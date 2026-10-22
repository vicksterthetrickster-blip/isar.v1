// rates.js — currency conversion, live exchange rates, net worth card and currency menu.

function convertFromBase(amountAUD, code) {
    return amountAUD * EXCHANGE_RATES[code];
}

function convertToBase(amount, sourceCurrency) {
    return amount / EXCHANGE_RATES[sourceCurrency];
}

function getPortfolioTotalAUD() {
    return ACCOUNTS.reduce((total, account) => {
        return total + convertToBase(account.balance, account.currency);
    }, 0);
}

function getPortfolioTotal(code) {
    return convertFromBase(getPortfolioTotalAUD(), code);
}

// "21 Sep, 4:43 PM": the date and time of a refresh, in the user's own timezone.
function formatRefreshStamp(d) {
    return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// "Fri 18 Sep": the date the ECB published a set of rates.
function formatRateDate(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) + ' ' + d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()];
}

function localISODate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Re-runs a CSS animation by removing and re-adding its class.
function restartAnimation(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
}

// Two lines under the currency list:
//   line 1: WHEN this app last refreshed (today's date and time)
//   line 2: which ECB fixing those rates are from (can be an earlier working day)
function updateRatesStatus() {
    const main = document.getElementById('rates-status-text');
    const sub = document.getElementById('rates-status-sub');
    if (!main || !sub) return;

    if (ratesAreLive && !ratesLastFetchFailed) {
        main.innerText = 'Updated ' + formatRefreshStamp(ratesUpdatedAt);
        main.style.color = '#00FF85';
        sub.innerText = 'ECB fixing: ' + (ratesAsOf === localISODate(new Date()) ? 'today' : formatRateDate(ratesAsOf));
    } else if (ratesAreLive) {
        main.innerText = 'Couldn\u2019t refresh \u00b7 using last rates';
        main.style.color = '#71717A';
        sub.innerText = 'ECB fixing: ' + formatRateDate(ratesAsOf) + ' \u00b7 tap \u27f3 to retry';
    } else {
        main.innerText = 'Offline \u00b7 fallback rates';
        main.style.color = '#71717A';
        sub.innerText = 'Couldn\u2019t reach the rate service \u00b7 tap \u27f3';
    }
    restartAnimation(document.getElementById('rates-status'), 'status-swap');
}

// Spinner + pulsing text while a refresh is in flight.
function setRatesRefreshingUI(on) {
    const btn = document.getElementById('rates-refresh-btn');
    const main = document.getElementById('rates-status-text');
    const sub = document.getElementById('rates-status-sub');
    if (btn) btn.classList.toggle('refreshing', on);
    if (!main || !sub) return;
    if (on) {
        main.innerText = 'Refreshing rates\u2026';
        main.style.color = '#71717A';
        main.classList.add('pulsing');
        sub.innerText = 'Fetching the latest ECB rates';
    } else {
        main.classList.remove('pulsing');
    }
}

// Numbers ease in after a successful manual refresh.
function playRefreshAnimations() {
    ['balance-display', 'balance-subtext', 'curr-items'].forEach(id => restartAnimation(document.getElementById(id), 'value-refresh'));
}

// Frankfurter serves the European Central Bank's daily reference rates (free, no key).
// The ECB publishes once per working day (~16:00 CET), so the newest rates can be
// from an earlier day than today. The second address is the older host, kept as a backup.
const RATE_SOURCES = [
    targets => 'https://api.frankfurter.dev/v1/latest?base=' + BASE_CURRENCY + '&symbols=' + targets,
    targets => 'https://api.frankfurter.app/latest?from=' + BASE_CURRENCY + '&to=' + targets
];
const RATE_TIMEOUT_MS = 8000;     // give up on a request after this long
const MIN_REFRESH_MS = 1200;      // a manual refresh always animates at least this long

