// 효과 블록 레지스트리: 블록 이름 → 처리 함수. 새 블록은 여기에 등록만 추가한다(아키텍처 원칙 9).
// env: { player, char, target, cell, attack, ... } — 블록을 쓰는 상황의 문맥
//
// 공격 수정 블록(attack_bonus 등)은 env.attack(공격 작업)을 고친다.
// 아직 처리하지 않는 블록은 not_implemented로 거절한다(데이터에는 있으나 프로토 1차에서 쓰지 않는 것).

import { BLOCKS, fail, emit, push, gainCoins, gainVp, gainParts, drawPlayerCards, card, getFoe, armorDefense, allFoes, dist, singleOcc, freeNeighbors } from './core.js';
import { canStop } from './map.js';
import { randomInt } from './rng.js';
import { drawSupplyTo, spawnFoe, gainTokens, spawnCell, sellCard } from './supply.js';
import { drawCard } from './core.js';

const onChar = (env) => env.target?.kind === 'char' ? env.target.ref : env.char;

// ---- 자원 · 카드 ----
BLOCKS.gain_coin = (ctx, b, env) => gainCoins(ctx, env.player, b.amount);
BLOCKS.pay_coin = (ctx, b, env) => {
  const cost = Math.max(0, b.amount + (env.coin_discount ?? 0));
  if (ctx.s.players[env.player].coins < cost) fail('not_enough_coins');
  ctx.s.players[env.player].coins -= cost;
  emit(ctx, { type: 'coins_changed', player: env.player, amount: -cost });
};
BLOCKS.gain_vp = (ctx, b, env) => gainVp(ctx, env.player, b.amount, env.vp_source ?? 'effect');
BLOCKS.gain_material = (ctx, b, env) => gainParts(ctx, env.player, b.amount, { char: env.char?.id ?? null });   // 부품 = 자원(신규 4)
BLOCKS.draw_supply = (ctx, b, env) => {
  if (!env.char) return;
  push(ctx, drawSupplyTo(ctx, env.char, b.amount));
};
BLOCKS.draw_investigation = (ctx, b, env) => {
  if (!env.char) return;
  const cards = [];
  for (let i = 0; i < b.amount; i++) { const id = drawCard(ctx, 'investigation'); if (id) cards.push(id); }
  push(ctx, { type: 'acquire', char: env.char.id, cards });
};
BLOCKS.gain_token = (ctx, b, env) => {
  if (!env.char) return;
  push(ctx, ...gainTokens(ctx, env.char, b.token === 'research' ? 'lab' : 'survivor', b.amount ?? 1));
};
BLOCKS.draw_player_card = (ctx, b, env) => {
  const player = env.player ?? env.char?.owner;
  if (player) { drawPlayerCards(ctx, player, b.amount); push(ctx, { type: 'hand_limit', players: [player] }); }
};

