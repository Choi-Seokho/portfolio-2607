// 쉬움 AI: 규칙을 배우는 상대. 단순한 우선순위로 움직이고, 가끔 비효율 행동을 한다.
// 수치(실수 확률 · 체력 기준 · 반응 확률 등)는 data/ai_profiles.json의 easy 프로필에서 읽는다.
//
// 방식: 후보 액션마다 "쉬운 점수"를 매기고(높을수록 먼저), 엔진이 받아들이는 첫 후보를 낸다. 점수 0 이하는 안 한다.
//   장비 교체 90 · 부활 95 · 아군 부활 아이템 95 · 눈앞의 적 공격 80 · 상호작용 70 · 회복 60 ·
//   다음 목표 칸으로 이동 40~ · 재정비 · 휴식 · 차례 종료 순
// 하지 않는 것(프로필로 조절): 상대 플레이어 공격(pvp_attack) · 약탈(loot) · 교환 제안(후보에 없음).
// 뷰(view)만 본다 — 남의 손패 · 덱 순서를 알 수 없다.

import { segDist } from '../engine/map.js';
import { cellBlockReason } from '../engine/core.js';
import { ctxOf, weaponScore } from './knowledge.js';
import { isNear } from '../engine/query.js';
import { INTERACT_TYPES } from '../engine/supply.js';
import { HIDDEN } from '../engine/view.js';
import { BM_DONE } from './candidates.js';
import { makeRng, pick, lack } from './util.js';

const EQUIP = new Set(['weapon', 'armor', 'accessory']);

export function createEasyController(profile, { seed = 1 } = {}) {
  const r = makeRng(seed);
  const memo = new Map();                       // 차례 · 챕터마다 한 번만 굴리는 결정(보스 소환 여부 · 암시장 칩)
  const once = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };

  return {
    kind: 'easy',
    profile,

    // 캐릭터 드래프트(화면 밖 설정 단계): 남은 캐릭터 중 무작위
    draft({ available }) { return pick(r, available); },

    decide(view, tools) {
      const player = tools.player;
      const content = tools.content;
      const me = { v: view, c: content, player, r, profile, once, tools };

      let action = view.pending ? decidePending(me) : null;
      if (action && !tools.check(action).ok) action = null;
      if (action) return action;

      // 후보를 걸러(PvP · 약탈 금지) 점수 순으로 시험 제출
      const cands = tools.candidates(view).filter((a) => allowed(me, a));
      if (!cands.length) return null;
      const scored = cands.map((a) => ({ a, s: score(me, a) }));
      if (!view.pending && r() < profile.mistake_rate) {
        // 가끔 비효율 행동: 점수와 무관하게 (차례 종료 · 보스 소환 · 암시장 정산 아닌) 아무 후보나
        const loose = cands.filter((a) => !['end_turn', 'spawn_boss', 'end_maintenance', BM_DONE, 'revive_infirmary'].includes(a.type));
        for (let i = 0; i < 3 && loose.length; i++) {
          const a = pick(r, loose);
          if (tools.check(a).ok) return a;
        }
      }
      scored.sort((x, y) => y.s - x.s);
      for (const { a, s } of scored) {
        if (s <= 0 && !isFallback(a)) break;
        if (tools.check(a).ok) return a;
      }
      // 점수 있는 후보가 전부 거절됐으면 아무 합법 후보(게임이 멈추지 않게)
      for (const { a } of scored) if (tools.check(a).ok) return a;
      return null;
    },
  };
}

const isFallback = (a) => a.type === 'end_turn' || a.type === 'end_maintenance' || a.type === BM_DONE;

function allowed(me, a) {
  if (a.type === 'attack' && me.v.chars[a.target] && !me.profile.pvp_attack) return false;
  if (a.type === 'loot' && !me.profile.loot) return false;
  return true;
}

