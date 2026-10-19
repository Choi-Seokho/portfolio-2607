// 가상 상태 만들기(높음 AI): 뷰(view)의 가려진 칸('?')을 "아직 안 보인 카드" 중에서 무작위로 채워
// 엔진에 넣을 수 있는 완전한 상태를 만든다. 여러 개를 만들어 각각 시뮬레이션하고 평균을 내면,
// 남의 손패 · 덱 순서 · 주사위를 모르는 채로(반칙 없이) 앞을 내다볼 수 있다.
//
// - 카드 종류마다 "전체 구성(우주)"에서 뷰에 보이는 카드를 빼고 남은 것으로 채운다(모자라면 아무 카드로).
// - 난수 상태(rng)는 새 시드로 — 주사위를 미리 아는 게 아니라 "가능한 주사위 중 하나"를 굴려 보는 것.
// - 작업 목록(stack)은 비운다. 그래서 선택 대기(pending)가 없을 때만 쓸 수 있다(그때는 stack이 원래 비어 있다).

import { HIDDEN } from '../engine/view.js';
import { playerDeck } from '../engine/setup.js';

const DECK_SOURCE = {
  supply: 'supply', investigation: 'investigation', investigation_discard: 'investigation',
  black_market: 'black_market', mission: 'mission', mission_box: 'mission', enemy: 'enemy', lab: 'lab', survivor: 'survivor',
  search: 'search',
};

// 콘텐츠 → 종류별 전체 구성(같은 카드는 장수만큼)
const universes = new WeakMap();
function universe(content, mapId) {
  const key = content;
  let byMap = universes.get(key);
  if (!byMap) { byMap = {}; universes.set(key, byMap); }
  if (byMap[mapId]) return byMap[mapId];
  const u = { supply: [], investigation: [], black_market: [], mission: [], enemy: [], lab: [], survivor: [] };
  for (const cd of Object.values(content.cards)) {
    if (u[cd.source]) for (let i = 0; i < (cd.copies ?? 1); i++) u[cd.source].push(cd.id);
  }
  for (const id of Object.keys(content.missions)) for (let i = 0; i < content.config.missions.copies_per_type; i++) u.mission.push(id);
  for (const t of Object.values(content.tokens)) {
    const k = t.token === 'research' ? 'lab' : 'survivor';
    for (let i = 0; i < (t.copies ?? 1); i++) u[k].push(t.id);
  }
  for (const e of content.maps[mapId].enemy_deck) for (let i = 0; i < e.copies; i++) u.enemy.push(e.enemy);
  // 수색 덱(? 칸)은 맵마다 구성이 다르다
  u.search = (content.maps[mapId].search_deck ?? []).flatMap((e) => Array(e.copies).fill(e.card));
  byMap[mapId] = u;
  return u;
}


function sourceOf(content, id) {
  if (id === HIDDEN || id === 'part') return null;
  if (content.cards[id]) return content.cards[id].source;
  if (content.missions[id]) return 'mission';
  if (content.tokens[id]) return content.tokens[id].token === 'research' ? 'lab' : 'survivor';
  if (content.enemies[id]) return 'enemy';
  return null;
}

// multiset에서 보이는 카드를 뺀 나머지
function remove(pool, seen) {
  const left = [...pool];
  for (const id of seen) { const i = left.indexOf(id); if (i >= 0) left.splice(i, 1); }
  return left;
}

function drawFrom(r, pool, fallback) {
  if (pool.length) return pool.splice(Math.floor(r() * pool.length), 1)[0];
  return fallback[Math.floor(r() * fallback.length)];
}

export function determinize(view, content, r) {
  const s = structuredClone(view);
  delete s.viewer;
  s.stack = [];
  s.rng = Math.floor(r() * 4294967296) >>> 0;
  if (s.pending && s.pending.type !== 'placement') throw new Error('determinize: 선택 대기 중에는 가상 상태를 만들 수 없음');

  // 1) 보이는 카드 모으기(종류별)
  const seen = { supply: [], investigation: [], black_market: [], mission: [], enemy: [], lab: [], survivor: [], search: [] };
  const see = (id) => { const k = sourceOf(content, id); if (k && seen[k]) seen[k].push(id); };
  for (const ch of Object.values(s.chars)) {
    ch.bag.forEach(see);
    Object.values(ch.equip ?? {}).filter(Boolean).forEach(see);
  }
  for (const sh of Object.values(s.shelter)) {
    sh.storage.forEach(see); (sh.research ?? []).forEach(see); (sh.survivor_pool ?? []).forEach(see);
    for (const l of Object.values(sh.assigned ?? {})) l.forEach(see);
  }
  for (const pl of Object.values(s.players)) {
    pl.missions.hand.forEach(see); pl.missions.active.forEach((a) => see(a.id)); pl.missions.completed.forEach(see);
  }
  s.board.open_supply.filter(Boolean).forEach(see);
  s.board.black_market.forEach(see);
  for (const [k, list] of Object.entries(s.decks)) if (!DECK_SOURCE[k]) list.forEach(see);   // 공개 더미(버린 카드 · 상자)
  for (const f of Object.values(s.enemies)) { if (f.from_supply) see(f.from_supply); else if (f.from_search) see(f.from_search); else see(f.type); }
  const u = universe(content, s.map_id);
  const pools = Object.fromEntries(Object.keys(u).map((k) => [k, remove(u[k], seen[k])]));
  const fill = (list, kind) => list.map((id) => (id === HIDDEN ? drawFrom(r, pools[kind], u[kind]) : id));

  // 2) 덱(순서도 모르므로 무작위로 뽑은 순서가 곧 섞인 순서)
  for (const [k, kind] of Object.entries(DECK_SOURCE)) if (s.decks[k]) s.decks[k] = fill(s.decks[k], kind);

  // 3) 남의 가방 · 창고(보급품 · 암시장 · 조사 카드 중에서), 남의 손에 든 미션
  const bagPool = () => (pools.supply.length ? 'supply' : pools.investigation.length ? 'investigation' : 'supply');
  for (const ch of Object.values(s.chars)) ch.bag = ch.bag.map((id) => (id === HIDDEN ? drawFrom(r, pools[bagPool()], u.supply) : id));
  for (const sh of Object.values(s.shelter)) sh.storage = sh.storage.map((id) => (id === HIDDEN ? drawFrom(r, pools.supply, u.supply) : id));
  for (const pl of Object.values(s.players)) pl.missions.hand = fill(pl.missions.hand, 'mission');

  // 4) 플레이어 카드(공용): 플레이어마다 처음 덱(공용 1벌 + 두 캐릭터 전용) − 손패 − 버린 카드 = 덱 + (남의) 손패
  for (const [p, pl] of Object.entries(s.players)) {
    const all = playerDeck(content, Object.values(s.chars).filter((c) => c.owner === p).map((c) => c.char), s.config);
    const pool = remove(all, [...pl.hand.filter((x) => x !== HIDDEN), ...pl.discard]);
    pl.hand = pl.hand.map((id) => (id === HIDDEN ? drawFrom(r, pool, all) : id));
    pl.deck = pl.deck.map(() => drawFrom(r, pool, all));
  }
  return s;
}
