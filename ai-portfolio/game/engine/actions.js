// 플레이어 행동(액션) 처리: 검증 → 확정(행동 수 · 비용) → 작업 쌓기
// 검증에서 규칙 위반이면 fail()로 거절하고 상태는 바뀌지 않는다.

import {
  ACTIONS, TASKS, fail, emit, push, ask, answer, card, getChar, requireActor, requireTurn, moveOf, rangeOf, weaponOf,
  hasPassive, hasStatus, passives, foesAt, getFoe, isHiddenEnemyCell, enemyRevealMode, dist, cellBlockReason, ref, perksWithHook, condOk, runBlocks,
  bagCap, charsOf, gainCoins, gainVp, facilityEffects, assignedBonuses, drawPlayerCards, drawCard, activeCharsAt,
  pcards, handMax, cardOwnerOk, partsValue, retireCard, hasItem, takeItem,
  grappleSource, grappleTapped, tapItem,
  singleOcc, occupied, blocksChar, near, freeNeighbors, placementCells, isSafeCell, activationMode, researchLocked,
  cardMode, basicOf, basicStamina, itemStamina,
} from './core.js';
import { stepEdge, cellOf, canStop } from './map.js';
import { attackTask, foeAttackTask, validateReaction } from './combat.js';
import { INTERACT_TYPES, spawnFoe, revealEnemyCell, revealDangerZones, sellCard } from './supply.js';
import { finishPlacement, submittable, remainingBids, bmPrice, playerDrawFor } from './flow.js';
import { reachableCells } from './query.js';
import { weaponPower } from './weapons.js';

// ---------- 공용 ----------
function zoneAttacks(ctx, ch) {
  if (hasStatus(ch, 'ignore_zone_attacks')) return [];
  if (singleOcc(ctx)) return [];   // 한 칸에 하나 규칙: 같은 칸의 적이 없으니 "같은 칸에서 행동하면 공격받기"도 없음(2026-10-03)
  return foesAt(ctx, ch.cell).map((f) => foeAttackTask(ctx, f, ch, 'zone'));
}

function useAction(ctx, ch, kind = null) {
  if (activationMode(ctx.s)) { markAct(ctx, ch, kind); return; }
  ctx.s.turn.actions_left -= 1;
  if (ch) (ctx.s.turn.char_used ??= {})[ch.id] = (ctx.s.turn.char_used[ch.id] ?? 0) + 1;
}
// 활성화 방식: 이동 · 공격 표시, 상호작용 · 행동 끝이면 그 캐릭터 끝(남은 활성화 수 = actions_left)
export function markAct(ctx, ch, kind) {
  const act = (ctx.s.turn.act ??= {});
  const a = (act[ch.id] ??= { move: false, attack: false, done: false });
  if (kind === 'move') a.move = true;
  else if (kind === 'attack') a.attack = true;
  else if (!a.done) {
    a.done = true;
    ctx.s.turn.actions_left = Math.max(0, ctx.s.turn.actions_left - 1);
    emit(ctx, { type: 'activation_ended', character: ch.id });
  }
}

// 손패 카드 검증: (플레이어 공용) 손에 있음 · 이 캐릭터가 쓸 수 있는 카드 · 사용 시점 · 스테미너
// 특전 "이 종류 카드를 라운드당 1회 스테미너 없이"(free_card_use, 회피 제외 — 회피는 combat.js evadeFree): 구원자 회복 카드(2026-10-08 — 예전엔 적용 안 됨)
export function freeCardKind(ctx, ch, cd) {
  for (const b of passives(ctx, ch)) {
    if (b.block !== 'free_card_use' || b.kind === '회피' || b.kind !== cd.kind) continue;
    if (!ctx.s.players[ch.owner].round_flags[`free_${b.kind}_${ch.id}`]) return b.kind;
  }
  return null;
}

export function checkCards(ctx, ch, ids, timing) {
  let stamina = 0;
  const pool = [...pcards(ctx, ch.owner).hand];
  for (const id of ids) {
    const i = pool.indexOf(id);
    if (i < 0) fail('card_not_in_hand', id);
    pool.splice(i, 1);
    if (!cardOwnerOk(ctx, ch, id)) fail('not_this_character', id);
    const cd = card(ctx, id);
    if (cd.timing !== timing) fail('wrong_timing', id);
    if (!freeCardKind(ctx, ch, cd)) stamina += cd.stamina;
  }
  if (stamina > ch.stamina) fail('not_enough_stamina');
  return ids.map((id) => card(ctx, id));
}

function payCards(ctx, ch, ids) {
  const P = pcards(ctx, ch.owner);
  for (const id of ids) {
    P.hand.splice(P.hand.indexOf(id), 1);
    retireCard(ctx, ch.owner, id);   // 소실 카드면 버린 더미 대신 소실로
    const fk = freeCardKind(ctx, ch, card(ctx, id));
    if (fk) ctx.s.players[ch.owner].round_flags[`free_${fk}_${ch.id}`] = true;   // 라운드에 1번 무료로 씀
    else ch.stamina -= card(ctx, id).stamina;
    emit(ctx, { type: 'card_played', character: ch.id, card: id });
  }
}

// ---------- 카드 운용 버전(turn_mode 'cards', 2026-10-18 사용자 결정 — docs/rules-b-cards.md) ----------
// 이동 · 공격(약탈 포함)은 카드 1장으로 한 번: a.basic = 기본 아이콘으로 쓰는 카드(공용 이동 · 공격 카드 또는 전용 카드의 아이콘),
// 또는 그 시점의 스킬 카드 1장(a.cards — "이동 + 효과" on_move · "공격 + 효과" on_attack). 둘을 같이 내거나 둘 다 없으면 거절.
// extra = 함께 내는 스테미너(공격과 같이 쓰는 아이템). 반환값은 payBasic에 넘긴다. 지금 규칙(활성화 방식)에서 a.basic을 내면 거절
function cardGate(ctx, ch, a, kind, skills, extra = 0) {
  if (!cardMode(ctx.s)) { if (a.basic) fail('card_mode_only'); return null; }
  const n = (a.basic ? 1 : 0) + skills.length;
  if (!n) fail('card_required');
  if (n > 1) fail('one_card_only');
  let cost = skills.reduce((t, cd) => t + (freeCardKind(ctx, ch, cd) ? 0 : cd.stamina), 0);
  if (a.basic) {
    if (!pcards(ctx, ch.owner).hand.includes(a.basic)) fail('card_not_in_hand', a.basic);
    // 기본 기능은 전용 카드여도 내 캐릭터 누구나 쓸 수 있다(2026-10-19 사용자 결정 — 룰북에만 적고 카드엔 안 씀). 예전(10-18)엔 주인 캐릭터만
    if (basicOf(card(ctx, a.basic)) !== kind) fail('wrong_basic_icon', a.basic);
    cost = basicStamina(ctx.s, kind);
  }
  if (cost + extra > ch.stamina) fail('not_enough_stamina');
  return a.basic ? { id: a.basic, cost } : null;
}
function payBasic(ctx, ch, gate) {
  if (!gate) return;
  const P = pcards(ctx, ch.owner);
  P.hand.splice(P.hand.indexOf(gate.id), 1);
  retireCard(ctx, ch.owner, gate.id);
  ch.stamina -= gate.cost;
  emit(ctx, { type: 'card_played', character: ch.id, card: gate.id, as: 'basic' });
}

function coinDiscount(ctx, ch, cardId) {
  let d = 0;
  for (const b of passives(ctx, ch)) if (b.block === 'mod_card_cost' && b.card === cardId) d += b.coin;
  return d;
}

function inMaintenanceOrTurn(ctx, ch) {
  if (ctx.s.turn.phase === 'maintenance' || ctx.s.turn.phase === 'chapter_prep') return;   // 챕터 준비 전: 암시장 구매 정리(신규 8)
  requireTurn(ctx, ch.owner);
}

