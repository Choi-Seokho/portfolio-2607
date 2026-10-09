/* 제작대 리뉴얼 DBML 원문. dbdiagram.io DBML-in-Link(https://docs.dbdiagram.io/dbml-in-link-diagram/) 방식으로
   계정 없이 임베드 URL을 만드는 데 씁니다. 실 밸런스 수치/사내 링크는 없는 원문 그대로입니다. */

const CS_DBML = `// 제작대 리뉴얼 - 데이터 관계도
// https://dbdiagram.io 에 붙여넣기
// 2026-03-19 업데이트: OTS v24 반영 — MinGrade 제거, MaxGrade→ItemRarity, MaxLevel/Desc_StringID 폐기 주석

Project Workbench {
  Note: '제작 시스템 리뉴얼 - 데이터 테이블 구조'
}

// ─── 서버 테이블 ───

Table WorkbenchStation {
  DataId int [pk, note: '제작대 고유 ID']
  IsDefaultUnlocked bool [note: '기본 제공 여부 (true=초기 해금)']
  MaxLevel int [note: '최대 레벨 (기본: 5). ※ NextLevelMeterialGroupId=0으로 최대레벨 판단 가능하여 폐기 예정']
  MaterialGroupID int [note: '해금 재료 그룹 (WorkbenchMeterial.GroupId)']
  // --- 클라이언트 전용 ---
  Name_StringID string [note: '제작대 이름 (String 참조)']
  Desc_StringID string [note: '제작대 설명 (String 참조). ※ 사용처 없어 미추가 예정']
  IconPath string [note: '아이콘/일러스트 경로']
  SortOrder int [note: '표시 순서 (오름차순)']
  Note: '제작대 정의 (서버+클라이언트)'
}

Table WorkbenchStationLevel {
  DataId int [pk, note: '고유 ID']
  WorkbenchStationId int [note: '제작대 ID']
  Level int [note: '레벨 (1~MaxLevel)']
  NextLevelMeterialGroupId int [note: '다음 레벨 재료 그룹 (WorkbenchMeterial.GroupId). 최대레벨=0 (레벨업 불가)']
  ItemRarity enum [note: '제작 가능 최대 등급 (EItemRarity). 해당 등급 이하 모두 제작 가능']
  Note: '제작대 레벨별 정의'
}

Table WorkbenchCraftItem {
  DataId int [pk, note: '고유 ID']
  CraftingOutputItemDataId int [note: '제작 결과 아이템 (Item.DataId)']
  CraftingOutputCount int [note: '1회 제작 배출 수량']
  RequipredItemDataId int [note: '장비 재료 아이템 ID (Item.DataId 참조, 0=없음). >0이면 스탯 승계. 교차 등급 가능 (예: Uncommon→Rare 제작)']
  RequipredBlueprintItemDataId int [note: '설계도 아이템 ID (0=기본 제작)']
  MaterialGroupID int [note: '재료 그룹 (WorkbenchMeterial.GroupId)']
  // --- 클라이언트 전용 ---
  WorkbenchStationId int [note: '소속 제작대 (WorkbenchStation.DataId)']
  Note: '제작 아이템 정의 (서버+클라이언트)'
}

Table WorkbenchMeterial {
  DataId int [pk, note: '고유 ID']
  GroupId int [note: '재료 그룹 ID (같은 GroupId = 한 세트, 최대 6종)']
  MaterialType int [note: '재료 종류 (WorkbenchEnum: 1=재화, 2=아이템)']
  MaterialId int [note: '재료 아이템 ID (MaterialType에 따라 참조 테이블 결정)']
  MaterialValue int [note: '소모 수량']
  Note: '통합 재료 테이블 (해금/레벨업/제작 공용)'
}

Table WorkbenchEnum {
  DataId int [pk, note: '열거형 ID']
  // 1: 재화, 2: 아이템
  Note: '재료 타입 열거형'
}

Table WorkbenchFactor {
  DataId int [pk, note: '고유 ID']
  MaxMaterialTypeCount int [note: '재료 최대 종류 수 (기본: 6)']
  Note: '제작 시스템 공용 상수'
}

// ─── 참조 테이블 ───

Table Item {
  DataId int [pk, note: '아이템 고유 ID']
  BaseId int [note: '기본 아이템 ID']
  ItemRarity int [note: '아이템 등급 (EItemRarity)']
  Note: '아이템 테이블 (등급별)'
}

Table BaseItem {
  DataId int [pk, note: '기본 아이템 고유 ID']
  StringTableID string [note: '이름 String ID']
  MainCategory int [note: '대분류 (EItemMainCategory)']
  SubCategory int [note: '소분류 (Blueprint=18)']
  Note: '베이스 아이템 테이블'
}

Table String {
  Key string [pk, note: 'String Key']
  Korean string [note: '한글 텍스트']
  English string [note: '영문 텍스트']
}

// ─── 관계 (References) ───

// 재료 그룹 참조 (통합 재료 테이블)
Ref: WorkbenchStation.MaterialGroupID > WorkbenchMeterial.GroupId
Ref: WorkbenchStationLevel.NextLevelMeterialGroupId > WorkbenchMeterial.GroupId
Ref: WorkbenchCraftItem.MaterialGroupID > WorkbenchMeterial.GroupId

// 제작대 레벨 → 제작대
Ref: WorkbenchStationLevel.WorkbenchStationId > WorkbenchStation.DataId

// 제작 아이템 → 제작대 (클라이언트)
Ref: WorkbenchCraftItem.WorkbenchStationId > WorkbenchStation.DataId

// 제작 아이템 → 아이템 참조
Ref: WorkbenchCraftItem.CraftingOutputItemDataId > Item.DataId
Ref: WorkbenchCraftItem.RequipredItemDataId > Item.DataId  // 교차 등급: 출력과 다른 등급 장비 요구 가능
Ref: WorkbenchCraftItem.RequipredBlueprintItemDataId > Item.DataId

// 재료 → 아이템
Ref: WorkbenchMeterial.MaterialId > Item.DataId

// 재료 타입 → 열거형
Ref: WorkbenchMeterial.MaterialType < WorkbenchEnum.DataId

// 아이템 → 기본 아이템
Ref: Item.BaseId > BaseItem.DataId

// 기본 아이템 이름 → String
Ref: BaseItem.StringTableID > String.Key
`;
