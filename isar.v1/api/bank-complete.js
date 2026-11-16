// api/bank-complete.js — step 2: the bank approved, now save the connection to THIS person.
//
// After approving at the bank, the person lands back on Isar with a one-time `code`.
// The app sends it here (with their sign-in pass). The server swaps the code for a session:
// a limited, expiring, revocable pass that can only READ the approved accounts.
//
// The connection is saved to the bank_connections table AS THE PERSON THEMSELVES: the server
// passes their own sign-in along to the database, so the database's "own rows only" rules
// make it impossible to file this under anyone else's account. No master key exists.

import { ebRequest, requireUser, saveRowAsUser, checkState } from './_enablebanking.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'POST only' });

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    const code = String((request.body && request.body.code) || '');
    if (!code) return response.status(400).json({ ok: false, error: 'Missing the code from the bank.' });
    // Only a connection this server started, for THIS person, in the last 30 minutes.
    if (!checkState(request.body && request.body.state, user.id)) {
        return response.status(400).json({ ok: false, error: 'That bank approval has expired or was started from another Isar account. Please connect again.' });
    }

    try {
        const session = await ebRequest('/sessions', { method: 'POST', body: { code: code } });

        // Keep only what syncing needs. Enable Banking warns some account fields are shown
        // only once, at this moment — so they're stored now.
        const accounts = (session.accounts || []).map(account => ({
            uid: account.uid,
            name: account.name || null,
            currency: account.currency || null,
            iban: (account.account_id && account.account_id.iban) || null,
            product: account.product || null
        }));

        const row = await saveRowAsUser(request, 'bank_connections', {
            user_id: user.id,
            bank_name: (session.aspsp && session.aspsp.name) || 'Bank',
            bank_country: (session.aspsp && session.aspsp.country) || '',
            session_id: session.session_id,
            accounts: accounts,
            valid_until: (session.access && session.access.valid_until) || null
        });

        response.status(200).json({
            ok: true,
            bank: row.bank_name,
            accounts: accounts.map(a => ({ name: a.name, currency: a.currency }))
        });
    } catch (error) {
        response.status(502).json({ ok: false, error: error.message });
    }
}
