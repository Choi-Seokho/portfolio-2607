// 전투: 공격 선언 → (맞는 쪽 반응: 주사위 전) → 주사위 → 방어력 → 피해 감소 → 피해 적용
//       → 처치 · 탈진 → 반격(고정 피해) · 산탄 · 추가 공격 · 봄버 폭발

import {
  TASKS, emit, push, ask, ref, getFoe, foeDef, foeStat, isBoss, defenseOf, card, charDef, perksWithHook,
  hasPassive, dist, gainCoins, gainVp, runBlocks, activeCharsAt, allFoes, bagCap, pcards, cardOwnerOk,
  near, attackerPouch, retireCard,
} from './core.js';
import { drawToken, faceValue, attackRank } from './rng.js';
import { cellOf } from './map.js';
import { weaponHitTask } from './weapons.js';

// 공격 작업 만들기
// attacker: {kind:'char'|'foe'|'explosion', id?, player?, char?}  target: {kind:'char'|'foe', id}
export function attackTask(attacker, target, opts = {}) {
  return {
    type: 'attack', attacker, target, source: opts.source ?? 'action',
    base: opts.base ?? 0, bonus: opts.bonus ?? 0, rolls: opts.rolls ?? 1, extras: opts.extras ?? 0,
    is_extra: !!opts.is_extra, no_dice: !!opts.no_dice, override: opts.override ?? null,
    ignore_armor: !!opts.ignore_armor, splash: opts.splash ?? null, def_bonus: 0, reduce: 0, evaded: false,
    on_hit: opts.on_hit ?? null, weapon: opts.weapon ?? null, splash_always: !!opts.splash_always, ricochet: null,   // ricochet: 도탄 사격(2026-10-18)   // 무기 특수 효과(engine/weapons.js, 2026-10-17)
    reactable: opts.reactable ?? true, stage: null,
  };
}

export function foeAttackTask(ctx, foe, target, source) {
  return attackTask({ kind: 'foe', id: foe.uid }, { kind: 'char', id: target.id }, { source, base: foeStat(ctx, foe, 'attack') });
}

function alive(ctx, t) {
  const r = ref(ctx, t);
  if (!r.ref) return false;
  if (t.kind === 'char') return !r.ref.exhausted && r.ref.cell != null;
  return true;
}

function attackerCell(ctx, a) {
  if (a.kind === 'char') return ctx.s.chars[a.id]?.cell;
  if (a.kind === 'foe') return getFoe(ctx.s, a.id)?.cell;
  return null;
}

export function attackerPlayer(ctx, a) {
  if (a.kind === 'char') return ctx.s.chars[a.id].owner;
  if (a.kind === 'explosion') return a.player ?? null;
  return null;
}

// ---------- 반응 ----------
function guardiansFor(ctx, ch) {
  return Object.values(ctx.s.chars).filter((g) => g.id !== ch.id && g.owner === ch.owner && near(ctx, g.cell, ch.cell) && !g.exhausted
    && perksWithHook(ctx, g, 'on_hit').some((p) => p.effect.some((b) => b.block === 'intercept')));
}

export function evadeFree(ctx, ch) {
  const perk = charDef(ctx, ch).perks.find((p) => p.hook === 'passive' && p.effect.some((b) => b.block === 'free_card_use' && b.kind === '회피'));
  return !!perk && !ctx.s.players[ch.owner].round_flags[`free_evade_${ch.id}`];
}

