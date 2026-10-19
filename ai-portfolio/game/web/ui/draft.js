// 시작 화면: 인원수 선택 → 무작위 빠른 시작 또는 뱀 순서 캐릭터 드래프트 (규칙서 '캐릭터 선택')
// 드래프트에서 고른 캐릭터는 공개 정보라(모두가 보는 앞에서 고름) 핫싯 가리개 없이 중앙 카드 창으로 바로 진행한다.
import { openChooser, closeChooser } from './chooser.js';
import { openManual } from './manual.js';
import { PLAYER_COLORS } from '../board3d/pieces.js';
import { pouchHtml } from './cards.js';
import { BUILD } from '../build.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// 캐릭터 카드 보기(체력 · 스테미너 · 이동 · 가방 · 시작 무기 · 특전 2개)
// mode: 규칙 버전의 진행 방식(카드 운용 버전은 스테미너가 다름 — stamina_by_turn_mode, 2026-10-19)
export function characterView(content, N, defId, mode = null) {
  const def = content.chars[defId];
  const w = def.starting_weapon;
  return {
    id: defId, title: N.nameOf(def), band: def.color ?? '#5A5A7A', glyph: def.icon ?? '●',
    kind: `체력 ${def.hp} · 스테미너 ${def.stamina_by_turn_mode?.[mode] ?? def.stamina} · 이동 ${def.move + (content.config.turn_mode === 'activation' ? content.config.activation_move_bonus ?? 0 : 0)} · 가방 ${def.bag}`,
    desc: N.t(`char.${defId}.perk1`, ''),
    descHtml: `${N.rich(`char.${defId}.perk1`, '')}<div class="card-next">${N.rich(`char.${defId}.perk2`, '')}</div><div class="card-next">${pouchHtml(content.config, def.pouch ?? 'basic', N)}</div>`,
    stats: [{ label: '공격력', value: w.attack, icon: 'atk' }, { label: '사거리', value: w.range, icon: 'range' }],
    footer: `시작 무기: ${N.t(w.name_key, w.name_key)}`,
  };
}

