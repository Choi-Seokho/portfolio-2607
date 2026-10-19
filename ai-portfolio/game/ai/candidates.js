// 행동 후보 열거기: 뷰(view.js)만 보고 "지금 이 플레이어가 낼 만한 액션"을 빠짐없이 뽑는다.
//
// - 뷰만 쓴다: 남의 손패 · 덱 순서 같은 비공개 정보 없이도 만들 수 있어야 한다(AI 반칙 금지).
// - 합법 여부는 최종적으로 엔진이 판정한다(진행자가 주는 tools.check). 여기서는 규칙 조회(query.js)로
//   대부분 합법인 후보만 만들어 시험 제출 횟수를 줄인다.
// - 좋은 행동을 고르는 건 AI(쉬움 · 보통 · 높음)의 몫이다. 여기서는 PvP 공격도 후보에 넣고, 거르는 건 AI가 한다.
// - 일부러 뺀 것: 교환 제안(AI는 먼저 제안하지 않음 — docs/ai-design.md 2장), 짐꾼 '짐 정리'의 창고 선택,
//   반응 카드 2장 이상 조합(한 장 + 아이템 조합까지만).

import { reachableCells, attackTargets, interactInfo, cardUse, isNear, placeableCells } from '../engine/query.js';
import { segDist } from '../engine/map.js';
import { HIDDEN } from '../engine/view.js';
import { weaponOf } from '../engine/core.js';
import { weaponPower } from '../engine/weapons.js';

export const BM_DONE = 'bm_done';   // 암시장 칩 놓기를 마쳤다는 진행자용 표시(엔진 액션 아님)

const EQUIP_KINDS = new Set(['weapon', 'armor', 'accessory']);

// 같은 카드가 여러 장일 수 있으므로 조합은 내용 기준으로 중복을 없앤다
export function combos(list, k, limit = 300) {
  const out = [];
  const seen = new Set();
  const rec = (start, pick) => {
    if (out.length >= limit) return;
    if (pick.length === k) {
      const key = [...pick].sort().join('|');
      if (!seen.has(key)) { seen.add(key); out.push([...pick]); }
      return;
    }
    for (let i = start; i < list.length; i++) { pick.push(list[i]); rec(i + 1, pick); pick.pop(); }
  };
  rec(0, []);
  return out;
}
const subsets = (list, maxSize = list.length) => {
  const out = [];
  for (let k = 0; k <= Math.min(maxSize, list.length); k++) out.push(...combos(list, k));
  return out;
};

export function candidates(view, content, player) {
  const v = view;
  if (v.game.over) return [];
  const p = v.pending;
  if (p) return pendingCandidates(v, content, player);
  switch (v.turn.phase) {
    case 'player_turn': return v.turn.current_player === player ? turnCandidates(v, content, player) : [];
    case 'maintenance': return v.maint_done.includes(player) ? [] : maintenanceCandidates(v, content, player);
    case 'black_market': return blackMarketCandidates(v, content, player);
    default: return [];
  }
}

const cd = (content, id) => content.cards[id];
const mineOf = (v, player) => Object.values(v.chars).filter((c) => c.owner === player);
// 이 캐릭터가 쓸 수 있는 손패(플레이어 공용 손패 중 공용 카드 + 자기 전용 카드)
const handOf = (v, content, ch) => [...new Set(v.players[ch.owner].hand)].filter((id) => id !== HIDDEN && (!cd(content, id)?.char || cd(content, id).char === ch.char));
const sellOf = (content, id) => (id === 'part' ? 0 : cd(content, id)?.sell ?? 0);
// 카드 운용 버전(2026-10-18): 기본 이동 · 공격에 낼 카드 하나 — 공용 카드(기능 없음)를 먼저, 없으면 전용 카드의 아이콘. 스테미너가 모자라면 null
// 2026-10-19: 기본 기능은 전용 카드여도 내 캐릭터 누구나 → 플레이어 손패 전체에서 고름. 공용 카드 → 공격받을 때 카드(내 차례엔 스킬을 못 씀) → 남의 카드 → 내 카드 순
function basicCard(v, content, ch, hand, kind) {
  const costOf = v.config.card_mode?.basic_cost?.[kind] ?? v.config.card_mode?.basic_stamina ?? 1;
  if (ch.stamina < costOf) return null;
  const all = [...new Set(v.players[ch.owner].hand)].filter((id) => id !== HIDDEN && cd(content, id)?.basic === kind);
  const rank = (id) => { const c = cd(content, id); return !c.char ? 0 : c.timing === 'on_hit' ? 1 : c.char !== ch.char ? 2 : 3; };
  return all.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}
