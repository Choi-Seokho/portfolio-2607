// 3D 보드 월드: 지형 · 칸 · 장소 모형 · 보드 바깥 세계 · 렌더러 · 광원.
// viewer3d/demo3d.template.html(아트 방향 v0.2 룩 데모)에서 가져온 코드를 함수 하나로 감쌌다.
// 룩을 바꿀 때는 이 파일과 demo3d 템플릿을 같이 본다(docs/art-direction.md 참고).
// three.js는 UMD 빌드(viewer3d/lib/three.min.js)를 <script>로 먼저 불러 전역 THREE를 쓴다(빌드 과정 없음).

export function buildWorld(MAP, L, canvasId = 'c') {
  const THREE = window.THREE;
  // =====================================================================
  const S = 3.6;                // 맵 좌표 1 = 월드 3.6 단위 (칸 사이 간격 약 1.0)
  const TILE = 2.6;             // 칸 한 변 길이
  const HALF = TILE / 2;
  const TILE_H = 0.2;           // 칸 두께
  // 육각 맵(grid: 'hex', F3d 2026-10-01): 꼭짓점이 위인 육각. HR = 중심 간격 기준 반지름, HT = 칸 반지름(사이 틈 0.1)
  const HEX = MAP.grid === 'hex';
  const HR = 1.6, HT = 1.5;
  const hexPos = (q, r) => ({ x: Math.sqrt(3) * HR * (q + r / 2), z: 1.5 * HR * r });
  // 칸 종류: 바닥 색(은은하게) · 인쇄 색(아이콘·수량, 진하게) · 마커를 놓는 칸인지
  const TYPE_INFO = {
    start:       { tile: '#D8CDB0', ink: '#7A7262', marker: false },
    supply:      { tile: '#EACB9A', ink: '#B5561C', marker: true },
    enemy:       { tile: '#DDAE9C', ink: '#9E2F27', marker: false },
    investigate: { tile: '#BACBD8', ink: '#2F5E88', marker: true },
    money:       { tile: '#EADCA0', ink: '#94700E', marker: true },
    resource:    { tile: '#CDBB9C', ink: '#5A4632', marker: true },
    survivor:    { tile: '#EFC3A3', ink: '#B04E28', marker: true },
    camp:        { tile: '#F0D38A', ink: '#A85D08', marker: false },
    lab:         { tile: '#DCE3E6', ink: '#2F7466', marker: true },
    search:      { tile: '#E8D9AE', ink: '#7A5A1E', marker: true },
    empty:       { tile: '#D3C9A8', ink: '#8A7F66', marker: false },
  };
  // 육각 맵 지형 테마(빈칸 바닥색) · 구역 테두리 진한 색
  const BIOME_TILE = { forest: '#A3BC78', swamp: '#9AA47C', wreck: '#BFB096', river: '#7DB6D2', bridge: '#B99A6C' };
  const BIOME_GLYPH = { forest: '🌲', swamp: '🌾', wreck: '🚗', river: '🌊' };
  const ZONE_STRONG = { blue: '#2F6FD6', yellow: '#D4A114', red: '#D0453A' };
  // 보스 구역: 칸 아래 바닥(구역 판)을 은은한 색으로 칠한다
  const ZONE_COLOR = { blue: '#8FAFC9', yellow: '#DDC57C', red: '#D39A86' };
  // 칸 안 배치(칸 중심 기준, +z가 화면 아래쪽)
  // 칸 안 배치 (위에서부터 3줄)
  //   뒷줄: 장소 모형 / 가운데 줄: [아이콘 · 수량 · 마커 자리]를 칸 바닥에 크게 인쇄 / 앞줄: 말 4자리
  const LANDMARK_Z = -0.88;
  const INFO_Z = -0.1;
  const ICON_SIZE = 0.98, AMOUNT_W = 0.74, MARKER_W = 0.5, INFO_GAP = 0.08;
  // 건물 없이 보는 큰 칸 정보(육각 맵, 2026-10-03): 칸 뒤쪽 절반에 크게. 피규어는 칸 앞쪽에 선다
  // 2026-10-04: 아이콘을 칸 정중앙에 더 크게(피규어는 칸 앞쪽에 크게 서므로 아이콘 아래쪽이 조금 가려질 수 있음)
  const BIG_INFO_Z = -0.05, BIG_ICON = 1.5, BIG_AMOUNT = 0.95;
  let buildingsOn = false;
  try { buildingsOn = localStorage.getItem('eb.buildings') === '1'; } catch { /* 저장소를 못 쓰면 기본(끔) */ }
  const SECRET_DIM = 0.22;                 // 비밀 통로 점선: 평소엔 흐리게, 마우스를 올린 통로만 진하게
  const secretMats = new Map();            // 통로 번호 → 점선 재질
  const PAWN_SLOTS = HEX ? [[-0.75, 0.66], [-0.25, 0.66], [0.25, 0.66], [0.75, 0.66]] : [[-0.9, 0.84], [-0.3, 0.84], [0.3, 0.84], [0.9, 0.84]];
  const ENEMY_SLOT = 3;                                            // 적 칸: 좀비가 앞줄 맨 오른쪽
  // =====================================================================
  // 유틸
  // =====================================================================
  function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  const rand = rng(20260928);
  const col = (hex) => new THREE.Color(hex);
  const matCache = new Map();
  function mat(hex) {
    if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshLambertMaterial({ color: col(hex) }));
    return matCache.get(hex);
  }
  function add(parent, geo, hex, x, y, z, o) {
    const m = new THREE.Mesh(geo, typeof hex === 'string' ? mat(hex) : hex);
    m.position.set(x || 0, y || 0, z || 0);
    if (o && o.ry) m.rotation.y = o.ry;
    if (o && o.rx) m.rotation.x = o.rx;
    if (o && o.rz) m.rotation.z = o.rz;
    m.castShadow = !(o && o.noShadow);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const box = (p, w, h, d, c, x, y, z, o) => add(p, new THREE.BoxGeometry(w, h, d), c, x, y + h / 2, z, o);
  const cyl = (p, r, h, c, x, y, z, seg, o) => add(p, new THREE.CylinderGeometry(r, r, h, seg || 14), c, x, y + h / 2, z, o);
  const cone = (p, r, h, c, x, y, z, seg, o) => add(p, new THREE.ConeGeometry(r, h, seg || 8), c, x, y + h / 2, z, o);
  function roundedRectShape(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // 모서리가 둥글고 윗면이 살짝 깎인 판 (바닥 y=0, 높이 h)
  function slabGeo(w, d, h, r, bevel) {
    const g = new THREE.ExtrudeGeometry(roundedRectShape(w - bevel * 2, d - bevel * 2, Math.max(0.01, r - bevel)),
      { depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 5 });
    g.rotateX(-Math.PI / 2); g.translate(0, bevel, 0);
    return g;
  }
  // 박공지붕(삼각 기둥): 길이 w(x축), 폭 d(z축), 높이 h
  function roofGeo(w, d, h) {
    const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2); g.rotateY(Math.PI / 2);
    return g;
  }
  function outlineGeo(w, d, r, t) {
    const s = roundedRectShape(w + t, d + t, r + t / 2);
    s.holes.push(roundedRectShape(w - t, d - t, Math.max(0.01, r - t / 2)));
    const g = new THREE.ShapeGeometry(s, 6); g.rotateX(-Math.PI / 2);
    return g;
  }

  // =====================================================================
  // 아이콘 텍스처 (캔버스로 그린 픽토그램, 문자 없음 → 국가 미상 톤)
  // =====================================================================
  const texCache = new Map();
  function iconTexture(kind, ink) {
    ink = ink || '#fff';
    const key = kind + '|' + ink;
    if (texCache.has(key)) return texCache.get(key);
    const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d');
    g.translate(N / 2, N / 2); g.scale(N / 256, N / 256);
    g.fillStyle = ink; g.strokeStyle = ink; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
    const P = new Path2D();
    switch (kind) {
      case 'supply':        // 테이프 붙은 상자
        g.lineWidth = 18;                                       // 나무 상자: 테두리 + X 버팀목
        g.strokeRect(-60, -60, 120, 120);
        g.beginPath(); g.moveTo(-54, -54); g.lineTo(54, 54); g.moveTo(54, -54); g.lineTo(-54, 54); g.stroke();
        break;
      case 'enemy':         // 해골
        g.beginPath(); g.arc(0, -14, 62, 0, Math.PI * 2); g.fill();
        g.fillRect(-36, 20, 72, 44);
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(-24, -12, 16, 0, Math.PI * 2); g.arc(24, -12, 16, 0, Math.PI * 2); g.fill();
        g.fillRect(-4, 34, 8, 30); g.fillRect(-22, 38, 8, 26); g.fillRect(14, 38, 8, 26);
        g.globalCompositeOperation = 'source-over';
        break;
      case 'investigate':   // 돋보기
        g.lineWidth = 18;
        g.beginPath(); g.arc(-16, -16, 44, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 26; g.beginPath(); g.moveTo(18, 18); g.lineTo(62, 62); g.stroke();
        break;
      case 'money':         // 동전 더미
        for (const [x, y] of [[-26, 30], [26, 30], [0, -20]]) {
          g.beginPath(); g.arc(x, y, 38, 0, Math.PI * 2); g.fill();
          g.globalCompositeOperation = 'destination-out'; g.lineWidth = 8;
          g.beginPath(); g.arc(x, y, 24, 0, Math.PI * 2); g.stroke();
          g.globalCompositeOperation = 'source-over';
        }
        break;
      case 'resource':      // 톱니바퀴(부품)
        g.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * Math.PI * 2, r = i % 2 ? 58 : 76;
          const a2 = (i + 1) / 16 * Math.PI * 2;
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
        }
        g.closePath(); g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'source-over';
        break;
      case 'camp':          // 텐트 + 불
        g.beginPath(); g.moveTo(-78, 56); g.lineTo(-10, -60); g.lineTo(58, 56); g.closePath(); g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.moveTo(-28, 56); g.lineTo(-10, 14); g.lineTo(8, 56); g.closePath(); g.fill();
        g.globalCompositeOperation = 'source-over';
        g.beginPath(); g.moveTo(66, 60); g.quadraticCurveTo(44, 30, 70, 4); g.quadraticCurveTo(96, 34, 74, 60); g.closePath(); g.fill();
        break;
      case 'lab':           // 플라스크
        g.beginPath(); g.moveTo(-18, -70); g.lineTo(18, -70); g.lineTo(18, -18); g.lineTo(62, 58); g.lineTo(-62, 58); g.lineTo(-18, -18); g.closePath(); g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(-10, 30, 10, 0, Math.PI * 2); g.arc(16, 12, 7, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'source-over';
        break;
      case 'survivor':      // 사람 + 더하기
        g.beginPath(); g.arc(-18, -34, 30, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(-70, 64); g.quadraticCurveTo(-68, 4, -18, 4); g.quadraticCurveTo(32, 4, 34, 64); g.closePath(); g.fill();
        g.lineWidth = 16; g.beginPath(); g.moveTo(66, -32); g.lineTo(66, 8); g.moveTo(46, -12); g.lineTo(86, -12); g.stroke();
        break;
      case 'search': {      // 물음표(수색 — 카드를 뒤집어 봐야 앎)
        g.font = 'bold 200px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('?', 0, 8);
        break;
      }
      case 'start':         // 들어오는 화살표
        g.lineWidth = 20;
        g.beginPath(); g.moveTo(0, -64); g.lineTo(0, 44); g.stroke();
        g.beginPath(); g.moveTo(-44, 8); g.lineTo(0, 52); g.lineTo(44, 8); g.stroke();
        break;
      case 'check':         // 마커 윗면: 체크
        g.lineWidth = 30;
        g.beginPath(); g.moveTo(-54, 4); g.lineTo(-14, 44); g.lineTo(58, -36); g.stroke();
        break;
    }
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 8;
    texCache.set(key, t);
    return t;
  }
  // 수량: 칸 바닥에 인쇄하는 굵은 "×3" (아이콘과 같은 색)
  function numberTexture(n, ink) {
    const key = '#' + n + '|' + ink;
    if (texCache.has(key)) return texCache.get(key);
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = ink; g.textBaseline = 'middle';
    g.font = `900 130px "Pretendard","Malgun Gothic","Arial Black",sans-serif`;
    g.textAlign = 'right'; g.fillText('×', 104, 150);
    g.font = `900 290px "Pretendard","Malgun Gothic","Arial Black",sans-serif`;
    g.textAlign = 'left'; g.fillText(String(n), 100, 142);
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 8;
    texCache.set(key, t);
    return t;
  }

  // =====================================================================
  // 렌더러 · 씬 · 광원
  // =====================================================================
  const canvas = document.getElementById(canvasId);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;          // 마스크 패스에서 그림자를 다시 굽지 않도록 직접 갱신

  const FOG = '#c8cfae';
  const scene = new THREE.Scene();
  scene.background = col(FOG);
  scene.fog = new THREE.Fog(col(FOG), 60, 140);

  // 게임 보드 영역(월드). 육각 맵은 칸 위치에서 계산
  const HB = HEX ? MAP.cells.map((c) => hexPos(c.q, c.r)) : null;
  const GX0 = HEX ? Math.min(...HB.map((p) => p.x)) - HR * 1.2 : -0.62 * S;
  const GX1 = HEX ? Math.max(...HB.map((p) => p.x)) + HR * 1.2 : 7.62 * S;
  const GZ0 = HEX ? Math.min(...HB.map((p) => p.z)) - HR * 1.2 : -0.62 * S;
  const GZ1 = HEX ? Math.max(...HB.map((p) => p.z)) + HR * 1.2 : 5.62 * S;
  const BW = GX1 - GX0, BD = GZ1 - GZ0, BCX = (GX0 + GX1) / 2, BCZ = (GZ0 + GZ1) / 2;
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 400);

  const sun = new THREE.DirectionalLight(col('#FFDDA8'), 0.74);
  sun.position.set(BCX - 22, 20, BCZ + 13);
  sun.target.position.set(BCX, 0, BCZ);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  { const sc = sun.shadow.camera, hw = Math.max(26, BW / 2 + 6), hd = Math.max(22, BD / 2 + 6); sc.left = -hw; sc.right = hw; sc.top = hd; sc.bottom = -hd; sc.near = 1; sc.far = 80 + Math.max(BW, BD); }
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(col('#d7e6ff'), col('#8a78a8'), 0.6));

  // =====================================================================
  // 땅: 보드 바깥까지 이어지는 들판 + 보드 둘레 흙길
  // =====================================================================
  {
    const ground = add(scene, new THREE.PlaneGeometry(400, 400), '#86AE55', BCX, 0, BCZ, { rx: -Math.PI / 2, noShadow: true });
    ground.castShadow = false;
    // 보드 영역은 조금 더 정돈된 잔디
    add(scene, slabGeo(BW, BD, 0.04, 1.2, 0.015), '#92B962', BCX, 0.0, BCZ, { noShadow: true });
    // 둘레 흙길
    add(scene, outlineGeo(BW + 0.9, BD + 0.9, 1.6, 0.9), '#CDAF7E', BCX, 0.012, BCZ, { noShadow: true });
  }

  // =====================================================================
  // 인스턴스 소품 (나무·덤불·바위·풀) — 수백 개를 가볍게 그리기
  // =====================================================================
  const inst = {
    pineTrunk: [], pine1: [], pine2: [], pine3: [], roundTrunk: [], blob: [], rock: [], tuft: [], bush: [], flower: [],
  };
  const blocked = [];   // 장애물(원): 칸·도로·강·집 근처에는 나무를 심지 않음
  function isBlocked(x, z, r) {
    for (const b of blocked) {
      if (b.type === 'rect') { if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true; }
      else if (b.type === 'seg') {
        const dx = b.bx - b.ax, dz = b.bz - b.az, l2 = dx * dx + dz * dz;
        let t = ((x - b.ax) * dx + (z - b.az) * dz) / l2; t = Math.max(0, Math.min(1, t));
        if (Math.hypot(b.ax + dx * t - x, b.az + dz * t - z) < b.r + r) return true;
      } else if (Math.hypot(x - b.x, z - b.z) < b.r + r) return true;
    }
    return false;
  }
  function pushMat(list, x, y, z, s, ry, color, sy) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0)),
      new THREE.Vector3(s, s * (sy || 1), s));
    list.push({ m, c: col(color) });
  }
  function pine(x, z, s) {
    const ry = rand() * 6.28, tone = rand();
    pushMat(inst.pineTrunk, x, 0, z, s, ry, '#7A5A3A');
    pushMat(inst.pine1, x, 0.3 * s, z, s, ry, tone > 0.5 ? '#4E8A3E' : '#5E9146');
    pushMat(inst.pine2, x, 0.62 * s, z, s, ry, tone > 0.5 ? '#63A04A' : '#6FA84E');
    pushMat(inst.pine3, x, 0.92 * s, z, s, ry, '#86BD5B');
  }
  function roundTree(x, z, s) {
    const ry = rand() * 6.28;
    pushMat(inst.roundTrunk, x, 0, z, s, ry, '#846042');
    pushMat(inst.blob, x, 0.75 * s, z, s, ry, rand() > 0.5 ? '#7DB14E' : '#8FBF55');
    pushMat(inst.blob, x + 0.18 * s, 0.98 * s, z - 0.08 * s, s * 0.72, ry + 1, '#9ECB62');
  }
  function flushInstances() {
    const geos = {
      pineTrunk: new THREE.CylinderGeometry(0.07, 0.1, 0.36, 6).translate(0, 0.18, 0),
      pine1: new THREE.ConeGeometry(0.48, 0.62, 7).translate(0, 0.31, 0),
      pine2: new THREE.ConeGeometry(0.37, 0.52, 7).translate(0, 0.26, 0),
      pine3: new THREE.ConeGeometry(0.24, 0.42, 7).translate(0, 0.21, 0),
      roundTrunk: new THREE.CylinderGeometry(0.07, 0.1, 0.62, 6).translate(0, 0.31, 0),
      blob: new THREE.IcosahedronGeometry(0.42, 0),
      rock: new THREE.DodecahedronGeometry(0.3, 0),
      tuft: new THREE.ConeGeometry(0.06, 0.26, 4).translate(0, 0.13, 0),
      bush: new THREE.IcosahedronGeometry(0.26, 0).translate(0, 0.16, 0),
      flower: new THREE.SphereGeometry(0.045, 6, 4).translate(0, 0.06, 0),
    };
    const noShadow = { tuft: 1, flower: 1 };
    for (const k in inst) {
      const list = inst[k]; if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[k], new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
      list.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, it.c); });
      im.castShadow = !noShadow[k]; im.receiveShadow = true;
      scene.add(im);
    }
  }

  // =====================================================================
  // 장소 모형 (칸 뒤쪽, 폭 ≤ 2.2 · 깊이 ≤ 0.8 · 높이 ≤ 1.4 — 뒤 칸을 가리지 않게)
  // =====================================================================
  function house(g, x, z, w, d, h, wall, roof, o) {
    box(g, w, h, d, wall, x, 0, z);
    if (o && o.flat) {
      box(g, w + 0.08, 0.1, d + 0.08, roof, x, h, z);
    } else {
      add(g, roofGeo(w + 0.16, d + 0.18, h * 0.55), roof, x, h, z);
    }
    // 문·창문
    box(g, 0.18, 0.32, 0.03, '#6B5A48', x - w * 0.25, 0, z + d / 2);
    for (const k of [0.05, 0.3]) box(g, 0.2, 0.18, 0.03, '#9CC1D6', x + w * k, h * 0.45, z + d / 2);
  }
  function awning(g, x, z, w, c1, c2) {
    for (let i = 0; i < 6; i++) box(g, w / 6, 0.05, 0.28, i % 2 ? c1 : c2, x - w / 2 + w / 12 + i * w / 6, 0.5, z, { rx: 0.35 });
  }
  function crates(g, x, z) {
    box(g, 0.3, 0.26, 0.3, '#D9913F', x, 0, z);
    box(g, 0.24, 0.22, 0.24, '#C47A34', x + 0.3, 0, z + 0.04);
    box(g, 0.22, 0.2, 0.22, '#E0A55C', x + 0.12, 0.26, z);
  }
  function barrels(g, x, z) {
    for (const [dx, dz] of [[0, 0], [0.26, 0.05], [0.12, -0.2]]) cyl(g, 0.12, 0.34, '#4E8FB8', x + dx, 0, z + dz, 12);
  }
  function tent(g, x, z, c, s) {
    s = s || 1;
    add(g, new THREE.ConeGeometry(0.5 * s, 0.62 * s, 4), c, x, 0.31 * s, z, { ry: Math.PI / 4 });
  }
  function fire(g, x, z) {
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; cyl(g, 0.05, 0.06, '#8F8D86', x + Math.cos(a) * 0.14, 0, z + Math.sin(a) * 0.14, 6); }
    const f = add(g, new THREE.ConeGeometry(0.09, 0.26, 6), new THREE.MeshBasicMaterial({ color: col('#FFB040') }), x, 0.14, z, { noShadow: true });
    f.userData.flame = true; flames.push(f);
    const l = new THREE.PointLight(col('#FFB050'), 0.45, 2.4); l.position.set(x, 0.5, z); g.add(l);
  }
  function treeProp(g, x, z, s) {
    cyl(g, 0.06 * s, 0.4 * s, '#846042', x, 0, z, 6);
    add(g, new THREE.IcosahedronGeometry(0.36 * s, 0), '#7DB14E', x, 0.62 * s, z);
  }
  function car(g, c) {
    box(g, 0.38, 0.16, 0.76, c, 0, 0.07, 0);
    box(g, 0.34, 0.14, 0.38, '#DCE4E8', 0, 0.23, -0.04);
    for (const [x, z] of [[-0.19, 0.24], [0.19, 0.24], [-0.19, -0.24], [0.19, -0.24]]) cyl(g, 0.08, 0.06, '#33363A', x, 0.08 - 0.03, z, 10, { rz: Math.PI / 2 });
  }
  function sandbags(g, x, z, n) {
    for (let i = 0; i < n; i++) add(g, new THREE.CapsuleGeometry(0.07, 0.16, 3, 6), '#C9B58A', x + i * 0.2, 0.07, z, { rz: Math.PI / 2 });
  }
  function water(g, x, z, w, d) {
    add(g, slabGeo(w, d, 0.04, Math.min(w, d) * 0.45, 0.01), '#5BA6C4', x, 0.005, z, { noShadow: true });
  }
  const flames = [];
  const LANDMARKS = {
    c_store(g) { house(g, 0.2, 0, 1.5, 0.66, 0.66, '#EDE2C8', '#E58A3C', { flat: true }); awning(g, 0.2, 0.42, 1.3, '#E58A3C', '#F2E6C9'); },
    c_alley(g) {
      box(g, 0.2, 0.9, 0.7, '#C9BBA0', -0.7, 0, 0); box(g, 0.2, 0.7, 0.7, '#B9AD95', 0.75, 0, 0);
      box(g, 0.44, 0.3, 0.3, '#5E7F5A', 0.2, 0, -0.1);
      for (const [x, z] of [[-0.3, 0.1], [-0.15, 0.2], [0.5, 0.2]]) add(g, new THREE.IcosahedronGeometry(0.11, 0), '#3E4A3E', x, 0.1, z);
    },
    c_police(g) {
      house(g, 0.1, 0, 1.5, 0.66, 0.8, '#E2E6E8', '#3E5E86', { flat: true });
      box(g, 1.52, 0.1, 0.68, '#3E5E86', 0.1, 0.55, 0);
      box(g, 0.14, 0.07, 0.07, '#3D8FD6', 0.0, 0.9, 0); box(g, 0.14, 0.07, 0.07, '#D9483B', 0.18, 0.9, 0);
    },
    c_bank(g) {
      house(g, 0.15, 0, 1.6, 0.66, 0.85, '#EFE4C9', '#8A7F6A', { flat: true });
      box(g, 1.3, 0.16, 0.04, '#6E9B5A', 0.15, 0.64, 0.34);
      for (const x of [-0.45, 0.75]) cyl(g, 0.05, 0.6, '#F5EEDC', x, 0, 0.38, 8);
    },
    c_ruin(g) {
      box(g, 1.2, 0.7, 0.66, '#BCAE93', 0.1, 0, 0);
      add(g, roofGeo(0.7, 0.8, 0.36), '#8A6E5A', -0.12, 0.7, 0, { rz: 0.22 });
      for (const [x, z, s] of [[0.55, 0.3, 0.16], [0.75, 0.15, 0.12], [-0.6, 0.3, 0.14]]) add(g, new THREE.DodecahedronGeometry(s, 0), '#A89A82', x, s * 0.5, z);
      box(g, 0.1, 0.3, 0.5, '#BCAE93', 0.62, 0.7, 0, { rz: 0.3 });
    },
    c_hardware(g) {
      house(g, -0.1, 0, 1.3, 0.66, 0.72, '#D8CDB5', '#6E6A60', { flat: true });
      for (let i = 0; i < 4; i++) cyl(g, 0.035, 0.8, '#A8B0B5', 0.8, 0.05 + i * 0.07, -0.1 + i * 0.03, 6, { rx: Math.PI / 2 });
      box(g, 0.4, 0.06, 0.6, '#D9B382', 0.8, 0, 0.1);
    },
    c_field(g) {
      for (let r = 0; r < 3; r++) for (let k = 0; k < 7; k++) add(g, new THREE.IcosahedronGeometry(0.08, 0), '#8DB65A', -0.95 + k * 0.3, 0.08, -0.25 + r * 0.25);
      box(g, 0.04, 0.5, 0.04, '#8A6A48', 0.95, 0, 0.25); box(g, 0.3, 0.04, 0.04, '#8A6A48', 0.95, 0.38, 0.25);
    },
    c_hall(g) { house(g, 0.1, 0, 1.7, 0.7, 0.7, '#E9DCC0', '#B0573F'); box(g, 0.5, 0.1, 0.14, '#8A6A48', -0.85, 0.12, 0.32); },
    c_plaza(g) {
      cyl(g, 0.5, 0.05, '#E3D4AE', 0.2, 0, 0, 20);
      treeProp(g, 0.2, -0.05, 1.2);
      fire(g, 0.85, 0.2);
      box(g, 0.44, 0.08, 0.12, '#8A6A48', -0.55, 0.12, 0.2);
    },
    c_clinic(g) {
      house(g, 0.15, 0, 1.4, 0.66, 0.8, '#F4F4F0', '#C9CED2', { flat: true });
      box(g, 0.34, 0.1, 0.04, '#D9483B', 0.15, 0.56, 0.34); box(g, 0.1, 0.34, 0.04, '#D9483B', 0.15, 0.44, 0.34);
    },
    c_school(g) {
      box(g, 2.0, 1.0, 0.62, '#EADBB8', 0.1, 0, -0.05);
      box(g, 2.08, 0.1, 0.7, '#B0573F', 0.1, 1.0, -0.05);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) box(g, 0.16, 0.16, 0.03, '#9CC1D6', -0.72 + k * 0.3, 0.18 + r * 0.42, 0.27);
      cyl(g, 0.12, 0.03, '#F5EEDC', 0.1, 0.78, 0.28, 16, { rx: Math.PI / 2 });
    },
    c_gas(g) {
      box(g, 1.3, 0.08, 0.7, '#E4572E', -0.2, 0.62, 0.05);
      for (const [x, z] of [[-0.75, -0.2], [0.35, -0.2], [-0.75, 0.3], [0.35, 0.3]]) box(g, 0.06, 0.62, 0.06, '#EDE6D6', x, 0, z);
      for (const x of [-0.4, 0.0]) box(g, 0.14, 0.34, 0.12, '#EDE6D6', x, 0, 0.05);
      house(g, 0.8, -0.05, 0.5, 0.55, 0.55, '#E2E6E8', '#6E6A60', { flat: true });
    },
    c_barn(g) {
      box(g, 1.3, 0.55, 0.7, '#B0573F', -0.2, 0, 0);
      add(g, new THREE.CylinderGeometry(0.35, 0.35, 1.34, 12, 1, false, 0, Math.PI), '#8E4535', -0.2, 0.55, 0, { rz: Math.PI / 2 });
      box(g, 0.34, 0.2, 0.46, '#6E9B5A', 0.8, 0.1, 0.1);
      for (const z of [-0.1, 0.3]) cyl(g, 0.12, 0.08, '#33363A', 0.8, 0.12 - 0.04, z, 10, { rz: Math.PI / 2 });
    },
    c_church(g) {
      house(g, -0.2, 0, 1.3, 0.66, 0.7, '#F1E8D2', '#6E6A8A');
      box(g, 0.34, 1.05, 0.34, '#F1E8D2', 0.7, 0, 0.05);
      cone(g, 0.28, 0.42, '#6E6A8A', 0.7, 1.05, 0.05, 4, { ry: Math.PI / 4 });
    },
    c_market(g) {
      for (const [x, c] of [[-0.65, '#E4572E'], [0.05, '#3D8FD6'], [0.75, '#6E9B5A']]) {
        box(g, 0.56, 0.3, 0.4, '#D9B382', x, 0, 0);
        for (const px of [-0.25, 0.25]) box(g, 0.03, 0.55, 0.03, '#8A6A48', x + px, 0, 0.18);
        box(g, 0.62, 0.05, 0.5, c, x, 0.55, 0.02, { rx: 0.2 });
      }
      crates(g, -0.9, 0.35);
    },
    c_bridge(g) {
      water(g, 0, 0.02, 2.2, 0.7);
      box(g, 2.3, 0.1, 0.44, '#A88A66', 0, 0.36, 0);
      for (const x of [-0.6, 0.6]) box(g, 0.14, 0.36, 0.3, '#A8A69E', x, 0, 0);
    },
    c_mart(g) {
      house(g, 0.05, 0, 2.0, 0.66, 0.75, '#EFE8D8', '#3E7E5A', { flat: true });
      box(g, 1.7, 0.16, 0.04, '#3E7E5A', 0.05, 0.55, 0.34);
      box(g, 0.2, 0.14, 0.14, '#A8B0B5', 0.8, 0, 0.45);
    },
    c_terminal(g) {
      box(g, 1.6, 0.06, 0.5, '#5F86A8', -0.15, 0.58, 0);
      for (const x of [-0.85, 0.55]) box(g, 0.06, 0.58, 0.06, '#EDE6D6', x, 0, 0);
      const b = new THREE.Group(); b.position.set(0.1, 0, 0.2);
      box(b, 1.2, 0.34, 0.36, '#F2B83B', 0, 0.08, 0); box(b, 1.1, 0.12, 0.37, '#9CC1D6', 0, 0.26, 0);
      for (const x of [-0.4, 0.4]) cyl(b, 0.08, 0.37, '#33363A', x, 0.08 - 0.04, -0.185, 10, { rx: Math.PI / 2 });
      g.add(b);
    },
    c_farm(g) {
      box(g, 1.6, 0.4, 0.6, '#E9DCC0', -0.1, 0, -0.05);
      add(g, roofGeo(1.7, 0.72, 0.28), '#8A6E5A', -0.1, 0.4, -0.05);
      for (const [x, z] of [[0.6, 0.4], [0.8, 0.3], [-0.4, 0.42]]) { add(g, new THREE.SphereGeometry(0.07, 8, 6), '#F7F4EC', x, 0.07, z); box(g, 0.03, 0.03, 0.03, '#D9483B', x, 0.13, z + 0.04); }
    },
    c_reservoir(g) {
      water(g, 0.1, 0, 1.9, 0.72);
      box(g, 0.2, 0.18, 0.76, '#A8A69E', -0.95, 0, 0);
      for (const [x, z] of [[0.9, 0.3], [0.95, -0.25], [-0.6, 0.35]]) for (let i = 0; i < 3; i++) box(g, 0.02, 0.3 + i * 0.05, 0.02, '#6E9B5A', x + i * 0.05, 0, z);
    },
    c_mill(g) {
      house(g, -0.35, 0, 1.0, 0.66, 0.6, '#D9C7A5', '#8A6E5A');
      box(g, 0.44, 1.2, 0.44, '#CBB894', 0.55, 0, -0.05);
      add(g, roofGeo(0.5, 0.5, 0.2), '#8A6E5A', 0.55, 1.2, -0.05);
      cyl(g, 0.22, 0.9, '#A8B0B5', 0.95, 0, 0.1, 12);
    },
    c_factory(g) {
      box(g, 1.6, 0.6, 0.7, '#B9B3A6', -0.15, 0, 0);
      for (let i = 0; i < 4; i++) add(g, roofGeo(0.72, 0.4, 0.24), '#8F8B85', -0.75 + i * 0.4, 0.6, 0, { ry: Math.PI / 2 });
      cyl(g, 0.12, 1.4, '#A0574A', 0.85, 0, -0.15, 10);
      for (const [x, z, s] of [[0.5, 0.35, 0.12], [0.75, 0.3, 0.09]]) add(g, new THREE.DodecahedronGeometry(s, 0), '#9F9A90', x, s * 0.5, z);
    },
    c_campsite(g) {
      tent(g, -0.6, 0, '#E8973A'); tent(g, 0.1, -0.1, '#5F86A8', 0.85);
      fire(g, 0.75, 0.2);
    },
    c_checkpoint(g) {
      box(g, 0.5, 0.62, 0.5, '#E2E6E8', -0.7, 0, -0.05);
      box(g, 0.58, 0.07, 0.58, '#6E6A60', -0.7, 0.62, -0.05);
      box(g, 1.2, 0.05, 0.05, '#E4572E', 0.2, 0.36, 0.2);
      box(g, 0.1, 0.4, 0.1, '#EDE6D6', -0.38, 0, 0.2);
      sandbags(g, 0.1, -0.2, 5);
    },
    // 2026-10-03 덜 쓰는 구역에 더한 부품 · 금품 칸
    c_sawmill(g) {
      house(g, -0.3, 0, 1.1, 0.55, 0.62, '#C9A47A', '#7A5A3E');
      for (let i = 0; i < 3; i++) cyl(g, 0.09, 0.9, '#9C7650', 0.65, 0.09 + i * 0.17, -0.2 + (i % 2) * 0.1, 10, { rz: Math.PI / 2 });
      cyl(g, 0.22, 0.04, '#A8B0B5', 0.65, 0.6, 0.3, 16, { rx: Math.PI / 2 });
    },
    c_junkyard(g) {
      box(g, 1.9, 0.3, 0.04, '#8F8B85', 0, 0, -0.35);
      for (const [x, z, s] of [[-0.6, 0, 0.2], [-0.25, 0.15, 0.15], [0.1, -0.05, 0.22], [0.3, 0.2, 0.12]]) add(g, new THREE.DodecahedronGeometry(s, 0), '#9F9A90', x, s * 0.6, z);
      const c = new THREE.Group(); c.position.set(0.75, 0, 0.05); c.rotation.y = 0.5; car(c, '#7A6A5A'); g.add(c);
    },
    c_garage(g) {
      house(g, -0.2, 0, 1.3, 0.62, 0.7, '#E2E6E8', '#3E5E86', { flat: true });
      box(g, 0.6, 0.42, 0.04, '#5A5F66', -0.2, 0, 0.36);
      barrels(g, 0.7, 0.25);
    },
    c_pharmacy(g) {
      house(g, 0, 0, 1.2, 0.62, 0.66, '#F2EEE4', '#3E9A6A', { flat: true });
      box(g, 0.08, 0.26, 0.04, '#3E9A6A', 0, 0.68, 0.34); box(g, 0.26, 0.08, 0.04, '#3E9A6A', 0, 0.77, 0.34);
    },
    c_post(g) {
      house(g, -0.15, 0, 1.3, 0.62, 0.7, '#EDE2C8', '#D9483B', { flat: true });
      cyl(g, 0.11, 0.42, '#D9483B', 0.75, 0, 0.3, 12);
    },
    c_diner(g) {
      house(g, 0.1, 0, 1.4, 0.6, 0.66, '#EDE2C8', '#C9962E', { flat: true });
      awning(g, 0.1, 0.42, 1.2, '#C9962E', '#F2E6C9');
      const c = new THREE.Group(); c.position.set(-0.85, 0, 0.1); car(c, '#4E8FB8'); g.add(c);
    },
    _start() {},
  };

  // =====================================================================
  // 맵: 구역 판 · 칸 · 장소 모형 · 아이콘 · 마커 자리
  // =====================================================================
  const gx = (x) => x * S, gz = (y) => y * S;
  const cells = new Map();         // id -> { data, pos, tile, ring, group, lift, marker }
  const tileMeshes = [];
  const tileGeo = slabGeo(TILE, TILE, TILE_H, 0.22, 0.05);
  const ringGeo = outlineGeo(TILE + 0.04, TILE + 0.04, 0.26, 0.14);
  const glowGeo = new THREE.PlaneGeometry(TILE - 0.1, TILE - 0.1);
  const slotGeo = outlineGeo(0.44, 0.44, 0.22, 0.04);
  function printDecal(g, tex, w, d, x, z) {          // 칸 윗면에 인쇄한 것처럼 붙이는 평면
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, TILE_H + 0.008, z); m.receiveShadow = true;
    g.add(m);
    return m;
  }
  const zoneGeo = new THREE.BoxGeometry(S, 0.05, S);

  // =====================================================================
  // 육각 맵(F3d): 육각 칸 · 구역 바닥 · 지형 테마(숲 · 늪 · 폐허 · 강 · 다리) · 장애물 · 테두리 · 비밀 통로
  // 규칙과 상관없는 그림(테마 소품)은 칸 가장자리에만 두어 아이콘 · 말 자리를 가리지 않는다.
  // =====================================================================
  function hexShape(R) {
    const s = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i + 30);
      if (i) s.lineTo(R * Math.cos(a), R * Math.sin(a)); else s.moveTo(R * Math.cos(a), R * Math.sin(a));
    }
    s.closePath();
    return s;
  }
  function hexSlabGeo(R, h, bevel) {
    const g = new THREE.ExtrudeGeometry(hexShape(R - bevel), { depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2); g.translate(0, bevel, 0);
    return g;
  }
  function hexFlatGeo(R) { const g = new THREE.ShapeGeometry(hexShape(R)); g.rotateX(-Math.PI / 2); return g; }
  function hexRingGeo(R, t) {
    const s = hexShape(R + t / 2);
    s.holes.push(hexShape(R - t / 2));
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2);
    return g;
  }
  // 칸 윗면에 글자(로마자 · 화살표)를 찍는 텍스처 — 비밀 통로 표시
  function labelTexture(text, ink, bg) {
    const key = 'lbl|' + text + '|' + ink + '|' + bg;
    if (texCache.has(key)) return texCache.get(key);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = bg; g.beginPath(); g.roundRect(6, 6, 244, 116, 40); g.fill();
    g.fillStyle = ink; g.font = 'bold 84px system-ui, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 70);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  }
  // 이모지 한 글자를 정사각 텍스처로(지형 아이콘)
  function glyphTexture(text) {
    const key = 'gly|' + text;
    if (texCache.has(key)) return texCache.get(key);
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d');
    g.font = '96px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.globalAlpha = 0.85;
    g.fillText(text, 64, 70);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  }
  function buildHexBoard() {
    const at = new Map(MAP.cells.map((c) => [`${c.q},${c.r}`, c]));
    const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const tileG = hexSlabGeo(HT, TILE_H, 0.05);
    const OBST_H = 0.62;
    const obstG = hexSlabGeo(HT, OBST_H, 0.06);
    const plateG = hexFlatGeo(HR);
    const ringG = hexRingGeo(HT - 0.02, 0.16);
    const glowG = hexFlatGeo(HT - 0.1);
    const markRingG = hexRingGeo(HT - 0.02, 0.32);   // 칸 찾기 테두리(굵게)
    // 월드 좌표의 꼭짓점(셰이프의 y가 월드의 -z가 되도록 회전했으므로 z는 부호를 바꿈)
    const cornersW = (x, z, R) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i + 30); return [x + R * Math.cos(a), z - R * Math.sin(a)]; });
    const edgeOf = (x, z, dq, dr, R) => {
      const n = hexPos(dq, dr);
      return cornersW(x, z, R).map((p) => ({ p, d: (p[0] - x) * n.x + (p[1] - z) * n.z })).sort((a, b) => b.d - a.d).slice(0, 2).map((o) => o.p);
    };
    function strip(a, b, color, y, w) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      add(scene, new THREE.BoxGeometry(len + w * 0.6, 0.03, w), color, (a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, { ry: -Math.atan2(b[1] - a[1], b[0] - a[0]), noShadow: true });
    }
    const treeAt = (x, z, s) => {
      const ry = rand() * 6.28;
      pushMat(inst.pineTrunk, x, TILE_H, z, s, ry, '#7A5A3A');
      pushMat(inst.pine1, x, TILE_H + 0.3 * s, z, s, ry, rand() > 0.5 ? '#4E8A3E' : '#5E9146');
      pushMat(inst.pine2, x, TILE_H + 0.62 * s, z, s, ry, '#63A04A');
      pushMat(inst.pine3, x, TILE_H + 0.92 * s, z, s, ry, '#86BD5B');
    };
    // 지형 테마 소품: 상호작용 칸은 양옆 가장자리에만, 빈칸은 조금 더
    function decorate(g, c, px, pz) {
      const typed = c.type !== 'empty';
      const side = [[-1.0, 0.1], [1.0, 0.1]];
      const many = [[-0.6, -0.55], [0.55, -0.5], [-0.75, 0.35], [0.7, 0.4], [0, 0.05]];
      const spots = typed ? side : many;
      if (c.biome === 'forest') for (const [x, z] of spots.slice(0, typed ? 2 : 4)) treeAt(px + x, pz + z, 0.42 + rand() * 0.14);
      else if (c.biome === 'swamp') {
        const w = new THREE.Group(); w.position.set(0, TILE_H, 0); g.add(w);
        water(w, typed ? 0.95 : 0.1, typed ? 0.25 : 0.05, typed ? 0.4 : 1.2, typed ? 0.5 : 0.8);
        for (const [x, z] of spots) for (let i = 0; i < 3; i++) box(g, 0.025, 0.22 + rand() * 0.14, 0.025, '#6E8B4A', x + i * 0.05, TILE_H, z + (i % 2) * 0.04);
      } else if (c.biome === 'wreck') {
        for (const [x, z] of spots.slice(0, typed ? 1 : 2)) {
          const k = new THREE.Group(); car(k, ['#9C5A48', '#6F7F8C', '#B9A465'][Math.floor(rand() * 3)]);
          k.position.set(x, TILE_H, z); k.rotation.set(0, rand() * 6.28, (rand() - 0.5) * 0.3); k.scale.setScalar(1.05);
          g.add(k);
        }
        for (const [x, z] of spots.slice(2, 4)) add(g, new THREE.DodecahedronGeometry(0.1, 0), '#33363A', x, TILE_H + 0.06, z);
      } else if (c.biome === 'river') {
        for (let i = 0; i < 3; i++) box(g, 0.5 + rand() * 0.4, 0.012, 0.05, '#BFE3F0', (rand() - 0.5) * 1.4, TILE_H, (i - 1) * 0.55 + (rand() - 0.5) * 0.2, { noShadow: true });
      } else if (c.biome === 'bridge') {
        for (let i = -3; i <= 3; i++) box(g, 0.28, 0.03, 2.1, '#A8875C', i * 0.36, TILE_H, 0, { noShadow: true });
        for (const s of [-1, 1]) box(g, 2.3, 0.18, 0.08, '#7E6141', 0, TILE_H, s * 1.0);
      }
    }
    // 장애물: 무너진 건물 잔해(벽 조각 · 돌무더기) — 지나갈 수만 있고 멈출 수 없는 칸
    function rubble(g) {
      for (let i = 0; i < 3; i++) box(g, 0.5 + rand() * 0.5, 0.3 + rand() * 0.5, 0.18, '#A49E93', (rand() - 0.5) * 1.2, OBST_H, (rand() - 0.5) * 1.0, { ry: rand() * 3 });
      for (let i = 0; i < 6; i++) add(g, new THREE.DodecahedronGeometry(0.12 + rand() * 0.12, 0), rand() > 0.5 ? '#8F8B85' : '#7C7870', (rand() - 0.5) * 1.6, OBST_H + 0.08, (rand() - 0.5) * 1.4);
    }

    for (const c of MAP.cells) {
      const { x: px, z: pz } = hexPos(c.q, c.r);
      const obst = c.terrain === 'obstacle';
      const info = TYPE_INFO[c.type] || TYPE_INFO.empty;
      if (c.zone) add(scene, plateG, ZONE_COLOR[c.zone], px, 0.025, pz, { noShadow: true });
      const g = new THREE.Group();
      g.position.set(px, 0, pz);
      const color = obst ? '#8F8A80' : c.type !== 'empty' ? info.tile : BIOME_TILE[c.biome] ?? info.tile;
      const tile = add(g, obst ? obstG : tileG, color, 0, 0, 0);
      tile.userData.cellId = c.id;
      tileMeshes.push(tile);
      const top = obst ? OBST_H : TILE_H;
      const ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
      ring.position.y = top + 0.014; ring.visible = false;
      g.add(ring);
      const glow = new THREE.Mesh(glowG, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }));
      glow.position.y = top + 0.006; glow.visible = false;
      ring.userData.glow = glow;
      g.add(glow);
      // 위험 구역(아직 안 열린 적 칸 주변) — 옅은 빨강 바닥(2026-10-03)
      const dangerMark = new THREE.Mesh(glowG, new THREE.MeshBasicMaterial({ color: col('#E0453A'), transparent: true, opacity: 0.1, depthWrite: false }));
      dangerMark.position.y = top + 0.004; dangerMark.visible = false;
      g.add(dangerMark);
      // 칸 종류 찾기(예: 부품 칸만) 강조 — 노란 테두리 + 옅은 바닥
      let typeMark = null;
      if (c.type !== 'empty') {
        typeMark = new THREE.Group();
        const tr = new THREE.Mesh(markRingG, new THREE.MeshBasicMaterial({ color: col('#FF9F1C'), transparent: true, opacity: 1, depthWrite: false }));
        tr.position.y = top + 0.02;
        const tf = new THREE.Mesh(glowG, new THREE.MeshBasicMaterial({ color: col('#FFD23F'), transparent: true, opacity: 0.55, depthWrite: false }));
        tf.position.y = top + 0.01;
        typeMark.add(tr, tf); typeMark.visible = false;
        g.add(typeMark);
      }

      // 칸 정보(아이콘 · 수량 · 마커 자리)는 두 벌: 작은 줄(가운데, 뒤쪽에 건물 모형) / 큰 줄(건물 없이 뒤쪽 절반에 크게).
      // 건물 보기를 켜고 끄면 두 벌을 바꿔 보여 준다(2026-10-03 사용자 결정 F — 아이콘을 크게, 건물은 아트 단계까지 꺼 둠)
      const markerPosBy = { small: null, big: null };
      const infoBy = { small: new THREE.Group(), big: new THREE.Group() };
      if (c.type !== 'empty') {
        const rows = { small: { k: 0.9, z: INFO_Z, icon: ICON_SIZE, amount: AMOUNT_W, marker: MARKER_W }, big: { k: 1, z: BIG_INFO_Z, icon: BIG_ICON, amount: BIG_AMOUNT, marker: MARKER_W } };
        // 큰 줄(기본): 아이콘은 칸 정중앙, 수량은 작게 오른쪽 아래, 마커 자리는 왼쪽 아래(2026-10-04 사용자 피드백)
        {
          const ig = infoBy.big;
          printDecal(ig, iconTexture(c.type, info.ink), BIG_ICON, BIG_ICON, 0, BIG_INFO_Z);
          if (c.amount) printDecal(ig, numberTexture(c.amount, info.ink), 0.62, 0.62 * 256 / 300, 0.82, 0.62);
          if (info.marker) markerPosBy.big = [-0.82, 0.62];
          g.add(ig);
        }
        for (const [mode, R] of Object.entries(rows)) {
          if (mode === 'big') continue;
          const parts = [{ w: R.icon, kind: 'icon' }];
          if (c.amount) parts.push({ w: R.amount, kind: 'amount' });
          if (info.marker) parts.push({ w: mode === 'big' ? 0.38 : R.marker, kind: 'marker' });
          let cx = -(parts.reduce((a, q) => a + q.w, 0) + INFO_GAP * (parts.length - 1)) / 2;
          const ig = infoBy[mode];
          for (const q of parts) {
            const x = cx + q.w / 2; cx += q.w + INFO_GAP;
            if (q.kind === 'icon') printDecal(ig, iconTexture(c.type, info.ink), R.icon * R.k, R.icon * R.k, x, R.z);
            if (q.kind === 'amount') printDecal(ig, numberTexture(c.amount, info.ink), R.amount * R.k, R.amount * R.k * 256 / 300, x, R.z + 0.02);
            if (q.kind === 'marker') {
              if (mode === 'small') {   // 큰 줄(기본)은 동그라미 없이 자리만(2026-10-04 — 표시가 없어도 마커는 놓을 수 있음)
                const slot = new THREE.Mesh(slotGeo, new THREE.MeshBasicMaterial({ color: col(info.ink), transparent: true, opacity: 0.55, depthWrite: false }));
                slot.position.set(x, TILE_H + 0.006, R.z);
                ig.add(slot);
              }
              markerPosBy[mode] = [x, R.z];
            }
          }
          g.add(ig);
        }
        const name = c.name_key?.startsWith('cell.') ? c.name_key.slice(5) : null;
        const lmFn = (name && LANDMARKS['c_' + name]) || LANDMARKS['_' + c.type];
        if (lmFn) {
          const lm = new THREE.Group();
          lm.position.set(0, TILE_H, -0.86); lm.scale.setScalar(0.7);
          lmFn(lm);
          infoBy.small.add(lm);
        }
      }
      infoBy.small.visible = buildingsOn; infoBy.big.visible = !buildingsOn;
      // 칸 위 장식(나무 · 갈대 · 폐차 · 물결)은 아트 단계까지 치움(2026-10-04 사용자 결정) — 다리 판자 · 장애물 잔해만 남김(이동 규칙과 관련).
      // 대신 험지는 칸 왼쪽에 작은 지형 아이콘
      if (obst) rubble(g);
      else if (c.biome === 'bridge') decorate(g, c, px, pz);
      else if (c.terrain === 'rough' && BIOME_GLYPH[c.biome]) {
        const s = c.type === 'empty' ? 1.1 : 0.55;
        const d = printDecal(g, glyphTexture(BIOME_GLYPH[c.biome]), s, s, c.type === 'empty' ? 0 : -0.95, c.type === 'empty' ? 0 : 0.62);
        d.position.y = top + 0.011;
      }
      if (c.secret) {
        const dirTxt = c.secret_dir === 'in' ? '⬇' : c.secret_dir === 'out' ? '⬆' : '↕';
        // 2D 빌보드(카메라를 향함) — 멀리 있는(위쪽) 칸에서 눕혀져 안 보이던 문제(2026-10-04). 칸 위쪽 고정 자리
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(`${c.secret}${dirTxt}`, '#F4EEDF', '#3B2F5C'), transparent: true, depthWrite: false }));
        sp.scale.set(0.95, 0.475, 1);
        sp.position.set(0, top + 0.35, -0.95);
        g.add(sp);
      }
      scene.add(g);
      cells.set(c.id, { data: c, pos: g.position, tile, ring, group: g, lift: 0, marker: null, infoBy, markerPosBy, typeMark, dangerMark,
        edgeSegs: DIRS.map(([dq, dr]) => ({ n: at.get(`${c.q + dq},${c.r + dr}`)?.id ?? null, seg: edgeOf(px, pz, dq, dr, HT - 0.05) })), top,
        get markerPos() { return markerPosBy[buildingsOn ? 'small' : 'big']; } });
      blocked.push({ x: px, z: pz, r: HR });

      // 테두리: 구역(색) · 험지(보라) — 이웃과 다를 때 그 변에
      for (const [dq, dr] of DIRS) {
        const n = at.get(`${c.q + dq},${c.r + dr}`);
        // 보스 구역 표시(2026-10-17 사용자 피드백 "노랑 · 파랑 · 빨강 구역이 뭘 기준으로 보는지 모르겠다 — 확실하게 구분되게"):
        // 예전엔 구역 경계를 타일 아래 바닥 높이에 얇게 그려 거의 안 보였고, 칸 종류 색(조사 파랑 · 금품 노랑 · 적 빨강)과도 헷갈렸다.
        // → 타일 윗면에 그린다: 구역 바깥 경계는 굵은 선, 구역 안 칸마다 얇은 안쪽 테두리(어느 칸이 어느 구역인지 칸마다 보이게)
        // 2026-10-18 사용자 피드백("칸 테두리 색은 좋은데, 같은 색 그룹 지역을 칠해 주는 부분이 너무 진하다 — 파랑 · 빨강 · 노랑은 그룹 테두리를 빼자"):
        // 구역 바깥 경계의 굵은 선(폭 0.2)은 지움. 칸마다 얇은 안쪽 테두리만 남긴다.
        if (c.zone && !obst) { const [a, b] = edgeOf(px, pz, dq, dr, HT - 0.3); strip(a, b, ZONE_STRONG[c.zone], TILE_H + 0.02, 0.07); }
        if (c.terrain === 'rough' && n?.terrain !== 'rough') { const [a, b] = edgeOf(px, pz, dq, dr, HT - 0.07); strip(a, b, '#8A4FC4', TILE_H + 0.016, 0.1); }
      }
    }

    // 비밀 통로: 입구 → 출구를 잇는 점선 아치 + 출구 쪽 화살촉(일방통행)
    const bySecret = {};
    for (const c of MAP.cells) if (c.secret) (bySecret[c.secret] ??= []).push(c);
    const dotG = new THREE.SphereGeometry(0.07, 8, 6);
    for (const [sid, list] of Object.entries(bySecret)) {
      const dotMat = new THREE.MeshBasicMaterial({ color: col('#4A3C72'), transparent: true, opacity: SECRET_DIM, depthWrite: false });
      secretMats.set(sid, dotMat);
      for (const a0 of list) for (const b0 of list) {
        if (a0 === b0) continue;
        const directed = a0.secret_dir || b0.secret_dir;
        if (directed ? !(a0.secret_dir === 'in' && b0.secret_dir === 'out') : a0.id > b0.id) continue;
        const A = hexPos(a0.q, a0.r), B = hexPos(b0.q, b0.r);
        const len = Math.hypot(B.x - A.x, B.z - A.z);
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(A.x, 0.5, A.z), new THREE.Vector3((A.x + B.x) / 2, 1.2 + len * 0.18, (A.z + B.z) / 2), new THREE.Vector3(B.x, 0.6, B.z));
        const n = Math.max(8, Math.round(len * 1.6));
        for (let i = 1; i < n - 1; i++) {
          const p = curve.getPoint(i / n);
          const m = new THREE.Mesh(dotG, dotMat);
          m.position.set(p.x, p.y, p.z);
          scene.add(m);
        }
        if (directed) {
          const p = curve.getPoint((n - 1) / n), q = curve.getPoint(1);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 10), dotMat);
          tip.position.set(p.x, p.y, p.z);
          scene.add(tip);
          tip.lookAt(q.x, q.y, q.z); tip.rotateX(Math.PI / 2);
        }
      }
    }
  }

  if (HEX) buildHexBoard();
  else for (const c of MAP.cells) {
    const info = TYPE_INFO[c.type] || TYPE_INFO.start;
    const px = gx(c.x), pz = gz(c.y);

    if (c.zone) add(scene, zoneGeo, ZONE_COLOR[c.zone], px, 0.03, pz, { noShadow: true });

    const g = new THREE.Group();
    g.position.set(px, 0, pz);
    const tile = add(g, tileGeo, info.tile, 0, 0, 0);
    tile.userData.cellId = c.id;
    tileMeshes.push(tile);

    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.position.y = TILE_H + 0.012; ring.visible = false;
    g.add(ring);
    // 강조 칸 윗면을 옅게 물들이는 판(테두리만으로는 잘 안 보여서)
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = TILE_H + 0.004; glow.visible = false;
    ring.userData.glow = glow;
    g.add(glow);

    // 가운데 줄: 아이콘 · 수량 · 마커 자리를 칸 바닥에 인쇄 (틀 없이, 줄 전체를 가운데 정렬)
    const parts = [{ w: ICON_SIZE, kind: 'icon' }];
    if (c.amount) parts.push({ w: AMOUNT_W, kind: 'amount' });
    if (info.marker) parts.push({ w: MARKER_W, kind: 'marker' });
    let cx = -(parts.reduce((a, q) => a + q.w, 0) + INFO_GAP * (parts.length - 1)) / 2;
    let markerPos = null;
    for (const q of parts) {
      const x = cx + q.w / 2; cx += q.w + INFO_GAP;
      if (q.kind === 'icon') printDecal(g, iconTexture(c.type, info.ink), ICON_SIZE, ICON_SIZE, x, INFO_Z);
      if (q.kind === 'amount') printDecal(g, numberTexture(c.amount, info.ink), AMOUNT_W, AMOUNT_W * 256 / 300, x, INFO_Z + 0.02);
      if (q.kind === 'marker') {
        const slot = new THREE.Mesh(slotGeo, new THREE.MeshBasicMaterial({ color: col(info.ink), transparent: true, opacity: 0.55, depthWrite: false }));
        slot.position.set(x, TILE_H + 0.006, INFO_Z);
        g.add(slot);
        markerPos = [x, INFO_Z];
      }
    }

    const lm = new THREE.Group();
    lm.position.set(0, TILE_H, LANDMARK_Z);
    (LANDMARKS[c.id] || LANDMARKS['_' + c.type] || (() => {}))(lm);
    g.add(lm);

    scene.add(g);
    cells.set(c.id, { data: c, pos: g.position, tile, ring, group: g, lift: 0, marker: null, markerPos });
    blocked.push({ type: 'rect', x0: px - HALF - 0.2, x1: px + HALF + 0.2, z0: pz - HALF - 0.2, z1: pz + HALF + 0.2 });
  }

  // 통로(도로) + 비용 점 (선 맵만)
  const edges = HEX ? [] : MAP.edges.map((e) => ({ a: e.a, b: e.b, cost: e.cost }));
  const adj = new Map();
  for (const c of MAP.cells) adj.set(c.id, []);
  for (const e of edges) {
    adj.get(e.a).push({ to: e.b, cost: e.cost });
    adj.get(e.b).push({ to: e.a, cost: e.cost });
    const A = cells.get(e.a).pos, B = cells.get(e.b).pos;
    const len = A.distanceTo(B), ang = Math.atan2(B.x - A.x, B.z - A.z);
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    add(scene, new THREE.BoxGeometry(0.62, 0.06, len), '#E3D4AE', mx, 0.04, mz, { ry: ang, noShadow: true });
    add(scene, new THREE.BoxGeometry(0.74, 0.04, len), '#BFAE86', mx, 0.03, mz, { ry: ang, noShadow: true });
    for (let k = 0; k < e.cost; k++) {
      const t = 0.5 + (k - (e.cost - 1) / 2) * (0.3 / len);
      cyl(scene, 0.09, 0.03, '#6F6552', A.x + (B.x - A.x) * t, 0.07, A.z + (B.z - A.z) * t, 12, { noShadow: true });
    }
    blocked.push({ type: 'seg', ax: A.x, az: A.z, bx: B.x, bz: B.z, r: 0.5 });
  }

  // 보드 안 빈틈 장식: 칸 사이 교차점에 덤불·꽃 조금 (가독성 해치지 않게)
  if (!HEX) for (let ix = 0; ix <= 7; ix++) for (let iz = 0; iz <= 5; iz++) {
    const x = (ix - 0.5) * S, z = (iz - 0.5) * S;
    if (x < GX0 + 0.4 || x > GX1 - 0.4 || z < GZ0 + 0.4 || z > GZ1 - 0.4) continue;
    for (let k = 0; k < 3; k++) {
      const bx = x + (rand() - 0.5) * 0.7, bz = z + (rand() - 0.5) * 0.7;
      if (isBlocked(bx, bz, 0.12)) continue;
      if (k === 0 && rand() > 0.35) pushMat(inst.bush, bx, 0, bz, 0.8 + rand() * 0.5, rand() * 6, rand() > 0.5 ? '#6FA34C' : '#7FB356');
      else pushMat(inst.flower, bx, 0, bz, 1, 0, ['#F2E6C9', '#F5C858', '#E98A8A'][Math.floor(rand() * 3)]);
    }
  }
  // 보드 가장자리 여백에 나무 조금
  for (let i = 0; i < (HEX ? 0 : 70); i++) {
    const x = GX0 + 0.4 + rand() * (BW - 0.8), z = GZ0 + 0.4 + rand() * (BD - 0.8);
    if (isBlocked(x, z, 0.45)) continue;
    (rand() > 0.35 ? pine : roundTree)(x, z, 0.8 + rand() * 0.35);
    blocked.push({ x, z, r: 0.4 });
  }

  // =====================================================================
  // 보드 바깥 세계: 강 · 다리 · 길 · 밭 · 빈집 · 전봇대 · 숲
  // =====================================================================
  blocked.push({ type: 'rect', x0: GX0 - 1.2, x1: GX1 + 1.2, z0: GZ0 - 1.2, z1: GZ1 + 1.2 });   // 보드 + 둘레길
  {
    // 강: 보드 아래쪽을 가로지르는 완만한 곡선
    const pts = [];
    for (let x = -70; x <= 100; x += 4) pts.push(new THREE.Vector3(x, 0, GZ1 + 9 + Math.sin(x * 0.06) * 3.5));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = a.distanceTo(b) + 0.4, ang = Math.atan2(b.x - a.x, b.z - a.z);
      add(scene, new THREE.BoxGeometry(5.2, 0.05, len), '#D8C08E', (a.x + b.x) / 2, 0.01, (a.z + b.z) / 2, { ry: ang, noShadow: true });
      add(scene, new THREE.BoxGeometry(4.0, 0.06, len), '#5BA6C4', (a.x + b.x) / 2, 0.02, (a.z + b.z) / 2, { ry: ang, noShadow: true });
      blocked.push({ type: 'seg', ax: a.x, az: a.z, bx: b.x, bz: b.z, r: 2.8 });
    }
    // 바깥 길: 보드 둘레길에서 좌·우·위로 뻗어 나감 (세계가 이어진다는 느낌)
    const roads = [
      [[GX0 - 0.9, BCZ], [-70, BCZ + 4]],
      [[GX1 + 0.9, BCZ - 2], [100, BCZ - 8]],
      [[BCX + 3, GZ0 - 0.9], [BCX + 10, -60]],
      [[BCX - 4, GZ1 + 0.9], [BCX - 6, GZ1 + 40]],     // 강을 건너는 길
    ];
    for (const [[ax, az], [bx, bz]] of roads) {
      const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az);
      add(scene, new THREE.BoxGeometry(1.4, 0.05, len), '#CDAF7E', (ax + bx) / 2, 0.02, (az + bz) / 2, { ry: ang, noShadow: true });
      blocked.push({ type: 'seg', ax, az, bx, bz, r: 1.3 });
      // 전봇대
      for (let t = 0.08; t < 1; t += 0.11) {
        const x = ax + (bx - ax) * t + Math.cos(ang) * 1.3, z = az + (bz - az) * t - Math.sin(ang) * 1.3;
        if (Math.abs(z - (GZ1 + 9 + Math.sin(x * 0.06) * 3.5)) < 3.4) continue;
        cyl(scene, 0.06, 2.2, '#8A6A48', x, 0, z, 6);
        box(scene, 0.7, 0.06, 0.06, '#8A6A48', x, 1.95, z, { ry: ang + Math.PI / 2 });
      }
    }
    // 다리 (강 건너는 길 위)
    {
      const bx = BCX - 4.6, bz = GZ1 + 9 + Math.sin(bx * 0.06) * 3.5;
      box(scene, 1.8, 0.18, 6.4, '#A88A66', bx, 0.18, bz);
      for (const s of [-1, 1]) box(scene, 0.1, 0.3, 6.4, '#8A6A48', bx + s * 0.85, 0.36, bz);
    }
    // 밭 (줄지어 심은 작물)
    const fields = [[-14, -10, 9, 6], [GX1 + 8, GZ1 - 2, 8, 6], [-12, GZ1 + 20, 10, 5]];
    for (const [fx, fz, fw, fd] of fields) {
      add(scene, new THREE.BoxGeometry(fw, 0.06, fd), '#B89363', fx, 0.02, fz, { noShadow: true });
      for (let r = 0; r < fd / 0.7 - 1; r++) for (let k = 0; k < fw / 0.45 - 1; k++) {
        pushMat(inst.bush, fx - fw / 2 + 0.45 + k * 0.45, 0, fz - fd / 2 + 0.55 + r * 0.7, 0.55, rand() * 6, rand() > 0.3 ? '#9CC86A' : '#B6D276');
      }
      blocked.push({ type: 'rect', x0: fx - fw / 2 - 0.5, x1: fx + fw / 2 + 0.5, z0: fz - fd / 2 - 0.5, z1: fz + fd / 2 + 0.5 });
    }
    // 빈집들 (보드 밖 마을이 계속된다는 단서)
    const houses = [[-8, 4], [-11, 9], [-6, 14], [GX1 + 6, 3], [GX1 + 9, 8], [GX1 + 5, 12], [BCX - 2, -8], [BCX + 8, -9], [BCX + 20, GZ1 + 22], [BCX - 20, GZ1 + 26]];
    for (const [hx, hz] of houses) {
      if (isBlocked(hx, hz, 1.2)) continue;
      const hg = new THREE.Group(); hg.position.set(hx, 0, hz); hg.rotation.y = (rand() - 0.5) * 0.5 + (rand() > 0.5 ? Math.PI / 2 : 0);
      house(hg, 0, 0, 1.8 + rand() * 0.6, 1.4, 1.0 + rand() * 0.4, ['#E6D8B8', '#D9C7A5', '#C9D3D6'][Math.floor(rand() * 3)], ['#5F86A8', '#B0573F', '#6E8F5A'][Math.floor(rand() * 3)]);
      scene.add(hg);
      blocked.push({ x: hx, z: hz, r: 1.6 });
    }
    // 숲 (보드에서 멀어질수록 빽빽하게)
    let n = 0, tries = 0;
    while (n < 1100 && tries++ < 9000) {
      const x = -70 + rand() * 170, z = -60 + rand() * 130;
      const dx = Math.max(GX0 - x, 0, x - GX1), dz = Math.max(GZ0 - z, 0, z - GZ1);
      const d = Math.hypot(dx, dz);
      if (d < 1.4) continue;
      if (rand() > Math.min(1, 0.25 + d * 0.06)) continue;     // 보드 근처는 듬성듬성
      if (isBlocked(x, z, 0.45)) continue;
      (rand() > 0.3 ? pine : roundTree)(x, z, 0.9 + rand() * 0.6);
      n++;
    }
    for (let i = 0; i < 220; i++) {
      const x = -50 + rand() * 130, z = -40 + rand() * 100;
      if (isBlocked(x, z, 0.3)) continue;
      pushMat(inst.rock, x, 0.08, z, 0.5 + rand() * 1.0, rand() * 6, rand() > 0.5 ? '#A8A69E' : '#8F8D86', 0.65);
    }
    for (let i = 0; i < 1400; i++) {
      const x = GX0 - 25 + rand() * (BW + 50), z = GZ0 - 20 + rand() * (BD + 40);
      if (isBlocked(x, z, 0.05)) continue;
      pushMat(inst.tuft, x, 0, z, 0.8 + rand() * 0.8, rand() * 6, rand() > 0.5 ? '#9CC468' : '#6FA34C');
    }
  }
  // 버려진 차 몇 대 (보드 바깥 길 위)
  for (const [x, z, ry, c] of [[GX0 - 4, BCZ + 1.2, 1.4, '#B95B4B'], [GX1 + 5, BCZ - 3.4, 1.9, '#5F7F9C'], [BCX + 5, GZ0 - 6, 0.3, '#C9B26A']]) {
    const g = new THREE.Group(); car(g, c); g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(1.4); scene.add(g);
  }
  flushInstances();

  // 건물 보기 켜고 끄기(칸 정보 두 벌을 바꿔 보여 줌). 마커 위치는 view.js가 다시 놓는다
  function setBuildings(on) {
    buildingsOn = !!on;
    try { localStorage.setItem('eb.buildings', buildingsOn ? '1' : '0'); } catch { /* 무시 */ }
    for (const c of cells.values()) if (c.infoBy && !c.inactive) { c.infoBy.small.visible = buildingsOn; c.infoBy.big.visible = !buildingsOn; }
  }
  // 인원수별 칸(min_players): 이번 판에 안 쓰는 칸은 아이콘 · 건물을 숨기고 빈 길 색으로
  function setInactive(ids) {
    for (const id of ids) {
      const c = cells.get(id);
      if (!c) continue;
      c.inactive = true;
      if (c.infoBy) { c.infoBy.small.visible = false; c.infoBy.big.visible = false; }
      if (c.typeMark) c.typeMark.visible = false;
      if (c.data.terrain !== 'obstacle') c.tile.material = mat(BIOME_TILE[c.data.biome] ?? TYPE_INFO.empty.tile);
    }
  }
  // 사거리 · 위협 범위 겹쳐 그리기(2026-10-08 사용자 "추천으로" — docs/range-display.md): 층(layer)마다 칸 바닥 칠 + 바깥 경계 점선.
  //   layers: [{ ids: 칸 id 목록, color, fill(0~1, 바닥 칠 투명도), edge(true면 영역 바깥 경계 점선) }]. 빈 배열이면 지움.
  //   바닥 칠은 모양(채움), 경계는 점선으로 — 색만으로 구분하지 않게(색맹 대비). 육각 맵 전용(edgeSegs가 있는 칸만 경계를 그린다).
  let rangeGroup = null;
  function setRangeOverlay(layers = []) {
    if (rangeGroup) { scene.remove(rangeGroup); rangeGroup.traverse((o) => { if (o.userData.own) o.geometry?.dispose(); }); rangeGroup = null; }
    if (!layers.length) return;
    rangeGroup = new THREE.Group();
    layers.forEach((L, li) => {
      const set = new Set(L.ids);
      const fillM = new THREE.MeshBasicMaterial({ color: col(L.color), transparent: true, opacity: L.fill ?? 0.2, depthWrite: false });
      const edgeM = new THREE.MeshBasicMaterial({ color: col(L.color), transparent: true, opacity: 0.95, depthWrite: false });
      for (const id of set) {
        const c = cells.get(id);
        if (!c) continue;
        if ((L.fill ?? 0.2) > 0 && c.ring?.userData.glow) {
          const f = new THREE.Mesh(c.ring.userData.glow.geometry, fillM);
          f.position.set(c.pos.x, c.top + 0.016 + li * 0.003, c.pos.z);
          rangeGroup.add(f);
        }
        if (L.edge) {
          for (const { n, seg: [a, b] } of c.edgeSegs ?? []) {
            if (n && set.has(n)) continue;
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const s = new THREE.Mesh(new THREE.BoxGeometry(len * 0.62, 0.02, 0.12), edgeM);   // 가운데만 그려 점선처럼
            s.userData.own = true;
            s.position.set((a[0] + b[0]) / 2, c.top + 0.04 + li * 0.003, (a[1] + b[1]) / 2); s.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
            rangeGroup.add(s);
          }
        }
      }
    });
    scene.add(rangeGroup);
  }
  // 칸 종류 찾기: types에 든 종류의 칸만 노랗게
  function markTypes(types) {
    // 'zone:blue' 처럼 쓰면 그 색 보스 구역 칸도 강조(2026-10-07 오늘 12 — "노랑 구역이 어디인지 모르겠다")
    for (const c of cells.values()) if (c.typeMark) c.typeMark.visible = !c.inactive && (types.has(c.data.type) || (!!c.data.zone && types.has(`zone:${c.data.zone}`)));
  }
  // 위험 구역: 아직 안 열린 적 칸들(hiddenIds)의 주변 radius칸을 옅은 빨강으로(맵 enemy_cells.reveal = danger_zone일 때만)
  const dangerSet = new Set();
  let dangerEdges = null;
  function setDanger(hiddenIds) {
    dangerSet.clear();
    if (MAP.enemy_cells?.reveal === 'danger_zone') {
      const r = MAP.enemy_cells.radius ?? 2;
      const hd = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
      const src = hiddenIds.map((id) => cells.get(id)?.data).filter(Boolean);
      for (const c of cells.values()) if (src.some((h) => hd(h, c.data) <= r)) dangerSet.add(c.data.id);
    }
    for (const c of cells.values()) if (c.dangerMark) c.dangerMark.visible = false;   // 바닥 칠은 끔(판이 너무 붉어짐) — 경계선만
    // 구역 바깥 경계에 가는 빨간 선
    if (dangerEdges) { scene.remove(dangerEdges); dangerEdges.traverse((o) => o.geometry?.dispose()); }
    dangerEdges = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: col('#D93A2F'), transparent: true, opacity: 0.8, depthWrite: false });
    for (const id of dangerSet) {
      const c = cells.get(id);
      for (const { n, seg: [a, b] } of c.edgeSegs ?? []) {
        if (n && dangerSet.has(n)) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const s = new THREE.Mesh(new THREE.BoxGeometry(len * 0.82, 0.02, 0.1), m);   // 모서리를 조금 비워 점선처럼
        s.position.set((a[0] + b[0]) / 2, c.top + 0.03, (a[1] + b[1]) / 2); s.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
        dangerEdges.add(s);
      }
    }
    scene.add(dangerEdges);
  }
  // 중앙 보상 지역(2026-10-04): 등급 경계에 금색 선 — 중간(1)은 옅게, 중앙(2)은 진하게. tierOf(cellId) → 0 · 1 · 2
  let tierEdges = null;
  function setTiers(tierOf) {
    if (tierEdges) { scene.remove(tierEdges); tierEdges.traverse((o) => o.geometry?.dispose()); }
    tierEdges = new THREE.Group();
    // 구역 경계(실선)와 구분되게 흰 금색 점선
    const mats = { 1: new THREE.MeshBasicMaterial({ color: col('#FFF3C4'), transparent: true, opacity: 0.55, depthWrite: false }),
      2: new THREE.MeshBasicMaterial({ color: col('#FFFFFF'), transparent: true, opacity: 0.95, depthWrite: false }) };
    for (const c of cells.values()) {
      const tr = tierOf(c.data.id);
      if (!tr) continue;
      for (const { n, seg: [a, b] } of c.edgeSegs ?? []) {
        if (n && tierOf(n) >= tr) continue;   // 같은 등급 이상끼리는 선 없음(바깥쪽 경계만)
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ang = -Math.atan2(b[1] - a[1], b[0] - a[0]);
        for (const f of [0.22, 0.5, 0.78]) {   // 점선 3토막
          const s = new THREE.Mesh(new THREE.BoxGeometry(len * 0.16, 0.025, tr === 2 ? 0.16 : 0.1), mats[tr]);
          s.position.set(a[0] + (b[0] - a[0]) * f, c.top + 0.05, a[1] + (b[1] - a[1]) * f); s.rotation.y = ang;
          tierEdges.add(s);
        }
      }
    }
    scene.add(tierEdges);
  }
  // 비밀 통로: 이 번호의 점선만 진하게(null이면 모두 흐리게)
  function focusSecret(sid) {
    for (const [k, m] of secretMats) m.opacity = sid != null && k === String(sid) ? 1 : SECRET_DIM;
  }

  return {
    THREE, S, TILE, TILE_H, HALF, TYPE_INFO, ZONE_COLOR, PAWN_SLOTS, ENEMY_SLOT, INFO_Z, single: !!MAP.one_per_cell,
    setBuildings, markTypes, setRangeOverlay, focusSecret, setDanger, setInactive, setTiers, isDanger: (id) => dangerSet.has(id), map: MAP, get buildingsOn() { return buildingsOn; }, hex: HEX,
    renderer, scene, camera, canvas, sun, cells, tileMeshes, flames,
    GX0, GX1, GZ0, GZ1, BW, BD, BCX, BCZ, FOG,
    col, mat, add, box, cyl, cone, slabGeo, outlineGeo, iconTexture, numberTexture, rand,
  };
}
