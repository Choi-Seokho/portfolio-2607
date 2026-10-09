/* AI 도구 데모 탭: 한 번에 하나의 데모만 보여주고, 주소(#demo-...)로 바로 열 수 있게 한다 */
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.demo-tabs [role="tab"]'));
  if (!tabs.length) return;

  function panelOf(tab) { return document.getElementById(tab.getAttribute('aria-controls')); }

  function select(tab, opts) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      panelOf(t).hidden = !on;
    });
    // 숨겨져 있던 데모(지도 등)가 크기를 다시 계산하도록
    window.dispatchEvent(new Event('resize'));
    if (opts && opts.updateHash && history.replaceState) {
      history.replaceState(null, '', '#' + panelOf(tab).id);
    }
    if (opts && opts.scroll) {
      document.getElementById('demos').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { select(tab, { updateHash: true }); });
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next, { updateHash: true });
    });
  });

  function fromHash(scroll) {
    var id = location.hash.slice(1);
    var tab = tabs.filter(function (t) { return t.getAttribute('aria-controls') === id; })[0];
    if (tab) select(tab, { scroll: scroll });
    return !!tab;
  }

  // 페이지 안의 "데모 보기" 링크
  document.querySelectorAll('a[href^="#demo-"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href').slice(1);
      var tab = tabs.filter(function (t) { return t.getAttribute('aria-controls') === id; })[0];
      if (!tab) return;
      e.preventDefault();
      select(tab, { updateHash: true, scroll: true });
    });
  });

  if (!fromHash(true)) select(tabs[0]);
  window.addEventListener('hashchange', function () { fromHash(true); });
})();
