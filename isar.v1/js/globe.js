// globe.js — Globe tab: where your money lives, on a dotted Earth you can spin, plus what a
// currency move would do to your net worth. Money is placed by its CURRENCY, because that's
// what affects its value: EUR sits in Frankfurt, whichever bank holds it.
// The Earth is drawn by hand on a <canvas> from the land grid in globedata.js, so no map
// library or internet connection is needed.

// Each currency's place on the globe: [latitude, longitude, name].
const CURRENCY_HOMES = {
    AUD: [-33.9, 151.2, 'Australia'], USD: [40.7, -74, 'United States'], EUR: [50.1, 8.7, 'Eurozone'],
    GBP: [51.5, -0.1, 'United Kingdom'], JPY: [35.7, 139.7, 'Japan'], CAD: [43.7, -79.4, 'Canada'],
    NZD: [-36.8, 174.8, 'New Zealand'], CHF: [47.4, 8.5, 'Switzerland'], SGD: [1.35, 103.8, 'Singapore'],
    HKD: [22.3, 114.2, 'Hong Kong'], CNY: [31.2, 121.5, 'China'], INR: [19.1, 72.9, 'India'],
    KRW: [37.6, 127, 'South Korea'], IDR: [-6.2, 106.8, 'Indonesia'], MYR: [3.1, 101.7, 'Malaysia'],
    PHP: [14.6, 121, 'Philippines'], THB: [13.8, 100.5, 'Thailand'], SEK: [59.3, 18.1, 'Sweden'],
    NOK: [59.9, 10.8, 'Norway'], DKK: [55.7, 12.6, 'Denmark'], ISK: [64.1, -21.9, 'Iceland'],
    PLN: [52.2, 21, 'Poland'], CZK: [50.1, 14.4, 'Czechia'], HUF: [47.5, 19, 'Hungary'],
    RON: [44.4, 26.1, 'Romania'], TRY: [41, 29, 'Türkiye'], ILS: [32.1, 34.8, 'Israel'],
    ZAR: [-26.2, 28, 'South Africa'], MXN: [19.4, -99.1, 'Mexico'], BRL: [-23.6, -46.6, 'Brazil']
};
const GLOBE_SPIN_PER_SECOND = 5;        // degrees, while nothing is selected
const GLOBE_DRAG_SPEED = 0.4;           // degrees per pixel dragged
const GLOBE_DEFAULT_TILT = 18;          // degrees: shows a little more of the northern hemisphere
const GLOBE_TAP_RADIUS = 26;            // how close a tap must be to a marker, in pixels

let globeDots = null;                   // land dots as points on a unit sphere (built on first use)
let globeSpin = 0, globeTilt = GLOBE_DEFAULT_TILT;       // the point facing you: longitude, latitude
let globeTarget = null;                 // { spin, tilt } the globe is easing towards
let globeSelected = null;               // currency code of the selected marker
let globeDragX = null, globeDragged = false;
let globeFrame = null, globeLastTime = 0;
let exposureCurrency = null, exposureMove = -10;

function toSpherePoint(lat, lon) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    return { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) };
}

// One dot per land cell. Near the poles the cells get narrower, so some are skipped to keep
// the dots evenly spaced.
function buildGlobeDots() {
    const dots = [];
    GLOBE_LAND_ROWS.forEach((row, r) => {
        const lat = 89 - r * 2;
        const step = Math.max(1, Math.round(1 / Math.max(0.08, Math.cos(lat * Math.PI / 180))));
        for (let col = 0; col < 180; col += step) {
            if (parseInt(row[col >> 2], 16) & (8 >> (col & 3))) dots.push(toSpherePoint(lat, col * 2 - 179));
        }
    });
    return dots;
}

// Turns a point on the sphere to face the viewer. z > 0 means it's on the visible side.
function rotateGlobePoint(p) {
    const lambda = globeSpin * Math.PI / 180, phi = globeTilt * Math.PI / 180;
    const x = p.x * Math.cos(lambda) - p.z * Math.sin(lambda);
    const z1 = p.x * Math.sin(lambda) + p.z * Math.cos(lambda);
    return { x: x, y: p.y * Math.cos(phi) - z1 * Math.sin(phi), z: p.y * Math.sin(phi) + z1 * Math.cos(phi) };
}

