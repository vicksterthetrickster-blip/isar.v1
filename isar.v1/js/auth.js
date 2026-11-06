// auth.js — signing up, signing in and out. THE ONLY FILE that knows how accounts are checked.
// Loaded right after data.js, because storage.js needs to know who is signed in.
//
// ===== MOCK VERSION: replaced by a real sign-in service (e.g. Supabase) later =====
// There is no server yet, so nothing here is real security:
//   - accounts (name + email) are remembered on this device only
//   - passwords are checked for length but NEVER stored, so any password "works"
// The rest of the app only uses the functions below (signUp, signIn, signOut, startDemo,
// getSession). They already behave like a real service: they're asynchronous (the app waits
// for them) and they fail with a readable message. So switching to a real service means
// rewriting the inside of these functions, and nothing else.

const AUTH_KEY = 'isar.auth.v1';
const AUTH_DELAY_MS = 700;               // pretend network delay, so the screens behave like the real thing
const LEGACY_DATA_KEY = 'isar.savedData.v1';

function readAuthStore() {
    try {
        const data = JSON.parse(localStorage.getItem(AUTH_KEY)) || {};
        return { users: data.users && typeof data.users === 'object' ? data.users : {}, session: data.session || null };
    } catch (e) {
        return { users: {}, session: null };
    }
}

function writeAuthStore(store) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(store)); } catch (e) {}
}

// Who is signed in, read once at start-up. null = nobody (the sign-in screen shows).
// { userId, name, email, memberSince } for a user, or { demo: true } for the demo.
// Signing in or out reloads the app, so this never goes stale.
const AUTH_SESSION = readAuthStore().session;

function getSession() {
    return AUTH_SESSION;
}

// Each user's saved data lives under its own key, so people never see each other's banks.
function savedDataKeyFor(session) {
    if (!session) return 'isar.savedData.v1.signed-out';
    if (session.demo) return 'isar.savedData.v1.demo';
    return 'isar.savedData.v1.user-' + session.userId;
}

function authDelay() {
    return new Promise(resolve => setTimeout(resolve, AUTH_DELAY_MS));
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkPassword(password) {
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
}

async function signUp(name, email, password) {
    name = name.trim(); email = email.trim().toLowerCase();
    if (!name) throw new Error('Enter your name.');
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    checkPassword(password);
    await authDelay();

    const store = readAuthStore();
    if (store.users[email]) throw new Error('There\'s already an account with that email. Sign in instead.');
    const now = new Date();
    const user = { userId: Date.now().toString(36), name: name, email: email, memberSince: MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear() };

    // The first account on this device takes over data saved before sign-in existed
    // (linked banks, history, settings). Every other new account starts fresh, with sample data off.
    let legacy = null;
    try { legacy = Object.keys(store.users).length === 0 ? localStorage.getItem(LEGACY_DATA_KEY) : null; } catch (e) {}
    try { localStorage.setItem(savedDataKeyFor(user), legacy || JSON.stringify({ settings: { showSampleData: false } })); } catch (e) {}

    store.users[email] = user;
    store.session = user;
    writeAuthStore(store);
    return user;
}

async function signIn(email, password) {
    email = email.trim().toLowerCase();
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    checkPassword(password);
    await authDelay();

    const store = readAuthStore();
    const user = store.users[email];
    if (!user) throw new Error('No account found with that email.');
    store.session = user;
    writeAuthStore(store);
    return user;
}

// The demo: a separate, signed-in-like session that always shows the sample data.
async function startDemo() {
    await authDelay();
    const store = readAuthStore();
    store.session = { demo: true };
    writeAuthStore(store);
}

// Saves a new name and email. In the demo they only last until you exit it (startDemo resets them).
async function updateProfile(name, email) {
    name = name.trim(); email = email.trim().toLowerCase();
    if (!name) throw new Error('Enter your name.');
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    await authDelay();

    const store = readAuthStore();
    if (!AUTH_SESSION.demo) {
        if (email !== AUTH_SESSION.email && store.users[email]) throw new Error('There\'s already an account with that email.');
        delete store.users[AUTH_SESSION.email];
    }
    Object.assign(AUTH_SESSION, { name: name, email: email });
    if (!AUTH_SESSION.demo) store.users[email] = AUTH_SESSION;
    store.session = AUTH_SESSION;
    writeAuthStore(store);
}

async function signOut() {
    const store = readAuthStore();
    store.session = null;
    writeAuthStore(store);
}
