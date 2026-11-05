// accounts.js — Accounts tab list and the account detail screen.

// --- Render everything that shows an account balance from ACCOUNTS ---
// Native-currency display of an account balance (symbol + amount + currency code).
function formatAccountBalance(account) {
    const meta = CURRENCY_META[account.currency];
    return meta.symbol + account.balance.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + account.currency;
}

// "≈ $58,366 AUD": the balance in the currency chosen on the net worth card.
// Empty when the account is already in that currency.
function formatConvertedBalance(account) {
    if (account.currency === activeCurrency) return '';
    const value = convertFromBase(convertToBase(account.balance, account.currency), activeCurrency);
    return '≈ ' + CURRENCY_META[activeCurrency].symbol + Math.round(value).toLocaleString('en-US') + ' ' + activeCurrency;
}

function accountRowHTML(account, extraStyle) {
    const converted = formatConvertedBalance(account);
    return '<div class="account-row" onclick="openAccount(\'' + account.id + '\')"' + (extraStyle ? ' style="' + extraStyle + '"' : '') + '>' +
        '<div style="display: flex; align-items: center; gap: 12px;">' +
            '<div style="width: 36px; height: 36px; border-radius: 10px; background: ' + account.color + '; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px;">' + account.letter + '</div>' +
            '<div><div style="font-size: 13px; font-weight: 600;">' + escapeHTML(account.name) + '</div>' +
            '<div style="font-size: 11px; color: #71717A;">' + escapeHTML(account.type) + '</div></div>' +
        '</div>' +
        '<div style="display: flex; align-items: center; gap: 8px;">' +
            '<div style="text-align: right;">' +
                '<div style="font-size: 13px; font-weight: 700;">' + formatAccountBalance(account) + '</div>' +
                (converted ? '<div style="font-size: 11px; color: #71717A; margin-top: 2px;">' + converted + '</div>' : '') +
            '</div>' +
            '<span style="font-size: 16px; color: #71717A;">›</span>' +
        '</div>' +
    '</div>';
}

function accountCountLabel() {
    return ACCOUNTS.length + ' accounts';
}

// Linked banks are listed first (newest on top), so a bank linked on the Connect tab
// shows straight away instead of being folded behind the "+ N accounts" toggle.
function getAccountsInDisplayOrder() {
    const linked = ACCOUNTS.filter(a => a.userLinked).reverse();
    return linked.concat(ACCOUNTS.filter(a => !a.userLinked));
}

// Rows are redrawn on their own (not with the Transfer dropdowns) so changing
// currency updates the converted amounts without resetting a dropdown selection.
function renderAccountRows() {
    const ordered = getAccountsInDisplayOrder();
    document.getElementById('visible-accounts').innerHTML = ordered.length
        ? ordered.slice(0, VISIBLE_ACCOUNT_COUNT).map(a => accountRowHTML(a)).join('')
        : '<div style="font-size: 12px; color: #71717A; text-align: center; padding: 16px 0;">No accounts yet. Add one on the Connect tab.</div>';
    document.getElementById('extra-accounts').innerHTML =
        ordered.slice(VISIBLE_ACCOUNT_COUNT).map(a => accountRowHTML(a, 'margin-bottom: 0;')).join('');
}

function renderAccounts() {
    renderAccountRows();
    document.getElementById('toggle-text').innerText = accountCountLabel();

    const optionsHTML = ACCOUNTS.map(a => '<option value="' + a.id + '">' + a.name + ' - ' + formatAccountBalance(a) + '</option>').join('');
    const from = document.getElementById('transfer-from');
    const to = document.getElementById('transfer-to');
    from.innerHTML = optionsHTML;
    to.innerHTML = optionsHTML;
    from.selectedIndex = 0;
    to.selectedIndex = Math.min(1, ACCOUNTS.length - 1);
}

function toggleAccounts() {
    const extra = document.getElementById('extra-accounts');
    const icon = document.getElementById('toggle-icon');
    const text = document.getElementById('toggle-text');
    if (extra.style.display === 'none' || extra.style.display === '') {
        extra.style.display = 'flex';
        icon.innerText = '−';
        text.innerText = 'less';
    } else {
        extra.style.display = 'none';
        icon.innerText = '+';
        text.innerText = accountCountLabel();
    }
}