// A point along the curved line between two places, lifted off the surface in the middle.
function arcPoint(a, b, t, angle) {
    const s = Math.sin(angle), k1 = Math.sin((1 - t) * angle) / s, k2 = Math.sin(t * angle) / s;
    const lift = 1 + 0.22 * (angle / Math.PI) * Math.sin(Math.PI * t);
    return { x: (a.x * k1 + b.x * k2) * lift, y: (a.y * k1 + b.y * k2) * lift, z: (a.z * k1 + b.z * k2) * lift };
}

// Your assets grouped by currency, largest first. Debts aren't on the globe: it shows where your
// money lives. `value` is each group in the display currency, all converted at the same rates,
// and `share` is that group's percentage of your total assets.
function getHoldings() {
    const groups = {};
    ACCOUNTS.filter(a => !isDebt(a)).forEach(account => {
        const group = groups[account.currency] || (groups[account.currency] = { code: account.currency, value: 0, native: 0, accounts: [] });
        group.native += account.balance;      // in the currency itself, as shown in the list
        group.value += convertFromBase(convertToBase(account.balance, account.currency), activeCurrency);
        group.accounts.push(account);
    });
    const list = Object.keys(groups).map(code => groups[code]).sort((a, b) => b.value - a.value);
    const total = list.reduce((sum, g) => sum + g.value, 0);
    list.forEach(g => { g.share = total > 0 ? g.value / total : 0; });
    return list;
}

