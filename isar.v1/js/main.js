// main.js — navigation and start-up. Loaded LAST, so everything it calls already exists.

// Like a native tab bar: switching closes any open menu and starts the new tab at the top;
// tapping the tab you're already on scrolls it back to the top.
function switchTab(tabName, btnElement) {
    const content = document.querySelector('.phone-frame > .content');
    closeAllMenus();
    if (btnElement.classList.contains('active')) {
        content.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + tabName).classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    content.scrollTop = 0;
}

// Initialize instantly with fallback rates so the UI never shows a blank state,
// then fetch live rates and re-render once they arrive.
function startApp() {
    upgradeLinkedAccounts();
    recordDailySnapshot();
    renderUser();
    renderSettings();
    renderAccounts();
    renderConnectTab();
    renderCurrencyMenu();
    selectCurrency(SAVED.displayCurrency || BASE_CURRENCY);
    initPerfScrub();
    initPerfHover();
    initDismissMenus();
    initScreenTransitions();
    initSwipeBack();
    // The daily summary waits for live rates, so it compares real numbers.
    fetchLiveRates(false).then(() => { if (!needsSetup()) showDailySummary(); });
    // Keep an open dashboard current without relying on a page reload.
    setInterval(() => fetchLiveRates(false), 5 * 60 * 1000);
}

// --- Start-up: runs last, once every function and variable above exists ---
// Nobody signed in: only the sign-in screen. Signing in reloads the page and lands here again.
// Signed in for the first time: the app starts underneath and the setup screens show on top.
if (getSession()) {
    startApp();
    if (needsSetup()) showSetup();
} else {
    showAuthScreen();
}
