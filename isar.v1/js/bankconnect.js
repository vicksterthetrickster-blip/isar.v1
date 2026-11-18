// bankconnect.js — connecting a real bank from inside Isar, read-only.
//
// The three steps, from the app's side:
//   1. You pick your bank         -> openBankConnect(), startBankConnect()
//   2. You approve at the bank    -> you leave Isar, then come back with a code
//   3. Isar saves it and syncs    -> finishBankConnect(), syncConnectedBanks()
//
// Isar never sees your bank password: you type it on the bank's own website. What comes
// back is a limited pass that can only READ the accounts you approved, and the server
// files it under YOUR Isar account only (see api/bank-complete.js).

// The bank's one-time code waits here until you're signed in. The bank may send you back to a
// different browser than the one you left from (on iPhone: Safari instead of the home-screen
// app), where you may need to sign in first. The server-signed `state` travels with it and
// proves which Isar account started the connection (api/bank-complete.js checks it).
const BANK_RETURN_KEY = 'isar.pendingBankReturn';
const BANK_RETURN_MAX_AGE_MS = 25 * 60 * 1000;    // the server's ticket lasts 30 minutes
const BANK_COUNTRY_KEY = 'isar.bankCountry';      // the country last picked in "Connect a bank"

// Countries Isar can connect today (Enable Banking covers Europe; BankSync covers Australia,
// for the owner only: anyone else picking Australia is told it isn't available).
const BANK_COUNTRIES = [
    ['AU', '🇦🇺 Australia'], ['ES', '🇪🇸 Spain'], ['GB', '🇬🇧 United Kingdom'], ['IE', '🇮🇪 Ireland'], ['LT', '🇱🇹 Lithuania'],
    ['FR', '🇫🇷 France'], ['DE', '🇩🇪 Germany'], ['IT', '🇮🇹 Italy'], ['PT', '🇵🇹 Portugal'],
    ['NL', '🇳🇱 Netherlands'], ['FI', '🇫🇮 Finland'], ['SE', '🇸🇪 Sweden'], ['NO', '🇳🇴 Norway'],
    ['DK', '🇩🇰 Denmark'], ['PL', '🇵🇱 Poland'], ['BE', '🇧🇪 Belgium'], ['AT', '🇦🇹 Austria']
];

// The phone's time zone says which country you're in right now, which is what matters for
// local banks (an Australian phone in Madrid should see Spanish banks).
const TIMEZONE_COUNTRY = {
    'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Africa/Ceuta': 'ES', 'Europe/London': 'GB',
    'Europe/Dublin': 'IE', 'Europe/Vilnius': 'LT', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
    'Europe/Rome': 'IT', 'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT', 'Atlantic/Azores': 'PT',
    'Europe/Amsterdam': 'NL', 'Europe/Helsinki': 'FI', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
    'Europe/Copenhagen': 'DK', 'Europe/Warsaw': 'PL', 'Europe/Brussels': 'BE', 'Europe/Vienna': 'AT',
    'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU',
    'Australia/Adelaide': 'AU', 'Australia/Hobart': 'AU', 'Australia/Darwin': 'AU'
};

function guessBankCountry() {
    try {
        const saved = localStorage.getItem(BANK_COUNTRY_KEY);
        if (BANK_COUNTRIES.some(c => c[0] === saved)) return saved;
    } catch (e) {}
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (TIMEZONE_COUNTRY[zone]) return TIMEZONE_COUNTRY[zone];
    } catch (e) {}
    return 'ES';
}

let bankConnectCountry = guessBankCountry();
let bankSyncRunning = false;
const bankListCache = {};          // country -> the request for its bank list (fetched once per visit)
let searchBankList = null;         // the real banks the Add tab and setup searches look through

// The provider supplies a logo for every bank; logos.js styles it like every other logo.
function connectableBankIcon(bank, size) {
    return bankIconHTML({ name: bank.name, color: '#1E1E24', logoUrl: bank.logo }, size);
}

// The pass proving who you are, which the server checks with Supabase before doing anything.
async function getAccessToken() {
    if (!SUPABASE_CLIENT) return null;
    try {
        const { data } = await SUPABASE_CLIENT.auth.getSession();
        return data.session ? data.session.access_token : null;
    } catch (e) {
        return null;
    }
}

