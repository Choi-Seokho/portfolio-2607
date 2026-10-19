// 읽기 전용 규칙 조회: 화면이 "지금 할 수 있는 것"을 보여 줄 때 쓴다(갈 수 있는 칸 · 공격 대상 등).
// 상태를 바꾸지 않는다. 판정은 액션 검증(actions.js)과 같은 규칙 함수를 써서 표시와 실제가 어긋나지 않게 한다.
// 최종 판정은 여전히 submit()이 한다 — 여기 결과는 안내용이다.

import {
  moveOf, rangeOf, hasPassive, hasStatus, foesAt, isHiddenEnemyCell, enemyRevealMode, dist, cellBlockReason, perCharActions, charActionsLeft, card, submit, bagCap, grappleSource,
  singleOcc, occupied, blocksChar, near, placementCells, activationMode, canDo, foeStat, safeCells,
} from './core.js';
import { graph, stepEdge, cellOf, canStop } from './map.js';
import { INTERACT_TYPES } from './supply.js';
import { freeCardKind } from './actions.js';
import { UNIMPLEMENTED_BLOCKS } from './blocks.js';

// 이 액션을 지금 내면 엔진이 받아들이는가(시험 제출 — 결과 상태는 버린다).
// 버튼을 켜고 끌 때 쓴다: 화면이 규칙을 따로 계산하지 않고 엔진 판정을 그대로 보여 준다.
export function check(state, content, action) {
  const res = submit(state, action, content);
  return res.ok ? { ok: true } : { ok: false, error: res.error?.code ?? res.error };
}

const mkCtx = (state, content) => ({ s: state, c: content, map: content.maps[state.map_id], events: [] });

// 같은 칸 또는(한 칸에 하나 규칙이면) 옆 칸 — 약탈 · 교환 · 아군 대상 카드 · 대신 맞기의 거리 조건(2026-10-03)
export const isNear = (state, content, a, b) => near(mkCtx(state, content), a, b);
export const isSingleOcc = (state, content) => singleOcc(mkCtx(state, content));
// 지금 캐릭터를 놓을 수 있는 칸(배치 · 엔진과 같은 규칙)
export const placeableCells = (state, content) => placementCells(mkCtx(state, content));

// 캐릭터 가방 용량(기본 + 장착 장비의 가방 보너스). 화면의 가방 칸 수 표시용 — 엔진과 같은 계산.
export function bagCapacity(state, content, charId) {
  return bagCap(mkCtx(state, content), state.chars[charId]);
}

// ---------- 누가 결정하는가 (진행자 · 화면 · AI 공용) ----------
// 지금 게임이 누구의 결정을 기다리는지. 뷰(view.js)에도 그대로 쓸 수 있다(공개 정보만 본다).
//   kind: 'pending'(선택 대기) · 'turn'(플레이어 차례) · 'maintenance'(정비) · 'black_market'(암시장 칩 놓기)
//         · 'public'(적 차례 · 챕터 준비처럼 아무나 진행 버튼만 누르면 되는 국면) · 'over'(게임 종료)
//   players: 지금 액션을 낼 수 있는 플레이어(차례 순서). 정비 · 암시장 · 경쟁 입찰은 여럿이 동시에 결정한다.
//   action: 'public'이면 진행할 액션, 'black_market'이면 모두 끝났을 때 낼 정산 액션.
export function whoDecides(state) {
  const s = state;
  const order = s.game.turn_order;
  if (s.game.over) return { kind: 'over', players: [] };
  const p = s.pending;
  if (p) {
    if (p.type === 'bm_bid' || p.type === 'bm_bid_extra') {
      const waiting = new Set(p.waiting);
      return { kind: 'pending', players: order.filter((x) => waiting.has(x)) };
    }
    return { kind: 'pending', players: [p.player] };
  }
  switch (s.turn.phase) {
    case 'player_turn': return { kind: 'turn', players: [s.turn.current_player] };
    case 'maintenance': return { kind: 'maintenance', players: order.filter((x) => !s.maint_done.includes(x)) };
    case 'black_market': return { kind: 'black_market', players: [...order], action: { type: 'bm_resolve' } };
    case 'enemy_turn': return { kind: 'public', players: [], action: { type: 'run_enemy_turn' } };
    case 'chapter_prep': return { kind: 'public', players: [], action: { type: 'run_chapter_prep' } };
    default: return { kind: 'public', players: [] };
  }
}