const startCells = (v, content) => content.maps[v.map_id].cells.filter((c) => c.type === 'start').map((c) => c.id);

// ---------- 선택 대기 ----------
function pendingCandidates(v, content, player) {
  const p = v.pending;
  if (p.type === 'bm_bid' || p.type === 'bm_bid_extra') {
    // 암시장 경쟁(플레이어 단위, AC-2): 내 두 가방 + 창고의 카드 1장, 또는 포기(card: null)
    if (!p.waiting.includes(player)) return [];
    const pool = [...mineOf(v, player).flatMap((c) => c.bag), ...v.shelter[player].storage];
    // 추가 제출이면 처음 낸 카드(my_first_bid)는 한 장 빼고 센다 — 같은 카드가 두 장이면 나머지 한 장은 낼 수 있다
    if (p.my_first_bid && pool.includes(p.my_first_bid)) pool.splice(pool.indexOf(p.my_first_bid), 1);
    const out = [];
    for (const c of new Set(pool)) {
      if (c === 'part' || c === HIDDEN || EQUIP_KINDS.has(cd(content, c)?.kind)) continue;
      out.push({ type: 'bm_bid', player, card: c });
    }
    out.push({ type: 'bm_bid', player, card: null });
    return out;
  }
  if (p.player !== player) return [];
  const ch = p.character ? v.chars[p.character] : null;
  const choose = (choice) => ({ type: 'choose', player, choice });
  switch (p.type) {
    case 'reaction': return reactionCandidates(v, content, ch);
    case 'choose_trap_target':
    case 'camp_pick':
    case 'choose_char': return p.options.map(choose);   // 캐릭터 고르기(구원자 특전 1, 2026-10-17)
    case 'supply_source': return p.options.map(choose);   // 감춰진 보급품 / 드러난 카드 1장(2026-10-08)
    case 'pick_card': return p.count === 1 ? [...new Set(p.options)].map(choose) : combos(p.options, p.count).map(choose);   // 카드 보고 고르기(2026-10-08)
    case 'bag_overflow': return combos(ch.bag, p.discard_count).map(choose);
    case 'discard_to_hand_limit': return combos(v.players[player].hand, p.count).map(choose);
    case 'mulligan': return subsets(v.players[player].hand).map(choose);
    case 'mission_keep': return subsets([...p.current, ...p.options], p.max_keep).filter((x) => x.length >= (p.min_keep ?? 0)).map(choose);   // 2026-10-18 최소 장수
    case 'trade_consent': return [choose('accept'), choose('decline')];
    // 카드 운용 버전(2026-10-19): 연속 행동 단계 · 레벨업 카드 고르기 · 버릴 카드(손패 · 덱 · 버린 카드 어디서든)
    case 'combo_step':
    case 'level_up_pick': return p.options.map(choose);
    case 'level_up_remove': {
      const P = v.players[player];
      const out = [];
      for (const zone of ['hand', 'deck', 'discard']) for (const id of new Set(P[zone] ?? [])) if (id !== HIDDEN) out.push(choose({ zone, card: id }));
      return out;
    }
    case 'placement': {
      const c = mineOf(v, player).find((x) => x.cell == null);
      if (!c) return [];
      return placeableCells(v, content).map((cell) => ({ type: 'place_character', player, character: c.id, cell }));
    }
    default: return [];
  }
}

