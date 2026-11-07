// insights.js — Insights tab. The Leak Finder adds up the hidden cost of your foreign transactions
// over a period you choose, and regular payments are spotted from your transactions.
// It only reads getAccountTransactions(), so it works on real bank data without changes.

const LEAK_PERIODS = [['week', 7], ['30 days', 30], ['60 days', 60], ['90 days', 90], ['6 months', 182], ['year', 365], ['2 years', 730]];
const RECURRING_LOOKBACK_DAYS = 100;    // only recent payments count, so cancelled ones drop off
const RECURRING_MIN_TIMES = 3;          // seen this many times...
const RECURRING_GAP_DAYS = [25, 35];    // ...about a month apart...
const RECURRING_AMOUNT_RANGE = 0.15;    // ...for roughly the same amount (within 15%)

function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}

function dateDaysAgo(days) {
    const day = new Date();
    day.setDate(day.getDate() - days);
    return localISODate(day);
}

// True if an account has real or sample transactions. Value and balance updates you typed in
// aren't money moving, so Insights ignores them.
function hasTransactions(account) {
    return Array.isArray(account.transactions) || usesMockTransactions(account);
}

// Every foreign transaction with a hidden cost in the last `days` days, newest first, and the
// totals by account. Each cost is valued in the display currency at that day's rate.
function getLeakReport(days) {
    const start = dateDaysAgo(days);
    const items = [], byAccount = [];
    ACCOUNTS.filter(hasTransactions).forEach(account => {
        const entry = { account: account, total: 0, fairTotal: 0, costTotal: 0 };
        getAccountTransactions(account).filter(t => t.date >= start && !t.opening).forEach(t => {
            const fx = getFxCost(t, account);
            if (!fx || fx.unknown) return;
            entry.fairTotal += fx.fair;
            entry.costTotal += fx.cost;
            if (!fx.significant) return;
            const cost = convertTransactionAmount(fx.cost, account, activeCurrency, t.date);
            entry.total += cost;
            items.push({ account: account, transaction: t, fx: fx, cost: cost });
        });
        entry.avgMarkup = entry.fairTotal ? entry.costTotal / entry.fairTotal * 100 : 0;
        if (entry.total > 0) byAccount.push(entry);
    });
    items.sort((a, b) => (b.transaction.date + (b.transaction.time || '')).localeCompare(a.transaction.date + (a.transaction.time || '')));
    byAccount.sort((a, b) => b.total - a.total);
    return { items: items, accounts: byAccount, total: items.reduce((sum, i) => sum + i.cost, 0) };
}

// The chart's bars: days for a week, weeks up to 90 days, months beyond that.
function getLeakBars(days, items) {
    const today = localISODate(new Date());
    const bars = [];
    if (days > 90) {
        const month = new Date();                       // starts in the month the period starts in
        month.setDate(1);
        month.setMonth(month.getMonth() - Math.ceil(days / 30.4));
        while (localISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0)) < dateDaysAgo(days)) month.setMonth(month.getMonth() + 1);
        while (localISODate(month) <= today) {
            bars.push({ start: localISODate(month), label: MONTH_NAMES[month.getMonth()] + ' ' + month.getFullYear(), short: MONTH_NAMES[month.getMonth()] + " '" + String(month.getFullYear()).slice(2), cost: 0 });
            month.setMonth(month.getMonth() + 1);
        }
    } else {
        const step = days <= 7 ? 1 : 7;
        for (let ago = days - 1; ago >= 0; ago -= step) {
            const start = dateDaysAgo(ago);
            const name = formatRateDate(start).replace(/^\w+ /, '');
            bars.push({ start: start, label: step === 1 ? formatRateDate(start) : 'Week of ' + name, short: name, cost: 0 });
        }
    }
    items.forEach(item => {
        const bar = bars.filter(b => b.start <= item.transaction.date).pop();
        if (bar) bar.cost += item.cost;
    });
    return bars;
}

