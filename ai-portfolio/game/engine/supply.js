// 보급품 획득 · 함정 · 크롤러 · 가방 초과 · 칸 상호작용

import {
  TASKS, emit, push, ask, card, drawCard, bagCap, gainCoins, runBlocks, charsOf, drawPlayerCards,
  armorDefense, nextSeq, uid, perksWithHook, singleOcc, occupied, freeNeighbors, enemyRevealMode, dangerRadius, isHiddenEnemyCell, dist, enemyDefAt, perCharActions, charActionsLeft, partsValue, gainParts, activationMode, cellTier, tierBonus, gainVp,
} from './core.js';
import { cellOf } from './map.js';
import { playerDrawFor } from './flow.js';

function special(ctx, id) {
  const k = card(ctx, id)?.kind;
  return k === 'trap' || k === 'enemy';
}

// 함정 · 크롤러 처리. 대상 선택이 필요하면 'wait'를 돌려준다.
function resolveSpecial(ctx, t, id) {
  const taker = ctx.s.chars[t.char];
  const cd = card(ctx, id);
  if (t.special_used) {
    emit(ctx, { type: 'trap_skipped', card: id });
    ctx.s.decks.supply_discard.push(id);
    return 'done';
  }
  // 함정은 뽑은 캐릭터가 받는다(2026-10-04 사용자 결정 — 예전엔 같은 플레이어의 캐릭터 중 하나를 골랐음)
  const target = taker;
  t.special_used = true;
  if (cd.kind === 'enemy') {
    emit(ctx, { type: 'supply_ambush', card: id, character: taker.id });   // 화면이 카드를 먼저 보여 주게(2026-10-04 사용자 피드백 신규 1)
    runBlocks(ctx, cd.effect, { player: taker.owner, char: taker, cell: taker.cell, from_supply: id });
    return 'done';
  }
  emit(ctx, { type: 'trap_triggered', card: id, target: target.id });
  ctx.s.decks.supply_discard.push(id);
  runBlocks(ctx, cd.effect, { player: taker.owner, char: target, cell: taker.cell, source_char: taker });
  return 'done';
}

// 보급품 덱에서 나온 적 카드: 그 카드를 뽑은 캐릭터 칸(한 칸에 하나 규칙이면 옆 빈 칸)에 출현 — 카드는 그 적이 사라질 때 버린 더미로
function spawnSupplyEnemy(ctx, taker, id) {
  const cd = card(ctx, id);
  emit(ctx, { type: 'supply_ambush', card: id, character: taker.id });   // 화면이 카드를 먼저 보여 주게
  runBlocks(ctx, cd.effect, { player: taker.owner, char: taker, cell: taker.cell, from_supply: id });
}

// 카드 여러 장을 한 캐릭터가 얻는다: 함정 · 크롤러는 합쳐서 1회만 효과, 나머지는 가방으로, 넘치면 버릴 카드를 고른다(Z-8)
TASKS.acquire = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  t.i ??= 0;
  t.got ??= { supply: 0, investigation: 0, part: 0 };   // 미션용: 가방에 넣은 카드 수(함정 · 크롤러 제외)
  while (t.i < t.cards.length) {
    const id = t.cards[t.i];
    if (id !== 'part' && special(ctx, id)) {
      // 적 카드(크롤러 · 워커 · 러너)는 2026-10-08 사용자 결정: 적을 배치하고(함정의 "획득 1번에 효과 1번" 제한과 별개)
      // 보급품을 한 장 더 뽑는다 — 적이 보상 자리를 먹지 않게. 더 뽑은 카드도 같은 규칙(덱이 떨어지면 끝)
      // 2026-10-17 사용자 결정: 한 번 얻을 때 적은 1마리까지만 배치 — 두 번째부터 나온 적 카드는 배치하지 않고 버린 뒤 한 장 더
      // (예전엔 나올 때마다 배치해서 적이 줄줄이 나올 수 있었다)
      if (t.from_deck && card(ctx, id)?.kind === 'enemy') {
        if (!t.enemy_placed) { spawnSupplyEnemy(ctx, ctx.s.chars[t.char], id); t.enemy_placed = true; }
        else { ctx.s.decks.supply_discard.push(id); emit(ctx, { type: 'supply_enemy_skipped', card: id, character: t.char }); }
        const more = drawCard(ctx, 'supply');
        if (more != null) { t.cards.push(more); emit(ctx, { type: 'card_drawn', character: t.char, deck: 'supply', count: 1, replace: true }); }
        t.i++;
        continue;
      }
      if (resolveSpecial(ctx, t, id) === 'wait') return;
    } else {
      ch.bag.push(id);
      const src = id === 'part' ? 'part' : card(ctx, id)?.kind === 'investigation' ? 'investigation' : card(ctx, id)?.source === 'supply' ? 'supply' : null;
      if (src) t.got[src]++;
      const cd = card(ctx, id);
      if (cd?.kind === 'investigation' && cd.effect?.length) {
        runBlocks(ctx, cd.effect, { player: ch.owner, char: ch, cell: ch.cell });
      }
    }
    t.i++;
  }
  const mp = (trigger) => ({ type: 'mission_progress', player: ch.owner, char: ch.id, trigger });
  push(ctx, { type: 'bag_check', char: ch.id },
    t.got.supply && mp({ type: 'gain_card', kind: 'supply', count: t.got.supply }),
    t.got.investigation && mp({ type: 'gain_card', kind: 'investigation', count: t.got.investigation }),
    t.got.part && mp({ type: 'gain_material', material: 'part', count: t.got.part }));
};

