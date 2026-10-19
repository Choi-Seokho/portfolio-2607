// 카드 컴포넌트: 플레이어 카드 · 보급품 · 암시장 · 조사 · 미션 · 시설 · 캐릭터(초상) · 선택지 카드
// 카드는 층으로 나눈다(art-direction 7장): 프레임(색 띠) / 그림(지금은 색 + 픽토그램 자리) / 비용 · 능력치 아이콘 / 텍스트(번역 키).
// 실물 인쇄 · Godot으로 옮길 때도 같은 "카드 보기 데이터(cardView)"를 쓰면 된다.

import { iconHtml, iconText } from './icons.js';
import { enemyDefAt, bagCapacity, charPouchId } from '../../engine/index.js';
import { weaponOf, rangeOf, moveOf, defenseOf } from '../../engine/core.js';

const PLAYER_KIND_COLOR = { '공격 강화': '#B0573F', 방어: '#5F7F9C', 회피: '#3F8FA8', 유틸리티: '#7A6AA8', 회복: '#4F9A6A', 이동: '#5A7A5A', 공격: '#8C4A3A' };   // 이동 · 공격 = 카드 운용 버전 공용 카드(2026-10-18)
// 카드 운용 버전(2026-10-18 A/B 테스트)일 때만 플레이어 카드에 기본 아이콘(이동 · 공격) 줄을 그린다 — 기본 행동 버전 화면은 그대로.
// game3d.js가 판을 시작할 때 setCardMode로 켜고 끈다
let cardModeOn = false;
export function setCardMode(on) { cardModeOn = !!on; }
export const isCardModeView = () => cardModeOn;
const SUPPLY_KIND_COLOR = {
  weapon: '#B0573F', armor: '#5F7F9C', accessory: '#7A6AA8', consumable: '#4F9A6A', material: '#8A6A48',
  treasure: '#B8922E', trap: '#8C3A30', enemy: '#6A4A44', special: '#5A5A7A', investigation: '#4F6F8C', part: '#8A6A48',
  search: '#7A5A1E',
};
const INV_COLOR = { blue: '#4F7FA8', yellow: '#B8922E', red: '#B0573F', wild: '#7A6AA8' };
const MISSION_COLOR = { combat: '#B0573F', explore: '#4F7FA8', risk: '#3F8FA8', shelter: '#4F9A6A', pvp: '#8C3A30', boss: '#7A4A8C', economy: '#B8922E', gear: '#7A6AA8' };
const GLYPH = {
  weapon: '⚔', armor: '⛨', accessory: '◈', consumable: '✚', material: '⚙', treasure: '◆', trap: '⚠', enemy: '☠', special: '✦',
  investigation: '⌕', part: '⚙', mission: '⚑', facility: '⌂', search: '?',
  '공격 강화': '⚔', 방어: '⛨', 회피: '➶', 유틸리티: '✦', 회복: '✚', 이동: '👣', 공격: '⚔',
};

// 토큰 카드 핵심 정보 한 줄(아이콘 + 수치): 생존자는 배치 보너스(시설 · 효과), 연구 카드는 효과
const FAC_ICON = { f_infirmary: '🏥', f_workshop: '🛠', f_garden: '🌱', f_radio: '📻', f_lab: '🔬' };   // f_lab 연구실(2026-10-18)
export function tokenKey(content, N, id) {
  const cd = content.cards[id];
  if (cd.kind === 'survivor') {
    const tk = content.tokens?.[id] ?? {};
    const kind = tk.kind === 'animal' ? '🐾 동물' : '👤 사람';
    const b = tk.assigned_bonus;
    if (!b) return `${kind} 일손`;
    const fac = content.facilities[b.facility];
    const what = b.block === 'mod_revive' ? `부활 비용 ${b.cost}` : b.block === 'mod_upgrade_cost' ? `레벨업 부품 ${b.amount}` : b.block === 'mod_heal' ? `회복 +${b.amount}` : b.block;
    return `${kind} · ${FAC_ICON[b.facility] ?? '⌂'} ${fac ? N.nameOf(fac) : ''} ${iconHtml(what.replace(/^회복/, '{hp}'))}`;
  }
  const out = [];
  for (const b of cd.effect ?? []) {
    if (b.block === 'heal') out.push(`${iconHtml('{hp}')}+${b.hp}`);
    else if (b.block === 'attack_bonus') out.push(`${iconHtml('{atk}')}+${b.amount} <small>공격할 때</small>`);
    else if (b.block === 'noise') out.push(`🔊 소음 <small>${b.range ?? 3}칸 안 칸 고르기</small>`);
    else if (b.block === 'gain_coin') out.push(`${iconHtml('{coin}')}+${b.amount} <small>정비 때</small>`);
  }
  return out.join(' · ');
}

