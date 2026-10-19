// 난이도 프로필(data/ai_profiles.json) 읽기. 엔진의 content와 별개 파일이라 따로 불러온다.

export async function loadProfilesFromDir(dataDir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'ai_profiles.json'), 'utf8')).profiles;
}

export async function loadProfilesFromUrl(dataUrl = '../data/') {
  return (await (await fetch(`${dataUrl}ai_profiles.json`)).json()).profiles;
}
