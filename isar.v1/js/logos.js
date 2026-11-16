// logos.js — bank icons: the bank's real logo, simplified to one off-white shape on a tile in
// the bank's signature colour, so every bank looks the same "Isar style".
//
// How a logo is made (once per bank, then saved on this device):
//   1. download the logo: from the bank provider when it supplies one (`logoUrl`, e.g. Enable
//      Banking's for European banks), otherwise from logo.dev by the bank's website (`domain`)
//   2. remove its background and redraw the logo itself in off-white (knockOutLogo)
//   3. crop it and centre it at the same size and padding as every other logo
// Until a logo is ready (or if it can't be made), the tile shows the bank's first letter instead.
// Later an open-banking provider can supply the logo address; bankIconHTML stays the same.

// Paste the logo.dev "publishable key" here (logo.dev -> sign up -> API keys). Publishable keys
// are made to sit inside an app, so it's fine in this file. Empty = letter tiles only.
const LOGO_DEV_TOKEN = 'pk_Eq7NLH3GSVCg6V_4dqF98A';

const LOGO_CACHE_KEY = 'isar.logos.v1';
const LOGO_SIZE = 96;                          // finished logo images are 96x96 (sharp at 2-3x)
const LOGO_FILL = 0.58;                        // the logo fills 58% of the tile, like every other

// A logo's "key" is the bank's website (logo.dev) or the full https address of its logo.
const logoCache = loadLogoCache();             // key -> finished image (data: URL)
const logoPending = {};                        // key -> true while being made
const logoFailed = {};                         // key -> true if it couldn't be made (this session)

function loadLogoCache() {
    try { return JSON.parse(localStorage.getItem(LOGO_CACHE_KEY)) || {}; } catch (e) { return {}; }
}

function saveLogoCache() {
    try { localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(logoCache)); } catch (e) {}
}

// The website of a bank or account: its own `domain`, or the matching bank in topBanks.
function logoDomainFor(item) {
    if (item.domain) return item.domain;
    const bank = bankForIcon(item);
    return bank ? bank.domain : null;
}

function bankForIcon(item) {
    return topBanks.find(b => b.name === (item.bankName || item.name));
}

// True if a colour is so light that an off-white logo wouldn't show up on it.
function isLightColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    const n = parseInt(m[1], 16);
    const luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return luminance > 0.68;
}

// The icon for a bank or account (anything with name + color, and optionally logoUrl / domain / bankName).
// A bank with a `monogram` (no logo of its own) uses those letters and its own colour.
function bankIconHTML(item, size) {
    const bank = bankForIcon(item);
    const monogram = bank && bank.monogram;
    const color = monogram ? bank.color : item.color;
    const logoKey = monogram ? null : (item.logoUrl || logoDomainFor(item));
    const light = isLightColor(color);
    const letter = monogram || escapeHTML(Array.from(item.name || '?')[0].toUpperCase());
    const kind = !item.domain && MANUAL_KINDS[item.kind];      // property, loans etc. use a line icon
    const logo = logoKey && logoCache[logoKey];
    if (logoKey && !logo) requestLogo(logoKey);
    return '<div class="bank-icon' + (light ? ' light' : '') + '"' + (logoKey ? ' data-logo-key="' + escapeHTML(logoKey) + '"' : '') +
        ' style="width: ' + size + 'px; height: ' + size + 'px; border-radius: ' + Math.round(size * 0.3) + 'px; background: ' + color + '; font-size: ' + Math.round(size * (monogram ? 0.34 : 0.42)) + 'px;">' +
        (logo ? '<img src="' + logo + '" alt="">' : kind ? kindIconHTML(kind.icon) : letter) +
    '</div>';
}