// 카드 데이터 → 화면에 보일 내용(텍스트는 전부 번역 키에서)
export function cardView(content, N, id) {
  if (id === 'part') return { id, shape: 'small', title: N.t('ui.kind.part', '부품'), band: SUPPLY_KIND_COLOR.part, glyph: GLYPH.part, kind: N.t('ui.kind.material'), desc: iconText('{part}1'), descHtml: `${iconHtml('{part}')}1`, stats: [] };
  const cd = content.cards[id];
  if (!cd) return { id, title: id, band: '#777', glyph: '?', kind: '', desc: '', stats: [] };
  const t = (k, f) => (k ? N.t(k, f ?? '') : f ?? '');
  const v = { id, title: N.nameOf(cd), desc: t(cd.desc_key), descHtml: cd.desc_key ? richOf(N, cd.desc_key) : '', stats: [], source: cd.source, costs: extraCosts(N, cd) };
  if (cd.source === 'player') {
    v.band = PLAYER_KIND_COLOR[cd.kind] ?? '#777';
    v.glyph = GLYPH[cd.kind] ?? '✦';
    v.kind = `${cd.kind} · ${t(`ui.timing.${cd.timing}`, cd.timing)}`;
    v.cost = { value: cd.stamina, type: 'stamina' };
    v.signature = id.startsWith('c_');
    v.shape = 'tall';
    // 전용 카드: 오른쪽 위 모서리에 주인 캐릭터 색 · 아이콘(피드백 2)
    const owner = cd.char ? content.chars[cd.char] : null;
    if (owner) {
      v.owner = { color: owner.color, icon: owner.icon, name: N.nameOf(owner) };
      v.kind = `${v.owner.name} 전용 · ${v.kind}`;   // 주인 이름은 늘 고정해서 보여 준다(2026-10-03 사용자 결정 D)
    }
    // 카드 운용 버전: 기본 아이콘(2026-10-18 사용자 결정 — 전용 카드도 기능 대신 기본 이동 · 공격으로 쓸 수 있음). 공용 이동 · 공격 카드는 종류 줄만
    // 2026-10-19 사용자 요청: "기본 이동 · 기본 공격" 글자 없이 아이콘 + (스테미너 아이콘 −1). 뽑기는 카드 아이콘 +2(스테미너 없음)
    if (cardModeOn && cd.basic) {
      const st = (n) => (n ? ` <small>(${iconHtml('{st}')}−${n})</small>` : '');
      const what = cd.basic === 'move' ? `${iconHtml('{move}')}${st(1)}` : cd.basic === 'attack' ? `${iconHtml('{atk}')}${st(1)}` : `${iconHtml('{card}')}+2`;
      v.basic = cd.basic;
      if (cd.timing === 'basic') v.kind = cd.basic === 'move' ? '공용 · 이동 카드' : '공용 · 공격 카드';
      else { v.footerHtml = `<span class="key-strip basic-strip">${what}</span>`; v.footer = ' '; }
    }
    // 레벨(카드 운용 버전 레벨업 카드, 2026-10-19): 종류 줄 앞에 Lv
    if (cardModeOn && (cd.level ?? 1) > 1) v.kind = `Lv${cd.level} · ${v.kind}`;
  } else if (cd.source === 'token') {
    // 토큰 카드(2026-10-07 사용자 결정): 연구 · 생존자. 아래쪽 띠에 핵심 정보를 아이콘 + 수치로 크게
    v.shape = 'small';
    const animal = cd.kind === 'survivor' && content.tokens?.[id]?.kind === 'animal';
    v.band = cd.kind === 'research' ? '#4F6F8C' : animal ? '#8A6A48' : '#4F9A6A';
    v.glyph = cd.kind === 'research' ? '🧪' : animal ? '🐕' : '🧑';
    // 연구실 레벨 조건(2026-10-18): 종류 줄에 "연구실 Lv n" — 쓰려면 쉘터 연구실이 그 레벨 이상
    v.kind = cd.kind === 'research' ? `연구 카드 · ${t(`ui.timing.${cd.timing}`, cd.timing)}${cd.lab_level ? ` · 🔬Lv${cd.lab_level}` : ''}` : `생존자 · ${animal ? '동물' : '사람'}`;
    v.footerHtml = `<span class="key-strip">${tokenKey(content, N, id)}</span>`;
    v.footer = ' ';
  } else if (cd.source === 'investigation') {
    v.shape = 'small';
    v.band = INV_COLOR[cd.color] ?? '#4F6F8C';
    v.glyph = cd.kind === 'clue' || cd.wild ? '⌕' : cd.kind === 'noise' ? '♪' : cd.kind === 'cache' ? '◆' : '✉';
    v.kind = `${t('ui.kind.investigation')} · ${t(`ui.color.${cd.color}`, cd.color)}`;
    v.flavor = t(cd.flavor_key);
  } else {
    v.shape = 'small';
    v.band = SUPPLY_KIND_COLOR[cd.kind] ?? '#777';
    v.glyph = GLYPH[cd.kind] ?? '✦';
    v.kind = `${t(`ui.source.${cd.source}`)} · ${t(`ui.kind.${cd.kind}`, cd.kind)}`;
    if (cd.attack != null) v.stats.push({ label: t('ui.stat.attack'), value: cd.attack, icon: 'atk' });
    if (cd.range != null && cd.kind === 'weapon') v.stats.push({ label: t('ui.stat.range'), value: cd.range, icon: 'range' });
    if (cd.defense != null) v.stats.push({ label: t('ui.stat.defense'), value: cd.defense, icon: 'def' });
    if (cd.cost != null) v.cost = { value: cd.cost, type: 'coin' };
    // 재료 카드는 팔면 코인 대신 부품 토큰(2026-10-01)
    if (cd.material === 'part') v.footer = `${t('ui.stat.sell')} → ${t('ui.kind.part', '부품')} ${cd.amount ?? 1}${cd.sell_coins ? ` · 코인 ${cd.sell_coins}` : ''}`;
    else if (cd.sell != null) v.footer = `${t('ui.stat.sell')} ${cd.sell}`;
  }
  return v;
}