// ---------- 값어치(버릴 카드 · 제출할 카드 고를 때) ----------
function itemValue(c, id) {
  if (id === 'part') return 3;
  if (id === HIDDEN) return 0;
  const cd = c.cards[id];
  if (!cd) return 0;
  if (cd.kind === 'investigation') return 6;
  if (EQUIP.has(cd.kind)) return 8;
  if (cd.effect?.some((b) => b.block === 'revive')) return 9;
  return Math.max(1, cd.sell ?? 1);
}
const sellOf = (c, id) => (id === 'part' ? 0 : c.cards[id]?.sell ?? 0);
const lowest = (c, list, n) => [...list].sort((a, b) => itemValue(c, a) - itemValue(c, b)).slice(0, n);

// ---------- 선택 대기 ----------
function decidePending({ v, c, player, r, profile, tools }) {
  const p = v.pending;
  const choose = (choice) => ({ type: 'choose', player, choice });
  const ch = p.character ? v.chars[p.character] : null;
  switch (p.type) {
    case 'reaction': {
      if (r() >= profile.react_rate) return { type: 'react', character: p.character, pass: true };
      // 회피 > 방어 카드 > 아이템 > 대신 맞기 순으로, 엔진이 받아들이는 첫 반응
      const rank = (a) => {
        const cards = (a.cards ?? []).map((id) => c.cards[id]);
        if (cards.some((cd) => cd.effect.some((b) => b.block === 'evade'))) return 0;
        if (cards.length) return 1;
        if (a.items) return 2;
        return 3;
      };
      const opts = tools.candidates(v).filter((a) => a.type === 'react' && !a.pass).sort((x, y) => rank(x) - rank(y));
      return opts.find((a) => tools.check(a).ok) ?? { type: 'react', character: p.character, pass: true };
    }
    case 'choose_trap_target': return choose([...p.options].sort((a, b) => v.chars[b].hp - v.chars[a].hp)[0]);
    case 'camp_pick': return choose(pick(r, p.options));
    case 'choose_char': return choose([...p.options].sort((a, b) => lack(v.chars[b], p) - lack(v.chars[a], p))[0]);   // 구원자 특전 1(2026-10-17): 덜 찬 캐릭터
    case 'supply_source': return choose(pick(r, p.options));   // 2026-10-08
    case 'pick_card': { const sh = [...p.options].sort(() => r() - 0.5).slice(0, p.count); return choose(p.count === 1 ? sh[0] : sh); }   // 2026-10-08
    case 'bag_overflow': return choose(lowest(c, ch.bag, p.discard_count));
    case 'discard_to_hand_limit': return choose([...v.players[player].hand].sort(() => r() - 0.5).slice(0, p.count));
    case 'mulligan': {
      const hand = v.players[player].hand;
      if (r() >= profile.mulligan_rate || !hand.length) return choose([]);
      return choose([pick(r, hand)]);
    }
    case 'mission_keep': {
      // 진행 중인 미션은 유지하고, 남는 자리를 무작위로 채운다
      const keep = [...p.current];
      const rest = [...p.options].sort(() => r() - 0.5);
      while (keep.length < p.max_keep && rest.length) keep.push(rest.shift());
      return choose(keep.slice(0, p.max_keep));
    }
    case 'trade_consent': return choose(r() < profile.trade_accept ? 'accept' : 'decline');
    case 'bm_bid':
    case 'bm_bid_extra': {
      // 경쟁: 가장 값싼 카드를 몰래 낸다
      const bids = tools.candidates(v).filter((a) => a.type === 'bm_bid' && a.card != null);
      return bids.sort((a, b) => sellOf(c, a.card) - sellOf(c, b.card))[0] ?? { type: 'bm_bid', player, card: null };
    }
    case 'placement': return null;   // 후보(시작 칸)에서 점수로 고른다
    default: return null;
  }
}

// ---------- 후보 점수 ----------
const hpRatio = (ch) => ch.hp / ch.max_hp;
const noisy = (me, s) => s + me.r() * 2;   // 같은 점수끼리는 무작위

