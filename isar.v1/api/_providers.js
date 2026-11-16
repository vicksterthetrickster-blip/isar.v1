// api/_providers.js — which provider handles which country.
//
// Open banking is regulated by region, and one provider covers a whole region, so adding a
// region is one adapter file (_provider-<name>.js) plus one line here. Nothing else on the server or in the app
// knows provider details. See the Provider strategy note.

import * as enablebanking from './_provider-enablebanking.js';

const PROVIDERS = { enablebanking };

// Europe and the UK (PSD2). Australia (CDR) will route to its own adapter.
const PROVIDER_BY_COUNTRY = {};
['ES', 'GB', 'IE', 'LT', 'FR', 'DE', 'IT', 'PT', 'NL', 'FI', 'SE', 'NO', 'DK', 'PL', 'BE', 'AT']
    .forEach(country => { PROVIDER_BY_COUNTRY[country] = 'enablebanking'; });

export function getProvider(name) {
    return Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
}

export function providerForCountry(country) {
    return getProvider(PROVIDER_BY_COUNTRY[country]);
}

// Connections saved before providers were recorded are all Enable Banking.
export function providerOf(connection) {
    return getProvider(connection.provider || 'enablebanking');
}