async function callServer(path, options = {}) {
    const token = await getAccessToken();
    if (!token) throw new Error('Sign in to Isar first.');
    const reply = await fetch(path, {
        method: options.method || 'GET',
        headers: {
            authorization: 'Bearer ' + token,
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        cache: 'no-store'
    });
    const data = await reply.json().catch(() => null);
    if (!reply.ok || !data || !data.ok) throw new Error((data && data.error) || ('Server error ' + reply.status));
    return data;
}


// --- Step 1: pick a bank ---
function openBankConnect() {
    if (getSession() && getSession().demo) return showToast('Connecting banks needs a real account');
    openInfoScreen('Connect a bank',
        '<p class="info-note" style="text-align: left;">Pick your bank. You\'ll approve <strong>read-only</strong> access on the bank\'s own website — Isar never sees your password and can never move money.</p>' +
        '<div id="bank-problems"></div>' +      // problems from the last sync (renderBankProblems)
        '<label class="form-label">Country<select id="bank-country" class="form-select" onchange="pickBankCountry(this.value)">' +
            BANK_COUNTRIES.map(c => '<option value="' + c[0] + '"' + (c[0] === bankConnectCountry ? ' selected' : '') + '>' + c[1] + '</option>').join('') +
        '</select></label>' +
        '<input class="auth-input" id="bank-filter" type="search" placeholder="Search banks" oninput="renderBankChoices()" autocomplete="off">' +
        '<div id="bank-choices" class="setup-list"><p class="info-note">Loading banks…</p></div>');
    renderBankProblems();
    loadBanksForCountry(bankConnectCountry);
}

let bankChoices = [];

// Each bank comes with the provider that connects it; the server picks it by country.
// The sign-in pass goes along because some lists are private (Australia lists the owner's own
// BankSync banks, so the server checks who's asking).
function fetchBankList(country) {
    if (!bankListCache[country]) {
        bankListCache[country] = getAccessToken()
            .then(token => fetch('/api/banks?country=' + country, {
                cache: 'no-store',
                headers: token ? { authorization: 'Bearer ' + token } : {}
            }))
            .then(reply => reply.json())
            .then(data => {
                if (!data.ok) throw new Error(data.error || 'Could not load banks');
                return data.banks;
            })
            .catch(error => { delete bankListCache[country]; throw error; });
    }
    return bankListCache[country];
}

// Picking a country also points the Add tab search at it, and is remembered.
function pickBankCountry(country) {
    try { localStorage.setItem(BANK_COUNTRY_KEY, country); } catch (e) {}
    searchBankList = null;
    loadBanksForCountry(country);
}

async function loadBanksForCountry(country) {
    bankConnectCountry = country;
    bankChoices = [];
    const list = document.getElementById('bank-choices');
    if (list) list.innerHTML = '<p class="info-note">Loading banks…</p>';
    try {
        const banks = await fetchBankList(country);
        if (country !== bankConnectCountry) return;      // another country was picked meanwhile
        bankChoices = banks;
        renderBankChoices();
    } catch (error) {
        if (document.getElementById('bank-choices')) {
            document.getElementById('bank-choices').innerHTML = '<p class="info-note">' + escapeHTML(error.message) + '</p>';
        }
    }
}

function renderBankChoices() {
    const list = document.getElementById('bank-choices');
    if (!list) return;
    const search = (document.getElementById('bank-filter').value || '').toLowerCase();
    const shown = bankChoices.filter(b => b.name.toLowerCase().includes(search)).slice(0, 60);
    if (!shown.length) return list.innerHTML = '<p class="info-note">No banks found. Try another country or spelling.</p>';
    list.innerHTML = shown.map((bank, i) =>
        '<button class="setup-item" onclick="startBankConnect(' + bankChoices.indexOf(bank) + ')">' +
            connectableBankIcon(bank, 32) +
            '<span class="setup-item-name">' + escapeHTML(bank.name) + '<small>Read-only' +
                (bank.maxConsentDays ? ' · renew every ' + bank.maxConsentDays + ' days' : '') +
                (bank.note ? ' · ' + escapeHTML(bank.note) : '') + '</small></span>' +
            '<span class="setup-add">Connect</span>' +
        '</button>').join('');
}


// --- Searching real banks from the Add tab and setup ---
// Real banks in your country that match a search, best first, as { bank, index } (index into
// searchBankList). The list is fetched the first time you search; `redraw` runs when it arrives.
function connectableBankMatches(query, redraw) {
    if (!getSession() || getSession().demo) return [];
    if (!searchBankList) {
        fetchBankList(bankConnectCountry).then(banks => { searchBankList = banks; redraw(); }).catch(() => {});
        return [];
    }
    return searchBankList
        .map((bank, index) => ({ bank: bank, index: index, rank: bankMatchRank(bank, query) }))
        .filter(x => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.bank.name.length - b.bank.name.length)
        .slice(0, 8);
}

function startSearchedBankConnect(index) {
    document.getElementById('bank-results').style.display = 'none';
    connectToBank(searchBankList && searchBankList[index]);
}


// --- Step 2: off to the bank ---
function startBankConnect(index) {
    connectToBank(bankChoices[index]);
}

async function connectToBank(bank) {
    if (!bank) return;
    showToast('Opening ' + bank.name + '…');
    try {
        const data = await callServer('/api/bank-connect', { method: 'POST', body: { provider: bank.provider, name: bank.name, country: bank.country, bankId: bank.bankId } });
        // Leaving for a bank counts as finishing setup, so it doesn't start over on your return.
        if (isSetupOpen()) { SAVED.setupDone = true; saveData(); }
        // You may come back in another browser, which loads your data from your account.
        await flushCloudUpload();
        location.href = data.url;
    } catch (error) {
        showToast(error.message);
    }
}

// Back from the bank: the address carries ?code=…&state=… (or ?error=…).
// Runs first thing on start-up (main.js), signed in or not. Cleans the address and keeps the
// code until someone is signed in to finish with it.
function takeBankReturn() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    if (!(code && state) && !error) return;
    history.replaceState(null, '', location.pathname);
    if (error) return showToast('The bank didn\'t connect: ' + (params.get('error_description') || error));
    try { localStorage.setItem(BANK_RETURN_KEY, JSON.stringify({ code: code, state: state, at: Date.now() })); } catch (e) {}
}