// ---------- 이동 ----------
ACTIONS.move = (ctx, a) => {
  const ch = requireActor(ctx, a.character, { kind: 'move' });
  if (!a.path?.length) fail('invalid_path');
  const cards = checkCards(ctx, ch, a.cards ?? [], 'on_move');
  let bonus = 0;
  // 적이 있는 칸 통과: 상태(끈질긴 추격 등) 또는 상시 특성(암살자 pass_enemies, 2026-10-01)
  let passThrough = hasStatus(ch, 'pass_through_enemies') || hasPassive(ctx, ch, 'pass_enemies') ? Infinity : 0;
  for (const cd of cards) for (const b of cd.effect) {
    if (b.block === 'move_bonus') bonus += b.amount;
    if (b.block === 'grant_status' && b.status === 'pass_through_enemies') passThrough = Math.max(passThrough, b.count ?? Infinity);
  }
  const passHidden = hasPassive(ctx, ch, 'pass_hidden_enemies');
  const budget = moveOf(ctx, ch) + bonus;
  // 그래플링은 필요할 때만 쓴다: 그래플링 없이 이 경로로 갈 수 있으면 안 쓰고(아껴 둠), 안 되면 그래플링으로 다시 계산.
  // 장비 그래플링은 라운드당 1회(쓰면 카드를 눕힘, 2026-10-01).
  // 험지 무시(닌자 "rough_free", 2026-10-08): 험지에 들어가는 1짜리 연결을 그래플링 없이 쓴다 — 그래플링은 소모하지 않음
  const roughFree = hasPassive(ctx, ch, 'rough_free');
  const walk = (grapple) => {
    let cur = ch.cell, cost = 0, used = false;
    for (const cell of a.path) {
      const e = stepEdge(ctx.map, cur, cell, { grapple, roughFree });
      if (!e) return { err: 'invalid_path', detail: `${cur}→${cell}` };
      if (e.blocked) return { err: e.blocked };
      if (e.kind === 'grapple' && !(roughFree && e.rough)) used = true;
      cost += e.cost;
      cur = cell;
    }
    return { cost, used };
  };
  const gsrc = grappleSource(ctx, ch);
  let route = walk(false);
  if (route.err || route.cost > budget) {
    const g = gsrc ? walk(true) : null;
    if (g && !g.err && g.cost <= budget) route = g;
    else if (g && !g.err) fail('not_enough_move');
    else if (route.err === 'grapple_required' && !gsrc && grappleTapped(ctx, ch)) fail('grapple_used_this_round');
    else if (route.err) fail(route.err, route.detail);
    else fail('not_enough_move');
  }
  let cur = ch.cell;
  let passed = 0;
  const single = singleOcc(ctx);
  let overFigures = false;   // 한 칸에 하나 규칙: 막는 피규어를 그래플링으로 넘었는가
  a.path.forEach((cell, i) => {
    if (i < a.path.length - 1) {
      const blocked = single ? blocksChar(ctx, ch, cell) : foesAt(ctx, cell).length > 0 || (enemyRevealMode(ctx) === 'on_enter' && isHiddenEnemyCell(ctx, cell) && !passHidden);
      if (blocked) {
        if (passed < passThrough) passed++;
        else if (single && gsrc) overFigures = true;
        else fail('path_blocked_by_enemy', cell);
      }
    }
    cur = cell;
  });
  if (!canStop(ctx.map, cur)) fail('cannot_stop_here');   // 장애물 칸은 지나가기만(AC-8-1)
  if (single && occupied(ctx, cur, ch.id)) fail('cell_occupied');   // 한 칸에 피규어 하나(2026-10-03)
  const gate = cardGate(ctx, ch, a, 'move', cards);   // 카드 운용 버전: 이동 카드 1장(2026-10-18)

  useAction(ctx, ch, 'move');
  payBasic(ctx, ch, gate);
  if ((route.used || overFigures) && gsrc?.card?.once_per_round) tapItem(ctx, ch, gsrc.card.id);
  // 특전 그래플링(닌자 — 장비 없이 라운드당 1번, 2026-10-08): 쓴 라운드에는 다시 못 씀. 라운드 끝에 다시 세워짐(flow.js round_end)
  else if ((route.used || overFigures) && gsrc?.once_per_round) tapItem(ctx, ch, gsrc.token);
  payCards(ctx, ch, a.cards ?? []);
  for (const cd of cards) runBlocks(ctx, cd.effect.filter((b) => b.block === 'grant_status'), { player: ch.owner, char: ch });
  // 이동을 마친 뒤 처리할 카드 효과(after: 'move', 예: 기습)
  const after = cards.flatMap((cd) => cd.effect.filter((b) => b.after === 'move'));
  push(ctx, ...zoneAttacks(ctx, ch), { type: 'do_move', char: ch.id, path: a.path, ...(after.length ? { after } : {}) });
};

TASKS.do_move = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (ch.exhausted) return; // 벗어나기 전에 받은 공격으로 탈진: 이동 못 함(행동은 이미 씀, Z-5)
  const from = ch.cell;
  ch.cell = t.path[t.path.length - 1];
  emit(ctx, { type: 'moved', character: ch.id, path: [from, ...t.path] });
  ch.statuses = ch.statuses.filter((x) => x.duration !== 'this_move');
  if (enemyRevealMode(ctx) === 'danger_zone') revealDangerZones(ctx, t.path);   // 지나간 칸 포함
  else if (isHiddenEnemyCell(ctx, ch.cell)) revealEnemyCell(ctx, ch.cell);
  if (t.after?.length) runBlocks(ctx, t.after, { player: ch.owner, char: ch });
};

// ---------- 상호작용 ----------
ACTIONS.interact = (ctx, a) => {
  const ch = requireActor(ctx, a.character, { kind: 'interact' });
  const cell = cellOf(ctx.map, ch.cell);
  if (!INTERACT_TYPES.has(cell.type)) fail('nothing_to_interact');
  const blocked = cellBlockReason(ctx, cell, ch);
  if (blocked) fail(blocked);
  if (cell.type === 'supply' && a.option && a.option !== 'hidden') {
    if (!ctx.s.board.open_supply[a.option.open]) fail('empty_slot');
  }
  useAction(ctx, ch, 'interact');
  push(ctx, ...zoneAttacks(ctx, ch), { type: 'interact', char: ch.id, option: a.option ?? 'hidden' });
};

// ---------- 약탈 ----------
// 원하는 카드를 먼저 가져오고, 가방이 넘치면 (내 가방 + 가져온 카드) 중에서 버릴 카드를 고른다.
// 가져온 카드를 버리기로 고르면 그 카드는 원래 가방으로 돌아간다(취소). (2026-09-30 AC-3)
ACTIONS.loot = (ctx, a) => {
  const ch = requireActor(ctx, a.character, { kind: 'attack' });
  const target = getChar(ctx, a.target);
  if (!target.exhausted) fail('target_not_exhausted');
  if (!near(ctx, target.cell, ch.cell)) fail('not_same_cell');
  const take = a.take ?? [];
  if (!take.length) fail('nothing_to_loot');
  const pool = [...target.bag];
  for (const id of take) {
    const i = pool.indexOf(id);
    if (i < 0) fail(Object.values(target.equip).includes(id) ? 'cannot_loot_equipped' : 'card_not_in_bag', id);
    pool.splice(i, 1);
  }
  const gate = cardGate(ctx, ch, a, 'attack', []);   // 카드 운용 버전: 약탈도 공격 카드 1장(2026-10-18)
  useAction(ctx, ch, 'attack');
  payBasic(ctx, ch, gate);
  push(ctx, ...zoneAttacks(ctx, ch), { type: 'do_loot', char: ch.id, target: target.id, take });
};

TASKS.do_loot = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (ch.exhausted) return;
  const target = ctx.s.chars[t.target];
  for (const id of t.take) { target.bag.splice(target.bag.indexOf(id), 1); ch.bag.push(id); }
  emit(ctx, { type: 'looted', character: ch.id, target: target.id, cards: t.take });
  push(ctx, { type: 'bag_check', char: ch.id, looted: { from: target.id, cards: [...t.take] } },
    { type: 'perk_hook', hook: 'on_loot', char: ch.id },   // 약탈 특전(약탈자 코인 +1, 2026-10-08)
    { type: 'mission_progress', player: ch.owner, char: ch.id, trigger: { type: 'looted' } });
};

// ---------- 가방 카드 버리기 (행동 소모 없음, 자기 차례 · 정비 중, 2026-09-30 AC-3) ----------
ACTIONS.discard_item = (ctx, a) => {
  const ch = getChar(ctx, a.character);
  inMaintenanceOrTurn(ctx, ch);
  if (ch.exhausted) fail('character_exhausted');
  if (!ch.bag.includes(a.item)) fail('item_not_in_bag', a.item);
  ch.bag.splice(ch.bag.indexOf(a.item), 1);
  if (a.item !== 'part') ctx.s.decks.supply_discard.push(a.item);
  emit(ctx, { type: 'card_discarded', character: ch.id, card: a.item });
};

