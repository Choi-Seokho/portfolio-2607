// 이어 하기(자동 저장, 2026-10-17 포트폴리오 데모 준비 — 정식 판은 45~60분이라 새로 고침 · 탭 닫기로 판이 날아가지 않게).
// 게임 상태는 처음부터 순수 데이터(아키텍처 원칙 2)라, 엔진에 액션이 들어갈 때마다 상태 통째를 브라우저 저장소에 쓴다.
// AI 좌석은 기억하는 것 없이 매번 뷰만 보고 판단하므로(ai/) 저장할 것이 없다. 이어 할 때 새로 만든다.
// 저장소는 그 브라우저에만 남는다(다른 PC · 다른 브라우저에서는 처음부터). 시크릿 창 등 저장소를 못 쓰면 조용히 건너뛴다.
const KEY = 'eb.save';
const VERSION = 1;          // 저장 모양이 바뀌면 올린다(옛 저장은 무시)

// data: { build, data(데이터 지문), mapId, seats, state, bmDone, length }
export function saveGame(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, savedAt: Date.now(), ...data })); return true; } catch { return false; }
}

// 같은 빌드 · 같은 게임 데이터로 저장한 것만 돌려준다(카드 · 맵이 바뀐 뒤의 옛 저장은 엉뚱하게 복원될 수 있어서 버림)
export function loadSave({ build, data }) {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (!s || s.v !== VERSION || s.build !== build || s.data !== data || !s.state || s.state.game?.over) return null;
    return s;
  } catch { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}

// 게임 데이터 지문: 데이터 JSON을 바꾸면 값이 달라진다(FNV-1a 32비트 — 보안용 아님, 바뀜 감지용)
export function fingerprint(obj) {
  const str = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