function pendingBankReturn() {
    try {
        const pending = JSON.parse(localStorage.getItem(BANK_RETURN_KEY));
        if (pending && pending.code && Date.now() - pending.at < BANK_RETURN_MAX_AGE_MS) return pending;
        localStorage.removeItem(BANK_RETURN_KEY);
    } catch (e) {}
    return null;
}

// Signed in: saves the waiting connection to your account.
async function finishBankConnect() {
    const pending = pendingBankReturn();
    if (!pending) return false;
    if (getSession().demo) {
        try { localStorage.removeItem(BANK_RETURN_KEY); } catch (e) {}
        showToast('Connecting banks needs a real account');
        return false;
    }

    showToast('Saving your connection…');
    try {
        const data = await callServer('/api/bank-complete', { method: 'POST', body: { code: pending.code, state: pending.state } });
        const message = data.bank + ' connected · ' + data.accounts.length + (data.accounts.length === 1 ? ' account' : ' accounts');
        // On iPhone the bank returns you to Safari, not the home-screen app. The connection is
        // saved to your account, so the app shows it too once you go back to it.
        if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone) {
            showNotice(message, 'It\'s saved to your Isar account. If you use Isar from your home screen, you can go back to it now — the bank will be there.');
        } else {
            showToast(message);
        }
        return true;
    } catch (e) {
        showToast(e.message);
        return false;
    } finally {
        try { localStorage.removeItem(BANK_RETURN_KEY); } catch (e) {}   // a code only works once
    }
}


// --- Transactions for a connected account ---
// Banks allow only about four background reads a day (PSD2), so each account is read at most
// every 6 hours. The first read asks for 2 years; many banks only give 90 days outside the
// minutes after you approve them, so it falls back to that. Later reads go back a few days,
// so pending payments that have since gone through are replaced, not doubled.
const BANK_TX_REFRESH_MS = 6 * 60 * 60 * 1000;
const BANK_TX_FIRST_DAYS = [730, 89];
const BANK_TX_OVERLAP_DAYS = 10;
const BANK_TX_RETRY_MS = 30 * 60 * 1000;     // after a refusal, wait before asking the bank again
const bankTxFailedAt = {};                     // account uid -> when its last read failed (this visit)

function isoDaysAgo(days) {
    const day = new Date();
    day.setDate(day.getDate() - days);
    return localISODate(day);
}

// Raised when the server starts sending something new with each transaction, so transactions
// saved before then are read again in full once. 2 = each transaction's own currency (18 Nov).
const BANK_TX_VERSION = 2;

