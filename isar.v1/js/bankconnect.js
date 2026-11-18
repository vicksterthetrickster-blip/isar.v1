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
// 3 = amounts signed from credit/debit, pending links, `partial` (18 Nov, Travel Money fix).
const BANK_TX_VERSION = 3;

function isPendingTransaction(t) {
    return !!(t && (t.pending || t.category === 'Pending'));
}

// One copy of each transaction: the newest copy of an id wins, and a pending payment goes once
// the posted payment that replaces it has arrived (it names it in `replacesPending`). Without
// this, a payment could be counted twice: once pending, once posted.
function dedupeTransactions(list) {
    const byId = new Map();
    list.forEach(t => { if (t && t.id) byId.set(t.id, t); });
    const replaced = new Set();
    byId.forEach(t => { if (t.replacesPending) replaced.add(t.replacesPending); });
    return Array.from(byId.values()).filter(t => !(isPendingTransaction(t) && replaced.has(t.id)));
}

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
            // Older transactions stay, except pending ones: by now they've either gone through
            // (and arrived again as posted) or been cancelled, so keeping them would double count.
            const kept = (account.transactions || []).filter(t => t.date < from && !isPendingTransaction(t));
            account.transactions = dedupeTransactions(kept.concat(data.transactions));
            // The bank had more than the server was allowed to read: nothing is added up from it.
            account.txPartial = !!data.partial || (!first && !!account.txPartial);
            if (!account.txPartial) delete account.txPartial;
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
    // Transactions in several currencies, but Isar can't tell which one the balance is in: no
    // past balances at all, rather than ones mixing currencies (splitMultiCurrencyCard).
    const unsure = account.mixedCurrencies && !account.cardCurrencies;
    if (!unsure) countedTransactions(account).forEach(t => {
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
    if (start < anchor.date && !unsure) worked.push({ date: start, balance: Math.round(balance * 100) / 100, fromTransactions: true });

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
        typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && (pendingInBalance || !isPendingTransaction(t)));
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
// BankSync gives a multi-currency card ONE balance and drops the others, but every transaction
// says its own currency. THE RULE: only the bank's own balance is certain. Anything Isar works
// out from transactions is shown only when it passes every check below; otherwise it shows as
// "Unknown" with the reason, and counts as nothing in net worth. A wrong number is worse than
// no number. (The first version trusted the sums blindly and showed a $10,000 AUD balance made
// of every top-up ever loaded onto the card.)
//
// 1. MAIN currency = the one the bank's single balance is in. Your Currency pick (Edit) wins.
//    Otherwise each currency is tested: if the balance were in it, the money before the data
//    starts would be (balance − that currency's transactions), and replaying the transactions
//    from there must never go below zero (a prepaid card can't). If exactly one passes, or
//    exactly one of those that pass explains the balance with its own transactions alone,
//    that's it. Otherwise Isar doesn't guess: the card stays one balance and you're asked to
//    pick its currency.
// 2. AUD on a foreign-currency card is FUNDING, not a currency balance. Top-ups arrive as AUD
//    (BankSync also writes "AUD" whenever the bank left the currency out), and the conversion
//    into CNY/EUR usually isn't sent as AUD going out. Adding AUD up gives every top-up ever
//    made, which is what produced the $10,000. So AUD never becomes a worked-out balance.
// 3. Every other currency: balance = its starting amount (0, or what you set once with Update
//    balance) + its transactions. Shown only if ALL of these hold:
//      - the bank sent the whole transaction list (not cut short);
//      - no transaction disagrees with itself on whether money went in or out;
//      - the running balance never goes below zero;
//      - its first transaction is money in (so the data reaches back to when it was loaded),
//        or you've set its starting amount;
//      - all worked-out currencies together aren't more than was loaded onto the card (AUD
//        top-ups in the same period, plus 10% for rate differences, plus starting amounts you set).
// Each extra currency is its own account (`purseOf` = the card), so net worth, graphs, the Globe
// and the bank screen include it. Transactions are saved once, on the card.
const CARD_TOLERANCE = 0.01;                     // a cent, for rounding

// Replays one currency's transactions, oldest first, from `opening`. Returns the lowest point.
function lowestRunningBalance(transactions, opening) {
    let running = opening, lowest = opening;
    transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
        running += t.amount;
        if (running < lowest) lowest = running;
    });
    return lowest;
}

