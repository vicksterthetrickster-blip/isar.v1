// transactions.js — an account's transactions, shown under its balance graph.
//
// One transaction: { id, date: 'YYYY-MM-DD', time, description, category, amount, opening, original }
//   time is 'HH:MM' on the device's clock. It's optional: some banks only give the date.
//   amount is in the account's own currency: positive = money in, negative = money out
//   opening: true marks a starting balance, which isn't counted as money in
//   original: { amount, currency } only on a foreign transaction: what was actually spent, e.g.
//             EUR 100. `amount` is then what the bank charged for it, in the account's currency.
//
// getAccountTransactions() is the ONLY place that decides where the list comes from:
//   1. account.transactions: real data. A bank connection (TrueLayer, Plaid, Basiq...) fills
//      this in when it syncs, and everything below keeps working unchanged.
//   2. sample data: made-up transactions for the demo (generateMockTransactions)
//   3. your own accounts: the balance updates you've entered, as there's no bank feed yet

const TX_MOCK_DAYS = 90;                // how far back the made-up transactions go
const TX_SUMMARY_DAYS = 30;             // the "money in / money out" totals cover this many days
const TX_PAGE_SIZE = 15;                // rows shown before "Show more"
const TX_FILTERS = [['all', 'All'], ['in', 'Money in'], ['out', 'Money out']];

function getAccountTransactions(account) {
    const list = Array.isArray(account.transactions) ? account.transactions
        : usesMockTransactions(account) ? generateMockTransactions(account)
        : balanceUpdateEntries(account);
    return list.slice().sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));   // newest first
}

function currentTimeHHMM() {
    const now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

// "14:05" -> "2:05 PM"
function formatTransactionTime(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours % 12 || 12) + ':' + String(minutes).padStart(2, '0') + (hours < 12 ? ' AM' : ' PM');
}

// An amount from an account's own currency in the currency it's being viewed in, at THAT
// day's rate (like the balance graph). Falls back to today's rate if we don't have that day.
function convertTransactionAmount(amount, account, code, date) {
    if (code === account.currency) return amount;
    const past = getRateOnDate(date, account.currency, code);
    return amount * (past ? past.rate : EXCHANGE_RATES[code] / EXCHANGE_RATES[account.currency]);
}

function usesMockTransactions(account) {
    return USER_SETTINGS.showSampleData && !Array.isArray(account.transactions) && !isValuedByHand(account) &&
        (!account.userLinked || account.historySource === 'mock');
}

// Your own accounts: each saved balance becomes an entry, showing how much it changed by.
function balanceUpdateEntries(account) {
    const points = (account.history || []).filter(h => typeof h.balance === 'number' && h.date >= (account.addedDate || ''));
    const word = isValuedByHand(account) ? 'value' : 'balance';
    const entries = points.map((point, i) => {
        const change = i === 0 ? point.balance : Math.round((point.balance - points[i - 1].balance) * 100) / 100;
        return {
            id: account.id + '-' + point.date,
            date: point.date,
            time: point.time,
            description: i === 0 ? 'Starting ' + word : word[0].toUpperCase() + word.slice(1) + ' updated',
            category: !account.userLinked ? 'Sample data' : i === 0 ? 'Account added' : 'Entered by you',
            amount: change,
            opening: i === 0
        };
    });
    return entries.filter(e => e.opening || e.amount !== 0).reverse();
}

