// AI 판단 도구(보통 · 높음 공용): 뷰(view)만 보고 계산하는 "게임 감각".
//   - 거리 · 이동 비용 표, 공격 예상 피해 분포(엔진과 같은 주사위 공식), 칸의 위험도,
//     아이템 · 목표 칸 · 적 처치 · 미션 진행의 가치 — 전부 "최종 점수(승점 + 코인)" 단위로 맞춘다.
//   - 가중치는 프로필(data/ai_profiles.json)의 w 값으로 조절한다.
// 엔진 규칙 함수(core.js의 weaponOf · defenseOf 등)를 그대로 빌려 쓴다 — 규칙을 따로 흉내 내다 어긋나지 않게.

import { weaponOf, defenseOf, moveOf, rangeOf, perksWithHook, condOk, enemyDefAt, cellBlockReason, pouchTokens, charPouchId, foePouchId, cellTier, tierBonus } from '../engine/core.js';
import { graph, segDist, stepEdge } from '../engine/map.js';
import { HIDDEN } from '../engine/view.js';
import { INTERACT_TYPES } from '../engine/supply.js';

export const FACES = ['+1', '+2', '0', '0', '-1', '-2', 'x2', 'skull'];   // 예전 주사위(주머니 설정이 없을 때)
const FACES_DEFAULT = FACES;
const RANK = { x2: 6, '+2': 5, '+1': 4, '0': 3, '-1': 2, '-2': 1, skull: 0 };
const EQUIP = new Set(['weapon', 'armor', 'accessory']);

// 무기 점수(장착 · 암시장 판단 공용, 2026-10-17): 공격력 + 사거리 × 0.35 + 관통 + 특수 효과(on_hit) 어림값.
// 효과 값은 "공격력 몇 점쯤"으로 어림(기절은 확률 반영, 독은 횟수만큼). 숫자는 플레이 데이터로 조정할 것
const HIT_VALUE = { stun: 1.2, root: 0.5, poison: 0.35, knockback: 0.3, lifesteal: 0.5 };
export function weaponScore(w) {
  if (!w) return 0;
  let s = (w.attack ?? 0) + (w.range ?? 1) * 0.35 + ((w.passive ?? []).some((b) => b.block === 'ignore_armor') ? 0.3 : 0);
  for (const b of w.on_hit ?? []) {
    const chance = b.faces ? 0.45 : 1;
    s += (HIT_VALUE[b.block] ?? 0.3) * chance * (b.block === 'poison' ? b.turns ?? 1 : 1) + (b.collision ? 0.3 : 0);
  }
  return s;
}

export const ctxOf = (view, content) => ({ s: view, c: content, map: content.maps[view.map_id], events: [] });
// 코인 1개의 점수 가치(최종 점수 = 승점 + 코인 × coin_value, 2026-10-02부터 0.5)
export const coinW = (content) => content?.config?.scoring?.coin_value ?? 1;

// ---------- 거리 표(맵마다 한 번) ----------
const tables = new WeakMap();
function table(map) {
  let t = tables.get(map);
  if (t) return t;
  const ids = map.cells.map((c) => c.id);
  const seg = new Map();
  const cost = new Map();
  const { adj } = graph(map);
  for (const a of ids) {
    for (const b of ids) seg.set(`${a}|${b}`, segDist(map, a, b));
    // 캐릭터 이동 비용(그래플링 없이, 적 무시) — 다익스트라
    const d = new Map([[a, 0]]);
    const open = [a];
    while (open.length) {
      open.sort((x, y) => d.get(x) - d.get(y));
      const c = open.shift();
      for (const e of adj.get(c)) {
        const st = stepEdge(map, c, e.to);
        if (!st || st.blocked) continue;
        const nd = d.get(c) + st.cost;
        if (!d.has(e.to) || nd < d.get(e.to)) { d.set(e.to, nd); open.push(e.to); }
      }
    }
    for (const b of ids) cost.set(`${a}|${b}`, d.get(b) ?? Infinity);
  }
  t = { seg, cost, ids };
  tables.set(map, t);
  return t;
}
export const segD = (map, a, b) => (a == null || b == null ? Infinity : table(map).seg.get(`${a}|${b}`) ?? Infinity);
export const moveCost = (map, a, b) => (a == null || b == null ? Infinity : table(map).cost.get(`${a}|${b}`) ?? Infinity);
// 이 캐릭터가 a에서 b까지 가는 데 드는 이동 행동 수(대략)
export const movesTo = (map, a, b, move) => (a === b ? 0 : Math.ceil(moveCost(map, a, b) / Math.max(1, move)));

