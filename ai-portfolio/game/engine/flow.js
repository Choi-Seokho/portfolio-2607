// 게임 흐름: 차례 종료 → (모든 플레이어) → 적 차례 → 라운드 종료 → (마지막 라운드) 챕터 종료
//          → 정비 → 암시장(마지막 챕터 제외) → 챕터 준비 → 배치 → 다음 챕터 … → 게임 종료

import {
  TASKS, emit, push, ask, charsOf, drawPlayerCards, drawCard, facilityEffects, runBlocks, clearStatuses, card,
  gainCoins, bagCap, pcards, handMax, enemyRevealMode, turnActions, perksWithHook, assignedBonuses,
  ref, dist, rangeOf, fail,
} from './core.js';
import { reachableCells } from './query.js';
import { shuffle } from './rng.js';
import { placementQueue } from './setup.js';
import { revealEnemyCell } from './supply.js';


// ---------- 차례 종료 ----------
TASKS.turn_end = (ctx, t) => {
  const { s } = ctx;
  if (!t.stage) {
    // 시설 효과(차례가 끝날 때)
    for (const b of facilityEffects(ctx, t.player).filter((x) => x.timing === 'turn_end')) {
      const alive = charsOf(ctx, t.player).filter((c) => !c.exhausted && c.cell != null);
      // 텃밭에 배치한 닭(생존자 mod_heal, 2026-10-08 — 예전엔 데이터만 있고 적용 안 됨): 회복량 +amount
      const healBonus = b.block === 'heal' ? assignedBonuses(ctx, t.player).filter((x) => x.block === 'mod_heal').reduce((n, x) => n + (x.amount ?? 0), 0) : 0;
      if (alive.length) runBlocks(ctx, [b], { player: t.player, char: alive.sort((a, b2) => a.hp - b2.hp)[0], heal_bonus: healBonus });
    }
    if (s.config.hand.draw_at_turn_end && charsOf(ctx, t.player).some((c) => !c.exhausted)) drawPlayerCards(ctx, t.player, s.config.hand.draw_at_turn_end);
    t.stage = 'next';
    // 카드 운용 버전(hand.limit_at 'turn_end', 2026-10-18 사용자 결정): 차례 중엔 손패 한도 없음(카드 뽑기 카드로 얼마든지) →
    // 차례를 끝낼 때 turn_end_keep장(5)까지 버린다. 다음 플레이어 차례가 시작되기 전에 고르게 hand_limit을 먼저
    if (s.config.hand.limit_at === 'turn_end') push(ctx, { type: 'hand_limit', players: [t.player], turn_end: true, limit: s.config.hand.turn_end_keep ?? handMax(ctx) }, t);
    else push(ctx, t, { type: 'hand_limit', players: [t.player] });
    return;
  }
  clearStatuses(ctx, ['this_turn', 'this_action', 'this_move']);
  emit(ctx, { type: 'turn_ended', player: t.player });
  const order = s.game.turn_order;
  const i = order.indexOf(t.player);
  if (i < order.length - 1) startTurn(ctx, order[i + 1]);
  else {
    s.turn.phase = 'enemy_turn';
    s.turn.current_player = null;
  }
};

export function startTurn(ctx, player) {
  const { s } = ctx;
  s.turn.phase = 'player_turn';
  s.turn.current_player = player;
  s.turn.actions_left = turnActions(s, player);
  s.turn.char_used = {};
  s.turn.act = {};   // 활성화 방식: 캐릭터마다 { move, attack, done }
  emit(ctx, { type: 'turn_started', player });
}

// ---------- 카드를 보고 고르기(2026-10-08 미구현 카드 채우기) — 결정 종류 pick_card ----------
// 덱에서 손패로 옮기지 않고 k장만 꺼낸다(덱이 모자라면 버린 더미를 섞어 덱 아래에 붙임 — drawPlayerCards와 같은 재활용 규칙)
function peekPlayerDeck(ctx, player, k) {
  const P = pcards(ctx, player);
  if (P.deck.length < k && P.discard.length) P.deck.push(...shuffle(ctx.s, P.discard.splice(0)));
  return P.deck.slice(0, k);
}

// 예언자 "예지": 덱 위 look장 중 take장을 손패로, 나머지는 원래 순서대로 덱 위에
TASKS.look_take = (ctx, t) => {
  const P = pcards(ctx, t.player);
  if (!t.options) {
    t.options = peekPlayerDeck(ctx, t.player, t.look);
    if (!t.options.length) return;
  }
  if (t.answer === undefined && t.options.length > t.take) {
    ask(ctx, t, { type: 'pick_card', purpose: 'look_take', player: t.player, character: t.char, options: [...t.options], count: t.take, card: t.card });
    return;
  }
  const picks = t.answer === undefined ? [...t.options] : [].concat(t.answer);
  for (const id of picks) { const i = P.deck.indexOf(id); if (i >= 0) P.deck.splice(i, 1); P.hand.push(id); }
  emit(ctx, { type: 'card_drawn', player: t.player, deck: 'player', count: picks.length });
  push(ctx, { type: 'hand_limit', players: [t.player] });
};

