// 쉘터 보드(F2d): 내 쉘터 서랍(오른쪽 아래, 버튼 · S 키로 켜고 끔) · 다른 플레이어 쉘터 보드(위 상태 줄의 판을 누르면)
// 공개 정보: 시설 레벨 · 배치한 생존자 · 연구 토큰 · 진행 중 미션 · 장착 장비 · 체력.
// 비공개: 창고 · 가방 · 손에 든 미션 · 조사 카드 — 본인(ctx.viewer)이 아니면 장수만 보여 준다.
import { renderCard, cardView, missionView, facilityView } from './cards.js';
import { hscroll } from './hscroll.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const TABS = [['fac', '시설'], ['store', '창고'], ['tok', '토큰'], ['mis', '미션'], ['inv', '조사']];
const INV_COLORS = [['blue', '파랑', '#4F7FA8'], ['yellow', '노랑', '#B8922E'], ['red', '빨강', '#B0573F']];

export function createShelter(ctx) {
  const { content } = ctx;
  const N = () => ctx.names;
  let tab = 'fac';
  let modal = null;

  const canSee = (p) => ctx.viewer === '*' || ctx.viewer === p;

  // 탭 하나의 내용
  function fill(box, s, p, t) {
    const sh = s.shelter[p];
    const pl = s.players[p];
    const own = canSee(p);
    if (t === 'fac') {
      for (const fid of Object.keys(content.facilities)) {
        const col = el('div', 'sh-fac');
        col.append(renderCard(facilityView(content, N(), fid, sh.facilities[fid] ?? 0, sh.assigned?.[fid] ?? []), { size: 'sm' }));
        const staff = (sh.assigned?.[fid] ?? []).map((tid) => content.tokens[tid]);
        if (staff.length) col.append(el('div', 'sh-staff', staff.map((d) => `<span data-tip="${N().t(d.name_key, d.id)}">${d.kind === 'animal' ? '🐕' : '🧑'}</span>`).join('')));
        box.append(col);
      }
    } else if (t === 'store') {
      if (!own) box.append(el('div', 'sh-empty', `창고 ${sh.storage.length}장 — 다른 플레이어 창고는 장수만 보여요`));
      else if (!sh.storage.length) box.append(el('div', 'sh-empty', '창고가 비어 있어요. 정비 때 가방 카드를 넣을 수 있어요.'));
      else for (const id of sh.storage) box.append(renderCard(cardView(content, N(), id), { size: 'sm' }));
    } else if (t === 'tok') {
      const list = [
        ...sh.research.map((id) => ['research', id]),
        ...sh.survivor_pool.map((id) => ['pool', id]),
        ...Object.entries(sh.assigned ?? {}).flatMap(([f, ids]) => ids.map((id) => ['assigned', id, f])),
      ];
      if (!list.length) box.append(el('div', 'sh-empty', '아직 얻은 토큰이 없어요. 연구소 · 생존자 칸에서 얻어요.'));
      const col = el('div', 'sh-toks');
      for (const [kind, id, f] of list) {
        const d = content.tokens[id];
        const icon = kind === 'research' ? '🧪' : d?.kind === 'animal' ? '🐕' : '🧑';
        const bg = kind === 'research' ? '#4F6F8C' : '#4F9A6A';
        const where = kind === 'assigned' ? ` <small>→ ${N().nameOf(content.facilities[f])}</small>` : kind === 'pool' ? ' <small>· 대기</small>' : '';
        const c = el('div', 'sh-chip', `<span class="sh-ci" style="background:${bg}">${icon}</span><span>${N().t(d?.name_key ?? '', id)}${where}<br><small class="sh-desc">${d?.desc_key ? N().rich(d.desc_key, '') : ''}</small></span>`);
        col.append(c);
      }
      if (list.length) box.append(col);
    } else if (t === 'mis') {
      for (const a of pl.missions.active) box.append(renderCard(missionView(content, N(), a.id, { markers: a.markers }), { size: 'sm', note: '진행 중' }));
      if (own) for (const id of pl.missions.hand) box.append(renderCard(missionView(content, N(), id), { size: 'sm', note: '손에 든 미션' }));
      else for (const _ of pl.missions.hand) box.append(renderCard({}, { size: 'sm', back: true }));
      box.append(el('div', 'sh-empty', `완료한 미션 ${pl.missions.completed.length}장`));
    } else if (t === 'inv') {
      if (!own) { box.append(el('div', 'sh-empty', '조사 카드는 가방 속 비공개 정보라 볼 수 없어요')); return; }
      const bags = Object.values(s.chars).filter((c) => c.owner === p).flatMap((c) => c.bag);
      const inv = bags.filter((id) => content.cards[id]?.source === 'investigation' || content.cards[id]?.kind === 'investigation');
      const wild = inv.filter((id) => content.cards[id].wild).length + bags.filter((id) => content.cards[id]?.passive?.some((b) => b.block === 'wild_investigation')).length;
      const col = el('div', 'sh-toks');
      for (const [color, label, bg] of INV_COLORS) {
        const n = inv.filter((id) => content.cards[id].color === color && !content.cards[id].wild).length;
        const ready = n + wild >= 3;
        col.append(el('div', 'sh-chip', `<span class="sh-ci" style="background:${bg}">🔍</span><span>${label} 조사 <b>${n}</b>장 ${ready ? '<b class="sh-ready">· 보스 소환 가능!</b>' : `<small>· 보스까지 ${Math.max(0, 3 - n - wild)}장</small>`}</span>`));
      }
      col.append(el('div', 'sh-chip', `<span class="sh-ci" style="background:#7A6AA8">✦</span><span>만능 <b>${wild}</b>장 <small>(아무 색으로)</small></span>`));
      box.append(col);
    }
  }

  // 내 쉘터 서랍(탭 · 가로 넘김)
  function renderDrawer(root, s, p) {
    root.innerHTML = '';
    if (!s || !p) return;
    root.append(el('div', 'sh-head', `<b>${p} · 내 쉘터</b><small>S 키 · ESC로 닫기 · 다른 플레이어는 위쪽 판을 누르면</small>`));
    const tabs = el('div', 'sh-tabs');
    for (const [k, label] of TABS) {
      const b = el('button', tab === k ? 'on' : '', label);
      b.onclick = () => { tab = k; renderDrawer(root, s, p); };
      tabs.append(b);
    }
    root.append(tabs);
    const box = el('div', 'sh-body');
    fill(box, s, p, tab);
    root.append(box);
    hscroll(box);
  }

  // 다른 플레이어(또는 나) 쉘터 보드: 캐릭터 보드 + 시설 · 토큰 · 미션 · 창고
  function openModal(s, p) {
    closeModal();
    const m = el('div', 'sh-modal');
    const box = el('div', 'sh-mbox glass');
    const who = ctx.seatTag?.(p) ?? '';
    box.append(el('div', 'sh-mtitle', `${p}${who} · 쉘터 보드`));
    box.append(el('div', 'sh-msub', '시설 · 토큰 · 공개 미션 · 캐릭터(체력 · 장비)는 공개 정보예요. 손패 · 가방 · 손에 든 미션 · 창고 내용은 비공개(장수만). ESC · 바깥 클릭으로 닫기.'));
    const row = el('div', 'sh-mrow');
    const boards = el('div', 'sh-mboards');
    for (const ch of Object.values(s.chars).filter((c) => c.owner === p)) boards.append(ctx.charBoard(s, ch, { readonly: true }));
    row.append(boards);
    const col = el('div', 'sh-mcol');
    for (const [t, label] of [['fac', '시설'], ['tok', '토큰'], ['mis', '미션'], ['store', '창고']]) {
      col.append(el('div', 'sh-mh', label));
      const b = el('div', 'sh-body wrap');
      fill(b, s, p, t);
      col.append(b);
    }
    row.append(col);
    box.append(row);
    const close = el('button', 'primary', '닫기');
    close.onclick = closeModal;
    box.append(close);
    m.append(box);
    m.onclick = (e) => { if (e.target === m) closeModal(); };
    document.body.append(m);
    modal = m;
  }
  function closeModal() { modal?.remove(); modal = null; }

  return { renderDrawer, openModal, closeModal, isModalOpen: () => !!modal };
}
