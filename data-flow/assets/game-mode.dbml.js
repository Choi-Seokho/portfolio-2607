/* 게임 모드 → 페이즈 프로세스 DBML. 사전에 정리된 기획 문서가 없어, DT_GameMode.Json /
   DT_GameMode_Group.Json / DT_PhaseProcess.Json 원본을 직접 분석해서 작성했습니다.
   QA/테스트 전용 플래그(IsTest 등)는 핵심 흐름과 무관해 제외했습니다. */

const GM_DBML = `// 게임 모드 -> 페이즈 프로세스 데이터 관계도
// https://dbdiagram.io 에 붙여넣기

Project GameMode {
  Note: '게임 모드 - 라운드 진행에 따라 이어지는 페이즈 체인 구조'
}

Table DT_GameMode_Group {
  Id int [pk, note: '고유 ID']
  Name string [unique, note: '그룹 이름. 게임 모드가 이 값을 문자열로 참조']
  ModeType string [note: '모드 분류 (PvE, PvPvE 등)']
  MinEntryLevel int [note: '입장 최소 레벨']
  IsRanking int [note: '랭킹 집계 대상 여부']
  Name_StringID string [note: '표시 이름']
  Note: '게임 모드 상위 그룹 (예: Rookie, Normal, Hardcore)'
}

Table DT_GameMode {
  Index int [pk, note: '고유 ID']
  Group string [note: '소속 그룹. ID가 아니라 이름으로 매칭']
  SquadType string [note: '인원 구성 (Solo, Duo, Trio 등)']
  MinUser int [note: '최소 매칭 인원']
  MaxUser int [note: '최대 매칭 인원']
  WaitingTimeSec int [note: '매칭 대기 시간(초)']
  IntervalTimeSec int [note: '매칭 시도 간격(초)']
  RotationMinute int [note: '맵 순환 주기(분)']
  Level1 string [note: '순환 맵 1']
  Level2 string [note: '순환 맵 2']
  GameTime int [note: '라운드 총 제한 시간(초)']
  StartPhaseProcess_ID int [note: '라운드 시작 시 진입하는 페이즈']
  ModeName_StringID string [note: '모드 이름']
  Rule_StringID string [note: '모드 규칙 설명']
  ModeImg_UIResourcesID string [note: '모드 대표 이미지 리소스']
  MinItemScore int [note: '입장 최소 아이템 점수 제한']
  MaxItemScore int [note: '입장 최대 아이템 점수 제한']
  UseKillLog bool [note: '킬 로그 사용 여부']
  UseGainedItemFloatingNotify bool [note: '아이템 획득 플로팅 알림 사용 여부']
  UseGainedExpFloatingNotify bool [note: '경험치 획득 플로팅 알림 사용 여부']
  Note: '개별 게임 모드 (예: 탐험 솔로, 탐험 듀오)'
}

Table DT_PhaseProcess {
  Index int [pk, note: '내부 순번']
  ID int [unique, note: '실제로 참조되는 페이즈 식별자']
  NextPhase_ID int [note: '다음 페이즈로 이어지는 자기 참조. 값이 없으면 마지막 페이즈']
  PhaseEndTime int [note: '이 페이즈가 끝나는 누적 시각(초)']
  ShutdownFloorCnt int [note: '이 페이즈에서 폐쇄되는 층 수']
  PoisonDmg int [note: '이 페이즈에서 적용되는 독 피해']
  AppearExtractPointCnt int [note: '이 페이즈에서 새로 열리는 탈출구 수']
  ActivateRedroom int [note: '특수 구역(레드룸) 활성화 여부']
  Note: '시간 흐름에 따라 이어지는 라운드 진행 단계. NextPhase_ID로 체인을 구성'
}

Table DT_String {
  Key string [pk, note: 'String Key']
  Korean string [note: '한글 텍스트']
  English string [note: '영문 텍스트']
}

Ref: DT_GameMode.Group > DT_GameMode_Group.Name
Ref: DT_GameMode.StartPhaseProcess_ID > DT_PhaseProcess.ID
Ref: DT_PhaseProcess.NextPhase_ID > DT_PhaseProcess.ID
Ref: DT_GameMode.ModeName_StringID > DT_String.Key
Ref: DT_GameMode.Rule_StringID > DT_String.Key
Ref: DT_GameMode_Group.Name_StringID > DT_String.Key
`;
