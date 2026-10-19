// 게임 상태 만들기. 테스트 시나리오의 setup을 그대로 상태로 바꾸는 함수와(stateFromSetup),
// 실제 게임을 처음부터 시작하는 함수(newGame, 4-5 단계에서 채움)가 있다.

import { deepMerge, playerMapId } from './content.js';
import { enemyDefAt } from './core.js';
import { shuffle, randomInt } from './rng.js';

export const SCHEMA_VERSION = 1;

function emptyShelter() {
  return { facilities: {}, storage: [], survivor_pool: [], assigned: {}, research: [] };
}

function emptyDecks() {
  return {
    supply: [], supply_discard: [], enemy: [], enemy_discard: [], investigation: [], investigation_discard: [],
    investigation_box: [], mission: [], mission_box: [], black_market: [], black_market_box: [], lab: [], survivor: [],
    search: [], search_discard: [],
  };
}

// config: 판 설정(카드 운용 버전은 캐릭터마다 stamina_by_turn_mode로 스테미너가 다를 수 있음, 2026-10-19)
export function makeChar(content, spec, seq, config = content.config) {
  const def = content.chars[spec.char];
  const st = def.stamina_by_turn_mode?.[config?.turn_mode] ?? def.stamina;
  if (!def) throw new Error(`없는 캐릭터 ${spec.char}`);
  return {
    id: spec.id,
    owner: spec.owner,
    char: spec.char,
    cell: spec.cell ?? null,
    max_hp: spec.max_hp ?? def.hp,
    hp: spec.hp ?? spec.max_hp ?? def.hp,
    max_stamina: st,
    stamina: spec.stamina ?? st,
    move_base: spec.move ?? null,
    bag_base: null,
    bag: [...(spec.bag ?? [])],
    equip: { weapon: null, armor: null, accessory: null, ...(spec.equip ?? {}) },
    exhausted: !!spec.exhausted,
    statuses: [...(spec.statuses ?? [])],
    tapped: [...(spec.tapped ?? [])],   // 이번 라운드에 써서 눕힌 장비 카드(라운드에 한 번 쓰는 카드)
    order: seq,
  };
}

function makeFoe(content, spec, seq, chapter = 1) {
  const def = enemyDefAt(content, spec.type, chapter);   // 챕터별 체력(2026-10-03)
  if (!def) throw new Error(`없는 적 ${spec.type}`);
  const f = { uid: spec.uid, type: spec.type, cell: spec.cell, hp: spec.hp ?? def.hp, max_hp: def.hp, seq, statuses: [] };
  for (const k of ['move', 'attack', 'sight', 'range', 'defense', 'from_supply', 'from_search']) if (spec[k] != null) f[k] = spec[k];
  if (spec.hp != null && spec.hp > def.hp) f.max_hp = spec.hp;
  return f;
}