// 스테미너 말고 따로 내는 비용(코인 · 카드 버리기) — 카드의 "비용 줄"에 아이콘으로(피드백 7)
function extraCosts(N, cd) {
  const out = [];
  for (const b of cd.effect ?? []) {
    if (b.block === 'pay_coin') out.push(`${iconHtml('{coin}')}${b.amount} ${esc(N.t('ui.cost.pay_coin', '지불'))}`);
    if (b.block === 'discard_supply') out.push(`${iconHtml('{supply}')} ${esc(N.t('ui.cost.discard_supply', '').replace('{n}', b.min_sell))}`);
  }
  // 소실 카드(쓰면 게임에서 빠짐, 2026-10-07): 비용 줄에 같이 표시 — 카드 데이터 "exile": true
  if (cd.exile) out.push(`🔥 ${esc(N.t('ui.cost.exile', '쓰면 소실'))}`);
  return out;
}
const richOf = (N, key) => (N.rich ? N.rich(key, '') : esc(N.t(key, '')));

export function missionView(content, N, id, { markers = null } = {}) {
  const m = content.missions[id];
  return {
    id, shape: 'small', title: N.nameOf(m), desc: N.t(m.desc_key, ''), descHtml: richOf(N, m.desc_key), band: MISSION_COLOR[m.category] ?? '#777', glyph: GLYPH.mission,
    kind: `${N.t('ui.kind.mission')} · ${N.t(`ui.mcat.${m.category}`, m.category)}`,
    cost: { value: m.vp, type: 'vp' },
    pips: { total: m.target, filled: markers ?? 0 },
    footer: iconText(rewardText(content, N, m.reward)),
    footerHtml: iconHtml(esc(rewardText(content, N, m.reward))),
  };
}

