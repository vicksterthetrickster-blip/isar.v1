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
async function runAuthAction(form, errorId, action) {
    const button = form.querySelector('button[type="submit"]');
    const error = document.getElementById(errorId);
    error.hidden = true;
    button.classList.add('loading');
    try {
        await action();
        enterSignedInApp();
    } catch (err) {
        button.classList.remove('loading');
        error.innerText = err.message;
        error.hidden = false;
    }
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
    runAuthAction(event.target, 'signup-error', () => signUp(name, email, password));
}

async function enterDemo() {
    document.getElementById('auth-demo-btn').innerText = 'Opening demo…';
    await startDemo();
    enterSignedInApp();
}
