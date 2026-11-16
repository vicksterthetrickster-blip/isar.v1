// api/_provider-enablebanking.js — the Enable Banking adapter (Europe and the UK, PSD2).
//
// Every provider adapter offers the same functions and returns Isar's own shapes, so the
// endpoints never know which provider they're talking to (see _providers.js):
//   listBanks(country)                                   -> [{ name, country, logo, maxConsentDays }]
//   startConnect({ bank, state, redirectUrl, request })  -> the bank's URL to send the person to
//   completeConnect({ code, request })                   -> { bankName, country, sessionId, accounts, validUntil }
//   getBalance({ account, request })                     -> { balance, currency, balanceType }
//   getTransactions({ account, from, request })          -> [Isar transactions, see js/transactions.js]
//   logoFor(connection)                                  -> the bank's logo URL
//
// Every request to Enable Banking is signed with Isar's private RSA key (a "JWT"), proving it
// really comes from our registered application. The key lives ONLY in Vercel's environment
// variables, never in this code.

import { createSign } from 'crypto';

const EB_BASE = 'https://api.enablebanking.com';
const JWT_LIFETIME_SECONDS = 3600;        // 1 hour (their maximum is 24)
const CONSENT_DAYS = 89;                  // how long the bank access lasts (banks may cap it lower)
const MAX_PAGES = 20;                     // a safety stop; a year of everyday spending is a few pages

export const name = 'enablebanking';

// Vercel normally keeps the key's line breaks, but some ways of pasting turn them into the
// characters \ and n. This repairs that, so either form works.
function readPrivateKey() {
    const key = process.env.ENABLE_BANKING_PRIVATE_KEY;
    if (!key) throw new Error('ENABLE_BANKING_PRIVATE_KEY is not set in Vercel.');
    return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

function makeJWT() {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    if (!appId) throw new Error('ENABLE_BANKING_APP_ID is not set in Vercel.');
    const now = Math.floor(Date.now() / 1000);
    const header = { typ: 'JWT', alg: 'RS256', kid: appId };
    const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + JWT_LIFETIME_SECONDS };
    const unsigned = Buffer.from(JSON.stringify(header)).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    return unsigned + '.' + signer.sign(readPrivateKey(), 'base64url');
}

// "The person is here right now." Without these, banks treat a read as a background job and
// allow only about 4 a day (PSD2). Pass the incoming request as `psu` when the person opened the app.
function psuHeaders(request) {
    if (!request) return {};
    const headers = {};
    const ip = String(request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || '').split(',')[0].trim();
    if (ip) headers['Psu-Ip-Address'] = ip;
    if (request.headers['user-agent']) headers['Psu-User-Agent'] = request.headers['user-agent'];
    if (request.headers['accept-language']) headers['Psu-Accept-Language'] = request.headers['accept-language'];
    return headers;
}

