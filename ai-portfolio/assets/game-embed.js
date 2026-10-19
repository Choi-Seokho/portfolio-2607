/* 플레이 데모: 페이지 안에서 게임을 띄운다.
   - "데모 실행하기"를 누르면 iframe을 만들고 바로 전체 화면으로 연다.
   - 평소에는 1600x900 화면을 영역 너비에 맞춰 축소해서 보여 준다.
   - 전체 화면에서는 축소 없이 화면 크기 그대로 띄운다. Esc로 전체 화면이 닫혀도 게임은 이 자리에서 이어진다.
   - Chrome, Edge에서는 전체 화면 동안 Esc를 게임에 넘긴다(길게 누르면 전체 화면이 닫힘). */
(function () {
  var BASE_W = 1600, BASE_H = 900;
  var embed = document.getElementById('gameEmbed');
  var stage = document.getElementById('gameStage');
  if (!embed || !stage) return;
  var startBtn = document.getElementById('gameStart');
  var loading = document.getElementById('gameLoading');
  var fullBtn = document.getElementById('gameFull');
  var frame = null;

  function isFull() { return (document.fullscreenElement || document.webkitFullscreenElement) === embed; }
  function canFull() { return !!(embed.requestFullscreen || embed.webkitRequestFullscreen); }
  function lockEsc() {
    if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(function () {});
  }
  function unlockEsc() {
    if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
  }
  function enterFull() {
    var req = embed.requestFullscreen || embed.webkitRequestFullscreen;
    if (!req) return;
    try {
      var p = req.call(embed);
      if (p && p.then) p.then(lockEsc, function () {}); else lockEsc();
    } catch (e) { /* 전체 화면을 못 쓰는 환경 */ }
  }
  function exitFull() { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }

  function fit() {
    if (!frame) return;
    if (isFull()) {
      frame.style.width = stage.clientWidth + 'px';
      frame.style.height = stage.clientHeight + 'px';
      frame.style.transform = 'none';
    } else {
      frame.style.width = BASE_W + 'px';
      frame.style.height = BASE_H + 'px';
      frame.style.transform = 'scale(' + stage.clientWidth / BASE_W + ')';
    }
  }

  function sync() {
    if (!isFull()) unlockEsc();
    if (fullBtn) fullBtn.textContent = isFull() ? '전체 화면 닫기' : '전체 화면으로 보기';
    requestAnimationFrame(fit);
    if (frame) frame.focus();
  }

  startBtn.addEventListener('click', function () {
    var wantFull = canFull();
    frame = document.createElement('iframe');
    frame.src = stage.getAttribute('data-src');
    frame.title = stage.getAttribute('data-title') || '플레이 데모';
    frame.setAttribute('allow', 'fullscreen');
    loading.hidden = false;
    frame.addEventListener('load', function () { loading.hidden = true; frame.focus(); }, { once: true });
    startBtn.remove();
    stage.appendChild(frame);
    fit();
    if (fullBtn) fullBtn.hidden = !canFull();
    if (wantFull) enterFull();
  });

  if (fullBtn) fullBtn.addEventListener('click', function () { if (isFull()) exitFull(); else enterFull(); });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  window.addEventListener('resize', fit);
})();
