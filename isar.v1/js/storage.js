// storage.js — saving and loading (localStorage).
// Loaded right after data.js, because it applies saved settings and restores linked banks.

// --- Saved data (remembered between sessions) ---
// Everything the user changes in the app is kept in the browser's localStorage
// under one key, as JSON. It survives closing and reopening the page in the same
// browser. To wipe it, use "Clear saved data" on the Connect tab.
// Bump the version in the key if the saved shape ever changes incompatibly.
// Each signed-in user (and the demo) has their own key; see savedDataKeyFor() in auth.js.
const STORAGE_KEY = savedDataKeyFor(AUTH_SESSION);

// A saved snapshot is only used if it has a date and both balances and rates.
function isValidSnapshot(s) {
    return !!s && typeof s.date === 'string' &&
        !!s.balances && typeof s.balances === 'object' &&
        !!s.rates && typeof s.rates === 'object';
}

function loadSavedData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        return {
            linkedAccounts: Array.isArray(data.linkedAccounts) ? data.linkedAccounts : [],
            settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
            displayCurrency: typeof data.displayCurrency === 'string' ? data.displayCurrency : null,
            // Daily net-worth records (see snapshots.js), same shape as HISTORY records.
            snapshots: Array.isArray(data.snapshots) ? data.snapshots.filter(isValidSnapshot) : [],
            setupDone: data.setupDone === true,     // finished the first-run setup (setup.js)
            lastSummaryDate: typeof data.lastSummaryDate === 'string' ? data.lastSummaryDate : null   // last daily summary shown
        };
    } catch (e) {
        return { linkedAccounts: [], settings: {}, displayCurrency: null, snapshots: [], setupDone: false, lastSummaryDate: null };
    }
}

const SAVED = loadSavedData();

// Call after any change that should be remembered.
function saveData() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED)); }
    catch (e) { console.warn('Could not save app data:', e); }
}

Object.assign(USER_SETTINGS, SAVED.settings);

// The signed-in person replaces the sample user. The demo keeps the sample user (unless its
// name was edited in Personal details) and always shows sample data.
if (AUTH_SESSION && AUTH_SESSION.name) {
    Object.assign(USER, { name: AUTH_SESSION.name, email: AUTH_SESSION.email, memberSince: AUTH_SESSION.memberSince || USER.memberSince });
}
if (AUTH_SESSION && AUTH_SESSION.demo) USER_SETTINGS.showSampleData = true;
else if (SAVED.settings.showSampleData === undefined) USER_SETTINGS.showSampleData = false;   // real users start with only their own accounts

// Banks the user linked in the Connect tab are added after the built-in accounts.
// Only accounts with a valid balance and a currency the app knows are restored.
SAVED.linkedAccounts.forEach(a => {
    if (!a || !a.id || !CURRENCY_META[a.currency] || typeof a.balance !== 'number') return;
    if (!ACCOUNTS.some(x => x.id === a.id)) ACCOUNTS.push(Object.assign({}, a, { userLinked: true }));
});

// "Start fresh": with sample data off, only the user's own accounts are kept.
if (!USER_SETTINGS.showSampleData) {
    for (let i = ACCOUNTS.length - 1; i >= 0; i--) if (!ACCOUNTS[i].userLinked) ACCOUNTS.splice(i, 1);
}
