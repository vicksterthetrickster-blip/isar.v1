// auth.js — signing up, signing in and out. THE ONLY FILE that knows how accounts are checked.
// Loaded right after data.js, because storage.js needs to know who is signed in.
//
// Real accounts use Supabase (supabase.com): it checks passwords, sends the confirmation and
// password-reset emails, and keeps the sign-in pass on this device. Isar never sees or stores
// your password. The demo doesn't use Supabase at all: it stays on this device.
//
// The rest of the app only uses the functions below (signUp, signIn, signOut, startDemo,
// getSession, updateProfile, requestPasswordReset, setNewPassword).

// Your Supabase project. Both are MEANT to be public: the key only identifies the app.
// What protects your data is your password plus the database rules ("each person can only
// read and change their own row"). The SECRET key must never be put in this app.
const SUPABASE_URL = 'https://ditlmphsrvglmetljxdl.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JfRW2WmTKhkH9Mg0TCLWtg_QznUHiUr';

// True when Isar was opened from a password-reset email. Read before Supabase tidies the address.
const OPENED_FROM_RESET_LINK = /type=recovery/.test(location.hash);

// The connection to Supabase. Null if its code couldn't load (e.g. offline on first open):
// the app still opens from this device's copy, but signing in has to wait.
// 'implicit' lets email links work even when they open in a different browser from the one
// you signed up in (on iPhone, links open in Safari, not the home-screen app).
const SUPABASE_CLIENT = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { flowType: 'implicit' } })
    : null;

// Who is signed in, remembered on this device so the app can open instantly (even offline).
// Supabase keeps the real sign-in pass separately; checkSignIn() makes sure the two agree.
const AUTH_KEY = 'isar.auth.v1';

function readAuthStore() {
    try {
        const data = JSON.parse(localStorage.getItem(AUTH_KEY)) || {};
        return { session: data.session || null };
    } catch (e) {
        return { session: null };
    }
}

function writeSession(session) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify({ session: session })); } catch (e) {}
}

// Read once at start-up. null = nobody (the sign-in screen shows).
// { userId, name, email, memberSince } for a real account, or { demo: true } for the demo.
// Signing in or out reloads the app, so this never goes stale.
const AUTH_SESSION = readAuthStore().session;

function getSession() {
    return AUTH_SESSION;
}

// Each person's saved data lives under its own key, so people never see each other's banks.
function savedDataKeyFor(session) {
    if (!session) return 'isar.savedData.v1.signed-out';
    if (session.demo) return 'isar.savedData.v1.demo';
    return 'isar.savedData.v1.user-' + session.userId;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkPassword(password) {
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
}

function requireSupabase() {
    if (!SUPABASE_CLIENT) throw new Error('Can\'t reach Isar right now. Check your internet connection and try again.');
}

// Supabase's error messages, in plain words.
function friendlyAuthError(error) {
    const message = (error && error.message) || '';
    if (/invalid login credentials/i.test(message)) return new Error('Wrong email or password.');
    if (/email not confirmed/i.test(message)) return new Error('Please confirm your email first: tap the link we sent you.');
    if (/already registered|already exists/i.test(message)) return new Error('There\'s already an account with that email. Sign in instead.');
    if (/rate limit|too many/i.test(message)) return new Error('Too many attempts. Please wait a few minutes and try again.');
    if (/password/i.test(message) && /weak|short|characters/i.test(message)) return new Error('Please choose a stronger password.');
    if (/fetch|network/i.test(message)) return new Error('Can\'t reach Isar right now. Check your internet connection and try again.');
    return new Error(message || 'Something went wrong. Please try again.');
}

// The details Isar shows, from a Supabase user.
function sessionFromUser(user) {
    const created = new Date(user.created_at || Date.now());
    return {
        userId: user.id,
        name: (user.user_metadata && user.user_metadata.name) || user.email,
        email: user.email,
        memberSince: MONTH_NAMES[created.getMonth()] + ' ' + created.getFullYear()
    };
}

// Creates the account. Supabase then emails a link to confirm the address.
// Returns { needsConfirmation: true } until that's done, so the screen can say "check your email".
async function signUp(name, email, password) {
    name = name.trim(); email = email.trim().toLowerCase();
    if (!name) throw new Error('Enter your name.');
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    checkPassword(password);
    requireSupabase();

    const { data, error } = await SUPABASE_CLIENT.auth.signUp({ email: email, password: password, options: { data: { name: name } } });
    if (error) throw friendlyAuthError(error);
    // Supabase doesn't say if the email is already taken (so strangers can't test emails), but
    // it returns a user with no identities in that case.
    if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) {
        throw new Error('There\'s already an account with that email. Sign in instead.');
    }
    if (!data.session) return { needsConfirmation: true, email: email };
    writeSession(sessionFromUser(data.user));
    return {};
}

