// 엔진의 선택 대기(state.pending) → 화면 중앙 카드 선택 창
// 어떤 카드를 낼 수 있는지는 화면이 판정하지 않는다: 엔진에 시험 제출(check)해서 안 되는 카드는 회색 + 이유.
import { openChooser } from './chooser.js';
import { cardView, missionView, portraitView, optionView, foeView, charInfoView, pouchHtml } from './cards.js';
import { PLAYER_COLORS } from '../board3d/pieces.js';
import { check, isNear, charPouchId, foePouchId } from '../../engine/index.js';
import { openPilePeek, isPilePeekOpen } from './pilepeek.js';
import { defenseOf } from '../../engine/core.js';

export function showDecision(ctx) {
  const s = ctx.state();
  const p = s.pending;
  if (!p) return false;
  const { content } = ctx;
  const N = ctx.names;
  const card = (id, extra = {}) => ({ view: cardView(content, N, id), value: id, ...extra });
  const who = (id) => `${N.charName(s.chars[id].char)}(${s.chars[id].owner})`;
  const act = ctx.act;

  switch (p.type) {
    case 'mission_keep': {
      const items = [
        ...p.current.map((id) => {
          const active = s.players[p.player].missions.active.find((a) => a.id === id);
          return { view: missionView(content, N, id, { markers: active?.markers ?? 0 }), value: id, note: active ? '진행 중' : '보유 중' };
        }),
        ...p.options.map((id) => ({ view: missionView(content, N, id), value: id, note: '새 미션' })),
      ];
      openChooser({
        title: `${p.player} · 미션 고르기`,
        // min(2026-10-18 사용자 요청 "안 고르고 Space 누르면 그냥 넘어가진다 — 최소 2장은 골라야"): 엔진 min_keep만큼 골라야 확인 버튼 · Space가 켜짐. 예전엔 min 0
        subtitle: `손에 남길 미션을 ${(p.min_keep ?? 0) >= p.max_keep ? `${p.max_keep}장` : `${p.min_keep ? `${p.min_keep}~` : '최대 '}${p.max_keep}장`} 고르세요. 고르지 않은 미션은 미션 덱 맨 아래로 돌아가고, 진행 중 미션을 빼면 마커도 사라져요.`,
        items, min: p.min_keep ?? 0, max: p.max_keep, preselect: p.current.slice(0, p.max_keep), confirmLabel: '이 미션으로',
        onPick: (vals) => act({ type: 'choose', player: p.player, choice: vals }),
      });
      return true;
    }
    case 'camp_pick':
      openChooser({
        title: '캠프 · 카드 1장 가져오기', subtitle: `${who(p.character)} — 고르지 않은 카드는 버려져요. 캠프를 쓰면 차례가 끝나요.`,
        items: p.options.map((id) => card(id)),
        onPick: ([v]) => act({ type: 'choose', player: p.player, choice: v }),
      });
      return true;
    case 'discard_to_hand_limit': {
      if (ctx.handPickOk?.(s, p)) return true;   // 2026-10-18: 손패가 보이면 손패에서 바로 고름(hud.js renderPickHand). 아래 창은 손패가 안 보이는 국면용
      const hand = s.players[p.player].hand;
      openChooser({
        title: '손패 초과 · 버릴 카드', subtitle: p.at === 'turn_end' ? `${p.player} — 차례를 끝낼 때 손패는 ${p.keep}장까지. ${p.count}장을 버리세요.` : `${p.player} — 공용 손패는 최대 ${s.config.hand.max_per_player}장. ${p.count}장을 버리세요.`,   // 카드 운용 버전(2026-10-18)
        items: hand.map((id, i) => ({ ...card(id), value: i })), min: p.count, max: p.count, confirmLabel: '버리기',
        onPick: (idx) => act({ type: 'choose', player: p.player, choice: idx.map((i) => hand[i]) }),
      });
      return true;
    }
    case 'mulligan': {
      if (ctx.handPickOk?.(s, p)) return true;   // 2026-10-18: 손패에서 바로 고름(hud.js renderPickHand). 아래 창은 손패가 안 보이는 경우용
      const hand = s.players[p.player].hand;
      openChooser({
        // 2026-10-18 멀리건이 챕터마다 1회로 바뀜(config hand.mulligan) — 문구도 "처음 손패 · 게임 시작 때 1번만" → 챕터 기준
        title: `${p.player} · ${s.game.chapter > 1 ? `${s.game.chapter}챕터 시작 손패` : '처음 손패'}(공용)`,
        subtitle: `다시 뽑을 카드를 고르세요(원하는 만큼, ${s.config.hand.mulligan === 'every_chapter_start' ? '챕터마다' : '게임 시작 때'} 1번만). 고른 만큼 새로 뽑고, 고른 카드는 덱에 섞어요.`,
        // min 1(2026-10-18): 안 골랐을 때 Space · Enter가 "고른 카드 다시 뽑기"(0장)가 아니라 "이대로 시작"을 누르고, 배지도 거기 붙게
        items: hand.map((id, i) => ({ ...card(id), value: i })), min: 1, max: hand.length, confirmLabel: '고른 카드 다시 뽑기',
        buttons: [{ label: '이대로 시작', primary: true, onClick: () => act({ type: 'choose', player: p.player, choice: [] }) }],
        onPick: (idx) => act({ type: 'choose', player: p.player, choice: idx.map((i) => hand[i]) }),
      });
      return true;
    }
    case 'bag_overflow': {
      const ch = s.chars[p.character];
      openChooser({
        title: '가방이 넘쳤어요 · 버릴 카드', subtitle: `${who(ch.id)} — 새로 얻은 카드와 가방 카드 중 ${p.discard_count}장을 버리세요.`,
        items: ch.bag.map((id, i) => ({ ...card(id), value: i, note: p.looted?.includes(id) && ch.bag.slice(0, i).filter((x) => x === id).length >= ch.bag.filter((x) => x === id).length - p.looted.filter((x) => x === id).length ? '약탈 — 고르면 돌려줌' : null })), min: p.discard_count, max: p.discard_count, confirmLabel: '버리기',
        onPick: (idx) => act({ type: 'choose', player: p.player, choice: idx.map((i) => ch.bag[i]) }),
      });
      return true;
    }
    // 보급품을 얻을 때: 감춰진 카드(덱 맨 위) 또는 드러난 카드 1장(2026-10-08 — 보급품 칸이 없는 맵에서도 드러난 카드를 가져갈 수 있게)
    case 'supply_source': {
      const open = s.board.open_supply;
      const items = [{ view: optionView(`감춰진 보급품${p.count > 1 ? ` ${p.count}장` : ''}`, '덱 맨 위에서 뽑아요. 함정이나 적(크롤러 · 워커 · 러너)이 나올 수 있어요 — 적이 나오면 옆에 배치하고 한 장 더 뽑아요.', { glyph: '?', band: '#6A5A48' }), value: 'hidden' }];
      for (const slot of p.options.filter((x) => x !== 'hidden')) items.push({ view: cardView(content, N, open[slot]), value: slot, note: p.count > 1 ? `드러난 카드 1장 + 감춰진 ${p.count - 1}장` : '드러난 카드' });
      openChooser({
        title: '보급품 · 무엇을 가져갈까요?', subtitle: `${who(p.character)} — 드러난 카드는 1장만 고를 수 있고, 가져간 자리는 덱에서 새로 채워져요.`,
        items, onPick: ([v]) => act({ type: 'choose', player: p.player, choice: v }),
      });
      return true;
    }
    // 카드 보고 고르기(2026-10-08 미구현 카드 채우기): 예언자 예지 · 예언자 특전(플레이어 카드 · 보급품)
    case 'pick_card': {
      const TITLE = { look_take: ['예지 · 손패로 가져올 카드', '덱 위 카드예요. 고른 카드는 손패로, 나머지는 원래 순서대로 덱 위에 돌아가요.'],
        oracle_draw: ['예언자 · 뽑을 카드 고르기', '한 장 더 보고 골라요. 고르지 않은 카드는 버린 더미로 가요.'],
        oracle_search: ['예언자 · 수색 카드 고르기', '두 장 중 한 장만 효과가 나요. 고르지 않은 카드는 효과 없이 버려져요(습격 피하기 가능).'],
        oracle_supply: ['예언자 · 가져올 보급품 고르기', '한 장 더 보고 골라요(라운드에 1번). 고르지 않은 카드는 효과 없이 버려져요(함정 피하기 가능).'] }[p.purpose] ?? ['카드 고르기', ''];
      openChooser({
        title: `${TITLE[0]} (${p.count}장)`, subtitle: `${p.character ? `${who(p.character)} — ` : ''}${TITLE[1]}`,
        items: p.options.map((id, i) => ({ ...card(id), value: i })), min: p.count, max: p.count, confirmLabel: '이 카드로',
        onPick: (idx) => { const ids = idx.map((i) => p.options[i]); act({ type: 'choose', player: p.player, choice: p.count === 1 ? ids[0] : ids }); },
      });
      return true;
    }
    case 'choose_trap_target':
      openChooser({
        title: `함정! ${N.cardName(p.card)}`, subtitle: '효과를 받을 캐릭터를 고르세요.',
        items: p.options.map((id) => ({ view: portraitView(content, N, s.chars[id], PLAYER_COLORS[s.chars[id].owner]), value: id })),
        onPick: ([v]) => act({ type: 'choose', player: p.player, choice: v }),
        peek: true,
      });
      return true;
    // 캐릭터 고르기(구원자 특전 1, 2026-10-17): 회복 카드를 쓴 뒤 추가 회복 받을 내 캐릭터(거리 무관)
    case 'choose_char':
      openChooser({
        title: `${N.charName(s.chars[p.character].char)} 특전 · 추가 회복`,
        subtitle: `거리 상관없이 내 캐릭터 하나가 체력 +${p.hp} · 스테미너 +${p.stamina} 회복해요(라운드에 1번).`,
        items: p.options.map((id) => ({ view: portraitView(content, N, s.chars[id], PLAYER_COLORS[s.chars[id].owner]), value: id })),   // 초상화에 체력 · 스테미너가 이미 나옴
        onPick: ([v]) => act({ type: 'choose', player: p.player, choice: v }),
        peek: true,
      });
      return true;
    case 'reaction': return showReaction(ctx, p);
    // ---- 카드 운용 버전(2026-10-19) ----
    // 연속 행동: 이동 단계는 보드에서(game3d.js), 공격 단계는 대상 고르기 창 + 건너뛰기
    case 'combo_step': {
      if (p.step === 'move') return true;
      const foes = p.options.filter((id) => s.enemies[id] || s.bosses[id]);
      const chars = p.options.filter((id) => s.chars[id]);
      const ch = s.chars[p.character];
      openChooser({
        title: `${N.cardName(p.card)} · ${p.index + 1}/${p.total}단계 공격`, subtitle: `${N.charName(ch.char)}이(가) 공격할 대상을 고르세요. 공격하지 않으려면 "공격 안 함".`,
        items: [...foes.map((id) => { const f = s.enemies[id] ?? s.bosses[id]; return { view: foeView(content, N, f, s.game.chapter, s.bosses[id] ? null : ctx.map().enemy_mods), value: id }; }),
          ...chars.map((id) => ({ view: charInfoView({ s, c: content, map: ctx.map() }, N, s.chars[id], PLAYER_COLORS[s.chars[id].owner]), value: id }))],
        instant: true, buttons: [{ label: '공격 안 함', onClick: () => act({ type: 'choose', player: p.player, choice: 'skip' }) }],   // "건너뛰기"는 도구줄 연출 버튼과 이름이 겹쳐서(2026-10-19)
        onPick: ([id]) => act({ type: 'choose', player: p.player, choice: id }),
      });
      return true;
    }
    // 레벨업: 새 카드 1장 고르기 → 덱 보는 화면에서 뺄 카드 1장(손패 · 덱 · 버린 카드 전부, 2026-10-19 사용자 결정)
    case 'level_up_pick': {
      const ch = s.chars[p.character];
      openChooser({
        title: `${N.charName(ch.char)} 레벨업 · 새 카드 1장`, subtitle: `${p.chapter}챕터를 마쳤어요. 이 캐릭터의 새 카드를 1장 고르세요 — 고른 카드는 덱에 섞이고, 이어서 덱에서 1장을 빼요(덱 장수 유지).`,
        items: p.options.map((id) => ({ ...card(id), size: 'lg' })),
        onPick: ([id]) => act({ type: 'choose', player: p.player, choice: id }),
      });
      return true;
    }
    case 'level_up_remove': {
      if (isPilePeekOpen()) return true;
      const ch = s.chars[p.character];
      openPilePeek(ctx, s, p.player, 'hand', {
        pick: { title: `${N.charName(ch.char)} 레벨업 · 뺄 카드 1장`, note: '손패 · 덱 · 버린 카드 중 게임에서 뺄 카드를 1장 고르세요(방금 얻은 카드도 됨). 뺀 카드는 돌아오지 않아요.',
          onPick: (zone, id) => act({ type: 'choose', player: p.player, choice: { zone, card: id } }) },
      });
      return true;
    }
    case 'trade_consent':
      openChooser({
        title: `${p.player} · 교환 제안`, subtitle: `${who(p.from)} → ${who(p.to)} : 위 카드를 주고, 아래 카드를 받아요.`,
        items: [...p.give.map((id) => ({ ...card(id), note: '받는 카드', disabled: true })), ...p.take.map((id) => ({ ...card(id), note: '주는 카드', disabled: true }))],
        min: 0, max: 0, confirmLabel: '수락',
        buttons: [{ label: '거절', onClick: () => act({ type: 'choose', player: p.player, choice: 'decline' }) }],
        onPick: () => act({ type: 'choose', player: p.player, choice: 'accept' }),
      });
      return true;
    case 'bm_bid':
    case 'bm_bid_extra': {
      // 플레이어 단위 경쟁(AC-2): 내 두 캐릭터 가방 + 창고의 카드 1장을 몰래 내거나 포기. 카드마다 판매가를 보여 준다(26번)
      const P = ctx.actor ?? p.waiting[0];
      const mine = Object.values(s.chars).filter((c) => c.owner === P);
      const pool = [
        ...mine.flatMap((c) => c.bag.map((id) => ({ id, where: N.charName(c.char) }))),
        ...s.shelter[P].storage.map((id) => ({ id, where: '창고' })),
      ];
      const items = pool.map(({ id, where }, i) => {
        const r = check(s, content, { type: 'bm_bid', player: P, card: id });
        const sell = content.cards[id]?.sell ?? 0;
        return { ...card(id), value: id, disabled: !r.ok, note: r.ok ? `판매가 ${sell} · ${where}` : id === 'part' ? '부품은 못 냄' : '낼 수 없음' };
      });
      const cost = content.cards[p.card]?.cost;
      openChooser({
        title: `${P} · 암시장 경쟁 · ${N.cardName(p.card)}${cost != null ? ` (정가 ${cost}코인)` : ''}`,
        subtitle: `가방 · 창고의 카드 1장을 몰래 내세요. 판매가가 가장 높은 쪽이 그 카드로 값을 치르고 가져가요(진 쪽은 돌려받음)${p.type === 'bm_bid_extra' ? ' — 동점! 한 장 더 내서 추가 카드끼리 비교해요' : ''}. 장비는 낼 수 없어요.`,
        items,
        buttons: [{ label: '포기하기', onClick: () => act({ type: 'bm_bid', player: P, card: null }) }],
        onPick: ([v]) => act({ type: 'bm_bid', player: P, card: v }),
        peek: false,
      });
      return true;
    }
    case 'placement':
      return false; // 보드에서 시작 칸을 직접 클릭
    default:
      return false;
  }
}

