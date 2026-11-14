// support.js — the pages behind Support on the Account screen: Help, Privacy & terms, About.
// They open in the shared second-level screen (openInfoScreen in profile.js).

const HELP_TOPICS = [
    ['Can Isar move my money?', 'No. Isar can only ever read balances, never move them. It can\'t spend, transfer or withdraw anything, and it holds no money for you. When banks can be connected, that connection will be read-only as well.'],
    ['How do I add a bank?', 'Open the Add tab (the + icon), search for your bank, broker or crypto exchange, then enter its balance and currency.'],
    ['How do I update a balance?', 'Tap the account on the Accounts tab, then tap Update balance. Each update is saved to that account\'s history. Investment accounts with holdings work out their own balance, so you update the holdings instead.'],
    ['Why is my graph empty?', 'Your graph builds up one day at a time, so it needs at least two days of balances to draw a line.'],
    ['Why can\'t I see my transactions?', 'Isar can\'t read your bank yet. For now, the Transactions list on your own accounts shows the balance updates you\'ve entered. Individual transactions will appear once banks are connected.'],
    ['How up to date are exchange rates?', 'Isar uses the European Central Bank\'s reference rates, which are published once each working day. It checks for new rates when it opens and every 5 minutes.'],
    ['How does the Leak Finder work?', 'It adds up the hidden exchange cost of your foreign transactions over the period you pick. Tap it to change the period, see the graph and check each transaction.'],
    ['What is the hidden exchange cost?', 'When you spend in another currency, a bank can say there\'s no fee but give you a worse exchange rate. Isar compares what you were charged with the real rate that day, so you can see what it actually cost. It\'s an estimate, because rates move during the day.'],
    ['Why is growth different from my balance change?', 'Growth only compares accounts that existed at both the start and end of the period, so adding a new bank never counts as growth.'],
    ['Where is my data saved?', 'To your Isar account, so it\'s there on every device you sign in on. A copy is kept on this device too, so the app opens instantly and works offline. Removing the app from your home screen no longer loses anything: sign in again and it comes back.']
];

function openHelp() {
    openInfoScreen('Help & support',
        '<div class="settings-group">' + HELP_TOPICS.map(topic =>
            '<details class="faq"><summary>' + escapeHTML(topic[0]) + '</summary><p>' + escapeHTML(topic[1]) + '</p></details>'
        ).join('') + '</div>' +
        '<p class="info-note">Isar is an early prototype, so there\'s no support team yet.</p>');
}

function infoSectionHTML(title, text) {
    return '<div><div class="section-label">' + title + '</div><p class="info-text">' + text + '</p></div>';
}

// IMPORTANT: this page must always match what the app actually does. Re-read it after any
// change that moves data somewhere new, or it becomes a false statement to the people using it.
function openPrivacy() {
    openInfoScreen('Privacy & terms',
        '<p class="info-note">Plain-English summary for this early version. It isn\'t a final legal document.</p>' +
        infoSectionHTML('Isar never holds or moves money', 'Isar is a read-only tracker. It can show you balances, never spend, transfer or withdraw. It holds no money for you and has no way to move any. Once banks can be connected, that connection will be read-only too.') +
        infoSectionHTML('What Isar saves', 'Your name, email, accounts, balances, history and settings. They\'re saved to your Isar account so they\'re on every device you sign in on, and a copy is kept on this device so the app opens instantly and works offline.') +
        infoSectionHTML('Where it\'s saved', 'With Supabase, on servers in Europe. Each person can only ever read their own data.') +
        infoSectionHTML('Passwords', 'Supabase checks your password. Isar never sees it and never saves it.') +
        infoSectionHTML('Who Isar connects to', 'Supabase, for sign-in and saving your data. Frankfurter, for European Central Bank exchange rates. CoinGecko, for crypto prices. Logo.dev, for bank logos: it receives the bank\'s website address, never your balances. Vercel, which hosts the app.') +
        infoSectionHTML('Not financial advice', 'Figures are for tracking only and may be wrong. Exchange rates are daily reference rates, not the rates your bank gives you. Nothing in Isar is a recommendation to buy, sell or do anything with your money.') +
        infoSectionHTML('Deleting your data', '"Clear saved data" on the Add tab deletes your accounts, history and settings from your Isar account, on every device. Signing out removes the copy from this device. Deleting your whole account, and downloading a copy of your data, are still to come.'));
}

function openAbout() {
    const rows = [
        ['Version', '1.0.0'],
        ['Exchange rates', 'European Central Bank, via Frankfurter'],
        ['Currencies', String(CURRENCIES.length)],
        ['Banks and platforms', String(topBanks.length)]
    ];
    openInfoScreen('About Isar',
        '<div class="info-hero"><img src="icons/icon-192.png" alt=""><strong>Isar</strong><span>One net worth. Every bank, every currency.</span></div>' +
        infoSectionHTML('Read-only, always', 'Isar shows you what you have. It holds no money, and it can never spend, transfer or withdraw any. Bank connections, when they arrive, will be read-only too.') +
        '<div class="settings-group">' + rows.map(row =>
            '<div class="settings-row" style="cursor: default;"><span class="row-label">' + row[0] + '</span><span class="row-value" style="text-align: right;">' + escapeHTML(row[1]) + '</span></div>'
        ).join('') + '</div>' +
        '<p class="info-note"><a href="https://logo.dev" target="_blank" rel="noopener">Logos provided by Logo.dev</a></p>');
}