// --- Account detail screen (opened by tapping an account row) ---
function refreshAccountViews() {
    renderAccountRows();
    if (openAccountId) renderAccountDetail();
    if (performanceOpen) renderPerformanceScreen();
}

function openAccount(id) {
    const account = ACCOUNTS.find(a => a.id === id);
    if (!account) return;
    openAccountId = id;
    acctViewCurrency = account.currency;             // always starts on the account's own currency
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
        return '<button class="interactive-btn" onclick="setAccountTimeframe(\'' + pair[1] + '\')" style="flex: 1; padding: 6px 0; border-radius: 8px; font-size: 11px; ' +
            'border: 1px solid ' + (active ? '#00FF85' : '#27272A') + '; background: ' + (active ? '#27272A' : '#18181B') + '; ' +
            'color: ' + (active ? '#00FF85' : '#fff') + '; font-weight: ' + (active ? '700' : '600') + ';">' + pair[0] + '</button>';
    }).join('');
}

// "$5,300.00 EUR": an account's balance converted into any currency, using live rates.
function formatAccountBalanceIn(account, code) {
    const meta = CURRENCY_META[code];
    const value = convertFromBase(convertToBase(account.balance, account.currency), code);
    return meta.symbol + value.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + code;
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
               `<span style="color:#71717A">${meta.symbol}${Math.round(value).toLocaleString('en-US')}</span>` +
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
    badge.innerText = account.letter;
    badge.style.background = account.color;
    document.getElementById('acct-title').innerText = account.name;
    document.getElementById('acct-name').innerText = account.name;
    document.getElementById('acct-type').innerText = account.type + ' · ' + account.currency;
    document.getElementById('acct-balance').innerText = formatAccountBalanceIn(account, code);
    document.getElementById('acct-converted').innerText = code === account.currency ? '' : ('Native: ' + formatAccountBalance(account));
    renderAcctCurrencyMenu(account);
    renderAcctActions(account);

    // Balance history for this account only, valued in the chosen currency
    const { points, clipped } = getAccountSeries(account, code, accountTimeframe);
    document.getElementById('acct-graph-title').innerText = graphTitle('Balance', accountTimeframe, clipped, points);
    document.getElementById('acct-graph-note').innerText = account.currency === code
        ? 'Shown in ' + code
        : 'Shown in ' + code + ', using each date\'s exchange rate';
    renderAccountTimeframes();
    const layout = drawGraph(points, { line: 'acct-graph-line', area: 'acct-graph-area', svg: 'acct-graph-svg', labels: 'acct-graph-labels', empty: 'acct-graph-empty', pct: 'acct-graph-pct' });
    drawAddedMarkers('acct-graph-markers', layout, getAddedMarkers([account]));

    // Details
    const totalAUD = getPortfolioTotalAUD();
    const share = totalAUD > 0 ? convertToBase(account.balance, account.currency) / totalAUD * 100 : null;
    document.getElementById('acct-detail-type').innerText = account.type;
    document.getElementById('acct-detail-currency').innerText = account.currency + ' ' + CURRENCY_META[account.currency].flag;
    document.getElementById('acct-detail-share').innerText = share === null ? '—' : share.toFixed(1) + '%';
}

// --- Your own accounts: update balance, edit, remove ---
// Only accounts the user added can be changed; the sample accounts are read-only.
const ACCT_BTN_STYLE = 'flex: 1; border-radius: 12px; padding: 10px 0; font-size: 12px; font-weight: 700; ';