// assigned: 그 시설에 배치된 생존자 토큰 id 목록(주면 레벨별 필요 인력 충족 여부까지 — 2026-10-04 사용자 피드백 신규 6)
export function facilityView(content, N, fid, level, assigned = null) {
  const f = content.facilities[fid];
  const next = f.levels[level] ?? null;
  const cur = level > 0 ? f.levels[level - 1] : null;
  // 레벨별 필요 인력: 그 레벨 효과는 필요한 생존자가 배치돼 있어야 작동(Z-9)
  const have = { human: 0, animal: 0 };
  for (const tk of assigned ?? []) if (content.tokens?.[tk]) have[content.tokens[tk].kind] += 1;
  const KIND = { human: '👤 사람', animal: '🐾 동물' };
  const staffRows = f.levels.map((L) => {
    const need = L.staff ? Object.entries(L.staff).map(([k, n]) => `${KIND[k] ?? k} ${n}`).join(' · ') : '필요 없음';
    const ok = !L.staff || Object.entries(L.staff).every(([k, n]) => have[k] >= n);
    const built = L.level <= level;
    const state = !L.staff ? '' : assigned == null ? '' : ok ? ' <span class="st-ok">✔ 배치됨</span>' : built ? ' <span class="st-no">✖ 배치 필요 — 효과 꺼짐</span>' : '';
    return `<div class="fac-staff${built ? ' built' : ''}">Lv${L.level} 인력: <b>${need}</b>${state}</div>`;
  }).join('');
  return {
    id: fid, title: N.nameOf(f), band: '#6A7F5A', glyph: GLYPH.facility,
    kind: `Lv ${level} / ${f.max_level}`,
    desc: cur ? N.t(cur.desc_key, '') : N.t(f.lv0_key ?? '', '아직 짓지 않음'),
    descHtml: cur ? richOf(N, cur.desc_key) : f.lv0_key ? richOf(N, f.lv0_key) : '아직 짓지 않음',
    next: next ? N.t(next.desc_key, '') : null,
    nextHtml: next ? richOf(N, next.desc_key) : null,
    cost: next ? { value: next.cost_parts, type: 'part' } : null,
    pips: { total: f.max_level, filled: level },
    footer: next ? `다음 레벨 승점 +${next.vp}${level + 1 === f.max_level ? ` · 첫 Max +${f.first_max_bonus}` : ''}` : '최대 레벨',
    staffHtml: staffRows,
  };
}

function rewardText(content, N, blocks = []) {
  const parts = [];
  for (const b of blocks) {
    if (b.block === 'gain_coin') parts.push(`{coin}+${b.amount}`);
    else if (b.block === 'draw_supply') parts.push(`{supply}${b.amount}장`);
    else if (b.block === 'draw_investigation') parts.push(`{inv}${b.amount}장`);
    else if (b.block === 'draw_player_card') parts.push(`{card}${b.amount}장`);
    else if (b.block === 'gain_material') parts.push(`{part}+${b.amount}`);
    else if (b.block === 'gain_vp') parts.push(`{vp}+${b.amount}`);
  }
  return parts.length ? `보상: ${parts.join(' · ')}` : '';
}