async function syncBankTransactions(account) {
    const first = !Array.isArray(account.transactions) || account.txVersion !== BANK_TX_VERSION;
    if (!first && account.txFetchedAt && Date.now() - account.txFetchedAt < BANK_TX_REFRESH_MS) return false;
    const key = account.provider + ':' + account.bankAccountId;
    if (bankTxFailedAt[key] && Date.now() - bankTxFailedAt[key] < BANK_TX_RETRY_MS) return false;

    const tries = first ? BANK_TX_FIRST_DAYS.map(isoDaysAgo) : [isoDaysAgo(BANK_TX_OVERLAP_DAYS)];
    let lastError = '';
    for (const [i, from] of tries.entries()) {
        try {
            const data = await callServer('/api/bank-transactions?provider=' + encodeURIComponent(account.provider) +
                '&uid=' + encodeURIComponent(account.bankAccountId) + '&from=' + from);
            if (!data.transactions.length && i < tries.length - 1) continue;   // some banks answer a too-long range with nothing
            const kept = (account.transactions || []).filter(t => t.date < from);
            account.transactions = kept.concat(data.transactions);
            account.txFetchedAt = Date.now();
            account.txVersion = BANK_TX_VERSION;
            if (!account.txCoveredFrom) account.txCoveredFrom = isoDaysAgo(BANK_TX_SURE_DAYS);
            delete account.txError;
            delete bankTxFailedAt[key];
            return true;
        } catch (e) {
            lastError = e.message;
            if (lastError === 'consent_expired') break;
        }
    }
    // Kept on the account and shown under its transactions, so a refusal is never silent.
    bankTxFailedAt[key] = Date.now();
    const changed = account.txError !== lastError;
    account.txError = lastError;
    return changed;
}

// --- Past balances, worked out from transactions ---
// A connected account's history starts the day you connect it, so its graph had one point and
// said "Not enough history". Its transactions go back further, and they pin down every earlier
// balance exactly, walking backwards from the first balance Isar saw:
//   balance at the end of a day = first balance seen − every transaction after that day
// That gives one point per day with transactions, plus one where the bank's data starts. The
// points are marked `fromTransactions` and rebuilt from scratch after each sync, so they never
// pile up or go stale. Balances Isar actually saw are never changed.
const BANK_TX_SURE_DAYS = BANK_TX_FIRST_DAYS[BANK_TX_FIRST_DAYS.length - 1];   // every bank gives at least this much
// Balance types that already include payments still pending. With any other (a "current" or
// booked balance), pending payments aren't in the balance yet, so they're left out of the walk.
const BALANCE_TYPES_WITH_PENDING = ['CLAV', 'ITAV', 'XPCD', 'AVAILABLE'];

function rebuildHistoryFromTransactions(account) {
    if (!Array.isArray(account.transactions) || !Array.isArray(account.history)) return false;
    const seen = account.history.filter(h => h && !h.fromTransactions && typeof h.balance === 'number');
    if (!seen.length) return false;
    const anchor = seen[0];
    if (!account.txCoveredFrom) account.txCoveredFrom = isoDaysAgo(BANK_TX_SURE_DAYS);   // read before this was saved

    const movedOn = {};                                  // date -> that day's total in and out
    countedTransactions(account).forEach(t => {
        // On a multi-currency card, only the transactions in this balance's own currency.
        if (t.date > anchor.date || (account.cardCurrencies && transactionCurrency(t, account) !== account.currency)) return;
        movedOn[t.date] = (movedOn[t.date] || 0) + t.amount;
    });
    const days = Object.keys(movedOn).sort();
    const start = transactionDataStart(account);

    const worked = [];
    let balance = anchor.balance;
    for (let i = days.length - 1; i >= 0; i--) {         // newest day first, stepping back in time
        if (days[i] < anchor.date) worked.push({ date: days[i], balance: Math.round(balance * 100) / 100, fromTransactions: true });
        balance -= movedOn[days[i]];                      // undo that day: now it's the day before's closing balance
    }
    if (start < anchor.date) worked.push({ date: start, balance: Math.round(balance * 100) / 100, fromTransactions: true });

    const history = worked.reverse().concat(seen);
    if (JSON.stringify(history) === JSON.stringify(account.history)) return false;
    account.history = history;
    return true;
}

// The transactions that move the balance: real amounts with a date, leaving out pending ones
// when the bank's balance doesn't include them yet.
function countedTransactions(account) {
    const pendingInBalance = BALANCE_TYPES_WITH_PENDING.includes(String(account.balanceType || '').toUpperCase());
    return (account.transactions || []).filter(t => t && typeof t.amount === 'number' && isFinite(t.amount) &&
        typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && (pendingInBalance || t.category !== 'Pending'));
}