// 예언자 특전 1(draw_look_extra · player): 예언자가 플레이어 카드를 뽑을 때(휴식 · 캠프) n + extra장을 보고 n장 선택, 나머지는 버림
export function playerDrawFor(ctx, ch, n) {
  if (n <= 0) return null;
  const extra = (perksWithHook(ctx, ch, 'on_draw').flatMap((p) => p.effect).find((b) => b.block === 'draw_look_extra' && (b.decks ?? []).includes('player'))?.amount) ?? 0;
  if (!extra) { drawPlayerCards(ctx, ch.owner, n); return null; }
  return { type: 'oracle_draw', player: ch.owner, char: ch.id, n, extra };
}
TASKS.oracle_draw = (ctx, t) => {
  const P = pcards(ctx, t.player);
  if (!t.options) {
    t.options = peekPlayerDeck(ctx, t.player, t.n + t.extra);
    for (const id of t.options) P.deck.splice(P.deck.indexOf(id), 1);   // 덱에서 꺼내 둠(고른 것은 손패, 나머지는 버린 더미)
    if (!t.options.length) return;
  }
  if (t.answer === undefined && t.options.length > t.n) {
    ask(ctx, t, { type: 'pick_card', purpose: 'oracle_draw', player: t.player, character: t.char, options: [...t.options], count: t.n });
    return;
  }
  const picks = t.answer === undefined ? [...t.options] : [].concat(t.answer);
  const rest = [...t.options];
  for (const id of picks) { rest.splice(rest.indexOf(id), 1); P.hand.push(id); }
  P.discard.push(...rest);
  emit(ctx, { type: 'card_drawn', player: t.player, deck: 'player', count: picks.length });
};

// 예언자 특전 2(draw_look_extra · supply, 라운드당 1회): 보급품을 뽑을 때 n + 1장을 보고 n장 선택(나머지는 버린 보급품 더미로 — 함정이어도 효과 없음)
TASKS.oracle_supply = (ctx, t) => {
  if (t.answer === undefined && t.cards.length > t.n) {
    ask(ctx, t, { type: 'pick_card', purpose: 'oracle_supply', player: ctx.s.chars[t.char].owner, character: t.char, options: [...t.cards], count: t.n });
    return;
  }
  const picks = t.answer === undefined ? [...t.cards] : [].concat(t.answer);
  const rest = [...t.cards];
  for (const id of picks) rest.splice(rest.indexOf(id), 1);
  ctx.s.decks.supply_discard.push(...rest);
  push(ctx, { type: 'acquire', char: t.char, cards: picks, from_deck: true });   // from_deck: 덱에서 나온 적 카드는 배치 + 한 장 더(2026-10-08)
};

// 손패 한도 초과(플레이어 공용 손패): 플레이어마다 버릴 카드를 고른다
TASKS.hand_limit = (ctx, t) => {
  // 카드 운용 버전: 차례 끝 검사(turn_end)만 한다 — 캠프 · 휴식 · 뽑기 효과 뒤의 한도 검사는 건너뜀(2026-10-18)
  if (ctx.s.config.hand.limit_at === 'turn_end' && !t.turn_end) return;
  const limit = t.limit ?? handMax(ctx);
  t.i ??= 0;
  while (t.i < t.players.length) {
    const player = t.players[t.i];
    const P = pcards(ctx, player);
    const over = P.hand.length - limit;
    if (over > 0) {
      if (t.answer === undefined) {
        ask(ctx, t, { type: 'discard_to_hand_limit', player, count: over, keep: limit, ...(t.turn_end ? { at: 'turn_end' } : {}) });
        return;
      }
      for (const id of t.answer) { P.hand.splice(P.hand.indexOf(id), 1); P.discard.push(id); }
      t.answer = undefined;
    }
    t.i++;
  }
};

