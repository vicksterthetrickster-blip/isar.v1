// connect.js — Connect tab: bank search, linking banks, linked/suggested lists.

// Live Bank Search
// Bank search: only matches from the START of the name, the start of a word in
// the name, never from the middle of a word.
// Results are ranked by how well they match, best first, and re-sorted on every keystroke.
function bankMatchRank(bank, query) {
    const name = bank.name.toLowerCase();
    const words = name.split(/[\s\-.]+/).filter(Boolean);
    if (name === query) return 0;                                   // exact name
    if (name.startsWith(query)) return 1;                           // name starts with it
    if (words.some(w => w === query)) return 2;                     // a whole word matches
    if (words.some(w => w.startsWith(query))) return 3;             // a word starts with it
    const kindWords = KIND_SEARCH_WORDS[bank.kind] || [];
    if (query.length >= 3 && kindWords.some(w => w.startsWith(query))) return 4;   // its category, e.g. "crypto"
    return -1;                                                      // no match
}

// Wraps the typed letters in the bank name in green so it's clear why each result matched.
function highlightBankName(name, query) {
    const lower = name.toLowerCase();
    let idx = lower.startsWith(query) ? 0 : -1;
    if (idx === -1) {
        const re = /[\s\-.]+/g;
        let m;
        while ((m = re.exec(lower)) !== null) {
            const start = m.index + m[0].length;
            if (lower.startsWith(query, start)) { idx = start; break; }
        }
    }
    if (idx === -1) return name;
    return name.slice(0, idx) +
        '<span style="color: #00FF85;">' + name.slice(idx, idx + query.length) + '</span>' +
        name.slice(idx + query.length);
}

function filterBanks() {
    const query = document.getElementById('bank-search').value.trim().toLowerCase();
    const resultsBox = document.getElementById('bank-results');

    if (!query) {
        resultsBox.style.display = 'none';
        return;
    }

    const filtered = searchBanks(query);

    if (filtered.length === 0) {
        resultsBox.innerHTML = '<div style="padding: 12px 14px; font-size: 12px; color: #71717A;">No banks match your search</div>';
        resultsBox.style.display = 'block';
        return;
    }

    resultsBox.innerHTML = filtered.map(b => `
        <div class="bank-result" onclick="promptConnect(${topBanks.indexOf(b)})">
            <div style="display: flex; align-items: center; gap: 10px;">
                ${bankIconHTML(b, 28)}
                <span style="font-size: 13px; font-weight: 600; color: #fff;">${highlightBankName(b.name, query)}</span>
            </div>
            <span style="font-size: 11px; color: ${isBankLinked(b.name) ? '#71717A' : '#00FF85'}; font-weight: 600;">${isBankLinked(b.name) ? 'Linked ✓' : 'Connect'}</span>
        </div>
    `).join('');
    resultsBox.scrollTop = 0;
    resultsBox.style.display = 'block';
}

// Banks matching a (lower-case) search, best match first. Used by the Connect tab and setup.
function searchBanks(query) {
    return topBanks
        .map(b => ({ bank: b, rank: bankMatchRank(b, query) }))
        .filter(x => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.bank.name.length - b.bank.name.length || a.bank.name.localeCompare(b.bank.name))
        .map(x => x.bank);
}

// --- Connect tab: linking banks (simulated) and remembering them ---
// Suggested banks depend on the home (display) currency: banks people with that currency
// most likely use. Names must match topBanks in data.js.
const BANKS_BY_CURRENCY = {
    AUD: ['Commonwealth Bank', 'Westpac', 'ANZ Bank', 'National Australia Bank'],
    USD: ['JPMorgan Chase', 'Bank of America', 'Wells Fargo', 'Citigroup'],
    GBP: ['Monzo', 'Barclays', 'HSBC Holdings', 'Lloyds Banking Group', 'NatWest Group'],
    EUR: ['BNP Paribas', 'Banco Santander', 'Deutsche Bank', 'BBVA', 'Rabobank'],
    CAD: ['Toronto-Dominion Bank', 'Scotiabank', 'Quebec National Bank'],
    JPY: ['Mitsubishi UFJ Financial Group', 'Nomura Holdings'],
    CNY: ['Industrial and Commercial Bank of China', 'China Construction Bank', 'Bank of China', 'Agricultural Bank of China'],
    HKD: ['HSBC Holdings', 'Standard Chartered', 'Bank of China'],
    SGD: ['Standard Chartered', 'HSBC Holdings', 'Citigroup'],
    CHF: ['UBS Group'],
    SEK: ['Nordea'], NOK: ['Nordea'], DKK: ['Nordea']
};
const DEFAULT_SUGGESTED_BANKS = ['HSBC Holdings', 'JPMorgan Chase', 'Citigroup', 'Standard Chartered'];