// A transaction's currency. One the bank didn't label belongs to the account's main balance.
function transactionCurrency(t, account) {
    return t.currency || account.currency;
}

// How far back the bank's data surely reaches: the day before the oldest transaction, or the
// stretch every bank gives, whichever is earlier. Before that, Isar doesn't know.
function transactionDataStart(account) {
    if (!account.txCoveredFrom) account.txCoveredFrom = isoDaysAgo(BANK_TX_SURE_DAYS);   // read before this was saved
    const oldest = (account.transactions || []).reduce((min, t) => t && typeof t.date === 'string' && t.date < min ? t.date : min, '9999');
    const dayBeforeOldest = oldest === '9999' ? null : shiftISODate(oldest, -1);
    return dayBeforeOldest && dayBeforeOldest < account.txCoveredFrom ? dayBeforeOldest : account.txCoveredFrom;
}

// --- Multi-currency cards (e.g. CommBank Travel Money) ---
// BankSync gives a multi-currency card ONE balance with no currency (so it reads as AUD) and
// drops the others. But every transaction says its own currency. So when one account's
// transactions come in two or more currencies, Isar treats it as a card and shows one account
// per currency:
//   - The MAIN currency is the one the bank's single balance is in. That balance stays exactly
//     as the bank gives it; only its label is corrected.
//   - Every OTHER currency's balance is added up from its transactions: top-ups in, spending out,
//     and a conversion counts as money out of one currency and into the other:
//         balance = every transaction in that currency, starting from 0
//     Starting from 0 is right when the bank's data reaches back to when that currency was first
//     loaded. If it doesn't, the total can come out below zero, which a prepaid card can't be,
//     so that's reported as a problem instead of shown silently.
// Each extra currency is its own account (`purseOf` = the card's account), so net worth, the
// graphs, the Globe and the bank screen all include it. Transactions are saved once, on the card.
function splitMultiCurrencyCard(account, problems) {
    if (!Array.isArray(account.transactions) || account.purseCurrency) return false;   // the bank already splits it
    const sums = {};                                     // currency -> total of its transactions
    const unsupported = new Set();
    countedTransactions(account).forEach(t => {
        if (!t.currency) return;                         // no label: part of the main balance
        if (!CURRENCY_META[t.currency]) { unsupported.add(t.currency); return; }
        sums[t.currency] = (sums[t.currency] || 0) + t.amount;
    });
    unsupported.forEach(c => problems.push(account.name + ': has transactions in ' + c + ', which Isar doesn\'t support yet, so they aren\'t counted.'));
    const currencies = Object.keys(sums).sort();
    const reported = account.reportedCurrency || account.currency;
    let changed = false;
    const set = (key, value) => {
        if (JSON.stringify(account[key]) === JSON.stringify(value)) return;
        if (value === undefined) delete account[key]; else account[key] = value;
        changed = true;
    };

    // Which currency the bank's single balance is in: one you set yourself; else the bank's own
    // label when it's a real one (not the AUD it says when it says nothing); else the currency
    // whose transactions alone best explain that balance (the one needing the smallest starting
    // amount, ideally 0).
    let main = account.currencyFixed;
    if (!main && reported && reported !== 'AUD' && (sums[reported] !== undefined || !currencies.length)) main = reported;
    // Once chosen, it stays (unless it disappears), so the accounts don't swap round between syncs.
    if (!main && account.mainCurrency && sums[account.mainCurrency] !== undefined) main = account.mainCurrency;
    if (!main && currencies.length) {
        main = currencies.slice().sort((a, b) => Math.abs(account.balance - sums[a]) - Math.abs(account.balance - sums[b]))[0];
    }
    if (!main) main = reported;

    if (currencies.length < 2) {
        // An ordinary account. If all its transactions are in one currency that isn't the label
        // (e.g. a CNY balance the bank called AUD), the label is corrected.
        set('mainCurrency', currencies.length === 1 && currencies[0] !== reported && !account.currencyFixed ? currencies[0] : undefined);
        if (account.cardName && account.parentName === account.cardName) set('parentName', undefined);
        set('cardCurrencies', undefined);
        set('cardName', undefined);
        if (!account.currencyFixed) {
            const label = account.mainCurrency || reported;
            if (label && account.currency !== label) { account.currency = label; changed = true; }
        }
        return changed;
    }

    const cardName = account.cardName || account.name;
    set('cardName', cardName);
    set('parentName', cardName);
    set('cardCurrencies', currencies);
    set('mainCurrency', account.currencyFixed ? undefined : main);
    if (account.currency !== main) { account.currency = main; changed = true; }

    const start = transactionDataStart(account);
    const today = localISODate(new Date());
    currencies.filter(c => c !== main).forEach(currency => {
        const id = account.id + ':' + currency;
        let purse = ACCOUNTS.find(a => a.id === id);
        if (!purse) {
            purse = {
                id: id,
                purseOf: account.id,                     // the card it's one currency of
                provider: account.provider,
                connectionId: account.connectionId,
                bankCountry: account.bankCountry,
                bankName: account.bankName,
                name: cardName + ' · ' + currency,
                type: 'Worked out from transactions',
                letter: account.letter,
                color: account.color,
                logoUrl: account.logoUrl,
                currency: currency,
                addedDate: account.addedDate,
                historySource: 'bank',
                userLinked: true
            };
            ACCOUNTS.push(purse);
            changed = true;
        }
        Object.assign(purse, { parentName: cardName, connectionId: account.connectionId, logoUrl: account.logoUrl });
        const history = purseHistory(account, currency, start, today, purse.opening || 0);
        const balance = history[history.length - 1].balance;
        if (purse.balance !== balance || JSON.stringify(purse.history) !== JSON.stringify(history)) {
            purse.balance = balance;
            purse.history = history;
            changed = true;
        }
        if (balance < 0) {
            problems.push(purse.name + ': worked out from transactions since ' + formatGraphDate(Date.parse(start + 'T00:00:00Z'), true) +
                ', it comes to below zero, so the bank\'s data doesn\'t reach back to when this currency was loaded. ' +
                'Open it and use Update balance once with what the CommBank app shows; Isar keeps adding up from there.');
        }
    });
    // A currency the card no longer has.
    for (let i = ACCOUNTS.length - 1; i >= 0; i--) {
        const a = ACCOUNTS[i];
        if (a.purseOf === account.id && (a.currency === main || !currencies.includes(a.currency))) {
            ACCOUNTS.splice(i, 1);
            changed = true;
        }
    }
    return changed;
}

