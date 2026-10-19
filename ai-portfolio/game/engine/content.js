// 게임 콘텐츠(JSON 데이터)를 엔진이 찾기 쉬운 모양으로 묶는다.
// 콘텐츠는 읽기 전용이며 상태(state)에 넣지 않는다. 상태에는 id만 저장한다.

export function deepMerge(base, over) {
  if (over == null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

/**
 * raw: { config, characters, player_cards, supply, black_market, investigation,
 *        missions, facilities, tokens, enemies, effect_blocks, maps: {id: map} }
 */
export function buildContent(raw) {
  const cards = {};
  const add = (list, source) => { for (const c of list) cards[c.id] = { ...c, source }; };
  add(raw.player_cards.common_cards, 'player');
  // 전용 카드에는 주인 캐릭터를 적어 둔다(손패는 플레이어 공용이지만 전용 카드는 그 캐릭터만 쓸 수 있음, 2026-09-30 AC-1)
  for (const ch of raw.characters.characters) add(ch.signature_cards.map((c) => ({ ...c, char: ch.id })), 'player');
  add(raw.supply.cards, 'supply');
  add(raw.black_market.cards, 'black_market');
  add(raw.investigation.cards.map((c) => ({ ...c, kind: 'investigation' })), 'investigation');
  add(raw.search?.cards ?? [], 'search');   // 수색 카드(? 칸, F3b)

  const enemies = {};
  for (const e of raw.enemies.enemies) enemies[e.id] = { ...e, boss: false };
  for (const b of raw.enemies.bosses) enemies[b.id] = { ...b, boss: true };

  const tokens = {};
  for (const t of raw.tokens.research) tokens[t.id] = { ...t, token: 'research' };
  for (const t of raw.tokens.survivor) tokens[t.id] = { ...t, token: 'survivor' };
  // 토큰 카드(2026-10-07 사용자 결정): 연구 · 생존자 토큰도 카드 — 가방에 들어감(config.token_cards). 팔 수 없음
  for (const t of raw.tokens.research) cards[t.id] = { ...t, kind: 'research', source: 'token' };
  for (const t of raw.tokens.survivor) cards[t.id] = { ...t, kind: 'survivor', source: 'token', effect: [] };

  return {
    config: raw.config,
    chars: Object.fromEntries(raw.characters.characters.map((c) => [c.id, c])),
    cards,
    enemies,
    tokens,
    missions: Object.fromEntries(raw.missions.missions.map((m) => [m.id, m])),
    facilities: Object.fromEntries(raw.facilities.facilities.map((f) => [f.id, f])),
    zoneBoss: raw.investigation.zone_boss,
    blocks: raw.effect_blocks,
    maps: withPlayerVariants(raw.maps ?? {}),
  };
}

// 인원수별 칸(min_players, 2026-10-03 사용자 결정): 그 인원수보다 적으면 그 칸은 빈 길(지형 · 구역 · 비밀 통로는 그대로).
// 그런 칸이 있는 맵은 인원수마다 변형 맵(id~2p 등)을 만들어 두고, newGame이 인원수에 맞는 변형을 고른다.
export const playerMapId = (maps, mapId, n) => (maps[`${mapId}~${n}p`] ? `${mapId}~${n}p` : mapId);
function withPlayerVariants(maps) {
  const out = { ...maps };
  for (const m of Object.values(maps)) {
    if (!m.cells?.some((c) => c.min_players)) continue;
    for (let n = 1; n <= 4; n++) {
      const cells = m.cells.map((c) => {
        if (!(c.min_players > n)) return c;
        const { amount, name_key, uses, ...rest } = c;
        return { ...rest, type: 'empty', inactive_type: c.type };
      });
      out[`${m.id}~${n}p`] = { ...m, id: `${m.id}~${n}p`, base_id: m.id, for_players: n, cells };
    }
  }
  return out;
}

const DATA_NAMES = ['config', 'characters', 'player_cards', 'supply', 'black_market', 'investigation',
  'missions', 'facilities', 'tokens', 'enemies', 'effect_blocks', 'search'];

// Node에서 prototype/data 폴더를 읽는다.
export async function loadRawFromDir(dataDir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const read = (n) => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
  const raw = Object.fromEntries(DATA_NAMES.map((n) => [n, read(n)]));
  // 맵: data/map_*.json 전부(파일 안의 id로 찾는다)
  const maps = fs.readdirSync(dataDir).filter((f) => /^map_.*[.]json$/.test(f)).map((f) => read(f.slice(0, -5)));
  raw.maps = Object.fromEntries(maps.map((m) => [m.id, m]));
  return raw;
}

// 브라우저에서 정적 서버로 열었을 때 fetch로 같은 모양을 만든다. dataUrl 기본값은 '../data/'.
// maps: 읽을 맵 파일 이름 목록(정적 호스팅용, 2026-10-17 포트폴리오 데모). 없으면 아래처럼 개발 서버에 묻는다.
export async function loadRawFromUrl(dataUrl = '../data/', { maps: fixedMaps = null } = {}) {
  const read = async (n) => (await fetch(`${dataUrl}${n}.json`)).json();
  const raw = Object.fromEntries(await Promise.all(DATA_NAMES.map(async (n) => [n, await read(n)])));
  // 맵 목록은 개발 서버(tools/serve.py)의 /__maps에서, 없으면 기본 마을 맵만
  let names = fixedMaps ?? ['map_village'];
  if (!fixedMaps) try { const r = await fetch('/__maps'); if (r.ok) names = await r.json(); } catch { /* 정적 서버 */ }
  const maps = await Promise.all(names.map(read));
  raw.maps = Object.fromEntries(maps.map((m) => [m.id, m]));
  return raw;
}
