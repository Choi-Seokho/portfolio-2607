/* ===== MapGenie 데모 ===== */
(function () {
  const ICONS = {
    Item: `<svg viewBox="0 0 32 32"><polygon points="16,2 28,12 16,30 4,12" fill="#22c55e" stroke="#166534" stroke-width="2"/><polygon points="16,2 10,12 16,30" fill="#16a34a"/><line x1="4" y1="12" x2="28" y2="12" stroke="#166534" stroke-width="1.5"/></svg>`,
    ItemBox: `<svg viewBox="0 0 32 32"><rect x="4" y="10" width="24" height="18" fill="#3b82f6" stroke="#1d4ed8" stroke-width="2" rx="2"/><rect x="4" y="10" width="24" height="6" fill="#60a5fa" stroke="#1d4ed8" stroke-width="2" rx="1"/><rect x="13" y="16" width="6" height="4" fill="#fbbf24" stroke="#b45309" stroke-width="1"/></svg>`,
    Monster: `<svg viewBox="0 0 32 32"><circle cx="16" cy="14" r="10" fill="#ef4444" stroke="#b91c1c" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#000"/><circle cx="20" cy="12" r="3" fill="#000"/><path d="M10,20 L12,17 L14,20 L16,17 L18,20 L20,17 L22,20" fill="none" stroke="#000" stroke-width="2"/></svg>`,
    HiddenZombie: `<svg viewBox="0 0 32 32"><ellipse cx="16" cy="16" rx="14" ry="10" fill="#991b1b" stroke="#7f1d1d" stroke-width="2"/><ellipse cx="16" cy="16" rx="6" ry="6" fill="#fef2f2"/><circle cx="16" cy="16" r="4" fill="#7f1d1d"/><circle cx="17" cy="15" r="1.5" fill="#fff"/></svg>`,
    PlayerSpawnPoint: `<svg viewBox="0 0 32 32"><polygon points="16,2 20,12 30,12 22,18 25,28 16,22 7,28 10,18 2,12 12,12" fill="#8b5cf6" stroke="#6d28d9" stroke-width="2"/></svg>`,
    EscapePoint: `<svg viewBox="0 0 32 32"><rect x="8" y="4" width="16" height="24" fill="#06b6d4" stroke="#0891b2" stroke-width="2" rx="2"/><circle cx="20" cy="16" r="2" fill="#fbbf24"/><path d="M4,16 L10,12 L10,20 Z" fill="#06b6d4" stroke="#0891b2" stroke-width="1"/></svg>`,
    Grinder: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="8" fill="#ec4899" stroke="#be185d" stroke-width="2"/><path d="M16,4 L18,10 L16,8 L14,10 Z M28,16 L22,18 L24,16 L22,14 Z M16,28 L14,22 L16,24 L18,22 Z M4,16 L10,14 L8,16 L10,18 Z" fill="#ec4899" stroke="#be185d" stroke-width="1"/><circle cx="16" cy="16" r="4" fill="#fdf2f8" stroke="#be185d" stroke-width="1"/></svg>`,
    LockedDoor: `<svg viewBox="0 0 32 32"><rect x="5" y="11" width="22" height="19" fill="#d6d3d1" stroke="#e7e5e4" stroke-width="2" rx="3"/><path d="M9,11 L9,7 A7,7 0 0,1 23,7 L23,11" fill="none" stroke="#e7e5e4" stroke-width="3"/><circle cx="16" cy="20" r="4" fill="#fcd34d"/><rect x="14.5" y="20" width="3" height="6" fill="#fcd34d" rx="1"/></svg>`,
    AreaInfo: `<svg viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" fill="none" stroke="#facc15" stroke-width="2" stroke-dasharray="4,2" rx="2"/><text x="16" y="21" font-size="14" fill="#facc15" text-anchor="middle" font-weight="bold">A</text></svg>`,
  };

  const el = {
    floorTabs: document.getElementById('mgFloorTabs'),
    viewport: document.getElementById('mgViewport'),
    stage: document.getElementById('mgStage'),
    mapImage: document.getElementById('mgMapImage'),
    searchInput: document.getElementById('mgSearchInput'),
    searchBtn: document.getElementById('mgSearchBtn'),
    resetBtn: document.getElementById('mgResetBtn'),
    zoomIn: document.getElementById('mgZoomIn'),
    zoomOut: document.getElementById('mgZoomOut'),
    zoomReset: document.getElementById('mgZoomReset'),
    filterAll: document.getElementById('mgFilterAll'),
    filterAllCount: document.getElementById('mgFilterAllCount'),
    filterList: document.getElementById('mgFilterList'),
    itemSearchInput: document.getElementById('mgItemSearchInput'),
    itemSearchBtn: document.getElementById('mgItemSearchBtn'),
    itemSearchHint: document.getElementById('mgItemSearchHint'),
    detailPanel: document.getElementById('mgDetailPanel'),
    history: document.getElementById('mgHistory'),
    side: document.getElementById('mgSide'),
  };

  if (!el.viewport) return; // 이 페이지에 데모가 없으면 종료

  const typeMeta = {};
  MG_TYPES.forEach((t) => (typeMeta[t.type] = t));

  const state = {
    floorId: MG_FLOORS[0].id,
    scale: 1,
    tx: 0,
    ty: 0,
    dragging: false,
    hasDragged: false,
    lastX: 0,
    lastY: 0,
    typeFilter: {},
    search: '',
    itemSearch: '',
    selected: null,
    markerEls: [],
  };

  MG_TYPES.forEach((t) => (state.typeFilter[t.type] = true));

  function currentFloor() {
    return MG_FLOORS.find((f) => f.id === state.floorId);
  }

  function applyTransform() {
    el.stage.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  }

  function renderFloorTabs() {
    el.floorTabs.innerHTML = MG_FLOORS.map(
      (f) => `<div class="mg-floor-tab ${f.id === state.floorId ? 'active' : ''}" data-floor="${f.id}">${f.label}</div>`
    ).join('');
    el.floorTabs.querySelectorAll('.mg-floor-tab').forEach((tab) => {
      tab.addEventListener('click', () => selectFloor(tab.dataset.floor));
    });
  }

  function selectFloor(floorId) {
    state.floorId = floorId;
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    state.selected = null;
    el.searchInput.value = '';
    state.search = '';
    el.itemSearchInput.value = '';
    state.itemSearch = '';
    renderItemSearchHint();
    applyTransform();
    renderFloorTabs();
    loadMap();
  }

  function loadMap() {
    const floor = currentFloor();
    el.mapImage.src = floor.image;
    renderMarkers();
    renderFilterList();
    renderDetail(null);
  }

  function renderMarkers() {
    el.stage.querySelectorAll('.mg-marker').forEach((m) => m.remove());
    const floor = currentFloor();
    state.markerEls = floor.markers.map((m, idx) => {
      const id = `${floor.id}-${idx}`;
      const meta = typeMeta[m.type];
      const div = document.createElement('div');
      div.className = 'mg-marker';
      div.style.left = m.x + '%';
      div.style.top = m.y + '%';
      div.dataset.id = id;
      div.dataset.type = m.type;
      div.title = m.name;
      div.innerHTML = ICONS[m.type] || ICONS.Item;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.hasDragged) return;
        state.selected = id;
        highlightSelected();
        renderDetail({ ...m, id, color: meta.color, label: meta.label });
      });
      el.stage.appendChild(div);
      return { id, type: m.type, name: m.name, loot: m.loot, node: div };
    });
    applyFilters();
  }

  function highlightSelected() {
    state.markerEls.forEach((m) => m.node.classList.toggle('selected', m.id === state.selected));
  }

  function renderFilterList() {
    const floor = currentFloor();
    const counts = {};
    MG_TYPES.forEach((t) => (counts[t.type] = 0));
    floor.markers.forEach((m) => (counts[m.type] = (counts[m.type] || 0) + 1));
    const total = floor.markers.length;
    el.filterAllCount.textContent = `(${total})`;

    el.filterList.innerHTML = MG_TYPES.map((t) => {
      const checked = state.typeFilter[t.type] ? 'checked' : '';
      return `
        <label class="mg-type-filter-item" data-type="${t.type}">
          <input type="checkbox" ${checked}>
          <span class="swatch-icon">${ICONS[t.type] || ICONS.Item}</span>
          <span>${t.label}</span>
          <span class="cnt">${counts[t.type] || 0}</span>
        </label>`;
    }).join('');

    el.filterList.querySelectorAll('.mg-type-filter-item').forEach((row) => {
      const type = row.dataset.type;
      const checkbox = row.querySelector('input');
      checkbox.addEventListener('change', () => {
        state.typeFilter[type] = checkbox.checked;
        syncAllCheckbox();
        applyFilters();
      });
    });
    syncAllCheckbox();
  }

  function syncAllCheckbox() {
    const allOn = MG_TYPES.every((t) => state.typeFilter[t.type]);
    const allOff = MG_TYPES.every((t) => !state.typeFilter[t.type]);
    el.filterAll.checked = allOn;
    el.filterAll.indeterminate = !allOn && !allOff;
  }

  function applyFilters() {
    const term = state.search.trim().toLowerCase();
    const itemTerm = state.itemSearch.trim().toLowerCase();
    const matchingTables = itemTerm ? mgFindLootTablesByItemName(itemTerm) : null;
    state.markerEls.forEach((m) => {
      const typeOn = state.typeFilter[m.type];
      const dropsSearchedItem = !matchingTables || (m.loot && matchingTables.has(m.loot));
      const visible = typeOn && dropsSearchedItem;
      const matches = term.length > 0 && m.name.toLowerCase().includes(term);
      m.node.classList.toggle('hidden-type', !visible);
      m.node.classList.toggle('dim', visible && term.length > 0 && !matches);
      m.node.classList.toggle('match', visible && matches);
    });
    updateFloorBadges();
  }

  function updateFloorBadges() {
    const term = state.search.trim().toLowerCase();
    const itemTerm = state.itemSearch.trim().toLowerCase();
    const matchingTables = itemTerm ? mgFindLootTablesByItemName(itemTerm) : null;
    el.floorTabs.querySelectorAll('.mg-floor-tab').forEach((tab) => {
      const existing = tab.querySelector('.mg-floor-match');
      if (existing) existing.remove();
      if (!term && !itemTerm) return;
      const floor = MG_FLOORS.find((f) => f.id === tab.dataset.floor);
      const count = floor.markers.filter((m) => {
        if (term && !m.name.toLowerCase().includes(term)) return false;
        if (matchingTables && !(m.loot && matchingTables.has(m.loot))) return false;
        return true;
      }).length;
      if (count > 0 && floor.id !== state.floorId) {
        const badge = document.createElement('span');
        badge.className = 'mg-floor-match';
        badge.textContent = ` ${count}`;
        badge.style.color = '#facc15';
        tab.appendChild(badge);
      }
    });
  }

  function renderItemSearchHint() {
    const term = state.itemSearch.trim().toLowerCase();
    if (!term) {
      el.itemSearchHint.textContent = '검색한 아이템을 드롭하는 오브젝트만 지도에 표시됩니다.';
      return;
    }
    const matchingTables = mgFindLootTablesByItemName(term);
    if (matchingTables.size === 0) {
      el.itemSearchHint.textContent = `"${term}"을(를) 드롭하는 오브젝트가 없습니다.`;
      return;
    }
    const totalCount = MG_FLOORS.reduce(
      (sum, f) => sum + f.markers.filter((m) => m.loot && matchingTables.has(m.loot)).length,
      0
    );
    el.itemSearchHint.textContent = `전체 층 기준 ${totalCount}개 오브젝트에서 드롭됩니다.`;
  }

  function renderDetail(m) {
    if (!m) {
      el.detailPanel.innerHTML = `<p class="empty">스포너를 클릭하면 상세 정보가 표시됩니다.</p>`;
      return;
    }
    el.detailPanel.innerHTML = `
      <span class="mg-detail-badge" style="background:${m.color}">${m.label}</span>
      <div class="mg-detail-name">${m.name}</div>
      <div class="mg-detail-row"><span>맵 상대 좌표 X</span><span>${m.x}%</span></div>
      <div class="mg-detail-row"><span>맵 상대 좌표 Y</span><span>${m.y}%</span></div>
      <div class="mg-detail-row"><span>층</span><span>${currentFloor().label}</span></div>
      ${renderDropSection(m)}
    `;
  }

  // 상자/아이템 스포너의 드롭 확률 + 드롭 아이템 목록 렌더링
  function renderDropSection(m) {
    const table = m.loot && MG_LOOT_TABLES[m.loot];
    if (!table) return '';

    const rateOrder = ['empty', 'junk', 'common', 'uncommon', 'rare', 'epic', 'legendary'];
    const rateBadges = rateOrder
      .map((key) => {
        const v = table.gradeRates[key];
        if (!v) return '';
        const label = key === 'empty' ? 'Empty' : MG_RARITY_LABEL[key];
        const color = key === 'empty' ? '#6b7280' : MG_RARITY_COLOR[key];
        return `<span class="mg-rate-badge" style="border-color:${color};color:${color}">${label} ${(v / 10).toFixed(1)}%</span>`;
      })
      .join('');

    const itemRows = table.items
      .map((it) => {
        const item = MG_ITEM_CATALOG.find((c) => c.id === it.itemId);
        if (!item) return '';
        const qty = it.min === it.max ? (it.min > 1 ? `x${it.min}` : '') : `${it.min}-${it.max}`;
        return `
          <div class="mg-drop-item">
            <span class="mg-drop-rarity-dot" style="background:${MG_RARITY_COLOR[item.rarity]}"></span>
            <span class="mg-drop-name">${item.name}</span>
            <span class="mg-drop-rarity-label" style="color:${MG_RARITY_COLOR[item.rarity]}">${MG_RARITY_LABEL[item.rarity]}</span>
            ${qty ? `<span class="mg-drop-qty">${qty}</span>` : ''}
          </div>`;
      })
      .join('');

    return `
      <div class="mg-drop-section">
        <h5>드롭 아이템</h5>
        <div class="mg-drop-rates">${rateBadges}</div>
        <div class="mg-drop-items">${itemRows}</div>
      </div>
    `;
  }

  function renderHistory() {
    el.history.innerHTML =
      `<div class="hist-title">개발 히스토리 (세션 로그 기준)</div>` +
      MG_HISTORY.map((h) => `<span class="hist-chip"><strong>${h.date}</strong>${h.text}</span>`).join('');
  }

  // 우측 패널(mg-side) 높이를 지도(mg-viewport)와 맞춰서, 드롭 아이템 목록이 길어져도
  // 지도 정사각형 비율이 깨지지 않고 우측 패널만 내부 스크롤되도록 한다.
  // 좁은 화면(모바일 스택 레이아웃)에서는 세로로 쌓이므로 높이 고정을 풀어준다.
  function syncSideHeight() {
    const isStacked = window.matchMedia('(max-width: 760px)').matches;
    if (isStacked) {
      el.side.style.height = '';
      return;
    }
    el.side.style.height = el.viewport.getBoundingClientRect().height + 'px';
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = el.viewport.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const newScale = Math.min(4, Math.max(0.5, state.scale * factor));
    state.tx = mx - ((mx - state.tx) * newScale) / state.scale;
    state.ty = my - ((my - state.ty) * newScale) / state.scale;
    state.scale = newScale;
    applyTransform();
  }

  // ===== 이벤트 바인딩 =====
  el.viewport.addEventListener('mousedown', (e) => {
    state.dragging = true;
    state.hasDragged = false;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    el.viewport.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!state.dragging) return;
    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.hasDragged = true;
    state.tx += dx;
    state.ty += dy;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    state.dragging = false;
    el.viewport.classList.remove('dragging');
  });

  el.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 0.87);
  }, { passive: false });

  el.zoomIn.addEventListener('click', () => {
    const rect = el.viewport.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
  });
  el.zoomOut.addEventListener('click', () => {
    const rect = el.viewport.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.83);
  });
  el.zoomReset.addEventListener('click', () => {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    applyTransform();
  });

  el.filterAll.addEventListener('change', () => {
    const newState = el.filterAll.checked;
    MG_TYPES.forEach((t) => (state.typeFilter[t.type] = newState));
    renderFilterList();
    applyFilters();
  });

  function runSearch() {
    state.search = el.searchInput.value;
    applyFilters();
  }
  el.searchBtn.addEventListener('click', runSearch);
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  });
  function runItemSearch() {
    state.itemSearch = el.itemSearchInput.value;
    applyFilters();
    renderItemSearchHint();
  }
  el.itemSearchBtn.addEventListener('click', runItemSearch);
  el.itemSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runItemSearch();
    }
  });

  el.resetBtn.addEventListener('click', () => {
    el.searchInput.value = '';
    state.search = '';
    el.itemSearchInput.value = '';
    state.itemSearch = '';
    renderItemSearchHint();
    applyFilters();
  });

  window.addEventListener('resize', syncSideHeight);

  renderFloorTabs();
  renderHistory();
  loadMap();
  syncSideHeight();
})();

