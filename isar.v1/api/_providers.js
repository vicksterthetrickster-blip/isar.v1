// api/_providers.js — which provider handles which country.
//
// Open banking is regulated by region, and one provider covers a whole region, so adding a
// region is one adapter file (_provider-<name>.js) plus one line here. Nothing else on the server or in the app
// knows provider details. See the Provider strategy note.

import * as enablebanking from './_provider-enablebanking.js';
import * as banksync from './_provider-banksync.js';

const PROVIDERS = { enablebanking, banksync };

// Europe and the UK (PSD2) go through Enable Banking.
const PROVIDER_BY_COUNTRY = {};
['ES', 'GB', 'IE', 'LT', 'FR', 'DE', 'IT', 'PT', 'NL', 'FI', 'SE', 'NO', 'DK', 'PL', 'BE', 'AT']
    .forEach(country => { PROVIDER_BY_COUNTRY[country] = 'enablebanking'; });
// Australia (CDR) goes through BankSync, which only ever answers for the owner (see its file).
PROVIDER_BY_COUNTRY.AU = 'banksync';

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