// ---------- 라운드 · 챕터 종료 ----------
TASKS.round_end = (ctx) => {
  const { s } = ctx;
  clearStatuses(ctx, ['enemy_turn', 'round']);
  for (const p of Object.values(s.players)) p.round_flags = {};
  // 라운드에 한 번 쓰는 장비(눕힌 카드)를 다시 세운다
  for (const ch of Object.values(s.chars)) {
    if (!ch.tapped?.length) continue;
    emit(ctx, { type: 'items_readied', character: ch.id, cards: ch.tapped });
    ch.tapped = [];
  }
  emit(ctx, { type: 'round_ended', round: s.game.round, chapter: s.game.chapter });
  if (s.game.round >= s.config.rounds_per_chapter) {
    push(ctx, { type: 'chapter_end' });
    return;
  }
  // 라운드 끝 회복 · 뽑기(config.recovery.round_end · hand.round_end_draw). 지금 규칙은 둘 다 0이라 아무 일 없음.
  // 2026-10-18 사용자 결정(카드 운용 버전): 스테미너 최대치로 회복 · 카드 3장 뽑기(부족하면 테스트 뒤 조정) → 손패 한도 → 다음 라운드
  const rec = s.config.recovery?.round_end ?? {};
  for (const ch of Object.values(s.chars)) {
    if (ch.exhausted || ch.cell == null) continue;
    if (rec.stamina === 'full') ch.stamina = ch.max_stamina;
    else if (rec.stamina) ch.stamina = Math.min(ch.max_stamina, ch.stamina + rec.stamina);
    if (rec.hp) ch.hp = Math.min(ch.max_hp, ch.hp + rec.hp);
  }
  // 라운드 끝 보충(hand.round_end_fill_to, 2026-10-18 사용자 결정 — 카드 운용 버전 "5장이 될 때까지": 3장이면 2장, 5장 이상이면 안 뽑음).
  // 예전 하루(같은 날) 첫 안은 3장 뽑기(round_end_draw) — "카드를 생각보다 많이 쓴다"는 플레이 뒤 바꿈. round_end_draw도 남겨 둠
  const fill = s.config.hand.round_end_fill_to ?? 0;
  if (fill > 0) for (const p of s.game.turn_order) {
    const n = fill - pcards(ctx, p).hand.length;
    if (n > 0 && charsOf(ctx, p).some((c) => !c.exhausted)) drawPlayerCards(ctx, p, n);
  }
  const draw = s.config.hand.round_end_draw ?? 0;
  if (draw > 0) {
    for (const p of s.game.turn_order) if (charsOf(ctx, p).some((c) => !c.exhausted)) drawPlayerCards(ctx, p, draw);
    push(ctx, { type: 'hand_limit', players: [...s.game.turn_order] }, { type: 'round_start' });
    return;
  }
  s.game.round += 1;
  startTurn(ctx, s.game.turn_order[0]);
};
TASKS.round_start = (ctx) => {
  ctx.s.game.round += 1;
  startTurn(ctx, ctx.s.game.turn_order[0]);
};

// 드러나 있던 일반 적을 치운다: 적 카드는 덱 · 버린 더미로 돌려보냄(보스는 제자리에 남고 다음 챕터 준비 때 체력만 회복).
// 원래는 다음 챕터 준비(chapter_prep)에서 치웠는데, 정비 · 암시장 내내 지난 챕터 적이 보드에 남아 어색해 보여서
// 챕터가 끝나는 순간 치우도록 옮겼다(2026-10-07 사용자 피드백 "오늘 9"). 챕터 준비의 같은 반복문은 안전망으로 남아 있다.
function clearEnemies(ctx) {
  const { s } = ctx;
  const gone = Object.keys(s.enemies);
  for (const f of Object.values(s.enemies)) {
    if (f.from_supply) s.decks.supply_discard.push(f.from_supply);
    else if (f.from_search) s.decks.search_discard.push(f.from_search);
    else s.decks.enemy.push(f.type);
  }
  s.enemies = {};
  if (gone.length) emit(ctx, { type: 'enemies_cleared', enemies: gone });
}

TASKS.chapter_end = (ctx) => {
  const { s } = ctx;
  for (const ch of Object.values(s.chars)) {
    ch.cell = null;
    ch.exhausted = false;
    ch.hp = ch.max_hp;
    ch.stamina = ch.max_stamina;
    ch.statuses = [];
    ch.tapped = [];
    ch.power_used = [];   // 챕터에 1번 쓰는 무기 능력 다시 사용 가능(2026-10-17)
  }
  clearEnemies(ctx);
  emit(ctx, { type: 'chapter_ended', chapter: s.game.chapter });
  s.turn.phase = 'maintenance';
  s.turn.current_player = null;
  s.maint_done = [];
  // 정비 시작 시 시설 효과(작업장 Lv3 부품 등)
  for (const p of s.game.turn_order) {
    for (const b of facilityEffects(ctx, p).filter((x) => x.timing === 'maintenance')) runBlocks(ctx, [b], { player: p, char: null });
  }
  // 카드 운용 버전 레벨업(2026-10-19 사용자 결정): 챕터가 끝나면(config.card_mode.level_up_at) 캐릭터마다 새 카드 1장을 고르고, 덱 전체에서 1장을 버려 장수 유지
  if (s.config.turn_mode === 'cards' && (s.config.card_mode?.level_up_at ?? []).includes(s.game.chapter)) {
    for (const p of s.game.turn_order) for (const ch of charsOf(ctx, p)) push(ctx, { type: 'level_up', player: p, char: ch.id });
  }
};

