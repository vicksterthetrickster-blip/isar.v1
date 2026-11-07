// insights.js — Insights tab. The Leak Finder adds up what your accounts quietly cost you
// (hidden exchange costs and bank fees), and regular payments are spotted from transactions.
// It only reads getAccountTransactions(), so it works on real bank data without changes.

const LEAK_WINDOW_DAYS = 90;
const RECURRING_MIN_TIMES = 3;          // seen this many times...
const RECURRING_GAP_DAYS = [25, 35];    // ...about a month apart...
const RECURRING_AMOUNT_RANGE = 0.15;    // ...for roughly the same amount (within 15%)

function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}

// True if an account has real or sample transactions. Value and balance updates you typed in
// aren't money moving, so Insights ignores them.
function hasTransactions(account) {
    return Array.isArray(account.transactions) || usesMockTransactions(account);
}

// Everything each account cost over the window, valued in the display currency.
function getLeakReport() {
    const since = new Date();
    since.setDate(since.getDate() - LEAK_WINDOW_DAYS);
    const start = localISODate(since);
    const accounts = ACCOUNTS.filter(hasTransactions).map(account => {
        const entry = { account: account, hidden: 0, fees: 0, foreignCount: 0, fairTotal: 0, costTotal: 0 };
        getAccountTransactions(account).filter(t => t.date >= start && !t.opening).forEach(t => {
            const fx = getFxCost(t, account);
            if (fx && !fx.unknown) {
                entry.foreignCount++;
                entry.fairTotal += fx.fair;
                entry.costTotal += fx.cost;
                if (fx.significant) entry.hidden += convertTransactionAmount(fx.cost, account, activeCurrency, t.date);
            }
            if (t.category === 'Fees' && t.amount < 0) entry.fees += convertTransactionAmount(-t.amount, account, activeCurrency, t.date);
        });
        entry.total = entry.hidden + entry.fees;
        entry.avgMarkup = entry.fairTotal ? entry.costTotal / entry.fairTotal * 100 : 0;
        return entry;
    }).filter(e => e.total > 0).sort((a, b) => b.total - a.total);
    const sum = key => accounts.reduce((total, e) => total + e[key], 0);
    return { accounts: accounts, hidden: sum('hidden'), fees: sum('fees'), total: sum('total') };
}

// Payments that repeat about monthly for about the same amount, like subscriptions and bills.
function getRecurringPayments() {
    const found = [];
    ACCOUNTS.filter(hasTransactions).forEach(account => {
        const groups = {};
        getAccountTransactions(account).filter(t => t.amount < 0 && !t.opening && !t.original).forEach(t => {
            (groups[t.description] = groups[t.description] || []).push(t);
        });
        Object.keys(groups).forEach(description => {
            const list = groups[description].slice().sort((a, b) => a.date.localeCompare(b.date));
            if (list.length < RECURRING_MIN_TIMES) return;
            const amounts = list.map(t => Math.abs(t.amount));
            const average = amounts.reduce((sum, n) => sum + n, 0) / amounts.length;
            const monthly = list.every((t, i) => {
                if (!i) return true;
                const gap = daysBetween(list[i - 1].date, t.date);
                return gap >= RECURRING_GAP_DAYS[0] && gap <= RECURRING_GAP_DAYS[1];
            });
            if (!monthly || !amounts.every(n => Math.abs(n - average) <= average * RECURRING_AMOUNT_RANGE)) return;
            found.push({ description: description, category: list[0].category, account: account, yearly: convertFromBase(convertToBase(average, account.currency), activeCurrency) * 12 });
        });
    });
    return found.sort((a, b) => b.yearly - a.yearly);
}

function renderInsightsTab() {
    const report = getLeakReport();
    const recurring = getRecurringPayments();
    const symbol = CURRENCY_META[activeCurrency].symbol;
    const money = value => symbol + formatMoney(value);
    const anyData = report.total > 0;

    document.getElementById('leak-empty').hidden = anyData;
    document.getElementById('leak-found').hidden = !anyData;
    document.getElementById('leak-total').innerText = '≈ ' + money(report.total);
    document.getElementById('leak-yearly').innerText = 'That\'s about ' + symbol + Math.round(report.total * 365 / LEAK_WINDOW_DAYS).toLocaleString('en-US') + ' a year at this rate.';
    document.getElementById('leak-hidden').innerText = '≈ ' + money(report.hidden);
    document.getElementById('leak-fees').innerText = money(report.fees);
    document.getElementById('leak-accounts').innerHTML = report.accounts.map(entry => {
        const detail = [];
        if (entry.hidden) detail.push(entry.avgMarkup.toFixed(1) + '% worse than the real rate');
        if (entry.fees) detail.push(money(entry.fees) + ' in fees');
        return '<div class="account-row insight-row" onclick="openAccount(\'' + entry.account.id + '\')">' +
            bankIconHTML(entry.account, 36) +
            '<span class="tx-name">' + escapeHTML(entry.account.name) + '<small>' + detail.join(' · ') + '</small></span>' +
            '<span class="tx-amount">≈ ' + money(entry.total) + '</span>' +
        '</div>';
    }).join('');

    document.getElementById('recurring-card').hidden = !recurring.length;
    document.getElementById('recurring-total').innerText = symbol + Math.round(recurring.reduce((sum, r) => sum + r.yearly, 0)).toLocaleString('en-US') + ' a year';
    document.getElementById('recurring-list').innerHTML = recurring.map(r =>
        '<div class="tx-row" onclick="openAccount(\'' + r.account.id + '\')">' +
            '<span class="tx-name">' + escapeHTML(r.description) + '<small>' + escapeHTML(r.category || '') + ' · ' + escapeHTML(r.account.name) + '</small></span>' +
            '<span class="tx-amount">' + symbol + Math.round(r.yearly).toLocaleString('en-US') + '<small class="per-year">a year</small></span>' +
        '</div>'
    ).join('');

    document.getElementById('insights-note').innerText = USER_SETTINGS.showSampleData ? 'Based on sample transactions in the demo. Hidden costs are estimates.' : '';
}
