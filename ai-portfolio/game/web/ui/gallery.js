// 카드 도감(2026-10-04 사용자 피드백): 게임에 나오는 모든 카드를 종류별 탭으로 본다.
// 정적 데이터(content)만 쓰므로 게임 전 · 중 어디서나 열 수 있다. 카드 수(copies)도 함께.
import { renderCard, cardView, missionView, facilityView, foeView } from './cards.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

let root = null;

function tabs(content, N) {
  const cards = Object.values(content.cards);
  const bySource = (src) => cards.filter((c) => c.source === src);
  const charName = (id) => N.charName(id);
  const player = bySource('player');
  return [
    ['공용 카드', player.filter((c) => !c.char).map((c) => ({ view: cardView(content, N, c.id), n: c.copies }))],
    ['캐릭터 전용', player.filter((c) => c.char).sort((a, b) => a.char.localeCompare(b.char)).map((c) => ({ view: cardView(content, N, c.id), n: c.copies, group: charName(c.char) }))],
    ['보급품', bySource('supply').map((c) => ({ view: cardView(content, N, c.id), n: c.copies }))],
    ['조사', bySource('investigation').map((c) => ({ view: cardView(content, N, c.id), n: c.copies }))],
    ['암시장', bySource('black_market').map((c) => ({ view: cardView(content, N, c.id), n: c.copies }))],
    ['수색(?)', bySource('search').map((c) => ({ view: cardView(content, N, c.id), n: c.copies }))],
    ['미션', Object.keys(content.missions).map((id) => ({ view: missionView(content, N, id) }))],
    ['적', Object.values(content.enemies).filter((e) => !e.test_only).map((e) => ({ view: foeView(content, N, { uid: e.id, type: e.id, hp: e.hp, max_hp: e.hp }, 1) }))],
    ['시설', Object.keys(content.facilities).flatMap((fid) => content.facilities[fid].levels.map((_, i) => ({ view: facilityView(content, N, fid, i), group: N.nameOf(content.facilities[fid]) })))],
  ];
}

export function openGallery(content, N) {
  closeGallery();
  root = el('div', 'gallery');
  root.innerHTML = `<div class="gallery-dim"></div><div class="gallery-box"><div class="gallery-head"><h2>🂠 카드 도감</h2><div class="gallery-tabs"></div><button class="gallery-close">닫기 <kbd>Esc</kbd></button></div><div class="gallery-body"></div></div>`;
  document.body.append(root);
  root.querySelector('.gallery-dim').onclick = closeGallery;
  root.querySelector('.gallery-close').onclick = closeGallery;
  const list = tabs(content, N);
  const tabBox = root.querySelector('.gallery-tabs');
  const body = root.querySelector('.gallery-body');
  const show = (i) => {
    [...tabBox.children].forEach((b, k) => b.classList.toggle('on', k === i));
    body.innerHTML = '';
    let lastGroup = null;
    let row = null;
    for (const it of list[i][1]) {
      if (it.group !== lastGroup || !row) {
        if (it.group) body.append(el('div', 'gallery-group', it.group));
        row = el('div', 'gallery-row');
        body.append(row);
        lastGroup = it.group;
      }
      const wrap = el('div', 'gallery-item');
      wrap.append(renderCard(it.view, { size: 'md' }));
      if (it.n > 1) wrap.append(el('div', 'gallery-n', `× ${it.n}`));
      row.append(wrap);
    }
    body.scrollTop = 0;
  };
  list.forEach(([label, items], i) => {
    const b = el('button', '', `${label} <small>${items.length}</small>`);
    b.onclick = () => show(i);
    tabBox.append(b);
  });
  show(0);
}
export function closeGallery() { root?.remove(); root = null; }
export const isGalleryOpen = () => !!root;
