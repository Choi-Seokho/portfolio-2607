/* ===== TradeLogViewer 데모 ===== */
(function () {
  const el = {
    itemSearch: document.getElementById('tlItemSearch'),
    userSearch: document.getElementById('tlUserSearch'),
    raritySelect: document.getElementById('tlRaritySelect'),
    resetBtn: document.getElementById('tlResetBtn'),
    typeFilters: document.getElementById('tlTypeFilters'),
    matchToggle: document.getElementById('tlMatchToggle'),
    statRow: document.getElementById('tlStatRow'),
    tabs: document.getElementById('tlTabs'),
    tabContent: document.getElementById('tlTabContent'),
    detailPanel: document.getElementById('tlDetailPanel'),
    tableBody: document.getElementById('tlTableBody'),
    count: document.getElementById('tlCount'),
  };

  if (!el.tableBody) return; // 이 페이지에 데모가 없으면 종료

  const state = {
    activeTypes: new Set(Object.keys(TL_LOG_TYPES)),
    rarity: '',
    itemSearch: '',
    userSearch: '',
    activeTab: 'overview',
    onlyMatched: true,
    selectedId: null,
  };

  const TAB_LABELS = { overview: '개요', items: '인기아이템', price: '가격분석', users: '유저활동', timeline: '시간대' };

  function formatPrice(n) { return n.toLocaleString('ko-KR') + ' 코인'; }
  function formatTime(t) {
    const d = new Date(t);
    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function rarityColor(r) { return (typeof DV_RARITY_COLOR !== 'undefined' && DV_RARITY_COLOR[r]) || '#9ca3af'; }

  function initTypeFilters() {
    el.typeFilters.innerHTML = Object.entries(TL_LOG_TYPES).map(([key, t]) =>
      `<div class="tl-type-chip active ${t.cls}" data-type="${key}">${t.name}</div>`
    ).join('');
    el.typeFilters.querySelectorAll('.tl-type-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.type;
        if (state.activeTypes.has(key)) { state.activeTypes.delete(key); chip.classList.remove('active'); }
        else { state.activeTypes.add(key); chip.classList.add('active'); }
        render();
      });
    });
  }

  function initRaritySelect() {
    DV_RARITY_ORDER.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r; opt.textContent = r;
      el.raritySelect.appendChild(opt);
    });
  }

  function getFilteredLogs() {
    return TL_LOGS.filter((l) => {
      if (!state.activeTypes.has(l.type)) return false;
      if (state.rarity && l.rarity !== state.rarity) return false;
      if (state.itemSearch && !l.itemName.includes(state.itemSearch)) return false;
      if (state.userSearch && !(l.buyerName || '').includes(state.userSearch)) return false;
      return true;
    });
  }

  function renderStats(logs) {
    const counts = { REGISTER: 0, PURCHASE: 0, SETTLE: 0, WITHDRAW: 0, EXPIRED: 0 };
    let volume = 0;
    logs.forEach((l) => { counts[l.type]++; if (l.type === 'PURCHASE') volume += l.price; });
    const chips = [
      { label: '전체 로그', num: logs.length },
      { label: '등록', num: counts.REGISTER },
      { label: '구매', num: counts.PURCHASE },
      { label: '정산', num: counts.SETTLE },
      { label: '총 거래액 (체결)', num: formatPrice(volume) },
    ];
    el.statRow.innerHTML = chips.map((c) => `<div class="tl-stat-chip"><div class="num">${c.num}</div><div class="label">${c.label}</div></div>`).join('');
  }

  function renderTable(logs) {
    if (logs.length === 0) {
      el.tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#6f6f7a;padding:20px;">조건에 맞는 로그가 없습니다.</td></tr>';
      el.count.textContent = '0건';
      return;
    }
    const rows = logs.slice(0, 200); // 표시 상한 (실제 서비스와 동일하게 스크롤 영역 내 성능 고려)
    el.tableBody.innerHTML = rows.map((l) => {
      const t = TL_LOG_TYPES[l.type];
      return `<tr data-id="${l.id}" class="${state.selectedId === l.id ? 'selected' : ''}">
        <td>${formatTime(l.time)}</td>
        <td><span class="tl-type-badge ${t.cls}">${t.name}</span></td>
        <td style="color:${rarityColor(l.rarity)}">${l.itemName}</td>
        <td style="color:${rarityColor(l.rarity)}">${l.rarity}</td>
        <td>${l.count}</td>
        <td>${formatPrice(l.price)}</td>
        <td style="font-size:0.75rem;color:#7d7d88;">${l.tradeId}</td>
        <td>${l.buyerName || '-'}</td>
      </tr>`;
    }).join('');
    el.count.textContent = `${logs.length.toLocaleString()}건${logs.length > 200 ? ' (상위 200건 표시)' : ''}`;

    el.tableBody.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = Number(tr.dataset.id);
        const log = TL_LOGS.find((l) => l.id === id);
        if (log) selectLog(log);
      });
    });
  }

  function selectLog(log) {
    state.selectedId = log.id;
    const t = TL_LOG_TYPES[log.type];
    el.detailPanel.innerHTML = `
      <div class="tl-detail-title"><span class="tl-type-badge ${t.cls}">${t.name}</span> <span style="color:${rarityColor(log.rarity)}">${log.itemName}</span></div>
      <div class="tl-detail-row"><span>등급</span><span style="color:${rarityColor(log.rarity)}">${log.rarity}</span></div>
      <div class="tl-detail-row"><span>수량</span><span>${log.count}</span></div>
      <div class="tl-detail-row"><span>가격</span><span>${formatPrice(log.price)}</span></div>
      <div class="tl-detail-row"><span>거래ID</span><span style="font-size:0.75rem;">${log.tradeId}</span></div>
      <div class="tl-detail-row"><span>ActionID</span><span style="font-size:0.75rem;">${log.actionId}</span></div>
      <div class="tl-detail-row"><span>구매자</span><span>${log.buyerName || '-'}</span></div>
      <div class="tl-detail-row"><span>캐릭터명</span><span>${log.buyerPcName || '-'}</span></div>
      <div class="tl-detail-row"><span>시간</span><span>${new Date(log.time).toLocaleString('ko-KR')}</span></div>
    `;
    renderTable(getFilteredLogs()); // 선택 하이라이트 반영
  }

  function barList(items, valueFormatter) {
    if (items.length === 0) return '<p class="tl-analysis-empty">데이터 없음</p>';
    return '<div class="tl-analysis-list">' + items.map((it, idx) => `
      <div class="tl-analysis-item" data-id="${it.log ? it.log.id : ''}">
        <span class="tl-analysis-rank ${idx < 3 ? 'top' : ''}">${idx + 1}</span>
        <span class="tl-analysis-name" style="${it.color ? `color:${it.color}` : ''}">${it.name}</span>
        <span class="tl-analysis-value">${valueFormatter(it)}</span>
      </div>`).join('') + '</div>';
  }

  function bindAnalysisClicks() {
    el.tabContent.querySelectorAll('.tl-analysis-item[data-id]').forEach((row) => {
      const id = Number(row.dataset.id);
      if (!id) return;
      row.addEventListener('click', () => {
        const log = TL_LOGS.find((l) => l.id === id);
        if (log) selectLog(log);
      });
    });
  }

  function renderOverview(logs) {
    const purchases = logs.filter((l) => l.type === 'PURCHASE');
    let ranked;
    if (state.onlyMatched) {
      ranked = purchases.slice().sort((a, b) => b.price - a.price).slice(0, 5)
        .map((l) => ({ name: `${l.itemName} (${l.rarity})`, color: rarityColor(l.rarity), log: l, price: l.price }));
    } else {
      const registers = logs.filter((l) => l.type === 'REGISTER');
      ranked = registers.slice().sort((a, b) => b.price - a.price).slice(0, 5)
        .map((l) => ({ name: `${l.itemName} (${l.rarity})`, color: rarityColor(l.rarity), log: l, price: l.price }));
    }
    const hint = state.onlyMatched
      ? '실제로 구매까지 체결된 거래 기준 TOP 5입니다.'
      : '⚠ 등록가 기준 TOP 5입니다 — 회수·만료된(안 팔린) 매물이 섞여 있을 수 있습니다.';
    el.tabContent.innerHTML = `
      <h4>최고가 거래 TOP 5</h4>
      <p style="font-size:0.78rem;color:${state.onlyMatched ? '#7d7d88' : '#f97316'};margin:0 0 10px;">${hint}</p>
      ${barList(ranked, (it) => formatPrice(it.price))}
    `;
    bindAnalysisClicks();
  }

  function renderItems(logs) {
    const purchases = logs.filter((l) => l.type === 'PURCHASE');
    const counter = {};
    purchases.forEach((l) => { counter[l.itemName] = (counter[l.itemName] || 0) + 1; });
    const ranked = Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => {
        const sample = purchases.find((l) => l.itemName === name);
        return { name, count, color: rarityColor(sample.rarity) };
      });
    el.tabContent.innerHTML = `<h4>인기 아이템 TOP 8 (구매 건수 기준)</h4>${barList(ranked, (it) => `${it.count.toLocaleString()}건`)}`;
  }

  function renderUsers(logs) {
    const purchases = logs.filter((l) => l.type === 'PURCHASE');
    const counter = {};
    purchases.forEach((l) => { counter[l.buyerName] = (counter[l.buyerName] || 0) + 1; });
    const ranked = Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name, count }));
    el.tabContent.innerHTML = `<h4>인기 구매자 TOP 8 (구매 건수 기준)</h4>${barList(ranked, (it) => `${it.count.toLocaleString()}건`)}`;
  }

  function renderPrice(logs) {
    const purchases = logs.filter((l) => l.type === 'PURCHASE');
    const rows = DV_RARITY_ORDER.map((r) => {
      const items = purchases.filter((l) => l.rarity === r);
      if (items.length === 0) return { rarity: r, count: 0, avg: 0, min: 0, max: 0 };
      const prices = items.map((l) => l.price);
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      return { rarity: r, count: items.length, avg, min: Math.min(...prices), max: Math.max(...prices) };
    });
    const priceRows = rows.map((r) => `
      <div class="tl-price-row">
        <span class="tl-price-rarity" style="color:${rarityColor(r.rarity)}">${r.rarity}</span>
        <span class="tl-price-avg">${r.count > 0 ? formatPrice(r.avg) : '-'}</span>
        <span class="tl-price-range">${r.count > 0 ? `${formatPrice(r.min)} ~ ${formatPrice(r.max)}` : '-'}</span>
        <span class="tl-price-count">${r.count.toLocaleString()}건</span>
      </div>`).join('');

    const ranges = [
      { label: '~ 500', min: 0, max: 500 },
      { label: '500 ~ 2,000', min: 500, max: 2000 },
      { label: '2,000 ~ 5,000', min: 2000, max: 5000 },
      { label: '5,000 ~ 10,000', min: 5000, max: 10000 },
      { label: '10,000+', min: 10000, max: Infinity },
    ];
    const total = purchases.length || 1;
    const rangeRows = ranges.map((rg) => {
      const count = purchases.filter((l) => l.price >= rg.min && l.price < rg.max).length;
      const pct = Math.round((count / total) * 100);
      return `<div class="tl-range-row">
        <span class="tl-range-label">${rg.label}</span>
        <div class="tl-range-track"><div class="tl-range-fill" style="width:${pct}%"></div></div>
        <span class="tl-range-value">${count.toLocaleString()} (${pct}%)</span>
      </div>`;
    }).join('');

    el.tabContent.innerHTML = `
      <h4>등급별 평균가 (구매 체결 기준)</h4>
      <div style="margin-bottom:18px;">${priceRows}</div>
      <h4>가격대 분포 (코인)</h4>
      ${rangeRows}
    `;
  }

  function renderTimeline(logs) {
    const purchases = logs.filter((l) => l.type === 'PURCHASE');
    const hours = new Array(24).fill(0);
    purchases.forEach((l) => { hours[new Date(l.time).getHours()]++; });
    const max = Math.max(...hours, 1);
    const bars = hours.map((count, h) => {
      const pct = Math.round((count / max) * 100);
      return `<div class="tl-timeline-bar-wrap" title="${h}시: ${count.toLocaleString()}건">
        <div class="tl-timeline-bar" style="height:${Math.max(pct, 2)}%"></div>
        <span class="tl-timeline-hour">${h}</span>
      </div>`;
    }).join('');
    el.tabContent.innerHTML = `<h4>시간대별 구매 건수 (0~23시)</h4><div class="tl-timeline">${bars}</div>`;
  }

  function renderTab(logs) {
    if (state.activeTab === 'overview') renderOverview(logs);
    else if (state.activeTab === 'items') renderItems(logs);
    else if (state.activeTab === 'price') renderPrice(logs);
    else if (state.activeTab === 'users') renderUsers(logs);
    else if (state.activeTab === 'timeline') renderTimeline(logs);
  }

  function render() {
    const logs = getFilteredLogs();
    renderStats(logs);
    renderTab(logs);
    renderTable(logs);
  }

  function bindEvents() {
    el.itemSearch.addEventListener('input', () => { state.itemSearch = el.itemSearch.value.trim(); render(); });
    el.userSearch.addEventListener('input', () => { state.userSearch = el.userSearch.value.trim(); render(); });
    el.raritySelect.addEventListener('change', () => { state.rarity = el.raritySelect.value; render(); });
    el.matchToggle.addEventListener('change', () => { state.onlyMatched = el.matchToggle.checked; render(); });
    el.resetBtn.addEventListener('click', () => {
      state.rarity = ''; state.itemSearch = ''; state.userSearch = '';
      el.raritySelect.value = ''; el.itemSearch.value = ''; el.userSearch.value = '';
      state.activeTypes = new Set(Object.keys(TL_LOG_TYPES));
      el.typeFilters.querySelectorAll('.tl-type-chip').forEach((c) => c.classList.add('active'));
      render();
    });
    el.tabs.querySelectorAll('.tl-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.activeTab = tab.dataset.tab;
        el.tabs.querySelectorAll('.tl-tab').forEach((t) => t.classList.toggle('active', t === tab));
        render();
      });
    });
  }

  initTypeFilters();
  initRaritySelect();
  bindEvents();
  render();
})();
