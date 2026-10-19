// 보통 AI: 행동마다 "기대 점수 변화"를 매겨 가장 좋은 것을 고른다(평범한 플레이어 수준).
// 설계: docs/ai-design.md 5장. 수치는 data/ai_profiles.json의 normal 프로필(w = 가중치).
//
// - 이동: 목표(상호작용 칸 · 적 · 보스)까지 남은 행동 수로 할인한 "잠재력"이 커지는 쪽으로, 위험(적 사거리 · 감춰진 적)은 피해서.
// - 보스: 같은 색 조사 카드 3장 + 이번 · 다음 차례에 잡을 수 있을 때만 소환, 다른 플레이어에게서 먼 칸에.
// - 정비: 부품당 승점 효율(첫 Max 보너스 포함)로 시설, 마지막 챕터엔 전부 판매 · 부품 소진. 암시장은 가치 − 코인.
// - 하지 않는 것: 상대 캐릭터 공격(프로필 pvp_attack), 교환 제안. 약탈은 함(프로필 loot).
// 뷰(view)만 본다 — 남의 손패 · 덱 순서를 모른다.

import { cardUse, bagCapacity } from '../engine/query.js';
import { charActionsLeft, activationMode, cardMode, canDo } from '../engine/core.js';
import { attackTargets } from '../engine/query.js';
import { BM_DONE } from './candidates.js';
import { makeRng, pick, lack } from './util.js';
import {
  ctxOf, segD, movesTo, attackOutcome, foesOf, foeStatOf, dangerAt, zoneHit, hurtCost, chapterInfo, keepValue,
  invCounts, wildCount, bossKillValue, enemyKillValue, missionStepValue, missionTriggerValue, cellValue, moveOf, rangeOf, EQUIP, coinW, weaponScore } from './knowledge.js';

export function createNormalController(profile, { seed = 1 } = {}) {
  const r = makeRng(seed);
  return {
    kind: 'normal',
    profile,
    draft({ available }) {
      const pref = profile.draft_priority ?? [];
      return [...available].sort((a, b) => rankOf(pref, a) - rankOf(pref, b))[0] ?? pick(r, available);
    },
    decide(view, tools) {
      const me = makeMe(view, tools, profile, r);
      if (view.pending) {
        const a = decidePending(me);
        if (a && tools.check(a).ok) return a;
      }
      const cands = tools.candidates(view).filter((a) => allowed(me, a));
      const scored = cands.map((a) => ({ a, s: scoreOf(me, a) + r() * 0.01 })).sort((x, y) => y.s - x.s);
      for (const { a, s } of scored) {
        if (s <= profile.w.min_gain && !isCloser(a)) continue;
        if (tools.check(a).ok) return a;
      }
      for (const { a } of scored) if (isCloser(a) && tools.check(a).ok) return a;
      for (const { a } of scored) if (tools.check(a).ok) return a;
      return null;
    },
  };
}

// 높음 AI(ai/hard.js)가 재사용: makeMe · allowed · scoreOf(후보 점수) · potential(목표 잠재력)
const rankOf = (pref, id) => { const i = pref.indexOf(id); return i < 0 ? 99 : i; };
const isCloser = (a) => a.type === 'end_turn' || a.type === 'end_maintenance' || a.type === BM_DONE;

export function makeMe(view, tools, profile, r) {
  const content = tools.content;
  return {
    v: view, c: content, player: tools.player, tools, profile, w: profile.w, r,
    ctx: ctxOf(view, content), map: content.maps[view.map_id], info: chapterInfo(view),
    mine: Object.values(view.chars).filter((c) => c.owner === tools.player),
  };
}

export function allowed(me, a) {
  if (a.type === 'attack' && me.v.chars[a.target] && !me.profile.pvp_attack) return false;
  if (a.type === 'loot' && !me.profile.loot) return false;
  if (a.type === 'use_item' && a.target && me.v.chars[a.target] && me.v.chars[a.target].owner !== me.player) return false;   // 남의 캐릭터 부활은 안 함
  return true;
}

// ---------- 카드 쓸모(손패 정리 · 멀리건) ----------
const CARD_USE = {
  evade: 3, defense_bonus: 2, reduce_damage: 1.5, attack_bonus: 2, dice_advantage: 1.8, extra_attack: 2, range_bonus: 1.2, ricochet: 1.3,   /* ricochet: 도탄 사격(2026-10-18) */
  attack_override: 1.8, move_bonus: 1.5, heal: 2, rest_multiplier: 1.2, transfer_stamina: 0.5,
};
function cardUseful(me, ch, id) {
  const cd = me.c.cards[id];
  if (!cd) return 0;
  const u = cardUse(me.v, me.c, ch.id, id);
  if (!u.implemented || !u.ownerOk || cd.timing === 'maintenance') return 0;
  let v = 0.3;
  for (const b of cd.effect ?? []) {
    v = Math.max(v, CARD_USE[b.block] ?? 0);
    if (b.block === 'grant_status') v = Math.max(v, { defense_up: 1.5, untargetable: 1.5, marked: 1, pass_through_enemies: 1.2, ignore_zone_attacks: 1.2, taunt: 0.3 }[b.status] ?? 0.5);
  }
  return v;
}

// 공용 손패의 카드 쓸모 = 내 캐릭터 중 가장 잘 쓸 수 있는 캐릭터 기준(전용 카드는 주인만)
const handUseful = (me, id) => Math.max(0, ...me.mine.map((ch) => cardUseful(me, ch, id)));
const myHand = (me) => me.v.players[me.player].hand;

