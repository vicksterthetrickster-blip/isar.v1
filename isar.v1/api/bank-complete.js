// api/bank-complete.js — step 2: the bank approved, now save the connection to THIS person.
//
// After approving at the bank, the person lands back on Isar with a one-time `code`. The app
// sends it here with the `state` ticket. The ticket says who started the connection and
// through which provider; that provider swaps the code for a session: a limited, expiring,
// revocable pass that can only READ the approved accounts.
//
// The connection is saved AS THE PERSON THEMSELVES: the database's "own rows only" rules make
// it impossible to file this under anyone else's account. No master key exists.

import { requireUser, saveRowAsUser, checkState } from './_server.js';
import { getProvider } from './_providers.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'POST only' });

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    const code = String((request.body && request.body.code) || '');
    if (!code) return response.status(400).json({ ok: false, error: 'Missing the code from the bank.' });
    // Only a connection this server started, for THIS person, in the last 30 minutes.
    const ticket = checkState(request.body && request.body.state, user.id);
    if (!ticket) {
        return response.status(400).json({ ok: false, error: 'That bank approval has expired or was started from another Isar account. Please connect again.' });
    }
    const provider = getProvider(ticket.p || 'enablebanking');
    if (!provider) return response.status(400).json({ ok: false, error: 'Unknown bank provider.' });

    try {
        const result = await provider.completeConnect({ code, request });
        const row = await saveRowAsUser(request, 'bank_connections', {
            user_id: user.id,
            provider: provider.name,
            bank_name: result.bankName,
            bank_country: result.country,
            session_id: result.sessionId,
            accounts: result.accounts,
            valid_until: result.validUntil
        });
        response.status(200).json({
            ok: true,
            bank: row.bank_name,
            accounts: result.accounts.map(a => ({ name: a.name, currency: a.currency }))
        });
    } catch (error) {
        response.status(502).json({ ok: false, error: error.message });
    }
}
