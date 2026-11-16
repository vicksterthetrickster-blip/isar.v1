// api/bank-connect.js — step 1 of connecting a bank: starts a READ-ONLY consent.
//
// The app calls this with the person's Isar sign-in pass and the bank they picked.
// The server asks Enable Banking to begin an ACCOUNT INFORMATION consent (reading only —
// payments are a different permission Isar never requests and isn't registered for), and
// replies with the bank's own authorisation page URL. The bank carries a signed `state`
// ticket there and back, which bank-complete checks. Nobody's password is involved:
// they log in on the bank's own site.

import { ebRequest, requireUser, makeState } from './_enablebanking.js';

const CONSENT_DAYS = 89;        // how long the bank access lasts before re-approval (banks may cap it lower)

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'POST only' });

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    const name = String((request.body && request.body.name) || '').slice(0, 100);
    const country = String((request.body && request.body.country) || '').toUpperCase();
    if (!name || !/^[A-Z]{2}$/.test(country)) {
        return response.status(400).json({ ok: false, error: 'Send the bank\'s name and two-letter country.' });
    }

    // The person returns to the app's own address, which is whitelisted at Enable Banking.
    const redirectUrl = 'https://' + request.headers.host + '/';
    const state = makeState(user.id);       // anti-forgery ticket naming this person: bank-complete checks it

    try {
        const auth = await ebRequest('/auth', {
            method: 'POST',
            body: {
                access: { valid_until: new Date(Date.now() + CONSENT_DAYS * 24 * 60 * 60 * 1000).toISOString() },
                aspsp: { name: name, country: country },
                state: state,
                redirect_url: redirectUrl,
                psu_type: 'personal'
            }
        });
        response.status(200).json({ ok: true, url: auth.url, state: state });
    } catch (error) {
        response.status(502).json({ ok: false, error: error.message });
    }
}
