// 내 덱 · 버린 카드 · 소실 카드 보기(2026-10-07 사용자 피드백 10-03 항목 7):
//   "뭘 버렸을 때 어떤 걸 다시 먹을 수 있는지" — 남은 덱에 어떤 카드가 몇 장 있는지, 버린 더미에 뭐가 쌓였는지 확인한다.
//   덱은 섞여 있어서 순서는 모르고 "무슨 카드가 남았는지"만 보여 준다(같은 카드는 ×n으로 묶음).
//   소실 카드(쓰면 게임에서 빠지는 카드, players[p].exiled)가 있으면 세 번째 탭으로 나온다.
// 화면 전용 도구(규칙 판정 없음). 본인 것만 열 수 있다(남의 덱 · 손패는 비공개).
import { renderCard, cardView } from './cards.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
let open = null;

export function isPilePeekOpen() { return !!open; }
export function closePilePeek() { open?.remove(); open = null; picking = false; removeEventListener('keydown', onKey, true); }
let picking = false;   // 고르기 모드(레벨업 — 뺄 카드): 반드시 골라야 해서 Esc · 바깥 누르기로 닫지 않음
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); if (!picking) closePilePeek(); } }

// ctx: { content, names } · s: 상태 · owner: 보는 플레이어 · tab: 'deck' | 'discard' | 'exiled' | 'hand'(고르기 모드)
// opts.pick = { title, note, onPick(zone, cardId) } — 카드 운용 버전 레벨업에서 뺄 카드 고르기(2026-10-19 사용자 요청 "덱 보는 화면에서 하나 골라 버리자"):
//   손패 · 덱 · 버린 카드 탭에서 카드를 누르고 "이 카드 빼기"
export function openPilePeek(ctx, s, owner, tab = 'deck', opts = {}) {
  closePilePeek();
  const { content } = ctx;
  const N = ctx.names;
  const P = s.players[owner];
  const pick = opts.pick ?? null;
  picking = !!pick;
  let chosen = null;   // { zone, id }
  const tabs = [...(pick ? [['hand', `손패 ${P.hand.length}`]] : []), ['deck', `남은 덱 ${P.deck.length}`], ['discard', `버린 카드 ${P.discard.length}`]];
  if (P.exiled?.length) tabs.push(['exiled', `소실 ${P.exiled.length}`]);
  const root = el('div', 'pile-modal');
  const box = el('div', 'pile-box glass');
  root.append(box);
  const body = el('div', 'pile-body');
  const draw = () => {
    box.innerHTML = '';
    box.append(el('div', 'pile-title', pick ? pick.title : `${owner} · 내 카드 더미`));
    const bar = el('div', 'pile-tabs');
    for (const [k, label] of tabs) {
      const b = el('button', k === tab ? 'on' : '', label);
      b.onclick = () => { tab = k; draw(); };
      bar.append(b);
    }
    if (pick) {
      const go = el('button', 'mini primary', chosen ? `「${N.cardName?.(chosen.id) ?? chosen.id}」 빼기` : '뺄 카드를 누르세요');
      go.disabled = !chosen;
      go.onclick = () => { const c = chosen; closePilePeek(); pick.onPick(c.zone, c.id); };
      bar.append(go);
    } else {
      const x = el('button', 'mini', '닫기 <kbd>Esc</kbd>');
      x.onclick = closePilePeek;
      bar.append(x);
    }
    box.append(bar);
    if (pick) box.append(el('div', 'pile-note', pick.note));
    const note = { deck: '덱은 섞여 있어서 순서는 몰라요 — 어떤 카드가 몇 장 남았는지만 보여요. 손패가 모자라 뽑을 때 이 중에서 나와요.',
      discard: '쓰거나 버린 카드예요. 덱이 떨어지면 이 카드들을 섞어서 새 덱이 돼요.',
      exiled: '효과를 쓰고 게임에서 빠진 카드예요(다시 돌아오지 않아요).', hand: '지금 손에 든 카드예요.' }[tab];
    if (!pick) box.append(el('div', 'pile-note', note));
    const pileOf = (t) => (t === 'deck' ? P.deck : t === 'discard' ? P.discard : t === 'hand' ? P.hand : P.exiled);
    const ids = pileOf(tab).filter((id) => id !== '?');
    const hidden = pileOf(tab).length - ids.length;
    const grid = el('div', 'pile-grid');
    // 같은 카드는 묶어서 ×n, 종류 → 이름 순
    const count = new Map();
    for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
    const kindOrder = (id) => (content.cards[id]?.char ? 0 : 1);
    const list = [...count.entries()].sort(([a], [b]) => kindOrder(a) - kindOrder(b) || (content.cards[a]?.kind ?? '').localeCompare(content.cards[b]?.kind ?? '') || (N.cardName?.(a) ?? a).localeCompare(N.cardName?.(b) ?? b));
    for (const [id, n] of list) {
      const w = el('div', 'pile-item');
      const cardEl = renderCard(cardView(content, N, id), { size: 'sm' });
      w.append(cardEl);
      if (n > 1) w.append(el('span', 'pile-n', `×${n}`));
      if (pick) {
        w.style.cursor = 'pointer';
        if (chosen && chosen.zone === tab && chosen.id === id) { cardEl.classList.add('armed'); w.style.outline = '3px solid #FFD23F'; w.style.borderRadius = '10px'; }
        w.onclick = () => { chosen = { zone: tab, id }; draw(); };
      }
      grid.append(w);
    }
    if (!list.length) grid.append(el('div', 'pile-empty', hidden ? `${hidden}장 — 이 화면에서는 내용을 알 수 없어요` : '비어 있어요'));
    box.append(grid);
  };
  draw();
  root.onclick = (e) => { if (e.target === root && !pick) closePilePeek(); };
  document.body.append(root);
  addEventListener('keydown', onKey, true);
  open = root;
}
