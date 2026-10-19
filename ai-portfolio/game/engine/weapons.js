// 무기 특수 효과(2026-10-17 사용자 결정 — "보급품 무기는 기본 무기보다 좋거나, 특별한 효과가 있었으면"):
// 무기 카드의 on_hit: [{ block, faces?, ... }] — 캐릭터가 이 무기로 적에게 피해를 1 이상 주면 차례대로 적용한다.
//   faces: 이 토큰 면이 나왔을 때만(확률 효과, 예: ['+1', '+2', 'x2'] = "+1 이상"). 없으면 피해를 주면 항상.
// 효과는 적에게만(다른 플레이어 캐릭터를 쏠 때는 피해만). 보스는 기절 · 속박에 면역(독 · 밀어내기는 받음).
//
// 블록(효과 블록 레지스트리처럼 이름 → 처리 함수, 새 효과는 HIT에 하나 더 등록):
//   stun      기절: 다음 적 차례에 아무것도 안 함(그 적 차례에 풀림)
//   root      속박: 다음 적 차례에 이동하지 않음(사거리 안이면 공격은 함)
//   poison    독 n(turns): 적 차례가 시작될 때마다 피해 1, n번. 출혈 = 독 1. 독으로 쓰러지면 처치 보상은 독을 건 쪽
//   knockback 밀어내기: 공격자 반대쪽 바로 뒤 칸으로 1칸. 맵 끝 · 장애물 · 다른 말 · 숨은 적 칸 · 안전 지역이면 막힘
//             collision: n이 있으면 막혔을 때 고정 피해 n(발리스타)
//   lifesteal 흡혈 n: 공격자 체력 +n(최대 체력까지) — 대상이 쓰러져도 적용

import { TASKS, emit, push, getFoe, isBoss, dist, occupied, isSafeCell, isHiddenEnemyCell, allFoes } from './core.js';
import { cellOf, canStop, graph, isHex, hexXY } from './map.js';

// ---------- 챕터에 1번 쓰는 무기 능력(2026-10-17 사용자 결정 "확률 효과는 보드게임에서 못 쓴다 — 챕터당 한 번 사용") ----------
// on_hit 블록에 once_per_chapter: true가 붙은 효과(전기 충격봉 기절 · 샷건 산탄). 공격할 때 "쓰겠다"고 고르면(attack.weapon_power)
// 그 챕터에는 다시 못 쓴다(빗나가도 쓴 것). 효과는 그 공격이 피해를 1 이상 주면. 챕터가 끝나면 다시 쓸 수 있다(flow.js chapter_end).
// 쓴 기록은 캐릭터의 power_used(무기 id 목록) — 같은 무기를 다른 캐릭터에게 넘기면 그 캐릭터는 새로 쓸 수 있다
export const powerEffects = (w) => (w?.on_hit ?? []).filter((b) => b.once_per_chapter);
export function weaponPower(ctx, ch, w) {
  const effects = powerEffects(w);
  if (!effects.length) return null;
  return { effects, used: (ch.power_used ?? []).includes(w.id ?? 'start') };
}

// 공격 작업이 피해를 준 직후(combat.js resolveDamage)에 쌓는 작업. 효과가 없거나 조건이 안 맞으면 null
export function weaponHitTask(t, tgt, face, dmg) {
  if (!t.on_hit?.length || t.attacker.kind !== 'char' || tgt.kind !== 'foe' || dmg < 1) return null;
  // 산탄(splash_damage)은 combat.js가 따로 처리. faces(토큰 면 조건)는 데이터에 남아 있을 때만(2026-10-17부터 무기 데이터엔 없음)
  const effects = t.on_hit.filter((b) => b.block !== 'splash_damage' && (!b.faces || b.faces.includes(face)));
  if (!effects.length) return null;
  return { type: 'weapon_hit', attacker: t.attacker, target: t.target, effects, weapon: t.weapon ?? null };
}

const HIT = {
  stun(ctx, foe, b, t) { addStatus(ctx, foe, { status: 'stunned' }, t); },
  root(ctx, foe, b, t) { addStatus(ctx, foe, { status: 'rooted' }, t); },
  poison(ctx, foe, b, t) {
    const turns = b.turns ?? 1;
    const by = { player: t.attacker.player ?? null, char: t.attacker.id };
    const cur = foe.statuses.find((x) => x.status === 'poison');
    if (cur) { cur.turns = Math.max(cur.turns, turns); cur.by = by; } else foe.statuses.push({ status: 'poison', turns, by });
    emit(ctx, { type: 'status_granted', target: foe.uid, status: 'poison', turns, label: b.label ?? null });
  },
  knockback(ctx, foe, b, t) {
    const ch = ctx.s.chars[t.attacker.id];
    const to = ch?.cell != null ? pushCell(ctx, ch.cell, foe.cell) : { cell: null, free: false };
    if (to.free) {
      const from = foe.cell;
      foe.cell = to.cell;
      emit(ctx, { type: 'enemy_pushed', enemy: foe.uid, from, to: to.cell });
      return;
    }
    emit(ctx, { type: 'push_blocked', enemy: foe.uid, cell: to.cell ?? null, collision: b.collision ?? 0 });
    if (b.collision) {
      foe.hp = Math.max(0, foe.hp - b.collision);
      emit(ctx, { type: 'damage_applied', target: foe.uid, amount: b.collision, hp_after: foe.hp, source: 'collision', fixed: true });
      if (foe.hp <= 0) push(ctx, { type: 'death', target: { kind: 'foe', id: foe.uid }, killer: { player: t.attacker.player ?? null, char: t.attacker.id } });
    }
  },
};
const AFTER_DEATH = new Set(['lifesteal']);   // 대상이 쓰러져도 적용되는 효과