// ---------- 공격 예상 피해 ----------
// spec: {base, bonus, rolls, extras, override, ignore_armor, no_dice, faces} — 엔진 attackTask와 같은 모양
// faces: 공격하는 쪽 주머니의 토큰 목록(2026-10-04 수정 사항 25). 없으면 예전 주사위 면
export function damageDist(spec, def) {
  const FACES = spec.faces ?? FACES_DEFAULT;
  const power = spec.base + (spec.bonus ?? 0);
  const one = (face) => {
    let raw;
    if (spec.no_dice) raw = power;
    else if (spec.override === 'double_weapon') raw = spec.base * 2;
    else if (face === 'skull') raw = 0;
    else if (face === 'x2') raw = power * 2;
    else raw = Math.max(0, power + Number(face));
    return Math.max(0, raw - (spec.ignore_armor ? 0 : def));
  };
  if (spec.no_dice || spec.override === 'double_weapon') return [{ d: one(null), p: 1, skull: false }];
  // 여러 번 꺼내 가장 좋은 토큰(dice_advantage) — 같은 토큰은 한 번만 계산
  const rolls = spec.rolls ?? 1;
  const out = [];
  for (const f of new Set(FACES)) {
    // P(최고 면 = f) = P(모두 ≤ f) − P(모두 < f)
    const le = FACES.filter((x) => RANK[x] <= RANK[f]).length / FACES.length;
    const lt = FACES.filter((x) => RANK[x] < RANK[f]).length / FACES.length;
    const p = Math.pow(le, rolls) - Math.pow(lt, rolls);
    out.push({ d: one(f), p, skull: f === 'skull' });
  }
  return out;
}
export const expectOf = (dist) => dist.reduce((n, x) => n + x.d * x.p, 0);
export const pAtLeast = (dist, hp) => dist.reduce((n, x) => n + (x.d >= hp ? x.p : 0), 0);
export const maxOf = (dist) => Math.max(...dist.map((x) => x.d));

// 캐릭터의 공격 스펙(무기 + on_attack 특전 + 함께 쓰는 카드)
export function attackSpec(view, content, ch, target, cards = []) {
  const ctx = ctxOf(view, content);
  const w = weaponOf(ctx, ch);
  const spec = { base: w.attack, bonus: 0, rolls: 1, extras: 0, override: null, ignore_armor: w.passive.some((b) => b.block === 'ignore_armor'), coins: 0, faces: pouchTokens(view.config, charPouchId(content, ch)) };
  const d = segD(ctx.map, ch.cell, target.cell);
  const apply = (blocks) => {
    for (const b of blocks) {
      if (b.block === 'attack_bonus') spec.bonus += b.per === 'bag_count' ? Math.min(ch.bag.length, b.max ?? Infinity) : b.amount;
      if (b.block === 'dice_advantage') spec.rolls = Math.max(spec.rolls, b.rolls);
      if (b.block === 'extra_attack') spec.extras += 1;
      if (b.block === 'attack_override') spec.override = b.mode;
      if (b.block === 'pay_coin') spec.coins += b.amount;
    }
  };
  for (const p of perksWithHook(ctx, ch, 'on_attack')) if (condOk(ctx, ch, p.condition, { distance: d })) apply(p.effect);
  for (const id of cards) apply(content.cards[id]?.effect ?? []);
  return spec;
}

// 대상에게 한 번 공격할 때: 기대 피해 · 처치 확률(추가 공격은 대략 반영)
export function attackOutcome(view, content, ch, target, cards = []) {
  const spec = attackSpec(view, content, ch, target, cards);
  const def = target.kind === 'char' ? defenseOf(ctxOf(view, content), { kind: 'char', ref: target.ref }) : foeDefense(content, target.ref, view);
  const dist = damageDist(spec, def);
  let exp = expectOf(dist);
  let pKill = pAtLeast(dist, target.ref.hp);
  if (spec.extras) { exp *= 1 + 0.8 * spec.extras; pKill = Math.min(1, pKill + (1 - pKill) * 0.5 * spec.extras); }
  return { exp, pKill, max: maxOf(dist), coins: spec.coins };
}
// 적 카드 수치는 챕터마다 다르다(enemyDefAt). view가 없으면 1챕터 값
const defOf = (content, type, view) => enemyDefAt(content, type, view?.game?.chapter ?? 1) ?? {};
export const foeDefense = (content, f, view = null) => f.defense ?? defOf(content, f.type, view).defense ?? 0;
// view를 주면 맵 보정(enemy_mods, 일반 적만)까지 — 엔진 foeStat과 같은 값
export const foeStatOf = (content, f, k, view = null) => f[k] ?? ((defOf(content, f.type, view)[k] ?? 0) + (view && !view.bosses?.[f.uid] ? content.maps[view.map_id]?.enemy_mods?.[k] ?? 0 : 0));
export const foesOf = (view) => [...Object.values(view.enemies), ...Object.values(view.bosses)];

