// 화면(HUD) 연출(F2e): 3D 보드 연출과 같은 사건 순서로, 화면 위에서 카드 · 코인 · 토큰이 날아간다.
// - 카드 뽑기: 덱 더미(보급품 · 조사) 또는 내 손패 자리로 카드 뒷면이 날아옴. 남이 뽑으면 그 사람 판으로.
// - 코인 · 승점 · 연구/생존자 토큰: 보드의 캐릭터 자리에서 자원 숫자로 날아가고 숫자가 톡 튄다.
// - 미션 진행은 알림, 완료는 카드 확대 + "완료" 도장. 적 차례는 가운데 배너.
// 연출 속도(×1 · ×2 · ×4 · 건너뛰기)는 3D 연출과 같은 값(ctx.fxSpeed)을 따른다. 규칙 판정은 하지 않는다(보여 주기만).
import { renderCard, missionView } from './cards.js';
import { iconGlyph } from './icons.js';
import { holdForInput } from './fxpause.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function createHudFx(ctx) {
  const { content } = ctx;
  const layer = el('div', null);
  layer.id = 'fxlayer';
  document.body.append(layer);
  const speed = () => Math.max(0.25, ctx.fxSpeed?.() ?? 1);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / speed()));
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const visible = (e) => e && e.offsetParent !== null;

  // 자원 숫자 자리: 나는 왼쪽 아래 내 자원 줄, 다른 플레이어는 위 상태 줄의 판
  function anchor(kind, p) {
    const mine = ctx.me?.() === p;
    const q = mine ? `.myres [data-anchor="${kind}"]` : `.tb-plate[data-p="${p}"] [data-anchor="${kind}"]`;
    const a = document.querySelector(q);
    return visible(a) ? a : null;
  }
  // 출발점: 그 플레이어의 캐릭터가 있는 칸(지금 고른 캐릭터 우선) → 없으면 화면 가운데
  function sourceOf(p, charId = null) {
    const s = ctx.state();
    let ch = charId ? s.chars[charId] : null;
    if (!ch?.cell && s.chars[ctx.ui.selected]?.owner === p) ch = s.chars[ctx.ui.selected];
    if (!ch?.cell) ch = Object.values(s.chars).find((c) => c.owner === p && c.cell);
    if (ch?.cell && ctx.cellScreen) return ctx.cellScreen(ch.cell);
    return { x: innerWidth / 2, y: innerHeight / 2 };
  }

  // 하나 날리기: from{x,y} → to 요소(가운데), 도착하면 숫자 톡
  function fly(from, toEl, html, { dur = 650, size = 30, cls = '' } = {}) {
    if (!toEl) return Promise.resolve();
    const t = center(toEl.getBoundingClientRect());
    const e = el('div', `fx-fly ${cls}`, html);
    e.style.cssText = `left:${from.x}px;top:${from.y}px;font-size:${size}px;transition-duration:${dur / speed()}ms`;
    layer.append(e);
    requestAnimationFrame(() => requestAnimationFrame(() => { e.style.left = `${t.x}px`; e.style.top = `${t.y}px`; e.style.transform = 'translate(-50%,-50%) scale(.55)'; }));
    return new Promise((r) => setTimeout(() => { e.remove(); bump(toEl); r(); }, dur / speed()));
  }
  function bump(target) {
    if (target.closest('#tb-plates')) return;   // 다른 플레이어 판(위 상태 줄)은 커졌다 작아지지 않게(2026-10-04 사용자 피드백)
    target.classList.remove('fx-bump');
    void target.offsetWidth;
    target.classList.add('fx-bump');
  }
  function floatText(target, text, color) {
    if (!target) return;
    const t = center(target.getBoundingClientRect());
    const e = el('div', 'fx-float', text);
    e.style.cssText = `left:${t.x}px;top:${t.y}px;color:${color}`;
    layer.append(e);
    setTimeout(() => e.remove(), 1100);
  }

  // 카드 뒷면 날리기(여러 장이면 조금씩 늦게)
  async function flyCards(from, toEl, n, color) {
    const jobs = [];
    for (let i = 0; i < Math.min(n, 5); i++) {
      jobs.push(wait(i * 90).then(() => fly(from, toEl, `<div class="fx-back" style="--pc:${color}"></div>`, { dur: 560, size: 16 })));
    }
    await Promise.all(jobs);
  }
  const PILE_COLOR = { supply: '#8A6A48', investigation: '#4F6F8C', player: '#5A6A8A' };

  async function play(e) {
    const s = ctx.state();
    if (!s || (ctx.fxSpeed?.() ?? 1) >= 30) return;          // 건너뛰기 중이면 생략
    switch (e.type) {
      case 'card_drawn': {
        const p = e.player ?? s.chars[e.character]?.owner;
        if (!p) return;
        const mine = ctx.me?.() === p;
        const pile = document.querySelector(`#tb-piles [data-pile="${e.deck}"] .tb-stack`);
        // 출발: 보급품 · 조사는 위쪽 덱 더미, 플레이어 카드는 그 사람의 손패 숫자(내 자원 줄 · 상대 판)
        const handAnchor = anchor('hand', p);
        const from = pile ? center(pile.getBoundingClientRect()) : handAnchor ? center(handAnchor.getBoundingClientRect()) : sourceOf(p, e.character);
        let to;
        if (mine) to = e.deck === 'player' ? document.querySelector('#hand .hand-fan') : document.querySelector(`#dock .cboard[data-char="${e.character}"] .cb-bag`);
        else to = document.querySelector(`.tb-plate[data-p="${p}"]`);
        if (!visible(to)) to = anchor('hand', p);
        await flyCards(from, to, e.count ?? 1, PILE_COLOR[e.deck] ?? '#5A5A7A');
        return;
      }
      case 'coins_changed': {
        const to = anchor('coin', e.player);
        if (!to) return;
        if (e.amount > 0) {
          const from = sourceOf(e.player);
          const jobs = [];
          for (let i = 0; i < Math.min(e.amount, 6); i++) jobs.push(wait(i * 80).then(() => fly(from, to, iconGlyph('coin'), { dur: 600, size: 28 })));
          floatText(to, `+${e.amount}`, '#FFE27A');
          await Promise.race([Promise.all(jobs), wait(420)]);
        } else if (e.amount < 0) floatText(to, `${e.amount}`, '#FF9A8A');
        return;
      }
      case 'parts_changed': {   // 부품 = 자원(신규 4): 코인처럼 날아 들어감
        const to = anchor('part', e.player);
        if (!to) return;
        if (e.amount > 0) {
          const from = sourceOf(e.player);
          for (let i = 0; i < Math.min(e.amount, 6); i++) wait(i * 80).then(() => fly(from, to, iconGlyph('part'), { dur: 600, size: 26 }));
          floatText(to, `+${e.amount}`, '#D9C7A8');
          await wait(420);
        } else if (e.amount < 0) floatText(to, `${e.amount}`, '#FF9A8A');
        return;
      }
      case 'vp_gained': {
        const to = anchor('vp', e.player);
        if (!to) return;
        fly(sourceOf(e.player), to, `<b class="fx-vp">${iconGlyph('vp')}+${e.amount}</b>`, { dur: 700, size: 22 });
        await wait(300);
        return;
      }
      case 'token_gained': {
        // 연구 토큰 → 연구 토큰 숫자, 생존자 → 내 쉘터 버튼(다른 플레이어는 그 사람 판)
        const mine = ctx.me?.() === e.player;
        const to = e.token === 'research' ? anchor('research', e.player) ?? document.querySelector(`.tb-plate[data-p="${e.player}"]`)
          : mine ? document.querySelector('#actions .shbtn') : document.querySelector(`.tb-plate[data-p="${e.player}"]`);
        if (!visible(to)) return;
        const icon = e.token === 'research' ? iconGlyph('research') : iconGlyph('survivor');
        for (let i = 0; i < Math.min(e.ids?.length ?? 1, 4); i++) fly(sourceOf(e.player), to, icon, { dur: 650, size: 26 });
        await wait(300);
        return;
      }
      case 'mission_progress': {
        if (!e.mission) return;                              // 트리거 작업(조건 판정 전)은 무시, 실제 진행만
        const m = content.missions[e.mission];
        toastMission(e.player, `${ctx.names.missionName(e.mission)} ${e.markers}/${m?.target ?? '?'}`);
        const to = anchor('mission', e.player);
        if (to) bump(to);
        return;
      }
      case 'mission_completed': {
        const card = renderCard(missionView(content, ctx.names, e.mission, { markers: content.missions[e.mission]?.target }), { size: 'lg' });
        const box = el('div', 'fx-mission');
        box.append(card, el('div', 'fx-stamp', '완료'));
        box.append(el('div', 'fx-mission-who', `${e.player} · 미션 완료`));
        document.body.append(box);   // 딤(z 52) 위에 보이려고 fxlayer(z 50)가 아니라 body에 직접
        requestAnimationFrame(() => box.classList.add('on'));
        // 미션 완료도 한 번 멈춤(2026-10-07 사용자 피드백 오늘 4) — 자동 스킵 옵션이면 예전처럼 1.3초
        await holdForInput({ speed: ctx.fxSpeed?.() ?? 1, wait: (sec) => wait(sec * 1000) }, { hold: 1.3 });
        box.classList.add('off');
        setTimeout(() => box.remove(), 300);
        return;
      }
      default:
    }
  }

  function toastMission(p, text) {
    const t = el('div', 'fx-toast', `<span class="fx-ti">${iconGlyph('marker')}</span>${p} 미션 진행 · ${text}`);
    layer.append(t);
    setTimeout(() => t.remove(), 1800);
  }

  // 가운데 띠 배너(적 차례 · 배치 · 차례 안내 공용, 2026-10-04) — color: 띠 색, sub: 작은 안내 문구
  async function phaseBanner(text, { color = 'rgba(80,10,20,.88)', sub = '', ms = 900 } = {}) {
    if ((ctx.fxSpeed?.() ?? 1) >= 30) return;
    const b = el('div', 'fx-enemy', `<div>${text}${sub ? `<small>${sub}</small>` : ''}</div>`);
    b.style.setProperty('--band', color);
    layer.append(b);
    requestAnimationFrame(() => b.classList.add('on'));
    await wait(ms);
    b.classList.remove('on');
    setTimeout(() => b.remove(), 300);
  }
  const enemyBanner = () => phaseBanner('적 차례');

  return { play, enemyBanner, phaseBanner };
}