// 이 액션은 누구의 이름으로 내는 것인가. 엔진은 "지금 그 플레이어 차례인가"만 보고 "누가 보냈나"는 모르므로,
// 진행자(session)가 좌석마다 자기 액션만 내게 막을 때 쓴다(온라인에서 호스트가 클라이언트 요청을 거르는 것과 같음).
//   반환: 플레이어 id · null(공개 진행 액션 — 좌석 주인이 없음) · undefined(좌석에서 낼 수 없는 액션)
const BY_CHARACTER = new Set(['move', 'interact', 'loot', 'attack', 'rest', 'resupply', 'end_activation', 'play_card', 'use_item', 'equip', 'unequip', 'discard_item',
  'sell', 'store', 'retrieve', 'react']);
const BY_PLAYER = new Set(['spawn_boss', 'revive_infirmary', 'end_turn', 'upgrade_facility', 'place_survivor', 'sell_batch',
  'end_maintenance', 'place_character', 'choose', 'bm_place', 'bm_bid']);
const PUBLIC_ACTIONS = new Set(['run_enemy_turn', 'run_chapter_prep', 'bm_resolve']);

export function authorOf(state, action) {
  const t = action?.type;
  if (BY_CHARACTER.has(t)) return state.chars[action.character]?.owner;
  if (t === 'trade') return state.chars[action.from]?.owner;
  if (BY_PLAYER.has(t)) return state.players[action.player] ? action.player : undefined;
  if (PUBLIC_ACTIONS.has(t)) return null;
  return undefined;   // debug_noise 같은 테스트 전용 · 모르는 액션
}

