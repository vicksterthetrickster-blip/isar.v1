// signin.js — the sign-in screens: welcome, sign in, create account, and "Explore the demo".
// They only talk to auth.js (signUp, signIn, startDemo), so they keep working unchanged
// when auth.js switches to a real sign-in service.
//
// After a successful sign-in the app reloads: start-up then loads THAT person's saved data
// (storage.js picks the key from the session).

function showAuthScreen() {
    document.getElementById('auth-screen').hidden = false;
    showAuthView('auth-welcome');
}

// Shows one of the three views (welcome / sign in / create account).
function showAuthView(id) {
    document.querySelectorAll('.auth-view').forEach(v => { v.hidden = v.id !== id; });
    document.querySelectorAll('.auth-error').forEach(e => { e.hidden = true; });
    const first = document.querySelector('#' + id + ' .auth-input');
    if (first) first.focus();
}

function enterSignedInApp() {
    document.getElementById('auth-screen').classList.add('leaving');
    setTimeout(() => location.reload(), 250);
}

// Runs a sign-in action with the button showing a spinner, and shows the error message if it fails.
// `onSuccess` gets what the action returned (by default the app opens).
async function runAuthAction(form, errorId, action, onSuccess) {
    const button = form.querySelector('button[type="submit"]');
    const error = document.getElementById(errorId);
    error.hidden = true;
    button.classList.add('loading');
    try {
        const result = await action();
        if (onSuccess) {
            button.classList.remove('loading');
            onSuccess(result);
        } else {
            enterSignedInApp();
        }
    } catch (err) {
        button.classList.remove('loading');
        error.innerText = err.message;
        error.hidden = false;
    }
}

function showCheckEmail(text) {
    document.getElementById('check-email-text').innerText = text;
    showAuthView('auth-check-email');
}

function submitSignIn(event) {
    event.preventDefault();
    const email = document.getElementById('signin-email').value;
    const password = document.getElementById('signin-password').value;
    runAuthAction(event.target, 'signin-error', () => signIn(email, password));
}

function submitSignUp(event) {
    event.preventDefault();
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    // Usually Supabase asks you to confirm your email first. The link signs you in.
    runAuthAction(event.target, 'signup-error', () => signUp(name, email, password), result => {
        if (!result.needsConfirmation) return enterSignedInApp();
        showCheckEmail('We sent a link to ' + result.email + '. Tap it to confirm your email and open Isar. On iPhone it opens in Safari: after that, sign in here with your email and password.');
    });
}

function openForgotPassword() {
    document.getElementById('forgot-email').value = document.getElementById('signin-email').value;
    showAuthView('auth-forgot');
}

function submitForgotPassword(event) {
    event.preventDefault();
    const email = document.getElementById('forgot-email').value;
    runAuthAction(event.target, 'forgot-error', () => requestPasswordReset(email), () => {
        showCheckEmail('If there\'s an Isar account for ' + email.trim() + ', we\'ve sent it a link to choose a new password.');
    });
}

// Opened from the reset link in the email (see watchSignIn in auth.js).
function showNewPasswordView() {
    document.getElementById('auth-screen').hidden = false;
    showAuthView('auth-newpass');
}

function submitNewPassword(event) {
    event.preventDefault();
    const password = document.getElementById('newpass-password').value;
    runAuthAction(event.target, 'newpass-error', async () => {
        await setNewPassword(password);
        await downloadCloudDataFor(getStoredSession());
    }, () => location.replace(location.pathname));
}

// The session just written by auth.js (AUTH_SESSION is only read when the app starts).
function getStoredSession() {
    return readAuthStore().session;
}

async function enterDemo() {
    document.getElementById('auth-demo-btn').innerText = 'Opening demo…';
    await startDemo();
    enterSignedInApp();
}
