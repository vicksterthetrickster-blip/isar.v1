// support.js — the pages behind Support on the Account screen: Help, Privacy & terms, About.
// They open in the shared second-level screen (openInfoScreen in profile.js).

const HELP_TOPICS = [
    ['How do I add a bank?', 'Open the Connect tab (the + icon), search for your bank, broker or crypto exchange, then enter its balance and currency.'],
    ['How do I update a balance?', 'Tap the account on the Accounts tab, then tap Update balance. Each update is saved to that account\'s history.'],
    ['Why is my graph empty?', 'Your graph builds up one day at a time, so it needs at least two days of balances to draw a line.'],
    ['Why can\'t I see my transactions?', 'Isar can\'t read your bank yet. For now, the Transactions list on your own accounts shows the balance updates you\'ve entered. Individual transactions will appear once banks are connected.'],
    ['How up to date are exchange rates?', 'Isar uses the European Central Bank\'s reference rates, which are published once each working day. It checks for new rates when it opens and every 5 minutes.'],
    ['What is the hidden exchange cost?', 'When you spend in another currency, a bank can say there\'s no fee but give you a worse exchange rate. Isar compares what you were charged with the real rate that day, so you can see what it actually cost. It\'s an estimate, because rates move during the day.'],
    ['Why is growth different from my balance change?', 'Growth only compares accounts that existed at both the start and end of the period, so adding a new bank never counts as growth.'],
    ['Where is my data saved?', 'On this device only, inside the app. Removing the app from your home screen deletes it, and your account doesn\'t carry over to other devices yet.']
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

function openPrivacy() {
    openInfoScreen('Privacy & terms',
        '<p class="info-note">Plain-English summary for this prototype. It isn\'t a final legal document.</p>' +
        infoSectionHTML('What Isar saves', 'Your name, email, accounts, balances, history and settings are saved on this device only. Nothing is sent to an Isar server, because there isn\'t one yet.') +
        infoSectionHTML('Passwords', 'Passwords aren\'t saved or checked yet, so sign-in doesn\'t protect your data. Don\'t use a password you use anywhere else.') +
        infoSectionHTML('Who Isar connects to', 'Frankfurter, for exchange rates. Logo.dev, for bank logos: it receives the bank\'s website address, never your balances. Vercel, which hosts the app.') +
        infoSectionHTML('Not financial advice', 'Figures are for tracking only and may be wrong. Exchange rates are daily reference rates, not the rates your bank would give you.') +
        infoSectionHTML('Deleting your data', 'Use "Clear saved data" on the Connect tab, or remove the app from your home screen.'));
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
        '<div class="settings-group">' + rows.map(row =>
            '<div class="settings-row" style="cursor: default;"><span class="row-label">' + row[0] + '</span><span class="row-value" style="text-align: right;">' + escapeHTML(row[1]) + '</span></div>'
        ).join('') + '</div>' +
        '<p class="info-note"><a href="https://logo.dev" target="_blank" rel="noopener">Logos provided by Logo.dev</a></p>');
}
