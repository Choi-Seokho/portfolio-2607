/* 일일 미션(Daily Mission) DBML. 실제 서비스 중인 DT_*.Json 데이터의 컬럼명을 직접 대조해서
   작성했습니다(사전에 작성된 기획 문서의 컬럼명과 실제 데이터가 다른 부분은 실제 데이터 기준으로 보정).
   실 밸런스 수치/사내 링크는 없는 구조 정의만 담았습니다. */

const DM_DBML = `// 일일 미션(Daily Mission) 데이터 관계도
// https://dbdiagram.io 에 붙여넣기

Project DailyMission {
  Note: '일일 미션 - 슬롯 기반 미션 풀 + 범용 보상 상자 구조'
}

// --- 일일 미션 코어 ---

Table DT_DailyMissionConfig {
  Id int [pk, note: '고유 ID']
  SlotCount int [note: '일일 미션 슬롯 수']
  MaxRerollCount int [note: '일일 최대 리롤 횟수']
  ResetHourUTC int [note: '초기화 시각(UTC)']
  Note: '일일 미션 글로벌 설정'
}

Table DT_DailyMissionPool {
  Id int [pk, note: '고유 ID']
  Slot int [note: '슬롯 번호']
  MissionObjectiveId int [note: '미션 목표 참조']
  DescriptionKey string [note: '슬롯 전용 설명 문자열']
  RewardBoxGroupId string [note: '보상 상자 그룹']
  Note: '슬롯별 미션 풀'
}

Table DT_DailyMissionMilestone {
  Id int [pk, note: '고유 ID']
  RequiredCount int [note: '필요 누적 완료 미션 수']
  RewardBoxGroupId string [note: '보상 상자 그룹']
  Description string [note: '설명 문자열']
  Note: '누적 완료 마일스톤 보상'
}

// --- 공용 미션 목표 ---

Table DT_MissionObjective {
  Id int [pk, note: '고유 ID']
  Group string [note: '소속 그룹. 일일 미션 외 다른 미션 시스템도 함께 참조하는 공용 값']
  DisplayOrder int [note: '표시 순서']
  MissionObjectiveType string [note: '목표 타입']
  Item int [note: '목표 아이템, 등급 포함. 0이면 미사용']
  BaseItem int [note: '목표 아이템, 등급 무관. 0이면 미사용, Item보다 우선']
  VolumeId string [note: '목표 지역 ID']
  Object string [note: '목표 오브젝트']
  MonsterType string [note: '목표 몬스터 타입']
  MonsterId string [note: '목표 몬스터 ID']
  Count int [note: '수행 횟수']
  GameModeGroup string [note: '진행 가능한 게임 모드 그룹']
  SquadType string [note: '스쿼드 타입 제한']
  Description string [note: '기본 설명 문자열']
  Note: '미션 목표 정의. 일일 미션 외에 다른 미션 시스템도 함께 참조하는 공용 테이블'
}

// --- 범용 보상 상자 ---

Table DT_RewardBox {
  Id int [pk, note: '고유 ID']
  BoxId string [unique, note: '개별 보상 상자 식별자. 클래스별 변형을 포함']
  GroupId string [note: '상자 그룹 식별자. 같은 값끼리 클래스별 변형을 한 세트로 묶음']
  Name string [note: '상자 이름']
  Icon string [note: '상자 아이콘']
  Grade string [note: '등급. 색상 표시가 여기서 파생됨']
  Description string [note: '상자 설명']
  Category string [note: 'mission / milestone 등 분류']
  ClassFilter string [note: '빈 값이면 공용, 값이 있으면 해당 클래스 전용 변형']
  Note: '범용 보상 상자 정의. 미션 풀과 마일스톤이 공통으로 참조'
}

// --- 참조 테이블 ---

Table DT_Item {
  DataId int [pk, note: '아이템 고유 ID']
  Note: '아이템 테이블 (등급별, 기존 참조)'
}

Table DT_BaseItem {
  DataId int [pk, note: '기본 아이템 고유 ID']
  Note: '베이스 아이템 테이블 (등급 무관, 기존 참조)'
}

Table DT_GameMode_Group {
  Name string [pk, note: '게임 모드 그룹 이름']
  Note: '게임 모드 그룹 (기존 참조, 게임 모드 다이어그램과 공유)'
}

Table DT_String {
  Key string [pk, note: 'String Key']
  Korean string [note: '한글 텍스트']
  English string [note: '영문 텍스트']
}

// --- 관계 ---

Ref: DT_DailyMissionPool.MissionObjectiveId > DT_MissionObjective.Id
Ref: DT_DailyMissionPool.RewardBoxGroupId > DT_RewardBox.GroupId
Ref: DT_DailyMissionPool.DescriptionKey > DT_String.Key

Ref: DT_DailyMissionMilestone.RewardBoxGroupId > DT_RewardBox.GroupId
Ref: DT_DailyMissionMilestone.Description > DT_String.Key

Ref: DT_MissionObjective.Item > DT_Item.DataId
Ref: DT_MissionObjective.BaseItem > DT_BaseItem.DataId
Ref: DT_MissionObjective.GameModeGroup > DT_GameMode_Group.Name
Ref: DT_MissionObjective.Description > DT_String.Key

Ref: DT_RewardBox.Name > DT_String.Key
Ref: DT_RewardBox.Description > DT_String.Key
`;
