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

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function renderTable(table, items) {
    table.innerHTML = '';
    if (!items || !items.length) {
      table.innerHTML = '<tr><td>No data</td></tr>';
      return;
    }
    const headers = Object.keys(items[0]);
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
        const v = row[h];
        td.textContent = v === null || v === undefined ? '' : String(v);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
  }

  // Date helpers: keep YYYY-MM-DD in payload, allow native calendar UI
  function setMinMaxDates() {
    // Ensure 'to' cannot be before 'from'
    if (fromInput.value) {
      toInput.min = fromInput.value;
    } else {
      toInput.removeAttribute('min');
    }
    if (toInput.value) {
      fromInput.max = toInput.value;
    } else {
      fromInput.removeAttribute('max');
    }
  }

  fromInput.addEventListener('change', () => { setMinMaxDates(); persistForm(); });
  toInput.addEventListener('change', () => { setMinMaxDates(); persistForm(); });

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
    // Aggregate to one row per action id for selector (max exposures across templates)
    const acActionMap = new Map(); // acId -> { actionCard.id, actionCard.name, row.exposures }
    acTplInfo.forEach((val) => {
      const acId = val['actionCard.id'];
      const name = val['actionCard.name'];
      const exp = val['row.exposures'] || 0;
      const prev = acActionMap.get(acId);
      if (!prev) acActionMap.set(acId, { 'actionCard.id': acId, 'actionCard.name': name, 'row.exposures': exp });
      else prev['row.exposures'] = Math.max(prev['row.exposures'] || 0, exp || 0);
    });
    currentActionCards = Array.from(acActionMap.values()).sort((a,b)=> String(a['actionCard.name']).localeCompare(String(b['actionCard.name'])));
    renderTable(actionCardsTable, currentActionCards);

    currentTermRows = Array.from(termConv.entries()).map(([key, conv]) => {
      const [acId, templateName, termId, termName] = key.split('|');
      const acTpl = acTplInfo.get(`${acId}|${templateName}`) || {};
      const exposures = (typeof acTpl['row.exposures'] === 'number' ? acTpl['row.exposures'] : parseFloat(String(acTpl['row.exposures'] || '0'))) || 0;
      const ratePct = exposures > 0 ? `${((conv / exposures) * 100).toFixed(2)}%` : '—';
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
    restoreForm();
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
      if (!json.ok) throw new Error(json.error || 'Request failed');
      render(json.data);
      setStatus('');
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