// ---------- 공격 ----------
ACTIONS.attack = (ctx, a) => {
  const ch = requireActor(ctx, a.character, { kind: 'attack' });
  const tRef = a.target in ctx.s.chars ? { kind: 'char', id: a.target } : { kind: 'foe', id: a.target };
  const tgt = ref(ctx, tRef);
  if (!tgt.ref) fail('invalid_target');
  if (tRef.kind === 'char') {
    if (tgt.ref.owner === ch.owner) fail('invalid_target');
    if (tgt.ref.exhausted) fail('target_exhausted');
  }
  const cards = checkCards(ctx, ch, a.cards ?? [], 'on_attack');
  // 챕터에 1번 쓰는 무기 능력(weapon_power, 2026-10-17 — engine/weapons.js)
  const w0 = weaponOf(ctx, ch);
  const power = weaponPower(ctx, ch, w0);
  if (a.weapon_power && !power) fail('no_weapon_power');
  if (a.weapon_power && power.used) fail('weapon_power_used');
  // 가방의 "공격할 때" 아이템(연구 카드 부검 보고서 등, 2026-10-07)
  const items = (a.items ?? []).map((id) => {
    if (!hasItem(ctx, ch, id)) fail('item_not_in_bag', id);   // 연구 카드는 쉘터 보관함에서도(2026-10-08)
    if (card(ctx, id)?.timing !== 'on_attack') fail('not_usable_now', id);
    if (researchLocked(ctx, ch.owner, card(ctx, id))) fail('lab_level_low', id);   // 연구실 레벨 조건(2026-10-18)
    return card(ctx, id);
  });
  const d = dist(ctx, ch.cell, tgt.ref.cell);
  let range = rangeOf(ctx, ch);
  for (const cd of cards) for (const b of cd.effect) {
    if (b.block === 'range_bonus') range += b.amount;
    if (b.block === 'attack_override' && b.max_range != null && d > b.max_range) fail('out_of_range');
  }
  if (d > range) fail('out_of_range');
  let coins = 0;
  for (const cd of cards) for (const b of cd.effect) if (b.block === 'pay_coin') coins += Math.max(0, b.amount + coinDiscount(ctx, ch, cd.id));
  if (coins > ctx.s.players[ch.owner].coins) fail('not_enough_coins');
  // 카드 운용 버전: 공격 카드 1장 + 같이 쓰는 아이템도 스테미너(2026-10-18)
  const itemCost = items.reduce((t, cd) => t + itemStamina(ctx.s, cd), 0);
  const gate = cardGate(ctx, ch, a, 'attack', cards, itemCost);

  useAction(ctx, ch, 'attack');
  payBasic(ctx, ch, gate);
  ch.stamina -= itemCost;
  payCards(ctx, ch, a.cards ?? []);
  const w = weaponOf(ctx, ch);
  if (a.weapon_power) {
    (ch.power_used ??= []).push(w.id ?? 'start');
    emit(ctx, { type: 'weapon_power_used', character: ch.id, weapon: w.id, effects: power.effects.map((b) => b.block) });
  }
  const onHit = (w.on_hit ?? []).filter((b) => !b.once_per_chapter || a.weapon_power);   // 챕터 1번 능력은 쓰겠다고 했을 때만
  const powerSplash = onHit.find((b) => b.block === 'splash_damage');
  const task = attackTask({ kind: 'char', id: ch.id, player: ch.owner }, tRef, {
    source: 'action', base: w.attack,
    ignore_armor: w.passive.some((b) => b.block === 'ignore_armor'),
    splash: powerSplash ?? w.on_dice?.x2?.find((b) => b.block === 'splash_damage') ?? null,
    splash_always: !!powerSplash,   // 능력으로 쓴 산탄은 치명이 아니어도(맞히면)
    on_hit: onHit, weapon: w.id,
  });
  const env = { player: ch.owner, char: ch, attack: task, distance: d };
  for (const p of perksWithHook(ctx, ch, 'on_attack')) if (condOk(ctx, ch, p.condition, env)) runBlocks(ctx, p.effect, { ...env, src: { perk: p.text_key ?? null, char: ch.char } });
  for (const cd of cards) runBlocks(ctx, cd.effect, { ...env, coin_discount: coinDiscount(ctx, ch, cd.id), src: { card: cd.id } });
  for (const cd of items) {
    takeItem(ctx, ch, cd.id);
    if (cd.source !== 'token') ctx.s.decks.supply_discard.push(cd.id);
    emit(ctx, { type: 'item_used', character: ch.id, item: cd.id });
    runBlocks(ctx, cd.effect, { ...env, src: { card: cd.id } });
  }
  // 범위 공격(attack_area, 2026-10-19 사용자 결정): 대상 주변 radius칸 안의 다른 적에게도 각각 공격(무기 공격력 + bonus, 토큰은 따로 뽑음).
  // 주 공격이 먼저, 그다음 가까운 순. 캐릭터는 맞지 않음
  const area = cards.flatMap((cd) => cd.effect).find((b) => b.block === 'attack_area');
  const extra = [];
  if (area && tgt.ref.cell != null) {
    const around = [...Object.values(ctx.s.enemies), ...Object.values(ctx.s.bosses)]
      .filter((f) => f.uid !== a.target && f.cell != null && dist(ctx, f.cell, tgt.ref.cell) <= (area.radius ?? 1))
      .sort((x, y) => dist(ctx, x.cell, tgt.ref.cell) - dist(ctx, y.cell, tgt.ref.cell));
    for (const f of around) {
      const x = attackTask({ kind: 'char', id: ch.id, player: ch.owner }, { kind: 'foe', id: f.uid }, { source: 'action', base: w.attack, ignore_armor: w.passive.some((b) => b.block === 'ignore_armor'), weapon: w.id });
      if (area.bonus) { x.bonus += area.bonus; (x.bonus_src ??= []).push({ card: null, amount: area.bonus }); }
      extra.push(x);
    }
    emit(ctx, { type: 'area_attack', character: ch.id, center: tgt.ref.cell, targets: around.map((f) => f.uid) });
  }
  push(ctx, task, ...extra);
};

// 카드 운용 버전 기본 기능 "카드 n장 뽑기"(2026-10-19 사용자 결정): 손패의 뽑기 아이콘 카드를 내고 n장(config.card_mode.basic_draw, 기본 2) 뽑음.
// 스테미너 0(basic_cost.draw) · 내 캐릭터 누구나 · 행동 끝을 한 캐릭터도 됨(행동이 아님). 차례 중 손패 한도 없음(차례 끝 5장)
function basicDraw(ctx, a) {
  if (!cardMode(ctx.s)) fail('card_mode_only');
  const ch = requireActor(ctx, a.character, { useAction: false });
  if (!pcards(ctx, ch.owner).hand.includes(a.card)) fail('card_not_in_hand', a.card);
  if (basicOf(card(ctx, a.card)) !== 'draw') fail('wrong_basic_icon', a.card);
  const cost = basicStamina(ctx.s, 'draw');
  if (cost > ch.stamina) fail('not_enough_stamina');
  payBasic(ctx, ch, { id: a.card, cost });
  drawPlayerCards(ctx, ch.owner, ctx.s.config.card_mode?.basic_draw ?? 2);
  push(ctx, { type: 'hand_limit', players: [ch.owner] });
}

// ---------- 휴식 ----------
// 휴식(2026-10-02): config.recovery.rest.choice면 "회복(heal)"과 "카드 뽑기(draw)" 중 하나를 고른다(mode). 아니면 예전처럼 둘 다.
// 휴식 카드(재생 등 회복 배수)는 회복할 때만 쓸 수 있다.
ACTIONS.rest = (ctx, a) => {
  const ch = requireActor(ctx, a.character, { kind: 'rest' });
  const choice = !!ctx.s.config.recovery.rest.choice;
  if (choice && a.mode !== 'heal' && a.mode !== 'draw') fail('rest_mode_required');
  const mode = choice ? a.mode : 'both';
  if (mode === 'draw' && (a.cards ?? []).length) fail('rest_card_heal_only');
  const cards = checkCards(ctx, ch, a.cards ?? [], 'on_rest');
  useAction(ctx, ch);
  payCards(ctx, ch, a.cards ?? []);
  let factor = 1;
  for (const cd of cards) for (const b of cd.effect) if (b.block === 'rest_multiplier') factor *= b.factor;
  push(ctx, ...zoneAttacks(ctx, ch), { type: 'do_rest', char: ch.id, factor, mode });
};

TASKS.do_rest = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (ch.exhausted) return;
  const base = ctx.s.config.recovery.rest;
  const mode = t.mode ?? 'both';
  if (mode !== 'draw') {
    let hp = base.hp;
    let st = base.stamina;
    for (const p of perksWithHook(ctx, ch, 'on_rest')) for (const b of p.effect) {
      if (b.block === 'rest_bonus') { hp += b.hp ?? 0; st += b.stamina ?? 0; }
    }
    ch.hp = Math.min(ch.max_hp, ch.hp + hp * t.factor);
    ch.stamina = Math.min(ch.max_stamina, ch.stamina + st * t.factor);
  }
  emit(ctx, { type: 'rested', character: ch.id, mode });
  if (mode !== 'heal') {
    // 예언자면 1장 더 보고 고름(특전 draw_look_extra, 2026-10-08 — 예전엔 적용 안 됨)
    push(ctx, playerDrawFor(ctx, ch, ctx.s.config.hand.rest_draw ?? 1), { type: 'hand_limit', players: [ch.owner] });
  }
};

// ---------- 재정비(resupply): (플레이어 공용) 손패를 최대 장수까지 채운다 ----------
// 2026-10-01 규칙에서 제거(config.hand.resupply_action = "none"). 플레이테스트용으로 "fill_to_max"면 다시 켜진다.
ACTIONS.resupply = (ctx, a) => {
  if (ctx.s.config.hand.resupply_action !== 'fill_to_max') fail('action_disabled');
  const ch = requireActor(ctx, a.character);
  const P = pcards(ctx, ch.owner);
  if (P.hand.length >= handMax(ctx)) fail('hand_full');
  if (!P.deck.length && !P.discard.length) fail('no_cards_to_draw');
  useAction(ctx, ch);
  push(ctx, ...zoneAttacks(ctx, ch), { type: 'do_resupply', char: ch.id });
};

