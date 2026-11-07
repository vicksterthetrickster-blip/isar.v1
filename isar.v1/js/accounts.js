// accounts.js — Accounts tab list and the account detail screen.

// --- Render everything that shows an account balance from ACCOUNTS ---
// Native-currency display of an account balance (symbol + amount + currency code).
function formatAccountBalance(account) {
    return formatAmount(account.balance, account.currency);
}

// "$5,300 AUD", with the minus sign before the symbol for debts: "−$5,300 AUD".
function formatAmount(amount, code, wholeNumber) {
    const digits = wholeNumber ? 0 : 2;
    return (amount < 0 ? '−' : '') + CURRENCY_META[code].symbol + Math.abs(amount).toLocaleString('en-US', { maximumFractionDigits: digits }) + ' ' + code;
}

// "≈ $58,366 AUD": the balance in the currency chosen on the net worth card.
// Empty when the account is already in that currency.
function formatConvertedBalance(account) {
    if (account.currency === activeCurrency) return '';
    const value = convertFromBase(convertToBase(account.balance, account.currency), activeCurrency);
    return '≈ ' + formatAmount(value, activeCurrency, true);
}

function accountRowHTML(account) {
    const converted = formatConvertedBalance(account);
    return '<div class="account-row" onclick="openAccount(\'' + account.id + '\')">' +
        '<div style="display: flex; align-items: center; gap: 12px; min-width: 0;">' +
            bankIconHTML(account, 36) +
            '<div><div style="font-size: 14px; font-weight: 600;">' + escapeHTML(account.name) + '</div>' +
            '<div style="font-size: 12px; color: #71717A;">' + escapeHTML(account.type) + '</div></div>' +
        '</div>' +
        '<div style="display: flex; align-items: center; gap: 8px;">' +
            '<div style="text-align: right;">' +
                '<div style="font-size: 14px; font-weight: 700;">' + formatAccountBalance(account) + '</div>' +
                (converted ? '<div style="font-size: 12px; color: #71717A; margin-top: 2px;">' + converted + '</div>' : '') +
            '</div>' +
            '<span style="font-size: 16px; color: #71717A;">›</span>' +
        '</div>' +
    '</div>';
}

// Your own accounts are listed first in each group (newest on top), before any sample ones.
function getAccountsInDisplayOrder() {
    const linked = ACCOUNTS.filter(a => a.userLinked).reverse();
    return linked.concat(ACCOUNTS.filter(a => !a.userLinked));
}

// Rows are redrawn on their own so changing
// currency updates just the converted amounts.
// One section per group (Cash, Investments, Assets, Debts) with a subtotal in the display currency.
function renderAccountRows() {
    const ordered = getAccountsInDisplayOrder();
    document.getElementById('account-groups').innerHTML = ACCOUNT_GROUPS.map(group => {
        const list = ordered.filter(a => accountGroup(a) === group.id);
        if (!list.length) return '';
        const total = list.reduce((sum, a) => sum + convertFromBase(convertToBase(a.balance, a.currency), activeCurrency), 0);
        return '<div class="group-head"><span>' + group.label + '</span><span>' + formatAmount(total, activeCurrency, true) + '</span></div>' +
            list.map(a => accountRowHTML(a)).join('');
    }).join('');
}

function renderAccounts() {
    // No accounts yet: an "Add your first account" card instead of an empty graph and list.
    const empty = !ACCOUNTS.length;
    document.getElementById('home-empty').hidden = !empty;
    document.getElementById('perf-card').hidden = empty;
    document.getElementById('accounts-section').hidden = empty;

    renderAccountRows();
}


// --- Account detail screen (opened by tapping an account row) ---
function refreshAccountViews() {
    renderAccountRows();
    if (openAccountId) renderAccountDetail();
    if (performanceOpen) renderPerformanceScreen();
    refreshActiveTab();
}