// 적 한 번의 공격이 이 캐릭터에게 주는 피해(기대 · 최대)
export function incoming(view, content, ch, attackPower, foe = null) {
  const def = defenseOf(ctxOf(view, content), { kind: 'char', ref: ch });
  const faces = pouchTokens(view.config, foePouchId(content, view.config, foe, view.game?.chapter ?? 1));   // 적 주머니
  const dist = damageDist({ base: attackPower, faces }, def);
  return { exp: expectOf(dist), max: maxOf(dist) };
}

// ---------- 위험도 ----------
export function isHiddenEnemyCell(view, content, cellId) {
  const cell = content.maps[view.map_id].cells.find((c) => c.id === cellId);
  return cell?.type === 'enemy' && !view.board.markers.includes(cellId) && !foesOf(view).some((f) => f.cell === cellId);
}

// 이 캐릭터가 cell에서 적 차례를 맞을 때 예상 피해(대략). 다른 캐릭터가 더 가까우면 덜 노린다.
export function dangerAt(view, content, ch, cell, { ignore = [], w = null } = {}) {
  const map = content.maps[view.map_id];
  let exp = 0;
  let max = 0;
  const others = Object.values(view.chars).filter((c) => c.id !== ch.id && !c.exhausted && c.cell != null);
  for (const f of foesOf(view)) {
    if (ignore.includes(f.uid)) continue;
    const d = segD(map, f.cell, cell);
    const range = Math.max(map.one_per_cell ? 1 : 0, foeStatOf(content, f, 'range', view));
    const sight = foeStatOf(content, f, 'sight', view);
    const reach = range + Math.floor(foeStatOf(content, f, 'move', view) / 1.4);
    let p = 0;
    if (d <= range) p = 1;
    else if (d <= Math.min(sight, reach)) p = 0.7;
    else continue;
    // 더 가까운 다른 캐릭터가 있으면 그쪽을 노릴 가능성
    if (others.some((o) => segD(map, f.cell, o.cell) < d)) p *= 0.4;
    const hit = incoming(view, content, ch, foeStatOf(content, f, 'attack', view), f);
    exp += hit.exp * p;
    max += hit.max * (p >= 0.7 ? 1 : 0);
  }
  const mode = map.enemy_cells?.reveal ?? view.config.enemy_cells?.reveal ?? 'on_enter';
  if (mode === 'on_enter' && isHiddenEnemyCell(view, content, cell) && cell !== ch.cell) { exp += 2.2; max += 5; }
  // 위험 구역(2026-10-03): 이 칸에 서면 새로 나타날 적(아직 안 열린 적 칸 중 radius 안) — 어떤 적인지 모르니 워커로 어림
  if (mode === 'danger_zone') {
    const r = map.enemy_cells?.radius ?? 2;
    const atk = (defOf(content, 'walker', view).attack ?? 2) + (map.enemy_mods?.attack ?? 0);
    for (const c of map.cells) {
      if (c.type !== 'enemy' || !isHiddenEnemyCell(view, content, c.id)) continue;
      const d = segD(map, c.id, cell);
      if (d > r || segD(map, c.id, ch.cell) <= r) continue;   // 이미 안에 있으면(이미 열렸어야 함) 새 위험 아님
      const p = (d <= 1 ? 0.9 : 0.6) * (w?.dz_risk ?? 1);   // w.dz_risk: 위험 구역을 얼마나 겁내나(프로필)
      const hit = incoming(view, content, ch, atk);
      exp += hit.exp * p;
      max += hit.max;
    }
  }
  return { exp, max };
}

