// 위 상태 줄(F2d): 챕터 · 라운드 트랙 · 다른 플레이어 판 · 덱 더미.
// 판: 캐릭터마다 아이콘(고유 색 + 팀 색 테두리) · 체력 · 스테미너 막대, 승점 · 코인 · 손패 · 창고 · 미션 수(모두 공개 정보).
// 내 판은 없다(내 정보는 왼쪽 아래). 관전이면 모두의 판. 판을 누르면 그 플레이어의 쉘터 보드.
import { PLAYER_COLORS } from '../board3d/pieces.js';
import { iconHtml } from './icons.js';
import { renderCard, cardView } from './cards.js';
import { attachCardZoom, hideCardZoom } from './cardzoom.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const PILES = [['supply', '보급품', '#8A6A48'], ['investigation', '조사', '#4F6F8C'], ['enemy', '적', '#8C3A30'], ['mission', '미션', '#7A4A8C']];

export function createTopbar(ctx, dom, { onPlate }) {
  const { content } = ctx;
  const N = () => ctx.names;

  function render() {
    hideCardZoom();   // 다시 그리면 마우스 아래 카드가 바뀌므로 확대도 지움(남아 있는 것 방지)
    const s = ctx.state();
    dom.dots.innerHTML = '';
    dom.plates.innerHTML = '';
    dom.piles.innerHTML = '';
    if (!s) { document.getElementById('tb-rank')?.remove(); document.getElementById('tb-supply')?.remove(); return; }
    // 10개가 넘으면(테스트 맵 라운드 99 등, 2026-10-17) 동그라미 대신 "n / 전체"
    const dots = (n, cur) => (n > 10 ? `<b>${cur}</b> / ${n}` : Array.from({ length: n }, (_, i) => `<i class="${i + 1 === cur ? 'on' : i + 1 < cur ? 'done' : ''}">${i + 1}</i>`).join(''));
    dom.dots.innerHTML = `<div>챕터 ${dots(s.config.chapters, s.game.chapter)}</div><div>라운드 ${dots(s.config.rounds_per_chapter, s.game.round)}</div>`;

    const me = ctx.me?.();
    for (const p of s.game.turn_order.filter((x) => x !== me)) {
      const pl = s.players[p];
      const sh = s.shelter[p];
      const cur = p === s.turn.current_player && s.turn.phase === 'player_turn';
      const plate = el('div', `tb-plate${cur ? ' cur' : ''}`);
      plate.style.setProperty('--team', PLAYER_COLORS[p]);
      plate.dataset.p = p;
      const ms = pl.missions.active.length + pl.missions.hand.length;
      plate.innerHTML = `<div class="tb-who"><b>${p}</b><small>${ctx.seatTag?.(p) ?? ''}</small>
        <span class="tb-res"><span data-anchor="vp" data-tip="승점">${iconHtml('{vp}')}<b>${pl.vp}</b></span><span data-anchor="coin" data-tip="코인">${iconHtml('{coin}')}<b>${pl.coins}</b></span><span data-anchor="part" data-tip="부품">${iconHtml('{part}')}${pl.parts ?? 0}</span>`
        + `<span data-anchor="hand" data-tip="공용 손패">${iconHtml('{card}')}${pl.hand.length}</span><span data-anchor="storage" data-tip="창고(장수)">🗄${sh.storage.length}</span><span data-anchor="mission" data-tip="미션(진행 · 손에 든)">${iconHtml('{marker}')}${ms}</span></span></div>`;
      const chars = el('div', 'tb-chars');
      for (const ch of Object.values(s.chars).filter((c) => c.owner === p)) {
        const def = content.chars[ch.char];
        const pct = (a, b) => `${Math.max(0, Math.min(100, (a / b) * 100))}%`;
        chars.append(el('div', `tb-chip${ch.exhausted ? ' ex' : ''}`, `<span class="tb-av" style="--cc:${def.color}">${def.icon}</span>
          <div class="tb-bars"><div class="tb-name">${N().charName(ch.char)}${ch.exhausted ? ' · 💤탈진' : ''}</div>
          <div class="tb-bar hp"><i style="width:${pct(ch.hp, ch.max_hp)}"></i></div><div class="tb-bar st"><i style="width:${pct(ch.stamina, ch.max_stamina)}"></i></div></div>
          <div class="tb-nums">${iconHtml('{hp}')}${ch.hp}<br>${iconHtml('{st}')}${ch.stamina}</div>`));
      }
      plate.append(chars);
      plate.onclick = () => onPlate?.(p);
      dom.plates.append(plate);
    }

    // 오른쪽 위 세로 단(2026-10-07 사용자 피드백 오늘 2): 덱 더미 아래에 "드러난 보급품", 그 아래에 승점 순위, 맨 아래 알림(#toasts).
    // 세 가지를 한 단에 쌓아서 서로 높이가 달라져도 겹치지 않는다.
    let side = document.getElementById('tb-side');
    if (!side) {
      side = el('div'); side.id = 'tb-side'; document.body.append(side);
      const toasts = document.getElementById('toasts');
      if (toasts) side.append(toasts);
    }
    // 드러난 보급품: 기본 화면에서도 보이게 작은 카드(xs)로. 빈 칸(가져가서 비움)은 점선 칸.
    let sup = document.getElementById('tb-supply');
    if (!sup) { sup = el('div', 'tb-supply glass'); sup.id = 'tb-supply'; side.prepend(sup); }
    const open = s.board.open_supply ?? [];
    sup.innerHTML = '<div class="tb-rank-h">드러난 보급품 <small>(가져갈 수 있는 카드)</small></div>';
    const row = el('div', 'tb-supply-row');
    for (const id of open) {
      if (id) {
        // 조금 크게(mini — 2026-10-13 사용자 피드백 "너무 작아서 안 보임") + 마우스를 올리면 정상 크기로 확대(ui/cardzoom.js)
        const v = cardView(content, N(), id);
        row.append(attachCardZoom(renderCard(v, { size: 'mini' }), v, { side: 'left' }));
      }
      else row.append(el('div', 'tb-supply-empty', '비어 있음'));
    }
    sup.append(row);

    // 승점 순위표(2026-10-04 사용자 피드백 신규 2): 덱 더미 아래 — 지금 1위가 누구인지. 같은 승점이면 같은 순위
    let rank = document.getElementById('tb-rank');
    if (!rank) { rank = el('div', 'tb-rank glass'); rank.id = 'tb-rank'; side.insertBefore(rank, document.getElementById('toasts')); }
    const order = [...s.game.turn_order].sort((a, b) => s.players[b].vp - s.players[a].vp || s.game.turn_order.indexOf(a) - s.game.turn_order.indexOf(b));
    rank.innerHTML = `<div class="tb-rank-h">${iconHtml('{vp}')} 승점 순위</div>` + order.map((p) => {
      const place = 1 + order.filter((q) => s.players[q].vp > s.players[p].vp).length;
      return `<div class="tb-rank-row${place === 1 ? ' first' : ''}${p === me ? ' me' : ''}"><span class="tb-rank-n">${place === 1 ? '👑' : place}</span><span class="dot" style="background:${PLAYER_COLORS[p]}"></span><b>${p}</b>${p === me ? '<small>나</small>' : ''}<span class="tb-rank-v">${s.players[p].vp}</span></div>`;
    }).join('');

    for (const [k, label, color] of PILES) {
      const n = s.decks[k]?.length ?? 0;
      const pile = el('div', 'tb-pile', `<div class="tb-stack" style="--pc:${color}"><i></i><i></i><i></i></div>${label} <b>${n}</b>`);
      pile.dataset.pile = k;
      dom.piles.append(pile);
    }
  }


  return { render };
}