// 반응 카드의 비용(스테미너)을 내는 캐릭터. 보통은 맞는 캐릭터 자신.
// 수호자 "엄호"처럼 대상이 same_cell_ally인 전용 카드는 그 카드 주인 캐릭터(옆 칸 · 같은 칸, 탈진 아님)가 대신 써 준다(2026-10-08 —
// 예전엔 주인 캐릭터만 반응 카드를 쓸 수 있어서 아군을 지키는 카드인데 아군이 맞을 때는 못 썼음)
export function reactionPayer(ctx, ch, id) {
  const cd = card(ctx, id);
  if (cardOwnerOk(ctx, ch, id)) return ch;
  if (!cd?.char || !cd.effect.some((b) => b.target === 'same_cell_ally')) return null;
  return Object.values(ctx.s.chars).find((c) => c.owner === ch.owner && c.char === cd.char && !c.exhausted && c.cell != null && near(ctx, c.cell, ch.cell)) ?? null;
}

export function reactionCardUsable(ctx, ch, id) {
  const cd = card(ctx, id);
  if (!cd || cd.timing !== 'on_hit') return 'not_reaction_card';
  const payer = reactionPayer(ctx, ch, id);
  if (!payer) return 'not_this_character';
  const isEvade = cd.effect.some((b) => b.block === 'evade');
  if (isEvade && hasPassive(ctx, ch, 'forbid_evade')) return 'evade_forbidden';
  const free = isEvade && evadeFree(ctx, ch);
  if (!free && payer.stamina < cd.stamina) return 'not_enough_stamina';
  return null;
}

function discardableFor(ctx, ch, minSell) {
  return ch.bag.filter((id) => id !== 'part' && card(ctx, id) && (card(ctx, id).sell ?? 0) >= minSell);
}

export function reactionOptions(ctx, ch, task) {
  const opts = [];
  if (task.source !== 'explosion' && guardiansFor(ctx, ch).length) opts.push('intercept');
  const cards = pcards(ctx, ch.owner).hand.filter((id) => {
    if (reactionCardUsable(ctx, ch, id)) return false;
    const ds = card(ctx, id).effect.find((b) => b.block === 'discard_supply');
    return !ds || discardableFor(ctx, ch, ds.min_sell).length > 0;
  });
  if (cards.length) opts.push('cards');
  if (ch.bag.some((id) => card(ctx, id)?.kind === 'consumable' && card(ctx, id).effect?.some((b) => b.block === 'reduce_damage'))) opts.push('items');
  return opts;
}

// react 액션 검증(규칙 위반이면 예외)
export function validateReaction(ctx, ch, ans, fail) {
  if (ans.pass) return;
  if (ans.intercept_by) {
    const g = ctx.s.chars[ans.intercept_by];
    if (!g || !guardiansFor(ctx, ch).includes(g)) fail('invalid_intercept');
  }
  let stamina = 0;
  const pool = [...pcards(ctx, ch.owner).hand];
  for (const id of ans.cards ?? []) {
    const i = pool.indexOf(id);
    if (i < 0) fail('card_not_in_hand', id);
    pool.splice(i, 1);
    const why = reactionCardUsable(ctx, ch, id);
    if (why) fail(why, id);
    const cd = card(ctx, id);
    const isEvade = cd.effect.some((b) => b.block === 'evade');
    // 다른 캐릭터(엄호한 수호자)가 내는 비용은 그 캐릭터 스테미너에서 — 맞는 캐릭터 합계에서 뺀다
    if (!(isEvade && evadeFree(ctx, ch)) && reactionPayer(ctx, ch, id) === ch) stamina += cd.stamina;
    const ds = cd.effect.find((b) => b.block === 'discard_supply');
    if (ds) {
      const pick = ans.discard_supply;
      if (!pick || !ch.bag.includes(pick) || (card(ctx, pick)?.sell ?? 0) < ds.min_sell) fail('evade_cost_unmet');
    }
  }
  if (stamina > ch.stamina) fail('not_enough_stamina');
  for (const id of ans.items ?? []) {
    if (!ch.bag.includes(id)) fail('item_not_in_bag', id);
    if (!card(ctx, id).effect?.some((b) => b.block === 'reduce_damage')) fail('not_reaction_item', id);
  }
}