// ---------- 카드 운용 버전 레벨업(2026-10-19 사용자 결정) ----------
// 1챕터 끝: 그 캐릭터의 Lv2 카드 2장 중 1장 · 2챕터 끝: Lv3 3장 + 아직 안 고른 Lv2 1장 중 1장 → 고른 카드는 덱에 섞음.
// 이어서 내 카드 전부(손패 · 덱 · 버린 카드, 방금 얻은 카드 포함) 중 1장을 골라 게임에서 뺀다(덱 장수 유지 — "덱 보는 화면"에서 고름).
export function levelUpOptions(s, content, charId) {
  const ch = s.chars[charId];
  const taken = s.players[ch.owner].level_taken?.[charId] ?? [];
  const maxLv = (s.game.chapter ?? 1) + 1;
  return content.chars[ch.char].signature_cards
    .filter((c) => (c.level ?? 1) >= 2 && (c.level ?? 1) <= maxLv && !taken.includes(c.id))
    .map((c) => c.id);
}
TASKS.level_up = (ctx, t) => {
  const { s } = ctx;
  const ch = s.chars[t.char];
  const P = pcards(ctx, t.player);
  if (!t.stage) {
    const options = levelUpOptions(s, ctx.c, t.char);
    if (!options.length) return;
    if (t.answer === undefined) { ask(ctx, t, { type: 'level_up_pick', player: t.player, character: t.char, options, chapter: s.game.chapter }); return; }
    const id = t.answer;
    t.answer = undefined;
    ((P.level_taken ??= {})[t.char] ??= []).push(id);
    P.deck.push(id);
    shuffle(s, P.deck);
    emit(ctx, { type: 'card_gained', player: t.player, character: ch.id, card: id, level: card(ctx, id)?.level ?? 1 });
    t.stage = 'remove';
  }
  if (t.answer === undefined) { ask(ctx, t, { type: 'level_up_remove', player: t.player, character: t.char }); return; }
  const { zone, card: id } = t.answer;
  const pile = { hand: P.hand, deck: P.deck, discard: P.discard }[zone];
  pile.splice(pile.indexOf(id), 1);
  (P.removed ??= []).push(id);
  emit(ctx, { type: 'card_removed', player: t.player, card: id, zone });
};

// ---------- 연속 행동(combo, 2026-10-19 사용자 결정 — 카드 운용 버전) ----------
// steps: [{ move: n } | { attack: { range?, bonus? } }]. 단계마다 묻는다(combo_step): 이동 = 갈 칸(지금 칸 = 제자리) · 공격 = 사거리 안의 대상 또는 'skip'.
// 앞 단계 결과(쓰러짐 · 반응 · 피해)가 다 끝난 뒤 다음 단계를 묻는다. 고를 것이 없으면 그 단계는 건너뜀. 이 캐릭터가 쓰러지면 끝
export function comboTargets(s, content, charId, step) {
  const ctx = { s, c: content, map: content.maps[s.map_id] };
  const ch = s.chars[charId];
  const range = step.attack.range ?? rangeOf(ctx, ch);
  const foes = [...Object.values(s.enemies), ...Object.values(s.bosses)].filter((f) => f.cell != null && dist(ctx, f.cell, ch.cell) <= range).map((f) => f.uid);
  const chars = Object.values(s.chars).filter((c) => c.owner !== ch.owner && !c.exhausted && c.cell != null && dist(ctx, c.cell, ch.cell) <= range).map((c) => c.id);
  return [...foes, ...chars];
}
export function comboCells(s, content, charId, step) {
  return [...reachableCells(s, content, charId, { budget: step.move, ignoreTurn: true })].filter(([, i]) => !i.grapple).map(([c, i]) => ({ cell: c, path: i.path }));
}
TASKS.combo = (ctx, t) => {
  const { s } = ctx;
  const ch = s.chars[t.char];
  if (!ch || ch.exhausted || ch.cell == null) return;
  while (t.i < t.steps.length) {
    const st = t.steps[t.i];
    const ask1 = (step, options) => ask(ctx, t, { type: 'combo_step', step, player: ch.owner, character: ch.id, card: t.card, index: t.i, total: t.steps.length, options });
    if (st.move != null) {
      const cells = comboCells(s, ctx.c, ch.id, st);
      if (!cells.length) { t.i++; continue; }
      if (t.answer === undefined) { ask1('move', [ch.cell, ...cells.map((x) => x.cell)]); return; }
      const to = t.answer;
      t.answer = undefined;
      t.i++;
      const go = cells.find((x) => x.cell === to);
      if (go) { push(ctx, { type: 'do_move', char: ch.id, path: go.path }, { ...t, waiting: false }); return; }
      continue;   // 제자리
    }
    if (st.attack) {
      const opts = comboTargets(s, ctx.c, ch.id, st);
      if (!opts.length) { t.i++; continue; }
      if (t.answer === undefined) { ask1('attack', [...opts, 'skip']); return; }
      const who = t.answer;
      t.answer = undefined;
      t.i++;
      if (who !== 'skip') {
        const target = who in s.chars ? { kind: 'char', id: who } : { kind: 'foe', id: who };
        push(ctx, { type: 'card_attack', char: ch.id, target, range: st.attack.range ?? null, bonus: st.attack.bonus ?? 0, card: t.card }, { ...t, waiting: false });
        return;
      }
      continue;
    }
    t.i++;
  }
};