// ---------- 선택 대기 ----------
function decidePending(me) {
  const { v, c, player } = me;
  const p = v.pending;
  const choose = (choice) => ({ type: 'choose', player, choice });
  const ch = p.character ? v.chars[p.character] : null;
  switch (p.type) {
    case 'reaction': return decideReaction(me, ch);
    case 'choose_char': return choose([...p.options].sort((a, b) => lack(v.chars[b], p) - lack(v.chars[a], p))[0]);   // 구원자 특전 1(2026-10-17): 실제로 회복되는 양이 가장 큰 캐릭터
    case 'choose_trap_target': {
      const cd = c.cards[p.card];
      const key = cd?.effect?.some((b) => b.block === 'lose_stamina') ? 'stamina' : 'hp';
      return choose([...p.options].sort((a, b) => v.chars[b][key] - v.chars[a][key])[0]);
    }
    case 'camp_pick': return choose([...p.options].sort((a, b) => cardUseful(me, ch, b) - cardUseful(me, ch, a))[0]);
    // 보급품 얻을 때(2026-10-08): 드러난 카드 중 가방 가치가 가장 높은 것이 평균보다 확실히 좋으면 그것, 아니면 감춰진 카드
    case 'supply_source': {
      const slots = p.options.filter((x) => x !== 'hidden');
      const best = slots.map((i) => [i, keepValue(v, c, v.board.open_supply[i], player, me.w)]).sort((a, b) => b[1] - a[1])[0];
      return choose(best && best[1] > 2.5 ? best[0] : 'hidden');
    }
    // 카드 보고 고르기(2026-10-08): 보급품이면 가방 가치, 수색 카드면 습격 · 경보를 피함, 플레이어 카드면 쓸모 순으로 count장
    case 'pick_card': {
      if (p.purpose === 'oracle_search') { const bad = (id) => (c.cards[id]?.effect ?? []).some((b) => b.block === 'spawn_enemy' || b.block === 'noise'); return choose([...p.options].sort((a, b) => bad(a) - bad(b))[0]); }
      const val = p.purpose === 'oracle_supply' ? (id) => keepValue(v, c, id, player, me.w) : (id) => (ch ? cardUseful(me, ch, id) : handUseful(me, id));
      const best = [...p.options].sort((a, b) => val(b) - val(a)).slice(0, p.count);
      return choose(p.count === 1 ? best[0] : best);
    }
    case 'bag_overflow': return choose([...ch.bag].sort((a, b) => keepValue(v, c, a, player, me.w) - keepValue(v, c, b, player, me.w)).slice(0, p.discard_count));
    case 'discard_to_hand_limit': return choose([...myHand(me)].sort((a, b) => handUseful(me, a) - handUseful(me, b)).slice(0, p.count));
    case 'mulligan': return choose(myHand(me).filter((id) => handUseful(me, id) < 1));
    case 'mission_keep': {
      const all = [...new Set([...p.current, ...p.options])];
      const val = (id) => missionWorth(me, id);
      // 2026-10-18: 최소 min_keep장은 남겨야 해서(flow.js), 가치가 0 이하인 미션도 모자라면 가치 순으로 채운다
      const sorted = [...all].sort((a, b) => val(b) - val(a));
      const n = Math.max(p.min_keep ?? 0, sorted.filter((id) => val(id) > 0).length);
      return choose(sorted.slice(0, Math.min(n, p.max_keep)));
    }
    case 'trade_consent': {
      const sum = (ids) => ids.reduce((n, id) => n + keepValue(v, c, id, player), 0);
      return choose(sum(p.give) - sum(p.take) >= me.w.trade_margin ? 'accept' : 'decline');
    }
    case 'bm_bid':
    case 'bm_bid_extra': return decideBid(me);
    // 카드 운용 버전(2026-10-19)
    case 'combo_step': return choose(comboChoice(me, ch, p));
    case 'level_up_pick': return choose([...p.options].sort((a, b) => (c.cards[b].level ?? 1) - (c.cards[a].level ?? 1) || (c.cards[b].stamina ?? 0) - (c.cards[a].stamina ?? 0))[0]);
    case 'level_up_remove': {
      // 가장 약한 카드: Lv1 · 스테미너 낮은 것 · 반응 카드(공격받을 때) 먼저. 손패에 있으면 손패에서(지금 덜 쓸모 있는 카드)
      const P = v.players[player];
      const all = ['hand', 'deck', 'discard'].flatMap((zone) => (P[zone] ?? []).filter((id) => c.cards[id]).map((id) => ({ zone, card: id })));
      const weak = (x) => (c.cards[x.card].level ?? 1) * 10 + (c.cards[x.card].timing === 'on_hit' ? 0 : 3) + (c.cards[x.card].stamina ?? 0);
      return choose(all.sort((a, b) => weak(a) - weak(b))[0]);
    }
    default: return null;   // placement 등은 후보 점수로
  }
}

// 미션 기대 가치: 승점 + 보상 × 달성 가능성(진행 중이면 가산)
function missionWorth(me, id) {
  const { v, c, player } = me;
  const m = c.missions[id];
  const entry = v.players[player].missions.active.find((a) => a.id === id);
  const progress = (entry?.markers ?? 0) / m.target;
  const t = m.trigger;
  // 달성 가능성(대략). PvP 미션은 상대를 공격하지 않으므로 0, 약탈은 기회가 드묾
  const F = { gain_card: 0.8, gain_coin: 0.85, gain_material: 0.8, gain_token: 0.8, facility_level_up: 0.85, facility_max: 0.6,
    survivor_assigned: 0.7, bm_bought: 0.55, full_equip: 0.4, looted: me.profile.loot ? 0.25 : 0, interact_cell: 0.75 };
  let f = F[t.type] ?? 0.7;
  if (t.type === 'attack_damaged' && t.target_kind === 'other_player_character') f = me.profile.pvp_attack ? 0.5 : 0;
  else if (t.type === 'attack_damaged' && t.target_kind === 'boss') f = Math.max(...Object.values(invCounts(v, c, player))) + wildCount(v, c, player) >= 2 || Object.keys(v.bosses).length ? 0.6 : 0.3;
  else if (t.type === 'evade_success') f = myHand(me).some((h) => c.cards[h]?.effect?.some((b) => b.block === 'evade')) ? 0.45 : 0.25;
  else if (t.type === 'interact_cell' && t.cell_type === 'camp') f = 0.5;
  else if (t.type === 'enemy_killed') f = t.enemy ? 0.55 : t.zone ? 0.6 : 0.75;
  if (me.info.last) f *= Math.min(1, me.info.roundsLeft / 3 + 0.2);
  return (m.vp + 0.6 * (m.reward?.length ?? 0)) * Math.min(1, f + progress * 0.6);
}

