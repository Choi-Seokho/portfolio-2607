// 시드 기반 랜덤. 상태(state.rng)에 숫자 하나만 저장하므로 저장 · 전송 · 재현이 가능하다.
// 테스트에서는 state.test.dice(주사위 결과 목록)를 먼저 쓴다.

export const DICE_FACES = ['+1', '+2', '0', '0', '-1', '-2', 'x2', 'skull'];

// mulberry32: 32비트 상태 하나로 도는 가벼운 의사 난수
function next(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rollDie(s) {
  return drawToken(s, DICE_FACES);
}

// 토큰 주머니에서 1개 꺼내고 바로 다시 넣기(2026-10-04 수정 사항 25) — tokens: 토큰 목록(같은 토큰 여러 개 = 그만큼 잘 나옴)
// 테스트의 state.test.dice는 그대로 "꺼낸 토큰 목록"으로 쓴다.
export function drawToken(s, tokens) {
  if (s.test && Array.isArray(s.test.dice)) {
    if (s.test.dice.length === 0) throw new Error('dice_exhausted: 테스트에 준비된 주사위보다 더 많이 굴렸음');
    return s.test.dice.shift();
  }
  return tokens[Math.floor(next(s) * tokens.length)];
}

export function shuffle(s, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomInt(s, n) {
  return Math.floor(next(s) * n);
}

// 주사위 결과의 공격 수치(숫자 면만)
export function faceValue(face) {
  return face === 'x2' || face === 'skull' ? 0 : Number(face);
}

// 공격에서 고를 때의 순위: 피해가 큰 쪽이 높다 (Z-4)
export function attackRank(face) {
  return { x2: 6, '+2': 5, '+1': 4, '0': 3, '-1': 2, '-2': 1, skull: 0 }[face];
}

// 동률 판정 주사위 비교: a가 이기면 1, 지면 -1, 같으면 0. 해골은 x2를 이긴다.
export function tieCompare(a, b) {
  if (a === b) return 0;
  if (a === 'skull' && b === 'x2') return 1;
  if (a === 'x2' && b === 'skull') return -1;
  return attackRank(a) > attackRank(b) ? 1 : -1;
}
