/* DataViewer 데모용 가상 테이블 3종 — 실제 게임 데이터 스키마/수치가 아닌 포트폴리오 데모 전용 가칭 데이터입니다.
   Item → BaseItem → String 순으로 이어지는 실제 조회 체인 구조를 재현했습니다.

   Index 규칙(원본 데이터 규칙 참조): Item.Index = BaseItem.BaseID + 등급 순번(1~6)
     BaseID 1000 → 10001(Junk) 10002(Common) 10003(Uncommon) 10004(Rare) 10005(Epic) 10006(Legendary)
   즉 같은 BaseID를 공유하는 등급별 아이템들은 전부 같은 BaseItem(같은 이름/설명)을 참조하고,
   등급에 따라 수치(Value/Weight)와 Desc만 달라지는 구조입니다.

   의도적으로 끊어놓은 참조 2건 + 미사용(고아) 데이터 1건이 섞여 있어,
   "키값 하나로 전체 테이블을 검색해 참조 무결성을 확인하는" 데모 시나리오에 사용됩니다:
     - BaseID 1009: Item은 있지만 BaseItem 자체가 없음 (참조 끊김)
     - BaseID 1008: BaseItem은 있지만 String(ItemName_1008)이 없음 (문자열 누락)
     - BaseID 1010: BaseItem/String은 멀쩡하지만 참조하는 Item이 하나도 없음 (미사용 데이터) */

