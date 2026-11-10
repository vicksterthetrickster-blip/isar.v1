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
    refreshActiveTab();
    updateGlobeRunning();
}

function isTabActive(tabName) {
    return document.getElementById('panel-' + tabName).classList.contains('active');
}

// Globe and Insights add up every account, so they're only redrawn while they're on screen.
function refreshActiveTab() {
    if (isTabActive('globe')) renderGlobeTab();
    if (isTabActive('insights')) renderInsightsTab();
}

// The globe only animates while it can be seen, which saves battery.
function updateGlobeRunning() {
    const covered = document.querySelector('.phone-frame').classList.contains('screen-open');
    if (isTabActive('globe') && !covered) startGlobe();
    else stopGlobe();
}

// Initialize instantly with fallback rates so the UI never shows a blank state,
// then fetch live rates and re-render once they arrive.
function startApp() {
    applySavedRates();                  // first, so everything below uses the newest rates this device has
    upgradeLinkedAccounts();
    revalueHoldings();                  // investment accounts with holdings work out their balance
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
    initGlobe();
    refreshRateHistory();
    // The daily summary waits for live rates, so it compares real numbers.
    fetchLiveRates(false).then(() => { if (!needsSetup()) showDailySummary(); });
    refreshHoldingPrices();             // live crypto prices (and, once the server exists, broker sync and share prices)
    // Keep an open dashboard current without relying on a page reload.
    setInterval(() => { fetchLiveRates(false); refreshHoldingPrices(); }, 5 * 60 * 1000);
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
