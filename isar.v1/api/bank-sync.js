// api/bank-sync.js — step 3, repeated forever: fresh balances for YOUR connected banks.
//
// Called when the app opens, when it comes back on screen and every few minutes. The server
// reads this person's rows from bank_connections (as them, so the database only hands over
// their own), then asks each connection's provider for every account's current balance.
// One bank having a bad day doesn't break the rest: errors are reported per account.

import { requireUser, readRowsAsUser, updateRowAsUser } from './_server.js';
import { providerOf } from './_providers.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    let connections;
    try {
        connections = await readRowsAsUser(request, 'bank_connections', '*');
    } catch (error) {
        return response.status(502).json({ ok: false, error: 'Could not read your connections: ' + error.message });
    }

    // Every bank at the same time, so one slow bank can't make the whole sync time out.
    // Within a bank, accounts are read one by one (gentler on the bank's limits).
    const perBank = await Promise.all(connections.map(connection => syncConnection(connection, request, user)));
    response.status(200).json({ ok: true, connections: connections.length, accounts: perBank.flat() });
}

// Always returns an entry for every account (or one for the bank, if it has none), each with
// either a balance or an `error`. Nothing is ever left out silently: the app shows the errors.
async function syncConnection(connection, request, user) {
    const provider = providerOf(connection);
    const expired = connection.valid_until && new Date(connection.valid_until) < new Date();
    const base = {
        provider: connection.provider || 'enablebanking',
        connectionId: connection.id,            // the app groups a bank's accounts by this (not a secret)
        bank: connection.bank_name || 'Bank',
        country: connection.bank_country,
        investments: !!(provider && provider.investments),   // a broker (SnapTrade): Investments, with holdings
        logo: null
    };
    try { base.logo = provider ? provider.logoFor(connection) : null; } catch (e) { /* no logo is fine */ }

    let accounts = Array.isArray(connection.accounts) ? connection.accounts : [];
    // Providers that can list accounts live (BankSync) keep the saved list current: a new
    // account, or a card that turned out to hold several currencies, shows without reconnecting.
    if (provider && provider.refreshAccounts && !expired) {
        try {
            const live = await provider.refreshAccounts({ connection, request, user });
            const merged = live.length ? mergeAccountLists(accounts, live) : accounts;
            if (JSON.stringify(merged) !== JSON.stringify(accounts)) {
                await updateRowAsUser(request, 'bank_connections', connection.id, { accounts: merged });
                accounts = merged;
            }
        } catch (e) { /* keep the saved list; the balance reads below report the problem */ }
    }
    if (!accounts.length) return [{ ...base, uid: null, error: 'no_accounts' }];

    const results = [];
    for (const account of accounts) {
        const entry = { ...base, uid: account.uid, name: account.name, parent: account.parentName || null, currency: upper(account.currency) };
        if (account.missingSince) {
            // Left out of the bank's latest list: the app keeps it (and its history) with its last
            // balance and says so, until it's back or the grace period runs out.
            entry.missingSince = account.missingSince;
            entry.removeAfter = addDays(account.missingSince, MISSING_GRACE_DAYS);
        } else if (!provider) {
            entry.error = 'unknown_provider';
        } else if (expired) {
            entry.error = 'consent_expired';       // the person needs to approve the bank again
        } else {
            try {
                const balance = await provider.getBalance({ account, request, user });
                Object.assign(entry, balance, { currency: upper(balance.currency) || entry.currency });
            } catch (error) {
                entry.error = error.message || 'unknown_error';
            }
        }
        results.push(entry);
    }
    return results;
}

// An account the bank leaves out of ONE answer isn't gone: aggregators sometimes send a short
// list (a bank mid-refresh, a hiccup). Dropping it straight away deleted it in the app, with its
// history and anything you'd set on it, and it came back next time as a brand-new account.
// So the saved list is the live list PLUS any saved account it left out, marked `missingSince`.
// It's only dropped when:
//   - the same bank account is in the live list in a new shape (e.g. a card now split into one
//     account per currency, or back again). That's a replacement, not an absence, so it's
//     dropped at once, or its money would count twice; or
//   - it has been missing for MISSING_GRACE_DAYS days in a row (it really was closed).
// If it comes back in time, it's simply in the live list again, with nothing lost.
const MISSING_GRACE_DAYS = 7;

function mergeAccountLists(saved, live) {
    const today = new Date().toISOString().slice(0, 10);
    const liveUids = new Set(live.map(a => a.uid));
    const liveBankAccounts = new Set(live.map(bankAccountOf));
    const stillWaiting = saved
        .filter(a => a && a.uid && !liveUids.has(a.uid) && !liveBankAccounts.has(bankAccountOf(a)))
        .map(a => ({ ...a, missingSince: a.missingSince || today }))
        .filter(a => addDays(a.missingSince, MISSING_GRACE_DAYS) > today);
    return live.concat(stillWaiting);
}

// The bank's own account id: one currency of a card is saved as "<account id>:<CUR>".
function bankAccountOf(account) {
    return account.accountId || String(account.uid).split(':')[0];
}

function addDays(isoDate, days) {
    const day = new Date(isoDate + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
}

function upper(currency) {
    return typeof currency === 'string' && currency ? currency.trim().toUpperCase() : null;
}
