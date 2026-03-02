/* ===== Subsurface Innovation Tracker – App Logic ===== */
(function () {
  'use strict';

  /* ---------- GA4 event helper (Measurement Protocol) ---------- */
  const GA4_MP = {
    measurement_id: 'G-9MHK97S37F',
    api_secret: 'CA1mCVMpTKe6a13CryVPSw',
    endpoint: 'https://www.google-analytics.com/mp/collect'
  };
  function getClientId() {
    /* Read from cookie if available, otherwise generate new */
    var match = document.cookie.match(/(?:^|; )ga_cid=([^;]+)/);
    if (match) return match[1];
    var cid = Math.random().toString(36).substring(2) + '.' + Date.now();
    try { document.cookie = 'ga_cid=' + cid + '; max-age=63072000; path=/; SameSite=Lax'; } catch(e) {}
    return cid;
  }
  function track(eventName, params) {
    /* Try gtag first (works if not blocked) */
    if (typeof gtag === 'function') {
      gtag('event', eventName, params || {});
    }
    /* Always also send via Measurement Protocol */
    const payload = {
      client_id: getClientId(),
      events: [{ name: eventName, params: params || {} }]
    };
    const url = GA4_MP.endpoint + '?measurement_id=' + GA4_MP.measurement_id + '&api_secret=' + GA4_MP.api_secret;
    fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload)
    }).catch(function() {});
  }

  /* ---------- constants ---------- */
  const TECH_COLORS = {
    'CCUS': '#16A34A',
    'Geothermal': '#DC2626',
    'Direct Lithium Extraction': '#2563EB',
    'Natural Hydrogen': '#D4A017',
    'Helium': '#7C3AED'
  };
  const TECH_FILLS = {
    'CCUS': 'rgba(22, 163, 74, 0.15)',
    'Geothermal': 'rgba(220, 38, 38, 0.15)',
    'Direct Lithium Extraction': 'rgba(37, 99, 235, 0.15)',
    'Natural Hydrogen': 'rgba(212, 160, 23, 0.15)',
    'Helium': 'rgba(124, 58, 237, 0.15)'
  };
  const TECH_LABELS = {
    'CCUS': 'CCUS',
    'Geothermal': 'Geothermal',
    'Direct Lithium Extraction': 'DLE',
    'Natural Hydrogen': 'Nat. Hydrogen',
    'Helium': 'Helium'
  };
  const TECH_BADGE_CLASS = {
    'CCUS': 'ccus',
    'Geothermal': 'geothermal',
    'Direct Lithium Extraction': 'dle',
    'Natural Hydrogen': 'hydrogen',
    'Helium': 'helium'
  };
  const TECH_ORDER = ['CCUS', 'Geothermal', 'Direct Lithium Extraction', 'Natural Hydrogen', 'Helium'];

  /* Distinct colors for announcement types */
  const TYPE_COLORS = [
    '#2563EB', '#DC2626', '#16A34A', '#D97706', '#7C3AED',
    '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4F46E5',
    '#059669', '#BE185D', '#0D9488', '#CA8A04', '#9333EA'
  ];

  const PURPLE_MAIN = '#7C3AED';
  const PURPLE_FILL = 'rgba(124, 58, 237, 0.15)';
  const PAGE_SIZE = 50;

  /* ---------- state ---------- */
  let filtered = [...DATA];
  let techFilters = new Set(Object.keys(TECH_COLORS));
  let sortCol = 'date';
  let sortDir = 'desc';
  let currentPage = 1;
  let tableSearchTerm = '';
  let charts = {};
  let map, clusterGroup;

  /* Cross-filter state */
  let chartFilter = { key: null, value: null, source: null };

  /* Map-bounds filtering state */
  let mapBoundsFilter = false;
  let mapBoundsRect = null;

  /* ---------- helpers ---------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function formatAmount(v) {
    if (v == null || v <= 0) return '—';
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'B';
    return '$' + v.toFixed(1) + 'M';
  }

  function formatAmountShort(v) {
    if (v == null || v <= 0) return '—';
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'T';
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'B';
    if (v >= 1) return '$' + v.toFixed(1) + 'M';
    return '$' + (v * 1000).toFixed(0) + 'K';
  }

  function formatTotalFunding(v) {
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'T';
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'B';
    if (v >= 1) return '$' + v.toFixed(0) + 'M';
    if (v > 0) return '$' + (v * 1000).toFixed(0) + 'K';
    return '$0';
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '...' : s;
  }

  function countBy(arr, key) {
    const m = {};
    arr.forEach(r => {
      const v = r[key];
      if (v) m[v] = (m[v] || 0) + 1;
    });
    return m;
  }

  function sumBy(arr, key, filterFn) {
    let total = 0;
    arr.forEach(r => {
      if (filterFn ? filterFn(r) : true) {
        const v = r[key];
        if (v != null && v > 0) total += v;
      }
    });
    return total;
  }

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function getChartColors() {
    return {
      grid: isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      text: isDark() ? '#9CA3AF' : '#6B7280',
      tooltipBg: isDark() ? '#1A1A24' : '#FFFFFF',
      tooltipText: isDark() ? '#F3F4F6' : '#111827',
      tooltipBorder: isDark() ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    };
  }

  /* ---------- cross-filtering ---------- */
  function getChartFiltered() {
    let data = filtered;

    /* Apply map-bounds filter if active */
    if (mapBoundsFilter && mapBoundsRect) {
      data = data.filter(r => {
        const lat = parseFloat(r.lat);
        const lon = parseFloat(r.lon);
        if (isNaN(lat) || isNaN(lon)) return false;
        return mapBoundsRect.contains(L.latLng(lat, lon));
      });
    }

    if (!chartFilter.key || !chartFilter.value) return data;
    return data.filter(r => {
      if (chartFilter.key === 'technology') return r.technology === chartFilter.value;
      if (chartFilter.key === 'type') return r.type === chartFilter.value;
      if (chartFilter.key === 'stage') return r.stage === chartFilter.value;
      if (chartFilter.key === 'country') return r.country === chartFilter.value;
      if (chartFilter.key === 'company') return r.company === chartFilter.value;
      return true;
    });
  }

  function setChartFilter(key, value, source) {
    if (chartFilter.key === key && chartFilter.value === value) {
      chartFilter = { key: null, value: null, source: null };
      track('chart_filter_clear', { chart: source });
    } else {
      chartFilter = { key, value, source };
      track('chart_filter', { chart: source, filter_key: key, filter_value: value });
    }
    updateAfterChartFilter();
  }

  function updateAfterChartFilter() {
    updateKPIs();
    updateMap();
    updateAllCharts();
    updateTable();
    updateFilterBadge();
  }

  function updateFilterBadge() {
    let badge = $('#activeFilterBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'activeFilterBadge';
      badge.className = 'active-filter-badge';
      badge.addEventListener('click', () => {
        chartFilter = { key: null, value: null, source: null };
        updateAfterChartFilter();
      });
      const main = $('.main');
      main.insertBefore(badge, main.firstChild);
    }
    if (chartFilter.key && chartFilter.value) {
      badge.innerHTML = `<span>Filtered: <strong>${chartFilter.value}</strong></span> <span class="clear-filter">✕ Clear</span>`;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
    updateResetButtons();
  }

  /* ---------- per-chart reset buttons ---------- */
  function updateResetButtons() {
    const chartMeta = [
      { source: 'tech', titleId: 'chartTech' },
      { source: 'countries', titleId: 'chartCountries' },
      { source: 'timeline', titleId: 'chartTimeline' },
      { source: 'type', titleId: 'chartType' },
      { source: 'fundingTech', titleId: 'chartFundingTech' },
      { source: 'stage', titleId: 'chartStage' },
      { source: 'companies', titleId: 'chartCompanies' },
      { source: 'fundingTime', titleId: 'chartFundingTime' }
    ];
    chartMeta.forEach(cm => {
      const canvas = $('#' + cm.titleId);
      if (!canvas) return;
      const card = canvas.closest('.chart-card');
      if (!card) return;
      let btn = card.querySelector('.chart-reset-btn');
      const isSource = chartFilter.source === cm.source && chartFilter.key;
      if (isSource) {
        if (!btn) {
          btn = document.createElement('button');
          btn.className = 'chart-reset-btn';
          btn.innerHTML = '✕ Reset';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            chartFilter = { key: null, value: null, source: null };
            updateAfterChartFilter();
          });
          const title = card.querySelector('.chart-title');
          if (title) title.appendChild(btn);
        }
        btn.style.display = 'inline-flex';
      } else if (btn) {
        btn.style.display = 'none';
      }
    });
  }

  /* ---------- theme toggle ---------- */
  function initTheme() {
    const toggle = $('#themeToggle');
    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      track('theme_toggle', { theme: next });
      updateAllCharts();
      if (map) {
        map.eachLayer(l => {
          if (l._url) map.removeLayer(l);
        });
        L.tileLayer(getTileUrl(), {
          attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
          maxZoom: 18
        }).addTo(map);
      }
    });
  }

  function getTileUrl() {
    return isDark()
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  }

  /* ---------- filters ---------- */
  function initFilters() {
    const container = $('#techCheckboxes');
    Object.keys(TECH_COLORS).forEach(tech => {
      const el = document.createElement('div');
      el.className = 'tech-checkbox active';
      el.dataset.tech = tech;
      el.innerHTML = `<span class="dot" style="background:${TECH_COLORS[tech]}"></span>${TECH_LABELS[tech]}`;
      el.addEventListener('click', () => {
        if (techFilters.has(tech)) {
          techFilters.delete(tech);
          el.classList.remove('active');
        } else {
          techFilters.add(tech);
          el.classList.add('active');
        }
        applyFilters();
        track('tech_filter', { technology: tech, active: techFilters.has(tech) });
      });
      container.appendChild(el);
    });

    $('#dateFrom').addEventListener('change', () => { applyFilters(); track('date_filter', { type: 'from', value: $('#dateFrom').value }); });
    $('#dateTo').addEventListener('change', () => { applyFilters(); track('date_filter', { type: 'to', value: $('#dateTo').value }); });
    let countryDebounce;
    $('#countrySearch').addEventListener('input', () => {
      applyFilters();
      clearTimeout(countryDebounce);
      countryDebounce = setTimeout(() => {
        const v = $('#countrySearch').value.trim();
        if (v) track('country_filter', { country: v });
      }, 800);
    });
    $('#resetFilters').addEventListener('click', () => { resetFilters(); track('filters_reset'); });

    let companyDebounce;
    $('#companySearch').addEventListener('input', () => {
      applyFilters();
      clearTimeout(companyDebounce);
      companyDebounce = setTimeout(() => {
        const v = $('#companySearch').value.trim();
        if (v) track('company_search', { company: v });
      }, 800);
    });
  }

  function resetFilters() {
    techFilters = new Set(Object.keys(TECH_COLORS));
    $$('.tech-checkbox').forEach(el => el.classList.add('active'));
    $('#dateFrom').value = '';
    $('#dateTo').value = '';
    $('#countrySearch').value = '';
    $('#companySearch').value = '';
    $('#tableSearch').value = '';
    tableSearchTerm = '';
    chartFilter = { key: null, value: null, source: null };
    /* Reset map bounds sync */
    mapBoundsFilter = false;
    mapBoundsRect = null;
    const chk = document.getElementById('mapBoundsCheck');
    if (chk) chk.checked = false;
    applyFilters();
  }

  function applyFilters() {
    const dateFrom = $('#dateFrom').value;
    const dateTo = $('#dateTo').value;
    const country = $('#countrySearch').value.toLowerCase().trim();
    const company = $('#companySearch').value.toLowerCase().trim();

    filtered = DATA.filter(r => {
      if (!techFilters.has(r.technology)) return false;
      if ((dateFrom || dateTo) && !r.date) return false;
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      if (country && (!r.country || !r.country.toLowerCase().includes(country))) return false;
      if (company && (!r.company || !r.company.toLowerCase().includes(company))) return false;
      return true;
    });

    currentPage = 1;
    updateKPIs();
    updateMap();
    updateAllCharts();
    updateTable();
    updateFilterBadge();
  }

  /* ---------- KPIs ---------- */
  function updateKPIs() {
    const data = getChartFiltered();
    $('#totalBadge').textContent = data.length.toLocaleString();
    $('#kpiTotal').textContent = data.length.toLocaleString();

    const countries = new Set(data.filter(r => r.country).map(r => r.country));
    $('#kpiCountries').textContent = countries.size.toLocaleString();

    const fundedCount = data.filter(r => r.amount != null && r.amount > 0).length;
    $('#kpiFunded').textContent = fundedCount.toLocaleString();

    const totalFunding = sumBy(data, 'amount', r => r.amount != null && r.amount > 0);
    $('#kpiFunding').textContent = formatTotalFunding(totalFunding);
  }

  function getMarkerSize(zoom) {
    if (zoom <= 3) return { size: 6, border: 1 };
    if (zoom <= 5) return { size: 8, border: 1.5 };
    if (zoom <= 7) return { size: 10, border: 2 };
    if (zoom <= 10) return { size: 14, border: 2 };
    return { size: 18, border: 2.5 };
  }

  function updateMarkerSizes() {
    const zoom = map.getZoom();
    const { size, border } = getMarkerSize(zoom);
    document.querySelectorAll('.tech-marker').forEach(el => {
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.borderWidth = border + 'px';
    });
  }

  /* ---------- map ---------- */
  function initMap() {
    map = L.map('map', {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
      scrollWheelZoom: true,
      worldCopyJump: true,
      maxBoundsViscosity: 1.0
    });

    L.tileLayer(getTileUrl(), {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18
    }).addTo(map);

    clusterGroup = L.layerGroup();
    map.addLayer(clusterGroup);
    map.on('zoomend', updateMarkerSizes);

    /* Map-bounds → chart sync */
    let moveDebounce;
    map.on('moveend', () => {
      if (!mapBoundsFilter) return;
      clearTimeout(moveDebounce);
      moveDebounce = setTimeout(() => {
        mapBoundsRect = map.getBounds();
        updateKPIs();
        updateAllCharts();
        updateTable();
      }, 250);
    });

    updateMap();
  }

  function updateMap() {
    clusterGroup.clearLayers();
    const markers = [];
    const data = getChartFiltered();
    const zoom = map ? map.getZoom() : 2;
    const ms = getMarkerSize(zoom);

    /* Group records by location (rounded to ~100m) to detect overlaps */
    const locGroups = {};
    data.forEach(r => {
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
      const key = lat.toFixed(3) + ',' + lon.toFixed(3);
      if (!locGroups[key]) locGroups[key] = { lat, lon, records: [] };
      locGroups[key].records.push(r);
    });

    Object.values(locGroups).forEach(group => {
      const { lat, lon, records } = group;
      const firstTech = records[0].technology;
      const color = TECH_COLORS[firstTech] || PURPLE_MAIN;
      /* Use a ring if multiple techs overlap */
      const multiTech = records.length > 1 && records.some(r => r.technology !== firstTech);
      const dotColor = multiTech ? '#fff' : color;
      const borderColor = multiTech ? color : '#fff';
      const icon = L.divIcon({
        className: '',
        html: `<div class="tech-marker" style="background:${dotColor};border-color:${borderColor};width:${ms.size}px;height:${ms.size}px;border-width:${ms.border}px"></div>`,
        iconSize: [ms.size + ms.border * 2, ms.size + ms.border * 2],
        iconAnchor: [(ms.size + ms.border * 2) / 2, (ms.size + ms.border * 2) / 2]
      });
      const marker = L.marker([lat, lon], { icon, _techColor: color });
      marker.on('click', () => openMapModal(records));
      markers.push(marker);
    });

    markers.forEach(m => clusterGroup.addLayer(m));
  }

  /* ---------- map modal with pagination for overlapping projects ---------- */
  let mapModalRecords = [];
  let mapModalIndex = 0;

  function openMapModal(records) {
    mapModalRecords = records;
    mapModalIndex = 0;
    track('map_click', {
      project: records[0].project || records[0].company || 'Unknown',
      technology: records[0].technology,
      country: records[0].country || 'Unknown',
      overlapping_count: records.length
    });
    renderMapModal();
    $('#modalOverlay').classList.add('open');
  }

  function renderMapModal() {
    const r = mapModalRecords[mapModalIndex];
    const total = mapModalRecords.length;
    const body = $('#modalBody');
    const badgeClass = TECH_BADGE_CLASS[r.technology] || '';

    const navHtml = total > 1 ? `
      <div class="map-modal-nav">
        <button class="map-modal-arrow" id="mapModalPrev" ${mapModalIndex === 0 ? 'disabled' : ''}>&#8592;</button>
        <span class="map-modal-counter">${mapModalIndex + 1} of ${total} projects at this location</span>
        <button class="map-modal-arrow" id="mapModalNext" ${mapModalIndex === total - 1 ? 'disabled' : ''}>&#8594;</button>
      </div>` : '';

    body.innerHTML = `
      ${navHtml}
      <h2>${r.project || r.company || 'Announcement Detail'}</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="modal-field">
          <div class="modal-field-label">Company</div>
          <div class="modal-field-value">${r.company || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Partner</div>
          <div class="modal-field-value">${r.partner || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Technology</div>
          <div class="modal-field-value"><span class="tech-badge ${badgeClass}">${TECH_LABELS[r.technology] || r.technology}</span></div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Type</div>
          <div class="modal-field-value">${r.type || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Date</div>
          <div class="modal-field-value">${r.date || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Stage</div>
          <div class="modal-field-value">${r.stage || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Country</div>
          <div class="modal-field-value">${r.country || '—'}${r.state ? ', ' + r.state : ''}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Amount</div>
          <div class="modal-field-value">${(r.amount != null && r.amount > 0) ? formatAmountShort(r.amount) + (r.amount_type ? ' (' + r.amount_type + ')' : '') : '—'}</div>
        </div>
        ${r.capacity_co2 ? `<div class="modal-field"><div class="modal-field-label">CO₂ Capacity</div><div class="modal-field-value">${r.capacity_co2.toLocaleString()} Mtpa</div></div>` : ''}
        ${r.capacity_mw ? `<div class="modal-field"><div class="modal-field-label">Capacity (MW)</div><div class="modal-field-value">${r.capacity_mw.toLocaleString()} MW</div></div>` : ''}
        ${r.capacity_tpy ? `<div class="modal-field"><div class="modal-field-label">Capacity (tpy)</div><div class="modal-field-value">${r.capacity_tpy.toLocaleString()} tpy</div></div>` : ''}
      </div>
      ${r.notes ? `<div class="modal-notes"><div class="modal-field-label">Notes</div><p>${r.notes}</p></div>` : ''}
      ${r.source ? `<div class="modal-source"><a href="${r.source}" target="_blank" rel="noopener noreferrer">View Source →</a></div>` : ''}
    `;

    if (total > 1) {
      document.getElementById('mapModalPrev').addEventListener('click', () => {
        if (mapModalIndex > 0) { mapModalIndex--; track('map_modal_nav', { direction: 'prev', index: mapModalIndex }); renderMapModal(); }
      });
      document.getElementById('mapModalNext').addEventListener('click', () => {
        if (mapModalIndex < total - 1) { mapModalIndex++; track('map_modal_nav', { direction: 'next', index: mapModalIndex }); renderMapModal(); }
      });
    }
  }

  /* ---------- chart defaults ---------- */
  function chartDefaults() {
    const c = getChartColors();
    return {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.6,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.tooltipBg,
          titleColor: c.tooltipText,
          bodyColor: c.tooltipText,
          borderColor: c.tooltipBorder,
          borderWidth: 1,
          cornerRadius: 6,
          padding: 10,
          titleFont: { family: 'Inter', weight: '600', size: 13 },
          bodyFont: { family: 'Inter', size: 12 },
          displayColors: true,
          boxWidth: 10,
          boxHeight: 10,
          boxPadding: 4
        }
      }
    };
  }

  function scaleDefaults(axis) {
    const c = getChartColors();
    return {
      grid: { color: c.grid, drawBorder: false },
      ticks: { color: c.text, font: { family: 'Inter', size: 11 } },
      border: { display: false }
    };
  }

  /* ---------- chart click handler helper ---------- */
  function addBarClickHandler(chart, chartKey, filterKey, labelsToValues) {
    chart.options.onClick = function (evt, elements) {
      if (elements.length > 0) {
        const idx = elements[0].index;
        const label = chart.data.labels[idx];
        const value = labelsToValues ? labelsToValues[label] : label;
        setChartFilter(filterKey, value, chartKey);
      }
    };
    chart.options.onHover = function (evt, elements) {
      evt.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
    };
  }

  function addDoughnutClickHandler(chart, chartKey, filterKey, labelsToValues) {
    chart.options.onClick = function (evt, elements) {
      if (elements.length > 0) {
        const idx = elements[0].index;
        const label = chart.data.labels[idx];
        const value = labelsToValues ? labelsToValues[label] : label;
        setChartFilter(filterKey, value, chartKey);
      }
    };
    chart.options.onHover = function (evt, elements) {
      evt.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
    };
  }

  function addLegendClickHandler(chart, chartKey, filterKey, techKeys) {
    chart.options.plugins.legend.onClick = function (evt, legendItem, legend) {
      const tech = techKeys[legendItem.datasetIndex];
      setChartFilter(filterKey, tech, chartKey);
    };
  }

  /* ---------- chart: By Technology ---------- */
  function renderChartTech() {
    const data = getChartFiltered();
    const counts = countBy(data, 'technology');
    const techs = TECH_ORDER;
    const vals = techs.map(t => counts[t] || 0);
    const labels = techs.map(t => TECH_LABELS[t]);
    const colors = techs.map(t => TECH_COLORS[t]);

    /* Highlight selected bar with border */
    const borderWidths = techs.map((t, i) => {
      if (chartFilter.source === 'tech' && chartFilter.key === 'technology' && chartFilter.value === t) return 3;
      return 0;
    });
    const borderColors = techs.map(t => '#111827');

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: vals,
          backgroundColor: colors,
          borderRadius: 4,
          barThickness: 24,
          borderWidth: borderWidths,
          borderColor: borderColors
        }]
      },
      options: {
        ...chartDefaults(),
        aspectRatio: 1.2,
        indexAxis: 'y',
        scales: {
          x: { ...scaleDefaults('x'), beginAtZero: true },
          y: { ...scaleDefaults('y'), grid: { display: false } }
        }
      }
    };

    if (charts.tech) {
      charts.tech.data = config.data;
      charts.tech.options = config.options;
      charts.tech.update('none');
    } else {
      charts.tech = new Chart($('#chartTech'), config);
    }
    /* Label → full tech name mapping for click handler */
    const labelMap = {};
    techs.forEach((t, i) => { labelMap[TECH_LABELS[t]] = t; });
    addBarClickHandler(charts.tech, 'tech', 'technology', labelMap);
  }

  /* ---------- chart: Top 15 Countries ---------- */
  function renderChartCountries() {
    const data = getChartFiltered();
    const counts = countBy(data, 'country');
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const labels = sorted.map(e => e[0]);
    const vals = sorted.map(e => e[1]);
    const colors = vals.map((_, i) => {
      const alpha = 1 - (i / vals.length) * 0.5;
      return `rgba(124, 58, 237, ${alpha})`;
    });

    /* Highlight selected bar with border */
    const borderWidths = labels.map((l) => {
      if (chartFilter.source === 'countries' && chartFilter.key === 'country' && chartFilter.value === l) return 3;
      return 0;
    });
    const borderColors = labels.map(() => '#111827');

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: vals,
          backgroundColor: colors,
          borderRadius: 4,
          barThickness: 18,
          borderWidth: borderWidths,
          borderColor: borderColors
        }]
      },
      options: {
        ...chartDefaults(),
        aspectRatio: 0.8,
        indexAxis: 'y',
        scales: {
          x: { ...scaleDefaults('x'), beginAtZero: true },
          y: { ...scaleDefaults('y'), grid: { display: false } }
        }
      }
    };

    if (charts.countries) {
      charts.countries.data = config.data;
      charts.countries.options = config.options;
      charts.countries.update('none');
    } else {
      charts.countries = new Chart($('#chartCountries'), config);
    }
    addBarClickHandler(charts.countries, 'countries', 'country');
  }

  /* ---------- chart: Announcements Over Time (stacked by tech) ---------- */
  function renderChartTimeline() {
    const data = getChartFiltered();

    /* Build monthly counts per technology */
    const monthlyByTech = {};
    TECH_ORDER.forEach(t => { monthlyByTech[t] = {}; });
    data.forEach(r => {
      if (!r.date) return;
      const m = r.date.slice(0, 7);
      const t = r.technology;
      if (t && monthlyByTech[t]) {
        monthlyByTech[t][m] = (monthlyByTech[t][m] || 0) + 1;
      }
    });

    /* Collect all months, sorted */
    const allMonths = new Set();
    TECH_ORDER.forEach(t => {
      Object.keys(monthlyByTech[t]).forEach(m => allMonths.add(m));
    });
    const sortedMonths = [...allMonths].sort();

    /* Build datasets */
    const datasets = TECH_ORDER.map(tech => ({
      label: TECH_LABELS[tech],
      data: sortedMonths.map(m => monthlyByTech[tech][m] || 0),
      borderColor: TECH_COLORS[tech],
      backgroundColor: TECH_FILLS[tech],
      fill: true,
      tension: 0.3,
      pointRadius: 1,
      pointHoverRadius: 4,
      pointBackgroundColor: TECH_COLORS[tech],
      borderWidth: 2
    }));

    const config = {
      type: 'line',
      data: {
        labels: sortedMonths,
        datasets
      },
      options: {
        ...chartDefaults(),
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          x: {
            ...scaleDefaults('x'),
            grid: { display: false },
            ticks: { ...scaleDefaults('x').ticks, maxTicksLimit: 12 },
            stacked: true
          },
          y: {
            ...scaleDefaults('y'),
            beginAtZero: true,
            stacked: true
          }
        },
        plugins: {
          ...chartDefaults().plugins,
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: getChartColors().text,
              font: { family: 'Inter', size: 11 },
              boxWidth: 12,
              padding: 12,
              usePointStyle: true
            }
          }
        }
      }
    };

    if (charts.timeline) {
      charts.timeline.data = config.data;
      charts.timeline.options = config.options;
      charts.timeline.update('none');
    } else {
      charts.timeline = new Chart($('#chartTimeline'), config);
    }
    addLegendClickHandler(charts.timeline, 'timeline', 'technology', TECH_ORDER);
  }

  /* ---------- chart: By Announcement Type ---------- */
  function renderChartType() {
    const data = getChartFiltered();
    const counts = countBy(data, 'type');
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(e => e[0]);
    const vals = sorted.map(e => e[1]);
    const colors = labels.map((_, i) => TYPE_COLORS[i % TYPE_COLORS.length]);

    const config = {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: vals,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: isDark() ? '#1A1A24' : '#FFFFFF',
          hoverOffset: 6
        }]
      },
      options: {
        ...chartDefaults(),
        cutout: '55%',
        plugins: {
          ...chartDefaults().plugins,
          legend: {
            display: true,
            position: 'right',
            labels: {
              color: getChartColors().text,
              font: { family: 'Inter', size: 11 },
              boxWidth: 12,
              padding: 8,
              usePointStyle: true
            }
          }
        }
      }
    };

    if (charts.type) {
      charts.type.data = config.data;
      charts.type.options = config.options;
      charts.type.update('none');
    } else {
      charts.type = new Chart($('#chartType'), config);
    }
    addDoughnutClickHandler(charts.type, 'type', 'type');
  }

  /* ---------- chart: Funding by Technology ---------- */
  function renderChartFundingTech() {
    const data = getChartFiltered();
    const funding = {};
    data.forEach(r => {
      if (r.amount != null && r.amount > 0) {
        const t = r.technology;
        funding[t] = (funding[t] || 0) + r.amount;
      }
    });
    const techs = TECH_ORDER;
    const labels = techs.map(t => TECH_LABELS[t]);
    const vals = techs.map(t => funding[t] || 0);
    const colors = techs.map(t => TECH_COLORS[t]);

    /* Highlight selected bar with border */
    const borderWidths = techs.map((t) => {
      if (chartFilter.source === 'fundingTech' && chartFilter.key === 'technology' && chartFilter.value === t) return 3;
      return 0;
    });
    const borderColors = techs.map(() => '#111827');

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: vals,
          backgroundColor: colors,
          borderRadius: 4,
          barThickness: 32,
          borderWidth: borderWidths,
          borderColor: borderColors
        }]
      },
      options: {
        ...chartDefaults(),
        scales: {
          x: { ...scaleDefaults('x'), grid: { display: false } },
          y: {
            ...scaleDefaults('y'),
            beginAtZero: true,
            ticks: {
              ...scaleDefaults('y').ticks,
              callback: function (v) {
                if (v >= 1000000) return '$' + (v / 1000000).toFixed(0) + 'T';
                if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'B';
                return '$' + v.toFixed(0) + 'M';
              }
            }
          }
        },
        plugins: {
          ...chartDefaults().plugins,
          tooltip: {
            ...chartDefaults().plugins.tooltip,
            callbacks: {
              label: function (ctx) {
                return formatTotalFunding(ctx.raw);
              }
            }
          }
        }
      }
    };

    if (charts.fundingTech) {
      charts.fundingTech.data = config.data;
      charts.fundingTech.options = config.options;
      charts.fundingTech.update('none');
    } else {
      charts.fundingTech = new Chart($('#chartFundingTech'), config);
    }
    const labelMap = {};
    techs.forEach((t, i) => { labelMap[TECH_LABELS[t]] = t; });
    addBarClickHandler(charts.fundingTech, 'fundingTech', 'technology', labelMap);
  }

  /* ---------- chart: Project Stage Distribution ---------- */
  function renderChartStage() {
    const data = getChartFiltered();
    const counts = countBy(data, 'stage');
    const sorted = Object.entries(counts)
      .filter(e => e[0] && e[0] !== 'N/A' && e[0] !== 'Unknown')
      .sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(e => e[0]);
    const vals = sorted.map(e => e[1]);
    const colors = vals.map((_, i) => {
      const alpha = 1 - (i / (vals.length + 1)) * 0.55;
      return `rgba(124, 58, 237, ${alpha})`;
    });

    /* Highlight selected bar with border */
    const borderWidths = labels.map((l) => {
      if (chartFilter.source === 'stage' && chartFilter.key === 'stage' && chartFilter.value === l) return 3;
      return 0;
    });
    const borderColors = labels.map(() => '#111827');

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: vals,
          backgroundColor: colors,
          borderRadius: 4,
          barThickness: 20,
          borderWidth: borderWidths,
          borderColor: borderColors
        }]
      },
      options: {
        ...chartDefaults(),
        aspectRatio: 1.0,
        indexAxis: 'y',
        scales: {
          x: { ...scaleDefaults('x'), beginAtZero: true },
          y: { ...scaleDefaults('y'), grid: { display: false } }
        }
      }
    };

    if (charts.stage) {
      charts.stage.data = config.data;
      charts.stage.options = config.options;
      charts.stage.update('none');
    } else {
      charts.stage = new Chart($('#chartStage'), config);
    }
    addBarClickHandler(charts.stage, 'stage', 'stage');
  }

  /* ---------- chart: Top 20 Companies ---------- */
  function renderChartCompanies() {
    const data = getChartFiltered();
    const counts = countBy(data, 'company');
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const labels = sorted.map(e => e[0]);
    const vals = sorted.map(e => e[1]);
    const colors = vals.map((_, i) => {
      const alpha = 1 - (i / vals.length) * 0.5;
      return `rgba(124, 58, 237, ${alpha})`;
    });

    /* Highlight selected bar with border */
    const borderWidths = labels.map((l) => {
      if (chartFilter.source === 'companies' && chartFilter.key === 'company' && chartFilter.value === l) return 3;
      return 0;
    });
    const borderColors = labels.map(() => '#111827');

    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: vals,
          backgroundColor: colors,
          borderRadius: 4,
          barThickness: 16,
          borderWidth: borderWidths,
          borderColor: borderColors
        }]
      },
      options: {
        ...chartDefaults(),
        aspectRatio: 0.7,
        indexAxis: 'y',
        scales: {
          x: { ...scaleDefaults('x'), beginAtZero: true },
          y: { ...scaleDefaults('y'), grid: { display: false }, ticks: { ...scaleDefaults('y').ticks, font: { family: 'Inter', size: 10 } } }
        }
      }
    };

    if (charts.companies) {
      charts.companies.data = config.data;
      charts.companies.options = config.options;
      charts.companies.update('none');
    } else {
      charts.companies = new Chart($('#chartCompanies'), config);
    }
    addBarClickHandler(charts.companies, 'companies', 'company');
  }

  /* ---------- chart: Cumulative Funding Over Time (by technology) ---------- */
  function renderChartFundingTime() {
    const data = getChartFiltered();

    /* Build monthly funding per technology */
    const monthlyByTech = {};
    TECH_ORDER.forEach(t => { monthlyByTech[t] = {}; });
    data.forEach(r => {
      if (!r.date || r.amount == null || r.amount <= 0) return;
      const m = r.date.slice(0, 7);
      const t = r.technology;
      if (t && monthlyByTech[t]) {
        monthlyByTech[t][m] = (monthlyByTech[t][m] || 0) + r.amount;
      }
    });

    /* Collect all months */
    const allMonths = new Set();
    TECH_ORDER.forEach(t => {
      Object.keys(monthlyByTech[t]).forEach(m => allMonths.add(m));
    });
    const sortedMonths = [...allMonths].sort();

    /* Build cumulative datasets per technology */
    const datasets = TECH_ORDER.map(tech => {
      let cumulative = 0;
      const vals = sortedMonths.map(m => {
        cumulative += (monthlyByTech[tech][m] || 0);
        return cumulative;
      });
      return {
        label: TECH_LABELS[tech],
        data: vals,
        borderColor: TECH_COLORS[tech],
        backgroundColor: TECH_FILLS[tech],
        fill: true,
        tension: 0.3,
        pointRadius: 1,
        pointHoverRadius: 4,
        pointBackgroundColor: TECH_COLORS[tech],
        borderWidth: 2
      };
    });

    const config = {
      type: 'line',
      data: {
        labels: sortedMonths,
        datasets
      },
      options: {
        ...chartDefaults(),
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          x: { ...scaleDefaults('x'), grid: { display: false }, ticks: { ...scaleDefaults('x').ticks, maxTicksLimit: 12 }, stacked: true },
          y: {
            ...scaleDefaults('y'),
            beginAtZero: true,
            stacked: true,
            ticks: {
              ...scaleDefaults('y').ticks,
              callback: function (v) {
                if (v >= 1000000) return '$' + (v / 1000000).toFixed(0) + 'T';
                if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'B';
                return '$' + v.toFixed(0) + 'M';
              }
            }
          }
        },
        plugins: {
          ...chartDefaults().plugins,
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: getChartColors().text,
              font: { family: 'Inter', size: 11 },
              boxWidth: 12,
              padding: 12,
              usePointStyle: true
            }
          },
          tooltip: {
            ...chartDefaults().plugins.tooltip,
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + formatTotalFunding(ctx.raw);
              }
            }
          }
        }
      }
    };

    if (charts.fundingTime) {
      charts.fundingTime.data = config.data;
      charts.fundingTime.options = config.options;
      charts.fundingTime.update('none');
    } else {
      charts.fundingTime = new Chart($('#chartFundingTime'), config);
    }
    addLegendClickHandler(charts.fundingTime, 'fundingTime', 'technology', TECH_ORDER);
  }

  function updateAllCharts() {
    // Destroy all and recreate for theme change
    Object.keys(charts).forEach(k => {
      charts[k].destroy();
      delete charts[k];
    });
    renderChartTech();
    renderChartCountries();
    renderChartTimeline();
    renderChartType();
    renderChartFundingTech();
    renderChartStage();
    renderChartCompanies();
    renderChartFundingTime();
  }

  /* ---------- data table ---------- */
  function getTableData() {
    let data = [...getChartFiltered()];
    // Table search
    if (tableSearchTerm) {
      const q = tableSearchTerm.toLowerCase();
      data = data.filter(r =>
        (r.company && r.company.toLowerCase().includes(q)) ||
        (r.project && r.project.toLowerCase().includes(q)) ||
        (r.country && r.country.toLowerCase().includes(q)) ||
        (r.technology && r.technology.toLowerCase().includes(q)) ||
        (r.type && r.type.toLowerCase().includes(q)) ||
        (r.stage && r.stage.toLowerCase().includes(q)) ||
        (r.notes && r.notes.toLowerCase().includes(q))
      );
    }
    // Sort
    data.sort((a, b) => {
      let va = a[sortCol];
      let vb = b[sortCol];
      if (sortCol === 'amount') {
        va = va || 0;
        vb = vb || 0;
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }

  function updateTable() {
    const data = getTableData();
    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = data.slice(start, start + PAGE_SIZE);

    const tbody = $('#tableBody');
    tbody.innerHTML = '';

    pageData.forEach(r => {
      const tr = document.createElement('tr');
      tr.dataset.id = r.id;
      tr.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') return;
        openModal(r);
      });

      const badgeClass = TECH_BADGE_CLASS[r.technology] || '';
      const amountDisplay = (r.amount != null && r.amount > 0) ? formatAmountShort(r.amount) : '—';

      tr.innerHTML = `
        <td>${r.date || '—'}</td>
        <td><span class="tech-badge ${badgeClass}">${TECH_LABELS[r.technology] || r.technology || '—'}</span></td>
        <td>${truncate(r.company || '—', 30)}</td>
        <td>${truncate(r.project || '—', 30)}</td>
        <td>${r.country || '—'}</td>
        <td>${truncate(r.type || '—', 25)}</td>
        <td>${r.stage || '—'}</td>
        <td class="num">${amountDisplay}</td>
        <td>${r.source ? `<a class="source-link" href="${r.source}" target="_blank" rel="noopener noreferrer">Link</a>` : '—'}</td>
      `;
      tbody.appendChild(tr);
    });

    renderPagination(data.length, totalPages);
  }

  function renderPagination(total, totalPages) {
    const container = $('#pagination');
    container.innerHTML = '';

    if (totalPages <= 1) {
      container.innerHTML = `<span class="page-info">${total} results</span>`;
      return;
    }

    // Prev
    const prev = document.createElement('button');
    prev.className = 'page-btn';
    prev.textContent = '←';
    prev.disabled = currentPage === 1;
    prev.addEventListener('click', () => { currentPage--; updateTable(); });
    container.appendChild(prev);

    // Page numbers
    const maxButtons = 7;
    let startP = Math.max(1, currentPage - 3);
    let endP = Math.min(totalPages, startP + maxButtons - 1);
    if (endP - startP < maxButtons - 1) startP = Math.max(1, endP - maxButtons + 1);

    if (startP > 1) {
      addPageBtn(container, 1);
      if (startP > 2) {
        const dots = document.createElement('span');
        dots.className = 'page-info';
        dots.textContent = '...';
        container.appendChild(dots);
      }
    }

    for (let i = startP; i <= endP; i++) {
      addPageBtn(container, i);
    }

    if (endP < totalPages) {
      if (endP < totalPages - 1) {
        const dots = document.createElement('span');
        dots.className = 'page-info';
        dots.textContent = '...';
        container.appendChild(dots);
      }
      addPageBtn(container, totalPages);
    }

    // Next
    const next = document.createElement('button');
    next.className = 'page-btn';
    next.textContent = '→';
    next.disabled = currentPage === totalPages;
    next.addEventListener('click', () => { currentPage++; updateTable(); });
    container.appendChild(next);

    // Info
    const info = document.createElement('span');
    info.className = 'page-info';
    const s = (currentPage - 1) * PAGE_SIZE + 1;
    const e = Math.min(currentPage * PAGE_SIZE, total);
    info.textContent = `${s}–${e} of ${total.toLocaleString()}`;
    container.appendChild(info);
  }

  function addPageBtn(container, page) {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (page === currentPage ? ' active' : '');
    btn.textContent = page;
    btn.addEventListener('click', () => { currentPage = page; updateTable(); });
    container.appendChild(btn);
  }

  function initTableSort() {
    $$('#dataTable th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortCol = col;
          sortDir = col === 'date' ? 'desc' : 'asc';
        }
        $$('#dataTable th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        currentPage = 1;
        updateTable();
      });
    });

    // Default sort indicator
    const defaultTh = document.querySelector('#dataTable th[data-col="date"]');
    if (defaultTh) defaultTh.classList.add('sort-desc');
  }

  function initTableSearch() {
    let searchDebounce;
    $('#tableSearch').addEventListener('input', (e) => {
      tableSearchTerm = e.target.value.trim();
      currentPage = 1;
      updateTable();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        if (tableSearchTerm) track('table_search', { query: tableSearchTerm });
      }, 800);
    });
  }

  /* ---------- modal ---------- */
  function openModal(r) {
    track('table_row_click', {
      project: r.project || r.company || 'Unknown',
      technology: r.technology,
      country: r.country || 'Unknown'
    });
    const body = $('#modalBody');
    const badgeClass = TECH_BADGE_CLASS[r.technology] || '';

    body.innerHTML = `
      <h2>${r.project || r.company || 'Announcement Detail'}</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="modal-field">
          <div class="modal-field-label">Company</div>
          <div class="modal-field-value">${r.company || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Partner</div>
          <div class="modal-field-value">${r.partner || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Technology</div>
          <div class="modal-field-value"><span class="tech-badge ${badgeClass}">${TECH_LABELS[r.technology] || r.technology}</span></div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Type</div>
          <div class="modal-field-value">${r.type || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Date</div>
          <div class="modal-field-value">${r.date || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Stage</div>
          <div class="modal-field-value">${r.stage || '—'}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Country</div>
          <div class="modal-field-value">${r.country || '—'}${r.state ? ', ' + r.state : ''}</div>
        </div>
        <div class="modal-field">
          <div class="modal-field-label">Amount</div>
          <div class="modal-field-value">${(r.amount != null && r.amount > 0) ? formatAmountShort(r.amount) + (r.amount_type ? ' (' + r.amount_type + ')' : '') : '—'}</div>
        </div>
        ${r.capacity_co2 ? `<div class="modal-field"><div class="modal-field-label">CO₂ Capacity</div><div class="modal-field-value">${r.capacity_co2.toLocaleString()} Mtpa</div></div>` : ''}
        ${r.capacity_mw ? `<div class="modal-field"><div class="modal-field-label">Capacity (MW)</div><div class="modal-field-value">${r.capacity_mw.toLocaleString()} MW</div></div>` : ''}
        ${r.capacity_tpy ? `<div class="modal-field"><div class="modal-field-label">Capacity (tpy)</div><div class="modal-field-value">${r.capacity_tpy.toLocaleString()} tpy</div></div>` : ''}
      </div>
      ${r.notes ? `<div class="modal-notes"><div class="modal-field-label">Notes</div><p>${r.notes}</p></div>` : ''}
      ${r.source ? `<div class="modal-source"><a href="${r.source}" target="_blank" rel="noopener noreferrer">View Source →</a></div>` : ''}
    `;

    $('#modalOverlay').classList.add('open');
  }

  function initModal() {
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalOverlay').addEventListener('click', (e) => {
      if (e.target === $('#modalOverlay')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  function closeModal() {
    $('#modalOverlay').classList.remove('open');
  }

  /* ---------- init ---------- */
  function init() {
    try {
      initTheme();
      initFilters();
      updateKPIs();
      initMap();
      initMapBoundsToggle();
      renderChartTech();
      renderChartCountries();
      renderChartTimeline();
      renderChartType();
      renderChartFundingTech();
      renderChartStage();
      renderChartCompanies();
      renderChartFundingTime();
      initTableSort();
      initTableSearch();
      updateTable();
      initModal();
      initOutboundTracking();
      track('page_view', { page_title: document.title, page_location: window.location.href });
      updateFilterBadge();
    } catch (e) {
      console.error('Dashboard init error:', e);
    }
  }

  /* ---------- outbound link tracking ---------- */
  function initOutboundTracking() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      /* Find context: is this inside a modal or table? */
      const inModal = link.closest('.modal-body');
      const inTable = link.closest('#dataTable');
      const context = inModal ? 'modal' : inTable ? 'table' : 'other';
      /* Try to get project/company info from nearby elements */
      let project = '';
      let company = '';
      let technology = '';
      if (inModal) {
        const h2 = inModal.querySelector('h2');
        if (h2) project = h2.textContent.trim();
        const badge = inModal.querySelector('.tech-badge');
        if (badge) technology = badge.textContent.trim();
        const fields = inModal.querySelectorAll('.modal-field');
        fields.forEach(f => {
          const label = f.querySelector('.modal-field-label');
          const value = f.querySelector('.modal-field-value');
          if (label && value && label.textContent.trim() === 'Company') company = value.textContent.trim();
        });
      } else if (inTable) {
        const row = link.closest('tr');
        if (row) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            company = cells[2] ? cells[2].textContent.trim() : '';
            project = cells[3] ? cells[3].textContent.trim() : '';
            const badge = cells[1] ? cells[1].querySelector('.tech-badge') : null;
            if (badge) technology = badge.textContent.trim();
          }
        }
      }
      track('outbound_click', {
        url: href,
        context: context,
        project: project || 'Unknown',
        company: company || 'Unknown',
        technology: technology || 'Unknown'
      });
    });
  }

  function initMapBoundsToggle() {
    const mapCard = document.querySelector('.map-card');
    if (!mapCard) return;
    const toggle = document.createElement('div');
    toggle.className = 'map-bounds-toggle';
    toggle.innerHTML = `
      <label class="bounds-switch">
        <input type="checkbox" id="mapBoundsCheck">
        <span class="bounds-label">Sync charts to map view</span>
      </label>
    `;
    mapCard.insertBefore(toggle, mapCard.firstChild);
    const checkbox = document.getElementById('mapBoundsCheck');
    checkbox.addEventListener('change', () => {
      mapBoundsFilter = checkbox.checked;
      if (mapBoundsFilter) {
        mapBoundsRect = map.getBounds();
      } else {
        mapBoundsRect = null;
      }
      track('map_bounds_sync', { enabled: mapBoundsFilter });
      updateKPIs();
      updateAllCharts();
      updateTable();
    });
  }

  // Ensure all scripts including Chart.js are loaded
  window.addEventListener('load', init);
})();