// 카드 DOM
// 모양: 세로 카드(플레이어 · 시설 · 선택지, 실물 63×88) / 작은 카드(보급품 · 조사 · 암시장 · 미션, 44×68).
// 크기(size xs · sm · md · lg)는 배율만 바꾸고, 글이 넘치면 설명 글자를 조금씩 줄인다(fitCard).
// 못 쓰는 카드(disabled)에 note가 있으면 그 이유를 가운데 띠로 보여 준다(예: "사냥꾼 전용", "스테미너 부족").
export function renderCard(v, { size = 'md', note = null, disabled = false, selected = false, back = false } = {}) {
  const e = document.createElement('div');
  e.className = `card card-${size} shape-${back ? 'tall' : v.shape ?? 'tall'}${disabled ? ' disabled' : ''}${selected ? ' selected' : ''}${back ? ' back' : ''}${v.tag ? ' tagged' : ''}`;
  if (back) { e.innerHTML = '<div class="card-back-mark">?</div>'; return e; }
  e.style.setProperty('--band', v.band ?? '#777');
  const costHtml = v.cost ? `<div class="card-cost cost-${v.cost.type}">${v.cost.value}</div>` : '';
  const stats = (v.stats ?? []).map((s) => (s.icon ? `<span class="stat" data-tip="${esc(s.label)}">${iconHtml(`{${s.icon}}`)}<b>${s.value}</b></span>` : `<span class="stat"><b>${s.value}</b>${s.label}</span>`)).join('');
  const pips = v.pips ? `<div class="card-pips">${Array.from({ length: v.pips.total }, (_, i) => `<i class="${i < v.pips.filled ? 'on' : ''}"></i>`).join('')}</div>` : '';
  e.innerHTML = `
    <div class="card-band"><span class="card-title">${esc(v.title)}</span></div>
    ${costHtml}
    ${v.tag ? `<div class="card-tag">${esc(v.tag)}</div>` : ''}
    ${v.owner ? `<div class="card-owner" style="--cc:${v.owner.color}" data-tip="${esc(v.owner.name)} 전용"><span>${v.owner.icon}</span></div>` : ''}
    <div class="card-art"><span class="card-glyph">${v.glyph ?? ''}</span></div>
    <div class="card-kind">${esc(v.kind ?? '')}</div>
    ${pips}
    ${stats ? `<div class="card-stats">${stats}</div>` : ''}
    <div class="card-desc">${v.descHtml ?? esc(v.desc ?? '')}${v.next ? `<div class="card-next">다음: ${v.nextHtml ?? esc(v.next)}</div>` : ''}${v.flavor ? `<div class="card-flavor">${esc(v.flavor)}</div>` : ''}</div>
    ${v.staffHtml ? `<div class="card-staff">${v.staffHtml}</div>` : ''}
    ${v.costs?.length ? `<div class="card-costs">${v.costs.map((c) => `<span>${c}</span>`).join('')}</div>` : ''}
    ${v.footer ? `<div class="card-footer">${v.footerHtml ?? esc(v.footer)}</div>` : ''}
    ${note && disabled ? `<div class="card-reason">${esc(note)}</div>` : note ? `<div class="card-note">${esc(note)}</div>` : ''}`;
  if (size !== 'xs') fitSoon(e);
  return e;
}

// 설명이 카드 밖으로 넘치면 글자를 0.5px씩 줄인다(최소 9px). 화면에 붙은 뒤에 재야 해서 다음 프레임에 한다.
export function fitCard(e) {
  const d = e.querySelector('.card-desc');
  if (!d || !d.clientHeight) return false;
  d.style.fontSize = '';
  let fs = parseFloat(getComputedStyle(d).fontSize);
  while (d.scrollHeight > d.clientHeight + 1 && fs - 0.5 >= 9) { fs -= 0.5; d.style.fontSize = `${fs}px`; }
  e.toggleAttribute('data-overflow', d.scrollHeight > d.clientHeight + 1);
  return true;
}
function fitSoon(e, tries = 4) {
  requestAnimationFrame(() => { if (!fitCard(e) && tries > 0) fitSoon(e, tries - 1); });
}

