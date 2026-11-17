// history.js — turns HISTORY records (historynetworth.js) into graph data.
//
// A record only counts an account if it has a balance for it. An account with no
// balance on a date simply didn't exist yet: it is skipped, never counted as 0.

// Total of `accounts` (default: all) in AUD, using the record's own rates.
function getRecordTotalAUD(record, accounts) {
    let total = 0;
    for (const account of accounts || ACCOUNTS) {
        const balance = record.balances[account.id];
        if (balance === undefined) continue;          // account didn't exist on this date
        const rate = record.rates[account.currency];
        if (!rate) return null;                       // cannot value this record safely
        total += balance / rate;
    }
    return total;
}

function getRecordTotal(record, code, accounts) {
    const aud = getRecordTotalAUD(record, accounts);
    const rate = record.rates[code];
    if (aud === null || !rate) return null;
    return aud * rate;
}

// The accounts that have a balance in BOTH records. Comparing only these keeps a
// change like-for-like, so linking a bank never shows up as growth.
function accountsInBoth(a, b) {
    return ACCOUNTS.filter(acc => a.balances[acc.id] !== undefined && b.balances[acc.id] !== undefined);
}

// A linked account's balance on a date, from its own history: the latest point
// on or before that date, or null if its history starts later.
// Made-up (mock) history from before the account was added only counts while sample data is shown.
// History is oldest first, so this halves the search each step instead of reading every
// point (a bank account can have hundreds, and this runs for every date on the graph).
function getBalanceOnDate(account, date) {
    if (!USER_SETTINGS.showSampleData && account.historySource === 'mock' && date < account.addedDate) return null;
    const list = account.history;
    let low = 0, high = list.length - 1, index = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (list[middle] && list[middle].date <= date) { index = middle; low = middle + 1; }
        else high = middle - 1;
    }
    for (; index >= 0; index--) {
        if (list[index] && typeof list[index].balance === 'number') return list[index].balance;
    }
    return null;
}

// The percentage change from `from` to `to`, measured against the SIZE of `from`. So a debt
// that shrinks (−1,000 → −800) is +20%, the same direction as the money. Null when there's
// nothing to compare against (a start of 0 would divide by zero and show "NaN%" or "∞%").
function percentChange(from, to) {
    if (typeof from !== 'number' || typeof to !== 'number' || !isFinite(from) || !isFinite(to) || from === 0) return null;
    return (to - from) / Math.abs(from) * 100;
}

// All history, oldest first: sample HISTORY (only while sample data is shown), then the
// user's saved daily snapshots, then today built live from ACCOUNTS. If two share a date,
// the later source wins. Records that don't include a linked account get its balance from
// that account's history.
// Days when one of your accounts has a known balance but no snapshot was saved (e.g. balances
// worked out from a bank's transactions, bankconnect.js) become points too.
// Every record is valued at ITS OWN day's exchange rates: a snapshot's saved rates, filled in
// from the saved rate history (rates.js) for any it lacks. Today's rate is only the last resort.
function getHistoryRecords() {
    const byDate = {};
    if (USER_SETTINGS.showSampleData && typeof HISTORY !== 'undefined') HISTORY.forEach(r => { byDate[r.date] = r; });
    SAVED.snapshots.forEach(r => { byDate[r.date] = r; });
    const today = buildSnapshot(localISODate(new Date()));
    byDate[today.date] = today;

    ACCOUNTS.filter(a => a.userLinked && a.historySource !== 'mock' && Array.isArray(a.history)).forEach(a => {
        a.history.forEach(h => {
            if (h && typeof h.date === 'string' && h.date < today.date && !byDate[h.date]) byDate[h.date] = { date: h.date, balances: {}, rates: {} };
        });
    });

    const withHistory = ACCOUNTS.filter(a => Array.isArray(a.history) && a.history.length);
    return Object.keys(byDate).sort().map(date => {
        const record = byDate[date];
        const rates = Object.assign({}, EXCHANGE_RATES, getRatesOnDate(date), record.rates);
        const balances = Object.assign({}, record.balances);
        withHistory.filter(a => balances[a.id] === undefined).forEach(a => {
            const balance = getBalanceOnDate(a, date);
            if (balance !== null) balances[a.id] = balance;
        });
        return { date: record.date, balances: balances, rates: rates };
    });
}
// The raw history records that fall inside a timeframe, oldest first.
// `clipped` is true when the timeframe reaches back further than the data does.
function getRecordsInWindow(label) {
    const records = getHistoryRecords()
        .map(r => Object.assign({ t: Date.parse(r.date + 'T00:00:00Z') }, r))
        .filter(r => !isNaN(r.t))
        .sort((a, b) => a.t - b.t);
    if (!records.length) return { records: [], clipped: false };
    const months = TIMEFRAMES[label];
    if (months === null) return { records, clipped: false };
    const cutoff = new Date(records[records.length - 1].t);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    return { records: records.filter(r => r.t >= cutoff.getTime()), clipped: cutoff.getTime() < records[0].t };
}

// Total net worth over time, in the chosen currency. Each point has:
//   value: everything that existed on that date (what the line draws)
//   lfl:   like-for-like, only accounts that exist at BOTH ends of the window
//          (what growth %, the summary change and Performance stats use)
function getHistorySeries(code, label) {
    const { records, clipped } = getRecordsInWindow(label);
    if (!records.length) return { points: [], clipped: false };
    const kept = accountsInBoth(records[0], records[records.length - 1]);
    const points = records
        .map(r => ({ t: r.t, value: getRecordTotal(r, code), lfl: getRecordTotal(r, code, kept) }))
        .filter(p => p.value !== null && p.lfl !== null);
    return { points, clipped: clipped && points.length === records.length };
}

// One account's balance on a record's date, valued in `code` using THAT record's rates.
function getAccountRecordValue(record, account, code) {
    const balance = record.balances[account.id];
    const fromRate = record.rates[account.currency];
    const toRate = record.rates[code];
    if (balance === undefined || !fromRate || !toRate) return null;
    return balance / fromRate * toRate;
}

// A single account is always like-for-like with itself, so lfl equals value.
function getAccountSeries(account, code, label) {
    const { records, clipped } = getRecordsInWindow(label);
    const points = records
        .map(r => { const value = getAccountRecordValue(r, account, code); return { t: r.t, value: value, lfl: value }; })
        .filter(p => p.value !== null);
    return { points, clipped: clipped && points.length === records.length };
}

// Change over the most recent month of history, in the chosen currency (like-for-like).
function getPastMonthChange(code) {
    const { records } = getRecordsInWindow('All Time');
    if (records.length < 2) return null;
    const latest = records[records.length - 1];
    const cutoff = new Date(latest.t);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
    const start = records.find(r => r.t >= cutoff.getTime());
    if (!start || start === latest) return null;
    const kept = accountsInBoth(start, latest);
    const from = getRecordTotal(start, code, kept), to = getRecordTotal(latest, code, kept);
    const pct = percentChange(from, to);
    if (pct === null) return null;
    return { amount: to - from, pct: pct };
}
