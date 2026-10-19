// 화면 중앙 카드 선택 창 (카드 게임식): 배경이 어두워지고 카드가 아래에서 한 장씩 펼쳐져 올라온다.
// 모든 선택은 "고르고 → 확인"(F2b, 피드백 5): 카드를 누르면 선택(주황 테두리 + ✔, 다시 누르면 취소 · 한 장 고르기면 바꾸기),
// 조건이 맞으면 확인 버튼이 켜진다. 빨리 하고 싶으면 카드를 더블클릭하면 그 카드로 바로 확인(한 장 고르기일 때).
// 누르는 즉시 결정해야 하는 특별한 경우만 instant: true.
import { renderCard } from './cards.js';
import { addKeyHint, clearKeyHints } from './keyhint.js';

let current = null;

export function closeChooser() {
  if (!current) return;
  const { root } = current;
  current = null;
  root.classList.add('closing');
  setTimeout(() => root.remove(), 180);
}

export function isChooserOpen() { return !!current; }
function togglePeek(root) { root.classList.toggle('peek'); }

/**
 * opts: {
 *   title, subtitle,
 *   items: [{ view, value, disabled, note, size }],
 *   min = 1, max = 1, preselect = [],
 *   confirmLabel = '확인',
 *   instant = false,        // true면 누르는 즉시 결정(확인 버튼 없음)
 *   buttons: [{ label, onClick, primary }],   // 넘기기 · 취소 같은 추가 버튼
 *   onPick(values),         // 확정했을 때
 *   peek = true,            // 보드를 잠깐 보는 버튼(창 접기)
 *   dblConfirm = true,      // false면 더블클릭 바로 확인을 끈다(공격받을 때 반응 창 — 실수로 카드가 쓰이지 않게)
 *   info: [{ view }],       // 고르는 카드가 아닌 참고 카드(공격하는 적 · 내 캐릭터 등) — 왼쪽에 흐리게 하지 않고 놓고 구분선
 *   emptyText,              // 고를 카드가 하나도 없을 때 보여 줄 글(예: 사용할 수 있는 카드가 없습니다)
 * }
 */