TASKS.do_resupply = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (ch.exhausted) return;
  const got = drawPlayerCards(ctx, ch.owner, Math.max(0, handMax(ctx) - pcards(ctx, ch.owner).hand.length));
  emit(ctx, { type: 'resupplied', character: ch.id, count: got.length });
};

// ---------- 카드 · 아이템 · 장비 (행동 소모 없음) ----------
ACTIONS.play_card = (ctx, a) => {
  // 카드 운용 버전 기본 기능 "카드 n장 뽑기"(a.as 'basic', 2026-10-19 사용자 결정 — 전용 카드 10장 중 2장, 스테미너 0, 아무 캐릭터나)
  if (a.as === 'basic') return basicDraw(ctx, a);
  const ch = requireActor(ctx, a.character, { useAction: false });
  const [cd] = checkCards(ctx, ch, [a.card], 'anytime');
  // 카드 사용 조건(2026-10-17, 예: 재생은 캠프 칸에서만) — 이동 카드의 목적지 조건(destination_has_boss)은 move에서 따로
  if (cd.condition && !cd.condition.destination_has_boss && !condOk(ctx, ch, cd.condition)) fail('condition_not_met');
  const env = { player: ch.owner, char: ch, coin_discount: coinDiscount(ctx, ch, cd.id), choice: a.choice ?? null };
  if (a.target) {
    env.target = ref(ctx, a.target in ctx.s.chars ? { kind: 'char', id: a.target } : { kind: 'foe', id: a.target });
    if (!env.target.ref) fail('invalid_target');
  }
  for (const b of cd.effect) {
    if (b.target === 'same_cell_ally') {
      const t = env.target?.ref;
      const selfOk = b.block === 'heal';          // 응급 처치는 자신 포함, 활력 나눔은 다른 아군
      if (env.target?.kind !== 'char' || t.owner !== ch.owner || !near(ctx, t.cell, ch.cell) || t.exhausted || (!selfOk && t.id === ch.id)) fail('invalid_target');
    }
    if (b.target === 'chosen_enemy') {
      if (env.target?.kind !== 'foe') fail('invalid_target');
      if (dist(ctx, ch.cell, env.target.ref.cell) > rangeOf(ctx, ch)) fail('out_of_range');
    }
    // 내 캐릭터 하나(거리 상관없음, 2026-10-19 카드 운용 버전 구원자 "격려" 등)
    if (b.target === 'my_char') {
      const t = env.target?.ref;
      if (env.target?.kind !== 'char' || t.owner !== ch.owner || t.exhausted || t.cell == null) fail('invalid_target');
    }
  }
  // 연속 행동(combo, 2026-10-19 사용자 결정 — 암살자 "이동 2 → 사거리 1 공격 → 이동 2 → 사거리 1 공격", 이동 + 공격 한 장 등):
  // 단계마다 엔진이 고르게 묻는다(flow.js combo — 앞 공격 결과를 보고 다음 칸 · 대상을 고름). 행동 끝을 한 캐릭터는 못 씀
  const combo = cd.effect.find((b) => b.block === 'combo');
  if (combo) requireActor(ctx, a.character, {});
  // ---- 2026-10-08 미구현 카드 채우기: 고르는 값 검증(상태를 바꾸기 전에) ----
  // 예언자 "재구성": a.choice = 버릴 손패 목록(이 카드 자신은 빼고)
  if (cd.effect.some((b) => b.block === 'cycle_hand')) {
    const pool = [...pcards(ctx, ch.owner).hand];
    pool.splice(pool.indexOf(a.card), 1);
    const list = a.choice ?? [];
    if (!Array.isArray(list) || !list.every((x) => { const i = pool.indexOf(x); if (i < 0) return false; pool.splice(i, 1); return true; })) fail('invalid_choice');
  }
  // 예언자 "통찰": a.choice = 들여다볼 다른 플레이어
  if (cd.effect.some((b) => b.block === 'peek_player_card') && (!a.choice || a.choice === ch.owner || !ctx.s.players[a.choice])) fail('invalid_target');
  // 사냥꾼 "치고 빠지기": a.cell = 최대 max_move칸 이동할 곳(그대로 서 있으면 생략), a.target = 이동한 뒤 공격할 대상.
  // 2026-10-18 사용자 결정("이동 후 공격까지 한 다음 치고 빠지기로 공격만 했는데 공격이 안 됐다"): 활성화 방식에선 캐릭터의 이동 · 공격 행동과 별개 —
  // 이미 이동 · 공격했어도 쓸 수 있고, 쓴 뒤에도 남은 이동 · 공격을 할 수 있다. 행동 끝을 한 캐릭터는 못 씀.
  // 예전(2026-10-08)엔 그 캐릭터의 공격 1번을 써서(requireActor kind 'attack'), 공격한 뒤엔 대상을 골라도 엔진이 거절했다. 행동 n번 방식(예전 규칙)은 그대로 행동 1회
  const mta = cd.effect.find((b) => b.block === 'move_then_attack');
  let mtaPath = null, mtaRef = null;
  if (mta) {
    requireActor(ctx, a.character, {});   // 활성화 방식: 행동 끝 전이면 됨 · 행동 n번 방식: 남은 행동 필요
    let dest = ch.cell;
    if (a.cell && a.cell !== ch.cell) {
      const info = reachableCells(ctx.s, ctx.c, ch.id, { budget: mta.max_move ?? 2, ignoreTurn: true }).get(a.cell);
      if (!info || info.grapple) fail('out_of_reach');
      mtaPath = info.path;
      dest = a.cell;
    }
    mtaRef = a.target in ctx.s.chars ? { kind: 'char', id: a.target } : { kind: 'foe', id: a.target };
    const tgt = ref(ctx, mtaRef);
    if (!tgt.ref || (mtaRef.kind === 'char' && (tgt.ref.owner === ch.owner || tgt.ref.exhausted))) fail('invalid_target');
    if (dist(ctx, dest, tgt.ref.cell) > rangeOf(ctx, ch)) fail('out_of_range');
  }
  // 전력 질주(bonus_move, 2026-10-18 사용자 결정 — 예전엔 이동할 때 같이 쓰는 이동력 +2): 카드를 쓰면 따로 max_move칸까지 이동(a.cell).
  // 캐릭터의 이동 행동과 별개(이미 이동했어도 됨). 행동 끝을 한 캐릭터는 못 씀
  const bmv = cd.effect.find((b) => b.block === 'bonus_move');
  let bmvPath = null;
  if (bmv) {
    requireActor(ctx, a.character, {});
    if (!a.cell || a.cell === ch.cell) fail('invalid_choice');
    const info = reachableCells(ctx.s, ctx.c, ch.id, { budget: bmv.max_move ?? 2, ignoreTurn: true }).get(a.cell);
    if (!info || info.grapple) fail('out_of_reach');
    bmvPath = info.path;
  }
  if (cd.effect.some((b) => b.block === 'access_storage')) accessStorage(ctx, ch, a);
  if (mta && !activationMode(ctx.s)) useAction(ctx, ch, 'attack');   // 행동 n번 방식만 행동 1회(활성화 방식은 별개 — 위 주석)
  const bonus = cardBonusRecover(ctx, ch, cd);   // payCards 전에(무료 사용 표시와 무관하게 카드 종류만 봄)
  payCards(ctx, ch, [a.card]);
  push(ctx, bonus);   // 카드 효과가 쌓는 작업보다 아래 → 카드 효과가 다 끝난 뒤에 고름
  runBlocks(ctx, cd.effect, env);
  if (mta) push(ctx, mtaPath ? { type: 'do_move', char: ch.id, path: mtaPath } : null, { type: 'card_attack', char: ch.id, target: mtaRef });
  if (combo) push(ctx, { type: 'combo', char: ch.id, card: cd.id, steps: combo.steps, i: 0 });
  if (bmvPath) push(ctx, { type: 'do_move', char: ch.id, path: bmvPath });
};

