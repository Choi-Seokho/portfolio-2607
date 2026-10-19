// 높음 AI: 보통 AI의 판단 위에 "미리 두어 보기"를 얹는다.
//
// 자기 차례(선택 대기 없음)마다:
//   1) 보통 AI 점수로 상위 후보 몇 개(+ 차례 종료)를 고른다.
//   2) 뷰의 가려진 칸을 그럴듯하게 채운 가상 상태(ai/determinize.js)를 여러 개 만든다 — 남의 손패 · 덱 순서 · 주사위는 모르므로.
//   3) 후보마다, 가상 상태마다: 실제 엔진으로 그 행동을 하고 → 남은 행동은 보통 AI 방식으로 차례 끝까지 두어 본 뒤
//      → 끝난 상태의 가치(stateValue)를 잰다. 가상 상태들의 평균이 가장 높은 후보를 고른다.
// 선택 대기(반응 · 버리기 등) · 정비 · 암시장 · 배치는 보통 AI 판단을 그대로 쓴다.
// 결정 하나에 쓰는 시간은 프로필 search.budget_ms로 제한한다(화면이 멈춘 느낌이 안 나게).
// 뷰(view)만 본다 — 반칙 없음.

import { Session } from '../session/session.js';
import { createNormalController, makeMe, allowed, scoreOf, potential } from './normal.js';
import { determinize } from './determinize.js';
import { makeRng } from './util.js';
import { BM_DONE } from './candidates.js';
import { chapterInfo, keepValue, dangerAt, hurtCost, bossKillValue, segD, rangeOf, ctxOf, coinW } from './knowledge.js';

export function createHardController(profile, { seed = 1 } = {}) {
  const r = makeRng(seed);
  const base = createNormalController(profile, { seed: seed + 7919 });
  const S = profile.search;
  const stats = { searches: 0, rollouts: 0, ms: 0 };

  return {
    kind: 'hard',
    profile,
    stats,
    draft: base.draft,
    decide(view, tools) {
      const player = tools.player;
      const own = view.turn.phase === 'player_turn' && view.turn.current_player === player && !view.pending;
      if (!own) return base.decide(view, tools);
      const t0 = performance.now();
      const me = makeMe(view, tools, profile, r);
      // 1) 후보: 보통 점수 상위 K개(엔진이 받아들이는 것만) + 차례 종료
      const scored = tools.candidates(view).filter((a) => allowed(me, a))
        .map((a) => ({ a, s: scoreOf(me, a) })).sort((x, y) => y.s - x.s);
      const picks = [];
      for (const x of scored) {
        if (picks.length >= S.top_k) break;
        if (x.a.type === 'end_turn') continue;
        if (x.s < S.min_score) break;
        if (tools.check(x.a).ok) picks.push(x.a);
      }
      if (!picks.length) return base.decide(view, tools);
      // 행동을 쓰지 않는 확실한 이득(더 좋은 장비 · 아군 부활)은 탐색 없이 바로
      if (['equip', 'revive_infirmary'].includes(picks[0].type) || (picks[0].type === 'use_item' && scored[0].s >= 8)) return picks[0];
      const endTurn = { type: 'end_turn', player };
      const options = [...picks, endTurn];
      // 2) · 3) 가상 상태마다 후보를 두어 본다(시간 예산 안에서)
      const sum = options.map(() => 0);
      let n = 0;
      while (n < S.max_worlds && (n < S.min_worlds || performance.now() - t0 < S.budget_ms)) {
        const world = determinize(view, tools.content, r);
        const rollSeed = Math.floor(r() * 1e9);
        // 같은 가상 상태에서는 모든 후보가 같은 운(주사위 · 뽑기)을 쓴다 — 후보끼리의 차이만 비교되게(공통 난수)
        options.forEach((a, i) => { sum[i] += rollout(world, a, tools.content, player, profile, rollSeed); stats.rollouts++; });
        n++;
      }
      stats.searches++;
      stats.ms += performance.now() - t0;
      let best = 0;
      for (let i = 1; i < options.length; i++) if (sum[i] > sum[best]) best = i;
      return options[best];
    },
  };
}

// 가상 상태에서 action을 하고, 남은 내 차례를 보통 AI로 끝까지 둔 뒤 상태 가치를 돌려준다.
function rollout(world, action, content, player, profile, seed) {
  const state = structuredClone(world);
  // rng는 가상 상태마다 다르게, 같은 가상 상태 안의 후보끼리는 같게(seed가 같음)
  state.rng = (state.rng ^ (seed * 2654435761)) >>> 0;
  const seats = Object.fromEntries(Object.keys(state.players).map((p) => [p, { kind: 'ai' }]));
  const ses = new Session({ content, state, seats, controllers: { [player]: createNormalController(profile, { seed }) } });
  const res = ses.submit(player, action);
  if (!res.ok) return -1e9;
  for (let k = 0; k < profile.search.max_steps; k++) {
    const s = ses.state;
    if (s.game.over) break;
    const mine = s.pending ? ses.deciders().includes(player) : s.turn.phase === 'player_turn' && s.turn.current_player === player;
    if (!mine) break;
    try { if (!ses.step()) break; } catch { break; }
  }
  return stateValue(ses.state, content, player, profile);
}

// 상태 가치(점수 단위): 지금 점수 + 가진 것의 가치 + 위치 잠재력 − 적 차례 위험 − 탈진 손실 + 미션 진행 + 보스 진척
export function stateValue(state, content, player, profile) {
  const w = profile.w;
  const E = profile.eval;
  const v = state;
  const pl = v.players[player];
  const info = chapterInfo(v);
  const me = makeMe(v, { content, player }, profile, () => 0.5);
  let val = pl.vp + pl.coins * coinW(content);   // 코인 가치(2026-10-02 코인 2개 = 1점)
  const lateChapter = info.roundsLeft <= 1;
  for (const ch of me.mine) {
    for (const id of ch.bag) val += keepValue(v, content, id, player, w);
    for (const id of Object.values(ch.equip ?? {}).filter(Boolean)) val += keepValue(v, content, id, player, w) + E.equipped;
    if (ch.exhausted) { val -= E.exhausted_round * info.roundsLeft + E.exhausted; continue; }
    if (ch.cell == null) continue;
    val += potential(me, ch, ch.cell) * E.position;
    val -= hurtCost(ch, dangerAt(v, content, ch, ch.cell, { w }), w, { lateChapter });
    if (!lateChapter) val -= (ch.max_hp - ch.hp) * w.hp * (1 + (1 - ch.hp / ch.max_hp)) * E.missing_hp;
    val += ch.stamina * E.stamina;
  }
  val += pl.hand.length * E.card;
  for (const id of v.shelter[player].storage) val += keepValue(v, content, id, player, w);
  for (const a of pl.missions.active) {
    const m = content.missions[a.id];
    if (m) val += (a.markers / m.target) * m.vp * E.mission_progress;
  }
  // 깎아 둔 보스: 내 캐릭터가 사거리 근처에 있으면 막타 기대
  for (const b of Object.values(v.bosses)) {
    const near = me.mine.some((ch) => !ch.exhausted && ch.cell != null && segD(me.map, ch.cell, b.cell) <= rangeOf(ctxOf(v, content), ch) + 1);
    if (near) val += (1 - b.hp / b.max_hp) * bossKillValue(v, content, b.type) * E.boss_progress;
  }
  return val;
}

export { BM_DONE };