// ===== MOCK DATA: replaced by the bank provider later =====
// Believable transactions for sample accounts. Amounts are in AUD and scaled to the
// account's currency and size. `day` = every month on that date; `chance` = per day.
// `mainOnly` = only on your main account, so a demo person doesn't pay three rents.
const MOCK_TRANSACTION_RULES = {
    everyday: [
        { description: 'Salary', category: 'Income', min: 3100, max: 3400, in: true, day: 15, mainOnly: true },
        { description: 'Rent', category: 'Housing', min: 1700, max: 1700, day: 1, mainOnly: true },
        { description: 'Electricity bill', category: 'Bills', min: 90, max: 190, day: 9, mainOnly: true },
        { description: 'Mobile plan', category: 'Bills', min: 45, max: 45, day: 20, mainOnly: true },
        { description: 'Netflix', category: 'Subscriptions', min: 19, max: 19, day: 12, mainOnly: true },
        { description: 'Spotify', category: 'Subscriptions', min: 14, max: 14, day: 23, mainOnly: true },
        { description: 'Supermarket', category: 'Groceries', min: 35, max: 160, chance: 0.28 },
        { description: 'Cafe', category: 'Eating out', min: 5, max: 24, chance: 0.38 },
        { description: 'Restaurant', category: 'Eating out', min: 30, max: 110, chance: 0.1 },
        { description: 'Uber', category: 'Transport', min: 12, max: 45, chance: 0.12 },
        { description: 'Fuel', category: 'Transport', min: 50, max: 90, chance: 0.07 },
        { description: 'Amazon', category: 'Shopping', min: 18, max: 140, chance: 0.08 },
        { description: 'Transfer received', category: 'Transfers', min: 40, max: 300, in: true, chance: 0.05 },
        { description: 'Monthly account fee', category: 'Fees', min: 6, max: 6, day: 5 },
        { description: 'ATM fee', category: 'Fees', min: 3, max: 5, chance: 0.04 }
    ],
    savings: [
        { description: 'Interest', category: 'Income', min: 95, max: 130, in: true, day: 28 },
        { description: 'Monthly savings', category: 'Transfers', min: 600, max: 600, in: true, day: 16 },
        { description: 'Transfer to everyday', category: 'Transfers', min: 100, max: 600, chance: 0.03 }
    ],
    broker: [
        { description: 'Deposit', category: 'Transfers', min: 500, max: 500, in: true, day: 16 },
        { description: 'Dividend: VAS', category: 'Income', min: 40, max: 160, in: true, day: 18 },
        { description: 'Dividend: AAPL', category: 'Income', min: 12, max: 50, in: true, day: 11 },
        { description: 'Buy: VGS', category: 'Investing', min: 200, max: 700, chance: 0.05 },
        { description: 'Buy: NVDA', category: 'Investing', min: 150, max: 500, chance: 0.03 },
        { description: 'Sell: TSLA', category: 'Investing', min: 150, max: 600, in: true, chance: 0.02 }
    ],
    crypto: [
        { description: 'Deposit', category: 'Transfers', min: 300, max: 300, in: true, day: 16 },
        { description: 'Staking reward', category: 'Income', min: 4, max: 30, in: true, chance: 0.1 },
        { description: 'Buy: BTC', category: 'Crypto', min: 100, max: 500, chance: 0.05 },
        { description: 'Buy: ETH', category: 'Crypto', min: 60, max: 300, chance: 0.05 },
        { description: 'Sell: SOL', category: 'Crypto', min: 80, max: 350, in: true, chance: 0.03 }
    ]
};
// Foreign spending (everyday accounts only). The amounts are real conversions: each one is
// priced at that day's real rate, plus a markup like a bank's (see mockFxMarkup).
const MOCK_FOREIGN_SPENDS = [
    { description: 'Hotel, Lisbon', category: 'Travel', currency: 'EUR', min: 120, max: 260 },
    { description: 'Restaurant, Paris', category: 'Eating out', currency: 'EUR', min: 40, max: 110 },
    { description: 'Amazon US', category: 'Shopping', currency: 'USD', min: 30, max: 160 },
    { description: 'Uber, London', category: 'Transport', currency: 'GBP', min: 12, max: 40 },
    { description: 'Train, Tokyo', category: 'Travel', currency: 'JPY', min: 20, max: 70 }
];
const MOCK_FOREIGN_CHANCE = 0.09;       // per day

// Multi-currency accounts convert close to the real rate; ordinary bank cards charge about 3%.
function mockFxMarkup(account, random) {
    const multiCurrency = account.type === 'Multi-Currency' || account.type === 'Business Account';
    return multiCurrency ? 0.003 + random * 0.003 : 0.025 + random * 0.01;
}

function mockForeignTransaction(account, date, size) {
    const random = seededRandom('fx' + account.id + date);
    if (random() > MOCK_FOREIGN_CHANCE) return null;
    const spend = MOCK_FOREIGN_SPENDS[Math.floor(random() * MOCK_FOREIGN_SPENDS.length)];
    const toSpend = getRateOnDate(date, BASE_CURRENCY, spend.currency);
    const toAccount = getRateOnDate(date, spend.currency, account.currency);
    if (spend.currency === account.currency || !toSpend || !toAccount) return null;
    const original = Math.round((spend.min + random() * (spend.max - spend.min)) * size * toSpend.rate * 100) / 100;
    const charged = Math.round(original * toAccount.rate * (1 + mockFxMarkup(account, random())) * 100) / 100;
    return { id: account.id + '-' + date + '-fx', date: date, description: spend.description, category: spend.category, amount: -charged, original: { amount: -original, currency: spend.currency } };
}