TASKS.bag_check = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  const over = ch.bag.length - bagCap(ctx, ch);
  if (over <= 0) return;
  if (t.answer === undefined) {
    const pending = { type: 'bag_overflow', player: ch.owner, character: ch.id, discard_count: over };
    if (t.looted) pending.looted = [...t.looted.cards];      // 약탈로 가져온 카드(고르면 원래 가방으로 돌아감)
    ask(ctx, t, pending);
    return;
  }
  const looted = [...(t.looted?.cards ?? [])];
  const returned = [];
  for (const id of t.answer) {
    ch.bag.splice(ch.bag.indexOf(id), 1);
    const li = looted.indexOf(id);
    if (li >= 0) { looted.splice(li, 1); ctx.s.chars[t.looted.from].bag.push(id); returned.push(id); continue; }
    if (id !== 'part') ctx.s.decks.supply_discard.push(id);
    emit(ctx, { type: 'card_discarded', character: ch.id, card: id });
  }
  if (returned.length) emit(ctx, { type: 'loot_returned', character: ch.id, target: t.looted.from, cards: returned });
};

// 드러난 보급품 자리 채우기: 함정이 아닌 카드가 나올 때까지 연다. 함정 · 크롤러는 첫 장만 효과.
TASKS.refill = (ctx, t) => {
  while (true) {
    if (t.current) {
      if (resolveSpecial(ctx, t, t.current) === 'wait') return;
      t.current = null;
      continue;
    }
    const id = drawCard(ctx, 'supply');
    if (id == null) { ctx.s.board.open_supply[t.slot] = null; return; }
    // 보충 때 나온 적 카드(2026-10-08 사용자 결정): 드러난 카드를 가져간 캐릭터 주변에 매번 배치하고 계속 채운다
    if (card(ctx, id)?.kind === 'enemy' && t.char && ctx.s.chars[t.char]) { spawnSupplyEnemy(ctx, ctx.s.chars[t.char], id); continue; }
    if (special(ctx, id)) { t.current = id; continue; }
    ctx.s.board.open_supply[t.slot] = id;
    emit(ctx, { type: 'supply_opened', slot: t.slot, card: id });
    return;
  }
};