function openAccount(id) {
    const account = ACCOUNTS.find(a => a.id === id);
    if (!account) return;
    openAccountId = id;
    acctViewCurrency = account.currency;             // always starts on the account's own currency
    acctTxFilter = 'all';
    acctTxLimit = TX_PAGE_SIZE;
    document.getElementById('curr-menu').classList.remove('open');
    renderAccountDetail();
    document.getElementById('account-screen').classList.add('open');
    document.getElementById('account-content').scrollTop = 0;
}

function closeAccount() {
    openAccountId = null;
    acctViewCurrency = null;
    document.getElementById('acct-curr-menu').classList.remove('open');
    document.getElementById('account-screen').classList.remove('open');
}

function setAccountTimeframe(label) {
    accountTimeframe = label;
    renderAccountDetail();
}

function renderAccountTimeframes() {
    document.getElementById('acct-timeframes').innerHTML = ACCOUNT_TIMEFRAMES.map(pair => {
        const active = pair[1] === accountTimeframe;
        return '<button class="interactive-btn" onclick="setAccountTimeframe(\'' + pair[1] + '\')" style="flex: 1; padding: 6px 0; border-radius: 8px; font-size: 12px; ' +
            'border: 1px solid ' + (active ? '#00FF85' : '#27272A') + '; background: ' + (active ? '#27272A' : '#18181B') + '; ' +
            'color: ' + (active ? '#00FF85' : '#fff') + '; font-weight: ' + (active ? '700' : '600') + ';">' + pair[0] + '</button>';
    }).join('');
}

// "$5,300.00 EUR": an account's balance converted into any currency, using live rates.
function formatAccountBalanceIn(account, code) {
    return formatAmount(convertFromBase(convertToBase(account.balance, account.currency), code), code);
}

function toggleAcctCurrencyMenu() {
    document.getElementById('acct-curr-menu').classList.toggle('open');
}

// Same list, same live rates, same style as the net worth card's currency menu —
// just valued against this one account's balance instead of the whole portfolio.
function renderAcctCurrencyMenu(account) {
    document.getElementById('acct-curr-label').innerText = acctViewCurrency + ' ' + CURRENCY_META[acctViewCurrency].flag;
    document.getElementById('acct-curr-items').innerHTML = Object.keys(EXCHANGE_RATES).map(code => {
        const meta = CURRENCY_META[code];
        const value = convertFromBase(convertToBase(account.balance, account.currency), code);
        const activeClass = code === acctViewCurrency ? ' active' : '';
        return `<button class="dropdown-item${activeClass}" onclick="setAcctViewCurrency('${code}')">` +
               `<span>${meta.flag} ${code}</span>` +
               `<span style="color:#71717A">${value < 0 ? '−' : ''}${meta.symbol}${Math.abs(Math.round(value)).toLocaleString('en-US')}</span>` +
               `</button>`;
    }).join('');
}

// Changes how THIS account is displayed only. It doesn't touch activeCurrency (the
// net worth card, the account rows, and every other screen are unaffected), and it
// isn't saved: reopening the account, or any account, resets to that account's own currency.
function setAcctViewCurrency(code) {
    acctViewCurrency = code;
    document.getElementById('acct-curr-menu').classList.remove('open');
    renderAccountDetail();
}