// 구원자 특전 1(card_bonus_recover, 2026-10-17 사용자 결정): 회복 카드를 쓰면 라운드당 1번, 거리 상관없이 원하는 내 캐릭터 하나 체력 +2 · 스테미너 +2
// (예전: on_rest rest_bonus "휴식 시 회복량 +1" — 휴식 행동이 없어져 발동하지 않았음)
function cardBonusRecover(ctx, ch, cd) {
  const b = passives(ctx, ch).find((x) => x.block === 'card_bonus_recover' && x.kind === cd.kind);
  if (!b) return null;
  const rf = ctx.s.players[ch.owner].round_flags;
  const key = `bonus_recover_${ch.id}`;
  if (rf[key]) return null;
  rf[key] = true;
  return { type: 'bonus_recover', player: ch.owner, char: ch.id, hp: b.hp ?? 0, stamina: b.stamina ?? 0 };
}
TASKS.bonus_recover = (ctx, t) => {
  const options = Object.values(ctx.s.chars).filter((c) => c.owner === t.player && !c.exhausted).map((c) => c.id);
  if (!options.length) return;
  if (t.answer === undefined && options.length > 1) {
    ask(ctx, t, { type: 'choose_char', purpose: 'bonus_recover', player: t.player, character: t.char, options, hp: t.hp, stamina: t.stamina });
    return;
  }
  const tgt = ctx.s.chars[t.answer ?? options[0]];
  if (!tgt || tgt.exhausted) return;
  const before = tgt.hp;
  tgt.hp = Math.min(tgt.max_hp, tgt.hp + t.hp);
  tgt.stamina = Math.min(tgt.max_stamina, tgt.stamina + t.stamina);
  emit(ctx, { type: 'healed', character: tgt.id, amount: tgt.hp - before, by_perk: t.char });
};

// 카드 효과로 하는 공격(치고 빠지기): 일반 공격과 같은 판정(특전 · 무기), 손패 공격 카드는 같이 못 씀
TASKS.card_attack = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (!ch || ch.exhausted) return;
  const tgt = ref(ctx, t.target);
  if (!tgt.ref || (t.target.kind === 'char' && tgt.ref.exhausted)) return;
  const d = dist(ctx, ch.cell, tgt.ref.cell);
  if (d > (t.range ?? rangeOf(ctx, ch))) return;   // 이동 중에 대상이 사라지거나 멀어졌으면 공격 없음 · t.range = 연속 행동 단계의 사거리(2026-10-19)
  const w = weaponOf(ctx, ch);
  const task = attackTask({ kind: 'char', id: ch.id, player: ch.owner }, t.target, {
    source: 'action', base: w.attack,
    ignore_armor: w.passive.some((b) => b.block === 'ignore_armor'),
    splash: w.on_dice?.x2?.find((b) => b.block === 'splash_damage') ?? null,
    on_hit: (w.on_hit ?? []).filter((b) => !b.once_per_chapter), weapon: w.id,   // 카드 공격에는 챕터 1번 능력을 쓰지 않음
  });
  const env = { player: ch.owner, char: ch, attack: task, distance: d };
  for (const p of perksWithHook(ctx, ch, 'on_attack')) if (condOk(ctx, ch, p.condition, env)) runBlocks(ctx, p.effect, { ...env, src: { perk: p.text_key ?? null, char: ch.char } });
  if (t.bonus) { task.bonus += t.bonus; (task.bonus_src ??= []).push({ card: t.card ?? null, amount: t.bonus }); }   // 연속 행동 단계의 공격력 보너스
  push(ctx, task);
};

// 짐꾼 '짐 정리': 챕터 중에도 창고 ↔ 가방 교환
function accessStorage(ctx, ch, a) {
  const st = ctx.s.shelter[ch.owner].storage;
  const bag = [...ch.bag];
  const store = [...st];
  for (const id of a.store ?? []) { const i = bag.indexOf(id); if (i < 0) fail('card_not_in_bag', id); bag.splice(i, 1); store.push(id); }
  for (const id of a.retrieve ?? []) { const i = store.indexOf(id); if (i < 0 || (a.store ?? []).includes(id)) fail('card_not_in_storage', id); store.splice(i, 1); bag.push(id); }
  if (bag.length > bagCap(ctx, ch)) fail('bag_full');
  ch.bag = bag;
  ctx.s.shelter[ch.owner].storage = store;
}

ACTIONS.use_item = (ctx, a) => {
  const ch = getChar(ctx, a.character);
  inMaintenanceOrTurn(ctx, ch);
  if (ch.exhausted) fail('character_exhausted');
  if (!hasItem(ctx, ch, a.item)) fail('item_not_in_bag', a.item);   // 연구 카드는 쉘터 보관함에서도(2026-10-08)
  if (researchLocked(ctx, ch.owner, card(ctx, a.item))) fail('lab_level_low', a.item);   // 연구실 레벨 조건(2026-10-18)
  const cd = card(ctx, a.item);
  if (!cd.effect?.length || cd.effect.every((b) => b.block === 'reduce_damage')) fail('not_usable_now');
  // 연구 카드(2026-10-07): 사용 시점 — 정비 때만 · 공격과 함께(공격 창) · 칸을 고르는 소음
  if (cd.timing === 'maintenance' && ctx.s.turn.phase !== 'maintenance') fail('maintenance_only');
  if (cd.timing === 'on_attack') fail('use_with_attack');
  const env = { player: ch.owner, char: ch, cell: ch.cell, item: a.item };
  const chosen = cd.effect.find((b) => b.at === 'chosen_cell');
  if (chosen) {
    if (!a.cell || !cellOf(ctx.map, a.cell)) fail('invalid_cell');
    if (dist(ctx, ch.cell, a.cell) > (chosen.range ?? 3)) fail('out_of_range');
    env.chosen_cell = a.cell;
  }
  const needs = cd.effect.find((b) => ['revive', 'deal_damage'].includes(b.block));
  if (needs) {
    const tRef = a.target in ctx.s.chars ? { kind: 'char', id: a.target } : { kind: 'foe', id: a.target };
    const tgt = ref(ctx, tRef);
    if (!tgt.ref) fail('invalid_target');
    // 사거리 0(같은 칸)은 한 칸에 하나 규칙이면 옆 칸까지(근접 공격과 같은 해석, near) — 2026-10-17 QA 전수 테스트에서 발견:
    // 응급 부활 키트(사거리 0)가 쓰러진 아군과 같은 칸에 설 수 없어 절대 쓸 수 없었다
    const r = cd.range ?? 0;
    if (r === 0 ? !near(ctx, ch.cell, tgt.ref.cell) : dist(ctx, ch.cell, tgt.ref.cell) > r) fail('out_of_range');
    if (needs.block === 'revive' && !tgt.ref.exhausted) fail('target_not_exhausted');
    // 피해 아이템(화염병 등)은 적 또는 다른 플레이어의 캐릭터(2026-10-18 사용자 피드백 "다른 플레이어 캐릭터에게 화염병을 쓰려 했다"). 내 캐릭터 · 쓰러진 캐릭터는 불가,
    // 칸 전체 피해(수류탄 all_enemies_in_cell)는 적만. 예전엔 화면 목록에 적만 있었고 엔진은 내 캐릭터까지 막지 않았다
    if (needs.block === 'deal_damage' && tRef.kind === 'char' && (tgt.ref.owner === ch.owner || tgt.ref.exhausted || needs.target === 'all_enemies_in_cell')) fail('invalid_target');
    env.target = tgt;
  }
  // 카드 운용 버전: 내 차례에 아이템을 쓰면 스테미너(기본 1, 아이템의 stamina_cost — 정비 때는 0). 2026-10-18 사용자 결정:
  // 너무 강한 아이템은 비용을 올리되 플레이어 카드보다는 싸게(팔면 돈인데 쓰면 사라지니까)
  const ist = itemStamina(ctx.s, cd);
  if (ist > ch.stamina) fail('not_enough_stamina');
  ch.stamina -= ist;
  takeItem(ctx, ch, a.item);
  if (cd.source !== 'token') ctx.s.decks.supply_discard.push(a.item);   // 연구 카드는 쓰면 사라짐
  emit(ctx, { type: 'item_used', character: ch.id, item: a.item });
  runBlocks(ctx, cd.effect, env);
};

const SLOT = { weapon: 'weapon', armor: 'armor', accessory: 'accessory' };
ACTIONS.equip = (ctx, a) => {
  const ch = getChar(ctx, a.character);
  inMaintenanceOrTurn(ctx, ch);
  if (!ch.bag.includes(a.item)) fail('item_not_in_bag', a.item);
  const slot = SLOT[card(ctx, a.item).kind];
  if (!slot) fail('not_equipment');
  const before = { bag: [...ch.bag], equip: { ...ch.equip } };
  ch.bag.splice(ch.bag.indexOf(a.item), 1);
  if (ch.equip[slot]) ch.bag.push(ch.equip[slot]);
  ch.equip[slot] = a.item;
  // 가방을 늘려 주던 장비를 바꿔서 가방이 넘치게 되면, 넘치는 만큼 골라 버려야 한다(a.discard). 못 버리면 교체 불가.
  const over = ch.bag.length - bagCap(ctx, ch);
  if (over > 0) {
    const drop = [...(a.discard ?? [])];
    const ok = drop.length === over && drop.every((id) => { const i = ch.bag.indexOf(id); if (i < 0) return false; ch.bag.splice(i, 1); return true; });
    if (!ok) { ch.bag = before.bag; ch.equip = before.equip; fail('bag_full'); }
    for (const id of drop) if (id !== 'part') ctx.s.decks.supply_discard.push(id);
  }
  emit(ctx, { type: 'equipped', character: ch.id, item: a.item, slot });
  if (ch.equip.weapon && ch.equip.armor && ch.equip.accessory) push(ctx, { type: 'mission_progress', player: ch.owner, char: ch.id, trigger: { type: 'full_equip' } });
};

