// api/banks.js — lists the real banks Isar can connect to in a country.
//
// Try it in a browser:  /api/banks?country=ES   (Spain: CaixaBank, and Revolut's Spanish arm)
//                       /api/banks?country=GB   (the UK)
//
// This is the first endpoint that actually talks to Enable Banking, so it doubles as proof
// that the application ID and private key in Vercel are working.
//
// The list of banks isn't private information (it's the same list on Enable Banking's own
// site), so this endpoint doesn't require signing in. Everything that touches YOUR money
// does — see requireUser in _enablebanking.js.

import { ebRequest } from './_enablebanking.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    // Two letters only, e.g. ES, GB, AU. Guards against odd values being passed on.
    const country = String(request.query.country || 'ES').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
        return response.status(400).json({ ok: false, error: 'country must be two letters, e.g. ES' });
    }

    try {
        const data = await ebRequest('/aspsps?country=' + country);
        const banks = (data.aspsps || []).map(bank => ({
            name: bank.name,
            country: bank.country,
            logo: bank.logo,
            // "personal" vs "business" accounts; Isar wants personal ones.
            psuTypes: bank.psu_types || [],
            // How long a consent can last before the bank makes you approve again (days).
            maxConsentDays: bank.maximum_consent_validity ? Math.round(bank.maximum_consent_validity / 86400) : null
        }));
        response.status(200).json({ ok: true, country, count: banks.length, banks });
    } catch (error) {
        // status 401/403 here almost always means the key or app ID is wrong in Vercel.
        response.status(error.status === 401 || error.status === 403 ? 401 : 502)
            .json({ ok: false, error: error.message });
    }
}