function sumOf(transactions) {
    return transactions.reduce((sum, t) => sum + t.amount, 0);
}

function splitMultiCurrencyCard(account, problems) {
    if (!Array.isArray(account.transactions) || account.purseCurrency) return false;   // the bank already splits it
    const byCurrency = {};                               // currency -> its transactions
    const unsupported = new Set();
    countedTransactions(account).forEach(t => {
        if (!t.currency) return;                         // no label: part of the main balance
        if (!CURRENCY_META[t.currency]) { unsupported.add(t.currency); return; }
        (byCurrency[t.currency] = byCurrency[t.currency] || []).push(t);
    });
    unsupported.forEach(c => problems.push(account.name + ': has transactions in ' + c + ', which Isar doesn\'t support yet, so they aren\'t counted.'));
    const currencies = Object.keys(byCurrency).sort();
    const reported = account.reportedCurrency || account.currency;
    let changed = false;
    const set = (key, value) => {
        if (JSON.stringify(account[key]) === JSON.stringify(value)) return;
        if (value === undefined) delete account[key]; else account[key] = value;
        changed = true;
    };
    const relabel = currency => { if (currency && account.currency !== currency) { account.currency = currency; changed = true; } };
    const keepPurses = keep => {
        for (let i = ACCOUNTS.length - 1; i >= 0; i--) {
            const a = ACCOUNTS[i];
            if (a.purseOf === account.id && !keep.includes(a.currency)) {
                ACCOUNTS.splice(i, 1);
                if (openAccountId === a.id) closeAccount();
                changed = true;
            }
        }
    };
    const stopBeingACard = () => {
        if (account.cardName && account.parentName === account.cardName) set('parentName', undefined);
        set('cardCurrencies', undefined);
        set('cardName', undefined);
        keepPurses([]);
    };

    if (currencies.length < 2) {
        // An ordinary account. If all its transactions are in one currency that isn't its label
        // (a CNY balance the bank called AUD), and the balance fits that currency, it's relabelled.
        const only = currencies[0];
        const fits = only && only !== reported && !account.currencyFixed &&
            lowestRunningBalance(byCurrency[only], account.balance - sumOf(byCurrency[only])) >= -CARD_TOLERANCE;
        set('mainCurrency', fits ? only : undefined);
        set('mixedCurrencies', undefined);
        stopBeingACard();
        if (!account.currencyFixed) relabel(account.mainCurrency || reported);
        return changed;
    }

    // 1. Which currency the bank's balance is in.
    let main = account.currencyFixed;
    if (!main) {
        const fit = currencies.filter(c => {
            const opening = account.balance - sumOf(byCurrency[c]);
            return opening >= -CARD_TOLERANCE && lowestRunningBalance(byCurrency[c], opening) >= -CARD_TOLERANCE;
        });
        // Several can fit. The one whose transactions alone add up to the balance (nothing needed
        // from before the data starts) is the strongest evidence, if exactly one does.
        const exact = fit.filter(c => Math.abs(account.balance - sumOf(byCurrency[c])) <= Math.max(1, Math.abs(account.balance) * 0.01));
        if (fit.length === 1) main = fit[0];
        else if (exact.length === 1) main = exact[0];
        else if (fit.includes(reported) && reported !== 'AUD') main = reported;   // the bank's own (non-default) label settles a tie
    }
    if (!main) {
        set('mixedCurrencies', currencies);
        set('mainCurrency', undefined);
        stopBeingACard();
        if (!account.currencyFixed) relabel(reported);
        problems.push(account.name + ': its transactions are in ' + currencies.join(', ') + ', and Isar can\'t tell for sure which currency its balance is in, ' +
            'so it isn\'t split yet. Open it → Edit → Currency, and pick the currency the CommBank app shows for this balance.');
        return changed;
    }

    const cardName = account.cardName || account.name;
    set('cardName', cardName);
    set('parentName', cardName);
    set('cardCurrencies', currencies);
    set('mixedCurrencies', undefined);
    set('mainCurrency', account.currencyFixed ? undefined : main);
    relabel(main);

    // 2. AUD is funding unless it's the card's main balance.
    const purseCurrencies = currencies.filter(c => c !== main && c !== 'AUD');
    const loadsAUD = main === 'AUD' ? 0 : sumOf((byCurrency.AUD || []).filter(t => t.amount > 0));

    // 3. Each other currency, checked one by one.
    const start = transactionDataStart(account);
    const today = localISODate(new Date());
    const purses = purseCurrencies.map(currency => {
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
        const list = byCurrency[currency];
        const openingSet = typeof purse.opening === 'number';
        const opening = openingSet ? purse.opening : 0;
        const reasons = [];
        if (account.txPartial) reasons.push('the bank sent only part of the card\'s transactions');
        if (list.some(t => t.signConflict)) reasons.push('some of its transactions don\'t agree on whether money went in or out');
        if (lowestRunningBalance(list, opening) < -CARD_TOLERANCE) reasons.push('adding up its transactions goes below zero, so money loaded before the bank\'s data begins is missing');
        const oldest = list.slice().sort((a, b) => a.date.localeCompare(b.date))[0];
        if (!openingSet && oldest && oldest.amount < 0) reasons.push('its oldest transaction in the bank\'s data is a payment, not a top-up, so it already held money Isar can\'t see');
        return { purse, currency, list, opening, openingSet, reasons };
    });

    // All worked-out currencies together can't be more than was loaded onto the card.
    if (loadsAUD > 0) {
        const total = purses.filter(p => !p.reasons.length).reduce((sum, p) => sum + convertToBase(p.opening + sumOf(p.list), p.currency), 0);
        const allowed = loadsAUD * 1.1 + purses.filter(p => p.openingSet).reduce((sum, p) => sum + Math.max(0, convertToBase(p.opening, p.currency)), 0);
        if (total > allowed) purses.forEach(p => { if (!p.reasons.length) p.reasons.push('together the currencies come to more than was ever loaded onto the card'); });
    }

    purses.forEach(({ purse, currency, list, opening, reasons }) => {
        const before = JSON.stringify([purse.balance, purse.history, purse.unverified, purse.transactionsTotal, purse.type]);
        purse.transactionsTotal = Math.round(sumOf(list) * 100) / 100;   // Update balance uses this to set the starting amount
        if (reasons.length) {
            // Not trustworthy: shown as Unknown, counted as nothing.
            purse.unverified = reasons.join('; ');
            purse.balance = 0;
            purse.history = [];
            purse.type = 'Unknown: can\'t be worked out yet';
            problems.push(purse.name + ': Isar can\'t work this balance out reliably (' + purse.unverified + '). ' +
                'Open it and use Update balance once with what the CommBank app shows; Isar keeps it up to date from there.');
        } else {
            delete purse.unverified;
            purse.history = purseHistory(account, currency, start, today, opening);
            purse.balance = purse.history[purse.history.length - 1].balance;
            purse.type = 'Worked out from transactions';
        }
        if (JSON.stringify([purse.balance, purse.history, purse.unverified, purse.transactionsTotal, purse.type]) !== before) changed = true;
    });
    keepPurses(purseCurrencies);
    return changed;
}