function applyReaction(ctx, t, ans) {
  if (ans.pass) return;
  const ch = ctx.s.chars[t.target.id];
  if (ans.intercept_by) {
    t.target = { kind: 'char', id: ans.intercept_by };
    emit(ctx, { type: 'reaction_used', kind: 'intercept', by: ans.intercept_by, character: ch.id });
  }
  for (const id of ans.cards ?? []) {
    const cd = card(ctx, id);
    const P = pcards(ctx, ch.owner);
    P.hand.splice(P.hand.indexOf(id), 1);
    retireCard(ctx, ch.owner, id);   // 반응 카드도 소실 카드일 수 있음
    const isEvade = cd.effect.some((b) => b.block === 'evade');
    const payer = reactionPayer(ctx, ch, id) ?? ch;
    if (isEvade && evadeFree(ctx, ch)) ctx.s.players[ch.owner].round_flags[`free_evade_${ch.id}`] = true;
    else payer.stamina -= cd.stamina;
    for (const b of cd.effect) {
      if (b.block === 'defense_bonus') t.def_bonus += b.amount;
      if (b.block === 'reduce_damage') t.reduce += b.amount;
      if (b.block === 'evade') t.evaded = true;
      if (b.block === 'discard_supply') {
        ch.bag.splice(ch.bag.indexOf(ans.discard_supply), 1);
        ctx.s.decks.supply_discard.push(ans.discard_supply);
      }
    }
    emit(ctx, { type: 'reaction_used', card: id, character: ch.id, ...(payer !== ch ? { by: payer.id } : {}) });
  }
  for (const id of ans.items ?? []) {
    ch.bag.splice(ch.bag.indexOf(id), 1);
    ctx.s.decks.supply_discard.push(id);
    for (const b of card(ctx, id).effect) if (b.block === 'reduce_damage') t.reduce += b.amount;
    emit(ctx, { type: 'reaction_used', item: id, character: ch.id });
  }
}

// ---------- 토큰 주머니(예전 주사위, 2026-10-04 수정 사항 25) ----------
// 공격하는 쪽 주머니에서 꺼낸다(꺼내고 바로 다시 넣음). 이벤트 이름은 호환을 위해 dice_rolled 그대로, pouch에 주머니 id.
// info: 화면에 계산식을 보여 주기 위한 수치 { base, bonus, def, reduce } (2026-10-04 사용자 피드백 — "왜 피해 6?")
function rollAttack(ctx, t, info = {}) {
  const pouch = attackerPouch(ctx, t.attacker);
  const faces = [];
  for (let i = 0; i < Math.max(1, t.rolls); i++) faces.push(drawToken(ctx.s, pouch.tokens));
  let face = faces.reduce((a, b) => (attackRank(b) > attackRank(a) ? b : a));
  const meta = { pouch: pouch.id, attacker: t.attacker.id ?? null, target: t.target.id, ...info };
  if (faces.length > 1) emit(ctx, { type: 'dice_rolled', faces, face, chosen: face, ...meta });
  else emit(ctx, { type: 'dice_rolled', face, ...meta });
  // 추적 표식: 표식을 남긴 플레이어의 공격이 빗나감이면 한 번 다시 꺼냄
  const tgt = t.target.kind === 'foe' ? getFoe(ctx.s, t.target.id) : null;
  const who = attackerPlayer(ctx, t.attacker);
  // 약점 파악(해체 전문가 특전 "skull_reroll", 2026-10-08): 이 캐릭터의 공격은 늘 빗나감이면 한 번 다시 꺼낸다(표식 없이도)
  const weak = t.attacker.kind === 'char' && hasPassive(ctx, ctx.s.chars[t.attacker.id], 'skull_reroll');
  if (face === 'skull' && (weak || tgt?.statuses?.some((x) => x.status === 'marked' && x.by_player === who))) {
    face = drawToken(ctx.s, pouch.tokens);
    emit(ctx, { type: 'dice_rolled', face, reroll: true, ...meta });
  }
  return face;
}

