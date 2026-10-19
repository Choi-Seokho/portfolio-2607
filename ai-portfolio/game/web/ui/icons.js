// 문구 속 아이콘 표기({move}+2 등)를 화면용으로 바꾼다. 아이콘 목록은 data/icons.json(데이터), 이름은 번역 키(icon.*).
// - iconText: 글자만 쓰는 곳(버튼 · 툴팁 · 로그)용 — 임시 기호로 바꾼다.
// - iconHtml: 카드 설명처럼 HTML로 그리는 곳용 — 아이콘 배지(<span class="ic">)로 바꾼다. 이미 이스케이프된 문자열을 받는다.
// Godot · 인쇄로 옮길 때도 같은 {id} 표기를 그 환경의 아이콘으로 바꾸면 된다.

let ICONS = {};
let NAME = (key) => key;

export async function loadIcons(dataBase) {
  const raw = await (await fetch(`${dataBase}icons.json`)).json();
  setIcons(raw);
  return ICONS;
}

export function setIcons(raw) {
  ICONS = Object.fromEntries((raw.icons ?? []).map((i) => [i.id, i]));
}

// 툴팁에 쓸 아이콘 이름(번역) 조회 함수를 연결
export function setIconNames(t) { NAME = t; }

const TOKEN = /\{([a-z_]+)\}/g;

export function iconText(str) {
  if (!str || !str.includes('{')) return str;
  return str.replace(TOKEN, (m, id) => ICONS[id]?.glyph ?? m);
}

export function iconHtml(escaped) {
  if (!escaped || !escaped.includes('{')) return escaped;
  return escaped.replace(TOKEN, (m, id) => {
    const ic = ICONS[id];
    if (!ic) return m;
    return `<span class="ic ic-${id}" style="--icc:${ic.color ?? '#666'}" data-tip="${NAME(ic.name_key, id)}">${ic.glyph}</span>`;
  });
}

// 카드(또는 캐릭터 보드)에 마우스를 올리면 카드 오른쪽(자리가 없으면 왼쪽)에, 카드와 겹치지 않게
// 그 카드에 나오는 모든 아이콘의 뜻을 "아이콘 : 이름" 목록으로 보여 준다. hostSelector = 카드로 칠 요소들.
export function installCardLegend(hostSelector) {
  if (document.getElementById('card-legend')) return;
  const box = document.createElement('div');
  box.id = 'card-legend';
  box.style.cssText = 'position:fixed;z-index:9998;pointer-events:none;display:none;padding:8px 10px;border-radius:10px;'
    + 'background:rgba(24,27,38,.94);color:#fff;font:600 13px/1.55 "Pretendard","Noto Sans KR","Malgun Gothic",sans-serif;'
    + 'box-shadow:0 8px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.22);white-space:nowrap';
  document.body.append(box);
  let cur = null;
  // 정렬 규칙(2026-10-18 사용자 요청 "툴팁이 겹쳐서 나온다 — 카드 > 툴팁 순서로, 미션 카드(원본) > 미션 카드(확대) > 툴팁(설명)"):
  //   확대 카드(cardzoom.js .card-zoom)가 떠 있으면 설명판은 확대 카드 바깥쪽(원본 → 확대와 같은 방향)에 붙인다.
  //   그쪽에 자리가 없으면 원본 카드의 반대편. 확대 카드가 없으면 예전처럼 카드 오른쪽(자리가 없으면 왼쪽).
  //   예전엔 늘 원본 카드 옆에 붙어서, 원본 옆에 뜬 확대 카드를 덮었다
  const place = () => {
    if (!cur?.isConnected) { hide(); return; }
    const r = cur.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const zoom = cur.classList.contains('zoomable') ? document.querySelector('.card-zoom') : null;
    let x, top = r.top;
    if (zoom) {
      const z = zoom.getBoundingClientRect();
      const right = z.left + z.width / 2 >= r.left + r.width / 2;   // 확대 카드가 원본 오른쪽에 떴나
      const lo = Math.min(r.left, z.left), hi = Math.max(r.right, z.right);   // 원본 + 확대 묶음
      x = right ? z.right + 10 : z.left - w - 10;
      if (right && x + w > innerWidth - 6) x = lo - w - 10;
      if (!right && x < 6) x = hi + 10;
      top = z.top;
    } else {
      x = r.right + 10;
      if (x + w > innerWidth - 6) x = r.left - w - 10;          // 오른쪽에 자리가 없으면 왼쪽
    }
    box.style.left = `${Math.max(6, Math.min(x, innerWidth - w - 6))}px`;
    box.style.top = `${Math.max(6, Math.min(top, innerHeight - h - 6))}px`;
  };
  const hide = () => { box.style.display = 'none'; cur = null; };
  const show = (host) => {
    const seen = new Map();
    for (const ic of host.querySelectorAll('.ic')) {
      const id = [...ic.classList].find((c) => c.startsWith('ic-'));
      if (id && !seen.has(id)) seen.set(id, [ic.textContent, ic.dataset.tip ?? '']);
    }
    if (!seen.size) { hide(); return; }
    cur = host;
    box.innerHTML = [...seen.values()].map(([g, name]) => `<div><span style="display:inline-block;width:1.6em;font-size:1.2em;vertical-align:-.1em">${g}</span> : ${name}</div>`).join('');
    box.style.display = 'block';
    place();
  };
  // 들어 올려지는 카드는 다 올라간 뒤(약 0.2초) 그 자리에 띄운다 — 올라가는 동안 설명판이 따라 움직여 흔들려 보이던 문제(2026-10-04)
  let pending = null, timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; pending = null; };
  document.addEventListener('pointermove', (e) => {
    const host = e.target.closest?.(hostSelector);
    if (!host) { cancel(); if (cur) hide(); return; }
    if (host === cur) return;                       // 이미 떠 있으면 그대로(위치를 다시 잡지 않음)
    if (host === pending) return;
    cancel(); if (cur) hide();
    pending = host;
    timer = setTimeout(() => { if (pending?.isConnected) show(pending); pending = null; }, host.matches('.card') ? 200 : 60);
  }, { passive: true });
  document.addEventListener('pointerdown', () => { cancel(); hide(); });
  document.addEventListener('dragstart', hide);
}