// ---------- 장착 해제 (2026-10-03 사용자 결정) ----------
// 장비 칸의 카드를 가방으로(행동 없음, 내 차례 · 정비 중). 가방에 자리가 있어야 한다. 무기를 빼면 시작 무기로 돌아간다.
ACTIONS.unequip = (ctx, a) => {
  const ch = getChar(ctx, a.character);
  inMaintenanceOrTurn(ctx, ch);
  const id = SLOT[a.slot] ? ch.equip?.[a.slot] : null;
  if (!id) fail('slot_empty');
  ch.equip[a.slot] = null;
  ch.bag.push(id);
  if (ch.bag.length > bagCap(ctx, ch)) { ch.bag.pop(); ch.equip[a.slot] = id; fail('bag_full'); }   // 가방을 늘려 주던 장비도 빼면 넘칠 수 있음
  emit(ctx, { type: 'unequipped', character: ch.id, item: id, slot: a.slot });
};

// ---------- 교환 ----------
ACTIONS.trade = (ctx, a) => {
  const from = getChar(ctx, a.from);
  const to = getChar(ctx, a.to);
  requireTurn(ctx, from.owner);
  if (!near(ctx, from.cell, to.cell) || from.exhausted || to.exhausted) fail('not_same_cell');
  for (const id of a.give ?? []) if (!from.bag.includes(id)) fail('card_not_in_bag', id);
  for (const id of a.take ?? []) if (!to.bag.includes(id)) fail('card_not_in_bag', id);
  const task = { type: 'trade', from: from.id, to: to.id, give: a.give ?? [], take: a.take ?? [] };
  if (from.owner === to.owner) task.answer = 'accept';
  push(ctx, task);
};

TASKS.trade = (ctx, t) => {
  const from = ctx.s.chars[t.from];
  const to = ctx.s.chars[t.to];
  if (t.answer === undefined) {
    t.waiting = true;
    ctx.s.stack.push(t);
    ctx.s.pending = { type: 'trade_consent', player: to.owner, from: t.from, to: t.to, give: t.give, take: t.take };
    return;
  }
  if (t.answer !== 'accept') { emit(ctx, { type: 'trade_declined', from: t.from, to: t.to }); return; }
  for (const id of t.give) { from.bag.splice(from.bag.indexOf(id), 1); to.bag.push(id); }
  for (const id of t.take) { to.bag.splice(to.bag.indexOf(id), 1); from.bag.push(id); }
  emit(ctx, { type: 'traded', from: t.from, to: t.to, give: t.give, take: t.take });
  push(ctx, { type: 'bag_check', char: from.id }, { type: 'bag_check', char: to.id });
};

// ---------- 보스 탐색 ----------
ACTIONS.spawn_boss = (ctx, a) => {
  requireTurn(ctx, a.player);
  const mine = charsOf(ctx, a.player);
  if (mine.every((c) => c.exhausted)) fail('all_characters_exhausted');
  if ((a.cards ?? []).length !== 3) fail('need_three_cards');
  // 조사 카드(단서 등)는 쉘터 창고에 둔 것도 쓸 수 있다(2026-10-18 사용자 결정 "단서는 창고에 둬도 사용할 수 있게"). 가방 카드를 먼저 쓴다.
  // 예전엔 내 캐릭터 가방에 든 카드만 됐음
  const store = ctx.s.shelter[a.player]?.storage ?? [];
  const pool = [...mine.flatMap((c) => c.bag.map((id) => ({ c, id }))), ...store.filter((id) => id !== 'part').map((id) => ({ store: true, id }))];
  const used = [];
  let color = null;
  for (const id of a.cards) {
    const i = pool.findIndex((x) => x.id === id && !used.includes(x));
    if (i < 0) fail('card_not_in_bag', id);
    used.push(pool[i]);
    const cd = card(ctx, id);
    const wild = cd.wild || (cd.passive ?? []).some((b) => b.block === 'wild_investigation');
    if (wild) continue;
    if (cd.kind !== 'investigation') fail('not_investigation_card', id);
    if (color && cd.color !== color) fail('mixed_colors');
    color = cd.color;
  }
  const cell = cellOf(ctx.map, a.cell);
  if (!cell) fail('invalid_cell');
  if (color && cell.zone !== color) fail('wrong_zone');
  if (!cell.zone) fail('wrong_zone');
  if (isSafeCell(ctx, a.cell)) fail('safe_zone');   // 안전 지역(시작 칸)에는 보스를 놓을 수 없음
  if (Object.values(ctx.s.chars).some((c) => c.cell === a.cell && c.owner !== a.player)) fail('cell_has_other_player');
  if (singleOcc(ctx) && occupied(ctx, a.cell)) fail('cell_occupied');
  const type = ctx.map.boss_zones?.[cell.zone] ?? ctx.c.zoneBoss[cell.zone];
  // 보스 카드는 종류마다 copies_per_type장(2026-09-30: 2장 — 같은 보스가 동시에 두 마리도 가능).
  // 한 종류는 게임 전체에서 그 장수만큼(보드 위 + 처치된 수), 게임 전체 보스 수는 인원수별 표(bosses.count_by_players).
  const B = ctx.s.config.bosses ?? {};
  const outOfType = Object.values(ctx.s.bosses).filter((b) => b.type === type).length
    + Object.values(ctx.s.players).reduce((n, p) => n + p.bosses_killed.filter((k) => k === type).length, 0);
  if (outOfType >= (B.copies_per_type ?? 1)) fail('boss_already_out');
  const limit = B.count_by_players?.[ctx.s.game.turn_order.length] ?? B.count ?? Infinity;
  if (Object.keys(ctx.s.bosses).length + ctx.s.game.bosses_killed_count >= limit) fail('boss_limit_reached');
  for (const u of used) {
    if (u.store) store.splice(store.indexOf(u.id), 1);
    else u.c.bag.splice(u.c.bag.indexOf(u.id), 1);
    ctx.s.decks.investigation_box.push(u.id);
  }
  const id = `b${++ctx.s.game.uid}`;
  const def = ctx.c.enemies[type];
  ctx.s.bosses[id] = { uid: id, type, cell: a.cell, hp: def.hp, max_hp: def.hp, seq: ++ctx.s.game.seq, statuses: [] };
  emit(ctx, { type: 'boss_spawned', boss: id, boss_type: type, cell: a.cell, player: a.player });
};

// ---------- 의무실 부활 ----------
ACTIONS.revive_infirmary = (ctx, a) => {
  requireTurn(ctx, a.player);
  const ch = getChar(ctx, a.character);
  if (ch.owner !== a.player || !ch.exhausted) fail('invalid_target');
  // 부활 위치(config.revive.placement): exhausted_cell = 쓰러진 자리(2026-10-01 피드백 12, 기본) · empty_start_point = 빈 시작 지점(예전)
  let at;
  if ((ctx.s.config.revive.placement ?? 'exhausted_cell') === 'empty_start_point') {
    const cell = cellOf(ctx.map, a.cell);
    if (cell?.type !== 'start') fail('not_start_point');
    if (Object.values(ctx.s.chars).some((c) => c.cell === a.cell) || foesAt(ctx, a.cell).length) fail('start_point_occupied');
    at = a.cell;
  } else {
    if (!ch.cell) fail('not_on_board');
    if (a.cell && a.cell !== ch.cell) fail('revive_in_place');
    at = ch.cell;
    if (singleOcc(ctx) && occupied(ctx, at, ch.id)) {   // 쓰러진 자리에 누가 서 있으면 옆 빈칸에서 일어남(2026-10-03)
      at = freeNeighbors(ctx, at)[0];
      if (!at) fail('no_free_cell');
    }
  }
  const effects = [...facilityEffects(ctx, a.player), ...assignedBonuses(ctx, a.player)].filter((b) => b.block === 'mod_revive');
  let cost = ctx.s.config.revive.infirmary_cost_by_chapter[ctx.s.game.chapter - 1] ?? 0;
  let full = false;
  for (const b of effects) { cost += b.cost ?? 0; if (b.hp === 'full') full = true; }
  cost = Math.max(0, cost);
  if (ctx.s.players[a.player].coins < cost) fail('not_enough_coins');
  if (cost) gainCoins(ctx, a.player, -cost);
  ch.exhausted = false;
  ch.cell = at;
  ch.hp = full ? ch.max_hp : Math.ceil(ch.max_hp / 2);
  ch.stamina = ch.max_stamina;
  emit(ctx, { type: 'revived', character: ch.id, method: 'infirmary', cell: at, cost });
};

