// AI 공용 도구: AI 전용 시드 난수(엔진 난수와 분리) · 가중치 순서 정하기

// xorshift32: AI의 무작위 선택용. 엔진 난수(state.rng)를 건드리지 않으므로 게임 재현에는 영향이 없다
// (AI가 낸 액션이 액션 기록에 남기 때문에, 재현은 여전히 "시작 상태 + 액션 기록"만으로 된다).
export function makeRng(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

export const pick = (r, list) => list[Math.floor(r() * list.length)];
// 캐릭터 고르기 회복(choose_char · 구원자 특전 1, 2026-10-17): 이 캐릭터가 실제로 받는 체력 + 스테미너 양
export const lack = (ch, p) => Math.min(p.hp ?? 0, ch.max_hp - ch.hp) + Math.min(p.stamina ?? 0, ch.max_stamina - ch.stamina);

// 가중치가 클수록 앞에 올 확률이 높은 무작위 순서(가중치 0 이하는 뺀다)
export function weightedOrder(r, list, weightOf) {
  return list
    .map((x) => ({ x, w: weightOf(x) }))
    .filter((e) => e.w > 0)
    .map((e) => ({ x: e.x, k: Math.pow(r() || 1e-9, 1 / e.w) }))
    .sort((a, b) => b.k - a.k)
    .map((e) => e.x);
}

// 순서대로 엔진에 시험 제출해서 처음으로 받아들여지는 액션
export function firstLegal(tools, ordered) {
  for (const a of ordered) if (tools.check(a).ok) return a;
  return null;
}