function decideReaction(me, ch) {
  const { v, c } = me;
  const p = v.pending;
  const pass = { type: 'react', character: ch.id, pass: true };
  const src = v.enemies[p.attacker] ?? v.bosses[p.attacker] ?? null;
  const atkChar = v.chars[p.attacker];
  let power = 3;
  if (src) power = foeStatOf(c, src, 'attack', v);
  else if (atkChar) power = 3;
  const hit = { exp: power * 0.85, max: power * 2 };
  const danger = hit.max >= ch.hp || hit.exp >= me.w.react_min_damage || ch.hp - hit.exp <= 3;
  const wantEscape = missionStepValue(v, c, me.player, 'evade_success') > 0;
  if (!danger && !wantEscape) return pass;
  const opts = me.tools.candidates(v).filter((a) => a.type === 'react' && !a.pass);
  const cost = (a) => {
    let n = 0;
    for (const id of a.cards ?? []) n += cardUseful(me, ch, id) * 0.6 + (c.cards[id].stamina ?? 0) * 0.2;
    for (const id of a.items ?? []) n += keepValue(v, c, id, me.player) * 0.5;
    if (a.discard_supply) n += keepValue(v, c, a.discard_supply, me.player);
    if (a.intercept_by) { const g = v.chars[a.intercept_by]; n += g.hp < hit.max + 2 ? 99 : 1.5; }
    return n;
  };
  const gain = (a) => {
    const blocks = (a.cards ?? []).flatMap((id) => c.cards[id].effect).concat((a.items ?? []).flatMap((id) => c.cards[id].effect));
    if (blocks.some((b) => b.block === 'evade')) return hit.exp + (hit.max >= ch.hp ? me.w.exhaust * 0.4 : 0) + (wantEscape ? 2 : 0);
    let red = 0;
    for (const b of blocks) if (b.block === 'defense_bonus' || b.block === 'reduce_damage') red += b.amount;
    if (a.intercept_by) red = hit.exp * 0.8;
    return Math.min(hit.exp, red) * 1.2 + (hit.max >= ch.hp && hit.max - red < ch.hp ? me.w.exhaust * 0.3 : 0);
  };
  const best = opts.map((a) => ({ a, s: gain(a) - cost(a) })).sort((x, y) => y.s - x.s).find((x) => x.s > 0 && me.tools.check(x.a).ok);
  return best?.a ?? pass;
}

// 암시장 경쟁: 이길 확률 × (얻는 가치 − 내는 카드 가치)가 가장 큰 카드. 모두 손해면 가장 아까운 게 적은 카드.
function decideBid(me) {
  const { v, c, player } = me;
  const p = v.pending;
  const bids = me.tools.candidates(v).filter((a) => a.type === 'bm_bid');
  if (!bids.length) return null;
  const prize = bmValue(me, p.card);
  // 이길 확률 × (얻는 가치 − 내는 카드 가치). 포기(card: null)는 0 — 모든 입찰이 손해면 포기한다(AC-2)
  const scoreBid = (a) => {
    if (a.card == null) return 0;
    const sell = c.cards[a.card]?.sell ?? 0;
    const win = sell / (sell + 3);
    return win * (prize - keepValue(v, c, a.card, player, me.w));
  };
  return bids.sort((x, y) => scoreBid(y) - scoreBid(x))[0];
}

function bmValue(me, id) {
  const { v, c, player } = me;
  const cd = c.cards[id];
  if (!cd) return 0;
  if (cd.kind === 'weapon') return me.mine.some((ch) => weaponScore(cd) > weaponScore(curWeapon(me, ch)) + 0.01) ? keepValue(v, c, id, player) + 2 : (cd.sell ?? 0) * coinW(c);
  if (cd.kind === 'material') return (cd.amount ?? 1) * me.w.part;   // 재료 카드는 팔면 부품 토큰
  return keepValue(v, c, id, player);
}
// 지금 든 무기(없으면 시작 무기) — 2026-10-17 공격력만 보던 weaponAtk를 점수 비교(weaponScore)로 바꿈
const curWeapon = (me, ch) => (ch.equip?.weapon ? me.c.cards[ch.equip.weapon] : me.c.chars[ch.char].starting_weapon);

// ---------- 후보 점수(기대 점수 변화) ----------
export function scoreOf(me, a) {
  const { v } = me;
  if (v.turn.phase === 'maintenance') return maintScore(me, a);
  if (v.turn.phase === 'black_market') return bmScore(me, a);
  if (a.type === 'place_character') return placeScore(me, a);
  return turnScore(me, a);
}

// 이 캐릭터의 목표들: 상호작용 칸 · 처치할 적 · 보스
export function goalsFor(me, ch) {
  const key = `g:${ch.id}`;
  if (me[key]) return me[key];
  const { v, c, w, map } = me;
  const out = [];
  const other = me.mine.find((o) => o.id !== ch.id && !o.exhausted && o.cell != null);
  for (const cell of map.cells) {
    let val = cellValue(v, c, ch, cell.id, w);
    if (val <= 0) continue;
    if (cell.type === 'camp' && ch.hp / ch.max_hp > 0.5) continue;
    // 다른 내 캐릭터가 더 가까운 칸은 그쪽 몫
    if (other && segD(map, other.cell, cell.id) < segD(map, ch.cell, cell.id)) val *= 0.5;
    out.push({ cell: cell.id, value: val, kind: 'cell' });
  }
  const range = rangeOf(me.ctx, ch);
  for (const f of foesOf(v)) {
    const boss = !!v.bosses[f.uid];
    const o = attackOutcome(v, c, ch, { kind: 'foe', ref: f });
    const kv = boss ? bossKillValue(v, c, f.type, ch, w.vp_bias ?? 1) : enemyKillValue(c, f, v, w.vp_bias ?? 1) + killMission(me, f, boss);
    const hits = Math.max(1, f.hp / Math.max(0.3, o.exp));
    let val = kv / hits;
    if (boss) val *= hits <= 5 ? w.boss_chase : 0.2;
    out.push({ cell: f.cell, value: val, kind: 'foe', range });
  }
  me[key] = out;
  return out;
}

export function potential(me, ch, cell) {
  const move = moveOf(me.ctx, ch);
  let best = 0;
  for (const g of goalsFor(me, ch)) {
    let t;
    if (g.kind === 'foe') {
      const d = segD(me.map, cell, g.cell);
      t = d <= g.range ? 0 : Math.ceil(((d - g.range) * 1.4) / move);
    } else t = movesTo(me.map, cell, g.cell, move);
    if (!Number.isFinite(t)) continue;
    best = Math.max(best, g.value * Math.pow(me.w.gamma, t));
  }
  return best;
}

