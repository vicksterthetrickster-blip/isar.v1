// performance.js — Performance screen: stats, contributions, graph scrubbing and hover.

// --- Performance detail screen ---

// Statistics for a set of graph points, all computed from the data itself:
//  - step changes are the $ and % move between each consecutive pair of snapshots
//  - volatility is the standard deviation of those step % changes
//  - drawdown is the largest peak-to-trough decline at any point in the window
function computeStepStats(points) {
    if (points.length < 2) return null;
    const steps = [];
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1], cur = points[i];
        if (prev.value <= 0) continue;
        steps.push({ t: cur.t, amount: cur.value - prev.value, pct: (cur.value - prev.value) / prev.value * 100 });
    }
    if (!steps.length) return null;

    const best = steps.reduce((a, b) => (b.pct > a.pct ? b : a));
    const worst = steps.reduce((a, b) => (b.pct < a.pct ? b : a));
    const up = steps.filter(s => s.amount > 0).length;
    const down = steps.filter(s => s.amount < 0).length;

    const mean = steps.reduce((s, x) => s + x.pct, 0) / steps.length;
    const variance = steps.reduce((s, x) => s + (x.pct - mean) ** 2, 0) / steps.length;
    const volatilityPct = Math.sqrt(variance);

    return { best, worst, up, down, flat: steps.length - up - down, volatilityPct };
}

// Largest peak-to-trough decline within the window, with the dates it ran between.
function computeDrawdown(points) {
    if (points.length < 2) return null;
    let peak = points[0], worst = null;
    for (const p of points) {
        if (p.value > peak.value) peak = p;
        const drawdownPct = peak.value > 0 ? (p.value - peak.value) / peak.value * 100 : 0;
        if (!worst || drawdownPct < worst.pct) worst = { pct: drawdownPct, peak, trough: p };
    }
    return worst && worst.pct < 0 ? worst : null;
}

// Compound annual growth rate implied by the window, using the ACTUAL elapsed time
// between the first and last point (records are not evenly spaced).
function computeAnnualized(points) {
    if (points.length < 2) return null;
    const first = points[0], last = points[points.length - 1];
    const days = (last.t - first.t) / 864e5;
    if (days < 1 || first.value <= 0) return null;
    return (Math.pow(last.value / first.value, 365 / days) - 1) * 100;
}

