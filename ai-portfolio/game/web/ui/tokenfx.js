// 토큰 꺼내기 연출(2026-10-04 사용자 피드백 — 주사위 → 주머니 토큰): 화면 가운데에 뒤집힌 토큰이 나타나 앞면으로 돌아간다.
// 여러 개 꺼내 좋은 것 고르기(dice_advantage)면 나란히 뒤집고 고른 토큰만 밝게. 애니메이션 시간은 연출 속도(fx.tween)를 따른다.
//
// 사람이 낀 판정(사람 캐릭터가 공격하거나 공격받음)은 interactive:
//   1) 뒤집힌 토큰 + 위에 "무슨 판정인지" → 토큰을 누르거나 Space/Enter로 뒤집기(안 누르면 3초 뒤 저절로)
//   2) 앞면 + 계산식(무기 + 보너스 + 토큰 − 방어 → 피해) + [확인] 버튼(Space/Enter, 안 누르면 3초 뒤 저절로 진행)
// AI끼리 · 적끼리 판정은 저절로 뒤집고 잠깐 보여 준 뒤 사라진다.

export const TOKEN_LABEL = { '+2': '+2', '+1': '+1', '0': '0', '-1': '−1', '-2': '−2', x2: '×2', skull: '💀' };
export const TOKEN_NAME = { '+2': '+2', '+1': '+1', '0': '±0', '-1': '−1', '-2': '−2', x2: '치명 ×2', skull: '빗나감' };
const TOKEN_CLASS = { '+2': 'up', '+1': 'up', '0': 'zero', '-1': 'down', '-2': 'down', x2: 'crit', skull: 'miss' };
import { openDim, waitForInput, holdForInput, fxPauseOpts } from './fxpause.js';
import { addKeyHint } from './keyhint.js';

const FLIP_WAIT = 3;      // 뒤집기 기다리는 초
const CONFIRM_WAIT = 3;   // 확인 기다리는 초

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// fx: 보드 연출 도구 · faces/face: 꺼낸 토큰 · title: 위 줄(무슨 판정) · result: 뒤집은 뒤 계산식 · caption: 아래 줄(누구 주머니)
export async function playTokens(fx, { faces, face, title, result, caption, interactive = false }) {
  if (fx.speed >= 20) return;          // 빠른 진행(건너뛰기 · 자동 테스트)에서는 생략
  // 연출 자동 스킵 옵션(2026-10-07): 켜져 있으면 사람이 낀 판정도 눌러서 뒤집지 않고 AI끼리처럼 저절로 지나간다
  interactive = interactive && !fxPauseOpts.autoSkip;
  const list = faces?.length ? faces : [face];
  const root = el('div', `tokfx${interactive ? ' interactive' : ''}`);
  if (title) root.append(el('div', 'tokfx-title', title));
  const row = el('div', 'tokfx-row');
  const chosen = list.indexOf(face);
  const toks = list.map((f, i) => {
    const t = el('div', `tok ${TOKEN_CLASS[f] ?? 'zero'}`);
    t.innerHTML = `<div class="tok-in"><div class="tok-face tok-back">?</div><div class="tok-face tok-front"><b>${TOKEN_LABEL[f] ?? f}</b>${f === 'x2' ? '<small>치명</small>' : f === 'skull' ? '<small>빗나감</small>' : ''}</div></div>`;
    if (list.length > 1 && i !== chosen) t.dataset.other = '1';
    row.append(t);
    return t;
  });
  root.append(row);
  const hint = el('div', 'tokfx-hint');
  const res = el('div', 'tokfx-result');
  const cap = caption ? el('div', 'tokfx-cap', caption) : null;
  root.append(hint, res);
  if (cap) root.append(cap);
  document.body.append(root);
  // 사람이 낀 판정은 화면을 어둡게 하고 빈 곳 클릭도 "넘기기"로 인정(2026-10-07 사용자 피드백 오늘 8)
  const dim = interactive ? openDim() : null;
  const ins = toks.map((t) => t.querySelector('.tok-in'));
  // 1) 아래에서 떠오르며 나타남
  await fx.tween(0.18, (u) => { root.style.opacity = String(u); ins.forEach((x) => { x.style.transform = `translateY(${(1 - u) * 40}px) rotateY(0deg)`; }); });
  // 사람이 낀 판정: 눌러서 뒤집기
  if (interactive) {
    hint.hidden = false;
    await waitForInput(dim, { sec: FLIP_WAIT, extra: toks, label: '토큰을 눌러 뒤집기 · ' });
    hint.hidden = true;
  }
  // 2) 뒤집기(살짝 위로 튀어 오르며 앞면으로)
  await fx.tween(0.42, (u) => {
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    ins.forEach((x, i) => { const k = Math.min(1, Math.max(0, e * 1.15 - i * 0.12)); x.style.transform = `translateY(${-Math.sin(k * Math.PI) * 26}px) rotateY(${k * 180}deg)`; });
  });
  ins.forEach((x) => { x.style.transform = 'rotateY(180deg)'; });
  toks.forEach((t) => t.classList.add('shown'));
  if (result) { res.innerHTML = result; res.classList.add('on'); }
  // 3) 확인(사람) 또는 잠깐 보여 주고 사라짐
  if (interactive) {
    const btn = el('button', 'primary tokfx-ok');
    root.append(btn);
    btn.textContent = '확인';
    addKeyHint(btn);   // Space · Enter 안내 — 버튼 아래(2026-10-18, 예전 '확인 (Space)')
    await waitForInput(dim, { sec: CONFIRM_WAIT, extra: [btn], label: '계산 결과를 확인하세요 · ' });
  } else {
    await fx.wait(result ? 0.9 : 0.55);
  }
  await fx.tween(0.16, (u) => { root.style.opacity = String(1 - u); });
  root.remove();
  dim?.close();
}

// 카드 사용 연출(2026-10-04 사용자 피드백 — 효과 이름만 말고 카드도 보여 주기): 읽을 수 있는 크기로 잠깐 떴다가 저절로 사라짐.
// cardEl: renderCard로 만든 카드 요소 · caption: 위 줄(누가 · 언제) · hold: 보여 주는 초(연출 속도를 따름)
export async function playCardShow(fx, { cardEl, caption, hold = 1.8 }) {
  if (fx.speed >= 20) return;
  const root = el('div', 'cardfx');
  if (caption) root.append(el('div', 'cardfx-cap', caption));
  root.append(cardEl);
  document.body.append(root);
  await fx.tween(0.18, (u) => { root.style.opacity = String(u); root.style.transform = `translate(-50%, -50%) scale(${0.85 + 0.15 * u})`; });
  // 한 번 멈춤(2026-10-07 사용자 피드백 오늘 4): 빈 곳 클릭 · Space · Enter로 넘기고, 안 누르면 카운트 뒤 자동. 자동 스킵 옵션이면 hold초만 보여 줌
  await holdForInput(fx, { hold, short: hold <= 1 });
  await fx.tween(0.2, (u) => { root.style.opacity = String(1 - u); root.style.transform = `translate(-50%, ${-50 - 6 * u}%) scale(1)`; });
  root.remove();
}