// 이 칸에 도착하면 바로(행동 1번으로) 쓸 수 있는 목표 가치: 그 칸의 상호작용 · 사거리 안의 적
function arriveValue(me, ch, cell) {
  let best = 0;
  let foe = 0, here = 0;
  for (const g of goalsFor(me, ch)) {
    const now = g.kind === 'foe' ? segD(me.map, cell, g.cell) <= g.range : g.cell === cell;
    if (!now) continue;
    best = Math.max(best, g.value);
    if (g.kind === 'foe') foe = Math.max(foe, g.value); else here = Math.max(here, g.value);
  }
  // 활성화 방식: 도착한 뒤 공격도 하고 그 칸 상호작용도 할 수 있음 → 둘 다(2026-10-04)
  return activationMode(me.v) ? foe + here : best;
}
// 활성화 방식: 상호작용을 하면 그 캐릭터 행동이 끝나서 아직 안 한 공격 기회를 잃음 → 지금 할 수 있는 가장 좋은 공격 점수
function forfeitAttack(me, ch) {
  if (!activationMode(me.v) || !canDo(me.v, ch.id, 'attack')) return 0;
  if (cardMode(me.v) && !hasAttackCard(me, ch)) return 0;   // 카드 운용 버전: 공격할 카드가 없으면 잃을 공격도 없음(2026-10-18)
  let best = 0;
  for (const tg of attackTargets(me.v, me.c, ch.id)) {
    if (me.v.chars[tg.id] && !me.profile.pvp_attack) continue;
    best = Math.max(best, turnScore(me, { type: 'attack', character: ch.id, target: tg.id }));
  }
  return best;
}

const late = (me) => me.info.roundsLeft <= 1;
function endDanger(me, ch, cell) {
  // 이 캐릭터의 마지막 행동이면 그 자리에서 적 차례를 맞음(활성화 방식은 이동이 한 번뿐이라 도착 칸이 곧 마지막 자리)
  const k = activationMode(me.v) || charActionsLeft(me.v, ch.id) <= 1 ? 1 : 0.6;
  return hurtCost(ch, dangerAt(me.v, me.c, ch, cell, { w: me.w }), me.w, { lateChapter: late(me) }) * k;
}
function zoneCost(me, ch) {
  const hit = zoneHit(me.v, me.c, ch, ch.cell);
  if ((ch.statuses ?? []).some((s) => s.status === 'ignore_zone_attacks')) return 0;
  return hurtCost(ch, hit, me.w, { lateChapter: late(me) });
}
const cardCost = (me, ids) => (ids ?? []).reduce((n, id) => n + (me.c.cards[id]?.stamina ?? 0) * me.w.stamina + 0.8, 0);
// 카드 운용 버전(2026-10-18): 기본 아이콘으로 낸 카드의 값 — 공용 카드는 싸게, 전용 카드(스킬을 버리는 것)는 조금 더.
// 스테미너는 라운드 끝에 다 차므로 무겁게 보지 않는다(설정 recovery.round_end.stamina = full)
const basicCost = (me, id) => (!id ? 0 : 0.25 + (me.c.cards[id]?.char ? 0.35 : 0));
// 카드 운용 버전: 이 캐릭터가 지금 낼 수 있는 공격 카드(기본 공격 아이콘 · 공격할 때 스킬)가 손에 있나
function hasAttackCard(me, ch) {
  const hand = me.v.players[ch.owner]?.hand ?? [];
  return hand.some((id) => { const cd = me.c.cards[id]; return cd && (!cd.char || cd.char === ch.char) && (cd.basic === 'attack' || cd.timing === 'on_attack'); });
}

