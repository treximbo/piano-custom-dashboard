/* global fetch */
(function () {
  const FALLBACK_BRANDS = {
    "Accounting Today": "BOmg9kapee",
    "American Banker": "XUnXNMUrFF",
    "Digital Insurance": "N8sydUSDcX",
    "Employee Benefit News": "t7vpsMsOZy",
    "Financial Planning": "RXUl28joTX",
    "National Mortgage News": "DqBrRoNVmq",
    "Bond Buyer": "x2vmB6Jdyn",
  };
  const form = document.getElementById('fetch-form');
  const statusEl = document.getElementById('status');
  const summary = document.getElementById('summary');
  const exposuresEl = document.getElementById('exposures');
  const conversionsEl = document.getElementById('conversions');
  const periods = document.getElementById('periods');
  const daysTable = document.getElementById('days-table');
  const rowsSection = document.getElementById('rows');
  const rowsTable = document.getElementById('rows-table');
  const actionCardsSection = document.getElementById('action-cards');
  const actionCardsTable = document.getElementById('action-cards-table');
  const actionCardTermsWrap = document.getElementById('action-card-terms-wrap');
  const actionCardTermsTable = document.getElementById('action-card-terms-table');
  const actionCardTermsTitle = document.getElementById('action-card-terms-title');
  const templateClickAllSection = document.getElementById('template-click-all');
  const templateClickAllTable = document.getElementById('template-click-all-table');
  const exposureTrends = document.getElementById('exposure-trends');
  const CHART_ENABLED = false; // temporarily disable chart while optimizing
  let exposureChart = null;
  let selectedForChart = new Set(); // actionCard.id values
  let hiddenTerms = new Set(); // `${acId}|||${termName}` to hide in chart (default hidden)
  const subMetrics = document.getElementById('subscription-metrics');
  const subTotalWrap = document.getElementById('subTotalWrap');
  const subTotalEmpty = document.getElementById('subTotalEmpty');
  const subTotalTable = document.getElementById('sub-total-table');
  const subNonHashCountEl = document.getElementById('subNonHashCount');
  const subTermWrap = document.getElementById('subTermWrap');
  const subTermTable = document.getElementById('sub-term-table');
  const selectedAcTitle = document.getElementById('selected-ac-title');
  const downloadBtn = document.getElementById('download-csv');
  const parseLocalBtn = document.getElementById('parse-local');
  const brandSelect = document.getElementById('brand');
  const brandAuto = document.getElementById('brandAuto');
  const fromAuto = document.getElementById('fromAuto');
  const toAuto = document.getElementById('toAuto');
  const expIdInput = document.getElementById('expId');
  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');
  const bearerInput = document.getElementById('bearer');

  let lastData = null; // store last JSON result for CSV
  let selectedActionCardId = null;
  let selectedTemplateName = null; // null means show all templates' clicks for selected action
  let currentActionCards = [];
  let currentTermRows = [];

  function setStatus(msg) {
    statusEl.textContent = msg || '';
  }

  function markComposerTokenInvalid(extraMsg) {
    const cs = document.getElementById('composer-status');
    if (cs) cs.textContent = 'Token invalid or expired. Click "Connect via Browser Extension" to refresh, then try again.' + (extraMsg ? ` (${extraMsg})` : '');
  }

  function setComposerStatus(msg) {
    const cs = document.getElementById('composer-status');
    if (cs) cs.textContent = msg || '';
  }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function switchPage(page) {
    const pages = ['page-manual','page-auto','page-info'];
    pages.forEach(id => hide(document.getElementById(id)));
    const target = document.getElementById(`page-${page}`);
    if (target) show(target);
    // When not on manual, hide any previously shown data panels so they don't overlap
    if (page !== 'manual') {
      ['summary','periods','rows','action-cards','template-click-all','exposure-trends'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
    }
    // Hide experiences panel unless on auto
    if (page !== 'auto') {
      const exp = document.getElementById('experiences');
      if (exp) exp.classList.add('hidden');
    }
    // Ensure auto brand dropdown has options on auto
    if (page === 'auto') {
      if (brandAuto && (!brandAuto.options || brandAuto.options.length === 0)) {
        brandAuto.innerHTML = brandSelect ? brandSelect.innerHTML : '<option value="">— Select —</option>';
      }
    }
  }

  // Simple nav routing (only nav links that actually switch pages)
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
      link.classList.add('active');
      const page = link.getAttribute('data-page');
      if (page) switchPage(page);
    });
  });

  function renderTable(table, items) {
    // If this is the action cards table, inject a checkbox column for chart selection (only if chart enabled)
    const isActionCardsTable = CHART_ENABLED && table === actionCardsTable;
    table.innerHTML = '';
    if (!items || !items.length) {
      table.innerHTML = '<tr><td>No data</td></tr>';
      return;
    }
    const headers = Object.keys(items[0]);
    if (isActionCardsTable && !headers.includes('Select')) headers.unshift('Select');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);

    const tbody = document.createElement('tbody');
    items.forEach(row => {
      const tr = document.createElement('tr');
      headers.forEach(h => {
        const td = document.createElement('td');
        if (isActionCardsTable && h === 'Select') {
          const acId = row['actionCard.id'];
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = selectedForChart.has(acId);
          cb.addEventListener('change', () => {
            if (cb.checked) selectedForChart.add(acId); else selectedForChart.delete(acId);
            updateExposureChart();
          });
          td.appendChild(cb);
        } else {
          const v = row[h];
          td.textContent = v === null || v === undefined ? '' : String(v);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
  }

  function getCadence() {
    const el = document.querySelector('input[name="cadence"]:checked');
    return (el && el.value) || 'days';
  }
  // Update chart on cadence change
  document.addEventListener('change', (e) => {
    if (!CHART_ENABLED) return;
    if (e.target && e.target.name === 'cadence') {
      updateExposureChart();
    }
  });

  async function buildExposureSeries(loadMore=false) {
    if (!CHART_ENABLED) return { labels: [], datasets: [] };
    if (!lastData) return { labels: [], datasets: [] };
    const cadence = getCadence();
    const payload = {
      brand: document.getElementById('brand').value || undefined,
      expId: document.getElementById('expId').value || undefined,
      from: document.getElementById('from').value || undefined,
      to: document.getElementById('to').value || undefined,
      bearer: document.getElementById('bearer').value || undefined,
      cadence,
      actionCardIds: Array.from(selectedForChart),
    };
    let labels = [];
    let datasets = [];
    try {
      const res = await fetch('/api/trends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json && json.ok) {
        labels = json.labels || [];
        // Overall series as background from totalsByPeriods
        const groups = (lastData.totalsByPeriods && lastData.totalsByPeriods[cadence]) || [];
        datasets.push({ label: 'All Exposures', data: groups.map(g => g.exposures || 0), borderColor: '#60a5fa', tension: 0.2, yAxisID: 'yLeft' });
        // Selected actions
        const actions = json.actions || {};
        Object.entries(actions).forEach(([acId, arr], idx) => {
          datasets.push({ label: `Action ${acId}`, data: arr, borderColor: '#f59e0b', borderDash: [5,3], tension: 0, yAxisID: 'yLeft' });
        });
        // Terms per action
        const terms = json.terms || {};
        const colors = ['#10b981','#ef4444','#8b5cf6','#22d3ee','#eab308','#f472b6','#34d399','#a3e635'];
        let colorIdx = 0;
        Object.entries(terms).forEach(([acId, termMap]) => {
          Object.entries(termMap || {}).forEach(([termName, series]) => {
            const key = `${acId}|||${termName}`;
            if (hiddenTerms.size === 0) { hiddenTerms.add(key); } // default hidden
            if (hiddenTerms.has(key)) return; // skip hidden terms
            const color = colors[colorIdx % colors.length];
            colorIdx += 1;
            datasets.push({ label: `${acId}: ${termName} (conv)`, data: series, borderColor: color, tension: 0, yAxisID: 'yRight' });
          });
        });
        // Render legend chips for terms
        renderTermLegend(terms);
        // Show or hide the "load more" note for daily cadence
        const note = document.getElementById('trends-note');
        if (cadence === 'days' && json.truncated) note.classList.remove('hidden'); else note.classList.add('hidden');
      }
    } catch (e) {
      // ignore
    }
    return { labels, datasets };
  }

  async function updateExposureChart(loadMore=false) {
    if (!CHART_ENABLED) { if (exposureTrends) exposureTrends.classList.add('hidden'); return; }
    const ctx = document.getElementById('exposureChart');
    if (!ctx) return;
    const cfg = await buildExposureSeries(loadMore);
    if (!exposureChart) {
      exposureChart = new Chart(ctx, {
        type: 'line',
        data: cfg,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'nearest', intersect: false },
          scales: {
            yLeft: { type: 'linear', position: 'left', beginAtZero: true },
            yRight: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } }
          }
        }
      });
    } else {
      exposureChart.data = cfg;
      exposureChart.options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          yLeft: { type: 'linear', position: 'left', beginAtZero: true },
          yRight: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } }
        }
      };
      exposureChart.update();
    }
    if (cfg.labels.length) show(exposureTrends);
  }

  // Load previous 14 days batching (front-end only triggers, backend uses cache and slice limits)
  const loadMoreBtn = document.getElementById('trends-load-more');
  if (loadMoreBtn && !loadMoreBtn._wired) {
    loadMoreBtn._wired = true;
    loadMoreBtn.addEventListener('click', () => {
      // Move window back by 14 days and refresh
      const from = document.getElementById('from');
      const to = document.getElementById('to');
      if (!from.value || !to.value) return;
      const fromDate = new Date(from.value);
      const toDate = new Date(to.value);
      // New window: end becomes previous start - 1, start becomes end - 13
      const newTo = new Date(fromDate.getTime() - 24*3600*1000);
      const newFrom = new Date(newTo.getTime() - 13*24*3600*1000);
      from.value = newFrom.toISOString().slice(0,10);
      to.value = newTo.toISOString().slice(0,10);
      setMinMaxDates();
      updateExposureChart(true);
    });
  }

  function renderTermLegend(termsByAction) {
    if (!CHART_ENABLED) return;
    const wrap = document.getElementById('term-legend');
    const cont = document.getElementById('term-legend-content');
    const btn = document.getElementById('toggle-term-legend');
    if (!termsByAction) { wrap.classList.add('hidden'); return; }
    cont.innerHTML = '';
    Object.entries(termsByAction || {}).forEach(([acId, termMap]) => {
      Object.keys(termMap || {}).forEach(termName => {
        const key = `${acId}|||${termName}`;
        const label = document.createElement('label');
        label.className = 'term';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !hiddenTerms.has(key);
        cb.addEventListener('change', () => {
          if (cb.checked) hiddenTerms.delete(key); else hiddenTerms.add(key);
          updateExposureChart();
        });
        const span = document.createElement('span');
        span.textContent = ` ${termName}`;
        label.appendChild(cb);
        label.appendChild(span);
        cont.appendChild(label);
      });
    });
    wrap.classList.remove('hidden');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', () => {
        wrap.classList.toggle('hidden');
      });
    }
  }

  // Date helpers: keep YYYY-MM-DD in payload, allow native calendar UI
  function setMinMaxDates() {
    // Ensure 'to' cannot be before 'from'
    if (fromInput) {
      if (fromInput.value) { toInput && (toInput.min = fromInput.value); } else { toInput && toInput.removeAttribute('min'); }
    }
    if (toInput) {
      if (toInput.value) { fromInput && (fromInput.max = toInput.value); } else { fromInput && fromInput.removeAttribute('max'); }
    }
    // Auto page dates
    if (fromAuto) {
      if (fromAuto.value) { toAuto && (toAuto.min = fromAuto.value); } else { toAuto && toAuto.removeAttribute('min'); }
    }
    if (toAuto) {
      if (toAuto.value) { fromAuto && (fromAuto.max = toAuto.value); } else { fromAuto && fromAuto.removeAttribute('max'); }
    }
  }

  fromInput.addEventListener('change', () => { setMinMaxDates(); persistForm(); });
  toInput.addEventListener('change', () => { setMinMaxDates(); persistForm(); });
  if (fromAuto) fromAuto.addEventListener('change', () => { setMinMaxDates(); });
  if (toAuto) toAuto.addEventListener('change', () => { setMinMaxDates(); });

  function flattenRows(rows) {
    function getIn(obj, path) {
      let cur = obj;
      for (const key of path) {
        if (typeof cur !== 'object' || cur === null) return undefined;
        cur = cur[key];
      }
      return cur;
    }
    return (rows || []).map(r => {
      const meta = r.conversionSetMetadata || {};
      return {
        'category.id': getIn(meta, ['category','id']),
        'category.vxId': getIn(meta, ['category','vxId']),
        'category.interaction': getIn(meta, ['category','interaction']),
        'source.id': getIn(meta, ['source','id']),
        'offer': getIn(meta, ['offer']),
        'term.id': getIn(meta, ['term','id']),
        'term.name': getIn(meta, ['term','name']),
        'term.link': getIn(meta, ['term','link']),
        'template.id': getIn(meta, ['template','id']),
        'template.variantId': getIn(meta, ['template','variantId']),
        'template.name': getIn(meta, ['template','name']),
        'template.variantName': getIn(meta, ['template','variantName']),
        'actionCard.id': getIn(meta, ['actionCard','id']),
        'actionCard.name': getIn(meta, ['actionCard','name']),
        'meta.currency': getIn(meta, ['currency']),
        'splitTest': getIn(meta, ['splitTest']),
        'customName': getIn(meta, ['customName']),
        'row.exposures': r.exposures ?? '',
        'row.conversions': r.conversions ?? '',
        'row.value': r.value ?? '',
        'row.currency': r.currency,
        'row.changed': r.changed,
        'row.isCounted': r.isCounted,
        'row.conversionRate': r.conversionRate ?? ''
      };
    });
  }

  function applyActionCardSelection() {
    const trs = actionCardsTable.querySelectorAll('tbody tr');
    trs.forEach((tr, idx) => {
      const row = currentActionCards[idx];
      const sel = row && row['actionCard.id'] === selectedActionCardId;
      tr.classList.toggle('selected', !!sel);
    });
  }

  function applyTermHighlights() {
    const tbody = actionCardTermsTable.querySelector('tbody');
    if (!tbody) return;
    if (!selectedActionCardId) return;
    // Render rows for selected action; optionally filter to selected template
    let rows = currentTermRows.filter(r => r['actionCard.id'] === selectedActionCardId);
    if (selectedTemplateName) rows = rows.filter(r => (r['template.name'] || '') === selectedTemplateName);
    const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0'))) || 0;
    const sorted = rows.slice().sort((a, b) => toNum(b['row.conversions']) - toNum(a['row.conversions']));
    const display = sorted.map(r => ({
      'template.name': r['template.name'],
      'term.name': r['term.name'],
      'row.conversions': r['row.conversions'],
      'conversionRate': r['conversionRate'],
    }));
    renderTable(actionCardTermsTable, display);
  }

  function wireActionCardClicks() {
    const trs = actionCardsTable.querySelectorAll('tbody tr');
    trs.forEach((tr, idx) => {
      tr.classList.add('row-clickable');
      tr.addEventListener('click', () => {
        const row = currentActionCards[idx];
        const id = row && row['actionCard.id'];
        selectedActionCardId = (selectedActionCardId === id) ? null : id;
        selectedTemplateName = null;
        applyActionCardSelection();
        applyTermHighlights();
        updateSubscriptionMetrics();
        updateSelectedAcTitle();
        updateTemplateList();
        updateExposureChart();
        if (selectedActionCardId) {
          const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0'))) || 0;
          const filtered = currentTermRows
            .filter(r => r['actionCard.id'] === selectedActionCardId)
            .sort((a,b)=> toNum(b['row.conversions']) - toNum(a['row.conversions']))
            .map(r => ({
              'template.name': r['template.name'],
              'term.name': r['term.name'],
              'row.conversions': r['row.conversions'],
              'conversionRate': r['conversionRate'],
            }));
          renderTable(actionCardTermsTable, filtered);
          actionCardTermsWrap.classList.remove('hidden');
          if (typeof actionCardTermsTitle !== 'undefined' && actionCardTermsTitle) actionCardTermsTitle.classList.remove('hidden');
        } else {
          actionCardTermsWrap.classList.add('hidden');
          actionCardTermsTable.innerHTML = '';
          if (typeof actionCardTermsTitle !== 'undefined' && actionCardTermsTitle) actionCardTermsTitle.classList.add('hidden');
        }
      });
    });
  }

  function updateTemplateList() {
    const title = document.getElementById('template-list-title');
    const wrap = document.getElementById('template-list');
    const table = document.getElementById('template-list-table');
    if (!selectedActionCardId) { title.classList.add('hidden'); wrap.classList.add('hidden'); table.innerHTML=''; return; }
    // Aggregate exposures per template for the selected action (from non-subscription rows)
    const tplMap = new Map(); // template.name -> exposures (max, not sum)
    (lastData.rows || []).forEach(r => {
      const meta = r.conversionSetMetadata || {};
      const catId = (meta.category && meta.category.id) || '';
      if (catId === 'Subscription' || catId === 'Uncategorized') return;
      const acId = meta.actionCard && meta.actionCard.id;
      if (acId !== selectedActionCardId) return;
      const tpl = (meta.template && meta.template.name) || '';
      const exp = r.exposures || 0;
      const prev = tplMap.get(tpl) || 0;
      tplMap.set(tpl, Math.max(prev, exp));
    });
    const rows = Array.from(tplMap.entries()).map(([tpl, exp]) => ({ 'template.name': tpl, 'row.exposures': exp }));
    // Click to filter by template
    table.innerHTML = '';
    renderTable(table, rows);
    // Add click handlers
    const trs = table.querySelectorAll('tbody tr');
    trs.forEach((tr, idx) => {
      tr.classList.add('row-clickable');
      tr.addEventListener('click', () => {
        const tpl = rows[idx]['template.name'] || '';
        selectedTemplateName = (selectedTemplateName === tpl) ? null : tpl;
        applyTermHighlights();
      });
    });
    title.classList.remove('hidden');
    wrap.classList.remove('hidden');
  }

  function updateSubscriptionMetrics() {
    // Compute total subscription count and revenue for selected action card
    if (!selectedActionCardId) { subTotalWrap.classList.add('hidden'); subTotalEmpty.classList.add('hidden'); subTotalTable.innerHTML=''; subTermWrap.classList.add('hidden'); subTermTable.innerHTML=''; subMetrics.classList.add('hidden'); return; }
    const rows = (lastData && lastData.rows) || [];
    let count = 0;
    let revenue = 0;
    const termAgg = new Map(); // term.name -> { conversions, revenue } (only non-# terms)
    for (const r of rows) {
      const meta = r.conversionSetMetadata || {};
      const catId = (meta.category && meta.category.id) || '';
      const isSub = catId === 'Subscription' || catId === 'Uncategorized';
      const acId = meta.actionCard && meta.actionCard.id;
      if (!isSub || acId !== selectedActionCardId) continue;
      count += (r.conversions || 0);
      const val = parseFloat(String(r.value != null ? r.value : '0')) || 0;
      revenue += val;
      const termId = meta.term && meta.term.id || '';
      const termName = meta.term && meta.term.name || '';
      if (termId && !termId.startsWith('#')) {
        const prev = termAgg.get(termName) || { conversions: 0, revenue: 0 };
        prev.conversions += (r.conversions || 0);
        prev.revenue += (parseFloat(String(r.value != null ? r.value : '0')) || 0);
        termAgg.set(termName, prev);
      }
    }
    // If there are no associated subscriptions, show empty message and hide tables
    const subTermTitle = document.getElementById('subTermTitle');
    if (count === 0) {
      subTotalWrap.classList.add('hidden');
      subTotalEmpty.classList.remove('hidden');
      subTermTable.innerHTML = '';
      subTermWrap.classList.add('hidden');
      subTermTitle.classList.add('hidden');
      subMetrics.classList.remove('hidden');
      return;
    } else {
      subTotalEmpty.classList.add('hidden');
    }

    // render total subscriptions table with Subscriptions and Revenue
    subTotalTable.innerHTML = '';
    const theadTotal = document.createElement('thead');
    const trhTotal = document.createElement('tr');
    ['Subscriptions', 'Revenue'].forEach(h => { const th = document.createElement('th'); th.textContent = h; trhTotal.appendChild(th); });
    theadTotal.appendChild(trhTotal);
    const tbodyTotal = document.createElement('tbody');
    const trTotal = document.createElement('tr');
    const tdSubsTotal = document.createElement('td'); tdSubsTotal.textContent = String(count); trTotal.appendChild(tdSubsTotal);
    const tdRevTotal = document.createElement('td'); tdRevTotal.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(revenue); trTotal.appendChild(tdRevTotal);
    tbodyTotal.appendChild(trTotal);
    subTotalTable.appendChild(theadTotal);
    subTotalTable.appendChild(tbodyTotal);
    subTotalWrap.classList.remove('hidden');
    // render term table: columns = Product Name | Subscriptions | Revenue, rows per term
    // exclude terms with zero conversions
    const items = Array.from(termAgg.entries())
      .filter(([, agg]) => (agg.conversions || 0) > 0)
      .sort((a,b)=>b[1].conversions - a[1].conversions);
    if (items.length > 0) {
      subTermTable.innerHTML = '';
      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      ['Product Name', 'Subscriptions', 'Revenue'].forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
      thead.appendChild(trh);
      const tbody = document.createElement('tbody');
      items.forEach(([name, agg]) => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td'); tdName.textContent = name; tr.appendChild(tdName);
        const tdSubs = document.createElement('td'); tdSubs.textContent = String(agg.conversions); tr.appendChild(tdSubs);
        const tdRev = document.createElement('td'); tdRev.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(agg.revenue); tr.appendChild(tdRev);
        tbody.appendChild(tr);
      });
      subTermTable.appendChild(thead);
      subTermTable.appendChild(tbody);
      subTermWrap.classList.remove('hidden');
      subTermTitle.classList.remove('hidden');
    } else {
      subTermTable.innerHTML = '';
      subTermWrap.classList.add('hidden');
      subTermTitle.classList.add('hidden');
    }
    subMetrics.classList.remove('hidden');
  }

  function updateSelectedAcTitle() {
    if (!selectedActionCardId) { selectedAcTitle.textContent = ''; selectedAcTitle.classList.add('hidden'); return; }
    const ac = currentActionCards.find(r => r['actionCard.id'] === selectedActionCardId);
    const name = (ac && ac['actionCard.name']) || selectedActionCardId;
    selectedAcTitle.textContent = `Selected Action: ${name}`;
    selectedAcTitle.classList.remove('hidden');
  }

  function render(data) {
    lastData = data;
    downloadBtn.disabled = false;

    // Original summary: use top-level exposures/conversions
    exposuresEl.textContent = data.exposures ?? '—';
    conversionsEl.textContent = data.conversions ?? '—';
    show(summary);

    const days = (data.totalsByPeriods && data.totalsByPeriods.days) || [];
    renderTable(daysTable, days);
    show(periods);

    const flatRows = flattenRows(data.rows);
    renderTable(rowsTable, flatRows);
    show(rowsSection);

    // Build action card views
    const acTplInfo = new Map(); // key `${acId}|${templateName}` -> { actionCard.id, actionCard.name, template.name, row.exposures }
    const termConv = new Map(); // key `${acId}|${templateName}|${termId}|${termName}` -> conversions
    (data.rows || []).forEach(r => {
      const meta = r.conversionSetMetadata || {};
      const acId = meta.actionCard && meta.actionCard.id || '';
      const acName = meta.actionCard && meta.actionCard.name || '';
      const templateName = (meta.template && meta.template.name) || '';
      const catId = (meta.category && meta.category.id) || '';
      const exposures = r.exposures || 0;
      // Build selector rows only from non-subscription categories
      if (acId && catId !== 'Subscription' && catId !== 'Uncategorized') {
        const key = `${acId}|${templateName}`;
        const prev = acTplInfo.get(key);
        if (!prev) acTplInfo.set(key, { 'actionCard.id': acId, 'actionCard.name': acName, 'template.name': templateName, 'row.exposures': exposures });
        else prev['row.exposures'] = Math.max(prev['row.exposures'] || 0, exposures || 0);
      }
      const termId = meta.term && meta.term.id || '';
      const termName = meta.term && meta.term.name || '';
      // Include all non-subscription categories (exclude Subscription and Uncategorized)
      const exclude = catId === 'Subscription' || catId === 'Uncategorized';
      if (!exclude && acId && (termId || termName)) {
        const key = `${acId}|${templateName}|${termId}|${termName}`;
        const prev = termConv.get(key) || 0;
        termConv.set(key, prev + (r.conversions || 0));
      }
    });
    // Aggregate to one row per action id for selector (sum exposures across templates)
    const acActionMap = new Map(); // acId -> { actionCard.id, actionCard.name, row.exposures }
    acTplInfo.forEach((val) => {
      const acId = val['actionCard.id'];
      const name = val['actionCard.name'];
      const exp = val['row.exposures'] || 0;
      const prev = acActionMap.get(acId);
      if (!prev) acActionMap.set(acId, { 'actionCard.id': acId, 'actionCard.name': name, 'row.exposures': exp });
      else prev['row.exposures'] = (prev['row.exposures'] || 0) + (exp || 0);
    });
    currentActionCards = Array.from(acActionMap.values()).sort((a,b)=> String(a['actionCard.name']).localeCompare(String(b['actionCard.name'])));
    renderTable(actionCardsTable, currentActionCards);

    currentTermRows = Array.from(termConv.entries()).map(([key, conv]) => {
      const [acId, templateName, termId, termName] = key.split('|');
      const acTpl = acTplInfo.get(`${acId}|${templateName}`) || {};
      const exposures = (typeof acTpl['row.exposures'] === 'number' ? acTpl['row.exposures'] : parseFloat(String(acTpl['row.exposures'] || '0'))) || 0;
      const ratePct = exposures > 0 ? `${((conv / exposures) * 100).toFixed(3)}%` : '—';
      return {
        'actionCard.id': acId,
        'actionCard.name': acTpl['actionCard.name'] || '',
        'template.name': templateName,
        'term.id': termId,
        'term.name': termName,
        'row.conversions': conv,
        'conversionRate': ratePct,
      };
    });
    const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0'))) || 0;
    currentTermRows.sort((a, b) => toNum(b['row.conversions']) - toNum(a['row.conversions']));
    // Do not render per-action table on initial load
    actionCardTermsWrap.classList.add('hidden');
    actionCardTermsTable.innerHTML = '';
    show(actionCardsSection);

    // Build All Template Click Conversions across all actions (include Subscription too),
    // broken up by Action Card name
    const allConv = new Map(); // key `${acName}|${termId}|${termName}` -> conversions
    (data.rows || []).forEach(r => {
      const meta = r.conversionSetMetadata || {};
      const acName = (meta.actionCard && meta.actionCard.name) || (meta.actionCard && meta.actionCard.id) || '';
      const termId = meta.term && meta.term.id || '';
      const termName = meta.term && meta.term.name || '';
      if (!(acName && (termId || termName))) return;
      const key = `${acName}|${termId}|${termName}`;
      const prev = allConv.get(key) || 0;
      allConv.set(key, prev + (r.conversions || 0));
    });
    const allRows = Array.from(allConv.entries()).map(([key, conv]) => {
      const [acName, termId, termName] = key.split('|');
      return { 'actionCard.name': acName, 'term.name': termName, 'row.conversions': conv };
    }).sort((a,b)=> (String(a['actionCard.name']).localeCompare(String(b['actionCard.name'])) || toNum(b['row.conversions']) - toNum(a['row.conversions'])));
    renderTable(templateClickAllTable, allRows);
    show(templateClickAllSection);

    // Reset selection and wire clicks
    selectedActionCardId = null;
    selectedTemplateName = null;
    wireActionCardClicks();
    updateSubscriptionMetrics();
    updateSelectedAcTitle();
  }

  async function loadBrands() {
    try {
      const res = await fetch('/api/brands');
      const json = await res.json();
      if (json && json.ok && json.brands && Object.keys(json.brands).length > 0) {
        const entries = Object.entries(json.brands).sort((a, b) => a[0].localeCompare(b[0]));
        brandSelect.innerHTML = '<option value="">— Select —</option>' + entries.map(([name]) => `<option value="${name}">${name}</option>`).join('');
      }
    } catch (err) {
      // Keep existing hardcoded options on failure
    }
    brandSelect.addEventListener('change', () => { persistForm(); });
    // Mirror options to auto brand
    if (brandAuto) {
      brandAuto.innerHTML = brandSelect.innerHTML;
    }
    restoreForm();
    applyUrlParams();
  }

  function downloadFile(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function generateCsvBundle(data) {
    const res = await fetch('/api/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'CSV generation failed');
    const files = json.files || {};
    for (const [name, content] of Object.entries(files)) {
      downloadFile(name, content);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('Fetching...');
    hide(summary); hide(periods); hide(rowsSection);
    downloadBtn.disabled = true;

    const payload = {
      brand: brandSelect.value || undefined,
      expId: expIdInput.value.trim() || undefined,
      ln: 'en_US',
      from: fromInput.value || undefined,
      to: toInput.value || undefined,
      bearer: bearerInput.value.trim(),
    };
    if (!payload.bearer) {
      setStatus('Bearer token is required');
      return;
    }

    // Persist last used values (excluding bearer)
    persistForm();

    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.ok) {
        // If 502 or message indicates token issue, warn user to refresh via extension
        if (res.status === 502 || /token|bearer|auth|unauthor/i.test(String(json.error || ''))) {
          markComposerTokenInvalid(String(json.error || 'Bad Gateway'));
        }
        throw new Error(json.error || 'Request failed');
      }
      render(json.data);
      setStatus('');
      updateExposureChart();
    } catch (err) {
      setStatus(String(err.message || err));
    }
  });

  downloadBtn.addEventListener('click', async () => {
    if (!lastData) return;
    setStatus('Generating CSV files...');
    try {
      await generateCsvBundle(lastData);
      setStatus('CSV files downloaded');
    } catch (err) {
      setStatus(String(err.message || err));
    }
  });

  parseLocalBtn.addEventListener('click', async () => {
    setStatus('Loading local sampleData.json...');
    hide(summary); hide(periods); hide(rowsSection);
    downloadBtn.disabled = true;
    try {
      const res = await fetch('/sampleData.json');
      const data = await res.json();
      render(data);
      setStatus('');
    } catch (err) {
      setStatus(String(err.message || err));
    }
  });

  // init
  loadBrands();

  // ---------------
  // Persistence
  // ---------------
  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search || '');
    if (params.size === 0) return;
    let changed = false;

    const brandParam = params.get('brand');
    if (brandParam && brandSelect.querySelector(`option[value="${brandParam}"]`)) {
      brandSelect.value = brandParam;
      if (brandAuto && brandAuto.querySelector(`option[value="${brandParam}"]`)) brandAuto.value = brandParam;
      changed = true;
    }

    const expParam = params.get('expId');
    if (expParam) { expIdInput.value = expParam; changed = true; }

    const fromParam = params.get('from');
    if (fromParam) { fromInput.value = fromParam; changed = true; }
    const toParam = params.get('to');
    if (toParam) { toInput.value = toParam; changed = true; }

    const bearerParam = params.get('bearer');
    if (bearerParam) { bearerInput.value = bearerParam; changed = true; }

    if (changed) {
      setMinMaxDates();
      persistForm();
    }
  }

  // ---------- Automatic Data Retrieval: load experiences ----------
  const loadExpBtn = document.getElementById('loadExperiences');
  if (loadExpBtn && !loadExpBtn._wired) {
    loadExpBtn._wired = true;
    loadExpBtn.addEventListener('click', async () => {
      const aidBrand = (brandAuto && brandAuto.value) || (brandSelect && brandSelect.value) || '';
      if (!aidBrand) { setStatus('Select a brand'); return; }
      setStatus('Loading experiences...');
      try {
        const res = await fetch('/api/experiences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand: aidBrand }) });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Failed to load experiences');
        renderExperiences(json.groups || {});
        setStatus('');
      } catch (err) {
        setStatus(String(err.message || err));
      }
    });
  }

  function renderExperiences(groups) {
    const container = document.getElementById('experiences');
    const list = document.getElementById('exp-list');
    const statuses = document.getElementById('exp-statuses');
    // Treat statuses as filter toggles; default to all selected
    let selectedStatuses = new Set(['active','scheduled','inactive']);

    function renderList(items) {
      list.innerHTML = '';
      (items || []).forEach(it => {
        const div = document.createElement('div');
        div.className = 'item';
        const title = it.name || it.title || it.experienceName || it.id || it.experience_id;
        const idText = it.id || it.experienceId || it.experience_id || '';
        // Add status-colored border class
        const raw = (it.status || it.state || '').toString().toUpperCase();
        const status = raw === 'LIVE' ? 'active' : raw === 'SCHEDULED' ? 'scheduled' : raw === 'OFFLINE' ? 'inactive' : '';
        if (status === 'active') div.classList.add('status-active-border');
        if (status === 'scheduled') div.classList.add('status-scheduled-border');
        if (status === 'inactive') div.classList.add('status-inactive-border');
        div.textContent = title + (idText ? ` (${idText})` : '');
        div.addEventListener('click', () => {
          setStatus(`Selected experience: ${title}`);
          const composerBearer = (localStorage.getItem('composer_bearer') || '') || (bearerInput && bearerInput.value) || '';
          if (!composerBearer) {
            const cs = document.getElementById('composer-status');
            if (cs) cs.textContent = 'Not connected. Paste a token or connect via extension.';
            return;
          }
          // Fetch composer data directly and render a compact table
          const f = (fromAuto && fromAuto.value) || (fromInput && fromInput.value) || undefined;
          const t = (toAuto && toAuto.value) || (toInput && toInput.value) || undefined;
          fetchComposerData(brandAuto && brandAuto.value, idText, composerBearer, f, t);
        });
        list.appendChild(div);
      });
    }

    function toggleStatus(status) {
      const btn = statuses.querySelector(`.status-item[data-status="${status}"]`);
      if (selectedStatuses.has(status)) {
        selectedStatuses.delete(status);
        btn && btn.classList.remove('selected');
      } else {
        selectedStatuses.add(status);
        btn && btn.classList.add('selected');
      }
      // If none selected, treat as all selected
      if (selectedStatuses.size === 0) {
        selectedStatuses = new Set(['active','scheduled','inactive']);
        statuses.querySelectorAll('.status-item').forEach(b => b.classList.add('selected'));
      }
      applySearch();
    }

    // Wire status buttons
    statuses.querySelectorAll('.status-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const st = btn.getAttribute('data-status');
        if (st) toggleStatus(st);
      });
    });

    // Search logic
    const searchEl = document.getElementById('exp-search');
    function applySearch() {
      const q = (searchEl && searchEl.value || '').trim().toLowerCase();
      // Collect items from all selected statuses
      const activeStatuses = selectedStatuses.size ? Array.from(selectedStatuses) : ['active','scheduled','inactive'];
      let items = [];
      activeStatuses.forEach(st => { if (groups && Array.isArray(groups[st])) items = items.concat(groups[st]); });
      if (q) {
        items = items.filter(it => {
          const title = (it.name || it.title || it.experienceName || it.id || it.experience_id || '').toString().toLowerCase();
          const eid = (it.id || it.experienceId || it.experience_id || '').toString().toLowerCase();
          return title.includes(q) || eid.includes(q);
        });
      }
      renderList(items);
    }
    if (searchEl) searchEl.addEventListener('input', applySearch);

    // Default: all selected
    statuses.querySelectorAll('.status-item').forEach(b => b.classList.add('selected'));
    applySearch();
    container.classList.remove('hidden');
  }

  async function fetchComposerData(brandNameOrAid, expId, bearer, fromOverride, toOverride) {
    const aid = (resolveAidLocal(brandNameOrAid) || brandNameOrAid || '').trim();
    if (!expId || !bearer) return;
    const params = {
      expId,
      aid,
      ln: 'en_US',
      from: fromOverride || (fromInput && fromInput.value) || undefined,
      to: toOverride || (toInput && toInput.value) || undefined,
      bearer,
    };
    try {
      const res = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
      const json = await res.json();
      if (!json.ok) {
        if (res.status === 502 || /token|bearer|auth|unauthor/i.test(String(json.error || ''))) {
          markComposerTokenInvalid(String(json.error || 'Bad Gateway'));
        }
        throw new Error(json.error || 'Failed to fetch composer data');
      }
      // Render Action Card reporting inside the Automatic panel
      renderActionCardsAuto(json.data || {});
    } catch (err) {
      setStatus(String(err.message || err));
    }
  }

  function resolveAidLocal(brand) {
    // Minimal mirror of brands.py mapping
    const m = {
      'Accounting Today': 'BOmg9kapee',
      'American Banker': 'XUnXNMUrFF',
      'Digital Insurance': 'N8sydUSDcX',
      'Employee Benefit News': 't7vpsMsOZy',
      'Financial Planning': 'RXUl28joTX',
      'National Mortgage News': 'DqBrRoNVmq',
      'Bond Buyer': 'x2vmB6Jdyn',
    };
    return m[brand] || brand;
  }

  function renderExpData(data) {
    const mount = document.getElementById('exp-data');
    if (!mount) return;
    // Build a small summary table: totals and first N rows
    const totals = data && data.totals || {};
    const rows = Array.isArray(data && data.rows) ? data.rows : [];
    const head = `<table><thead><tr><th>Metric</th><th>Value</th></tr></thead>`;
    const body = `<tbody>
      <tr><td>Exposures</td><td>${data.exposures ?? ''}</td></tr>
      <tr><td>Conversions</td><td>${data.conversions ?? ''}</td></tr>
      <tr><td>Totals Exposures</td><td>${totals.exposures ?? ''}</td></tr>
      <tr><td>Totals Conversions</td><td>${totals.conversions ?? ''}</td></tr>
    </tbody></table>`;
    // Small rows preview
    const preview = rows.slice(0, 10).map(r => {
      const meta = r.conversionSetMetadata || {};
      const term = (meta.term && (meta.term.name || meta.term.id)) || '';
      const tpl = (meta.template && meta.template.name) || '';
      return `<tr><td>${tpl}</td><td>${term}</td><td>${r.exposures ?? ''}</td><td>${r.conversions ?? ''}</td></tr>`;
    }).join('');
    const rowsTable = `<div style="margin-top:8px;"><table><thead><tr><th>Template</th><th>Term</th><th>Exposures</th><th>Conversions</th></tr></thead><tbody>${preview || '<tr><td colspan="4">No rows</td></tr>'}</tbody></table></div>`;
    mount.innerHTML = head + body + rowsTable;
  }

  // Render Action Card reporting (Auto page): replicate manual module exactly, inside the Auto panel
  function renderActionCardsAuto(data) {
    const mount = document.getElementById('exp-data');
    if (!mount) return;
    const rows = Array.isArray(data && data.rows) ? data.rows : [];

    // Build structures exactly like manual render()
    const acTplInfo = new Map(); // `${acId}|${templateName}` -> { actionCard.id, actionCard.name, template.name, row.exposures (max per tpl) }
    const termConv = new Map(); // `${acId}|${templateName}|${termId}|${termName}` -> conversions
    rows.forEach(r => {
      const meta = r.conversionSetMetadata || {};
      const acId = meta.actionCard && meta.actionCard.id || '';
      const acName = meta.actionCard && meta.actionCard.name || '';
      const templateName = (meta.template && meta.template.name) || '';
      const catId = (meta.category && meta.category.id) || '';
      const exposures = r.exposures || 0;
      // Selector rows from non-subscription categories
      if (acId && catId !== 'Subscription' && catId !== 'Uncategorized') {
        const key = `${acId}|${templateName}`;
        const prev = acTplInfo.get(key);
        if (!prev) acTplInfo.set(key, { 'actionCard.id': acId, 'actionCard.name': acName, 'template.name': templateName, 'row.exposures': exposures });
        else prev['row.exposures'] = Math.max(prev['row.exposures'] || 0, exposures || 0);
      }
      const termId = meta.term && meta.term.id || '';
      const termName = meta.term && meta.term.name || '';
      const exclude = catId === 'Subscription' || catId === 'Uncategorized';
      if (!exclude && acId && (termId || termName)) {
        const key2 = `${acId}|${templateName}|${termId}|${termName}`;
        const prev2 = termConv.get(key2) || 0;
        termConv.set(key2, prev2 + (r.conversions || 0));
      }
    });

    const acActionMap = new Map(); // acId -> { actionCard.id, actionCard.name, row.exposures (sum across templates of max) }
    acTplInfo.forEach((val) => {
      const acId = val['actionCard.id'];
      const name = val['actionCard.name'];
      const exp = val['row.exposures'] || 0;
      const prev = acActionMap.get(acId);
      if (!prev) acActionMap.set(acId, { 'actionCard.id': acId, 'actionCard.name': name, 'row.exposures': exp });
      else prev['row.exposures'] = (prev['row.exposures'] || 0) + (exp || 0);
    });
    const currentActionCards = Array.from(acActionMap.values()).sort((a,b)=> String(a['actionCard.name']).localeCompare(String(b['actionCard.name'])));

    const currentTermRows = Array.from(termConv.entries()).map(([key, conv]) => {
      const [acId, templateName, termId, termName] = key.split('|');
      const acTpl = acTplInfo.get(`${acId}|${templateName}`) || {};
      const exposures = (typeof acTpl['row.exposures'] === 'number' ? acTpl['row.exposures'] : parseFloat(String(acTpl['row.exposures'] || '0'))) || 0;
      const ratePct = exposures > 0 ? `${((conv / exposures) * 100).toFixed(3)}%` : '—';
      return {
        'actionCard.id': acId,
        'actionCard.name': acTpl['actionCard.name'] || '',
        'template.name': templateName,
        'term.id': termId,
        'term.name': termName,
        'row.conversions': conv,
        'conversionRate': ratePct,
      };
    }).sort((a, b) => {
      const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0'))) || 0;
      return toNum(b['row.conversions']) - toNum(a['row.conversions']);
    });

    // Build Auto module DOM, mirroring manual ids with auto- prefix
    mount.innerHTML = `
      <section id="ac-auto" class="panel">
        <h2>Action Cards</h2>
        <div class="table-wrap"><table id="ac-auto-table"></table></div>
        <h3 id="selected-ac-title-auto" class="hidden"></h3>
        <div id="subscription-metrics-auto" class="metrics hidden">
          <h3>Total Associated Subscriptions</h3>
          <div id="auto-subTotalWrap" class="table-wrap hidden"><table id="auto-sub-total-table"></table></div>
          <div id="auto-subTotalEmpty" class="empty hidden">No Associated Subscriptions</div>
          <h3 id="auto-subTermTitle" class="hidden">Subscription Term Conversions</h3>
          <div id="auto-subTermWrap" class="table-wrap hidden"><table id="auto-sub-term-table"></table></div>
        </div>
        <h3 id="auto-template-list-title" class="hidden">Templates for Selected Action</h3>
        <div id="auto-template-list" class="table-wrap hidden"><table id="auto-template-list-table"></table></div>
        <h3 id="auto-action-card-terms-title" class="hidden">Template Click Conversions</h3>
        <div id="auto-action-card-terms-wrap" class="table-wrap hidden"><table id="auto-action-card-terms-table"></table></div>
      </section>
    `;

    const acTable = document.getElementById('ac-auto-table');
    const selectedAcTitleEl = document.getElementById('selected-ac-title-auto');
    const subMetricsEl = document.getElementById('subscription-metrics-auto');
    const subTotalWrapEl = document.getElementById('auto-subTotalWrap');
    const subTotalEmptyEl = document.getElementById('auto-subTotalEmpty');
    const subTotalTableEl = document.getElementById('auto-sub-total-table');
    const subTermTitleEl = document.getElementById('auto-subTermTitle');
    const subTermWrapEl = document.getElementById('auto-subTermWrap');
    const subTermTableEl = document.getElementById('auto-sub-term-table');
    const tplListTitleEl = document.getElementById('auto-template-list-title');
    const tplListWrapEl = document.getElementById('auto-template-list');
    const tplListTableEl = document.getElementById('auto-template-list-table');
    const termsTitleEl = document.getElementById('auto-action-card-terms-title');
    const termsWrapEl = document.getElementById('auto-action-card-terms-wrap');
    const termsTableEl = document.getElementById('auto-action-card-terms-table');

    let selectedActionCardIdAuto = null;
    let selectedTemplateNameAuto = null;

    function renderTableAuto(table, items) {
      table.innerHTML = '';
      if (!items || !items.length) { table.innerHTML = '<tr><td>No data</td></tr>'; return; }
      const headers = Object.keys(items[0]);
      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
      thead.appendChild(trh);
      const tbody = document.createElement('tbody');
      items.forEach(row => {
        const tr = document.createElement('tr');
        headers.forEach(h => { const td = document.createElement('td'); const v = row[h]; td.textContent = v == null ? '' : String(v); tr.appendChild(td); });
        tbody.appendChild(tr);
      });
      table.appendChild(thead);
      table.appendChild(tbody);
    }

    // Render Action Cards selector table
    renderTableAuto(acTable, currentActionCards);

    function applyActionCardSelectionAuto() {
      const trs = acTable.querySelectorAll('tbody tr');
      trs.forEach((tr, idx) => {
        const row = currentActionCards[idx];
        const sel = row && row['actionCard.id'] === selectedActionCardIdAuto;
        tr.classList.toggle('selected', !!sel);
      });
    }

    function applyTermHighlightsAuto() {
      if (!selectedActionCardIdAuto) return;
      let rows = currentTermRows.filter(r => r['actionCard.id'] === selectedActionCardIdAuto);
      if (selectedTemplateNameAuto) rows = rows.filter(r => (r['template.name'] || '') === selectedTemplateNameAuto);
      const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0'))) || 0;
      const sorted = rows.slice().sort((a,b)=> toNum(b['row.conversions']) - toNum(a['row.conversions']));
      const display = sorted.map(r => ({ 'template.name': r['template.name'], 'term.name': r['term.name'], 'row.conversions': r['row.conversions'], 'conversionRate': r['conversionRate'] }));
      renderTableAuto(termsTableEl, display);
    }

    function updateSelectedAcTitleAuto() {
      if (!selectedActionCardIdAuto) { selectedAcTitleEl.textContent = ''; selectedAcTitleEl.classList.add('hidden'); return; }
      const ac = currentActionCards.find(r => r['actionCard.id'] === selectedActionCardIdAuto);
      const name = (ac && ac['actionCard.name']) || selectedActionCardIdAuto;
      selectedAcTitleEl.textContent = `Selected Action: ${name}`;
      selectedAcTitleEl.classList.remove('hidden');
    }

    function updateTemplateListAuto() {
      if (!selectedActionCardIdAuto) { tplListTitleEl.classList.add('hidden'); tplListWrapEl.classList.add('hidden'); tplListTableEl.innerHTML=''; return; }
      const tplMap = new Map(); // template.name -> exposures (max)
      rows.forEach(r => {
        const meta = r.conversionSetMetadata || {};
        const catId = (meta.category && meta.category.id) || '';
        if (catId === 'Subscription' || catId === 'Uncategorized') return;
        const acId = meta.actionCard && meta.actionCard.id;
        if (acId !== selectedActionCardIdAuto) return;
        const tpl = (meta.template && meta.template.name) || '';
        const exp = r.exposures || 0;
        const prev = tplMap.get(tpl) || 0;
        tplMap.set(tpl, Math.max(prev, exp));
      });
      const listRows = Array.from(tplMap.entries()).map(([tpl, exp]) => ({ 'template.name': tpl, 'row.exposures': exp }));
      tplListTableEl.innerHTML='';
      renderTableAuto(tplListTableEl, listRows);
      // Row clicks to filter by template
      const trs = tplListTableEl.querySelectorAll('tbody tr');
      trs.forEach((tr, idx) => {
        tr.classList.add('row-clickable');
        tr.addEventListener('click', () => {
          const tpl = listRows[idx]['template.name'] || '';
          selectedTemplateNameAuto = (selectedTemplateNameAuto === tpl) ? null : tpl;
          applyTermHighlightsAuto();
        });
      });
      tplListTitleEl.classList.remove('hidden');
      tplListWrapEl.classList.remove('hidden');
    }

    function updateSubscriptionMetricsAuto() {
      if (!selectedActionCardIdAuto) { subTotalWrapEl.classList.add('hidden'); subTotalEmptyEl.classList.add('hidden'); subTotalTableEl.innerHTML=''; subTermWrapEl.classList.add('hidden'); subTermTableEl.innerHTML=''; subMetricsEl.classList.add('hidden'); return; }
      let count = 0; let revenue = 0;
      const termAgg = new Map(); // term.name -> { conversions, revenue }
      for (const r of rows) {
        const meta = r.conversionSetMetadata || {};
        const catId = (meta.category && meta.category.id) || '';
        const isSub = catId === 'Subscription' || catId === 'Uncategorized';
        const acId = meta.actionCard && meta.actionCard.id;
        if (!isSub || acId !== selectedActionCardIdAuto) continue;
        count += (r.conversions || 0);
        const val = parseFloat(String(r.value != null ? r.value : '0')) || 0;
        revenue += val;
        const termId = meta.term && meta.term.id || '';
        const termName = meta.term && meta.term.name || '';
        if (termId && !termId.startsWith('#')) {
          const prev = termAgg.get(termName) || { conversions: 0, revenue: 0 };
          prev.conversions += (r.conversions || 0);
          prev.revenue += (parseFloat(String(r.value != null ? r.value : '0')) || 0);
          termAgg.set(termName, prev);
        }
      }
      if (count === 0) {
        subTotalWrapEl.classList.add('hidden');
        subTotalEmptyEl.classList.remove('hidden');
        subTermTableEl.innerHTML = '';
        subTermWrapEl.classList.add('hidden');
        subTermTitleEl.classList.add('hidden');
        subMetricsEl.classList.remove('hidden');
        return;
      } else {
        subTotalEmptyEl.classList.add('hidden');
      }
      // Total subscriptions table
      subTotalTableEl.innerHTML = '';
      const theadTotal = document.createElement('thead');
      const trhTotal = document.createElement('tr');
      ['Subscriptions', 'Revenue'].forEach(h => { const th = document.createElement('th'); th.textContent = h; trhTotal.appendChild(th); });
      theadTotal.appendChild(trhTotal);
      const tbodyTotal = document.createElement('tbody');
      const trTotal = document.createElement('tr');
      const tdSubsTotal = document.createElement('td'); tdSubsTotal.textContent = String(count); trTotal.appendChild(tdSubsTotal);
      const tdRevTotal = document.createElement('td'); tdRevTotal.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(revenue); trTotal.appendChild(tdRevTotal);
      tbodyTotal.appendChild(trTotal);
      subTotalTableEl.appendChild(theadTotal);
      subTotalTableEl.appendChild(tbodyTotal);
      subTotalWrapEl.classList.remove('hidden');
      // Term table
      const items = Array.from(termAgg.entries()).filter(([, agg]) => (agg.conversions || 0) > 0).sort((a,b)=> b[1].conversions - a[1].conversions);
      if (items.length > 0) {
        subTermTableEl.innerHTML = '';
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        ['Product Name', 'Subscriptions', 'Revenue'].forEach(h => { const th = document.createElement('th'); th.textContent = h; trh.appendChild(th); });
        thead.appendChild(trh);
        const tbody = document.createElement('tbody');
        items.forEach(([name, agg]) => {
          const tr = document.createElement('tr');
          const tdName = document.createElement('td'); tdName.textContent = name; tr.appendChild(tdName);
          const tdSubs = document.createElement('td'); tdSubs.textContent = String(agg.conversions); tr.appendChild(tdSubs);
          const tdRev = document.createElement('td'); tdRev.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(agg.revenue); tr.appendChild(tdRev);
          tbody.appendChild(tr);
        });
        subTermTableEl.appendChild(thead);
        subTermTableEl.appendChild(tbody);
        subTermWrapEl.classList.remove('hidden');
        subTermTitleEl.classList.remove('hidden');
      } else {
        subTermTableEl.innerHTML = '';
        subTermWrapEl.classList.add('hidden');
        subTermTitleEl.classList.add('hidden');
      }
      subMetricsEl.classList.remove('hidden');
    }

    // Wire Action Card clicks
    const acTrs = acTable.querySelectorAll('tbody tr');
    acTrs.forEach((tr, idx) => {
      tr.classList.add('row-clickable');
      tr.addEventListener('click', () => {
        const row = currentActionCards[idx];
        const id = row && row['actionCard.id'];
        selectedActionCardIdAuto = (selectedActionCardIdAuto === id) ? null : id;
        selectedTemplateNameAuto = null;
        applyActionCardSelectionAuto();
        if (selectedActionCardIdAuto) {
          // Show terms table and title and populate
          termsTitleEl.classList.remove('hidden');
          termsWrapEl.classList.remove('hidden');
          applyTermHighlightsAuto();
        } else {
          termsWrapEl.classList.add('hidden');
          termsTableEl.innerHTML = '';
          termsTitleEl.classList.add('hidden');
        }
        updateSubscriptionMetricsAuto();
        updateSelectedAcTitleAuto();
        updateTemplateListAuto();
      });
    });
  }

  // -------- Composer bearer via extension --------
  const connectBtn = document.getElementById('connectComposer');
  if (connectBtn && !connectBtn._wired) {
    connectBtn._wired = true;
    connectBtn.addEventListener('click', () => {
      // Request token from the extension. If extension isn't installed or allowed, show guidance.
      setComposerStatus('Requesting token via extension...');
      try {
        window.postMessage({ type: 'REQUEST_PIANO_TOKEN' }, window.location.origin);
        // If no response arrives within timeout, show help text
        clearTimeout(connectBtn._timeout);
        connectBtn._timeout = setTimeout(() => {
          // Only show if we haven't received a token yet
          const cur = (localStorage.getItem('composer_bearer') || '').trim();
          if (!cur) {
            setComposerStatus('No response from extension. Ensure it\'s installed, has access to this site (Site access: On), and the Piano dashboard tab is open while capturing. Then click Connect again.');
          }
        }, 2000);
      } catch {
        setComposerStatus('Could not post message to extension.');
      }
    });
  }

  // Force navigation for extension ZIP if some browsers block programmatic download
  const dlExt = document.getElementById('download-extension');
  if (dlExt && !dlExt._wired) {
    dlExt._wired = true;
    dlExt.addEventListener('click', (e) => {
      // Some SPA routers may prevent default; ensure full navigation
      e.stopPropagation();
      // Let the browser handle the navigation normally
      // If nothing happens, try programmatic fetch as fallback
      setTimeout(async () => {
        // If user stayed on page and no download started, attempt manual fetch
        try {
          const res = await fetch('/download/extension.zip');
          if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'piano_composer_extension.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
        } catch {}
      }, 150);
    });
  }
  // Info page ZIP link
  const dlExtInfo = document.getElementById('download-extension-info');
  if (dlExtInfo && !dlExtInfo._wired) {
    dlExtInfo._wired = true;
    dlExtInfo.addEventListener('click', (e) => {
      e.stopPropagation();
      setTimeout(async () => {
        try {
          const res = await fetch('/download/extension.zip');
          if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'piano_composer_extension.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
        } catch {}
      }, 150);
    });
  }

  // Copy chrome://extensions to clipboard helper
  const copyExtBtn = document.getElementById('copy-chrome-extensions');
  if (copyExtBtn && !copyExtBtn._wired) {
    copyExtBtn._wired = true;
    copyExtBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText('chrome://extensions');
        copyExtBtn.textContent = 'Link Copied';
        setStatus('Copied "chrome://extensions" to clipboard');
      } catch {
        setStatus('Copy failed. Manually copy: chrome://extensions');
      }
    });
  }

  window.addEventListener('message', (event) => {
    // Only accept from same origin as our app
    if (event.origin !== window.location.origin) return;
    const data = event.data || {};
    if (data && data.type === 'PIANO_COMPOSER_BEARER' && data.token) {
      try {
        localStorage.setItem('composer_bearer', data.token);
        setComposerStatus('Connected to Piano (Composer token received).');
        setStatus('');
      } catch {}
    }
  });
  function persistForm() {
    const state = {
      brand: brandSelect.value || '',
      expId: expIdInput.value || '',
      // no ln persisted; always en_US
      from: fromInput.value || '',
      to: toInput.value || '',
      bearer: bearerInput.value || '',
    };
    try { localStorage.setItem('piano_form_state', JSON.stringify(state)); } catch {}
  }

  function restoreForm() {
    try {
      const raw = localStorage.getItem('piano_form_state');
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.brand && brandSelect.querySelector(`option[value="${state.brand}"]`)) brandSelect.value = state.brand;
      if (state.expId) expIdInput.value = state.expId;
      // no ln restore; always en_US
      if (state.from) fromInput.value = state.from;
      if (state.to) toInput.value = state.to;
      if (state.bearer) bearerInput.value = state.bearer;
      setMinMaxDates();
    } catch {}
  }
})();
