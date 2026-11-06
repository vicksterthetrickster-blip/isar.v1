// transactions.js — money in and out of an account, shown under its balance graph.
//
// One transaction: { id, date: 'YYYY-MM-DD', description, category, amount, opening }
//   amount is in the account's own currency: positive = money in, negative = money out
//   opening: true marks a starting balance, which isn't counted as money in
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
    if (Array.isArray(account.transactions)) return account.transactions;
    if (usesMockTransactions(account)) return generateMockTransactions(account);
    return balanceUpdateEntries(account);
}

function usesMockTransactions(account) {
    return USER_SETTINGS.showSampleData && !Array.isArray(account.transactions) &&
        (!account.userLinked || account.historySource === 'mock');
}

// Your own accounts: each saved balance becomes an entry, showing how much it changed by.
function balanceUpdateEntries(account) {
    const points = (account.history || []).filter(h => typeof h.balance === 'number' && h.date >= (account.addedDate || ''));
    const entries = points.map((point, i) => {
        const change = i === 0 ? point.balance : Math.round((point.balance - points[i - 1].balance) * 100) / 100;
        return {
            id: account.id + '-' + point.date,
            date: point.date,
            description: i === 0 ? 'Starting balance' : 'Balance updated',
            category: i === 0 ? 'Account added' : 'Entered by you',
            amount: change,
            opening: i === 0
        };
    });
    return entries.filter(e => e.opening || e.amount !== 0).reverse();
}

// ===== MOCK DATA: replaced by the bank provider later =====
// Believable transactions for sample accounts. Amounts are in AUD and scaled to the
// account's currency and size. `day` = every month on that date; `chance` = per day.
const MOCK_TRANSACTION_RULES = {
    everyday: [
        { description: 'Salary', category: 'Income', min: 3100, max: 3400, in: true, day: 15 },
        { description: 'Rent', category: 'Housing', min: 1700, max: 1700, day: 1 },
        { description: 'Electricity bill', category: 'Bills', min: 90, max: 190, day: 9 },
        { description: 'Mobile plan', category: 'Bills', min: 45, max: 45, day: 20 },
        { description: 'Netflix', category: 'Subscriptions', min: 19, max: 19, day: 12 },
        { description: 'Spotify', category: 'Subscriptions', min: 14, max: 14, day: 23 },
        { description: 'Supermarket', category: 'Groceries', min: 35, max: 160, chance: 0.28 },
        { description: 'Cafe', category: 'Eating out', min: 5, max: 24, chance: 0.38 },
        { description: 'Restaurant', category: 'Eating out', min: 30, max: 110, chance: 0.1 },
        { description: 'Uber', category: 'Transport', min: 12, max: 45, chance: 0.12 },
        { description: 'Fuel', category: 'Transport', min: 50, max: 90, chance: 0.07 },
        { description: 'Amazon', category: 'Shopping', min: 18, max: 140, chance: 0.08 },
        { description: 'Transfer received', category: 'Transfers', min: 40, max: 300, in: true, chance: 0.05 }
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
const mockTransactionCache = {};        // account id + balance -> generated list

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
    const cacheKey = account.id + ':' + account.balance;
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
            if (!happens) return;
            const amount = Math.round((rule.min + spread * (rule.max - rule.min)) * size * fallbackRate * 100) / 100;
            list.push({ id: account.id + '-' + date + '-' + i, date: date, description: rule.description, category: rule.category, amount: rule.in ? amount : -amount });
        });
    }
    mockTransactionCache[cacheKey] = list;
    return list;
}

// --- The "Money in & out" card on the account screen ---
function formatTransactionAmount(amount, currency) {
    return (amount >= 0 ? '+' : '−') + CURRENCY_META[currency].symbol + formatMoney(Math.abs(amount));
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

    // Totals for the last 30 days, in the account's own currency
    const since = new Date();
    since.setDate(since.getDate() - TX_SUMMARY_DAYS);
    const recent = counted.filter(t => t.date >= localISODate(since));
    const moneyIn = recent.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const moneyOut = recent.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0);
    const symbol = CURRENCY_META[account.currency].symbol;
    document.getElementById('acct-tx-title').innerText = 'Money in & out · ' + account.currency;
    document.getElementById('acct-tx-in').innerText = symbol + formatMoney(moneyIn);
    document.getElementById('acct-tx-out').innerText = symbol + formatMoney(Math.abs(moneyOut));

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
            '<div class="tx-row">' +
                '<span class="tx-icon ' + (moneyInRow ? 'in' : 'out') + '">' + (moneyInRow ? '↓' : '↑') + '</span>' +
                '<span class="tx-name">' + escapeHTML(t.description) + '<small>' + escapeHTML(t.category || '') + '</small></span>' +
                '<span class="tx-amount' + (moneyInRow ? ' in' : '') + '">' + formatTransactionAmount(t.amount, account.currency) + '</span>' +
            '</div>';
    }).join('') || '<div class="tx-empty">Nothing here yet</div>';

    document.getElementById('acct-tx-more').hidden = shown.length <= acctTxLimit;
    document.getElementById('acct-tx-note').innerText = Array.isArray(account.transactions) ? ''
        : usesMockTransactions(account) ? 'Sample transactions for the demo.'
        : 'These are the balance updates you\'ve entered. Individual transactions will appear here once this bank is connected.';
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
