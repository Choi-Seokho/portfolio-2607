// 서버에 "이 게임 페이지가 아직 열려 있음"을 알린다(tools/serve.py --auto-exit용).
// 탭을 닫으면 서버가 몇 초 뒤 스스로 꺼진다. 일반 개발 서버에서도 신호는 그냥 무시되므로 해가 없다.
export function startKeepAlive(intervalMs = 5000) {
  const ping = () => fetch('/__alive', { cache: 'no-store' }).catch(() => {});
  ping();
  setInterval(ping, intervalMs);
  addEventListener('pagehide', () => { try { navigator.sendBeacon('/__bye'); } catch { /* 무시 */ } });
}