// 이동 가능한 칸: 이동력(카드 보너스 포함) 안에서 갈 수 있는 칸마다 가장 싼 경로.
// 적이 있는 칸(드러난 적 · 감춰진 적)은 들어갈 수는 있지만 지나갈 수는 없다.
// budget · ignoreTurn: 사냥꾼 "치고 빠지기"처럼 카드가 정한 이동(최대 n칸)을 이번 차례 이동 여부와 상관없이 계산할 때(2026-10-08)
export function reachableCells(state, content, charId, { bonus = 0, passThrough = 0, budget: budgetOverride = null, ignoreTurn = false } = {}) {
  const ctx = mkCtx(state, content);
  const ch = state.chars[charId];
  const out = new Map();
  if (!ch || ch.exhausted || ch.cell == null) return out;
  if (!ignoreTurn && (activationMode(state) ? state.turn?.phase === 'player_turn' && state.turn.current_player === ch.owner && !canDo(state, ch.id, 'move')
    : perCharActions(state) && state.turn?.phase === 'player_turn' && state.turn.current_player === ch.owner && charActionsLeft(state, ch.id) <= 0)) return out;   // 이 캐릭터는 이번 차례 이동(행동)을 다 씀
  const budget = budgetOverride ?? moveOf(ctx, ch) + bonus;
  const passHidden = hasPassive(ctx, ch, 'pass_hidden_enemies');
  const roughFree = hasPassive(ctx, ch, 'rough_free');   // 닌자: 험지 진입 1(2026-10-08)
  const pass = hasStatus(ch, 'pass_through_enemies') || hasPassive(ctx, ch, 'pass_enemies') ? Infinity : passThrough;
  const single = singleOcc(ctx);
  const { adj } = graph(ctx.map);
  // 그래플링 없이 먼저 → 그래플링을 쓸 수 있으면(라운드당 1회 장비 포함) 그래플링으로만 가는 칸을 grapple: true로 더한다(2026-10-01)
  const run = (grapple) => {
    const found = new Map();
    // 상태: (칸, 지나간 적 칸 수) — 통과 효과가 없으면 지나간 수는 늘 0
    const best = new Map([[`${ch.cell}|0`, { cost: 0, path: [], cell: ch.cell, passed: 0 }]]);
    const open = [best.get(`${ch.cell}|0`)];
    while (open.length) {
      open.sort((a, b) => a.cost - b.cost);
      const cur = open.shift();
      if (cur.cell !== ch.cell && canStop(ctx.map, cur.cell) && !(single && occupied(ctx, cur.cell, ch.id))) {
        const prev = found.get(cur.cell);
        if (!prev || cur.cost < prev.cost) found.set(cur.cell, { cost: cur.cost, path: cur.path });
      }
      // 적이 있는 칸에서는 더 나아갈 수 없음(통과 효과 제외)
      let passed = cur.passed;
      if (cur.cell !== ch.cell) {
        const blocked = single ? blocksChar(ctx, ch, cur.cell) : foesAt(ctx, cur.cell).length > 0 || (enemyRevealMode(ctx) === 'on_enter' && isHiddenEnemyCell(ctx, cur.cell) && !passHidden);
        // 한 칸에 하나 규칙: 막는 피규어는 그래플링으로 넘을 수 있음(그래플링 계산에서만)
        if (blocked && !(single && grapple)) { if (passed >= pass) continue; passed += 1; }
      }
      for (const e of adj.get(cur.cell) ?? []) {
        const step = stepEdge(ctx.map, cur.cell, e.to, { grapple, roughFree });
        if (!step || step.blocked) continue;
        const cost = cur.cost + step.cost;
        if (cost > budget || e.to === ch.cell) continue;
        const key = `${e.to}|${passed}`;
        if (best.has(key) && best.get(key).cost <= cost) continue;
        const node = { cost, path: [...cur.path, e.to], cell: e.to, passed };
        best.set(key, node);
        open.push(node);
      }
    }
    return found;
  };
  for (const [cell, info] of run(false)) out.set(cell, info);
  if (grappleSource(ctx, ch)) {
    for (const [cell, info] of run(true)) if (!out.has(cell)) out.set(cell, { ...info, grapple: true });
  }
  return out;
}

// 적 위협 범위(읽기 전용, 2026-10-08 사용자 "추천으로" — docs/range-display.md 2단계):
// 이 적이 다음 적 차례에 "이동해서 공격할 수 있는" 칸. 적 이동 규칙(enemies.js moveToward)과 같은 조건을 쓴다:
//  - 일반 선만 · 이동력(맵 보정 포함) 안 · 안전 지역(시작 칸)과 (한 칸에 하나 규칙이면) 캐릭터가 선 칸은 지나갈 수 없음 · 적끼리는 지나감.
// 소음에 끌려오는 이동은 일부러 뺀다(차례 중 예측하기 어려운 요소 — 사용자 결정 대기 항목, 추천은 제외).
// 반환: { move: 이동해 갈 수 있는 칸(지금 칸 포함), attack: 그 칸들에서 사거리 안에 드는 칸(지금 칸 주변 포함), budget, range }
export function foeThreat(state, content, uid) {
  const ctx = mkCtx(state, content);
  const foe = state.enemies[uid] ?? state.bosses[uid];
  if (!foe) return null;
  const budget = foeStat(ctx, foe, 'move');
  const range = Math.max(singleOcc(ctx) ? 1 : 0, foeStat(ctx, foe, 'range'));
  const blocked = new Set(safeCells(ctx));
  if (singleOcc(ctx)) for (const c of Object.values(state.chars)) if (!c.exhausted && c.cell != null) blocked.add(c.cell);
  const { adj } = graph(ctx.map);
  const cost = new Map([[foe.cell, 0]]);
  const open = [foe.cell];
  while (open.length) {
    open.sort((a, b) => cost.get(a) - cost.get(b));
    const cur = open.shift();
    for (const e of adj.get(cur) ?? []) {
      if (e.kind !== 'normal' || blocked.has(e.to)) continue;
      const nd = cost.get(cur) + e.cost;
      if (nd > budget || (cost.has(e.to) && cost.get(e.to) <= nd)) continue;
      cost.set(e.to, nd);
      open.push(e.to);
    }
  }
  const move = [...cost.keys()];
  const attack = ctx.map.cells.filter((c) => move.some((m) => dist(ctx, m, c.id) <= range)).map((c) => c.id);
  return { move, attack, budget, range };
}