// ---------- 공격 작업 ----------
TASKS.attack = (ctx, t) => {
  if (t.stage === null) {
    if (!alive(ctx, t.target)) return;
    if (t.is_extra && t.attacker.kind === 'char') emit(ctx, { type: 'extra_attack', character: t.attacker.id, target: t.target.id });
    declare(ctx, t);
    t.stage = 'react';
  }
  if (t.stage === 'react') {
    if (t.answer === undefined) {
      const ch = t.target.kind === 'char' ? ctx.s.chars[t.target.id] : null;
      if (ch && t.reactable) {
        const options = reactionOptions(ctx, ch, t);
        if (options.length) {
          // attack · no_dice: 반응 창에 보여 줄 이번 공격의 공격력(주사위 전, 2026-10-04 사용자 피드백 23)
          ask(ctx, t, { type: 'reaction', player: ch.owner, character: ch.id, options, attacker: t.attacker.id ?? 'explosion', source: t.source, attack: (t.base ?? 0) + (t.bonus ?? 0), no_dice: !!t.no_dice });
          return;
        }
      }
    } else {
      applyReaction(ctx, t, t.answer);
    }
    t.stage = 'roll';
  }
  if (t.evaded) {
    const ch = ctx.s.chars[t.target.id];
    emit(ctx, { type: 'evaded', character: ch.id });
    push(ctx, { type: 'mission_progress', player: ch.owner, char: ch.id, trigger: { type: 'evade_success' } });
    return;
  }
  resolveDamage(ctx, t);
};

function declare(ctx, t) {
  const a = t.attacker;
  if (t.source === 'zone') emit(ctx, { type: 'zone_attack', enemy: a.id, target: t.target.id });
  else if (t.source === 'enemy_turn' || t.source === 'noise') emit(ctx, { type: 'enemy_attack', enemy: a.id, target: t.target.id, reason: t.source });
  else if (t.source === 'action') {
    emit(ctx, { type: 'attack_declared', attacker: a.id, target: t.target.id, distance: dist(ctx, attackerCell(ctx, a), ref(ctx, t.target).ref.cell) });
  }
}

