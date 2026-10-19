// 카메라(회전 없음: 줌 + 보드 범위 안 이동) · 마우스 입력 · 후처리(보드 바깥만 틸트시프트 + 색보정) · 렌더 루프
// demo3d(아트 방향 v0.2)의 카메라 · 후처리 코드를 모듈로 옮기고, 클릭 · 호버를 콜백으로 바꿨다.

export function createStage(W, { onClick, onHover, pickables, rightInset = 0 }) {
  const { THREE, renderer, scene, camera, canvas, GX0, GX1, GZ0, GZ1, BCX, BCZ, BW } = W;

  // ---------- 카메라 ----------
  const EL = 54 * Math.PI / 180;
  // 큰 맵(육각 2배)은 처음에 조금 더 멀리서, 최대로 멀어지는 거리도 맵 폭에 맞춘다
  const cam = { x: BCX, z: BCZ + 0.6, d: Math.min(Math.max(50, BW * 1.0), 110), minD: 14, maxD: Math.max(78, BW * 1.6) };
  let camTarget = null;   // 연출 중 부드럽게 옮길 목표
  function updateCamera() {
    if (camTarget) {
      cam.x += (camTarget.x - cam.x) * 0.08;
      cam.z += (camTarget.z - cam.z) * 0.08;
      if (camTarget.d) cam.d += (camTarget.d - cam.d) * 0.08;
      // 위치뿐 아니라 거리(확대)까지 다 맞춰졌을 때 멈춘다(예전엔 위치만 봐서 확대가 중간에 멈춤 — 2026-10-04 "카메라가 엉뚱한 데")
      if (Math.abs(camTarget.x - cam.x) < 0.02 && Math.abs(camTarget.z - cam.z) < 0.02 && (!camTarget.d || Math.abs(camTarget.d - cam.d) < 0.05)) camTarget = null;
    }
    cam.x = Math.max(GX0, Math.min(GX1, cam.x)); cam.z = Math.max(GZ0, Math.min(GZ1, cam.z));
    camera.position.set(cam.x, Math.sin(EL) * cam.d, cam.z + Math.cos(EL) * cam.d);
    camera.lookAt(cam.x, 0, cam.z);
    scene.fog.near = cam.d * 1.05; scene.fog.far = cam.d * 2.4;
    W.camDist = cam.d;
  }
  function focus(x, z, d) { camTarget = { x, z: z + 0.6, d }; }
  // 보드 전체가 화면에 들어오는 거리(기본 배율, 2026-10-04 사용자 피드백). 위 상태 줄 · 아래 손패 여백을 남김
  const BD = GZ1 - GZ0;
  const corners = [[GX0, GZ0], [GX1, GZ0], [GX0, GZ1], [GX1, GZ1]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  // 보드가 들어가야 할 화면 범위(NDC, -1~1). 2026-10-18 사용자 피드백(스크린샷 "기본 뷰를 이 정도로 — UI에 가려 보드가 안 보이는 구간이 생긴다"):
  // 예전엔 좌우 0.97 · 위 0.78 · 아래 -0.72까지 꽉 채워서 왼쪽 아래 캐릭터 보드 · 미션 띠, 오른쪽 위 보급품 · 순위 판, 아래 손패 밑으로 가장자리 칸이 들어갔다.
  // 사용자가 맞춘 시점(2000×998 기준 칸 중심이 가로 357~1640 · 세로 165~690)에 맞춰 좌우 · 아래를 줄이고 보드를 위로 올림
  const FIT = { x: 0.72, top: 0.73, bottom: -0.57 };
  function fits(d, zOff) {
    const c = camera.clone();
    c.position.set(BCX, Math.sin(EL) * d, BCZ + zOff + Math.cos(EL) * d);
    c.lookAt(BCX, 0, BCZ + zOff);
    c.updateMatrixWorld(); c.updateProjectionMatrix();
    return corners.every((p) => { const v = p.clone().project(c); return Math.abs(v.x) <= FIT.x && v.y <= FIT.top && v.y >= FIT.bottom; });
  }
  let homeScale = 1;   // 전체 시점을 얼마나 더 멀리서(테스트 맵처럼 작은 맵은 가장자리 칸이 화면 위 · 옆 도구에 가려서 1.3, 2026-10-17)
  const fitD = (zOff) => {
    let lo = cam.minD, hi = 220;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid, zOff)) hi = mid; else lo = mid; }
    return hi;
  };
  function homeView() {
    // 보드를 위아래 어디에 둘지(zOff)도 찾는다: 위아래 범위가 비대칭(아래 손패 쪽이 큼)이라 가장 크게 보이는 자리로.
    // 예전엔 zOff = 보드 깊이의 6%로 고정
    // 좌우가 먼저 꽉 차서 거리가 같은 자리가 여럿이면 그 가운데(위아래 여백이 고르게)
    const tries = [];
    for (let k = -10; k <= 30; k++) tries.push({ z: BD * k * 0.01, d: fitD(BD * k * 0.01) });
    const d = Math.min(...tries.map((t) => t.d));
    const best = tries.filter((t) => t.d <= d * 1.002);
    const zOff = best[Math.floor(best.length / 2)].z;
    return { x: BCX, z: BCZ + zOff, d: Math.min(d, 220) * homeScale };
  }
  function home(instant = false) {
    const h = homeView();
    cam.maxD = Math.max(cam.maxD, h.d * 1.15);
    if (instant) { cam.x = h.x; cam.z = h.z; cam.d = h.d; camTarget = null; } else camTarget = { x: h.x, z: h.z, d: h.d };
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camTarget = null;
    cam.d = Math.max(cam.minD, Math.min(cam.maxD, cam.d * Math.exp(e.deltaY * 0.0011)));
  }, { passive: false });

  // ---------- 마우스 ----------
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2(-9, -9);
  let down = null;
  let hoverId;
  const setMouse = (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const DRAG_SPEED = 0.0017 * 0.8;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    setMouse(e);
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      down.moved += Math.abs(dx) + Math.abs(dy);
      if (down.moved > 6) camTarget = null;
      const k = cam.d * DRAG_SPEED;
      cam.x -= dx * k; cam.z -= dy * k / Math.sin(EL);
      down.x = e.clientX; down.y = e.clientY;
    }
  });
  canvas.addEventListener('pointerleave', () => mouse.set(-9, -9));
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = down && down.moved < 6;
    down = null;
    if (!wasClick) return;
    setMouse(e);
    ray.setFromCamera(mouse, camera);
    // 클릭은 타일 기준(2026-10-17 사용자 피드백 "겹쳐 있는 곳에서 타일이 잘 안 눌린다 — UI를 눌러 행동이 취소되는 느낌"):
    // 예전엔 피규어(머리 위 이름표 · 체력바 포함)를 먼저 찾아서, 옆 칸 피규어의 이름표가 가리고 있으면 엉뚱한 칸이 눌렸다.
    // 이제 마우스 아래 타일을 먼저 정하고(마우스를 올렸을 때 강조되는 칸과 같음), 그 타일에 피규어가 있으면 그 피규어를 누른 것으로 본다.
    // 타일 밖(보드 가장자리 위로 솟은 피규어 몸통 등)을 누른 경우에만 피규어 몸통으로 찾는다(이름표 · 체력바 같은 글자 스프라이트는 제외).
    const tileHit = ray.intersectObjects(W.tileMeshes, false)[0];
    if (tileHit) {
      const cellId = tileHit.object.userData.cellId;
      return onClick?.({ cellId, pieceId: pickables.pieceAt?.(cellId) ?? null });
    }
    const pieceHit = ray.intersectObjects(pickables.pieces(), true).find((h) => !h.object.isSprite);
    if (pieceHit) {
      let o = pieceHit.object;
      while (o && !o.userData.pieceId) o = o.parent;
      if (o) onClick?.({ pieceId: o.userData.pieceId, cellId: pickables.pieceCell?.(o.userData.pieceId) ?? o.userData.cellId });
    }
  });
  function updateHover() {
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(W.tileMeshes, false);
    const id = hits.length ? hits[0].object.userData.cellId : null;
    if (id === hoverId) return;
    hoverId = id;
    onHover?.(id);
  }

  // ---------- 후처리: 보드 바깥만 흐리게 + 비네트 + 색보정 ----------
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const maskMat = new THREE.ShaderMaterial({
    uniforms: { r0: { value: new THREE.Vector2(GX0, GZ0) }, r1: { value: new THREE.Vector2(GX1, GZ1) } },
    vertexShader: `
      varying vec3 vW;
      void main(){
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        vec4 w = modelMatrix * p; vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec2 r0, r1; varying vec3 vW;
      void main(){
        vec2 q = max(max(r0 - vW.xz, vW.xz - r1), 0.0);
        float d = length(q);
        gl_FragColor = vec4(vec3(smoothstep(0.6, 7.0, d)), 1.0);
      }`,
  });
  const BLUR_FS = `
    uniform sampler2D tex, mask; uniform vec2 dir, res; uniform float strength; varying vec2 vUv;
    vec4 blur(){
      float m = texture2D(mask, vUv).r * strength;
      if (m < 0.01) return texture2D(tex, vUv);
      vec2 st = dir * m * 1.9 / res;
      vec4 c = texture2D(tex, vUv) * 0.1596;
      c += (texture2D(tex, vUv + st) + texture2D(tex, vUv - st)) * 0.1473;
      c += (texture2D(tex, vUv + st * 2.0) + texture2D(tex, vUv - st * 2.0)) * 0.1159;
      c += (texture2D(tex, vUv + st * 3.0) + texture2D(tex, vUv - st * 3.0)) * 0.0776;
      c += (texture2D(tex, vUv + st * 4.0) + texture2D(tex, vUv - st * 4.0)) * 0.0443;
      c += (texture2D(tex, vUv + st * 5.0) + texture2D(tex, vUv - st * 5.0)) * 0.0215;
      return c / 0.9728;
    }`;
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, mask: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, res: { value: new THREE.Vector2(1, 1) }, strength: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: BLUR_FS + 'void main(){ gl_FragColor = blur(); }',
    depthTest: false, depthWrite: false,
  });
  const finalMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, mask: { value: null }, dir: { value: new THREE.Vector2(0, 1) }, res: { value: new THREE.Vector2(1, 1) }, strength: { value: 1 }, grade: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: BLUR_FS + `
      uniform float grade;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec3 col = blur().rgb;
        if (grade > 0.5) {
          float m = texture2D(mask, vUv).r;
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, 1.1 - m * 0.25);
          col *= 1.0 - m * 0.06;
          col = mix(col, col * vec3(1.05, 1.0, 0.93), 0.6);
          col += (hash(vUv * res) - 0.5) * 0.02;
          float v = smoothstep(0.95, 0.35, distance(vUv, vec2(0.5)));
          col *= mix(0.84, 1.0, v);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat);
  const quadScene = new THREE.Scene(); quadScene.add(quad);

  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
  let rtA, rtB, rtMask;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    canvas.style.width = '100vw'; canvas.style.height = '100vh';
    camera.aspect = innerWidth / innerHeight;
    // 오른쪽 패널에 가리지 않도록 화면 중심을 왼쪽으로 옮긴다(보이는 영역의 가운데에 보드가 오게)
    const shift = Math.floor(rightInset * dpr);
    if (shift > 0) camera.setViewOffset(w + shift, h, shift, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (rtA) { rtA.dispose(); rtB.dispose(); rtMask.dispose(); }
    rtA = new THREE.WebGLRenderTarget(w, h, Object.assign({ samples: 4 }, rtOpts));
    rtB = new THREE.WebGLRenderTarget(w, h, rtOpts);
    rtMask = new THREE.WebGLRenderTarget(w >> 1, h >> 1, rtOpts);
    blurMat.uniforms.res.value.set(w, h); finalMat.uniforms.res.value.set(w, h);
  }
  addEventListener('resize', resize);
  resize();

  let tilt = 1, grade = 1;
  const white = new THREE.Color(1, 1, 1);
  const clock = new THREE.Clock();
  let shadowDirty = 2;

  function renderFrame() {
    renderer.shadowMap.needsUpdate = shadowDirty > 0 || true;
    renderer.setRenderTarget(rtA); renderer.render(scene, camera);
    if (tilt || grade) {
      const bg = scene.background, fog = scene.fog;
      scene.overrideMaterial = maskMat; scene.background = white; scene.fog = null;
      renderer.setRenderTarget(rtMask); renderer.render(scene, camera);
      scene.overrideMaterial = null; scene.background = bg; scene.fog = fog;
    }
    quad.material = blurMat;
    blurMat.uniforms.tex.value = rtA.texture; blurMat.uniforms.mask.value = rtMask.texture; blurMat.uniforms.strength.value = tilt;
    renderer.setRenderTarget(rtB); renderer.render(quadScene, quadCam);
    quad.material = finalMat;
    finalMat.uniforms.tex.value = rtB.texture; finalMat.uniforms.mask.value = rtMask.texture;
    finalMat.uniforms.strength.value = tilt; finalMat.uniforms.grade.value = grade;
    renderer.setRenderTarget(null); renderer.render(quadScene, quadCam);
  }

  function start(update) {
    function frame() {
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      update(dt, t);
      for (const f of W.flames) f.scale.set(1, 0.85 + Math.sin(t * 13 + f.id) * 0.15, 1);
      updateCamera();
      updateHover();
      renderFrame();
      requestAnimationFrame(frame);
    }
    frame();
  }

  return {
    start, focus, cam, home, homeView, setHomeScale: (k) => { homeScale = k; },
    get tilt() { return tilt; }, set tilt(v) { tilt = v ? 1 : 0; },
    get grade() { return grade; }, set grade(v) { grade = v ? 1 : 0; },
  };
}
