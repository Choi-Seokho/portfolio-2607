// 무작위 AI(테스트용 결정 주체): 합법 후보 중에서 가중치를 둔 무작위로 고른다.
// 게임 실력이 목적이 아니라 엔진의 모든 흐름(보스 · PvP · 약탈 · 암시장 경쟁 …)을 자주 거치게 하는 게 목적이다.
// 그래서 난이도 AI와 달리 PvP 공격도 가끔 한다. tests/simulate.mjs가 쓴다.

import { makeRng, weightedOrder, firstLegal } from './util.js';
import { BM_DONE } from './candidates.js';

const FREE = new Set(['play_card', 'equip', 'use_item']);

export function randomController({ seed = 1 } = {}) {
  const r = makeRng(seed);
  const weight = (v, a, content) => {
    switch (a.type) {
      case 'spawn_boss': return 50;                                    // 보스 흐름을 자주 거치게
      case 'attack': return v.bosses[a.target] ? 20 : v.chars[a.target] ? 0.3 : 1;
      case 'interact': return 8;                                       // 이동 후보가 많아 묻히지 않게(조사 카드가 모여야 보스가 나옴)
      case 'move': return 0.3;
      case 'sell': return content.cards[a.card]?.kind === 'investigation' ? 0.05 : 1;
      case 'end_turn': return v.turn.actions_left > 0 ? 0.05 : 1;
      case 'end_maintenance': return 0.4;
      case BM_DONE: return 0.5;
      case 'store': case 'retrieve': return 0.2;
      case 'discard_item': return 0.02;
      default: return FREE.has(a.type) ? 0.3 : 1;
    }
  };
  return {
    kind: 'random',
    decide(view, tools) {
      const list = tools.candidates(view);
      return firstLegal(tools, weightedOrder(r, list, (a) => weight(view, a, tools.content)));
    },
  };
}