// One currency of a card, day by day: `opening` where the data starts (0, unless you corrected
// it once with Update balance), then each day's transactions added on. Rebuilt in full every
// sync, so it always matches the transactions.
function purseHistory(card, currency, start, today, opening) {
    const movedOn = {};
    countedTransactions(card).forEach(t => {
        if (t.currency === currency && t.date <= today) movedOn[t.date] = (movedOn[t.date] || 0) + t.amount;
    });
    const days = Object.keys(movedOn).sort();
    const history = [];
    let balance = opening;
    if (!days.length || start < days[0]) history.push({ date: start, balance: Math.round(opening * 100) / 100 });
    days.forEach(day => {
        balance += movedOn[day];
        history.push({ date: day, balance: Math.round(balance * 100) / 100 });
    });
    if (history[history.length - 1].date < today) history.push({ date: today, balance: history[history.length - 1].balance });
    return history;
}

// A card's extra currency goes when its card does (removed, or no longer at the bank).
function removeOrphanCurrencies() {
    let removed = false;
    for (let i = ACCOUNTS.length - 1; i >= 0; i--) {
        const a = ACCOUNTS[i];
        if (!a.purseOf || ACCOUNTS.some(card => card.id === a.purseOf)) continue;
        ACCOUNTS.splice(i, 1);
        if (openAccountId === a.id) closeAccount();
        removed = true;
    }
    return removed;
}

