// 적 차례 · 적의 목표 고르기 · 추적 이동 · 소음 반응

import { TASKS, emit, push, getFoe, foeStat, allFoes, dist, hasStatus, singleOcc, occupied, attackerPouch, safeCells, isSafeCell } from './core.js';

// 한 칸에 하나 규칙: 적은 캐릭터가 서 있는 칸을 지나갈 수 없다(적끼리는 지나감). 근접(사거리 0)은 옆 칸까지(사거리 1).
// 적이 지나갈 수 없는 칸: (한 칸에 하나 규칙) 캐릭터가 서 있는 칸 + (안전 지역) 시작 칸
const charBlocks = (ctx) => {
  const safe = safeCells(ctx);
  if (!singleOcc(ctx) && !safe.length) return null;
  const set = new Set(safe);
  if (singleOcc(ctx)) for (const c of Object.values(ctx.s.chars)) if (!c.exhausted && c.cell != null) set.add(c.cell);
  return set;
};
const foeRange = (ctx, foe) => Math.max(singleOcc(ctx) ? 1 : 0, foeStat(ctx, foe, 'range'));
import { enemyPath, normalNeighbors, edgeCost } from './map.js';
import { drawToken, tieCompare } from './rng.js';
import { foeAttackTask } from './combat.js';
import { takeFoeStatus } from './weapons.js';

// 적이 노릴 수 있는 캐릭터: 탈진 안 함 · 보드 위 · 연막 아님. 도발 중인 캐릭터가 범위 안에 있으면 그들만.
function candidates(ctx, foe) {
  const list = Object.values(ctx.s.chars).filter((c) => !c.exhausted && c.cell != null && !hasStatus(c, 'untargetable'));
  const taunting = list.filter((c) => (c.statuses ?? []).some((x) => x.status === 'taunt' && dist(ctx, foe.cell, c.cell) <= (x.range ?? 0)));
  return taunting.length ? taunting : list;
}

// 목표 우선순위: 이동력 경로 비용 → 체력 낮은 쪽 → 순서가 늦은 플레이어 → 같은 플레이어 두 캐릭터면 주사위
export function pickTarget(ctx, foe, list) {
  if (list.length === 0) return null;
  const order = ctx.s.game.turn_order;
  const blocked = charBlocks(ctx);
  const keyed = list.map((c) => ({ c, cost: enemyPath(ctx.map, foe.cell, c.cell, blocked).cost, hp: c.hp, ord: order.indexOf(c.owner) }));
  keyed.sort((a, b) => a.cost - b.cost || a.hp - b.hp || b.ord - a.ord);
  const top = keyed.filter((k) => k.cost === keyed[0].cost && k.hp === keyed[0].hp && k.ord === keyed[0].ord).map((k) => k.c);
  if (top.length === 1) return top[0];
  top.sort((a, b) => a.order - b.order);
  let pool = top;
  while (pool.length > 1) {
    const pouch = attackerPouch(ctx, { kind: 'foe', id: foe.uid });   // 동률 판정도 적 주머니
    const faces = pool.map(() => drawToken(ctx.s, pouch.tokens));
    emit(ctx, { type: 'dice_rolled', purpose: 'target_tiebreak', faces, characters: pool.map((c) => c.id), pouch: pouch.id });
    let best = [0];
    for (let i = 1; i < pool.length; i++) {
      const cmp = tieCompare(faces[i], faces[best[0]]);
      if (cmp > 0) best = [i];
      else if (cmp === 0) best.push(i);
    }
    pool = best.map((i) => pool[i]);
  }
  return pool[0];
}

TASKS.enemy_turn = (ctx) => {
  const foes = allFoes(ctx.s);
  const normal = foes.filter((f) => f._group === 'enemies');
  const bosses = foes.filter((f) => f._group === 'bosses');
  // 독 피해가 먼저(적 차례 시작, 2026-10-17 무기 특수 효과)
  push(ctx, { type: 'poison_tick' }, ...[...normal, ...bosses].map((f) => ({ type: 'foe_act', id: f.uid })), { type: 'round_end' });
};

