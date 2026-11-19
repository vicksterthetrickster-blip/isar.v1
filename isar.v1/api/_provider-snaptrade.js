// api/_provider-snaptrade.js — the SnapTrade adapter (CommSec and other brokers). OWNER ONLY.
//
// Same functions as the bank adapters (see _provider-banksync.js), so the same endpoints, the
// same "Connect a bank" list and the same sync handle it. What's different:
//   - It reads INVESTMENTS: each broker account's value, and what it holds (getBalance also
//     returns `holdings`, which the app shows on the account screen).
//   - No transactions (an investment account's value moves with prices, not only payments).
//
// SnapTrade Personal is one free key pair that reads the owner's own brokers, the same
// situation as BankSync's key. So every request first checks the caller is the owner
// (ISAR_OWNER_USER_ID), the same check BankSync uses, failing closed.
//
// Vercel settings it needs (never in code):
//   SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY    the Personal key pair (dashboard.snaptrade.com/api-key)
//   SNAPTRADE_USER_ID, SNAPTRADE_USER_SECRET       only if SnapTrade's dashboard gives you a user too
//                                                  (Personal keys normally don't need one)
//
// Connecting: Isar asks SnapTrade for a one-off link to its Connection Portal. You pick CommSec
// there and log in on SnapTrade's screen (not CommSec's own site, and not Isar's). SnapTrade
// sends you back to Isar with ?status=SUCCESS&connection_id=… and the signed ticket.

import { createHmac } from 'crypto';
import { isOwner } from './_provider-banksync.js';

const ST_BASE = 'https://api.snaptrade.com';
const REQUEST_TIMEOUT_MS = 15000;
const CACHE_MS = 10 * 60 * 1000;     // SnapTrade Personal refreshes about daily; positions allow 10 reads a minute per account

export const name = 'snaptrade';
export const ownerOnly = true;
export const investments = true;     // the app treats its accounts as Investments, with holdings

function requireOwner(user) {
    if (isOwner(user)) return;
    const error = new Error('Broker connections aren\'t available on this Isar account.');
    error.status = 403;
    error.code = 'owner_only';
    throw error;
}

function keys() {
    const clientId = String(process.env.SNAPTRADE_CLIENT_ID || '').trim();
    const consumerKey = String(process.env.SNAPTRADE_CONSUMER_KEY || '').trim();
    if (!clientId || !consumerKey) throw new Error('SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY are not set in Vercel.');
    return { clientId, consumerKey };
}

// --- Request signing (SnapTrade's rule) ---
// Every request carries clientId + timestamp (seconds) in the address, and a `Signature` header:
// base64 HMAC-SHA256, keyed with the consumer key, of this JSON with keys sorted and no spaces:
//   { "content": <the JSON body, or null>, "path": "/accounts/all", "query": "<the query exactly as sent>" }
function sortedJSON(value) {
    if (Array.isArray(value)) return '[' + value.map(sortedJSON).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + sortedJSON(value[k])).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
}

function sign(consumerKey, content, path, query) {
    return createHmac('sha256', consumerKey).update(sortedJSON({ content: content, path: path, query: query })).digest('base64');
}

// Every SnapTrade request goes through here. Errors are readable and never include the keys.
async function stRequest(method, path, user, body) {
    requireOwner(user);
    const { clientId, consumerKey } = keys();
    const params = new URLSearchParams({ clientId: clientId, timestamp: String(Math.floor(Date.now() / 1000)) });
    if (process.env.SNAPTRADE_USER_ID && process.env.SNAPTRADE_USER_SECRET) {
        params.set('userId', process.env.SNAPTRADE_USER_ID.trim());
        params.set('userSecret', process.env.SNAPTRADE_USER_SECRET.trim());
    }
    const query = params.toString();
    const content = body && Object.keys(body).length ? body : null;

    let reply;
    try {
        reply = await fetch(ST_BASE + path + '?' + query, {
            method: method,
            headers: {
                Signature: sign(consumerKey, content, path, query),
                Accept: 'application/json',
                ...(content ? { 'Content-Type': 'application/json' } : {})
            },
            ...(content ? { body: JSON.stringify(content) } : {}),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (e) {
        throw new Error('SnapTrade didn\'t answer (' + (e.name === 'TimeoutError' ? 'timed out' : 'network error') + ').');
    }
    const text = await reply.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON: use the raw text below */ }
    if (!reply.ok) {
        const detail = (data && (data.detail || data.message || data.error)) || text.slice(0, 200) || 'no detail';
        let message;
        if (reply.status === 401) message = 'SnapTrade rejected Isar\'s keys (401): ' + detail + '. Check SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in Vercel.';
        else if (reply.status === 429) message = 'SnapTrade is limiting requests (429). Isar will try again later.';
        else message = 'SnapTrade said ' + reply.status + ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 200));
        const error = new Error(message);
        error.status = reply.status;
        throw error;
    }
    return data;
}

