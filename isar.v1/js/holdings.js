// holdings.js — what's inside an investment account: shares, ETFs, funds, crypto and cash.
//
// An account with holdings works out its own balance: each holding's quantity × price,
// converted into the account's currency, added up. Net worth, the graph and the daily snapshots
// keep working exactly as before, because they only read the balance.
// An account without holdings (e.g. a super fund that only reports a total) works as before.
//
// One holding:
//   { id, symbol: 'VAS', name, kind: 'etf' | 'stock' | 'fund' | 'crypto' | 'cash',
//     quantity, price (per unit, in `currency`), currency,
//     costBasis (optional: the total you paid, in `currency`),
//     coinId (crypto only: CoinGecko's name for the coin),
//     priceSource, priceAsOf (when the price was last updated, ISO time) }
//
// Where prices come from (priceSource):
//   'sample'     the demo's fixed prices, so the demo never jumps around
//   'you'        typed in by you (shares, ETFs and funds, until the server can price them)
//   'coingecko'  live crypto prices, fetched straight from the app (free, no key needed)
//   'server'     live share prices from Isar's server          (step 4: ready, switched off)
//   'provider'   holdings synced from your broker or exchange  (step 3: ready, switched off)

const HOLDING_KINDS = {
    etf:    { label: 'ETF',    plural: 'ETFs',   color: '#5B8DEF' },
    stock:  { label: 'Share',  plural: 'Shares', color: '#2EC4B6' },
    fund:   { label: 'Fund',   plural: 'Funds',  color: '#A78BFA' },
    crypto: { label: 'Crypto', plural: 'Crypto', color: '#F2A93B' },
    cash:   { label: 'Cash',   plural: 'Cash',   color: '#71717A' }
};

// Coins you can add by hand: [symbol, name, CoinGecko id].
const POPULAR_COINS = [
    ['BTC', 'Bitcoin', 'bitcoin'], ['ETH', 'Ethereum', 'ethereum'], ['SOL', 'Solana', 'solana'],
    ['XRP', 'XRP', 'ripple'], ['BNB', 'BNB', 'binancecoin'], ['ADA', 'Cardano', 'cardano'],
    ['DOGE', 'Dogecoin', 'dogecoin'], ['TRX', 'TRON', 'tron'], ['AVAX', 'Avalanche', 'avalanche-2'],
    ['LINK', 'Chainlink', 'chainlink'], ['DOT', 'Polkadot', 'polkadot'], ['LTC', 'Litecoin', 'litecoin'],
    ['XLM', 'Stellar', 'stellar'], ['TON', 'Toncoin', 'the-open-network'], ['SHIB', 'Shiba Inu', 'shiba-inu'],
    ['CRO', 'Cronos', 'crypto-com-chain'], ['USDT', 'Tether', 'tether'], ['USDC', 'USD Coin', 'usd-coin']
];

const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';

// THE SWITCH FOR STEPS 3 AND 4. Isar's server isn't built yet, so this is empty and both are off.
// Once the server exists, put its address here (e.g. 'https://isar.vercel.app/api') and
// broker sync (fetchProviderHoldings) and live share prices (fetchSharePrices) turn on.
const ISAR_SERVER_URL = null;

let holdingFormFirst = false;     // true while adding an account's first holding
let editingHoldingId = null;      // the holding the edit form is changing


// --- Values ---
function hasHoldings(account) {
    return Array.isArray(account.holdings) && account.holdings.length > 0;
}

// In the holding's own currency
function holdingValue(holding) {
    return holding.quantity * holding.price;
}

function holdingValueIn(holding, code) {
    return convertFromBase(convertToBase(holdingValue(holding), holding.currency), code);
}

// What it's gained since you bought it, in its own currency. Null when the cost isn't known.
function holdingGain(holding) {
    if (holding.kind === 'cash' || !(holding.costBasis > 0)) return null;
    const amount = holdingValue(holding) - holding.costBasis;
    return { amount: amount, pct: amount / holding.costBasis * 100 };
}

// Saved data can be old or edited by hand, so anything incomplete is dropped.
function isValidHolding(h) {
    return !!h && typeof h.id === 'string' && typeof h.symbol === 'string' && !!HOLDING_KINDS[h.kind] &&
        !!CURRENCY_META[h.currency] && Number.isFinite(h.quantity) && h.quantity >= 0 &&
        Number.isFinite(h.price) && h.price >= 0;
}

