// 행동 패널 · 시작 화면 (5-1 텍스트 화면과 5-2 3D 화면이 같이 쓴다)
// UI는 상태를 보여 주고 액션을 만들어 보낼 뿐, 규칙 판정은 하지 않는다(엔진이 전부 검증).
//
// ctx: {
//   content, locale,
//   state()            현재 게임 상태
//   map()              현재 맵 데이터
//   act(action)        엔진에 액션 제출 (거절되면 false)
//   path               이동 경로를 만드는 중이면 { char, cells: [] }, 아니면 null
//   setPath(p)         경로 상태 바꾸고 다시 그림
// }
import { cellOf } from '../../engine/map.js';
import { iconText, iconHtml, setIconNames } from './icons.js';

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function makeNames(content, locale, map) {
  // raw: 번역 원문({move} 같은 아이콘 표기 그대로) · t: 글자용(아이콘 → 기호) · rich: HTML용(아이콘 배지)
  const raw = (key, fallback) => locale.strings[key] ?? fallback ?? key;
  const t = (key, fallback) => iconText(raw(key, fallback));
  const rich = (key, fallback) => iconHtml(escHtml(raw(key, fallback)));
  setIconNames(raw);
  const nameOf = (obj) => (obj ? t(obj.name_key, obj.id) : '?');
  return {
    t,
    raw,
    rich,
    nameOf,
    charName: (defId) => nameOf(content.chars[defId]),
    cardName: (id) => nameOf(content.cards[id]),
    foeName: (f) => nameOf(content.enemies[f.type]),
    // 칸 이름: 지명(name_key), 없으면 지형(길 · 숲 · 늪 · 폐차 더미 · 강 · 다리 · 무너진 건물) 또는 칸 종류 — 내부 id는 보여 주지 않음(2026-10-03 테스터 피드백)
    cellName: (cellId) => {
      const c = cellOf(map(), cellId);
      if (!c) return cellId;
      if (c.name_key) return t(c.name_key, c.id);
      if (c.terrain === 'obstacle') return t('celltip.name.obstacle');
      if (c.biome) return t(`celltip.name.${c.biome}`, c.biome);
      if (c.type === 'search') return t('celltip.name.search');
      if (c.type !== 'empty') return t(`celltype.${c.type}`, c.type);
      return t('celltip.name.road');
    },
    missionName: (id) => nameOf(content.missions[id]),
    errorText: (code) => t(`error.${code}`, code),
  };
}

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function phaseLabel(s) {
  const names = { player_turn: `${s.turn.current_player} 차례`, enemy_turn: '적 차례', maintenance: '정비', black_market: '암시장', chapter_prep: '챕터 준비', placement: '배치', game_over: '게임 종료' };
  return `${names[s.turn.phase] ?? s.turn.phase} · ${s.game.chapter}챕터 ${s.game.round}라운드`;
}

const PENDING_LABEL = {
  reaction: '공격받음 — 반응을 고르세요 (토큰 꺼내기 전)',
  choose_trap_target: '함정을 받을 캐릭터',
  choose_char: '구원자 특전: 추가 회복 받을 캐릭터',   // 2026-10-17
  camp_pick: '캠프: 가져올 카드 1장',
  bag_overflow: '가방이 넘침 — 버릴 카드',
  discard_to_hand_limit: '손패 초과 — 버릴 카드',
  combo_step: '연속 행동 — 다음 단계',   // 카드 운용 버전(2026-10-19)
  level_up_pick: '레벨업 — 새 카드 고르기',
  level_up_remove: '레벨업 — 뺄 카드 고르기',
  mission_keep: '미션 고르기',
  trade_consent: '교환 제안',
  bm_bid: '암시장 경쟁 — 제출할 카드',
  bm_bid_extra: '암시장 동점 — 한 장 더',
  placement: '캐릭터 배치',
};

