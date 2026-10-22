// storage.js — saving and loading (localStorage).
// Loaded right after data.js, because it applies saved settings and restores linked banks.

// --- Saved data (remembered between sessions) ---
// Everything the user changes in the app is kept in the browser's localStorage
// under one key, as JSON. It survives closing and reopening the page in the same
// browser. To wipe it, use "Clear saved data" on the Connect tab.
// Bump the version in the key if the saved shape ever changes incompatibly.
const STORAGE_KEY = 'isar.savedData.v1';

function loadSavedData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        return {
            linkedAccounts: Array.isArray(data.linkedAccounts) ? data.linkedAccounts : [],
            settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
            displayCurrency: typeof data.displayCurrency === 'string' ? data.displayCurrency : null
        };
    } catch (e) {
        return { linkedAccounts: [], settings: {}, displayCurrency: null };
    }
}

const SAVED = loadSavedData();

// Call after any change that should be remembered.
function saveData() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED)); }
    catch (e) { console.warn('Could not save app data:', e); }
}

Object.assign(USER_SETTINGS, SAVED.settings);

// Banks the user linked in the Connect tab are added after the built-in accounts.
// Only accounts with a valid balance and a currency the app knows are restored.
SAVED.linkedAccounts.forEach(a => {
    if (!a || !a.id || !CURRENCY_META[a.currency] || typeof a.balance !== 'number') return;
    if (!ACCOUNTS.some(x => x.id === a.id)) ACCOUNTS.push(Object.assign({}, a, { userLinked: true }));
});
