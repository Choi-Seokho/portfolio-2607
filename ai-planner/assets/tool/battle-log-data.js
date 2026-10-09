/* BattleLogViewer 데모용 가상 로그 데이터 — 실제 서비스 로그가 아닌 포트폴리오 데모 전용 가상 데이터입니다.
   무기 이름·클래스·수치는 모두 가상이며, 실제 도구가 쓰는 "입장 로그 + PvP 킬 로그" 구조만 재현했습니다.

   - 입장 로그: 매치 입장 시 유저가 어떤 클래스로, 어떤 무기(주무기·보조무기)를 들고 들어갔는지
   - PvP 킬 로그: 누가 어떤 무기로 처치했는지 (피해자의 무기는 킬 로그에 없음)
   - 피해자의 무기는 피해자의 입장 로그를 (매치, 유저) 키로 역추적해서 구함
   데모의 무기 성능 차이는 아래 WM_WEAPONS의 power/popularity로만 만들어지는 임의 값입니다. */

function wmMulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WM_CLASSES = [
  { id: 1, name: '브루저', color: '#f87171' },
  { id: 2, name: '스카우트', color: '#a78bfa' },
  { id: 3, name: '가디언', color: '#60a5fa' },
  { id: 4, name: '서포터', color: '#fbbf24' },
];

// slot 1 = 주무기, slot 2 = 보조무기 / power = 데모용 가상 성능, popularity = 기본 선호도
// affinity = 클래스별 선호 가중치 (클래스 id 순)
const WM_WEAPONS = [
  { id: 1, name: '야구 배트', kind: '근접', slot: 1, power: 1.00, popularity: 1.2, affinity: [1.6, 0.6, 1.2, 0.8] },
  { id: 2, name: '소방 도끼', kind: '근접', slot: 1, power: 1.10, popularity: 1.0, affinity: [1.8, 0.5, 1.3, 0.7] },
  { id: 3, name: '카타나', kind: '근접', slot: 1, power: 1.24, popularity: 1.5, affinity: [1.2, 1.7, 0.8, 0.9] },
  { id: 4, name: '쇠파이프', kind: '근접', slot: 1, power: 0.84, popularity: 0.5, affinity: [1.2, 0.8, 1.0, 1.0] },
  { id: 5, name: '리볼버', kind: '원거리', slot: 1, power: 1.04, popularity: 1.3, affinity: [0.7, 1.5, 1.0, 1.3] },
  { id: 6, name: '산탄총', kind: '원거리', slot: 1, power: 1.14, popularity: 1.0, affinity: [1.1, 1.0, 1.6, 0.8] },
  { id: 7, name: '볼트액션 소총', kind: '원거리', slot: 1, power: 0.92, popularity: 1.6, affinity: [0.5, 1.9, 0.7, 1.2] },
  { id: 8, name: '석궁', kind: '원거리', slot: 1, power: 1.12, popularity: 0.32, affinity: [0.6, 1.4, 0.8, 1.2] },
  { id: 9, name: '단검', kind: '근접', slot: 2, power: 0.92, popularity: 1.1, affinity: [0.8, 1.6, 0.8, 1.2] },
  { id: 10, name: '권총', kind: '원거리', slot: 2, power: 0.98, popularity: 1.3, affinity: [1.0, 1.1, 1.2, 1.2] },
  { id: 11, name: '손도끼', kind: '근접', slot: 2, power: 1.03, popularity: 0.8, affinity: [1.4, 0.8, 1.2, 0.8] },
  { id: 12, name: '화염병', kind: '투척', slot: 2, power: 1.10, popularity: 0.4, affinity: [0.9, 0.9, 1.0, 1.5] },
];

const WM_MODES = {
  solo: { name: '솔로', players: 8 },
  trio: { name: '트리오', players: 9 },
};

function wmPickWeighted(rand, items, weightFn) {
  let total = 0;
  const weights = items.map((it) => { const w = weightFn(it); total += w; return w; });
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function wmBuildLogs() {
  const rand = wmMulberry32(20260401);
  const primaries = WM_WEAPONS.filter((w) => w.slot === 1);
  const secondaries = WM_WEAPONS.filter((w) => w.slot === 2);
  const byId = Object.fromEntries(WM_WEAPONS.map((w) => [w.id, w]));
  const entries = []; // 입장 로그
  const kills = [];   // PvP 킬 로그
  let matchSeq = 1;

  Object.keys(WM_MODES).forEach((modeKey) => {
    const matchCount = 420;
    for (let m = 0; m < matchCount; m++) {
      const matchId = matchSeq++;
      const players = [];
      for (let p = 0; p < WM_MODES[modeKey].players; p++) {
        const cls = WM_CLASSES[Math.floor(rand() * WM_CLASSES.length)];
        const prim = wmPickWeighted(rand, primaries, (w) => w.popularity * w.affinity[cls.id - 1]);
        const sec = wmPickWeighted(rand, secondaries, (w) => w.popularity * w.affinity[cls.id - 1]);
        const entry = { matchId, playerId: p + 1, mode: modeKey, classId: cls.id, weapons: [prim.id, sec.id] };
        players.push(entry);
        entries.push(entry);
      }

      // 매치당 PvP 킬 3~6건: 무작위 두 명이 맞붙어 가상 성능 + 변동으로 승패 결정
      const alive = players.slice();
      const killCount = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < killCount && alive.length > 1; k++) {
        const ai = Math.floor(rand() * alive.length);
        let bi = Math.floor(rand() * (alive.length - 1));
        if (bi >= ai) bi++;
        const a = alive[ai];
        const b = alive[bi];
        const strength = (e) => (byId[e.weapons[0]].power * 0.7 + byId[e.weapons[1]].power * 0.3) * (0.75 + rand() * 0.5);
        const [winner, loser] = strength(a) >= strength(b) ? [a, b] : [b, a];
        const usedPrimary = rand() < 0.7;
        kills.push({
          matchId,
          mode: modeKey,
          killerClassId: winner.classId,
          killerWeaponId: winner.weapons[usedPrimary ? 0 : 1],
          victimKey: `${matchId}_${loser.playerId}`,
        });
        alive.splice(alive.indexOf(loser), 1);
      }
    }
  });

  return { entries, kills };
}

const WM_LOGS = wmBuildLogs();
