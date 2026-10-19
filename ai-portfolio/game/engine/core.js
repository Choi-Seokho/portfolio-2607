// 룰 엔진 핵심: 액션 제출 → 검증 → 작업(task) 실행 → 이벤트.
//
// - 게임의 모든 상태는 state 객체 하나(순수 데이터)에 있다. 콘텐츠(카드 · 캐릭터 데이터)는 content에 따로 있다.
// - submit()은 state를 복사해서 작업하고, 규칙 위반이면 원래 state를 그대로 돌려준다.
// - 도중에 플레이어의 선택이 필요하면(반응 · 버릴 카드 등) state.pending에 질문을 남기고 멈춘다.
//   남은 처리는 state.stack(작업 목록)에 저장되므로, 그대로 저장 · 전송했다가 이어서 진행할 수 있다.

import { segDist, cellOf, graph } from './map.js';
import { shuffle, DICE_FACES } from './rng.js';

export const ACTIONS = {};   // 액션 type → (ctx, action) 처리 함수
export const TASKS = {};     // 작업 type → (ctx, task) 처리 함수
export const BLOCKS = {};    // 효과 블록 이름 → (ctx, block, env) 처리 함수 (레지스트리)
export const ANSWERS = new Set(['react', 'choose', 'bm_bid', 'place_character']);

export class RuleError extends Error {
  constructor(code, detail) {
    super(code + (detail ? `: ${detail}` : ''));
    this.code = code;
  }
}
export const fail = (code, detail) => { throw new RuleError(code, detail); };

export function submit(state, action, content) {
  const s = structuredClone(state);
  const ctx = { s, c: content, map: content.maps[s.map_id], events: [] };
  try {
    if (s.pending && !ANSWERS.has(action.type)) fail('pending_decision');
    const handler = ACTIONS[action.type];
    if (!handler) fail('unknown_action', action.type);
    handler(ctx, action);
    run(ctx);
    return { ok: true, state: s, events: ctx.events };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.code, detail: e.message, state, events: [] };
    throw e;
  }
}

export function run(ctx) {
  const { s } = ctx;
  while (!s.pending && s.stack.length) {
    const task = s.stack.pop();
    const handler = TASKS[task.type];
    if (!handler) throw new Error(`unknown task ${task.type}`);
    handler(ctx, task);
  }
}

export const emit = (ctx, ev) => { ctx.events.push(ev); };

// 작업을 적은 순서대로 실행되게 쌓는다
export function push(ctx, ...tasks) {
  for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i]) ctx.s.stack.push(tasks[i]);
}

// 작업을 멈추고 플레이어에게 묻는다. 답은 task.answer에 들어온 뒤 같은 작업이 다시 실행된다.
export function ask(ctx, task, pending) {
  task.waiting = true;
  ctx.s.stack.push(task);
  ctx.s.pending = pending;
}

// 답변 액션: 대기 중인 작업에 답을 넣고 이어서 실행
export function answer(ctx, value) {
  const task = ctx.s.stack[ctx.s.stack.length - 1];
  task.answer = value;
  task.waiting = false;
  ctx.s.pending = null;
}

export const uid = (ctx, prefix) => `${prefix}${++ctx.s.game.uid}`;
export const nextSeq = (ctx) => ++ctx.s.game.seq;

// ---------- 덱 ----------
const DISCARD_OF = { supply: 'supply_discard', enemy: 'enemy_discard', investigation: 'investigation_discard', search: 'search_discard' };

export function drawCard(ctx, deck) {
  const d = ctx.s.decks;
  if (!d[deck]) d[deck] = [];
  if (d[deck].length === 0 && DISCARD_OF[deck] && d[DISCARD_OF[deck]]?.length) {
    d[deck] = shuffle(ctx.s, d[DISCARD_OF[deck]].splice(0));
  }
  return d[deck].shift() ?? null;
}

export function toDeck(ctx, deck, card) {
  if (!ctx.s.decks[deck]) ctx.s.decks[deck] = [];
  ctx.s.decks[deck].push(card);
}

// ---------- 플레이어 카드(손패 · 덱 · 버린 카드는 플레이어 공용, 2026-09-30 AC-1) ----------
// 두 캐릭터가 한 손패를 같이 쓴다. 전용 카드(card.char)는 그 캐릭터만 쓸 수 있고, 스테미너는 카드를 쓰는 캐릭터가 낸다.
export const pcards = (ctx, player) => ctx.s.players[player];
export const handMax = (ctx) => ctx.s.config.hand.max_per_player;

// 이 캐릭터가 이 카드를 쓸 수 있는가(공용 카드는 누구나, 전용 카드는 주인 캐릭터만)
export function cardOwnerOk(ctx, ch, id) {
  const cd = ctx.c.cards[id];
  return !cd?.char || cd.char === ch.char;
}