function turnScore(me, a) {
  const { v, c, w, player } = me;
  const ch = a.character ? v.chars[a.character] : null;
  switch (a.type) {
    case 'move': {
      const end = a.path[a.path.length - 1];
      let gain = potential(me, ch, end) - potential(me, ch, ch.cell);
      // 이번 차례 안에 도착해서 바로 쓸 목표(이동 → 상호작용 · 공격)면 진행도가 아니라 목표 가치로 본다(F3e).
      // 진행도(잠재력 차이)만 보면 한 칸 앞 목표도 가치의 20%만 쳐서, 도착 칸의 위험에 밀려 차례를 그냥 끝냈다.
      // 카드 운용 버전(2026-10-18): 이동 뒤에도 카드가 있으면 공격 · 상호작용을 이어서 할 수 있음 — 예전엔 charActionsLeft가 늘 1이라
      // 도착 가치를 안 보고 차례를 그냥 끝냈다(AI 10판: 바로 종료 차례 22%)
      if (charActionsLeft(v, ch.id) >= 2 || cardMode(v)) gain = Math.max(gain, arriveValue(me, ch, end) * w.arrive);   // 이 캐릭터에게 행동이 남아야(캐릭터마다 행동 n번 설정 포함)
      const risk = endDanger(me, ch, end) - endDanger(me, ch, ch.cell);
      return gain - risk - zoneCost(me, ch) - cardCost(me, a.cards) - basicCost(me, a.basic) - w.action * 0.2;
    }
    case 'interact': {
      const here = c.maps[v.map_id].cells.find((x) => x.id === ch.cell);
      let val;
      if (here.type === 'supply' && typeof a.option === 'object') {
        val = keepValue(v, c, v.board.open_supply[a.option.open], player) + 0.3
          + missionTriggerValue(v, c, player, { type: 'gain_card', kind: 'supply', count: 1 })
          + missionTriggerValue(v, c, player, { type: 'interact_cell', cell_type: 'supply', zone: here.zone ?? null });
      } else if (here.type === 'camp' && !activationMode(v)) {
        val = cellValue(v, c, ch, ch.cell, w) - (charActionsLeft(v, ch.id) - 1) * w.action;   // 캠프: 그 캐릭터의 남은 행동 손해(예전 규칙이면 차례 전체)
      } else val = cellValue(v, c, ch, ch.cell, w);
      // 활성화 방식: 상호작용 = 이 캐릭터 끝 → 아직 이동 · 공격이 남았으면 그 손해
      if (activationMode(v)) val -= forfeitAttack(me, ch) + (canDo(v, ch.id, 'move') ? w.action * 0.3 : 0);
      return val - zoneCost(me, ch);
    }
    case 'attack': {
      const f = v.enemies[a.target] ?? v.bosses[a.target];
      if (!f) return -1;
      const boss = !!v.bosses[a.target];
      const o = attackOutcome(v, c, ch, { kind: 'foe', ref: f }, a.cards ?? []);
      const kv = boss ? bossKillValue(v, c, f.type, ch, w.vp_bias ?? 1) : enemyKillValue(c, f, v, w.vp_bias ?? 1) + killMission(me, f, boss);
      // 처치 기대값 + 깎아 둔 체력의 일부 가치(보스는 남이 막타를 칠 수도) + 위협 제거
      let val = o.pKill * kv + (1 - o.pKill) * (Math.min(o.exp, f.hp) / f.hp) * kv * (boss ? w.boss_chip : 0.35);
      if (boss && o.exp >= 1) val += missionStepValue(v, c, player, 'attack_damaged', (m) => m.trigger.target_kind === 'boss') * 0.8;
      const threat = me.mine.filter((x) => !x.exhausted && x.cell != null).reduce((n, x) => n + hurtCost(x, dangerAt(v, c, x, x.cell, {}), w) - hurtCost(x, dangerAt(v, c, x, x.cell, { ignore: [f.uid] }), w), 0);
      val += o.pKill * threat * 0.8;
      // 범위 공격 카드(2026-10-19): 대상 주변의 다른 적 수만큼 더(한 마리당 이 공격 가치의 절반쯤)
      const area = (a.cards ?? []).flatMap((id) => c.cards[id].effect).find((b) => b.block === 'attack_area');
      if (area) val += [...Object.values(v.enemies), ...Object.values(v.bosses)].filter((x) => x.uid !== f.uid && x.cell != null && segD(me.map, x.cell, f.cell) <= (area.radius ?? 1)).length * Math.max(0.5, val * 0.5);
      return val - cardCost(me, a.cards) - basicCost(me, a.basic) - o.coins * coinW(c);
    }
    case 'rest': {
      // 휴식은 회복(heal) 또는 카드 뽑기(draw) 중 하나(2026-10-02). mode가 없으면 예전 규칙(둘 다)
      const handRoom = v.config.hand.max_per_player - myHand(me).length;
      const drawV = handRoom >= 2 ? 0.8 : handRoom === 1 ? 0.3 : -0.5;
      if (a.mode === 'draw') return drawV - zoneCost(me, ch) - w.action * 0.3;
      const perk = c.chars[ch.char].perks.filter((p) => p.hook === 'on_rest').flatMap((p) => p.effect).reduce((n, b) => n + (b.hp ?? 0), 0);
      const factor = a.cards?.length ? 2 : 1;
      const heal = Math.min(ch.max_hp - ch.hp, (v.config.recovery.rest.hp + perk) * factor);
      const st = Math.min(ch.max_stamina - ch.stamina, v.config.recovery.rest.stamina * factor);
      const hpW = w.hp * (1 + (1 - ch.hp / ch.max_hp)) * (late(me) ? 0.3 : 1);
      const draw = a.mode === 'heal' ? 0 : Math.max(0, drawV) * 0.4;
      return heal * hpW + st * w.stamina * 0.5 + draw - zoneCost(me, ch) - cardCost(me, a.cards) - w.action * 0.3;
    }
    case 'resupply': {
      const n = v.config.hand.max_per_player - myHand(me).length;
      return (n >= 2 ? n * 0.45 : 0) - zoneCost(me, ch) - w.action * 0.3;
    }
    case 'loot': {
      const gain = a.take.reduce((n, id) => n + keepValue(v, c, id, player), 0);
      return gain - zoneCost(me, ch) - w.action * 0.3;
    }
    case 'equip': return betterEquip(me, ch, a.item) ? 6 : -1;
    case 'use_item': return itemScore(me, ch, a);
    case 'play_card': return playScore(me, ch, a);
    case 'spawn_boss': return spawnScore(me, a);
    case 'revive_infirmary': {
      const cost = reviveCost(me);
      const value = me.info.roundsLeft * w.char_round - (v.turn.actions_left === 0 ? w.char_round * 0.5 : 0);
      if (value <= cost + 0.5) return -1;
      const chAt = { ...v.chars[a.character], cell: a.cell, exhausted: false };
      return value - cost + potential(me, chAt, a.cell) * 0.2 - hurtCost(chAt, dangerAt(v, c, chAt, a.cell), w) * 0.3;
    }
    case 'end_turn': return 0;
    default: return -1;
  }
}

// 이 적을 처치하면 진행되는 미션 가치(구역 색 · 적 종류 포함)
function killMission(me, f, boss) {
  const zone = me.map.cells.find((x) => x.id === f.cell)?.zone ?? null;
  return missionTriggerValue(me.v, me.c, me.player, { type: 'enemy_killed', boss, enemy: f.type, zone });
}

function reviveCost(me) {
  const { v, c } = me;
  let cost = v.config.revive.infirmary_cost_by_chapter[v.game.chapter - 1] ?? 0;
  const lv = v.shelter[me.player].facilities.f_infirmary ?? 0;
  for (const L of c.facilities.f_infirmary?.levels ?? []) if (L.level <= lv) for (const b of L.effect) if (b.block === 'mod_revive' && b.cost) cost += b.cost;
  return Math.max(0, cost);
}

function betterEquip(me, ch, id) {
  const { c } = me;
  const cd = c.cards[id];
  const eq = ch.equip ?? {};
  const wScore = weaponScore;   // 특수 효과까지 보는 공용 점수(ai/knowledge.js, 2026-10-17 — 예전엔 공격력 · 사거리 · 관통만)
  if (cd.kind === 'weapon') {
    const cur = eq.weapon ? c.cards[eq.weapon] : c.chars[ch.char].starting_weapon;
    return wScore(cd) > wScore(cur) + 0.01;
  }
  const aScore = (x) => (x ? (x.defense ?? 0) + (x.passive ?? []).reduce((n, b) => n + (b.block === 'stat_mod' ? (b.stat === 'move' ? b.amount * 1.2 : b.stat === 'bag' ? b.amount * 0.3 : 0) : b.block === 'forbid_evade' ? -0.3 : 0), 0) : 0);
  if (cd.kind === 'armor') return aScore(cd) > aScore(eq.armor ? c.cards[eq.armor] : null) + 0.01;
  const xScore = (x) => (x ? (x.passive ?? []).reduce((n, b) => n + (b.block === 'stat_mod' ? (b.stat === 'weapon_range' ? 1.5 : b.stat === 'bag' ? b.amount * 0.5 : 0.5) : 0.6), 0) : 0);
  if (cd.kind === 'accessory') return xScore(cd) > xScore(eq.accessory ? c.cards[eq.accessory] : null) + 0.01;
  return false;
}