// 칸 안의 적이 비공격 행동마다 거는 공격(구역 공격)
export function zoneHit(view, content, ch, cell) {
  let exp = 0;
  let max = 0;
  for (const f of foesOf(view)) {
    if (f.cell !== cell) continue;
    const h = incoming(view, content, ch, foeStatOf(content, f, 'attack', view), f);
    exp += h.exp; max += h.max;
  }
  return { exp, max };
}

// 피해를 점수로: 체력이 적을수록 비싸고, 탈진 위험은 크게(행동 손실 · 부활 코인 · 약탈)
export function hurtCost(ch, hit, w, { lateChapter = false } = {}) {
  if (hit.exp <= 0) return 0;
  const ratio = Math.max(0, ch.hp - hit.exp) / ch.max_hp;
  let c = hit.exp * w.hp * (1 + (1 - ratio));
  if (hit.exp >= ch.hp) c += w.exhaust;
  else if (hit.max >= ch.hp) c += w.exhaust * 0.3;
  return lateChapter ? c * 0.5 : c;
}

// ---------- 가치 ----------
export function chapterInfo(view) {
  const cfg = view.config;
  return {
    last: view.game.chapter >= cfg.chapters,
    roundsLeft: cfg.rounds_per_chapter - view.game.round + 1,   // 이번 라운드 포함
    chaptersLeft: cfg.chapters - view.game.chapter,               // 이번 챕터 제외
  };
}

// 아이템을 "가지고 있을 때"의 가치(점수 단위). 판매가 = 최소 가치(정비에서 코인 = 점수로 바꿀 수 있음)
export function keepValue(view, content, id, owner = null, w = null) {
  if (id === HIDDEN) return 1.5;
  const info = chapterInfo(view);
  if (id === 'part') return info.last && view.turn.phase === 'maintenance' ? 0 : w?.part ?? 1.3;
  const cd = content.cards[id];
  if (!cd) return 0;
  const sell = (cd.sell ?? 0) * coinW(content);
  let use = 0;
  if (cd.kind === 'investigation' || (cd.passive ?? []).some((b) => b.block === 'wild_investigation')) {
    // 같은 색을 많이 모았을수록 보스에 가깝다
    const mine = owner ? invCounts(view, content, owner) : {};
    const n = cd.wild ? Math.max(0, ...Object.values(mine)) : (mine[cd.color] ?? 0);
    use = 2 + n * 2;
  } else if (cd.kind === 'weapon') use = sell + 1;
  else if (cd.kind === 'armor') use = sell + (cd.defense ?? 0) * 0.6;
  else if (cd.kind === 'accessory') use = sell + 1;
  else if (cd.kind === 'survivor') use = w?.survivor ?? 2.5;   // 토큰 카드(2026-10-07): 쉘터로 가져가 배치할 일손
  else if (cd.kind === 'research') use = w?.research ?? 2;
  else if (cd.kind === 'consumable') {
    const e = cd.effect ?? [];
    if (e.some((b) => b.block === 'revive')) use = 5;
    else if (e.some((b) => b.block === 'deal_damage')) use = 3.5;
    else if (e.some((b) => b.block === 'heal')) use = 2.5;
    else use = 2;
  }
  return Math.max(sell, info.last && view.turn.phase === 'maintenance' ? sell : use);
}

// 플레이어가 가진(가방) 조사 카드 색별 수(만능 제외)
export function invCounts(view, content, player) {
  const out = { blue: 0, yellow: 0, red: 0 };
  // 쉘터 창고의 조사 카드도 센다(2026-10-18 — 창고 카드로도 보스 탐색 가능)
  const ids = [...Object.values(view.chars).filter((ch) => ch.owner === player).flatMap((ch) => ch.bag), ...(view.shelter?.[player]?.storage ?? [])];
  for (const id of ids) {
    const cd = content.cards[id];
    if (cd?.kind === 'investigation' && !cd.wild && out[cd.color] != null) out[cd.color]++;
  }
  return out;
}
export function wildCount(view, content, player) {
  let n = 0;
  const ids = [...Object.values(view.chars).filter((ch) => ch.owner === player).flatMap((ch) => ch.bag), ...(view.shelter?.[player]?.storage ?? [])];   // 창고도(2026-10-18)
  for (const id of ids) {
    const cd = content.cards[id];
    if (cd?.wild || (cd?.passive ?? []).some((b) => b.block === 'wild_investigation')) n++;
  }
  return n;
}