// 공격할 수 있는 대상(사거리 안): 적 · 보스 · 다른 플레이어의 탈진하지 않은 캐릭터
export function attackTargets(state, content, charId, { rangeBonus = 0 } = {}) {
  const ctx = mkCtx(state, content);
  const ch = state.chars[charId];
  if (!ch || ch.exhausted || ch.cell == null) return [];
  const range = rangeOf(ctx, ch) + rangeBonus;
  const out = [];
  for (const f of [...Object.values(state.enemies), ...Object.values(state.bosses)]) {
    const d = dist(ctx, ch.cell, f.cell);
    if (d <= range) out.push({ kind: 'foe', id: f.uid, distance: d });
  }
  for (const o of Object.values(state.chars)) {
    if (o.owner === ch.owner || o.exhausted || o.cell == null) continue;
    const d = dist(ctx, ch.cell, o.cell);
    if (d <= range) out.push({ kind: 'char', id: o.id, distance: d });
  }
  return out;
}

// 지금 칸에서 상호작용할 수 있는가
export function interactInfo(state, content, charId) {
  const ctx = mkCtx(state, content);
  const ch = state.chars[charId];
  if (!ch || ch.cell == null) return { ok: false, reason: 'character_exhausted' };
  const cell = cellOf(ctx.map, ch.cell);
  if (!INTERACT_TYPES.has(cell.type)) return { ok: false, reason: 'nothing_to_interact', type: cell.type };
  const blocked = cellBlockReason(ctx, cell, ch);
  if (blocked) return { ok: false, reason: blocked, type: cell.type };
  return { ok: true, type: cell.type, amount: cell.amount ?? null, open: cell.type === 'supply' ? state.board.open_supply : null };
}

// 손패 카드를 지금 어떻게 쓸 수 있는가: play(바로) · move/attack/rest(행동에 붙여서) · reaction(공격받을 때만)
export function cardUse(state, content, charId, cardId) {
  const ch = state.chars[charId];
  const cd = card(mkCtx(state, content), cardId);
  const mode = { anytime: 'play', on_move: 'move', on_attack: 'attack', on_rest: 'rest', on_hit: 'reaction' }[cd.timing] ?? 'none';
  const affordable = ch.stamina >= (cd.stamina ?? 0) || !!freeCardKind(mkCtx(state, content), ch, cd);   // 구원자 회복 카드 무료(2026-10-08)
  const needsTarget = (cd.effect ?? []).some((b) => b.target === 'same_cell_ally' || b.target === 'chosen_enemy');
  const implemented = !(cd.effect ?? []).some((b) => UNIMPLEMENTED_BLOCKS.has(b.block));
  // 손패는 플레이어 공용이지만 전용 카드는 주인 캐릭터만 쓸 수 있다(owner: 전용 카드의 캐릭터 id, 공용 카드는 null)
  const owner = cd.char ?? null;
  const ownerOk = !owner || owner === ch.char;
  return { mode, affordable, needsTarget, implemented, ownerOk, owner, stamina: cd.stamina ?? 0 };
}