function itemScore(me, ch, a) {
  const { v, c, w, player } = me;
  const cd = c.cards[a.item];
  const has = (n) => cd.effect.find((b) => b.block === n);
  const keep = keepValue(v, c, a.item, player);
  if (has('revive')) {
    const t = v.chars[a.target];
    return t?.owner === player ? me.info.roundsLeft * w.char_round + reviveCost(me) - keep * 0.3 : -1;
  }
  if (has('deal_damage')) {
    const f = v.enemies[a.target] ?? v.bosses[a.target];
    if (!f) return -1;
    const boss = !!v.bosses[a.target];
    const dmg = has('deal_damage').amount;
    const targets = has('deal_damage').target === 'all_enemies_in_cell' ? foesOf(v).filter((x) => x.cell === f.cell && !v.bosses[x.uid]) : [f];
    let val = 0;
    for (const t of targets) {
      const kv = v.bosses[t.uid] ? bossKillValue(v, c, t.type, ch, w.vp_bias ?? 1) : enemyKillValue(c, t, v, w.vp_bias ?? 1) + killMission(me, t, false);
      val += dmg >= t.hp ? kv : (dmg / t.hp) * kv * (boss ? w.boss_chip : 0.3);
    }
    return val - keep;
  }
  if (has('heal')) {
    const amt = has('heal').hp === 'full' ? ch.max_hp : has('heal').hp;
    const heal = Math.min(ch.max_hp - ch.hp, amt);
    return heal * w.hp * (1 + (1 - ch.hp / ch.max_hp)) * (late(me) ? 0.3 : 1) - keep;
  }
  if (has('restore_stamina')) return ch.stamina <= 2 ? 1 - keep * 0.5 : -1;
  if (has('grant_status')) {
    // 연막 · 통행증: 적이 있는 칸에서 남은 행동 동안 구역 공격을 막음
    const z = zoneCost(me, ch);
    return z > 0 && v.turn.actions_left >= 2 ? z * Math.min(v.turn.actions_left, 3) * 0.6 - keep : -1;
  }
  return -1;
}

// 연속 행동 단계 고르기(2026-10-19): 공격 = 쓰러뜨릴 수 있는 적 → 체력 낮은 적(상대 캐릭터는 PvP 성향일 때만), 이동 = 다음 공격 단계 사거리 안에 적이 많은 칸 · 위험이 적은 칸
function comboChoice(me, ch, p) {
  const { v, c } = me;
  if (p.step === 'attack') {
    const foes = p.options.filter((id) => v.enemies[id] || v.bosses[id]);
    const pick = foes.map((id) => [id, turnScore(me, { type: 'attack', character: ch.id, target: id })]).sort((a, b) => b[1] - a[1])[0];
    if (pick) return pick[0];
    const chars = p.options.filter((id) => v.chars[id]);
    return me.profile.pvp_attack && chars.length ? chars[0] : 'skip';
  }
  const cdx = c.cards[p.card];
  const steps = cdx?.effect.find((b) => b.block === 'combo')?.steps ?? [];
  const next = steps.slice(p.index + 1).find((s) => s.attack);
  const range = next ? next.attack.range ?? rangeOf(me.ctx, ch) : 0;
  const foes = [...Object.values(v.enemies), ...Object.values(v.bosses)].filter((f) => f.cell != null);
  const val = (cell) => {
    const near = foes.filter((f) => segD(me.map, cell, f.cell) <= range).length;
    const closest = Math.min(99, ...foes.map((f) => segD(me.map, cell, f.cell)));
    const risk = hurtCost(ch, dangerAt(v, c, ch, cell, { w: me.w }), me.w);
    return (next ? near * 3 - closest * 0.2 : potential(me, ch, cell)) - risk * (next ? 0.3 : 1);
  };
  return [...p.options].sort((a, b) => val(b) - val(a))[0];
}

