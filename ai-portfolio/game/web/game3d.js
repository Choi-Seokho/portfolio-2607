// 5-4 3D 게임 화면: 엔진 상태 → 3D 보드, 엔진 사건 → 연출.
// 입력은 카드 게임식: 선택은 화면 중앙 카드 창(decisions/chooser), 차례 조작은 아래 손패 · 행동 바 · 캐릭터 도크(hud),
// 정비 · 암시장은 중앙 판(screens), 오른쪽은 상황판(status). 보드는 배치 · 이동 · 공격 · 부활 · 보스 칸 고르기.
// 규칙 판정은 전부 엔진이 한다. 화면은 엔진 조회(query.js)로 "가능한 것"을 보여 주고, 액션을 만들어 보낼 뿐이다.
// AI 좌석(A-4): 시작 화면에서 좌석마다 사람 / AI(난이도) / 비움을 고른다. 게임은 진행자(session/session.js)가 이끌고,
// AI 좌석 차례에는 화면이 "생각 중…"을 보여 주며 AI가 낸 액션을 사람과 똑같이 연출한다. AI는 자기 뷰만 보고 결정한다(ai/).
// 사람이 0명이면 관전 모드(모든 비공개 정보 공개, 적 차례 · 챕터 준비도 자동), 1명이면 가리개 없음, 2명 이상이면 사람끼리 넘어갈 때만 가리개.
// 핫싯 가리개(5-4): 손패 · 손에 든 미션처럼 비공개 정보를 가진 "다음 확인할 사람"이 바뀌면, 그 사람이 화면을 보기 전까지
// 아무 정보도 그리지 않고 전체 화면 가리개를 띄운다. 캐릭터 드래프트(ui/draft.js)는 공개 정보라 가리개 없이 진행한다.
import { buildContent, loadRawFromUrl, deepMerge } from '../engine/content.js';
import { loadIcons, installIconTips, installCardLegend, iconHtml, iconText } from './ui/icons.js';
import { installHoverLift } from './ui/hoverlift.js';
import { weaponPower } from '../engine/index.js';
import { newGame, reachableCells, attackTargets, foeThreat, check, charPouchId, placeableCells, authorOf, whoDecides, interactInfo, isNear, enemyDefAt, cellUsesOf, charActionsLeft, perCharActions, turnActions, activationMode, cardMode, canDo, cellTier, tierBonus } from '../engine/index.js';
import { Session } from '../session/session.js';
import { createAI, loadProfilesFromUrl, availableLevels } from '../ai/index.js';
import { cellOf, segDist } from '../engine/map.js';
const segDistOf = (a, b) => segDist(map, a, b);
import { createUI, el, phaseLabel } from './ui/panel.js';
import { runStart } from './ui/draft.js';
import { closeManual, toggleManual, isManualOpen } from './ui/manual.js';
import { openGallery, closeGallery, isGalleryOpen } from './ui/gallery.js';
import { showDecision } from './ui/decisions.js';
import { openChooser, isChooserOpen, closeChooser } from './ui/chooser.js';
import { createHud } from './ui/hud.js';
import { createScreens } from './ui/screens.js';
import { createStatus } from './ui/status.js';
import { createTopbar } from './ui/topbar.js';
import { fxPauseOpts } from './ui/fxpause.js';
import { createShelter } from './ui/shelter.js';
import { createHudFx } from './ui/hudfx.js';
import { portraitView, foeView, optionView, cardView, renderCard, charInfoView, pouchHtml, setCardMode } from './ui/cards.js';
import { weaponOf, defenseOf, perksWithHook, condOk, rangeOf } from '../engine/core.js';
import { buildWorld } from './board3d/world.js';
import { createStage } from './board3d/stage.js';
import { createBoardView } from './board3d/view.js';
import { PLAYER_COLORS } from './board3d/pieces.js';
import { startKeepAlive } from './keepalive.js';
import { BUILD } from './build.js';
import { saveGame, loadSave, clearSave, fingerprint } from './save.js';
import { createSandbox } from './ui/sandbox.js';
// 테스트 맵(2026-10-17): 주소에 ?sandbox=1이면 테스트 맵으로 바로 시작 + 테스트 도구(개발용, 포트폴리오 데모 빌드에서는 꺼짐)
const SANDBOX = !BUILD.demo && new URLSearchParams(location.search).get('sandbox') === '1';
let sandbox = null;

const $ = (id) => document.getElementById(id);
const RIGHT_INSET = 0;      // F2d: 오른쪽 상황판을 없애고 위 상태 줄 · 아래 테이블로(보드가 화면 전체를 씀)
let content, locale, map, W, view, stage, panel, hud, screens, status;
let state = null;
let session = null;         // 진행자(Session): state의 주인. 화면의 state는 항상 session.state와 같다
let seats = {};             // { P1: {kind:'human'}, P2: {kind:'ai', level} }
let humans = [];            // 사람 좌석
let profiles = null;        // AI 난이도 프로필(data/ai_profiles.json)
let pumping = false;        // AI 좌석 진행 중(이 동안 사람 입력은 무시)
let paused = false;         // AI 진행 일시정지(관전용)
let thinking = '';          // "P2(보통 AI) 생각 중…"
let reach = null;           // 이동 모드: 칸 → {cost, path}
let targets = null;         // 공격 모드: [{kind, id, distance}]
let viewerActor = null;     // 가리개를 확인해 지금 화면을 봐도 되는 플레이어(null = 아무도 확인 전 · 공개 국면)
const rejects = [];         // 엔진이 거절한 액션(자동 테스트 확인용)

const ctx = {
  get content() { return content; },
  get locale() { return locale; },
  state: () => state,
  map: () => map,
  names: null,
  viewer: null,              // 지금 화면에 비공개 정보를 보여 줘도 되는 플레이어('*' = 관전: 전부 공개, null = 공개 정보만)
  actor: null,               // 지금 결정을 기다리는 "사람" 좌석(AI 차례 · 공개 국면이면 null)
  ai: null,                  // { levels, create(level, seed) } — 시작 화면의 AI 좌석용
  isHuman: (p) => humans.includes(p),
  spectating: () => humans.length === 0,
  seatTag: (p) => (seats[p]?.kind === 'ai' ? ` · ${levelName(seats[p].level)} AI` : ''),
  ui: { selected: null, mode: null, armed: [], bossCards: null },
  act,
  refresh,
  // "나": 지금 화면을 봐도 되는 플레이어. 관전이면 지금 차례 플레이어(F2d — 내 보드 · 손패 · 쉘터를 보여 줄 기준)
  me() {
    if (!state || !ctx.viewer) return null;
    return ctx.viewer === '*' ? state.turn.current_player : ctx.viewer;
  },
  shelterOpen: () => shelterOpen,
  toggleShelter() { shelterOpen = !shelterOpen; refresh(); },
  // 카메라를 그 칸으로(캐릭터 보드를 누르면 그 말로 — 2026-10-03 테스터 피드백 "내 말을 못 찾겠다")
  focusCell(cellId) {
    const c = W.cells.get(cellId)?.pos;
    if (c) stage.focus(c.x, c.z);
  },
  // 화면 연출용: 칸의 화면 좌표 · 연출 속도(F2e)
  cellScreen(cellId) {
    const c = W.cells.get(cellId)?.pos?.clone();
    if (!c) return null;
    c.y = 0.2; c.project(W.camera);
    const r = W.canvas.getBoundingClientRect();
    return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height };
  },
  fxSpeed: () => view?.fx.speed ?? 1,
  toast: (t) => toast(t),
};
let hudfx = null;
let dataPrint = '';        // 게임 데이터 지문(이어 하기 저장이 지금 데이터와 맞는지, web/save.js)
let shelterOpen = false;   // 내 쉘터 서랍(S 키 · 버튼)
let topbar = null;
let shelter = null;