// 마지막으로 누른 자리(near 옵션 — 누른 곳 근처에 창을 띄움, 2026-10-04 사용자 피드백)
let lastPointer = null;
if (typeof document !== 'undefined') document.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
export function openChooser(opts) {
  closeChooser();
  const { title, subtitle, items, min = 1, max = 1, preselect = [], confirmLabel, buttons = [], onPick, peek = true, dblConfirm = true } = opts;
  const instant = opts.instant === true && max === 1;
  const root = document.createElement('div');
  root.className = 'chooser';
  root.innerHTML = `<div class="chooser-dim"></div><div class="chooser-box">
      <div class="chooser-title">${title ?? ''}</div>
      <div class="chooser-sub">${subtitle ?? ''}</div>
      <div class="chooser-row"></div>
      <div class="chooser-count"></div>
      <div class="chooser-buttons"></div>
    </div>`;
  const row = root.querySelector('.chooser-row');
  // columns: 한 줄에 놓을 카드 수(예: 캐릭터 9명 → 5 + 4 두 줄)
  if (opts.columns) { row.style.display = 'grid'; row.style.gridTemplateColumns = `repeat(${opts.columns}, auto)`; row.style.justifyContent = 'safe center'; }   // safe: 넘치면 왼쪽부터(잘리지 않게, 2026-10-18)
  const btnBox = root.querySelector('.chooser-buttons');
  const count = root.querySelector('.chooser-count');
  const info = opts.info ?? [];
  const autoSize = (n) => (n <= 4 ? 'lg' : n <= 7 ? 'md' : 'sm');
  const total = items.length + info.length;
  info.forEach((it, i) => {
    const el = renderCard(it.view, { size: it.size ?? autoSize(total) });
    el.classList.add('info-card', 'deal');
    el.style.animationDelay = `${i * 55}ms`;
    el.addEventListener('animationend', () => el.classList.remove('deal'), { once: true });
    row.append(el);
  });
  if (info.length) row.append(Object.assign(document.createElement('div'), { className: 'chooser-sep' }));
  if (!items.length && opts.emptyText) row.append(Object.assign(document.createElement('div'), { className: 'chooser-empty', textContent: opts.emptyText }));
  if (!items.length && !info.length && !opts.emptyText) { row.style.display = 'none'; root.classList.add('btn-only'); }   // 버튼만 있는 작은 확인 창(보드 경로가 보이게 어둡게 하지 않음)
  const chosen = new Set(preselect.map((v) => items.findIndex((it) => it.value === v)).filter((i) => i >= 0));

  const els = items.map((it, i) => {
    // 카드가 적으면 크게(가운데 창이라 읽기 쉽게), 많으면 한 줄에 들어가게
    const el = renderCard(it.view, { size: it.size ?? autoSize(total), note: it.note, disabled: it.disabled && !it.fresh && max > 0 });
    if (it.fresh) el.classList.add('fresh');
    el.style.animationDelay = `${(i + info.length) * 55}ms`;
    el.classList.add('deal');
    // 등장 애니메이션이 끝나면 떼어 낸다(남아 있으면 마지막 위치를 붙잡아 선택 · 호버 때 떠오르지 않음)
    el.addEventListener('animationend', () => el.classList.remove('deal'), { once: true });
    if (!it.disabled) {
      el.onclick = () => {
        if (instant) { flyOut(el); finish([it.value]); return; }
        if (chosen.has(i)) chosen.delete(i);
        else {
          if (max === 1) chosen.clear();
          if (chosen.size < max) chosen.add(i);
        }
        refresh();
      };
      // 더블클릭: 이 카드 한 장으로 바로 확인(한 장 고르기일 때)
      if (!instant && max === 1 && dblConfirm) el.ondblclick = () => { chosen.clear(); chosen.add(i); refresh(); if (!confirmBtn.disabled) confirmBtn.click(); };
    }
    row.append(el);
    return el;
  });

  let confirmBtn = null;
  if (!instant && !opts.hideConfirm) {   // hideConfirm: 확인 버튼 없이 buttons만(카드 보기 + 동작 버튼 창)
    confirmBtn = document.createElement('button');
    confirmBtn.className = 'primary';
    confirmBtn.textContent = confirmLabel ?? '확인';
    confirmBtn.onclick = () => {
      const vals = [...chosen].sort((a, b) => a - b).map((i) => items[i].value);
      for (const i of chosen) flyOut(els[i]);
      finish(vals);
    };
    btnBox.append(confirmBtn);
  }
  for (const b of buttons) {
    const e = document.createElement('button');
    e.textContent = b.label;
    if (b.primary) e.className = 'primary';
    e.onclick = () => { closeChooser(); b.onClick?.(); };
    btnBox.append(e);
  }
  // 보드 보기: 누르고 있는 동안 → 토글(2026-10-04 사용자 피드백 — 보면서 칸에 마우스를 올려 보고 싶음). 단축키 Tab.
  // 켜 있는 동안 창은 거의 투명하고 마우스가 보드로 통과, 화면 위 "창 다시 보기" 알약으로 끔
  if (peek) {
    const e = document.createElement('button');
    e.className = 'ghost';
    e.innerHTML = '보드 보기 <kbd>Tab</kbd>';
    e.onclick = () => togglePeek(root);
    btnBox.append(e);
    const pill = document.createElement('button');
    pill.className = 'peek-pill primary';
    pill.innerHTML = '↩ 창 다시 보기 <kbd>Tab</kbd>';
    pill.onclick = () => togglePeek(root);
    root.append(pill);
  }

  // Space · Enter가 누를 버튼(아래 onKey와 같은 규칙): 켜진 확인 버튼, 없으면 켜진 주 버튼이 하나뿐일 때 그 버튼
  const keyTarget = () => {
    const prim = [...btnBox.querySelectorAll('button.primary')].filter((b) => !b.disabled);
    return confirmBtn && !confirmBtn.disabled ? confirmBtn : prim.length === 1 ? prim[0] : null;
  };
  function refresh() {
    els.forEach((el, i) => el.classList.toggle('selected', chosen.has(i)));
    if (confirmBtn) confirmBtn.disabled = chosen.size < min || chosen.size > max;
    // "(n장 골라야 확인)"(2026-10-18 미션 최소 2장 요청): 꼭 n장을 골라야 하는 창에서 확인 버튼이 왜 꺼져 있는지 알 수 있게
    // Space · Enter 안내 배지(2026-10-18 사용자 요청 — 넘겨지는 모든 곳에 같은 표현): 지금 키가 누를 버튼에만
    clearKeyHints(btnBox);
    addKeyHint(keyTarget());
    if (!instant) count.innerHTML = max === 0 || !items.length ? '' : `선택 <b>${chosen.size}</b> / ${max}${min > 0 && min < max ? ` <small>(최소 ${min})</small>` : min > 1 && min === max && chosen.size < min ? ` <small>(${min}장 골라야 확인)</small>` : ''}${max === 1 && dblConfirm ? ' <small>· 더블클릭하면 바로 확인</small>' : ''}`;
  }
  function flyOut(el) { el.classList.add('picked'); }
  function finish(vals) {
    setTimeout(() => { closeChooser(); onPick?.(vals); }, 220);
  }
  refresh();
  document.body.append(root);
  // near: 누른 자리 근처(오른쪽 위로 펼침), 화면 밖으로 나가지 않게
  if (opts.near && lastPointer) {
    root.classList.add('near');
    const box = root.querySelector('.chooser-box');
    const r = box.getBoundingClientRect();
    let x = lastPointer.x + 40, y = lastPointer.y - r.height / 2;   // 누른 칸을 가리지 않게 조금 띄움
    if (x + r.width > innerWidth - 8) x = lastPointer.x - r.width - 40;
    x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    y = Math.max(8, Math.min(y, innerHeight - r.height - 8));
    box.style.left = `${x}px`; box.style.top = `${y}px`;
  }
  // Enter · Space: 확인 버튼(켜져 있으면), 없으면 버튼이 하나뿐인 주 버튼(2026-10-04 — 대부분의 확인을 키보드로)
  // Tab: 보드 보기 켜고 끄기
  document.activeElement?.blur?.();   // 포커스된 버튼이 Space로 한 번 더 눌리지 않게
  const onKey = (e) => {
    if (current?.root !== root) { removeEventListener('keydown', onKey); return; }
    if (e.key === 'Tab') { if (peek) { e.preventDefault(); togglePeek(root); } return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (root.classList.contains('peek')) return;
    if (e.target.closest?.('input, select, textarea')) return;
    const target = keyTarget();
    if (target) { e.preventDefault(); target.click(); }
  };
  addEventListener('keydown', onKey);
  current = { root };
  return { close: closeChooser };
}
