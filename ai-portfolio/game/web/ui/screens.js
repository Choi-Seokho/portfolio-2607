// 정비 · 암시장 화면 (화면 중앙 카드 판)
// 정비: 선 플레이어부터 한 명씩 순서대로(핫싯 가리개로 남의 가방을 못 보게) → 시설 카드(업그레이드) · 가방/창고 카드(판매 · 보관 · 꺼내기) · 생존자 배치 → 정비 종료
//   (규칙상 정비는 순서 없이 동시 진행이지만, 화면이 하나뿐인 핫싯에서는 한 사람씩 진행한다 — config.json hotseat.maintenance 참조)
// 암시장: 공개된 카드를 크게 늘어놓고, 카드 아래 캐릭터 칩을 눌러 올려 둔 뒤 정산(칩은 공개 정보라 순서 제한 없음)
import { renderCard, cardView, facilityView, optionView } from './cards.js';
import { openChooser } from './chooser.js';
import { PLAYER_COLORS } from '../board3d/pieces.js';
import { check, bagCapacity, bmPrice } from '../../engine/index.js';
import { iconHtml } from './icons.js';
import { createMaintTable } from './maint.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function createScreens(ctx, root) {
  const { content } = ctx;
  const N = () => ctx.names;
  const maint = createMaintTable(ctx);

  let lastKey = null;
  function render() {
    const s = ctx.state();
    // 다시 그려도 스크롤 위치 유지(같은 화면 · 같은 플레이어일 때) — 시설을 올리면 맨 위로 튀던 문제(2026-10-03 테스터 피드백)
    const key = s ? `${s.turn.phase}|${ctx.actor ?? ''}|${s.game.chapter}` : null;
    const scrolls = key === lastKey ? [...root.querySelectorAll('.mt-box, .screen-box')].map((e) => e.scrollTop) : [];
    lastKey = key;
    root.innerHTML = '';
    root.classList.remove('maint');
    // 정비는 지금 차례인 "사람"이 있을 때만(AI 정비는 화면 없이 바로 끝남), 암시장은 사람이 있을 때만(AI끼리면 자동)
    // 암시장에서 산 카드 정리(챕터 준비 전, 산 사람 좌석마다 한 번 — 2026-10-04 신규 8)
    const arrangeP = s?.turn.phase === 'chapter_prep' && !s.pending ? ctx.ui.arrangeQueue?.[0] : null;
    const show = s && !s.pending && (s.game.over || arrangeP || (s.turn.phase === 'maintenance' && ctx.actor) || (s.turn.phase === 'black_market' && !ctx.spectating()));
    root.classList.toggle('hidden', !show);
    if (!show) return;
    if (s.game.over) renderResult(s);
    else if (arrangeP) {
      root.classList.add('maint');
      maint.render(root, s, arrangeP, { mode: 'arrange', fresh: ctx.ui.bmFresh?.[arrangeP] ?? [], onDone: () => { ctx.ui.arrangeQueue.shift(); ctx.refresh(); } });
    }
    else if (s.turn.phase === 'maintenance') renderMaintenance(s);
    else renderMarket(s);
    [...root.querySelectorAll('.mt-box, .screen-box')].forEach((e, i) => { if (scrolls[i]) e.scrollTop = scrolls[i]; });
  }

  // ---------- 게임 결과 ----------
  // 순위 · 점수는 엔진이 state.game.ranking/scores에 남긴 값을 그대로 보여 준다(화면에서 다시 계산하지 않음).
  function renderResult(s) {
    const box = el('div', 'screen-box result');
    box.append(el('div', 'screen-title', '게임 종료'));
    // 2026-10-18 처음 보는 플레이어 테스트: 예전 문구 "점수 = 승점 + 코인"이 실제 계산(코인 2개당 1점)과 달라 점수가 틀린 줄 알았음 → 환산을 그대로 보여 줌
    const cv = s.config.scoring?.coin_value ?? 1;
    const per = cv > 0 && cv < 1 ? Math.round(1 / cv) : 1;
    box.append(el('div', 'screen-sub', `점수 = 승점 + 코인${per > 1 ? ` ${per}개당 1점(나머지 버림)` : ''}. 동점이면 보스 처치 → 완료 미션 → 코인 순.`));
    const row = el('div', 'screen-row');
    (s.game.ranking ?? []).forEach((p, i) => {
      const pl = s.players[p];
      const view = optionView(`${i + 1}위 · ${p}${ctx.seatTag?.(p) ?? ''}`, `승점 ${pl.vp} + 코인 ${pl.coins}개(→ ${Math.floor(pl.coins * cv)}점)\n보스 처치 ${pl.bosses_killed.length} · 완료 미션 ${pl.missions.completed.length}`,
        { glyph: i === 0 ? '♛' : String(i + 1), band: PLAYER_COLORS[p], kind: Object.values(s.chars).filter((c) => c.owner === p).map((c) => N().charName(c.char)).join(' · ') });
      view.cost = { value: s.game.scores?.[p] ?? '?', type: 'vp' };
      const card = renderCard(view, { size: i === 0 ? 'lg' : 'md' });
      card.classList.add('deal');
      card.style.animationDelay = `${i * 120}ms`;
      row.append(card);
    });
    box.append(row);
    const again = el('button', 'big primary', '새 게임');
    again.onclick = () => location.reload();
    box.append(again);
    root.append(box);
  }

  // ---------- 정비: 드래그 앤 드롭 테이블(F2f, ui/maint.js) ----------
  // 선 플레이어부터 한 명씩(핫싯 가리개로 남의 가방을 못 보게). 판정 · 실행은 엔진 액션.
  function renderMaintenance(s) {
    root.classList.add('maint');
    maint.render(root, s, ctx.actor);
  }

  // ---------- 암시장 (플레이어 단위, AC-2) ----------
  // 플레이어마다 카드 1장: 카드를 눌러 고르고(다시 누르면 취소, 다른 카드를 누르면 옮김), 받을 곳(캐릭터 가방 · 창고)을 고른다.
  // 칩은 공개 정보라 순서 없이 사람 좌석 모두가 고를 수 있다. AI 좌석은 국면이 열리면 스스로 고른다.
  function renderMarket(s) {
    const box = el('div', 'screen-box bm-box');
    box.append(el('div', 'screen-title', '암시장'));
    box.append(el('div', 'screen-sub', '플레이어마다 카드 1장 — <b>카드를 눌러 고르고</b>, 다시 누르면 취소. 혼자 고른 카드는 코인으로 사고, 여럿이 고르면 가방 · 창고의 카드를 몰래 내서 판매가가 높은 쪽이 가져가요. 산 카드는 창고로 들어오고, 정산 뒤 정리 화면에서 옮겨요. 모두 고르면 "암시장 정산".'));
    const humans = s.game.turn_order.filter((p) => ctx.isHuman(p));
    const solo = humans.length === 1 ? humans[0] : null;       // 사람이 1명이면 카드를 눌러 바로 고른다
    const choiceOf = (p) => Object.entries(s.board.bm_place).find(([, l]) => l.includes(p))?.[0] ?? null;
    const place = (p, card) => ctx.act({ type: 'bm_place', player: p, card });
    // 사람 좌석마다 코인(받을 곳은 산 뒤에 정리 화면에서 정함 — 2026-10-04 신규 8)
    const destRow = el('div', 'bm-dests');
    for (const p of humans) destRow.append(el('div', 'bm-dest', `<span class="dot" style="background:${PLAYER_COLORS[p]}"></span><b>${p}</b> ${iconHtml('{coin}')}${s.players[p].coins}${choiceOf(p) ? ` · 고른 카드: ${N().cardName(choiceOf(p))}` : ''}`));
    box.append(destRow);
    const row = el('div', 'screen-row bm-row');
    for (const id of s.board.black_market) {
      const on = s.board.bm_place[id] ?? [];
      const wrap = el('div', 'screen-card bm-card');
      const price = content.cards[id]?.cost;
      // 혼자 살 때의 내 가격(브로커 할인 등 — 2026-10-03)
      const buyer = on.length === 1 ? on[0] : solo;
      const mine = buyer ? bmPrice({ s, c: content }, buyer, id) : price;
      const priceHtml = mine != null && mine !== price ? `<s>${price}</s> ${mine}` : `${price ?? '?'}`;
      const badge = el('div', `bm-badge${on.length > 1 ? ' fight' : ''}`, on.length > 1 ? `경쟁 ${on.length}명! 몰래 카드 내기` : on.length === 1 ? `${iconHtml('{coin}')}${priceHtml}으로 구매` : `가격 ${iconHtml('{coin}')}${priceHtml}`);   // 카드 아래(호버로 들리면 가려지던 문제)
      // 코인이 모자라면 고를 수 없음(엔진도 거절, 2026-10-04 사용자 피드백)
      const poor = solo && !on.includes(solo) && s.players[solo].coins < bmPrice({ s, c: content }, solo, id);
      const card = renderCard(cardView(content, N(), id), { size: 'lg', selected: !!solo && on.includes(solo), disabled: !!poor, note: poor ? '코인이 부족해요' : null });
      if (solo && !poor) {
        card.onclick = () => place(solo, on.includes(solo) ? null : id);
        card.dataset.tip = on.includes(solo) ? '다시 누르면 취소' : '눌러서 고르기';
      }
      wrap.append(card, badge);
      const chips = el('div', 'screen-chips');
      for (const p of on) chips.append(el('span', 'tag on', `<span class="dot" style="background:${PLAYER_COLORS[p]}"></span>${p}${ctx.seatTag(p)}`));
      // 사람이 여럿(핫싯)이면 좌석마다 버튼
      if (!solo) for (const p of humans) {
        const mineHere = on.includes(p);
        const short = !mineHere && s.players[p].coins < bmPrice({ s, c: content }, p, id);
        const b = el('button', mineHere ? 'on' : '', mineHere ? `${p} 취소` : short ? `${p} 코인 부족` : `${p} 고르기`);
        b.disabled = short;
        b.style.borderColor = PLAYER_COLORS[p];
        b.onclick = () => place(p, mineHere ? null : id);
        chips.append(b);
      }
      wrap.append(chips);
      row.append(wrap);
    }
    box.append(row);
    const go = el('button', 'big primary', '암시장 정산');
    go.onclick = () => ctx.act({ type: 'bm_resolve' });
    box.append(go);
    root.append(box);
  }

  return { render };
}
