// main.js — navigation and start-up. Loaded LAST, so everything it calls already exists.

function switchTab(tabName, btnElement) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + tabName).classList.add('active');
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
}

// --- Start-up: runs last, once every function and variable above exists ---
// Initialize instantly with fallback rates so the UI never shows a blank state,
// then fetch live rates and re-render once they arrive.
renderUser();
renderSettings();
renderAccounts();
renderConnectTab();
renderCurrencyMenu();
selectCurrency(SAVED.displayCurrency || BASE_CURRENCY);
initPerfScrub();
initPerfHover();
fetchLiveRates(false);
// Keep an open dashboard current without relying on a page reload.
setInterval(() => fetchLiveRates(false), 5 * 60 * 1000);