async function boot() {
  if (!BUILD.demo) startKeepAlive();          // "게임 실행"으로 켠 서버는 이 탭이 닫히면 스스로 꺼진다(정적 호스팅 데모에는 그 서버가 없음)
  if (BUILD.title) document.title = BUILD.title;
  if (BUILD.demo) document.body.classList.add('demo-build');   // 개발용 버튼 숨김(game3d.html의 .demo-build 규칙)
  const raw = await loadRawFromUrl('../data/', { maps: BUILD.maps });
  content = buildContent(raw);
  locale = await (await fetch('../data/locale/ko.json')).json();
  dataPrint = fingerprint([raw, locale]);
  await loadIcons('../data/');
  installIconTips('.card');
  installCardLegend('.card');
  // 카드 들어 올리기(떨림 방지: :hover 대신 원래 자리까지 포함해 판정)
  installHoverLift('.card.in-hand:not(.disabled), .chooser-row .card:not(.disabled), .screen-card .card, .screen-mini-row .card');
  profiles = await loadProfilesFromUrl('../data/');
  ctx.ai = { levels: availableLevels(profiles), create: (level, seed) => createAI(level, profiles, { seed }) };
  // 맵: 주소의 ?map=맵id, 없으면 육각 마을(F3d). 3D 보드는 한 번만 만들기 때문에 맵을 바꾸면 페이지를 다시 연다(시작 화면의 맵 선택).
  const want = new URLSearchParams(location.search).get('map');
  // 기본 맵: 중간 맵(2026-10-07 사용자 결정 — 이동력 대신 맵을 줄여 중앙까지 닿게). 큰 맵은 ?map=map_village_hex 또는 시작 화면에서
  const mapId = content.maps[want] ? want : content.maps.map_village_mid ? 'map_village_mid' : content.maps.map_village_hex ? 'map_village_hex' : Object.keys(content.maps)[0];
  map = content.maps[mapId];
  ctx.mapId = mapId;
  const L = (k) => locale.strings[k] ?? k;
  W = buildWorld(map, L, 'c');
  W.bossZones = map.boss_zones ?? content.zoneBoss;
  panel = createUI(ctx);
  ctx.names = panel.names;
  hud = createHud(ctx, { dock: $('dock'), actions: $('actions'), hand: $('hand') });
  screens = createScreens(ctx, $('screen'));
  status = createStatus(ctx, $('status'));
  shelter = createShelter(ctx);
  topbar = createTopbar(ctx, { dots: $('tb-dots'), plates: $('tb-plates'), piles: $('tb-piles') }, { onPlate: (p) => shelter.openModal(state, p) });
  hudfx = createHudFx(ctx);
  // 토큰 판정에 사람 캐릭터가 끼면(공격하거나 공격받음 · 반격) 눌러서 뒤집고 확인(2026-10-04 사용자 피드백)
  const tokenInteractive = (e, after) => [e.attacker, e.target, e.character].some((id) => after?.chars?.[id] && humans.includes(after.chars[id].owner));
  view = createBoardView(W, { content, names: ctx.names, onBanner: banner, onToast: toast, onEvent: (e) => hudfx.play(e), tokenInteractive, humanOwns: (p) => humans.includes(p) });
  stage = createStage(W, { onClick: onBoardClick, onHover: onHover, pickables: { pieces: view.pickables, pieceAt: view.pieceAt, pieceCell: view.pieceCell }, rightInset: RIGHT_INSET });
  requestAnimationFrame(() => stage.home(true));   // 처음엔 보드 전체가 보이게(2026-10-04)
  if (content.config.center_reward) W.setTiers?.((id) => cellTier(map, id));   // 중앙 보상 지역 경계(금색)
  stage.start((dt, t) => view.update(dt, t));
  $('loading').remove();
  // 개발용: 브라우저 콘솔 · 자동 테스트에서 상태를 들여다보고 칸 화면 좌표를 구할 수 있게
  window.__g3d = {
    get state() { return state; }, get session() { return session; }, get hudfx() { return hudfx; }, get seats() { return seats; }, pumping: () => pumping, act, pump: () => pump(), setSpeed: (v) => { speedState.user = v; applySpeed(); }, view, W, stage, ctx, rejects, get map() { return map; }, get mapEdges() { return map.edges; },
    // 개발용: 상태를 고쳐 끼운다(자동 테스트에서 장비 · 위치를 맞출 때). 말 위치는 보드에 다시 반영
    boardClick: (cellId, pieceId = null) => onBoardClick({ cellId, pieceId }),   // 자동 테스트: 칸 id로 보드 누르기(화면 좌표 대신)
    // 화면 조작 QA 봇(2026-10-17, tests/ui_cards_bot.js): 지금 보드에서 누를 수 있는 칸과 그 칸에서 할 일(이동 · 공격 · 상호작용 …)
    cellOpts: () => [...(cellOpts ?? [])].map(([cell, os]) => ({ cell, kinds: os.map((o) => o.kind), cost: os.find((o) => o.info?.cost != null)?.info.cost ?? null, targets: os.filter((o) => o.target).map((o) => o.target.id) })),
    reachCells: () => [...(reach ?? [])].filter(([, i]) => i.path?.length).map(([cell, i]) => ({ cell, cost: i.cost, grapple: !!i.grapple })),   // 장전한 이동 카드(이동 모드)의 이동 칸
    debugPatch(fn) { const s = structuredClone(state); fn(s); session.state = s; state = s; view.sync?.(s); refresh(); },
    cellScreen(cellId) {
      const c = W.cells.get(cellId).pos.clone(); c.y = 0.2; c.project(W.camera);
      const r = W.canvas.getBoundingClientRect();
      return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height };
    },
    // 자동 테스트용: 무작위 캐릭터로 시작해서 첫 플레이어 차례까지 기본 선택으로 넘긴다
    // kinds: 좌석 종류 목록(예: ['human', 'ai:normal']). 안 쓰면 앞에서 nPlayers명이 전부 사람(핫싯)
    async quickStart(nPlayers = 2, kinds = null, { until = null } = {}) {   // until: 이 결정(pending type)에서 멈춤(예: 'mulligan')
      const sels = [...$('start').querySelectorAll('select.seat-kind')];
      sels.forEach((sel, i) => { sel.value = kinds?.[i] ?? (i < nPlayers ? 'human' : 'none'); sel.dispatchEvent(new Event('change')); });
      $('btn-quickstart').click();
      const prev = view.fx.speed;
      view.fx.speed = 60;
      const ready = () => state.turn.phase === 'player_turn' && !state.pending && humans.includes(state.turn.current_player);
      for (let k = 0; k < 600 && !state.game.over && !ready(); k++) {
        if (pumping) { await new Promise((r) => setTimeout(r, 30)); continue; }
        const p = state.pending;
        if (until && p?.type === until && humans.includes(p.player)) break;
        closeChooser();
        if (p && !humans.includes(p.player)) { await new Promise((r) => setTimeout(r, 30)); continue; }
        if (!p && state.turn.phase === 'chapter_prep') await act({ type: 'run_chapter_prep' });
        else if (p?.type === 'mission_keep') await act({ type: 'choose', player: p.player, choice: [...p.current, ...p.options].slice(0, p.max_keep) });
        else if (p?.type === 'mulligan') await act({ type: 'choose', player: p.player, choice: [] });
        else if (p?.type === 'placement') {
          const ch = Object.values(state.chars).find((c) => c.owner === p.player && c.cell == null);
          const cell = placeableCells(state, content)[0];
          await act({ type: 'place_character', player: p.player, character: ch.id, cell });
        } else break;
      }
      view.fx.speed = prev;
      confirmPass();          // 가리개가 남아 있으면 확인 처리(테스트가 이어서 보드 · 버튼을 클릭할 수 있게)
      return { phase: state.turn.phase, pending: state.pending?.type ?? null };
    },
    confirmPass,
  };
  bindTools();
  $('start').classList.remove('hidden');
  document.body.classList.add('at-start');
  // 이어 하기(2026-10-17): 같은 빌드 · 같은 데이터로 저장한 판이 있으면 시작 화면 맨 위에 보여 준다
  const saved = loadSave({ build: BUILD.id, data: dataPrint });
  if (saved && saved.mapId === mapId) {
    const who = Object.entries(saved.seats).map(([p, x]) => `${p} ${x.kind === 'ai' ? `${levelName(x.level)} AI` : '사람'}`).join(' · ');
    const at = new Date(saved.savedAt);
    const when = `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    ctx.resume = {
      summary: `${phaseLabel(saved.state)} · ${who} · ${when} 저장`,   // phaseLabel에 챕터 · 라운드가 들어 있음
      onResume: () => {
        try { beginSession({ seats: saved.seats, state: saved.state, bmDone: saved.bmDone, length: saved.length }); } catch (e) {
          // 복원에 실패하면(저장이 깨졌거나 규칙이 바뀜) 저장을 지우고 새 게임으로
          console.error(e); clearSave(); toast('저장된 게임을 불러오지 못했어요. 새 게임을 시작해 주세요.'); location.reload();
        }
      },
    };
  } else if (saved) ctx.resume = null;
  if (SANDBOX) { startSandbox(); return; }
  runStart($('start'), ctx, ({ players, picks, seats: chosen, length, rules }) => {
    const seed = Date.now();
    // 판 길이(짧은 판 = 1챕터) + 규칙 버전(2026-10-18 A/B 테스트 — 카드 운용 버전). 둘 다 이번 판만 덮어쓰는 설정값이라 합친다
    const lenCfg = content.config.game_lengths?.find((L) => L.id === length)?.config ?? null;
    const ruleCfg = content.config.rule_sets?.find((R) => R.id === rules)?.config ?? null;
    const over = lenCfg || ruleCfg ? deepMerge(lenCfg ?? {}, ruleCfg ?? {}) : null;
    beginSession({ seats: chosen, state: newGame(content, { mapId, players, picks, seed, config: over }), length });
  });

  // 새 게임 · 이어 하기 공용: 진행자(Session)를 만들고 보드에 올린다. bmDone = 암시장 칩 놓기를 마친 좌석(저장에서 복원할 때)
  function beginSession({ seats: chosen, state: start, bmDone = [], length = null }) {
    seats = chosen;
    const players = Object.keys(seats);
    humans = players.filter((p) => seats[p].kind === 'human');
    const seed = Date.now();
    const controllers = Object.fromEntries(players.filter((p) => seats[p].kind === 'ai').map((p, i) => [p, ctx.ai.create(seats[p].level, seed + i + 1)]));
    const next = new Session({ content, state: start, seats, controllers });
    next.bmDone = new Set(bmDone);
    whoDecides(next.state);         // 저장이 깨졌으면 여기서 먼저 터지게(보드에 올리기 전)
    $('start').classList.add('hidden');
    document.body.classList.remove('at-start');
    session = next;
    state = session.state;
    setCardMode(cardMode(state));   // 카드 운용 버전이면 카드에 기본 아이콘 줄(2026-10-18 A/B 테스트)
    // 인원수별 칸(min_players): 이번 판에 안 쓰는 칸은 보드에서 빈 길처럼(엔진은 인원수 변형 맵을 씀)
    if (state.map_id !== mapId) { map = content.maps[state.map_id]; W.setInactive(map.cells.filter((c) => c.inactive_type).map((c) => c.id)); if (content.config.center_reward) W.setTiers?.((id) => cellTier(map, id)); }
    $('btn-pause').classList.toggle('hidden', !Object.keys(controllers).length || !!BUILD.demo);
    // 자동 저장: 엔진에 액션이 들어갈 때마다(사람 · AI · 공개 진행 모두). 게임이 끝나면 저장을 지운다. 테스트 맵은 저장 안 함
    const persist = (s) => (SANDBOX ? null : s.game.over ? clearSave() : saveGame({ build: BUILD.id, data: dataPrint, mapId, seats, state: s, bmDone: [...session.bmDone], length }));
    session.on(({ state: s }) => { if (session === next) persist(s); });
    persist(state);
    view.sync(state);
    refresh();
    pump();
  }

  // 테스트 맵: P1 사람 · P2 "가만히 있는 상대"(자기 차례엔 바로 차례 종료, 고를 일은 쉬움 AI), 챕터가 끝나지 않게 라운드 99,
  // 적 행동은 꺼진 채로 시작(테스트 도구에서 켜기). 미션 · 멀리건 · 배치는 자동으로 넘기고 P1 차례에서 멈춘다
  async function startSandbox() {
    const chars = Object.keys(content.chars).sort(() => Math.random() - 0.5);
    const players = ['P1', 'P2'];
    const picks = { P1: chars.slice(0, 2), P2: chars.slice(2, 4) };
    const seatsT = { P1: { kind: 'human' }, P2: { kind: 'ai', level: ctx.ai.levels[0] } };
    const st = newGame(content, { mapId, players, picks, seed: Date.now(), config: { chapters: 1, rounds_per_chapter: 99, test: { enemies_idle: true } } });
    beginSession({ seats: seatsT, state: st });
    // 상대(P2): 자기 차례면 바로 끝, 그 밖의 결정(배치 · 반응 등)은 쉬움 AI
    const base = session.controllers.P2;
    session.controllers.P2 = { ...base, decide: (v, tools) => (v.turn.phase === 'player_turn' && v.turn.current_player === 'P2' && !v.pending ? { type: 'end_turn', player: 'P2' } : base.decide(v, tools)) };
    setSpeedFast(true);
    for (let k = 0; k < 400 && !state.game.over; k++) {
      if (pumping || view.playing) { await sleep(40); continue; }
      const p = state.pending;
      if (state.turn.phase === 'player_turn' && !p && state.turn.current_player === 'P1') break;
      closeChooser();
      if (!p && state.turn.phase === 'chapter_prep') await act({ type: 'run_chapter_prep' });
      else if (p?.type === 'mission_keep' && p.player === 'P1') await act({ type: 'choose', player: 'P1', choice: [...p.current, ...p.options].slice(0, p.max_keep) });
      else if (p?.type === 'mulligan' && p.player === 'P1') await act({ type: 'choose', player: 'P1', choice: [] });
      else if (p?.type === 'placement' && p.player === 'P1') {
        const ch = Object.values(state.chars).find((c) => c.owner === 'P1' && c.cell == null);
        await act({ type: 'place_character', player: 'P1', character: ch.id, cell: placeableCells(state, content)[0] });
      } else { pump(); await sleep(60); }
      document.querySelector('#passscreen:not(.hidden) button')?.click();
      document.querySelector('.chooser .chooser-buttons button.primary')?.click();   // 멀리건 새 카드 확인 같은 안내 창
    }
    setSpeedFast(false);
    stage.setHomeScale(1.3);   // 작은 맵이라 가장자리 칸이 도구 판에 가리지 않게 조금 멀리서
    stage.home();
    sandbox = createSandbox({
      content, names: ctx.names, state: () => state, selected: () => ctx.ui.selected,
      patch: (fn) => window.__g3d.debugPatch(fn), act, toast, refresh,
      pickCell: (hint, cb) => { ctx.ui.mode = 'sandbox'; ctx.ui.sandboxPick = cb; toast(hint); refresh(); },
    });
    toast('테스트 맵이에요 — 오른쪽 "테스트 도구"로 카드 · 적 · 수치를 바꿔 가며 시험하세요');
  }
}
// 테스트 맵 준비 중에는 연출을 아주 빠르게(건너뛰기와 같은 방식, applySpeed)
function setSpeedFast(on) { speedState.skip += on ? 1 : -1; applySpeed(); }

// ---------- 액션 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const levelName = (lv) => ctx.names.t(`ai.${lv}.name`, lv);
const seatLabel = (p) => `${p}${seats[p]?.kind === 'ai' ? `(${levelName(seats[p].level)} AI)` : ''}`;

// 사람이 화면에서 내는 액션: 좌석 검증(AI 좌석 · 남의 차례는 거절) → 엔진 → 연출. 끝나면 AI 좌석 진행을 이어 간다.
async function act(action) {
  if (view.playing || pumping || !session) return false;
  const author = authorOf(state, action);
  const res = author && !humans.includes(author)
    ? { ok: false, error: 'not_your_seat' }        // 화면은 AI 좌석의 행동을 대신 내지 못한다
    : session.submit(author ?? null, action);
  if (!res.ok) {
    rejects.push({ type: action.type, error: res.error?.code ?? res.error, pending: state.pending?.type ?? null });
    if (rejects.length > 200) rejects.shift();
    log(`✗ ${action.type}: ${ctx.names.errorText(res.error)}`, 'err');
    toast(ctx.names.errorText(res.error));
    refresh();              // 선택 대기 중이었다면 카드 창을 다시 연다
    return false;
  }
  ctx.ui.cardPlay = null;   // 카드 운용 버전: 행동이 들어가면 고른 카드는 풀림(같은 카드가 여러 장이라 손패 자리로는 못 가림, 2026-10-18)
  await present(res);
  pump();
  return true;
}

let lastEnemyBanner = null;
// 암시장 결과: 카드마다 누가 골랐고 누가 샀는지, 경쟁이면 낸 카드(판매가)까지 — 입찰한 카드는 공개 정보
function showMarketResult(start, log) {
  const N = ctx.names;
  const items = [];
  const lines = [];
  for (const id of start.cards) {
    const placed = start.place[id] ?? [];
    const won = log.find((e) => e.type === 'bm_resolved' && e.card === id);
    const bids = log.filter((e) => e.type === 'bm_bids_revealed' && e.card === id);
    const tag = won ? `${won.winner} ${bids.length ? '낙찰' : '구매'}` : placed.length ? '아무도 못 삼' : '아무도 안 고름';
    items.push({ view: { ...cardView(content, N, id), tag }, value: id, note: placed.length ? `고른 사람: ${placed.join(' · ')}` : null });
    for (const b of bids) {
      const parts = Object.entries(b.bids).map(([p, c]) => `${p}: ${c ? `${N.cardName(c)}(판매 ${content.cards[c]?.sell ?? 0})` : '포기'}`);
      lines.push(`<b>${N.cardName(id)}</b> 경쟁${b.round > 1 ? ' · 동점이라 한 장 더' : ''} — ${parts.join(' vs ')}`);
    }
  }
  return new Promise((resolve) => openChooser({
    title: '암시장 결과', subtitle: lines.length ? lines.join('<br>') : '경쟁 없이 끝났어요.',
    items, min: 0, max: 0, hideConfirm: true, peek: false,
    buttons: [{ label: '확인', primary: true, onClick: resolve }],
  }));
}
// 그 플레이어의 (보드 위) 캐릭터들이 화면 가운데 오게 — 둘이 멀리 떨어져 있으면 그만큼 멀리서(둘 다 보이게) — 2026-10-17부터 쓰지 않음(카메라 고정), 되살릴 때를 위해 남겨 둠
function focusPlayer(p) {
  const pts = Object.values(state.chars).filter((c) => c.owner === p && c.cell).map((c) => W.cells.get(c.cell)?.pos).filter(Boolean);
  if (!pts.length) { stage.home(); return; }
  const x = pts.reduce((n, v) => n + v.x, 0) / pts.length;
  const z = pts.reduce((n, v) => n + v.z, 0) / pts.length;
  const spread = Math.max(0, ...pts.map((a) => Math.max(...pts.map((b) => Math.hypot(a.x - b.x, a.z - b.z)))));
  const homeD = stage.homeView().d;
  stage.focus(x, z, Math.min(homeD, Math.max(homeD * 0.68, homeD * 0.5 + spread * 1.3)));
}
// 엔진이 돌려준 사건을 로그 · 3D 연출로 보여 주고 최종 상태로 맞춘다(사람 · AI 공용)
async function present(res) {
  const before = state;
  state = session.state;
  markFresh(before, state);
  closeChooser();           // 다른 경로(자동 테스트 등)로 답했을 때 남은 창 정리
  resetMode();
  for (const e of res.events) log(fmtEvent(e));
  document.body.classList.add('busy');
  view.setHighlight(null);
  lockInputs();             // 연출 중: 행동 버튼 · 정비 판만 숨기고, 내 보드 · 손패는 그대로 보여 준다(F2d)
  const enemyPhase = before?.turn.phase === 'enemy_turn';
  // 적 차례 배너는 라운드마다 한 번만(적 A → 적 B마다 뜨던 문제, 2026-10-04 사용자 피드백 24)
  const ebKey = before ? `${before.game.chapter}-${before.game.round}` : null;
  if (enemyPhase && res.events.length && ebKey !== lastEnemyBanner) { lastEnemyBanner = ebKey; await hudfx.enemyBanner(); }
  // 카메라(2026-10-17 사용자 결정 "카메라가 제대로 따라다니지 않아 — 전체 화면이 보이는 시점으로 고정하고 다른 사람 차례를 보자"):
  // 자동으로 따라가는 카메라는 전부 끔. 보드 전체 시점이 기본이고, 새 차례 · 적 차례 · 정비가 시작되면 전체 시점으로 돌아온다(아래).
  // 휠 · 드래그로 직접 확대 · 이동하는 건 그대로. 예전(2026-10-04): 차례 시작 때 그 플레이어 말 쪽으로(focusPlayer),
  // 적 차례에 사람 캐릭터가 공격받으면 그 캐릭터 쪽으로 확대 — 둘 다 지움.
  // 적 차례 연출은 2배속(적이 15곳에서 나와 길어짐 — 2026-10-03 테스터 피드백 "적 차례 대기가 길다")
  // 2026-10-17 버그 수정(사용자 "빠르게 했다가 1배속으로 바꿨는데 원래대로 안 돌아온다"): 예전엔 연출 시작 때 속도를 기억했다가
  // 끝날 때 그 값으로 되돌려서, 연출 도중 바꾼 속도가 덮어써졌다 → 사용자 속도(speedState.user)와 임시 배율을 나눠 applySpeed로 계산
  speedState.enemy = enemyPhase;
  applySpeed();
  try { await view.play(res.events, state); } finally { speedState.enemy = false; applySpeed(); }
  if (ctx.ui.preview) view.previewMove(ctx.ui.preview.char, ctx.ui.preview.cell, { instant: true });   // 연출이 피규어를 실제 칸으로 돌려 놓았으면 미리 본 칸으로 다시
  // (예전 피드백 1-1: 멀리건 뒤 새로 받은 카드 확인 창 revealMulligan — 2026-10-18 사용자 결정으로 지움: 멀리건을 손패에서 바로 하니
  //  새 카드도 손패에 바로 들어오고 markFresh로 빛남. 핫싯은 다음 사람 가리개가 손패를 가림)
  // 암시장(2026-10-04 신규 8): 정산 사건을 모아 두었다가 암시장이 끝나면 결과 화면 → 산 사람(사람 좌석)은 정리 화면
  if (before?.turn.phase === 'black_market') {
    const ui = ctx.ui;
    if (!ui.bmStart) ui.bmStart = { cards: [...before.board.black_market], place: structuredClone(before.board.bm_place ?? {}) };
    (ui.bmLog ??= []).push(...res.events.filter((e) => e.type === 'bm_resolved' || e.type === 'bm_bids_revealed'));
    if (state.turn.phase !== 'black_market') {
      const start = ui.bmStart, log = ui.bmLog;
      ui.bmStart = null; ui.bmLog = [];
      if (humans.length && start.cards.length) await showMarketResult(start, log);
      const bought = {};
      for (const e of log) if (e.type === 'bm_resolved' && humans.includes(e.winner)) (bought[e.winner] ??= []).push(e.card);
      ui.arrangeQueue = Object.keys(bought);
      ui.bmFresh = bought;
    }
  }
  // ? 칸 수색: 뒤집은 수색 카드를 잠깐 보여 준다(모두에게 공개되는 카드, 2026-10-02)
  for (const e of res.events) if (e.type === 'search_revealed') await revealSearch(e);
  // 라운드에 한 번 쓰는 장비: 눕힘 · 다시 세움 안내(2026-10-01 그래플링 훅)
  // 'perk:캐릭터id'는 특전 그래플링(닌자, 2026-10-08)의 눕힘 표시 — 카드가 아니라서 이름을 따로
  const cardName = (id) => (String(id).startsWith('perk:') ? '그래플링(특전)' : ctx.names.cardName?.(id) ?? id);
  for (const e of res.events) {
    const ch = state.chars[e.character];
    if (!ch) continue;
    if (e.type === 'item_tapped') toast(`🪝 ${ctx.names.charName(ch.char)} — ${cardName(e.card)} 사용(이번 라운드는 눕혀 둠)`);
    if (e.type === 'items_readied' && humans.includes(ch.owner)) toast(`↻ ${ctx.names.charName(ch.char)} — ${e.cards.map(cardName).join(', ')} 다시 세움`);
  }
  // 예언자 "통찰": 들여다본 카드는 본 플레이어에게만(2026-10-08) — 핫싯이면 "나"가 그 플레이어일 때만 띄움
  for (const e of res.events) {
    if (e.type !== 'card_peeked' || e.player !== ctx.me()) continue;
    if (!e.card) { toast(`통찰: ${e.target}의 손패가 비어 있어요`); continue; }
    openChooser({ title: `통찰 · ${e.target}의 손패 1장`, subtitle: '나만 보는 정보예요(상대 손패는 그대로).', items: [{ view: cardView(content, ctx.names, e.card), value: 0, disabled: true, size: 'lg' }], min: 0, max: 0, confirmLabel: '닫기', peek: false, onPick: () => {} });
  }
  // 새 차례가 시작되면(사람 · AI 모두) 보드 전체 시점으로(2026-10-17 — 예전엔 그 플레이어 말 쪽으로 focusPlayer). 적 차례 · 정비도 전체
  const newTurn = state.turn.phase === 'player_turn' && (before?.turn.phase !== 'player_turn' || before?.turn.current_player !== state.turn.current_player);
  if (newTurn) stage.home();
  if (state.turn.phase === 'enemy_turn' && before?.turn.phase !== 'enemy_turn') stage.home();
  if (state.turn.phase === 'maintenance' && before?.turn.phase !== 'maintenance') stage.home();
  await announce();
  document.body.classList.remove('busy');
  refresh();
}

// 배치 · 차례가 바뀌면 가운데 띠로 안내(2026-10-04 사용자 피드백 — 지금 누가 무엇을 하는지)
let lastAnnounce = null;
async function announce() {
  const s = state;
  if (!s || s.game.over) return;
  const band = (p) => `color-mix(in srgb, ${PLAYER_COLORS[p]} 75%, #101018)`;
  let key = null, text = '', sub = '', p = null;
  if (s.pending?.type === 'placement') {
    p = s.pending.player; key = `place:${s.game.chapter}:${p}`;
    const mine = humans.includes(p);
    text = mine ? (humans.length > 1 ? `${p} 배치 차례` : '배치 — 내 차례') : `${seatLabel(p)} 배치 중`;
    sub = mine ? '캐릭터 보드를 눌러 놓을 캐릭터를 고르고, 화살표가 있는 시작 칸을 누르세요' : '';
  } else if (!s.pending && s.turn.phase === 'player_turn') {
    p = s.turn.current_player; key = `turn:${s.game.chapter}:${s.game.round}:${p}`;
    const mine = humans.includes(p);
    text = mine ? (humans.length > 1 ? `${p} 차례` : '내 차례') : `${seatLabel(p)} 차례`;
    sub = mine ? '머리 위에 화살표가 있는 캐릭터가 행동할 수 있어요(캐릭터마다 2번)' : '';
  }
  if (!key || key === lastAnnounce) return;
  lastAnnounce = key;
  await hudfx.phaseBanner(text, { color: band(p), sub, ms: humans.includes(p) ? 1100 : 650 });
}

// AI 좌석 진행: 사람의 결정이 필요해질 때까지 AI 결정(과 사람이 없을 때 공개 국면)을 하나씩 연출하며 진행한다.
// 공개 국면 자동 진행(F2h, AC-7-1): 사람이 없으면 전부, 사람이 1명이면 적 차례만 자동(배너 후 바로 진행).
// 사람이 2명 이상(핫싯)이면 지금처럼 버튼으로 넘긴다(누가 볼지 모이는 시간).
function autoPublic(w) {
  if (humans.length === 0) return true;
  return humans.length === 1 && w.action?.type === 'run_enemy_turn';
}
ctx.autoEnemyTurn = () => humans.length <= 1;

async function pump() {
  if (pumping || !session) return;
  pumping = true;
  const mine = session;
  try {
    while (session === mine && !session.state.game.over) {
      if (paused) { thinking = '⏸ AI 진행이 멈춰 있어요'; refreshHud(); await sleep(150); continue; }
      const n = session.nextStep({ autoPublic });
      if (!n) break;
      thinking = n.player ? `${seatLabel(n.player)} 생각 중…` : '';
      refreshHud();
      const range = n.player ? (profiles[seats[n.player].level]?.think_ms ?? [300, 700]) : [250, 250];
      await sleep((range[0] + Math.random() * (range[1] - range[0])) / view.fx.speed);
      if (paused) continue;
      const r = session.step({ autoPublic });
      if (!r) break;
      await present(r.res);
    }
  } finally {
    pumping = false;
    thinking = '';
    if (session === mine) refresh();
  }
}

function refreshHud() {
  if (!state) return;
  $('hud-phase').textContent = phaseLabel(state);
  setHudLine(state);
  if (pumping && !ctx.spectating()) lockInputs();   // AI 차례: 조작만 막고 내 보드 · 손패는 읽기 전용으로 보여 준다(A-6b)
}

function resetMode() {
  const ui = ctx.ui;
  ui.mode = null;
  ui.armed = [];
  ui.bossCards = null;
  if (ui.cardPlay && (state.turn.phase !== 'player_turn' || !canDo(state, ui.cardPlay.char, ui.cardPlay.kind))) ui.cardPlay = null;   // 카드 운용 버전(2026-10-18)
  if (ui.selected && (!state.chars[ui.selected] || state.chars[ui.selected].owner !== state.turn.current_player)) ui.selected = null;
  // 캐릭터마다 행동 n번: 고른 캐릭터가 행동을 다 쓰면 선택을 풀어 플레이어가 다음 캐릭터를 직접 고르게(2026-10-04 사용자 피드백 — 자동 전환 X)
  if (ui.selected && perCharActions(state) && state.turn.phase === 'player_turn' && charActionsLeft(state, ui.selected) <= 0) ui.selected = null;
  // 이동 미리 보기는 그 캐릭터가 아직 이동할 수 있을 때만 유지
  if (ui.preview && (ui.preview.char !== ui.selected || !canDo(state, ui.preview.char, 'move'))) { view.previewClear(ui.preview.char); ui.preview = null; }
}

// 연출 중 · 가리개 표시 중에는 손패 · 행동 바 · 정비/암시장 판을 숨긴다(누를 수 없게)
// 멀리건으로 새로 받은 카드만 모아서 보여 주고, 확인하면 손패로 들어간다(피드백 1-1).
// 엔진은 새로 뽑은 카드를 손패 끝에 붙이므로 마지막 count장이 새 카드다(같은 카드가 다시 나와도 정확함).
// 수색 카드 공개: 덱에서 한 장을 뒤집는 연출(실물처럼 뒷면 → 앞면) 뒤 잠깐 보여 주고 사라진다. 누르면 바로 닫힘.
function revealSearch(e) {
  const sp = Math.max(1, view.fx.speed);
  if (sp >= 20) return Promise.resolve();          // 빠른 진행(건너뛰기 · 자동 테스트)에서는 생략
  const ch = state.chars[e.character];
  const wrap = el('div', 'search-reveal');
  wrap.append(el('div', 'sr-title', `${ch ? ctx.names.charName(ch.char) + ' · ' : ''}? 칸 수색`));
  const flip = el('div', 'sr-flip');
  const cv = cardView(content, ctx.names, e.card);
  const front = renderCard(cv, { size: 'lg' });
  const back = el('div', `${front.className} back`);   // 앞면과 같은 크기의 뒷면
  back.innerHTML = '<div class="card-back-mark">?</div>';
  flip.append(back, front);
  wrap.append(flip);
  wrap.append(el('div', 'sr-hint', '누르면 닫혀요'));
  document.body.append(wrap);
  return new Promise((resolve) => {
    let done = false;
    // 닫힌 뒤에도 무엇을 얻었는지 알림으로 남긴다(2026-10-03 테스터: "? 칸에서 뭘 얻었는지 모름")
    const close = () => { if (done) return; done = true; wrap.classList.add('out'); toast(`? 칸 수색 — ${cv.title}: ${iconText(cv.desc ?? "")}`); setTimeout(() => { wrap.remove(); resolve(); }, 220); };
    wrap.onclick = close;
    setTimeout(() => flip.classList.add('open'), 260 / sp);
    setTimeout(close, 3200 / sp);   // 1.9초는 읽기에 짧았음
  });
}

// (예전 revealMulligan · flyToHand — 멀리건 새 카드 확인 창과 손패로 날아가는 연출, 2026-10-04 — 2026-10-18 확인 창을 없애며 지움)

// 방금 새로 들어온 카드(내 손패 · 가방)를 기억해 두고 빛나게 표시한다(피드백 13). 내가 다음 행동을 하면 사라진다.
function markFresh(before, after) {
  const me = ctx.me();
  if (!before || !me) { ctx.ui.fresh = null; return; }
  const added = (a = [], b = []) => { const left = [...a]; const out = []; for (const x of b) { const i = left.indexOf(x); if (i >= 0) left.splice(i, 1); else out.push(x); } return out; };
  const hand = added(before.players[me]?.hand, after.players[me]?.hand);
  const bag = {};
  for (const ch of Object.values(after.chars)) if (ch.owner === me) { const n = added(before.chars[ch.id]?.bag, ch.bag); if (n.length) bag[ch.id] = n; }
  // 가방의 새 카드는 마우스를 올릴 때까지 표시를 유지(쌓아 둠, 2026-10-04 사용자 피드백) — 가방에서 빠진 카드는 지움
  const fb = (ctx.ui.freshBag ??= {});
  for (const ch of Object.values(after.chars)) {
    if (ch.owner !== me) continue;
    const keep = []; const left = [...ch.bag];
    for (const id of [...(fb[ch.id] ?? []), ...(bag[ch.id] ?? [])]) { const i = left.indexOf(id); if (i >= 0) { left.splice(i, 1); keep.push(id); } }
    fb[ch.id] = keep;
  }
  const any = hand.length || Object.keys(bag).length;
  const mineActed = before.turn.current_player === me && before.turn.phase === 'player_turn';
  if (any) ctx.ui.fresh = { hand, bag };
  else if (mineActed) ctx.ui.fresh = null;
}

function lockInputs() {
  for (const id of ['actions', 'screen']) $(id).classList.add('hidden');
  document.body.classList.add('readonly-hud');
}
function hideInputs() {
  for (const id of ['dock', 'actions', 'hand', 'screen', 'drawer']) $(id).classList.add('hidden');
  shelter?.closeModal();
}

// ---------- 핫싯 가리개 ----------
// 지금 화면을 보고 있어도 되는 사람(비공개 정보를 쥔 쪽): 선택 대기 중이면 그 답을 낼 플레이어,
// 아니면 진행 중인 플레이어 차례 · 정비 차례의 주인. 공개 국면(적 차례 · 챕터 준비 진행 · 암시장 · 게임 종료)은 null(가리개 없음).
function actorFor(s) {
  if (!s || s.game.over) return null;
  const p = s.pending;
  if (p) {
    if (p.type === 'bm_bid' || p.type === 'bm_bid_extra') return p.waiting.find((x) => humans.includes(x)) ?? p.waiting[0] ?? null;   // 플레이어 단위(AC-2)
    return p.player ?? null;
  }
  if (s.turn.phase === 'player_turn') return s.turn.current_player;
  if (s.turn.phase === 'maintenance') return s.game.turn_order.find((x) => !s.maint_done.includes(x)) ?? null;
  return null;
}

// 결정 대기(공격받음 반응 · 고르기 창) 중에 보드 · 손패 · 가방을 누르면: 숨겨 둔 창을 다시 보여 주고 먼저 할 일을 알려 준다.
// 2026-10-18 사용자 피드백("화염병을 던진 뒤 다시 쓰려니 거리에 대상이 없다고 뜨고, 남은 일반 공격도 안 됐다"): 화염병 소음으로 다가온 적의
// 공격 → "공격받음!" 반응 대기 중이었는데, 창이 뜨기 전 · "보드 보기(Tab)"로 숨긴 동안 누른 행동이 아무 안내 없이 거절됐다
function nudgeDecision() {
  const s = state;
  if (!s?.pending || !humans.includes(s.pending.player)) return false;
  const peeked = document.querySelector('.chooser.peek');
  if (peeked) peeked.classList.remove('peek');
  else if (!isChooserOpen()) showDecision(ctx);
  toast(`먼저 할 일 — ${passReason(s)}`);
  return true;
}
ctx.nudgeDecision = nudgeDecision;
// 연출 · AI 진행이 끝날 때까지 기다린다(연달아 내는 액션용 — act는 그동안 조용히 false를 돌려줌). 2026-10-18 정비 판매대 여러 장 팔기
ctx.waitIdle = async (ms = 8000) => { const end = Date.now() + ms; while ((view.playing || pumping) && Date.now() < end) await new Promise((r) => setTimeout(r, 60)); };
function passReason(s) {
  const p = s.pending;
  const R = {
    reaction: '공격받았어요 — 반응을 고르세요 (토큰을 꺼내기 전에)',
    mulligan: '챕터 시작 손패를 확인하고, 원하면 다시 뽑으세요',   // 2026-10-18 멀리건 챕터마다(예전 "처음 손패")
    mission_keep: '미션 카드를 확인하고 손에 남길 카드를 고르세요',
    camp_pick: '캠프에서 가져올 카드를 고르세요',
    discard_to_hand_limit: '손패가 넘쳤어요 — 버릴 카드를 고르세요',
    combo_step: '연속 행동 카드 — 다음 단계를 고르세요',   // 카드 운용 버전(2026-10-19)
    level_up_pick: '레벨업 — 새 카드를 고르세요',
    level_up_remove: '레벨업 — 덱에서 뺄 카드를 고르세요',
    bag_overflow: '가방이 넘쳤어요 — 버릴 카드를 고르세요',
    choose_trap_target: '함정에 걸렸어요 — 대상을 고르세요',
    choose_char: '구원자 특전 — 추가 회복 받을 캐릭터를 고르세요',   // 2026-10-17
    trade_consent: '교환 제안을 확인하세요',
    bm_bid: '암시장 경쟁 — 낼 카드를 몰래 고르세요',
    bm_bid_extra: '암시장 동점 — 한 장 더 몰래 고르세요',
    placement: '캐릭터를 놓을 시작 칸을 고르세요',
  };
  if (p) return R[p.type] ?? '선택할 차례예요';
  if (s.turn.phase === 'maintenance') return '정비할 차례예요';
  return '차례예요';
}

function showPassScreen(actor, s) {
  const box = $('passscreen');
  box.style.setProperty('--pc', PLAYER_COLORS[actor] ?? '#888');
  box.innerHTML = '';
  const card = el('div', 'pass-card');
  card.innerHTML = `<div class="pass-dot"></div><div class="pass-who">${escHtml(actor)}</div><div class="pass-msg">기기를 넘겨받았으면 눌러 주세요.<br>${escHtml(passReason(s))}</div>`;
  const btn = el('button', 'big primary', `${actor}, 확인했어요`);
  btn.onclick = () => { viewerActor = actor; refresh(); };
  card.append(btn);
  box.append(card);
  box.classList.remove('hidden');
}
function hidePassScreen() { $('passscreen').classList.add('hidden'); }
function confirmPass() {
  const btn = $('passscreen').querySelector('button');
  if (btn) btn.click();
}
function escHtml(t) { return String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ---------- 화면 갱신 ----------
function refresh() {
  if (!state) return;
  const s = state;
  sandbox?.sync();   // 테스트 맵 도구(2026-10-17)
  $('hud-phase').textContent = phaseLabel(s);
  setHudLine(s);
  const actor = actorFor(s);
  const humanActor = actor && humans.includes(actor) ? actor : null;   // AI 좌석 차례는 가리개 · 입력이 없다
  ctx.actor = humanActor;
  if (humanActor && humans.length >= 2 && humanActor !== viewerActor) {
    // 확인 전에는 비공개 정보를 하나도 그리지 않는다(가리개가 화면 전체를 덮긴 하지만, 이중으로 안전하게)
    ctx.viewer = null;
    status.render();
    hideInputs();
    showPassScreen(humanActor, s);
    return;
  }
  viewerActor = humanActor;  // 사람 배우가 없으면(공개 국면 · AI 차례) 초기화 — 다음에 사람 배우가 나타나면 다시 확인받는다
  // 비공개 정보를 보여 줘도 되는 사람: 관전이면 전부('*'), 사람 1명이면 그 사람, 여럿이면 가리개를 확인한 지금 배우
  ctx.viewer = humans.length === 0 ? '*' : humans.length === 1 ? humans[0] : humanActor;
  hidePassScreen();
  status.render();
  topbar.render();
  screens.render();
  hud.render();
  renderDrawer();
  if (s.pending && humanActor && !isChooserOpen()) showDecision(ctx);
  updateHighlights();
  updateRangeOverlay();   // 위협 지도(T)는 상태가 바뀔 때마다 다시 계산
  view.setSelected(s.turn.phase === 'player_turn' && !s.pending ? ctx.ui.selected : null);
}

// 내 쉘터 서랍: 켜져 있고 "나"가 있으면 그린다(비공개 정보라 가리개 확인 뒤에만)
// 2026-10-07 사용자 피드백(오늘 11): 서랍이 먼저 올라오고 행동 바가 뒤늦게 따라오던 것을 한 덩어리처럼 —
// 서랍은 아래에서 바 이동거리만큼 같은 시간 · 같은 곡선으로 밀려 올라오고(닫을 땐 반대로), 바는 같은 값으로 bottom을 옮긴다(game3d.html .drawer-in / .drawer-out).
let drawerWasOpen = false;
function renderDrawer() {
  const me = ctx.me();
  const open = shelterOpen && !!me && !state.game.over;
  const d = $('drawer');
  document.body.classList.toggle('shelter-open', open);
  if (open) {
    d.classList.remove('hidden', 'drawer-out');
    if (!drawerWasOpen) { d.classList.remove('drawer-in'); void d.offsetWidth; d.classList.add('drawer-in'); }
    shelter.renderDrawer(d, state, me);
  } else if (drawerWasOpen) {
    d.classList.remove('drawer-in'); d.classList.add('drawer-out');
    d.addEventListener('animationend', () => { if (!shelterOpen || !ctx.me()) d.classList.add('hidden'); d.classList.remove('drawer-out'); }, { once: true });
  } else d.classList.add('hidden');
  drawerWasOpen = open;
}

// 왼쪽 위 줄: 짧게 한 줄만, 긴 도움말은 마우스를 올릴 때(2026-10-04 사용자 피드백 — 칸을 넘침)
function setHudLine(s) {
  const line = hudLine(s);
  let short = line;
  if (s.pending?.type === 'placement' && humans.includes(s.pending.player)) {
    const pc = s.chars[ctx.ui.placeSel];
    short = pc ? `${ctx.names.charName(pc.char)} 배치할 칸 고르기` : '배치할 캐릭터 고르기';
  } else if (line.length > 24) short = line.slice(0, 22) + '…';
  $('hud-acts').textContent = short === line ? line : `${short} ⓘ`;
  $('hud').dataset.tip = short === line ? '' : line;
}
function hudLine(s) {
  if (s.game.over) return '게임이 끝났어요';
  if (thinking) return thinking;
  if (humans.length === 0 && s.turn.phase === 'player_turn') return `${seatLabel(s.turn.current_player)} 차례 (관전)`;
  if (s.pending?.type === 'placement') {
    const pc = s.chars[ctx.ui.placeSel];
    return humans.includes(s.pending.player) ? (pc ? `${s.pending.player} · ${ctx.names.charName(pc.char)}을(를) 화살표가 있는 시작 칸에 놓으세요(캐릭터 보드를 눌러 바꾸기)` : `${s.pending.player} · 왼쪽 아래에서 배치할 캐릭터를 먼저 고르세요`) : `${seatLabel(s.pending.player)} 배치 중`;
  }
  if (s.pending?.type === 'combo_step' && humans.includes(s.pending.player)) return `「${ctx.names.cardName(s.pending.card)}」 ${s.pending.index + 1}/${s.pending.total}단계 · ${s.pending.step === 'move' ? '갈 칸을 누르세요(지금 칸 = 제자리)' : '공격할 대상을 고르세요'}`;   // 2026-10-19
  if (s.pending) return `${s.pending.player ?? ''} 선택을 기다리는 중`;
  if (s.turn.phase === 'player_turn') {
    const pickHint = humans.includes(s.turn.current_player) && !ctx.ui.selected && s.turn.actions_left > 0 ? ' · 행동할 캐릭터를 고르세요(캐릭터 보드 · 피규어)' : '';
    if (cardMode(s)) return `행동할 캐릭터 ${s.turn.actions_left} / ${turnActions(s, s.turn.current_player)} · 손패 카드를 눌러 이동 · 공격(카드 1장 = 1번)`;   // 카드 운용 버전(2026-10-18)
    if (activationMode(s)) return `행동할 캐릭터 ${s.turn.actions_left} / ${turnActions(s, s.turn.current_player)}${pickHint}${ctx.ui.preview ? ' · 이동 미리 보기 중 — 공격하거나 "행동 끝"(Space 또는 Enter)을 누르면 확정, Esc · 원래 칸 = 취소' : ''}`;
    return `남은 행동 ${s.turn.actions_left} / ${turnActions(s, s.turn.current_player)}${pickHint}`;
  }
  return '';
}

// ---------- 보드 칸으로 행동하기(2026-10-01) ----------
// 내 캐릭터가 골라져 있으면 칸마다 할 수 있는 일을 계산한다: 흰색 = 이동, 빨강 = 공격(그 칸의 대상), 노랑 = 지금 칸 상호작용 · 약탈.
// 한 칸에 둘 이상이면 테두리 · 바닥을 다른 색으로 칠하고, 누르면 무엇을 할지 고르는 창을 띄운다.
// grapple = 그래플링 훅을 써야만 갈 수 있는 칸(청록, 라운드당 1회 — 2026-10-01)
const OPT_COLOR = { move: '#FFFFFF', grapple: '#2EE6D6', attack: '#FF4A3A', interact: '#FFD23F', loot: '#FFD23F', back: '#9FE6FF' };
const OPT_ORDER = { attack: 0, interact: 1, loot: 1, move: 2, grapple: 2, back: 3 };   // 테두리에 쓸 색 우선순위
let cellOpts = null;       // Map<cellId, [{ kind, ... }]>
function boardMode(s) {
  const ui = ctx.ui;
  if (!s || s.pending || s.turn.phase !== 'player_turn' || ui.mode || !ui.selected) return null;
  if (!humans.includes(s.turn.current_player)) return null;
  const ch = s.chars[ui.selected];
  if (!ch || ch.owner !== s.turn.current_player || ch.exhausted || !ch.cell || charActionsLeft(s, ch.id) <= 0) return null;
  return ch;
}
// ---------- 활성화 방식: 이동 미리 보기(2026-10-04 사용자 결정 — 수정 사항 신규 9) ----------
// 이동 칸을 누르면 엔진에 내지 않고 피규어만 옮겨 봄(ui.preview). 공격하거나 "행동 끝"을 누를 때 이동이 확정된다.
// 미리 본 자리 기준으로 공격 대상 · 상호작용을 보여 준다(pvState = 미리 본 자리를 반영한 읽기 전용 상태).
function pvState(s = state) {
  const p = ctx.ui.preview;
  if (!p || !s?.chars[p.char]) return s;
  return { ...s, chars: { ...s.chars, [p.char]: { ...s.chars[p.char], cell: p.cell } } };
}
function setPreview(chId, info) {
  const real = state.chars[chId].cell;
  const cell = info ? info.path[info.path.length - 1] : real;
  ctx.ui.preview = info ? { char: chId, cell, info } : null;
  view.previewMove(chId, cell);
  if (!info) view.previewClear(chId);
  refresh();
}
function clearPreview() {
  const p = ctx.ui.preview;
  if (!p) return;
  ctx.ui.preview = null;
  if (state?.chars[p.char]?.cell) view.previewMove(p.char, state.chars[p.char].cell, { instant: true });
  view.previewClear(p.char);
}
// 미리 본 이동을 엔진에 낸다. 이어서 공격 · 상호작용을 해도 되면 true(반응 창 같은 결정이 생기면 false)
async function commitMove() {
  const p = ctx.ui.preview;
  if (!p) return true;
  const ok = await act({ type: 'move', character: p.char, path: p.info.path, cards: ctx.armedCards('on_move') });
  if (ok) ctx.ui.preview = null;
  return ok && !state.pending;
}
// "행동 끝": 미리 본 이동 확정 → 그 칸에서 할 수 있는 상호작용(못 하면 상호작용 없이 끝)
async function endActivation(chId) {
  if (!state || view.playing || pumping) return;
  if (!(await commitMove())) return;
  const ch = state.chars[chId];
  if (!ch || !canDo(state, chId, 'end')) return;
  const inter = interactInfo(state, content, chId);
  if (inter.ok) ctx.doInteract(state, ch, inter);
  else await act({ type: 'end_activation', character: chId });
}
ctx.endActivation = endActivation;
ctx.commitMove = commitMove;   // hud.js: 교환 · 옆 아군 대상 카드 · 아이템 대상 고르기 전에 미리 본 이동 확정(2026-10-18)
// 카드 대상 적을 보드에서 고르기(약점 파악 등, 2026-10-17): 미리 본 이동이 있으면 먼저 확정하고(그 자리 기준 사거리),
// 사거리 안의 적만 빨갛게 → 그 적(또는 칸)을 누르면 카드 사용. Esc로 취소(ui.mode를 비우는 기존 Esc 처리)
async function pickCardTarget(charId, cardId) {
  if (!state || view.playing || pumping) return;
  if (!(await commitMove())) return;
  const list = attackTargets(state, content, charId).filter((t) => t.kind === 'foe');
  if (!list.length) { toast('사거리 안에 대상 적이 없어요'); return; }
  ctx.ui.selected = charId; ctx.ui.mode = 'cardtarget'; ctx.ui.cardTarget = { card: cardId, char: charId, ids: list.map((t) => t.id) };
  refresh();
}
ctx.pickCardTarget = pickCardTarget;
// "차례 종료"(2026-10-17): 미리 본 이동이 있으면 먼저 확정하고 끝낸다(예전엔 미리 보기가 그냥 사라졌음).
// 아직 "행동 끝"을 안 한 캐릭터는 엔진(end_turn)이 지금 칸에서 자동으로 행동 끝 · 상호작용한다.
async function endTurn(player) {
  if (!state || view.playing || pumping) return;
  if (!(await commitMove())) return;
  await act({ type: 'end_turn', player });
}
ctx.endTurn = endTurn;
ctx.previewOf = () => ctx.ui.preview;
function computeCellOpts(s, ch) {
  const out = new Map();
  const add = (cell, o) => { if (!out.has(cell)) out.set(cell, []); out.get(cell).push(o); };
  // 카드 운용 버전(2026-10-18 사용자 결정): 카드를 고르면 그 캐릭터의 이동 범위(이동 카드) · 공격 범위(공격 카드)만. 고른 카드가 없으면
  // 지금 칸의 상호작용(행동 끝 때)만 표시. 이동 미리 보기는 없음 — 카드를 내는 순간 확정
  if (cardMode(s)) {
    const cp = ctx.ui.cardPlay?.char === ch.id ? ctx.ui.cardPlay : null;
    const sk = cp?.as === 'skill' ? content.cards[cp.card].effect : [];
    reach = new Map(); targets = [];
    if (cp?.kind === 'move') {
      const bonus = sk.filter((b) => b.block === 'move_bonus').reduce((n, b) => n + b.amount, 0);
      const pass = sk.find((b) => b.block === 'grant_status' && b.status === 'pass_through_enemies');
      reach = reachableCells(s, content, ch.id, { bonus, passThrough: pass ? (pass.count ?? Infinity) : 0 });
      for (const [cell, info] of reach) if (info.path.length) add(cell, { kind: info.grapple ? 'grapple' : 'move', info });
    } else if (cp?.kind === 'attack') {
      const rb = sk.filter((b) => b.block === 'range_bonus').reduce((n, b) => n + b.amount, 0);
      targets = attackTargets(s, content, ch.id, { rangeBonus: rb });
      for (const t of targets) add(targetCell(t), { kind: 'attack', target: t });
      if (cp.as === 'basic') for (const x of Object.values(s.chars)) if (x.exhausted && x.cell && isNear(s, content, x.cell, ch.cell) && x.id !== ch.id && x.bag.length) add(x.cell, { kind: 'loot', target: x });
    }
    const inter = interactInfo(s, content, ch.id);
    if (inter.ok) add(ch.cell, { kind: 'interact', inter, info: true });
    return out;
  }
  if (activationMode(s)) {
    const pv = pvState(s);
    const at = pv.chars[ch.id].cell;
    reach = canDo(s, ch.id, 'move') ? reachableCells(s, content, ch.id, { bonus: ctx.armedBonus?.('move_bonus') ?? 0 }) : new Map();
    for (const [cell, info] of reach) if (info.path.length && cell !== at) add(cell, { kind: info.grapple ? 'grapple' : 'move', info });
    if (ctx.ui.preview && ctx.ui.preview.char === ch.id) add(ch.cell, { kind: 'back' });   // 원래 칸을 누르면 미리 보기 취소
    if (canDo(s, ch.id, 'attack')) {
      targets = attackTargets(pv, content, ch.id, { rangeBonus: ctx.armedBonus?.('range_bonus') ?? 0 });
      for (const t of targets) add(targetCell(t), { kind: 'attack', target: t });
      for (const x of Object.values(pv.chars)) if (x.exhausted && x.cell && isNear(pv, content, x.cell, at) && x.id !== ch.id && x.bag.length) add(x.cell, { kind: 'loot', target: x });
    } else targets = [];
    const inter = interactInfo(pv, content, ch.id);
    if (inter.ok) add(at, { kind: 'interact', inter, info: true });   // 표시만(상호작용은 "행동 끝"에서)
    return out;
  }
  reach = reachableCells(s, content, ch.id, { bonus: ctx.armedBonus?.('move_bonus') ?? 0 });
  for (const [cell, info] of reach) if (info.path.length) add(cell, { kind: info.grapple ? 'grapple' : 'move', info });
  targets = attackTargets(s, content, ch.id, { rangeBonus: ctx.armedBonus?.('range_bonus') ?? 0 });
  for (const t of targets) add(targetCell(t), { kind: 'attack', target: t });
  const inter = interactInfo(s, content, ch.id);
  if (inter.ok) add(ch.cell, { kind: 'interact', inter });
  // 약탈: 같은 칸 또는(한 칸에 하나 규칙) 옆 칸의 쓰러진 캐릭터 — 쓰러진 피규어가 있는 칸에 표시
  for (const x of Object.values(s.chars)) if (x.exhausted && x.cell && isNear(s, content, x.cell, ch.cell) && x.id !== ch.id && x.bag.length) add(x.cell, { kind: 'loot', target: x });
  return out;
}
function optLabel(o) {
  const N = ctx.names;
  if (o.kind === 'back') return '원래 칸으로(미리 보기 취소)';
  if (o.kind === 'interact' && o.info) return `행동 끝 때 상호작용: ${N.t('celltype.' + o.inter.type, o.inter.type)}`;
  if (o.kind === 'move' && cardMode(state)) return `이동 (이동력 ${o.info.cost})`;
  if (o.kind === 'move' && activationMode(state)) return `여기로 이동해 보기 (이동력 ${o.info.cost}) — 공격 · 행동 끝 때 확정`;
  if (o.kind === 'move') return `이동 (이동력 ${o.info.cost})`;
  if (o.kind === 'grapple') return `이동 · 그래플링 사용 (이동력 ${o.info.cost}, 라운드에 1번)`;
  if (o.kind === 'attack') {
    const t = o.target;
    if (t.kind === 'char') { const x = state.chars[t.id]; return `공격: ${N.charName(x.char)}(${x.owner}) ♥${x.hp}`; }
    const f = state.enemies[t.id] ?? state.bosses[t.id];
    return `공격: ${N.foeName(f)} ♥${f.hp}`;
  }
  if (o.kind === 'interact') return `상호작용: ${N.t('celltype.' + o.inter.type, o.inter.type)}`;
  if (o.kind === 'loot') return `약탈: ${N.charName(o.target.char)}(${o.target.owner})`;
  return o.kind;
}
function runOpt(o, ch) {
  if (o.kind === 'move' || o.kind === 'grapple') return moveTo(ch.id, o.info);
  if (o.kind === 'attack') return attack(o.target.id);
  if (o.kind === 'interact') return ctx.doInteract(state, ch, o.inter);
  if (o.kind === 'loot') return ctx.lootMenu(state, ch, o.target);
}
// 이동: 그래플링이 있어야만 가는 칸이면 한 번 묻는다(그래플링 훅은 라운드에 1번 — 쓰면 카드가 눕는다)
function moveTo(chId, info) {
  // 카드 운용 버전: 고른 카드로(기본 아이콘 basic · 스킬 cards, 2026-10-18)
  const go = () => act(cardMode(state) ? { type: 'move', character: chId, path: info.path, ...ctx.cardPay('move') } : { type: 'move', character: chId, path: info.path, cards: ctx.armedCards('on_move') });
  if (!info.grapple) return go();
  openChooser({
    title: '그래플링 훅을 쓸까요?', subtitle: '이 칸은 그래플링 훅이 있어야 갈 수 있어요. 이번 라운드에 1번만 쓸 수 있고, 쓰면 카드가 옆으로 눕혀져요(라운드가 끝나면 다시 세워짐).',
    items: [{ view: optionView('그래플링 사용 · 이동', `이동력 ${info.cost} · 경로 ${info.path.length}칸`, { glyph: '🪝', band: '#1F8F86' }), value: 'go' }],
    instant: true, buttons: [{ label: '취소' }],
    onPick: () => go(),
  });
}

// 보드에서 고른 행동은 확인 버튼을 눌러야 실행(2026-10-04 사용자 피드백 28 — 내 피규어를 눌렀는데 칸 상호작용이 바로 되던 문제).
// 누른 자리 옆에 작은 창: 할 수 있는 일을 버튼으로 + 취소. 공격 · 약탈 · 그래플링 · 드러난 보급품 고르기는 자기 창이 곧 확인이라 바로 연다.
const selfConfirming = (o) => o.kind === 'attack' || o.kind === 'loot' || o.kind === 'grapple' || (o.kind === 'interact' && o.inter.type === 'supply' && (o.inter.open ?? []).some(Boolean));
function pickOpt(opts, ch, pieceId) {
  // 말(적 · 캐릭터)을 직접 눌렀으면 그 대상 공격을 우선 후보로
  const direct = pieceId ? opts.filter((o) => o.kind === 'attack' && o.target.id === pieceId) : [];
  const list = direct.length === 1 && opts.length === 1 ? direct : opts;
  if (list.length === 1 && selfConfirming(list[0])) return runOpt(list[0], ch);
  const N = ctx.names;
  const left = charActionsLeft(state, ch.id);
  const mv = list.find((o) => o.kind === 'move');
  openChooser({
    near: true, peek: false, hideConfirm: true, items: [], min: 0, max: 0,
    title: list.length === 1 ? '이렇게 할까요?' : '무엇을 할까요?',
    subtitle: `${N.charName(ch.char)} · 행동 1회 사용 (남은 행동 ${left})${mv ? ` · 경로 ${mv.info.path.length}칸` : ''}`,
    buttons: [...list.map((o) => ({ label: optLabel(o), primary: true, onClick: () => runOpt(o, ch) })), { label: '취소' }],
  });
}

// 칸에 마우스를 올리면 마우스 옆에 할 수 있는 일을 글자로
let mouseXY = [0, 0];
let hoverCell = null;      // 지금 마우스가 올라가 있는 칸(상태가 바뀌면 그 칸 글자도 다시 그린다)
addEventListener('pointermove', (e) => { mouseXY = [e.clientX, e.clientY]; const r = $('hovercards'); if (r && !r.hidden) placeCellTip(r); }, { passive: true });
// 카드 줄은 마우스 오른쪽에, 화면 오른쪽 끝에 닿으면 왼쪽에(왼쪽에서 오른쪽 순서는 그대로 — 중요한 정보가 항상 왼쪽). 세로는 화면 안으로
function placeCellTip(t) {
  const w = t.offsetWidth, h = t.offsetHeight;
  const x = mouseXY[0] + 18 + w > innerWidth - 8 ? Math.max(8, mouseXY[0] - 18 - w) : mouseXY[0] + 18;
  const y = Math.min(Math.max(8, mouseXY[1] - h / 3), Math.max(8, innerHeight - h - 8));
  t.style.left = `${x}px`; t.style.top = `${y}px`;
}
// 칸 말풍선(2026-10-02 피드백): 어느 칸에서든 지명 · 칸 기능 · 지형을 먼저 보여 주고, 아래에 지금 할 수 있는 행동
function cellFacts(c) {
  const N = ctx.names;
  const fill = (k, vars) => Object.entries(vars).reduce((s, [a, b]) => s.replaceAll(`{${a}}`, b), N.t(k, ''));
  const dz = map.enemy_cells?.reveal === 'danger_zone';
  const out = [fill(dz && c.type === 'enemy' ? 'celltip.type.enemy_dz' : `celltip.type.${c.type}`, { n: c.amount ?? 1, r: map.enemy_cells?.radius ?? 2 })];
  if (W.isDanger?.(c.id)) out.push(N.t('celltip.danger'));
  if (c.inactive_type) out.push(`${c.min_players}인 이상일 때만 쓰는 칸(${N.t(`celltip.type.${c.inactive_type}`, c.inactive_type).split(' — ')[0]}) — 이번 판은 빈 길`);
  if (c.terrain === 'rough') out.push(N.t('celltip.rough'));
  if (c.terrain === 'obstacle') out.push(N.t('celltip.obstacle'));
  if (c.biome === 'bridge') out.push(N.t('celltip.bridge'));
  if (c.zone) out.push(fill('celltip.zone', { color: N.t(`celltip.zone.${c.zone}`, c.zone) }));
  // 중앙 보상(2026-10-04): 등급과 보너스
  const tr = state?.config.center_reward ? cellTier(map, c.id) : 0;
  if (tr) {
    const b = tierBonus(state.config, tr);
    const parts = [b.amount ? `금품 · 부품 +${b.amount}` : '', b.extra_card ? `보급품 · 조사 카드 +${b.extra_card}장` : '', b.vp ? `상호작용 {vp}+${b.vp}` : ''].filter(Boolean);
    out.push(`${tr === 2 ? '★ 중앙 지역' : '중간 지역'} — ${parts.join(' · ')}`);
  }
  if (c.secret) out.push(fill(`celltip.secret.${c.secret_dir ?? 'both'}`, { m: c.secret }));
  if (state && !['empty', 'start', 'enemy', 'camp'].includes(c.type)) {
    const uses = cellUsesOf(map, state.game.turn_order.length, c);
    const usedN = state.board.markers.filter((x) => x === c.id).length;
    if (usedN >= uses) out.push(N.t('celltip.marked'));
    else if (uses > 1) out.push(`이번 챕터 남은 횟수 ${uses - usedN}/${uses} (캐릭터마다 1번)`);
    const sel = state.chars[ctx.ui.selected];
    if (sel && usedN < uses && (state.board.cell_users?.[c.id] ?? []).includes(sel.id)) out.push(N.t('error.cell_used_by_you'));
  }
  return out.filter(Boolean);
}
// (예전 cellUnits · tierHint — 칸 안 캐릭터 · 적을 말풍선 글자 한 줄로 요약하던 함수 — 는 2026-10-07 호버 카드로 대체되어 지움: 아래 showCellTip)
// 칸 · 피규어에 마우스를 올렸을 때 정보(2026-10-07 사용자 피드백 10-03 항목 9 · 15 · 16):
//   하나로 몰아 쓰지 않고 카드 · 툴팁이 따로 뜨며, 중요한 순서대로 왼쪽부터 — 캐릭터 카드 > 적 카드 > 칸 정보(칸 말풍선) > 아이콘 설명(UI 쪽 data-tip).
//   (적 · 내 캐릭터가 있는 칸은 이름 · 능력치 한 줄 대신 진짜 카드 — 예전 cellUnits 한 줄 요약을 대체)
function ensureHoverRow() {
  let row = $('hovercards');
  if (!row) { row = el('div', null); row.id = 'hovercards'; row.hidden = true; document.body.append(row); }
  return row;
}
function showCellTip(cellId) {
  const row = ensureHoverRow();
  let t = $('celltip');
  if (!t) { t = el('div', null); t.id = 'celltip'; t.hidden = true; }
  const c = cellId && cellOf(map, cellId);
  if (!c) { t.hidden = true; row.hidden = true; return; }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const opts = cellOpts?.get(cellId) ?? [];
  t.innerHTML = `<div class="ct-name">${esc(ctx.names.cellName(c.id))}</div>`
    + cellFacts(c).map((f) => `<div class="ct-fact">${iconHtml(esc(f))}</div>`).join('')
    + (opts.length ? `<div class="ct-opts">${opts.map((o) => `<div><i style="background:${OPT_COLOR[o.kind]}"></i>${optLabel(o)}</div>`).join('')}</div>` : '')
    + (opts.length > 1 ? '<small>누르면 고르기</small>' : '');
  // 카드 줄 다시 만들기: 캐릭터 → 적 → 칸 정보
  row.innerHTML = '';
  if (state) {
    const ec = { s: state, c: content, map };
    for (const ch of Object.values(state.chars).filter((x) => x.cell === c.id)) row.append(renderCard(charInfoView(ec, ctx.names, ch, PLAYER_COLORS[ch.owner]), { size: 'sm' }));
    for (const f of [...Object.values(state.enemies), ...Object.values(state.bosses)].filter((x) => x.cell === c.id)) {
      row.append(renderCard(foeView(content, ctx.names, f, state.game.chapter, state.bosses[f.uid] ? null : map.enemy_mods), { size: 'sm' }));
    }
  }
  row.append(t);
  t.hidden = false;
  row.hidden = false;
  placeCellTip(row);
}

// 보드 강조: 배치 · 부활 가능한 시작 칸 / 칸별 행동(이동 · 공격 · 상호작용) / 보스 소환 칸
// 내 차례: 행동이 남은 내 캐릭터 머리 위 화살표(다 쓴 캐릭터는 안 보임)
function markActionable(s) {
  const P = s?.turn.current_player;
  const on = s && !s.pending && s.turn.phase === 'player_turn' && humans.includes(P) && !pumping
    ? Object.values(s.chars).filter((c) => c.owner === P && !c.exhausted && c.cell && charActionsLeft(s, c.id) > 0).map((c) => c.id) : [];
  view.setActionable(on);
}
function updateHighlights() {
  const s = state;
  const ui = ctx.ui;
  if (ui.preview && ui.preview.char !== ui.selected) clearPreview();   // 다른 캐릭터를 고르면 미리 보기 취소
  const hl = new Map();
  reach = null;
  targets = null;
  cellOpts = null;
  const bm = boardMode(s);
  if (bm) {
    cellOpts = computeCellOpts(s, bm);
    for (const [cell, opts] of cellOpts) {
      const kinds = [...new Set(opts.map((o) => (o.kind === 'loot' ? 'interact' : o.kind)))].sort((a, b) => OPT_ORDER[a] - OPT_ORDER[b]);
      hl.set(cell, kinds.length === 1 ? OPT_COLOR[kinds[0]] : [OPT_COLOR[kinds[0]], OPT_COLOR[kinds[1]]]);
    }
    if (hoverPath) for (const c of hoverPath.slice(0, -1)) if (!cellOpts.has(c)) hl.set(c, '#9FE6FF');
    view.setCellArrows([]); view.setDim([]);
    view.setHighlight(hl);
    markActionable(s);
    showCellTip(hoverCell);
    return;
  }
  showCellTip(hoverCell);   // 행동을 고르지 않을 때도 칸 정보(지명 · 기능)는 보여 준다
  if (s.pending?.type !== 'placement' && s.pending?.type !== 'combo_step') { view.setCellArrows([]); view.setDim([]); }
  // 연속 행동 이동 단계(2026-10-19): 갈 수 있는 칸(초록) · 지금 칸(하늘색) + 화살표 · 나머지 어둡게
  if (s.pending?.type === 'combo_step' && s.pending.step === 'move' && humans.includes(s.pending.player)) {
    const here = s.chars[s.pending.character]?.cell;
    for (const id of s.pending.options) hl.set(id, id === here ? '#9FE6FF' : '#7FE28A');
    view.setCellArrows(s.pending.options.length <= 8 ? s.pending.options : []);
    view.setDim(map.cells.map((c) => c.id).filter((id) => !hl.has(id)));
  }
  markActionable(s);
  const emptyStarts = () => map.cells.filter((c) => c.type === 'start' && !Object.values(s.chars).some((x) => x.cell === c.id)).map((c) => c.id);
  if (s.pending?.type === 'placement') {
    // 엔진과 같은 규칙(모두 막혔으면 시작 칸 옆 빈 칸). 놓을 캐릭터를 고른 뒤에만 화살표
    const picked = !!s.chars[ui.placeSel] && s.chars[ui.placeSel].cell == null;
    const starts = humans.includes(s.pending.player) && picked ? placeableCells(s, content) : [];
    for (const id of starts) hl.set(id, '#3FD8FF');
    // 2026-10-18 처음 보는 플레이어 테스트(사용자 결정 D2): 캐릭터를 고르기 전에는 놓을 칸이 안 보여 보드를 6번 헛침 →
    // 고르기 전에도 놓을 수 있는 칸만 옅게(캐릭터를 미리 골라 두지는 않음 — 2026-10-04 결정 유지). 고르면 지금처럼 진하게 + 화살표 + 나머지 어둡게
    if (!picked && humans.includes(s.pending.player)) for (const id of placeableCells(s, content)) hl.set(id, '#9FE6FF');
    view.setCellArrows(starts);
    view.setDim(starts.length ? map.cells.map((c) => c.id).filter((id) => !starts.includes(id)) : []);
  } else if (!s.pending && s.turn.phase === 'player_turn' && ui.selected) {
    if (ui.mode === 'move') {
      reach = reachableCells(s, content, ui.selected, { bonus: ctx.armedBonus?.('move_bonus') ?? 0 });
      for (const [cell, info] of reach) if (info.path.length) hl.set(cell, info.grapple ? OPT_COLOR.grapple : '#3FD8FF');
      if (hoverPath) for (const c of hoverPath) hl.set(c, '#9FE6FF');
    } else if (ui.mode === 'attack') {
      targets = attackTargets(s, content, ui.selected, { rangeBonus: ctx.armedBonus?.('range_bonus') ?? 0 });
      for (const t of targets) hl.set(targetCell(t), '#FF4A3A');
    } else if (ui.mode === 'revive') {
      for (const id of emptyStarts()) hl.set(id, '#3FE07A');
    } else if (ui.mode === 'hitrun' && ui.hitRun) {
      // 사냥꾼 "치고 빠지기": 이동할 수 있는 칸(최대 2칸) + 지금 칸을 초록으로(2026-10-08)
      for (const id of ui.hitRun.cells) hl.set(id, '#7FE28A');
    } else if (ui.mode === 'pickcell' && ui.pickItem) {
      const at = s.chars[ui.selected]?.cell;
      for (const c of map.cells) if (at && segDistOf(at, c.id) <= ui.pickItem.range) hl.set(c.id, '#FFB74D');
    } else if (ui.mode === 'cardtarget' && ui.cardTarget) {
      for (const id of ui.cardTarget.ids) { const f = s.enemies[id] ?? s.bosses[id]; if (f) hl.set(f.cell, '#FF5A4A'); }
    } else if (ui.mode === 'boss') {
      // 보스를 놓을 수 있는 칸만(엔진 판정 — 구역 색 · 시작 칸 · 빈 칸) 밝은 초록으로(2026-10-17 사용자 피드백 "어딜 골라야 될지 모르겠다":
      // 예전엔 구역 칸 전부를 보라로 칠해 구역 색과 섞였고, 놓을 수 없는 칸까지 빛났다)
      for (const c of map.cells) if (c.zone && check(s, content, { type: 'spawn_boss', player: s.turn.current_player, cards: ui.bossCards, cell: c.id }).ok) hl.set(c.id, '#3FE07A');
    }
    // 효과로 칸을 고르는 모드(보스 탐색 · 부활 칸 · 치고 빠지기 · 칸 고르기 아이템 · 카드 대상 적): 고를 수 있는 칸에 화살표 + 나머지 칸 어둡게 —
    // 배치(시작 칸)와 같은 방식(2026-10-18 사용자 요청 "보스 부를 수 있는 칸도 시작 위치처럼 활성화 — 효과로 어떤 칸에 상호작용할 수 있다면
    // 그 칸이 활성화되어 보여야 해"). 예전엔 칸 색만 칠해서 구역 색 · 칸 종류 색 위에서 잘 안 보였음. 칸이 많으면(소음 칸 고르기 등) 화살표는 생략
    if (EFFECT_PICK.has(ui.mode)) {
      const ids = [...hl.keys()];
      view.setCellArrows(ids.length <= 8 ? ids : []);
      view.setDim(ids.length ? map.cells.map((c) => c.id).filter((id) => !hl.has(id)) : []);
    }
  }
  view.setHighlight(hl);
}
const EFFECT_PICK = new Set(['boss', 'revive', 'hitrun', 'pickcell', 'cardtarget']);

function targetCell(t) {
  return t.kind === 'char' ? state.chars[t.id].cell : (state.enemies[t.id] ?? state.bosses[t.id]).cell;
}
function bossColor() {
  for (const id of ctx.ui.bossCards ?? []) {
    const cd = content.cards[id];
    if (cd.kind === 'investigation' && !cd.wild) return cd.color;
  }
  return null;
}

// ---------- 보드 클릭 ----------
function onBoardClick({ pieceId, cellId }) {
  if (!state || view.playing || isManualOpen() || !$('passscreen').classList.contains('hidden')) return;
  if (isChooserOpen()) { if (state.pending && document.querySelector('.chooser.peek')) toast('보드 보기 중이에요 — <kbd>Tab</kbd>(창 다시 보기)으로 돌아가 먼저 고르세요'); return; }   // 2026-10-18
  const s = state;
  const ui = ctx.ui;
  // 테스트 도구의 "칸 고르기"(2026-10-17): 국면과 상관없이 누른 칸을 넘긴다
  if (ui.mode === 'sandbox' && ui.sandboxPick) {
    const cell = cellId ?? (pieceId ? view.pieceCell(pieceId) : null);
    const cb = ui.sandboxPick; ui.mode = null; ui.sandboxPick = null;
    if (cell) cb(cell);
    refresh();
    return;
  }
  // 배치: 빈 시작 칸 클릭
  if (s.pending?.type === 'placement' && humans.includes(s.pending.player)) {
    const cell = cellId ?? view.pieceCell(pieceId);
    // 놓을 캐릭터: 캐릭터 보드에서 고른 캐릭터(아직 안 놓은 것). 안 골랐으면 먼저 고르라고 안내(2026-10-04 사용자 피드백 — 미리 골라 두지 않음)
    const sel = s.chars[ui.placeSel];
    const ch = sel && sel.owner === s.pending.player && sel.cell == null ? sel : null;
    if (!ch) { toast('먼저 배치할 캐릭터를 고르세요 (왼쪽 아래 빛나는 캐릭터 보드)'); return; }
    if (cell) act({ type: 'place_character', player: s.pending.player, character: ch.id, cell });
    return;
  }
  // 연속 행동 카드의 이동 단계(2026-10-19): 보드에서 갈 칸을 누름(지금 칸 = 제자리)
  if (s.pending?.type === 'combo_step' && s.pending.step === 'move' && humans.includes(s.pending.player)) {
    const cell = cellId ?? (pieceId ? view.pieceCell(pieceId) : null);
    if (cell && s.pending.options.includes(cell)) act({ type: 'choose', player: s.pending.player, choice: cell });
    else toast('빛나는 칸을 누르세요 — 지금 칸을 누르면 제자리');
    return;
  }
  if (s.pending && nudgeDecision()) return;   // 2026-10-18: 결정 대기 중이면 창을 다시 띄우고 안내(예전엔 아무 반응 없음)
  if (s.pending || s.turn.phase !== 'player_turn' || !humans.includes(s.turn.current_player)) return;
  const P = s.turn.current_player;
  const cell = cellId ?? (pieceId ? view.pieceCell(pieceId) : null);

  if (ui.mode === 'move' && reach) {
    const info = cell && reach.get(cell);
    if (info?.path.length) { moveTo(ui.selected, info); return; }
  }
  if (ui.mode === 'attack' && targets) {
    let list = pieceId ? targets.filter((t) => t.id === pieceId) : [];
    if (!list.length && cell) list = targets.filter((t) => targetCell(t) === cell);
    if (list.length === 1) { attack(list[0].id); return; }
    if (list.length > 1) {
      openChooser({
        title: '공격 대상', subtitle: '같은 칸에 대상이 여럿이에요.',
        items: list.map((t) => ({
          view: t.kind === 'char' ? portraitView(content, ctx.names, s.chars[t.id], PLAYER_COLORS[s.chars[t.id].owner]) : foeView(content, ctx.names, s.enemies[t.id] ?? s.bosses[t.id], s.game.chapter, s.bosses[t.id] ? null : map.enemy_mods),
          value: t.id, note: `거리 ${t.distance}`,
        })),
        buttons: [{ label: '취소' }],
        onPick: ([id]) => attack(id),
      });
      return;
    }
  }
  if (ui.mode === 'revive' && cell) { act({ type: 'revive_infirmary', player: P, character: ui.selected, cell }); return; }
  if (ui.mode === 'boss' && cell) { act({ type: 'spawn_boss', player: P, cards: ui.bossCards, cell }); return; }
  if (ui.mode === 'cardtarget' && ui.cardTarget) {   // 카드 대상 적(2026-10-17)
    const t = ui.cardTarget;
    const id = t.ids.find((x) => x === pieceId) ?? t.ids.find((x) => (s.enemies[x] ?? s.bosses[x])?.cell === cell);
    if (!id) { toast('빨갛게 빛나는 적을 누르세요 (<kbd>Esc</kbd> 취소)'); return; }
    ui.mode = null; ui.cardTarget = null;
    act({ type: 'play_card', character: t.char, card: t.card, target: id });
    return;
  }
  if (ui.mode === 'hitrun' && cell && ui.hitRun) { if (ui.hitRun.cells.includes(cell)) hitRunTarget(cell); return; }
  if (ui.mode === 'pickcell' && cell && ui.pickItem) { const it = ui.pickItem; ui.mode = null; ui.pickItem = null; act({ type: 'use_item', character: ui.selected, item: it.id, cell }); return; }

  // 내 다른 캐릭터를 누르면 그 캐릭터로 바꾼다
  const ch = pieceId && s.chars[pieceId];
  if (ch && ch.owner === P && ch.id !== ui.selected) {
    // 카드 운용 버전: 공용 카드를 고른 채로 다른 내 캐릭터를 누르면 그 캐릭터가 그 카드를 씀(전용 카드는 주인만 — 고른 카드 풀기, 2026-10-18)
    const cp = cardMode(s) ? ui.cardPlay : null;
    if (cp && (!content.cards[cp.card].char || cp.as === 'basic') && canDo(s, ch.id, cp.kind)) ui.cardPlay = { ...cp, char: ch.id };   // 기본 기능은 누구나(2026-10-19)
    else ui.cardPlay = null;
    ui.selected = ch.id; ui.mode = null; ui.armed = [];
    refresh();
    return;
  }
  // 칸 색으로 행동: 그 칸에서 할 수 있는 일이 하나면 바로, 여럿이면 고르는 창
  const me = boardMode(s);
  const opts = me && cell && cellOpts?.get(cell);
  // 쓰러진 캐릭터를 눌렀는데 약탈할 수 없으면 이유를 알려 준다(2026-10-18 사용자 피드백 "탈진한 적 캐릭터를 조사할 수 없었다" — 아무 반응이 없었음)
  const downed = me && cell && Object.values(s.chars).find((x) => x.exhausted && x.cell === cell && x.id !== me.id);
  if (downed && !opts?.some((o) => o.kind === 'loot' || o.kind === 'attack')) {
    const at = pvState(s).chars[me.id].cell;
    toast(!downed.bag.length ? `${ctx.names.charName(downed.char)}(${downed.owner})의 가방이 비어 있어 약탈할 카드가 없어요`
      : !isNear(pvState(s), content, downed.cell, at) ? '약탈하려면 쓰러진 캐릭터 바로 옆 칸에 서야 해요'
      : !canDo(s, me.id, 'attack') ? '이번 활성화에 이미 공격(약탈)했어요 — 약탈은 공격 1번을 써요'
      : '지금은 약탈할 수 없어요');
    return;
  }
  // 카드 운용 버전(2026-10-18): 고른 카드가 있으면 이동 칸 = 바로 이동 · 적 = 공격 창 · 쓰러진 캐릭터 = 약탈. 고른 카드가 없으면 안내
  if (me && cardMode(s)) {
    $('celltip') && ($('celltip').hidden = true); $('hovercards') && ($('hovercards').hidden = true);
    const acts = (opts ?? []).filter((o) => !o.info || o.kind === 'move' || o.kind === 'grapple');
    if (!ui.cardPlay) {
      if (cell && cell !== me.cell) toast('먼저 손패에서 카드를 고르세요 — 이동 카드면 이동 범위, 공격 카드면 공격 범위가 보여요');
      return;
    }
    const atk = acts.filter((o) => o.kind === 'attack');
    const direct = pieceId ? atk.filter((o) => o.target.id === pieceId) : [];
    if (direct.length === 1 || atk.length === 1) { attack((direct[0] ?? atk[0]).target.id); return; }
    if (atk.length > 1) { pickOpt(atk, me, pieceId); return; }
    const loot = acts.find((o) => o.kind === 'loot');
    if (loot) { ctx.lootMenu(state, me, state.chars[loot.target.id]); return; }
    const mv = acts.find((o) => o.kind === 'move' || o.kind === 'grapple');
    if (mv) { moveTo(me.id, mv.info); return; }
    if (cell) toast(ui.cardPlay.kind === 'move' ? '흰 칸(이동 범위)을 누르세요' : '빨간 대상(공격 범위)을 누르세요');
    return;
  }
  // 활성화 방식: 이동 칸 = 미리 보기(확정 없음), 원래 칸 = 미리 보기 취소, 적 = 공격 창(이동과 함께 확정), 쓰러진 캐릭터 = 약탈
  if (me && activationMode(s) && opts?.length) {
    $('celltip') && ($('celltip').hidden = true); $('hovercards') && ($('hovercards').hidden = true);
    const atk = opts.filter((o) => o.kind === 'attack');
    const direct = pieceId ? atk.filter((o) => o.target.id === pieceId) : [];
    if (direct.length === 1 || atk.length === 1) { attack((direct[0] ?? atk[0]).target.id); return; }
    if (atk.length > 1) { pickOpt(atk, me, pieceId); return; }
    const loot = opts.find((o) => o.kind === 'loot');
    if (loot) { commitMove().then((ok) => ok && ctx.lootMenu(state, state.chars[me.id], state.chars[loot.target.id])); return; }
    if (opts.some((o) => o.kind === 'back')) { setPreview(me.id, null); return; }
    const mv = opts.find((o) => o.kind === 'move' || o.kind === 'grapple');
    if (mv) { setPreview(me.id, mv.info); if (mv.kind === 'grapple') toast('🪝 이 칸은 그래플링 훅을 써야 가요(확정할 때 사용)'); return; }
    return;
  }
  if (opts?.length) {
    $('celltip') && ($('celltip').hidden = true); $('hovercards') && ($('hovercards').hidden = true);
    pickOpt(opts, me, pieceId);
    return;
  }
  if (ch && ch.owner === P) refresh();
}

// 공격 창(2026-10-04 사용자 피드백 26): 공격받을 때처럼 내 캐릭터 · 대상 카드와 이번 전투 수치를 보여 주고,
// 쓸 공격 카드를 고른 뒤 "공격" 버튼으로 실행. 쓸 카드가 없어도 창은 뜬다. 장전해 둔 카드는 미리 골라 둔다.
function attack(target) {
  const s = pvState();   // 활성화 방식: 미리 본 자리 기준(공격하면 이동과 함께 확정)
  const N = ctx.names;
  const ch = s.chars[ctx.ui.selected];
  if (!ch) return;
  const c = { s, c: content, map };
  const tgtChar = s.chars[target];
  const foe = s.enemies[target] ?? s.bosses[target];
  const info = [
    { view: { ...charInfoView(c, N, ch, PLAYER_COLORS[ch.owner]), tag: '공격하는 캐릭터' } },
    { view: tgtChar ? { ...charInfoView(c, N, tgtChar, PLAYER_COLORS[tgtChar.owner]), tag: '공격 대상' }
      : { ...foeView(content, N, foe, s.game.chapter, s.bosses[target] ? null : map.enemy_mods), tag: '공격 대상' } },
  ];
  // 카드 운용 버전(2026-10-18): 공격은 고른 카드 1장(기본 아이콘 · 공격 + 효과 스킬) — 공격 창에서 손패 카드를 더 붙이지 않음(가방 아이템 · 무기 능력은 그대로)
  const cm = cardMode(s);
  const pay = cm ? ctx.cardPay('attack') : null;
  if (cm && pay.cards) info.push({ view: { ...cardView(content, N, pay.cards[0]), tag: '사용하는 스킬 카드' } });
  if (cm && pay.basic) info.push({ view: { ...cardView(content, N, pay.basic), tag: '기본 공격으로 쓰는 카드' } });
  const tryAtk = (cards) => check(s, content, cm ? { type: 'attack', character: ch.id, target, ...pay } : { type: 'attack', character: ch.id, target, cards });
  const armed = cm ? [] : ctx.armedCards('on_attack');
  const need = tryAtk([]).ok ? [] : armed;      // 장전한 사거리 카드가 있어야 닿는 대상이면 그 카드는 같이 낸다
  const hand = cm ? [] : [...new Set(s.players[ch.owner].hand)].filter((id) => content.cards[id].timing === 'on_attack' && (!content.cards[id].char || content.cards[id].char === ch.char));
  const items = hand.map((id) => {
    const r = tryAtk([...new Set([...need, id])]);
    return { view: cardView(content, N, id), value: id, disabled: !r.ok, note: r.ok ? null : N.errorText(r.error) };
  });
  // 가방의 "공격할 때" 아이템(연구 카드 해부 기록 등, 2026-10-07) — 값 앞에 bag: 표시
  for (const id of [...new Set(ch.bag)].filter((x) => content.cards[x]?.timing === 'on_attack')) items.push({ view: { ...cardView(content, N, id), tag: '가방' }, value: `bag:${id}` });
  // 쉘터 연구 보관함의 "공격할 때" 연구 카드도 같이 쓸 수 있다(2026-10-08 AF-1 — 연구 카드는 가방이 아니라 쉘터에 있음)
  // 연구실 레벨이 모자라면 꺼 두고 이유 표시(2026-10-18)
  const labLv = s.shelter[ch.owner].facilities?.f_lab ?? 0;
  for (const id of [...new Set(s.shelter[ch.owner].research)].filter((x) => content.cards[x]?.timing === 'on_attack')) {
    const need = content.cards[id].lab_level ?? 0;
    items.push({ view: { ...cardView(content, N, id), tag: '연구 보관함' }, value: `bag:${id}`, ...(need > labLv ? { disabled: true, note: `연구실 Lv${need} 필요` } : {}) });
  }
  const tRef = tgtChar ? { kind: 'char', ref: tgtChar } : { kind: 'foe', ref: foe };
  const def = defenseOf(c, tRef);
  const w = weaponOf(c, ch);
  // 챕터에 1번 쓰는 무기 능력(2026-10-17): 공격 창 맨 앞에 "능력 카드"로 — 고르면 이번 공격에 사용(값 power)
  const power = weaponPower(c, ch, w);
  if (power) {
    const label = power.effects.map((b) => ({ stun: '기절', splash_damage: '산탄' }[b.block] ?? b.block)).join(' · ');
    const why = power.used ? '이번 챕터에 이미 썼어요' : tgtChar ? '적에게만 효과가 있어요' : (foe && s.bosses[target] && power.effects.every((b) => b.block === 'stun')) ? '보스는 기절 면역' : null;
    items.unshift({
      view: optionView(`${N.cardName(w.id)} · ${label}`, `챕터에 1번. 고르면 이번 공격에 써요(빗나가도 쓴 것). ${power.effects.map((b) => ({ stun: '맞히면 그 적은 다음 적 차례에 아무것도 못 해요(보스 면역).', splash_damage: `맞히면 거리 ${b.range ?? 1} 이내 다른 적 · 캐릭터도 무기 공격력만큼 피해.` }[b.block] ?? '')).join(' ')}`, { glyph: '⚡', band: '#7A4FD6' }),
      value: 'power', disabled: power.used, note: why ?? '챕터에 1번',
    });
  }
  const dist = targets?.find((x) => x.id === target)?.distance;
  const tName = tgtChar ? `${N.charName(tgtChar.char)}(${tgtChar.owner})` : N.foeName(foe);
  // 이번 공격에 붙는 특전 보너스(예: 싸움꾼 사거리 2 이하 +2) — 공격 전에 미리 보여 줌
  let perkBonus = 0;
  for (const p of perksWithHook(c, ch, 'on_attack')) if (condOk(c, ch, p.condition, { distance: dist })) for (const b of p.effect) if (b.block === 'attack_bonus') perkBonus += b.per === 'bag_count' ? Math.min(ch.bag.length, b.max ?? Infinity) : b.amount;
  const atkTxt = perkBonus ? `무기 <b>${w.attack}</b> + <span class="bonus">${N.charName(ch.char)} 특전 +${perkBonus}</span>` : `공격력 <b>${w.attack}</b>`;
  openChooser({
    title: `${N.charName(ch.char)} · 공격`,
    subtitle: `${N.charName(ch.char)} → ${tName}${dist != null ? ` · 거리 ${dist}` : ''} · ${atkTxt}${hand.length ? ' (+ 카드)' : ''} + 내 주머니 토큰 ${pouchHtml(s.config, charPouchId(content, ch), N)} vs 대상 방어력 <b>${def}</b> · 체력 <b>${tRef.ref.hp}/${tRef.ref.max_hp ?? tRef.ref.hp}</b>`
      + (items.length ? '<br><small>아래 카드는 골라도 되고 안 골라도 돼요 — 고른 것만 이번 공격에 써요. 안 고르고 "공격"을 눌러도 공격해요.</small>' : ''),   // 2026-10-18 처음 보는 플레이어 테스트: 카드가 필수인지 몰랐음
    info, items, min: 0, max: Math.max(1, items.length), preselect: armed.filter((id) => hand.includes(id)),
    confirmLabel: '⚔ 공격', dblConfirm: false, emptyText: cm ? '같이 쓸 가방 아이템이 없어요' : '사용할 수 있는 공격 카드가 없어요',   // 카드 운용 버전은 손패 카드를 더 붙이지 않음(2026-10-18)
    buttons: [{ label: '취소' }],
    onPick: async (picked) => {
      const cards = picked.filter((x) => !String(x).startsWith('bag:') && x !== 'power');
      const bagItems = picked.filter((x) => String(x).startsWith('bag:')).map((x) => x.slice(4));
      const usePower = picked.includes('power');
      if (cm) { act({ type: 'attack', character: ch.id, target, ...pay, items: bagItems, ...(usePower ? { weapon_power: true } : {}) }); return; }
      if (await commitMove()) act({ type: 'attack', character: ch.id, target, cards, items: bagItems, ...(usePower ? { weapon_power: true } : {}) });
    },
  });
}

// ---------- 사냥꾼 "치고 빠지기"(move_then_attack, 2026-10-08 미구현 카드 채우기) ----------
// 손패 카드를 누르면 → 보드에서 이동할 칸(최대 2칸, 지금 칸 포함)을 누르고 → 그 칸에서 사거리 안의 대상을 고르면 엔진에 한 번에 낸다.
// 전력 질주(bonus_move, 2026-10-18)도 같은 방식 — 이동할 칸(지금 칸 제외)을 누르면 바로 이동(공격 없음, hitRun.moveOnly)
ctx.startHitRun = async (charId, cardId) => {
  // 이동 미리 보기가 있으면 먼저 확정(2026-10-18 — 예전엔 취소하고 원래 자리에서 시작해서, 미리 옮겨 둔 자리가 사라졌다)
  if (!(await commitMove())) return;
  const s = state;
  const ch = s.chars[charId];
  const eff = content.cards[cardId].effect;
  const mta = eff.find((b) => b.block === 'move_then_attack');
  const bmv = eff.find((b) => b.block === 'bonus_move');
  const reachMap = reachableCells(s, content, charId, { budget: (mta ?? bmv).max_move ?? 2, ignoreTurn: true });
  const around = [...reachMap].filter(([, i]) => !i.grapple).map(([c]) => c);
  const cells = bmv ? around : [ch.cell, ...around];
  if (!cells.length) { toast('이동할 수 있는 칸이 없어요'); return; }
  ctx.ui.selected = charId; ctx.ui.mode = 'hitrun'; ctx.ui.hitRun = { card: cardId, cells, moveOnly: !!bmv };
  refresh();
  toast(bmv ? `${ctx.names.cardName(cardId)}: 이동할 칸(초록, ${bmv.max_move ?? 2}칸 안)을 누르세요 — <kbd>Esc</kbd> 취소`
    : `${ctx.names.cardName(cardId)}: 이동할 칸(초록, 지금 칸도 됨)을 누르세요 — <kbd>Esc</kbd> 취소`);
};
function hitRunTarget(cell) {
  const s = state;
  const ui = ctx.ui;
  const ch = s.chars[ui.selected];
  const { card } = ui.hitRun;
  const N = ctx.names;
  if (ui.hitRun.moveOnly) { ui.mode = null; ui.hitRun = null; act({ type: 'play_card', character: ch.id, card, cell }); return; }   // 전력 질주: 바로 이동
  const range = rangeOf({ s, c: content, map }, ch);
  const foes = [...Object.values(s.enemies), ...Object.values(s.bosses)].filter((f) => segDistOf(cell, f.cell) <= range);
  const chars = Object.values(s.chars).filter((x) => x.owner !== ch.owner && !x.exhausted && x.cell && segDistOf(cell, x.cell) <= range);
  if (!foes.length && !chars.length) { toast('그 칸에서는 사거리 안에 공격할 대상이 없어요'); return; }
  openChooser({
    title: `${N.cardName(card)} · 공격할 대상`, subtitle: `${N.cellName(cell)}${cell === ch.cell ? '(그대로)' : '로 이동한 뒤'} 공격 · 사거리 ${range}`,
    items: [...foes.map((f) => ({ view: foeView(content, N, f, s.game.chapter, s.bosses[f.uid] ? null : map.enemy_mods), value: f.uid })),
      ...chars.map((x) => ({ view: charInfoView({ s, c: content, map }, N, x, PLAYER_COLORS[x.owner]), value: x.id }))],
    buttons: [{ label: '취소' }],
    onPick: ([t]) => { ui.mode = null; ui.hitRun = null; act({ type: 'play_card', character: ch.id, card, target: t, ...(cell !== ch.cell ? { cell } : {}) }); },
  });
}

// ---------- 사거리 · 위협 범위 겹쳐 보기(2026-10-08 사용자 "추천으로" — docs/range-display.md 1~3단계) ----------
//  1단계: 내 캐릭터를 고른 채 이동할 수 있는 칸에 마우스를 올리면 → 거기서 내 사거리 안에 드는 칸(빨강, 안의 적은 진하게)
//  2단계: 적(보스)에 마우스를 올리면 → 그 적이 다음 적 차례에 이동해 갈 수 있는 칸(옅은 주황 바닥) + 공격할 수 있는 칸(주황 점선)
//  3단계: T 키(또는 도구 줄 "위협 지도") → 모든 적의 위협을 겹쳐서, 칸마다 몇 마리에게 위협받는지(옅 → 진한 주황)
// 읽기 전용 표시일 뿐 규칙 판정은 엔진(attackTargets · foeThreat)과 같은 함수를 쓴다. 육각 맵에서만 그린다.
let threatMap = false;
function toggleThreatMap() {
  threatMap = !threatMap;
  $('btn-threat')?.classList.toggle('on', threatMap);
  updateRangeOverlay();
  toast(threatMap ? '위협 지도 켜짐 — 칸마다 적 몇 마리가 닿는지(진할수록 위험)' : '위협 지도 꺼짐');
}
function updateRangeOverlay() {
  if (!W.hex || !W.setRangeOverlay) return;
  const s = state;
  const layers = [];
  const foeCells = s ? new Map([...Object.values(s.enemies), ...Object.values(s.bosses)].map((f) => [f.cell, f])) : new Map();
  if (s && threatMap) {
    const count = new Map();
    for (const f of [...Object.values(s.enemies), ...Object.values(s.bosses)]) { const t = foeThreat(s, content, f.uid); if (t) for (const id of t.attack) count.set(id, (count.get(id) ?? 0) + 1); }
    for (const [n, fill] of [[1, 0.12], [2, 0.24], [3, 0.38]]) layers.push({ ids: [...count].filter(([, k]) => (n === 3 ? k >= 3 : k === n)).map(([id]) => id), color: '#FF8A1F', fill, edge: false });
  }
  if (s && hoverCell) {
    // 2단계: 호버한 칸의 적
    const foe = foeCells.get(hoverCell);
    if (foe) {
      const t = foeThreat(s, content, foe.uid);
      if (t) {
        const atkOnly = t.attack.filter((id) => !t.move.includes(id));
        layers.push({ ids: t.move, color: '#FFB347', fill: 0.26, edge: false });
        layers.push({ ids: [...atkOnly, ...t.move], color: '#FF7A1A', fill: 0.0, edge: true });
        layers.push({ ids: atkOnly, color: '#FF7A1A', fill: 0.16, edge: false });
      }
    }
    // 1단계: 이동할 수 있는 칸에 올림 → 거기서의 내 사거리
    const ch = s.chars[ctx.ui.selected];
    const opts = cellOpts?.get(hoverCell) ?? [];
    if (ch && opts.some((o) => o.kind === 'move' || o.kind === 'grapple')) {
      const range = rangeOf({ s, c: content, map }, ch) + (ctx.armedBonus?.('range_bonus') ?? 0);
      const ids = map.cells.filter((c) => c.id !== hoverCell && segDistOf(hoverCell, c.id) <= range).map((c) => c.id);
      layers.push({ ids, color: '#FF4A3A', fill: 0.12, edge: true });
      const hit = ids.filter((id) => foeCells.has(id) || Object.values(s.chars).some((x) => x.cell === id && x.owner !== ch.owner && !x.exhausted));
      if (hit.length) layers.push({ ids: hit, color: '#FF2A1A', fill: 0.38, edge: false });
    }
  }
  W.setRangeOverlay(layers);
}

// ---------- 마우스 올림: 칸 정보 + 이동 경로 미리보기 ----------
let hoverPath = null;
function onHover(cellId) {
  hoverCell = cellId;
  W.focusSecret?.(cellId ? cellOf(map, cellId)?.secret ?? null : null);   // 비밀 통로 칸에 올리면 그 통로 점선만 진하게
  showCellTip(cellId);       // 칸 정보는 마우스 옆 말풍선 하나로(2026-10-02 — 왼쪽 위 정보 상자는 없앰)
  updateRangeOverlay();
  const moving = ctx.ui.mode === 'move' || (!ctx.ui.mode && cellOpts);
  const next = moving && reach && cellId ? reach.get(cellId)?.path ?? null : null;
  if (next !== hoverPath) { hoverPath = next; if (state) updateHighlights(); }
}

// ---------- 로그 · 배너 · 토스트 ----------
function fmtEvent(e) {
  const N = ctx.names;
  const who = (id) => (state.chars[id] ? `${N.charName(state.chars[id].char)}(${state.chars[id].owner})` : id);
  switch (e.type) {
    case 'moved': return `${who(e.character)} 이동 ${e.path.map(N.cellName).join('→')}`;
    case 'attack_declared': return `${who(e.attacker)} → ${who(e.target)} 공격`;
    case 'dice_rolled': return `토큰${e.pouch ? `(${ctx.names.t(`pouch.${e.pouch}.name`, e.pouch)})` : ''} ${e.faces ? e.faces.join('/') + '→' : ''}${e.face}${e.purpose ? ` (${e.purpose})` : ''}`;
    case 'damage_applied': return `${who(e.target)} 피해 ${e.amount}${e.fixed ? '(고정)' : ''}${e.missed ? ' 빗나감' : ''}`;
    case 'exhausted': return `${who(e.character)} 탈진`;
    case 'enemy_killed': return `적 처치 ${e.enemy_type}`;
    // 무기 특수 효과(2026-10-17)
    case 'foe_stunned': return `${e.enemy} 기절 — 이번 적 차례 행동 없음`;
    case 'supply_enemy_skipped': return `보급품 적 카드 ${N.cardName(e.card)} 버림(한 번에 1마리까지) · 한 장 더`;
    case 'weapon_power_used': return `${who(e.character)} ${N.cardName(e.weapon)} 능력 사용(챕터에 1번)`;
    case 'status_granted': return `${who(e.target)} ${({ stunned: '기절', rooted: '속박', poison: e.label === 'bleed' ? '출혈' : `독 ${e.turns}` })[e.status] ?? e.status}`;
    case 'foe_rooted': return `${e.enemy} 속박 — 이번 적 차례 이동 없음`;
    case 'enemy_pushed': return `${e.enemy} 밀려남 ${N.cellName(e.from)}→${N.cellName(e.to)}`;
    case 'push_blocked': return `${e.enemy} 밀어내기 막힘${e.collision ? ` · 충돌 피해 ${e.collision}` : ''}`;
    case 'status_immune': return `${e.target} ${e.status === 'stunned' ? '기절' : '속박'} 면역(보스)`;
    case 'turn_started': return `── ${e.player} 차례 ──`;
    case 'auto_activation': return `${who(e.character)} 자동 행동 끝${e.interact ? ` · ${N.t('celltype.' + e.interact, e.interact)}` : ''}`;
    default: {
      const rest = Object.entries(e).filter(([k]) => k !== 'type').map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v && typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
      return `${e.type} ${rest}`;
    }
  }
}
function log(text, cls) {
  const box = $('log');
  box.prepend(el('div', cls, text));
  while (box.children.length > 12) box.lastChild.remove();
}
let bannerTimer;
function banner(text) {
  const b = $('banner');
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 1400);
}
function toast(text) {
  const t = el('div', 'toast');
  t.innerHTML = text;   // 2026-10-18: 키캡(<kbd>)을 넣으려고 HTML로(알림 글은 모두 게임 내부 문구)
  const box = $('toasts');
  box.append(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => t.remove(), 2700);
}

// 육각 맵 보드 도구(2026-10-03 사용자 결정 F): 건물 보기 켜고 끄기 · 칸 찾기(종류별 강조)
const FIND_TYPES = [['resource', '⚙️', '부품'], ['money', '🪙', '금품'], ['investigate', '🔍', '조사'], ['lab', '🧪', '연구소'], ['search', '?', '수색'], ['camp', '⛺', '캠프'], ['enemy', '☠️', '적 칸'], ['supply', '📦', '보급품'], ['survivor', '🧑', '생존자']];
function bindBoardFinder() {
  if (!W.hex) return;
  const b = $('btn-build');
  b.classList.remove('hidden');
  b.classList.toggle('on', W.buildingsOn);
  b.onclick = () => { W.setBuildings(!W.buildingsOn); b.classList.toggle('on', W.buildingsOn); view.placeMarkers(); };
  const box = $('finder');
  box.classList.remove('hidden');
  box.innerHTML = '';
  box.append(el('span', 'lbl', '칸 찾기'));
  const on = new Set();
  const present = new Set(map.cells.map((c) => c.type));
  for (const [type, glyph, label] of FIND_TYPES) {
    if (!present.has(type)) continue;
    const t = el('button', '', `${glyph} ${label}`);
    t.dataset.tip = `${label} 칸을 보드에서 노랗게 표시(다시 누르면 끔)`;
    t.onclick = () => { on.has(type) ? on.delete(type) : on.add(type); t.classList.toggle('on', on.has(type)); W.markTypes(on); };
    box.append(t);
  }
  // 보스 구역(미션 문구에 나오는 파랑 · 노랑 · 빨강 구역 칸) 찾기(2026-10-07 사용자 피드백 오늘 12)
  const zones = new Set(map.cells.map((c) => c.zone).filter(Boolean));
  for (const [z, glyph, label] of [['blue', '🟦', '파랑 구역'], ['yellow', '🟨', '노랑 구역'], ['red', '🟥', '빨강 구역']]) {
    if (!zones.has(z)) continue;
    const t = el('button', '', `${glyph} ${label}`);
    t.dataset.tip = `${label}(보스를 부를 수 있는 칸, 미션에 나오는 구역)을 보드에서 노랗게 표시(다시 누르면 끔)`;
    t.onclick = () => { const k = `zone:${z}`; on.has(k) ? on.delete(k) : on.add(k); t.classList.toggle('on', on.has(k)); W.markTypes(on); };
    box.append(t);
  }
}

// 연출 속도: 사용자가 고른 배속(user) × 적 차례 2배(enemy) / 건너뛰기 중이면 60(skip). 바꿀 때는 항상 applySpeed로(2026-10-17)
const speedState = { user: 1, enemy: false, skip: 0 };
function applySpeed() { view.fx.speed = speedState.skip > 0 ? 60 : speedState.user * (speedState.enemy ? 2 : 1); }

function bindTools() {
  const speeds = [1, 2, 4];
  let si = 0;
  $('btn-speed').onclick = () => { si = (si + 1) % speeds.length; speedState.user = speeds[si]; applySpeed(); $('btn-speed').textContent = `연출 속도 ×${speeds[si]}`; };   // 2026-10-18 "연출 ×1" → "연출 속도 ×1"(처음 보는 플레이어가 속도 버튼인지 몰랐음, D3)
  // 연출 멈춤 ↔ 자동 스킵(2026-10-07 사용자 피드백 오늘 4): 설정은 ui/fxpause.js가 브라우저에 저장
  fxPauseOpts.suspended = () => humans.length === 0;   // AI끼리 관전할 땐 멈추지 않음
  const fxPauseBtn = $('btn-fxpause');
  const showFxPause = () => { fxPauseBtn.textContent = fxPauseOpts.autoSkip ? '연출 자동 스킵' : '연출 멈춤'; fxPauseBtn.classList.toggle('on', !fxPauseOpts.autoSkip); };
  fxPauseBtn.onclick = () => { fxPauseOpts.autoSkip = !fxPauseOpts.autoSkip; showFxPause(); };
  showFxPause();
  $('btn-threat').onclick = toggleThreatMap;
  // 건너뛰기: 0.6초 동안만 아주 빠르게(끝나면 그때의 사용자 속도로 — 예전엔 누른 순간 값으로 되돌려 적 차례 2배속이 남곤 했음)
  $('btn-skip').onclick = () => { speedState.skip += 1; applySpeed(); setTimeout(() => { speedState.skip -= 1; applySpeed(); }, 600); };
  $('btn-tilt').onclick = () => { stage.tilt = !stage.tilt; $('btn-tilt').classList.toggle('on', !!stage.tilt); };
  $('btn-log').onclick = () => { $('log').classList.toggle('hidden-log'); $('btn-log').classList.toggle('on'); };
  $('btn-manual').onclick = toggleManual;
  $('btn-gallery').onclick = () => (isGalleryOpen() ? closeGallery() : openGallery(content, ctx.names));
  // 게임 중 다시 시작(2026-10-04 사용자 피드백): 한 번 묻고 시작 화면으로(맵 선택은 주소에 남아 있음)
  $('btn-restart').onclick = () => {
    if (!state) return location.reload();
    openChooser({
      title: '다시 시작할까요?', subtitle: '지금 게임은 지워지고 시작 화면(좌석 · 캐릭터 고르기)으로 돌아가요.',
      items: [], instant: true, peek: false,
      // 이어 하기 저장도 같이 지운다(2026-10-17 — 안 지우면 시작 화면에 버린 판이 "이어 하기"로 다시 뜸)
      buttons: [{ label: '계속하기' }, { label: '다시 시작', primary: true, onClick: () => { clearSave(); location.reload(); } }],
    });
  };
  bindBoardFinder();
  $('btn-pause').onclick = () => {
    paused = !paused;
    $('btn-pause').classList.toggle('on', paused);
    $('btn-pause').textContent = paused ? '▶ AI 계속' : '⏸ AI 멈춤';
    if (!paused) pump();
  };
  addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); toggleManual(); return; }
    // T: 모든 적의 위협 지도 켜고 끄기(2026-10-08, 3단계)
    if (e.code === 'KeyT' && !e.ctrlKey && !e.altKey && !e.metaKey && state && !isManualOpen() && !e.target.closest?.('input, select, textarea')) { toggleThreatMap(); return; }
    // S: 내 쉘터 켜고 끄기(한글 입력 상태여도 되게 키 위치로 판단)
    if (e.code === 'KeyS' && !e.ctrlKey && !e.altKey && !e.metaKey && state && !isManualOpen() && !e.target.closest?.('input, select, textarea')) { ctx.toggleShelter(); return; }
    // Space · Enter: 더 할 행동이 없을 때 차례 종료(깜빡이는 버튼, 2026-10-04 사용자 피드백). 창이 떠 있으면 창이 먼저 받음
    if ((e.key === ' ' || e.key === 'Enter') && !isChooserOpen() && !isManualOpen() && !isGalleryOpen() && !shelter?.isModalOpen() && !e.target.closest?.('input, select, textarea')) {
      // 챕터 준비 안내 판이 떠 있으면 Space · Enter = 시작(hud.js syncPrepPanel, 2026-10-07)
      const prepGo = document.getElementById('prepbox-go');
      if (prepGo) { e.preventDefault(); prepGo.click(); return; }
      // 손패에서 고르기(멀리건 · 손패 초과, 2026-10-18 hud.js renderPickHand): 안내가 붙은 버튼. 버리기 장수가 안 맞으면 아무것도 안 함
      const pickKey = document.getElementById('handpick-key');
      if (pickKey) { e.preventDefault(); if (!pickKey.disabled) pickKey.click(); return; }
      if (document.body.classList.contains('hand-picking')) { e.preventDefault(); return; }
      // 활성화 방식: 고른 캐릭터가 아직 행동 중이면 "행동 끝"
      const doneBtn = document.querySelector('#actions .act.actend:not(:disabled)');
      if (doneBtn && !document.body.classList.contains('busy')) { e.preventDefault(); doneBtn.click(); return; }
      const endBtn = document.querySelector('#actions .act.end.pulse:not(:disabled)');
      if (endBtn && !document.body.classList.contains('busy')) { e.preventDefault(); endBtn.click(); }
      return;
    }
    if (e.key !== 'Escape') return;
    if (isManualOpen()) { closeManual(); return; }
    if (isGalleryOpen()) { closeGallery(); return; }
    if (shelter?.isModalOpen()) { shelter.closeModal(); return; }
    if (shelterOpen && !isChooserOpen()) { ctx.toggleShelter(); return; }
    // 선택 대기 창은 Esc로 닫지 않는다(반드시 골라야 함). 그 외 창 · 모드는 취소.
    if (isChooserOpen()) { if (!state?.pending) closeChooser(); return; }
    if (ctx.ui.preview) { clearPreview(); refresh(); return; }   // 이동 미리 보기 취소
    ctx.ui.mode = null; ctx.ui.armed = []; ctx.ui.bossCards = null; ctx.ui.cardPlay = null; hoverPath = null;   // cardPlay: 카드 운용 버전 고른 카드(2026-10-18)
    refresh();
  });
}

boot().catch((e) => { console.error(e); const l = $('loading'); if (l) l.textContent = `오류: ${e.message}`; });