// 보스를 잡으면 얻는 점수(보스 승점 + 순서 보너스 + 보상 코인 · 보급품 + 추적자 특전)
// vpW: 승점에 더 주는 가중(프로필 w.vp_bias — 2026-10-04 사용자 결정 "AI는 승점을 가장 높게 받는 행동을 우선")
export function bossKillValue(view, content, type, killerChar = null, vpW = 1) {
  const def = content.enemies[type];
  const order = view.config.scoring.boss_kill_order_bonus[view.game.bosses_killed_count] ?? 0;
  let v = order * vpW;
  for (const b of def.reward ?? []) {
    if (b.block === 'gain_vp') v += b.amount * vpW;
    if (b.block === 'gain_coin') v += b.amount * coinW(content);
    if (b.block === 'draw_supply') v += b.amount * 1.6;
  }
  if (killerChar) for (const p of content.chars[killerChar.char].perks) if (p.hook === 'on_boss_kill') for (const b of p.effect) if (b.block === 'gain_vp') v += b.amount * vpW;
  return v;
}

export function enemyKillValue(content, f, view = null, vpW = 1) {
  let v = 0;
  for (const b of defOf(content, f.type, view).reward ?? []) {
    if (b.block === 'gain_coin') v += b.amount * coinW(content);
    if (b.block === 'draw_supply') v += b.amount * 1.6;
    if (b.block === 'gain_vp') v += b.amount * vpW;
  }
  return v;
}

// 엔진(missions.js)과 같은 미션 조건 판정: 적힌 값이 모두 같으면 진행(exclude_boss만 특별)
export function missionMatches(m, trig) {
  const tr = m.trigger;
  if (tr.type !== trig.type) return false;
  for (const [k, v] of Object.entries(tr)) {
    if (k === 'type') continue;
    if (k === 'exclude_boss') { if (v && trig.boss) return false; continue; }
    if (trig[k] !== v) return false;
  }
  return true;
}

// 이 사건(trig)이 내 미션들을 진행시키는 가치(count개면 그만큼, 목표를 넘는 몫은 안 셈)
export function missionTriggerValue(view, content, player, trig) {
  const ms = view.players[player].missions;
  let v = 0;
  for (const id of [...ms.active.map((a) => a.id), ...ms.hand]) {
    const m = content.missions[id];
    if (!m || m.trigger.type !== trig.type || !missionMatches(m, trig)) continue;
    const done = ms.active.find((a) => a.id === id)?.markers ?? 0;
    const step = Math.min(Math.max(1, trig.count ?? 1), m.target - done);
    v += (m.vp + rewardValue(m.reward, coinW(content))) / m.target * step * (done + step >= m.target ? 1.3 : 1);
  }
  return v;
}

// 미션 한 칸 진행의 가치: (승점 + 보상) / 목표 수. 마지막 칸이면 조금 더.
export function missionStepValue(view, content, player, triggerType, match = () => true) {
  const ms = view.players[player].missions;
  let v = 0;
  for (const id of [...ms.active.map((a) => a.id), ...ms.hand]) {
    const m = content.missions[id];
    if (!m || m.trigger.type !== triggerType || !match(m, ms.active.find((a) => a.id === id))) continue;
    const entry = ms.active.find((a) => a.id === id);
    const done = entry?.markers ?? 0;
    const reward = rewardValue(m.reward, coinW(content));
    v += (m.vp + reward) / m.target * (done + 1 >= m.target ? 1.3 : 1);
  }
  return v;
}
export function rewardValue(blocks, cw = 1) {
  let v = 0;
  for (const b of blocks ?? []) {
    if (b.block === 'gain_coin') v += b.amount * cw;
    else if (b.block === 'gain_vp') v += b.amount;
    else if (b.block === 'gain_material') v += b.amount * 1.3;
    else v += (b.amount ?? 1) * 1.5;
  }
  return v;
}

