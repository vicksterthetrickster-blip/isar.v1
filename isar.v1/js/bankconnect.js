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

// Where the "state" ticket waits while you're away at the bank. It proves the code that
// comes back belongs to the connection THIS app started, not a link someone sent you.
const BANK_STATE_KEY = 'isar.bankConnectState';

// Countries Isar can connect today (Enable Banking covers Europe).
const BANK_COUNTRIES = [
    ['ES', '🇪🇸 Spain'], ['GB', '🇬🇧 United Kingdom'], ['IE', '🇮🇪 Ireland'], ['LT', '🇱🇹 Lithuania'],
    ['FR', '🇫🇷 France'], ['DE', '🇩🇪 Germany'], ['IT', '🇮🇹 Italy'], ['PT', '🇵🇹 Portugal'],
    ['NL', '🇳🇱 Netherlands'], ['FI', '🇫🇮 Finland'], ['SE', '🇸🇪 Sweden'], ['NO', '🇳🇴 Norway'],
    ['DK', '🇩🇰 Denmark'], ['PL', '🇵🇱 Poland'], ['BE', '🇧🇪 Belgium'], ['AT', '🇦🇹 Austria']
];

let bankConnectCountry = 'ES';
let bankSyncRunning = false;

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
        '<label class="form-label">Country<select id="bank-country" class="form-select" onchange="loadBanksForCountry(this.value)">' +
            BANK_COUNTRIES.map(c => '<option value="' + c[0] + '"' + (c[0] === bankConnectCountry ? ' selected' : '') + '>' + c[1] + '</option>').join('') +
        '</select></label>' +
        '<input class="auth-input" id="bank-filter" type="search" placeholder="Search banks" oninput="renderBankChoices()" autocomplete="off">' +
        '<div id="bank-choices" class="setup-list"><p class="info-note">Loading banks…</p></div>');
    loadBanksForCountry(bankConnectCountry);
}

let bankChoices = [];

async function loadBanksForCountry(country) {
    bankConnectCountry = country;
    bankChoices = [];
    const list = document.getElementById('bank-choices');
    if (list) list.innerHTML = '<p class="info-note">Loading banks…</p>';
    try {
        const reply = await fetch('/api/banks?country=' + country, { cache: 'no-store' });
        const data = await reply.json();
        if (!data.ok) throw new Error(data.error || 'Could not load banks');
        // Personal accounts only; Isar isn't a business tool yet.
        bankChoices = data.banks.filter(b => !b.psuTypes.length || b.psuTypes.includes('personal'));
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
            bankIconHTML({ name: bank.name, color: '#1E1E24' }, 32) +
            '<span class="setup-item-name">' + escapeHTML(bank.name) + '<small>Read-only' +
                (bank.maxConsentDays ? ' · renew every ' + bank.maxConsentDays + ' days' : '') + '</small></span>' +
            '<span class="setup-add">Connect</span>' +
        '</button>').join('');
}


// --- Step 2: off to the bank ---
async function startBankConnect(index) {
    const bank = bankChoices[index];
    if (!bank) return;
    showToast('Opening ' + bank.name + '…');
    try {
        const data = await callServer('/api/bank-connect', { method: 'POST', body: { name: bank.name, country: bank.country } });
        // Remember the ticket, then hand over to the bank's own site.
        sessionStorage.setItem(BANK_STATE_KEY, data.state);
        location.href = data.url;
    } catch (error) {
        showToast(error.message);
    }
}

// Back from the bank: the address carries ?code=…&state=…
// Called on start-up (main.js) before anything else looks at the page.
async function finishBankConnect() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    if (!code && !error) return false;

    const expected = sessionStorage.getItem(BANK_STATE_KEY);
    sessionStorage.removeItem(BANK_STATE_KEY);
    history.replaceState(null, '', location.pathname);      // clean the address straight away

    if (error) { showToast('The bank cancelled: ' + error); return false; }
    // A code that didn't come from the connection this app started is ignored.
    if (!expected || state !== expected) { showToast('That bank link didn\'t match — please try connecting again.'); return false; }

    showToast('Saving your connection…');
    try {
        const data = await callServer('/api/bank-complete', { method: 'POST', body: { code: code } });
        showToast(data.bank + ' connected · ' + data.accounts.length + (data.accounts.length === 1 ? ' account' : ' accounts'));
        return true;
    } catch (e) {
        showToast(e.message);
        return false;
    }
}


// --- Step 3: keep balances fresh ---
// Turns each synced bank account into an Isar account, matched by its `ebUid` so the same
// account is updated rather than duplicated. From here on it behaves like any other account:
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

            const existing = ACCOUNTS.find(a => a.ebUid === incoming.uid);
            if (existing) {
                if (existing.balance !== incoming.balance) {
                    existing.balance = incoming.balance;
                    recordBalanceToday(existing);       // keeps its history, same as a typed update
                    changed = true;
                }
            } else {
                const today = localISODate(new Date());
                ACCOUNTS.push({
                    id: 'eb-' + incoming.uid,
                    ebUid: incoming.uid,
                    bankName: incoming.bank,
                    name: incoming.name || incoming.bank,
                    type: 'Connected account',
                    letter: Array.from(incoming.bank)[0].toUpperCase(),
                    color: '#1E1E24',
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

        if (changed) { saveLinkedAccounts(); refreshAfterAccountChange(); }
        if (needsReconnect) showToast('A bank needs approving again — reconnect it in the Add tab');
    } catch (e) {
        // Offline, or no banks connected yet: nothing to report, the app works as before.
    } finally {
        bankSyncRunning = false;
    }
}
