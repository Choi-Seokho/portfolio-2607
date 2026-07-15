/* MapGenie 드롭 데이터 — 데모용 가상 아이템 카탈로그 및 드롭테이블입니다.
   상자/아이템 스포너에 드롭테이블을 배정해, 클릭 시 등급별 드롭 확률·아이템 목록을 보여주고
   아이템 이름 검색 시 해당 아이템을 드롭하는 오브젝트만 필터링하는 데 사용합니다. */

const MG_RARITY_COLOR = {
  junk: '#9ca3af',
  common: '#c9c6bf',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f97316',
};

const MG_RARITY_LABEL = {
  junk: 'Junk',
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

const MG_ITEM_CATALOG = [
  { id: 'flashlight', name: '낡은 손전등', rarity: 'junk' },
  { id: 'wrench', name: '녹슨 렌치', rarity: 'junk' },
  { id: 'rations', name: '비상 식량 세트', rarity: 'common' },
  { id: 'medkit', name: '구급 키트', rarity: 'common' },
  { id: 'battery', name: '예비 배터리', rarity: 'common' },
  { id: 'backpack', name: '방수 배낭', rarity: 'common' },
  { id: 'vest', name: '합성 섬유 조끼', rarity: 'uncommon' },
  { id: 'driverset', name: '정밀 드라이버 세트', rarity: 'uncommon' },
  { id: 'nvgparts', name: '야시경 부품', rarity: 'uncommon' },
  { id: 'purifier', name: '휴대용 정수기', rarity: 'uncommon' },
  { id: 'coagulant', name: '고급 지혈제', rarity: 'rare' },
  { id: 'carbonframe', name: '강화 카본 프레임', rarity: 'rare' },
  { id: 'decryptor', name: '암호 해독기', rarity: 'rare' },
  { id: 'specimen', name: '정체불명 표본', rarity: 'epic' },
  { id: 'phasecore', name: '위상 안정 코어', rarity: 'epic' },
  { id: 'radio', name: '구형 통신 단말기', rarity: 'epic' },
  { id: 'journal', name: '봉인된 연구 일지', rarity: 'legendary' },
  { id: 'prototypecell', name: '시제품 동력원', rarity: 'legendary' },
];

// gradeRates 단위: 천분율(퍼밀) — 표시할 때 /10 해서 퍼센트로 변환 (예: 350 → 35.0%)
const MG_LOOT_TABLES = {
  T1: { // 일반 상자
    gradeRates: { empty: 200, junk: 300, common: 350, uncommon: 120, rare: 30 },
    items: [
      { itemId: 'flashlight', min: 1, max: 1 },
      { itemId: 'wrench', min: 1, max: 1 },
      { itemId: 'rations', min: 1, max: 2 },
      { itemId: 'medkit', min: 1, max: 1 },
      { itemId: 'battery', min: 1, max: 3 },
      { itemId: 'driverset', min: 1, max: 1 },
      { itemId: 'coagulant', min: 1, max: 1 },
    ],
  },
  T2: { // 사무 구역 캐비닛
    gradeRates: { empty: 150, junk: 150, common: 350, uncommon: 250, rare: 90, epic: 10 },
    items: [
      { itemId: 'wrench', min: 1, max: 1 },
      { itemId: 'rations', min: 1, max: 1 },
      { itemId: 'backpack', min: 1, max: 1 },
      { itemId: 'vest', min: 1, max: 1 },
      { itemId: 'purifier', min: 1, max: 1 },
      { itemId: 'carbonframe', min: 1, max: 1 },
      { itemId: 'specimen', min: 1, max: 1 },
    ],
  },
  T3: { // 창고 고급 보관함
    gradeRates: { empty: 100, common: 250, uncommon: 300, rare: 250, epic: 90, legendary: 10 },
    items: [
      { itemId: 'battery', min: 1, max: 2 },
      { itemId: 'nvgparts', min: 1, max: 1 },
      { itemId: 'driverset', min: 1, max: 1 },
      { itemId: 'decryptor', min: 1, max: 1 },
      { itemId: 'coagulant', min: 1, max: 1 },
      { itemId: 'phasecore', min: 1, max: 1 },
      { itemId: 'journal', min: 1, max: 1 },
    ],
  },
  T4: { // 바닥 낙하물 (일반)
    gradeRates: { empty: 400, junk: 400, common: 200 },
    items: [
      { itemId: 'flashlight', min: 1, max: 1 },
      { itemId: 'wrench', min: 1, max: 1 },
      { itemId: 'rations', min: 1, max: 1 },
      { itemId: 'battery', min: 1, max: 1 },
    ],
  },
  T5: { // 발전실/통신 특수 보관함
    gradeRates: { empty: 300, uncommon: 200, rare: 250, epic: 200, legendary: 50 },
    items: [
      { itemId: 'nvgparts', min: 1, max: 1 },
      { itemId: 'carbonframe', min: 1, max: 1 },
      { itemId: 'decryptor', min: 1, max: 1 },
      { itemId: 'radio', min: 1, max: 1 },
      { itemId: 'phasecore', min: 1, max: 1 },
      { itemId: 'prototypecell', min: 1, max: 1 },
    ],
  },
  T6: { // 옥상/유물 창고
    gradeRates: { empty: 250, rare: 200, epic: 350, legendary: 200 },
    items: [
      { itemId: 'coagulant', min: 1, max: 1 },
      { itemId: 'specimen', min: 1, max: 1 },
      { itemId: 'radio', min: 1, max: 1 },
      { itemId: 'journal', min: 1, max: 1 },
      { itemId: 'prototypecell', min: 1, max: 1 },
    ],
  },
};

// ItemBox/Item 스포너에 드롭테이블을 순환 배정 (실제 기획 데이터가 아닌 데모용 재구성)
const MG_ITEMBOX_TABLE_CYCLE = ['T1', 'T2', 'T1', 'T3', 'T5', 'T1', 'T2', 'T6', 'T3', 'T1'];
const MG_ITEM_TABLE_CYCLE = ['T4', 'T1', 'T4', 'T4', 'T1', 'T4'];

(function assignLootTables() {
  MG_FLOORS.forEach((floor) => {
    let boxIdx = 0;
    let itemIdx = 0;
    floor.markers.forEach((m) => {
      if (m.type === 'ItemBox') {
        m.loot = MG_ITEMBOX_TABLE_CYCLE[boxIdx % MG_ITEMBOX_TABLE_CYCLE.length];
        boxIdx++;
      } else if (m.type === 'Item') {
        m.loot = MG_ITEM_TABLE_CYCLE[itemIdx % MG_ITEM_TABLE_CYCLE.length];
        itemIdx++;
      }
    });
  });
})();

// 아이템 이름 검색어와 매칭되는 드롭테이블 id 목록
function mgFindLootTablesByItemName(term) {
  const matchedIds = new Set(
    MG_ITEM_CATALOG.filter((it) => it.name.toLowerCase().includes(term)).map((it) => it.id)
  );
  const tables = new Set();
  if (matchedIds.size === 0) return tables;
  Object.entries(MG_LOOT_TABLES).forEach(([tableId, table]) => {
    if (table.items.some((it) => matchedIds.has(it.itemId))) tables.add(tableId);
  });
  return tables;
}