// ? 칸(수색)의 기대 가치: 아직 덱에 남은 카드(맵 구성 − 공개된 버린 더미 − 보드 위 수색 적)의 평균.
// 적 · 경보는 위험이라 마이너스(F3b 1차 값 — F3e에서 조정).
function searchCardValue(content, id, w) {
  let v = 0;
  for (const b of content.cards[id]?.effect ?? []) {
    if (b.block === 'draw_supply') v += b.amount * w.supply_draw;
    else if (b.block === 'gain_material') v += b.amount * w.part;
    else if (b.block === 'gain_coin') v += b.amount * coinW(content);
    else if (b.block === 'draw_investigation') v += b.amount * w.investigate;
    else if (b.block === 'gain_token') v += b.amount * (b.token === 'research' ? w.research : w.survivor);
    else if (b.block === 'noise') v -= 1.5;
    else if (b.block === 'spawn_enemy') v -= 2.5;
  }
  return v;
}
function searchValue(view, content, w) {
  const left = (content.maps[view.map_id].search_deck ?? []).flatMap((e) => Array(e.copies).fill(e.card));
  const gone = [...(view.decks.search_discard ?? []), ...Object.values(view.enemies).map((f) => f.from_search).filter(Boolean)];
  for (const id of gone) { const i = left.indexOf(id); if (i >= 0) left.splice(i, 1); }
  if (!left.length) return 0;
  return left.reduce((s, id) => s + searchCardValue(content, id, w), 0) / left.length;
}

// 상호작용 칸의 가치(아직 마커 없는 칸). 미션 진행 · 캐릭터 특전 포함.
export function cellValue(view, content, ch, cellId, w) {
  const cell = content.maps[view.map_id].cells.find((c) => c.id === cellId);
  if (!cell || !INTERACT_TYPES.has(cell.type)) return 0;
  if (cellBlockReason(ctxOf(view, content), cell, ch)) return 0;   // 다 쓴 칸 · 이 캐릭터가 이미 쓴 칸(칸 사용 횟수, 2026-10-03)
  // 중앙 보상(2026-10-04): 칸 등급 보너스까지 — 금품 · 부품 +amount, 보급품 · 조사 +extra_card, 승점 +vp
  const tb = cell.type === 'camp' ? {} : tierBonus(view.config, cellTier(content.maps[view.map_id], cellId));
  const n = (cell.amount ?? 1) + (cell.type === 'money' || cell.type === 'resource' ? tb.amount ?? 0 : cell.type === 'supply' ? tb.extra_card ?? 0 : 0);
  const player = ch.owner;
  let v = (tb.vp ?? 0) * (w.vp_bias ?? 1) + (cell.type === 'investigate' ? (tb.extra_card ?? 0) * w.investigate : 0);
  switch (cell.type) {
    case 'money': v += n * coinW(content) + missionTriggerValue(view, content, player, { type: 'gain_coin', count: n }); break;
    case 'resource': v += n * w.part + missionTriggerValue(view, content, player, { type: 'gain_material', material: 'part', count: n }); break;
    case 'supply': v += Math.max(n * w.supply_draw, Math.max(0, ...view.board.open_supply.filter(Boolean).map((id) => keepValue(view, content, id, player))))
      + missionTriggerValue(view, content, player, { type: 'gain_card', kind: 'supply', count: n }) * 0.8; break;
    case 'survivor': v += n * w.survivor + missionTriggerValue(view, content, player, { type: 'gain_token', token: 'survivor', count: n }); break;
    case 'investigate': {
      const counts = invCounts(view, content, player);
      const best = Math.max(0, ...Object.values(counts)) + wildCount(view, content, player);
      v += w.investigate + best * w.investigate_stack + missionTriggerValue(view, content, player, { type: 'gain_card', kind: 'investigation' });
      break;
    }
    case 'lab': v += n * w.research + missionTriggerValue(view, content, player, { type: 'gain_token', token: 'research', count: n }); break;
    case 'search': v += searchValue(view, content, w); break;
    case 'camp': {
      const hpDef = ch.max_hp - ch.hp;
      const handDef = Math.max(0, view.config.hand.max_per_player - view.players[ch.owner].hand.length) * 0.6;
      v += hpDef * 0.5 * (1 + (1 - ch.hp / ch.max_hp)) + (ch.max_stamina - ch.stamina) * 0.15 + handDef * 0.4;
      break;
    }
    default: v = 0;
  }
  // 추적자: 상호작용마다 조사 카드 1장
  for (const p of content.chars[ch.char].perks) if (p.hook === 'on_interact' && cell.type !== 'camp') v += w.investigate * 0.8;
  // 칸 상호작용 자체의 미션(○색 구역 수색 · 캠프 재충전)
  v += missionTriggerValue(view, content, player, { type: 'interact_cell', cell_type: cell.type, zone: cell.zone ?? null });
  return v;
}

export { EQUIP, moveOf, rangeOf };