TASKS.maintenance_end = (ctx) => {
  const { s } = ctx;
  const last = s.game.chapter >= s.config.chapters;
  if (last) { push(ctx, { type: 'game_end' }); return; }
  if (s.config.black_market.enabled) {
    s.turn.phase = 'black_market';
    s.board.black_market = [];
    s.board.bm_place = {};
    s.board.bm_to = {};
    for (let i = 0; i < s.game.turn_order.length + (s.config.black_market.extra_cards ?? 0); i++) {
      const id = drawCard(ctx, 'black_market');
      if (id) s.board.black_market.push(id);
    }
    emit(ctx, { type: 'black_market_opened', cards: [...s.board.black_market] });
  } else {
    toChapterPrep(ctx);
  }
};

export function toChapterPrep(ctx) {
  const { s } = ctx;
  s.game.chapter += 1;
  s.game.round = 1;
  s.turn.phase = 'chapter_prep';
}

// ---------- 암시장 (플레이어 단위, 2026-09-30 AC-2) ----------
// 플레이어마다 카드 1장에만 참가(board.bm_place[카드] = [플레이어…]), 받을 곳은 board.bm_to[플레이어](캐릭터 id · 'storage' · 없음).
// 경쟁에 낼 수 있는 카드는 그 플레이어의 두 캐릭터 가방 + 창고(장비 · 부품 제외). 포기(카드 없이 탈락)도 가능.
const EQUIP = new Set(['weapon', 'armor', 'accessory']);
const biddable = (ctx, id) => id !== 'part' && card(ctx, id) && !EQUIP.has(card(ctx, id).kind) && card(ctx, id).source !== 'token';   // 토큰 카드는 경쟁에 못 냄

// 플레이어가 경쟁에 낼 수 있는 카드(가방들 + 창고, 같은 카드가 여러 장이면 그만큼)
export function submittable(ctx, player) {
  const bags = charsOf(ctx, player).flatMap((c) => c.bag);
  return [...bags, ...ctx.s.shelter[player].storage].filter((id) => biddable(ctx, id));
}

// 동점 뒤 추가로 낼 수 있는 카드(처음 낸 카드 한 장은 제외)
export function remainingBids(ctx, player, first) {
  const list = submittable(ctx, player);
  const i = list.indexOf(first);
  if (i >= 0) list.splice(i, 1);
  return list;
}

// 플레이어의 소지품(가방들 → 창고 순)에서 카드 한 장을 꺼낸다
function takeFrom(ctx, player, id) {
  for (const c of charsOf(ctx, player)) { const i = c.bag.indexOf(id); if (i >= 0) { c.bag.splice(i, 1); return true; } }
  const st = ctx.s.shelter[player].storage;
  const i = st.indexOf(id);
  if (i >= 0) { st.splice(i, 1); return true; }
  return false;
}

TASKS.bm_resolve_all = (ctx) => {
  const cards = [...ctx.s.board.black_market];
  push(ctx, ...cards.map((id) => ({ type: 'bm_card', card: id })), { type: 'bm_finish' });
};