function resolveDamage(ctx, t) {
  const tgt = ref(ctx, t.target);
  if (!tgt.ref || (tgt.kind === 'char' && tgt.ref.exhausted)) return;
  let face = null;
  let raw;
  const power = t.base + t.bonus;
  const def = t.ignore_armor ? 0 : defenseOf(ctx, tgt) + t.def_bonus;
  if (t.no_dice) raw = power;
  else if (t.override === 'double_weapon') raw = t.base * 2;
  else {
    face = rollAttack(ctx, t, { base: t.base, bonus: t.bonus, bonus_src: t.bonus_src ?? [], def, reduce: t.reduce, ignore_armor: !!t.ignore_armor });
    if (face === 'skull') raw = 0;
    else if (face === 'x2') raw = power * 2;     // x2는 모든 보너스를 더한 뒤 마지막에 2배
    else raw = Math.max(0, power + faceValue(face));
  }
  const dmg = Math.max(0, Math.max(0, raw - def) - t.reduce); // 피해 감소는 방어력 다음, 마지막
  tgt.ref.hp = Math.max(0, tgt.ref.hp - dmg);
  const ev = { type: 'damage_applied', target: t.target.id, amount: dmg, hp_after: tgt.ref.hp, source: t.source };
  if (face === 'skull') ev.missed = true;
  emit(ctx, ev);

  const player = attackerPlayer(ctx, t.attacker);
  if (player && dmg >= 1) {
    if (tgt.kind === 'char' && tgt.ref.owner !== player) {
      push(ctx, { type: 'mission_progress', player, char: t.attacker.id ?? t.attacker.char, trigger: { type: 'attack_damaged', target_kind: 'other_player_character' } });
    } else if (tgt.kind === 'foe' && isBoss(ctx, tgt.ref)) {
      push(ctx, { type: 'mission_progress', player, char: t.attacker.id ?? t.attacker.char, trigger: { type: 'attack_damaged', target_kind: 'boss' } });
    }
  }

  const killer = { player, char: t.attacker.kind === 'char' ? t.attacker.id : t.attacker.char ?? null };
  const after = [];
  if (tgt.ref.hp <= 0) after.push({ type: 'death', target: t.target, killer });
  else if (tgt.kind === 'char' && t.attacker.kind !== 'explosion' && ['action', 'zone', 'enemy_turn', 'noise'].includes(t.source)) {
    const counter = counterFor(ctx, tgt.ref);
    if (counter && dist(ctx, attackerCell(ctx, t.attacker), tgt.ref.cell) <= counter.max_distance) {
      after.push({ type: 'counter', char: tgt.ref.id, attacker: t.attacker, block: counter });
    }
  }
  // 무기 특수 효과(기절 · 속박 · 독 · 밀어내기 · 흡혈, 2026-10-17): 피해를 1 이상 줬을 때. 쓰러짐 · 반격 다음, 산탄 · 추가 공격 전
  const hit = weaponHitTask(t, tgt, face, dmg);
  if (hit) after.push(hit);
  // 산탄: 치명(x2)일 때(예전 방식) 또는 챕터 1번 능력으로 쓴 공격이 맞았을 때(splash_always, 2026-10-17)
  if (t.splash && (t.splash_always ? face !== 'skull' && dmg >= 1 : face === 'x2')) after.push({ type: 'splash', attacker: t.attacker, primary: t.target, cell: tgt.ref.cell, amount: t.base, range: t.splash.range, killer });
  // 도탄 사격(2026-10-18): 이번 공격이 맞으면(빗나감 아님 · 피해 1 이상) 맞은 대상 주변의 다른 적에게 고정 피해. 추가 공격에는 다시 적용하지 않음
  if (t.ricochet && !t.is_extra && face !== 'skull' && dmg >= 1) after.push({ type: 'ricochet', attacker: t.attacker, primary: t.target, cell: tgt.ref.cell, range: t.ricochet.range, damage: t.ricochet.damage, killer });
  if (!t.is_extra && t.extras > 0 && face !== 'skull' && tgt.ref.hp > 0) {
    for (let i = 0; i < t.extras; i++) {
      after.push({ ...structuredClone(t), stage: null, is_extra: true, extras: 0, answer: undefined, waiting: false, def_bonus: 0, reduce: 0, evaded: false, target: t.target });
    }
  }
  push(ctx, ...after);
}

function counterFor(ctx, ch) {
  for (const p of perksWithHook(ctx, ch, 'on_hit')) for (const b of p.effect) if (b.block === 'counter_attack') return b;
  return null;
}

// 싸움꾼 반격: 판정 주사위 → 고정 피해(공격이 아니므로 반응 · 재반격 없음)
TASKS.counter = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (!ch || ch.exhausted || !alive(ctx, t.attacker.kind === 'foe' ? { kind: 'foe', id: t.attacker.id } : { kind: 'char', id: t.attacker.id })) return;
  const pouch = attackerPouch(ctx, { kind: 'char', id: ch.id });   // 반격 판정은 싸움꾼 자기 주머니
  const face = drawToken(ctx.s, pouch.tokens);
  emit(ctx, { type: 'dice_rolled', face, purpose: 'counter_check', character: ch.id, pouch: pouch.id, need: t.block.on_dice, damage: t.block.damage, target: t.attacker.id });
  if (!t.block.on_dice.includes(face)) return;
  emit(ctx, { type: 'counter_attack', character: ch.id, target: t.attacker.id });
  const target = { kind: t.attacker.kind === 'foe' ? 'foe' : 'char', id: t.attacker.id };
  applyFixedDamage(ctx, target, t.block.damage, { player: ch.owner, char: ch.id });
};