function renderAccountDetail() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    if (!account) return;
    const code = acctViewCurrency;

    // Top card: the balance in the currency chosen for THIS account (its own by default),
    // with the native amount shown underneath whenever a different one is picked.
    const badge = document.getElementById('acct-badge');
    badge.innerHTML = bankIconHTML(account, 56);
    badge.style.background = 'transparent';
    document.getElementById('acct-title').innerText = account.name;
    document.getElementById('acct-name').innerText = account.name;
    document.getElementById('acct-type').innerText = account.type + ' · ' + account.currency;
    document.getElementById('acct-balance').innerText = formatAccountBalanceIn(account, code);
    document.getElementById('acct-converted').innerText = code === account.currency ? '' : ('Native: ' + formatAccountBalance(account));
    renderAcctCurrencyMenu(account);
    renderAcctActions(account);

    // Balance history for this account only, valued in the chosen currency
    const { points, clipped } = getAccountSeries(account, code, accountTimeframe);
    document.getElementById('acct-graph-title').innerText = graphTitle(isDebt(account) ? 'Amount owed' : isValuedByHand(account) ? 'Value' : 'Balance', accountTimeframe, clipped, points);
    document.getElementById('acct-graph-note').innerText = account.currency === code
        ? 'Shown in ' + code
        : 'Shown in ' + code + ', using each date\'s exchange rate';
    renderAccountTimeframes();
    const layout = drawGraph(points, { line: 'acct-graph-line', area: 'acct-graph-area', svg: 'acct-graph-svg', labels: 'acct-graph-labels', empty: 'acct-graph-empty', pct: 'acct-graph-pct' });
    drawAddedMarkers('acct-graph-markers', layout, getAddedMarkers([account]));
    renderAccountTransactions(account);

    // Details
    const debt = isDebt(account);
    const assetsAUD = getAssetsTotalAUD();
    const share = assetsAUD > 0 ? convertToBase(account.balance, account.currency) / assetsAUD * 100 : null;
    document.getElementById('acct-detail-type').innerText = account.type;
    document.getElementById('acct-detail-currency').innerText = account.currency + ' ' + CURRENCY_META[account.currency].flag;
    document.getElementById('acct-detail-share').innerText = share === null ? '—' : share.toFixed(1) + '%';
    document.getElementById('acct-share-row').hidden = debt;

    // A property shows its equity (value minus linked debts); a linked debt shows its property.
    const equity = getEquity(account);
    const linkedAsset = ACCOUNTS.find(a => a.id === account.linkedTo);
    document.getElementById('acct-link-row').hidden = equity === null && !linkedAsset;
    if (equity !== null) {
        document.getElementById('acct-link-label').innerText = 'Your equity';
        document.getElementById('acct-link-value').innerText = formatAmount(equity, account.currency, true);
    } else if (linkedAsset) {
        document.getElementById('acct-link-label').innerText = 'Linked to';
        document.getElementById('acct-link-value').innerText = linkedAsset.name;
    }
}

// --- Your own accounts: update balance, edit, remove ---
// Only accounts the user added can be changed; the sample accounts are read-only.
const ACCT_BTN_STYLE = 'flex: 1; border-radius: 12px; padding: 10px 0; font-size: 13px; font-weight: 700; ';

function renderAcctActions(account) {
    const el = document.getElementById('acct-actions');
    if (!account.userLinked) {
        el.innerHTML = '<div style="font-size: 12px; color: #71717A; text-align: center;">Sample account (read-only). Turn off "Show sample data" in Account settings to use only your own accounts.</div>';
        return;
    }
    const updateLabel = isDebt(account) ? 'Update amount' : isValuedByHand(account) ? 'Update value' : 'Update balance';
    el.innerHTML =
        '<button class="interactive-btn" onclick="openUpdateBalance()" style="' + ACCT_BTN_STYLE + 'background: #00FF85; color: #000; border: none;">' + updateLabel + '</button>' +
        '<button class="interactive-btn" onclick="openEditAccount()" style="' + ACCT_BTN_STYLE + 'background: #18181B; color: #fff; border: 1px solid #27272A;">Edit</button>' +
        '<button class="interactive-btn" onclick="removeLinkedAccount(openAccountId)" style="' + ACCT_BTN_STYLE + 'background: #18181B; color: #FF4D6D; border: 1px solid #27272A;">Remove</button>';
}