// ---------- 차례 · 흐름 ----------
// 활성화 방식: 이 캐릭터 행동 끝(상호작용 없이). 화면은 "행동 끝"을 누르면 그 칸에서 할 수 있는 상호작용을 먼저 내고,
// 할 수 없는 칸이면 이 액션으로 끝낸다(2026-10-04 사용자 결정)
ACTIONS.end_activation = (ctx, a) => {
  if (!activationMode(ctx.s)) fail('action_disabled');
  const ch = requireActor(ctx, a.character, { kind: 'end' });
  markAct(ctx, ch, 'end');
};

// 차례 종료(2026-10-17 사용자 결정): 활성화 방식에서 아직 "행동 끝"을 안 한 캐릭터는 지금 칸에서 자동으로 "행동 끝" 처리 —
// 상호작용할 수 있는 칸이면 상호작용(보급품 칸은 감춰진 카드), 아니면 그냥 끝. 예전에는 남은 캐릭터의 행동이 상호작용 없이 사라져서
// 처음 하는 사람이 이동만 하고 바로 차례 종료를 누르면 조사 · 수색을 놓쳤다(포트폴리오 데모 점검). AI도 같은 규칙.
ACTIONS.end_turn = (ctx, a) => {
  requireTurn(ctx, a.player);
  const auto = activationMode(ctx.s)
    ? charsOf(ctx, a.player).filter((c) => !c.exhausted && c.cell != null && !ctx.s.turn.act?.[c.id]?.done).map((c) => ({ type: 'auto_end', char: c.id }))
    : [];
  push(ctx, ...auto, { type: 'turn_end', player: a.player });
};

// 자동 "행동 끝" 하나: 앞 캐릭터의 상호작용(선택 대기 · 피해 포함)이 다 끝난 뒤 실행되므로 그때 상태로 다시 확인한다
TASKS.auto_end = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (!ch || ch.exhausted || ch.cell == null || ctx.s.turn.act?.[ch.id]?.done) return;
  const cell = cellOf(ctx.map, ch.cell);
  const canInteract = INTERACT_TYPES.has(cell.type) && !cellBlockReason(ctx, cell, ch);
  emit(ctx, { type: 'auto_activation', character: ch.id, cell: ch.cell, interact: canInteract ? cell.type : null });
  if (!canInteract) { markAct(ctx, ch, 'end'); return; }
  useAction(ctx, ch, 'interact');
  push(ctx, ...zoneAttacks(ctx, ch), { type: 'interact', char: ch.id, option: 'hidden' });
};

ACTIONS.run_enemy_turn = (ctx) => {
  if (ctx.s.turn.phase !== 'enemy_turn') fail('wrong_phase');
  push(ctx, { type: 'enemy_turn' });
};

ACTIONS.run_chapter_prep = (ctx) => {
  if (ctx.s.turn.phase !== 'chapter_prep') fail('wrong_phase');
  push(ctx, { type: 'chapter_prep' });
};

ACTIONS.place_character = (ctx, a) => {
  const p = ctx.s.pending;
  if (p?.type !== 'placement' || p.player !== a.player) fail('not_your_turn');
  const ch = getChar(ctx, a.character);
  if (ch.owner !== a.player || ch.cell != null) fail('invalid_target');
  // 비어 있는 시작 칸(모두 막혔으면 시작 칸 옆 빈 칸 — placementCells)
  if (!placementCells(ctx).includes(a.cell)) fail(cellOf(ctx.map, a.cell)?.type === 'start' ? 'start_point_occupied' : 'not_start_point');
  ch.cell = a.cell;
  emit(ctx, { type: 'placed', character: ch.id, cell: a.cell });
  revealDangerZones(ctx, [a.cell]);   // 시작 지점이 위험 구역 안이면 바로 등장
  ctx.s.placement_queue.shift();
  if (ctx.s.placement_queue.length) ctx.s.pending = { type: 'placement', player: ctx.s.placement_queue[0] };
  else finishPlacement(ctx);
};

// ---------- 답변 ----------
ACTIONS.react = (ctx, a) => {
  const p = ctx.s.pending;
  if (p?.type !== 'reaction' || p.character !== a.character) fail('no_such_decision');
  const ch = ctx.s.chars[a.character];
  validateReaction(ctx, ch, a, fail);
  answer(ctx, { pass: !!a.pass, intercept_by: a.intercept_by, cards: a.cards ?? [], items: a.items ?? [], discard_supply: a.discard_supply });
};

ACTIONS.choose = (ctx, a) => {
  const p = ctx.s.pending;
  if (!p || p.player !== a.player) fail('no_such_decision');
  const v = a.choice;
  const multiset = (list, from) => { const pool = [...from]; return list.every((x) => { const i = pool.indexOf(x); if (i < 0) return false; pool.splice(i, 1); return true; }); };
  switch (p.type) {
    case 'choose_trap_target':
    case 'camp_pick':
    case 'choose_char':   // 캐릭터 고르기(구원자 특전 1, 2026-10-17)
      if (!p.options.includes(v)) fail('invalid_choice');
      break;
    // 보급품 얻을 때 감춰진 카드 / 드러난 카드 1장(2026-10-08)
    case 'supply_source':
      if (!p.options.includes(v)) fail('invalid_choice');
      break;
    // 카드 보고 고르기(예지 · 예언자 특전, 2026-10-08): count가 1이면 카드 하나, 아니면 count장 배열
    case 'pick_card': {
      const list = p.count === 1 && !Array.isArray(v) ? [v] : v;
      if (!Array.isArray(list) || list.length !== p.count || !multiset(list, p.options)) fail('invalid_choice');
      break;
    }
    case 'bag_overflow': {
      const ch = ctx.s.chars[p.character];
      if (!Array.isArray(v) || v.length !== p.discard_count || !multiset(v, ch.bag)) fail('invalid_choice');
      break;
    }
    case 'discard_to_hand_limit': {
      if (!Array.isArray(v) || v.length !== p.count || !multiset(v, pcards(ctx, p.player).hand)) fail('invalid_choice');
      break;
    }
    case 'mulligan': {
      if (!Array.isArray(v) || !multiset(v, pcards(ctx, p.player).hand)) fail('invalid_choice');
      break;
    }
    case 'mission_keep': {
      const allowed = [...p.options, ...p.current];
      if (!Array.isArray(v) || !v.every((x) => allowed.includes(x))) fail('invalid_choice');
      if (v.length > p.max_keep) fail('too_many_missions');
      if (new Set(v).size < (p.min_keep ?? 0)) fail('too_few_missions');   // 2026-10-18 최소 장수(flow.js min_keep)
      break;
    }
    case 'trade_consent':
      if (v !== 'accept' && v !== 'decline') fail('invalid_choice');
      break;
    // 카드 운용 버전(2026-10-19): 연속 행동 단계(칸 · 대상 · 'skip') · 레벨업 카드 고르기 · 버릴 카드(어느 더미의 어느 카드)
    case 'combo_step':
    case 'level_up_pick':
      if (!p.options.includes(v)) fail('invalid_choice');
      break;
    case 'level_up_remove': {
      const P = pcards(ctx, p.player);
      const pile = { hand: P.hand, deck: P.deck, discard: P.discard }[v?.zone];
      if (!pile || !pile.includes(v.card)) fail('invalid_choice');
      break;
    }
    default:
      fail('no_such_decision');
  }
  answer(ctx, v);
};

// ---------- 정비 ----------
function requireMaintenance(ctx) {
  if (ctx.s.turn.phase !== 'maintenance') fail('wrong_phase');
}
// 가방 · 창고 정리(넣기 · 꺼내기 · 장착)는 정비 때 + 챕터 준비 전(암시장에서 산 카드를 정리, 2026-10-04 신규 8)
function requireArrange(ctx) {
  if (ctx.s.turn.phase !== 'maintenance' && ctx.s.turn.phase !== 'chapter_prep') fail('wrong_phase');
}

// 판매: 가방 카드(기본) 또는 창고 카드(from: 'storage', 2026-10-01 — 규칙서 "보유한 아이템을 판매").
// 창고 판매도 파는 캐릭터(character)를 정한다 — 그 캐릭터의 판매 특전(브로커 +1)이 적용된다.
ACTIONS.sell = (ctx, a) => {
  requireMaintenance(ctx);
  const ch = getChar(ctx, a.character);
  const fromStorage = a.from === 'storage';
  const list = fromStorage ? ctx.s.shelter[ch.owner].storage : ch.bag;
  if (!list.includes(a.card)) fail(fromStorage ? 'card_not_in_storage' : 'card_not_in_bag', a.card);
  const cd = card(ctx, a.card);
  if (!cd || cd.sell == null) fail('not_sellable');
  sellCard(ctx, ch, a.card, list, { fromStorage });
};