TASKS.foe_act = (ctx, t) => {
  const foe = getFoe(ctx.s, t.id);
  if (!foe) return;
  // 테스트 맵(2026-10-17): 허수아비(적 데이터 idle)는 아무것도 안 함 · 테스트 도구 "적 행동 끄기"(config.test.enemies_idle)면 모든 적이 가만히
  if (ctx.c.enemies[foe.type]?.idle || ctx.s.config.test?.enemies_idle) return;
  // 기절: 이번 적 차례는 아무것도 안 함 / 속박: 이동하지 않음(사거리 안이면 공격) — 둘 다 한 번 쓰면 풀림(2026-10-17 무기 특수 효과)
  if (takeFoeStatus(foe, 'stunned')) { takeFoeStatus(foe, 'rooted'); emit(ctx, { type: 'foe_stunned', enemy: foe.uid }); return; }
  const rooted = takeFoeStatus(foe, 'rooted');
  const range = foeRange(ctx, foe);
  const sight = foeStat(ctx, foe, 'sight');
  const cands = candidates(ctx, foe);
  const inRange = () => cands.filter((c) => !c.exhausted && dist(ctx, foe.cell, c.cell) <= range);
  let now = inRange();
  if (now.length === 0) {
    const seen = cands.filter((c) => dist(ctx, foe.cell, c.cell) <= sight && enemyPath(ctx.map, foe.cell, c.cell, charBlocks(ctx)).cost < Infinity);
    const target = pickTarget(ctx, foe, seen);
    if (!target) return;
    if (rooted) { emit(ctx, { type: 'foe_rooted', enemy: foe.uid }); return; }
    moveToward(ctx, foe, target, range);
    now = inRange();
  }
  const victim = pickTarget(ctx, foe, now);
  if (victim) push(ctx, foeAttackTask(ctx, foe, victim, 'enemy_turn'));
};

// 가장 싼 경로를 따라 이동력 한도까지. 목표가 사거리에 들어오면 멈춘다. 선 비용이 남은 이동력보다 크면 멈춘다.
function moveToward(ctx, foe, target, range) {
  const { path } = enemyPath(ctx.map, foe.cell, target.cell, charBlocks(ctx));
  if (!path) return;
  let left = foeStat(ctx, foe, 'move');
  const walked = [foe.cell];
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    if (dist(ctx, walked[walked.length - 1], target.cell) <= range) break;
    if (isSafeCell(ctx, path[i])) break;   // 안전 지역(시작 칸)에는 들어갈 수 없음 — 대상이 그 안에 있으면 바깥에서 멈춤
    const step = stepCost(ctx, path[i - 1], path[i]);
    if (step > left) break;
    left -= step;
    cost += step;
    walked.push(path[i]);
  }
  // 한 칸에 하나 규칙: 다른 피규어가 있는 칸에는 멈출 수 없으니 빈칸이 나올 때까지 되돌아간다
  if (singleOcc(ctx)) while (walked.length > 1 && occupied(ctx, walked[walked.length - 1], foe.uid)) walked.pop();
  if (walked.length > 1) {
    foe.cell = walked[walked.length - 1];
    emit(ctx, { type: 'enemy_moved', enemy: foe.uid, path: walked, cost });
  }
}

// 한 걸음 비용: 일반 선(육각 맵은 험지 진입 2처럼 방향마다 다를 수 있음)
const stepCost = (ctx, a, b) => edgeCost(ctx.map, a, b);

// ---------- 소음 ----------
// 거리 3 이내의 드러난 적이 소음 칸 쪽으로 인접한 칸 하나 이동(선 비용 무관).
// 이동해 들어간 칸에 캐릭터가 있으면 1회 공격(소음을 낸 캐릭터 우선). 이미 같은 칸에 있던 적은 반응하지 않는다(Z-2).
TASKS.noise = (ctx, t) => {
  emit(ctx, { type: 'noise', cell: t.cell, character: t.source_char ?? null });
  const range = ctx.s.config.noise_range ?? 3;
  const movers = allFoes(ctx.s).filter((f) => { const d = dist(ctx, f.cell, t.cell); return d >= 1 && d <= range; });
  push(ctx, ...movers.map((f) => ({ type: 'noise_move', id: f.uid, cell: t.cell, source_char: t.source_char })));
};

TASKS.noise_move = (ctx, t) => {
  const foe = getFoe(ctx.s, t.id);
  if (!foe) return;
  const here = dist(ctx, foe.cell, t.cell);
  const single = singleOcc(ctx);
  const next = normalNeighbors(ctx.map, foe.cell).find((n) => dist(ctx, n, t.cell) < here && !(single && occupied(ctx, n)) && !isSafeCell(ctx, n));
  if (!next) return;
  const from = foe.cell;
  foe.cell = next;
  emit(ctx, { type: 'enemy_moved', enemy: foe.uid, path: [from, next], reason: 'noise' });
  // 다가온 뒤 공격: 예전엔 같은 칸의 캐릭터, 한 칸에 하나 규칙이면 사거리 안(옆 칸)의 캐릭터(2026-10-03)
  const there = Object.values(ctx.s.chars).filter((c) => !c.exhausted && c.cell != null && !hasStatus(c, 'untargetable')
    && (single ? dist(ctx, c.cell, next) <= foeRange(ctx, foe) : c.cell === next));
  if (there.length === 0) return;
  const src = there.find((c) => c.id === t.source_char);
  const victim = src ?? pickTarget(ctx, foe, there);
  push(ctx, foeAttackTask(ctx, foe, victim, 'noise'));
};