// 보급품을 얻는 모든 순간(? 칸 수색 · 적 처치 보상 · 카드 효과 등)에 드러난 보급품 중 1장을 대신 가져갈 수 있다
// (2026-10-08 사용자 요청 — 맵에서 보급품 칸이 빠진 뒤로 드러난 보급품을 가져갈 방법이 없었음. 규칙: 드러난 카드는 한 장만, 나머지는 덱에서)
export function drawSupplyTo(ctx, ch, n) {
  return { type: 'supply_draw', char: ch.id, n };
}
TASKS.supply_draw = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (!ch || t.n <= 0) return;
  const open = ctx.s.board.open_supply ?? [];
  const slots = open.map((id, i) => (id ? i : null)).filter((x) => x != null);
  if (t.answer === undefined && slots.length) {
    ask(ctx, t, { type: 'supply_source', player: ch.owner, character: ch.id, count: t.n, options: ['hidden', ...slots] });
    return;
  }
  let n = t.n;
  const after = [];
  if (typeof t.answer === 'number') {
    const id = open[t.answer];
    open[t.answer] = null;
    emit(ctx, { type: 'open_supply_taken', character: ch.id, slot: t.answer, card: id });
    after.push({ type: 'acquire', char: ch.id, cards: [id] }, { type: 'refill', slot: t.answer, char: ch.id });
    n -= 1;
  }
  push(ctx, n > 0 ? drawSupplyHidden(ctx, ch, n) : null, ...after);
};

// 감춰진 보급품(덱 맨 위) n장 — 예전 drawSupplyTo
export function drawSupplyHidden(ctx, ch, n) {
  const cards = [];
  // 예언자 특전 2(라운드당 1회): 1장 더 보고 고름 — TASKS.oracle_supply(flow.js)가 고른 뒤 acquire
  const look = n > 0 ? perksWithHook(ctx, ch, 'on_draw').flatMap((p) => p.effect).find((b) => b.block === 'draw_look_extra' && (b.decks ?? []).includes('supply')) : null;
  const flag = `oracle_supply_${ch.id}`;
  const rf = ctx.s.players[ch.owner].round_flags;
  const extra = look && !rf[flag] ? look.amount ?? 1 : 0;
  if (extra) rf[flag] = true;
  for (let i = 0; i < n + extra; i++) {
    const id = drawCard(ctx, 'supply');
    if (id != null) cards.push(id);
  }
  if (cards.length) emit(ctx, { type: 'card_drawn', character: ch.id, deck: 'supply', count: cards.length });
  if (extra) return { type: 'oracle_supply', char: ch.id, cards, n };
  return { type: 'acquire', char: ch.id, cards, from_deck: true };
}

// ---------- 칸 상호작용 ----------
export const INTERACT_TYPES = new Set(['supply', 'investigate', 'lab', 'survivor', 'money', 'resource', 'camp', 'search']);

// 적 칸 공개: 적 카드 1장 → 토큰 배치 · 상호작용 마커. 드러난 적은 그 라운드 적 차례부터 행동.
// 들어설 때(on_enter) 또는 챕터 시작 때(chapter_start) 쓴다.
export function revealEnemyCell(ctx, cell) {
  const type = drawCard(ctx, 'enemy');
  const at = type ? spawnCell(ctx, cell) : null;
  if (type && at) {
    const id = spawnFoe(ctx, type, at);
    emit(ctx, { type: 'enemy_revealed', enemy: id, enemy_type: type, cell: at });
  } else if (type) ctx.s.decks.enemy_discard.push(type);   // 놓을 자리가 없으면 출현하지 않음
  ctx.s.board.markers.push(cell);
  emit(ctx, { type: 'marker_placed', cell });
}

// 위험 구역(danger_zone): 캐릭터가 들어선 · 지나간 칸에서 radius칸 안의 감춰진 적 칸을 모두 공개(맵에 적힌 순서대로)
export function revealDangerZones(ctx, cellIds) {
  if (enemyRevealMode(ctx) !== 'danger_zone') return;
  const r = dangerRadius(ctx);
  for (const c of ctx.map.cells) {
    if (c.type !== 'enemy' || !isHiddenEnemyCell(ctx, c.id)) continue;
    if (cellIds.some((x) => x != null && dist(ctx, x, c.id) <= r)) revealEnemyCell(ctx, c.id);
  }
}

