// api/bank-transactions.js — the transactions of ONE of your connected bank accounts.
//
// GET /api/bank-transactions?provider=enablebanking&uid=<account uid>&from=YYYY-MM-DD
// The server first checks the account is in one of YOUR connections (read as you, so the
// database only hands over your own), then asks that connection's provider for its
// transactions since `from`, already in Isar's transaction shape (see js/transactions.js).

import { requireUser, readRowsAsUser } from './_server.js';
import { providerOf } from './_providers.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    const uid = String(request.query.uid || '');
    const providerName = String(request.query.provider || 'enablebanking');
    const from = String(request.query.from || '');
    if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return response.status(400).json({ ok: false, error: 'Missing account or start date.' });

    let connections;
    try {
        connections = await readRowsAsUser(request, 'bank_connections', '*');
    } catch (error) {
        return response.status(502).json({ ok: false, error: 'Could not read your connections: ' + error.message });
    }
    const connection = connections.find(c => (c.provider || 'enablebanking') === providerName && (c.accounts || []).some(a => a.uid === uid));
    if (!connection) return response.status(404).json({ ok: false, error: 'That account isn\'t one of your connections.' });
    if (connection.valid_until && new Date(connection.valid_until) < new Date()) {
        return response.status(403).json({ ok: false, error: 'consent_expired' });
    }
    const provider = providerOf(connection);
    if (!provider) return response.status(400).json({ ok: false, error: 'Unknown bank provider.' });

    try {
        const account = connection.accounts.find(a => a.uid === uid);
        const transactions = await provider.getTransactions({ connection, account, from, request, user });
        // partial: the provider had more pages than it was allowed to read, so the list is incomplete.
        response.status(200).json({ ok: true, from: from, transactions: transactions, partial: !!transactions.partial });
    } catch (error) {
        const status = error.code === 'owner_only' ? 403 : (error.status === 422 || error.status === 400 ? 422 : 502);
        response.status(status).json({ ok: false, error: error.message });
    }
}