function score(me, a) {
  const s = scoreOf(me, a);
  if (s <= 0) return s;
  return noisy(me, s);
}

// 지금 아직 갈 가치가 있는 상호작용 칸(마커 없는 칸, 캠프는 다쳤을 때만)
function goals(me, ch) {
  const { v, c } = me;
  const out = [];
  for (const cell of c.maps[v.map_id].cells) {
    if (!INTERACT_TYPES.has(cell.type)) continue;
    if (cell.type === 'camp') { if (hpRatio(ch) < 0.6) out.push(cell.id); continue; }
    if (cellBlockReason(ctxOf(v, c), cell, ch)) continue;   // 다 쓴 칸 · 이 캐릭터가 이미 쓴 칸
    out.push(cell.id);
  }
  return out;
}

function nearestDist(me, cell, list) {
  let best = Infinity;
  for (const g of list) best = Math.min(best, segDist(me.c.maps[me.v.map_id], cell, g));
  return best;
}

function foesIn(v, cell) {
  return [...Object.values(v.enemies), ...Object.values(v.bosses)].filter((f) => f.cell === cell);
}

function isHiddenEnemyCell(me, cellId) {
  const cell = me.c.maps[me.v.map_id].cells.find((x) => x.id === cellId);
  return cell?.type === 'enemy' && !me.v.board.markers.includes(cellId) && foesIn(me.v, cellId).length === 0;
}

function betterEquip(c, ch, id) {
  const cd = c.cards[id];
  const eq = ch.equip ?? {};
  if (cd.kind === 'weapon') {
    // 2026-10-17: 공격력만 비교하던 것을 특수 효과까지 보는 점수로(ai/knowledge.js weaponScore)
    return weaponScore(cd) > weaponScore(eq.weapon ? c.cards[eq.weapon] : c.chars[ch.char].starting_weapon) + 0.01;
  }
  if (cd.kind === 'armor') return (cd.defense ?? 0) > (eq.armor ? c.cards[eq.armor].defense ?? 0 : 0);
  if (cd.kind === 'accessory') return !eq.accessory;
  return false;
}