export function stateFromSetup(setup, content, { seed = 1 } = {}) {
  const config = deepMerge(content.config, setup.config ?? {});
  const players = setup.players ?? ['P1', 'P2'];
  const phase = setup.phase ?? 'player_turn';
  const s = {
    schema_version: SCHEMA_VERSION,
    rng: seed >>> 0,
    config,
    map_id: setup.map,
    game: {
      chapter: setup.chapter ?? 1,
      round: setup.round ?? 1,
      turn_order: [...players],
      bosses_killed_count: setup.bosses_killed_count ?? 0,
      first_max_claimed: { ...(setup.first_max_claimed ?? {}) },
      seq: 0,
      uid: 0,
      over: false,
    },
    turn: {
      phase,
      current_player: phase === 'player_turn' ? (setup.current_player ?? players[0]) : null,
      actions_left: setup.actions_left ?? config.actions_per_turn,
    },
    players: {},
    chars: {},
    enemies: {},
    bosses: {},
    board: { markers: [...(setup.markers ?? [])], open_supply: [...(setup.open_supply ?? [])], black_market: [], bm_place: {} },
    decks: emptyDecks(),
    shelter: {},
    stack: [],
    pending: null,
    maint_done: [],
    placement_queue: [],
    log: [],
  };
  if (setup.dice) s.test = { dice: [...setup.dice] };
  Object.assign(s.board, structuredClone(setup.board ?? {}));

  players.forEach((p, i) => {
    const m = setup.missions?.[p] ?? {};
    s.players[p] = {
      coins: setup.coins?.[p] ?? config.starting_coins_by_order[i] ?? 0,
      parts: setup.parts?.[p] ?? 0,
      vp: setup.vp?.[p] ?? 0,
      missions: {
        hand: [...(m.hand ?? [])],
        active: structuredClone(m.active ?? []),
        completed: [...(m.completed ?? [])],
      },
      bosses_killed: [...(setup.bosses_killed?.[p] ?? [])],
      round_flags: {},
      exiled: [],   // 소실 카드(쓰면 게임에서 빠지는 카드, core.js retireCard) — 2026-10-07
      // 플레이어 카드는 플레이어 공용(2026-09-30 AC-1). 테스트 setup은 players 대신 캐릭터에 hand/deck/discard를 적어도 되고,
      // 그러면 그 주인 플레이어의 손패 · 덱 · 버린 카드로 (캐릭터 순서대로) 합친다.
      ...playerCardsFromSetup(setup, p),
    };
    s.shelter[p] = { ...emptyShelter(), ...structuredClone(setup.shelter?.[p] ?? {}) };
  });

  (setup.characters ?? []).forEach((spec, i) => { s.chars[spec.id] = makeChar(content, spec, i, s.config); });
  for (const spec of setup.enemies ?? []) s.enemies[spec.uid] = makeFoe(content, spec, ++s.game.seq, s.game.chapter);
  for (const spec of setup.bosses ?? []) s.bosses[spec.uid] = makeFoe(content, spec, ++s.game.seq);
  for (const [k, v] of Object.entries(setup.decks ?? {})) s.decks[k] = [...v];

  if (phase === 'placement') {
    s.placement_queue = placementQueue(s);
    s.pending = { type: 'placement', player: s.placement_queue[0] };
  }
  return s;
}

// 선 플레이어부터 한 명씩, 마지막 플레이어부터 역순으로 두 번째(뱀 순서). 배치할 캐릭터가 없는 차례는 건너뛴다.
export function placementQueue(s) {
  const order = s.game.turn_order;
  const left = Object.fromEntries(order.map((p) => [p, Object.values(s.chars).filter((c) => c.owner === p && c.cell == null).length]));
  const q = [];
  const perPlayer = s.config.players.characters_per_player;
  for (let round = 0; round < perPlayer; round++) {
    const seq = round % 2 === 0 ? order : [...order].reverse();
    for (const p of seq) if (left[p] > 0) { q.push(p); left[p]--; }
  }
  return q;
}

// ---------- 실제 게임 시작 ----------
// picks: { P1: ['c_fighter', 'c_hunter'], ... }  (좌석 순서 = players 순서, 선 플레이어는 시드로 무작위)
// 캐릭터 선택(드래프트) 화면은 핫싯 UI 단계에서 붙이고, 엔진은 선택 결과를 받는다.
function playerCardsFromSetup(setup, p) {
  const own = setup.hands?.[p];
  if (own) return { hand: [...(own.hand ?? [])], deck: [...(own.deck ?? [])], discard: [...(own.discard ?? [])] };
  const specs = (setup.characters ?? []).filter((c) => c.owner === p);
  return {
    hand: specs.flatMap((c) => c.hand ?? []),
    deck: specs.flatMap((c) => c.deck ?? []),
    discard: specs.flatMap((c) => c.discard ?? []),
  };
}

