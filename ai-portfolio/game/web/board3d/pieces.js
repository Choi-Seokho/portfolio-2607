// 말 모형: 캐릭터 피규어 · 좀비 · 보스 · 감춰진 적 토큰 · 상호작용 마커 · 체력 표시
// 캐릭터 · 좀비 모양은 demo3d(아트 방향 v0.2)에서 가져왔다. 적은 종류마다 실루엣과 소품으로 구분한다.

// 팀 색(플레이어 판 · 말 발판 · 칩). 캐릭터 고유 색(data/characters.json color)과 겹치지 않게 빨강 · 파랑 · 초록 · 노랑 (F2c)
export const PLAYER_COLORS = { P1: '#D9534F', P2: '#3B7DD8', P3: '#3FA46A', P4: '#E3B23C' };

export const ARROW_Y = 1.3;   // 선택 · 행동 가능 표시 화살표의 기본 높이(피규어 안쪽 좌표)

export function createPieces(W) {
  const { THREE, add, box, cyl, cone, col, iconTexture, TILE_H } = W;
  const BASE_GEO = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.29, 0), new THREE.Vector2(0.3, 0.02), new THREE.Vector2(0.3, 0.06), new THREE.Vector2(0.27, 0.085), new THREE.Vector2(0, 0.085)], 28);
  const lighten = (hex, k) => { const c = col(hex); c.lerp(col('#ffffff'), k); return '#' + c.getHexString(); };
  const darken = (hex, k) => { const c = col(hex); c.lerp(col('#000000'), k); return '#' + c.getHexString(); };

  // 발판 강조(2026-10-18 사용자 요청 "내 차례에 내 캐릭터 피규어도 강조 — 선택됨 · 선택 안 됨을 상태에 맞춰, 발판 하이라이트 정도"):
  //   sel   = 고른 캐릭터: 굵은 금색 고리 + 금색 빛 번짐(halo), 깜빡임
  //   ready = 아직 행동할 수 있는 내 캐릭터(안 고름): 얇은 흰 고리 + 옅은 흰 빛, 천천히 숨쉬기
  //   발판 자체도 같은 색으로 은은하게 빛남(view.js setSelected가 base 재질 emissive를 바꿈)
  //   예전엔 고른 캐릭터만 얇은 흰 고리(0.34~0.42)라 밝은 칸 위에서 거의 안 보였다
  const haloTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 18, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  })();
  function selectionParts(g) {
    const flat = (m, y) => { m.rotation.x = -Math.PI / 2; m.position.y = y; m.visible = false; m.renderOrder = 2; g.add(m); return m; };
    const sel = flat(new THREE.Mesh(new THREE.RingGeometry(0.31, 0.47, 40), new THREE.MeshBasicMaterial({ color: col('#FFD23F'), transparent: true, side: THREE.DoubleSide, depthWrite: false })), 0.012);
    const ready = flat(new THREE.Mesh(new THREE.RingGeometry(0.31, 0.41, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false })), 0.011);
    const halo = flat(new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), new THREE.MeshBasicMaterial({ map: haloTex, color: col('#FFD23F'), transparent: true, depthWrite: false })), 0.006);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 4), new THREE.MeshBasicMaterial({ color: col('#FFFFFF') }));
    arrow.rotation.x = Math.PI; arrow.position.y = ARROW_Y; arrow.visible = false; g.add(arrow);   // 이름표(view.js nameTag) 위로 비키려고 1.05 → 1.3(2026-10-07)
    return { sel, ready, halo, arrow };
  }

  // 캐릭터 피규어: 발판 = 팀 색, 몸통(옷) = 캐릭터 고유 색, 소품으로도 캐릭터 구분
  function figure(charId, hex, bodyHex = null) {
    const g = new THREE.Group();
    // 발판 재질은 피규어마다 따로(2026-10-18 발판 강조 — 같은 팀 색 재질을 공유하면 한 피규어만 빛나게 할 수 없음)
    const base = add(g, BASE_GEO, new THREE.MeshLambertMaterial({ color: col(hex) }), 0, 0, 0);
    const fig = new THREE.Group(); fig.position.y = 0.085; g.add(fig);
    const cloth = bodyHex ? lighten(bodyHex, 0.1) : lighten(hex, 0.25);
    add(fig, new THREE.CapsuleGeometry(0.075, 0.14, 4, 10), '#4E4A44', -0.06, 0.14, 0);
    add(fig, new THREE.CapsuleGeometry(0.075, 0.14, 4, 10), '#4E4A44', 0.06, 0.14, 0);
    add(fig, new THREE.CapsuleGeometry(0.13, 0.16, 4, 12), cloth, 0, 0.4, 0);
    add(fig, new THREE.SphereGeometry(0.11, 16, 12), '#E9C39C', 0, 0.64, 0);
    const acc = {
      c_fighter()  { box(fig, 0.05, 0.4, 0.05, '#8A6A48', 0.18, 0.18, 0.05, { rz: -0.3 }); },
      c_hunter()   { box(fig, 0.04, 0.04, 0.46, '#4E4A44', 0.15, 0.42, 0.02, { rx: 0.4 }); cone(fig, 0.14, 0.08, '#6E6A40', 0, 0.72, 0, 10); },
      c_assassin() { cone(fig, 0.14, 0.24, '#3E3A44', 0, 0.62, -0.01, 10); },
      c_savior()   { box(fig, 0.2, 0.2, 0.06, '#F4F4F0', 0, 0.36, -0.13); box(fig, 0.12, 0.04, 0.07, '#D9483B', 0, 0.44, -0.13); },
      c_oracle()   { cyl(fig, 0.18, 0.02, '#5A4E7A', 0, 0.7, 0, 16); cone(fig, 0.1, 0.16, '#5A4E7A', 0, 0.71, 0, 12); },
      c_porter()   { box(fig, 0.3, 0.36, 0.18, '#8A6A48', 0, 0.28, -0.16); box(fig, 0.2, 0.12, 0.16, '#6B5A48', 0, 0.64, -0.16); },
      c_guardian() { box(fig, 0.05, 0.34, 0.26, '#A8B0B5', 0.18, 0.22, 0.04); },
      c_tracker()  { add(fig, new THREE.SphereGeometry(0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#6E8F5A', 0, 0.65, 0); box(fig, 0.14, 0.02, 0.1, '#6E8F5A', 0, 0.66, 0.1); },
      c_broker()   { box(fig, 0.2, 0.14, 0.05, '#6B4A38', 0.2, 0.12, 0); },
      // 2026-10-08 신규 직업 3종(수정 사항 오늘 13): 간단한 소품으로 구분
      c_raider()      { box(fig, 0.04, 0.34, 0.04, '#6B4A38', 0.19, 0.2, 0.05, { rz: -0.3 }); box(fig, 0.16, 0.1, 0.03, '#9AA0A6', 0.23, 0.38, 0.05, { rz: -0.3 }); },   // 손도끼
      c_dismantler()  { box(fig, 0.04, 0.38, 0.04, '#6E7378', 0.19, 0.18, 0.05, { rz: -0.2 }); box(fig, 0.12, 0.04, 0.04, '#6E7378', 0.17, 0.38, 0.05); cyl(fig, 0.13, 0.05, '#F2C14E', 0, 0.72, 0, 14); },   // 쇠지렛대 + 안전모
      c_ninja()       { box(fig, 0.3, 0.05, 0.22, '#C0392B', 0, 0.66, 0.02); box(fig, 0.05, 0.16, 0.03, '#C0392B', -0.14, 0.58, -0.1); },   // 두건 + 늘어진 매듭
    };
    (acc[charId] || (() => {}))();
    g.userData = { fig, base, ...selectionParts(g) };
    return g;
  }

  // 좀비: 회녹색 피부 · 일상복 · 앞으로 뻗은 팔. 종류는 실루엣과 소품으로 구분.
  const ENEMY_LOOK = {
    walker:  { shirt: '#7A8A6A' },
    runner:  { shirt: '#6F8CB0', lean: 0.45, slim: 0.85 },
    spitter: { shirt: '#8F8BA8', sac: true },
    bomber:  { shirt: '#B07A6A', belly: true },
    crawler: { shirt: '#C9B58A', crawl: true },
    charger: { shirt: '#6F9C9A', bulk: 1.25 },
  };
  function zombie(type, { boss = false, base = '#5E6266' } = {}) {
    const look = ENEMY_LOOK[type] ?? ENEMY_LOOK[type?.replace('boss_temp_', '')] ?? ENEMY_LOOK.walker;
    const g = new THREE.Group();
    add(g, BASE_GEO, base, 0, 0, 0);
    const fig = new THREE.Group(); fig.position.y = 0.085; g.add(fig);
    const slim = look.slim ?? 1, bulk = look.bulk ?? 1;
    if (!look.crawl) {
      add(fig, new THREE.CapsuleGeometry(0.075 * slim, 0.14, 4, 10), '#4A4E52', -0.06, 0.14, 0);
      add(fig, new THREE.CapsuleGeometry(0.075 * slim, 0.14, 4, 10), '#4A4E52', 0.06, 0.14, 0);
    }
    const upper = new THREE.Group();
    upper.position.y = look.crawl ? 0.06 : 0.3;
    upper.rotation.x = look.crawl ? 1.2 : (look.lean ?? 0.22);
    fig.add(upper);
    add(upper, new THREE.CapsuleGeometry(0.13 * slim * bulk, 0.16 * bulk, 4, 12), look.shirt, 0, 0.1, 0);
    if (look.belly) add(upper, new THREE.SphereGeometry(0.15, 14, 10), '#8FA08A', 0, 0.05, 0.08);
    const headY = 0.35 * (look.bulk ?? 1);
    add(upper, new THREE.SphereGeometry(look.sac ? 0.13 : 0.11, 16, 12), '#9AAE8E', 0.02, headY, 0.03);
    if (look.sac) add(upper, new THREE.SphereGeometry(0.08, 12, 8), '#B7C86A', 0, headY - 0.14, 0.12);
    box(upper, 0.07, 0.025, 0.02, '#B8443A', 0.02, headY - 0.05, 0.13);
    for (const x of [-0.15, 0.15]) add(upper, new THREE.CapsuleGeometry(0.035, 0.2, 3, 8), '#9AAE8E', x * bulk, 0.2, 0.15, { rx: Math.PI / 2 - 0.15 });
    if (boss) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        cone(upper, 0.03, 0.12, '#E8973A', Math.cos(a) * 0.09, headY + 0.08, 0.03 + Math.sin(a) * 0.09, 5);
      }
      g.scale.setScalar(1.45);
    }
    g.userData = { fig, upper, phase: Math.random() * 6.28, ...selectionParts(g) };
    return g;
  }

  // 감춰진 적: 뒤집힌 원판(해골 인쇄) — 들어서면 뒤집혀 적이 나온다
  const hiddenTex = iconTexture('enemy', '#E8D6CC');
  function hiddenToken() {
    const g = new THREE.Group();
    add(g, new THREE.CylinderGeometry(0.3, 0.32, 0.1, 24), '#6A4A44', 0, 0.05, 0);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshLambertMaterial({ map: hiddenTex, transparent: true, depthWrite: false }));
    face.rotation.x = -Math.PI / 2; face.position.y = 0.102; g.add(face);
    return g;
  }

  const MARKER_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20);
  const checkTex = iconTexture('check', '#fff');
  function marker() {
    const g = new THREE.Group();
    add(g, MARKER_GEO, '#3A3F47', 0, 0.04, 0);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: checkTex, transparent: true, depthWrite: false }));
    face.rotation.x = -Math.PI / 2; face.position.y = 0.082; g.add(face);
    return g;
  }

  // 머리 위 체력 막대(적 · 보스). 캔버스를 다시 그려 갱신한다.
  function hpBar(width = 0.62) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 24;
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    const w = width * 0.075;                       // 화면 높이 비율(줌과 상관없이 읽히게)
    sp.scale.set(w, w * 24 / 128, 1);
    sp.renderOrder = 9;
    sp.userData.draw = (hp, max) => {
      const g = cv.getContext('2d');
      g.clearRect(0, 0, 128, 24);
      g.fillStyle = 'rgba(30,24,40,0.75)'; g.fillRect(0, 0, 128, 24);
      const segs = Math.max(1, max);
      const gap = segs > 12 ? 0 : 2;
      const w = (124 - gap * (segs - 1)) / segs;
      for (let i = 0; i < segs; i++) {
        g.fillStyle = i < hp ? '#E0574A' : 'rgba(255,255,255,0.18)';
        g.fillRect(2 + i * (w + gap), 4, w, 16);
      }
      tex.needsUpdate = true;
    };
    return sp;
  }

  return { figure, zombie, hiddenToken, marker, hpBar, lighten, darken, TILE_H };
}
