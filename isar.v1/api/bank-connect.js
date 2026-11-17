// api/bank-connect.js — step 1 of connecting a bank: starts a READ-ONLY consent.
//
// The app calls this with the person's Isar sign-in pass and the bank they picked. The
// provider for that bank's country starts an account-information consent (reading only) and
// returns the bank's own page to send the person to. A signed `state` ticket naming the person
// and the provider goes there and back, and bank-complete checks it. Nobody's password is
// involved: they log in on the bank's own site.

import { requireUser, makeState } from './_server.js';
import { getProvider, providerForCountry } from './_providers.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'POST only' });

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    const body = request.body || {};
    const name = String(body.name || '').slice(0, 100);
    const country = String(body.country || '').toUpperCase();
    if (!name || !/^[A-Z]{2}$/.test(country)) {
        return response.status(400).json({ ok: false, error: 'Send the bank\'s name and two-letter country.' });
    }
    const provider = getProvider(body.provider) || providerForCountry(country);
    if (!provider) return response.status(400).json({ ok: false, error: 'Isar can\'t connect banks in this country yet.' });

    // The person returns to the app's own address, which is whitelisted at the provider.
    const redirectUrl = 'https://' + request.headers.host + '/';
    const state = makeState(user.id, provider.name);

    try {
        const bankId = String(body.bankId || '').slice(0, 100);    // BankSync's id for the bank, if it has one
        const url = await provider.startConnect({ bank: { name, country, id: bankId }, state, redirectUrl, request, user });
        response.status(200).json({ ok: true, url: url });
    } catch (error) {
        response.status(error.code === 'owner_only' ? 403 : 502).json({ ok: false, error: error.message });
    }
}