function playScore(me, ch, a) {
  const { v, c, w } = me;
  const cd = c.cards[a.card];
  // 카드 운용 버전 기본 기능 "카드 2장 뽑기"(2026-10-19): 차례 끝에 5장까지만 남으므로, 뽑은 뒤 손패가 넘치지 않을 때 값어치
  if (a.as === 'basic') {
    const hand = v.players[me.player].hand.length - 1 + (v.config.card_mode?.basic_draw ?? 2);
    return hand <= (v.config.hand.turn_end_keep ?? 5) + 1 ? 0.9 : 0.1;
  }
  const cost = cardCost(me, [a.card]);
  // 연속 행동: 닿을 수 있는 적에게 공격 단계 수만큼(대략)
  const combo = cd.effect.find((b) => b.block === 'combo');
  if (combo) {
    const moves = combo.steps.reduce((n, s) => n + (s.move ?? 0), 0);
    const hits = combo.steps.filter((s) => s.attack).length;
    const best = Math.max(-1, ...attackTargets(v, c, ch.id, { rangeBonus: moves }).filter((t) => v.enemies[t.id] || v.bosses[t.id]).map((t) => turnScore(me, { type: 'attack', character: ch.id, target: t.id })));
    return best <= 0 ? -1 : best * (1 + (hits - 1) * 0.6) - cost * 0.5;
  }
  // 여러 내 캐릭터 회복 · 스테미너 · 카드 뽑기 카드(카드 운용 버전 사냥 준비 · 치유의 손길 · 격려 등)
  if (cd.effect.some((b) => ['my_chars_in_range', 'my_chars', 'my_char'].includes(b.target)) || (cd.effect.every((b) => ['restore_stamina', 'draw_player_card', 'heal'].includes(b.block)) && cd.effect.some((b) => b.block !== 'heal'))) {
    let val = 0;
    for (const b of cd.effect) {
      const who = b.target === 'my_char' ? [v.chars[a.target]].filter(Boolean)
        : b.target === 'my_chars' ? me.mine.filter((x) => !x.exhausted && x.cell != null)
        : b.target === 'my_chars_in_range' ? me.mine.filter((x) => !x.exhausted && x.cell != null && segD(me.map, x.cell, ch.cell) <= (b.range ?? 1))
        : [ch];
      for (const t of who) {
        if (b.block === 'heal') val += Math.min(t.max_hp - t.hp, b.hp) * w.hp * (late(me) ? 0.3 : 1);
        if (b.block === 'restore_stamina') val += Math.min(t.max_stamina - t.stamina, b.amount === 'full' ? 99 : b.amount) * 0.35;
      }
      if (b.block === 'draw_player_card') val += b.amount * 0.5;
    }
    return val > 0.2 ? val - cost : -1;
  }
  for (const b of cd.effect) {
    if (b.block === 'heal') {
      const t = v.chars[a.target] ?? ch;   // 대상 없는 회복(숨 고르기)은 쓰는 캐릭터
      const st = cd.effect.find((x) => x.block === 'restore_stamina');
      const stVal = st ? Math.min(t.max_stamina - t.stamina, st.amount) * 0.35 : 0;
      return Math.min(t.max_hp - t.hp, b.hp) * w.hp * (1 + (1 - t.hp / t.max_hp)) * (late(me) ? 0.3 : 1) + stVal - cost;
    }
    if (b.block === 'grant_status' && b.status === 'defense_up') return v.turn.actions_left <= 1 ? dangerAt(v, c, ch, ch.cell).exp * 0.6 - cost : -1;
    if (b.block === 'grant_status' && b.status === 'untargetable') return v.turn.actions_left <= 1 ? hurtCost(ch, dangerAt(v, c, ch, ch.cell), w) * 0.8 - cost : -1;
    if (b.block === 'grant_status' && b.status === 'marked') {
      const f = v.bosses[a.target];
      return f && v.turn.actions_left >= 2 ? 1.2 - cost * 0.5 : -1;
    }
    if (b.block === 'transfer_stamina') {
      const t = v.chars[a.target];
      return t && t.id !== ch.id && t.stamina <= 2 && ch.stamina >= 4 ? 0.8 - cost : -1;
    }
    // 브로커 카드(2026-10-03): 자산 정리 · 뇌물 · 투자
    if (b.block === 'sell_now') {
      const sellable = ch.bag.filter((id) => id !== 'part' && c.cards[id]?.sell != null);
      if (!sellable.length) return -1;
      const best = Math.max(...sellable.map((id) => (c.cards[id].sell + sellBonus(me)) * coinW(c) - keepValue(v, c, id, me.player) * 0.8));
      const full = ch.bag.length >= bagCapacity(v, c, ch.id);
      return best + (full ? 0.6 : 0) - cost * 0.5;
    }
    if (b.block === 'take_open_supply') {
      const pay = cd.effect.find((x) => x.block === 'pay_coin')?.amount ?? 0;
      if (v.players[me.player].coins < pay) return -1;
      const best = Math.max(-1, ...v.board.open_supply.filter(Boolean).map((id) => keepValue(v, c, id, me.player)));
      return best - pay * coinW(c) - cost * 0.5;
    }
    if (b.block === 'gain_vp') {
      const pay = cd.effect.find((x) => x.block === 'pay_coin')?.amount ?? 0;
      if (v.players[me.player].coins < pay) return -1;
      return b.amount - pay * coinW(c) + 0.3 - (c.cards[a.card].stamina ?? 0) * w.stamina;
    }
  }
  return -1;
}
// 판매 특성 보너스(브로커: 내 캐릭터 누가 팔아도 +1)
const sellBonus = (me) => me.mine.reduce((n, x) => n + me.c.chars[x.char].perks.filter((p) => p.hook === 'on_sell').flatMap((p) => p.effect).filter((e) => e.block === 'gain_coin').reduce((k, e) => k + e.amount, 0), 0);

// 보스 소환: 이번 차례 남은 행동 + 다음 차례로 잡을 수 있을 만큼 기대 피해가 나오는가
function spawnScore(me, a) {
  const { v, c, w, map, player } = me;
  const act = activationMode(v);
  if (!act && v.turn.actions_left < w.boss_min_actions) return -1;
  if (!act && me.info.roundsLeft < 2 && v.turn.actions_left < 4) return -1;
  const cell = map.cells.find((x) => x.id === a.cell);
  const type = map.boss_zones?.[cell.zone] ?? c.zoneBoss[cell.zone];
  const def = c.enemies[type];
  const fake = { uid: '_boss', type, cell: a.cell, hp: def.hp, max_hp: def.hp };
  let dmg = 0;
  if (act) {
    // 활성화 방식(2026-10-04): 캐릭터마다 차례에 공격 1번(이동 뒤에도 가능). 이번 차례(아직 공격 안 했으면) + 다음 라운드 1번
    for (const ch of me.mine.filter((x) => !x.exhausted && x.cell != null)) {
      const d = segD(map, ch.cell, a.cell);
      const reachNow = canDo(v, ch.id, 'move') ? d <= rangeOf(me.ctx, ch) + moveOf(me.ctx, ch) / 1.4 : d <= rangeOf(me.ctx, ch);
      const swings = (reachNow && canDo(v, ch.id, 'attack') ? 1 : 0) + (me.info.roundsLeft >= 2 ? 1 : 0);
      dmg += swings * attackOutcome(v, c, ch, { kind: 'foe', ref: fake }).exp;
    }
    const killA = Math.min(1, dmg / def.hp);
    if (killA < w.boss_spawn_confidence) return -1;
    return spawnValue(me, a, def, type, killA);
  }
  let actions = v.turn.actions_left + (me.info.roundsLeft >= 2 ? v.config.actions_per_turn : 0);
  const active = me.mine.filter((x) => !x.exhausted && x.cell != null).sort((x, y) =>
    attackOutcome(v, c, y, { kind: 'foe', ref: { ...fake } }).exp - attackOutcome(v, c, x, { kind: 'foe', ref: { ...fake } }).exp);
  for (const ch of active) {
    const d = segD(map, ch.cell, a.cell);
    const range = rangeOf(me.ctx, ch);
    const moves = d <= range ? 0 : Math.ceil(((d - range) * 1.4) / moveOf(me.ctx, ch));
    const use = Math.max(0, Math.min(actions, 5) - moves);
    dmg += use * attackOutcome(v, c, ch, { kind: 'foe', ref: fake }).exp;
    actions -= use + moves;
    if (actions <= 0) break;
  }
  const kill = Math.min(1, dmg / def.hp);
  if (kill < w.boss_spawn_confidence) return -1;
  return spawnValue(me, a, def, type, kill);
}
// 보스를 부를 때의 가치: 처치 가치 × 처치 확률 × (막타를 뺏기지 않을 확률) − 보스 사거리 안 내 캐릭터 − 쓴 조사 카드
function spawnValue(me, a, def, type, kill) {
  const { v, c, map, player } = me;
  const active = me.mine.filter((x) => !x.exhausted && x.cell != null);
  // 다른 플레이어 캐릭터가 가까우면 막타를 뺏길 수 있다
  let steal = 0;
  for (const o of Object.values(v.chars)) {
    if (o.owner === player || o.exhausted || o.cell == null) continue;
    if (segD(map, o.cell, a.cell) <= 3) steal += 0.2;
  }
  // 우리 캐릭터가 보스 사거리 안에 서 있으면 적 차례에 맞는다
  const hurt = active.reduce((n, ch) => n + (segD(map, ch.cell, a.cell) <= def.range ? 1 : 0), 0);
  const used = a.cards.reduce((n, id) => n + keepValue(v, c, id, player) * 0.2, 0);
  return bossKillValue(v, c, type, active[0], me.w.vp_bias ?? 1) * kill * Math.max(0.2, 1 - steal) - hurt * 1.5 - used;
}