function drawGlobe(time) {
    const canvas = document.getElementById('globe-canvas');
    const ratio = window.devicePixelRatio || 1, size = canvas.clientWidth;
    if (!size) return;
    if (canvas.width !== Math.round(size * ratio)) canvas.width = canvas.height = Math.round(size * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const centre = size / 2, radius = size * 0.44;
    const screen = p => ({ x: centre + p.x * radius, y: centre - p.y * radius });

    // The sphere, with a soft green glow around its edge
    const glow = ctx.createRadialGradient(centre, centre, radius * 0.9, centre, centre, radius * 1.12);
    glow.addColorStop(0, 'rgba(0, 255, 133, 0.13)');
    glow.addColorStop(1, 'rgba(0, 255, 133, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    const body = ctx.createRadialGradient(centre - radius * 0.3, centre - radius * 0.35, radius * 0.1, centre, centre, radius);
    body.addColorStop(0, '#14201B');
    body.addColorStop(1, '#0B0F0D');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(centre, centre, radius, 0, Math.PI * 2);
    ctx.fill();

    // Land: brighter towards the middle of the globe, in three shades (drawn in batches for speed)
    if (!globeDots) globeDots = buildGlobeDots();
    const shades = [[], [], []];
    globeDots.forEach(dot => {
        const p = rotateGlobePoint(dot);
        if (p.z > 0.02) shades[p.z > 0.66 ? 2 : p.z > 0.33 ? 1 : 0].push(screen(p));
    });
    ['rgba(150, 175, 165, 0.26)', 'rgba(170, 195, 185, 0.46)', 'rgba(190, 215, 205, 0.68)'].forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        shades[i].forEach(s => ctx.rect(s.x - 0.8, s.y - 0.8, 1.6, 1.6));
        ctx.fill();
    });

    // Lines from your home currency to everywhere else you hold money, with a dot moving along each
    const holdings = getHoldings();
    const homeInfo = CURRENCY_HOMES[activeCurrency];
    const home = toSpherePoint(homeInfo[0], homeInfo[1]);
    ctx.lineWidth = 1.2;
    holdings.forEach((holding, i) => {
        const place = CURRENCY_HOMES[holding.code];
        if (holding.code === activeCurrency) return;
        const to = toSpherePoint(place[0], place[1]);
        const angle = Math.acos(Math.max(-1, Math.min(1, home.x * to.x + home.y * to.y + home.z * to.z)));
        if (angle < 0.01) return;
        ctx.strokeStyle = 'rgba(0, 255, 133, ' + (!globeSelected || globeSelected === holding.code ? 0.6 : 0.16) + ')';
        ctx.beginPath();
        let drawing = false;
        for (let s = 0; s <= 40; s++) {
            const p = rotateGlobePoint(arcPoint(home, to, s / 40, angle)), pos = screen(p);
            if (p.z > 0) { if (drawing) ctx.lineTo(pos.x, pos.y); else ctx.moveTo(pos.x, pos.y); drawing = true; } else drawing = false;
        }
        ctx.stroke();
        const moving = rotateGlobePoint(arcPoint(home, to, (time / 2600 + i * 0.37) % 1, angle));
        if (moving.z > 0) {
            const pos = screen(moving);
            ctx.fillStyle = '#E8FFF4';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 1.7, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // A glowing marker per currency: bigger when more of your money is there
    const labels = [];
    holdings.forEach(holding => {
        const place = CURRENCY_HOMES[holding.code];
        const p = rotateGlobePoint(toSpherePoint(place[0], place[1]));
        if (p.z <= 0) return;
        const pos = screen(p), selected = globeSelected === holding.code;
        const dot = 3 + 8 * Math.sqrt(holding.share);
        ctx.fillStyle = 'rgba(0, 255, 133, 0.2)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dot * 1.9 + Math.sin(time / 500) * 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#00FF85';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dot, 0, Math.PI * 2);
        ctx.fill();
        if (selected) {
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, dot + 4, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 12px Inter, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        // Above the marker, or below it if that would overlap a nearby label (e.g. EUR and GBP)
        const above = pos.y - dot - 7;
        const crowded = labels.some(l => Math.abs(l.x - pos.x) < 34 && Math.abs(l.y - above) < 14);
        const labelY = crowded ? pos.y + dot + 16 : above;
        labels.push({ x: pos.x, y: labelY });
        ctx.fillText(holding.code, pos.x, labelY);
    });
}

function globeLoop(time) {
    const elapsed = Math.min(50, time - globeLastTime);
    globeLastTime = time;
    const stayStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (globeTarget) {
        const spinGap = ((globeTarget.spin - globeSpin + 540) % 360) - 180, tiltGap = globeTarget.tilt - globeTilt;
        globeSpin += spinGap * 0.09;
        globeTilt += tiltGap * 0.09;
        if (Math.abs(spinGap) < 0.1 && Math.abs(tiltGap) < 0.1) globeTarget = null;
    } else if (globeDragX === null && !globeSelected && !stayStill) {
        globeSpin = (globeSpin + GLOBE_SPIN_PER_SECOND * elapsed / 1000) % 360;
    }
    drawGlobe(time);
    globeFrame = requestAnimationFrame(globeLoop);
}

function startGlobe() {
    if (globeFrame !== null) return;
    globeLastTime = performance.now();
    globeFrame = requestAnimationFrame(globeLoop);
}

function stopGlobe() {
    if (globeFrame !== null) cancelAnimationFrame(globeFrame);
    globeFrame = null;
}

// Turns the globe to a currency's home, or lets it spin again if it's tapped a second time.
function selectGlobeCurrency(code) {
    globeSelected = globeSelected === code ? null : code;
    if (globeSelected) {
        const place = CURRENCY_HOMES[code];
        globeTarget = { spin: place[1], tilt: Math.max(-35, Math.min(35, place[0])) };
    } else {
        globeTarget = { spin: globeSpin, tilt: GLOBE_DEFAULT_TILT };
    }
    renderGlobeTab();
}

// Dragging sideways spins the globe; dragging up and down still scrolls the page.
// A tap that didn't move selects the marker under it.
function initGlobe() {
    const canvas = document.getElementById('globe-canvas');
    canvas.addEventListener('pointerdown', e => { globeDragX = e.clientX; globeDragged = false; globeTarget = null; });
    canvas.addEventListener('pointermove', e => {
        if (globeDragX === null) return;
        const dx = e.clientX - globeDragX;
        if (Math.abs(dx) > 2) globeDragged = true;
        globeSpin = (globeSpin - dx * GLOBE_DRAG_SPEED + 360) % 360;
        globeDragX = e.clientX;
    });
    canvas.addEventListener('pointerup', e => {
        globeDragX = null;
        if (globeDragged) return;
        const box = canvas.getBoundingClientRect(), size = box.width;
        const tapX = e.clientX - box.left, tapY = e.clientY - box.top;
        let nearest = null, nearestGap = GLOBE_TAP_RADIUS;
        getHoldings().forEach(holding => {
            const place = CURRENCY_HOMES[holding.code];
            const p = rotateGlobePoint(toSpherePoint(place[0], place[1]));
            if (p.z <= 0) return;
            const gap = Math.hypot(size / 2 + p.x * size * 0.44 - tapX, size / 2 - p.y * size * 0.44 - tapY);
            if (gap < nearestGap) { nearest = holding.code; nearestGap = gap; }
        });
        if (nearest) selectGlobeCurrency(nearest);
    });
    canvas.addEventListener('pointercancel', () => { globeDragX = null; });
}

// --- Under the globe: the list of places, and the currency move calculator ---
function renderGlobeTab() {
    const holdings = getHoldings();
    const meta = CURRENCY_META[activeCurrency];
    const debts = convertFromBase(getDebtsTotalAUD(), activeCurrency);
    document.getElementById('globe-summary').innerText = holdings.length
        ? holdings.length + (holdings.length === 1 ? ' currency' : ' currencies') + ' · ' + formatAmount(holdings.reduce((sum, g) => sum + g.value, 0), activeCurrency, true) + ' in assets'
        : 'Add an account to see where your money lives.';
    document.getElementById('globe-note').innerText = !holdings.length ? ''
        : 'Percentages are each currency\'s share of your total assets, at today\'s rates.' +
          (debts ? ' Debts of ' + formatAmount(Math.abs(debts), activeCurrency, true) + ' aren\'t included here.' : '');
    document.getElementById('globe-list').innerHTML = holdings.map(holding => {
        const names = holding.accounts.map(a => escapeHTML(a.name)).join(', ');
        return '<button class="globe-row' + (globeSelected === holding.code ? ' selected' : '') + '" onclick="selectGlobeCurrency(\'' + holding.code + '\')">' +
            '<span class="globe-flag">' + CURRENCY_META[holding.code].flag + '</span>' +
            '<span class="globe-place">' + CURRENCY_HOMES[holding.code][2] + '<small>' + names + '</small>' +
                '<span class="globe-bar"><span style="width: ' + (holding.share * 100).toFixed(1) + '%;"></span></span>' +
            '</span>' +
            '<span class="globe-value">' + formatAmount(holding.native, holding.code, true) +
                (holding.code === activeCurrency ? '' : '<small>≈ ' + formatAmount(holding.value, activeCurrency, true) + '</small>') +
                '<small>' + (holding.share * 100).toFixed(1) + '%</small>' +
            '</span>' +
        '</button>';
    }).join('');
    renderExposure(holdings);
}

// What a currency move would do to your net worth, in the display currency. Holdings in the
// display currency don't change when measured in that currency, so they aren't offered.
function renderExposure(holdings) {
    const others = holdings.filter(h => h.code !== activeCurrency);
    document.getElementById('exposure-card').hidden = !holdings.length;
    document.getElementById('exposure-controls').hidden = !others.length;
    if (!others.length) {
        document.getElementById('exposure-result').innerText = 'All your money is in ' + activeCurrency + ', so exchange rates can\'t change your net worth in ' + activeCurrency + '.';
        return;
    }
    if (!others.some(h => h.code === exposureCurrency)) exposureCurrency = others[0].code;
    const selected = others.find(h => h.code === exposureCurrency);
    document.getElementById('exposure-currency').innerHTML = others.map(h =>
        '<option value="' + h.code + '"' + (h.code === exposureCurrency ? ' selected' : '') + '>' + CURRENCY_META[h.code].flag + ' ' + h.code + '</option>'
    ).join('');
    document.getElementById('exposure-move').value = exposureMove;
    document.getElementById('exposure-move-label').innerText = (exposureMove > 0 ? '+' : '') + exposureMove + '%';

    // A debt in the same currency cancels out part of the effect, so it's counted here
    const owed = ACCOUNTS.filter(a => isDebt(a) && a.currency === exposureCurrency)
        .reduce((sum, a) => sum + convertFromBase(convertToBase(a.balance, a.currency), activeCurrency), 0);
    const change = (selected.value + owed) * exposureMove / 100;
    const meta = CURRENCY_META[activeCurrency];
    document.getElementById('exposure-result').innerText = !exposureMove ? 'Move the slider to see what would happen.'
        : 'If ' + exposureCurrency + ' ' + (exposureMove < 0 ? 'falls ' : 'rises ') + Math.abs(exposureMove) + '%, your net worth would ' + (change < 0 ? 'drop ' : 'grow ') +
          'by ' + meta.symbol + Math.round(Math.abs(change)).toLocaleString('en-US') + ' ' + activeCurrency + '.';
}

function setExposureCurrency(code) {
    exposureCurrency = code;
    renderExposure(getHoldings());
}

function setExposureMove(value) {
    exposureMove = Number(value);
    renderExposure(getHoldings());
}
