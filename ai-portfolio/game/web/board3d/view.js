// 3D 보드 뷰: 엔진 상태를 3D로 보여 주고(sync), 엔진 사건(events)을 연출로 재생한다(play).
// 뷰는 규칙을 판정하지 않는다. 연출이 끝나면 항상 엔진의 최종 상태로 다시 맞춘다(sync) — 엔진이 진실.

import { createFx } from './fx.js';
import { createPieces, PLAYER_COLORS, ARROW_Y } from './pieces.js';
import { cellUsesOf } from '../../engine/index.js';
import { playTokens, playCardShow, TOKEN_NAME } from '../ui/tokenfx.js';
import { renderCard, cardView } from '../ui/cards.js';

const STATUS_LABEL = { ignore_zone_attacks: '엄폐', pass_through_enemies: '통과', untargetable: '연막', taunt: '도발', defense_up: '철벽', marked: '표식',
  stunned: '기절', rooted: '속박', poison: '독' };   // 기절 · 속박 · 독: 무기 특수 효과(2026-10-17, engine/weapons.js)
// 적 머리 위 상태 표시(이름표 위 한 줄): 기절 · 속박 · 독 n
const foeStatusText = (f) => (f.statuses ?? []).map((x) => (x.status === 'poison' ? `독 ${x.turns}` : STATUS_LABEL[x.status])).filter(Boolean).join(' · ');
const ZONE_BASE = { blue: '#4F6F8C', yellow: '#9C8436', red: '#8C4E3E' };

