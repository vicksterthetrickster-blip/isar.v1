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

    const filtered = topBanks
        .map(b => ({ bank: b, rank: bankMatchRank(b, query) }))
        .filter(x => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.bank.name.length - b.bank.name.length || a.bank.name.localeCompare(b.bank.name))
        .map(x => x.bank);

    if (filtered.length === 0) {
        resultsBox.innerHTML = '<div style="padding: 12px 14px; font-size: 12px; color: #71717A;">No banks match your search</div>';
        resultsBox.style.display = 'block';
        return;
    }

    resultsBox.innerHTML = filtered.map(b => `
        <div onclick="promptConnect(${topBanks.indexOf(b)})" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #27272A;" onmouseover="this.style.background='#27272A'" onmouseout="this.style.background='transparent'">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 28px; height: 28px; border-radius: 6px; background: ${b.color}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;">${b.name[0]}</div>
                <span style="font-size: 13px; font-weight: 600; color: #fff;">${highlightBankName(b.name, query)}</span>
            </div>
            <span style="font-size: 11px; color: ${isBankLinked(b.name) ? '#71717A' : '#00FF85'}; font-weight: 600;">${isBankLinked(b.name) ? 'Linked ✓' : 'Connect'}</span>
        </div>
    `).join('');
    resultsBox.scrollTop = 0;
    resultsBox.style.display = 'block';
}

// --- Connect tab: linking banks (simulated) and remembering them ---
const SUGGESTED_BANKS = ['JPMorgan Chase', 'Monzo'];

function findBank(name) {
    return topBanks.find(b => b.name === name) || { name: name, code: name[0], color: '#1E1E24' };
}

function isBankLinked(name) {
    return ACCOUNTS.some(a => a.userLinked && a.bankName === name);
}

function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bankBadgeHTML(bank, size) {
    return '<div style="width: ' + size + 'px; height: ' + size + 'px; border-radius: 8px; background: ' + bank.color + '; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0;">' + escapeHTML(bank.name[0]) + '</div>';
}

function renderConnectTab() {
    const linked = ACCOUNTS.filter(a => a.userLinked);
    document.getElementById('linked-section').style.display = linked.length ? 'flex' : 'none';
    document.getElementById('linked-list').innerHTML = linked.map(a =>
        '<div class="account-row" style="margin-bottom: 0;">' +
            '<div style="display: flex; align-items: center; gap: 10px; min-width: 0;">' +
                bankBadgeHTML({ name: a.name, color: a.color }, 32) +
                '<div style="min-width: 0;"><div style="font-size: 13px; font-weight: 600;">' + escapeHTML(a.name) + '</div>' +
                '<div style="font-size: 11px; color: #71717A;">' + formatAccountBalance(a) + '</div></div>' +
            '</div>' +
            '<button class="interactive-btn" onclick="removeLinkedAccount(\'' + a.id + '\')" style="background: #1E1E24; color: #FF4D6D; border: 1px solid #27272A; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;">Remove</button>' +
        '</div>'
    ).join('');

    const suggestions = SUGGESTED_BANKS.filter(n => !isBankLinked(n)).map(findBank);
    document.getElementById('suggested-section').style.display = suggestions.length ? 'flex' : 'none';
    document.getElementById('connect-container').innerHTML = suggestions.map(b =>
        '<div class="account-row" style="margin-bottom: 0;">' +
            '<div style="display: flex; align-items: center; gap: 10px;">' + bankBadgeHTML(b, 32) +
            '<span style="font-size: 13px; font-weight: 600;">' + escapeHTML(b.name) + '</span></div>' +
            '<button class="interactive-btn" onclick="promptConnect(' + topBanks.indexOf(b) + ')" style="background: #1E1E24; color: #fff; border: 1px solid #27272A; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;">+ Link</button>' +
        '</div>'
    ).join('');
}

// Everything that shows accounts, redrawn after one is added or removed.
function refreshAfterAccountChange() {
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
        letter: a.letter, color: a.color, balance: a.balance, currency: a.currency
    }));
    saveData();
}

function addLinkedAccount(bankName, balance, currency) {
    const bank = findBank(bankName);
    ACCOUNTS.push({
        id: 'linked-' + Date.now().toString(36),
        bankName: bank.name,
        name: bank.name,
        type: 'Linked Account',
        letter: bank.name[0],
        color: bank.color,
        balance: balance,
        currency: currency,
        userLinked: true
    });
    saveLinkedAccounts();
    refreshAfterAccountChange();
}

function removeLinkedAccount(id) {
    const idx = ACCOUNTS.findIndex(a => a.id === id && a.userLinked);
    if (idx === -1) return;
    if (!confirm('Remove ' + ACCOUNTS[idx].name + ' from your accounts?')) return;
    ACCOUNTS.splice(idx, 1);
    if (openAccountId === id) closeAccount();
    saveLinkedAccounts();
    refreshAfterAccountChange();
}

function resetSavedData() {
    if (!confirm('Clear all saved data? Linked banks and settings go back to the defaults.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    location.reload();
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
    icon.innerText = bank.name[0];
    icon.style.background = bank.color;
    icon.style.color = '#fff';

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
        const currencyOptions = Object.keys(CURRENCY_META).map(c => '<option value="' + c + '"' + (c === activeCurrency ? ' selected' : '') + '>' + CURRENCY_META[c].flag + ' ' + c + '</option>').join('');
        modalBox.innerHTML = `
            <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(0,255,133,0.15); color: #00FF85; font-size: 22px; display: flex; align-items: center; justify-content: center; margin: 0 auto;">✓</div>
            <div>
                <h3 style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px;">Authorized</h3>
                <p style="font-size: 12px; color: #A1A1AA;">Enter the current balance of your ${name} account.</p>
            </div>
            <div style="display: flex; gap: 8px;">
                <input id="link-balance" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" style="flex: 1; min-width: 0; background: #121216; border: 1px solid #27272A; border-radius: 12px; padding: 12px; color: #fff; font-size: 13px; outline: none;">
                <select id="link-currency" style="background: #121216; border: 1px solid #27272A; border-radius: 12px; padding: 0 10px; color: #fff; font-size: 13px;">${currencyOptions}</select>
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