// Starts making a logo in the background; when it's ready, every tile showing that bank updates.
function requestLogo(key) {
    const direct = key.startsWith('https://');
    if ((!direct && !LOGO_DEV_TOKEN) || logoPending[key] || logoFailed[key]) return;
    logoPending[key] = true;
    makeLogo(direct ? key : 'https://img.logo.dev/' + encodeURIComponent(key) + '?token=' + LOGO_DEV_TOKEN + '&size=128&format=png&fallback=404').then(dataUrl => {
        delete logoPending[key];
        if (!dataUrl) { logoFailed[key] = true; return; }
        logoCache[key] = dataUrl;
        saveLogoCache();
        document.querySelectorAll('[data-logo-key="' + CSS.escape(key) + '"]').forEach(el => {
            el.innerHTML = '<img src="' + dataUrl + '" alt="">';
        });
    });
}

function makeLogo(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';          // needed to read the pixels (logo.dev and Enable Banking allow it)
        img.onload = () => {
            try { resolve(knockOutLogo(img)); } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

// Turns a logo picture into a single-colour (off-white) logo on a transparent background,
// cropped and centred. Returns a data: URL, or null if the picture doesn't look like a logo.
function knockOutLogo(img) {
    const N = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const ctx = canvas.getContext('2d');
    // Keep the logo's own shape: wide wordmarks (most bank providers' logos) aren't squashed.
    const aspect = img.naturalWidth / img.naturalHeight || 1;
    const dw = Math.round(aspect >= 1 ? N : N * aspect), dh = Math.round(aspect >= 1 ? N / aspect : N);
    const dx = Math.floor((N - dw) / 2), dy = Math.floor((N - dh) / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
    const image = ctx.getImageData(0, 0, N, N), px = image.data;

    // The background, judged from the logo's whole edge (tightly cropped wordmarks can touch a
    // corner, so single corner pixels mislead). Mostly see-through edge: no background. Otherwise
    // it's the average colour of the solid edge pixels (rounded app-icon logos are see-through
    // only at the corners).
    let edgeCount = 0, edgeSolid = 0, r = 0, g = 0, b = 0;
    const edgePixel = (x, y) => {
        const i = (y * N + x) * 4;
        edgeCount++;
        if (px[i + 3] >= 40) { edgeSolid++; r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    };
    for (let x = dx; x < dx + dw; x++) { edgePixel(x, dy); edgePixel(x, dy + dh - 1); }
    for (let y = dy + 1; y < dy + dh - 1; y++) { edgePixel(dx, y); edgePixel(dx + dw - 1, y); }
    const transparentBg = edgeSolid < edgeCount * 0.5;
    const bg = { r: r / edgeSolid, g: g / edgeSolid, b: b / edgeSolid };

    // Each pixel becomes off-white, as solid as it is different from the background.
    let solid = 0, minX = N, minY = N, maxX = -1, maxY = -1;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const i = (y * N + x) * 4, alpha = px[i + 3] / 255;
            let strength = alpha;
            if (!transparentBg) {
                const d = Math.hypot(px[i] - bg.r, px[i + 1] - bg.g, px[i + 2] - bg.b) / 441;
                strength = alpha * Math.min(1, Math.max(0, (d - 0.12) / 0.22));
            }
            px[i] = px[i + 1] = px[i + 2] = 255;
            px[i + 3] = Math.round(strength * 255);
            if (strength > 0.3) {
                solid++;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
    }
    // Nothing left, or almost everything solid (no real background to remove): not usable.
    if (maxX < 0 || solid > dw * dh * 0.6) return null;
    ctx.putImageData(image, 0, 0);

    // Crop to the logo and centre it at the standard size. Wide wordmarks get more of the
    // width, or their letters would be too small to read.
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const scale = (LOGO_SIZE * (w > h * 2 ? 0.84 : LOGO_FILL)) / Math.max(w, h);
    const out = document.createElement('canvas');
    out.width = out.height = LOGO_SIZE;
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(canvas, minX, minY, w, h, (LOGO_SIZE - w * scale) / 2, (LOGO_SIZE - h * scale) / 2, w * scale, h * scale);
    return out.toDataURL('image/png');
}