// 플레이어의 덱에서 뽑기(덱이 모자라면 버린 카드를 섞는다)
export function drawPlayerCards(ctx, player, n) {
  const P = pcards(ctx, player);
  const got = [];
  for (let i = 0; i < n; i++) {
    if (P.deck.length === 0 && P.discard.length) P.deck = shuffle(ctx.s, P.discard.splice(0));
    if (P.deck.length === 0) break;
    const card = P.deck.shift();
    P.hand.push(card);
    got.push(card);
  }
  if (got.length) emit(ctx, { type: 'card_drawn', player, deck: 'player', count: got.length });
  return got;
}

// ---------- 캐릭터 ----------
export const charDef = (ctx, ch) => ctx.c.chars[ch.char];
export const card = (ctx, id) => ctx.c.cards[id];
// 카드 운용 버전(2026-10-18): 카드의 기본 아이콘 — 'move' · 'attack'(공용 이동 · 공격 카드, 전용 카드에 같이 그려진 아이콘). 없으면 null
export const basicOf = (cd) => cd?.basic ?? null;
// 기본 아이콘으로 쓸 때 스테미너(config.card_mode.basic_cost[종류] → basic_stamina, 기본 1) · 아이템 사용 스테미너(item_stamina — 아이템에 stamina_cost가 있으면 그 값)
// 2026-10-19 사용자 결정: 기본 기능 "카드 2장 뽑기"(draw)는 스테미너 0
export const basicStamina = (s, kind = null) => s.config.card_mode?.basic_cost?.[kind] ?? s.config.card_mode?.basic_stamina ?? 1;
export const itemStamina = (s, cd) => (s.config.turn_mode === 'cards' && s.turn?.phase === 'player_turn') ? (cd?.stamina_cost ?? s.config.card_mode?.item_stamina ?? 1) : 0;

// 연구 카드는 가방이 아니라 쉘터의 연구 보관함(shelter.research)에 있다 — 2026-10-08 사용자 결정(AF-1: "전부 카드로, 단 가방 슬롯은 차지하지 않고 얻는 즉시 쉘터로").
// 그래도 캐릭터가 필요할 때 꺼내 쓸 수 있어야 하므로, 아이템 사용 · 공격에 같이 쓰기는 가방 또는 연구 보관함 어느 쪽에서든 가능.
export const hasItem = (ctx, ch, id) => ch.bag.includes(id) || (card(ctx, id)?.kind === 'research' && ctx.s.shelter[ch.owner].research.includes(id));
// 연구실 레벨 조건(2026-10-18 사용자 결정 — 연구 카드는 연구실(f_lab) 레벨이 카드의 lab_level 이상일 때만 사용. 얻는 건 언제든)
export const labLevel = (ctx, player) => ctx.s.shelter[player]?.facilities?.f_lab ?? 0;
export function researchLocked(ctx, player, cd) {
  const need = cd?.kind === 'research' ? cd.lab_level ?? 0 : 0;
  return need > labLevel(ctx, player) ? need : 0;
}
export function takeItem(ctx, ch, id) {
  const i = ch.bag.indexOf(id);
  if (i >= 0) { ch.bag.splice(i, 1); return; }
  const r = ctx.s.shelter[ch.owner].research;
  r.splice(r.indexOf(id), 1);
}

// 쓴 플레이어 카드를 치운다: 보통은 버린 더미(덱이 떨어지면 섞어서 재활용), 카드 데이터에 "exile": true가 있으면
// 소실(players[p].exiled — 게임에서 빠져 다시 안 돌아옴). 2026-10-07 사용자 요청("강력한 카드는 쓰면 소실") — 효과 카드 디자인 초안은 docs/exile-cards.md
export function retireCard(ctx, player, id) {
  const P = ctx.s.players[player];
  // 카드 운용 버전은 소실 없음(2026-10-19 사용자 결정 — "소실은 리스크가 크다", 기본 행동 버전은 그대로)
  if (card(ctx, id)?.exile && ctx.s.config.turn_mode !== 'cards') {
    (P.exiled ??= []).push(id);
    emit(ctx, { type: 'card_exiled', player, card: id });
  } else P.discard.push(id);
}
export const ownerOf = (ctx, ch) => ctx.s.players[ch.owner];

export function getChar(ctx, id) {
  const ch = ctx.s.chars[id];
  if (!ch) fail('unknown_character', id);
  return ch;
}

export function charsOf(ctx, player) {
  return Object.values(ctx.s.chars).filter((ch) => ch.owner === player);
}

export function equipCards(ctx, ch) {
  return Object.values(ch.equip ?? {}).filter(Boolean).map((id) => card(ctx, id));
}

