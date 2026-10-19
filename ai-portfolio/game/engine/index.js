// 룰 엔진 입구. 화면(UI) · 네트워크 · 테스트는 이 파일만 가져다 쓴다.
//   const res = submit(state, action, content)  → { ok, error?, state, events }
// 엔진은 DOM · 화면에 의존하지 않는 순수 JavaScript다(Node와 브라우저에서 같이 동작).

import './blocks.js';
import './combat.js';
import './weapons.js';   // 무기 특수 효과(기절 · 속박 · 독 · 밀어내기 · 흡혈, 2026-10-17)
import './supply.js';
import './enemies.js';
import './missions.js';
import './flow.js';
import './actions.js';

export { submit, ACTIONS, BLOCKS } from './core.js';
export { stateFromSetup, newGame, SCHEMA_VERSION } from './setup.js';
export { bmPrice } from './flow.js';
export { buildContent } from './content.js';
export { reachableCells, attackTargets, foeThreat, interactInfo, cardUse, check, whoDecides, authorOf, bagCapacity, isNear, isSingleOcc, placeableCells } from './query.js';
export { partsValue, enemyDefAt, cellUsesOf, charActionsLeft, perCharActions, turnActions, activationMode, cardMode, basicOf, basicStamina, itemStamina, canDo, actOf, cellTier, tierBonus, pouchTokens, charPouchId, foePouchId } from './core.js';
export { viewFor, HIDDEN, SPECTATOR } from './view.js';
export { weaponPower } from './weapons.js';   // 챕터에 1번 쓰는 무기 능력(2026-10-17)