// Payments that repeat about monthly for about the same amount, like subscriptions and bills.
function getRecurringPayments() {
    const found = [];
    const start = dateDaysAgo(RECURRING_LOOKBACK_DAYS);
    ACCOUNTS.filter(hasTransactions).forEach(account => {
        const groups = {};
        getAccountTransactions(account).filter(t => t.date >= start && t.amount < 0 && !t.opening && !t.original).forEach(t => {
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

// --- The Insights tab: a small Leak Finder box (tap it for the full page) and regular payments ---
function renderInsightsTab() {
    const report = getLeakReport(leakDays);
    const recurring = getRecurringPayments();
    const symbol = CURRENCY_META[activeCurrency].symbol;
    const anyData = ACCOUNTS.some(hasTransactions);

    document.getElementById('leak-empty').hidden = anyData;
    document.getElementById('leak-summary').hidden = !anyData;
    document.getElementById('leak-chevron').hidden = !anyData;
    document.getElementById('leak-total').innerText = (report.total ? '≈ ' : '') + symbol + formatMoney(report.total);
    document.getElementById('leak-label').innerText = 'Lost to hidden exchange costs, ' + leakPeriodLabel();

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

// "last 90 days", "last year"...
function leakPeriodLabel(days) {
    return 'last ' + LEAK_PERIODS.find(p => p[1] === (days || leakDays))[0];
}

function capitalise(text) {
    return text[0].toUpperCase() + text.slice(1);
}

function toggleLeakMenu() {
    document.getElementById('leak-menu').classList.toggle('open');
}

// --- The Leak Finder page: period, chart, banks and the transactions themselves ---
function leakChartHTML(bars) {
    const symbol = CURRENCY_META[activeCurrency].symbol;
    const highest = Math.max(...bars.map(b => b.cost), 0);
    const selected = bars[leakSelectedBar];
    const summary = bars.filter(b => b.cost).map(b => b.label + ' ' + symbol + formatMoney(b.cost)).join(', ');
    return '<div class="leak-chart" role="img" aria-label="' + escapeHTML('Hidden exchange costs over time: ' + summary) + '">' +
        bars.map((bar, i) =>
            '<button class="leak-bar' + (leakSelectedBar === i ? ' selected' : '') + '" title="' + bar.label + '" onclick="selectLeakBar(' + i + ')">' +
                '<span style="height: ' + (bar.cost ? Math.max(4, bar.cost / highest * 100) : 0) + '%;"></span>' +
            '</button>'
        ).join('') +
    '</div>' +
    '<div class="leak-axis"><span>' + bars[0].short + '</span><span>' + bars[bars.length - 1].short + '</span></div>' +
    '<div class="leak-bar-value">' + (selected
        ? selected.label + ': ' + (selected.cost ? '≈ ' + symbol + formatMoney(selected.cost) : 'nothing lost')
        : 'Tap a bar to see its amount') + '</div>';
}

function leakTransactionHTML(item, symbol) {
    const t = item.transaction;
    return '<div class="leak-tx" data-id="' + escapeHTML(t.id) + '" data-account="' + item.account.id + '" onclick="openLeakTransaction(this.dataset.id, this.dataset.account)">' +
        bankIconHTML(item.account, 32) +
        '<span class="tx-name">' + escapeHTML(t.description) +
            '<small>' + formatRateDate(t.date) + ' · ' + escapeHTML(item.account.name) + '</small>' +
            '<small>Spent ' + formatOriginalAmount(t.original) + ', charged ' + formatAmount(Math.abs(t.amount), item.account.currency) + '</small>' +
        '</span>' +
        '<span class="leak-cost">≈ ' + symbol + formatMoney(item.cost) + '<small>' + item.fx.pct.toFixed(1) + '%</small></span>' +
        '<span class="tx-chevron">›</span>' +
    '</div>';
}

function openLeakPage() {
    if (!ACCOUNTS.some(hasTransactions)) return;
    const report = getLeakReport(leakDays);
    const symbol = CURRENCY_META[activeCurrency].symbol;
    const money = value => symbol + formatMoney(value);
    if (!report.accounts.some(e => e.account.id === leakListAccount)) leakListAccount = null;
    const items = report.items.filter(i => !leakListAccount || i.account.id === leakListAccount);

    const periods = LEAK_PERIODS.map(p =>
        '<button class="dropdown-item' + (p[1] === leakDays ? ' active' : '') + '" onclick="setLeakDays(' + p[1] + ')">' + capitalise(leakPeriodLabel(p[1])) + '</button>'
    ).join('');
    const yearly = !report.total ? 'None found in this period.' : leakDays === 365 ? ''
        : 'That\'s about ' + symbol + Math.round(report.total * 365 / leakDays).toLocaleString('en-US') + ' a year at this rate.';
    const banks = report.accounts.map(entry =>
        '<div class="account-row insight-row' + (entry.account.id === leakListAccount ? ' selected' : '') + '" onclick="toggleLeakAccount(\'' + entry.account.id + '\')">' +
            bankIconHTML(entry.account, 36) +
            '<span class="tx-name">' + escapeHTML(entry.account.name) + '<small>' + entry.avgMarkup.toFixed(1) + '% worse than the real rate</small></span>' +
            '<span class="tx-amount">≈ ' + money(entry.total) + '</span>' +
        '</div>'
    ).join('');

    openInfoScreen('The Leak Finder',
        '<div class="card leak-hero" style="padding: 16px; gap: 4px;">' +
            '<div class="leak-head">' +
                '<span>Lost to hidden exchange costs</span>' +
                '<button id="leak-btn" class="interactive-btn leak-period-btn" onclick="toggleLeakMenu()">' + capitalise(leakPeriodLabel()) + ' <i>▼</i></button>' +
            '</div>' +
            '<div id="leak-menu" class="dropdown-menu">' + periods + '</div>' +
            '<div class="leak-total">' + (report.total ? '≈ ' : '') + money(report.total) + '</div>' +
            '<div style="font-size: 14px; color: #fff;">' + yearly + '</div>' +
            leakChartHTML(getLeakBars(leakDays, report.items)) +
        '</div>' +
        (banks ? '<div><div class="section-label">By bank</div>' + banks + '</div>' : '') +
        (items.length
            ? '<div><div class="section-label">' + items.length + (items.length === 1 ? ' transaction' : ' transactions') + '</div>' +
              '<div class="settings-group">' + items.map(item => leakTransactionHTML(item, symbol)).join('') + '</div></div>' +
              '<p class="info-note">Estimates, compared with the European Central Bank\'s rate for each day.</p>'
            : ''));
}

// Redraws the page after a change, staying at the same scroll position.
function refreshLeakPage() {
    const page = document.getElementById('info-content'), top = page.scrollTop;
    openLeakPage();
    page.scrollTop = top;
}

function setLeakDays(days) {
    leakDays = days;
    leakSelectedBar = null;
    refreshLeakPage();
    renderInsightsTab();
}

// Tapping a bar shows its amount under the chart; tapping it again hides it.
function selectLeakBar(index) {
    leakSelectedBar = leakSelectedBar === index ? null : index;
    refreshLeakPage();
}

// Tapping a bank shows only its transactions; tapping it again shows them all.
function toggleLeakAccount(id) {
    leakListAccount = leakListAccount === id ? null : id;
    refreshLeakPage();
}

function openLeakTransaction(id, accountId) {
    const top = document.getElementById('info-content').scrollTop;
    openTransaction(id, accountId, () => {
        openLeakPage();
        document.getElementById('info-content').scrollTop = top;
    });
}