export function condOk(ctx, ch, cond, env = {}) {
  if (!cond) return true;
  for (const [k, v] of Object.entries(cond)) {
    if (k === 'distance_max' && !(env.distance <= v)) return false;
    if (k === 'distance_min' && !(env.distance >= v)) return false;
    if (k === 'hp_at_most_half' && !(ch.hp * 2 <= ch.max_hp)) return false;
    if (k === 'bag_count_min' && !(ch.bag.length >= v)) return false;
    if (k === 'bag_full' && !(ch.bag.length >= bagCap(ctx, ch))) return false;
    if (k === 'armor_equipped' && !ch.equip?.armor) return false;
    if (k === 'at_cell_type' && cellOf(ctx.map, ch.cell)?.type !== v) return false;   // 그 종류 칸에 서 있을 때만(재생 = 캠프, 2026-10-17)
  }
  return true;
}

// 장비의 상시 능력 + 조건을 만족하는 상시 특전
export function passives(ctx, ch, { conditional = true } = {}) {
  const out = [];
  for (const cd of equipCards(ctx, ch)) for (const b of cd.passive ?? []) out.push(b);
  for (const p of charDef(ctx, ch).perks) {
    if (p.hook !== 'passive') continue;
    if (p.condition && (!conditional || !condOk(ctx, ch, p.condition))) continue;
    for (const b of p.effect) out.push(b);
  }
  return out;
}

export const hasPassive = (ctx, ch, name) => passives(ctx, ch).some((b) => b.block === name);

// 그래플링을 쓸 수 있는가: 특성(perk)이면 제한 없음, 장비 카드면 이번 라운드에 아직 안 눕힌 것(once_per_round, 2026-10-01).
// 돌려주는 값: null(못 씀) · { perk: true } · { card: 카드 } — 카드면 쓴 뒤 tapItem으로 눕힌다.
export function grappleSource(ctx, ch) {
  for (const p of charDef(ctx, ch).perks) {
    if (p.hook === 'passive' && (!p.condition || condOk(ctx, ch, p.condition)) && p.effect.some((b) => b.block === 'allow_grapple')) {
      // 라운드당 1번만 쓰는 특전 그래플링(닌자, 2026-10-08): 쓰면 ch.tapped에 'perk:캐릭터id' 표시를 남기고 라운드 끝에 지운다
      const once = p.effect.find((b) => b.block === 'allow_grapple')?.once_per_round;
      const token = `perk:${ch.char}`;
      if (once && (ch.tapped ?? []).includes(token)) continue;
      return once ? { perk: true, once_per_round: true, token } : { perk: true };
    }
  }
  for (const cd of equipCards(ctx, ch)) {
    if (!(cd.passive ?? []).some((b) => b.block === 'allow_grapple')) continue;
    if (cd.once_per_round && (ch.tapped ?? []).includes(cd.id)) continue;
    return { card: cd };
  }
  return null;
}
// 그래플링 장비는 있는데 이번 라운드에 이미 썼는가(오류 문구용)
export const grappleTapped = (ctx, ch) => equipCards(ctx, ch).some((cd) => (cd.passive ?? []).some((b) => b.block === 'allow_grapple') && (ch.tapped ?? []).includes(cd.id));

// 장비 카드 눕히기(라운드에 한 번 쓰는 카드 — 라운드가 끝나면 다시 세운다)
export function tapItem(ctx, ch, cardId) {
  ch.tapped = [...(ch.tapped ?? []), cardId];
  emit(ctx, { type: 'item_tapped', character: ch.id, card: cardId });
}

function statMod(list, stat) {
  return list.filter((b) => b.block === 'stat_mod' && b.stat === stat).reduce((n, b) => n + b.amount, 0);
}

// 카드 한 장이 부품 몇 개로 치는지(부품 토큰 1, 고철 더미 2, 부품 상자 4 — 카드 데이터 material: 'part' · amount)
export function partsValue(content, id) {
  if (id === 'part') return 1;
  const cd = content.cards?.[id];
  return cd?.material === 'part' ? (cd.amount ?? 1) : 0;
}

export function bagCap(ctx, ch) {
  // + 짐꾼 "짊어지기" 같은 일시 상태(bag_plus, 2026-10-08)
  const plus = (ch.statuses ?? []).filter((x) => x.status === 'bag_plus').reduce((n, x) => n + (x.amount ?? 1), 0);
  return (ch.bag_base ?? charDef(ctx, ch).bag) + statMod(passives(ctx, ch, { conditional: false }), 'bag') + plus;
}

export function moveOf(ctx, ch) {
  // 활성화 방식은 이동이 차례에 한 번뿐이라 이동력 보정(config.activation_move_bonus, 2026-10-04 실험: +2에서 탐험 · 전투가 가장 늘어남)
  const bonus = ctx.s.config.turn_mode === 'activation' ? ctx.s.config.activation_move_bonus ?? 0 : 0;
  return (ch.move_base ?? charDef(ctx, ch).move) + statMod(passives(ctx, ch), 'move') + bonus;
}