// 공격받을 때의 반응: 토큰(예전 주사위)을 꺼내기 전에 고른다(Z-6)
function showReaction(ctx, p) {
  const s = ctx.state();
  const { content } = ctx;
  const N = ctx.names;
  const ch = s.chars[p.character];
  const attacker = s.chars[p.attacker] ? `${N.charName(s.chars[p.attacker].char)}(${s.chars[p.attacker].owner})`
    : s.enemies[p.attacker] || s.bosses[p.attacker] ? N.foeName(s.enemies[p.attacker] ?? s.bosses[p.attacker]) : p.source === 'explosion' ? '폭발' : '공격';
  const items = [];
  // 낼 수 있는지는 엔진에 시험 제출해서 판단(스테미너 · 회피 비용 등)
  const tryReact = (extra) => check(s, content, { type: 'react', character: ch.id, ...extra });
  const discardable = (cards) => ch.bag.filter((d) => tryReact({ cards, discard_supply: d }).ok);
  const option = (view, value) => {
    const r = tryReact(value.needsDiscard ? { cards: value.cards, discard_supply: discardable(value.cards)[0] } : value);
    items.push({ view, value, disabled: !r.ok, note: r.ok ? null : N.errorText(r.error) });
  };
  for (const id of new Set(s.players[ch.owner].hand)) {
    const cd = content.cards[id];
    if (cd.timing !== 'on_hit') continue;
    // 이 캐릭터가 쓸 수 없는 남의 전용 카드는 아예 안 보여 줌(테스터 피드백). 단 수호자 "엄호"처럼 아군을 지키는 전용 카드는
    // 그 카드 주인이 옆에 있으면 대신 써 줄 수 있어서 보여 줌(2026-10-08) — 쓸 수 있는지는 엔진 check가 판정
    const helper = cd.char && cd.char !== ch.char && cd.effect.some((b) => b.target === 'same_cell_ally')
      ? Object.values(s.chars).find((x) => x.owner === ch.owner && x.char === cd.char && !x.exhausted && x.cell && isNear(s, ctx.content, x.cell, ch.cell)) : null;
    if (cd.char && cd.char !== ch.char && !helper) continue;
    option(helper ? { ...cardView(content, N, id), tag: `${N.charName(helper.char)}가 대신 써 줌(스테미너 ${cd.stamina})` } : cardView(content, N, id), { cards: [id], needsDiscard: cd.effect.some((b) => b.block === 'discard_supply') });
  }
  for (const id of ch.bag) {
    if (content.cards[id]?.effect?.some((b) => b.block === 'reduce_damage')) option(cardView(content, N, id), { items: [id] });
  }
  if (p.options.includes('intercept')) {
    for (const g of Object.values(s.chars).filter((x) => x.owner === ch.owner && x.id !== ch.id && isNear(s, ctx.content, x.cell, ch.cell) && !x.exhausted)) {
      option({ ...portraitView(content, N, g, PLAYER_COLORS[g.owner]), title: `대신 맞기: ${N.charName(g.char)}` }, { intercept_by: g.id });
    }
  }
  // 쓸 수 있는 반응이 하나도 없거나, "이번 적 차례 동안 묻지 않기"를 골랐으면 묻지 않고 넘어간다(2026-10-03 테스터 피드백)
  const pass = () => ctx.act({ type: 'react', character: ch.id, pass: true });
  const skipKey = `${s.game.chapter}-${s.game.round}`;
  if (!items.some((x) => !x.disabled) || (s.turn.phase === 'enemy_turn' && ctx.ui.noReactUntil === skipKey)) { setTimeout(pass, 0); return true; }
  // 이번 전투 수치(2026-10-04 사용자 피드백 23): 공격하는 쪽 카드 + 공격력, 내 방어력 · 체력
  const foe = s.enemies[p.attacker] ?? s.bosses[p.attacker];
  const atkChar = s.chars[p.attacker];
  const show = [];
  if (foe) show.push({ view: { ...foeView(content, N, foe, s.game.chapter, s.bosses[foe.uid] ? null : ctx.map().enemy_mods), tag: '공격하는 적' } });
  else if (atkChar) show.push({ view: { ...charInfoView({ s, c: content, map: ctx.map() }, N, atkChar, PLAYER_COLORS[atkChar.owner]), tag: '공격하는 캐릭터' } });
  // 공격받는 내 캐릭터 카드도 같이(2026-10-04 사용자 피드백 27)
  show.push({ view: { ...charInfoView({ s, c: content, map: ctx.map() }, N, ch, PLAYER_COLORS[ch.owner]), tag: '공격받는 캐릭터' } });
  const def = defenseOf({ s, c: content, map: ctx.map() }, { kind: 'char', ref: ch });
  // 공격하는 쪽 주머니(2026-10-04 수정 사항 25): 적은 적 주머니, 캐릭터는 그 캐릭터 주머니
  const pouchId = atkChar ? charPouchId(content, atkChar) : foePouchId(content, s.config, foe, s.game.chapter);
  const dice = p.no_dice ? '토큰 없음' : `+ 상대 주머니 토큰 ${pouchHtml(s.config, pouchId, N)}`;
  openChooser({
    title: `${p.player} · 공격받음!`,
    subtitle: `${attacker} → ${N.charName(ch.char)} · 공격력 <b>${p.attack ?? '?'}</b> ${dice} vs 내 방어력 <b>${def}</b> · 체력 <b>${ch.hp}/${ch.max_hp}</b>. 토큰을 꺼내기 전에 반응을 고르세요.<br><small>반응 = 이 공격을 막거나 줄이는 카드 · 아이템, 또는 옆 아군이 대신 맞기. 고르지 않으면(반응하지 않기) 그대로 맞아요.</small>`,   // 2026-10-18 처음 보는 플레이어 테스트: "반응"이 뭔지 몰랐음
    info: show, items, dblConfirm: false,   // 실수로 카드가 바로 쓰이지 않게(2026-10-03 테스터)
    buttons: [
      { label: '반응하지 않기', primary: true, onClick: pass },
      ...(s.turn.phase === 'enemy_turn' ? [{ label: '이번 적 차례 동안 묻지 않기', onClick: () => { ctx.ui.noReactUntil = skipKey; pass(); } }] : []),
    ],
    onPick: ([v]) => {
      if (v.needsDiscard) {
        // 회피 기동 등: 버릴 보급품을 한 번 더 고른다(조건에 맞는 카드만 켜짐)
        const ok = new Set(discardable(v.cards));
        openChooser({
          title: '회피 비용 · 버릴 보급품', subtitle: '판매가 조건을 만족하는 보급품 1장을 버리세요.',
          items: ch.bag.map((id) => ({ view: cardView(content, N, id), value: id, disabled: !ok.has(id) })),
          buttons: [{ label: '취소', onClick: () => showReaction(ctx, p) }],
          onPick: ([d]) => ctx.act({ type: 'react', character: ch.id, cards: v.cards, discard_supply: d }),
        });
        return;
      }
      ctx.act({ type: 'react', character: ch.id, ...v });
    },
  });
  return true;
}