// One currency of a card, day by day: `opening` where the data starts (0, unless you set it once
// with Update balance), then each day's transactions added on. Rebuilt in full every sync, so
// it always matches the transactions.
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
    // The bank left this account out of its latest list. It stays, with its history and its last
    // balance, and you're told; the server only stops listing it after a week (api/bank-sync.js).
    if (incoming.missingSince) {
        const day = iso => formatGraphDate(Date.parse(iso + 'T00:00:00Z'), true);
        return bankAccountLabel(incoming) + ': the bank has left this account out of its updates since ' + day(incoming.missingSince) +
            '. Isar is keeping it, with its last balance and history. If it isn\'t back by ' + day(incoming.removeAfter) + ', it will be removed.';
    }
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
        const pre = text => '<pre style="white-space: pre-wrap; word-break: break-all; font-size: 11px; color: #D4D4D8; background: #121216; border: 1px solid #27272A; border-radius: 12px; padding: 12px; user-select: text; -webkit-user-select: text;">' + escapeHTML(text) + '</pre>';
        const blocks = data.accounts.map(raw => {
            const sample = raw.isarRawTransactions;
            const account = Object.assign({}, raw);
            delete account.isarRawTransactions;
            return '<p class="info-note" style="text-align: left; margin-top: 14px;"><strong>' + escapeHTML(raw.name || raw.id || 'Account') + '</strong></p>' +
                pre(JSON.stringify(account, null, 2)) +
                (sample ? '<p class="info-note" style="text-align: left;">Its transactions, last 90 days (up to 60), and what they add up to per currency:</p>' +
                    pre(rawTransactionSummary(raw, sample)) + pre(JSON.stringify(sample, null, 2)) : '');
        }).join('');
        document.getElementById('info-content').innerHTML =
            '<p class="info-note" style="text-align: left;">Exactly what BankSync sends Isar for ' + escapeHTML(data.bank) +
            ', one block per account. Isar reads <strong>balance</strong> and <strong>currency</strong>, and each transaction\'s ' +
            '<strong>currency</strong>, <strong>creditAmount</strong> and <strong>debitAmount</strong>. Blur descriptions before sharing if you like.</p>' + blocks;
    } catch (e) {
        document.getElementById('info-content').innerHTML = '<p class="info-note">' + escapeHTML(e.message) + '</p>';
    }
}