export function weaponOf(ctx, ch) {
  const w = ch.equip?.weapon ? card(ctx, ch.equip.weapon) : charDef(ctx, ch).starting_weapon;
  return { attack: w.attack, range: w.range, passive: w.passive ?? [], on_dice: w.on_dice ?? {}, on_hit: w.on_hit ?? null, id: ch.equip?.weapon ?? null };   // on_hit: 무기 특수 효과(2026-10-17)
}

// ---------- 토큰 주머니(2026-10-04 수정 사항 25) ----------
// config.combat.pouches[id] = { 토큰: 개수 } → 토큰 목록. 주머니 설정이 없으면 예전 8면 주사위 면.
const pouchCache = new WeakMap();
export function pouchTokens(config, id) {
  const def = config?.combat?.pouches?.[id];
  if (!def) return DICE_FACES;
  let list = pouchCache.get(def);
  if (!list) { list = Object.entries(def).flatMap(([f, n]) => Array(n).fill(f)); pouchCache.set(def, list); }
  return list;
}
// 캐릭터의 주머니 id(캐릭터 데이터 pouch, 없으면 basic)
export const charPouchId = (content, ch) => content.chars[ch.char]?.pouch ?? 'basic';
// 적의 주머니 id(적 카드에 pouch가 있으면 그것, 없으면 config.combat.enemy_pouch)
export const foePouchId = (content, config, f, chapter = 1) => (f && enemyDefAt(content, f.type, chapter)?.pouch) ?? config?.combat?.enemy_pouch ?? 'basic';
// 공격하는 쪽의 주머니 { id, tokens }
export function attackerPouch(ctx, attacker) {
  const cfg = ctx.s.config;
  const ch = attacker?.kind === 'char' ? ctx.s.chars[attacker.id] : null;
  const id = ch ? charPouchId(ctx.c, ch) : foePouchId(ctx.c, cfg, ctx.s.enemies[attacker?.id] ?? ctx.s.bosses[attacker?.id], ctx.s.game.chapter);
  return { id, tokens: pouchTokens(cfg, id) };
}

export function rangeOf(ctx, ch) {
  return weaponOf(ctx, ch).range + statMod(passives(ctx, ch), 'weapon_range');
}

export function hasStatus(target, status) {
  return (target.statuses ?? []).some((x) => x.status === status);
}

export function defenseOf(ctx, target) {
  if (target.kind === 'foe') {
    const f = target.ref;
    return f.defense ?? foeDef(ctx, f).defense ?? 0;
  }
  const ch = target.ref;
  const armor = ch.equip?.armor ? card(ctx, ch.equip.armor).defense ?? 0 : 0;
  const up = (ch.statuses ?? []).filter((x) => x.status === 'defense_up').reduce((n, x) => n + (x.amount ?? 0), 0);
  return armor + statMod(passives(ctx, ch), 'defense') + up;
}

export function armorDefense(ctx, ch) {
  return ch.equip?.armor ? card(ctx, ch.equip.armor).defense ?? 0 : 0;
}

export function perksWithHook(ctx, ch, hook) {
  return charDef(ctx, ch).perks.filter((p) => p.hook === hook);
}

// ---------- 적 · 보스 ----------
export function allFoes(s) {
  const list = [
    ...Object.values(s.enemies).map((f) => ({ ...f, _group: 'enemies' })),
    ...Object.values(s.bosses).map((f) => ({ ...f, _group: 'bosses' })),
  ];
  return list.sort((a, b) => a.seq - b.seq);
}

export function getFoe(s, id) {
  return s.enemies[id] ?? s.bosses[id] ?? null;
}

// 적 카드의 챕터별 수치(2026-10-03 사용자 결정 — 좀비가 챕터마다 강해짐, 카드에 Ⅰ · Ⅱ · Ⅲ 3칸).
// by_chapter: { "2": { hp: 5 }, "3": { hp: 6, attack: 3, reward: [...] } } — 적힌 값만 기본값을 덮는다. 보스는 없음.
const tierCache = new WeakMap();
export function enemyDefAt(content, type, chapter = 1) {
  const def = content.enemies[type];
  if (!def?.by_chapter) return def;
  let m = tierCache.get(def);
  if (!m) { m = new Map(); tierCache.set(def, m); }
  if (!m.has(chapter)) {
    let d = { ...def };
    for (let k = 2; k <= chapter; k++) if (def.by_chapter[k]) d = { ...d, ...def.by_chapter[k] };
    m.set(chapter, d);
  }
  return m.get(chapter);
}
export const foeDef = (ctx, f) => enemyDefAt(ctx.c, f.type, ctx.s.game?.chapter ?? 1);
// 적 능력치: 개별 값(테스트 · 효과로 덮어쓴 값)이 있으면 그것, 없으면 적 카드 값 + 맵 보정(enemy_mods, 일반 적만 — 2026-10-03 육각 마을 이동력 · 시야 +1)
export const foeStat = (ctx, f, stat) => f[stat] ?? ((foeDef(ctx, f)[stat] ?? 0) + (ctx.s.bosses?.[f.uid] ? 0 : ctx.map?.enemy_mods?.[stat] ?? 0));
export const isBoss = (ctx, f) => !!ctx.s.bosses[f.uid];

