// 진행자(Session): 좌석(사람 · AI · 나중에 원격 사람)과 룰 엔진 사이에서 게임을 진행한다.
//
//   [화면 · AI · (나중에) 네트워크]  --좌석 이름으로 액션-->  [진행자]  --검증된 액션-->  [룰 엔진]
//
// - 화면(DOM)에 의존하지 않는 순수 JS라 Node에서 헤드리스로 돌릴 수 있다(tests/simulate.mjs).
// - 핫싯 · AI 대전 · 온라인이 같은 진행자를 쓴다. 온라인에서는 호스트가 이 진행자를 돌리고,
//   클라이언트 요청을 submit(좌석, 액션)으로 넣는다(아키텍처 원칙 3 · 4).
// - 좌석마다 "결정 주체(controller)"가 있으면 진행자가 그 좌석의 뷰를 주고 액션을 받는다(AI).
//   없으면(사람) 화면이 submit으로 액션을 넣을 때까지 기다린다.
//
// 결정 주체 인터페이스: { decide(view, tools) → 액션 }
//   view  = viewFor(state, 좌석) — 그 좌석이 알아도 되는 정보만(engine/view.js)
//   tools = { content, player, candidates(view) → 후보 액션 목록, check(action) → {ok, error} }

// 엔진은 반드시 index.js로 가져온다(액션 · 작업 처리 함수가 여기서 등록된다)
import { submit as engineSubmit, check as engineCheck, whoDecides, authorOf, viewFor } from '../engine/index.js';
import { candidates, BM_DONE } from '../ai/candidates.js';

export const SEAT_KINDS = ['human', 'ai'];
const ARRANGE = new Set(['store', 'retrieve', 'equip', 'unequip', 'discard_item']);   // 나중에 'remote'(원격 사람) 추가

export class Session {
  // seats: { P1: {kind:'human'}, P2: {kind:'ai', level:'easy'} } — 비운 좌석은 아예 넣지 않는다(게임에 없는 플레이어)
  // controllers: { P2: 결정 주체 } — AI 좌석마다 하나
  constructor({ content, state, seats, controllers = {} }) {
    this.content = content;
    this.initial = state;       // 재현용 시작 상태
    this.state = state;
    this.seats = seats;
    this.controllers = controllers;
    this.log = [];              // 엔진에 들어간 액션 기록(시작 상태 + 이 기록 = 게임 재현, 원칙 7)
    this.bmDone = new Set();    // 암시장 칩 놓기를 마친 좌석(엔진 밖 진행 정보)
    this.listeners = [];
  }

  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }

  humans() { return Object.keys(this.seats).filter((p) => this.seats[p].kind === 'human'); }
  isAI(player) { return !!this.controllers[player]; }

  // 지금 결정해야 하는 좌석들(암시장은 칩 놓기를 마친 좌석 제외)
  deciders() {
    const w = whoDecides(this.state);
    return w.kind === 'black_market' ? w.players.filter((p) => !this.bmDone.has(p)) : w.players;
  }

  // 좌석 검증: 이 좌석이 지금 이 액션을 낼 자격이 있는가(엔진 규칙 판정 전 단계)
  seatError(player, action) {
    const w = whoDecides(this.state);
    if (action?.type === BM_DONE) return w.kind === 'black_market' && this.seats[player] ? null : 'wrong_phase';
    const author = authorOf(this.state, action);
    if (author === undefined) return 'not_allowed';
    if (author === null) return null;                    // 공개 진행(적 차례 · 챕터 준비 · 암시장 정산)은 누구나
    if (author !== player) return 'not_your_seat';
    // 챕터 준비 전: 암시장에서 산 카드 정리(가방 · 창고 · 장비)는 자기 카드라면 누구나(2026-10-04 신규 8)
    if (this.state.turn.phase === 'chapter_prep' && !this.state.pending && ARRANGE.has(action.type)) return null;
    if (!this.deciders().includes(player)) return 'not_your_decision';
    return null;
  }

  // 좌석 검증 + 엔진 시험 제출(상태는 바뀌지 않음)
  check(player, action) {
    const e = this.seatError(player, action);
    if (e) return { ok: false, error: e };
    if (action.type === BM_DONE) return { ok: true };
    return engineCheck(this.state, this.content, action);
  }

  // player: 액션을 보낸 좌석(공개 진행 액션은 null도 됨)
  submit(player, action) {
    const e = this.seatError(player, action);
    if (e) return { ok: false, error: e, events: [] };
    if (action.type === BM_DONE) {
      this.bmDone.add(player);
      this.notify({ player, action, events: [] });
      return { ok: true, events: [] };
    }
    const res = engineSubmit(this.state, action, this.content);
    if (!res.ok) return res;
    this.state = res.state;
    this.log.push(action);
    if (this.state.turn.phase !== 'black_market') this.bmDone.clear();
    this.notify({ player, action, events: res.events });
    return res;
  }

  notify(update) { for (const fn of this.listeners) fn({ ...update, state: this.state }); }

  view(player) { return viewFor(this.state, player); }

  tools(player) {
    return {
      content: this.content,
      player,
      candidates: (view) => candidates(view, this.content, player),
      check: (action) => this.check(player, action),
    };
  }

  // 진행자가 스스로 할 수 있는 다음 일: AI 좌석의 결정 1개 · 공개 국면 자동 진행 · 없으면(사람 차례) null.
  // 화면이 "AI가 생각 중…"을 보여 주고 나서 step()을 부를 수 있게 실행 없이 먼저 알려 준다.
  // autoPublic: 적 차례 · 챕터 준비를 자동으로 넘길지(기본: 사람이 없을 때만).
  //   true/false 또는 국면별로 정하는 함수 (w) => boolean (예: 사람 1명이면 적 차례만 자동 — F2h)
  nextStep({ autoPublic } = {}) {
    const w = whoDecides(this.state);
    if (w.kind === 'over') return null;
    for (const p of this.deciders()) if (this.controllers[p]) return { player: p };
    const auto = typeof autoPublic === 'function' ? autoPublic(w) : autoPublic ?? this.humans().length === 0;
    if ((w.kind === 'public' && w.action && auto) || (w.kind === 'black_market' && this.deciders().length === 0)) return { player: null, action: w.action };
    return null;
  }

  // 위 nextStep을 실제로 한 번 실행한다. 할 일이 없으면 null.
  step(opts = {}) {
    const n = this.nextStep(opts);
    if (!n) return null;
    if (n.player === null) {
      const res = this.submit(null, n.action);
      if (!res.ok) throw new Error(`공개 진행 거절됨: ${res.error} ${JSON.stringify(n.action)}`);
      return { player: null, action: n.action, res };
    }
    const p = n.player;
    const action = this.controllers[p].decide(this.view(p), this.tools(p));
    if (!action) throw new Error(`AI(${p})가 낼 액션을 찾지 못함 — ${whoDecides(this.state).kind} ${JSON.stringify(this.state.pending)}`);
    const res = this.submit(p, action);
    if (!res.ok) throw new Error(`AI(${p}) 액션이 거절됨: ${res.error} ${JSON.stringify(action)}`);
    return { player: p, action, res };
  }

  // 사람의 결정이 필요해지거나 게임이 끝날 때까지 진행한다. 진행한 단계 수를 돌려준다.
  runUntilHuman({ autoPublic, maxSteps = 100000 } = {}) {
    let n = 0;
    while (n < maxSteps && this.step({ autoPublic })) n++;
    return n;
  }
}