// A time of day for a sample transaction (7:00 AM to 9:59 PM). Worked out from its id, so it
// never changes, and separately from the amounts.
function mockTransactionTime(id) {
    const random = seededRandom('time' + id);
    return String(7 + Math.floor(random() * 15)).padStart(2, '0') + ':' + String(Math.floor(random() * 60)).padStart(2, '0');
}

const mockTransactionCache = {};        // account id + balance + rate days + hour -> generated list

function isMockMainAccount(account) {
    return account.type !== 'Multi-Currency' && account.type !== 'Business Account';
}

function mockRulesFor(account) {
    const bank = topBanks.find(b => b.name === account.bankName);
    const kind = (bank && bank.kind) || '';
    if (kind === 'crypto' || account.type === 'Digital Assets') return MOCK_TRANSACTION_RULES.crypto;
    if (kind === 'broker' || account.type === 'Brokerage Portfolio') return MOCK_TRANSACTION_RULES.broker;
    if (account.type === 'Savings') return MOCK_TRANSACTION_RULES.savings;
    return MOCK_TRANSACTION_RULES.everyday;
}

// A random number generator that gives the same numbers for the same text, so each
// account's sample transactions stay the same every time the app opens.
function seededRandom(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return () => {
        hash = Math.imul(hash ^ (hash >>> 15), hash | 1) + 0x6D2B79F5 | 0;
        return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
    };
}

function generateMockTransactions(account) {
    const cacheKey = [account.id, account.balance, rateHistoryDates.length, new Date().getHours()].join(':');
    if (mockTransactionCache[cacheKey]) return mockTransactionCache[cacheKey];

    const fallbackRate = CURRENCIES.find(c => c.code === account.currency).fallback;   // stays fixed, so amounts don't shift with live rates
    const size = Math.min(1.5, Math.max(0.15, (account.balance / fallbackRate) / 25000));
    const rules = mockRulesFor(account);
    const list = [];
    for (let daysAgo = 0; daysAgo < TX_MOCK_DAYS; daysAgo++) {
        const day = new Date();
        day.setDate(day.getDate() - daysAgo);
        const date = localISODate(day);
        const random = seededRandom(account.id + date);    // each date always gives the same result
        rules.forEach((rule, i) => {
            const happens = rule.day ? day.getDate() === rule.day : random() < rule.chance;
            const spread = random();
            if (!happens || (rule.mainOnly && !isMockMainAccount(account))) return;
            const amount = Math.round((rule.min + spread * (rule.max - rule.min)) * size * fallbackRate * 100) / 100;
            list.push({ id: account.id + '-' + date + '-' + i, date: date, description: rule.description, category: rule.category, amount: rule.in ? amount : -amount });
        });
        const foreign = rules === MOCK_TRANSACTION_RULES.everyday ? mockForeignTransaction(account, date, size) : null;
        if (foreign) list.push(foreign);
    }
    // Today's sample transactions only appear once their time has passed
    const today = localISODate(new Date()), now = currentTimeHHMM();
    const timed = list
        .map(t => Object.assign(t, { time: mockTransactionTime(t.id) }))
        .filter(t => t.date !== today || t.time <= now);
    mockTransactionCache[cacheKey] = timed;
    return timed;
}

// --- The hidden cost of a foreign transaction ---
// A bank can say "no fee" and still charge one, by giving you a worse exchange rate. This
// compares what you were charged with what the same amount cost at the real rate that day.
// Differences under FX_TOLERANCE_PCT are normal: rates move during the day, and the ECB
// publishes just one rate, so the result is always an estimate.
const FX_TOLERANCE_PCT = 0.3;

function getFxCost(transaction, account) {
    const original = transaction.original;
    if (!original || original.currency === account.currency) return null;
    const real = getRateOnDate(transaction.date, original.currency, account.currency);
    if (!real) return { unknown: true };
    const charged = Math.abs(transaction.amount), spent = Math.abs(original.amount);
    const fair = spent * real.rate;
    const cost = transaction.amount < 0 ? charged - fair : fair - charged;      // on a refund, getting less is the cost
    const pct = cost / fair * 100;
    return { realRate: real.rate, rateDate: real.rateDate, bankRate: charged / spent, fair: fair, cost: cost, pct: pct, significant: pct >= FX_TOLERANCE_PCT };
}

// --- The Transactions card on the account screen ---
function formatTransactionAmount(amount, currency) {
    return (amount >= 0 ? '+' : '−') + CURRENCY_META[currency].symbol + formatMoney(Math.abs(amount));
}