export function foesAt(ctx, cell) {
  return allFoes(ctx.s).filter((f) => f.cell === cell).map((f) => getFoe(ctx.s, f.uid));
}

export function activeCharsAt(ctx, cell) {
  return Object.values(ctx.s.chars).filter((ch) => ch.cell === cell && !ch.exhausted);
}

// ---------- 한 칸에 피규어 하나(글룸헤이븐식, 2026-10-03 사용자 결정) ----------
// 맵의 one_per_cell(육각 마을) 또는 설정 board.one_per_cell로 켠다. 예전 선 맵 · 테스트 맵은 꺼져 있음(같은 칸에 여럿).
// - 칸을 차지하는 피규어: 탈진하지 않은 캐릭터 · 적 · 보스(쓰러진 피규어는 차지하지 않음)
// - 이동: 내 캐릭터는 지나갈 수 있고 상대 캐릭터 · 적 · 보스는 막힘(그래플링 · 통과 효과로 넘음), 빈칸에만 멈춤
// - "같은 칸" 조건(약탈 · 교환 · 아군 대상 카드 · 대신 맞기)은 "같은 칸 또는 옆 칸"
// 배치할 수 있는 칸(2026-10-04): 비어 있는 시작 칸. 하나도 없으면(지난 챕터 보스 등이 시작 칸을 막음 — 4인은 시작 칸 8 = 캐릭터 8)
// 시작 칸 옆의 빈 칸에 놓는다. 게임이 멈추지 않게 하는 임시 규칙(사용자 확인 대기).
export function placementCells(ctx) {
  const map = ctx.map;
  const used = new Set(Object.values(ctx.s.chars).map((c) => c.cell).filter(Boolean));
  const free = (id) => !used.has(id) && !(singleOcc(ctx) && foesAt(ctx, id).length);
  const starts = map.cells.filter((c) => c.type === 'start').map((c) => c.id);
  const ok = starts.filter(free);
  if (ok.length) return ok;
  const { adj } = graph(map);
  const out = new Set();
  for (const st of starts) for (const e of adj.get(st) ?? []) { const c = cellOf(map, e.to); if (c && c.terrain !== 'obstacle' && c.type !== 'start' && free(e.to)) out.add(e.to); }
  return [...out];
}
// ---------- 중앙 보상(2026-10-04 사용자 결정 — 중앙부는 위험하지만 보상이 큰 영역) ----------
// 칸 등급 = 가장 가까운 시작 칸까지 거리로 자동: 0 바깥 · 1 중간 · 2 중앙. 기준은 맵의 center_tiers [중간, 중앙]
// 거리, 없으면 그 맵에서 가장 먼 거리의 55% · 80%(올림). 보너스는 config.center_reward.tiers[등급].
const centerTierCache = new WeakMap();
export function cellTier(map, cellId) {
  let m = centerTierCache.get(map);
  if (!m) {
    m = new Map();
    const starts = map.cells.filter((c) => c.type === 'start').map((c) => c.id);
    const dist = new Map(map.cells.map((c) => [c.id, starts.length ? Math.min(...starts.map((s) => segDist(map, c.id, s))) : 0]));
    const far = Math.max(0, ...[...dist.values()].filter(Number.isFinite));
    const [t1, t2] = map.center_tiers ?? [Math.ceil(far * 0.55), Math.ceil(far * 0.8)];
    for (const [id, d] of dist) m.set(id, d >= t2 ? 2 : d >= t1 ? 1 : 0);
    centerTierCache.set(map, m);
  }
  return m.get(cellId) ?? 0;
}
export const tierBonus = (config, tier) => config?.center_reward?.tiers?.[tier] ?? {};