// 캐릭터 초상 카드(함정 대상 · 대신 맞기 · 대상 고르기)
export function portraitView(content, N, ch, color) {
  const def = content.chars[ch.char];
  return {
    id: ch.id, title: N.nameOf(def), band: color, glyph: def.icon ?? '●',
    kind: `${ch.owner}${ch.cell ? ` · ${N.cellName(ch.cell)}` : ''}`,
    desc: `체력 ${ch.hp}/${ch.max_hp} · 스테미너 ${ch.stamina}/${ch.max_stamina}`,
    stats: [],
  };
}

// 주머니 구성 한 줄(2026-10-04 수정 사항 25): "정밀형 [+1×2] [0×5] [−1] [치명×3] [💀]" — 작은 글씨 = 개수
const TOK = { '+2': '+2', '+1': '+1', '0': '0', '-1': '−1', '-2': '−2', x2: '치명', skull: '💀' };
const TOK_ORDER = ['+2', '+1', '0', '-1', '-2', 'x2', 'skull'];   // JS는 "0" 같은 숫자 키를 먼저 늘어놓아서 순서를 정해 둔다
const TOK_CLS = { '+2': 'up', '+1': 'up', '0': 'zero', '-1': 'down', '-2': 'down', x2: 'crit', skull: 'miss' };
export function pouchHtml(config, id, N, { name = true } = {}) {
  const def = config?.combat?.pouches?.[id];
  if (!def) return '';
  const chips = TOK_ORDER.filter((f) => def[f]).map((f) => `<i class="pc ${TOK_CLS[f] ?? ''}">${TOK[f] ?? f}${def[f] > 1 ? `<small>×${def[f]}</small>` : ''}</i>`).join('');
  return `<span class="pouch-line" data-tip="${esc(N.t(`pouch.${id}.desc`, ''))} — 공격할 때 이 주머니에서 토큰 1개를 꺼내고 다시 넣어요">${name ? `<b>${esc(N.t(`pouch.${id}.name`, id))}</b>` : ''}${chips}</span>`;
}

// 캐릭터 정보 카드: 지금 장비 기준 능력치 · 체력 · 스테미너 · 장비 · 가방 · 특전(2026-10-04 사용자 피드백 27 · 15)
// c = 엔진 문맥 { s, c: content, map }
export function charInfoView(c, N, ch, color) {
  const def = c.c.chars[ch.char];
  const w = weaponOf(c, ch);
  const it = (ic, v) => `<span class="ci-stat">${iconHtml(`{${ic}}`)}<b>${v}</b></span>`;
  const gear = ['weapon', 'armor', 'accessory'].map((k) => ch.equip?.[k]).filter(Boolean).map((id) => N.nameOf(c.c.cards[id]));
  const descHtml = `<div class="ci-stats">${it('atk', w.attack)}${it('range', rangeOf(c, ch))}${it('move', moveOf(c, ch))}${it('def', defenseOf(c, { kind: 'char', ref: ch }))}</div>`
    + `<div class="ci-line">${iconHtml('{hp}')} <b>${ch.hp}/${ch.max_hp}</b> · 스테미너 <b>${ch.stamina}/${ch.max_stamina}</b></div>`
    + `<div class="ci-line">장비: ${gear.length ? esc(gear.join(', ')) : '시작 무기'}</div>`
    + `<div class="ci-line">가방 ${ch.bag.length}/${bagCapacity(c.s, c.c, ch.id)}</div>`
    + `<div class="ci-line">${pouchHtml(c.s.config, charPouchId(c.c, ch), N)}</div>`
    + `<div class="ci-perk">${N.rich(`char.${ch.char}.perk1`, '')}<br>${N.rich(`char.${ch.char}.perk2`, '')}</div>`;
  return {
    id: ch.id, title: N.nameOf(def), band: color, glyph: def.icon ?? '●',
    kind: `${ch.owner}${ch.cell ? ` · ${N.cellName(ch.cell)}` : ''}${ch.exhausted ? ' · 탈진' : ''}`,
    descHtml, stats: [],
  };
}