/* ===== DataViewer 데모 (전역 키 검색 + Item→BaseItem→String 체인) ===== */
(function () {
  const el = {
    tabs: document.getElementById('dvTabs'),
    headerRow: document.getElementById('dvHeaderRow'),
    tbody: document.getElementById('dvTableBody'),
    rarity: document.getElementById('dvRaritySelect'),
    count: document.getElementById('dvCount'),
    errorCount: document.getElementById('dvErrorCount'),
    globalInput: document.getElementById('dvGlobalSearchInput'),
    globalBtn: document.getElementById('dvGlobalSearchBtn'),
    globalReset: document.getElementById('dvGlobalResetBtn'),
  };

  if (!el.tbody) return;

  const TABLE_KEYS = Object.keys(DV_TABLES); // ['Item', 'BaseItem', 'String']

  const state = {
    activeTable: 'Item',
    sortKey: 'Index',
    sortAsc: true,
    rarity: '',
    globalTerm: '',
  };

  // 테이블별 원본 행 + 계산 필드(해석된 이름 / 참조 수) 결합
  function rowsWithComputed(tableKey) {
    const table = DV_TABLES[tableKey];
    if (tableKey === 'Item') {
      return table.rows.map((r) => {
        const resolved = dvResolveItemName(r);
        return { ...r, ResolvedName: resolved.text, _resolvedStatus: resolved.status };
      });
    }
    if (tableKey === 'BaseItem') {
      return table.rows.map((r) => ({ ...r, RefCount: dvCountItemRefs(r.BaseID) }));
    }
    return table.rows.map((r) => ({ ...r }));
  }

  // 전역 키 검색: 행의 원본 컬럼 값 중 하나라도 검색어를 포함하면 매치
  function matchesTerm(rawRow, term) {
    return Object.values(rawRow).some((v) => String(v).toLowerCase().includes(term));
  }

  function countMatches(tableKey, term) {
    if (!term) return 0;
    return DV_TABLES[tableKey].rows.filter((r) => matchesTerm(r, term)).length;
  }

  // 탭 버튼 자체가 "테이블 전환 + 전역 검색 결과 표시"를 겸함 (별도 요약 줄 없음)
  function renderTabs() {
    const term = state.globalTerm;
    el.tabs.innerHTML = TABLE_KEYS.map((k) => {
      const active = k === state.activeTable ? 'active' : '';
      let badge = '';
      let zeroClass = '';
      if (term) {
        const count = countMatches(k, term);
        const zero = count === 0;
        zeroClass = zero ? 'zero-match' : '';
        badge = `<span class="dv-tab-count ${zero ? 'zero' : 'hit'}">${count}</span>`;
      }
      return `<div class="dv-tab ${active} ${zeroClass}" data-table="${k}">${DV_TABLES[k].label}${badge}</div>`;
    }).join('');
    el.tabs.querySelectorAll('.dv-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.activeTable = tab.dataset.table;
        state.sortKey = DV_TABLES[state.activeTable].columns[0].key;
        state.sortAsc = true;
        renderTabs();
        renderTable();
      });
    });
  }

  function renderTable() {
    const table = DV_TABLES[state.activeTable];
    const isItemTab = state.activeTable === 'Item';
    el.rarity.style.display = isItemTab ? '' : 'none';

    el.headerRow.innerHTML = table.columns
      .map((c) => `<th class="dv-th" data-key="${c.key}">${c.label}</th>`)
      .join('');

    let rows = rowsWithComputed(state.activeTable);

    if (isItemTab && state.rarity) {
      rows = rows.filter((r) => r.Rarity === state.rarity);
    }

    const term = state.globalTerm;
    if (term) {
      rows = rows.filter((r) => matchesTerm(r, term));
    }

    rows = rows.slice().sort((a, b) => {
      let av = a[state.sortKey];
      let bv = b[state.sortKey];
      if (state.sortKey === 'Rarity') {
        av = DV_RARITY_ORDER.indexOf(av);
        bv = DV_RARITY_ORDER.indexOf(bv);
      }
      if (typeof av === 'string' || typeof bv === 'string') {
        return state.sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return state.sortAsc ? av - bv : bv - av;
    });

    if (rows.length === 0) {
      const emptyText = term
        ? `'${term}' 검색 결과가 이 테이블에는 없습니다 — 다른 탭을 확인해보세요.`
        : '조건에 맞는 데이터가 없습니다.';
      el.tbody.innerHTML = `<tr class="dv-empty-row"><td colspan="${table.columns.length}">${emptyText}</td></tr>`;
    } else {
      el.tbody.innerHTML = rows
        .map((r) => {
          const cells = table.columns
            .map((c) => `<td>${renderCell(state.activeTable, c.key, r)}</td>`)
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
    }

    el.count.textContent = `${rows.length} / ${table.rows.length}개 표시 (${table.label})`;

    let errorCount = 0;
    if (state.activeTable === 'Item') {
      errorCount = rows.filter((r) => r._resolvedStatus === 'broken').length;
    } else if (state.activeTable === 'BaseItem') {
      errorCount = rows.filter((r) => r.RefCount === 0).length;
    }
    el.errorCount.textContent = errorCount > 0 ? ` · Error ${errorCount}건` : '';
    document.querySelectorAll('.dv-th').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.key === state.sortKey);
      th.classList.toggle('asc', th.dataset.key === state.sortKey && state.sortAsc);
      th.addEventListener('click', () => {
        if (state.sortKey === th.dataset.key) {
          state.sortAsc = !state.sortAsc;
        } else {
          state.sortKey = th.dataset.key;
          state.sortAsc = true;
        }
        renderTable();
      });
    });
  }

  function renderCell(tableKey, key, r) {
    if (key === 'Rarity') {
      return `<span class="dv-rarity-badge" style="background:${DV_RARITY_COLOR[r.Rarity]}">${r.Rarity}</span>`;
    }
    if (key === 'Value' && typeof r.Value === 'number') return r.Value.toLocaleString();
    if (key === 'ResolvedName') {
      return r._resolvedStatus === 'broken' ? `<span class="dv-chain-broken">${r.ResolvedName}</span>` : `<span class="dv-chain-ok">${r.ResolvedName}</span>`;
    }
    if (key === 'RefCount') {
      return r.RefCount === 0 ? `<span class="dv-chain-broken">0건 (미사용)</span>` : `${r.RefCount}건`;
    }
    if (key === 'Desc' && typeof r.Desc === 'string') {
      const safe = r.Desc.replace(/"/g, '&quot;');
      return `<span class="dv-desc-cell" title="${safe}">${r.Desc}</span>`;
    }
    return r[key];
  }

  el.rarity.addEventListener('change', () => {
    state.rarity = el.rarity.value;
    renderTable();
  });

  function runGlobalSearch() {
    state.globalTerm = el.globalInput.value.trim().toLowerCase();
    renderTabs();
    renderTable();
  }
  el.globalBtn.addEventListener('click', runGlobalSearch);
  el.globalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runGlobalSearch();
    }
  });
  el.globalReset.addEventListener('click', () => {
    el.globalInput.value = '';
    state.globalTerm = '';
    renderTabs();
    renderTable();
  });

  renderTabs();
  renderTable();
})();