// A short memory of recent answers: the app syncs every 5 minutes, SnapTrade's data changes
// about once a day. The owner check runs BEFORE the memory is read.
const recent = new Map();
function cachedGet(path, user) {
    requireOwner(user);
    const hit = recent.get(path);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    const promise = stRequest('GET', path, user);
    recent.set(path, { at: Date.now(), promise });
    promise.catch(() => recent.delete(path));      // never remember a failure
    return promise;
}

function asList(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.results)) return value.results;
    return [];
}

function safeLogo(url) {
    return typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(url) && url.length < 500 ? url : null;
}

function numberOrNaN(value) {
    return value === null || value === undefined || value === '' ? NaN : Number(value);
}

function upper(value) {
    return typeof value === 'string' && value ? value.trim().toUpperCase() : null;
}

async function allAccounts(user) {
    return asList(await cachedGet('/accounts/all', user)).filter(a => a && a.id);
}

async function connections(user) {
    return asList(await cachedGet('/authorizations', user)).filter(c => c && c.id);
}

// --- The list in "Connect a bank" (Australia): one entry, no SnapTrade request needed ---
export async function listBanks(country, { user } = {}) {
    if (country !== 'AU' || !isOwner(user)) return [];
    let note = 'Investments, through SnapTrade · you log in on SnapTrade\'s screen';
    try { keys(); } catch (e) { note = 'SnapTrade keys aren\'t set in Vercel yet'; }
    return [{ name: 'CommSec', country: 'AU', logo: null, maxConsentDays: null, bankId: 'snaptrade', note: note }];
}

// --- Connecting: a one-off link (lasts 5 minutes) to SnapTrade's Connection Portal ---
export async function startConnect({ state, redirectUrl, user }) {
    const back = redirectUrl + '?provider=snaptrade&state=' + encodeURIComponent(state);
    const data = await stRequest('POST', '/snapTrade/login', user, {
        connectionType: 'read',          // read-only: Isar can never trade
        immediateRedirect: true,         // straight back to Isar when done
        customRedirect: back
    });
    if (!data || !safeLogo(data.redirectURI)) throw new Error('SnapTrade didn\'t send a link to its connection screen.');
    return data.redirectURI;
}

// The broker's name and logo, from its connection.
function brokerOf(connection) {
    const broker = (connection && connection.brokerage) || {};
    return {
        name: String(broker.display_name || broker.name || (connection && connection.name) || 'Broker'),
        logo: safeLogo(broker.aws_s3_square_logo_url) || safeLogo(broker.aws_s3_logo_url)
    };
}

function accountLabel(account, brokerName) {
    if (account.display_name) return String(account.display_name);
    return brokerName + (account.masked_account_number ? ' ' + String(account.masked_account_number).replace(/\*+/g, '…') : '');
}

// What's saved in bank_connections for each account (no values: those are read live).
function savedShape(account, connectionId, broker) {
    return {
        uid: account.id,
        accountId: account.id,
        bankId: connectionId,
        name: accountLabel(account, broker.name),
        currency: upper(account.net_value && account.net_value.currency),
        product: 'investment',
        logo: broker.logo
    };
}

// `code` is the connection SnapTrade sent back, or "latest" if it didn't name one.
export async function completeConnect({ code, user }) {
    const list = await stRequest('GET', '/authorizations', user).then(asList);
    const connection = list.find(c => c.id === code) ||
        list.filter(c => !c.disabled).sort((a, b) => String(b.created_date).localeCompare(String(a.created_date)))[0];
    if (!connection) throw new Error('SnapTrade has no broker connected yet. Try connecting again.');
    recent.clear();                                  // the account list just changed
    const broker = brokerOf(connection);
    const accounts = (await allAccounts(user)).filter(a => a.connection_id === connection.id);
    return {
        bankName: broker.name,
        country: 'AU',
        sessionId: connection.id,                    // not a secret: useless without the keys
        validUntil: null,                            // SnapTrade keeps the connection until you remove it
        accounts: accounts.map(a => savedShape(a, connection.id, broker)),
        // SnapTrade often needs a few minutes for a new broker's first read. The connection is
        // saved anyway, and its accounts appear on a later sync (refreshAccounts).
        accountsMayFollow: true
    };
}

// The connection's accounts as SnapTrade lists them now; bank-sync.js keeps the saved list current.
export async function refreshAccounts({ connection, user }) {
    const found = (await connections(user)).find(c => c.id === connection.session_id);
    const broker = found ? brokerOf(found) : { name: connection.bank_name || 'Broker', logo: null };
    return (await allAccounts(user)).filter(a => a.connection_id === connection.session_id)
        .map(a => savedShape(a, connection.session_id, broker));
}