// 아이콘에 마우스를 올리면 뜻을 말풍선으로 보여 준다(카드 밖 아이콘용 — 카드 안은 위 설명판이 맡음).
// 페이지에서 한 번만 호출. data-tip이 있는 모든 요소에 동작한다. skip = 말풍선을 띄우지 않을 영역(카드).
export function installIconTips(skip = null) {
  if (document.getElementById('icon-tip')) return;
  const tip = document.createElement('div');
  tip.id = 'icon-tip';
  tip.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none;padding:4px 9px;border-radius:8px;'
    + 'background:#1E2230;color:#fff;font:600 13px/1.3 "Pretendard","Noto Sans KR","Malgun Gothic",sans-serif;'
    + 'box-shadow:0 4px 14px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);white-space:nowrap;transform:translate(-50%,-100%)';
  document.body.append(tip);
  let cur = null;
  document.addEventListener('pointerover', (e) => {
    let t = e.target.closest?.('[data-tip]');
    if (t && skip && t.closest(skip)) t = null;
    if (t === cur) return;
    cur = t;
    if (!t) { tip.style.display = 'none'; return; }
    const r = t.getBoundingClientRect();
    tip.textContent = t.dataset.tip;
    tip.style.left = `${r.left + r.width / 2}px`;
    // 화면 위쪽 요소면 아래로 띄움(위로 띄우면 화면 밖)
    const below = r.top < 70;
    tip.style.top = `${below ? r.bottom + 6 : r.top - 6}px`;
    tip.style.transform = below ? 'translate(-50%,0)' : 'translate(-50%,-100%)';
    tip.style.whiteSpace = t.dataset.tip.length > 40 ? 'normal' : 'nowrap';
    tip.style.maxWidth = '360px';
    tip.style.display = 'block';
    // 화면 밖으로 나가지 않게 가로 위치를 맞춤
    const w = tip.offsetWidth;
    const cx = Math.max(w / 2 + 6, Math.min(innerWidth - w / 2 - 6, r.left + r.width / 2));
    tip.style.left = `${cx}px`;
  });
  document.addEventListener('pointerdown', () => { tip.style.display = 'none'; cur = null; });
}

export function iconGlyph(id) { return ICONS[id]?.glyph ?? ''; }