const DV_RARITY_ORDER = ['Junk', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

const DV_RARITY_COLOR = {
  Junk: '#9ca3af',
  Common: '#c9c6bf',
  Uncommon: '#22c55e',
  Rare: '#3b82f6',
  Epic: '#a855f7',
  Legendary: '#f97316',
};

// SampleItem — Index(PK) = BaseID + 등급순번, BaseID(FK → BaseItem)
const DV_ITEM_ROWS = [
  // BaseID 1000: 손전등 — Junk~Legendary 전체 등급 보유
  { Index: '10001', BaseID: '1000', Rarity: 'Junk', Value: 5, Weight: 0.4, Desc: '배터리가 거의 방전된 손전등. 희미한 빛만 겨우 낸다.' },
  { Index: '10002', BaseID: '1000', Rarity: 'Common', Value: 20, Weight: 0.4, Desc: '표준 규격의 휴대용 손전등.' },
  { Index: '10003', BaseID: '1000', Rarity: 'Uncommon', Value: 60, Weight: 0.4, Desc: '밝기를 조절할 수 있는 개선형 손전등.' },
  { Index: '10004', BaseID: '1000', Rarity: 'Rare', Value: 150, Weight: 0.5, Desc: '충격에 강한 전술용 손전등.' },
  { Index: '10005', BaseID: '1000', Rarity: 'Epic', Value: 400, Weight: 0.5, Desc: '야간 신호 기능이 내장된 특수 손전등.' },
  { Index: '10006', BaseID: '1000', Rarity: 'Legendary', Value: 900, Weight: 0.5, Desc: '군용 규격으로 제작된 초고휘도 손전등.' },

  // BaseID 1001: 렌치 — Junk~Rare
  { Index: '10011', BaseID: '1001', Rarity: 'Junk', Value: 8, Weight: 0.8, Desc: '군데군데 녹슨 렌치.' },
  { Index: '10012', BaseID: '1001', Rarity: 'Common', Value: 25, Weight: 0.8, Desc: '표준 규격 렌치.' },
  { Index: '10013', BaseID: '1001', Rarity: 'Uncommon', Value: 70, Weight: 0.9, Desc: '다양한 규격에 대응하는 조절 렌치.' },
  { Index: '10014', BaseID: '1001', Rarity: 'Rare', Value: 180, Weight: 0.9, Desc: '정밀 가공된 특수합금 렌치.' },

  // BaseID 1002: 비상 식량 세트 — Common~Legendary
  { Index: '10022', BaseID: '1002', Rarity: 'Common', Value: 40, Weight: 0.6, Desc: '기본 구성의 비상 식량 세트.' },
  { Index: '10023', BaseID: '1002', Rarity: 'Uncommon', Value: 90, Weight: 0.6, Desc: '칼로리가 보강된 비상 식량 세트.' },
  { Index: '10024', BaseID: '1002', Rarity: 'Rare', Value: 220, Weight: 0.7, Desc: '장기 원정용으로 포장된 식량 세트.' },
  { Index: '10025', BaseID: '1002', Rarity: 'Epic', Value: 500, Weight: 0.7, Desc: '영양 밸런스가 최적화된 특수 식량 세트.' },
  { Index: '10026', BaseID: '1002', Rarity: 'Legendary', Value: 1100, Weight: 0.7, Desc: '군수용으로 개발된 완전식 식량 세트.' },

  // BaseID 1003: 구급 키트 — Common~Epic
  { Index: '10032', BaseID: '1003', Rarity: 'Common', Value: 65, Weight: 0.5, Desc: '기본 구급 키트.' },
  { Index: '10033', BaseID: '1003', Rarity: 'Uncommon', Value: 150, Weight: 0.5, Desc: '지혈 기능이 강화된 구급 키트.' },
  { Index: '10034', BaseID: '1003', Rarity: 'Rare', Value: 340, Weight: 0.6, Desc: '야전 수술도 가능한 고급 구급 키트.' },
  { Index: '10035', BaseID: '1003', Rarity: 'Epic', Value: 700, Weight: 0.6, Desc: '특수부대 규격의 응급처치 키트.' },

  // BaseID 1004: 방어구 조끼 — Uncommon~Legendary
  { Index: '10043', BaseID: '1004', Rarity: 'Uncommon', Value: 220, Weight: 2.4, Desc: '합성 섬유로 제작된 방어 조끼.' },
  { Index: '10044', BaseID: '1004', Rarity: 'Rare', Value: 480, Weight: 2.6, Desc: '충격 흡수 패널이 내장된 방어 조끼.' },
  { Index: '10045', BaseID: '1004', Rarity: 'Epic', Value: 950, Weight: 2.8, Desc: '경량 세라믹 플레이트가 삽입된 방어 조끼.' },
  { Index: '10046', BaseID: '1004', Rarity: 'Legendary', Value: 2000, Weight: 2.5, Desc: '실험적 나노 섬유로 제작된 방어 조끼.' },

  // BaseID 1005: 정찰 드론 부품 — Rare~Legendary
  { Index: '10054', BaseID: '1005', Rarity: 'Rare', Value: 410, Weight: 1.8, Desc: '부분적으로 손상된 드론 부품.' },
  { Index: '10055', BaseID: '1005', Rarity: 'Epic', Value: 900, Weight: 1.8, Desc: '정밀 센서가 포함된 드론 부품.' },
  { Index: '10056', BaseID: '1005', Rarity: 'Legendary', Value: 2200, Weight: 1.9, Desc: '시제품 단계의 초정밀 드론 부품.' },

  // BaseID 1006: 통신 단말기 — Epic~Legendary
  { Index: '10065', BaseID: '1006', Rarity: 'Epic', Value: 980, Weight: 0.9, Desc: '군용 주파수를 수신할 수 있는 통신 단말기.' },
  { Index: '10066', BaseID: '1006', Rarity: 'Legendary', Value: 2400, Weight: 0.9, Desc: '암호화 통신이 가능한 시제품 단말기.' },

  // BaseID 1007: 고대 유물 표본 — Legendary만 존재
  { Index: '10076', BaseID: '1007', Rarity: 'Legendary', Value: 3200, Weight: 0.4, Desc: '학계에 보고되지 않은 미확인 유물 표본.' },

  // BaseID 1008: 봉인된 연구 일지 — Junk~Common (⚠ String 누락 데모)
  { Index: '10081', BaseID: '1008', Rarity: 'Junk', Value: 15, Weight: 0.4, Desc: '표지가 봉인되어 내용을 알 수 없는 일지.' },
  { Index: '10082', BaseID: '1008', Rarity: 'Common', Value: 50, Weight: 0.4, Desc: '일부 페이지가 해독된 봉인 일지.' },

  // BaseID 1009: ⚠ BaseItem 자체가 존재하지 않음 (참조 끊김 데모)
  { Index: '10091', BaseID: '1009', Rarity: 'Junk', Value: 10, Weight: 0.3, Desc: '출처가 명확하지 않은 부품 조각.' },

  // BaseID 1010은 BaseItem/String만 존재하고 Item 없음 (미사용 데이터 데모, 아래 DV_BASEITEM_ROWS 참고)
];

// SampleBaseItem — BaseID(PK), StringTableID(FK → String), Category, Desc
const DV_BASEITEM_ROWS = [
  { BaseID: '1000', StringTableID: 'ItemName_1000', Category: '생존장비', Desc: '정전 상황에서 필수적인 개인 조명 장비.' },
  { BaseID: '1001', StringTableID: 'ItemName_1001', Category: '도구', Desc: '각종 장비를 수리할 때 사용하는 공구.' },
  { BaseID: '1002', StringTableID: 'ItemName_1002', Category: '자원', Desc: '장기 보관이 가능한 비상용 식량 패키지.' },
  { BaseID: '1003', StringTableID: 'ItemName_1003', Category: '의료', Desc: '부상 처치를 위한 기본 의료 용품 모음.' },
  { BaseID: '1004', StringTableID: 'ItemName_1004', Category: '방어구', Desc: '상체를 보호하는 방어구.' },
  { BaseID: '1005', StringTableID: 'ItemName_1005', Category: '자원', Desc: '정찰용 드론을 조립·수리하는 데 쓰이는 부품.' },
  { BaseID: '1006', StringTableID: 'ItemName_1006', Category: '도구', Desc: '장거리 무선 통신을 위한 휴대 단말기.' },
  { BaseID: '1007', StringTableID: 'ItemName_1007', Category: '유물', Desc: '출처를 알 수 없는 고대의 유물 조각.' },
  // ⚠ 의도적 오류: String 테이블에 ItemName_1008 행이 없음 (문자열 누락)
  { BaseID: '1008', StringTableID: 'ItemName_1008', Category: '유물', Desc: '표지가 봉인된 채 발견된 정체불명의 연구 기록물.' },
  // ⚠ 미사용(고아) 데이터: 이 BaseID를 참조하는 Item이 없음
  { BaseID: '1010', StringTableID: 'ItemName_1010', Category: '도구', Desc: '예전에 쓰이던 구형 휴대용 발전기. 현재는 사용되지 않는다.' },
];

// SampleString — StringID(PK) = "ItemName_{BaseID}" 규칙, 다국어 컬럼 보유
const DV_STRING_ROWS = [
  { StringID: 'ItemName_1000', Korean: '손전등', English: 'Flashlight', Japanese: '懐中電灯' },
  { StringID: 'ItemName_1001', Korean: '렌치', English: 'Wrench', Japanese: 'レンチ' },
  { StringID: 'ItemName_1002', Korean: '비상 식량 세트', English: 'Emergency Ration Kit', Japanese: '非常食セット' },
  { StringID: 'ItemName_1003', Korean: '구급 키트', English: 'First Aid Kit', Japanese: '救急キット' },
  { StringID: 'ItemName_1004', Korean: '방어구 조끼', English: 'Armor Vest', Japanese: '防具ベスト' },
  { StringID: 'ItemName_1005', Korean: '정찰 드론 부품', English: 'Recon Drone Parts', Japanese: '偵察ドローン部品' },
  { StringID: 'ItemName_1006', Korean: '통신 단말기', English: 'Comm Device', Japanese: '通信端末' },
  { StringID: 'ItemName_1007', Korean: '고대 유물 표본', English: 'Ancient Relic Sample', Japanese: '古代遺物サンプル' },
  // ItemName_1008 (봉인된 연구 일지) 은 의도적으로 누락 — BaseID 1008이 참조하지만 실제 문자열이 없는 상태
  { StringID: 'ItemName_1010', Korean: '구형 발전기', English: 'Old Generator', Japanese: '旧型ジェネレーター' },
];

const DV_TABLES = {
  Item: {
    label: 'SampleItem',
    columns: [
      { key: 'Index', label: 'Index' },
      { key: 'BaseID', label: 'BaseID (FK)' },
      { key: 'ResolvedName', label: '해석된 이름 (Item→BaseItem→String)' },
      { key: 'Rarity', label: 'Rarity' },
      { key: 'Value', label: 'Value' },
      { key: 'Weight', label: 'Weight' },
      { key: 'Desc', label: 'Desc' },
    ],
    rows: DV_ITEM_ROWS,
  },
  BaseItem: {
    label: 'SampleBaseItem',
    columns: [
      { key: 'BaseID', label: 'BaseID' },
      { key: 'StringTableID', label: 'StringTableID (FK)' },
      { key: 'Category', label: 'Category' },
      { key: 'Desc', label: 'Desc' },
      { key: 'RefCount', label: 'Item 참조 수' },
    ],
    rows: DV_BASEITEM_ROWS,
  },
  String: {
    label: 'SampleString',
    columns: [
      { key: 'StringID', label: 'StringID' },
      { key: 'Korean', label: 'Korean' },
      { key: 'English', label: 'English' },
      { key: 'Japanese', label: 'Japanese' },
    ],
    rows: DV_STRING_ROWS,
  },
};

// Item.BaseID → BaseItem → String.Korean 체인을 해석. 끊긴 지점을 status로 표시.
function dvResolveItemName(item) {
  const baseItem = DV_BASEITEM_ROWS.find((b) => b.BaseID === item.BaseID);
  if (!baseItem) {
    return { status: 'broken', text: `⚠ BaseItem 없음 (BaseID ${item.BaseID})` };
  }
  const str = DV_STRING_ROWS.find((s) => s.StringID === baseItem.StringTableID);
  if (!str) {
    return { status: 'broken', text: `⚠ String 없음 (StringID ${baseItem.StringTableID})` };
  }
  return { status: 'ok', text: str.Korean };
}

// 특정 BaseID를 참조하는 Item 개수 (미사용/고아 데이터 탐지용)
function dvCountItemRefs(baseID) {
  return DV_ITEM_ROWS.filter((it) => it.BaseID === baseID).length;
}