// 시작 칸 = 안전 지역(2026-10-04 사용자 결정): 적은 시작 칸에 들어가거나 지나갈 수 없다(옆 칸에서 공격하는 것은 가능 — 확인 대기).
// 맵의 safe_start 또는 설정 board.safe_start로 켠다.
export const safeStart = (ctx) => !!(ctx.map?.safe_start ?? ctx.s.config.board?.safe_start);
export const isSafeCell = (ctx, id) => safeStart(ctx) && cellOf(ctx.map, id)?.type === 'start';
export function safeCells(ctx) {
  return safeStart(ctx) ? ctx.map.cells.filter((c) => c.type === 'start').map((c) => c.id) : [];
}
export const singleOcc = (ctx) => !!(ctx.map?.one_per_cell ?? ctx.s.config.board?.one_per_cell);
// 2026-10-18 사용자 피드백("탈진한 적 캐릭터와 같은 칸 위에 설 수 없는데 이동으로 올라갔다"): 쓰러진(탈진) 캐릭터 피규어도 칸을 차지한다 —
// 그 칸에 멈출 수 없음(지나가는 건 blocksChar 그대로 가능). 예전(2026-10-03)엔 쓰러진 캐릭터를 빈칸으로 봐서 캐릭터 · 적이 그 위에 설 수 있었다
export function occupied(ctx, cell, exceptId = null) {
  if (cell == null) return false;
  return Object.values(ctx.s.chars).some((c) => c.cell === cell && c.id !== exceptId) || allFoes(ctx.s).some((f) => f.cell === cell && f.uid !== exceptId);
}
// 캐릭터 ch가 지나갈 수 없는 칸(상대 캐릭터 · 적 · 보스가 있음)
export function blocksChar(ctx, ch, cell) {
  return foesAt(ctx, cell).length > 0 || Object.values(ctx.s.chars).some((c) => c.cell === cell && !c.exhausted && c.owner !== ch.owner);
}
// 같은 칸 또는(한 칸에 하나 규칙이면) 옆 칸
export const near = (ctx, a, b) => a != null && b != null && (a === b || (singleOcc(ctx) && dist(ctx, a, b) <= 1));
// 이웃한 빈칸(멈출 수 있는 칸, 맵 이웃 순서 — 고정이라 재현 가능)
export function freeNeighbors(ctx, cell) {
  const out = [];
  for (const e of graph(ctx.map).adj.get(cell) ?? []) {
    if (e.kind === 'secret' || out.includes(e.to)) continue;
    if (cellOf(ctx.map, e.to)?.terrain === 'obstacle') continue;
    if (!occupied(ctx, e.to)) out.push(e.to);
  }
  return out;
}

// 적 칸 공개 방식: 맵 설정(enemy_cells.reveal)이 있으면 그것, 없으면 config.
//   on_enter = 그 칸에 들어설 때 · chapter_start = 챕터 시작 때 모두(2026-10-01) ·
//   danger_zone = 적 칸 주변 radius칸(위험 구역)에 캐릭터가 들어설 때(2026-10-03 사용자 결정)
export const enemyRevealMode = (ctx) => ctx.map?.enemy_cells?.reveal ?? ctx.s.config.enemy_cells?.reveal ?? 'on_enter';
export const dangerRadius = (ctx) => ctx.map?.enemy_cells?.radius ?? ctx.s.config.enemy_cells?.radius ?? 2;

// 상호작용 칸의 챕터당 사용 횟수(칸 보상 토큰 · 고갈형, 2026-10-03 사용자 결정):
//   칸의 uses > 맵 cell_uses[인원수] > cell_uses.default > 1. 캠프는 제한 없음, 적 칸 등 다른 칸은 1.
//   같은 캐릭터는 같은 칸을 챕터당 1번만(board.cell_users) — 한 명이 칸 하나를 독차지하지 못하게
const USE_TYPES = new Set(['supply', 'investigate', 'lab', 'survivor', 'money', 'resource', 'search']);
export function cellUsesOf(map, nPlayers, cell) {
  if (!USE_TYPES.has(cell?.type)) return 1;
  const u = map?.cell_uses;
  return cell.uses ?? u?.[nPlayers] ?? u?.default ?? 1;
}
export const cellUses = (ctx, cell) => cellUsesOf(ctx.map, ctx.s.game.turn_order.length, cell);
export const cellUsedCount = (ctx, cellId) => ctx.s.board.markers.reduce((n, x) => n + (x === cellId ? 1 : 0), 0);
// 이 캐릭터가 이 칸에서 지금 상호작용할 수 없는 이유(없으면 null)
export function cellBlockReason(ctx, cell, ch) {
  if (cell.type === 'camp') return null;
  if (cellUsedCount(ctx, cell.id) >= cellUses(ctx, cell)) return 'cell_marked';
  if (ch && (ctx.s.board.cell_users?.[cell.id] ?? []).includes(ch.id)) return 'cell_used_by_you';
  return null;
}

// 감춰진 적 칸: 아직 적 카드를 공개하지 않은 적 칸(on_enter · danger_zone).
// chapter_start면 적 칸은 챕터 시작 때 모두 공개되므로 감춰진 적 칸이 없다.
export function isHiddenEnemyCell(ctx, cellId) {
  if (!['on_enter', 'danger_zone'].includes(enemyRevealMode(ctx))) return false;
  const cell = cellOf(ctx.map, cellId);
  return cell?.type === 'enemy' && !ctx.s.board.markers.includes(cellId) && foesAt(ctx, cellId).length === 0;
}

// 대상 참조: {kind:'char'|'foe', id}
export function ref(ctx, t) {
  if (t.kind === 'char') return { ...t, ref: ctx.s.chars[t.id] };
  return { ...t, ref: getFoe(ctx.s, t.id) };
}