// onEvent(e): 사건마다 화면(HUD) 연출을 같이 재생할 때(F2e). 끝날 때까지 기다린 뒤 3D 연출로 넘어간다.
export function createBoardView(W, { content, names, onBanner, onToast, onEvent, tokenInteractive, humanOwns }) {
  const { THREE, cells, TILE_H, PAWN_SLOTS, INFO_Z } = W;
  const fx = createFx(W);
  const P = createPieces(W);
  const pieces = new Map();     // id → { id, kind: 'char'|'foe'|'boss', mesh, cell, owner, order, exhausted, hp, maxHp, bar }
  const hidden = new Map();     // cellId → 감춰진 적 토큰
  const markers = new Map();    // cellId → 상호작용 마커
  let highlight = new Map();    // cellId → 색
  let selectedId = null;
  let lastAttack = null;        // 주사위 · 피해 글자를 띄울 위치를 정하려고 기억

  // ---------- 칸 안 자리 ----------
  // 앞줄 4자리(PAWN_SLOTS): 캐릭터는 왼쪽부터, 적은 오른쪽부터. 넘치면 한 줄 뒤(둘째 줄)에.
  // 한 칸에 하나 규칙(육각 마을, 2026-10-03): 서 있는 피규어 하나를 칸 앞쪽 가운데에 크게, 쓰러진 피규어는 옆에 눕힘.
  const ONE = !!W.single;
  const KC = ONE ? 2.2 : 1, KF = ONE ? 2.1 : 1;     // 피규어 크기(캐릭터 · 적) — 2026-10-04: 발판이 칸 폭의 약 50%
  const ONE_SLOTS = [[0, 0.12], [-0.85, 0.65], [0.85, 0.65], [0, 1.0], [-0.5, 1.0], [0.5, 1.0]];   // 2026-10-04: 서 있는 피규어는 칸 중앙(아이콘은 마우스를 올리면 보임)
  const ROW2_Z = 0.34;
  function slotXZ(index) {
    if (ONE) return ONE_SLOTS[index] ?? [0, 0.5];
    const [sx, sz] = PAWN_SLOTS[index % 4];
    return index < 4 ? [sx, sz] : [sx, ROW2_Z];
  }
  function layoutOf(cellId) {
    const here = [...pieces.values()].filter((p) => p.cell === cellId);
    if (ONE) {   // 서 있는 피규어가 가운데(0번), 쓰러진 피규어는 옆자리
      const order = [...here].sort((a, b) => (a.exhausted ? 1 : 0) - (b.exhausted ? 1 : 0) || a.order - b.order);
      return new Map(order.map((p, i) => [p.id, i]));
    }
    const chars = here.filter((p) => p.kind === 'char').sort((a, b) => a.order - b.order);
    const foes = here.filter((p) => p.kind !== 'char').sort((a, b) => a.order - b.order);
    const taken = new Set();
    const out = new Map();
    for (const p of chars) { let i = 0; while (taken.has(i)) i++; taken.add(i); out.set(p.id, i); }
    const foeOrder = [3, 2, 1, 0, 7, 6, 5, 4, 8, 9, 10, 11];
    for (const p of foes) { const i = foeOrder.find((k) => !taken.has(k)) ?? taken.size; taken.add(i); out.set(p.id, i); }
    return out;
  }
  function slotWorld(cellId, index) {
    const c = cells.get(cellId).pos;
    const [x, z] = slotXZ(index);
    const extra = index >= 8 ? (index - 7) * 0.15 : 0;
    return new THREE.Vector3(c.x + x + extra, TILE_H, c.z + z);
  }
  function posOf(p) { return slotWorld(p.cell, layoutOf(p.cell).get(p.id) ?? 0); }
  function cellCenter(cellId) { const c = cells.get(cellId).pos; return new THREE.Vector3(c.x, TILE_H, c.z + 0.4); }
  async function relayout(cellIds, animate = true) {
    const jobs = [];
    for (const id of new Set(cellIds)) {
      if (!id || !cells.has(id)) continue;
      for (const p of pieces.values()) {
        if (p.cell !== id || p.busy) continue;
        const to = posOf(p);
        if (animate && p.mesh.position.distanceTo(to) > 0.02) jobs.push(fx.slide(p.mesh, to, 0.18));
        else p.mesh.position.copy(to);
      }
    }
    await Promise.all(jobs);
  }

  // ---------- 말 만들기 · 지우기 ----------
  function tagPick(mesh, id) { mesh.traverse((o) => { o.userData.pieceId ??= undefined; }); mesh.userData.pieceId = id; }
  // 바깥 그룹으로 감싸 안쪽 모형만 키운다(착지 · 등장 연출은 바깥 그룹의 크기를 1로 되돌리므로)
  function sized(inner, k) {
    if (k === 1) return inner;
    const outer = new THREE.Group();
    inner.scale.setScalar(k);
    outer.add(inner);
    outer.userData = { ...inner.userData };
    return outer;
  }
  // 머리 위 이름표(2026-10-07 사용자 피드백 오늘 1): 적 = 체력바 위에 이름, 아군 = 피규어 위에 직업.
  // 화면 비율 크기 스프라이트라 줌과 상관없이 읽히고, center로 기준점을 옮겨 "그 위"(화면 기준)에 놓는다.
  // 2026-10-18 사용자 피드백("보스 이름 폰트가 너무 크다 — 다른 적과 같은 크기 · 빨간색으로, 이름은 전반적으로 50% 줄여도 될 듯"):
  // 기본 크기 0.26 → 0.13. 보스는 피규어 묶음을 1.45배로 키워서(sync의 scale) 붙은 이름표도 1.45배였다 → 보스 이름표는 그만큼 줄여 같은 크기로
  const NAME_SIZE = 0.13, BOSS_SCALE = 1.45;
  function nameTag(text, color, y, up = -0.62, size = NAME_SIZE) {
    const sp = fx.textSprite(text, color, size);
    sp.position.y = y;
    sp.center.set(0.5, up);
    sp.renderOrder = 11;
    return sp;
  }
  function addChar(ch) {
    const mesh = sized(P.figure(ch.char, PLAYER_COLORS[ch.owner] ?? '#999999', content.chars[ch.char]?.color), KC);
    mesh.add(nameTag(names.charName(ch.char), '#FFFFFF', 0.9 * KC, -0.2));   // 머리 꼭대기 ≈ 0.835 × 크기
    tagPick(mesh, ch.id);
    W.scene.add(mesh);
    const p = { id: ch.id, kind: 'char', mesh, cell: ch.cell, owner: ch.owner, order: ch.order ?? 0, exhausted: false };
    pieces.set(ch.id, p);
    return p;
  }
  function addFoe(f, isBoss) {
    const def = content.enemies[f.type];
    const mesh = sized(P.zombie(f.type, isBoss ? { boss: true, base: ZONE_BASE[zoneOfBoss(f.type)] ?? '#6A4E6A' } : {}), KF);
    tagPick(mesh, f.uid);
    const bar = P.hpBar((isBoss ? 0.8 : 0.6) * (ONE ? 0.65 : 1));   // 2026-10-04: 피규어 · 칸을 가려서 절반 정도로
    bar.position.y = (isBoss ? 0.95 : 1.02) * KF;
    mesh.add(bar);
    const tag = nameTag(names.foeName(f), isBoss ? '#FF4F42' : '#FFD9CF', bar.position.y);   // 체력바 위에 이름(오늘 1). 보스는 빨강(2026-10-18, 예전 주황 #FFC98A)
    if (isBoss) tag.scale.multiplyScalar(1 / BOSS_SCALE);
    mesh.add(tag);
    W.scene.add(mesh);
    const p = { id: f.uid, kind: isBoss ? 'boss' : 'foe', mesh, cell: f.cell, order: f.seq ?? 0, hp: f.hp, maxHp: f.max_hp ?? def.hp, bar };
    bar.userData.draw(p.hp, p.maxHp);
    mesh.rotation.y = -0.4 + Math.random() * 0.8;
    pieces.set(f.uid, p);
    return p;
  }
  function zoneOfBoss(type) {
    const map = W.bossZones ?? {};
    return Object.entries(map).find(([, t]) => t === type)?.[0];
  }
  function removePiece(id) {
    const p = pieces.get(id);
    if (!p) return;
    W.scene.remove(p.mesh);
    pieces.delete(id);
  }
  function setPose(p, exhausted) {
    const fig = p.mesh.userData.fig;
    if (!fig) return;
    fig.rotation.z = exhausted ? Math.PI / 2 * 0.92 : 0;
    fig.position.y = exhausted ? 0.12 : 0.085;
    p.exhausted = exhausted;
  }

  // 감춰진 적 토큰 · 마커
  function markerSpot(cellId) {
    const c = cells.get(cellId);
    return c.markerPos ?? [0.78, INFO_Z];
  }
  function addMarker(cellId) {
    const c = cells.get(cellId);
    const m = P.marker();
    const [x, z] = markerSpot(cellId);
    m.position.set(x, TILE_H, z);
    c.group.add(m);
    markers.set(cellId, m);
    return m;
  }
  function removeMarker(cellId) { const m = markers.get(cellId); if (m) { m.parent.remove(m); markers.delete(cellId); } }
  // 건물 보기를 바꾸면 마커 자리가 달라진다(작은 줄 ↔ 큰 줄)
  function placeMarkers() { for (const [id, m] of markers) { const [x, z] = markerSpot(id); m.position.set(x, TILE_H, z); } }
  function addHidden(cellId) {
    const c = cells.get(cellId);
    const t = P.hiddenToken();
    const [x, z] = slotXZ(3);
    t.position.set(x, TILE_H, z);
    c.group.add(t);
    hidden.set(cellId, t);
  }
  function removeHidden(cellId) { const t = hidden.get(cellId); if (t) { t.parent.remove(t); hidden.delete(cellId); } }

  // ---------- 이동 미리 보기(활성화 방식: 확정 전에 피규어만 옮겨 봄) ----------
  const previewed = new Set();
  async function previewMove(id, cell, { instant = false } = {}) {
    const p = pieces.get(id);
    if (!p || !cell) return;
    const from = p.cell;
    p.cell = cell;
    previewed.add(id);
    if (instant) { p.mesh.position.copy(posOf(p)); await relayout([from, cell]); return; }
    await fx.hop(p.mesh, posOf(p), 0.22, 0.6);
    await relayout([from, cell]);
  }
  function previewClear(id) { previewed.delete(id); }

  // ---------- 상태 맞추기(연출 없이) ----------
  function sync(s) {
    const alive = new Set();
    for (const ch of Object.values(s.chars)) {
      if (ch.cell == null) continue;
      alive.add(ch.id);
      const p = pieces.get(ch.id) ?? addChar(ch);
      p.cell = ch.cell; p.order = ch.order ?? 0;
      if (p.exhausted !== ch.exhausted) setPose(p, ch.exhausted);
      p.mesh.visible = true;
      p.mesh.scale.set(1, 1, 1);
    }
    for (const [group, isBoss] of [[s.enemies, false], [s.bosses, true]]) {
      for (const f of Object.values(group)) {
        alive.add(f.uid);
        const p = pieces.get(f.uid) ?? addFoe(f, isBoss);
        p.cell = f.cell; p.order = f.seq ?? 0;
        if (p.hp !== f.hp || p.maxHp !== f.max_hp) { p.hp = f.hp; p.maxHp = f.max_hp ?? p.maxHp; p.bar.userData.draw(p.hp, p.maxHp); }
        p.mesh.scale.setScalar(isBoss ? BOSS_SCALE : 1);
        // 상태 표시(기절 · 속박 · 독, 2026-10-17): 바뀔 때만 글자 스프라이트를 다시 만든다
        const st = foeStatusText(f);
        if (st !== (p.statusText ?? '')) {
          if (p.statusTag) p.mesh.remove(p.statusTag);
          p.statusTag = st ? nameTag(st, '#C9B8FF', p.bar.position.y, -2.3, NAME_SIZE * 0.8) : null;   // 이름보다 작게, 이름 위에(2026-10-18 이름과 같이 줄임, 예전 0.2)
          if (p.statusTag && isBoss) p.statusTag.scale.multiplyScalar(1 / BOSS_SCALE);
          if (p.statusTag) p.mesh.add(p.statusTag);
          p.statusText = st;
        }
      }
    }
    for (const id of [...pieces.keys()]) if (!alive.has(id)) removePiece(id);
    // 마커
    // 마커는 칸을 다 썼을 때만(칸 사용 횟수 cell_uses — 인원수별, 2026-10-03)
    const used = {};
    for (const id of s.board.markers) used[id] = (used[id] ?? 0) + 1;
    const want = new Set(Object.keys(used).filter((id) => used[id] >= cellUsesOf(W.map, s.game.turn_order.length, cells.get(id)?.data)));
    for (const id of [...markers.keys()]) if (!want.has(id)) removeMarker(id);
    for (const id of want) if (!markers.has(id) && cells.has(id)) addMarker(id);
    // 감춰진 적: 적 칸 · 마커 없음 · 적 없음
    const foeCells = new Set([...Object.values(s.enemies), ...Object.values(s.bosses)].map((f) => f.cell));
    for (const [id, c] of cells) {
      const isHidden = c.data.type === 'enemy' && !c.inactive && !want.has(id) && !foeCells.has(id);
      if (isHidden && !hidden.has(id)) addHidden(id);
      if (!isHidden && hidden.has(id)) removeHidden(id);
    }
    W.setDanger?.([...hidden.keys()]);   // 위험 구역 표시(danger_zone 맵)
    for (const p of pieces.values()) { p.busy = false; p.mesh.position.copy(posOf(p)); }
    setSelected(selectedId);
  }

  // ---------- 사건 연출 ----------
  // 글자는 그 말의 머리 위에 — 키운 피규어(한 칸에 하나 맵)는 그만큼 높게. 낮으면 앞 칸 말에 겹쳐 남의 글자처럼 보였다(2026-10-03 테스터: "구원자에게 반격!")
  // 2026-10-07 사용자 피드백(오늘 3): 머리 위 대미지 · 빗나감 등의 글자가 너무 큼 → 모든 떠오르는 글자를 SAY_SCALE배로(호출부의 height 값은 그대로 두고 여기서 일괄 조정)
  const SAY_SCALE = 0.7;
  const say = (p, text, color, opts) => p && fx.floatText(p.mesh.position, text, color, { base: 0.9 * (p.kind === 'char' ? KC : KF), ...opts, height: (opts?.height ?? 0.42) * SAY_SCALE });
  // 카드 사용: 말 위 이름 + 화면 가운데에 카드(남의 카드는 길게, 내 카드는 짧게 — 2026-10-04 사용자 피드백)
  async function showEventCard(id, charId, after, what) {
    if (!id || !content.cards[id]) return;
    const ch = after?.chars?.[charId];
    await playCardShow(fx, { cardEl: renderCard(cardView(content, names, id), { size: 'lg' }), caption: `${what} ${ch ? `${names.charName(ch.char)}(${ch.owner})가 뽑음` : ''}`, hold: 1.6 });
  }
  async function showUsedCard(id, charId, after, what) {
    if (!id || !content.cards[id]) return;
    const ch = after?.chars?.[charId];
    say(pieces.get(charId), names.cardName(id), '#FFF3B0', { height: 0.32 });
    const who = ch ? `${names.charName(ch.char)}(${ch.owner})` : '';
    const mine = ch && humanOwns?.(ch.owner);
    await playCardShow(fx, { cardEl: renderCard(cardView(content, names, id), { size: 'lg' }), caption: `${who} · ${what}`, hold: mine ? 0.8 : 1.8 });
  }
  const H = {
    async moved(e, after) {
      const p = pieces.get(e.character);
      if (!p) return;
      // 미리 보기로 이미 옮겨 둔 칸으로 확정 이동이면 다시 걷지 않음(활성화 방식, 2026-10-04)
      if (previewed.has(e.character) && p.cell === e.path[e.path.length - 1]) { previewed.delete(e.character); return; }
      previewed.delete(e.character);
      const from = p.cell;
      p.busy = true;
      const route = e.path.slice(1);
      for (let i = 0; i < route.length; i++) {
        const last = i === route.length - 1;
        if (last) p.cell = route[i];
        const to = last ? posOf(p) : cellCenter(route[i]);
        await fx.hop(p.mesh, to, 0.3, 0.5);
        await fx.squash(p.mesh, 0.1);
      }
      p.busy = false;
      await relayout([from, p.cell]);
    },
    async enemy_moved(e) {
      const p = pieces.get(e.enemy);
      if (!p) return;
      const from = p.cell;
      p.busy = true;
      const route = e.path.slice(1);
      for (let i = 0; i < route.length; i++) {
        const last = i === route.length - 1;
        if (last) p.cell = route[i];
        const to = last ? posOf(p) : cellCenter(route[i]);
        await fx.hop(p.mesh, to, 0.34, 0.25);
      }
      p.busy = false;
      if (e.reason === 'noise') say(p, '소음 반응', '#C9D6FF', { height: 0.3 });
      await relayout([from, p.cell]);
    },
    async enemy_revealed(e, after) { await H.enemy_spawned(e, after, true); },
    async enemy_spawned(e, after, fromHidden = false) {
      const t = hidden.get(e.cell);
      if (t) await fx.tween(0.18, (u) => { t.rotation.x = Math.PI * u; t.scale.setScalar(1 - u); }).then(() => removeHidden(e.cell));
      const f = after.enemies[e.enemy];
      if (!f) return;
      const p = pieces.get(e.enemy) ?? addFoe({ ...f, cell: e.cell }, false);
      p.cell = e.cell;
      p.mesh.position.copy(posOf(p));
      await relayout([e.cell]);
      p.mesh.position.copy(posOf(p));
      await fx.rise(p.mesh, 0.25);
      // 예전에는 여기서 이름을 한 번 더 띄웠는데(say), 적마다 체력바 위 이름표(nameTag)가 늘 붙어 있어서 이름이 두 번 보여 지움
      // (2026-10-17 사용자 피드백 "적 배치할 때 이름이 떠 있는데 이름 플로팅까지 나와서 두 번 보임")
      await fx.wait(0.1);   // 등장 연출은 빠르게(2026-10-03 사용자)
    },
    async boss_spawned(e, after) {
      const f = after.bosses[e.boss];
      if (!f) return;
      const p = pieces.get(e.boss) ?? addFoe(f, true);
      p.cell = e.cell;
      await relayout([e.cell]);
      p.mesh.position.copy(posOf(p));
      await fx.drop(p.mesh, 5, 0.5);
      fx.ripple(p.mesh.position, '#FFD24A', { radius: 2.4 });
      onBanner?.(`보스 등장: ${names.foeName(f)}`);
      await fx.wait(0.3);
    },
    async marker_placed(e) {
      if (markers.has(e.cell) || !cells.has(e.cell)) return;
      const m = addMarker(e.cell);
      const y = m.position.y;
      m.position.y = y + 1.4;
      await fx.tween(0.3, (u) => { m.position.y = y + 1.4 * (1 - u * u); });
      await fx.squash(m, 0.1);
    },
    async placed(e, after) {
      const ch = after.chars[e.character];
      const p = pieces.get(e.character) ?? addChar({ ...ch, cell: e.cell });
      p.cell = e.cell;
      await relayout([e.cell]);
      p.mesh.position.copy(posOf(p));
      await fx.drop(p.mesh, 2.5, 0.35);
    },
    async attack_declared(e) { await attackAnim(e.attacker, e.target); },
    async zone_attack(e) { await attackAnim(e.enemy, e.target, '교전'); },
    async enemy_attack(e) { await attackAnim(e.enemy, e.target); },
    // 주머니 토큰(2026-10-04 수정 사항 25): 화면 가운데에서 토큰이 뒤집히는 연출(말 위 숫자는 없앰 — 사용자 피드백)
    // 위 줄 = 무슨 판정인지, 뒤집은 뒤 = 계산식. 사람이 낀 판정이면 눌러서 뒤집고 확인(tokenInteractive)
    async dice_rolled(e, after) {
      if (e.purpose === 'target_tiebreak') return;
      const ownerId = e.purpose === 'counter_check' ? e.character : e.attacker ?? lastAttack?.attacker;
      const nameOf = (id) => {
        const ch = after?.chars?.[id];
        const foe = after?.enemies?.[id] ?? after?.bosses?.[id];
        return ch ? names.charName(ch.char) : foe ? names.foeName(foe) : id === 'explosion' ? '폭발' : '';
      };
      const owner = nameOf(ownerId);
      const tgt = nameOf(e.target ?? lastAttack?.target);
      const pouch = e.pouch ? names.t(`pouch.${e.pouch}.name`, '') : '';
      const f = e.face;
      const tv = { '+2': 2, '+1': 1, '0': 0, '-1': -1, '-2': -2 }[f];
      let title;
      let result = '';
      if (e.purpose === 'counter_check') {
        const need = (e.need ?? []).map((x) => TOKEN_NAME[x]).join(' · ');
        const ok = (e.need ?? []).includes(f);
        title = `🛡 ${owner} 반격 판정 — ${need}이면 ${tgt}에게 고정 피해 ${e.damage ?? 2}`;
        result = ok ? `<b class="good">반격 성공!</b>` : `<b class="bad">반격 실패</b>`;
      } else {
        title = `⚔ 공격 판정 — ${owner} → ${tgt}${e.reroll ? ' · 💀 빗나가서 추적 표식으로 다시 꺼냄' : e.faces?.length > 1 ? ` · ${e.faces.length}개 꺼내 좋은 쪽` : ''}`;
        if (e.base != null) {
          const power = e.base + (e.bonus ?? 0);
          // 보너스는 출처별로(특전 · 카드) — "피해 6"이 버그처럼 보이지 않게(2026-10-04 사용자 피드백)
          const parts = (e.bonus_src ?? []).map((b) => `<span class="bonus">${b.card ? names.cardName(b.card) : b.char ? `${names.charName(b.char)} 특전` : '보너스'} +${b.amount}</span>`);
          const rest = (e.bonus ?? 0) - (e.bonus_src ?? []).reduce((n, b) => n + b.amount, 0);
          if (rest) parts.push(`<span class="bonus">보너스 ${rest > 0 ? '+' : ''}${rest}</span>`);
          const atk = parts.length ? `무기 ${e.base} + ${parts.join(' + ')}` : `공격력 ${e.base}`;
          const defTxt = e.ignore_armor ? '방어 무시' : `방어 ${e.def ?? 0}`;
          const red = e.reduce ? ` − 피해 감소 ${e.reduce}` : '';
          let raw;
          let expr;
          if (f === 'skull') { raw = 0; expr = '💀 빗나감'; }
          else if (f === 'x2') { raw = power * 2; expr = `(${atk}) × 2 = ${raw}`; }
          else { raw = Math.max(0, power + tv); expr = `${atk} ${tv < 0 ? '−' : '+'} <span class="tokv">토큰 ${Math.abs(tv)}</span> = ${raw}`; }
          const dmg = Math.max(0, Math.max(0, raw - (e.ignore_armor ? 0 : e.def ?? 0)) - (e.reduce ?? 0));
          result = f === 'skull' ? `${expr} → <b>피해 0</b>` : `${expr} · ${defTxt}${red} → <b>피해 ${dmg}</b>`;
        }
      }
      const caption = owner ? `${owner}의 주머니${pouch ? ` · ${pouch}` : ''}` : '';
      await playTokens(fx, { faces: e.faces, face: f, title, result, caption, interactive: !!tokenInteractive?.(e, after) });
    },
    async damage_applied(e, after) {
      const p = pieces.get(e.target);
      if (!p) return;
      if (p.kind !== 'char' && p.bar) {
        p.hp = e.hp_after ?? Math.max(0, p.hp - e.amount);
        p.bar.userData.draw(p.hp, p.maxHp);
      }
      const color = e.missed ? '#C8C8D0' : e.fixed ? '#FF9A3C' : e.amount > 0 ? '#FF6B5B' : '#E8E8F0';
      const text = e.missed ? '빗나감' : e.amount > 0 ? `-${e.amount}${e.fixed ? ' (고정)' : ''}` : '0';
      say(p, text, color, { height: 0.48 });
      if (e.amount > 0) await fx.shake(p.mesh);
      else await fx.wait(0.25);
    },
    async evaded(e) { const p = pieces.get(e.character); say(p, '회피!', '#8FD3FF', { height: 0.46 }); if (p) await fx.hop(p.mesh, p.mesh.position.clone().add(new THREE.Vector3(0.18, 0, 0)), 0.18, 0.2).then(() => fx.slide(p.mesh, posOf(p), 0.15)); },
    async reaction_used(e, after) {
      const p = pieces.get(e.kind === 'intercept' ? e.by : e.character);
      if (e.kind === 'intercept') { await say(p, '대신 맞기', '#B9F0C0', { height: 0.34, hold: true, dur: 0.6 }); return; }
      await showUsedCard(e.card ?? e.item, e.character, after, '공격받을 때 사용');
    },
    async counter_attack(e) { const p = pieces.get(e.character); say(p, '반격!', '#FF9A3C', { height: 0.44 }); await attackAnim(e.character, e.target, null, false); },
    async extra_attack(e) { await say(pieces.get(e.character), '추가 공격', '#FFD24A', { height: 0.34, hold: true, dur: 0.5 }); },
    async exhausted(e) { const p = pieces.get(e.character); if (!p) return; say(p, '탈진', '#FF8A80', { height: 0.44 }); await fx.tipOver(p.mesh, true); p.exhausted = true; },
    async revived(e, after) {
      const p = pieces.get(e.character) ?? addChar(after.chars[e.character]);
      if (e.cell && e.cell !== p.cell) {
        const from = p.cell;
        p.cell = e.cell;
        p.mesh.position.copy(posOf(p));
        await relayout([from]);
      }
      await fx.tipOver(p.mesh, false);
      p.exhausted = false;
      // 어떻게 부활했는지(2026-10-04 사용자 피드백 신규 3): 의무실이면 비용, 아이템이면 쓴 캐릭터
      const how = e.method === 'infirmary' ? ` · 의무실 🪙${e.cost ?? 0}` : e.method === 'item' ? ` · ${e.by && after?.chars?.[e.by] ? names.charName(after.chars[e.by].char) + '의 ' : ''}${e.item ? names.cardName(e.item) : '아이템'}` : '';
      say(p, `부활${how}`, '#9CF09C', { height: 0.44, hold: true, dur: 1.2 });
      await fx.squash(p.mesh);
    },
    async enemy_killed(e) { await killAnim(e.enemy); },
    async boss_killed(e) { await killAnim(e.boss); onBanner?.(`보스 처치! (${e.order}번째)`); },
    async explosion(e) { const at = cellCenter(e.cell); fx.flash(at, '#FFB347', { radius: 3.2 }); await fx.ripple(at, '#FF7043', { radius: 4.5, dur: 0.6 }); },
    async noise(e) { if (cells.has(e.cell)) await fx.ripple(cellCenter(e.cell), '#DDE6FF', { radius: 6, dur: 0.8 }); },
    // 함정 · 습격 카드: 효과보다 카드를 먼저 보여 줌(2026-10-04 사용자 피드백 신규 1 — 실물 카드가 있으면 보여 주고 진행)
    async trap_triggered(e, after) { say(pieces.get(e.target), `함정! ${names.cardName(e.card)}`, '#FFB74D', { height: 0.38 }); await showEventCard(e.card, e.target, after, '함정!'); },
    async supply_ambush(e, after) { await showEventCard(e.card, e.character, after, '습격!'); },
    async status_granted(e) { await say(pieces.get(e.target), e.label === 'bleed' ? '출혈' : e.status === 'poison' ? `독 ${e.turns}` : STATUS_LABEL[e.status] ?? e.status, '#D1C4FF', { height: 0.34, hold: true, dur: 0.55 }); },
    // 무기 특수 효과(2026-10-17): 면역 · 기절 · 속박 · 밀어내기
    // 보급품 한 번에 적은 1마리까지(2026-10-17): 두 번째 적 카드는 버리고 한 장 더 — 알림만
    async supply_enemy_skipped(e) { onToast?.(`${names.cardName(e.card)} — 한 번에 적은 1마리까지라 버리고 한 장 더 뽑아요`); },
    async status_immune(e) { await say(pieces.get(e.target), `${STATUS_LABEL[e.status] ?? e.status} 면역`, '#E0E0E0', { height: 0.34, hold: true, dur: 0.5 }); },
    async foe_stunned(e) { await say(pieces.get(e.enemy), '기절 — 행동 못 함', '#C9B8FF', { height: 0.34, hold: true, dur: 0.6 }); },
    async foe_rooted(e) { await say(pieces.get(e.enemy), '속박 — 이동 못 함', '#C9B8FF', { height: 0.34, hold: true, dur: 0.6 }); },
    async enemy_pushed(e) {
      const p = pieces.get(e.enemy);
      if (!p) return;
      const from = p.cell;
      p.busy = true;
      p.cell = e.to;
      await fx.slide(p.mesh, posOf(p), 0.22);
      p.busy = false;
      say(p, '밀려남', '#FFD9A0', { height: 0.3 });
      await relayout([from, p.cell]);
    },
    async push_blocked(e) { await say(pieces.get(e.enemy), e.collision ? `충돌! +${e.collision}` : '막힘', e.collision ? '#FF9A6A' : '#E0E0E0', { height: 0.36, hold: true, dur: 0.5 }); },
    async healed(e) { if (e.amount > 0) say(pieces.get(e.character), `+${e.amount}`, '#8DF08D', { height: 0.44 }); },
    // 차례 종료 때 자동 행동 끝(2026-10-17): 어떤 캐릭터가 자동으로 끝났는지 말 위에 짧게
    async auto_activation(e) { await say(pieces.get(e.character), e.interact ? '자동 행동 끝 · 상호작용' : '자동 행동 끝', '#EDE3C4', { height: 0.3, hold: true, dur: 0.5 }); },
    async rested(e) { await say(pieces.get(e.character), '휴식', '#BFE8FF', { height: 0.34, hold: true, dur: 0.5 }); },
    async looted(e) { await say(pieces.get(e.character), '약탈', '#FFD59A', { height: 0.36, hold: true, dur: 0.5 }); },
    async item_used(e, after) { await showUsedCard(e.item, e.character, after, '아이템 사용'); },
    async card_played(e, after) { await showUsedCard(e.card, e.character, after, '카드 사용'); },
    async equipped(e) { say(pieces.get(e.character), `장착: ${names.cardName(e.item)}`, '#E0E0FF', { height: 0.3 }); },
    async enemy_revealed_done() {},
    async turn_started(e) { onBanner?.(`${e.player} 차례`); },
    async round_ended(e) { onBanner?.(`${e.round}라운드 끝`); await fx.wait(0.2); },
    async chapter_ended(e) {
      onBanner?.(`${e.chapter}챕터 끝 — 쉘터로 복귀`);
      const jobs = [];
      for (const p of pieces.values()) if (p.kind === 'char') jobs.push(fx.hop(p.mesh, p.mesh.position.clone().add(new THREE.Vector3(0, 2.5, 0)), 0.4, 0.2).then(() => { p.mesh.visible = false; }));
      await Promise.all(jobs);
    },
    // 챕터 끝에 일반 적을 치움(2026-10-07 오늘 9): 쓰러질 때와 같은 사라지는 연출
    async enemies_cleared(e) {
      await Promise.all(e.enemies.map(async (id) => {
        const p = pieces.get(id);
        if (!p) return;
        pieces.delete(id);   // "처치" 글자 없이 조용히 사라짐(killAnim과 다름)
        await fx.vanish(p.mesh);
      }));
    },
    async chapter_started(e) { onBanner?.(`${e.chapter}챕터 시작`); },
    async game_ended(e) { onBanner?.(`게임 종료 · 1위 ${e.ranking[0]}`); },
    async vp_gained(e) { onToast?.(`${e.player} 승점 +${e.amount}`); },
    async mission_completed(e) { onToast?.(`${e.player} 미션 완료: ${names.missionName(e.mission)}`); },
    async facility_upgraded(e) { onToast?.(`${e.player} 시설 Lv${e.level}`); },
    async bm_resolved(e) { onToast?.(`암시장: ${names.cardName(e.card)} → ${e.player}`); },
  };

  async function attackAnim(attackerId, targetId, label, remember = true) {
    const a = pieces.get(attackerId);
    const t = pieces.get(targetId);
    if (remember) lastAttack = { attacker: attackerId, target: targetId };
    if (label && a) say(a, label, '#FFC4B8', { height: 0.3 });
    if (a && t) await fx.lunge(a.mesh, t.mesh.position);
    else await fx.wait(0.15);
  }
  async function killAnim(id) {
    const p = pieces.get(id);
    if (!p) return;
    await fx.wait(0.2);
    say(p, '처치', '#FFE08A', { height: 0.46 });
    pieces.delete(id);
    await fx.vanish(p.mesh);
    await relayout([p.cell]);
  }

  let playing = false;
  async function play(events, after) {
    playing = true;
    try {
      // 적 등장이 여러 번 이어지면(챕터 시작 등) 하나씩 기다리지 않고 조금씩 겹쳐서 빠르게(2026-10-04 사용자 피드백)
      let burst = [];
      const flush = async () => { if (burst.length) { await Promise.all(burst); burst = []; } };
      for (const e of events) {
        const h = H[e.type];
        if (e.type === 'enemy_revealed' || e.type === 'enemy_spawned') {
          burst.push(h ? h(e, after) : Promise.resolve());
          await fx.wait(0.07);
          continue;
        }
        if (e.type !== 'marker_placed') await flush();
        if (h) await h(e, after);
        if (onEvent) await onEvent(e, after);
      }
      await flush();
    } finally {
      playing = false;
      sync(after);
    }
  }

  // ---------- 강조 · 선택 ----------
  function setHighlight(map) {
    highlight = map instanceof Map ? map : new Map([...(map ?? [])].map((id) => [id, '#FFFFFF']));
    for (const [id, c] of cells) {
      const color = highlight.get(id);          // 색 하나, 또는 [테두리 색, 바닥 색](한 칸에 할 수 있는 일이 둘일 때)
      const [edge, fill] = Array.isArray(color) ? color : [color, color];
      c.ring.visible = !!color;
      const glow = c.ring.userData.glow;
      if (glow) glow.visible = !!color;
      if (!color && dimmed.has(id) && glow) { glow.visible = true; glow.material.color.set('#2A2833'); glow.material.opacity = 0.28; continue; }
      if (color) {
        c.ring.material.color.set(edge);
        glow?.material.color.set(fill);
        if (glow) glow.material.opacity = /^#f/i.test(fill) ? 0.6 : 0.42;   // 흰색(이동)은 밝은 칸 위에서 약해서 조금 진하게
      }
    }
  }
  // 화살표: 고른 말 + 행동할 수 있는 내 말(2026-10-04 사용자 피드백 — 행동을 다 쓴 말은 안 보임)
  let actionable = new Set();
  // 발판 강조(2026-10-18 사용자 요청 — pieces.js selectionParts): 고른 캐릭터 = 금색(sel + halo + 발판 빛),
  // 행동이 남은 내 캐릭터(안 고름) = 흰색(ready + 옅은 halo + 발판 약하게). 행동을 다 쓴 캐릭터 · 남의 차례 = 강조 없음
  const SEL_GLOW = new THREE.Color('#FFC93A'), READY_GLOW = new THREE.Color('#FFFFFF'), NO_GLOW = new THREE.Color('#000000');
  function setSelected(id) {
    selectedId = id;
    for (const p of pieces.values()) {
      const u = p.mesh.userData;
      if (!u.sel) continue;
      const isSel = p.id === id;
      const isReady = !isSel && p.kind === 'char' && actionable.has(p.id);
      u.sel.visible = isSel;
      u.arrow.visible = isSel || actionable.has(p.id);
      if (u.ready) u.ready.visible = isReady;
      if (u.halo) {
        u.halo.visible = (isSel || isReady) && p.kind === 'char';
        u.halo.material.color.copy(isSel ? SEL_GLOW : READY_GLOW);
      }
      if (u.base) { u.base.material.emissive.copy(isSel ? SEL_GLOW : isReady ? READY_GLOW : NO_GLOW); u.base.material.emissiveIntensity = isSel ? 0.55 : 0.22; }
    }
  }
  function setActionable(ids) { actionable = new Set(ids ?? []); setSelected(selectedId); }
  // 칸 위 화살표(배치할 수 있는 시작 칸 등) — 위아래로 움직이는 주황 화살표
  // 2D 빌보드 화살표(어느 각도에서 봐도 같은 모양 — 2026-10-04 사용자 피드백)
  const cellArrows = new Map();
  const arrowTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 160;
    const g = cv.getContext('2d');
    g.beginPath(); g.moveTo(64, 150); g.lineTo(10, 80); g.lineTo(40, 80); g.lineTo(40, 10); g.lineTo(88, 10); g.lineTo(88, 80); g.lineTo(118, 80); g.closePath();
    g.fillStyle = '#FFB020'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#4A2A00'; g.stroke();
    const t = new THREE.CanvasTexture(cv); return t;
  })();
  const arrowMat = new THREE.SpriteMaterial({ map: arrowTex, transparent: true, depthWrite: false });
  function setCellArrows(ids) {
    const want = new Set(ids ?? []);
    for (const [id, m] of cellArrows) if (!want.has(id)) { m.parent.remove(m); cellArrows.delete(id); }
    for (const id of want) {
      if (cellArrows.has(id) || !cells.has(id)) continue;
      const m = new THREE.Sprite(arrowMat);
      m.scale.set(0.8, 1.0, 1);
      m.position.set(0, TILE_H + 1.4, 0);
      m.renderOrder = 8;
      cells.get(id).group.add(m);
      cellArrows.set(id, m);
    }
  }
  // 칸 어둡게(배치할 수 없는 칸)
  let dimmed = new Set();
  function setDim(ids) { dimmed = new Set(ids ?? []); setHighlight(highlight); }

  function update(dt, t) {
    fx.step(dt);
    for (const p of pieces.values()) {
      if (p.kind !== 'char' && p.mesh.userData.upper) p.mesh.userData.upper.rotation.z = Math.sin(t * 1.6 + p.mesh.userData.phase) * 0.07;
      const u = p.mesh.userData;
      if (p.id === selectedId && u.sel) {
        u.sel.material.opacity = 0.75 + Math.sin(t * 5) * 0.25;
        if (u.halo) u.halo.material.opacity = 0.7 + Math.sin(t * 5) * 0.2;
      } else if (u.ready?.visible) {   // 고르지 않은 내 캐릭터: 천천히 숨쉬듯(고른 캐릭터보다 약하게)
        u.ready.material.opacity = 0.8 + Math.sin(t * 2.2) * 0.2;
        if (u.halo) u.halo.material.opacity = 0.5 + Math.sin(t * 2.2) * 0.12;
      }
      if (p.mesh.userData.arrow?.visible) {
        p.mesh.userData.arrow.position.y = ARROW_Y + Math.sin(t * 3) * 0.06;
        p.mesh.userData.arrow.rotation.y = t * 1.5;
      }
    }
    for (const m of cellArrows.values()) m.position.y = TILE_H + 1.4 + Math.sin(t * 4) * 0.18;
    for (const [id, c] of cells) {
      const target = c.ring.visible ? 0.04 + Math.sin(t * 4) * 0.015 : 0;
      c.lift += (target - c.lift) * 0.25;
      c.group.position.y = c.lift;
      if (c.ring.visible) c.ring.material.opacity = 0.6 + Math.sin(t * 4) * 0.3;
    }
  }

  return {
    sync, play, update, setHighlight, setSelected, setActionable, setCellArrows, setDim, fx, placeMarkers, previewMove, previewClear,
    pickables: () => [...pieces.values()].map((p) => p.mesh),
    pieceCell: (id) => pieces.get(id)?.cell ?? null,
    // 그 칸에 있는 피규어(클릭을 타일 기준으로, 2026-10-17). 적 · 보스를 먼저(공격 대상), 그다음 서 있는 캐릭터, 쓰러진 캐릭터
    pieceAt(cellId) {
      const here = [...pieces.values()].filter((p) => p.cell === cellId);
      const rank = (p) => (p.kind === 'foe' || p.kind === 'boss' ? 0 : p.exhausted ? 2 : 1);
      return here.sort((a, b) => rank(a) - rank(b))[0]?.id ?? null;
    },
    get playing() { return playing; },
  };
}