// 고정 피해: 주사위 · 방어력 · 반응 없이 그대로
export function applyFixedDamage(ctx, target, amount, killer) {
  const r = ref(ctx, target);
  if (!r.ref) return;
  r.ref.hp = Math.max(0, r.ref.hp - amount);
  emit(ctx, { type: 'damage_applied', target: target.id, amount, fixed: true, hp_after: r.ref.hp });
  if (r.ref.hp <= 0) push(ctx, { type: 'death', target, killer });
}

// 무기 효과로 주는 추가 피해(산탄): 대상의 방어력만 적용, 반응 없음
TASKS.splash = (ctx, t) => {
  const exclude = new Set([t.primary.id, t.attacker.id]);
  const targets = [
    ...allFoes(ctx.s).filter((f) => !exclude.has(f.uid) && dist(ctx, f.cell, t.cell) <= t.range).map((f) => ({ kind: 'foe', id: f.uid })),
    ...Object.values(ctx.s.chars).filter((c) => !exclude.has(c.id) && !c.exhausted && c.cell != null && dist(ctx, c.cell, t.cell) <= t.range)
      .map((c) => ({ kind: 'char', id: c.id })),
  ];
  const after = [];
  for (const target of targets) {
    const r = ref(ctx, target);
    const dmg = Math.max(0, t.amount - defenseOf(ctx, r));
    r.ref.hp = Math.max(0, r.ref.hp - dmg);
    emit(ctx, { type: 'damage_applied', target: target.id, amount: dmg, hp_after: r.ref.hp, source: 'splash' });
    if (r.ref.hp <= 0) after.push({ type: 'death', target, killer: t.killer });
  }
  push(ctx, ...after);
};

// 도탄 사격(2026-10-18): 맞은 대상 주변 range칸 이내의 다른 적(좀비 · 보스) 모두에게 고정 피해 — 캐릭터는 맞지 않음
TASKS.ricochet = (ctx, t) => {
  const hits = allFoes(ctx.s).filter((f) => f.uid !== t.primary.id && f.cell != null && dist(ctx, f.cell, t.cell) <= t.range);
  emit(ctx, { type: 'ricochet', attacker: t.attacker.id ?? null, targets: hits.map((f) => f.uid), damage: t.damage });
  for (const f of hits) applyFixedDamage(ctx, { kind: 'foe', id: f.uid }, t.damage, t.killer);
};

