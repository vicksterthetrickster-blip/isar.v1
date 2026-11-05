// profile.js — profile, settings and sign-out screens.

// Initials = first letter of the first word + first letter of the last word.
// A one-word name gives one letter.
function getInitials(fullName) {
    const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = Array.from(words[0])[0];
    const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
    return (first + last).toUpperCase();
}

function getFirstName(fullName) {
    const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    return words.length ? words[0] : '';
}

// --- Account & Settings screen ---
function renderUser() {
    const initials = getInitials(USER.name);
    document.getElementById('user-avatar').innerText = initials;
    document.getElementById('profile-avatar').innerText = initials;
    document.getElementById('welcome-name').innerText = getFirstName(USER.name);
    document.getElementById('profile-name').innerText = USER.name;
    document.getElementById('profile-email').innerText = USER.email;
    document.getElementById('profile-since').innerText = 'Member since ' + USER.memberSince;
}

function renderSettings() {
    document.querySelectorAll('[data-setting]').forEach(el => {
        el.classList.toggle('on', !!USER_SETTINGS[el.dataset.setting]);
    });
}

function toggleSetting(key) {
    USER_SETTINGS[key] = !USER_SETTINGS[key];
    SAVED.settings = Object.assign({}, USER_SETTINGS);
    saveData();
    renderSettings();
}

// Display-currency picker: the same currency the net worth card uses.
// A dropdown rather than buttons, because there are now ~30 currencies.
function renderProfileCurrency() {
    document.getElementById('profile-currency').innerHTML = currencyOptionsHTML(activeCurrency);
}

// "Start fresh" switch. The sample accounts are added or removed while the app
// starts up (storage.js), so the page reloads to apply it. Nothing is deleted:
// switching back on brings the sample data back.
function toggleSampleData() {
    toggleSetting('showSampleData');
    location.reload();
}

function setDisplayCurrency(code) {
    selectCurrency(code);
    renderProfileCurrency();
}

function openProfile() {
    document.getElementById('curr-menu').classList.remove('open');
    document.getElementById('profile-linked-count').innerText = ACCOUNTS.length + ' accounts';
    renderProfileCurrency();
    document.getElementById('profile-screen').classList.add('open');
    document.getElementById('profile-content').scrollTop = 0;
}

function closeProfile() {
    document.getElementById('profile-screen').classList.remove('open');
}

function goToLinkedAccounts() {
    closeProfile();
    switchTab('connect', document.getElementById('btn-connect'));
}

function openSignOutDialog() {
    document.getElementById('signout-dialog').style.display = 'flex';
}

function closeSignOutDialog() {
    document.getElementById('signout-dialog').style.display = 'none';
}

function confirmSignOut() {
    closeSignOutDialog();
    document.getElementById('signed-out-name').innerText = getFirstName(USER.name);
    document.getElementById('signed-out-view').style.display = 'flex';
}

function signBackIn() {
    document.getElementById('signed-out-view').style.display = 'none';
    closeProfile();
}