// 카드 판매(정비 판매 · 브로커 '자산 정리' 공용). 재료 카드는 코인 대신 부품 토큰(정비 = 창고로, 챕터 중 = 가방으로),
// 다른 카드는 판매가만큼 코인. 판매 특전(브로커)은 그 플레이어의 캐릭터 중 누가 팔아도 적용(2026-10-03 사용자 결정 — 돈 쪽 강점)
export function sellCard(ctx, ch, id, list, { fromStorage = false } = {}) {
  const cd = card(ctx, id);
  list.splice(list.indexOf(id), 1);
  (cd.source === 'black_market' ? ctx.s.decks.black_market_box : ctx.s.decks.supply_discard).push(id);
  const parts = partsValue(ctx.c, id);
  if (parts > 0) {
    gainParts(ctx, ch.owner, parts, { char: ch.id });   // 재료 카드는 팔면 부품(자원)으로
    if (cd.sell_coins) gainCoins(ctx, ch.owner, cd.sell_coins, { sale: true });   // 코인 + 부품 카드(쓸 만한 잡동사니)
  } else gainCoins(ctx, ch.owner, cd.sell, { sale: true });
  for (const c of charsOf(ctx, ch.owner)) for (const p of perksWithHook(ctx, c, 'on_sell')) runBlocks(ctx, p.effect, { player: ch.owner, char: c });
  emit(ctx, { type: 'sold', character: ch.id, card: id, amount: parts > 0 ? cd.sell_coins ?? 0 : cd.sell, parts });
}

// 생존자 · 연구 토큰 n개를 쉘터로(미션 진행 포함)
export function gainTokens(ctx, ch, deck, n) {
  const got = [];
  for (let i = 0; i < n; i++) { const id = drawCard(ctx, deck); if (id) got.push(id); }
  const sh = ctx.s.shelter[ch.owner];
  const token = deck === 'lab' ? 'research' : 'survivor';
  // 2026-10-07엔 토큰 카드를 캐릭터 가방으로 보냈지만(94번), 2026-10-08 사용자 결정(AF-1)으로 "카드이되 가방 슬롯은 차지하지 않고
  // 얻는 즉시 쉘터로" — 연구 카드는 연구 보관함(shelter.research, 캐릭터가 필요할 때 거기서 꺼내 씀), 생존자 카드는 쉘터 대기(survivor_pool).
  // 카드 모양 · 시설 카드 아래 겹치기는 그대로(토큰 id = 카드 id). 약탈 · 탈진으로 잃지 않는다.
  (deck === 'lab' ? sh.research : sh.survivor_pool).push(...got);
  emit(ctx, { type: 'token_gained', player: ch.owner, token, ids: got, to: 'shelter' });
  return got.map(() => ({ type: 'mission_progress', player: ch.owner, char: ch.id, trigger: { type: 'gain_token', token } }));
}

// ? 칸 수색 공개. 예언자 특전 2(라운드당 1번, 보급품과 같은 횟수 — 2026-10-08 사용자 결정 "적 카드를 뽑을 때"):
// 2장을 보고 1장을 고르면 그 카드만 효과, 다른 한 장은 효과 없이 수색 버린 더미로(습격 카드를 피할 수 있음)
TASKS.search_reveal = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (!ch) return;
  if (!t.cards) {
    const look = perksWithHook(ctx, ch, 'on_draw').flatMap((p) => p.effect).find((b) => b.block === 'draw_look_extra' && (b.decks ?? []).includes('supply'));
    const rf = ctx.s.players[ch.owner].round_flags;
    const flag = `oracle_supply_${ch.id}`;
    const n = look && !rf[flag] ? 1 + (look.amount ?? 1) : 1;
    if (n > 1) rf[flag] = true;
    t.cards = [];
    for (let i = 0; i < n; i++) { const id = drawCard(ctx, 'search'); if (id) t.cards.push(id); }
    if (!t.cards.length) return;
  }
  if (t.cards.length > 1 && t.answer === undefined) {
    ask(ctx, t, { type: 'pick_card', purpose: 'oracle_search', player: ch.owner, character: ch.id, options: [...t.cards], count: 1 });
    return;
  }
  const id = t.answer ?? t.cards[0];
  for (const x of t.cards) if (x !== id) ctx.s.decks.search_discard.push(x);
  const cd = card(ctx, id);
  emit(ctx, { type: 'search_revealed', character: ch.id, cell: t.cell, card: id });
  const spawns = (cd.effect ?? []).some((b) => b.block === 'spawn_enemy');
  if (!spawns) ctx.s.decks.search_discard.push(id);
  runBlocks(ctx, cd.effect ?? [], { player: ch.owner, char: ch, cell: t.cell, from_search: id });
};

