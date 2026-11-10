// accounttypes.js — the four groups everything in Isar belongs to, and the things you add by hand.
//
//   Cash         the balance, read from the bank (or typed in for now)
//   Investments  stocks, ETFs, crypto and retirement funds. Can list what's inside (holdings.js),
//                or just one total
//   Assets       an estimate you enter and update: property, cars, valuables...
//   Debts        what you owe. STORED AS A NEGATIVE BALANCE, so every total, graph and daily
//                snapshot subtracts it automatically. Forms ask for the positive amount owed.

const ACCOUNT_GROUPS = [
    { id: 'cash', label: 'Cash' },
    { id: 'investments', label: 'Investments' },
    { id: 'assets', label: 'Assets' },
    { id: 'debts', label: 'Debts' }
];

// Line icons for tiles, in the same style as the tab bar
const KIND_ICONS = {
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    retirement: '<path d="M22 12a10 10 0 0 0-20 0z"/><path d="M12 12v7a2 2 0 0 0 4 0"/><path d="M12 2v1"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    car: '<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><path d="M5 12h14"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/>',
    gem: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/><path d="M12 21 8 9l4-6 4 6z"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 13h20"/>',
    dollar: '<path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
    loan: '<path d="M3 21h18"/><path d="M5 21V10M10 21V10M14 21V10M19 21V10"/><path d="m12 3 9 6H3z"/>',
    study: '<path d="M22 10 12 5 2 10l10 5z"/><path d="M6 12.5V17c3 2.5 9 2.5 12 0v-4.5"/>',
    other: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
};

// Everything you can add by hand. `linkable` debts can be tied to a property to show its equity.
const MANUAL_KINDS = {
    cashAtHome: { group: 'cash', label: 'Cash at home', hint: 'Notes and coins', icon: 'cash', color: '#2F6F5E' },
    retirement: { group: 'investments', label: 'Retirement fund', hint: 'Super, 401(k), pension', icon: 'retirement', color: '#4F46E5' },
    property: { group: 'assets', label: 'Property', hint: 'Home, apartment, land', icon: 'home', color: '#0F766E' },
    vehicle: { group: 'assets', label: 'Vehicle', hint: 'Car, motorbike, boat', icon: 'car', color: '#475569' },
    valuables: { group: 'assets', label: 'Valuables', hint: 'Watches, art, jewellery', icon: 'gem', color: '#9333EA' },
    business: { group: 'assets', label: 'Business', hint: 'A company you own', icon: 'briefcase', color: '#B45309' },
    owed: { group: 'assets', label: 'Money owed to you', hint: 'A loan to someone', icon: 'dollar', color: '#15803D' },
    otherAsset: { group: 'assets', label: 'Other asset', hint: 'Anything else of value', icon: 'other', color: '#3F3F46' },
    mortgage: { group: 'debts', label: 'Mortgage', hint: 'Can be linked to a property', icon: 'home', color: '#9F1239', linkable: true },
    creditCard: { group: 'debts', label: 'Credit card', hint: 'What you currently owe', icon: 'card', color: '#BE123C' },
    carLoan: { group: 'debts', label: 'Car loan', hint: 'Vehicle finance', icon: 'car', color: '#A21CAF' },
    personalLoan: { group: 'debts', label: 'Personal loan', hint: 'Any fixed loan', icon: 'loan', color: '#C2410C' },
    studentDebt: { group: 'debts', label: 'Student debt', hint: 'HECS, student loans', icon: 'study', color: '#1D4ED8' },
    otherDebt: { group: 'debts', label: 'Other debt', hint: 'Anything else you owe', icon: 'other', color: '#3F3F46' }
};

function kindIconHTML(iconName) {
    return '<svg class="kind-icon" viewBox="0 0 24 24">' + KIND_ICONS[iconName] + '</svg>';
}

// The group of an institution in the bank list: brokers and exchanges are investments.
function bankGroup(bank) {
    return bank && (bank.kind === 'broker' || bank.kind === 'crypto') ? 'investments' : 'cash';
}

function accountGroup(account) {
    return account.group || bankGroup(topBanks.find(b => b.name === account.bankName));
}

function isDebt(account) {
    return accountGroup(account) === 'debts';
}

// True for things you value yourself, which have updates rather than transactions.
function isValuedByHand(account) {
    const group = accountGroup(account);
    return group === 'assets' || group === 'debts';
}

