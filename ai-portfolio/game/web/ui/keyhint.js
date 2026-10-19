// Space · Enter 안내(2026-10-18 사용자 요청 "스페이스바나 엔터로 넘겨지는 부분 중 가이드가 없는 곳이 있다 —
// 잘 보이게, 다른 걸 가리지 말고, 넘겨지는 모든 위치에 같은 표현으로"):
// Space · Enter가 실제로 누르는 버튼에 같은 안내를 붙인다.
//   - 선택 창(chooser.js): 확인 버튼(켜졌을 때) · 없으면 하나뿐인 주 버튼 — 키 처리와 같은 규칙으로 고름
//   - 행동 바(hud.js): "행동 끝"(켜졌을 때) → 아니면 깜빡이는 "차례 종료" — game3d.js 키 처리와 같은 순서
//   - 챕터 준비 안내판 "챕터 시작" · 토큰 판정 "확인" · 연출 멈춤 안내(fxpause.js 아래 알약 — 글 속에 그대로)
// 표현(2026-10-18 사용자 결정): [Space] 또는 [Enter] — 키는 키캡 모양(kbd, game3d.html)
// 위치(2026-10-18 사용자 피드백): 버튼 "안"에 넣었더니 글자를 다시 쓰는 버튼(드래프트 "확인 (5)" 카운트다운)에서 지워졌음 →
//   버튼 바로 아래에 테두리 없이. 버튼과 안내를 세로 틀(.keywrap)로 감싸 자리를 차지하게 한다(다른 요소를 덮지 않음).
export const KEYHINT_HTML = '<span class="keyhint"><kbd>Space</kbd>또는<kbd>Enter</kbd></span>';

// 버튼 하나 아래에 안내(이미 있으면 그대로)
export function addKeyHint(btn) {
  if (!btn || btn.parentElement?.classList.contains('keywrap')) return;
  const wrap = document.createElement('span');
  wrap.className = 'keywrap';
  btn.replaceWith(wrap);
  wrap.append(btn);
  wrap.insertAdjacentHTML('beforeend', KEYHINT_HTML);
}
// 영역 안의 안내 모두 떼기(대상이 바뀔 때 다시 붙이기 전에) — 틀을 풀어 버튼을 원래 자리로
export function clearKeyHints(root) {
  root?.querySelectorAll('.keywrap').forEach((w) => {
    const btn = w.querySelector(':scope > button, :scope > .act');
    if (btn) w.replaceWith(btn); else w.remove();
  });
}
