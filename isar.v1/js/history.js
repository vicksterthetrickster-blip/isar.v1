// history.js — turns HISTORY records (historynetworth.js) into graph data.

function getRecordTotalAUD(record) {
    let total = 0;
    for (const account of ACCOUNTS) {
        const rate = record.rates[account.currency];
        if (!rate) return null;                       // cannot value this record safely
        total += (record.balances[account.id] || 0) / rate;
    }
    return total;
}

function getRecordTotal(record, code) {
    const aud = getRecordTotalAUD(record);
    const rate = record.rates[code];
    if (aud === null || !rate) return null;
    return aud * rate;
}

        // The "today" line is built in memory from live ACCOUNTS balances and current rates.
function getHistoryRecords() {
    if (typeof HISTORY === 'undefined' || !HISTORY.length) return [];
    const records = HISTORY.slice();
    const now = new Date();
    const todayISO = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    const balances = {};
    ACCOUNTS.forEach(a => { balances[a.id] = a.balance; });
    const live = { balances: balances, rates: Object.assign({}, EXCHANGE_RATES) };

    const newest = records[records.length - 1];
    if (newest.date >= todayISO) records[records.length - 1] = Object.assign({ date: newest.date }, live);
    else records.push(Object.assign({ date: todayISO }, live));
    return records;
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

// Turns history records into graph points for a chosen timeframe.
// `valueOf(record)` returns the value to plot for that record, or null to skip it.
// `clipped` is true when the timeframe reaches back further than the data does.
function buildSeries(valueOf, label) {
    const { records, clipped } = getRecordsInWindow(label);
    const points = records.map(r => ({ t: r.t, value: valueOf(r) })).filter(p => p.value !== null);
    return { points, clipped: clipped && points.length === records.length };
}

// Total net worth over time, in the chosen currency.
function getHistorySeries(code, label) {
    return buildSeries(r => getRecordTotal(r, code), label);
}

// One account's balance on a record's date, valued in `code` using THAT record's rates.
function getAccountRecordValue(record, account, code) {
    const balance = record.balances[account.id];
    const fromRate = record.rates[account.currency];
    const toRate = record.rates[code];
    if (balance === undefined || !fromRate || !toRate) return null;
    return balance / fromRate * toRate;
}

function getAccountSeries(account, code, label) {
    return buildSeries(r => getAccountRecordValue(r, account, code), label);
}

// Change over the most recent month of history, in the chosen currency.
function getPastMonthChange(code) {
    const points = getHistorySeries(code, 'All Time').points;
    if (points.length < 2) return null;
    const latest = points[points.length - 1];
    const cutoff = new Date(latest.t);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
    const start = points.find(p => p.t >= cutoff.getTime());
    if (!start || start === latest || start.value <= 0) return null;
    return { amount: latest.value - start.value, pct: (latest.value - start.value) / start.value * 100 };
}
