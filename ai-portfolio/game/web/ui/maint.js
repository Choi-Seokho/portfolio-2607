// 정비 테이블(F2f, 목업 v0.3): 드래그 앤 드롭으로 가방 ↔ 가방 ↔ 창고 ↔ 장비 칸 · 판매대 · 생존자 배치.
// - 끌어 놓기는 엔진 액션으로 바뀐다: 창고에 넣기(store) · 꺼내기(retrieve) · 장착(equip) · 판매(sell) · 생존자 배치(place_survivor).
//   캐릭터 가방끼리는 "창고에 넣기 → 꺼내기" 두 단계를 한 번에 낸다.
// - 끄는 동안 놓을 수 있는 곳은 초록, 안 되는 곳은 빨강 + 이유. 판정은 화면이 따로 하지 않고 엔진 시험 제출(check)로 한다.
// - 판매대는 모아 두었다가 "판매 확정"(확정 전에는 되돌리기 가능 — 화면에만 있는 목록).
import { renderCard, cardView, facilityView, missionView } from './cards.js';
import { openChooser } from './chooser.js';
import { hscroll, edgeFade } from './hscroll.js';
import { iconHtml } from './icons.js';
import { check, bagCapacity } from '../../engine/index.js';
import { PLAYER_COLORS } from '../board3d/pieces.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const SLOTS = [['weapon', '무기'], ['armor', '방어구'], ['accessory', '액세서리']];
const GROUPS = [['weapon', '무기'], ['armor', '방어구'], ['accessory', '액세서리'], ['consumable', '소모품'], ['material', '재료'], ['treasure', '보물'], ['investigation', '조사'], ['research', '연구'], ['survivor', '생존자'], ['other', '기타']];
const CARD_H = 208;   // 작은 카드 높이(2026-10-04 카드 크기 키움 — 56×87 = 134×208px)

