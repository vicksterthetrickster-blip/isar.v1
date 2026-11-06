// snapshots.js — records one net-worth snapshot per day, so history builds up over time.
//
// A snapshot has exactly the same shape as a HISTORY record:
//   { date: 'YYYY-MM-DD', balances: { accountId: native balance }, rates: { AUD: 1, USD: ... } }
// Saved in SAVED.snapshots (localStorage). Opening the app several times in one
// day overwrites that day's snapshot, so each day keeps its latest numbers.
//
// With real bank connections, the backend would record these instead (once a day
// after syncing with the bank, even when the app is closed) and the app would load
// them from the server in this same shape.

// Today's (or any date's) record, built from live ACCOUNTS balances and current rates.
function buildSnapshot(date) {
    const balances = {};
    ACCOUNTS.forEach(a => { balances[a.id] = a.balance; });
    return { date: date, balances: balances, rates: Object.assign({}, EXCHANGE_RATES) };
}

// Saves today's snapshot. Called on start-up, after rates refresh, and after a bank is linked or removed.
function recordDailySnapshot() {
    const snapshot = buildSnapshot(localISODate(new Date()));
    const list = SAVED.snapshots;
    const last = list[list.length - 1];
    if (last && last.date === snapshot.date) list[list.length - 1] = snapshot;
    else list.push(snapshot);
    saveData();
}

// The daily summary: once a day, when the app opens, a short message with how your net worth
// changed since the last record. Compares like-for-like, so a new bank doesn't count as a gain.
// (Setting: "Daily summary" on the Account screen. Real push notifications need a server.)
function showDailySummary() {
    const today = localISODate(new Date());
    if (!USER_SETTINGS.notifications || SAVED.lastSummaryDate === today || !ACCOUNTS.length) return;
    const { records } = getRecordsInWindow('All Time');
    if (records.length < 2) return;
    const latest = records[records.length - 1], previous = records[records.length - 2];
    const kept = accountsInBoth(previous, latest);
    const from = getRecordTotal(previous, activeCurrency, kept), to = getRecordTotal(latest, activeCurrency, kept);
    if (from === null || to === null || to === from) return;
    SAVED.lastSummaryDate = today;
    saveData();
    showToast('Net worth ' + (to > from ? 'up ' : 'down ') + CURRENCY_META[activeCurrency].symbol + formatMoney(Math.abs(to - from)) + ' since ' + formatGraphDate(previous.t, true));
}