// ---------- 처치 · 탈진 ----------
TASKS.death = (ctx, t) => {
  const { killer } = t;
  if (t.target.kind === 'char') {
    const ch = ctx.s.chars[t.target.id];
    if (!ch || ch.exhausted) return;
    ch.exhausted = true;
    ch.hp = 0;
    emit(ctx, { type: 'exhausted', character: ch.id, by_player: killer?.player ?? null });
    if (killer?.player && killer.player !== ch.owner) gainVp(ctx, killer.player, ctx.s.config.scoring.pvp_exhaust, 'pvp_exhaust');
    return;
  }
  const foe = getFoe(ctx.s, t.target.id);
  if (!foe) return;
  const boss = isBoss(ctx, foe);
  const def = foeDef(ctx, foe);
  if (boss) delete ctx.s.bosses[foe.uid];
  else {
    delete ctx.s.enemies[foe.uid];
    if (foe.from_supply) ctx.s.decks.supply_discard.push(foe.from_supply);
    else if (foe.from_search) ctx.s.decks.search_discard.push(foe.from_search);
    else ctx.s.decks.enemy_discard.push(foe.type);
  }
  const player = killer?.player ?? null;
  const tasks = [];
  if (boss) {
    const order = ++ctx.s.game.bosses_killed_count;
    emit(ctx, { type: 'boss_killed', boss: foe.uid, boss_type: foe.type, by_player: player, order });
    if (player) {
      ctx.s.players[player].bosses_killed.push(foe.type);
      tasks.push({ type: 'rewards', player, char: killer.char, blocks: def.reward, vp_source: 'boss' });
      tasks.push({ type: 'boss_bonus', player, char: killer.char, order });
    }
  } else {
    emit(ctx, { type: 'enemy_killed', enemy: foe.uid, enemy_type: foe.type, by_player: player });
    if (player) {
      emit(ctx, { type: 'reward_gained', player, enemy: foe.uid });
      tasks.push({ type: 'rewards', player, char: killer.char, blocks: def.reward, vp_source: 'enemy' });   // 처치 승점(2026-10-03)
      // 처치 특전(hook "on_kill", 2026-10-08 신규 직업): 약탈자 코인 +1 · 해체 전문가 부품 +1 — 처치한 캐릭터의 특전
      const kch = killer.char ? ctx.s.chars[killer.char] : null;
      if (kch) tasks.push({ type: 'perk_hook', hook: 'on_kill', char: kch.id });
    }
  }
  if (player) tasks.push({ type: 'mission_progress', player, char: killer.char, trigger: { type: 'enemy_killed', boss, enemy: foe.type, zone: cellOf(ctx.map, foe.cell)?.zone ?? null } });
  if (def.special === 'explode_on_death') {
    tasks.push({ type: 'explosion', enemy: foe.uid, cell: foe.cell, amount: foeStat(ctx, foe, 'attack'), killer });
  }
  push(ctx, ...tasks);
};

// 캐릭터 특전 훅 하나를 실행(처치 · 약탈 같은 사건 뒤, 2026-10-08)
TASKS.perk_hook = (ctx, t) => {
  const ch = ctx.s.chars[t.char];
  if (!ch) return;
  for (const p of perksWithHook(ctx, ch, t.hook)) runBlocks(ctx, p.effect, { player: ch.owner, char: ch, vp_source: 'perk', src: { perk: p.text_key ?? null, char: ch.char } });
};

TASKS.rewards = (ctx, t) => {
  runBlocks(ctx, t.blocks, { player: t.player, char: t.char ? ctx.s.chars[t.char] : null, vp_source: t.vp_source });
};

TASKS.boss_bonus = (ctx, t) => {
  const bonus = ctx.s.config.scoring.boss_kill_order_bonus[t.order - 1] ?? 0;
  gainVp(ctx, t.player, bonus, 'boss_order');
  const ch = t.char ? ctx.s.chars[t.char] : null;
  if (ch) for (const p of perksWithHook(ctx, ch, 'on_boss_kill')) runBlocks(ctx, p.effect, { player: t.player, char: ch, vp_source: 'perk' });
};

// 봄버 폭발: 거리 1 이내 모든 대상에게 주사위 없이 공격력만큼. 방어력 · 방어 카드 · 회피 적용.
TASKS.explosion = (ctx, t) => {
  emit(ctx, { type: 'explosion', enemy: t.enemy, cell: t.cell, amount: t.amount });
  const attacker = { kind: 'explosion', player: t.killer?.player ?? null, char: t.killer?.char ?? null };
  const tasks = [];
  for (const f of allFoes(ctx.s)) {
    if (dist(ctx, f.cell, t.cell) <= 1) tasks.push(attackTask(attacker, { kind: 'foe', id: f.uid }, { source: 'explosion', base: t.amount, no_dice: true }));
  }
  const chars = Object.values(ctx.s.chars).filter((c) => !c.exhausted && c.cell != null && dist(ctx, c.cell, t.cell) <= 1).sort((a, b) => a.order - b.order);
  for (const c of chars) tasks.push(attackTask(attacker, { kind: 'char', id: c.id }, { source: 'explosion', base: t.amount, no_dice: true }));
  push(ctx, ...tasks);
};

export { activeCharsAt, bagCap };