// 암시장 코인 가격: 카드 비용 + 그 플레이어 캐릭터 특성의 할인(mod_black_market_cost, 예: 브로커 -2), 최소 0
export function bmPrice(ctx, player, id) {
  let cost = card(ctx, id).cost ?? 0;
  for (const c of charsOf(ctx, player)) for (const p of c.char ? ctx.c.chars[c.char].perks : []) {
    if (p.hook !== 'passive') continue;
    for (const b of p.effect) if (b.block === 'mod_black_market_cost') cost += b.amount;
  }
  return Math.max(0, cost);
}
function buy(ctx, player, id, { byCoins }) {
  const s = ctx.s;
  if (byCoins) {
    const cost = bmPrice(ctx, player, id);
    if (s.players[player].coins < cost) return false;
    gainCoins(ctx, player, -cost);
  }
  // 받을 곳: 고른 캐릭터의 가방(차 있으면 창고) · 창고 · (안 골랐으면) 가방에 자리가 있는 첫 캐릭터, 없으면 창고
  const want = s.board.bm_to?.[player];
  const mine = charsOf(ctx, player);
  let ch = want && want !== 'storage' ? mine.find((c) => c.id === want) : null;
  // 받을 곳을 안 골랐으면 창고(2026-10-04 신규 8 — 사람은 산 뒤에 정리 화면에서 옮김. AI는 입찰 때 받을 곳을 고름)
  const to = ch && ch.bag.length < bagCap(ctx, ch) ? ch.id : 'storage';
  (to === 'storage' ? s.shelter[player].storage : ch.bag).push(id);
  s.board.black_market.splice(s.board.black_market.indexOf(id), 1);
  emit(ctx, { type: 'bm_resolved', card: id, winner: player, player, to });
  push(ctx, { type: 'mission_progress', player, char: mine[0]?.id, trigger: { type: 'bm_bought' } });
  return true;
}

TASKS.bm_card = (ctx, t) => {
  const s = ctx.s;
  const order = s.game.turn_order;
  const byOrder = (list) => [...list].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const placed = byOrder(s.board.bm_place[t.card] ?? []);
  if (!t.stage) {
    if (placed.length === 0) return;
    if (placed.length === 1) { buy(ctx, placed[0], t.card, { byCoins: true }); return; }
    const eligible = placed.filter((p) => submittable(ctx, p).length > 0);
    if (eligible.length === 0) return;
    if (eligible.length === 1) { buy(ctx, eligible[0], t.card, { byCoins: true }); return; } // 혼자 남으면 코인 구매(Z-10)
    t.stage = 'bid';
    t.round = 1;
    t.bids = {};
    t.first = {};
    t.bidders = eligible;
  }
  // 입찰 수집(동시 비공개: 낸 카드는 작업 안에만 있고 뷰에는 안 보인다). null = 포기
  if (t.bid) { t.bids[t.bid.player] = t.bid.card; t.bid = undefined; }
  const waiting = t.bidders.filter((p) => !(p in t.bids));
  if (waiting.length) {
    ask(ctx, t, { type: t.round === 1 ? 'bm_bid' : 'bm_bid_extra', card: t.card, players: t.bidders, waiting });
    return;
  }
  const val = (p) => (t.bids[p] == null ? -1 : card(ctx, t.bids[p]).sell ?? 0);
  // 낸 카드 공개(입찰하면 공개 정보 — 2026-10-04 신규 8, 화면이 경쟁 결과를 보여 줌)
  emit(ctx, { type: 'bm_bids_revealed', card: t.card, round: t.round, bids: { ...t.bids } });
  let top;
  if (t.round === 1) {
    const best = Math.max(...t.bidders.map(val));
    if (best < 0) return;                                  // 모두 포기
    top = t.bidders.filter((p) => val(p) === best);
    if (top.length > 1) {
      // 동점: 한 장 더 제출(포기 가능), 추가 카드끼리 비교
      t.first = { ...t.bids };
      t.round = 2;
      t.bids = {};
      t.bidders = top.filter((p) => remainingBids(ctx, p, t.first[p]).length > 0);
      for (const p of top) if (!t.bidders.includes(p)) t.bids[p] = null; // 더 낼 카드가 없으면 포기
      if (t.bidders.length) {
        ask(ctx, t, { type: 'bm_bid_extra', card: t.card, players: t.bidders, waiting: [...t.bidders] });
        return;
      }
    }
  }
  if (t.round === 2) {
    // 추가 제출끼리 비교(모두 포기해도 같은 값끼리 동점 → 순서가 빠른 플레이어)
    const all = Object.keys(t.bids);
    const best2 = Math.max(...all.map(val));
    top = all.filter((p) => val(p) === best2);
  }
  const winner = byOrder(top)[0];
  for (const used of [t.first[winner], t.bids[winner]].filter(Boolean)) {
    takeFrom(ctx, winner, used);
    s.decks.supply_discard.push(used);
  }
  buy(ctx, winner, t.card, { byCoins: false });
};