// 좌석 종류: 'human'(사람) · 'ai:<난이도>' · 'none'(비움). 나중에 온라인에서 'remote'(원격 사람)를 추가한다.
// root: 시작 화면을 그릴 컨테이너. ctx: { content, names, ai }. ctx.ai = { levels: [난이도 id], create(level, seed) }
// ctx.resume: { summary, onResume() } — 이어 할 저장이 있으면 맨 위에 "이어 하기"(2026-10-17)
// onStart({ players, picks, seats, length, rules }) — length: 판 길이 id(config.game_lengths), rules: 규칙 버전 id(config.rule_sets, 2026-10-18), seats: { P1: {kind:'human'}, P2: {kind:'ai', level:'normal'} } (비운 좌석은 없음)
export function runStart(root, ctx, onStart) {
  const { content } = ctx;
  const N = ctx.names;
  const chars = Object.keys(content.chars);
  const perPlayer = content.config.players.characters_per_player;
  const { min: minP, max: maxP } = content.config.players;
  const seatIds = Array.from({ length: maxP }, (_, i) => `P${i + 1}`);
  const levels = ctx.ai?.levels ?? [];
  const levelName = (lv) => N.t(`ai.${lv}.name`, lv);
  const kinds = Object.fromEntries(seatIds.map((p, i) => [p, i === 0 ? 'human' : i === 1 && levels.length ? `ai:${levels[0]}` : 'none']));
  // 판 길이(2026-10-17 포트폴리오 데모 준비 — 정식 판 기본 + 짧은 판). 목록은 config.game_lengths, 첫 항목이 기본
  const lengths = content.config.game_lengths ?? [];
  let length = lengths[0]?.id ?? null;
  // 규칙 버전(2026-10-18 A/B 테스트 — 기본 행동 버전 · 카드 운용 버전). 목록은 config.rule_sets, 첫 항목(기본 행동 버전)이 기본
  // 2026-10-19 사용자 결정(포트폴리오 데모에 두 버전 다): 데모에서도 보임 — 예전(10-18)엔 BUILD.demo면 숨김
  const ruleSets = content.config.rule_sets ?? [];
  let rules = ruleSets[0]?.id ?? null;

  renderSetup();

  const seatOf = (kind) => (kind === 'human' ? { kind: 'human' } : { kind: 'ai', level: kind.slice(3) });
  function filled() { return seatIds.filter((p) => kinds[p] !== 'none'); }
  function seatsOf(ps) { return Object.fromEntries(ps.map((p) => [p, seatOf(kinds[p])])); }

  function renderSetup() {
    root.innerHTML = '';
    // 이어 하기: 저장된 판이 있으면 맨 위에 크게(새 게임 설정은 그 아래)
    if (ctx.resume) {
      const box = el('div', 'start-resume');
      box.append(el('div', 'sr-text', `<b>하던 게임이 있어요</b><span>${ctx.resume.summary}</span>`));
      const go = el('button', 'primary', '이어 하기');
      go.id = 'btn-resume';
      go.onclick = () => ctx.resume.onResume();
      box.append(go);
      root.append(box);
    }
    root.append(el('h2', 'start-title', 'Extraction B (가칭)'));
    root.append(el('p', 'start-sub', '1~4인 PvPvE 익스트랙션 보드게임 · 규칙 검증용 웹 프로토타입'));
    root.append(el('h3', null, '새 게임 · 좌석'));
    const grid = el('div', 'seat-grid');
    for (const p of seatIds) {
      const row = el('div', 'seat-row');
      row.append(el('span', 'dot', ''), el('b', null, p));
      row.firstChild.style.background = PLAYER_COLORS[p];
      const sel = document.createElement('select');
      sel.className = 'seat-kind';
      sel.dataset.seat = p;
      sel.append(new Option('사람', 'human'));
      for (const lv of levels) sel.append(new Option(`AI · ${levelName(lv)}`, `ai:${lv}`));
      sel.append(new Option('비움', 'none'));
      sel.value = kinds[p];
      sel.onchange = () => { kinds[p] = sel.value; refreshState(); };
      row.append(sel);
      grid.append(row);
    }
    root.append(grid);
    const note = el('div', 'start-note');
    root.append(note);
    // 맵 고르기(F3d): 3D 보드는 한 번만 만들기 때문에 바꾸면 그 맵으로 페이지를 다시 연다
    const mapRow = el('div', 'start-map');
    mapRow.append(el('span', '', '맵 '));
    const mapSel = el('select');
    // 인원수 변형 맵(id에 ~, engine playerMapId)은 고르는 대상이 아니라 뺀다(2026-10-17 — 같은 맵이 5번 보이던 문제)
    const baseMaps = Object.entries(ctx.content.maps).filter(([id]) => !id.includes('~'));
    for (const [id, m] of baseMaps) mapSel.append(new Option(ctx.names.t(m.name_key, id), id));
    mapSel.value = ctx.mapId;
    mapSel.onchange = () => { const u = new URL(location.href); u.searchParams.set('map', mapSel.value); location.href = u.href; };
    mapRow.append(mapSel);
    // 맵이 하나뿐이면(포트폴리오 데모 등) 고를 것이 없으니 줄을 숨긴다(2026-10-17)
    if (baseMaps.length > 1) root.append(mapRow);
    if (lengths.length > 1) {
      const lenRow = el('div', 'start-map start-length');
      lenRow.append(el('span', '', '판 길이 '));
      const lenSel = el('select');
      lenSel.id = 'start-length';
      const cfg = content.config;
      for (const L of lengths) {
        const ch = L.config?.chapters ?? cfg.chapters;
        const rd = L.config?.rounds_per_chapter ?? cfg.rounds_per_chapter;
        lenSel.append(new Option(`${N.t(L.name_key, L.id)} · ${ch}챕터 × ${rd}라운드`, L.id));
      }
      lenSel.value = length;
      lenSel.onchange = () => { length = lenSel.value; refreshState(); };
      lenRow.append(lenSel);
      root.append(lenRow);
    }
    if (ruleSets.length > 1) {
      const rRow = el('div', 'start-map start-rules');
      rRow.append(el('span', '', '규칙 버전 '));
      const rSel = el('select');
      rSel.id = 'start-rules';
      for (const R of ruleSets) rSel.append(new Option(N.t(R.name_key, R.id), R.id));
      rSel.value = rules;
      rSel.onchange = () => { rules = rSel.value; refreshState(); };
      rRow.append(rSel);
      root.append(rRow);
    }
    const row = el('div');
    const quick = el('button', '', '무작위로 빠른 시작');
    quick.id = 'btn-quickstart';
    quick.onclick = () => onStart({ ...randomPicks(), length, rules });
    const draft = el('button', 'primary', '드래프트 시작');
    draft.id = 'btn-draft';
    draft.onclick = () => startDraft();
    const help = el('button', 'ghost', '📖 설명서 <kbd>F1</kbd>');
    help.onclick = () => openManual();
    // 화면 개편안(F2a) 목업 — 새 탭으로 연다
    const mock = el('button', 'ghost', '🧪 UX 목업');
    mock.title = '화면 개편안 미리보기(실제 게임과 무관)';
    mock.onclick = () => window.open(new URL('mockup/ux.html', location.href).href, '_blank');
    // 육각 맵 편집기(F3c) — 새 탭으로 연다
    const mapEdit = el('button', 'ghost', '🗺 맵 편집기');
    mapEdit.title = '육각 맵을 칠하고 저장(data/map_*.json)';
    mapEdit.onclick = () => window.open(new URL('mapedit.html', location.href).href, '_blank');
    // 테스트 맵(2026-10-17, 개발용): 카드 · 적 · 수치를 바꿔 가며 기능을 시험하는 작은 맵 + 테스트 도구
    const sandboxBtn = el('button', 'ghost', '🧪 테스트 맵');
    sandboxBtn.title = '카드를 골라 써 보는 테스트 공간(허수아비 · 적 놓기 · 수치 바꾸기)';
    sandboxBtn.onclick = () => { const u = new URL(location.href); u.searchParams.set('map', 'map_test'); u.searchParams.set('sandbox', '1'); location.href = u.href; };
    // 포트폴리오 데모에서는 개발용 버튼(UX 목업 · 맵 편집기 · 테스트 맵)을 뺀다(2026-10-17, web/build.js)
    row.append(quick, draft, help, ...(BUILD.demo ? [] : [sandboxBtn, mock, mapEdit]));
    root.append(row);

    function refreshState() {
      const n = filled().length;
      const humans = filled().filter((p) => kinds[p] === 'human').length;
      const ok = n >= minP && n <= maxP;
      quick.disabled = draft.disabled = !ok;
      const mode = humans === 0 ? '사람 없이 AI끼리 붙는 <b>관전 모드</b>예요(모든 손패 · 미션이 공개돼요).'
        : humans === 1 ? '사람 1명이라 핫싯 가리개는 뜨지 않아요.' : `사람 ${humans}명이 한 화면을 같이 써서, 차례가 사람끼리 넘어갈 때 가리개가 떠요.`;
      // 판 길이 안내: 짧은 판(1챕터)은 정비 뒤 바로 끝나서 암시장이 없다
      const lenCfg = lengths.find((L) => L.id === length)?.config ?? {};
      const chs = lenCfg.chapters ?? content.config.chapters;
      const lenNote = !lengths.length ? '' : chs <= 1 ? '<br>짧은 판은 1챕터와 정비까지 해요(암시장은 2챕터부터 나와요).' : `<br>${chs}챕터를 끝까지 하면 정비 ${chs}번 · 암시장 ${chs - 1}번을 거쳐요.`;
      // 규칙 버전 안내(2026-10-18 A/B 테스트)
      const ruleNote = rules === 'cards' ? `<br><b>카드 운용 버전</b>: 기본 이동 · 공격이 없어요. 전용 카드 1장으로 스킬을 쓰거나, 카드 아래 아이콘으로 이동 · 공격 · 카드 2장 뽑기를 해요. 라운드가 끝나면 스테미너가 가득 차고 손패를 5장까지 채워요(차례를 끝낼 때 5장이 넘으면 버림). 챕터가 끝나면 캐릭터마다 새 카드를 1장 얻고 1장을 버려요.<br><b>(임시) 카드를 만든 ${roster().map((c) => N.charName(c)).join(' · ')}만 나와요.</b>` : '';
      note.innerHTML = `${ok ? '' : `<b>플레이어는 ${minP}~${maxP}명이어야 해요.</b> `}좌석마다 사람 / AI / 비움을 고르세요. ${ok ? mode : ''}<br>캐릭터는 ${perPlayer}명씩 갖고, 드래프트는 규칙서대로 뱀 순서예요. AI 좌석은 알아서 골라요. 픽은 모두에게 공개돼요.${lenNote}${ruleNote}<br>진행은 이 브라우저에 자동 저장돼서, 새로 고침하거나 창을 닫아도 이어 할 수 있어요.`;
    }
    refreshState();
  }

  // 규칙 버전의 캐릭터 목록(2026-10-19 — 카드 운용 버전은 (임시) 카드를 만든 4캐릭터만). 모자라면 플레이어끼리 겹쳐도 됨(내 두 캐릭터끼리만 다르게)
  const roster = () => ruleSets.find((R) => R.id === rules)?.config?.card_mode?.characters ?? chars;
  const shared = (n) => roster().length < n * perPlayer;
  function randomPicks() {
    const ps = filled();
    const pool = [...roster()].sort(() => Math.random() - 0.5);
    const picks = {};
    if (shared(ps.length)) ps.forEach((p) => { picks[p] = [...roster()].sort(() => Math.random() - 0.5).slice(0, perPlayer); });
    else ps.forEach((p, i) => { picks[p] = pool.slice(i * perPlayer, i * perPlayer + perPlayer); });
    return { players: ps, picks, seats: seatsOf(ps) };
  }

  // 뱀 순서: 1라운드 P1→P2→...→PN, 2라운드 PN→...→P1, 3라운드 다시 P1→... (characters_per_player가 3 이상이어도 대응)
  function startDraft() {
    const ps = filled();
    const seats = seatsOf(ps);
    const order = [];
    for (let round = 0; round < perPlayer; round++) order.push(...(round % 2 === 0 ? ps : [...ps].reverse()));
    const picks = Object.fromEntries(ps.map((p) => [p, []]));
    const pool = new Set(roster());
    const overlap = shared(ps.length);
    // 겹쳐도 되는 경우: 고를 수 있는 캐릭터 = 목록 − 내가 이미 고른 캐릭터(남이 고른 캐릭터도 됨)
    const avail = (p) => (overlap ? roster().filter((c) => !picks[p].includes(c)) : [...pool]);
    const bots = Object.fromEntries(ps.filter((p) => seats[p].kind === 'ai').map((p, i) => [p, ctx.ai.create(seats[p].level, Date.now() + i)]));
    const lines = [];
    let i = 0;
    step();
    function showLog() {
      root.innerHTML = '';
      root.append(el('h3', null, '캐릭터 드래프트'));
      root.append(el('div', 'start-note', lines.join('<br>') || '시작해요…'));
    }
    function step() {
      if (i >= order.length) { onStart({ players: ps, picks, seats, length, rules }); return; }
      const p = order[i];
      const n = picks[p].length + 1;
      if (bots[p]) {
        const id = bots[p].draft({ available: avail(p), picks });
        lines.push(`${label2(p)}이(가) <b>${N.charName(id)}</b>을(를) 골랐어요.`);
        picks[p].push(id); if (!overlap) pool.delete(id); i++;
        showLog();
        // 사람이 있으면 AI가 고른 캐릭터를 보여 주고 카운트다운(피드백 2-1): 확인을 누르면 바로, 안 누르면 끝나면 넘어감
        if (Object.values(seats).some((x) => x.kind === 'human')) announce(p, id, step);
        else setTimeout(step, 550);
        return;
      }
      showLog();
      const soFar = ps.filter((x) => picks[x].length).map((x) => `${x}: ${picks[x].map((c) => N.charName(c)).join(' · ')}`).join('  /  ');
      const list = avail(p);
      // 카드 운용 버전 임시 안내(2026-10-19 사용자 요청 "카드 고르는 화면에 걔네만 있다고 표시")
      const rosterNote = roster() !== chars ? `<br><b>(임시) 카드 운용 버전은 카드를 만든 ${roster().map((c) => N.charName(c)).join(' · ')}만 고를 수 있어요${overlap ? ' — 다른 플레이어와 겹쳐도 돼요' : ''}.</b>` : '';
      openChooser({
        title: `${p} · 캐릭터 선택 (${n}/${perPlayer})`,
        subtitle: (soFar || '아직 고른 캐릭터가 없어요.') + rosterNote,
        items: list.map((id) => ({ view: characterView(content, N, id, ruleSets.find((R) => R.id === rules)?.config?.turn_mode), value: id, size: 'lg' })),
        columns: Math.ceil(list.length / 2),     // 두 줄(피드백 2)
        peek: false,
        onPick: ([id]) => { picks[p].push(id); if (!overlap) pool.delete(id); lines.push(`${label2(p)}이(가) <b>${N.charName(id)}</b>을(를) 골랐어요.`); i++; step(); },
      });
    }
    function announce(p, id, next) {
      let left = 5;
      let done = false;
      const go = () => { if (done) return; done = true; clearInterval(timer); closeChooser(); next(); };
      openChooser({
        title: `${label2(p)}이(가) ${N.charName(id)}을(를) 골랐어요`, subtitle: '확인을 누르면 바로 넘어가요.',
        items: [{ view: characterView(content, N, id, ruleSets.find((R) => R.id === rules)?.config?.turn_mode), value: id, size: 'lg', disabled: true, fresh: true }],
        min: 0, max: 0, confirmLabel: `확인 (${left})`, peek: false, onPick: go,
      });
      const timer = setInterval(() => {
        left -= 1;
        const b = document.querySelector('.chooser-buttons .primary');
        if (b) b.textContent = `확인 (${left})`;
        if (left <= 0) go();
      }, 1000);
    }
    function label2(p) { return seats[p].kind === 'ai' ? `${p}(${levelName(seats[p].level)} AI)` : p; }
  }
}