export const dist = (ctx, a, b) => segDist(ctx.map, a, b);

// ---------- 플레이어 자원 ----------
// sale: 판매로 얻은 코인(미션 '자금 확보'에서 제외)
export function gainCoins(ctx, player, n, { sale = false } = {}) {
  if (!n) return;
  ctx.s.players[player].coins += n;
  emit(ctx, { type: 'coins_changed', player, amount: n });
  if (n > 0 && !sale) push(ctx, { type: 'mission_progress', player, char: null, trigger: { type: 'gain_coin', count: n } });
}

// 부품 = 플레이어 자원(코인처럼, 가방을 차지하지 않음 — 2026-10-04 사용자 결정 신규 4). 예전 'part' 토큰 카드는 쓰지 않음.
export const partsOf = (s, player) => (s.players[player].parts ?? 0);
export function gainParts(ctx, player, n, { char = null } = {}) {
  if (!n) return;
  const P = ctx.s.players[player];
  P.parts = (P.parts ?? 0) + n;
  emit(ctx, { type: 'parts_changed', player, amount: n });
  if (n > 0) push(ctx, { type: 'mission_progress', player, char, trigger: { type: 'gain_material', material: 'part', count: n } });
}

export function gainVp(ctx, player, n, source) {
  if (!n) return;
  ctx.s.players[player].vp += n;
  emit(ctx, { type: 'vp_gained', player, amount: n, source });
}

// ---------- 시설 ----------
// 레벨마다 필요한 생존자가 배치돼 있어야 그 레벨 효과가 동작한다(Z-9). 같은 블록은 높은 레벨 값이 덮어쓴다.
export function facilityEffects(ctx, player) {
  const sh = ctx.s.shelter[player];
  const merged = {};
  for (const [fid, lv] of Object.entries(sh.facilities)) {
    const fac = ctx.c.facilities[fid];
    for (const L of fac.levels) {
      if (L.level > lv || !staffOk(ctx, player, fid, L.staff)) continue;
      for (const b of L.effect) {
        const key = `${fid}:${b.block}:${b.timing ?? ''}`;
        merged[key] = { ...(merged[key] ?? {}), ...b, facility: fid };
      }
    }
  }
  return Object.values(merged);
}

export function staffOk(ctx, player, fid, staff) {
  if (!staff) return true;
  const assigned = ctx.s.shelter[player].assigned[fid] ?? [];
  const have = { human: 0, animal: 0 };
  for (const t of assigned) have[ctx.c.tokens[t].kind] += 1;
  return Object.entries(staff).every(([k, n]) => have[k] >= n);
}

export function assignedBonuses(ctx, player) {
  const out = [];
  for (const [fid, list] of Object.entries(ctx.s.shelter[player].assigned)) {
    for (const t of list) {
      const b = ctx.c.tokens[t].assigned_bonus;
      if (b && b.facility === fid && (ctx.s.shelter[player].facilities[fid] ?? 0) > 0) out.push(b);
    }
  }
  return out;
}

// ---------- 효과 블록 실행 ----------
// env: { player, char, target, cell, ... } — 블록이 쓰는 문맥
// 블록이 쌓은 작업(처치 · 소음 등)은 블록이 적힌 순서대로 실행되게 맞춘다. 스택은 나중에 쌓은 것이 먼저 실행되므로,
// 그냥 두면 [피해, 소음] 카드에서 소음이 처치보다 먼저 처리돼 체력 0인 적이 소음에 끌려가 공격하는 일이 생긴다.
export function runBlocks(ctx, blocks, env) {
  const segs = [];
  for (const b of blocks ?? []) {
    const h = BLOCKS[b.block];
    if (!h) throw new Error(`효과 블록 처리 함수 없음: ${b.block}`);
    const before = ctx.s.stack.length;
    h(ctx, b, env);
    segs.push(ctx.s.stack.splice(before));
  }
  for (let i = segs.length - 1; i >= 0; i--) ctx.s.stack.push(...segs[i]);
}

export function requireTurn(ctx, player) {
  const t = ctx.s.turn;
  if (t.phase !== 'player_turn' || t.current_player !== player) fail('not_your_turn');
}

