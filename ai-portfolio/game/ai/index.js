// AI 입구: 난이도 이름 → 결정 주체(controller). 진행자(session)의 controllers에 그대로 꽂는다.
//   const profiles = await loadProfilesFromDir(dataDir);
//   const ctl = createAI('easy', profiles, { seed });    // { decide(view, tools), draft({available}) }

import { createEasyController } from './easy.js';
import { createNormalController } from './normal.js';
import { createHardController } from './hard.js';

export { loadProfilesFromDir, loadProfilesFromUrl } from './profiles.js';
export { randomController } from './random.js';

const KINDS = { easy: createEasyController, normal: createNormalController, hard: createHardController };

export function createAI(level, profiles, opts = {}) {
  const profile = profiles[level];
  if (!profile) throw new Error(`없는 AI 난이도: ${level}`);
  const make = KINDS[profile.kind];
  if (!make) throw new Error(`아직 구현되지 않은 AI 종류: ${profile.kind}`);
  return make(profile, opts);
}

export const availableLevels = (profiles) => Object.keys(profiles).filter((l) => KINDS[profiles[l].kind]);
