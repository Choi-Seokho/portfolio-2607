/* 페이지 안에 띄우는 화면: 프로토타입(실행 버튼 + 축소 표시), 전체 화면 버튼 */
(function () {
  var BASE_W = 1280;

  function isFull(el) {
    return (document.fullscreenElement || document.webkitFullscreenElement) === el;
  }

  function toggleFull(el) {
    if (isFull(el)) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el);
    }
  }

  // 전체 화면 버튼: data-fullscreen="대상 id"
  document.querySelectorAll('[data-fullscreen]').forEach(function (btn) {
    var target = document.getElementById(btn.getAttribute('data-fullscreen'));
    if (!target) return;
    if (!(target.requestFullscreen || target.webkitRequestFullscreen)) { btn.hidden = true; return; }
    btn.addEventListener('click', function () { toggleFull(target); });
    function sync() { btn.textContent = isFull(target) ? '전체 화면 닫기' : '전체 화면'; }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  });

  // 프로토타입: 1280x800 기준으로 만든 화면을 영역 너비에 맞춰 축소해서 보여준다
  var stage = document.getElementById('protoStage');
  if (!stage) return;
  var startBtn = document.getElementById('protoStart');
  var loading = document.getElementById('protoLoading');
  var frame = null;

  function fit() {
    if (!frame) return;
    var scale = stage.clientWidth / BASE_W;
    frame.style.transform = 'scale(' + scale + ')';
  }

  startBtn.addEventListener('click', function () {
    frame = document.createElement('iframe');
    frame.src = stage.getAttribute('data-src');
    frame.title = stage.getAttribute('data-title') || '프로토타입';
    loading.hidden = false;
    frame.addEventListener('load', function () { loading.hidden = true; frame.focus(); }, { once: true });
    startBtn.remove();
    stage.appendChild(frame);
    fit();
    var full = document.querySelector('[data-fullscreen="protoEmbed"]');
    if (full) full.hidden = false;
  });

  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  window.addEventListener('resize', fit);
})();
