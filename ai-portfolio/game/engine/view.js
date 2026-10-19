// 플레이어별 뷰(View): 그 플레이어가 알아도 되는 정보만 남긴 상태 사본 (아키텍처 원칙 5)
//
// - AI는 이 뷰만 보고 결정한다(반칙 금지). 온라인에서 클라이언트에 보내는 데이터도 이것이다.
// - 기준은 노션 규칙서 "정보 공개": 가방 · 손패 · 손에 든 미션은 비공개, 장비 · 승점 · 시설 · 공개한 미션은 공개,
//   코인은 대략 보이므로 공개로 둔다. 뒤집힌 덱의 순서는 누구도 모른다(자기 덱 포함).
// - 가려진 카드는 지우지 않고 HIDDEN('?')으로 바꾼다. 장수는 실제 보드에서도 보이는 정보이고,
//   높음 AI가 모르는 칸을 그럴듯한 카드로 채워 넣을 자리(가상 상태)가 된다.
// - 뷰는 엔진(submit)에 다시 넣을 수 없다: 난수 상태(rng)와 작업 목록(stack)을 뺐기 때문이다.
//   rng가 남아 있으면 다음 주사위를 미리 계산할 수 있고, stack에는 몰래 낸 입찰 카드 등 비공개 정보가 들어 있다.

export const HIDDEN = '?';
export const SPECTATOR = '*';   // 관전(사람 0명): 비공개 정보까지 전부 보는 뷰

// 앞면이 보이는 더미(버린 카드 · 공개 후 상자로 간 카드). 나머지 덱은 순서 · 내용을 모른다.
const PUBLIC_DECKS = new Set(['supply_discard', 'enemy_discard', 'investigation_box', 'black_market_box', 'search_discard']);

const mask = (list) => (Array.isArray(list) ? list.map(() => HIDDEN) : list);

// viewer: 플레이어 id · SPECTATOR · null(아무 비공개 정보도 없는 공개 뷰)
export function viewFor(state, viewer) {
  const v = structuredClone(state);
  delete v.rng;
  delete v.stack;
  delete v.test;
  v.viewer = viewer;
  if (viewer === SPECTATOR) return v;

  const mine = (owner) => owner === viewer;

  // 약탈 가능한 가방: 탈진한 캐릭터와 같은 칸에 내 캐릭터(탈진 안 함)가 있으면 그 가방은 보인다.
  // 규칙상 가방 확인은 약탈 상호작용(행동 1회) 때 하지만, 디지털 판에서는 약탈 대상을 고르려면 내용이 필요해서
  // "지금 바로 약탈할 수 있는 가방"까지는 보이는 것으로 단순화했다(docs/ai-design.md 3장).
  const myCells = new Set(Object.values(state.chars).filter((c) => mine(c.owner) && !c.exhausted && c.cell != null).map((c) => c.cell));

  for (const ch of Object.values(v.chars)) {
    if (mine(ch.owner)) continue;
    const lootable = ch.exhausted && ch.cell != null && myCells.has(ch.cell);
    if (!lootable) ch.bag = mask(ch.bag);
  }

  // 플레이어 카드(공용 손패 · 덱): 덱 순서는 누구도 모르고, 남의 손패는 장수만. 버린 카드는 앞면이라 공개.
  for (const [p, pl] of Object.entries(v.players)) {
    pl.deck = mask(pl.deck);
    if (mine(p)) continue;
    pl.hand = mask(pl.hand);
    pl.missions.hand = mask(pl.missions.hand);
  }

  // 쉘터: 시설 레벨 · 생존자 배치 · 연구 토큰은 공개(2026-09-30 사용자 결정), 창고는 본인만(자기 것은 언제든 확인 가능)
  for (const [p, sh] of Object.entries(v.shelter)) {
    if (!mine(p)) sh.storage = mask(sh.storage);
  }

  for (const [k, list] of Object.entries(v.decks)) if (!PUBLIC_DECKS.has(k)) v.decks[k] = mask(list);

  v.pending = pendingView(state, viewer);
  return v;
}

// 선택 대기(pending): 내 질문이면 그대로(+ 내가 알아야 하는 것), 남의 질문이면 "누가 무엇을 고르는 중"까지만.
function pendingView(state, viewer) {
  const p = state.pending;
  if (!p) return null;
  const own = (id) => state.chars[id]?.owner === viewer;

  if (p.type === 'bm_bid' || p.type === 'bm_bid_extra') {
    // 경쟁 참가자 · 아직 안 낸 플레이어는 공개(칩이 카드 위에 있다). 낸 카드는 비공개.
    const out = { type: p.type, card: p.card, players: [...p.players], waiting: [...p.waiting] };
    if (p.type === 'bm_bid_extra') {
      // 추가 제출 때 처음 낸 카드는 다시 낼 수 없으므로, 내 첫 입찰만 알려 준다
      const task = state.stack[state.stack.length - 1];
      if (viewer && task?.first && viewer in task.first) out.my_first_bid = task.first[viewer];
    }
    return out;
  }
  if (p.player === viewer) return structuredClone(p);
  if (p.type === 'trade_consent' && own(p.from)) return structuredClone(p);   // 내가 제안한 교환: 내용은 이미 앎

  const out = { type: p.type, player: p.player };
  if (p.character) out.character = p.character;
  if (p.type === 'reaction') { out.attacker = p.attacker; out.source = p.source; }
  if (p.type === 'trade_consent') { out.from = p.from; out.to = p.to; }
  return out;
}
