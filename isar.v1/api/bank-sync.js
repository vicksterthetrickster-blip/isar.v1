// api/bank-sync.js — step 3, repeated forever: fresh balances for YOUR connected banks.
//
// Called when the app opens and every few minutes. The server reads this person's rows from
// bank_connections (as them, so the database only hands over their own), then asks Enable
// Banking for each account's current balance, signing every request with Isar's private key.
// One bank having a bad day doesn't break the rest: errors are reported per account.

import { ebRequest, requireUser, readRowsAsUser } from './_enablebanking.js';

// Banks report several balance "types"; these are the ones that mean the everyday balance,
// most useful first. CLAV = available, CLBD = booked, XPCD = expected.
const BALANCE_PREFERENCE = ['CLAV', 'CLBD', 'XPCD'];

function pickBalance(balances) {
    for (const type of BALANCE_PREFERENCE) {
        const match = balances.find(b => b.balance_type === type);
        if (match) return match;
    }
    return balances[0] || null;
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    let connections;
    try {
        connections = await readRowsAsUser(request, 'bank_connections',
            'id,bank_name,bank_country,session_id,accounts,valid_until');
    } catch (error) {
        return response.status(502).json({ ok: false, error: 'Could not read your connections: ' + error.message });
    }

    const results = [];
    for (const connection of connections) {
        const expired = connection.valid_until && new Date(connection.valid_until) < new Date();
        for (const account of connection.accounts || []) {
            const entry = {
                uid: account.uid,
                bank: connection.bank_name,
                country: connection.bank_country,
                name: account.name,
                iban: account.iban,
                currency: account.currency
            };
            if (expired) {
                entry.error = 'consent_expired';       // the person needs to approve the bank again
            } else {
                try {
                    const data = await ebRequest('/accounts/' + encodeURIComponent(account.uid) + '/balances', { psu: request });
                    const best = pickBalance(data.balances || []);
                    if (best && best.balance_amount) {
                        entry.balance = Number(best.balance_amount.amount);
                        entry.currency = best.balance_amount.currency || entry.currency;
                        entry.balanceType = best.balance_type;
                    } else {
                        entry.error = 'no_balance_reported';
                    }
                } catch (error) {
                    entry.error = error.message;
                }
            }
            results.push(entry);
        }
    }

    response.status(200).json({ ok: true, connections: connections.length, accounts: results });
}