// Sets each account's balance to the total of its holdings, at today's prices and exchange rates.
// Your own accounts also note the new value in their history (one entry per day).
function revalueHoldings() {
    let changed = false;
    ACCOUNTS.forEach(account => {
        if (!Array.isArray(account.holdings)) return;
        account.holdings = account.holdings.filter(isValidHolding);
        if (!account.holdings.length) return;
        const total = Math.round(account.holdings.reduce((sum, h) => sum + holdingValueIn(h, account.currency), 0) * 100) / 100;
        if (total === account.balance) return;
        account.balance = total;
        if (account.userLinked) { recordBalanceToday(account); changed = true; }
    });
    if (changed) saveLinkedAccounts();
}

// Same as typing a new balance: today's entry is updated, or added if there isn't one yet.
function recordBalanceToday(account) {
    if (!Array.isArray(account.history)) return;
    const today = localISODate(new Date());
    const last = account.history[account.history.length - 1];
    if (last && last.date === today) Object.assign(last, { balance: account.balance, time: currentTimeHHMM() });
    else account.history.push({ date: today, time: currentTimeHHMM(), balance: account.balance });
}

// Holdings in your own accounts (the sample ones keep their fixed prices)
function userHoldings() {
    return ACCOUNTS.filter(a => a.userLinked && hasHoldings(a)).flatMap(a => a.holdings);
}


// --- Live prices ---
// Runs on start-up and every 5 minutes (main.js). Redraws only if something changed.
async function refreshHoldingPrices() {
    const results = await Promise.all([fetchProviderHoldings(), fetchCryptoPrices(), fetchSharePrices()]);
    if (!results.some(Boolean)) return;
    revalueHoldings();
    saveLinkedAccounts();
    refreshAfterAccountChange();
    if (openAccountId) renderAccountDetail();
}