// ---- 체력 · 스테미너 ----
// 여러 캐릭터 대상(2026-10-19 카드 운용 버전 구원자): my_chars_in_range = range칸 안의 내 캐릭터 모두(자신 포함) · my_chars = 내 캐릭터 모두(거리 무관)
function myChars(ctx, b, env) {
  return Object.values(ctx.s.chars).filter((c) => c.owner === env.char.owner && !c.exhausted && c.cell != null
    && (b.target === 'my_chars' || dist(ctx, c.cell, env.char.cell) <= (b.range ?? 1)));
}
BLOCKS.heal = (ctx, b, env) => {
  if (b.target === 'my_chars_in_range' || b.target === 'my_chars') { for (const c of myChars(ctx, b, env)) BLOCKS.heal(ctx, { ...b, target: null }, { ...env, target: { kind: 'char', id: c.id, ref: c } }); return; }
  const ch = onChar(env);
  const before = ch.hp;
  ch.hp = b.hp === 'full' ? ch.max_hp : Math.min(ch.max_hp, ch.hp + b.hp + (env.heal_bonus ?? 0));
  emit(ctx, { type: 'healed', character: ch.id, amount: ch.hp - before });
};
BLOCKS.restore_stamina = (ctx, b, env) => {
  if (b.target === 'my_chars_in_range' || b.target === 'my_chars') { for (const c of myChars(ctx, b, env)) BLOCKS.restore_stamina(ctx, { ...b, target: null }, { ...env, target: { kind: 'char', id: c.id, ref: c } }); return; }
  const ch = onChar(env);
  ch.stamina = b.amount === 'full' ? ch.max_stamina : Math.min(ch.max_stamina, ch.stamina + b.amount);
};
BLOCKS.lose_stamina = (ctx, b, env) => {
  const ch = env.char;
  ch.stamina = Math.max(0, ch.stamina - b.amount);
};
// 공격이 아닌 피해(함정 등): 방어구의 방어력만 적용, 반응 없음
BLOCKS.take_damage = (ctx, b, env) => {
  const ch = env.char;
  const dmg = Math.max(0, b.amount - armorDefense(ctx, ch));
  ch.hp = Math.max(0, ch.hp - dmg);
  emit(ctx, { type: 'damage_applied', target: ch.id, amount: dmg, hp_after: ch.hp, source: 'trap' });
  if (ch.hp <= 0) push(ctx, { type: 'death', target: { kind: 'char', id: ch.id }, killer: null });
};
BLOCKS.revive = (ctx, b, env) => {
  const ch = env.target.ref;
  ch.exhausted = false;
  ch.hp = b.hp === 'full' ? ch.max_hp : b.hp === 'half_round_up' ? Math.ceil(ch.max_hp / 2) : b.hp;
  ch.stamina = b.stamina === 'full' ? ch.max_stamina : b.stamina;
  emit(ctx, { type: 'revived', character: ch.id, method: 'item', by: env.char.id, item: env.item ?? env.card_id ?? null });
};
BLOCKS.transfer_stamina = (ctx, b, env) => {
  const to = env.target.ref;
  const n = Math.min(b.amount, env.char.stamina);
  env.char.stamina -= n;
  to.stamina = Math.min(to.max_stamina, to.stamina + n);
};

// ---- 공격 수정 (env.attack = 공격 작업) ----
BLOCKS.attack_bonus = (ctx, b, env) => {
  const n = b.per === 'bag_count' ? Math.min(env.char.bag.length, b.max ?? Infinity) : b.amount;
  env.attack.bonus += n;
  // 보너스 출처(화면 계산식에 "싸움꾼 특전 +2"처럼 나눠 보여 주려고, 2026-10-04 사용자 피드백 — 피해 6이 버그처럼 보임)
  if (env.src && n) (env.attack.bonus_src ??= []).push({ ...env.src, amount: n });
};
BLOCKS.range_bonus = () => {};           // 사거리는 공격 검증 때 미리 계산한다
// 도탄(2026-10-18 사용자 결정 — 사냥꾼 "저격 태세"(사거리 +2)는 대상을 이미 고른 뒤라 쓸 데가 없어서 "도탄 사격"으로 바꿈):
// 이번 공격이 맞으면 맞은 대상 주변의 다른 적에게 고정 피해. 실제 처리는 combat.js(공격 결과 뒤 ricochet 작업)
BLOCKS.ricochet = (ctx, b, env) => { if (env.attack) env.attack.ricochet = { range: b.range ?? 1, damage: b.damage ?? 1 }; };
BLOCKS.dice_advantage = (ctx, b, env) => { env.attack.rolls = Math.max(env.attack.rolls, b.rolls); };
BLOCKS.extra_attack = (ctx, b, env) => { env.attack.extras += 1; };
BLOCKS.attack_override = (ctx, b, env) => { env.attack.override = b.mode; };

// ---- 피해 · 상태 ----
BLOCKS.deal_damage = (ctx, b, env) => {
  let targets;
  if (b.target === 'adjacent_weakest_enemy') {
    // 옆 칸(같은 칸 포함)에서 체력이 가장 낮은 적 하나(같으면 먼저 나온 적) — 기습(2026-10-03)
    const foe = allFoes(ctx.s).filter((f) => dist(ctx, f.cell, env.char.cell) <= 1).sort((x, y) => x.hp - y.hp || (x.seq ?? 0) - (y.seq ?? 0))[0];
    if (!foe) return;
    targets = [{ kind: 'foe', id: foe.uid, ref: getFoe(ctx.s, foe.uid) }];
  } else targets = b.target === 'all_enemies_in_cell' ? Object.values(ctx.s.enemies).filter((f) => f.cell === env.target.ref.cell).map((f) => ({ kind: 'foe', id: f.uid, ref: f })) : [env.target];
  for (const t of targets) {
    const r = t.ref;
    r.hp = Math.max(0, r.hp - b.amount);
    emit(ctx, { type: 'damage_applied', target: t.id, amount: b.amount, hp_after: r.hp, source: 'effect' });
    if (r.hp <= 0) push(ctx, { type: 'death', target: { kind: t.kind, id: t.id }, killer: { player: env.player, char: env.char.id } });
  }
};
BLOCKS.grant_status = (ctx, b, env) => {
  const t = b.target === 'chosen_enemy' ? env.target : { kind: 'char', id: env.char.id, ref: env.char };
  if (!t?.ref) fail('invalid_target');
  const st = { status: b.status, duration: b.duration };
  for (const k of ['amount', 'range', 'count']) if (b[k] != null) st[k] = b[k];
  if (b.status === 'marked') st.by_player = env.player;
  t.ref.statuses.push(st);
  emit(ctx, { type: 'status_granted', status: b.status, target: t.id, duration: b.duration });
};