// Per currency: how many transactions, money in, money out, and how many disagree with
// themselves on direction (amount's sign vs credit − debit). Plus how Isar reads the account.
// This is what settles whether a worked-out balance can be trusted.
function rawTransactionSummary(raw, sample) {
    if (sample.error) return 'Couldn\'t read its transactions: ' + sample.error;
    const lines = [];
    const perCurrency = {};
    (sample.transactions || []).forEach(tx => {
        const c = String(tx.currency || '(none)').toUpperCase();
        const row = perCurrency[c] = perCurrency[c] || { count: 0, moneyIn: 0, moneyOut: 0, disagree: 0 };
        const credit = Number(tx.creditAmount), debit = Number(tx.debitAmount), amount = Number(tx.amount);
        const signed = isFinite(credit) && isFinite(debit) && (credit || debit) ? credit - debit : amount;
        row.count++;
        if (signed > 0) row.moneyIn += signed; else row.moneyOut -= signed;
        if (isFinite(credit) && isFinite(debit) && (credit || debit) && isFinite(amount) && amount && Math.sign(amount) !== Math.sign(credit - debit)) row.disagree++;
    });
    Object.keys(perCurrency).sort().forEach(c => {
        const r = perCurrency[c];
        lines.push(c + ': ' + r.count + ' transactions · in ' + r.moneyIn.toFixed(2) + ' · out ' + r.moneyOut.toFixed(2) +
            (r.disagree ? ' · ' + r.disagree + ' disagree on direction' : ''));
    });
    if (sample.meta) lines.push('More than this page: ' + (sample.meta.hasMore ? 'yes' : 'no'));
    const isar = ACCOUNTS.find(a => a.bankAccountId === raw.id);
    if (isar) {
        lines.push('Isar reads its balance as: ' + (isar.currency || '?') +
            (isar.currencyFixed ? ' (you set it)' : isar.cardCurrencies ? ' (worked out; card in ' + isar.cardCurrencies.join(', ') + ')' :
                isar.mixedCurrencies ? ' (unsure; transactions in ' + isar.mixedCurrencies.join(', ') + ')' : ''));
        ACCOUNTS.filter(a => a.purseOf === isar.id).forEach(p => lines.push('  ' + p.currency + ': ' + (p.unverified ? 'Unknown (' + p.unverified + ')' : formatAmount(p.balance, p.currency))));
    }
    return lines.join('\n') || 'No transactions in the last 90 days.';
}

// An account the server no longer lists is removed, but only when its bank answered this time,
// so a bank that's down never makes accounts disappear. The server keeps listing an account the
// bank briefly leaves out for a week (`missingSince`, api/bank-sync.js), so by the time it
// reaches here it's really gone, or replaced by a new shape of the same account.
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