// Step 2: CoinGecko's free price list. Returns { bitcoin: 101234.5, ... } in USD, or null.
async function fetchCoinPricesUSD(coinIds) {
    try {
        const response = await fetch(COINGECKO_PRICE_URL + '?ids=' + coinIds.map(encodeURIComponent).join(',') + '&vs_currencies=usd', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const prices = {};
        coinIds.forEach(id => { if (data[id] && data[id].usd > 0) prices[id] = data[id].usd; });
        return prices;
    } catch (e) {
        console.warn('Crypto prices could not be fetched; using the last saved prices.', e);
        return null;
    }
}

async function fetchCryptoPrices() {
    const coins = [];
    userHoldings().forEach(h => {
        if (h.kind === 'crypto' && h.coinId && h.priceSource !== 'provider' && !coins.includes(h.coinId)) coins.push(h.coinId);
    });
    if (!coins.length) return false;
    const prices = await fetchCoinPricesUSD(coins);
    if (!prices) return false;
    const now = new Date().toISOString();
    let changed = false;
    userHoldings().forEach(h => {
        if (h.kind !== 'crypto' || h.priceSource === 'provider' || !prices[h.coinId]) return;
        Object.assign(h, { price: prices[h.coinId], currency: 'USD', priceSource: 'coingecko', priceAsOf: now });
        changed = true;
    });
    return changed;
}

// Step 3 (off until ISAR_SERVER_URL is set). The server reads each connected broker or exchange
// through a provider (Plaid Investments, SnapTrade, an exchange's read-only key...) and replies
// in the shape Isar already uses, so nothing else has to change:
//   { accounts: [{ id: 'linked-abc', holdings: [{ symbol, name, kind, quantity, price, currency, costBasis }] }] }
// (With Supabase sign-in, the request will also carry the person's sign-in token.)
async function fetchProviderHoldings() {
    if (!ISAR_SERVER_URL) return false;
    try {
        const response = await fetch(ISAR_SERVER_URL + '/holdings', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const now = new Date().toISOString();
        let changed = false;
        (Array.isArray(data.accounts) ? data.accounts : []).forEach(synced => {
            const account = ACCOUNTS.find(a => a.userLinked && a.id === synced.id);
            if (!account || !Array.isArray(synced.holdings)) return;
            account.holdings = synced.holdings
                .map((h, i) => Object.assign({}, h, { id: 'p-' + account.id + '-' + i, priceSource: 'provider', priceAsOf: now }))
                .filter(isValidHolding);
            account.holdingsSource = 'provider';
            changed = true;
        });
        return changed;
    } catch (e) {
        console.warn('Broker holdings could not be synced; showing the last saved ones.', e);
        return false;
    }
}

// Step 4 (off until ISAR_SERVER_URL is set). Live share and ETF prices need a paid data service
// with a secret key, so the app asks Isar's server, which keeps the key safe. Expected reply:
//   { prices: { VAS: { price: 104.2, currency: 'AUD' }, AAPL: { price: 262.1, currency: 'USD' } } }
async function fetchSharePrices() {
    if (!ISAR_SERVER_URL) return false;
    const priced = h => h.kind !== 'crypto' && h.kind !== 'cash' && h.priceSource !== 'provider';
    const symbols = [];
    userHoldings().forEach(h => { if (priced(h) && !symbols.includes(h.symbol)) symbols.push(h.symbol); });
    if (!symbols.length) return false;
    try {
        const response = await fetch(ISAR_SERVER_URL + '/prices?symbols=' + encodeURIComponent(symbols.join(',')), { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const now = new Date().toISOString();
        let changed = false;
        userHoldings().forEach(h => {
            const quote = priced(h) && data.prices && data.prices[h.symbol];
            if (!quote || !(quote.price > 0) || !CURRENCY_META[quote.currency]) return;
            Object.assign(h, { price: quote.price, currency: quote.currency, priceSource: 'server', priceAsOf: now });
            changed = true;
        });
        return changed;
    } catch (e) {
        console.warn('Share prices could not be fetched; using the last saved prices.', e);
        return false;
    }
}


// --- Formatting ---
function formatQuantity(quantity) {
    return quantity.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

// Prices under 1 (small coins) keep more decimals: "$0.1234 USD"
function formatHoldingPrice(price, code) {
    return CURRENCY_META[code].symbol + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: price < 1 ? 4 : 2 }) + ' ' + code;
}

function formatGainPct(gain) {
    return (gain.pct >= 0 ? '▲ ' : '▼ ') + Math.abs(gain.pct).toFixed(1) + '%';
}

function priceSourceText(holding) {
    const source = { sample: 'Sample price', you: 'Typed in by you', coingecko: 'CoinGecko, live', server: 'Live market price', provider: 'Your broker' }[holding.priceSource] || 'Unknown';
    if (!holding.priceAsOf) return source;
    const d = new Date(holding.priceAsOf);
    if (isNaN(d)) return source;
    return source + ' · ' + formatRateDate(localISODate(d)) + ', ' + formatTransactionTime(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
}

function holdingTileHTML(holding, large) {
    return '<span class="holding-tile' + (large ? ' large' : '') + '" style="color: ' + HOLDING_KINDS[holding.kind].color + ';">' + escapeHTML(holding.symbol.slice(0, 4)) + '</span>';
}


// --- The Holdings card on the account screen ---
function canEditHoldings(account) {
    return account.userLinked && accountGroup(account) === 'investments' && account.holdingsSource !== 'provider';
}

function renderAccountHoldings(account) {
    const el = document.getElementById('acct-holdings');
    const editable = canEditHoldings(account);
    el.hidden = !hasHoldings(account) && !editable;
    if (el.hidden) return;
    const addButton = editable ? '<button class="holdings-add interactive-btn" onclick="openAddHolding()">+ Add holding</button>' : '';

    if (!hasHoldings(account)) {
        el.innerHTML = '<div class="holdings-head"><span>Holdings</span></div>' +
            '<p class="holdings-empty">Add what this account holds (shares, ETFs, crypto) to see what each one is worth and how much it\'s gained. Crypto prices update live.</p>' +
            addButton;
        return;
    }

    // Values in the currency this account is being viewed in, largest first
    const code = acctViewCurrency;
    const rows = account.holdings.map(h => ({ holding: h, value: holdingValueIn(h, code) })).sort((a, b) => b.value - a.value);
    const total = rows.reduce((sum, r) => sum + r.value, 0);

    // How the account is split between ETFs, shares, crypto...
    const byKind = Object.keys(HOLDING_KINDS)
        .map(kind => ({ kind: kind, value: rows.filter(r => r.holding.kind === kind).reduce((sum, r) => sum + r.value, 0) }))
        .filter(k => k.value > 0);
    const share = value => total > 0 ? value / total * 100 : 0;

    el.innerHTML =
        '<div class="holdings-head"><span>Holdings · ' + rows.length + '</span><span>' + formatAmount(total, code, true) + '</span></div>' +
        (byKind.length > 1
            ? '<div class="alloc-bar">' + byKind.map(k => '<span style="flex-grow: ' + share(k.value).toFixed(2) + '; background: ' + HOLDING_KINDS[k.kind].color + ';"></span>').join('') + '</div>' +
              '<div class="alloc-legend">' + byKind.map(k => '<span><i style="background: ' + HOLDING_KINDS[k.kind].color + ';"></i>' + HOLDING_KINDS[k.kind].plural + ' ' + share(k.value).toFixed(0) + '%</span>').join('') + '</div>'
            : '') +
        '<div>' + rows.map(r => holdingRowHTML(r.holding, r.value, code, share(r.value))).join('') + '</div>' +
        addButton +
        '<div class="holdings-note">' + holdingsNote(account) + '</div>';
}

function holdingRowHTML(holding, value, code, sharePct) {
    const gain = holdingGain(holding);
    const detail = holding.kind === 'cash'
        ? 'Cash · ' + holding.currency
        : formatQuantity(holding.quantity) + ' × ' + formatHoldingPrice(holding.price, holding.currency);
    return '<button class="holding-row" onclick="openHolding(\'' + holding.id + '\')">' +
        holdingTileHTML(holding) +
        '<span class="holding-name"><span>' + escapeHTML(holding.name || holding.symbol) + '</span><small>' + detail + '</small></span>' +
        '<span class="holding-value">' + (holding.currency === code ? '' : '≈ ') + formatAmount(value, code, true) +
            (gain ? '<small class="' + (gain.pct >= 0 ? 'up' : 'down') + '">' + formatGainPct(gain) + '</small>' : '<small>' + sharePct.toFixed(1) + '%</small>') +
        '</span>' +
    '</button>';
}

function holdingsNote(account) {
    if (account.holdingsSource === 'provider') return 'Synced from ' + escapeHTML(account.name) + '.';
    if (!account.userLinked) return 'Sample holdings with fixed sample prices, for the demo.';
    const kinds = account.holdings.map(h => h.kind);
    const notes = [];
    if (kinds.includes('crypto')) notes.push('Crypto prices update live from CoinGecko.');
    if (kinds.some(k => k === 'etf' || k === 'stock' || k === 'fund')) notes.push('Share, ETF and fund prices are the ones you typed in. Tap one to update it. Live share prices come with Isar\'s server.');
    return notes.join(' ');
}


// --- One holding, opened by tapping it ---
function findOpenHolding(id) {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    const holding = account && hasHoldings(account) && account.holdings.find(h => h.id === id);
    return holding ? { account: account, holding: holding } : null;
}

function openHolding(id) {
    const found = findOpenHolding(id);
    if (!found) return;
    const { account, holding } = found;
    const gain = holdingGain(holding);
    const cash = holding.kind === 'cash';
    const share = account.balance > 0 ? holdingValueIn(holding, account.currency) / account.balance * 100 : 0;
    const gainSign = gain && gain.amount >= 0 ? '+' : '';

    openInfoScreen(holding.symbol,
        '<div class="tx-hero">' +
            holdingTileHTML(holding, true) +
            '<strong>' + formatAmount(holdingValue(holding), holding.currency, true) + '</strong>' +
            '<span>' + escapeHTML(holding.name || holding.symbol) + '</span>' +
        '</div>' +
        '<div class="settings-group">' +
            infoRowHTML('Type', HOLDING_KINDS[holding.kind].label) +
            (cash ? '' : infoRowHTML('Quantity', formatQuantity(holding.quantity))) +
            (cash ? '' : infoRowHTML('Price', formatHoldingPrice(holding.price, holding.currency))) +
            (cash ? '' : infoRowHTML('Price from', priceSourceText(holding))) +
            (holding.currency === account.currency ? '' : infoRowHTML('In ' + account.currency, '≈ ' + formatAmount(holdingValueIn(holding, account.currency), account.currency, true))) +
            infoRowHTML('Share of account', share.toFixed(1) + '%') +
            infoRowHTML('Account', account.name) +
        '</div>' +
        (gain
            ? '<div><div class="section-label">Since you bought it</div><div class="settings-group">' +
                infoRowHTML('You paid', formatAmount(holding.costBasis, holding.currency, true)) +
                infoRowHTML('Gain', gainSign + formatAmount(gain.amount, holding.currency, true) + ' (' + gainSign + gain.pct.toFixed(1) + '%)') +
              '</div></div>'
            : '') +
        (canEditHoldings(account)
            ? '<div style="display: flex; gap: 8px;">' +
                '<button class="interactive-btn" onclick="openEditHolding(\'' + holding.id + '\')" style="' + ACCT_BTN_STYLE + 'background: #00FF85; color: #000; border: none;">Edit</button>' +
                '<button class="interactive-btn" onclick="removeHolding(\'' + holding.id + '\')" style="' + ACCT_BTN_STYLE + 'background: #18181B; color: #FF4D6D; border: 1px solid #27272A;">Remove</button>' +
              '</div>'
            : '') +
        (account.userLinked ? '' : '<p class="info-note">Sample holding for the demo.</p>'));
}


// --- Adding, editing and removing holdings (your own investment accounts only) ---
function openAddHolding() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    if (!account) return;
    holdingFormFirst = !hasHoldings(account);
    showAccountForm('Add a holding',
        '<label class="form-label">What is it?<select id="holding-kind" class="form-select" onchange="renderHoldingFields()">' +
            '<option value="crypto">Crypto</option><option value="etf">ETF</option><option value="stock">Share</option>' +
            '<option value="fund">Fund</option><option value="cash">Cash</option>' +
        '</select></label>' +
        '<div id="holding-fields" class="holding-fields"></div>' +
        (holdingFormFirst && account.balance > 0
            ? '<p class="form-note">The current balance of ' + formatAccountBalance(account) + ' becomes a "Cash and other" line, so the total stays the same. You can edit or remove it afterwards.</p>'
            : ''),
        'saveHolding()');
    renderHoldingFields();
}

// The fields change with the kind of holding chosen.
function renderHoldingFields() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    const kind = document.getElementById('holding-kind').value;
    const currencySelect = '<label class="form-label">Currency<select id="holding-currency" class="form-select">' + currencyOptionsHTML(account.currency) + '</select></label>';
    let html;
    if (kind === 'crypto') {
        html = '<label class="form-label">Coin<select id="holding-coin" class="form-select">' +
                POPULAR_COINS.map(c => '<option value="' + c[2] + '">' + c[0] + ' · ' + c[1] + '</option>').join('') +
            '</select></label>' +
            formInputHTML('holding-qty', 'How many coins', '', 'number') +
            formInputHTML('holding-cost', 'Total you paid, in USD (optional)', '', 'number');
    } else if (kind === 'cash') {
        html = formInputHTML('holding-qty', 'Amount', '', 'number') + currencySelect;
    } else {
        html = formInputHTML('holding-symbol', 'Ticker (e.g. VAS, AAPL)', '') +
            formInputHTML('holding-name', 'Name (optional)', '') +
            formInputHTML('holding-qty', 'Units', '', 'number') +
            formInputHTML('holding-price', 'Price per unit', '', 'number') +
            currencySelect +
            formInputHTML('holding-cost', 'Total you paid, same currency (optional)', '', 'number');
    }
    document.getElementById('holding-fields').innerHTML = html;
}

// The number in a form field: null when it's empty, NaN when it isn't a valid amount.
function readFormNumber(id) {
    const el = document.getElementById(id);
    const raw = el ? el.value.trim() : '';
    if (raw === '') return null;
    const value = Number(raw);
    return isFinite(value) && value >= 0 ? value : NaN;
}

async function saveHolding() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    if (!account) return;
    const kind = document.getElementById('holding-kind').value;
    const quantity = readFormNumber('holding-qty');
    const cost = readFormNumber('holding-cost');
    if (!(quantity > 0)) return showAccountFormError(kind === 'cash' ? 'Enter an amount above 0.' : 'Enter a quantity above 0.');
    if (Number.isNaN(cost)) return showAccountFormError('Enter what you paid as a number, or leave it empty.');

    const holding = { id: 'h-' + Date.now().toString(36), kind: kind, quantity: quantity, priceAsOf: new Date().toISOString() };
    if (kind === 'crypto') {
        const coin = POPULAR_COINS.find(c => c[2] === document.getElementById('holding-coin').value);
        showAccountFormError('Getting the live price…');
        const prices = await fetchCoinPricesUSD([coin[2]]);
        if (!prices || !prices[coin[2]]) return showAccountFormError('Couldn\'t get a live price for ' + coin[0] + '. Check your connection and try again.');
        Object.assign(holding, { symbol: coin[0], name: coin[1], coinId: coin[2], price: prices[coin[2]], currency: 'USD', priceSource: 'coingecko' });
    } else if (kind === 'cash') {
        const currency = document.getElementById('holding-currency').value;
        Object.assign(holding, { symbol: currency, name: 'Cash', price: 1, currency: currency, priceSource: 'you' });
    } else {
        const symbol = document.getElementById('holding-symbol').value.trim().toUpperCase();
        const price = readFormNumber('holding-price');
        if (!symbol) return showAccountFormError('Enter a ticker, e.g. VAS.');
        if (!(price > 0)) return showAccountFormError('Enter the price per unit.');
        const name = document.getElementById('holding-name').value.trim();
        Object.assign(holding, { symbol: symbol, name: name || symbol, price: price, currency: document.getElementById('holding-currency').value, priceSource: 'you' });
    }
    if (cost > 0 && kind !== 'cash') holding.costBasis = cost;

    // The first holding: the typed-in balance becomes a cash line, so the total doesn't jump.
    if (!hasHoldings(account)) {
        account.holdings = [];
        if (account.balance > 0) {
            account.holdings.push({ id: 'h-start-' + Date.now().toString(36), symbol: account.currency, name: 'Cash and other', kind: 'cash',
                quantity: account.balance, price: 1, currency: account.currency, priceSource: 'you' });
        }
    }
    account.holdings.push(holding);
    account.holdingsSource = 'manual';
    closeModalAndReset();
    afterHoldingsChange(account);
    showToast(holding.symbol + ' added');
}

function openEditHolding(id) {
    const found = findOpenHolding(id);
    if (!found) return;
    const holding = found.holding;
    editingHoldingId = id;
    const cash = holding.kind === 'cash';
    // Crypto prices are live, so only typed-in prices can be changed.
    const typedPrice = !cash && holding.priceSource === 'you';
    showAccountForm('Edit ' + holding.symbol,
        formInputHTML('holding-qty', cash ? 'Amount (' + holding.currency + ')' : 'Quantity', holding.quantity, 'number') +
        (typedPrice ? formInputHTML('holding-price', 'Price per unit (' + holding.currency + ')', holding.price, 'number') : '') +
        (cash ? '' : formInputHTML('holding-cost', 'Total you paid, in ' + holding.currency + ' (optional)', holding.costBasis || '', 'number')),
        'saveEditedHolding()');
}

function saveEditedHolding() {
    const found = findOpenHolding(editingHoldingId);
    if (!found) return closeModalAndReset();
    const { account, holding } = found;
    const quantity = readFormNumber('holding-qty');
    const price = readFormNumber('holding-price');
    const cost = readFormNumber('holding-cost');
    if (!(quantity > 0)) return showAccountFormError('Enter an amount above 0.');
    if (document.getElementById('holding-price') && !(price > 0)) return showAccountFormError('Enter the price per unit.');
    if (Number.isNaN(cost)) return showAccountFormError('Enter what you paid as a number, or leave it empty.');

    holding.quantity = quantity;
    if (price > 0 && price !== holding.price) Object.assign(holding, { price: price, priceAsOf: new Date().toISOString() });
    if (cost > 0) holding.costBasis = cost;
    else delete holding.costBasis;
    closeModalAndReset();
    afterHoldingsChange(account);
    openHolding(holding.id);
}

function removeHolding(id) {
    const found = findOpenHolding(id);
    if (!found) return;
    const { account, holding } = found;
    showConfirmDialog('Remove ' + holding.symbol + '?', 'It will be taken out of this account\'s total.', 'Remove', () => {
        account.holdings = account.holdings.filter(h => h.id !== id);
        // Nothing left: the account is empty, and it goes back to a balance you type in.
        if (!account.holdings.length) {
            account.balance = 0;
            recordBalanceToday(account);
        }
        closeInfoScreen();
        afterHoldingsChange(account);
    });
}

function afterHoldingsChange(account) {
    revalueHoldings();
    saveLinkedAccounts();
    refreshAfterAccountChange();
    if (openAccountId === account.id) renderAccountDetail();
}