function reactionCandidates(v, content, ch) {
  const out = [{ type: 'react', character: ch.id, pass: true }];
  const items = [...new Set(ch.bag)].filter((id) => cd(content, id)?.effect?.some((b) => b.block === 'reduce_damage'));
  // + 아군을 지키는 남의 전용 반응 카드(수호자 엄호 — 주인이 옆에 있으면 대신 써 줌, 2026-10-08). 합법 여부는 엔진 check가 거름
  const allyCards = [...new Set(v.players[ch.owner].hand)].filter((id) => id !== HIDDEN && cd(content, id)?.char && cd(content, id).char !== ch.char && cd(content, id).effect?.some((b) => b.target === 'same_cell_ally'));
  const cards = [...handOf(v, content, ch), ...allyCards].filter((id) => cd(content, id)?.timing === 'on_hit');
  for (const c of cards) {
    const ds = cd(content, c).effect.find((b) => b.block === 'discard_supply');
    const bases = ds
      ? [...new Set(ch.bag)].filter((b) => b !== 'part' && sellOf(content, b) >= ds.min_sell).map((b) => ({ cards: [c], discard_supply: b }))
      : [{ cards: [c] }];
    for (const b of bases) {
      out.push({ type: 'react', character: ch.id, ...b });
      for (const it of items) if (it !== b.discard_supply) out.push({ type: 'react', character: ch.id, ...b, items: [it] });
    }
  }
  for (const it of items) out.push({ type: 'react', character: ch.id, items: [it] });
  // 수호자 대신 맞기: 같은 칸의 내 다른 캐릭터(누가 수호자인지는 엔진이 판정)
  for (const g of Object.values(v.chars)) {
    if (g.id !== ch.id && g.owner === ch.owner && isNear(v, content, g.cell, ch.cell) && !g.exhausted) out.push({ type: 'react', character: ch.id, intercept_by: g.id });
  }
  return out;
}