TASKS.interact = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (!ch || ch.exhausted) return;
  const cell = cellOf(ctx.map, ch.cell);
  const player = ch.owner;
  const tasks = [];
  if (cell.type !== 'camp') {
    ctx.s.board.markers.push(cell.id);   // 쓴 횟수만큼 쌓임(칸 사용 횟수 cell_uses)
    ((ctx.s.board.cell_users ??= {})[cell.id] ??= []).push(ch.id);
  }
  // 중앙 보상: 칸 등급에 따라 금품 · 부품 +amount, 보급품 · 조사 카드 +extra_card, 승점 +vp(캠프 제외)
  const tb = cell.type === 'camp' ? {} : tierBonus(ctx.s.config, cellTier(ctx.map, cell.id));
  switch (cell.type) {
    case 'supply': {
      if (t.option === 'hidden' || t.option == null) {
        tasks.push(drawSupplyHidden(ctx, ch, (cell.amount ?? 1) + (tb.extra_card ?? 0)));   // 칸에서 이미 고름
      } else {
        if (tb.extra_card) tasks.push(drawSupplyHidden(ctx, ch, tb.extra_card));
        const slot = t.option.open;
        const id = ctx.s.board.open_supply[slot];
        ctx.s.board.open_supply[slot] = null;
        tasks.push({ type: 'acquire', char: ch.id, cards: [id] });
        tasks.push({ type: 'refill', slot, char: ch.id });
      }
      break;
    }
    case 'investigate': {
      let n = 1 + (tb.extra_card ?? 0);
      for (const p of perksWithHook(ctx, ch, 'on_interact')) {
        if (p.cell_type === 'investigate') for (const b of p.effect) if (b.block === 'draw_investigation') n += b.amount;
      }
      const cards = [];
      for (let i = 0; i < n; i++) { const id = drawCard(ctx, 'investigation'); if (id) cards.push(id); }
      emit(ctx, { type: 'card_drawn', character: ch.id, deck: 'investigation', count: cards.length });
      tasks.push({ type: 'acquire', char: ch.id, cards });
      break;
    }
    case 'lab':
    case 'survivor':
      tasks.push(...gainTokens(ctx, ch, cell.type === 'lab' ? 'lab' : 'survivor', cell.amount ?? 1));
      break;
    case 'search': {
      // ? 칸: 수색 덱 맨 위 한 장 공개 → 효과 처리. 적 카드는 그 적이 사라질 때, 나머지는 바로 수색 버린 더미로(F3b)
      tasks.push({ type: 'search_reveal', char: ch.id, cell: cell.id });
      break;
    }
    case 'money':
      gainCoins(ctx, player, (cell.amount ?? 1) + (tb.amount ?? 0));
      break;
    case 'resource':
      gainParts(ctx, player, (cell.amount ?? 1) + (tb.amount ?? 0), { char: ch.id });   // 부품은 바로 자원으로(가방 X, 신규 4)
      break;
    case 'camp': {
      // 활성화 방식: 캠프 = 휴식(2026-10-04 사용자 결정 — 예전 휴식보다 강하고 예전 캠프보다 약하게): config.recovery.camp
      const cc = activationMode(ctx.s) ? ctx.s.config.recovery?.camp : null;
      if (cc) {
        const hpBefore = ch.hp;
        ch.hp = cc.hp === 'full' ? ch.max_hp : Math.min(ch.max_hp, ch.hp + (cc.hp ?? 0));
        ch.stamina = cc.stamina === 'full' ? ch.max_stamina : Math.min(ch.max_stamina, ch.stamina + (cc.stamina ?? 0));
        emit(ctx, { type: 'rested', character: ch.id, hp: ch.hp - hpBefore, mode: 'camp' });
        // 예언자면 1장 더 보고 고름(2026-10-08) — playerDrawFor가 작업을 돌려주면 그 작업이 뽑기를 마무리
        const pd = playerDrawFor(ctx, ch, cc.draw ?? 0);
        if (pd) tasks.push(pd);
        // 2026-10-17 무작위 시뮬레이션에서 발견: 캠프로 뽑은 뒤 손패 한도 검사가 빠져 차례 끝까지 8~9장을 들고 쓸 수 있었음 → 휴식 · 뽑기 효과처럼 바로 검사
        tasks.push({ type: 'hand_limit', players: [ch.owner] });
        emit(ctx, { type: 'resupplied', character: ch.id, count: cc.draw ?? 0 });
        break;
      }
      ch.hp = ch.max_hp;
      ch.stamina = ch.max_stamina;
      tasks.push({ type: 'camp_pick', char: ch.id });
      break;
    }
    default:
      break;
  }
  if (tb.vp) gainVp(ctx, player, tb.vp, 'center');   // 중앙 칸 상호작용 승점
  if (cell.type !== 'camp') emit(ctx, { type: 'marker_placed', cell: cell.id });
  tasks.push({ type: 'mission_progress', player, char: ch.id, trigger: { type: 'interact_cell', cell_type: cell.type, zone: cell.zone ?? null } });
  push(ctx, ...tasks);
};

