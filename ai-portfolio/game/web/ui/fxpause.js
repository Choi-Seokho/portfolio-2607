// 연출 멈춤(2026-10-07 사용자 피드백 "오늘 4 · 8"):
//   머리 위 떠오르는 글자를 뺀 연출(카드 공개 · 카드 사용 · 토큰 뒤집기 · 미션 완료 …)은 한 번씩 멈춘다.
//   - 멈춘 동안 화면을 어둡게(딤) 하고 보드 · 버튼 클릭을 막아 연출에만 집중시킨다(보드판은 "빈 영역"으로 취급).
//   - 빈 곳 클릭 · Space · Enter로 넘어가고, 안 누르면 카운트다운이 끝나 저절로 넘어간다(온라인에서 한 사람이 멈춰 세우지 않게).
//   - 옵션 "연출 자동 스킵"을 켜면 멈추지 않고 예전처럼 정해진 시간만 보여 주고 지나간다. 설정은 브라우저에 저장(없어도 동작).
// 규칙 판정과 무관한 화면 전용 도구라 엔진은 모른다.

import { KEYHINT_HTML } from './keyhint.js';
const KEY = 'eb.fxAutoSkip';
const WAIT_SEC = 4;      // 안 누르면 넘어가는 시간(초) — 내 카드 같은 짧은 연출은 SHORT_SEC
const SHORT_SEC = 2;

let autoSkip = false;
try { autoSkip = localStorage.getItem(KEY) === '1'; } catch { /* 저장소를 못 써도 기본값으로 */ }

export const fxPauseOpts = {
  // 관전(사람이 한 명도 없는 판)처럼 멈출 이유가 없을 때 true를 돌려주는 함수를 game3d.js가 꽂는다
  suspended: null,
  get autoSkip() { return autoSkip; },
  set autoSkip(v) { autoSkip = !!v; try { localStorage.setItem(KEY, autoSkip ? '1' : '0'); } catch { /* 무시 */ } },
};

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// 딤 켜기: 전체 화면을 덮는 클릭 막이 + 아래 안내 줄. close()로 치움
export function openDim() {
  const dim = el('div', 'fx-dim');
  const hint = el('div', 'fx-dim-hint');
  document.body.append(dim, hint);
  requestAnimationFrame(() => dim.classList.add('on'));
  return {
    el: dim,
    setHint: (t) => { hint.innerHTML = t; },   // 2026-10-18: Space · Enter 배지(HTML)를 넣으려고 textContent → innerHTML(넣는 글은 모두 내부 문구)
    close: () => { dim.remove(); hint.remove(); },
  };
}

// 사람 입력 기다리기: 빈 곳(딤) 클릭 · 추가 대상 클릭 · Space · Enter, 아니면 sec초 뒤 저절로.
// extra: 같이 클릭으로 인정할 요소들(예: 토큰 · 확인 버튼). label: 안내 앞 문구
export function waitForInput(dim, { sec = WAIT_SEC, extra = [], label = '' } = {}) {
  return new Promise((resolve) => {
    let left = sec;
    let done = false;
    const targets = [dim.el, ...extra];
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(iv);
      removeEventListener('keydown', onKey, true);
      targets.forEach((t) => t.removeEventListener('click', finish));
      resolve();
    };
    const onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(); } };
    const tick = () => dim.setHint(`${label}${KEYHINT_HTML}로 넘기기 · 아무 곳이나 클릭해도 돼요 · ${Math.max(0, left)}초 뒤 자동`);   // 같은 배지(2026-10-18 — "[Space] 또는 [Enter]로 넘기기")
    const iv = setInterval(() => { left -= 1; tick(); if (left <= 0) finish(); }, 1000);
    tick();
    addEventListener('keydown', onKey, true);
    targets.forEach((t) => t.addEventListener('click', finish));
  });
}

// 연출 하나를 보여 준 뒤 멈추기. 자동 스킵이거나 빠른 진행(fx.speed ≥ 20)이면 hold초만 기다리고 지나간다.
export async function holdForInput(fx, { hold = 1.5, short = false } = {}) {
  if (autoSkip || fx.speed >= 20 || fxPauseOpts.suspended?.()) { await fx.wait(hold); return; }
  const dim = openDim();
  await waitForInput(dim, { sec: short ? SHORT_SEC : WAIT_SEC });
  dim.close();
}