// 판매대 일괄 판매(2026-10-18 사용자 요청 "판매 버튼을 누르면 일괄 판매"): a.items = [{ character, card, from? }].
// 한 번의 액션으로 전부 판다 — 하나라도 안 되면 전부 거절(상태 그대로). 예전엔 화면이 sell을 한 장씩 연달아 내서, 앞 연출 중이면 뒤 판매가 무시됐다
ACTIONS.sell_batch = (ctx, a) => {
  if (!Array.isArray(a.items) || !a.items.length) fail('nothing_to_sell');
  for (const it of a.items) {
    if (getChar(ctx, it.character).owner !== a.player) fail('not_your_character', it.character);
    ACTIONS.sell(ctx, { type: 'sell', character: it.character, card: it.card, from: it.from });
  }
};

ACTIONS.store = (ctx, a) => {
  requireArrange(ctx);
  const ch = getChar(ctx, a.character);
  if (!ch.bag.includes(a.card)) fail('card_not_in_bag', a.card);
  ch.bag.splice(ch.bag.indexOf(a.card), 1);
  ctx.s.shelter[ch.owner].storage.push(a.card);
};

ACTIONS.retrieve = (ctx, a) => {
  requireArrange(ctx);
  const ch = getChar(ctx, a.character);
  const st = ctx.s.shelter[ch.owner].storage;
  if (!st.includes(a.card)) fail('card_not_in_storage', a.card);
  if (ch.bag.length + 1 > bagCap(ctx, ch)) fail('bag_full');
  st.splice(st.indexOf(a.card), 1);
  ch.bag.push(a.card);
};

ACTIONS.upgrade_facility = (ctx, a) => {
  requireMaintenance(ctx);
  const s = ctx.s;
  const fac = ctx.c.facilities[a.facility];
  if (!fac) fail('unknown_facility');
  const sh = s.shelter[a.player];
  const lv = sh.facilities[a.facility] ?? 0;
  if (lv >= fac.max_level) fail('max_level');
  const L = fac.levels[lv];
  let cost = L.cost_parts;
  if (a.facility !== 'f_workshop') {
    for (const b of [...facilityEffects(ctx, a.player), ...assignedBonuses(ctx, a.player)]) {
      if (b.block === 'mod_upgrade_cost' && (b.target ?? 'other_facilities') === 'other_facilities') cost += b.amount;
    }
  }
  cost = Math.max(0, cost);
  // 부품은 플레이어 자원으로 낸다(2026-10-04 신규 4). 재료 카드(고철 더미 · 부품 상자)는 팔아서 부품으로 바꿔야 함.
  // 예전 저장 · 테스트의 'part' 토큰(창고 · 가방)도 함께 셈.
  const sources = [sh.storage, ...charsOf(ctx, a.player).map((c) => c.bag)];
  const legacy = sources.reduce((n, list) => n + list.filter((x) => x === 'part').length, 0);
  const have = (s.players[a.player].parts ?? 0) + legacy;
  if (have < cost) fail('not_enough_parts');
  // 코인 비용(2026-10-02): 레벨 데이터의 cost_coins
  const coinCost = L.cost_coins ?? 0;
  if (s.players[a.player].coins < coinCost) fail('not_enough_coins');
  if (coinCost) gainCoins(ctx, a.player, -coinCost);
  let left = cost;
  const fromRes = Math.min(left, s.players[a.player].parts ?? 0);
  s.players[a.player].parts = (s.players[a.player].parts ?? 0) - fromRes;
  left -= fromRes;
  for (const list of sources) {
    while (left > 0 && list.includes('part')) { list.splice(list.indexOf('part'), 1); left--; }
  }
  sh.facilities[a.facility] = lv + 1;
  emit(ctx, { type: 'facility_upgraded', player: a.player, facility: a.facility, level: lv + 1, parts: cost, coins: coinCost });
  gainVp(ctx, a.player, L.vp, 'facility_level');
  if (lv + 1 === fac.max_level) {
    const claimed = s.game.first_max_claimed[a.facility];
    if (claimed === undefined || claimed === s.game.chapter) {
      gainVp(ctx, a.player, fac.first_max_bonus, 'first_max');
      s.game.first_max_claimed[a.facility] = s.game.chapter;
    }
  }
  push(ctx, { type: 'mission_progress', player: a.player, char: charsOf(ctx, a.player)[0]?.id, trigger: { type: 'facility_level_up' } });
  if (lv + 1 === fac.max_level) push(ctx, { type: 'mission_progress', player: a.player, char: charsOf(ctx, a.player)[0]?.id, trigger: { type: 'facility_max' } });
};

ACTIONS.place_survivor = (ctx, a) => {
  requireMaintenance(ctx);
  const sh = ctx.s.shelter[a.player];
  let fromPool = sh.survivor_pool.indexOf(a.survivor);
  // 생존자 카드(2026-10-07): 창고 · 내 캐릭터 가방에서도 시설로 배치, 빼면 창고로
  const bagOf = charsOf(ctx, a.player).find((c) => c.bag.includes(a.survivor));
  if (fromPool >= 0) sh.survivor_pool.splice(fromPool, 1);
  else if (sh.storage.includes(a.survivor) && card(ctx, a.survivor)?.kind === 'survivor') { sh.storage.splice(sh.storage.indexOf(a.survivor), 1); fromPool = 0; }
  else if (bagOf && card(ctx, a.survivor)?.kind === 'survivor') { bagOf.bag.splice(bagOf.bag.indexOf(a.survivor), 1); fromPool = 0; }
  else {
    const holder = Object.entries(sh.assigned).find(([, list]) => list.includes(a.survivor));
    if (!holder) fail('survivor_not_found');
    holder[1].splice(holder[1].indexOf(a.survivor), 1);
  }
  if (a.facility) (sh.assigned[a.facility] ??= []).push(a.survivor);
  else sh.survivor_pool.push(a.survivor);   // 뺀 생존자 카드는 쉘터 대기로(2026-10-08 AF-1 — 예전엔 창고로 보냈음)
  if (a.facility && fromPool >= 0) push(ctx, { type: 'mission_progress', player: a.player, char: charsOf(ctx, a.player)[0]?.id, trigger: { type: 'survivor_assigned' } });
};

ACTIONS.end_maintenance = (ctx, a) => {
  requireMaintenance(ctx);
  if (!ctx.s.players[a.player]) fail('unknown_player');
  if (!ctx.s.maint_done.includes(a.player)) ctx.s.maint_done.push(a.player);
  emit(ctx, { type: 'maintenance_done', player: a.player });
  if (ctx.s.game.turn_order.every((p) => ctx.s.maint_done.includes(p))) push(ctx, { type: 'maintenance_end' });
};

// ---------- 암시장 ----------
// 플레이어당 카드 1장에 참가. 다시 내면 다른 카드로 옮기고, card: null이면 참가 취소. to: 받을 곳(내 캐릭터 id · 'storage')
ACTIONS.bm_place = (ctx, a) => {
  const s = ctx.s;
  if (s.turn.phase !== 'black_market') fail('wrong_phase');
  if (!s.players[a.player]) fail('unknown_player');
  if (a.card != null && !s.board.black_market.includes(a.card)) fail('card_not_on_market');
  // 코인이 그 카드 가격(내 할인 반영)보다 적으면 고를 수 없음(2026-10-04 사용자 피드백)
  if (a.card != null && s.players[a.player].coins < bmPrice(ctx, a.player, a.card)) fail('not_enough_coins');
  if (a.to != null && a.to !== 'storage' && s.chars[a.to]?.owner !== a.player) fail('invalid_target');
  for (const [cid, list] of Object.entries(s.board.bm_place)) {
    s.board.bm_place[cid] = list.filter((p) => p !== a.player);
    if (!s.board.bm_place[cid].length) delete s.board.bm_place[cid];
  }
  s.board.bm_to ??= {};
  if (a.card == null) { delete s.board.bm_to[a.player]; return; }
  (s.board.bm_place[a.card] ??= []).push(a.player);
  s.board.bm_to[a.player] = a.to ?? null;
};

ACTIONS.bm_resolve = (ctx) => {
  if (ctx.s.turn.phase !== 'black_market') fail('wrong_phase');
  push(ctx, { type: 'bm_resolve_all' });
};

// 경쟁 입찰: 플레이어가 가방들 · 창고의 카드 1장을 몰래 내거나(card), 포기한다(card: null)
ACTIONS.bm_bid = (ctx, a) => {
  const p = ctx.s.pending;
  if (!p || (p.type !== 'bm_bid' && p.type !== 'bm_bid_extra') || !p.waiting.includes(a.player)) fail('no_such_decision');
  const task = ctx.s.stack[ctx.s.stack.length - 1];
  if (a.card != null) {
    const allowed = p.type === 'bm_bid' ? submittable(ctx, a.player) : remainingBids(ctx, a.player, task.first[a.player]);
    if (!allowed.includes(a.card)) fail('invalid_bid');
  }
  task.bid = { player: a.player, card: a.card ?? null };
  task.waiting = false;
  ctx.s.pending = null;
};

// ---------- 테스트 전용 ----------
ACTIONS.debug_noise = (ctx, a) => {
  const ch = getChar(ctx, a.character);
  push(ctx, { type: 'noise', cell: ch.cell, source_char: ch.id });
};

export { activeCharsAt, getFoe };