// Each account's $ change over the window, valued in `code` at each end's own rates.
function computeContributions(label, code) {
    const { records } = getRecordsInWindow(label);
    if (records.length < 2) return [];
    const first = records[0], last = records[records.length - 1];
    return ACCOUNTS.map(account => {
        const startValue = getAccountRecordValue(first, account, code);
        const endValue = getAccountRecordValue(last, account, code);
        if (startValue === null || endValue === null) return null;
        return {
            account, startValue, endValue,
            delta: endValue - startValue,
            pct: startValue > 0 ? (endValue - startValue) / startValue * 100 : null
        };
    }).filter(Boolean).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function renderPerfTimeframes() {
    const el = document.getElementById('perf-timeframes');
    if (!el) return;
    el.innerHTML = PERF_TIMEFRAMES.map(pair => {
        const active = pair[1] === activeTimeframe;
        return '<button class="interactive-btn perf-timeframe-btn" onclick="setTimeframe(\'' + pair[1] + '\')" style="' +
            'border: 1px solid ' + (active ? '#00FF85' : '#27272A') + '; background: ' + (active ? '#27272A' : '#18181B') + '; ' +
            'color: ' + (active ? '#00FF85' : '#fff') + '; font-weight: ' + (active ? '700' : '600') + ';">' + pair[0] + '</button>';
    }).join('');
}

// Summary card: shows the window's start/end by default, or a scrubbed point mid-drag.
function renderPerfSummary(points, clipped) {
    const meta = CURRENCY_META[activeCurrency];
    const asOf = document.getElementById('perf-asof');
    const total = document.getElementById('perf-total');
    const change = document.getElementById('perf-change');
    if (points.length < 2) {
        asOf.innerText = '';
        total.innerText = points.length ? meta.symbol + formatMoney(points[0].value) : '—';
        change.innerText = 'Not enough history in this window yet';
        change.style.color = '#71717A';
        return;
    }
    const first = points[0], last = points[points.length - 1];
    const up = last.value >= first.value;
    asOf.innerText = graphTitle(activeTimeframe, activeTimeframe, clipped, points).replace(activeTimeframe + ' (', '').replace(')', '') || ('As of ' + formatGraphDate(last.t, true));
    asOf.innerText = 'As of ' + formatGraphDate(last.t, true) + (clipped ? ' · since ' + formatGraphDate(first.t, false) : '');
    total.innerText = meta.symbol + formatMoney(last.value);
    change.style.color = up ? '#00FF85' : '#FF4D6D';
    change.innerText = (up ? '↑ +' : '↓ −') + Math.abs((last.value - first.value) / first.value * 100).toFixed(1) + '% (' +
        (up ? '+' : '−') + meta.symbol + formatMoney(Math.abs(last.value - first.value)) + ' ' + activeCurrency + ') over ' + activeTimeframe.toLowerCase();
}

// While dragging: show the value/date under the finger instead of the window summary.
function renderPerfScrub(points, idx) {
    const meta = CURRENCY_META[activeCurrency];
    const p = points[idx];
    const first = points[0];
    const up = p.value >= first.value;
    document.getElementById('perf-asof').innerText = formatGraphDate(p.t, true);
    document.getElementById('perf-total').innerText = meta.symbol + formatMoney(p.value);
    const change = document.getElementById('perf-change');
    change.style.color = up ? '#00FF85' : '#FF4D6D';
    change.innerText = (up ? '↑ +' : '↓ −') + Math.abs((p.value - first.value) / first.value * 100).toFixed(1) + '% since ' + formatGraphDate(first.t, false);
}

function renderPerfStats(points) {
    const meta = CURRENCY_META[activeCurrency];
    const steps = computeStepStats(points);
    const drawdown = computeDrawdown(points);
    const annualized = computeAnnualized(points);

    const bestV = document.getElementById('perf-best-value'), bestS = document.getElementById('perf-best-sub');
    const worstV = document.getElementById('perf-worst-value'), worstS = document.getElementById('perf-worst-sub');
    const volV = document.getElementById('perf-vol-value');
    const udV = document.getElementById('perf-updown-value'), udS = document.getElementById('perf-updown-sub');
    const annV = document.getElementById('perf-annualized-value');

    if (!steps) {
        [bestV, worstV, volV, udV, annV].forEach(el => el.innerText = '—');
        [bestS, worstS, udS].forEach(el => el.innerText = 'Not enough snapshots yet');
        document.getElementById('perf-drawdown-value').innerText = '—';
        document.getElementById('perf-drawdown-sub').innerText = '';
        return;
    }

    bestV.innerText = (steps.best.pct >= 0 ? '+' : '') + steps.best.pct.toFixed(1) + '%';
    bestS.innerText = (steps.best.amount >= 0 ? '+' : '−') + meta.symbol + formatMoney(Math.abs(steps.best.amount)) + ' · ' + formatGraphDate(steps.best.t, true);
    worstV.innerText = steps.worst.pct.toFixed(1) + '%';
    worstS.innerText = (steps.worst.amount >= 0 ? '+' : '−') + meta.symbol + formatMoney(Math.abs(steps.worst.amount)) + ' · ' + formatGraphDate(steps.worst.t, true);
    volV.innerText = '±' + steps.volatilityPct.toFixed(1) + '%';
    udV.innerText = steps.up + ' / ' + steps.down;
    udS.innerText = steps.flat ? steps.flat + ' unchanged' : 'across ' + (steps.up + steps.down + steps.flat) + ' snapshots';

    const ddV = document.getElementById('perf-drawdown-value'), ddS = document.getElementById('perf-drawdown-sub');
    if (drawdown) {
        ddV.innerText = drawdown.pct.toFixed(1) + '%';
        ddV.style.color = '#FF4D6D';
        ddS.innerText = formatGraphDate(drawdown.peak.t, true) + ' → ' + formatGraphDate(drawdown.trough.t, true);
    } else {
        ddV.innerText = '0.0%';
        ddV.style.color = '';
        ddS.innerText = 'No decline in this window';
    }

    annV.innerText = annualized === null ? '—' : (annualized >= 0 ? '+' : '') + annualized.toFixed(1) + '%';
    annV.style.color = annualized === null ? '' : (annualized >= 0 ? '#00FF85' : '#FF4D6D');
}

function perfMoverRowHTML(m) {
    const meta = CURRENCY_META[activeCurrency];
    const up = m.delta >= 0;
    return '<div class="settings-row" style="cursor: pointer;" onclick="closePerformance(); openAccount(\'' + m.account.id + '\')">' +
        '<span class="row-label">' +
            '<span class="row-icon" style="background: ' + m.account.color + '; color: #fff;">' + m.account.letter + '</span>' +
            m.account.name +
        '</span>' +
        '<span style="text-align: right;">' +
            '<div style="color: ' + (up ? '#00FF85' : '#FF4D6D') + ';">' + (up ? '+' : '−') + meta.symbol + formatMoney(Math.abs(m.delta)) + '</div>' +
            '<div class="row-value">' + (m.pct === null ? '—' : (up ? '+' : '') + m.pct.toFixed(1) + '%') + '</div>' +
        '</span>' +
    '</div>';
}

function renderPerfContrib() {
    const contributions = computeContributions(activeTimeframe, activeCurrency);
    const el = document.getElementById('perf-contrib');
    el.innerHTML = contributions.length
        ? contributions.map(perfMoverRowHTML).join('')
        : '<div class="settings-row" style="cursor: default;"><span class="row-label" style="color: #71717A;">Not enough history in this window yet</span></div>';
}

function renderPerformanceScreen() {
    const { points, clipped } = getHistorySeries(activeCurrency, activeTimeframe);
    renderPerfTimeframes();
    renderPerfSummary(points, clipped);
    perfLayout = drawGraph(points, { line: 'perf-graph-line', area: 'perf-graph-area', svg: 'perf-graph-svg', labels: 'perf-graph-labels', empty: 'perf-graph-empty', pct: null }, { w: 320, h: 150 });
    hidePerfScrub();
    renderPerfStats(points);
    renderPerfContrib();
}

function openPerformance() {
    performanceOpen = true;
    renderPerformanceScreen();
    document.getElementById('perf-screen').classList.add('open');
    document.getElementById('perf-content').scrollTop = 0;
}

function closePerformance() {
    performanceOpen = false;
    document.getElementById('perf-screen').classList.remove('open');
}

// Finds the plotted point nearest a horizontal position (0..W) within a graph's layout.
function nearestPointIndex(points, layout, xPos) {
    if (!points.length) return -1;
    const targetT = layout.t0 + (xPos / layout.W) * (layout.t1 - layout.t0);
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
        const dist = Math.abs(points[i].t - targetT);
        if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
}

function showPerfScrub(clientX) {
    if (!perfLayout || perfLayout.points.length < 2) return;
    const svg = document.getElementById('perf-graph-svg');
    const rect = svg.getBoundingClientRect();
    const xPos = Math.max(0, Math.min(perfLayout.W, (clientX - rect.left) / rect.width * perfLayout.W));
    const idx = nearestPointIndex(perfLayout.points, perfLayout, xPos);
    const p = perfLayout.points[idx];

    const guide = document.getElementById('perf-guide'), dot = document.getElementById('perf-dot');
    const x = perfLayout.xOf(p), y = perfLayout.yOf(p);
    guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('opacity', '1');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('opacity', '1');

    renderPerfScrub(perfLayout.points, idx);
}

function hidePerfScrub() {
    const guide = document.getElementById('perf-guide'), dot = document.getElementById('perf-dot');
    if (guide) guide.setAttribute('opacity', '0');
    if (dot) dot.setAttribute('opacity', '0');
    perfScrubActive = false;
    const { points, clipped } = getHistorySeries(activeCurrency, activeTimeframe);
    renderPerfSummary(points, clipped);
}

// --- Mouse hover: crosshair + tooltip (desktop). Separate from the touch-drag
// scrub above so a mouse doesn't need to be held down to inspect the graph. ---

// Positions the tooltip in the graph card's own coordinate space, and keeps
// it from spilling past the card's left/right edge.
function positionPerfTooltip(x, y) {
    const svg = document.getElementById('perf-graph-svg');
    const card = svg.parentElement;
    const svgRect = svg.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const tooltip = document.getElementById('perf-tooltip');

    let px = (x / perfLayout.W) * svgRect.width + (svgRect.left - cardRect.left);
    const py = (y / perfLayout.H) * svgRect.height + (svgRect.top - cardRect.top);
    const half = tooltip.offsetWidth / 2 || 40;
    px = Math.max(half + 4, Math.min(cardRect.width - half - 4, px));

    tooltip.style.left = px + 'px';
    tooltip.style.top = py + 'px';
}

function showPerfHover(clientX) {
    if (!perfLayout || perfLayout.points.length < 2) return;
    const svg = document.getElementById('perf-graph-svg');
    const rect = svg.getBoundingClientRect();
    const xPos = Math.max(0, Math.min(perfLayout.W, (clientX - rect.left) / rect.width * perfLayout.W));
    const idx = nearestPointIndex(perfLayout.points, perfLayout, xPos);
    const p = perfLayout.points[idx];
    const x = perfLayout.xOf(p), y = perfLayout.yOf(p);

    const guideX = document.getElementById('perf-guide');
    guideX.setAttribute('x1', x); guideX.setAttribute('x2', x); guideX.setAttribute('opacity', '1');
    const guideY = document.getElementById('perf-guide-y');
    guideY.setAttribute('y1', y); guideY.setAttribute('y2', y); guideY.setAttribute('opacity', '1');
    const dot = document.getElementById('perf-dot');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('opacity', '1');

    const meta = CURRENCY_META[activeCurrency];
    document.getElementById('perf-tooltip-date').innerText = formatGraphDate(p.t, true);
    document.getElementById('perf-tooltip-value').innerText = meta.symbol + formatMoney(p.value);
    document.getElementById('perf-tooltip').style.opacity = '1';
    positionPerfTooltip(x, y);

    renderPerfScrub(perfLayout.points, idx);   // keeps the summary card in sync too
}

function hidePerfHover() {
    document.getElementById('perf-guide').setAttribute('opacity', '0');
    document.getElementById('perf-guide-y').setAttribute('opacity', '0');
    document.getElementById('perf-dot').setAttribute('opacity', '0');
    document.getElementById('perf-tooltip').style.opacity = '0';
    const { points, clipped } = getHistorySeries(activeCurrency, activeTimeframe);
    renderPerfSummary(points, clipped);
}

function initPerfHover() {
    const svg = document.getElementById('perf-graph-svg');
    svg.addEventListener('mouseenter', e => showPerfHover(e.clientX));
    svg.addEventListener('mousemove', e => showPerfHover(e.clientX));
    svg.addEventListener('mouseleave', hidePerfHover);
}

// Touch/drag to inspect any point on the performance graph.
function initPerfScrub() {
    const svg = document.getElementById('perf-graph-svg');
    const clientXOf = e => (e.touches && e.touches.length ? e.touches[0].clientX : e.clientX);
    svg.addEventListener('pointerdown', e => { perfScrubActive = true; showPerfScrub(clientXOf(e)); if (svg.setPointerCapture && e.pointerId != null) svg.setPointerCapture(e.pointerId); e.preventDefault(); });
    svg.addEventListener('pointermove', e => { if (perfScrubActive) { showPerfScrub(clientXOf(e)); e.preventDefault(); } });
    svg.addEventListener('pointerup', hidePerfScrub);
    svg.addEventListener('pointercancel', hidePerfScrub);
    svg.addEventListener('pointerleave', () => { if (perfScrubActive) hidePerfScrub(); });
}