// ---- 맵 · 적 ----
BLOCKS.noise = (ctx, b, env) => {
  const cell = b.at === 'chosen_cell' ? env.chosen_cell : env.cell ?? env.char?.cell;
  push(ctx, { type: 'noise', cell, source_char: (env.source_char ?? env.char)?.id ?? null });
};
BLOCKS.spawn_enemy = (ctx, b, env) => {
  // 한 칸에 하나 규칙: 카드를 가져간 캐릭터 옆 빈칸에 나타남(2026-10-03). 자리가 없으면 카드만 버림
  const cell = spawnCell(ctx, env.cell);
  if (!cell) {
    if (env.from_supply) ctx.s.decks.supply_discard.push(env.from_supply);
    if (env.from_search) ctx.s.decks.search_discard.push(env.from_search);
    return;
  }
  const id = spawnFoe(ctx, b.enemy, cell, env.from_supply ? { from_supply: env.from_supply } : env.from_search ? { from_search: env.from_search } : {});
  emit(ctx, { type: 'enemy_spawned', enemy: id, enemy_type: b.enemy, cell });
};

// ---- 상시 · 쉘터 수정 블록: 각 규칙 처리 쪽에서 직접 읽으므로 실행 시에는 아무것도 하지 않는다 ----
for (const name of ['stat_mod', 'allow_grapple', 'forbid_evade', 'ignore_armor', 'wild_investigation', 'pass_hidden_enemies', 'pass_enemies',
  'mod_revive', 'mod_upgrade_cost', 'mod_heal', 'mod_mission_draw', 'mod_black_market_cost', 'mod_card_cost', 'free_card_use', 'card_bonus_recover',
  'rough_free', 'skull_reroll', 'draw_look_extra', 'rest_bonus', 'rest_multiplier', 'defense_bonus', 'reduce_damage', 'evade', 'intercept', 'counter_attack',
  'splash_damage', 'move_bonus', 'discard_supply', 'access_storage']) {
  BLOCKS[name] ??= () => {};
}

// ---- 브로커 카드(2026-10-03 사용자 결정 — 돈 쪽 강점) ----
// 자산 정리: 가방의 보급품 카드 1장을 지금 판매(정비가 아니어도). env.choice = 팔 카드(없으면 판매가가 가장 높은 카드)
BLOCKS.sell_now = (ctx, b, env) => {
  const ch = env.char;
  const sellable = ch.bag.filter((id) => id !== 'part' && card(ctx, id)?.sell != null);
  const pick = env.choice ?? [...sellable].sort((x, y) => card(ctx, y).sell - card(ctx, x).sell)[0];
  if (!pick || !sellable.includes(pick)) fail('nothing_to_sell');
  sellCard(ctx, ch, pick, ch.bag, { fromStorage: false });
};
// 뇌물: 드러난 보급품 카드 1장을 가져감(빈 자리는 다시 채움). env.choice = 자리 번호(없으면 첫 카드)
BLOCKS.take_open_supply = (ctx, b, env) => {
  const open = ctx.s.board.open_supply;
  const slot = env.choice ?? open.findIndex(Boolean);
  if (slot == null || slot < 0 || !open[slot]) fail('empty_slot');
  const id = open[slot];
  open[slot] = null;
  push(ctx, { type: 'acquire', char: env.char.id, cards: [id] }, { type: 'refill', slot, char: env.char.id });
};

// ---- 2026-10-08 미구현 카드 채우기(사용자 요청 — 플레이 테스트 중 "미구현"으로 막히던 카드들) ----