function shiftISODate(iso, days) {
    const day = new Date(iso + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
}

// --- Step 3: keep balances fresh ---
// Turns each synced bank account into an Isar account, matched by its provider and
// `bankAccountId` so the same account is updated rather than duplicated. From here on it behaves like any other account:
// net worth, graphs, the Globe and snapshots all include it automatically.
//
// THE RULE THIS FUNCTION KEEPS: every account the server knows about either shows in Isar or
// shows up as a problem you can read. Nothing is ever dropped silently. (It used to be: an
// account with an error, no balance or an unknown currency was skipped without a word, which
// looked exactly like "connected but missing", first with Enable Banking, then BankSync.)
let bankSyncProblems = [];              // the latest sync's problems, also listed in "Connect a bank"
const bankProblemsShown = new Set();    // shown in a pop-up once per visit, not every 5 minutes

async function syncConnectedBanks() {
    if (bankSyncRunning || !getSession() || getSession().demo) return;
    bankSyncRunning = true;
    try {
        // Wait for the online comparison (cloud.js), or the accounts added here could be replaced.
        if (!(await cloudSettled())) return;

        let data;
        try {
            data = await callServer('/api/bank-sync');
        } catch (e) {
            // No internet: try again later, quietly. Anything else is a real problem: show it.
            if (e instanceof TypeError || !navigator.onLine) return;
            reportBankProblems(['Couldn\'t update your banks: ' + e.message]);
            return;
        }

        let changed = false;
        let needsReconnect = false;
        const problems = [];

        data.accounts.forEach(incoming => {
            // Each account on its own: one bad account can't stop the others from showing.
            try {
                const problem = applyIncomingAccount(incoming);
                if (problem === 'consent_expired') needsReconnect = true;
                else if (problem === 'changed') changed = true;
                else if (problem) problems.push(problem);
            } catch (e) {
                problems.push(bankAccountLabel(incoming) + ': ' + e.message);
            }
        });
        if (removeAccountsNoLongerListed(data.accounts)) changed = true;

        for (const account of ACCOUNTS.filter(a => a.bankAccountId)) {
            if (await syncBankTransactions(account)) changed = true;
            if (splitMultiCurrencyCard(account, problems)) changed = true;
            if (rebuildHistoryFromTransactions(account)) changed = true;
        }
        if (removeOrphanCurrencies()) changed = true;

        if (changed) { saveLinkedAccounts(); refreshAfterAccountChange(); refreshAccountTransactions(); }
        if (needsReconnect) showToast('A bank needs approving again. Reconnect it in the Add tab (Australian banks: in the BankSync app).');
        reportBankProblems(problems);
    } finally {
        bankSyncRunning = false;
    }
}

// Puts one account from the server into Isar. Returns 'changed', nothing (no change), or a
// readable problem.
function applyIncomingAccount(incoming) {
    if (incoming.error === 'consent_expired') return 'consent_expired';
    if (incoming.error) return bankAccountLabel(incoming) + ': ' + bankErrorText(incoming.error);
    if (typeof incoming.balance !== 'number' || !Number.isFinite(incoming.balance)) {
        return bankAccountLabel(incoming) + ': the bank didn\'t send a balance.';
    }
    const existing = ACCOUNTS.find(a => a.provider === incoming.provider && a.bankAccountId === incoming.uid);
    // Which currency the balance is in, most trusted first: one you set yourself (Edit on the
    // account screen), then the one Isar worked out from the account's own transactions
    // (splitMultiCurrencyCard), then the bank's label, which says AUD whenever it says nothing.
    const reported = String(incoming.currency || '').toUpperCase();
    const currency = (existing && (existing.currencyFixed || existing.mainCurrency)) || reported;
    if (!CURRENCY_META[currency]) {
        return bankAccountLabel(incoming) + ': Isar doesn\'t support the currency "' + (incoming.currency || 'none') + '" yet.';
    }

    if (existing) {
        let changed = false;
        // The card it's one currency of: from the bank, or from Isar finding several currencies in it.
        const parentName = incoming.parent || existing.cardName || undefined;
        if (parentName !== existing.parentName) { existing.parentName = parentName; changed = true; }
        if (existing.reportedCurrency !== reported) { existing.reportedCurrency = reported; changed = true; }
        if (existing.logoUrl !== incoming.logo) { existing.logoUrl = incoming.logo; changed = true; }
        // Which bank login it belongs to, so the home list shows one row per bank (accounts.js).
        if (incoming.connectionId && existing.connectionId !== incoming.connectionId) { existing.connectionId = incoming.connectionId; changed = true; }
        if (incoming.country && existing.bankCountry !== incoming.country) { existing.bankCountry = incoming.country; changed = true; }
        // The bank corrected the account's currency (e.g. Revolut's THB account first arrived
        // labelled AUD). Its amounts were always in the real currency, so only the label changes;
        // its history and transactions stay as they are.
        if (existing.currency !== currency) { existing.currency = currency; changed = true; }
        // Which kind of balance the bank gives decides whether pending payments are in it (see
        // rebuildHistoryFromTransactions).
        if (incoming.balanceType && existing.balanceType !== incoming.balanceType) { existing.balanceType = incoming.balanceType; changed = true; }
        if (existing.balance !== incoming.balance) {
            existing.balance = incoming.balance;
            recordBalanceToday(existing);       // keeps its history, same as a typed update
            changed = true;
        }
        return changed ? 'changed' : null;
    }

    const bankName = String(incoming.bank || 'Bank');
    const today = localISODate(new Date());
    ACCOUNTS.push({
        id: incoming.provider + '-' + incoming.uid,
        provider: incoming.provider,
        bankAccountId: incoming.uid,
        connectionId: incoming.connectionId,
        bankCountry: incoming.country,
        parentName: incoming.parent || undefined,      // the card it's one currency of (accounts.js)
        bankName: bankName,
        name: incoming.name || bankName,
        type: 'Connected account',
        letter: (Array.from(bankName)[0] || 'B').toUpperCase(),
        color: '#1E1E24',
        logoUrl: incoming.logo,
        balance: incoming.balance,
        currency: currency,
        reportedCurrency: reported,
        balanceType: incoming.balanceType,
        addedDate: today,
        history: [{ date: today, time: currentTimeHHMM(), balance: incoming.balance }],
        historySource: 'bank',
        userLinked: true
    });
    return 'changed';
}

// "What BankSync sends": the provider's own data for this bank, exactly as it arrives, so a
// reading problem (a wrong currency, a missing balance) can be seen instead of guessed.
// Account numbers are cut to the last 4 by the server.
async function showBankRawData(connectionId) {
    openInfoScreen('What BankSync sends', '<p class="info-note">Loading…</p>');
    try {
        const data = await callServer('/api/bank-raw?connection=' + encodeURIComponent(connectionId));
        document.getElementById('info-content').innerHTML =
            '<p class="info-note" style="text-align: left;">Exactly what BankSync sends Isar for ' + escapeHTML(data.bank) +
            ', one block per account. Isar reads <strong>balance</strong> and <strong>currency</strong>, and a list of currencies if a card has one.</p>' +
            '<pre style="white-space: pre-wrap; word-break: break-all; font-size: 11px; color: #D4D4D8; background: #121216; border: 1px solid #27272A; border-radius: 12px; padding: 12px; user-select: text; -webkit-user-select: text;">' +
                escapeHTML(JSON.stringify(data.accounts, null, 2)) + '</pre>';
    } catch (e) {
        document.getElementById('info-content').innerHTML = '<p class="info-note">' + escapeHTML(e.message) + '</p>';
    }
}

// An account the bank no longer lists (e.g. the old single Travel Money account, now split
// into one account per currency) is removed, but only when its bank answered this time, so a
// bank that's down never makes accounts disappear.
function removeAccountsNoLongerListed(incomingList) {
    const listed = new Set(incomingList.filter(i => i.uid).map(i => i.provider + ':' + i.uid));
    const answered = new Set(incomingList.filter(i => i.uid && i.connectionId).map(i => i.connectionId));
    let removed = false;
    for (let i = ACCOUNTS.length - 1; i >= 0; i--) {
        const a = ACCOUNTS[i];
        if (!a.bankAccountId || !a.connectionId || !answered.has(a.connectionId)) continue;
        if (listed.has(a.provider + ':' + a.bankAccountId)) continue;
        ACCOUNTS.splice(i, 1);
        if (openAccountId === a.id) closeAccount();
        removed = true;
    }
    return removed;
}

function bankAccountLabel(incoming) {
    return (incoming.bank || 'A bank') + (incoming.name ? ' · ' + incoming.name : '');
}

function bankErrorText(error) {
    return {
        no_accounts: 'connected, but no accounts were saved. Connect it again in the Add tab.',
        unknown_provider: 'Isar doesn\'t recognise how this bank is connected.'
    }[error] || error;
}

// Problems show in a pop-up the first time they appear in a visit, and stay listed in
// "Connect a bank" for as long as they last.
function reportBankProblems(problems) {
    bankSyncProblems = problems;
    renderBankProblems();
    const fresh = problems.filter(p => !bankProblemsShown.has(p));
    if (!fresh.length) return;
    fresh.forEach(p => bankProblemsShown.add(p));
    showNotice(fresh.length === 1 ? 'A bank account couldn\'t update' : fresh.length + ' bank accounts couldn\'t update', fresh.map(p => '• ' + p).join(' '));
}

function renderBankProblems() {
    const box = document.getElementById('bank-problems');
    if (!box) return;
    box.innerHTML = bankSyncProblems.length
        ? '<p class="info-note" style="text-align: left; color: #FF6B6B;">' + bankSyncProblems.map(escapeHTML).join('<br>') + '</p>'
        : '';
}