// --- Value and holdings ---
// SnapTrade's instrument kinds -> Isar's holding kinds (holdings.js).
const KIND = {
    etf: 'etf', stock: 'stock', adr: 'stock', preferred_stock: 'stock', cfd: 'stock',
    mutualfund: 'fund', cef: 'fund', bond: 'fund', crypto: 'crypto', tokenized_asset: 'crypto', cash: 'cash'
};

// Each position as an Isar holding, plus cash. Anything that can't be read is reported in
// `skipped` (shown by the app), never dropped silently.
async function holdingsOf(accountId, user) {
    const id = encodeURIComponent(accountId);
    const [positions, balances] = await Promise.all([
        cachedGet('/accounts/' + id + '/positions/all', user).then(asList),
        cachedGet('/accounts/' + id + '/balances', user).then(asList)
    ]);
    const holdings = [];
    const skipped = [];
    positions.forEach(p => {
        const instrument = (p && p.instrument) || {};
        const symbol = String(instrument.symbol || instrument.raw_symbol || '').trim();
        const quantity = numberOrNaN(p.units);
        const price = numberOrNaN(p.price);
        const currency = upper(p.currency) || upper(instrument.currency);
        if (!symbol || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0 || !currency) {
            skipped.push((symbol || 'A position') + ' (' + [p.units, p.price, currency].map(String).join(' / ') + ')');
            return;
        }
        if (quantity === 0) return;
        // Cost isn't passed on yet: SnapTrade's `cost_basis` may be per share or in total, and a
        // wrong "gain" is worse than none. Check it in "What SnapTrade sends" before adding it.
        holdings.push({
            symbol: symbol.slice(0, 20),
            name: String(instrument.description || symbol).slice(0, 80),
            kind: KIND[String(instrument.kind || '').toLowerCase()] || 'stock',
            quantity: quantity,
            price: price,
            currency: currency
        });
    });
    balances.forEach(b => {
        const code = upper(b && b.currency && (b.currency.code || b.currency));
        const cash = numberOrNaN(b && b.cash);
        if (!code || !Number.isFinite(cash) || cash === 0) return;
        if (cash < 0) { skipped.push('Cash ' + code + ' ' + cash + ' (owed to the broker)'); return; }
        holdings.push({ symbol: code, name: 'Cash', kind: 'cash', quantity: Math.round(cash * 100) / 100, price: 1, currency: code });
    });
    return { holdings, skipped };
}

export async function getBalance({ account, user }) {
    const found = (await allAccounts(user)).find(a => a.id === (account.accountId || account.uid));
    if (!found) throw new Error('SnapTrade no longer lists this account. Connect CommSec again in Isar.');
    const value = numberOrNaN(found.net_value && found.net_value.amount);
    const currency = upper(found.net_value && found.net_value.currency) || account.currency;
    let held = { holdings: null, skipped: [] };
    try {
        held = await holdingsOf(found.id, user);
    } catch (e) {
        if (!Number.isFinite(value)) throw e;        // no holdings and no value: nothing to show
        held.skipped = ['Holdings couldn\'t be read (' + e.message + ')'];
    }
    if (!Number.isFinite(value) && !(held.holdings && held.holdings.length)) {
        throw new Error('SnapTrade hasn\'t read this account yet. It can take a few minutes after connecting.');
    }
    return {
        balance: Number.isFinite(value) ? value : null,
        currency: currency,
        balanceType: 'current',
        holdings: held.holdings,
        holdingsSkipped: held.skipped
    };
}

// Investment accounts don't use transactions in Isar yet.
export async function getTransactions() {
    return [];
}

// Exactly what SnapTrade sends for this connection, for the "What SnapTrade sends" screen.
// Account numbers are already masked by SnapTrade.
export async function rawAccounts({ connection, user }) {
    const accounts = (await allAccounts(user)).filter(a => a.connection_id === connection.session_id);
    const out = [];
    for (const a of accounts) {
        const copy = JSON.parse(JSON.stringify(a));
        const id = encodeURIComponent(a.id);
        try { copy.isarRawPositions = await cachedGet('/accounts/' + id + '/positions/all', user); } catch (e) { copy.isarRawPositions = { error: e.message }; }
        try { copy.isarRawBalances = await cachedGet('/accounts/' + id + '/balances', user); } catch (e) { copy.isarRawBalances = { error: e.message }; }
        out.push(copy);
    }
    return out;
}

export function logoFor(connection) {
    const first = asList(connection.accounts)[0];
    return (first && safeLogo(first.logo)) || null;
}