export function createMaintTable(ctx) {
  const { content } = ctx;
  const N = () => ctx.names;
  let sellList = [];          // [{ id, from: { zone: 'bag', ch } | { zone: 'storage' } }] — 확정 전 판매대(화면에만)
  let sellKey = null;         // 판매대가 속한 정비(챕터 · 플레이어 · 정리 화면 여부) — 바뀌면 판매대를 비운다(2026-10-18)
  // 판매대 카드를 한 번에 판다(2026-10-18 사용자 요청 "판매 버튼을 누르면 일괄 판매" — 엔진 sell_batch 한 번).
  // 예전(같은 날 125번)엔 sell을 한 장씩 연달아 냈다(앞 연출 · AI 진행을 기다려 가며)
  async function sellAll(s, P) {
    const list = sellList;
    if (!list.length) return true;
    await ctx.waitIdle?.();
    s = ctx.state();
    const items = list.map((x) => ({ character: x.from.zone === 'storage' ? storageSeller(s, P) : x.from.ch, card: x.id, ...(x.from.zone === 'storage' ? { from: 'storage' } : {}) }));
    const ok = await ctx.act({ type: 'sell_batch', player: P, items });
    if (ok) sellList = [];
    return ok;
  }
  let drag = null;            // { kind: 'card' | 'surv', id, from }
  let storeScroll = 0;

  const kindOf = (id) => (id === 'part' ? 'material' : content.cards[id]?.source === 'investigation' ? 'investigation' : content.cards[id]?.kind ?? 'other');
  const sellOf = (id) => content.cards[id]?.sell;
  // 재료 카드는 팔면 코인 대신 부품 토큰(창고로, 2026-10-01)
  const partsOf = (id) => (content.cards[id]?.material === 'part' ? content.cards[id].amount ?? 1 : 0);
  const coinOf = (s, P, x) => (partsOf(x.id) ? content.cards[x.id]?.sell_coins ?? 0 : sellOf(x.id)) + (sellerBonus(s, P, x) ?? 0);
  const sameFrom = (a, b) => a.zone === b.zone && a.ch === b.ch && a.slot === b.slot;

  // 종류별로 나누고, 칸 안은 정렬 기준대로(받은 순 · 판매가 높은 순 · 이름 — 가방 · 창고 공통, 2026-10-04 사용자 피드백 신규 7)
  const ORDERS = [['got', '받은 순'], ['sell', '판매가'], ['name', '이름']];
  let order = 'got';
  try { order = localStorage.getItem('eb.bagOrder') ?? 'got'; } catch { /* 기본값 */ }
  function groupBy(ids) {
    const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
    for (const id of ids) (by[kindOf(id)] ?? by.other).push(id);
    const nm = (id) => (id === 'part' ? '부품' : N().cardName?.(id) ?? id);
    for (const k of Object.keys(by)) {
      if (order === 'sell') by[k].sort((a, b) => (sellOf(b) ?? 0) - (sellOf(a) ?? 0));
      else if (order === 'name') by[k].sort((a, b) => nm(a).localeCompare(nm(b)));
    }
    return by;
  }
  function sortBar() {
    const bar = el('span', 'hand-sort mt-sort');
    for (const [k, label] of ORDERS) {
      const b = el('button', `mini${order === k ? ' on' : ''}`, label);
      b.onclick = (e) => { e.stopPropagation(); order = k; try { localStorage.setItem('eb.bagOrder', k); } catch { /* 무시 */ } ctx.refresh?.(); };
      bar.append(b);
    }
    return bar;
  }

  // 끌어 놓았을 때 낼 액션 목록. 안 되면 { error: 이유 글 }
  function planFor(s, P, src, to) {
    const txt = (r) => (r.ok ? null : N().errorText(r.error));
    if (src.kind === 'surv') {
      if (to.zone === 'fac') return { steps: [{ type: 'place_survivor', player: P, survivor: src.id, facility: to.fid }] };
      if (to.zone === 'pool') return src.from.zone === 'pool' ? { noop: true } : { steps: [{ type: 'place_survivor', player: P, survivor: src.id, facility: null }] };
      return { error: '생존자만' };
    }
    const id = src.id;
    // 생존자 카드(2026-10-07): 가방 · 창고 → 시설 = 배치, 시설 → 창고 = 빼기, 시설 → 가방 = 빼서 가방에
    const isSurv = content.cards[id]?.kind === 'survivor';
    if (to.zone === 'fac') {
      if (!isSurv) return { error: '생존자만' };
      if (src.from.zone === 'fac' && src.from.fid === to.fid) return { noop: true };
      const st = { type: 'place_survivor', player: P, survivor: id, facility: to.fid };
      const r = check(s, content, st);
      return r.ok ? { steps: [st] } : { error: txt(r) };
    }
    // 쉘터 대기(생존자 카드의 집, 2026-10-08 AF-1): 시설에서 빼면 대기로 돌아간다
    if (to.zone === 'pool') {
      if (!isSurv) return { error: '생존자만' };
      if (src.from.zone === 'pool') return { noop: true };
      if (src.from.zone === 'fac') return { steps: [{ type: 'place_survivor', player: P, survivor: id, facility: null }] };
      return { error: '쉘터 대기로 직접 옮길 수 없어요' };
    }
    if (src.from.zone === 'fac') {
      const out = { type: 'place_survivor', player: P, survivor: id, facility: null };
      if (to.zone === 'storage') return { steps: [out] };
      if (to.zone === 'bag') return { steps: [out, { type: 'retrieve', character: to.ch, card: id }] };
      return { error: '창고나 가방으로' };
    }
    if (src.from.zone === 'sell') return to.zone === 'sell' ? { noop: true } : { unsell: true };
    if (to.zone === 'sell') return sellOf(id) == null ? { error: '팔 수 없음' } : src.from.zone === 'equip' ? { error: '장착 중인 장비' } : { sell: true };
    // 장비 칸 → 같은 캐릭터 가방: 장착 해제(2026-10-03) · → 창고: 해제 후 보관
    if (src.from.zone === 'equip') {
      const un = { type: 'unequip', character: src.from.ch, slot: src.from.slot };
      const r = check(s, content, un);
      if (!r.ok) return { error: txt(r) };
      if (to.zone === 'bag' && to.ch === src.from.ch) return { steps: [un] };
      if (to.zone === 'storage') return { steps: [un, { type: 'store', character: src.from.ch, card: id }] };
      return { error: '먼저 이 캐릭터 가방으로 빼세요' };
    }
    const fromBag = src.from.zone === 'bag' ? src.from.ch : null;
    if (to.zone === 'storage') {
      if (!fromBag) return { noop: true };
      const r = check(s, content, { type: 'store', character: fromBag, card: id });
      return r.ok ? { steps: [{ type: 'store', character: fromBag, card: id }] } : { error: txt(r) };
    }
    const room = (chId) => s.chars[chId].bag.length < bagCapacity(s, content, chId);
    if (to.zone === 'bag') {
      if (fromBag === to.ch) return { noop: true };
      if (!room(to.ch)) return { error: '가방이 가득 참' };
      if (fromBag) return { steps: [{ type: 'store', character: fromBag, card: id }, { type: 'retrieve', character: to.ch, card: id }] };
      const r = check(s, content, { type: 'retrieve', character: to.ch, card: id });
      return r.ok ? { steps: [{ type: 'retrieve', character: to.ch, card: id }] } : { error: txt(r) };
    }
    if (to.zone === 'equip') {
      if (kindOf(id) !== to.slot) return { error: `${SLOTS.find(([k]) => k === to.slot)[1]}만` };
      if (fromBag === to.ch) {
        const r = check(s, content, { type: 'equip', character: to.ch, item: id });
        return r.ok ? { steps: [{ type: 'equip', character: to.ch, item: id }] } : { error: txt(r) };
      }
      if (!room(to.ch)) return { error: '가방이 가득 참(장착 전에 가방을 거침)' };
      const pre = fromBag ? [{ type: 'store', character: fromBag, card: id }] : [];
      return { steps: [...pre, { type: 'retrieve', character: to.ch, card: id }, { type: 'equip', character: to.ch, item: id }] };
    }
    return { error: '놓을 수 없음' };
  }

  async function run(steps) {
    for (const a of steps) if (!(await ctx.act(a))) return false;
    return true;
  }

  // opts.mode === 'arrange': 암시장에서 산 카드 정리(2026-10-04 신규 8) — 판매 · 시설 칸 없이 가방 · 창고 · 장비만, opts.fresh = 새로 산 카드(빛남)
  let arrange = null;
  function render(root, s, P, opts = {}) {
    arrange = opts.mode === 'arrange' ? opts : null;
    root.innerHTML = '';
    const keep = storeScroll;
    const mine = Object.values(s.chars).filter((c) => c.owner === P);
    const sh = s.shelter[P];
    const pl = s.players[P];
    // 다른 정비 · 정리 화면으로 바뀌면 판매대를 비운다(2026-10-18 — 예전엔 확정 안 한 판매대가 암시장 정리 화면까지 남아 가방 카드를 숨겼다)
    const key = `${s.game.chapter}:${P}:${arrange ? 'arrange' : s.turn.phase}`;
    if (key !== sellKey) { sellKey = key; sellList = []; }
    // 판매대 목록 정리(상태가 바뀌어 없어진 카드는 뺀다)
    const pool = { storage: [...sh.storage] };
    for (const c of mine) pool[c.id] = [...c.bag];
    sellList = sellList.filter((x) => { const list = pool[x.from.zone === 'storage' ? 'storage' : x.from.ch]; const i = list?.indexOf(x.id) ?? -1; if (i < 0) return false; list.splice(i, 1); return true; });
    const pendingOf = (key) => { const out = []; for (const x of sellList) if ((x.from.zone === 'storage' ? 'storage' : x.from.ch) === key) out.push(x.id); return out; };
    const without = (list, rm) => { const left = [...list]; for (const id of rm) { const i = left.lastIndexOf(id); if (i >= 0) left.splice(i, 1); } return left; };

    const box = el('div', 'mt-box');
    fitMaint();
    // 머리줄
    const parts = (pl.parts ?? 0) + [...sh.storage, ...mine.flatMap((c) => c.bag)].reduce((n, id) => n + (id === 'part' ? 1 : 0), 0);   // 부품 = 자원(+ 예전 토큰)
    const head = el('div', 'mt-head');
    head.innerHTML = `<b>${P} · ${arrange ? '암시장 구매 정리' : '정비'}</b><span class="mt-sub">${arrange ? '산 카드는 창고에 들어왔어요(빛나는 카드) — 가방 · 장비로 옮기세요' : `${s.game.chapter}챕터 끝${s.game.chapter >= s.config.chapters ? ' (마지막 — 끝나면 게임 종료)' : ' (끝나면 암시장)'}`}</span>
      <span>${iconHtml('{coin}')} <b>${pl.coins}</b></span><span>${iconHtml('{part}')} 부품 <b>${parts}</b></span><span>🗄 창고 <b>${sh.storage.length}</b>장</span>`;
    const tabs = el('span', 'mt-tabs');
    if (!arrange) for (const p of s.game.turn_order) {
      const done = s.maint_done.includes(p);
      tabs.append(el('span', `tag${p === P ? ' on' : ''}${done ? ' dim' : ''}`, `<span class="dot" style="background:${PLAYER_COLORS[p]}"></span>${p}${done ? ' 완료' : p === P ? ' 진행 중' : ''}`));
    }
    head.append(tabs);
    head.append(el('span', 'mt-hint', '카드를 끌어 옮겨요 — <i class="g"></i>놓을 수 있음 <i class="r"></i>안 됨(이유) · 겹친 카드는 이름 띠에 올리면 앞으로 · 창고는 휠/드래그로 넘겨 보기'));
    // 정비 화면에서도 내 미션 보기(2026-10-07 사용자 피드백 오늘 7) — 미션 진행에 맞춰 무엇을 팔고 · 올릴지 정하려고
    const ms = [...pl.missions.active.map((a) => ({ id: a.id, markers: a.markers, note: '진행 중' })), ...pl.missions.hand.map((id) => ({ id, markers: 0, note: '손에 든 미션' }))];
    const mbtn = el('button', 'mini', `⚑ 내 미션 ${ms.length}`);
    mbtn.disabled = !ms.length;
    mbtn.onclick = () => openChooser({
      title: `${P} · 내 미션`, subtitle: '진행 중인 미션과 손에 든 미션이에요(완료한 미션 ' + pl.missions.completed.length + '장).',
      items: ms.map((m) => ({ view: missionView(content, N(), m.id, { markers: m.markers }), value: m.id, disabled: true, note: m.note })),
      min: 0, max: 0, confirmLabel: '닫기', peek: false, onPick: () => {},
    });
    head.append(mbtn);
    // 정비 때 쓰는 연구 카드(연구 보고서 등, 2026-10-08 — 예전엔 쓸 버튼이 없어서 "정비 때만" 카드가 영영 안 쓰였음)
    const rsh = [...sh.research, ...mine.flatMap((c) => c.bag)].filter((x) => content.cards[x]?.kind === 'research');
    if (!arrange && rsh.length) {
      const rbtn = el('button', 'mini', `🧪 연구 카드 ${rsh.length}`);
      rbtn.onclick = () => {
        const user = mine.find((c) => !c.exhausted) ?? mine[0];
        openChooser({
          title: `${P} · 연구 카드`, subtitle: '정비 때 쓰는 카드(연구 보고서 등)를 여기서 써요. 다른 카드는 챕터 중에 써요.',
          items: rsh.map((x, i) => { const r = check(s, content, { type: 'use_item', character: user.id, item: x }); return { view: cardView(content, N(), x), value: i, disabled: !r.ok, note: r.ok ? '지금 사용 가능' : N().errorText(r.error) }; }),
          min: 0, max: 1, confirmLabel: '사용', peek: false, buttons: [{ label: '닫기' }],
          onPick: ([i]) => { if (i != null) ctx.act({ type: 'use_item', character: user.id, item: rsh[i] }); },
        });
      };
      head.append(rbtn);
    }
    const end = el('button', 'primary', arrange ? `${P} 정리 끝` : `${P} 정비 끝내기`);
    // 2026-10-18 처음 보는 플레이어 테스트: 마지막 정비는 "정비 끝내기" 한 번에 확인 없이 게임이 끝났음(판매 · 시설 레벨업을 안 했어도) → 한 번 묻기
    // 2026-10-18 사용자 피드백("가방 칸이 6/8 · 5/7인데 3장씩밖에 없다 — 판매한 게 적용이 안 된 것 같다"): 판매대에 올리고 "판매 확정"을 안 누른 채
    // 정비를 끝내면 카드가 팔리지 않고 가방에 남았는데, 화면은 판매대 목록(화면에만 있음)이 남아 그 카드를 가방에서 숨겼다(1 · 2챕터엔 확인 창도 없었음).
    // 사용자 결정(같은 날): 판매대에 남은 카드가 있으면 정비를 끝내지 않고 "판매 / 취소" 중에 고르게 한다 — 고른 뒤 다시 "정비 끝내기"(한 번에 끝내지 않음).
    // (그 전 125번에선 끝낼 때 자동으로 팔고 끝냈음)
    const finish = () => ctx.act({ type: 'end_maintenance', player: P });
    const askUnsold = () => openChooser({
      title: '판매가 완료되지 않은 카드가 있어요',
      subtitle: `판매대에 <b>${sellList.length}장</b>이 아직 팔리지 않았어요. 판매하거나 취소(가방 · 창고로 되돌리기)해 주세요.`,
      items: [], instant: true, peek: false,
      buttons: [
        { label: '취소 — 되돌리기', onClick: () => { sellList = []; ctx.refresh?.(); } },
        { label: `판매 (${sellList.length}장)`, primary: true, onClick: () => sellAll(ctx.state(), P) },
      ],
    });
    end.onclick = () => {
      if (arrange) return arrange.onDone?.();
      if (sellList.length) return askUnsold();
      if (s.game.chapter < s.config.chapters) return finish();
      const canUp = Object.keys(content.facilities).filter((fid) => check(s, content, { type: 'upgrade_facility', player: P, facility: fid }).ok).length;
      const lines = ['끝내면 게임이 끝나고 최종 점수를 계산해요.'];
      if (canUp) lines.push(`지금 올릴 수 있는 시설이 <b>${canUp}개</b> 있어요(레벨을 올리면 승점).`);
      if (sellList.length) lines.push(`판매대에 놓고 아직 확정하지 않은 카드가 <b>${sellList.length}장</b> 있어요(확정해야 코인 · 부품이 들어와요).`);
      // 가방 · 창고에 남은 팔 수 있는 카드(판매대에 올린 것 제외) — 게임이 끝나면 점수가 되지 않는다
      const unsold = without([...sh.storage, ...mine.flatMap((c) => c.bag)], sellList.map((x) => x.id)).filter((id) => id !== 'part' && content.cards[id]?.sell != null);
      if (unsold.length) lines.push(`가방 · 창고에 팔 수 있는 카드가 <b>${unsold.length}장</b> 남아 있어요 — 팔면 코인(재료 카드는 부품)이 되고, 그냥 끝내면 점수가 되지 않아요.`);
      openChooser({
        title: '마지막 정비 — 게임을 끝낼까요?', subtitle: lines.join('<br>'),
        items: [], instant: true, peek: false,
        buttons: [{ label: '계속 정비하기' }, { label: '끝내고 결과 보기', primary: true, onClick: finish }],
      });
    };
    head.append(end);
    box.append(head);

    const g = el('div', 'mt-grid');
    // 캐릭터 판
    for (const ch of mine) {
      const def = content.chars[ch.char];
      const mat = el('div', 'mt-zone mt-mat');
      mat.style.setProperty('--cc', def.color);
      mat.style.setProperty('--pc', PLAYER_COLORS[P]);
      const cap = bagCapacity(s, content, ch.id);
      const h = el('div', 'mt-mat-h', `<span class="dock-icon">${def.icon}</span><b>${N().charName(ch.char)}</b><small>${iconHtml('{hp}')}${ch.hp}/${ch.max_hp} ${iconHtml('{st}')}${ch.stamina}/${ch.max_stamina}</small>`);
      const toStore = el('button', 'mini', '가방 → 창고');
      toStore.dataset.tip = '가방 카드를 모두 창고로';
      toStore.onclick = () => run(without(ch.bag, pendingOf(ch.id)).map((id) => ({ type: 'store', character: ch.id, card: id })));
      h.append(toStore);
      mat.append(h);
      const eq = el('div', 'mt-eqrow');
      for (const [k, label] of SLOTS) {
        const z = dz(el('div', 'mt-slot'), { zone: 'equip', ch: ch.id, slot: k }, s, P);
        const id = ch.equip[k];
        // 장착 중인 카드도 끌 수 있다(2026-10-07 사용자 피드백 오늘 6): 같은 캐릭터 가방 · 창고에 놓으면 장착 해제(planFor의 equip 분기).
        // 누르면 예전처럼 장착 해제 메뉴, 같은 종류 장비를 끌어다 놓으면 교체
        if (id) { const c = dcard(id, { zone: 'equip', ch: ch.id, slot: k }, s, P); c.dataset.tip = '장착 중 — 끌어서 가방 · 창고에 놓으면 장착 해제 · 누르면 메뉴 · 같은 종류 장비를 끌어다 놓으면 교체'; c.addEventListener('click', () => ctx.equipMenu?.(s, ch, k)); z.append(c); }
        else if (k === 'weapon') { const w = def.starting_weapon; z.append(el('span', 'mt-lbl', `${label}<br><b>${N().t(w.name_key, '시작 무기')}</b><br><small>시작 무기 · ${iconHtml('{atk}')}${w.attack} ${iconHtml('{range}')}${w.range}</small><br><small>무기 카드를 놓으면 교체</small>`)); }
        else z.append(el('span', 'mt-lbl', `${label}<br><small>비어 있음</small>`));
        eq.append(z);
      }
      mat.append(eq);
      const bagIds = without(ch.bag, pendingOf(ch.id));
      const bag = dz(el('div', 'mt-bag'), { zone: 'bag', ch: ch.id }, s, P);
      // 판매대에 올린 카드는 빼고 센다 — 화면에 보이는 가방 카드 수와 맞게(2026-10-18 "가방 6/8인데 3장밖에 없다"). 판매대 장수는 따로 표시
      const onTable = pendingOf(ch.id).length;
      const shown = ch.bag.length - onTable;
      bag.append(el('div', 'mt-bag-h', `${iconHtml('{bag}')} 가방 <b>${shown}/${cap}</b>${onTable ? ` <small>(+판매대 ${onTable})</small>` : ''} <span class="mt-pips">${Array.from({ length: cap }, (_, i) => `<i class="${i < shown ? 'on' : ''}"></i>`).join('')}</span>`));
      // 가방도 창고처럼 종류별 칸에 포갬(2026-10-04 사용자 피드백 신규 7)
      const cols = el('div', 'mt-bagcols');
      const bagBy = groupBy(bagIds);
      for (const [k, label] of GROUPS) {
        if (!bagBy[k].length) continue;
        const col = el('div', 'mt-group');
        col.append(el('div', 'mt-gh', `${label} <b>${bagBy[k].length}</b>`));
        col.append(cascade(bagBy[k], { zone: 'bag', ch: ch.id }, 290, s, P));
        cols.append(col);
      }
      if (!bagIds.length) cols.append(el('div', 'mt-empty', '비어 있음 — 카드를 끌어다 놓으세요'));
      bag.append(cols);
      hscroll(cols);
      mat.append(bag);
      g.append(mat);
    }
    // 창고: 종류별 묶음
    const st = dz(el('div', 'mt-zone mt-store'), { zone: 'storage' }, s, P);
    const sh2 = el('div', 'mt-h', '창고 상자 <small>용량 무제한 · 종류별 자동 정리</small>');
    sh2.append(sortBar());
    st.append(sh2);
    const sz = el('div', 'mt-storez');
    const storeIds = without(sh.storage, pendingOf('storage'));
    const by = groupBy(storeIds);
    for (const [k, label] of GROUPS) {
      if (!by[k].length) continue;
      const col = el('div', 'mt-group');
      col.append(el('div', 'mt-gh', `${label} <b>${by[k].length}</b>`));
      col.append(cascade(by[k], { zone: 'storage' }, 470, s, P));
      sz.append(col);
    }
    if (!storeIds.length) sz.append(el('div', 'mt-empty', '창고가 비어 있어요'));
    st.append(sz);
    hscroll(sz);
    sz.addEventListener('scroll', () => { storeScroll = sz.scrollLeft; });
    g.append(st);
    if (!arrange) {
    // 판매대
    const sell = dz(el('div', 'mt-zone mt-sell'), { zone: 'sell' }, s, P);
    const total = sellList.reduce((n, x) => n + (coinOf(s, P, x) ?? 0), 0);
    const totalParts = sellList.reduce((n, x) => n + partsOf(x.id), 0);
    sell.append(el('div', 'mt-h', '판매대 <small>끌어다 놓고 → 확정. 확정 전엔 다시 끌어 빼거나 되돌릴 수 있어요</small>'));
    const row = el('div', 'mt-sellrow');
    if (!sellList.length) row.append(el('div', 'mt-empty', `${iconHtml('{coin}')} 팔 카드를 여기에 끌어다 놓으세요 (판매가만큼 코인 · 재료 카드는 ${iconHtml('{part}')} 부품)`));
    sellList.forEach((x, i) => {
      const d = dcard(x.id, { zone: 'sell', i }, s, P);
      d.style.zIndex = i + 1;
      d.append(el('div', 'mt-price', partsOf(x.id) ? `${iconHtml('{part}')}${partsOf(x.id)}${coinOf(s, P, x) ? ` ${iconHtml('{coin}')}${coinOf(s, P, x)}` : ''}` : `${iconHtml('{coin}')}${coinOf(s, P, x)}`));
      row.append(d);
    });
    if (sellList.length) pickByPos(row, (x) => Math.floor((x - 4) / (114 - 58)));
    sell.append(row);
    const bar = el('div', 'mt-sellbar');
    const ok = el('button', 'primary', `판매 확정 (${sellList.length}장 → ${[total || !totalParts ? `${iconHtml('{coin}')} +${total}` : '', totalParts ? `${iconHtml('{part}')} +${totalParts}` : ''].filter(Boolean).join(' · ')})`);
    ok.disabled = !sellList.length;
    ok.onclick = () => sellAll(s, P);
    const undo = el('button', null, '모두 되돌리기');
    undo.disabled = !sellList.length;
    undo.onclick = () => { sellList = []; ctx.refresh(); };
    bar.append(ok, undo);
    sell.append(bar);
    g.append(sell);
    // 시설 · 생존자
    const fz = el('div', 'mt-zone mt-fac');
    // 2026-10-18 처음 보는 플레이어 테스트 TOP 1: 시설 레벨업이 큰 점수인데 그 사실 · 부품 얻는 법이 화면에 없어 "왜 졌는지 모르고" 끝남 → 목표 한 줄
    fz.append(el('div', 'mt-h', `시설 <b class="mt-goal">레벨을 올리면 승점 ${iconHtml('{vp}')}(카드 아래 "다음 레벨 승점") · 비용은 ${iconHtml('{part}')} 부품 + ${iconHtml('{coin}')} 코인 — 부품은 재료 카드(고철 등)를 판매대에서 팔면 얻어요</b><small>생존자 토큰을 시설 카드에 끌어다 놓기 · 레벨 효과는 그 레벨에 필요한 생존자(👤 사람 · 🐾 동물)가 배치돼 있어야 작동</small>`));
    const fr = el('div', 'mt-facrow');
    for (const fid of Object.keys(content.facilities)) {
      const f = content.facilities[fid];
      const lv = sh.facilities[fid] ?? 0;
      const col = dz(el('div', 'mt-faccol'), { zone: 'fac', fid }, s, P);
      const facCard = renderCard(facilityView(content, N(), fid, lv, sh.assigned[fid] ?? []), { size: 'md' });
      facCard.classList.add('mt-faccard');
      col.append(facCard);
      const need = f.levels.filter((L) => L.staff).map((L) => `Lv${L.level} ${Object.keys(L.staff)[0] === 'animal' ? '🐾 동물' : '👤 사람'}`).join(' · ');
      // 배치된 생존자 카드: 시설 카드 아래에 겹쳐서 아래쪽 정보 띠(아이콘 + 수치)만 보이게(2026-10-07 사용자 결정). 끌어서 빼기
      const tuck = el('div', 'mt-tuck');
      (sh.assigned[fid] ?? []).forEach((sid, i) => {
        const d = content.cards[sid] ? dcard(sid, { zone: 'fac', fid }, s, P) : survTok(sid, { zone: 'fac', fid }, s, P);
        d.style.zIndex = 19 - i;   // 뒤에 놓인 카드일수록 아래 층 → 앞 카드의 정보 띠를 가리지 않음
        tuck.append(d);
      });
      if (tuck.children.length) col.append(tuck);
      else col.append(el('small', 'mt-need', need ? '생존자 카드를 여기로 끌어다 놓기' : '인력 필요 없음'));
      const next = f.levels[lv];
      const r = next ? check(s, content, { type: 'upgrade_facility', player: P, facility: fid }) : { ok: false };
      const price = next ? `${iconHtml('{part}')}${next.cost_parts}${next.cost_coins ? ` ${iconHtml('{coin}')}${next.cost_coins}` : ''}` : '';
      const up = el('button', 'mini', next ? (r.ok ? `Lv${lv + 1} 올리기 · ${price}` : `${N().errorText(r.error)} (${price})`) : '최대 레벨');
      up.disabled = !r.ok;
      if (!r.ok && (r.error?.code ?? r.error) === 'not_enough_parts') up.dataset.tip = '부품은 재료 카드(고철 등)를 판매대에 끌어다 팔면 얻어요';   // 2026-10-18
      up.onclick = () => ctx.act({ type: 'upgrade_facility', player: P, facility: fid });
      col.append(up);
      fr.append(col);
    }
    // 예전 저장의 생존자 대기 토큰(카드화 전)만 — 지금은 생존자가 가방 · 창고의 카드
    {   // 쉘터 대기: 얻은 생존자 카드가 여기로 바로 온다(2026-10-08 AF-1 — 예전엔 token_cards일 때 안 보였음)
    const poolZ = dz(el('div', 'mt-pool'), { zone: 'pool' }, s, P);
    poolZ.append(el('div', 'mt-gh', '생존자 대기'));
    const toks = el('div', 'mt-toks');
    for (const t of sh.survivor_pool) toks.append(content.cards[t] ? dcard(t, { zone: 'pool' }, s, P) : survTok(t, { zone: 'pool' }, s, P));
    if (!sh.survivor_pool.length) toks.append(el('small', 'mt-need', '대기 중인 생존자 없음'));
    poolZ.append(toks);
    fr.append(poolZ);
    }
    fz.append(fr);
    g.append(fz);
    }
    box.append(g);
    root.append(box);
    requestAnimationFrame(() => { sz.scrollLeft = keep; edgeFade(sz); });
  }

  // 창고 카드 판매자: 판매 특전이 있는 캐릭터(브로커) 우선
  function storageSeller(s, P) {
    const mine = Object.values(s.chars).filter((c) => c.owner === P);
    return (mine.find((c) => content.chars[c.char].perks?.some?.((p) => p.hook === 'on_sell')) ?? mine[0]).id;
  }
  function sellerBonus(s, P, x) {
    const chId = x.from.zone === 'storage' ? storageSeller(s, P) : x.from.ch;
    const def = content.chars[s.chars[chId]?.char];
    return (def?.perks ?? []).filter((p) => p.hook === 'on_sell').flatMap((p) => p.effect ?? []).filter((b) => b.block === 'gain_coin').reduce((n, b) => n + (b.amount ?? 0), 0);
  }

  // ----- 끌 수 있는 카드 · 생존자, 놓는 곳 -----
  function dcard(id, from, s, P) {
    const w = el('div', 'mt-dc');
    w.draggable = true;
    w.append(renderCard(cardView(content, N(), id), { size: 'md' }));
    if (arrange?.fresh?.includes(id) && from.zone === 'storage') w.classList.add('fresh');
    w.ondragstart = (e) => { drag = { kind: 'card', id, from }; e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => mark(s, P)); };
    w.ondragend = () => { drag = null; clearMarks(); };
    return w;
  }
  function survTok(id, from, s, P) {
    const d = content.tokens[id];
    const t = el('div', 'mt-surv', d.kind === 'animal' ? '🐕' : '🧑');
    t.style.background = d.kind === 'animal' ? '#8A6A48' : '#4F9A6A';
    t.dataset.tip = `${N().t(d.name_key, id)}${d.desc_key ? ` — ${N().t(d.desc_key, '')}` : ''}`;
    t.draggable = true;
    t.ondragstart = (e) => { drag = { kind: 'surv', id, from }; e.dataTransfer.setData('text/plain', id); requestAnimationFrame(() => mark(s, P)); };
    t.ondragend = () => { drag = null; clearMarks(); };
    return t;
  }
  function dz(elm, loc, s, P) {
    elm.classList.add('mt-dz');
    elm.dataset.loc = JSON.stringify(loc);
    elm.ondragover = (e) => { if (!drag) return; e.preventDefault(); elm.classList.add('over'); };
    elm.ondragleave = (e) => { if (!elm.contains(e.relatedTarget)) elm.classList.remove('over'); };
    elm.ondrop = async (e) => {
      e.preventDefault(); e.stopPropagation();
      elm.classList.remove('over');
      const src = drag;
      drag = null;
      clearMarks();
      if (!src) return;
      const plan = planFor(s, P, src, loc);
      if (plan.error) return ctx.toast?.(plan.error);
      if (plan.noop) return;
      if (plan.sell) { sellList.push({ id: src.id, from: src.from }); return ctx.refresh(); }
      if (plan.unsell) { sellList.splice(src.from.i, 1); return ctx.refresh(); }
      await run(plan.steps);
    };
    return elm;
  }
  function mark(s, P) {
    if (!drag) return;
    for (const z of document.querySelectorAll('#screen .mt-dz')) {
      const loc = JSON.parse(z.dataset.loc);
      const plan = planFor(s, P, drag, loc);
      const same = drag.from && drag.from.zone === loc.zone && (loc.ch == null || drag.from.ch === loc.ch) && drag.from.slot === loc.slot;
      z.classList.toggle('ok', !plan.error && !same);
      z.classList.toggle('no', !!plan.error);
      z.dataset.reason = plan.error ?? '';
    }
    document.getElementById('screen')?.classList.add('dragging');
  }
  function clearMarks() {
    for (const z of document.querySelectorAll('#screen .mt-dz')) z.classList.remove('ok', 'no', 'over');
    document.getElementById('screen')?.classList.remove('dragging');
  }
  // 세로로 포갠 카드 더미: 제목 띠만 보이고, 마우스가 닿은 띠의 카드를 앞으로
  function cascade(ids, from, maxH, s, P) {
    const c = el('div', 'mt-cascade');
    const step = ids.length > 1 ? Math.max(20, Math.min(36, (maxH - CARD_H) / (ids.length - 1))) : 0;
    ids.forEach((id, i) => { const d = dcard(id, from, s, P); d.style.top = `${i * step}px`; d.style.zIndex = i + 1; c.append(d); });
    c.style.height = `${ids.length ? (ids.length - 1) * step + CARD_H : 0}px`;
    pickByPos(c, (x, y) => (step ? Math.floor(y / step) : 0));
    return c;
  }
  function pickByPos(box, indexAt) {
    box.addEventListener('pointermove', (e) => {
      if (drag) return;
      const r = box.getBoundingClientRect();
      const k = box.offsetHeight ? r.height / box.offsetHeight : 1;   // 정비 판을 줄여 보일 때(fitMaint) 화면 좌표 → 판 좌표
      const kids = [...box.children];
      const i = Math.max(0, Math.min(kids.length - 1, indexAt((e.clientX - r.left) / k, (e.clientY - r.top) / k)));
      kids.forEach((d, j) => d.classList.toggle('lift', j === i));
    });
    box.addEventListener('pointerleave', () => [...box.children].forEach((d) => d.classList.remove('lift')));
  }

  return { render, reset: () => { sellList = []; } };
}

