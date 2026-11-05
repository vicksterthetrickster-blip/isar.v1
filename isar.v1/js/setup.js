// setup.js — first-run setup after creating an account, in 3 steps:
//   1. home currency   2. add your first accounts   3. "you're all set"
// Shown once per person; finishing it sets SAVED.setupDone. Not shown in the demo.
// Step 2 uses the same linking flow as the Connect tab, so when real bank connections
// arrive, they appear here automatically.

// Device region -> currency, to pre-select a sensible home currency (e.g. en-AU -> AUD).
const REGION_CURRENCY = {
    AU: 'AUD', US: 'USD', GB: 'GBP', NZ: 'NZD', CA: 'CAD', JP: 'JPY', SG: 'SGD', HK: 'HKD', CN: 'CNY',
    IN: 'INR', KR: 'KRW', ID: 'IDR', MY: 'MYR', PH: 'PHP', TH: 'THB', CH: 'CHF', SE: 'SEK', NO: 'NOK',
    DK: 'DKK', IS: 'ISK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY', IL: 'ILS', ZA: 'ZAR',
    MX: 'MXN', BR: 'BRL', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR',
    AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR', BG: 'EUR', HR: 'EUR'
};
const SETUP_STEPS = ['setup-currency', 'setup-accounts', 'setup-done'];
let setupCurrency = BASE_CURRENCY;        // the currency picked in step 1

function guessHomeCurrency() {
    const languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (const lang of languages) {
        const region = (lang.split('-')[1] || '').toUpperCase();
        if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    }
    return BASE_CURRENCY;
}

function needsSetup() {
    const session = getSession();
    return !!session && !session.demo && !SAVED.setupDone;
}

function isSetupOpen() {
    return !document.getElementById('setup-screen').hidden;
}

function showSetup() {
    setupCurrency = SAVED.displayCurrency || guessHomeCurrency();
    document.getElementById('setup-screen').hidden = false;
    showSetupStep(1);
}

function showSetupStep(n) {
    SETUP_STEPS.forEach((id, i) => { document.getElementById(id).hidden = i !== n - 1; });
    document.querySelectorAll('.setup-progress span').forEach((dot, i) => dot.classList.toggle('active', i === n - 1));
    if (n === 1) { document.getElementById('setup-currency-search').value = ''; renderSetupCurrencies(); }
    if (n === 2) { document.getElementById('setup-bank-search').value = ''; refreshSetup(); }
    if (n === 3) renderSetupDone();
}

// --- Step 1: home currency ---
function renderSetupCurrencies() {
    const query = document.getElementById('setup-currency-search').value.trim().toLowerCase();
    const list = CURRENCIES.filter(c => !query || c.code.toLowerCase().includes(query) || c.name.toLowerCase().includes(query));
    document.getElementById('setup-currency-list').innerHTML = list.map(c =>
        '<button class="setup-item' + (c.code === setupCurrency ? ' selected' : '') + '" onclick="pickSetupCurrency(\'' + c.code + '\')">' +
            '<span class="setup-flag">' + c.flag + '</span>' +
            '<span class="setup-item-name">' + c.name + '<small>' + c.code + '</small></span>' +
            '<span class="setup-tick">✓</span>' +
        '</button>'
    ).join('') || '<div class="setup-empty">No currency matches</div>';
}

function pickSetupCurrency(code) {
    setupCurrency = code;
    renderSetupCurrencies();
}

function confirmSetupCurrency() {
    selectCurrency(setupCurrency);            // saves it as the display currency
    showSetupStep(2);
}

// --- Step 2: add accounts ---
// Redraws the accounts added so far and the bank list. Called after every account change
// (refreshAfterAccountChange), and does nothing while setup isn't open.
function refreshSetup() {
    if (!isSetupOpen()) return;
    const added = ACCOUNTS.filter(a => a.userLinked);
    document.getElementById('setup-added').innerHTML = added.map(a =>
        '<div class="setup-item added">' + bankBadgeHTML({ name: a.name, color: a.color }, 32) +
            '<span class="setup-item-name">' + escapeHTML(a.name) + '<small>' + formatAccountBalance(a) + '</small></span>' +
            '<span class="setup-tick">✓</span>' +
        '</div>'
    ).join('');
    document.getElementById('setup-continue').hidden = !added.length;
    document.getElementById('setup-skip').innerText = added.length ? 'I\'ll add more later' : 'Skip for now';
    renderSetupBanks();
}

function renderSetupBanks() {
    const query = document.getElementById('setup-bank-search').value.trim().toLowerCase();
    const banks = query ? searchBanks(query) : suggestedBanksFor(activeCurrency, 5);
    document.getElementById('setup-banks-label').innerText = query ? 'Results' : 'Popular banks';
    document.getElementById('setup-bank-list').innerHTML = banks.map(b => {
        const linked = isBankLinked(b.name);
        return '<button class="setup-item" onclick="promptConnect(' + topBanks.indexOf(b) + ')">' + bankBadgeHTML(b, 32) +
            '<span class="setup-item-name">' + (query ? highlightBankName(b.name, query) : escapeHTML(b.name)) + '</span>' +
            '<span class="setup-add' + (linked ? ' done' : '') + '">' + (linked ? 'Added ✓' : 'Add') + '</span>' +
        '</button>';
    }).join('') || '<div class="setup-empty">No banks match your search</div>';
}

// --- Step 3: done ---
function renderSetupDone() {
    const count = ACCOUNTS.filter(a => a.userLinked).length;
    const meta = CURRENCY_META[activeCurrency];
    document.getElementById('setup-summary').innerText = count
        ? 'Your net worth across ' + count + (count === 1 ? ' account' : ' accounts') + ':'
        : 'You can add accounts any time from the Connect tab.';
    const total = document.getElementById('setup-networth');
    total.hidden = !count;
    total.innerText = meta.symbol + formatMoney(getPortfolioTotal(activeCurrency)) + ' ' + activeCurrency;
}

function finishSetup() {
    SAVED.setupDone = true;
    saveData();
    const screen = document.getElementById('setup-screen');
    screen.classList.add('leaving');
    setTimeout(() => { screen.hidden = true; screen.classList.remove('leaving'); }, 300);
}
