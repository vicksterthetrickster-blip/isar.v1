// graph.js — draws the line graphs and their labels.

function formatGraphDate(t, withDay) {
    const d = new Date(t);
    return withDay
        ? d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()]
        : MONTH_NAMES[d.getUTCMonth()] + " '" + String(d.getUTCFullYear()).slice(2);
}

// Draws a series into the SVG/label elements named in `ids`, sized WxH (default 320x70).
// Used by the net worth graph, each account's detail graph, and the performance graph.
// Returns the layout it drew with (t0, t1, xOf, yOf) so a caller can add its own overlays,
// such as the performance screen's touch-scrub guide line and dot.
function drawGraph(points, ids, size) {
    const line = document.getElementById(ids.line);
    const area = document.getElementById(ids.area);
    const svg = document.getElementById(ids.svg);
    const labels = document.getElementById(ids.labels);
    const empty = document.getElementById(ids.empty);
    const pctEl = document.getElementById(ids.pct);
    const W = (size && size.w) || 320, H = (size && size.h) || 70;
    const TOP = H * 0.08, BOTTOM = H - H * 0.14;

    const t0 = points.length ? points[0].t : 0;
    const t1 = points.length ? points[points.length - 1].t : 0;
    if (points.length < 2 || t1 === t0) {
        line.setAttribute('d', '');
        area.setAttribute('d', '');
        labels.innerHTML = '';
        empty.style.display = 'block';
        if (pctEl) pctEl.innerText = '—';
        return { points: [], t0, t1, W, H, TOP, BOTTOM, xOf: () => W / 2, yOf: () => H / 2 };
    }
    empty.style.display = 'none';

    const values = points.map(p => p.value);
    const min = Math.min(...values), max = Math.max(...values);
    const xOf = p => ((p.t - t0) / (t1 - t0)) * W;                       // spaced by real date
    const yOf = p => max === min ? (TOP + BOTTOM) / 2 : BOTTOM - ((p.value - min) / (max - min)) * (BOTTOM - TOP);

    const path = 'M ' + points.map(p => xOf(p).toFixed(1) + ' ' + yOf(p).toFixed(1)).join(' L ');
    line.setAttribute('d', path);
    area.setAttribute('d', path + ' L ' + W + ' ' + H + ' L 0 ' + H + ' Z');

    // Change over the visible window, in the selected currency. Uses the like-for-like
    // totals (lfl) so an account added mid-window doesn't count as growth.
    const first = points[0].lfl, last = points[points.length - 1].lfl;
    const up = last >= first;
    const color = up ? '#00FF85' : '#FF4D6D';
    svg.style.color = color;
    if (pctEl) {
        pctEl.parentElement.style.color = color;
        pctEl.innerText = first > 0 ? (up ? '+' : '') + (((last - first) / first) * 100).toFixed(1) + '%' : '—';
    }

    // Six evenly spaced date labels across the visible window.
    const withDay = (t1 - t0) / 864e5 <= 200;
    let html = '';
    for (let i = 0; i < 6; i++) html += '<span>' + formatGraphDate(t0 + (t1 - t0) * i / 5, withDay) + '</span>';
    labels.innerHTML = html;

    return { points, t0, t1, W, H, TOP, BOTTOM, xOf, yOf };
}

// "[Bank] added" markers for linked accounts that have an addedDate, oldest first.
function getAddedMarkers(accounts) {
    return accounts
        .filter(a => a.userLinked && a.addedDate)
        .map(a => ({ t: Date.parse(a.addedDate + 'T00:00:00Z'), label: a.name + ' added' }))
        .filter(m => !isNaN(m.t))
        .sort((a, b) => a.t - b.t);
}

// Draws a dashed line + label for each marker inside the window `layout` (from drawGraph)
// into the SVG group `groupId`. Labels close together are stacked so they don't overlap.
function drawAddedMarkers(groupId, layout, markers) {
    const g = document.getElementById(groupId);
    if (!g) return;
    const inWindow = layout.points.length ? markers.filter(m => m.t >= layout.t0 && m.t <= layout.t1) : [];
    let lastX = -Infinity, row = 0;
    g.innerHTML = inWindow.map(m => {
        const x = (m.t - layout.t0) / (layout.t1 - layout.t0) * layout.W;
        row = x - lastX < 70 ? row + 1 : 0;
        lastX = x;
        const nearRight = x > layout.W * 0.7;
        return '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="0" y2="' + layout.H + '" stroke="#71717A" stroke-width="1" stroke-dasharray="3,3" vector-effect="non-scaling-stroke"/>' +
            '<text x="' + (nearRight ? x - 3 : x + 3).toFixed(1) + '" y="' + (7 + row * 9) + '" font-size="9" fill="#A1A1AA" text-anchor="' + (nearRight ? 'end' : 'start') + '">' + escapeHTML(m.label) + '</text>';
    }).join('');
}

function graphTitle(prefix, label, clipped, points) {
    return prefix + ' (' + label + (clipped && points.length ? ' · since ' + formatGraphDate(points[0].t, false) : '') + ')';
}

function renderGraph() {
    const { points, clipped } = getHistorySeries(activeCurrency, activeTimeframe);
    document.getElementById('timeframe-title').innerText = graphTitle('Performance', activeTimeframe, clipped, points);
    const layout = drawGraph(points, { line: 'graph-line', area: 'graph-area', svg: 'graph-svg', labels: 'graph-labels', empty: 'graph-empty', pct: 'timeframe-pct' });
    drawAddedMarkers('graph-markers', layout, getAddedMarkers(ACCOUNTS));
}

// Shared by the home card and the performance screen, which both plot activeTimeframe.
function setTimeframe(label) {
    activeTimeframe = label;
    renderGraph();
    renderPerfTimeframes();
    if (performanceOpen) renderPerformanceScreen();
}