// Everything you own, and everything you owe, in AUD. Net worth is the two added together
// (debts are negative). Percentages use total assets: a share of net worth stops making sense
// once debts are involved, because shares could add up to well over 100%.
function getAssetsTotalAUD() {
    return ACCOUNTS.filter(a => !isDebt(a)).reduce((sum, a) => sum + convertToBase(a.balance, a.currency), 0);
}

function getDebtsTotalAUD() {
    return ACCOUNTS.filter(isDebt).reduce((sum, a) => sum + convertToBase(a.balance, a.currency), 0);
}

// What's left of an asset after any debts linked to it, in the asset's own currency.
function getEquity(asset) {
    const debts = ACCOUNTS.filter(a => a.linkedTo === asset.id);
    if (!debts.length) return null;
    const owed = debts.reduce((sum, d) => sum + convertToBase(d.balance, d.currency), 0);
    return asset.balance + convertFromBase(owed, asset.currency);
}

function addManualAccount(kindId, name, amount, currency, linkedTo) {
    const kind = MANUAL_KINDS[kindId];
    const balance = kind.group === 'debts' ? -amount : amount;
    const addedDate = localISODate(new Date());
    ACCOUNTS.push({
        id: 'manual-' + Date.now().toString(36),
        name: name,
        type: kind.label,
        group: kind.group,
        kind: kindId,
        letter: Array.from(name)[0].toUpperCase(),
        color: kind.color,
        balance: balance,
        currency: currency,
        linkedTo: linkedTo || undefined,
        addedDate: addedDate,
        history: [{ date: addedDate, time: currentTimeHHMM(), balance: balance }],
        historySource: 'manual',
        userLinked: true
    });
    saveLinkedAccounts();
    refreshAfterAccountChange();
}

// --- The Add tab: search everything first, then add assets and debts by hand further down ---
let manualFormKind = null;

function manualKindsHTML(kinds) {
    return kinds.map(id => {
        const kind = MANUAL_KINDS[id];
        return '<button class="setup-item" onclick="openManualForm(\'' + id + '\')">' +
            bankIconHTML({ name: kind.label, color: kind.color, kind: id }, 32) +
            '<span class="setup-item-name">' + kind.label + '<small>' + kind.hint + '</small></span>' +
            '<span class="setup-add">Add</span>' +
        '</button>';
    }).join('');
}

// Cash at home and retirement funds sit with the assets here, as things you add by hand.
function renderManualLists() {
    const ids = Object.keys(MANUAL_KINDS);
    document.getElementById('add-assets-list').innerHTML = manualKindsHTML(ids.filter(id => MANUAL_KINDS[id].group !== 'debts'));
    document.getElementById('add-debts-list').innerHTML = manualKindsHTML(ids.filter(id => MANUAL_KINDS[id].group === 'debts'));
}

function openManualForm(kindId) {
    const kind = MANUAL_KINDS[kindId];
    const debt = kind.group === 'debts';
    const properties = ACCOUNTS.filter(a => a.kind === 'property');
    manualFormKind = kindId;
    showAccountForm('Add ' + kind.label.toLowerCase(),
        formInputHTML('manual-name', 'Name', '') +
        formInputHTML('manual-amount', debt ? 'Amount owed' : 'Current value', '', 'number') +
        '<label class="form-label">Currency<select id="manual-currency" class="form-select">' + currencyOptionsHTML(activeCurrency) + '</select></label>' +
        (kind.linkable && properties.length ? linkSelectHTML(properties, '') : ''),
        'saveManualAccount()');
}

function linkSelectHTML(properties, selected) {
    return '<label class="form-label">Linked property<select id="manual-link" class="form-select"><option value="">None</option>' +
        properties.map(p => '<option value="' + p.id + '"' + (p.id === selected ? ' selected' : '') + '>' + escapeHTML(p.name) + '</option>').join('') +
    '</select></label>';
}

function saveManualAccount() {
    const name = document.getElementById('manual-name').value.trim();
    const raw = document.getElementById('manual-amount').value.trim();
    const amount = Number(raw);
    if (!name) return showAccountFormError('Enter a name.');
    if (raw === '' || !isFinite(amount) || amount < 0) return showAccountFormError('Enter an amount of 0 or more.');
    const link = document.getElementById('manual-link');
    addManualAccount(manualFormKind, name, Math.round(amount * 100) / 100, document.getElementById('manual-currency').value, link ? link.value : '');
    closeModalAndReset();
    showToast(name + ' added');
}
