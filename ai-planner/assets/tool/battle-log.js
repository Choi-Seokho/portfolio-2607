/* ===== BattleLogViewer 데모 (무기 픽률 · 승률) ===== */
(function () {
  const el = {
    mode: document.getElementById('wmMode'),
    cls: document.getElementById('wmClass'),
    slot: document.getElementById('wmSlot'),
    minSample: document.getElementById('wmMinSample'),
    resetBtn: document.getElementById('wmResetBtn'),
    statRow: document.getElementById('wmStatRow'),
    tabs: document.getElementById('wmTabs'),
    tabContent: document.getElementById('wmTabContent'),
    count: document.getElementById('wmCount'),
  };

  if (!el.tabContent) return; // 이 페이지에 데모가 없으면 종료

  const DEFAULTS = { mode: 'all', cls: '0', slot: '0', minSample: '30' };
  const state = { activeTab: 'table', sortKey: 'picks', sortAsc: false };
  const KIND_COLOR = { 근접: '#f97316', 원거리: '#60a5fa', 투척: '#a78bfa' };

  const entryMap = new Map();
  WM_LOGS.entries.forEach((e) => entryMap.set(`${e.matchId}_${e.playerId}`, e));

  function init() {
    WM_CLASSES.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = String(c.id); opt.textContent = c.name;
      el.cls.appendChild(opt);
    });
    [el.mode, el.cls, el.slot, el.minSample].forEach((s) => s.addEventListener('change', render));
    el.resetBtn.addEventListener('click', () => {
      el.mode.value = DEFAULTS.mode; el.cls.value = DEFAULTS.cls;
      el.slot.value = DEFAULTS.slot; el.minSample.value = DEFAULTS.minSample;
      render();
    });
    el.tabs.querySelectorAll('.tl-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.activeTab = tab.dataset.tab;
        el.tabs.querySelectorAll('.tl-tab').forEach((t) => t.classList.toggle('active', t === tab));
        render();
      });
    });
    render();
  }

  // 입장 로그로 픽수, 킬 로그로 킬, 피해자의 입장 로그를 역추적해 데스를 집계 (실제 도구와 같은 방식)
  function compute() {
    const mode = el.mode.value;
    const cls = Number(el.cls.value);
    const slot = Number(el.slot.value);
    const minSample = Number(el.minSample.value);

    const entries = WM_LOGS.entries.filter((e) =>
      (mode === 'all' || e.mode === mode) && (cls === 0 || e.classId === cls));

    const stats = {};
    WM_WEAPONS.forEach((w) => { stats[w.id] = { w, picks: 0, kills: 0, deaths: 0 }; });
    entries.forEach((e) => e.weapons.forEach((id) => { stats[id].picks++; }));

    let killTotal = 0;
    WM_LOGS.kills.forEach((k) => {
      if (mode !== 'all' && k.mode !== mode) return;
      const victim = entryMap.get(k.victimKey);
      const killerOk = cls === 0 || k.killerClassId === cls;
      const victimOk = cls === 0 || victim.classId === cls;
      if (killerOk) stats[k.killerWeaponId].kills++;
      if (victimOk) victim.weapons.forEach((id) => { stats[id].deaths++; }); // 데스는 입장 시 보유한 무기 전부에 집계
      if (killerOk || victimOk) killTotal++;
    });

    const rows = Object.values(stats)
      .filter((s) => slot === 0 || s.w.slot === slot)
      .map((s) => {
        const sample = s.kills + s.deaths;
        return {
          name: s.w.name, kind: s.w.kind, slot: s.w.slot,
          picks: s.picks,
          pickRate: entries.length ? (s.picks / entries.length) * 100 : 0,
          kills: s.kills, deaths: s.deaths, sample,
          wr: sample > 0 ? (s.kills / sample) * 100 : null,
          enough: sample >= minSample,
        };
      });
    // 데스가 보유 무기 전부에 집계되므로 평균 승률은 50%보다 낮게 나옵니다. 그래서 50%가 아니라 전체 평균을 기준선으로 비교합니다.
    const sumKills = rows.reduce((s, r) => s + r.kills, 0);
    const sumSample = rows.reduce((s, r) => s + r.sample, 0);
    const baseline = sumSample > 0 ? (sumKills / sumSample) * 100 : 0;
    return { rows, entryCount: entries.length, killTotal, minSample, baseline };
  }

  const GAP = 7; // 평균 대비 ±7%p 이상이면 강조

  function wrColor(wr, baseline) {
    if (wr === null) return '#6f6f7a';
    if (wr >= baseline + GAP) return '#4ade80';
    if (wr <= baseline - GAP) return '#f87171';
    return '#e5e7eb';
  }

  function renderStats(d) {
    const enough = d.rows.filter((r) => r.enough).length;
    const chips = [
      { label: '입장 로그', num: d.entryCount.toLocaleString('ko-KR') },
      { label: 'PvP 킬 로그', num: d.killTotal.toLocaleString('ko-KR') },
      { label: '분석 대상 무기', num: d.rows.length },
      { label: `표본 충분 (킬+데스 ${d.minSample}건 이상)`, num: enough },
      { label: '평균 승률 (기준선)', num: `${d.baseline.toFixed(1)}%` },
    ];
    el.statRow.innerHTML = chips.map((c) => `<div class="tl-stat-chip"><div class="num">${c.num}</div><div class="label">${c.label}</div></div>`).join('');
  }

  function sortRows(rows) {
    const key = state.sortKey;
    return rows.slice().sort((a, b) => {
      let av = a[key]; let bv = b[key];
      if (key === 'name' || key === 'kind') return state.sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      av = av === null ? -1 : av; bv = bv === null ? -1 : bv;
      return state.sortAsc ? av - bv : bv - av;
    });
  }

  function renderTable(d) {
    const cols = [
      ['name', '무기'], ['picks', '픽수'], ['pickRate', '픽률'], ['kills', '킬'], ['deaths', '데스'], ['wr', '승률'],
    ];
    const head = cols.map(([k, label]) => {
      const active = state.sortKey === k;
      return `<th class="wm-th${active ? ' sorted' : ''}" data-key="${k}">${label}${active ? (state.sortAsc ? ' ▲' : ' ▼') : ''}</th>`;
    }).join('');
    const maxPick = Math.max(1, ...d.rows.map((r) => r.pickRate));
    const body = sortRows(d.rows).map((r) => {
      const wrText = r.wr === null ? 'N/A' : `${r.wr.toFixed(1)}%`;
      const dim = r.enough ? '' : ' wm-dim';
      const note = r.enough ? '' : `<span class="wm-note-tag">표본 ${r.sample}건</span>`;
      return `<tr class="${dim.trim()}">
        <td><span class="wm-dot" style="background:${KIND_COLOR[r.kind]}"></span>${r.name}<span class="wm-slot">${r.slot === 1 ? '주' : '보조'} · ${r.kind}</span></td>
        <td>${r.picks.toLocaleString('ko-KR')}</td>
        <td><div class="wm-bar"><div class="wm-bar-fill" style="width:${(r.pickRate / maxPick) * 100}%"></div></div><span class="wm-bar-val">${r.pickRate.toFixed(1)}%</span></td>
        <td>${r.kills}</td>
        <td>${r.deaths}</td>
        <td style="color:${r.enough ? wrColor(r.wr, d.baseline) : '#6f6f7a'};font-weight:600">${wrText}${note}</td>
      </tr>`;
    }).join('');
    el.tabContent.innerHTML = `<div class="tl-table-wrap" style="border-top:none;max-height:none"><table class="tl-table wm-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="wm-hint">승률 색상은 전체 평균(${d.baseline.toFixed(1)}%) 대비 ±${GAP}%p 이상일 때 강조합니다. 표본이 부족한 무기는 회색으로 흐리게 표시합니다.</p>`;
    el.tabContent.querySelectorAll('.wm-th').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (state.sortKey === key) state.sortAsc = !state.sortAsc;
        else { state.sortKey = key; state.sortAsc = key === 'name'; }
        render();
      });
    });
  }

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function renderScatter(d) {
    const pts = d.rows.filter((r) => r.enough && r.wr !== null);
    if (pts.length < 2) {
      el.tabContent.innerHTML = '<div class="tl-analysis-empty">표본이 충분한 무기가 부족해 분포를 그릴 수 없습니다. 최소 표본을 낮추거나 필터를 풀어보세요.</div>';
      return;
    }
    const W = 640, H = 360, L = 48, R = 18, T = 16, B = 40;
    const xMax = Math.max(20, Math.ceil(Math.max(...pts.map((p) => p.pickRate)) / 5) * 5);
    const wrs = pts.map((p) => p.wr).concat([d.baseline]);
    const yMin = Math.max(0, Math.floor((Math.min(...wrs) - 5) / 10) * 10);
    const yMax = Math.min(100, Math.ceil((Math.max(...wrs) + 5) / 10) * 10);
    const x = (v) => L + (v / xMax) * (W - L - R);
    const y = (v) => T + (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) * (H - T - B);
    const med = median(pts.map((p) => p.pickRate));

    let svg = `<svg class="wm-scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="무기 픽률과 승률 분포">`;
    for (let v = yMin; v <= yMax; v += 10) {
      svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="wm-grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="wm-tick">${v}%</text>`;
    }
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(d.baseline)}" y2="${y(d.baseline)}" class="wm-axis-main"/>`;
    svg += `<text x="${W - R - 4}" y="${y(d.baseline) - 6}" text-anchor="end" class="wm-base-label">전체 평균 승률 ${d.baseline.toFixed(1)}%</text>`;
    for (let v = 0; v <= xMax; v += 5) {
      svg += `<text x="${x(v)}" y="${H - B + 18}" text-anchor="middle" class="wm-tick">${v}%</text>`;
    }
    svg += `<line x1="${x(med)}" x2="${x(med)}" y1="${T}" y2="${H - B}" class="wm-grid wm-dash"/>`;
    svg += `<text x="${x(med) + 6}" y="${T + 12}" class="wm-quad">중앙값 ${med.toFixed(1)}%</text>`;
    svg += `<text x="${W - R - 4}" y="${T + 12}" text-anchor="end" class="wm-quad">인기 + 강함</text>`;
    svg += `<text x="${L + 6}" y="${T + 12}" class="wm-quad">숨은 강자</text>`;
    svg += `<text x="${W - R - 4}" y="${H - B - 8}" text-anchor="end" class="wm-quad">인기만 높음</text>`;
    svg += `<text x="${L + 6}" y="${H - B - 8}" class="wm-quad">비선호</text>`;
    svg += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" class="wm-axis-label">픽률 (입장 로그 대비)</text>`;
    svg += `<text x="12" y="${(T + H - B) / 2}" text-anchor="middle" class="wm-axis-label" transform="rotate(-90 12 ${(T + H - B) / 2})">승률 (킬 ÷ 킬+데스)</text>`;
    // 라벨은 오른쪽, 왼쪽, 위, 아래 순으로 다른 점·라벨과 겹치지 않는 자리에 배치
    const circles = pts.map((p) => ({ p, cx: x(p.pickRate), cy: y(p.wr), r: Math.min(15, 5 + Math.sqrt(p.sample) / 4) }));
    const placed = [];
    const overlap = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    circles.forEach((c) => {
      svg += `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${KIND_COLOR[c.p.kind]}" fill-opacity="0.75" stroke="#0f0f14"><title>${c.p.name} · 픽률 ${c.p.pickRate.toFixed(1)}% · 승률 ${c.p.wr.toFixed(1)}% · 표본 ${c.p.sample}건</title></circle>`;
    });
    circles.slice().sort((a, b) => b.p.sample - a.p.sample).forEach((c) => {
      const w = c.p.name.length * 11 + 4;
      const cands = [
        { x: c.cx + c.r + 3, y: c.cy + 4, anchor: 'start', x1: c.cx + c.r + 3, x2: c.cx + c.r + 3 + w },
        { x: c.cx - c.r - 3, y: c.cy + 4, anchor: 'end', x1: c.cx - c.r - 3 - w, x2: c.cx - c.r - 3 },
        { x: c.cx, y: c.cy - c.r - 5, anchor: 'middle', x1: c.cx - w / 2, x2: c.cx + w / 2 },
        { x: c.cx, y: c.cy + c.r + 14, anchor: 'middle', x1: c.cx - w / 2, x2: c.cx + w / 2 },
      ].map((k) => Object.assign(k, { y1: k.y - 11, y2: k.y + 3 }));
      const free = cands.find((k) =>
        !placed.some((q) => overlap(k, q)) &&
        !circles.some((o) => overlap(k, { x1: o.cx - o.r, x2: o.cx + o.r, y1: o.cy - o.r, y2: o.cy + o.r })));
      const pick = free || cands[0];
      placed.push(pick);
      svg += `<text x="${pick.x}" y="${pick.y}" text-anchor="${pick.anchor}" class="wm-label">${c.p.name}</text>`;
    });
    svg += '</svg>';

    const hot = pts.filter((p) => p.pickRate >= med && p.wr >= d.baseline + GAP);
    const hidden = pts.filter((p) => p.pickRate < med && p.wr >= d.baseline + GAP);
    const over = pts.filter((p) => p.pickRate >= med && p.wr <= d.baseline - GAP);
    const card = (title, tone, list, desc) => `<div class="wm-insight ${tone}"><div class="wm-insight-title">${title}</div><div class="wm-insight-names">${list.length ? list.map((p) => `${p.name} <span>(픽 ${p.pickRate.toFixed(1)}% · 승 ${p.wr.toFixed(1)}%)</span>`).join('<br>') : '해당 없음'}</div><div class="wm-insight-desc">${desc}</div></div>`;

    el.tabContent.innerHTML = `${svg}
      <div class="wm-legend">${Object.entries(KIND_COLOR).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('')}<span class="wm-legend-note">원 크기 = 표본(킬+데스) 수</span></div>
      <div class="wm-insights">
        ${card('조정 후보', 'wm-tone-hot', hot, '많이 쓰이는데 평균보다 승률도 높음. 선택이 한쪽으로 쏠릴 가능성')}
        ${card('숨은 강자', 'wm-tone-hidden', hidden, '덜 쓰이지만 평균보다 승률이 높음. 노출·접근성 개선 후보')}
        ${card('인기만 높음', 'wm-tone-over', over, '자주 고르지만 평균보다 승률이 낮음. 체감과 실제 성능 차이 점검')}
      </div>`;
  }

  function render() {
    const d = compute();
    renderStats(d);
    if (state.activeTab === 'table') renderTable(d); else renderScatter(d);
    el.count.textContent = `무기 ${d.rows.length}종 표시`;
  }

  init();
})();