// 적 카드: 챕터마다 수치가 다르면 Ⅰ · Ⅱ · Ⅲ 3칸 표(지금 챕터 칸 강조) — 2026-10-03 사용자 결정
export function foeView(content, N, f, chapter = 1, mods = null) {
  const d = enemyDefAt(content, f.type, chapter);
  const v = {
    id: f.uid, title: N.nameOf(d), band: d.boss ? '#7A4A8C' : '#8C3A30', glyph: '☠', kind: d.boss ? '보스' : '적',
    desc: `생명력 ${f.hp}/${f.max_hp ?? d.hp}`,
    stats: [{ label: '공격', value: d.attack + (mods?.attack ?? 0) }, { label: '사거리', value: d.range }, { label: '이동', value: d.move + (mods?.move ?? 0) }],
  };
  const tbl = enemyTierTable(content, f.type, chapter, mods);
  // 무기 특수 효과 상태(2026-10-17): 기절 · 속박 · 독 n
  const st = (f.statuses ?? []).map((x) => ({ stunned: '기절(다음 적 차례 행동 못 함)', rooted: '속박(다음 적 차례 이동 못 함)', poison: `독 ${x.turns}(적 차례 시작마다 피해 1)` }[x.status])).filter(Boolean);
  const stHtml = st.length ? `<div class="card-next"><b>상태</b>: ${st.join(' · ')}</div>` : '';
  if (tbl) { v.descHtml = `${iconHtml('{hp}')} 지금 ${f.hp}/${f.max_hp ?? d.hp}${stHtml}${tbl}`; v.stats = []; v.kind = `적 · 챕터 ${['Ⅰ', 'Ⅱ', 'Ⅲ'][chapter - 1]}`; }
  return v;
}
// 적의 챕터별 수치 표(HTML). 챕터 차이가 없는 적(보스 등)은 null
export function enemyTierTable(content, type, chapter = 1, mods = null) {
  const base = content.enemies[type];
  if (!base?.by_chapter) return null;
  const tiers = [1, 2, 3].map((k) => enemyDefAt(content, type, k));
  const vpOf = (d) => (d.reward ?? []).filter((b) => b.block === 'gain_vp').reduce((n, b) => n + b.amount, 0);
  const rows = [['{hp}', (d) => d.hp], ['{atk}', (d) => d.attack + (mods?.attack ?? 0)], ['{move}', (d) => d.move + (mods?.move ?? 0)], ['{range}', (d) => d.range], ['{vp}', vpOf]];
  const head = `<tr><th></th>${['Ⅰ', 'Ⅱ', 'Ⅲ'].map((t, i) => `<th class="${i + 1 === chapter ? 'now' : ''}">${t}</th>`).join('')}</tr>`;
  const body = rows.map(([ic, fn]) => `<tr><td>${iconHtml(ic)}</td>${tiers.map((d, i) => `<td class="${i + 1 === chapter ? 'now' : ''}">${fn(d)}</td>`).join('')}</tr>`).join('');
  return `<table class="tier-tbl">${head}${body}</table>`;
}

// 선택지 카드(넘기기 · 감춰진 보급품 뽑기 등 행동을 카드 모양으로)
// 설명의 아이콘 표기({hp} 등)는 아이콘으로, 줄바꿈 문자는 줄바꿈으로(2026-10-02)
export function optionView(title, desc, { glyph = '✦', band = '#5A5A6A', kind = '' } = {}) {
  const descHtml = desc ? iconHtml(esc(desc)).replace(/\n/g, '<br>') : '';
  return { id: title, title, desc, descHtml, glyph, band, kind, stats: [] };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