function placeScore(me, a) {
  const { v, c, w } = me;
  const ch = { ...v.chars[a.character], cell: a.cell };
  let s = potential(me, ch, a.cell) - hurtCost(ch, dangerAt(v, c, ch, a.cell, { w }), w);
  // 내 다른 캐릭터와는 조금 떨어져서(목표를 나눠 갖게)
  const other = me.mine.find((o) => o.id !== ch.id && o.cell != null);
  if (other && segD(me.map, other.cell, a.cell) <= 2) s -= 1;
  for (const o of Object.values(v.chars)) if (o.owner !== me.player && o.cell != null && segD(me.map, o.cell, a.cell) <= 1) s -= 0.5;
  return s + 5;
}

// ---------- 정비 ----------
function maintScore(me, a) {
  const { v, c, player } = me;
  const last = me.info.last;
  const ch = a.character ? v.chars[a.character] : null;
  switch (a.type) {
    case 'equip': return betterEquip(me, ch, a.item) ? 80 : -1;
    case 'sell': {
      const cd = c.cards[a.card];
      // 재료 카드는 팔아야 부품 토큰이 된다(업그레이드보다 먼저, 2026-10-01)
      if (cd.kind === 'material') return 150;
      if (last) return 60 + (cd.sell ?? 0);
      if (EQUIP.has(cd.kind)) return me.mine.some((x) => betterEquip(me, x, a.card)) ? -1 : 40;
      return keepValue(v, c, a.card, player) <= (cd.sell ?? 0) * coinW(c) + 0.01 ? 40 : -1;
    }
    case 'upgrade_facility': {
      const fac = c.facilities[a.facility];
      const lv = v.shelter[player].facilities[a.facility] ?? 0;
      if (lv >= fac.max_level) return -1;
      const L = fac.levels[lv];
      let gain = L.vp;
      if (lv + 1 === fac.max_level) {
        const claimed = v.game.first_max_claimed[a.facility];
        if (claimed === undefined || claimed === v.game.chapter) gain += fac.first_max_bonus;
      }
      if (!last) gain += futureFacility(me, a.facility, lv + 1);
      gain += missionStepValue(v, c, player, 'facility_level_up');
      gain -= (L.cost_coins ?? 0) * coinW(c);   // 코인 비용(2026-10-02)
      return (last ? 70 : 30) + gain / Math.max(1, L.cost_parts) * 10;
    }
    case 'use_item': {   // 정비 때 쓰는 연구 카드(보고서: 코인)
      const cdx = c.cards[a.item];
      return cdx?.kind === 'research' && cdx.timing === 'maintenance' ? 30 : -1;
    }
    case 'place_survivor': {
      const sh = v.shelter[player];
      const fac = c.facilities[a.facility];
      const lv = sh.facilities[a.facility] ?? 0;
      const tok = c.tokens[a.survivor];
      let s = 10;
      for (const L of fac.levels) {
        if (L.level > lv || !L.staff) continue;
        const need = L.staff[tok.kind] ?? 0;
        const have = (sh.assigned[a.facility] ?? []).filter((t) => c.tokens[t].kind === tok.kind).length;
        if (have < need) s = 50;
      }
      if (tok.assigned_bonus?.facility === a.facility) s += 10;
      return s;
    }
    case 'retrieve': {
      const cd = c.cards[a.card];
      if (!cd || last) return -1;
      return cd.kind === 'consumable' || cd.kind === 'investigation' ? 15 : -1;
    }
    case 'end_maintenance': return 1;
    default: return -1;
  }
}

// 시설 효과의 앞으로의 가치(남은 챕터 동안)
function futureFacility(me, fid, level) {
  const n = me.info.chaptersLeft;
  if (fid === 'f_workshop') return level === 1 ? 1.5 * Math.min(n, 2) : 0.5 * n;
  if (fid === 'f_radio') return 2 * n;
  if (fid === 'f_garden') return 0.6 * n;
  if (fid === 'f_infirmary') return 0.3 * n;
  if (fid === 'f_lab') return 0.8 * n;   // 연구실(2026-10-18): 연구 카드를 쓸 수 있게 됨 — 초안 값
  return 0;
}

// ---------- 암시장 칩 놓기 ----------
function bmScore(me, a) {
  const { v, c } = me;
  if (a.type === BM_DONE) return 0.2;
  if (a.type !== 'bm_place' || a.card == null) return -1;
  if (Object.values(v.board.bm_place).some((l) => l.includes(me.player))) return -1;   // 이미 한 장 골랐음(플레이어당 1장)
  // 받을 곳: 가방에 자리가 있는 캐릭터(없으면 창고)
  const roomy = me.mine.find((x) => x.bag.length < c.chars[x.char].bag)?.id ?? 'storage';
  if (a.to !== roomy) return -1;
  const cd = c.cards[a.card];
  const placed = v.board.bm_place[a.card] ?? [];
  const coins = v.players[me.player].coins;
  // 혼자 사면 특성 할인(브로커 -2)
  const disc = me.mine.reduce((n, x) => n + c.chars[x.char].perks.filter((p) => p.hook === 'passive').flatMap((p) => p.effect).filter((e) => e.block === 'mod_black_market_cost').reduce((k, e) => k + e.amount, 0), 0);
  const price = Math.max(0, (cd.cost ?? 0) + (placed.length ? 0 : disc));
  const net = bmValue(me, a.card) - price * coinW(c);
  if (price > coins && !placed.length) return -1;
  return net > me.w.bm_margin ? net : -1;
}