// Shows a small form in the shared pop-up (the same box the Connect flow uses).
function showAccountForm(title, fieldsHTML, saveCall) {
    document.getElementById('modal-content-box').innerHTML =
        '<h3 style="font-size: 16px; font-weight: 700; color: #fff;">' + title + '</h3>' +
        fieldsHTML +
        '<p id="acct-form-error" style="display: none; font-size: 12px; color: #FF4D6D; margin-top: -6px;"></p>' +
        '<div style="display: flex; gap: 10px;">' +
            '<button onclick="closeModalAndReset()" style="flex: 1; background: #27272A; border: none; border-radius: 12px; padding: 12px; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;">Cancel</button>' +
            '<button onclick="' + saveCall + '" style="flex: 1; background: #00FF85; border: none; border-radius: 12px; padding: 12px; color: #000; font-size: 14px; font-weight: 700; cursor: pointer;">Save</button>' +
        '</div>';
    document.getElementById('secure-modal').style.display = 'flex';
    const first = document.querySelector('#modal-content-box input');
    if (first) first.focus();
}

function formInputHTML(id, label, value, type) {
    return '<label style="display: flex; flex-direction: column; gap: 4px; text-align: left; font-size: 12px; color: #A1A1AA;">' + label +
        '<input id="' + id + '" type="' + (type || 'text') + '"' + (type === 'number' ? ' inputmode="decimal" min="0" step="0.01"' : '') +
        ' value="' + escapeHTML(value) + '" style="background: #121216; border: 1px solid #27272A; border-radius: 12px; padding: 12px; color: #fff; font-size: 14px; outline: none;"></label>';
}

function showAccountFormError(message) {
    const el = document.getElementById('acct-form-error');
    el.innerText = message;
    el.style.display = 'block';
}

function openUpdateBalance() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    if (!account) return;
    // Debts are stored as negatives, but you always type the positive amount you owe.
    const word = isDebt(account) ? 'Amount owed' : isValuedByHand(account) ? 'Value' : 'Balance';
    showAccountForm('Update ' + word.toLowerCase(),
        '<p style="font-size: 13px; color: #A1A1AA; margin-top: -8px;">Today\'s ' + word.toLowerCase() + ' of ' + escapeHTML(account.name) + ' in ' + account.currency + '. It\'s saved in its history.</p>' +
        formInputHTML('acct-form-balance', word + ' (' + account.currency + ')', Math.abs(account.balance), 'number'),
        'saveUpdatedBalance()');
}

function saveUpdatedBalance() {
    const raw = document.getElementById('acct-form-balance').value.trim();
    const balance = Number(raw);
    if (raw === '' || !isFinite(balance) || balance < 0) return showAccountFormError('Enter an amount of 0 or more.');
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    const rounded = Math.round(balance * 100) / 100;
    updateLinkedAccount(openAccountId, { balance: isDebt(account) ? -rounded : rounded });
    closeModalAndReset();
}

function openEditAccount() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    if (!account) return;
    const linkable = MANUAL_KINDS[account.kind] && MANUAL_KINDS[account.kind].linkable;
    const properties = ACCOUNTS.filter(a => a.kind === 'property');
    showAccountForm('Edit account',
        formInputHTML('acct-form-name', 'Name', account.name) +
        formInputHTML('acct-form-type', 'Type (e.g. Savings, Checking)', account.type) +
        (linkable && properties.length ? linkSelectHTML(properties, account.linkedTo || '') : '') +
        '<p style="font-size: 12px; color: #71717A; margin-top: -6px;">Currency can\'t be changed, because the history is stored in ' + account.currency + '. To change it, remove the account and add it again.</p>',
        'saveEditedAccount()');
}

function saveEditedAccount() {
    const name = document.getElementById('acct-form-name').value.trim();
    const type = document.getElementById('acct-form-type').value.trim();
    if (!name) return showAccountFormError('Enter a name.');
    const link = document.getElementById('manual-link');
    updateLinkedAccount(openAccountId, link ? { name: name, type: type, linkedTo: link.value } : { name: name, type: type });
    closeModalAndReset();
}