TASKS.weapon_hit = (ctx, t) => {
  for (const b of t.effects) {
    if (b.block === 'lifesteal') { lifesteal(ctx, t, b); continue; }
    const foe = getFoe(ctx.s, t.target.id);
    if (!foe || foe.hp <= 0 || AFTER_DEATH.has(b.block)) continue;
    foe.statuses ??= [];
    const fn = HIT[b.block];
    if (!fn) throw new Error(`모르는 무기 효과 ${b.block}`);
    if ((b.block === 'stun' || b.block === 'root') && isBoss(ctx, foe)) { emit(ctx, { type: 'status_immune', target: foe.uid, status: b.block === 'stun' ? 'stunned' : 'rooted' }); continue; }
    fn(ctx, foe, b, t);
  }
};

function addStatus(ctx, foe, st) {
  if (!foe.statuses.some((x) => x.status === st.status)) foe.statuses.push(st);
  emit(ctx, { type: 'status_granted', target: foe.uid, status: st.status });
}

function lifesteal(ctx, t, b) {
  const ch = ctx.s.chars[t.attacker.id];
  if (!ch || ch.exhausted) return;
  const amount = Math.min(b.amount ?? 1, ch.max_hp - ch.hp);
  if (amount <= 0) return;
  ch.hp += amount;
  emit(ctx, { type: 'healed', character: ch.id, amount, source: 'lifesteal' });
}

// 밀려날 칸: 육각 맵은 "공격자 → 대상" 방향으로 대상 바로 뒤 칸(이웃 6칸 중 그 방향과 가장 잘 맞는 칸),
// 그 밖의 맵은 공격자에게서 가장 멀어지는 이웃 칸. { cell, free } — cell이 없으면 맵 끝
export function pushCell(ctx, fromCell, targetCell) {
  const map = ctx.map;
  let best = null;
  if (isHex(map)) {
    const a = cellOf(map, fromCell), b = cellOf(map, targetCell);
    const pa = hexXY(a.q, a.r), pb = hexXY(b.q, b.r);
    const vx = pb.x - pa.x, vy = pb.y - pa.y;
    let bestDot = 0.5 * Math.hypot(vx, vy);   // 60도 넘게 틀어진 칸은 "뒤"가 아님(맵 끝으로 봄)
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
      const p = hexXY(b.q + dq, b.r + dr);
      const dot = (p.x - pb.x) * vx + (p.y - pb.y) * vy;
      if (dot > bestDot + 1e-9) { bestDot = dot; best = { q: b.q + dq, r: b.r + dr }; }
    }
    const cell = best && map.cells.find((c) => c.q === best.q && c.r === best.r);
    if (!cell) return { cell: null, free: false };
    const edge = (graph(map).adj.get(targetCell) ?? []).find((e) => e.to === cell.id && e.kind === 'normal');
    return { cell: cell.id, free: !!edge && pushable(ctx, cell.id) };
  }
  const d0 = dist(ctx, fromCell, targetCell);
  for (const e of graph(map).adj.get(targetCell) ?? []) {
    if (e.kind !== 'normal') continue;
    const d = dist(ctx, fromCell, e.to);
    if (d > d0 && (!best || d > best.d)) best = { cell: e.to, d };
  }
  if (!best) return { cell: null, free: false };
  return { cell: best.cell, free: pushable(ctx, best.cell) };
}

function pushable(ctx, cellId) {
  const c = cellOf(ctx.map, cellId);
  if (!c || c.inactive_type || c.terrain === 'obstacle' || !canStop(ctx.map, cellId)) return false;
  if (isSafeCell(ctx, cellId) || isHiddenEnemyCell(ctx, cellId)) return false;
  return !occupied(ctx, cellId);
}

// 적 차례 시작: 독 피해(2026-10-17). 독으로 쓰러진 적의 처치 보상은 독을 건 쪽
TASKS.poison_tick = (ctx) => {
  const deaths = [];
  for (const foe of allFoes(ctx.s)) {
    const st = foe.statuses?.find((x) => x.status === 'poison');
    if (!st || foe.hp <= 0) continue;
    foe.hp = Math.max(0, foe.hp - 1);
    st.turns -= 1;
    if (st.turns <= 0) foe.statuses = foe.statuses.filter((x) => x !== st);
    emit(ctx, { type: 'damage_applied', target: foe.uid, amount: 1, hp_after: foe.hp, source: 'poison', fixed: true });
    if (foe.hp <= 0) deaths.push({ type: 'death', target: { kind: 'foe', id: foe.uid }, killer: st.by ?? { player: null, char: null } });
  }
  push(ctx, ...deaths);
};

// 적 차례에 그 적이 기절 · 속박 상태인가 — 확인하면서 풀어 준다(한 번만 효과)
export function takeFoeStatus(foe, status) {
  const i = foe.statuses?.findIndex((x) => x.status === status) ?? -1;
  if (i < 0) return false;
  foe.statuses.splice(i, 1);
  return true;
}
