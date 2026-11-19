// api/bank-raw.js — exactly what the provider sends for one of YOUR connected banks.
//
// GET /api/bank-raw?connection=<bank_connections id>
// For when an account reads wrong (wrong currency, a missing balance): instead of guessing,
// the app shows the provider's own data on screen ("What BankSync sends"). Read-only.
// Only your own connections (read as you), and only providers that offer it (BankSync and
// SnapTrade, both owner-only, so their own check refuses anyone else). Account numbers are cut to the last 4.

import { requireUser, readRowsAsUser } from './_server.js';
import { providerOf } from './_providers.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    const id = String(request.query.connection || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return response.status(400).json({ ok: false, error: 'Missing the connection.' });

    let connections;
    try {
        connections = await readRowsAsUser(request, 'bank_connections', '*');
    } catch (error) {
        return response.status(502).json({ ok: false, error: 'Could not read your connections: ' + error.message });
    }
    const connection = connections.find(c => c.id === id);
    if (!connection) return response.status(404).json({ ok: false, error: 'That connection isn\'t yours.' });
    const provider = providerOf(connection);
    if (!provider || !provider.rawAccounts) return response.status(400).json({ ok: false, error: 'This bank\'s provider can\'t show its raw data.' });

    try {
        const accounts = await provider.rawAccounts({ connection, request, user });
        response.status(200).json({ ok: true, bank: connection.bank_name, provider: provider.name, accounts: accounts });
    } catch (error) {
        response.status(error.code === 'owner_only' ? 403 : 502).json({ ok: false, error: error.message });
    }
}