// Up to `limit` suggested banks for a currency that the user hasn't linked yet.
function suggestedBanksFor(code, limit) {
    return (BANKS_BY_CURRENCY[code] || DEFAULT_SUGGESTED_BANKS)
        .filter(n => !isBankLinked(n))
        .map(findBank)
        .slice(0, limit || 4);
}

function findBank(name) {
    return topBanks.find(b => b.name === name) || { name: name, code: name[0], color: '#1E1E24' };
}

function isBankLinked(name) {
    return ACCOUNTS.some(a => a.userLinked && a.bankName === name);
}

function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderConnectTab() {
    const linked = ACCOUNTS.filter(a => a.userLinked);
    document.getElementById('linked-section').style.display = linked.length ? 'flex' : 'none';
    document.getElementById('linked-list').innerHTML = linked.map(a =>
        '<div class="account-row" style="margin-bottom: 0;">' +
            '<div style="display: flex; align-items: center; gap: 10px; min-width: 0;">' +
                bankIconHTML(a, 32) +
                '<div style="min-width: 0;"><div style="font-size: 13px; font-weight: 600;">' + escapeHTML(a.name) + '</div>' +
                '<div style="font-size: 11px; color: #71717A;">' + formatAccountBalance(a) + '</div></div>' +
            '</div>' +
            '<button class="interactive-btn" onclick="removeLinkedAccount(\'' + a.id + '\')" style="background: #1E1E24; color: #FF4D6D; border: 1px solid #27272A; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;">Remove</button>' +
        '</div>'
    ).join('');

    const suggestions = suggestedBanksFor(activeCurrency);
    document.getElementById('suggested-section').style.display = suggestions.length ? 'flex' : 'none';
    document.getElementById('connect-container').innerHTML = suggestions.map(b =>
        '<div class="account-row" style="margin-bottom: 0;">' +
            '<div style="display: flex; align-items: center; gap: 10px;">' + bankIconHTML(b, 32) +
            '<span style="font-size: 13px; font-weight: 600;">' + escapeHTML(b.name) + '</span></div>' +
            '<button class="interactive-btn" onclick="promptConnect(' + topBanks.indexOf(b) + ')" style="background: #1E1E24; color: #fff; border: 1px solid #27272A; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;">+ Link</button>' +
        '</div>'
    ).join('');
}

// Everything that shows accounts, redrawn after one is added or removed.
function refreshAfterAccountChange() {
    recordDailySnapshot();
    refreshSetup();
    renderAccounts();
    renderConnectTab();
    renderPortfolioValue();
    renderGraph();
    renderCurrencyMenu();
    document.getElementById('profile-linked-count').innerText = ACCOUNTS.length + ' accounts';
}

function saveLinkedAccounts() {
    SAVED.linkedAccounts = ACCOUNTS.filter(a => a.userLinked).map(a => ({
        id: a.id, bankName: a.bankName, name: a.name, type: a.type,
        letter: a.letter, color: a.color, balance: a.balance, currency: a.currency,
        addedDate: a.addedDate, history: a.history, historySource: a.historySource
    }));
    saveData();
}

// Where a new account's past comes from. With sample data on, it gets made-up history
// ('mock'); with your own data, history starts on the day you add it ('manual').
// A real bank provider would supply real history here instead.
function startingHistory(balance, addedDate) {
    return USER_SETTINGS.showSampleData
        ? { history: generateMockAccountHistory(balance, addedDate), historySource: 'mock' }
        : { history: [{ date: addedDate, balance: balance }], historySource: 'manual' };
}

// Applies changes to one of the user's accounts. `changes` can hold any of:
// balance (a new balance, recorded in the account's history for today), name, type.
// Sample accounts are read-only, so they're ignored.
function updateLinkedAccount(id, changes) {
    const account = ACCOUNTS.find(a => a.id === id && a.userLinked);
    if (!account) return;
    if (typeof changes.name === 'string' && changes.name.trim()) {
        account.name = changes.name.trim();
        account.letter = Array.from(account.name)[0].toUpperCase();
    }
    if (typeof changes.type === 'string' && changes.type.trim()) account.type = changes.type.trim();
    if (typeof changes.balance === 'number' && isFinite(changes.balance)) {
        account.balance = changes.balance;
        const today = localISODate(new Date());
        const history = account.history;
        const last = history[history.length - 1];
        if (last && last.date === today) last.balance = changes.balance;
        else history.push({ date: today, balance: changes.balance });
    }
    saveLinkedAccounts();
    refreshAfterAccountChange();
    if (openAccountId === id) renderAccountDetail();
}

