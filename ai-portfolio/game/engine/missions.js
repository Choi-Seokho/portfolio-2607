// 미션: 조건을 진행하면 자동 공개 → 마커 → 목표 수에 도달하면 완료(승점 + 보상)

import { TASKS, emit, gainVp, runBlocks } from './core.js';

// 미션 조건 판정: 적힌 값이 모두 같으면 진행(exclude_boss만 특별). 예) {type:'enemy_killed', exclude_boss:true, zone:'blue'}
function matches(m, trig) {
  const tr = m.trigger;
  if (tr.type !== trig.type) return false;
  for (const [k, v] of Object.entries(tr)) {
    if (k === 'type') continue;
    if (k === 'exclude_boss') { if (v && trig.boss) return false; continue; }
    if (trig[k] !== v) return false;
  }
  return true;
}

TASKS.mission_progress = (ctx, t) => {
  const P = ctx.s.players[t.player];
  const ms = P.missions;
  const candidates = [...ms.active.map((a) => a.id), ...ms.hand];
  for (const id of candidates) {
    const m = ctx.c.missions[id];
    let entry = ms.active.find((a) => a.id === id);
    if (!matches(m, t.trigger)) continue;
    if (!entry) {
      ms.hand.splice(ms.hand.indexOf(id), 1);
      entry = { id, markers: 0 };
      ms.active.push(entry);
      emit(ctx, { type: 'mission_revealed', player: t.player, mission: id });
    }
    entry.markers += Math.max(1, t.trigger.count ?? 1);   // 한 번에 여러 개(카드 여러 장 · 코인 N개)면 그만큼
    emit(ctx, { type: 'mission_progress', player: t.player, mission: id, markers: entry.markers });
    if (entry.markers >= m.target) {
      ms.active.splice(ms.active.indexOf(entry), 1);
      ms.completed.push(id);
      emit(ctx, { type: 'mission_completed', player: t.player, mission: id });
      gainVp(ctx, t.player, m.vp, 'mission');
      runBlocks(ctx, m.reward, { player: t.player, char: t.char ? ctx.s.chars[t.char] : null });
    }
  }
};
