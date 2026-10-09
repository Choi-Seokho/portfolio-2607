/* TradeLogViewer 데모용 가상 로그 데이터 — 실제 서비스 로그가 아닌 포트폴리오 데모 전용 가상 데이터입니다.
   실제 TradeLogViewer가 겪었던 문제(등록만 되고 실제로 안 팔린 매물이 "최고가 거래" 순위에 섞여 들어가는 문제)를
   그대로 재현하기 위해, 거래를 "등록 → (구매 → 정산) | 회수 | 만료" 흐름으로 생성합니다.
   TradeId로 등록-구매 로그를 매칭해야만 실제로 체결된 거래만 걸러낼 수 있습니다. */

// 결정적 의사난수 (항상 같은 데모 데이터가 생성되도록 시드 고정)
function tlMulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TL_LOG_TYPES = {
  REGISTER: { id: 10121, name: '등록', cls: 'tl-type-start' },
  WITHDRAW: { id: 10122, name: '회수', cls: 'tl-type-cancel' },
  EXPIRED: { id: 10123, name: '만료', cls: 'tl-type-neutral' },
  PURCHASE: { id: 10124, name: '구매', cls: 'tl-type-success' },
  SETTLE: { id: 10125, name: '정산', cls: 'tl-type-settle' },
};

// 등급별 가격대 (코인) — DV_RARITY_ORDER/DV_RARITY_COLOR는 item-data.js 참고
const TL_PRICE_RANGE = {
  Junk: [10, 80],
  Common: [80, 400],
  Uncommon: [400, 1200],
  Rare: [1200, 3500],
  Epic: [3500, 9000],
  Legendary: [9000, 22000],
};

const TL_ITEMS = [
  { name: '손전등', rarity: 'Common' },
  { name: '렌치', rarity: 'Uncommon' },
  { name: '비상 식량 세트', rarity: 'Rare' },
  { name: '구급 키트', rarity: 'Epic' },
  { name: '방어구 조끼', rarity: 'Legendary' },
  { name: '정찰 드론 부품', rarity: 'Epic' },
  { name: '통신 단말기', rarity: 'Legendary' },
  { name: '고대 유물 표본', rarity: 'Legendary' },
  { name: '휴대용 발전기', rarity: 'Uncommon' },
  { name: '녹슨 부품 조각', rarity: 'Junk' },
];

const TL_USERS = [
  '한밤의그림자', '레드폭스', '나이트워커', '조디악', '서바이버_강',
  '방랑자K', '고스트런너', '철벽수비대', '노아드림', '이든',
];

function tlGenerateLogs() {
  const rng = tlMulberry32(20260715);
  const now = new Date('2026-07-15T23:00:00');
  const logs = [];
  let seq = 1;

  const TRADE_COUNT = 280;
  for (let i = 0; i < TRADE_COUNT; i++) {
    const item = TL_ITEMS[Math.floor(rng() * TL_ITEMS.length)];
    const [min, max] = TL_PRICE_RANGE[item.rarity];
    const price = Math.round((min + rng() * (max - min)) / 10) * 10;
    const tradeId = `TR${(100000 + i).toString()}`;
    const actionIdBase = `ACT${(500000 + seq).toString()}`;

    // 시간대 가중치: 저녁(18~23시)에 몰리도록
    const hourWeights = [1,1,1,1,1,1,2,3,3,4,4,5,5,5,4,4,5,6,8,9,9,8,6,3];
    const totalW = hourWeights.reduce((a, b) => a + b, 0);
    let pick = rng() * totalW;
    let hour = 0;
    for (let h = 0; h < 24; h++) { pick -= hourWeights[h]; if (pick <= 0) { hour = h; break; } }
    const minute = Math.floor(rng() * 60);
    const dayOffset = rng() < 0.5 ? 0 : 1; // 최근 이틀 분산
    const registerTime = new Date(now);
    registerTime.setDate(registerTime.getDate() - dayOffset);
    registerTime.setHours(hour, minute, Math.floor(rng() * 60), 0);

    logs.push({
      id: seq++, time: new Date(registerTime), type: 'REGISTER',
      itemName: item.name, rarity: item.rarity, count: 1, price,
      tradeId, actionId: actionIdBase, buyerName: null, buyerPcName: null,
    });

    const outcome = rng();
    if (outcome < 0.55) {
      // 체결: 구매 + 정산
      const purchaseTime = new Date(registerTime.getTime() + (5 + rng() * 340) * 60000);
      const buyer = TL_USERS[Math.floor(rng() * TL_USERS.length)];
      const purchaseActionId = `ACT${(500000 + seq).toString()}`;
      logs.push({
        id: seq++, time: purchaseTime, type: 'PURCHASE',
        itemName: item.name, rarity: item.rarity, count: 1, price,
        tradeId, actionId: purchaseActionId, buyerName: buyer, buyerPcName: `${buyer}_캐릭`,
      });
      const settleTime = new Date(purchaseTime.getTime() + 2000);
      logs.push({
        id: seq++, time: settleTime, type: 'SETTLE',
        itemName: item.name, rarity: item.rarity, count: 1, price,
        tradeId, actionId: `ACT${(500000 + seq).toString()}`, buyerName: buyer, buyerPcName: `${buyer}_캐릭`,
      });
    } else if (outcome < 0.85) {
      // 미체결: 만료
      const expireTime = new Date(registerTime.getTime() + (60 + rng() * 60) * 60000 * 12);
      logs.push({
        id: seq++, time: expireTime, type: 'EXPIRED',
        itemName: item.name, rarity: item.rarity, count: 1, price,
        tradeId, actionId: `ACT${(500000 + seq).toString()}`, buyerName: null, buyerPcName: null,
      });
    } else {
      // 미체결: 판매자 회수
      const withdrawTime = new Date(registerTime.getTime() + (10 + rng() * 280) * 60000);
      logs.push({
        id: seq++, time: withdrawTime, type: 'WITHDRAW',
        itemName: item.name, rarity: item.rarity, count: 1, price,
        tradeId, actionId: `ACT${(500000 + seq).toString()}`, buyerName: null, buyerPcName: null,
      });
    }
  }

  return logs.sort((a, b) => b.time - a.time);
}

const TL_LOGS = tlGenerateLogs();