// ---------- 플레이어 차례 ----------
function turnCandidates(v, content, player) {
  const out = [];
  const map = content.maps[v.map_id];
  const mine = mineOf(v, player);
  const acting = v.turn.actions_left > 0;
  const occupied = new Set([...Object.values(v.chars).map((c) => c.cell), ...Object.values(v.enemies).map((f) => f.cell), ...Object.values(v.bosses).map((f) => f.cell)]);

  for (const ch of mine) {
    if (ch.exhausted) {
      // 의무실 부활: 쓰러진 자리(기본) — 칸을 고를 필요 없음. 설정이 '빈 시작 지점'이면 빈 시작 칸마다 후보
      if ((v.config.revive.placement ?? 'exhausted_cell') === 'empty_start_point') {
        for (const cell of startCells(v, content)) if (!occupied.has(cell)) out.push({ type: 'revive_infirmary', player, character: ch.id, cell });
      } else if (ch.cell) out.push({ type: 'revive_infirmary', player, character: ch.id });
      continue;
    }
    if (ch.cell == null) continue;
    const hand = handOf(v, content, ch);
    const usable = (id) => { const u = cardUse(v, content, ch.id, id); return u.implemented && u.affordable ? u : null; };

    // 카드 운용 버전(2026-10-18): 기본 이동 · 공격 · 약탈은 카드 1장(basic), 스킬 카드는 그것만으로 이동 · 공격
    const cm = v.config.turn_mode === 'cards';
    const bMove = cm ? basicCard(v, content, ch, hand, 'move') : null;
    const bAtk = cm ? basicCard(v, content, ch, hand, 'attack') : null;
    if (acting) {
      // 이동: 갈 수 있는 모든 칸(가장 싼 경로). 이동 카드는 카드 없이 못 가는 칸에만 붙인다(카드 운용 버전은 모든 칸).
      const base = reachableCells(v, content, ch.id);
      if (!cm || bMove) for (const [cell, r] of base) out.push({ type: 'move', character: ch.id, path: r.path, ...(bMove ? { basic: bMove } : {}) });
      for (const id of hand) {
        if (cd(content, id).timing !== 'on_move' || !usable(id)) continue;
        const eff = cd(content, id).effect;
        const bonus = eff.filter((b) => b.block === 'move_bonus').reduce((n, b) => n + b.amount, 0);
        const pass = eff.find((b) => b.block === 'grant_status' && b.status === 'pass_through_enemies');
        const more = reachableCells(v, content, ch.id, { bonus, passThrough: pass ? (pass.count ?? Infinity) : 0 });
        for (const [cell, r] of more) {
          const b = base.get(cell);
          if (cm || !b || b.path.join() !== r.path.join()) out.push({ type: 'move', character: ch.id, path: r.path, cards: [id] });
        }
      }
      // 공격: 사거리 안의 모든 대상(적 · 보스 · 다른 플레이어 캐릭터), 공격 강화 카드는 한 장씩 붙여 본다
      // 챕터에 1번 쓰는 무기 능력(2026-10-17): 한 방에 안 쓰러질 적(기절은 보스 제외)을 칠 때 쓴다 — 후보를 늘리지 않는 간단한 규칙
      const w = weaponOf({ s: v, c: content }, ch);
      const power = weaponPower(null, ch, w);
      const usePower = (t) => {
        if (!power || power.used) return false;
        const f = v.enemies?.[t.id] ?? v.bosses?.[t.id];
        if (!f || f.hp <= w.attack) return false;
        return !(v.bosses?.[t.id] && power.effects.every((b) => b.block === 'stun'));
      };
      if (!cm || bAtk) for (const t of attackTargets(v, content, ch.id)) out.push({ type: 'attack', character: ch.id, target: t.id, ...(usePower(t) ? { weapon_power: true } : {}), ...(bAtk ? { basic: bAtk } : {}) });
      for (const id of hand) {
        if (cd(content, id).timing !== 'on_attack' || !usable(id)) continue;
        const bonus = cd(content, id).effect.filter((b) => b.block === 'range_bonus').reduce((n, b) => n + b.amount, 0);
        for (const t of attackTargets(v, content, ch.id, { rangeBonus: bonus })) out.push({ type: 'attack', character: ch.id, target: t.id, cards: [id] });
      }
      // 상호작용
      const info = interactInfo(v, content, ch.id);
      if (info.ok) {
        if (info.type === 'supply') {
          out.push({ type: 'interact', character: ch.id, option: 'hidden' });
          (info.open ?? []).forEach((c, i) => { if (c) out.push({ type: 'interact', character: ch.id, option: { open: i } }); });
        } else out.push({ type: 'interact', character: ch.id });
      }
      // 약탈: 탈진한 캐릭터(뷰에 가방이 보이는 경우) — 비싼 카드부터 1장, 2장, … (가방 한도 초과는 엔진이 거절)
      for (const x of Object.values(v.chars)) {
        if (!x.exhausted || !isNear(v, content, x.cell, ch.cell) || x.id === ch.id || !x.bag.length || x.bag.includes(HIDDEN)) continue;
        const best = [...x.bag].sort((a, b) => sellOf(content, b) - sellOf(content, a));
        if (cm && !bAtk) continue;
        for (let n = 1; n <= best.length; n++) out.push({ type: 'loot', character: ch.id, target: x.id, take: best.slice(0, n), ...(bAtk ? { basic: bAtk } : {}) });
      }
      // 휴식: 고르는 규칙이면 회복 · 카드 두 가지(휴식 카드는 회복에만), 아니면 예전처럼 하나(2026-10-02)
      const modes = v.config.recovery.rest.choice ? ['heal', 'draw'] : [undefined];
      for (const mode of modes) out.push({ type: 'rest', character: ch.id, ...(mode ? { mode } : {}) });
      for (const id of hand) if (cd(content, id).timing === 'on_rest' && usable(id)) out.push({ type: 'rest', character: ch.id, cards: [id], ...(v.config.recovery.rest.choice ? { mode: 'heal' } : {}) });
      if (v.config.hand.resupply_action === 'fill_to_max') out.push({ type: 'resupply', character: ch.id });
    }

    // 카드 운용 버전 기본 기능 "카드 2장 뽑기"(2026-10-19): 뽑기 아이콘 카드 — 캐릭터 상관없음이라 첫 캐릭터에게만 후보
    if (cm && ch === mine.find((x) => !x.exhausted && x.cell != null)) {
      for (const id of new Set(v.players[player].hand)) if (id !== HIDDEN && cd(content, id)?.basic === 'draw') out.push({ type: 'play_card', character: ch.id, card: id, as: 'basic' });
    }
    // 행동을 쓰지 않는 것: 카드 · 아이템 · 장착
    for (const id of hand) {
      const u = usable(id);
      const card = cd(content, id);
      if (!u || u.mode !== 'play' || card.effect.some((b) => b.block === 'access_storage')) continue;
      // 2026-10-08 미구현이던 카드들: 고를 값이 필요한 카드는 값을 붙여 후보를 만든다(합법 여부는 엔진 check가 거름)
      const blk = (name) => card.effect.find((b) => b.block === name);
      if (blk('cycle_hand')) {
        const others = hand.filter((x) => x !== id);
        for (const x of new Set(others)) out.push({ type: 'play_card', character: ch.id, card: id, choice: [x] });
        if (others.length > 1) out.push({ type: 'play_card', character: ch.id, card: id, choice: others });
        continue;
      }
      if (blk('peek_player_card')) { for (const p of v.game.turn_order) if (p !== ch.owner) out.push({ type: 'play_card', character: ch.id, card: id, choice: p }); continue; }
      if (blk('pull_ally')) { for (const a of mine) if (a.id !== ch.id && !a.exhausted && a.cell) out.push({ type: 'play_card', character: ch.id, card: id, target: a.id }); continue; }
      const bmv = blk('bonus_move');   // 전력 질주(2026-10-18): 따로 이동할 칸마다 후보
      if (bmv) {
        for (const spot of [...reachableCells(v, content, ch.id, { budget: bmv.max_move ?? 2, ignoreTurn: true }).entries()].filter(([, i]) => !i.grapple).map(([c]) => c).slice(0, 12)) {
          out.push({ type: 'play_card', character: ch.id, card: id, cell: spot });
        }
        continue;
      }
      const mta = blk('move_then_attack');
      if (mta) {
        const spots = [ch.cell, ...reachableCells(v, content, ch.id, { budget: mta.max_move ?? 2, ignoreTurn: true }).keys()];
        for (const spot of spots.slice(0, 12)) {
          for (const f of [...Object.values(v.enemies), ...Object.values(v.bosses)]) if (segDist(map, spot, f.cell) <= 6) out.push({ type: 'play_card', character: ch.id, card: id, target: f.uid, ...(spot !== ch.cell ? { cell: spot } : {}) });
        }
        continue;
      }
      // 내 캐릭터 하나(거리 상관없음 — 카드 운용 버전 구원자 격려 등, 2026-10-19)
      if (card.effect.some((b) => b.target === 'my_char')) { for (const a of mine) if (!a.exhausted && a.cell != null) out.push({ type: 'play_card', character: ch.id, card: id, target: a.id }); continue; }
      const tgt = card.effect.find((b) => b.target === 'same_cell_ally' || b.target === 'chosen_enemy');
      if (!tgt) { out.push({ type: 'play_card', character: ch.id, card: id }); continue; }
      if (tgt.target === 'same_cell_ally') {
        for (const a of mine) if (!a.exhausted && isNear(v, content, a.cell, ch.cell)) out.push({ type: 'play_card', character: ch.id, card: id, target: a.id });
      } else {
        for (const t of attackTargets(v, content, ch.id)) if (t.kind === 'foe') out.push({ type: 'play_card', character: ch.id, card: id, target: t.id });
      }
    }
    // 쉘터 연구 보관함의 연구 카드(2026-10-08 AF-1): 언제든 쓰는 것(백신)은 어느 캐릭터든 꺼내 쓸 수 있다
    for (const id of new Set(v.shelter?.[ch.owner]?.research ?? [])) {
      const rc = cd(content, id);
      if (rc?.kind === 'research' && rc.timing === 'anytime' && !rc.effect.some((b) => b.at === 'chosen_cell')) out.push({ type: 'use_item', character: ch.id, item: id });
    }
    for (const id of new Set(ch.bag)) {
      out.push({ type: 'discard_item', character: ch.id, item: id });
      const card = cd(content, id);
      if (!card) continue;
      if (EQUIP_KINDS.has(card.kind)) out.push({ type: 'equip', character: ch.id, item: id });
      // 연구 카드(2026-10-07): 언제든 쓰는 것(백신)만 — 칸 고르기(페로몬) · 공격할 때 · 정비 때는 다른 곳에서
      if (card.kind === 'research' && card.timing === 'anytime' && !card.effect.some((b) => b.at === 'chosen_cell')) { out.push({ type: 'use_item', character: ch.id, item: id }); continue; }
      if (card.kind !== 'consumable' || !card.effect?.length || card.effect.every((b) => b.block === 'reduce_damage')) continue;
      const needs = card.effect.find((b) => b.block === 'revive' || b.block === 'deal_damage');
      if (!needs) { out.push({ type: 'use_item', character: ch.id, item: id }); continue; }
      // 사거리 0은 한 칸에 하나 규칙이면 옆 칸까지(엔진 use_item과 같은 해석, 2026-10-17)
      const inRange = (cell) => cell != null && ((card.range ?? 0) === 0 ? isNear(v, content, ch.cell, cell) : segDist(map, ch.cell, cell) <= card.range);
      if (needs.block === 'revive') {
        for (const x of Object.values(v.chars)) if (x.exhausted && inRange(x.cell)) out.push({ type: 'use_item', character: ch.id, item: id, target: x.id });
      } else {
        for (const f of [...Object.values(v.enemies), ...Object.values(v.bosses)]) if (inRange(f.cell)) out.push({ type: 'use_item', character: ch.id, item: id, target: f.uid });
        // 다른 플레이어 캐릭터(2026-10-18 — 화염병 등 단일 대상 피해 아이템)
        if (needs.target !== 'all_enemies_in_cell') for (const x of Object.values(v.chars)) if (x.owner !== player && !x.exhausted && inRange(x.cell)) out.push({ type: 'use_item', character: ch.id, item: id, target: x.id });
      }
    }
  }

  out.push(...bossCandidates(v, content, player, mine));
  out.push({ type: 'end_turn', player });
  return out;
}

