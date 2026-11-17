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
        '<label class="form-label">Country<select id="bank-country" class="form-select" onchange="pickBankCountry(this.value)">' +
            BANK_COUNTRIES.map(c => '<option value="' + c[0] + '"' + (c[0] === bankConnectCountry ? ' selected' : '') + '>' + c[1] + '</option>').join('') +
        '</select></label>' +
        '<input class="auth-input" id="bank-filter" type="search" placeholder="Search banks" oninput="renderBankChoices()" autocomplete="off">' +
        '<div id="bank-choices" class="setup-list"><p class="info-note">Loading banks…</p></div>');
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

async function syncBankTransactions(account) {
    const first = !Array.isArray(account.transactions);
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

// --- Step 3: keep balances fresh ---
// Turns each synced bank account into an Isar account, matched by its provider and
// `bankAccountId` so the same account is updated rather than duplicated. From here on it behaves like any other account:
// net worth, graphs, the Globe and snapshots all include it automatically.
async function syncConnectedBanks() {
    if (bankSyncRunning || !getSession() || getSession().demo) return;
    bankSyncRunning = true;
    try {
        const data = await callServer('/api/bank-sync');
        let changed = false;
        let needsReconnect = false;

        data.accounts.forEach(incoming => {
            if (incoming.error === 'consent_expired') { needsReconnect = true; return; }
            if (incoming.error || typeof incoming.balance !== 'number' || !CURRENCY_META[incoming.currency]) return;

            const logoUrl = incoming.logo;
            const existing = ACCOUNTS.find(a => a.provider === incoming.provider && a.bankAccountId === incoming.uid);
            if (existing) {
                if (existing.logoUrl !== logoUrl) { existing.logoUrl = logoUrl; changed = true; }
                if (existing.balance !== incoming.balance) {
                    existing.balance = incoming.balance;
                    recordBalanceToday(existing);       // keeps its history, same as a typed update
                    changed = true;
                }
            } else {
                const today = localISODate(new Date());
                ACCOUNTS.push({
                    id: incoming.provider + '-' + incoming.uid,
                    provider: incoming.provider,
                    bankAccountId: incoming.uid,
                    bankName: incoming.bank,
                    name: incoming.name || incoming.bank,
                    type: 'Connected account',
                    letter: Array.from(incoming.bank)[0].toUpperCase(),
                    color: '#1E1E24',
                    logoUrl: logoUrl,
                    balance: incoming.balance,
                    currency: incoming.currency,
                    addedDate: today,
                    history: [{ date: today, time: currentTimeHHMM(), balance: incoming.balance }],
                    historySource: 'bank',
                    userLinked: true
                });
                changed = true;
            }
        });

        for (const account of ACCOUNTS.filter(a => a.bankAccountId)) {
            if (await syncBankTransactions(account)) changed = true;
        }

        if (changed) { saveLinkedAccounts(); refreshAfterAccountChange(); refreshAccountTransactions(); }
        if (needsReconnect) showToast('A bank needs approving again — reconnect it in the Add tab');
    } catch (e) {
        // Offline, or no banks connected yet: nothing to report, the app works as before.
    } finally {
        bankSyncRunning = false;
    }
}
