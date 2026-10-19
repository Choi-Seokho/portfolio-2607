// 플레이어 차례 조작부(F2d): 내 자원 줄 + 캐릭터 보드(왼쪽 아래) · 행동 버튼(오른쪽 아래) · 손패(맨 아래 부채꼴)
//
// 손패 카드 쓰는 법(카드 게임식):
//   - "차례 중 언제든" 카드: 누르면 바로 사용(대상이 필요하면 중앙 창에서 고름)
//   - "이동할 때 / 공격할 때 / 휴식할 때" 카드: 누르면 장전(위로 올라와 빛남) → 다음 그 행동에 같이 쓰임
//   - "공격받을 때" 카드: 지금은 못 씀(공격받을 때 중앙 창에 나옴)
import { renderCard, cardView, missionView, portraitView, foeView, optionView } from './cards.js';
import { openChooser, isChooserOpen } from './chooser.js';
import { iconHtml, iconText } from './icons.js';
import { openDim } from './fxpause.js';
import { addKeyHint, KEYHINT_HTML } from './keyhint.js';
import { openPilePeek } from './pilepeek.js';
import { attachCardZoom } from './cardzoom.js';
import { PLAYER_COLORS } from '../board3d/pieces.js';
import { cardUse, attackTargets, check, bagCapacity, isNear, charActionsLeft, perCharActions, turnActions, activationMode, cardMode, basicStamina, itemStamina, canDo, actOf, interactInfo } from '../../engine/index.js';
import { weaponOf, rangeOf, moveOf, defenseOf } from '../../engine/core.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function createHud(ctx, dom) {
  const { content } = ctx;
  const N = () => ctx.names;
  const ui = ctx.ui;          // { selected, mode, armed: [{char, card}] }

  function render() {
    const s = ctx.state();
    dom.dock.innerHTML = '';
    dom.actions.innerHTML = '';
    dom.hand.innerHTML = '';
    dom.actions.classList.remove('center');
    if (!s) { for (const d of [dom.dock, dom.actions, dom.hand]) d.classList.add('hidden'); return; }
    // "나" = 지금 화면을 봐도 되는 플레이어(사람 1명이면 그 사람, 핫싯이면 가리개를 확인한 사람, 관전이면 지금 차례).
    // 내 차례가 아니어도 내 캐릭터 보드 · 손패를 읽기 전용으로 보여 준다(A-6b, 예전 "알려진 한계 1").
    const me = ctx.me?.() ?? null;
    const turn = s.turn.phase === 'player_turn' && !s.pending;
    const cur = s.turn.current_player;
    const interactive = !!turn && !!me && me === cur && ctx.isHuman(cur);
    const shown = ['player_turn', 'enemy_turn', 'chapter_prep', 'placement'].includes(s.turn.phase);
    const visible = !!me && !s.game.over && shown;
    ui.interactive = interactive;
    document.body.classList.toggle('readonly-hud', visible && !interactive);
    dom.dock.classList.toggle('hidden', !visible);
    dom.hand.classList.toggle('hidden', !visible);
    syncPrepPanel(s, me);
    const pb = phaseButton(s);
    dom.actions.classList.toggle('hidden', !pb && !visible);
    if (pb) { dom.actions.classList.add('center'); dom.actions.append(pb); }
    // 손패에서 바로 고르기(2026-10-18 사용자 요청 "멀리건 · 손패 초과 버리기는 화면 가운데에 카드를 다시 뿌리지 말고 손패에서 골라 바꾸자")
    const hp = visible ? handPickInfo(s, me) : null;
    syncHandPickDim(!!hp);
    if (!visible) { syncPickDim(false); return; }
    const mine = Object.values(s.chars).filter((c) => c.owner === me);
    // 캐릭터는 미리 골라 두지 않는다(2026-10-04 사용자 피드백): 차례 시작 · 배치 때 플레이어가 먼저 캐릭터를 고른다.
    // 안 골랐으면 고를 수 있는 캐릭터 보드가 빛나며(pick) 고르라고 안내 — 이미 있는 칸을 눌러 바로 상호작용되던 문제도 없어짐
    if (interactive && ui.selected && !mine.some((c) => c.id === ui.selected)) ui.selected = null;
    let selId = interactive ? ui.selected : (mine.find((c) => c.id === ui.viewSel) ?? mine.find((c) => !c.exhausted) ?? mine[0])?.id;
    let pickable = [];
    // 배치 차례: 고른(아직 안 놓은) 캐릭터가 다음에 놓임. 남은 캐릭터가 하나면 그 캐릭터
    if (s.pending?.type === 'placement' && s.pending.player === me) {
      const unplaced = mine.filter((c) => c.cell == null);
      if (!unplaced.some((c) => c.id === ui.placeSel)) ui.placeSel = unplaced.length === 1 ? unplaced[0].id : null;
      selId = ui.placeSel;
      if (!selId) pickable = unplaced.map((c) => c.id);
    } else if (interactive && !selId && s.turn.phase === 'player_turn') {
      pickable = mine.filter((c) => !c.exhausted && c.cell && charActionsLeft(s, c.id) > 0).map((c) => c.id);
    }
    dom.dock.append(missionStrip(s, me));
    dom.dock.append(myResources(s, me, interactive));
    // 배치 차례인데 캐릭터를 아직 안 골랐으면: 화면 전체를 딤드하고 캐릭터 보드만 활성화(2026-10-13 사용자 피드백)
    syncPickDim(s.pending?.type === 'placement' && s.pending.player === me && pickable.length > 0);
    const boards = el('div', `dock-boards${pickable.length ? ' picking' : ''}`);
    for (const ch of mine) boards.append(charBoard(s, ch, { interactive, selected: ch.id === selId, pick: pickable.includes(ch.id) }));
    dom.dock.append(boards);
    if (!pb) renderActions(s, me, interactive);
    if (hp) renderPickHand(s, me, hp);
    else renderHand(s, selId, interactive, me);
    fitMissionStrip();
  }

  // 미션 카드 띠가 위 도구 줄(연출 속도 · 건너뛰기 …)을 덮지 않게(2026-10-18 한 판 점검 봇 114번 — 1366×657 3챕터에서
  // 탈진한 캐릭터 보드에 "의무실 부활" 안내가 붙어 보드가 길어지자 자원 줄 · 미션 띠가 같이 위로 밀려 버튼을 덮음).
  // 사용자 결정(2026-10-18): 도구 줄 아래로만 — 자리가 모자라면 띠를 아래 기준으로 작게 줄인다(마우스를 올리면 지금처럼 크게 보기).
  addEventListener('resize', () => fitMissionStrip());
  function fitMissionStrip() {
    const strip = dom.dock.querySelector('.mission-strip:not(.empty)');
    if (!strip) return;
    strip.style.transform = '';
    let limit = 0;
    for (const id of ['tools', 'finder']) {
      const t = document.getElementById(id);
      if (!t || t.classList.contains('hidden') || getComputedStyle(t).display === 'none') continue;
      limit = Math.max(limit, t.getBoundingClientRect().bottom);
    }
    if (!limit) return;
    const r = strip.getBoundingClientRect();
    const room = r.bottom - (limit + 6);
    if (r.top >= limit + 6 || r.height <= 0) return;
    const k = Math.max(0.4, room / r.height);
    strip.style.transform = `scale(${k.toFixed(3)})`;
  }

  // ---------- 손패에서 바로 고르기: 멀리건 · 손패 초과 버리기(2026-10-18 사용자 요청) ----------
  // 예전엔 가운데 선택 창(decisions.js openChooser)에 손패를 한 벌 더 펼쳐 골랐다 — 같은 카드가 두 번 보이고, 실물처럼 "손에 든 카드를 골라 바꾸는" 느낌이 없었음.
  // 이제 손패 카드를 눌러 고르고(들림 + "다시 뽑기" · "버리기" 표시, 다시 누르면 취소) 손패 위 판의 버튼 · Space · Enter로 확정.
  // 손패가 보이지 않는 국면(정비 등)에서 생기면 예전처럼 선택 창으로(decisions.js가 ctx.handPickOk로 물어봄).
  const HAND_PICK = ['mulligan', 'discard_to_hand_limit'];
  const HAND_SHOWN = ['player_turn', 'enemy_turn', 'chapter_prep', 'placement'];
  function handPickInfo(s, me) {
    const p = s.pending;
    if (!p || !HAND_PICK.includes(p.type) || !me || p.player !== me || !ctx.isHuman(me) || !HAND_SHOWN.includes(s.turn.phase) || s.game.over) return null;
    const hand = s.players[me].hand;
    const key = `${p.type}:${me}:${s.game.chapter}:${s.game.round}:${hand.join(',')}`;
    if (ui.handPick?.key !== key) ui.handPick = { key, sel: [] };   // 결정이 바뀌면 고른 것 초기화
    return p;
  }
  ctx.handPickOk = (s, p) => HAND_PICK.includes(p?.type) && HAND_SHOWN.includes(s.turn.phase) && (ctx.me?.() ?? null) === p.player && ctx.isHuman(p.player);
  function syncHandPickDim(on) {
    document.body.classList.toggle('hand-picking', on);
    let d = document.getElementById('handpickdim');
    if (on && !d) {
      d = el('div'); d.id = 'handpickdim';
      d.onclick = () => ctx.toast?.('아래 손패에서 카드를 눌러 고르세요');
      document.body.append(d);
    } else if (!on && d) d.remove();
  }
  function renderPickHand(s, me, p) {
    const hand = s.players[me].hand;
    const st = ui.handPick;
    const mull = p.type === 'mulligan';
    const k = st.sel.length;
    const max = s.config.hand.max_per_player;
    const box = el('div', 'hand-pick glass');
    const once = s.config.hand.mulligan === 'every_chapter_start' ? '챕터마다' : '게임 시작 때';
    box.append(el('div', 'hp-head', mull
      ? `${s.game.chapter > 1 ? `${s.game.chapter}챕터 시작 손패` : '처음 손패'} — 다시 뽑을 카드를 손패에서 고르세요`
      : `손패가 넘쳤어요 — 공용 손패는 최대 ${max}장, <b>${p.count}장</b>을 버리세요`));
    box.append(el('div', 'hp-sub', mull
      ? `원하는 만큼 · ${once} 1번만 · 고른 만큼 새로 뽑고, 고른 카드는 덱에 섞어요 (고름 <b>${k}</b>장)`
      : `버릴 카드를 손패에서 누르세요 · 다시 누르면 취소 (<b>${k}</b>/${p.count})`));
    const btns = el('div', 'hp-btns');
    const submit = (ids) => { ui.handPick = null; syncHandPickDim(false); ctx.act({ type: 'choose', player: me, choice: ids }); };   // 딤은 바로 걷음(핫싯 가리개 밑에 남지 않게)
    let keyBtn;
    if (mull) {
      const redraw = el('button', k ? 'primary' : '', k ? `고른 ${k}장 다시 뽑기` : '고른 카드 다시 뽑기');
      redraw.disabled = !k;
      redraw.onclick = () => submit(st.sel.map((i) => hand[i]));
      const keep = el('button', k ? '' : 'primary', '이대로 시작');
      keep.onclick = () => submit([]);
      btns.append(redraw, keep);
      keyBtn = k ? redraw : keep;   // 안 골랐으면 Space · Enter = 이대로 시작
    } else {
      const go = el('button', 'primary', `고른 ${p.count}장 버리기`);
      go.disabled = k !== p.count;
      go.onclick = () => submit(st.sel.map((i) => hand[i]));
      btns.append(go);
      keyBtn = k === p.count ? go : null;
    }
    box.append(btns);
    if (keyBtn) { keyBtn.id = 'handpick-key'; addKeyHint(keyBtn); }
    dom.hand.append(box);

    const fan = el('div', 'hand-fan');
    const n = hand.length;
    const room = dom.hand.clientWidth || 600;
    const ov = n > 1 ? Math.min(-14, (room - 2 * 46 - 168 * n) / (2 * (n - 1))) : 0;
    fan.style.setProperty('--ov', `${Math.max(-72, ov)}px`);
    sortedIdx(hand, null).forEach((i) => {
      const e = renderCard(cardView(content, N(), hand[i]), { size: 'md' });
      const pos = fan.children.length;
      const off = pos - (n - 1) / 2;
      e.style.setProperty('--rot', `${off * 5}deg`);
      e.style.setProperty('--lift', `${Math.abs(off) * 6}px`);
      e.classList.add('in-hand', 'pickable');
      if (st.sel.includes(i)) {
        e.classList.add('hp-sel', mull ? 'redraw' : 'discard');   // 'picked'는 선택 창 날아가기 연출(chooser.js)이 이미 써서 다른 이름
        e.append(el('div', 'pick-badge', mull ? '🔄 다시 뽑기' : '🗑 버리기'));
      }
      e.onclick = () => {
        const j = st.sel.indexOf(i);
        if (j >= 0) st.sel.splice(j, 1);
        else { st.sel.push(i); if (!mull && st.sel.length > p.count) st.sel.shift(); }   // 버리기는 정해진 장수만 — 넘치면 먼저 고른 것을 뺌
        ctx.refresh();
      };
      fan.append(e);
    });
    dom.hand.append(fan);
  }

  // 배치 캐릭터 고르기 딤: 보드 · 손패 클릭을 막고, 누르면 "캐릭터부터 고르세요" 안내
  function syncPickDim(on) {
    document.body.classList.toggle('pick-char', on);
    let d = document.getElementById('pickdim');
    if (on && !d) {
      d = el('div'); d.id = 'pickdim';
      d.onclick = () => ctx.toast?.('먼저 배치할 캐릭터를 고르세요(왼쪽 아래 빛나는 캐릭터 보드)');
      document.body.append(d);
    } else if (!on && d) d.remove();
  }

  // ---------- 챕터 준비 안내 판(2026-10-07 사용자 피드백 오늘 8-1) ----------
  // 예전엔 가운데 아래에 "챕터 준비 진행" 버튼만 떠서 손패와 겹치고 허전했다 → 뒷배경을 어둡게 하고
  // 몇 챕터인지 · 누가 선 플레이어인지 · 현재 순위를 보여 주는 판 + 시작 버튼. Space · Enter · 빈 곳 클릭으로도 진행.
  let prep = null;   // { dim, box }
  function closePrep() { prep?.dim.close(); prep?.box.remove(); prep = null; }
  // 승점 얻는 법 요약(2026-10-18 처음 보는 플레이어 테스트 TOP 5 — 점수 구조를 끝까지 몰라 "왜 졌는지 모름"):
  // 챕터 준비 안내판에 항상. 남은 흐름(챕터 · 라운드 · 정비)도 같이
  function scoreGuide(s) {
    const cv = s.config.scoring?.coin_value ?? 1;
    const per = cv > 0 && cv < 1 ? Math.round(1 / cv) : 1;
    const left = s.config.chapters - s.game.chapter + 1;
    return `<div class="pp-sec">승점 얻는 법</div><ul class="pp-guide">
      <li>적 처치 ${iconHtml('{vp}')} — 보스는 크게(먼저 잡을수록 더)</li>
      <li>미션 완료 ${iconHtml('{vp}')} — 왼쪽 위 미션 카드의 조건</li>
      <li><b>챕터 끝 정비 때 시설 레벨업</b> ${iconHtml('{vp}')} — 부품(재료 카드를 팔아서) + 코인이 필요</li>
      <li>게임 끝에 남은 코인 ${per > 1 ? `${per}개당 1점` : '1개당 1점'}</li></ul>
      <div class="pp-flow">${left > 1 ? `남은 챕터 ${left}개` : '이번이 마지막 챕터'} · 챕터마다 ${s.config.rounds_per_chapter}라운드 → 정비${left > 1 ? ' → 암시장' : ' → 게임 끝'}</div>`;
  }
  function syncPrepPanel(s, me) {
    // 챕터 준비는 공개 국면이라 핫싯(사람 2명 이상)에서는 "나"가 없을 수 있다 — me는 순위표에 "나" 표시에만 쓰고 필수가 아님
    // 암시장 구매 정리 화면(ui.arrangeQueue)이 남아 있으면 안내 판을 띄우지 않는다(2026-10-17 버그 수정 — 사용자 "암시장에서 산 아이템을
    // 착용하려 했는데 창고로 가고 화면이 넘어갔다": 정리 화면 위에 이 판의 "아무 곳이나 클릭하면 시작" 어두운 막이 같이 떠서,
    // 카드를 끌려고 누르는 순간 다음 챕터가 시작됐다. Space도 같은 문제)
    const want = s.turn.phase === 'chapter_prep' && !s.pending && !s.game.over && !ctx.spectating() && !ctx.ui.arrangeQueue?.length;
    if (!want) { closePrep(); return; }
    if (prep) return;
    const order = s.game.turn_order;
    // 챕터 준비를 시작하면 선 플레이어가 한 칸 넘어간다(첫 챕터 제외, 엔진 TASKS.chapter_prep와 같은 규칙) — 미리 보여 줌
    const first = s.game.chapter > 1 ? order[1 % order.length] : order[0];
    const rank = [...order].sort((a, b) => s.players[b].vp - s.players[a].vp || order.indexOf(a) - order.indexOf(b));
    const rows = rank.map((p) => {
      const place = 1 + rank.filter((q) => s.players[q].vp > s.players[p].vp).length;
      return `<div class="pp-row${p === me ? ' me' : ''}"><span class="pp-n">${place === 1 ? '👑' : place}</span><span class="dot" style="background:${PLAYER_COLORS[p]}"></span><b>${p}</b>${p === me ? '<small>나</small>' : ''}<span class="pp-v">${iconHtml('{vp}')} ${s.players[p].vp}</span></div>`;
    }).join('');
    const box = el('div', 'prepbox');
    box.id = 'prepbox';
    box.innerHTML = `<div class="pp-title">${s.game.chapter}챕터 준비</div>
      <div class="pp-sub">이번 챕터 선 플레이어: <b style="color:${PLAYER_COLORS[first]}">${first}</b>${first === me ? ' (나)' : ''}</div>
      <div class="pp-sec">현재 승점 순위</div>${rows}${scoreGuide(s)}`;
    const go = el('button', 'primary big', '▶ 챕터 시작');
    go.id = 'prepbox-go';
    box.append(go);
    addKeyHint(go);   // Space · Enter 안내 — 버튼 아래(2026-10-18)
    document.body.append(box);
    const dim = openDim();
    dim.setHint(`${KEYHINT_HTML}로 시작 · 아무 곳이나 클릭해도 돼요`);
    prep = { dim, box };
    const start = () => { if (!prep) return; closePrep(); ctx.act({ type: 'run_chapter_prep' }); };
    go.onclick = start;
    dim.el.onclick = start;
  }

  // 내 미션 카드 띠(2026-10-07 사용자 피드백 오늘 10): 왼쪽 플레이어 구역 맨 위에 항상 — 진행 중(마커 n개) + 손에 든 미션.
  // 작은 카드(xs)로 줄여서 보드 위를 덜 가린다. 카드를 눌러 크게 보는 건 쉘터 서랍 "미션" 탭.
  function missionStrip(s, p) {
    const pl = s.players[p];
    const box = el('div', 'mission-strip');
    // 조금 크게(mini) + 마우스를 올리면 정상 크기로 확대(2026-10-13 사용자 피드백 — 미션 카드도 안 보임)
    for (const a of pl.missions.active) { const v = missionView(content, N(), a.id, { markers: a.markers }); box.append(attachCardZoom(renderCard(v, { size: 'mini', note: '진행 중' }), v, { side: 'right' })); }
    for (const id of pl.missions.hand) { const v = missionView(content, N(), id); box.append(attachCardZoom(renderCard(v, { size: 'mini', note: '손에 든 미션' }), v, { side: 'right' })); }
    if (!box.children.length) box.classList.add('empty');
    return box;
  }

  // 내 자원 줄(캐릭터 보드 위): 승점 · 코인 · 손패 · 창고 · 미션 · 연구 토큰
  function myResources(s, p, interactive) {
    const pl = s.players[p];
    const sh = s.shelter[p];
    const ms = pl.missions.active.length + pl.missions.hand.length;
    const e = el('div', `myres${s.turn.phase === 'player_turn' && s.turn.current_player === p ? ' cur' : ''}`);   // 내 차례면 강조
    e.style.setProperty('--pc', PLAYER_COLORS[p]);
    e.innerHTML = `<b class="me">${p} · 나</b><span data-anchor="vp" data-tip="승점">${iconHtml('{vp}')}<b>${pl.vp}</b></span><span data-anchor="coin" data-tip="코인">${iconHtml('{coin}')}<b>${pl.coins}</b></span><span data-anchor="part" data-tip="부품(시설 레벨업에 씀)">${iconHtml('{part}')}<b>${pl.parts ?? 0}</b></span>`
      + `<span data-anchor="hand" data-tip="공용 손패">${iconHtml('{card}')}${pl.hand.length}</span><span data-anchor="storage" data-tip="창고(장수)">🗄${sh.storage.length}</span>`
      + `<span data-anchor="mission" data-tip="미션(진행 · 손에 든)">${iconHtml('{marker}')}${ms}</span><span data-anchor="research" data-tip="연구 카드(쉘터 보관함) — 누르면 보기 · 사용">${iconHtml('{research}')}${sh.research.length + [...sh.storage, ...Object.values(s.chars).filter((c) => c.owner === p).flatMap((c) => c.bag)].filter((id) => content.cards[id]?.kind === 'research').length}</span>`
      + (interactive ? '' : `<small class="watch">${s.turn.phase === 'player_turn' ? `${s.turn.current_player} 차례 — 보기만` : '보기만'}</small>`);
    const rs = e.querySelector('[data-anchor="research"]');
    if (rs) { rs.classList.add('clickable'); rs.onclick = () => researchMenu(s, p, interactive); }
    return e;
  }

  function phaseButton(s) {
    if (!s || s.pending || ctx.spectating()) return null;   // 관전은 적 차례 · 챕터 준비가 자동으로 넘어간다
    if (s.turn.phase === 'enemy_turn' && ctx.autoEnemyTurn?.()) return null;   // 사람 1명이면 적 차례는 자동(F2h)
    // 챕터 준비는 버튼 대신 가운데 안내 판(prepPanel, 2026-10-07 사용자 피드백 오늘 8-1) — 손패와 안 겹치고 Space · 빈 곳 클릭으로 넘어감
    const map = { enemy_turn: ['적 차례 진행', { type: 'run_enemy_turn' }] };
    const m = map[s.turn.phase];
    if (!m) return null;
    const b = el('button', 'big primary', m[0]);
    b.onclick = () => ctx.act(m[1]);
    return b;
  }

  // ---------- 캐릭터 보드(F2d, 도크 대신) ----------
  // 체력 · 스테미너 · 장비 3칸(늘 보임) · 가방 칸(용량만큼) · 특전. 장비 · 가방 칸을 누르면 카드를 크게 본다
  // (내 차례면 가방 카드는 장착 · 사용 · 버리기 메뉴). 다른 플레이어 가방은 장수만(뒷면).
  function charBoard(s, ch, { interactive = false, selected = false, readonly = false, pick = false } = {}) {
    const def = content.chars[ch.char];
    const canSee = ctx.viewer === '*' || ctx.viewer === ch.owner;
    const p = el('div', `cboard${selected && !readonly ? ' sel' : ''}${pick && !readonly ? ' pick' : ''}${ch.exhausted ? ' exhausted' : ''}`);
    p.dataset.char = ch.id;
    p.style.setProperty('--pc', PLAYER_COLORS[ch.owner]);
    p.style.setProperty('--cc', def.color ?? PLAYER_COLORS[ch.owner]);
    const pct = (a, b) => `${Math.max(0, Math.min(100, (a / b) * 100))}%`;
    const cap = bagCapacity(s, content, ch.id);
    const slot = (k, label) => {
      const id = ch.equip[k];
      if (id) {
        const v = cardView(content, N(), id);
        // 라운드에 한 번 쓰는 장비를 이번 라운드에 썼으면 실물처럼 옆으로 눕힌다(2026-10-01 그래플링 훅)
        const tapped = (ch.tapped ?? []).includes(id);
        const tip = tapped ? ` data-tip="${esc(v.title)} — 이번 라운드에 썼어요(라운드가 끝나면 다시 세워짐)"` : '';
        return `<div class="cb-slot full${tapped ? ' tapped' : ''}" data-card="${id}" data-slot="${k}" style="--band:${v.band}"${tip}><span class="g">${v.glyph}</span>${esc(v.title)}</div>`;
      }
      // data-slot: 가방 카드를 끌어다 놓을 칸 종류를 알아내려고 빈 칸 · 시작 무기 칸에도 붙임(2026-10-07)
      if (k === 'weapon') return `<div class="cb-slot full start" data-start="1" data-slot="weapon"><span class="g">⚔</span>${esc(N().t(def.starting_weapon.name_key, '시작 무기'))}</div>`;
      return `<div class="cb-slot" data-slot="${k}">${label}<br><small>비어 있음</small></div>`;
    };
    const freshLeft = [...(ui.freshBag?.[ch.id] ?? [])];
    const bagFresh = ch.bag.map(() => false);
    for (let i = ch.bag.length - 1; i >= 0; i--) { const k = freshLeft.indexOf(ch.bag[i]); if (k >= 0) { freshLeft.splice(k, 1); bagFresh[i] = true; } }
    const bagSlots = Array.from({ length: Math.max(cap, ch.bag.length) }, (_, i) => {
      const id = ch.bag[i];
      if (id == null) return '<div class="cb-bag-slot"></div>';
      if (!canSee || id === '?') return '<div class="cb-bag-slot hidden" data-tip="비공개">🂠</div>';
      const v = cardView(content, N(), id);
      return `<div class="cb-bag-slot full${i >= cap ? ' over' : ''}${bagFresh[i] ? ' fresh' : ''}" data-bag="${i}" style="--band:${v.band}" data-tip="${esc(v.title)}${bagFresh[i] ? ' (새로 얻음)' : ''}">${v.glyph}</div>`;
    }).join('');
    p.innerHTML = `
      <div class="dock-head"><span class="dock-icon" data-tip="${esc(N().charName(ch.char))} · ${ch.owner}">${def.icon ?? ''}</span><b>${N().charName(ch.char)}</b>${actPips(s, ch)}<span class="dock-cell">${ch.cell ? N().cellName(ch.cell) : '쉘터'}${ch.exhausted ? ' · 탈진' : ''}</span></div>
      ${statRow(s, ch)}
      <div class="dock-bar hp"><i style="width:${pct(ch.hp, ch.max_hp)}"></i><span data-tip="체력">${ch.hp}/${ch.max_hp}</span></div>
      <div class="dock-bar st"><i style="width:${pct(ch.stamina, ch.max_stamina)}"></i><span data-tip="스테미너">${ch.stamina}/${ch.max_stamina}</span></div>
      <div class="cb-sec">장비</div><div class="cb-slots">${slot('weapon', '무기')}${slot('armor', '방어구')}${slot('accessory', '액세서리')}</div>
      <div class="cb-sec">가방 ${ch.bag.length}/${cap}</div><div class="cb-bag">${bagSlots}</div>
      <div class="cb-perks">${N().rich(`char.${ch.char}.perk1`, '')}<br>${N().rich(`char.${ch.char}.perk2`, '')}</div>`;
    // 새로 얻은 가방 카드: 마우스를 올리면 표시를 지움
    p.addEventListener('pointerover', (e) => {
      const t = e.target.closest('.cb-bag-slot.fresh');
      if (!t) return;
      t.classList.remove('fresh');
      const id = ch.bag[Number(t.dataset.bag)];
      const list = ui.freshBag?.[ch.id];
      const k = list ? list.indexOf(id) : -1;
      if (k >= 0) list.splice(k, 1);
    });
    // 칸 누르기: 카드 보기(내 차례의 내 가방이면 메뉴)
    p.addEventListener('click', (e) => {
      const t = e.target.closest('[data-card], [data-start], [data-bag]');
      if (t) {
        e.stopPropagation();
        if (t.dataset.bag != null) { const id = ch.bag[Number(t.dataset.bag)]; return interactive && !readonly ? bagItemMenu(s, ch, id) : previewCard(cardView(content, N(), id)); }
        if (t.dataset.card) return interactive && !readonly ? equipMenu(s, ch, t.dataset.slot) : previewCard(cardView(content, N(), t.dataset.card));
        if (t.dataset.start) return previewCard(startWeaponView(def));
      }
      if (e.target.closest('button') || readonly) return;
      if (s.pending?.type === 'placement' && s.pending.player === ch.owner && ch.cell == null) ui.placeSel = ch.id;
      else if (interactive) { ui.selected = ch.id; ui.mode = null; ui.armed = []; } else ui.viewSel = ch.id;
      // 예전에는 여기서 카메라를 그 말로 옮겼는데(2026-10-03 테스터 "내 말을 못 찾겠다"), 카메라는 보드 전체 시점 고정으로 바뀌어 지움(2026-10-17 사용자 결정).
      // 고른 말은 보드 위 강조(화살표 · 빛)로 찾는다
      ctx.refresh();
    });
    // 끌어서 장착 · 해제(2026-10-07 사용자 피드백 오늘 6 — 정비 화면과 같은 조작을 캐릭터 보드에서도):
    //   장비 칸의 카드 → 같은 보드의 아무 곳에 놓기 = 장착 해제 / 가방 카드 → 장비 칸에 놓기 = 장착(교체).
    //   판정은 화면이 따로 하지 않고 엔진 시험 제출(check)로 하고, 안 되면 이유를 알림으로.
    if (interactive && !readonly) {
      let dragging = null;   // { kind: 'equip', slot } | { kind: 'bag', id }
      const clear = () => { dragging = null; p.classList.remove('drop-unequip'); p.querySelectorAll('.cb-slot.drop-ok').forEach((x) => x.classList.remove('drop-ok')); };
      p.querySelectorAll('.cb-slot.full[data-card]').forEach((t) => {
        t.draggable = true;
        t.addEventListener('dragstart', (e) => { dragging = { kind: 'equip', slot: t.dataset.slot }; e.dataTransfer.setData('text/plain', t.dataset.card); e.dataTransfer.effectAllowed = 'move'; });
        t.addEventListener('dragend', clear);
      });
      p.querySelectorAll('.cb-bag-slot.full[data-bag]').forEach((t) => {
        t.draggable = true;
        t.addEventListener('dragstart', (e) => {
          const id = ch.bag[Number(t.dataset.bag)];
          dragging = { kind: 'bag', id };
          e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move';
          const sl = SLOT_OF[content.cards[id]?.kind];
          if (sl) p.querySelectorAll(`.cb-slot[data-slot="${sl}"]`).forEach((x) => x.classList.add('drop-ok'));
        });
        t.addEventListener('dragend', clear);
      });
      p.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); p.classList.toggle('drop-unequip', dragging.kind === 'equip'); } });
      p.addEventListener('dragleave', (e) => { if (!p.contains(e.relatedTarget)) p.classList.remove('drop-unequip'); });
      p.addEventListener('drop', async (e) => {
        e.preventDefault();
        const d = dragging;
        clear();
        if (!d) return;
        const slotEl = e.target.closest('.cb-slot');
        let act;
        if (d.kind === 'equip') { if (slotEl) return; act = { type: 'unequip', character: ch.id, slot: d.slot }; }   // 같은 칸 위에 놓으면 아무 일 없음
        else {
          const want = SLOT_OF[content.cards[d.id]?.kind];
          if (!slotEl) return;
          if (!want || slotEl.dataset.slot !== want) return ctx.toast?.('그 칸에는 놓을 수 없는 종류예요');
          act = { type: 'equip', character: ch.id, item: d.id };
        }
        const r = check(s, content, act);
        if (!r.ok) return ctx.toast?.(N().errorText(r.error));
        ctx.act(act);
      });
    }
    if (!interactive || readonly) return p;
    const extra = el('div', 'dock-extra');
    if (ch.exhausted) {
      const cost = s.config.revive.infirmary_cost_by_chapter[s.game.chapter - 1];
      // 의무실 부활: 기본은 쓰러진 자리에서 바로(2026-10-01). 설정이 '빈 시작 지점'이면 보드에서 칸을 고른다.
      const atStart = s.config.revive.placement === 'empty_start_point';
      const start = ctx.map().cells.find((c) => c.type === 'start' && !Object.values(s.chars).some((x) => x.cell === c.id));
      const trial = atStart ? (start ? { type: 'revive_infirmary', player: ch.owner, character: ch.id, cell: start.id } : null) : { type: 'revive_infirmary', player: ch.owner, character: ch.id };
      const ok = trial ? check(s, content, trial) : { ok: false, error: 'start_point_occupied' };
      // 2026-10-17 사용자 피드백 "죽었을 때 살릴 방법이 안 보인다": 예전엔 흐려진 보드 맨 아래 작은 버튼이라 안 보였다 →
      // 보드 위쪽(이름 바로 아래)에 큰 금색 버튼 + "탈진" 안내(game3d.html .revive-box)
      const b = btn(ok.ok ? `💉 의무실 부활 · ${iconHtml('{coin}')}${cost}~ (쓰러진 자리에서)` : `💉 의무실 부활 — ${N().errorText(ok.error)}`, () => {
        if (atStart) { ui.selected = ch.id; ui.mode = 'revive'; ctx.refresh(); } else ctx.act({ type: 'revive_infirmary', player: ch.owner, character: ch.id });
      }, 'revive-btn');
      b.disabled = !ok.ok;
      extra.append(b);
    } else {
      // 2026-10-18 사용자 피드백 "바로 옆 칸에 있는데 아군이랑 교환을 못 한다 — 교환 버튼이 안 보임": 활성화 방식의 이동은 공격 · 행동 끝 전까지
      // 미리 보기(ui.preview)라 엔진 자리는 그대로여서, 옆으로 옮겨 놓아도 버튼이 안 떴다 → 미리 본 자리 기준으로 찾고, 누르면 이동을 확정한 뒤 교환 창
      const pv = ctx.previewOf?.();
      const cellOf = (c) => (pv && pv.char === c.id ? pv.cell : c.cell);
      const others = Object.values(s.chars).filter((x) => !x.exhausted && isNear(s, content, cellOf(x), cellOf(ch)) && x.id !== ch.id);
      for (const x of others) extra.append(btn(`교환: ${N().charName(x.char)}(${x.owner})`, async () => {
        if (pv && !(await ctx.commitMove?.())) return;
        const s2 = ctx.state();
        if (!isNear(s2, content, s2.chars[x.id].cell, s2.chars[ch.id].cell)) return ctx.toast?.('옆 칸에 있어야 교환할 수 있어요');
        tradeMenu(s2, s2.chars[ch.id], s2.chars[x.id]);
      }));
    }
    if (ch.exhausted && extra.children.length) {   // 쓰러진 캐릭터: 부활 버튼을 이름 아래로(눈에 띄게)
      extra.classList.add('revive-box');
      extra.prepend(el('div', 'revive-note', '탈진 — 이번 챕터 행동 불가. 코인을 내고 부활할 수 있어요.'));
      p.children[0].after(extra);
    } else if (extra.children.length) p.append(extra);
    return p;
  }
  ctx.charBoard = (s, ch, opts) => charBoard(s, ch, opts);
  // 지금 장비 · 특성 기준 실제 능력치(2026-10-04 사용자 피드백 — 직접 계산하지 않게)
  function statRow(s, ch) {
    const c = { s, c: content, map: ctx.map() };
    const w = weaponOf(c, ch);
    const def = defenseOf(c, { kind: 'char', ref: ch });
    const it = (ic, v, tip) => `<span data-tip="${tip}">${iconHtml(`{${ic}}`)}<b>${v}</b></span>`;
    return `<div class="cb-stats">${it('atk', w.attack, '공격력(지금 무기)')}${it('range', rangeOf(c, ch), '사거리')}${it('move', moveOf(c, ch), '이동력(이동 행동 1번)')}${it('def', def, '방어력')}</div>`;
  }
  // 캐릭터마다 행동 n번 규칙: 그 캐릭터의 남은 행동을 주황 점으로(쓴 행동은 빈 점) — 그 플레이어 차례에만
  function actPips(s, ch) {
    if (activationMode(s)) {
      if (s.turn.phase !== 'player_turn' || s.turn.current_player !== ch.owner) return '';
      const a = actOf(s, ch.id);
      if (a.done || ch.exhausted) return '<span class="act-pips" data-tip="이번 차례 행동 끝"><i></i></span>';
      if (cardMode(s)) return '<span class="act-pips" data-tip="이번 차례 행동 중 — 카드로 이동 · 공격, 행동 끝(상호작용)을 하면 끝"><i class="on"></i></span>';   // 카드 운용 버전(2026-10-18)
      return `<span class="act-pips" data-tip="이번 차례: 이동 ${a.move ? '함' : '남음'} · 공격 ${a.attack ? '함' : '남음'}"><i class="on"></i></span>`;   // 2026-10-17: 공격 뒤 이동 가능
    }
    const per = perCharActions(s);
    if (!per || s.turn.phase !== 'player_turn' || s.turn.current_player !== ch.owner) return '';
    const left = ch.exhausted ? 0 : charActionsLeft(s, ch.id);
    return `<span class="act-pips" data-tip="이 캐릭터의 남은 행동 ${left}/${per}">${Array.from({ length: per }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  // 장착한 장비 카드를 누르면: 크게 보기 + 장착 해제(2026-10-03 사용자 결정 C — 시작 무기가 사라진 것처럼 보이던 문제)
  function equipMenu(s, ch, slot) {
    if (isChooserOpen()) return;
    const id = ch.equip[slot];
    if (!id) return;
    const def = content.chars[ch.char];
    const cap = bagCapacity(s, content, ch.id);
    const r = check(s, content, { type: 'unequip', character: ch.id, slot });
    const back = slot === 'weapon' ? `해제하면 시작 무기(${N().t(def.starting_weapon.name_key, '시작 무기')})로 돌아가요. ` : '';
    const cd = content.cards[id];   // 2026-10-07: 선언이 빠져 있어 장비 칸을 누르면 ReferenceError였음(94번 작업 때 생긴 버그) — 고침
    const rNote = cd?.kind === 'research' ? (cd.timing === 'on_attack' ? ' · 공격할 때 공격 창에서 같이 써요' : cd.timing === 'maintenance' ? ' · 정비 때 써요' : '') : cd?.kind === 'survivor' ? ' · 정비 때 시설에 배치해요' : '';
    openChooser({ near: true,
      title: N().cardName(id) + rNote, subtitle: `${N().charName(ch.char)} 장착 중 · ${back}카드는 가방으로 가요(가방 ${ch.bag.length}/${cap}).`,
      items: [{ view: { ...cardView(content, N(), id), tag: '장착 중' }, value: 0, size: 'lg' }], min: 0, max: 0, peek: false,
      hideConfirm: true, onPick: () => {},
      buttons: [r.ok ? { label: '장착 해제', primary: true, onClick: () => ctx.act({ type: 'unequip', character: ch.id, slot }) } : { label: `장착 해제 불가 — ${N().errorText(r.error)}` }, { label: '닫기' }],
    });
  }
  ctx.equipMenu = (s, ch, slot) => equipMenu(s, ch, slot);

  // 카드 크게 보기(읽기 전용). 결정 대기 창이 떠 있으면 가리지 않는다.
  function previewCard(v) {
    if (isChooserOpen()) return;
    openChooser({ near: true, title: v.title, subtitle: '카드 보기', items: [{ view: v, value: 0, disabled: true, size: 'lg' }], min: 0, max: 0, confirmLabel: '닫기', peek: false, onPick: () => {} });
  }
  function startWeaponView(def) {
    const w = def.starting_weapon;
    return { id: def.id, title: N().t(w.name_key, '시작 무기'), band: '#7A6048', glyph: '⚔', kind: `시작 무기 · ${N().nameOf(def)}`, shape: 'tall',
      stats: [{ label: '공격력', value: w.attack, icon: 'atk' }, { label: '사거리', value: w.range, icon: 'range' }],
      desc: '캐릭터 보드에 인쇄된 무기라 카드가 아니에요. 판매 · 약탈 · 교환 · 암시장 제출을 할 수 없고, 무기 카드를 장착하면 덮여요.' };
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function btn(text, fn, cls = '') { const b = el('button', cls, text); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; }

  // ---------- 행동 버튼(오른쪽 아래) ----------
  // 이동 · 공격 · 상호작용은 보드 칸을 눌러서 한다(흰색 · 빨강 · 노랑, game3d.js의 칸 선택). 버튼은 휴식 · 보스 탐색 · 차례 종료 · 내 쉘터.
  // 휴식: 회복(체력 · 스테미너)과 카드 뽑기 중 하나를 고른다(2026-10-02 사용자 결정). 예전 규칙(choice 없음)이면 바로 휴식.
  function restMenu(s, ch) {
    const R = s.config.recovery.rest;
    const cards = armedCards('on_rest');
    if (!R.choice) { ctx.act({ type: 'rest', character: ch.id, cards }); return; }
    const P = s.players[ch.owner];
    const max = s.config.hand.max_per_player;
    const perk = content.chars[ch.char].perks.filter((p) => p.hook === 'on_rest').flatMap((p) => p.effect).filter((b) => b.block === 'rest_bonus');
    const hp = R.hp + perk.reduce((n, b) => n + (b.hp ?? 0), 0), st = R.stamina + perk.reduce((n, b) => n + (b.stamina ?? 0), 0);
    const x = cards.length ? 2 : 1;
    const draw = s.config.hand.rest_draw ?? 1;
    openChooser({
      title: `${N().charName(ch.char)} · 휴식`, subtitle: '회복과 카드 뽑기 중 하나만 할 수 있어요. (행동 1회)',
      items: [
        { view: optionView('회복', `{hp}+${hp * x} · {st}+${st * x}${cards.length ? ' (재생 ×2)' : ''}\n지금 ${ch.hp}/${ch.max_hp} · ${ch.stamina}/${ch.max_stamina}`, { glyph: '❤', band: '#B0573F' }), value: 'heal' },
        { view: optionView('카드 뽑기', `플레이어 카드 ${draw}장\n손패 ${P.hand.length}/${max}${P.hand.length + draw > max ? ' — 넘치면 1장 버려요' : ''}`, { glyph: '🂠', band: '#5F7F9C' }),
          value: 'draw', disabled: cards.length > 0, note: cards.length ? '휴식 카드는 회복할 때만' : null },
      ],
      instant: true, buttons: [{ label: '취소' }],
      onPick: ([mode]) => ctx.act({ type: 'rest', character: ch.id, mode, cards: mode === 'heal' ? cards : [] }),
    });
  }

  function renderActions(s, P, interactive) {
    const ch = s.chars[ui.selected];
    const bar = dom.actions;
    const left = interactive ? s.turn.actions_left : 0;
    const per = perCharActions(s);
    const chLeft = ch && ch.owner === P ? charActionsLeft(s, ch.id) : 0;
    if (activationMode(s)) {
      const a = ch && ch.owner === P ? actOf(s, ch.id) : null;
      bar.append(el('div', `act-left${left === 0 && interactive ? ' zero' : ''}`, a && interactive
        ? cardMode(s)   // 카드 운용 버전(2026-10-18): 횟수 대신 스테미너가 한도
          ? `<span data-tip="이번 차례 남은 캐릭터 ${left}/${turnActions(s, P)} · 카드 1장 = 스테미너 1 이상">${N().charName(ch.char)} ${iconHtml('{st}')}<b>${ch.stamina}</b>/${ch.max_stamina}</span>`
          : `<span data-tip="이번 차례 남은 캐릭터 ${left}/${turnActions(s, P)}">${N().charName(ch.char)} 이동${a.move ? '✓' : '○'} 공격${a.attack ? '✓' : '○'}</span>`
        : `행동할 캐릭터 <b>${left}</b>/${turnActions(s, P)}`));
    } else bar.append(el('div', `act-left${left === 0 && interactive ? ' zero' : ''}`, per && interactive && ch?.owner === P
      ? `${N().charName(ch.char)} 행동 <b>${ch.exhausted ? 0 : chLeft}</b>/${per} <small>· 전체 ${left}/${turnActions(s, P)}</small>`
      : `남은 행동 <b>${left}</b>/${turnActions(s, P)}`));
    const can = interactive && ch && ch.owner === P && !ch.exhausted && chLeft > 0;
    const mk = (mode, label, icon, enabled, onClick) => {
      const b = el('button', `act${ui.mode === mode ? ' on' : ''}`, `<span class="ico">${icon}</span>${label}`);
      b.dataset.mode = mode;
      b.disabled = !enabled;
      b.onclick = onClick ?? (() => { ui.mode = ui.mode === mode ? null : mode; ctx.refresh(); });
      bar.append(b);
    };
    if (activationMode(s)) {
      // 활성화 방식: 휴식 대신 "행동 끝"(미리 본 이동 확정 → 그 칸 상호작용, 못 하면 그냥 끝) — Space · Enter
      const pv = ctx.previewOf?.();
      const at = pv && pv.char === ch?.id ? pv.cell : ch?.cell;
      const pvS = pv && ch ? { ...s, chars: { ...s.chars, [ch.id]: { ...ch, cell: at } } } : s;
      const inter = can && ch ? interactInfo(pvS, content, ch.id) : { ok: false };
      const what = inter.ok ? ` · ${N().t('celltype.' + inter.type, inter.type)}` : '';
      const b = el('button', 'act actend primary', `<span class="ico">✔</span>행동 끝${what}`);
      b.disabled = !can;
      b.dataset.tip = (inter.ok ? `${pv ? '이동을 확정하고 ' : ''}이 칸에서 상호작용한 뒤 이 캐릭터 행동 끝` : `${pv ? '이동을 확정하고 ' : ''}이 캐릭터 행동 끝(이 칸은 상호작용 없음)`) + ' — 단축키 Space';
      b.onclick = () => ctx.endActivation?.(ch.id);
      bar.append(b);
    } else {
      mk('rest', '휴식', '☕', can, () => restMenu(s, ch));
      const R = s.config.recovery.rest;
      bar.lastChild.dataset.tip = R.choice ? `회복(체력 +${R.hp} · 스테미너 +${R.stamina}) 또는 카드 ${s.config.hand.rest_draw ?? 1}장 중 하나 (행동 1회)` : `체력 +${R.hp} · 스테미너 +${R.stamina} · 카드 1장 (행동 1회)`;
    }
    if (s.config.hand.resupply_action === 'fill_to_max') {   // 재정비는 2026-10-01 규칙에서 제거(설정으로만 켬)
      const sup = can ? check(s, content, { type: 'resupply', character: ch.id }) : { ok: false };
      mk('resupply', '재정비', '🂠', sup.ok, () => ctx.act({ type: 'resupply', character: ch.id }));
    }
    const boss = interactive ? bossCandidates(s, P) : [];
    if (boss.length) {
      mk('boss', '보스 탐색', '☠', true, () => bossMenu(s, P, boss));
      // 같은 색 3장(만능 포함)이 모이면 알림 배지(피드백 8)
      if (canSummon(boss)) { bar.lastChild.classList.add('ready'); bar.lastChild.append(el('span', 'badge', '!')); bar.lastChild.dataset.tip = '보스를 부를 수 있어요!'; }
    }
    // 더 할 행동이 없으면(행동을 다 썼거나 움직일 캐릭터가 없음) 깜빡이며 Space · Enter로도 끝낼 수 있음(2026-10-04 사용자 피드백)
    const noMore = s.turn.actions_left <= 0 || !Object.values(s.chars).some((c) => c.owner === P && !c.exhausted && c.cell && charActionsLeft(s, c.id) > 0);
    const end = el('button', `act end primary${interactive && noMore ? ' pulse' : ''}`, interactive && noMore ? '▶ 차례 종료' : '차례 종료');
    end.disabled = !interactive;
    // 행동이 남았는데 끝내려 하면 한 번 묻기(실수 방지 — 2026-10-03 테스터 피드백). 움직일 수 있는 캐릭터가 없으면 바로 끝냄
    // 2026-10-17: 미리 본 이동은 확정하고(ctx.endTurn), 활성화 방식이면 남은 캐릭터가 지금 칸에서 자동으로 행동 끝(상호작용) — 창에 캐릭터별로 무엇을 하는지 보여 줌
    end.onclick = () => {
      const doEnd = () => (ctx.endTurn ? ctx.endTurn(P) : ctx.act({ type: 'end_turn', player: P }));
      const left = s.turn.actions_left;
      const rest = Object.values(s.chars).filter((c) => c.owner === P && !c.exhausted && c.cell && charActionsLeft(s, c.id) > 0);
      if (left <= 0 || !rest.length) return doEnd();
      let subtitle = '그래도 차례를 끝낼까요? 남은 행동은 사라져요.';
      if (activationMode(s)) {
        const pv = ctx.previewOf?.();
        const lines = rest.map((c) => {
          const at = pv && pv.char === c.id ? pv.cell : c.cell;
          const inter = interactInfo({ ...s, chars: { ...s.chars, [c.id]: { ...c, cell: at } } }, content, c.id);
          const what = inter.ok ? `<b>${N().t('celltype.' + inter.type, inter.type)}</b> 상호작용${inter.type === 'supply' ? '(감춰진 보급품)' : ''}` : '상호작용할 것 없음';
          return `${N().charName(c.char)}: ${pv && pv.char === c.id ? '미리 본 칸으로 이동 확정 → ' : ''}${what}`;
        });
        subtitle = `행동 끝을 안 한 캐릭터는 지금 칸에서 자동으로 행동을 끝내요. 공격은 하지 않아요.<br>${lines.join('<br>')}`;
      }
      openChooser({
        title: `행동이 ${left}개 남았어요`, subtitle,
        items: [], instant: true, peek: false,
        buttons: [{ label: '계속하기' }, { label: '차례 종료', primary: true, onClick: doEnd }],
      });
    };
    bar.append(end);
    // Space · Enter 안내 배지(2026-10-18 사용자 요청): game3d.js 키 처리와 같은 순서 — 켜진 "행동 끝" → 아니면 깜빡이는 "차례 종료"
    if (interactive) {
      const keyBtn = bar.querySelector('.act.actend:not(:disabled)') ?? (end.classList.contains('pulse') && !end.disabled ? end : null);
      addKeyHint(keyBtn);   // 버튼 아래에 테두리 없이(2026-10-18 — 행동 바 520px 고정이라 옆에 붙이면 넘침)
    }
    const sh = el('button', `act shbtn${ctx.shelterOpen?.() ? ' on' : ''}`, '🏠 내 쉘터 <kbd>S</kbd>');
    sh.onclick = () => ctx.toggleShelter?.();
    bar.append(sh);
    const hint = interactive ? modeHint(s) : '';
    if (hint) bar.append(el('div', 'act-hint', hint));
    // "?" 범례 버튼: 누르면 칸 색 · 단축키 창을 켜고 끔(다시 그려도 열린 상태 유지)
    // 2026-10-18 처음 보는 플레이어 테스트(사용자 결정 D1): 칸 색 범례를 4라운드에야 봄 → 처음 내 차례에만 자동으로 한 번 열어 둔다
    // (상시 안내 줄은 되살리지 않음 — 2026-10-13 결정 유지. 닫으면 이후엔 "?"로만)
    if (interactive && s.turn.phase === 'player_turn' && !ui.legendAutoShown) { ui.legendAutoShown = true; ui.legend = true; }
    const help = el('button', `act helpbtn${ui.legend ? ' on' : ''}`, '?');
    help.dataset.tip = '칸 색 · 단축키 범례';
    help.onclick = (e) => { e.stopPropagation(); ui.legend = !ui.legend; ctx.refresh(); };
    bar.append(help);
    if (ui.legend) {
      const lg = el('div', `act-legend glass${hint ? ' above-hint' : ''}`, legendBox(s));
      // 2026-10-18 사용자 피드백: 자동으로 뜬 안내에 닫기가 안 보여 "계속 떠 있는 건가?" 싶음 → 오른쪽 위 X(누르면 "?" 꺼짐)
      const x = el('button', 'lg-close', '✕');
      x.dataset.tip = '안내 닫기';
      x.onclick = (e) => { e.stopPropagation(); ui.legend = false; ctx.refresh(); };
      lg.prepend(x);
      bar.append(lg);
    }
    const piles = pileStacks(s, P);
    if (hint) piles.classList.add('above-hint');   // 안내 줄이 있으면 그 위로
    bar.append(piles);
    // 버튼이 많으면(보스 탐색 등) 고정 폭 520을 넘어 오른쪽 "내 쉘터 · ?"가 화면 밖으로 밀리던 것(2026-10-17 포트폴리오 데모 점검)
    // → 넘칠 때만 촘촘하게(단축키 표시 숨김 · 여백 줄임, game3d.html #actions.crowded)
    bar.classList.remove('crowded');
    if (bar.isConnected && bar.scrollWidth > bar.clientWidth + 1) bar.classList.add('crowded');
  }

  function modeHint(s) {
    // 카드 운용 버전(2026-10-18): 고른 카드와 할 일
    if (ui.cardPlay) {
      const cp = ui.cardPlay;
      const what = cp.kind === 'move' ? '흰 칸을 누르면 이동해요' : '빨간 대상을 누르면 공격해요(쓰러진 캐릭터는 약탈)';
      const how = cp.as === 'basic' ? `기본 ${cp.kind === 'move' ? '이동' : '공격'}` : '스킬';
      const sw = !content.cards[cp.card]?.char || cp.as === 'basic' ? ' · 다른 캐릭터 피규어를 누르면 그 캐릭터로' : '';
      return `「${N().cardName(cp.card)}」 ${how} · ${N().charName(s.chars[cp.char]?.char)}: ${what}${sw}. 카드를 다시 누르거나 <kbd>Esc</kbd> 취소`;
    }
    if (ui.mode === 'move') return '빛나는 칸을 누르면 이동해요 (마우스를 올리면 경로 · 이동력 표시). <kbd>Esc</kbd> 취소';
    if (ui.mode === 'attack') return '빛나는 칸의 적 · 캐릭터를 누르면 공격해요. <kbd>Esc</kbd> 취소';
    if (ui.mode === 'revive') return '빈 시작 칸을 누르면 그 자리에 부활해요. <kbd>Esc</kbd> 취소';
    if (ui.mode === 'sandbox') return '테스트 도구: 보드에서 칸을 누르세요. <kbd>Esc</kbd> 취소';
    if (ui.mode === 'cardtarget' && ui.cardTarget) return `빨갛게 빛나는 적을 누르면 「${N().cardName(ui.cardTarget.card)}」을(를) 써요. <kbd>Esc</kbd> 취소`;
    if (ui.mode === 'boss') {   // 2026-10-17: 어느 색 구역인지 + 초록으로 빛나는 칸
      const col = (ui.bossCards ?? []).map((id) => content.cards[id]).find((cd) => cd?.kind === 'investigation' && !cd.wild)?.color;
      const zoneName = { blue: '파랑', yellow: '노랑', red: '빨강' }[col];
      return `${zoneName ? `${zoneName} 테두리 구역에서 ` : ''}초록으로 빛나는 칸을 누르면 보스가 나와요. <kbd>Esc</kbd> 취소`;
    }
    if (ui.mode === 'pickcell') return '소음을 낼 칸을 누르세요(빛나는 칸). <kbd>Esc</kbd> 취소';
    if (ui.mode === 'hitrun') return ui.hitRun?.moveOnly ? '이동할 초록 칸을 누르세요. <kbd>Esc</kbd> 취소' : '이동할 초록 칸(지금 칸도 됨)을 누르고 공격할 대상을 고르세요. <kbd>Esc</kbd> 취소';
    // 평소 칸 색 설명은 상시 띄우지 않고 "?" 버튼(범례)으로(2026-10-13 사용자 피드백) — 장전한 카드만 짧게 알림
    const armed = ui.armed.map((a) => N().cardName(a.card));
    return armed.length ? `장전됨: ${armed.join(', ')}` : '';
  }

  // "?" 범례 창: 칸 색 · 단축키(2026-10-13 — 예전엔 행동 바 위에 늘 떠 있던 안내 줄)
  function legendBox(s) {
    const act = activationMode(s);
    const sw = (c, t) => `<div class="lg-row"><i style="background:${c}"></i>${t}</div>`;
    const key = (k, t) => `<div class="lg-row"><span class="lg-keys">${k.split(' 또는 ').map((x) => `<kbd>${x}</kbd>`).join('또는')}</span>${t}</div>`;   // 키캡(2026-10-18)
    // 2026-10-18: 첫 차례에 자동으로 열리므로(D1) 맨 위에 "내 차례 순서"를 짧게 — 처음 보는 플레이어 테스트 막힘 09(첫 이동 · 공격까지 클릭 12~15번)
    if (cardMode(s)) {   // 카드 운용 버전(2026-10-18)
      return `<div class="lg-h">내 차례 순서 (카드 운용 버전)</div><div class="lg-row">① 손패 카드 누르기 — 전용 카드는 스킬 / 기본 이동 / 기본 공격 중 고르기</div>`
        + `<div class="lg-row">② 보드에서 칸 · 대상 누르기 (카드 1장 = 행동 1번, 스테미너가 한도)</div><div class="lg-row">③ "행동 끝" = 서 있는 칸에서 상호작용하고 그 캐릭터 끝 → 차례 종료</div>`
        + `<div class="lg-row">라운드가 끝나면 스테미너가 가득 차고 손패를 ${s.config.hand.round_end_fill_to ?? 5}장까지 채워요. 차례를 끝낼 때 ${s.config.hand.turn_end_keep ?? 5}장이 넘으면 버려요</div>`
        + `<div class="lg-h">칸 색</div>` + sw('#FFFFFF', '이동(고른 카드)') + sw('#FF4A3A', '공격 · 약탈(고른 카드)') + sw('#FFD23F', '"행동 끝" 때 상호작용') + sw('#2EE6D6', '그래플링으로만 갈 수 있는 칸')
        + `<div class="lg-h">단축키</div>` + key('Space 또는 Enter', '행동 끝 · 창 확인 · 넘기기') + key('Esc', '고른 카드 취소 · 창 닫기') + key('Tab', '보드 보기') + key('T', '위협 지도') + key('S', '내 쉘터') + key('F1', '설명서')
        + `<div class="lg-row lg-foot">이 안내는 오른쪽 아래 <b>?</b> 버튼으로 다시 열고 닫아요</div>`;
    }
    return (act ? `<div class="lg-h">내 차례 순서</div><div class="lg-row">① 캐릭터 고르기(왼쪽 아래 보드나 피규어 누르기)</div>`
      + `<div class="lg-row">② 칸 누르기 — 흰 칸 이동 · 빨간 적은 공격 창 · 손패 카드를 누르면 사용</div><div class="lg-row">③ "행동 끝"(서 있는 칸의 상호작용) → 다른 캐릭터 → 차례 종료</div>` : '')
      + `<div class="lg-h">칸 색</div>`
      + sw('#FFFFFF', act ? '이동해 보기(확정 안 됨 — 공격하거나 행동 끝 때 확정)' : '이동')
      + sw('#FF4A3A', act ? '공격(이동과 함께 확정)' : '공격')
      + sw('#FFD23F', act ? '"행동 끝" 때 상호작용' : '상호작용')
      + sw('#2EE6D6', '그래플링으로만 갈 수 있는 칸')
      + sw('#7FE28A', '치고 빠지기 · 부활 등 카드가 고르라는 칸')
      + `<div class="lg-h">단축키</div>`
      + key('Space 또는 Enter', act ? '행동 끝 · 창 확인 · 넘기기' : '차례 종료 · 창 확인 · 넘기기') + key('Esc', '취소 · 창 닫기') + key('Tab', '보드 보기') + key('T', '위협 지도') + key('S', '내 쉘터') + key('F1', '설명서')
      + `<div class="lg-h">마우스</div><div class="lg-row">칸 · 피규어에 올리면 캐릭터 · 적 · 칸 정보 카드, 이동 칸에 올리면 거기서의 내 사거리, 적에 올리면 그 적의 위협 범위</div>`
      + `<div class="lg-row lg-foot">이 안내는 오른쪽 아래 <b>?</b> 버튼으로 다시 열고 닫아요</div>`;
  }

  // 장전한 카드
  function armedCards(timing) {
    return ui.armed.filter((a) => a.char === ui.selected && content.cards[a.card].timing === timing).map((a) => a.card);
  }
  function armedBonus(block) {
    let n = 0;
    for (const a of ui.armed) if (a.char === ui.selected) for (const b of content.cards[a.card].effect ?? []) if (b.block === block) n += b.amount ?? 0;
    return n;
  }
  ctx.armedCards = armedCards;
  ctx.armedBonus = armedBonus;
  // 카드 운용 버전(2026-10-18): 고른 카드(ui.cardPlay)를 액션 값으로 — 기본 아이콘이면 { basic }, 스킬이면 { cards }
  ctx.cardPay = (kind) => {
    const cp = ui.cardPlay;
    if (!cp || cp.kind !== kind) return {};
    return cp.as === 'basic' ? { basic: cp.card } : { cards: [cp.card] };
  };
  ctx.doInteract = (s, ch, inter) => doInteract(s, ch, inter);
  ctx.lootMenu = (s, ch, x) => lootMenu(s, ch, x);

  // ---------- 손패 ----------
  // 새로 들어온 손패 카드 표시(fresh): 마우스를 한 번 올리면 꺼진다(2026-10-18 사용자 피드백 "멀리건으로 받은 카드의 새 카드 표시가 너무 오래 간다 —
  // 호버 한 번이면 꺼지게"). 예전엔 내가 다음 행동을 할 때까지 유지(game3d.js markFresh). 가방 칸(freshBag)과 같은 방식
  function markFreshHand(e, id) {
    e.classList.add('fresh');
    e.addEventListener('pointerenter', () => {
      e.classList.remove('fresh');
      const list = ui.fresh?.hand;
      const k = list ? list.indexOf(id) : -1;
      if (k >= 0) list.splice(k, 1);
    }, { once: true });
  }
  // selId: 쓸 수 있는지 판단할 캐릭터(내 차례면 고른 캐릭터). 내 차례가 아니면 읽기 전용(누를 수 없음, 회색 처리 없이 보여 줌).
  function renderHand(s, selId, interactive, me) {
    const ch = s.chars[selId] ?? null;
    const owner = ch?.owner ?? me;
    if (!owner || !s.players[owner]) return;
    // 손패는 플레이어 공용(AC-1). 지금 고른 캐릭터 기준으로 쓸 수 있는지 표시(전용 카드는 주인 캐릭터만, 스테미너는 고른 캐릭터)
    // 캐릭터를 안 골랐으면 카드만 보여 주고, 누르면 캐릭터부터 고르라고 안내
    // (예전 ui.hideHandTail — 멀리건 새 카드 확인 창을 누르기 전까지 끝의 n장을 숨김 — 은 2026-10-18 확인 창을 없애며 지움. 새 카드는 손패에서 fresh로 빛남)
    const hand = s.players[owner].hand;
    const n = hand.length;
    if (interactive) {
      // 카드 운용 버전(2026-10-18): 차례 중엔 한도 없음 — 차례 끝에 turn_end_keep장까지
      const cap = s.config.hand.limit_at === 'turn_end' ? `${n}장(차례 끝 ${s.config.hand.turn_end_keep ?? 5}장까지)` : `${n}/${s.config.hand.max_per_player}장`;
      const title = el('div', 'hand-title', `공용 손패 ${cap} · ${ch ? `사용 캐릭터: ${N().charName(ch.char)} (스테미너 ${ch.stamina})` : cardMode(s) ? '카드를 누르면 그 카드를 쓸 캐릭터의 범위가 보여요' : '캐릭터를 먼저 고르세요'}`);
      title.append(sortBar());
      dom.hand.append(title);
    }
    const fan = el('div', 'hand-fan');
    // 손패가 많으면 카드를 더 겹쳐서 폭 안에 맞춘다(카드 폭 168)
    // 2026-10-17: 예전 식은 부채꼴로 기울인 바깥 카드가 차지하는 폭(양쪽 약 45px)과 맨 바깥 여백을 빼먹어서, 1536px 화면에서
    //   손패 5장이 왼쪽 캐릭터 보드 · 오른쪽 행동 바를 90px쯤 덮었다(포트폴리오 데모 점검). 보이는 폭 = n×168 + 2(n-1)×겹침 + 기울기 여유
    const room = dom.hand.clientWidth || 600;
    const tilt = 46;
    const ov = n > 1 ? Math.min(-14, (room - 2 * tilt - 168 * n) / (2 * (n - 1))) : 0;
    fan.style.setProperty('--ov', `${Math.max(-72, ov)}px`);
    // 방금 들어온 카드: 같은 카드가 여럿이면 뒤쪽(나중에 들어온 것)부터 표시
    const freshLeft = [...(ui.fresh?.hand ?? [])];
    const isFresh = hand.map(() => false);
    for (let i = hand.length - 1; i >= 0; i--) { const k = freshLeft.indexOf(hand[i]); if (k >= 0) { freshLeft.splice(k, 1); isFresh[i] = true; } }
    const cm = cardMode(s);
    sortedIdx(hand, ch).forEach((i) => {
      const id = hand[i];
      // 카드 운용 버전(2026-10-18 사용자 결정 "캐릭터를 고를 필요 없이 카드를 고르면 그 캐릭터의 범위"): 전용 카드는 주인 캐릭터,
      // 공용 카드는 고른 캐릭터(없으면 아직 행동 중인 첫 캐릭터) 기준으로 쓸 수 있는지 본다
      if (cm && interactive) {
        const cch = cardChar(s, owner, id);
        const e = cch ? cardModeCard(s, cch, id, i) : renderCard(cardView(content, N(), id), { size: 'md', note: '쓸 캐릭터 없음', disabled: true });
        const pos = fan.children.length;
        const off = pos - (n - 1) / 2;
        e.style.setProperty('--rot', `${off * 5}deg`);
        e.style.setProperty('--lift', `${Math.abs(off) * 6}px`);
        e.classList.add('in-hand');
        if (isFresh[i]) markFreshHand(e, id);
        fan.append(e);
        return;
      }
      if (!ch) {
        const e = renderCard(cardView(content, N(), id), { size: 'md' });
        const pos = fan.children.length;
        const off = pos - (n - 1) / 2;
        e.style.setProperty('--rot', `${off * 5}deg`);
        e.style.setProperty('--lift', `${Math.abs(off) * 6}px`);
        e.classList.add('in-hand');
        if (isFresh[i]) markFreshHand(e, id);
        if (interactive) e.onclick = () => { ctx.toast?.('먼저 카드를 쓸 캐릭터를 고르세요 (캐릭터 보드나 피규어 누르기)'); };
        fan.append(e);
        return;
      }
      const use = cardUse(s, content, ch.id, id);
      const armed = ui.armed.some((a) => a.char === ch.id && a.card === id && a.i === i);
      const usable = interactive && use.implemented && use.ownerOk && use.mode !== 'reaction' && use.affordable && !ch.exhausted;
      // 남의 전용 카드는 회색 띠 대신 살짝 흐리게(주인 이름은 카드에 늘 적혀 있음), 지금 쓸 수 있는 카드는 테두리 빛(2026-10-03 사용자 결정 D)
      const otherOwner = interactive && use.implemented && !use.ownerOk;
      const note = !interactive || otherOwner ? null : !use.implemented ? '미구현' : use.mode === 'reaction' ? '공격받을 때' : !use.affordable ? '스테미너 부족' : use.mode === 'play' ? '' : armed ? '장전됨' : '누르면 장전';
      const e = renderCard(cardView(content, N(), id), { size: 'md', note, disabled: interactive && !usable && !otherOwner });
      if (otherOwner) e.classList.add('other-owner');
      if (usable) e.classList.add('usable');
      const pos = fan.children.length;
      const off = pos - (n - 1) / 2;
      e.style.setProperty('--rot', `${off * 5}deg`);
      e.style.setProperty('--lift', `${Math.abs(off) * 6}px`);
      e.classList.add('in-hand');
      if (armed) e.classList.add('armed');
      if (isFresh[i]) markFreshHand(e, id);
      if (usable) e.onclick = () => handClick(s, ch, id, i, use);
      fan.append(e);
    });
    dom.hand.append(fan);
  }

  // 내 덱 · 버린 카드(· 소실) 더미(2026-10-13 사용자 피드백 — 손패 위 버튼 대신 오른쪽 아래 행동 바 위에, 오른쪽 위 덱 더미처럼 카드 더미 모양).
  // 행동 바 안에 붙여 두어 쉘터 서랍을 열고 닫을 때 바와 같이 움직인다. 누르면 ui/pilepeek.js 창
  function pileStacks(s, owner) {
    const P = s.players[owner];
    const box = el('div', 'my-piles glass');
    const list = [['deck', '덱', P.deck.length, '#5A6A8A', '남은 덱에 어떤 카드가 있는지(순서는 모름)'], ['discard', '버린 카드', P.discard.length, '#6E6A60', '쓰거나 버린 카드(덱이 떨어지면 섞어서 다시 덱으로)']];
    if (P.exiled?.length) list.push(['exiled', '소실', P.exiled.length, '#8C3A30', '쓰고 게임에서 빠진 카드']);
    for (const [tab, label, n, color, tip] of list) {
      const pile = el('div', `tb-pile my-pile${n ? '' : ' empty'}`, `<div class="tb-stack" style="--pc:${color}"><i></i><i></i><i></i></div>${label} <b>${n}</b>`);
      pile.dataset.tip = tip;
      pile.onclick = (e) => { e.stopPropagation(); openPilePeek(ctx, s, owner, tab); };
      box.append(pile);
    }
    return box;
  }

  // 손패 정렬(화면에서만 — 실제 손패 순서는 그대로, 2026-10-04 사용자 피드백): 기본 · 캐릭터 · 스테미너 · 종류
  // 2026-10-18 사용자 요청("손패 정렬 버튼을 드롭 박스로 — 그러면 짧아질 듯"): 버튼 4개(같은 버튼 다시 누르면 오름 ↔ 내림) → 드롭 박스 하나.
  //   111번에서 안내줄을 카드 위로 올린 뒤 버튼 줄이 보드 칸을 덮어(화면 조작 QA 봇 114번) 줄 길이를 줄임. 오름 · 내림은 항목으로 나눔
  //   항목 이름은 짧게(드롭 박스 폭 = 가장 긴 항목 — 길면 안내줄이 두 줄로 접혀 보드를 더 덮음)
  const SORTS = [['none', 1, '받은 순서'], ['char', 1, '내 캐릭터 먼저'], ['char', -1, '공용 먼저'],
    ['stamina', 1, '스테미너 ▲'], ['stamina', -1, '스테미너 ▼'], ['kind', 1, '종류 ▲'], ['kind', -1, '종류 ▼']];
  let handSort = { key: 'none', dir: 1 };
  try { handSort = JSON.parse(localStorage.getItem('eb.handSort')) ?? handSort; } catch { /* 기본값 */ }
  function sortBar() {
    const bar = el('label', 'hand-sort');
    bar.append(el('span', 'hs-label', '정렬'));
    const sel = document.createElement('select');
    sel.className = 'hs-select';
    sel.dataset.tip = '손패를 보기 좋게 정렬(실제 순서는 그대로) · ▲ 낮은 순 · ▼ 높은 순';
    for (const [k, dir, label] of SORTS) {
      const o = new Option(label, `${k}:${dir}`);
      o.selected = handSort.key === k && (k === 'none' || handSort.dir === dir);
      sel.append(o);
    }
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = () => {
      const [key, dir] = sel.value.split(':');
      handSort = { key, dir: Number(dir) };
      try { localStorage.setItem('eb.handSort', JSON.stringify(handSort)); } catch { /* 무시 */ }
      sel.blur();
      ctx.refresh();
    };
    // 드롭 박스에 포커스가 남아 있으면 Space · Enter가 게임(행동 끝 · 차례 종료) 대신 드롭 박스를 연다 → 포커스를 풀고 게임 키로 넘김
    sel.onkeydown = (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault(); e.stopPropagation();
      sel.blur();
      dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code }));
    };
    bar.append(sel);
    return bar;
  }
  function sortedIdx(hand, ch) {
    const idx = hand.map((_, i) => i);
    if (handSort.key === 'none') return idx;
    const cd = (i) => content.cards[hand[i]] ?? {};
    // 캐릭터: 지금 고른 캐릭터 전용 → 다른 캐릭터 전용 → 공용
    const charRank = (i) => (cd(i).char && cd(i).char === ch?.char ? 0 : cd(i).char ? 1 : 2);
    const key = { char: charRank, stamina: (i) => cd(i).stamina ?? 0, kind: (i) => cd(i).kind ?? '' }[handSort.key];
    return idx.sort((a, b) => {
      const x = key(a), y = key(b);
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return c * handSort.dir || a - b;
    });
  }

  // ---------- 카드 운용 버전 손패(2026-10-18 A/B 테스트 B안 — docs/rules-b-cards.md) ----------
  // 카드를 쓸 캐릭터: 전용 카드 = 주인(쓰러졌거나 행동 끝이면 없음), 공용 카드 = 고른 캐릭터 → 아직 행동 중인 첫 캐릭터
  const alive = (s, c) => c && !c.exhausted && c.cell && !actOf(s, c.id).done;
  function cardChar(s, owner, id) {
    const cd = content.cards[id];
    const mine = Object.values(s.chars).filter((c) => c.owner === owner);
    // 전용 카드: 주인이 행동 중이면 주인, 아니면(쓰러짐 · 행동 끝) 다른 캐릭터가 기본 기능으로(2026-10-19)
    if (cd.char) { const c = mine.find((x) => x.char === cd.char); if (alive(s, c)) return c; return mine.find((x) => alive(s, x)) ?? null; }
    const sel = s.chars[ui.cardPlay?.char] ?? s.chars[ui.selected];
    if (sel?.owner === owner && alive(s, sel)) return sel;
    return mine.find((c) => alive(s, c)) ?? null;
  }
  // 이 카드로 지금 할 수 있는 것: 스킬(그 시점 — 언제든 · 이동할 때 · 공격할 때) · 기본 아이콘. 공격받을 때 카드는 적 차례에 반응으로
  // 2026-10-19 사용자 결정: 기본 기능(이동 · 공격)은 전용 카드여도 내 캐릭터 누구나 → 캐릭터마다 선택지. 뽑기는 캐릭터 상관없음(스테미너 0)
  function cardModeUses(s, ch, id) {
    const cd = content.cards[id];
    const out = [];
    if (cd.timing !== 'basic') {
      const owner = cd.char ? Object.values(s.chars).find((c) => c.owner === ch.owner && c.char === cd.char) : ch;
      const ownerOk = owner && alive(s, owner);
      const use = ownerOk ? cardUse(s, content, owner.id, id) : null;
      const skillOk = !!use && use.implemented && use.affordable && ['play', 'move', 'attack'].includes(use.mode);
      out.push({ as: 'skill', kind: use?.mode === 'play' ? null : use?.mode, char: owner?.id, ok: skillOk, cost: cd.stamina,
        why: !ownerOk ? '주인 캐릭터가 행동을 마쳤어요' : use.mode === 'reaction' ? '공격받을 때 써요(적 차례에 반응 카드)' : !use.implemented ? '미구현' : !use.affordable ? '스테미너 부족' : null });
    }
    if (cd.basic === 'draw') {
      const cost = basicStamina(s, 'draw');
      out.push({ as: 'basic', kind: 'draw', char: ch.id, ok: ch.stamina >= cost, cost, why: ch.stamina >= cost ? null : '스테미너 부족' });
    } else if (cd.basic) {
      const cost = basicStamina(s, cd.basic);
      for (const c of Object.values(s.chars).filter((x) => x.owner === ch.owner && alive(s, x))) {
        out.push({ as: 'basic', kind: cd.basic, char: c.id, ok: c.stamina >= cost, cost, why: c.stamina >= cost ? null : `${N().charName(c.char)} 스테미너 부족` });
      }
    }
    return out;
  }
  function cardModeCard(s, ch, id, i) {
    const uses = cardModeUses(s, ch, id);
    const ok = uses.some((u) => u.ok);
    const picked = ui.cardPlay && ui.cardPlay.card === id && ui.cardPlay.i === i;
    const note = picked ? '사용 중' : ok ? '' : uses.find((u) => u.why)?.why ?? '';
    const e = renderCard(cardView(content, N(), id), { size: 'md', note, disabled: !ok });
    if (ok) e.classList.add('usable');
    if (picked) e.classList.add('armed');
    if (ok) e.onclick = () => cardModeClick(s, ch, id, i, uses);
    return e;
  }
  function cardModeClick(s, ch, id, i, uses) {
    if (s.pending && ctx.nudgeDecision?.()) return;
    if (ui.cardPlay && ui.cardPlay.card === id && ui.cardPlay.i === i) { ui.cardPlay = null; ctx.refresh(); return; }   // 다시 누르면 취소
    const cd = content.cards[id];
    const start = (u) => {
      const who = s.chars[u.char] ?? ch;
      if (u.as === 'skill' && !u.kind) { ui.cardPlay = null; ui.selected = who.id; return playNow(s, who, id); }   // 언제든 스킬: 바로 사용(대상 고르기 포함)
      if (u.as === 'basic' && u.kind === 'draw') { ui.cardPlay = null; return ctx.act({ type: 'play_card', character: who.id, card: id, as: 'basic' }); }   // 카드 2장 뽑기(2026-10-19)
      ui.cardPlay = { card: id, i, char: who.id, as: u.as, kind: u.kind };
      ui.selected = who.id; ui.mode = null; ui.armed = [];
      ctx.refresh();
    };
    // 공용 이동 · 공격 카드는 고를 것이 없으니 바로. 전용 카드는 늘 고르는 창(2026-10-18 사용자 결정 "카드 사용할 때는 선택해서 진행")
    if (cd.timing === 'basic') return start(uses[0]);
    // 선택지: 스킬(주인) · 기본 이동/공격(캐릭터마다 — 누가 쓸지 고르는 단계를 한 창에 합침, 2026-10-19) · 카드 2장 뽑기
    const nm = (u) => N().charName(s.chars[u.char]?.char);
    const label = (u) => (u.as === 'skill'
      ? `스킬: ${N().cardName(id)}${u.kind === 'move' ? ' (이동 + 효과)' : u.kind === 'attack' ? ' (공격 + 효과)' : ''}`
      : u.kind === 'move' ? `${nm(u)} 이동` : u.kind === 'attack' ? `${nm(u)} 공격` : '카드 2장 뽑기');
    const desc = (u) => (u.as === 'skill' ? `${nm(u)} · ${iconText(N().t(cd.desc_key, ''))}`
      : u.kind === 'move' ? `카드 효과 없이 ${nm(u)} 이동력만큼 이동` : u.kind === 'attack' ? `카드 효과 없이 ${nm(u)} 무기로 공격(또는 약탈)` : `손패에 카드 ${s.config.card_mode?.basic_draw ?? 2}장(차례 끝에 ${s.config.hand.turn_end_keep ?? 5}장까지 남김)`);
    const stam = (u) => { const c = s.chars[u.char]; return c ? ` (${N().charName(c.char)} ${c.stamina}/${c.max_stamina})` : ''; };
    openChooser({
      near: true, peek: false,
      title: `${N().cardName(id)} · 어떻게 쓸까요?`,
      subtitle: '스킬은 카드 주인만, 이동 · 공격 · 뽑기 아이콘은 내 캐릭터 누구나 쓸 수 있어요.',
      info: [{ view: cardView(content, N(), id) }],
      items: uses.map((u, k) => ({ view: optionView(label(u), `${desc(u)}\n스테미너 ${u.cost}${u.cost ? stam(u) : ''}`, { glyph: u.as === 'skill' ? '✦' : u.kind === 'move' ? '👣' : u.kind === 'attack' ? '⚔' : '🂠', band: u.as === 'skill' ? '#7A6AA8' : u.kind === 'move' ? '#5A7A5A' : u.kind === 'attack' ? '#8C4A3A' : '#5F7F9C' }),
        value: k, disabled: !u.ok, note: u.why })),
      instant: true, buttons: [{ label: '취소' }],
      onPick: ([k]) => start(uses[k]),
    });
  }

  function handClick(s, ch, id, i, use) {
    if (s.pending && ctx.nudgeDecision?.()) return;   // 결정 대기 중(2026-10-18)
    if (use.mode === 'play') return playNow(s, ch, id);
    const k = ui.armed.findIndex((a) => a.char === ch.id && a.card === id && a.i === i);
    if (k >= 0) ui.armed.splice(k, 1);
    else ui.armed.push({ char: ch.id, card: id, i });
    if (use.mode === 'move') ui.mode = 'move';
    if (use.mode === 'attack') ui.mode = 'attack';
    ctx.refresh();
  }

  // "차례 중 언제든" 카드: 바로 사용
  function playNow(s, ch, id) {
    const cd = content.cards[id];
    const eff = cd.effect ?? [];
    if (eff.some((b) => b.block === 'access_storage')) return storageMenu(s, ch, id);
    // ---- 2026-10-08 미구현이던 카드들 ----
    // 사냥꾼 "치고 빠지기": 보드에서 이동할 칸(최대 2칸, 그대로 있어도 됨)을 누르고 → 공격할 대상 고르기(game3d.js startHitRun)
    if (eff.some((b) => b.block === 'move_then_attack' || b.block === 'bonus_move')) return ctx.startHitRun?.(ch.id, id);   // 전력 질주도(2026-10-18)
    // 예언자 "재구성": 버릴 손패 고르기(몇 장이든) → 같은 수만큼 다시 뽑음
    if (eff.some((b) => b.block === 'cycle_hand')) {
      const others = [...s.players[ch.owner].hand];
      others.splice(others.indexOf(id), 1);
      return openChooser({
        title: N().cardName(id), subtitle: '버릴 손패를 고르세요. 버린 수만큼 덱에서 다시 뽑아요(0장도 가능).',
        items: others.map((x, i) => ({ view: cardView(content, N(), x), value: i })), min: 0, max: others.length, confirmLabel: '버리고 다시 뽑기',
        buttons: [{ label: '취소' }],
        onPick: (idx) => ctx.act({ type: 'play_card', character: ch.id, card: id, choice: idx.map((i) => others[i]) }),
      });
    }
    // 예언자 "통찰": 손패를 들여다볼 다른 플레이어 고르기(결과는 나에게만 카드로 뜸 — game3d.js card_peeked)
    if (eff.some((b) => b.block === 'peek_player_card')) {
      const list = s.game.turn_order.filter((p) => p !== ch.owner);
      return openChooser({
        title: N().cardName(id), subtitle: '손패를 들여다볼 플레이어를 고르세요. 그 플레이어 손패에서 무작위 1장을 나만 봐요.',
        items: list.map((p) => ({ view: optionView(p, `손패 ${s.players[p].hand.length}장`, { glyph: '👁', band: PLAYER_COLORS[p] }), value: p, disabled: !s.players[p].hand.length })),
        buttons: [{ label: '취소' }],
        onPick: ([p]) => ctx.act({ type: 'play_card', character: ch.id, card: id, choice: p }),
      });
    }
    // 수호자 "집결": 사거리 2 안의 내 다른 캐릭터를 내 칸(옆)으로
    const pull = eff.find((b) => b.block === 'pull_ally');
    if (pull) {
      const list = Object.values(s.chars).filter((x) => x.owner === ch.owner && x.id !== ch.id && !x.exhausted && x.cell);
      return openChooser({
        title: N().cardName(id), subtitle: `불러올 내 캐릭터를 고르세요(${pull.range ?? 2}칸 안, 이동력 소모 없음).`,
        items: list.map((x) => { const r = check(s, content, { type: 'play_card', character: ch.id, card: id, target: x.id }); return { view: portraitView(content, N(), x, PLAYER_COLORS[x.owner]), value: x.id, disabled: !r.ok, note: r.ok ? null : N().errorText(r.error) }; }),
        buttons: [{ label: '취소' }],
        onPick: ([t]) => ctx.act({ type: 'play_card', character: ch.id, card: id, target: t }),
      });
    }
    // 내 캐릭터 하나(거리 상관없음 — 카드 운용 버전 격려 · 생명 연결, 2026-10-19)
    if (eff.some((b) => b.target === 'my_char')) {
      const list = Object.values(s.chars).filter((x) => x.owner === ch.owner && !x.exhausted && x.cell != null);
      return openChooser({
        title: N().cardName(id), subtitle: '대상 내 캐릭터를 고르세요(거리 상관없음).',
        items: list.map((x) => ({ view: portraitView(content, N(), x, PLAYER_COLORS[x.owner]), value: x.id, note: `${x.hp}/${x.max_hp} · ${x.stamina}/${x.max_stamina}` })),
        buttons: [{ label: '취소' }],
        onPick: ([t]) => ctx.act({ type: 'play_card', character: ch.id, card: id, target: t }),
      });
    }
    const ally = eff.find((b) => b.target === 'same_cell_ally');
    const enemy = eff.find((b) => b.target === 'chosen_enemy');
    // 브로커 '자산 정리': 팔 카드 고르기 / '뇌물': 가져갈 드러난 보급품 고르기(2026-10-03)
    if (eff.some((b) => b.block === 'sell_now')) {
      const list = [...new Set(ch.bag)].filter((x) => x !== 'part' && content.cards[x]?.sell != null);
      if (!list.length) return ctx.toast?.('팔 수 있는 가방 카드가 없어요');
      return openChooser({
        title: N().cardName(id), subtitle: '지금 팔 가방 카드를 고르세요(판매가만큼 코인, 브로커 +1).',
        items: list.map((x) => ({ view: cardView(content, N(), x), value: x, note: `판매 ${content.cards[x].sell}` })),
        buttons: [{ label: '취소' }],
        onPick: ([x]) => ctx.act({ type: 'play_card', character: ch.id, card: id, choice: x }),
      });
    }
    if (eff.some((b) => b.block === 'take_open_supply')) {
      const items = s.board.open_supply.map((x, i) => (x ? { view: cardView(content, N(), x), value: i } : null)).filter(Boolean);
      if (!items.length) return ctx.toast?.('드러난 보급품 카드가 없어요');
      return openChooser({
        title: N().cardName(id), subtitle: '가져갈 드러난 보급품 카드를 고르세요.', items, buttons: [{ label: '취소' }],
        onPick: ([i]) => ctx.act({ type: 'play_card', character: ch.id, card: id, choice: i }),
      });
    }
    if (ally) {
      // 미리 본 이동이 있으면 먼저 확정하고 그 자리 기준으로 옆 아군(2026-10-18 — 교환 버튼과 같은 문제)
      if (ctx.previewOf?.()?.char === ch.id) { ctx.commitMove?.().then((ok) => { if (ok) { const s2 = ctx.state(); playNow(s2, s2.chars[ch.id], id); } }); return; }
      const list = Object.values(s.chars).filter((x) => x.owner === ch.owner && isNear(s, content, x.cell, ch.cell) && !x.exhausted && (ally.block === 'heal' || x.id !== ch.id));
      return openChooser({
        title: N().cardName(id), subtitle: '대상 아군을 고르세요(같은 칸).',
        items: list.map((x) => ({ view: portraitView(content, N(), x, PLAYER_COLORS[x.owner]), value: x.id })),
        buttons: [{ label: '취소' }],
        onPick: ([t]) => ctx.act({ type: 'play_card', character: ch.id, card: id, target: t }),
      });
    }
    // 대상 적 고르기(약점 파악 등): 보드에서 직접 누른다(2026-10-17 사용자 피드백 "딤드 때문에 대상 적을 못 고른다" —
    // 예전엔 미리 본 이동 전 자리 기준으로 사거리를 계산해 목록이 비기도 했고, 고르는 창이 보드를 덮었다). 아래 창 방식은 보드 고르기가 없을 때만
    if (enemy && ctx.pickCardTarget) return ctx.pickCardTarget(ch.id, id);
    if (enemy) {
      const list = attackTargets(s, content, ch.id).filter((t) => t.kind === 'foe');
      const foe = (fid) => s.enemies[fid] ?? s.bosses[fid];
      return openChooser({
        title: N().cardName(id), subtitle: '대상 적을 고르세요(사거리 안).',
        items: list.map((t) => ({ view: foeView(content, N(), foe(t.id), s.game.chapter, s.bosses[t.id] ? null : ctx.map().enemy_mods), value: t.id, note: `거리 ${t.distance}` })),
        buttons: [{ label: '취소' }],
        onPick: ([t]) => ctx.act({ type: 'play_card', character: ch.id, card: id, target: t }),
      });
    }
    // 2026-10-18 처음 보는 플레이어 테스트: 회복 카드(숨 고르기)를 누르자마자 쓰여서 체력 · 스테미너가 가득한 캐릭터에게 낭비 →
    // 효과가 하나도 없을 때만 한 번 묻는다(구원자는 특전으로 다른 캐릭터를 회복할 수 있어 묻지 않음)
    const selfHeal = eff.length && eff.every((b) => (b.block === 'heal' || b.block === 'restore_stamina') && !b.target);
    const savior = content.chars[ch.char]?.perks?.some((p) => p.effect?.some((b) => b.block === 'card_bonus_recover'));
    if (selfHeal && !savior && ch.hp >= ch.max_hp && ch.stamina >= ch.max_stamina) {
      return openChooser({
        title: N().cardName(id), subtitle: `${N().charName(ch.char)}는 체력 · 스테미너가 이미 가득이라 이 카드를 써도 효과가 없어요. 그래도 쓸까요?`,
        items: [], instant: true, peek: false,
        buttons: [{ label: '취소', primary: true }, { label: '그래도 쓰기', onClick: () => ctx.act({ type: 'play_card', character: ch.id, card: id }) }],
      });
    }
    ctx.act({ type: 'play_card', character: ch.id, card: id });
  }

  // 짐꾼 '짐 정리': 창고 ↔ 가방
  function storageMenu(s, ch, id) {
    const storage = s.shelter[ch.owner].storage;
    openChooser({
      title: `${N().cardName(id)} · 1/2 창고로 보낼 가방 카드`, subtitle: '고르지 않아도 돼요.',
      items: ch.bag.map((b, i) => ({ view: cardView(content, N(), b), value: i })), min: 0, max: ch.bag.length, confirmLabel: '다음',
      buttons: [{ label: '취소' }],
      onPick: (storeIdx) => openChooser({
        title: `${N().cardName(id)} · 2/2 가방으로 가져올 창고 카드`, subtitle: '고르지 않아도 돼요.',
        items: storage.map((b, i) => ({ view: cardView(content, N(), b), value: i })), min: 0, max: storage.length, confirmLabel: '교환',
        buttons: [{ label: '취소' }],
        onPick: (retIdx) => ctx.act({ type: 'play_card', character: ch.id, card: id, store: storeIdx.map((i) => ch.bag[i]), retrieve: retIdx.map((i) => storage[i]) }),
      }),
    });
  }

  // ---------- 상호작용 ----------
  function doInteract(s, ch, inter) {
    if (inter.type === 'supply' && (inter.open ?? []).some(Boolean)) {
      const items = [{ view: optionView(`감춰진 보급품 ${inter.amount ?? 1}장`, '덱 맨 위에서 뽑아요. 함정 · 크롤러가 나올 수 있어요.', { glyph: '?', band: '#6A5A48' }), value: 'hidden' }];
      inter.open.forEach((id, slot) => { if (id) items.push({ view: cardView(content, N(), id), value: { open: slot }, note: '드러난 카드 1장' }); });
      return openChooser({
        title: '보급품 · 무엇을 가져갈까요?', subtitle: '드러난 카드를 가져가면 그 자리는 덱에서 새로 채워져요.',
        items, buttons: [{ label: '취소' }],
        onPick: ([v]) => ctx.act({ type: 'interact', character: ch.id, option: v }),
      });
    }
    ctx.act({ type: 'interact', character: ch.id });
  }

  // ---------- 연구 카드(쉘터 보관함) ----------
  // 2026-10-08 AF-1: 연구 카드는 가방 슬롯을 차지하지 않고 얻는 즉시 쉘터 연구 보관함에 쌓인다. 여기서 보고, 지금 고른 캐릭터로 쓴다.
  //  - "언제든" 카드는 이 창에서 바로 사용, "공격할 때"는 공격 창에서 같이, "정비 때"는 정비 화면에서 쓴다.
  function researchMenu(s, p, interactive) {
    if (isChooserOpen()) return;
    const sh = s.shelter[p];
    const ch = interactive ? s.chars[ui.selected] : null;
    const items = sh.research.map((id) => {
      const cd = content.cards[id];
      const lab = s.shelter[p].facilities?.f_lab ?? 0;
      const note = (cd.lab_level ?? 0) > lab ? `연구실 Lv${cd.lab_level} 필요(지금 Lv${lab})`   // 2026-10-18 연구실 레벨 조건
        : cd.timing === 'on_attack' ? '공격할 때 공격 창에서' : cd.timing === 'maintenance' ? '정비 때 정비 화면에서' : !interactive ? '내 차례에' : !ch ? '캐릭터를 먼저 고르세요' : null;
      return { view: cardView(content, N(), id), value: id, disabled: !!note, note };
    });
    openChooser({
      title: `${p} · 연구 카드 ${sh.research.length}장`, subtitle: '쉘터 연구 보관함이에요 — 가방 슬롯을 차지하지 않고, 약탈 · 탈진으로 잃지 않아요. 쓸 카드를 고르면 지금 고른 캐릭터가 써요.',
      // 2026-10-18 화면 조작 QA: 예전엔 min 0이라 카드를 안 고르고 "사용"을 누르면 아무 일 없이 닫혔다 → 쓸 수 있는 카드가 있으면 1장 골라야 켜짐, 닫기는 따로
      items, min: items.some((x) => !x.disabled) ? 1 : 0, max: 1, confirmLabel: '사용', peek: false, emptyText: '아직 연구 카드가 없어요(연구소 칸에서 얻어요). 쓰려면 쉘터 연구실 레벨이 필요해요',
      buttons: [{ label: '닫기' }],
      onPick: ([id]) => { if (id && ch) useItem(s, ch, id); },
    });
  }

  // ---------- 가방 카드 ----------
  // 가방 카드 메뉴(2026-10-04 사용자 피드백): 카드 + 아래 버튼(장착 · 교체 / 사용 / 버리기 / 닫기).
  // 같은 칸에 장착 중인 장비가 있으면 그 카드를 "장착 중" 표시와 함께 옆에 보여 주고 버튼은 "교체"
  const SLOT_OF = { weapon: 'weapon', armor: 'armor', accessory: 'accessory' };
  function bagItemMenu(s, ch, id) {
    if (s.pending && ctx.nudgeDecision?.()) return;   // 결정 대기 중(2026-10-18)
    if (s.turn.phase !== 'player_turn' || s.turn.current_player !== ch.owner || ch.exhausted) return;
    const cd = content.cards[id];
    const slot = SLOT_OF[cd?.kind];
    const worn = slot ? ch.equip?.[slot] : null;
    const items = [];
    if (worn) items.push({ view: { ...cardView(content, N(), worn), tag: '장착 중' }, value: null, size: 'lg' });
    items.push({ view: cardView(content, N(), id), value: null, size: 'lg' });
    const buttons = [];
    if (slot) buttons.push({ label: worn ? '교체' : '장착', primary: true, onClick: () => ctx.act({ type: 'equip', character: ch.id, item: id }) });
    const ist = itemStamina(s, cd);   // 카드 운용 버전: 내 차례에 아이템을 쓰면 스테미너(2026-10-18)
    const useLabel = ist ? `사용 (스테미너 ${ist})` : '사용';
    if (cd?.kind === 'consumable' && !(cd.effect ?? []).every((b) => b.block === 'reduce_damage')) buttons.push({ label: useLabel, primary: true, onClick: () => useItem(s, ch, id) });
    // 연구 카드(2026-10-07): 언제든 · 칸 고르기(소음)는 여기서, 공격할 때는 공격 창에서, 정비 때만 쓰는 카드는 정비 화면에서
    if (cd?.kind === 'research' && cd.timing === 'anytime') buttons.push({ label: useLabel, primary: true, onClick: () => useItem(s, ch, id) });
    buttons.push({ label: '닫기' });
    buttons.push({ label: '버리기', onClick: () => ctx.act({ type: 'discard_item', character: ch.id, item: id }) });
    openChooser({ near: true,
      title: N().cardName(id),
      subtitle: `${N().charName(ch.char)}의 가방 · 행동을 쓰지 않아요${worn ? ' · 교체하면 장착 중인 카드는 가방으로' : ''} (판매는 정비 때)`,
      items, min: 0, max: 0, hideConfirm: true, peek: false, onPick: () => {}, buttons,
    });
  }

  function useItem(s, ch, id) {
    if (s.pending && ctx.nudgeDecision?.()) return;   // 결정 대기 중(2026-10-18 화염병 피드백 — 예전엔 아래 대상 판정이 전부 거절돼 "거리 밖"으로 잘못 안내)
    const cd = content.cards[id];
    // 대상 · 칸을 고르는 아이템은 미리 본 이동을 먼저 확정하고 그 자리 기준으로(2026-10-18 — 교환 버튼과 같은 문제: 미리 본 자리 옆 아군이 거리 밖으로 나옴)
    const placed = (cd.effect ?? []).some((b) => b.at === 'chosen_cell' || b.block === 'revive' || b.block === 'deal_damage');
    if (placed && ctx.previewOf?.()?.char === ch.id) { ctx.commitMove?.().then((ok) => { if (ok) { const s2 = ctx.state(); useItem(s2, s2.chars[ch.id], id); } }); return; }
    // 칸을 고르는 카드(페로몬 소음): 보드에서 칸을 누르게(ui.mode = 'pickcell')
    const pick = (cd.effect ?? []).find((b) => b.at === 'chosen_cell');
    if (pick) { ui.selected = ch.id; ui.mode = 'pickcell'; ui.pickItem = { id, range: pick.range ?? 3 }; ctx.refresh(); ctx.toast?.(`${N().cardName(id)}: 소음을 낼 칸을 누르세요(${pick.range ?? 3}칸 안, <kbd>Esc</kbd> 취소)`); return; }
    const needs = (cd.effect ?? []).find((b) => b.block === 'revive' || b.block === 'deal_damage');
    if (!needs) return ctx.act({ type: 'use_item', character: ch.id, item: id });
    let items;
    if (needs.block === 'revive') {
      items = Object.values(s.chars).filter((x) => x.exhausted && x.cell).map((x) => ({ view: portraitView(content, N(), x, PLAYER_COLORS[x.owner]), value: x.id }));
    } else {
      items = [...Object.values(s.enemies), ...Object.values(s.bosses)].map((f) => ({ view: foeView(content, N(), f, s.game.chapter, s.bosses[f.uid] ? null : ctx.map().enemy_mods), value: f.uid }));
      // 다른 플레이어의 캐릭터도 대상(2026-10-18 — 칸 전체 피해 아이템은 적만, 엔진 use_item과 같은 규칙)
      if (needs.target !== 'all_enemies_in_cell') for (const x of Object.values(s.chars)) if (x.owner !== ch.owner && !x.exhausted && x.cell) items.push({ view: portraitView(content, N(), x, PLAYER_COLORS[x.owner]), value: x.id });
    }
    // 2026-10-18: 거리 밖 대상은 미리 꺼 두고 이유 표시(예전엔 다 켜 두고 고르면 엔진이 거절 — 응급 부활 키트 피드백 때 같이 정리)
    for (const it of items) {
      const r = check(s, content, { type: 'use_item', character: ch.id, item: id, target: it.value });
      if (!r.ok) { it.disabled = true; it.note = r.error === 'out_of_range' ? `거리 ${content.cards[id].range ?? 0} 밖` : N().errorText(r.error); }
    }
    // 이유는 실제 거절 이유로(2026-10-18 — 예전엔 대상이 있으면 무조건 "거리 밖"이라고 해서 반응 대기 등 다른 이유를 가렸다)
    if (!items.some((it) => !it.disabled)) { ctx.toast?.(`${N().cardName(id)}: 쓸 수 있는 대상이 없어요${items.length ? ` (${items[0].note})` : ''}`); return; }
    openChooser({
      title: N().cardName(id), subtitle: `대상을 고르세요${content.cards[id].range != null ? ` (거리 ${content.cards[id].range} 이내)` : ''}.`,
      items, buttons: [{ label: '취소' }],
      onPick: ([t]) => ctx.act({ type: 'use_item', character: ch.id, item: id, target: t }),
    });
  }

  function lootMenu(s, ch, x) {
    openChooser({
      title: `약탈 · ${N().charName(x.char)}의 가방`, subtitle: `가져올 카드를 고르세요(행동 1회). 내 가방 ${ch.bag.length}장 — 넘치면 가져온 뒤에 남길 카드를 고르고, 가져온 카드를 안 남기면 원래 가방으로 돌아가요.`,
      items: x.bag.map((b, i) => ({ view: cardView(content, N(), b), value: i })), min: 1, max: x.bag.length, confirmLabel: '가져오기',
      buttons: [{ label: '취소' }],
      onPick: (idx) => ctx.act({ type: 'loot', character: ch.id, target: x.id, take: idx.map((i) => x.bag[i]), ...ctx.cardPay('attack') }),   // 카드 운용 버전: 공격 카드(2026-10-18)
    });
  }

  function tradeMenu(s, ch, x) {
    openChooser({
      title: `교환 1/2 · 줄 카드`, subtitle: `${N().charName(ch.char)} → ${N().charName(x.char)}(${x.owner})`,
      items: ch.bag.map((b, i) => ({ view: cardView(content, N(), b), value: i })), min: 0, max: ch.bag.length, confirmLabel: '다음',
      buttons: [{ label: '취소' }],
      onPick: (give) => openChooser({
        title: `교환 2/2 · 받을 카드`, subtitle: '상대 플레이어가 동의해야 성립해요.',
        items: x.bag.map((b, i) => ({ view: cardView(content, N(), b), value: i })), min: 0, max: x.bag.length, confirmLabel: '제안',
        buttons: [{ label: '취소' }],
        onPick: (take) => ctx.act({ type: 'trade', from: ch.id, to: x.id, give: give.map((i) => ch.bag[i]), take: take.map((i) => x.bag[i]) }),
      }),
    });
  }

  // ---------- 보스 탐색 ----------
  // 가방 + 쉘터 창고(2026-10-18 사용자 결정 — 창고의 조사 카드도 보스 탐색에 쓸 수 있음, 엔진 spawn_boss와 같은 순서: 가방 먼저)
  function bossCandidates(s, P) {
    const isInv = (id) => content.cards[id]?.kind === 'investigation' || content.cards[id]?.passive?.some((b) => b.block === 'wild_investigation');
    return [...Object.values(s.chars).filter((c) => c.owner === P).flatMap((c) => c.bag.map((id) => ({ c, id }))),
      ...(s.shelter[P]?.storage ?? []).map((id) => ({ c: null, id, store: true }))].filter(({ id }) => isInv(id));
  }
  // 조사 카드로 보스를 부를 수 있는가: 어느 한 색이 (그 색 카드 + 만능) 3장 이상
  function canSummon(list) {
    let wild = 0;
    const by = {};
    for (const { id } of list) {
      const cd = content.cards[id];
      if (cd?.wild || cd?.passive?.some((b) => b.block === 'wild_investigation')) wild++;
      else if (cd?.color) by[cd.color] = (by[cd.color] ?? 0) + 1;
    }
    return Object.values(by).some((n) => n + wild >= 3) || wild >= 3;
  }
  function bossMenu(s, P, list) {
    openChooser({
      title: '보스 탐색 · 조사 카드 3장', subtitle: '같은 색 3장(만능 · 보스 위치 정보는 아무 색). 다 고르면 보드에서 그 색 구역 칸을 누르세요.',
      items: list.map((x, i) => ({ view: { ...cardView(content, N(), x.id), ...(x.store ? { tag: '창고' } : {}) }, value: i })), min: 3, max: 3, confirmLabel: '구역 고르기',   // 창고 카드 표시(2026-10-18)
      buttons: [{ label: '취소' }],
      onPick: (idx) => { ui.mode = 'boss'; ui.bossCards = idx.map((i) => list[i].id); ctx.refresh(); },
    });
  }

  return { render };
}
