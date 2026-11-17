// api/bank-sync.js — step 3, repeated forever: fresh balances for YOUR connected banks.
//
// Called when the app opens, when it comes back on screen and every few minutes. The server
// reads this person's rows from bank_connections (as them, so the database only hands over
// their own), then asks each connection's provider for every account's current balance.
// One bank having a bad day doesn't break the rest: errors are reported per account.

import { requireUser, readRowsAsUser } from './_server.js';
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
        logo: null
    };
    try { base.logo = provider ? provider.logoFor(connection) : null; } catch (e) { /* no logo is fine */ }

    const accounts = Array.isArray(connection.accounts) ? connection.accounts : [];
    if (!accounts.length) return [{ ...base, uid: null, error: 'no_accounts' }];

    const results = [];
    for (const account of accounts) {
        const entry = { ...base, uid: account.uid, name: account.name, currency: upper(account.currency) };
        if (!provider) {
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

function upper(currency) {
    return typeof currency === 'string' && currency ? currency.trim().toUpperCase() : null;
}
