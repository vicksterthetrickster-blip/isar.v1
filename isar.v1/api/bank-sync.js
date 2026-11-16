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

    const results = [];
    for (const connection of connections) {
        const provider = providerOf(connection);
        const expired = connection.valid_until && new Date(connection.valid_until) < new Date();
        for (const account of connection.accounts || []) {
            const entry = {
                provider: connection.provider || 'enablebanking',
                uid: account.uid,
                bank: connection.bank_name,
                country: connection.bank_country,
                logo: provider ? provider.logoFor(connection) : null,
                name: account.name,
                currency: account.currency
            };
            if (!provider) {
                entry.error = 'unknown_provider';
            } else if (expired) {
                entry.error = 'consent_expired';       // the person needs to approve the bank again
            } else {
                try {
                    Object.assign(entry, await provider.getBalance({ account, request }));
                } catch (error) {
                    entry.error = error.message;
                }
            }
            results.push(entry);
        }
    }

    response.status(200).json({ ok: true, connections: connections.length, accounts: results });
}