// Throws a readable error if Enable Banking refuses, so endpoints can report something useful.
async function ebRequest(path, options = {}) {
    const reply = await fetch(EB_BASE + path, {
        method: options.method || 'GET',
        headers: {
            Authorization: 'Bearer ' + makeJWT(),
            ...psuHeaders(options.psu),
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    const text = await reply.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON: keep the raw text below */ }
    if (!reply.ok) {
        const detail = (data && (data.message || data.error || data.detail)) || text.slice(0, 200) || 'no detail';
        const error = new Error('Enable Banking said ' + reply.status + ': ' + detail);
        error.status = reply.status;
        throw error;
    }
    return data;
}

// --- The bank list (personal accounts only; Isar isn't a business tool yet) ---
export async function listBanks(country) {
    const data = await ebRequest('/aspsps?country=' + country);
    return (data.aspsps || [])
        .filter(bank => !(bank.psu_types || []).length || bank.psu_types.includes('personal'))
        .map(bank => ({
            name: bank.name,
            country: bank.country,
            logo: bank.logo,
            // How long a consent can last before the bank makes you approve again (days).
            maxConsentDays: bank.maximum_consent_validity ? Math.round(bank.maximum_consent_validity / 86400) : null
        }));
}

// --- Connecting: an ACCOUNT INFORMATION consent (reading only; payments are a different
// permission Isar never requests and isn't registered for) ---
export async function startConnect({ bank, state, redirectUrl }) {
    const auth = await ebRequest('/auth', {
        method: 'POST',
        body: {
            access: { valid_until: new Date(Date.now() + CONSENT_DAYS * 24 * 60 * 60 * 1000).toISOString() },
            aspsp: { name: bank.name, country: bank.country },
            state: state,
            redirect_url: redirectUrl,
            psu_type: 'personal'
        }
    });
    return auth.url;
}

// Swaps the bank's one-time code for a session. Some account fields are shown only once, at
// this moment — so they're returned for saving now.
export async function completeConnect({ code }) {
    const session = await ebRequest('/sessions', { method: 'POST', body: { code: code } });
    return {
        bankName: (session.aspsp && session.aspsp.name) || 'Bank',
        country: (session.aspsp && session.aspsp.country) || '',
        sessionId: session.session_id,
        validUntil: (session.access && session.access.valid_until) || null,
        accounts: (session.accounts || []).map(account => ({
            uid: account.uid,
            name: account.name || null,
            currency: account.currency || null,
            iban: (account.account_id && account.account_id.iban) || null,
            product: account.product || null
        }))
    };
}

// --- Balances ---
// Banks report several balance "types"; these mean the everyday balance, most useful first.
// CLAV = available, CLBD = booked, XPCD = expected.
const BALANCE_PREFERENCE = ['CLAV', 'CLBD', 'XPCD'];

export async function getBalance({ account, request }) {
    const data = await ebRequest('/accounts/' + encodeURIComponent(account.uid) + '/balances', { psu: request });
    const balances = data.balances || [];
    const best = BALANCE_PREFERENCE.map(type => balances.find(b => b.balance_type === type)).find(Boolean) || balances[0];
    if (!best || !best.balance_amount) throw new Error('no_balance_reported');
    return { balance: Number(best.balance_amount.amount), currency: best.balance_amount.currency || account.currency, balanceType: best.balance_type };
}

// --- Transactions ---
function isoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

// Banks describe a payment in different fields; use the most readable one they filled in.
function describe(tx, moneyIn) {
    const party = moneyIn ? tx.debtor && tx.debtor.name : tx.creditor && tx.creditor.name;
    const remittance = Array.isArray(tx.remittance_information) ? tx.remittance_information.filter(Boolean).join(' ') : '';
    return (party || remittance || tx.note || (tx.bank_transaction_code && tx.bank_transaction_code.description) || (moneyIn ? 'Money in' : 'Money out')).trim().slice(0, 140);
}

function toIsarTransaction(tx, index) {
    const amount = Number(tx.transaction_amount && tx.transaction_amount.amount);
    const date = isoDate(tx.booking_date) || isoDate(tx.transaction_date) || isoDate(tx.value_date);
    if (!Number.isFinite(amount) || !date) return null;

    // Enable Banking gives a positive amount and says separately whether it went in or out.
    const moneyIn = tx.credit_debit_indicator === 'CRDT';
    const signed = Math.abs(amount) * (moneyIn ? 1 : -1);
    const result = {
        id: 'eb-' + (tx.entry_reference || tx.transaction_id || [date, signed, index].join('-')),
        date: date,
        description: describe(tx, moneyIn),
        category: tx.status === 'PDNG' ? 'Pending' : ((tx.bank_transaction_code && tx.bank_transaction_code.description) || ''),
        amount: signed
    };

    // A card payment abroad: what was actually spent, which the hidden exchange cost needs.
    const instructed = tx.exchange_rate && tx.exchange_rate.instructed_amount;
    if (instructed && instructed.currency && instructed.currency !== tx.transaction_amount.currency && Number.isFinite(Number(instructed.amount))) {
        result.original = { amount: Math.abs(Number(instructed.amount)) * (moneyIn ? 1 : -1), currency: instructed.currency };
    }
    return result;
}

export async function getTransactions({ account, from, request }) {
    const transactions = [];
    let continuation = null;
    for (let page = 0; page < MAX_PAGES; page++) {
        const query = '?date_from=' + from + (continuation ? '&continuation_key=' + encodeURIComponent(continuation) : '');
        const data = await ebRequest('/accounts/' + encodeURIComponent(account.uid) + '/transactions' + query, { psu: request });
        (data.transactions || []).forEach(tx => {
            const converted = toIsarTransaction(tx, transactions.length);
            if (converted) transactions.push(converted);
        });
        continuation = data.continuation_key;
        if (!continuation) break;
    }
    return transactions;
}

export function logoFor(connection) {
    return 'https://enablebanking.com/brands/' + encodeURIComponent(connection.bank_country) + '/' + encodeURIComponent(connection.bank_name) + '/';
}
