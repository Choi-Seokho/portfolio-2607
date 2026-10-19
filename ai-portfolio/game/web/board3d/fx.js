// 연출 도구: 트윈(시간에 따라 값 바꾸기) · 들어 올려 이동 · 찌그러짐 · 흔들림 · 떠오르는 글자
// 뼈대 애니메이션 없이 코드 트윈으로만 처리한다(art-direction 6장 "말 이동").

export function createFx(W) {
  const { THREE } = W;
  const tweens = [];
  let speed = 1;

  function tween(dur, fn) {
    return new Promise((res) => {
      if (dur <= 0) { fn(1); res(); return; }
      tweens.push({ t: 0, dur, fn, res });
    });
  }
  function step(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const w = tweens[i];
      w.t += dt * speed;
      const u = Math.min(1, w.t / w.dur);
      w.fn(u);
      if (u >= 1) { tweens.splice(i, 1); w.res(); }
    }
  }
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  const wait = (sec) => tween(sec, () => {});

  // 톡 들어 올려 곡선으로 이동
  function hop(obj, to, dur = 0.32, height = 0.5) {
    const from = obj.position.clone();
    const targetYaw = Math.atan2(to.x - from.x, to.z - from.z);
    const moving = from.distanceTo(to) > 0.05;
    return tween(dur, (u) => {
      const e = ease(u);
      obj.position.lerpVectors(from, to, e);
      obj.position.y = from.y + (to.y - from.y) * e + Math.sin(u * Math.PI) * height;
      if (moving) {
        let d = targetYaw - obj.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        obj.rotation.y += d * 0.2;
      }
      obj.rotation.z = Math.sin(u * Math.PI) * 0.08;
      if (u >= 1) obj.rotation.z = 0;
    });
  }
  // 착지 찌그러짐
  function squash(obj, dur = 0.13) {
    return tween(dur, (u) => {
      const s = 1 - 0.2 * Math.sin(u * Math.PI);
      obj.scale.set(1 + (1 - s) * 0.6, s, 1 + (1 - s) * 0.6);
      if (u >= 1) obj.scale.set(1, 1, 1);
    });
  }
  // 미끄러지듯 자리 옮기기(같은 칸 안 재배치)
  function slide(obj, to, dur = 0.2) {
    const from = obj.position.clone();
    return tween(dur, (u) => obj.position.lerpVectors(from, to, ease(u)));
  }
  // 공격: 대상 쪽으로 찌르고 돌아옴
  function lunge(obj, toward, dur = 0.34) {
    const from = obj.position.clone();
    const dir = new THREE.Vector3().subVectors(toward, from); dir.y = 0;
    const len = dir.length();
    if (len > 0.001) {
      dir.normalize();
      obj.rotation.y = Math.atan2(dir.x, dir.z);
    }
    const reach = Math.min(0.45, len * 0.4);
    return tween(dur, (u) => {
      const k = u < 0.4 ? ease(u / 0.4) : 1 - ease((u - 0.4) / 0.6);
      obj.position.set(from.x + dir.x * reach * k, from.y + Math.sin(k * Math.PI / 2) * 0.12, from.z + dir.z * reach * k);
    });
  }
  // 피격: 좌우로 흔들림
  function shake(obj, dur = 0.3, amp = 0.09) {
    const from = obj.position.clone();
    return tween(dur, (u) => {
      obj.position.x = from.x + Math.sin(u * Math.PI * 7) * amp * (1 - u);
      if (u >= 1) obj.position.copy(from);
    });
  }
  // 쓰러짐(탈진) / 일어남
  function tipOver(obj, down = true, dur = 0.35) {
    const fig = obj.userData.fig ?? obj;
    const a0 = fig.rotation.z, a1 = down ? Math.PI / 2 * 0.92 : 0;
    const y0 = fig.position.y, y1 = down ? 0.12 : 0.085;
    return tween(dur, (u) => { const e = ease(u); fig.rotation.z = a0 + (a1 - a0) * e; fig.position.y = y0 + (y1 - y0) * e; });
  }
  // 작아지며 사라짐(처치)
  function vanish(obj, dur = 0.4) {
    const s0 = obj.scale.x;
    return tween(dur, (u) => {
      const s = s0 * (1 - ease(u));
      obj.scale.set(s, s, s);
      obj.rotation.y += 0.25;
      if (u >= 1) obj.parent?.remove(obj);
    });
  }
  // 땅에서 솟아오름(적 출현)
  function rise(obj, dur = 0.45) {
    const y = obj.position.y;
    obj.scale.set(0.01, 0.01, 0.01);
    return tween(dur, (u) => {
      const e = ease(u);
      const s = e * (1 + Math.sin(u * Math.PI) * 0.15);
      obj.scale.set(s, s, s);
      obj.position.y = y - 0.3 * (1 - e);
    });
  }
  // 하늘에서 떨어짐(배치 · 보스 등장)
  function drop(obj, height = 3, dur = 0.4) {
    const y = obj.position.y;
    obj.position.y = y + height;
    return tween(dur, (u) => { obj.position.y = y + height * (1 - u * u); }).then(() => squash(obj, 0.12));
  }

  // 글자 스프라이트(캔버스). 항상 카메라를 바라본다.
  const spriteCache = new Map();
  function textTexture(text, color, size = 64) {
    const key = `${text}|${color}|${size}`;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    const font = `800 ${size}px "Pretendard","Noto Sans KR","Malgun Gothic",sans-serif`;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + size * 0.6;
    cv.width = w; cv.height = size * 1.5;
    g.font = font;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = size * 0.16; g.strokeStyle = 'rgba(30,24,40,0.85)'; g.lineJoin = 'round';
    g.strokeText(text, w / 2, cv.height / 2);
    g.fillStyle = color; g.fillText(text, w / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    const out = { tex, aspect: w / cv.height };
    spriteCache.set(key, out);
    return out;
  }
  // height는 월드 단위가 아니라 화면 높이 비율(줌과 상관없이 같은 크기로 읽히게). 0.4 ≈ 화면 높이의 3%
  function textSprite(text, color = '#ffffff', height = 0.42) {
    const { tex, aspect } = textTexture(text, color);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    const h = height * 0.075;
    sp.scale.set(h * aspect, h, 1);
    sp.renderOrder = 10;
    return sp;
  }
  // 위로 떠오르며 사라지는 글자
  // base: 글자가 처음 뜨는 높이(말 머리 위). 큰 피규어는 더 높게(view.js say)
  function floatText(pos, text, color = '#ffffff', { height = 0.42, rise = 0.9, dur = 0.9, hold = false, base = 0.9 } = {}) {
    const sp = textSprite(text, color, height);
    sp.position.set(pos.x, pos.y + base, pos.z);
    W.scene.add(sp);
    const y0 = sp.position.y;
    const p = tween(dur, (u) => {
      sp.position.y = y0 + rise * ease(Math.min(1, u * 1.4)) * (W.camDist ? W.camDist / 40 : 1);
      sp.material.opacity = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      if (u >= 1) W.scene.remove(sp);
    });
    return hold ? p : Promise.resolve();
  }
  // 퍼지는 고리(소음 · 폭발)
  function ripple(pos, color = '#ffffff', { radius = 3, dur = 0.7, y = 0.3 } = {}) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, y, pos.z);
    W.scene.add(m);
    return tween(dur, (u) => {
      const s = 0.3 + radius * ease(u);
      m.scale.set(s, s, s);
      m.material.opacity = 1 - u;
      if (u >= 1) { W.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    });
  }
  function flash(pos, color = '#FFC45A', { radius = 2.2, dur = 0.5 } = {}) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, depthWrite: false }));
    m.position.set(pos.x, 0.5, pos.z);
    W.scene.add(m);
    return tween(dur, (u) => {
      const s = 0.2 + radius * ease(u);
      m.scale.set(s, s * 0.7, s);
      m.material.opacity = 0.85 * (1 - u);
      if (u >= 1) { W.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    });
  }

  return {
    tween, step, wait, ease, hop, squash, slide, lunge, shake, tipOver, vanish, rise, drop,
    textSprite, textTexture, floatText, ripple, flash,
    get speed() { return speed; }, set speed(v) { speed = v; },
    get busy() { return tweens.length > 0; },
  };
}
