// 오른쪽 상황판: 플레이어 점수 · 진행 중/완료 미션(작은 미션 카드) · 쉘터 시설 · 게임 종료 순위
// 선택은 여기서 하지 않는다(선택은 화면 중앙 카드 창).
// 손에 든(공개하지 않은) 미션은 비공개 정보라 ctx.viewer(지금 화면을 보고 있어도 되는 플레이어)에게만 보여 준다(핫싯 가리개 참조).
import { renderCard, missionView } from './cards.js';
import { PLAYER_COLORS } from '../board3d/pieces.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function createStatus(ctx, root) {
  const { content } = ctx;
  const N = () => ctx.names;

  function render() {
    const s = ctx.state();
    root.innerHTML = '';
    // F2d: 평소 정보는 위 상태 줄 · 쉘터 보드로 옮겼고, 여기서는 게임 종료 순위만 가운데 창으로 보여 준다
    // 2026-10-01: 게임 종료 순위는 가운데 결과 화면(screens.js) 하나로 합침(두 창이 겹쳐 뜨던 문제)
    root.classList.add('hidden');
    return;
    if (s.game.over) {
      root.append(el('div', 'st-h', '게임 종료 · 최종 순위'));
      (s.game.ranking ?? []).forEach((p, i) => {
        const pl = s.players[p];
        const row = el('div', 'st-player', `<span class="dot" style="background:${PLAYER_COLORS[p]}"></span><b>${i + 1}위 ${p}</b>${ctx.seatTag(p)} <span>${s.game.scores?.[p] ?? '?'}점</span>
          <div class="st-sub">승점 ${pl.vp} + 코인 ${pl.coins}개(→ ${Math.floor(pl.coins * (s.config.scoring?.coin_value ?? 1))}점) · 보스 ${pl.bosses_killed.length} · 완료 미션 ${pl.missions.completed.length}</div>`);
        root.append(row);
      });
      const b = el('button', 'primary', '새 게임');
      b.onclick = () => location.reload();
      root.append(b);
      return;
    }
    root.append(el('div', 'st-h', `${s.game.chapter}챕터 ${s.game.round}/${s.config.rounds_per_chapter}라운드`));
    for (const p of s.game.turn_order) {
      const pl = s.players[p];
      const cur = p === s.turn.current_player;
      const row = el('div', `st-player${cur ? ' cur' : ''}`);
      row.innerHTML = `<span class="dot" style="background:${PLAYER_COLORS[p]}"></span><b>${p}</b>${ctx.seatTag(p)} <span>승점 ${pl.vp} · 코인 ${pl.coins}</span>
        <div class="st-sub">보스 ${pl.bosses_killed.length} · 완료 미션 ${pl.missions.completed.length} · 시설 ${facilitySummary(s, p)}</div>`;
      // 공개된(진행 중) 미션은 모두에게 보이고, 손에 든 미션은 본인이 화면을 확인했을 때만 보인다(핫싯 가리개)
      const ms = el('div', 'st-missions');
      for (const a of pl.missions.active) ms.append(renderCard(missionView(content, N(), a.id, { markers: a.markers }), { size: 'xs', note: '진행 중' }));
      if (p === ctx.viewer || ctx.viewer === '*') for (const id of pl.missions.hand) ms.append(renderCard(missionView(content, N(), id), { size: 'xs', note: '손에 든 미션' }));
      else for (const _ of pl.missions.hand) ms.append(renderCard({}, { size: 'xs', back: true }));
      if (ms.children.length) row.append(ms);
      root.append(row);
    }
  }

  function facilitySummary(s, p) {
    const f = s.shelter[p].facilities;
    const parts = Object.entries(f).filter(([, lv]) => lv > 0).map(([fid, lv]) => `${N().nameOf(content.facilities[fid])} ${lv}`);
    return parts.length ? parts.join(', ') : '없음';
  }

  return { render };
}
