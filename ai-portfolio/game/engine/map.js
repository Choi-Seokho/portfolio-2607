// 도시 보드 그래프: 이동 비용 · 거리(구간 수) · 적 경로.
// - 일반 선: cost 만큼 이동력, 구간 1
// - 그래플링 훅 통로(kind: grapple): 아이콘만 있으면 이동력 1 · 구간 아님, cost가 적혀 있으면 그 이동력 · 구간 1
// - 비밀 통로(같은 secret 로마자 칸끼리): 이동력 1 · 구간 아님
// 적은 일반 선으로만 이동한다.
//
// 육각 맵(grid: 'hex', 2026-10-01 F3a · 노션 AC-6 · AC-8): 선(edges)을 적지 않고 칸마다 축 좌표 q · r(꼭짓점이 위인 육각)만 적는다.
// - 이웃 6칸을 자동으로 잇는다. 한 칸 = 이동력 1.
// - 험지(terrain: 'rough'): 험지 밖에서 험지 칸으로 들어갈 때 이동력 rough_entry_cost(기본 2), 험지 안 · 나갈 때는 1. 적도 같다.
// - 장애물(terrain: 'obstacle'): 일반 이동 · 적은 못 들어간다. 그래플링 훅이 있으면 지나갈 수 있다(멈출 수는 없음 — canStop).
// - 그래플링 훅이 있으면 험지 진입도 이동력 1.
// - 거리(사거리 · 시야 · 소음) = 육각 칸 수. 장애물 · 험지와 상관없다.
// - 비밀 통로(secret)는 선 맵과 같다.
//
// 비밀 통로 방향(2026-10-01 사용자 결정): secret_dir가 있으면 같은 표시의 입구(in) → 출구(out)로만 이동(일방통행).
// secret_dir가 없는 예전 맵 · 테스트 맵은 양방향.

const cache = new WeakMap();

// 육각 이웃 방향(축 좌표 q · r)
export const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const isHex = (map) => map?.grid === 'hex';
export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
// 칸 중심 위치(한 변 길이 1, 꼭짓점이 위) — 화면 · 편집기용
export const hexXY = (q, r) => ({ x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r });

export function graph(map) {
  let g = cache.get(map);
  if (g) return g;
  const cells = new Map(map.cells.map((c) => [c.id, c]));
  const adj = new Map(map.cells.map((c) => [c.id, []]));
  if (isHex(map)) hexLinks(map, adj);
  else for (const e of map.edges) {
    const kind = e.kind === 'grapple' ? 'grapple' : 'normal';
    const cost = e.cost ?? 1;
    const segment = kind === 'normal' || e.cost != null;
    adj.get(e.a).push({ to: e.b, cost, kind, segment });
    adj.get(e.b).push({ to: e.a, cost, kind, segment });
  }
  const bySecret = new Map();
  for (const c of map.cells) {
    if (!c.secret) continue;
    if (!bySecret.has(c.secret)) bySecret.set(c.secret, []);
    bySecret.get(c.secret).push(c);
  }
  const oneWay = (a, b) => (a.secret_dir || b.secret_dir ? a.secret_dir === 'in' && b.secret_dir === 'out' : true);
  for (const list of bySecret.values()) {
    for (const a of list) for (const b of list) {
      if (a !== b && oneWay(a, b)) adj.get(a.id).push({ to: b.id, cost: 1, kind: 'secret', segment: false });
    }
  }
  g = { cells, adj };
  cache.set(map, g);
  return g;
}

// 육각 이웃 잇기. 방향마다 비용이 다를 수 있어(험지 진입) a → b, b → a를 따로 넣는다.
// 장애물에 닿는 연결과 험지 진입의 1짜리 연결은 그래플링 전용(kind: grapple)이라 적 · 일반 이동은 못 쓴다.
function hexLinks(map, adj) {
  const at = new Map(map.cells.map((c) => [`${c.q},${c.r}`, c]));
  const roughCost = map.rough_entry_cost ?? 2;
  for (const c of map.cells) {
    for (const [dq, dr] of HEX_DIRS) {
      const n = at.get(`${c.q + dq},${c.r + dr}`);
      if (!n) continue;
      const list = adj.get(c.id);
      if (c.terrain === 'obstacle' || n.terrain === 'obstacle') {
        list.push({ to: n.id, cost: 1, kind: 'grapple', segment: true });
        continue;
      }
      const cost = n.terrain === 'rough' && c.terrain !== 'rough' ? roughCost : 1;
      list.push({ to: n.id, cost, kind: 'normal', segment: true });
      if (cost > 1) list.push({ to: n.id, cost: 1, kind: 'grapple', segment: true, rough: true });   // rough: 험지 진입 1짜리 — 험지 무시(닌자)는 그래플링 없이 쓴다(2026-10-08)
    }
  }
}