async function fetchRatesFromAnySource() {
    const targets = Object.keys(EXCHANGE_RATES).filter(c => c !== BASE_CURRENCY).join(',');
    let lastError = new Error('No rate source available');
    for (const buildUrl of RATE_SOURCES) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), RATE_TIMEOUT_MS);
        try {
            const response = await fetch(buildUrl(targets), { signal: controller.signal });
            if (!response.ok) throw new Error('Rate request failed: ' + response.status);
            const data = await response.json();
            if (!data || !data.rates || !data.date) throw new Error('Unexpected rate response');
            return data;
        } catch (err) {
            lastError = err;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError;
}

// `manual` is true when the user taps the refresh button.
async function fetchLiveRates(manual) {
    if (ratesRefreshing) return;
    ratesRefreshing = true;
    setRatesRefreshingUI(true);
    const started = Date.now();
    let succeeded = false;

    try {
        const data = await fetchRatesFromAnySource();
        Object.keys(data.rates).forEach(code => {
            if (code in EXCHANGE_RATES && data.rates[code] > 0) EXCHANGE_RATES[code] = data.rates[code];
        });
        ratesAreLive = true;
        ratesLastFetchFailed = false;
        ratesAsOf = data.date;
        ratesUpdatedAt = new Date();
        succeeded = true;
    } catch (err) {
        // Network unavailable, blocked, or API down: keep using the last known rates.
        console.warn('Live FX fetch failed, using last known rates.', err);
        ratesLastFetchFailed = true;
    }

    // Keep the spinner up long enough to read as a deliberate refresh.
    if (manual) {
        const wait = MIN_REFRESH_MS - (Date.now() - started);
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    }

    ratesRefreshing = false;
    setRatesRefreshingUI(false);
    renderPortfolioValue();
    renderGraph();
    refreshAccountViews();
    renderCurrencyMenu();
    updateRatesStatus();
    if (manual && succeeded) playRefreshAnimations();
}

function formatMoney(value) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toggleCurrencyMenu() {
    document.getElementById('curr-menu').classList.toggle('open');
}

// Every menu value is the sum of all account balances, converted from each
// native currency using the most recently fetched FX rates.
function renderCurrencyMenu() {
    const container = document.getElementById('curr-items');
    container.innerHTML = Object.keys(EXCHANGE_RATES).map(code => {
        const meta = CURRENCY_META[code];
        const value = getPortfolioTotal(code);
        const activeClass = code === activeCurrency ? ' active' : '';
        return `<button class="dropdown-item${activeClass}" onclick="selectCurrency('${code}')">` +
               `<span>${meta.flag} ${code}</span>` +
               `<span style="color:#71717A">${meta.symbol}${Math.round(value).toLocaleString('en-US')}</span>` +
               `</button>`;
    }).join('');
}

function selectCurrency(code) {
    if (!CURRENCY_META[code]) code = BASE_CURRENCY;
    activeCurrency = code;
    if (SAVED.displayCurrency !== code) { SAVED.displayCurrency = code; saveData(); }
    renderPortfolioValue();
    renderGraph();
    refreshAccountViews();
    renderCurrencyMenu();
    document.getElementById('curr-menu').classList.remove('open');
}

function renderPortfolioValue() {
    const code = activeCurrency;
    const meta = CURRENCY_META[code];
    const sub = document.getElementById('balance-subtext');

    document.getElementById('curr-label').innerText = code + ' ' + meta.flag;
    document.getElementById('balance-display').innerText = meta.symbol + formatMoney(getPortfolioTotal(code));

    // Change over the past month, worked out from the history records.
    const change = getPastMonthChange(code);
    if (!change) { sub.innerText = ''; return; }
    const up = change.amount >= 0;
    sub.style.color = up ? '#00FF85' : '#FF4D6D';
    sub.innerText = (up ? '↑ +' : '↓ −') + Math.abs(change.pct).toFixed(1) + '% (' +
        (up ? '+' : '−') + meta.symbol + formatMoney(Math.abs(change.amount)) + ' ' + code + ') past month';
}