// ===== MOCK DATA: replaced by the bank provider later =====
// A real provider (TrueLayer, GoCardless, Plaid) returns an account's past balances
// or transactions. Until then this invents a believable weekly history, back to the
// start of the sample HISTORY, that ends exactly at the balance the user typed in.
// Returns [{ date: 'YYYY-MM-DD', balance }] oldest first, in the account's own currency.
function generateMockAccountHistory(balance, addedDate) {
    const start = Date.parse(((typeof HISTORY !== 'undefined' && HISTORY.length) ? HISTORY[0].date : addedDate) + 'T00:00:00Z');
    const day = new Date(addedDate + 'T00:00:00Z');
    const history = [];
    let value = balance;
    do {
        history.unshift({ date: day.toISOString().slice(0, 10), balance: Math.round(value * 100) / 100 });
        value = Math.max(0, value * (1 - (Math.random() * 0.04 - 0.012)));   // a week earlier: usually a little lower
        day.setUTCDate(day.getUTCDate() - 7);
    } while (Date.parse(history[0].date + 'T00:00:00Z') > start);    // reach back to (or just before) the start
    return history;
}

// Banks linked before addedDate/history existed get them once, then they're saved.
// The link time is read back from the id ('linked-' + time in base 36).
function upgradeLinkedAccounts() {
    let changed = false;
    ACCOUNTS.filter(a => a.userLinked).forEach(a => {
        if (!a.addedDate) {
            const created = parseInt(String(a.id).replace('linked-', ''), 36);
            a.addedDate = localISODate(isNaN(created) ? new Date() : new Date(created));
            changed = true;
        }
        if (!Array.isArray(a.history)) {
            Object.assign(a, startingHistory(a.balance, a.addedDate));
            changed = true;
        }
        if (!a.historySource) { a.historySource = 'mock'; changed = true; }   // banks linked before this existed got mock history
    });
    if (changed) saveLinkedAccounts();
}

function addLinkedAccount(bankName, balance, currency) {
    const bank = findBank(bankName);
    const addedDate = localISODate(new Date());
    ACCOUNTS.push({
        id: 'linked-' + Date.now().toString(36),
        bankName: bank.name,
        name: bank.name,
        type: 'Linked Account',
        letter: bank.name[0],
        color: bank.color,
        balance: balance,
        currency: currency,
        addedDate: addedDate,
        userLinked: true
    });
    Object.assign(ACCOUNTS[ACCOUNTS.length - 1], startingHistory(balance, addedDate));
    saveLinkedAccounts();
    refreshAfterAccountChange();
}

function removeLinkedAccount(id) {
    const account = ACCOUNTS.find(a => a.id === id && a.userLinked);
    if (!account) return;
    showConfirmDialog('Remove ' + account.name + '?', 'Its balance and history will be removed from Isar.', 'Remove', () => {
        const idx = ACCOUNTS.indexOf(account);
        if (idx === -1) return;
        ACCOUNTS.splice(idx, 1);
        if (openAccountId === id) closeAccount();
        saveLinkedAccounts();
        refreshAfterAccountChange();
    });
}

function resetSavedData() {
    showConfirmDialog('Clear all saved data?', 'Linked banks, history and settings go back to the defaults.', 'Clear', () => {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        location.reload();
    });
}