function scoreOf(me, a) {
  const { v, c, player, profile, r, once } = me;
  const ch = a.character ? v.chars[a.character] : null;
  const turnKey = `${v.game.chapter}.${v.game.round}.${player}`;

  switch (a.type) {
    case 'equip': return betterEquip(c, ch, a.item) ? 90 : 0;
    case 'revive_infirmary': return 95;

    case 'attack': {
      if (a.cards?.length) return 0;
      const f = v.enemies[a.target] ?? v.bosses[a.target];
      if (!f) return 0;
      const same = isNear(v, c, f.cell, ch.cell);   // 같은 칸(예전) 또는 옆 칸(한 칸에 하나 규칙) = 붙어 있는 적
      if (same) return 80;
      if (v.bosses[a.target]) return 0;             // 멀리 있는 보스는 쫓지 않는다
      return hpRatio(ch) >= profile.attack_min_hp ? 55 : 0;
    }

    case 'interact': {
      const cell = c.maps[v.map_id].cells.find((x) => x.id === ch.cell);
      if (cell.type === 'camp') return hpRatio(ch) < 0.6 || v.players[player].hand.length <= 2 ? 60 : 0;
      return typeof a.option === 'object' ? 65 : 70;
    }

    case 'move': {
      if (a.cards?.length) return 0;
      const end = a.path[a.path.length - 1];
      if (foesIn(v, end).length || isHiddenEnemyCell(me, end)) return 0;
      const gl = goals(me, ch);
      if (!gl.length) return 0;
      const d0 = nearestDist(me, ch.cell, gl);
      const d1 = nearestDist(me, end, gl);
      if (d1 >= d0) return 0;
      return 40 + (d0 - d1) * 5 + (d1 === 0 ? 15 : 0);
    }

    case 'rest': {
      if (a.cards?.length) return 0;
      if (foesIn(v, ch.cell).length) return 0;
      const handRoom = v.config.hand.max_per_player - v.players[player].hand.length;
      if (a.mode === 'draw') return handRoom >= 2 ? 7 : handRoom === 1 ? 3 : 0;   // 휴식 = 회복 또는 카드(2026-10-02)
      if (hpRatio(ch) < profile.rest_below_hp) return 60;
      if (ch.stamina / ch.max_stamina < 0.3) return 25;
      if (ch.hp < ch.max_hp) return 8;
      if (!a.mode && handRoom > 0) return 6;
      return 0.5;
    }
    case 'resupply': {
      if (foesIn(v, ch.cell).length) return 0;
      const n = v.players[player].hand.length;
      return n <= 2 ? 35 : n <= 3 ? 15 : 1;
    }

    case 'play_card': {
      const cd = c.cards[a.card];
      const heal = cd.effect.find((b) => b.block === 'heal' && b.target === 'same_cell_ally');
      if (!heal) return 0;
      const t = v.chars[a.target];
      const deficit = t.max_hp - t.hp;
      return deficit >= 2 ? 50 + deficit : 0;
    }

    case 'use_item': {
      const cd = c.cards[a.item];
      const has = (name) => cd.effect.find((b) => b.block === name);
      if (has('revive')) return v.chars[a.target]?.owner === player ? 95 : 0;
      if (has('deal_damage')) {
        const f = v.enemies[a.target] ?? v.bosses[a.target];
        if (!f || v.bosses[a.target] || hpRatio(ch) < 0.4) return 0;
        return 60;
      }
      if (has('heal')) return ch.max_hp - ch.hp >= 3 || hpRatio(ch) < 0.5 ? 65 : 0;
      if (has('restore_stamina')) return ch.stamina <= 3 ? 50 : 0;
      return 0;
    }

    case 'spawn_boss': return once(`boss:${turnKey}`, () => r() < profile.boss_spawn_rate) ? 25 : 0;

    case 'place_character': return 5;

    // 정비: 장비 교체 90 > 재료 판매(부품 토큰으로) 70 > 보물 판매 60 > 생존자 배치 50 > 시설(싼 것부터) 40 − 비용
    case 'sell': return { material: 70, treasure: 60 }[c.cards[a.card]?.kind] ?? 0;
    case 'place_survivor': return 50;
    case 'upgrade_facility': {
      const fac = c.facilities[a.facility];
      const lv = v.shelter[player].facilities[a.facility] ?? 0;
      if (lv >= fac.max_level) return 0;
      return 40 - fac.levels[lv].cost_parts - (fac.levels[lv].cost_coins ?? 0) * 0.5;
    }

    // 암시장: 프로필 확률로 챕터마다 캐릭터별로 한 번만 칩을 놓는다(살 수 있는 카드 중 무작위)
    case 'bm_place': {
      if (a.card == null) return 0;
      if (Object.values(v.board.bm_place).some((l) => l.includes(player))) return 0;   // 이미 골랐으면 그대로
      const roomy = (id) => id !== 'storage' && v.chars[id].bag.length < c.chars[v.chars[id].char].bag;
      const dest = Object.values(v.chars).find((x) => x.owner === player && roomy(x.id))?.id ?? 'storage';
      if (a.to !== dest) return 0;
      const plan = once(`bm:${v.game.chapter}:${player}`, () => (r() < profile.bm_place_rate ? r() : -1));
      if (plan < 0) return 0;
      const coins = v.players[player].coins;
      const affordable = v.board.black_market.filter((id) => (c.cards[id]?.cost ?? 0) <= coins);
      if (!affordable.length) return 0;
      return affordable[Math.floor(plan * affordable.length)] === a.card ? 30 : 0;
    }

    case 'end_turn': return 1;
    case 'end_maintenance': return 0.5;
    case BM_DONE: return 0.5;
    default: return 0;
  }
}