// 보스 소환: 같은 색 조사 카드 3장(만능 · 보스 위치 정보는 아무 색) → 그 색 구역의 칸
function bossCandidates(v, content, player, mine) {
  const inv = [...mine.flatMap((c) => c.bag), ...(v.shelter?.[player]?.storage ?? [])].filter((id) => id !== 'part' && id !== HIDDEN);   // 창고 조사 카드도(2026-10-18)
  const isWild = (id) => cd(content, id)?.wild || (cd(content, id)?.passive ?? []).some((b) => b.block === 'wild_investigation');
  const wild = inv.filter(isWild);
  const out = [];
  const map = content.maps[v.map_id];
  for (const color of ['blue', 'yellow', 'red']) {
    const set = [...inv.filter((id) => !isWild(id) && cd(content, id)?.kind === 'investigation' && cd(content, id).color === color), ...wild].slice(0, 3);
    if (set.length < 3) continue;
    for (const cell of map.cells.filter((c) => c.zone === color)) out.push({ type: 'spawn_boss', player, cards: set, cell: cell.id });
  }
  return out;
}

// ---------- 정비 ----------
function maintenanceCandidates(v, content, player) {
  const out = [];
  const sh = v.shelter[player];
  for (const ch of mineOf(v, player)) {
    for (const id of new Set(ch.bag)) {
      if (id !== 'part' && cd(content, id)?.sell != null) out.push({ type: 'sell', character: ch.id, card: id });
      out.push({ type: 'store', character: ch.id, card: id });
      if (EQUIP_KINDS.has(cd(content, id)?.kind)) out.push({ type: 'equip', character: ch.id, item: id });
    }
    for (const id of new Set(sh.storage)) out.push({ type: 'retrieve', character: ch.id, card: id });
  }
  for (const f of Object.keys(content.facilities)) out.push({ type: 'upgrade_facility', player, facility: f });
  const built = Object.keys(sh.facilities).filter((f) => sh.facilities[f] > 0);
  // 생존자: 예전 대기 토큰 + 생존자 카드(창고 · 가방, 2026-10-07)
  const mineBags = Object.values(v.chars).filter((c) => c.owner === player).flatMap((c) => c.bag);
  const survs = [...sh.survivor_pool, ...[...sh.storage, ...mineBags].filter((id) => cd(content, id)?.kind === 'survivor')];
  for (const sv of new Set(survs)) for (const f of built) out.push({ type: 'place_survivor', player, survivor: sv, facility: f });
  // 정비 때 쓰는 연구 카드(보고서 등) — 쉘터 연구 보관함 + (예전 저장의) 가방
  const firstChar = Object.values(v.chars).find((x) => x.owner === player);
  if (firstChar) for (const id of new Set(sh.research ?? [])) if (cd(content, id)?.kind === 'research' && cd(content, id).timing === 'maintenance') out.push({ type: 'use_item', character: firstChar.id, item: id });
  for (const c of Object.values(v.chars).filter((x) => x.owner === player)) for (const id of new Set(c.bag)) if (cd(content, id)?.kind === 'research' && cd(content, id).timing === 'maintenance') out.push({ type: 'use_item', character: c.id, item: id });
  out.push({ type: 'end_maintenance', player });
  return out;
}

// ---------- 암시장 칩 놓기 ----------
// 암시장(플레이어 단위, AC-2): 카드 1장 고르기(받을 곳: 가방에 자리가 있는 캐릭터 · 창고) · 고른 걸 취소 · 완료
function blackMarketCandidates(v, content, player) {
  const out = [];
  const mine = Object.entries(v.board.bm_place).find(([, l]) => l.includes(player))?.[0] ?? null;
  const dests = [...mineOf(v, player).map((c) => c.id), 'storage'];
  for (const c of v.board.black_market) {
    if (c === mine) continue;
    for (const to of dests) out.push({ type: 'bm_place', player, card: c, to });
  }
  if (mine) out.push({ type: 'bm_place', player, card: null });
  out.push({ type: BM_DONE, player });
  return out;
}