async function signIn(email, password) {
    email = email.trim().toLowerCase();
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    if (!password) throw new Error('Enter your password.');
    requireSupabase();

    const { data, error } = await SUPABASE_CLIENT.auth.signInWithPassword({ email: email, password: password });
    if (error) throw friendlyAuthError(error);
    const session = sessionFromUser(data.user);
    writeSession(session);
    await downloadCloudDataFor(session);      // so the app opens with your data straight away (cloud.js)
    return session;
}

// The demo: a separate, signed-in-like session that always shows the sample data.
async function startDemo() {
    await new Promise(resolve => setTimeout(resolve, 300));
    writeSession({ demo: true });
}

// Emails a link to choose a new password. It opens Isar, which then asks for the new password.
async function requestPasswordReset(email) {
    email = email.trim().toLowerCase();
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    requireSupabase();
    const { error } = await SUPABASE_CLIENT.auth.resetPasswordForEmail(email);
    if (error) throw friendlyAuthError(error);
}

// After tapping the reset link: saves the new password and signs in.
async function setNewPassword(password) {
    checkPassword(password);
    requireSupabase();
    const { data, error } = await SUPABASE_CLIENT.auth.updateUser({ password: password });
    if (error) throw friendlyAuthError(error);
    writeSession(sessionFromUser(data.user));
}

// Saves a new name, and asks Supabase to change the email. A new email only takes effect after
// it's confirmed from the new inbox, so this returns { emailPending: true } in that case.
// In the demo the details only last until you exit it.
async function updateProfile(name, email) {
    name = name.trim(); email = email.trim().toLowerCase();
    if (!name) throw new Error('Enter your name.');
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');

    if (AUTH_SESSION.demo) {
        Object.assign(AUTH_SESSION, { name: name, email: email });
        writeSession(AUTH_SESSION);
        return {};
    }
    requireSupabase();
    const changes = { data: { name: name } };
    const emailChanged = email !== AUTH_SESSION.email;
    if (emailChanged) changes.email = email;
    const { error } = await SUPABASE_CLIENT.auth.updateUser(changes);
    if (error) throw friendlyAuthError(error);
    AUTH_SESSION.name = name;
    writeSession(AUTH_SESSION);
    return { emailPending: emailChanged };
}

async function signOut() {
    if (AUTH_SESSION && !AUTH_SESSION.demo) {
        await flushCloudUpload();                 // don't lose a change that hasn't uploaded yet (cloud.js)
        // 'local' = sign out on this device only, which works offline too
        if (SUPABASE_CLIENT) {
            try { await SUPABASE_CLIENT.auth.signOut({ scope: 'local' }); } catch (e) {}
        }
        // Privacy on shared devices: your data leaves the device with you (signing in brings it
        // back from your account). Skipped if a change couldn't upload (offline), so that
        // change isn't lost: it uploads the next time you sign in on this device.
        if (!cloudMeta.dirtyAt) {
            try {
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(CLOUD_META_KEY);
            } catch (e) {}
        }
    }
    writeSession(null);
}

// On start-up: makes sure Supabase agrees about who's signed in, and listens for the links
// in Isar's emails (confirm your email, reset your password).
function watchSignIn() {
    if (!SUPABASE_CLIENT) return;
    SUPABASE_CLIENT.auth.onAuthStateChange((event, supabaseSession) => {
        // The password-reset link was opened: ask for the new password.
        if (event === 'PASSWORD_RECOVERY') {
            setTimeout(showNewPasswordView, 0);
            return;
        }
        // The confirmation link was opened: you're signed in, so open the app.
        if (event === 'SIGNED_IN' && supabaseSession && !AUTH_SESSION && !OPENED_FROM_RESET_LINK) {
            writeSession(sessionFromUser(supabaseSession.user));
            setTimeout(() => location.replace(location.pathname), 0);
        }
    });
    if (AUTH_SESSION && !AUTH_SESSION.demo && !OPENED_FROM_RESET_LINK) checkSignIn();
}

// If Supabase has signed you out (e.g. the password was changed on another device), this
// device signs out too. Offline, Supabase keeps the pass, so the app still opens.
async function checkSignIn() {
    try {
        const { data, error } = await SUPABASE_CLIENT.auth.getSession();
        if (error) return;                        // couldn't check (e.g. offline): try again next time
        if (!data.session) {
            writeSession(null);
            location.reload();
            return;
        }
        // Keep the name and email current if they were changed on another device.
        const fresh = sessionFromUser(data.session.user);
        if (fresh.name !== AUTH_SESSION.name || fresh.email !== AUTH_SESSION.email) {
            Object.assign(AUTH_SESSION, { name: fresh.name, email: fresh.email });
            writeSession(AUTH_SESSION);
            Object.assign(USER, { name: fresh.name, email: fresh.email });
            renderUser();
        }
    } catch (e) {}
}