// 플레이어 덱 구성: 공용 카드 세트 1벌 + 고른 캐릭터들의 전용 카드(장수만큼) (2026-09-30 AC-1)
// only_turn_mode: 그 진행 방식에서만 넣는 카드(숨 고르기 = 활성화 방식 전용, 2026-10-04)
// 2026-10-18 카드 운용 버전: only_turn_mode는 목록도 됨 · exclude_turn_modes = 그 방식에선 빼는 카드(공용 4종은 카드 운용 버전에서 뺌) ·
// copies_by_turn_mode = 방식별 장수(전용 카드 3 · 2 · 2장 = 7장)
const inMode = (c, mode) => (!c.only_turn_mode || [].concat(c.only_turn_mode).includes(mode)) && !(c.exclude_turn_modes ?? []).includes(mode);
const copiesIn = (c, mode) => c.copies_by_turn_mode?.[mode] ?? c.copies ?? 1;
export function playerDeck(content, charIds, config = content.config) {
  const mode = config?.turn_mode;
  const deck = Object.values(content.cards).filter((c) => c.source === 'player' && c.id.startsWith('pc_') && inMode(c, mode))
    .flatMap((c) => Array(copiesIn(c, mode)).fill(c.id));
  for (const cid of charIds) for (const sc of content.chars[cid].signature_cards) if (inMode(sc, mode)) for (let k = 0; k < copiesIn(sc, mode); k++) deck.push(sc.id);
  return deck;
}

// config: 이번 판만 바꿀 설정값(예: { chapters: 1 } — 시작 화면의 "짧은 판", 2026-10-17 포트폴리오 데모). 상태(state.config)에 같이 저장된다.
export function newGame(content, { mapId: baseMapId, players, picks, seed = Date.now(), config: over = null }) {
  const config = content.config;
  const mapId = playerMapId(content.maps, baseMapId, players.length);   // 인원수별 칸(min_players)이 있으면 그 인원수 변형
  const map = content.maps[mapId];
  if (!map) throw new Error(`없는 맵 ${mapId}`);
  const tmp = { rng: seed >>> 0 };
  const first = randomInt(tmp, players.length);
  const order = [...players.slice(first), ...players.slice(0, first)];
  const setup = { map: mapId, players: order, phase: 'chapter_prep', characters: [], ...(over ? { config: over } : {}) };
  const s = stateFromSetup(setup, content, { seed: tmp.rng });

  let i = 0;
  for (const p of order) {
    for (const cid of picks[p]) s.chars[`${p}_${cid}`] = makeChar(content, { id: `${p}_${cid}`, owner: p, char: cid, cell: null }, i++, s.config);
    s.players[p].deck = shuffle(s, playerDeck(content, picks[p], s.config));
  }
  const copies = (list) => list.flatMap((c) => Array(c.copies ?? 1).fill(c.id));
  const byKind = (src) => Object.values(content.cards).filter((c) => c.source === src);
  s.decks.supply = shuffle(s, copies(byKind('supply')));
  s.decks.black_market = shuffle(s, copies(byKind('black_market')));
  s.decks.investigation = shuffle(s, copies(byKind('investigation')));
  s.decks.enemy = shuffle(s, map.enemy_deck.flatMap((e) => Array(e.copies).fill(e.enemy)));
  // 수색 덱(? 칸): 맵의 search_deck 구성대로
  const searchIds = new Set((map.search_deck ?? []).map((e) => e.card));
  s.decks.search = shuffle(s, (map.search_deck ?? []).flatMap((e) => Array(e.copies).fill(e.card)));
  // 미션 덱: 맵에 나오지 않는 적(적 카드 덱 + 보급품 · 이 맵 수색 카드로 나오는 적)의 처치 미션은 뺀다
  const enemiesHere = new Set([...map.enemy_deck.map((e) => e.enemy),
    ...Object.values(content.cards).filter((c) => c.source !== 'search' || searchIds.has(c.id))
      .flatMap((c) => (c.effect ?? []).filter((b) => b.block === 'spawn_enemy').map((b) => b.enemy))]);
  const usable = Object.values(content.missions).filter((m) => !m.trigger.enemy || enemiesHere.has(m.trigger.enemy)).map((m) => m.id);
  s.decks.mission = shuffle(s, usable.flatMap((id) => Array(config.missions.copies_per_type).fill(id)));
  const toks = Object.values(content.tokens);
  s.decks.lab = shuffle(s, copies(toks.filter((t) => t.token === 'research')));
  s.decks.survivor = shuffle(s, copies(toks.filter((t) => t.token === 'survivor')));
  return s;
}