TASKS.bm_finish = (ctx) => {
  const s = ctx.s;
  s.decks.black_market_box.push(...s.board.black_market);
  s.board.black_market = [];
  s.board.bm_place = {};
  s.board.bm_to = {};
  toChapterPrep(ctx);
};

// ---------- 챕터 준비 ----------
TASKS.chapter_prep = (ctx, t) => {
  const { s } = ctx;
  if (!t.stage) {
    emit(ctx, { type: 'chapter_started', chapter: s.game.chapter });
    // 드러난 적 제거 → 적 카드는 덱에 다시 섞음, 마커 제거, 보스는 제자리에서 체력 최대
    for (const f of Object.values(s.enemies)) {
      if (f.from_supply) s.decks.supply_discard.push(f.from_supply);
      else if (f.from_search) s.decks.search_discard.push(f.from_search);
      else s.decks.enemy.push(f.type);
    }
    s.enemies = {};
    s.decks.enemy.push(...s.decks.enemy_discard.splice(0));
    shuffle(s, s.decks.enemy);
    // 수색 덱도 챕터마다 다시 섞는다(F3b)
    s.decks.search.push(...s.decks.search_discard.splice(0));
    shuffle(s, s.decks.search);
    s.board.markers = [];
    s.board.cell_users = {};
    // 적 칸: 챕터 시작 때 모두 공개(reveal = chapter_start, 2026-10-01). 맵에 적힌 순서대로.
    // danger_zone(맵 설정, 2026-10-03)이면 여기서는 공개하지 않고, 캐릭터가 위험 구역에 들어설 때(배치 포함) 공개한다
    if (enemyRevealMode(ctx) === 'chapter_start') {
      for (const c of ctx.map.cells) if (c.type === 'enemy') revealEnemyCell(ctx, c.id);
    }
    for (const b of Object.values(s.bosses)) b.hp = b.max_hp;
    // 첫 챕터가 아니면 선 플레이어 교대
    if (s.game.chapter > 1) s.game.turn_order.push(s.game.turn_order.shift());
    // 보급품 3장 새로 공개(함정 · 크롤러는 효과 없이 버리고 다시)
    s.decks.supply_discard.push(...s.board.open_supply.filter(Boolean));
    s.board.open_supply = [];
    while (s.board.open_supply.length < s.config.supply_open_slots) {
      const id = drawCard(ctx, 'supply');
      if (id == null) break;
      const k = card(ctx, id).kind;
      if (k === 'trap' || k === 'enemy') { s.decks.supply_discard.push(id); continue; }
      s.board.open_supply.push(id);
    }
    t.stage = 'missions';
    t.queue = [...s.game.turn_order];
  }
  if (t.stage === 'missions') {
    while (t.queue.length) {
      const p = t.queue[0];
      const ms = s.players[p].missions;
      if (!t.options) {
        let n = s.config.missions.draw_per_player_per_chapter;
        for (const b of facilityEffects(ctx, p)) if (b.block === 'mod_mission_draw') n += b.amount;
        t.options = [];
        for (let i = 0; i < n; i++) { const id = drawCard(ctx, 'mission'); if (id) t.options.push(id); }
        if (t.options.length === 0) { t.options = null; t.queue.shift(); continue; }
      }
      if (t.answer === undefined) {
        const current = [...ms.hand, ...ms.active.map((a) => a.id)];
        const max_keep = s.config.missions.max_in_hand;
        // min_keep(2026-10-18 사용자 요청 "미션 고를 때 안 고르고 Space 누르면 그냥 넘어가진다 — 최소 2장은 골라야"):
        // 손에 남길 미션은 최소 min(한도, 고를 수 있는 장수). 예전엔 0장도 됐다
        const min_keep = Math.min(max_keep, new Set([...t.options, ...current]).size);
        ask(ctx, t, { type: 'mission_keep', player: p, options: t.options, max_keep, min_keep, current });
        return;
      }
      const keep = new Set(t.answer);
      // 고르지 않은 · 내려놓은 미션: 설정 missions.unkept가 'deck_bottom'이면 미션 덱 맨 아래로(재활용, AD-3), 아니면 상자로
      const away = s.config.missions.unkept === 'deck_bottom' ? s.decks.mission : s.decks.mission_box;
      for (const id of t.options) (keep.has(id) ? ms.hand : away).push(id);
      for (const id of [...ms.hand]) if (!keep.has(id)) { ms.hand.splice(ms.hand.indexOf(id), 1); away.push(id); }
      for (const a of [...ms.active]) if (!keep.has(a.id)) { ms.active.splice(ms.active.indexOf(a), 1); away.push(a.id); }
      t.answer = undefined;
      t.options = null;
      t.queue.shift();
    }
    t.stage = 'hands';
  }
  if (t.stage === 'hands') {
    const H = s.config.hand;
    if (!t.mulligan) {
      if (H.reset_at === 'chapter_start') {
        // (예전 규칙) 챕터마다 손패 리셋
        for (const p of s.game.turn_order) {
          const P = pcards(ctx, p);
          P.deck.push(...P.hand.splice(0), ...P.discard.splice(0));
          shuffle(s, P.deck);
          drawPlayerCards(ctx, p, H.draw_at_chapter_start ?? 0);
        }
      } else if (s.game.chapter === 1) {
        // 게임 시작: 플레이어마다 처음 손패(공용).
        for (const p of s.game.turn_order) drawPlayerCards(ctx, p, H.initial ?? 0);
      } else if (H.chapter_start_fill_to) {
        // 2026-10-18 사용자 결정("챕터 시작할 때 카드 드로우 다시 하자 — 손패 5장 될 때까지 보충, 멀리건 1회"):
        // 2챕터부터도 손패를 chapter_start_fill_to장까지 채운다(이미 그 이상이면 그대로, 버리지 않음).
        // 예전(2026-09-30 손패 규칙 변경)에는 2챕터부터 손패 · 덱 · 버린 카드를 그대로 이어 가고 보충 · 멀리건이 없었다.
        for (const p of s.game.turn_order) {
          const lack = H.chapter_start_fill_to - pcards(ctx, p).hand.length;
          if (lack > 0) drawPlayerCards(ctx, p, lack);
        }
      }
      // 멀리건: 'every_chapter_start' = 챕터마다 1회(2026-10-18 사용자 결정), 'once_at_game_start' = 예전 규칙(1챕터만)
      const doMulligan = H.mulligan === 'every_chapter_start' || (s.game.chapter === 1 && H.mulligan === 'once_at_game_start');
      t.mulligan = doMulligan ? [...s.game.turn_order] : [];
    }
    // 멀리건: 플레이어마다 원하는 만큼 버리고 같은 수를 새로 뽑은 뒤, 버린 카드는 덱에 섞는다(1회)
    while (t.mulligan.length) {
      const p = t.mulligan[0];
      const P = pcards(ctx, p);
      if (t.answer === undefined) {
        ask(ctx, t, { type: 'mulligan', player: p });
        return;
      }
      const out = t.answer;
      t.answer = undefined;
      t.mulligan.shift();
      if (!out.length) continue;
      for (const id of out) P.hand.splice(P.hand.indexOf(id), 1);
      drawPlayerCards(ctx, p, out.length);
      P.deck.push(...out);
      shuffle(s, P.deck);
      emit(ctx, { type: 'mulliganed', player: p, count: out.length });
    }
    // 시설 효과(챕터 준비 때)
    for (const p of s.game.turn_order) {
      for (const b of facilityEffects(ctx, p).filter((x) => x.timing === 'chapter_start' && x.block !== 'mod_mission_draw')) {
        const ch = charsOf(ctx, p)[0];
        runBlocks(ctx, [b], { player: p, char: ch });
      }
    }
    s.turn.phase = 'placement';
    s.placement_queue = placementQueue(s);
    if (s.placement_queue.length) s.pending = { type: 'placement', player: s.placement_queue[0] };
    else finishPlacement(ctx);
  }
};

export function finishPlacement(ctx) {
  const { s } = ctx;
  s.pending = null;
  s.game.round = 1;
  startTurn(ctx, s.game.turn_order[0]);
}

// ---------- 게임 종료 ----------
TASKS.game_end = (ctx) => {
  const { s } = ctx;
  const order = s.game.turn_order;
  // 최종 점수 = 승점 + 코인 × coin_value(소수점 버림). 2026-10-02: 코인 2개 = 1점(coin_value 0.5) — 코인이 점수의 61%라서
  const score = (p) => s.players[p].vp + Math.floor(s.players[p].coins * s.config.scoring.coin_value);
  const ranking = [...order].sort((a, b) => {
    const A = s.players[a];
    const B = s.players[b];
    return score(b) - score(a) || B.bosses_killed.length - A.bosses_killed.length
      || B.missions.completed.length - A.missions.completed.length || B.coins - A.coins || order.indexOf(a) - order.indexOf(b);
  });
  s.turn.phase = 'game_over';
  s.game.over = true;
  s.game.ranking = ranking;
  s.game.scores = Object.fromEntries(order.map((p) => [p, score(p)]));
  emit(ctx, { type: 'game_ended', ranking, scores: { ...s.game.scores } });
};