function formatRate(rate) {
    return Number(rate.toPrecision(5)).toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function formatOriginalAmount(original) {
    return CURRENCY_META[original.currency].symbol + formatMoney(Math.abs(original.amount)) + ' ' + original.currency;
}

function transactionDayLabel(date) {
    const today = new Date();
    if (date === localISODate(today)) return 'Today';
    today.setDate(today.getDate() - 1);
    if (date === localISODate(today)) return 'Yesterday';
    const [year, month, day] = date.split('-').map(Number);
    return Number(day) + ' ' + MONTH_NAMES[month - 1] + (year === today.getFullYear() ? '' : ' ' + year);
}

function renderAccountTransactions(account) {
    const all = getAccountTransactions(account);
    const counted = all.filter(t => !t.opening);

    // Everything on this card follows the currency chosen at the top of the account screen.
    // Each amount is converted at its own day's rate; the real charges are never changed.
    const code = acctViewCurrency || account.currency;
    const converted = code !== account.currency;
    const inView = t => convertTransactionAmount(t.amount, account, code, t.date);

    // Totals for the last 30 days
    const since = new Date();
    since.setDate(since.getDate() - TX_SUMMARY_DAYS);
    const recent = counted.filter(t => t.date >= localISODate(since));
    const moneyIn = recent.filter(t => t.amount > 0).reduce((sum, t) => sum + inView(t), 0);
    const moneyOut = recent.filter(t => t.amount < 0).reduce((sum, t) => sum + inView(t), 0);
    const symbol = CURRENCY_META[code].symbol;
    const approx = converted ? '≈ ' : '';
    // Assets and debts have value updates rather than transactions, so no money in/out totals
    const updatesOnly = isValuedByHand(account);
    document.getElementById('acct-tx-summary').hidden = updatesOnly;
    document.getElementById('acct-tx-filters').hidden = updatesOnly;
    if (updatesOnly) acctTxFilter = 'all';
    document.getElementById('acct-tx-title').innerText = (updatesOnly ? 'Value history · ' : 'Transactions · ') + code;
    document.getElementById('acct-tx-in').innerText = approx + symbol + formatMoney(moneyIn);
    document.getElementById('acct-tx-out').innerText = approx + symbol + formatMoney(Math.abs(moneyOut));

    // Total hidden exchange cost over the same 30 days
    const hidden = recent.reduce((sum, t) => {
        const fx = getFxCost(t, account);
        return fx && fx.significant ? sum + convertTransactionAmount(fx.cost, account, code, t.date) : sum;
    }, 0);
    document.getElementById('acct-tx-hidden').hidden = !hidden;
    document.getElementById('acct-tx-hidden-value').innerText = '≈ ' + symbol + formatMoney(hidden);

    document.getElementById('acct-tx-filters').innerHTML = TX_FILTERS.map(pair => {
        const active = pair[0] === acctTxFilter;
        return '<button class="interactive-btn tx-filter' + (active ? ' active' : '') + '" onclick="setAcctTxFilter(\'' + pair[0] + '\')">' + pair[1] + '</button>';
    }).join('');

    const shown = all.filter(t => acctTxFilter === 'all' || (!t.opening && (acctTxFilter === 'in' ? t.amount > 0 : t.amount < 0)));
    const page = shown.slice(0, acctTxLimit);
    let lastDate = null;
    document.getElementById('acct-tx-list').innerHTML = page.map(t => {
        const heading = t.date === lastDate ? '' : '<div class="tx-day">' + transactionDayLabel(t.date) + '</div>';
        lastDate = t.date;
        const moneyInRow = t.amount >= 0;
        return heading +
            '<div class="tx-row" data-id="' + escapeHTML(t.id) + '" onclick="openTransaction(this.dataset.id)">' +
                '<span class="tx-icon ' + (moneyInRow ? 'in' : 'out') + '">' + (moneyInRow ? '↓' : '↑') + '</span>' +
                '<span class="tx-name">' + escapeHTML(t.description) +
                    '<small>' + (t.time ? formatTransactionTime(t.time) + ' · ' : '') + escapeHTML(t.category || '') + '</small>' +
                    (t.original ? '<small>Spent ' + formatOriginalAmount(t.original) + '</small>' : '') +
                '</span>' +
                '<span class="tx-amount' + (moneyInRow ? ' in' : '') + '">' + approx + formatTransactionAmount(inView(t), code) + '</span>' +
                '<span class="tx-chevron">›</span>' +
            '</div>';
    }).join('') || '<div class="tx-empty">Nothing here yet</div>';

    document.getElementById('acct-tx-more').hidden = shown.length <= acctTxLimit;
    const source = Array.isArray(account.transactions) || updatesOnly ? ''
        : usesMockTransactions(account) ? 'Sample transactions for the demo.'
        : 'These are the balance updates you\'ve entered. Individual transactions will appear here once this bank is connected.';
    document.getElementById('acct-tx-note').innerText = (converted ? 'Converted from ' + account.currency + ' using each day\'s exchange rate. ' : '') + source;
}

// --- One transaction, opened by tapping it ---
function infoRowHTML(label, value) {
    return '<div class="settings-row" style="cursor: default;"><span class="row-label">' + label + '</span><span class="row-value" style="text-align: right;">' + escapeHTML(value) + '</span></div>';
}

function fxCostHTML(transaction, account) {
    const fx = getFxCost(transaction, account);
    if (!fx) return '';
    const symbol = CURRENCY_META[account.currency].symbol;
    const from = transaction.original.currency, to = account.currency;
    const spent = formatOriginalAmount(transaction.original);
    if (fx.unknown) return '<p class="info-note">We don\'t have the exchange rate for this date yet, so the hidden cost can\'t be worked out.</p>';

    return '<div><div class="section-label">Foreign currency</div><div class="settings-group">' +
            infoRowHTML('Spent', spent) +
            infoRowHTML('Your bank\'s rate', '1 ' + from + ' = ' + formatRate(fx.bankRate) + ' ' + to) +
            infoRowHTML('Real rate', '1 ' + from + ' = ' + formatRate(fx.realRate) + ' ' + to) +
        '</div></div>' +
        '<div class="fx-card' + (fx.significant ? '' : ' fair') + '">' +
            '<small>' + (fx.significant ? 'Hidden exchange cost' : 'Hidden exchange cost: none found') + '</small>' +
            (fx.significant ? '<strong>≈ ' + symbol + formatMoney(fx.cost) + '</strong><span>' + fx.pct.toFixed(1) + '% worse than the real rate, even if your bank calls it fee-free.</span>' : '<span>Your bank\'s rate was about the same as the real rate.</span>') +
            '<p>' + spent + ' at the real rate is ' + symbol + formatMoney(fx.fair) + '. Your bank charged ' + symbol + formatMoney(Math.abs(transaction.amount)) + '.</p>' +
        '</div>' +
        '<p class="info-note">An estimate. The real rate is the European Central Bank\'s rate for ' + formatRateDate(fx.rateDate) + ', and rates move during the day.</p>';
}

function openTransaction(id) {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    const transaction = account && getAccountTransactions(account).find(t => t.id === id);
    if (!transaction) return;
    const moneyIn = transaction.amount >= 0;
    const [year] = transaction.date.split('-');
    const code = acctViewCurrency || account.currency;
    const convertedRow = code === account.currency ? '' : infoRowHTML('In ' + code, '≈ ' + formatTransactionAmount(convertTransactionAmount(transaction.amount, account, code, transaction.date), code));
    openInfoScreen('Transaction',
        '<div class="tx-hero">' +
            '<span class="tx-icon ' + (moneyIn ? 'in' : 'out') + '">' + (moneyIn ? '↓' : '↑') + '</span>' +
            '<strong class="' + (moneyIn ? 'in' : '') + '">' + formatTransactionAmount(transaction.amount, account.currency) + '</strong>' +
            '<span>' + escapeHTML(transaction.description) + '</span>' +
        '</div>' +
        '<div class="settings-group">' +
            infoRowHTML('Date', formatRateDate(transaction.date) + ' ' + year) +
            (transaction.time ? infoRowHTML('Time', formatTransactionTime(transaction.time)) : '') +
            convertedRow +
            infoRowHTML('Type', transaction.opening ? 'Starting balance' : moneyIn ? 'Money in' : 'Money out') +
            (transaction.category ? infoRowHTML('Category', transaction.category) : '') +
            infoRowHTML('Account', account.name) +
        '</div>' +
        fxCostHTML(transaction, account) +
        (usesMockTransactions(account) ? '<p class="info-note">Sample transaction for the demo.</p>' : ''));
}

function refreshAccountTransactions() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    if (account) renderAccountTransactions(account);
}

function setAcctTxFilter(filter) {
    acctTxFilter = filter;
    acctTxLimit = TX_PAGE_SIZE;
    refreshAccountTransactions();
}

function showMoreAcctTx() {
    acctTxLimit += TX_PAGE_SIZE;
    refreshAccountTransactions();
}
