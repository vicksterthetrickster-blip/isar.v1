// api/banks.js — lists the real banks Isar can connect to in a country.
//
// Try it in a browser:  /api/banks?country=ES   (Spain)
//                       /api/banks?country=GB   (the UK)
//
// The country decides the provider (see _providers.js). The list of banks isn't private
// information, so this endpoint doesn't require signing in. Everything that touches YOUR money
// does — see requireUser in _server.js.

import { providerForCountry } from './_providers.js';

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    // Two letters only, e.g. ES, GB, AU. Guards against odd values being passed on.
    const country = String(request.query.country || 'ES').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
        return response.status(400).json({ ok: false, error: 'country must be two letters, e.g. ES' });
    }
    const provider = providerForCountry(country);
    if (!provider) return response.status(404).json({ ok: false, error: 'Isar can\'t connect banks in this country yet.' });

    try {
        const banks = (await provider.listBanks(country)).map(bank => ({ ...bank, provider: provider.name }));
        response.status(200).json({ ok: true, country, count: banks.length, banks });
    } catch (error) {
        // status 401/403 here almost always means the provider's keys are wrong in Vercel.
        response.status(error.status === 401 || error.status === 403 ? 401 : 502)
            .json({ ok: false, error: error.message });
    }
}