// kind: 행동 종류(활성화 방식에서 종류마다 한 번씩 — 'move' · 'attack'(약탈 포함) · 'interact' · 'rest' · 'end')
export function requireActor(ctx, charId, { useAction = true, kind = null } = {}) {
  const ch = getChar(ctx, charId);
  requireTurn(ctx, ch.owner);
  if (ch.exhausted) fail('character_exhausted');
  if (activationMode(ctx.s)) {
    if (!useAction) return ch;
    const a = actOf(ctx.s, ch.id);
    if (a.done) fail('activation_done');
    if (kind === 'rest') fail('rest_removed');
    if (cardMode(ctx.s)) return ch;   // 카드 운용 버전: 이동 · 공격 횟수 제한 없음(카드 1장씩 — actions.js cardGate)
    if (kind === 'move' && a.move) fail('already_moved');
    // 예전(2026-10-04 신규 9)엔 공격한 뒤 이동 금지(move_after_attack) — 2026-10-17 사용자 결정으로 지움:
    // 이동 → 공격 · 공격 → 이동 · 이동 → 행동 끝 · 공격 → 행동 끝 모두 가능(이동 · 공격 각 1번, 순서 자유)
    if (kind === 'attack' && a.attack) fail('already_attacked');
    return ch;
  }
  if (useAction && ctx.s.turn.actions_left <= 0) fail('no_actions_left');
  if (useAction && charActionsLeft(ctx.s, ch.id) <= 0) fail('no_actions_left_char');
  return ch;
}
// ---------- 활성화 방식(2026-10-04 사용자 결정 — 수정 사항 신규 9) ----------
// 캐릭터마다 차례에 한 번 "활성화": 이동 1번 → 공격(또는 약탈) 1번 → 상호작용(하면 끝) 또는 "행동 끝".
// 이동은 공격 전에만. 상호작용 · 행동 끝을 하면 그 캐릭터는 이번 차례 끝. config.turn_mode = 'activation'으로 켬.
// 카드 운용 버전(turn_mode 'cards', 2026-10-18 사용자 결정 — A/B 테스트 B안, docs/rules-b-cards.md): 활성화 방식 위에서
// 공짜 이동 · 공격이 없고 카드 1장으로 한 번씩(횟수 제한 없음, 스테미너가 한도). 상호작용 · 행동 끝 · 차례 끝 자동 상호작용은 활성화 방식 그대로.
// 그래서 activationMode는 'cards'에서도 참 — 차이는 cardMode로 따로 본다
export const activationMode = (s) => s.config.turn_mode === 'activation' || s.config.turn_mode === 'cards';
export const cardMode = (s) => s.config.turn_mode === 'cards';
export const actOf = (s, charId) => s.turn.act?.[charId] ?? { move: false, attack: false, done: false };
// 이 캐릭터가 지금 이 종류의 행동을 할 수 있나(화면 · AI 안내용 — 최종 판정은 액션 검증)
export function canDo(s, charId, kind) {
  const ch = s.chars[charId];
  if (!ch || ch.exhausted || s.turn.phase !== 'player_turn' || s.turn.current_player !== ch.owner) return false;
  if (!activationMode(s)) return charActionsLeft(s, charId) > 0;
  const a = actOf(s, charId);
  if (a.done) return false;
  if (cardMode(s)) return kind !== 'rest';   // 카드 운용 버전: 쓸 카드가 있는지는 query.js cardModeOptions가 봄
  if (kind === 'move') return !a.move;   // 2026-10-17: 공격한 뒤에도 이동 가능(예전엔 !a.attack도 조건)
  if (kind === 'attack') return !a.attack;
  if (kind === 'rest') return false;
  return true;
}
// 캐릭터마다 행동 n번(config.actions_per_character, 2026-10-03 실험). 설정이 없으면 남은 행동 전체
export const perCharActions = (s) => s.config.actions_per_character || null;   // 0 · null = 예전 규칙(아무 캐릭터나)
export function charActionsLeft(s, charId) {
  // 활성화 방식: 남은 단계 수(이동 · 공격 · 상호작용 중 아직 할 수 있는 것), 끝났으면 0
  if (activationMode(s)) {
    const a = actOf(s, charId);
    if (cardMode(s)) return a.done ? 0 : 1;
    return a.done ? 0 : (a.move ? 0 : 1) + (a.attack ? 0 : 1) + 1;   // 2026-10-17: 공격 뒤 이동 가능(예전 !a.move && !a.attack)
  }
  const per = perCharActions(s);
  if (per == null) return s.turn.actions_left;
  return Math.min(s.turn.actions_left, per - (s.turn.char_used?.[charId] ?? 0));
}
// 차례 시작 때 행동 수: 캐릭터마다 n번이면 n × 내 캐릭터 수
export function turnActions(s, player) {
  if (activationMode(s)) return Object.values(s.chars).filter((c) => c.owner === player).length;   // 활성화 방식: 캐릭터 수
  const per = perCharActions(s);
  if (per == null) return s.config.actions_per_turn;
  return per * Object.values(s.chars).filter((c) => c.owner === player).length;
}

export function clearStatuses(ctx, durations) {
  for (const t of [...Object.values(ctx.s.chars), ...Object.values(ctx.s.enemies), ...Object.values(ctx.s.bosses)]) {
    if (t.statuses?.length) t.statuses = t.statuses.filter((x) => !durations.includes(x.duration));
  }
}