export function cellOf(map, id) {
  return graph(map).cells.get(id);
}

// 이동을 끝낼 수 있는 칸인가(장애물 칸은 그래플링으로 지나가기만 한다, AC-8-1)
export function canStop(map, id) {
  return cellOf(map, id)?.terrain !== 'obstacle';
}

// 화면용 연결 목록 {a, b, cost, kind}: 선 맵은 적힌 선 그대로, 육각 맵은 이웃 쌍(한 번씩)
export function linksOf(map) {
  if (!isHex(map)) return map.edges;
  const out = [];
  for (const [a, list] of graph(map).adj) {
    for (const e of list) {
      if (e.kind === 'secret' || a > e.to) continue;
      if (out.some((x) => x.a === a && x.b === e.to)) continue;
      const kind = list.some((x) => x.to === e.to && x.kind === 'normal') ? 'normal' : 'grapple';
      out.push({ a, b: e.to, cost: 1, kind });
    }
  }
  return out;
}

// 캐릭터 이동에서 a → b 한 걸음에 쓸 수 있는 가장 싼 연결
export function stepEdge(map, a, b, { grapple = false, roughFree = false } = {}) {
  const opts = graph(map).adj.get(a)?.filter((e) => e.to === b) ?? [];
  const usable = opts.filter((e) => e.kind !== 'grapple' || grapple || (roughFree && e.rough));
  if (usable.length) return usable.reduce((x, y) => (y.cost < x.cost ? y : x));
  if (opts.length) return { ...opts[0], blocked: 'grapple_required' };
  return null;
}

// 거리 = 길로 이어진 구간 수 (BFS). 이어지지 않으면 Infinity
export function segDist(map, a, b) {
  if (a == null || b == null) return Infinity;
  if (a === b) return 0;
  if (isHex(map)) {
    const ca = cellOf(map, a), cb = cellOf(map, b);
    return ca && cb ? hexDist(ca, cb) : Infinity;
  }
  const { adj } = graph(map);
  const seen = new Set([a]);
  let frontier = [a];
  let d = 0;
  while (frontier.length) {
    d++;
    const nextF = [];
    for (const c of frontier) {
      for (const e of adj.get(c)) {
        if (!e.segment || seen.has(e.to)) continue;
        if (e.to === b) return d;
        seen.add(e.to);
        nextF.push(e.to);
      }
    }
    frontier = nextF;
  }
  return Infinity;
}

// 적의 이동 경로: 일반 선만, 이동력 비용 최소(다익스트라). 비용이 같으면 먼저 찾은 경로.
// blocked: 지나갈 수 없는 칸(한 칸에 하나 규칙에서 캐릭터가 서 있는 칸). 목적지는 막혀 있어도 비용 계산용으로 허용
export function enemyPath(map, from, to, blocked = null) {
  if (from === to) return { cost: 0, path: [from] };
  const { adj } = graph(map);
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const open = [from];
  const done = new Set();
  while (open.length) {
    open.sort((x, y) => dist.get(x) - dist.get(y));
    const c = open.shift();
    if (done.has(c)) continue;
    done.add(c);
    if (c === to) break;
    for (const e of adj.get(c)) {
      if (e.kind !== 'normal') continue;
      if (blocked && e.to !== to && blocked.has(e.to)) continue;
      const nd = dist.get(c) + e.cost;
      if (!dist.has(e.to) || nd < dist.get(e.to)) {
        dist.set(e.to, nd);
        prev.set(e.to, c);
        open.push(e.to);
      }
    }
  }
  if (!dist.has(to)) return { cost: Infinity, path: null };
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]));
  return { cost: dist.get(to), path };
}

export function edgeCost(map, a, b) {
  const e = graph(map).adj.get(a).find((x) => x.to === b && x.kind === 'normal');
  return e ? e.cost : Infinity;
}

// 소음 이동용: 선 비용과 무관하게 일반 선으로 이어진 이웃
export function normalNeighbors(map, a) {
  return graph(map).adj.get(a).filter((e) => e.kind === 'normal').map((e) => e.to);
}