export function createUI(ctx) {
  const { content } = ctx;
  const N = makeNames(content, ctx.locale, ctx.map);
  const button = (text, fn, cls) => { const b = el('button', cls, text); b.onclick = fn; return b; };
  const act = (a) => ctx.act(a);

  function bar(cls, val, max) {
    const b = el('div', `bar ${cls}`);
    const i = document.createElement('i');
    i.style.width = `${max ? Math.max(0, Math.min(100, (val / max) * 100)) : 0}%`;
    b.append(i);
    b.title = `${val}/${max}`;
    return b;
  }

  // 대상(캐릭터 · 적)을 고르는 버튼 묶음
  function targetPicker(container, onPick, { includeChars = true, includeFoes = true, allowNone = true } = {}) {
    const s = ctx.state();
    if (allowNone) container.append(button('대상 없음', () => onPick(null)));
    if (includeChars) for (const c of Object.values(s.chars)) if (c.cell) container.append(button(`${N.charName(c.char)}(${c.owner})`, () => onPick(c.id)));
    if (includeFoes) for (const f of [...Object.values(s.enemies), ...Object.values(s.bosses)]) container.append(button(`${N.foeName(f)} ${f.hp}`, () => onPick(f.uid)));
  }

  function renderActions(box) {
    box.innerHTML = '';
    const s = ctx.state();
    if (s.pending) return renderPending(box, s.pending);
    const ph = s.turn.phase;
    if (ph === 'chapter_prep') { box.append(button('챕터 준비 진행', () => act({ type: 'run_chapter_prep' }), 'primary')); return; }
    if (ph === 'enemy_turn') { box.append(button('적 차례 진행', () => act({ type: 'run_enemy_turn' }), 'primary')); return; }
    if (ph === 'game_over') return renderGameOver(box);
    if (ph === 'maintenance') return renderMaintenance(box);
    if (ph === 'black_market') return renderBlackMarket(box);
    if (ph === 'player_turn') return renderPlayerTurn(box);
  }

  function renderGameOver(box) {
    const s = ctx.state();
    box.append(el('h3', null, '게임 종료 · 최종 순위'));
    // 순위 · 점수는 엔진이 정한 값을 그대로 보여 준다(동점 판정 포함)
    const score = (p) => s.game.scores?.[p] ?? '?';
    (s.game.ranking ?? s.game.turn_order).forEach((p, i) => {
      const pl = s.players[p];
      const card = el('div', 'char-card');
      card.append(el('div', 'name', `${i + 1}위 · ${p} — ${score(p)}점`));
      card.append(el('div', 'sub', `승점 보드 ${pl.vp} + 코인 ${pl.coins} · 보스 ${pl.bosses_killed.length} · 완료 미션 ${pl.missions.completed.length}`));
      box.append(card);
    });
    box.append(button('새 게임', () => location.reload(), 'primary'));
  }

  function renderPending(box, p) {
    const s = ctx.state();
    const wrap = el('div', 'pending');
    box.append(wrap);
    wrap.append(el('h3', null, `${p.player ?? ''} ${PENDING_LABEL[p.type] ?? p.type}`));
    if (p.type === 'reaction') {
      const ch = s.chars[p.character];
      wrap.append(el('div', 'sub', `${N.charName(ch.char)}(${ch.owner})이(가) 공격받음`));
      wrap.append(button('넘기기(반응 안 씀)', () => act({ type: 'react', character: ch.id, pass: true })));
      if (p.options.includes('intercept')) {
        for (const g of Object.values(s.chars).filter((x) => x.owner === ch.owner && x.id !== ch.id && x.cell === ch.cell && !x.exhausted)) {
          wrap.append(button(`대신 맞기: ${N.charName(g.char)}`, () => act({ type: 'react', character: ch.id, intercept_by: g.id })));
        }
      }
      for (const cid of new Set(s.players[ch.owner].hand)) {
        const cd = content.cards[cid];
        if (cd.timing !== 'on_hit') continue;
        const row = el('div');
        const needsDiscard = cd.effect.some((b) => b.block === 'discard_supply');
        const discardSel = document.createElement('select');
        if (needsDiscard) {
          for (const bid of ch.bag) discardSel.append(new Option(`${N.cardName(bid)} 버리기`, bid));
        }
        row.append(el('span', null, `${N.cardName(cid)} `));
        if (needsDiscard) row.append(discardSel);
        row.append(button('사용', () => act({ type: 'react', character: ch.id, cards: [cid], discard_supply: needsDiscard ? discardSel.value : undefined })));
        wrap.append(row);
      }
      for (const bid of ch.bag) {
        const cd = content.cards[bid];
        if (cd?.effect?.some((b) => b.block === 'reduce_damage')) wrap.append(button(`아이템: ${N.cardName(bid)}`, () => act({ type: 'react', character: ch.id, items: [bid] })));
      }
    } else if (p.type === 'choose_trap_target' || p.type === 'choose_char') {   // choose_char: 구원자 특전 1(2026-10-17)
      for (const opt of p.options) wrap.append(button(N.charName(s.chars[opt].char), () => act({ type: 'choose', player: p.player, choice: opt })));
    } else if (p.type === 'camp_pick') {
      for (const opt of p.options) wrap.append(button(N.cardName(opt), () => act({ type: 'choose', player: p.player, choice: opt })));
    } else if (p.type === 'bag_overflow' || p.type === 'discard_to_hand_limit') {
      const pool = p.type === 'bag_overflow' ? s.chars[p.character].bag : s.players[p.player].hand;
      const need = p.discard_count ?? p.count;
      wrap.append(el('div', 'sub', `${p.character ? N.charName(s.chars[p.character].char) : p.player}: ${need}장 고르기`));
      multiPick(wrap, pool, need, need, (id) => (id === 'part' ? '부품' : N.cardName(id)), (chosen) => act({ type: 'choose', player: p.player, choice: chosen }));
    } else if (p.type === 'mission_keep') {
      const pool = [...p.current, ...p.options];
      wrap.append(el('div', 'sub', `최대 ${p.max_keep}장 남기기 (진행 중 미션을 빼면 마커도 사라짐)`));
      multiPick(wrap, pool, 0, p.max_keep, N.missionName, (chosen) => act({ type: 'choose', player: p.player, choice: chosen }), p.current.slice(0, p.max_keep));
    } else if (p.type === 'trade_consent') {
      wrap.append(button('수락', () => act({ type: 'choose', player: p.player, choice: 'accept' })));
      wrap.append(button('거절', () => act({ type: 'choose', player: p.player, choice: 'decline' })));
    } else if (p.type === 'bm_bid' || p.type === 'bm_bid_extra') {
      for (const pl of p.waiting) {
        wrap.append(el('div', 'sub', `${pl} (가방 · 창고)`));
        const pool = [...Object.values(s.chars).filter((c) => c.owner === pl).flatMap((c) => c.bag), ...s.shelter[pl].storage];
        for (const bid of new Set(pool)) wrap.append(button(`${N.cardName(bid)}(${content.cards[bid]?.sell ?? 0})`, () => act({ type: 'bm_bid', player: pl, card: bid })));
        wrap.append(button('포기', () => act({ type: 'bm_bid', player: pl, card: null })));
      }
    } else if (p.type === 'placement') {
      const ch = Object.values(s.chars).find((c) => c.owner === p.player && c.cell == null);
      wrap.append(el('div', 'sub', `${N.charName(ch.char)}을(를) 놓을 시작 지점 (보드의 빈 시작 칸을 클릭해도 됨)`));
      for (const cell of ctx.map().cells.filter((c) => c.type === 'start')) {
        const taken = Object.values(s.chars).some((c) => c.cell === cell.id);
        if (!taken) wrap.append(button(cell.id, () => act({ type: 'place_character', player: p.player, character: ch.id, cell: cell.id })));
      }
    } else {
      wrap.append(el('div', null, JSON.stringify(p)));
    }
  }

  // 여러 개 고르기 (min ~ max개)
  function multiPick(wrap, pool, min, max, label, onConfirm, initial = []) {
    const chosen = new Set();
    initial.forEach((id) => chosen.add(pool.indexOf(id)));
    const list = el('div');
    pool.forEach((id, i) => {
      const tag = el('span', 'tag', label(id));
      tag.onclick = () => { if (chosen.has(i)) chosen.delete(i); else if (chosen.size < max) chosen.add(i); refresh(); };
      list.append(tag);
    });
    wrap.append(list);
    const confirm = button('확정', () => onConfirm([...chosen].map((i) => pool[i])), 'primary');
    wrap.append(confirm);
    function refresh() {
      confirm.disabled = chosen.size < min || chosen.size > max;
      [...list.children].forEach((tag, i) => tag.classList.toggle('on', chosen.has(i)));
    }
    refresh();
  }

  function renderPlayerTurn(box) {
    const s = ctx.state();
    const P = s.turn.current_player;
    box.append(button(`${P} 차례 종료`, () => act({ type: 'end_turn', player: P }), 'primary'));
    for (const ch of Object.values(s.chars).filter((c) => c.owner === P)) box.append(charCard(ch, true));
  }

  function charCard(ch, interactive) {
    const s = ctx.state();
    const card = el('div', `char-card${ch.exhausted ? ' exhausted' : ''}`);
    card.append(el('div', 'name', `${N.charName(ch.char)} · ${ch.cell ? N.cellName(ch.cell) : '쉘터'}${ch.exhausted ? ' · 탈진' : ''}`));
    card.append(bar('hp', ch.hp, ch.max_hp), bar('stamina', ch.stamina, ch.max_stamina));
    card.append(el('div', 'sub', `체력 ${ch.hp}/${ch.max_hp} · 스테미너 ${ch.stamina}/${ch.max_stamina}`));
    const equip = Object.entries(ch.equip).filter(([, v]) => v).map(([, v]) => N.cardName(v)).join(', ');
    if (equip) card.append(el('div', 'sub', `장비: ${equip}`));
    if (ch.exhausted) {
      if (interactive) {
        const row = el('div');
        row.append(el('span', 'sub', '의무실 부활: '));
        if (s.config.revive.placement === 'empty_start_point') {
          for (const c of ctx.map().cells.filter((x) => x.type === 'start')) {
            if (!Object.values(s.chars).some((o) => o.cell === c.id)) row.append(button(c.id, () => act({ type: 'revive_infirmary', player: ch.owner, character: ch.id, cell: c.id })));
          }
        } else row.append(button('쓰러진 자리에서 부활', () => act({ type: 'revive_infirmary', player: ch.owner, character: ch.id })));
        card.append(row);
      }
      return card;
    }
    if (!interactive) {
      card.append(el('div', 'sub', `가방(${ch.bag.length}): ${ch.bag.map((b) => (b === 'part' ? '부품' : N.cardName(b))).join(', ')}`));
      return card;
    }
    const row1 = el('div');
    const pathing = ctx.path && ctx.path.char === ch.id;
    if (!pathing) row1.append(button('이동', () => ctx.setPath({ char: ch.id, cells: [] })));
    else {
      row1.append(el('span', 'sub', `경로: ${[ch.cell, ...ctx.path.cells].map(N.cellName).join(' → ')} `));
      row1.append(button('이동 확정', () => act({ type: 'move', character: ch.id, path: ctx.path.cells }), 'primary'));
      row1.append(button('취소', () => ctx.setPath(null)));
    }
    row1.append(button('상호작용', () => act({ type: 'interact', character: ch.id })));
    row1.append(button('휴식 · 회복', () => act({ type: 'rest', character: ch.id, mode: 'heal' })));
    row1.append(button('휴식 · 카드', () => act({ type: 'rest', character: ch.id, mode: 'draw' })));
    card.append(row1);

    const atkRow = el('div');
    atkRow.append(el('span', 'sub', '공격: '));
    targetPicker(atkRow, (target) => target && act({ type: 'attack', character: ch.id, target }), { allowNone: false });
    card.append(atkRow);

    const hand = s.players[ch.owner].hand;   // 공용 손패(AC-1)
    if (hand.length) {
      const handRow = el('div');
      handRow.append(el('span', 'sub', `공용 손패(${hand.length}): `));
      for (const cid of hand) {
        const cd = content.cards[cid];
        if (cd.timing !== 'anytime') { handRow.append(el('span', 'tag dim', N.cardName(cid))); continue; }
        handRow.append(button(N.cardName(cid), () => {
          const needsTarget = cd.effect.some((x) => x.target === 'same_cell_ally' || x.target === 'chosen_enemy');
          if (!needsTarget) return act({ type: 'play_card', character: ch.id, card: cid });
          const pop = el('div', 'sub', '대상: ');
          targetPicker(pop, (target) => act({ type: 'play_card', character: ch.id, card: cid, target }), { allowNone: false });
          handRow.append(pop);
        }));
      }
      card.append(handRow);
    }
    const bagRow = el('div');
    bagRow.append(el('span', 'sub', `가방(${ch.bag.length}): `));
    for (const bid of ch.bag) {
      const cd = content.cards[bid];
      if (bid === 'part') bagRow.append(el('span', 'tag dim', '부품'));
      else if (['weapon', 'armor', 'accessory'].includes(cd.kind)) bagRow.append(button(`장착 ${N.cardName(bid)}`, () => act({ type: 'equip', character: ch.id, item: bid })));
      else if (cd.kind === 'consumable') {
        bagRow.append(button(`사용 ${N.cardName(bid)}`, () => {
          const needs = cd.effect.some((b) => b.block === 'revive' || b.block === 'deal_damage');
          if (!needs) return act({ type: 'use_item', character: ch.id, item: bid });
          const pop = el('div', 'sub', '대상: ');
          targetPicker(pop, (target) => act({ type: 'use_item', character: ch.id, item: bid, target }), { allowNone: false });
          bagRow.append(pop);
        }));
      } else bagRow.append(el('span', 'tag dim', N.cardName(bid)));
    }
    card.append(bagRow);
    const lootTargets = Object.values(s.chars).filter((x) => x.exhausted && x.cell === ch.cell && x.bag.length);
    for (const x of lootTargets) card.append(button(`약탈: ${N.charName(x.char)}의 가방 전부`, () => act({ type: 'loot', character: ch.id, target: x.id, take: [...x.bag] })));
    return card;
  }

  function renderMaintenance(box) {
    const s = ctx.state();
    for (const p of s.game.turn_order) {
      if (s.maint_done.includes(p)) continue;
      const sec = el('div', 'section');
      sec.append(el('h3', null, `${p} 정비 · 코인 ${s.players[p].coins}`));
      for (const ch of Object.values(s.chars).filter((c) => c.owner === p)) sec.append(charCard(ch, false));
      const facRow = el('div');
      for (const [fid, fac] of Object.entries(content.facilities)) {
        const lv = s.shelter[p].facilities[fid] ?? 0;
        if (lv < fac.max_level) facRow.append(button(`${N.nameOf(fac)} Lv${lv}→${lv + 1} (부품 ${fac.levels[lv].cost_parts} · 코인 ${fac.levels[lv].cost_coins ?? 0})`, () => act({ type: 'upgrade_facility', player: p, facility: fid })));
        else facRow.append(el('span', 'tag dim', `${N.nameOf(fac)} Max`));
      }
      sec.append(facRow);
      const sellRow = el('div');
      for (const ch of Object.values(s.chars).filter((c) => c.owner === p)) {
        for (const bid of ch.bag) {
          const cd = content.cards[bid];
          if (cd?.sell != null) sellRow.append(button(`판매 ${N.cardName(bid)} +${cd.sell}`, () => act({ type: 'sell', character: ch.id, card: bid })));
        }
      }
      sec.append(sellRow);
      sec.append(button(`${p} 정비 종료`, () => act({ type: 'end_maintenance', player: p }), 'primary'));
      box.append(sec);
    }
  }

  function renderBlackMarket(box) {
    const s = ctx.state();
    box.append(el('div', 'sub', '공개된 카드: ' + s.board.black_market.map((id) => `${N.cardName(id)}(${content.cards[id].cost}코인)`).join(', ')));
    for (const pl of s.game.turn_order) {
      const placedOn = Object.entries(s.board.bm_place).find(([, l]) => l.includes(pl))?.[0];
      const row = el('div');
      row.append(el('span', 'sub', `${pl} `));
      if (placedOn) row.append(el('span', 'tag on', N.cardName(placedOn)), button('취소', () => act({ type: 'bm_place', player: pl, card: null })));
      else for (const cid of s.board.black_market) row.append(button(N.cardName(cid), () => act({ type: 'bm_place', player: pl, card: cid })));
      box.append(row);
    }
    box.append(button('암시장 정산', () => act({ type: 'bm_resolve' }), 'primary'));
  }

  // ---------- 시작 화면 (5-1 텍스트 디버그 화면 전용의 단순 선택기) ----------
  // 3D 핫싯 화면(game3d.html)의 실제 시작 화면은 뱀 순서 드래프트를 쓴다: web/ui/draft.js의 runStart 참조.
  function renderStart(box, onStart) {
    box.innerHTML = '';
    const chars = Object.keys(content.chars);
    box.append(el('h3', null, '새 게임'));
    let nPlayers = 2;
    const pSel = document.createElement('select');
    for (const n of [1, 2, 3, 4]) pSel.append(new Option(`${n}인`, n, n === 2, n === 2));
    pSel.onchange = () => { nPlayers = Number(pSel.value); renderPicks(); };
    box.append(pSel);
    const picksWrap = el('div');
    box.append(picksWrap);
    const picks = {};
    function renderPicks() {
      picksWrap.innerHTML = '';
      for (const p of ['P1', 'P2', 'P3', 'P4'].slice(0, nPlayers)) {
        picks[p] ??= [];
        const row = el('div', 'pick-row');
        row.dataset.player = p;
        row.append(el('h3', null, `${p} 캐릭터 (2명)`));
        for (const cid of chars) {
          const tag = el('span', `tag${picks[p].includes(cid) ? ' on' : ''}`, N.charName(cid));
          tag.dataset.char = cid;
          tag.onclick = () => {
            if (picks[p].includes(cid)) picks[p] = picks[p].filter((x) => x !== cid);
            else if (picks[p].length < 2) picks[p].push(cid);
            renderPicks();
          };
          row.append(tag);
        }
        picksWrap.append(row);
      }
    }
    renderPicks();
    const randomBtn = button('무작위로 채우기', () => {
      const pool = [...chars].sort(() => Math.random() - 0.5);
      ['P1', 'P2', 'P3', 'P4'].slice(0, nPlayers).forEach((p, i) => { picks[p] = pool.slice(i * 2, i * 2 + 2); });
      renderPicks();
    });
    const startBtn = button('게임 시작', () => {
      const players = ['P1', 'P2', 'P3', 'P4'].slice(0, nPlayers);
      for (const p of players) if ((picks[p] ?? []).length !== 2) { alert(`${p}는 캐릭터를 2명 골라야 해`); return; }
      onStart({ players, picks: Object.fromEntries(players.map((p) => [p, picks[p]])) });
    }, 'primary');
    startBtn.id = 'btn-start';
    box.append(el('div'), randomBtn, startBtn);
  }

  return { names: N, renderActions, renderStart, charCard };
}