function renderAcctActions(account) {
    const el = document.getElementById('acct-actions');
    if (!account.userLinked) {
        el.innerHTML = '<div style="font-size: 11px; color: #71717A; text-align: center;">Sample account (read-only). Turn off "Show sample data" in Account settings to use only your own accounts.</div>';
        return;
    }
    el.innerHTML =
        '<button class="interactive-btn" onclick="openUpdateBalance()" style="' + ACCT_BTN_STYLE + 'background: #00FF85; color: #000; border: none;">Update balance</button>' +
        '<button class="interactive-btn" onclick="openEditAccount()" style="' + ACCT_BTN_STYLE + 'background: #18181B; color: #fff; border: 1px solid #27272A;">Edit</button>' +
        '<button class="interactive-btn" onclick="removeLinkedAccount(openAccountId)" style="' + ACCT_BTN_STYLE + 'background: #18181B; color: #FF4D6D; border: 1px solid #27272A;">Remove</button>';
}

// Shows a small form in the shared pop-up (the same box the Connect flow uses).
function showAccountForm(title, fieldsHTML, saveCall) {
    document.getElementById('modal-content-box').innerHTML =
        '<h3 style="font-size: 16px; font-weight: 700; color: #fff;">' + title + '</h3>' +
        fieldsHTML +
        '<p id="acct-form-error" style="display: none; font-size: 11px; color: #FF4D6D; margin-top: -6px;"></p>' +
        '<div style="display: flex; gap: 10px;">' +
            '<button onclick="closeModalAndReset()" style="flex: 1; background: #27272A; border: none; border-radius: 12px; padding: 12px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;">Cancel</button>' +
            '<button onclick="' + saveCall + '" style="flex: 1; background: #00FF85; border: none; border-radius: 12px; padding: 12px; color: #000; font-size: 13px; font-weight: 700; cursor: pointer;">Save</button>' +
        '</div>';
    document.getElementById('secure-modal').style.display = 'flex';
    const first = document.querySelector('#modal-content-box input');
    if (first) first.focus();
}

function formInputHTML(id, label, value, type) {
    return '<label style="display: flex; flex-direction: column; gap: 4px; text-align: left; font-size: 11px; color: #A1A1AA;">' + label +
        '<input id="' + id + '" type="' + (type || 'text') + '"' + (type === 'number' ? ' inputmode="decimal" min="0" step="0.01"' : '') +
        ' value="' + escapeHTML(value) + '" style="background: #121216; border: 1px solid #27272A; border-radius: 12px; padding: 12px; color: #fff; font-size: 13px; outline: none;"></label>';
}

function showAccountFormError(message) {
    const el = document.getElementById('acct-form-error');
    el.innerText = message;
    el.style.display = 'block';
}

function openUpdateBalance() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    if (!account) return;
    showAccountForm('Update balance',
        '<p style="font-size: 12px; color: #A1A1AA; margin-top: -8px;">Today\'s balance of ' + escapeHTML(account.name) + ' in ' + account.currency + '. It\'s saved in the account\'s history.</p>' +
        formInputHTML('acct-form-balance', 'Balance (' + account.currency + ')', account.balance, 'number'),
        'saveUpdatedBalance()');
}

function saveUpdatedBalance() {
    const raw = document.getElementById('acct-form-balance').value.trim();
    const balance = Number(raw);
    if (raw === '' || !isFinite(balance) || balance < 0) return showAccountFormError('Enter a balance of 0 or more.');
    updateLinkedAccount(openAccountId, { balance: Math.round(balance * 100) / 100 });
    closeModalAndReset();
}

function openEditAccount() {
    const account = ACCOUNTS.find(a => a.id === openAccountId);
    if (!account) return;
    showAccountForm('Edit account',
        formInputHTML('acct-form-name', 'Name', account.name) +
        formInputHTML('acct-form-type', 'Type (e.g. Savings, Checking)', account.type) +
        '<p style="font-size: 11px; color: #71717A; margin-top: -6px;">Currency can\'t be changed, because the history is stored in ' + account.currency + '. To change it, remove the account and add it again.</p>',
        'saveEditedAccount()');
}

function saveEditedAccount() {
    const name = document.getElementById('acct-form-name').value.trim();
    const type = document.getElementById('acct-form-type').value.trim();
    if (!name) return showAccountFormError('Enter a name.');
    updateLinkedAccount(openAccountId, { name: name, type: type });
    closeModalAndReset();
}