// 짐꾼 "짊어지기": 이번 차례(this_action → 차례 끝에 지움) 가방 용량 +amount. 넘친 카드는 다음에 카드를 얻을 때 정리(bag_check)
BLOCKS.bag_overflow = (ctx, b, env) => {
  const ch = env.char;
  ch.statuses.push({ status: 'bag_plus', amount: b.amount ?? 1, duration: b.duration ?? 'this_action' });
  emit(ctx, { type: 'status_granted', status: 'bag_plus', target: ch.id, duration: b.duration ?? 'this_action' });
};

// 수호자 "집결": range 이내 내 다른 캐릭터를 내 칸으로(한 칸에 하나 규칙이면 내 옆 빈 칸 중 그 캐릭터에게 가장 가까운 칸). 이동력 소모 없음
BLOCKS.pull_ally = (ctx, b, env) => {
  const ch = env.char;
  const t = env.target?.ref;
  if (env.target?.kind !== 'char' || !t || t.owner !== ch.owner || t.id === ch.id || t.exhausted || t.cell == null) fail('invalid_target');
  if (dist(ctx, ch.cell, t.cell) > (b.range ?? 2)) fail('out_of_range');
  let to = ch.cell;
  if (singleOcc(ctx)) {
    const free = freeNeighbors(ctx, ch.cell).filter((c) => canStop(ctx.map, c));
    if (!free.length) fail('no_free_cell');
    to = free.sort((x, y) => dist(ctx, x, t.cell) - dist(ctx, y, t.cell))[0];
  }
  if (to === t.cell) return;
  const from = t.cell;
  t.cell = to;
  emit(ctx, { type: 'moved', character: t.id, path: [from, to], pulled_by: ch.id });
};

// 예언자 "재구성": 고른 손패(env.choice — 배열)를 버리고 같은 수만큼 다시 뽑음
BLOCKS.cycle_hand = (ctx, b, env) => {
  const P = ctx.s.players[env.player];
  const list = Array.isArray(env.choice) ? env.choice : [];
  for (const id of list) { P.hand.splice(P.hand.indexOf(id), 1); P.discard.push(id); }
  if (list.length) emit(ctx, { type: 'hand_cycled', player: env.player, count: list.length });
  drawPlayerCards(ctx, env.player, list.length);
};

// 예언자 "예지": 내 플레이어 카드 덱 위 look장을 보고 take장을 손패로, 나머지는 원래 순서대로 덱 위에(고르는 결정 — pick_card)
BLOCKS.look_top_take = (ctx, b, env) => {
  push(ctx, { type: 'look_take', player: env.player, char: env.char?.id ?? null, look: b.look ?? 3, take: b.take ?? 1, card: env.src?.card ?? null });
};

// 예언자 "통찰": 다른 플레이어 한 명(env.choice)의 손패에서 무작위 1장을 나만 확인(정보만 — 상태는 그대로)
BLOCKS.peek_player_card = (ctx, b, env) => {
  const other = env.choice;
  if (!other || other === env.player || !ctx.s.players[other]) fail('invalid_target');
  const hand = ctx.s.players[other].hand;
  if (!hand.length) { emit(ctx, { type: 'card_peeked', player: env.player, target: other, card: null }); return; }
  const id = hand[randomInt(ctx.s, hand.length)];
  // 비공개 정보: 이 이벤트는 본 플레이어(player)만 보여야 한다 — 화면은 "나"가 player일 때만 카드를 띄움(온라인 때 이벤트 필터 필요)
  emit(ctx, { type: 'card_peeked', player: env.player, target: other, card: id, private_to: env.player });
};

// 사냥꾼 "치고 빠지기": 이동 검증 · 공격은 actions.js(play_card)에서 처리 — 여기선 아무것도 안 함
BLOCKS.move_then_attack = () => {};
// 연속 행동 · 범위 공격(2026-10-19): 처리는 actions.js(play_card · attack)와 flow.js(combo 단계 묻기)
BLOCKS.combo = () => {};
BLOCKS.attack_area = () => {};
BLOCKS.bonus_move = () => {};   // 전력 질주(2026-10-18): 이동 처리는 actions.js play_card

// ---- 1차 프로토에서 아직 처리하지 않는 블록 ----
export const UNIMPLEMENTED_BLOCKS = new Set(['take_open_supply', 'look_top_take', 'cycle_hand', 'sell_now', 'bag_overflow', 'peek_player_card',
  'move_then_attack', 'pull_ally'].filter((name) => !BLOCKS[name]));
for (const name of UNIMPLEMENTED_BLOCKS) BLOCKS[name] = () => fail('not_implemented', name);

export { card, getFoe };
