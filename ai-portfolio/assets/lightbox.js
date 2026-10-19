/* 스크린샷 크게 보기: 갤러리(.shot-card)와 그림(.ap-figure)의 이미지를 누르면 화면 가운데에 크게 띄운다.
   - 같은 페이지의 다른 이미지로 ←/→ 키 또는 양옆 버튼으로 넘긴다.
   - 바깥을 누르거나 Esc, 닫기 버튼으로 닫는다. */
(function () {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('.shot-card img, .ap-figure img'));
  if (!imgs.length) return;

  function captionOf(img) {
    var box = img.closest('.shot-card, .ap-figure');
    var cap = box && box.querySelector('.caption, figcaption');
    return cap ? cap.textContent.trim() : img.alt;
  }

  var box = document.createElement('div');
  box.className = 'ap-lightbox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '이미지 크게 보기');
  box.innerHTML =
    '<button type="button" class="lb-close" aria-label="닫기">×</button>' +
    '<button type="button" class="lb-nav lb-prev" aria-label="이전 이미지">‹</button>' +
    '<figure><img alt="" /><figcaption><span class="lb-count"></span><span class="lb-cap"></span></figcaption></figure>' +
    '<button type="button" class="lb-nav lb-next" aria-label="다음 이미지">›</button>';
  document.body.appendChild(box);
  var big = box.querySelector('img');
  var cap = box.querySelector('.lb-cap');
  var count = box.querySelector('.lb-count');
  var prev = box.querySelector('.lb-prev');
  var next = box.querySelector('.lb-next');
  var index = 0, lastFocus = null;

  function show(i) {
    index = (i + imgs.length) % imgs.length;
    var img = imgs[index];
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    cap.textContent = captionOf(img);
    count.textContent = imgs.length > 1 ? (index + 1) + ' / ' + imgs.length : '';
  }
  function open(i) {
    lastFocus = document.activeElement;
    show(i);
    box.hidden = false;
    document.documentElement.classList.add('lb-open');
    box.querySelector('.lb-close').focus();
  }
  function close() {
    box.hidden = true;
    document.documentElement.classList.remove('lb-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  prev.hidden = next.hidden = imgs.length < 2;
  imgs.forEach(function (img, i) {
    img.classList.add('lb-zoomable');
    img.tabIndex = 0;
    img.addEventListener('click', function () { open(i); });
    img.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
  });
  box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'FIGURE') close(); });
  box.querySelector('.lb-close').addEventListener('click', close);
  prev.addEventListener('click', function () { show(index - 1); });
  next.addEventListener('click', function () { show(index + 1); });
  document.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  });
})();