let selectedBankName = '';
// `bankIndex` is the bank's position in topBanks (avoids putting names inside onclick strings).
function promptConnect(bankIndex) {
    const bank = topBanks[bankIndex];
    if (!bank) return;
    selectedBankName = bank.name;
    document.getElementById('bank-results').style.display = 'none';
    document.getElementById('bank-search').value = '';

    closeModalAndReset();   // make sure the modal is in its starting layout
    const icon = document.getElementById('modal-icon');
    icon.innerHTML = bankIconHTML(bank, 48);
    icon.style.background = 'transparent';

    if (isBankLinked(bank.name)) {
        document.getElementById('modal-title').innerText = bank.name + ' is already linked';
        document.getElementById('modal-desc').innerText = 'You can remove it from "Your linked banks" on the Connect tab.';
        document.getElementById('modal-actions').innerHTML =
            '<button onclick="closeModal()" style="flex: 1; background: #27272A; border: none; border-radius: 12px; padding: 12px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">OK</button>';
    } else {
        document.getElementById('modal-title').innerText = 'Securely connect ' + bank.name + '?';
        document.getElementById('modal-desc').innerText = 'Isar uses secure, read-only tokenization to sync your balances without storing credentials.';
    }
    document.getElementById('secure-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('secure-modal').style.display = 'none';
}

function startSecureConnect() {
    const modalBox = document.getElementById('modal-content-box');
    const name = escapeHTML(selectedBankName);
    modalBox.innerHTML = `
        <div style="width: 36px; height: 36px; border: 3px solid #27272A; border-top-color: #00FF85; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto;"></div>
        <div>
            <h3 style="font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 6px;">Redirecting to ${name}</h3>
            <p style="font-size: 11px; color: #A1A1AA; line-height: 1.4;">Taking you to your bank to securely authorize reading...</p>
        </div>
    `;

    // Simulated authorization. Until a real open-banking provider is connected,
    // the user enters the balance and currency themselves.
    setTimeout(() => {
        const currencyOptions = currencyOptionsHTML(activeCurrency);
        modalBox.innerHTML = `
            <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(0,255,133,0.15); color: #00FF85; font-size: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto;">✓</div>
            <div>
                <h3 style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px;">Authorized</h3>
                <p style="font-size: 12px; color: #A1A1AA;">Enter the current balance of your ${name} account.</p>
            </div>
            <!-- Balance and currency on separate full-width rows: side by side, the long currency
                 names made the picker so wide that the balance box got squashed. -->
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <input id="link-balance" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" style="width: 100%; background: #121216; border: 1px solid #27272A; border-radius: 12px; padding: 14px; color: #fff; font-size: 18px; font-weight: 700; outline: none;">
                <select id="link-currency" style="width: 100%; background: #121216; border: 1px solid #27272A; border-radius: 12px; padding: 12px; color: #fff; font-size: 13px;">${currencyOptions}</select>
            </div>
            <p id="link-error" style="display: none; font-size: 11px; color: #FF4D6D; margin-top: -6px;">Enter a balance of 0 or more.</p>
            <button onclick="finishLinking()" style="background: #00FF85; border: none; border-radius: 12px; padding: 12px; color: #000; font-size: 13px; font-weight: 700; cursor: pointer; width: 100%;">Add to portfolio</button>
        `;
        document.getElementById('link-balance').focus();
    }, 2200);
}

function finishLinking() {
    const raw = document.getElementById('link-balance').value.trim();
    const balance = Number(raw);
    if (raw === '' || !isFinite(balance) || balance < 0) {
        document.getElementById('link-error').style.display = 'block';
        return;
    }
    const currency = document.getElementById('link-currency').value;
    addLinkedAccount(selectedBankName, Math.round(balance * 100) / 100, currency);

    document.getElementById('modal-content-box').innerHTML = `
        <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(0,255,133,0.15); color: #00FF85; font-size: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto;">✓</div>
        <div>
            <h3 style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px;">Successfully Linked</h3>
            <p style="font-size: 12px; color: #A1A1AA;">${escapeHTML(selectedBankName)} has been added to your global portfolio.</p>
        </div>
        <button onclick="closeModalAndReset()" style="background: #00FF85; border: none; border-radius: 12px; padding: 12px; color: #000; font-size: 13px; font-weight: 700; cursor: pointer; width: 100%;">Done</button>
    `;
}

function closeModalAndReset() {
    document.getElementById('secure-modal').style.display = 'none';
    // Reset modal layout for next time
    document.getElementById('modal-content-box').innerHTML = `
        <div id="modal-icon" style="width: 48px; height: 48px; border-radius: 12px; background: #00FF85; color: #000; font-size: 20px; font-weight: 800; display: flex; align-items: center; justify-content: center; margin: 0 auto;">C</div>
        <div>
            <h3 id="modal-title" style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px;">Securely connect?</h3>
            <p id="modal-desc" style="font-size: 12px; color: #A1A1AA; line-height: 1.4;">Isar uses secure, read-only tokenization.</p>
        </div>
        <div id="modal-actions" style="display: flex; gap: 10px;">
            <button onclick="closeModal()" style="flex: 1; background: #27272A; border: none; border-radius: 12px; padding: 12px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">Cancel</button>
            <button onclick="startSecureConnect()" style="flex: 1; background: #00FF85; border: none; border-radius: 12px; padding: 12px; color: #000; font-size: 13px; font-weight: 700; cursor: pointer;">Okay</button>
        </div>
    `;
}