// 캠프: 손패를 최대 장수까지 채움(설정 hand.camp = fill_to_max). 예전 규칙은 2장 보고 1장.
// 그 뒤: 캐릭터마다 행동 n번 규칙이면 그 캐릭터의 남은 행동만 끝(다른 캐릭터는 계속 — 2026-10-03 사용자 결정),
// 아니면 예전처럼 차례 즉시 종료.
function campEnd(ctx, ch) {
  if (activationMode(ctx.s)) return;   // 활성화 방식: 상호작용이 곧 그 캐릭터 행동 끝(따로 할 것 없음)
  const per = perCharActions(ctx.s);
  if (per == null) { push(ctx, { type: 'turn_end', player: ch.owner }); return; }
  const left = charActionsLeft(ctx.s, ch.id);
  ctx.s.turn.actions_left -= left;
  (ctx.s.turn.char_used ??= {})[ch.id] = per;
  emit(ctx, { type: 'actions_forfeited', character: ch.id, amount: left, reason: 'camp' });
}
TASKS.camp_pick = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (ctx.s.config.hand.camp === 'fill_to_max') {
    const got = drawPlayerCards(ctx, ch.owner, Math.max(0, ctx.s.config.hand.max_per_player - ctx.s.players[ch.owner].hand.length));
    emit(ctx, { type: 'resupplied', character: ch.id, count: got.length });
    campEnd(ctx, ch);
    return;
  }
  if (!t.options) {
    const P = ctx.s.players[ch.owner];
    const before = P.hand.length;
    drawPlayerCards(ctx, ch.owner, 2);
    t.options = P.hand.splice(before);
  }
  if (t.options.length > 1 && t.answer === undefined) {
    ask(ctx, t, { type: 'camp_pick', player: ch.owner, character: ch.id, options: t.options });
    return;
  }
  const pick = t.answer ?? t.options[0];
  for (const id of t.options) (id === pick ? ctx.s.players[ch.owner].hand : ctx.s.players[ch.owner].discard).push(id);
  campEnd(ctx, ch);
};

// 보급품 · 적 카드 덱의 "적" 카드로 적을 출현시킨다
// 적을 놓을 칸: 한 칸에 하나 규칙이면 그 칸이 비어 있어야 하고, 차 있으면 옆 빈칸(없으면 null — 출현하지 않음)
// 2026-10-17 사용자 피드백 "캐릭터 피규어 위에서 적이 등장하지 않게": 예전 occupied()는 쓰러진 캐릭터를 빈 칸으로 봐서
// 쓰러진 캐릭터 위에 적이 나타날 수 있었다 → 적이 나타날 칸은 쓰러진 캐릭터가 누워 있는 칸도 피한다
export function spawnCell(ctx, cell) {
  if (!singleOcc(ctx)) return cell;
  const taken = (id) => occupied(ctx, id) || Object.values(ctx.s.chars).some((c) => c.cell === id);
  if (!taken(cell)) return cell;
  return freeNeighbors(ctx, cell).find((n) => !taken(n)) ?? null;
}

export function spawnFoe(ctx, type, cell, extra = {}) {
  const id = uid(ctx, 'x');
  const def = enemyDefAt(ctx.c, type, ctx.s.game?.chapter ?? 1);   // 챕터별 체력
  ctx.s.enemies[id] = { uid: id, type, cell, hp: def.hp, max_hp: def.hp, seq: nextSeq(ctx), statuses: [], ...extra };
  return id;
}
