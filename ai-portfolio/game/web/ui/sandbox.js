// 테스트 맵 도구(2026-10-17 사용자 요청 "맵에서 특정 카드를 골라 써 보는 테스트 공간"):
// 시작 화면의 "🧪 테스트 맵"(개발용 — 포트폴리오 데모 빌드에는 없음)으로 열면 오른쪽에 이 판이 뜬다.
//   카드 넣기(손패 · 가방 · 장착) · 보드에 놓기(허수아비 · 적 · 보스 · 상대 캐릭터 · 내 캐릭터 순간 이동) · 지우기
//   · 수치(체력 · 스테미너 · 코인 · 부품 · 탈진) · 캐릭터 바꾸기 · 행동 다시 · 챕터 1번 능력 초기화 · 적 행동 끄기/켜기
// 상태는 api.patch(fn)로 직접 고친다(테스트 전용 — 실제 게임 규칙 경로가 아님, 액션 로그에도 안 남음).
// 카드를 쓰는 것 · 공격 · 이동은 평소처럼 게임 화면에서 한다(그게 테스트 대상).
import { makeChar } from '../../engine/setup.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const SLOT = { weapon: 'weapon', armor: 'armor', accessory: 'accessory' };

// api: { state(), content, names, patch(fn), act(a), toast(t), refresh(), selected(), pickCell(hint, cb) }
export function createSandbox(api) {
  const { content } = api;
  const N = api.names;
  const root = el('div', 'sandbox glass');
  root.id = 'sandbox';
  document.body.append(root);
  let open = true;

  const SRC = { player: '플레이어', supply: '보급품', black_market: '암시장', investigation: '조사', search: '수색', token: '토큰' };
  const cardLabel = (c) => `${N.cardName(c.id)} · ${SRC[c.source] ?? c.source}${c.char ? `(${N.charName(c.char)})` : ''} [${c.id}]`;
  const cards = Object.values(content.cards).filter((c) => c.source !== 'token' || c.kind === 'research');
  const enemyTypes = Object.values(content.enemies);

  function render() {
    root.innerHTML = '';
    const head = el('div', 'sb-head', '<b>🧪 테스트 도구</b>');
    const tog = el('button', 'mini', open ? '접기' : '펼치기');
    tog.onclick = () => { open = !open; render(); };
    head.append(tog);
    root.append(head);
    if (!open) return;
    const s = api.state();
    const sel = s && s.chars[api.selected()];
    root.append(el('div', 'sb-note', sel ? `고른 캐릭터: <b>${N.charName(sel.char)}</b>(${sel.owner})` : '캐릭터를 먼저 고르세요(왼쪽 아래 보드 또는 보드의 말)'));

    // 1) 카드 넣기
    const sec1 = section('카드 넣기');
    const input = el('input', 'sb-input');
    input.setAttribute('list', 'sb-cards');
    input.placeholder = '카드 이름 또는 id';
    const dl = el('datalist');
    dl.id = 'sb-cards';
    for (const c of cards) dl.append(new Option(cardLabel(c)));
    const pickId = () => {
      const v = input.value.trim();
      const m = v.match(/\[([^\]]+)\]$/);
      const id = m ? m[1] : cards.find((c) => c.id === v || N.cardName(c.id) === v)?.id;
      if (!id) api.toast('목록에서 카드를 고르세요');
      return id;
    };
    sec1.append(input, dl, row(
      btn('손패에', () => { const id = pickId(); if (id) patch((x) => x.players[x.turn.current_player ?? 'P1'].hand.push(id), `손패에 ${N.cardName(id)}`); }),
      btn('가방에', () => { const id = pickId(); const c = sel; if (!id || !need(c)) return; patch((x) => { const cd = content.cards[id]; if (cd.kind === 'research') x.shelter[c.owner].research.push(id); else x.chars[c.id].bag.push(id); }, `가방에 ${N.cardName(id)}`); }),
      btn('장착', () => {
        const id = pickId(); const c = sel; if (!id || !need(c)) return;
        const slot = SLOT[content.cards[id].kind];
        if (!slot) return api.toast('장비(무기 · 방어구 · 액세서리)만 장착할 수 있어요');
        patch((x) => { x.chars[c.id].equip[slot] = id; }, `${N.charName(c.char)}: ${N.cardName(id)} 장착`);
      }),
    ));
    root.append(sec1);

    // 2) 보드에 놓기
    const sec2 = section('보드에 놓기 → 칸 누르기');
    const what = el('select', 'sb-select');
    what.append(new Option('허수아비(체력 99, 가만히)', 'enemy:dummy'));
    for (const e of enemyTypes) if (!e.test_only && !e.boss) what.append(new Option(`적 · ${N.foeName({ type: e.id })}`, `enemy:${e.id}`));
    for (const e of enemyTypes) if (e.boss) what.append(new Option(`보스 · ${N.foeName({ type: e.id })}`, `boss:${e.id}`));
    for (const c of Object.values(s?.chars ?? {})) what.append(new Option(`${c.owner === 'P1' ? '내' : '상대'} 캐릭터 옮기기 · ${N.charName(c.char)}(${c.owner})`, `char:${c.id}`));
    what.value = sec2.dataset.last ?? 'enemy:dummy';
    sec2.append(what, row(
      btn('칸 고르기', () => {
        const v = what.value;
        api.pickCell(`${what.selectedOptions[0].text}: 놓을 칸을 누르세요(<kbd>Esc</kbd> 취소)`, (cell) => place(v, cell));
      }),
      btn('적 지우기 → 칸', () => api.pickCell('지울 적 · 보스가 있는 칸을 누르세요(<kbd>Esc</kbd> 취소)', (cell) => patch((x) => {
        for (const g of [x.enemies, x.bosses]) for (const [k, f] of Object.entries(g)) if (f.cell === cell) delete g[k];
      }, '지웠어요'))),
    ));
    root.append(sec2);

    // 3) 수치
    const sec3 = section('고른 캐릭터 수치');
    sec3.append(row(
      btn('체력 · 스테미너 가득', () => need(sel) && patch((x) => { const c = x.chars[sel.id]; c.hp = c.max_hp; c.stamina = c.max_stamina; c.exhausted = false; if (c.cell == null) c.cell = sel.cell; }, '가득 채움')),
      btn('체력 1', () => need(sel) && patch((x) => { x.chars[sel.id].hp = 1; }, '체력 1')),
      btn('탈진시키기', () => need(sel) && patch((x) => { const c = x.chars[sel.id]; c.hp = 0; c.exhausted = true; }, '탈진')),
    ), row(
      btn('코인 +10', () => patch((x) => { x.players[sel?.owner ?? 'P1'].coins += 10; }, '코인 +10')),
      btn('부품 +10', () => patch((x) => { const p = x.players[sel?.owner ?? 'P1']; p.parts = (p.parts ?? 0) + 10; }, '부품 +10')),
      btn('조사 카드 3장(같은 색)', () => need(sel) && patch((x) => {
        const inv = Object.values(content.cards).filter((c) => c.kind === 'investigation' && !c.wild);
        const color = inv[0]?.color;
        for (const c of inv.filter((c2) => c2.color === color).slice(0, 3)) x.chars[sel.id].bag.push(c.id);
      }, '조사 카드 3장 — 보스 탐색 시험용')),
    ));
    const chSel = el('select', 'sb-select');
    for (const id of Object.keys(content.chars)) chSel.append(new Option(N.charName(id), id));
    if (sel) chSel.value = sel.char;
    sec3.append(row(chSel, btn('이 캐릭터로 바꾸기', () => need(sel) && patch((x) => {
      const old = x.chars[sel.id];
      const fresh = makeChar(content, { id: old.id, owner: old.owner, char: chSel.value, cell: old.cell, bag: old.bag }, old.order ?? 0);
      x.chars[sel.id] = { ...fresh, equip: { ...old.equip }, power_used: [] };
    }, `${N.charName(chSel.value)}(으)로 바꿈 — 특전 · 능력치 적용, 전용 카드는 카드 넣기로`))));
    root.append(sec3);

    // 4) 진행
    const idle = !!s?.config.test?.enemies_idle;
    const sec4 = section('진행');
    sec4.append(row(
      btn('행동 다시 채우기', () => patch((x) => { x.turn.act = {}; x.turn.actions_left = Object.values(x.chars).filter((c) => c.owner === x.turn.current_player).length; }, '이번 차례 행동을 다시 채웠어요')),
      btn('챕터 1번 능력 초기화', () => patch((x) => { for (const c of Object.values(x.chars)) c.power_used = []; }, '무기 능력을 다시 쓸 수 있어요')),
    ), row(
      btn(idle ? '적 행동: 꺼짐 → 켜기' : '적 행동: 켜짐 → 끄기', () => patch((x) => { (x.config.test ??= {}).enemies_idle = !idle; }, idle ? '적이 다시 움직여요' : '적이 가만히 있어요(허수아비는 항상 가만히)')),
      btn('차례 종료', () => api.act({ type: 'end_turn', player: s.turn.current_player })),
    ));
    root.append(sec4);
    root.append(el('div', 'sb-note', '카드 · 공격 · 이동은 평소처럼 하면 돼요. 이 판의 수정은 테스트 전용이에요(이어 하기 저장 안 함).'));
  }

  function place(v, cell) {
    const s = api.state();
    const [kind, id] = v.split(':');
    const taken = [...Object.values(s.chars).filter((c) => c.cell === cell && !(kind === 'char' && c.id === id)), ...Object.values(s.enemies).filter((f) => f.cell === cell), ...Object.values(s.bosses).filter((f) => f.cell === cell)];
    if (taken.length) return api.toast('빈 칸을 고르세요');
    patch((x) => {
      if (kind === 'char') { const c = x.chars[id]; c.cell = cell; if (c.exhausted) { c.exhausted = false; c.hp = Math.max(1, c.hp); } return; }
      const def = content.enemies[id];
      const uid = `${kind === 'boss' ? 'b' : 'x'}${++x.game.uid}`;
      const group = kind === 'boss' ? x.bosses : x.enemies;
      group[uid] = { uid, type: id, cell, hp: def.hp, max_hp: def.hp, seq: ++x.game.seq, statuses: [] };
    }, '놓았어요');
  }

  function patch(fn, msg) { api.patch(fn); if (msg) api.toast(msg); render(); }
  function need(c) { if (!c) api.toast('캐릭터를 먼저 고르세요'); return !!c; }
  function section(title) { const d = el('div', 'sb-sec'); d.append(el('div', 'sb-h', title)); return d; }
  function row(...xs) { const d = el('div', 'sb-row'); d.append(...xs); return d; }
  function btn(t, fn) { const b = el('button', 'mini', t); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; }

  // 게임 화면이 다시 그려질 때: 고른 캐릭터 · 캐릭터 목록 · 적 행동 설정이 바뀌었을 때만 판을 다시 그린다(입력 중인 글이 지워지지 않게)
  let lastKey = '';
  function sync() {
    const s = api.state();
    const key = `${api.selected()}|${Object.values(s?.chars ?? {}).map((c) => `${c.id}:${c.char}:${c.cell}`).join(',')}|${!!s?.config.test?.enemies_idle}`;
    if (key === lastKey) return;
    lastKey = key;
    render();
  }
  render();
  return { render, sync };
}