// 정비 판 축소 비율(2026-10-17): 판이 제대로 펼쳐지는 최소 크기(가로 1300 · 세로 980 — 가방 겹친 카드 더미가 들어가는 높이)보다 화면이 작으면 그만큼 줄인다.
// game3d.html의 #screen.maint .mt-box가 --mts로 크기 · 축소를 맞춘다. 창 크기를 바꾸면 다시 계산
const MAINT_MIN = { w: 1300, h: 980 };
function fitMaint() {
  const scr = document.getElementById('screen');
  if (!scr) return;
  const apply = (needH) => scr.style.setProperty('--mts', Math.max(0.6, Math.min(1, innerWidth / MAINT_MIN.w, innerHeight / needH)).toFixed(3));
  if (!scr.style.getPropertyValue('--mts')) apply(MAINT_MIN.h);   // 처음엔 어림값, 다시 그릴 때는 지난 값 유지(깜빡임 방지)
  // 그려진 뒤 필요한 높이를 직접 더해서 맞춘다: 안쪽 여백 + 머리줄 + 위 줄(최소 600, 가방 더미가 크면 그만큼) + 아래 줄(판매대 · 시설)
  // (스크롤 높이로 재면 위 줄이 남는 공간까지 늘어난 값이 섞여 실제보다 훨씬 작게 줄어드는 일이 있었다)
  requestAnimationFrame(() => {
    const b = scr.querySelector('.mt-box');
    const g = b?.querySelector('.mt-grid');
    if (!g) return;
    const outer = (e) => { const cs = getComputedStyle(e); return e.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom); };
    const inner = (z) => [...z.children].reduce((n, c) => n + (getComputedStyle(c).position === 'absolute' ? 0 : outer(c)), 0) + 22;
    const zones = [...g.children];
    const row1 = Math.max(600, ...zones.filter((z) => z.matches('.mt-mat')).map(inner));
    const row2 = Math.max(0, ...zones.filter((z) => z.matches('.mt-sell, .mt-fac')).map((z) => Math.max(z.offsetHeight ? inner(z) : 0, parseFloat(getComputedStyle(z).minHeight) || 0)));
    const head = b.querySelector('.mt-head')?.offsetHeight ?? 50;
    apply(24 + head + 10 + row1 + 12 + row2 + 6);
  });
}
addEventListener('resize', fitMaint);
