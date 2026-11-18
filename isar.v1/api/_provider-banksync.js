// api/_provider-banksync.js — the BankSync adapter (Australia: CommBank, Revolut AU). OWNER ONLY.
//
// Same six functions as every adapter (see _provider-enablebanking.js), plus one rule that
// matters more than anything else in this file:
//
//   THE BANKSYNC KEY READS THE OWNER'S OWN BANKS. Nobody else may ever reach it.
//
// Enable Banking gives each person their own session, so person A's session can only read
// person A's bank. BankSync is different: one key (BANKSYNC_API_KEY, in Vercel only) reads every
// bank connected in the owner's BankSync workspace. If any signed-in Isar person could make this
// server use that key, they would see the owner's money. So every single BankSync request goes
// through bsRequest(), which first checks the caller is the owner (ISAR_OWNER_USER_ID, the
// owner's Supabase user id, also in Vercel). Checking the PERSON, not the saved connection row,
// is deliberate: anyone can write rows into their own bank_connections, including fake ones
// pointing at the owner's account ids, and the check still refuses them.
//
// If ISAR_OWNER_USER_ID isn't set, nobody gets through ("fail closed").
//
// Connecting works differently from Enable Banking: the owner logs in to CommBank / Revolut
// inside BankSync's own app (Australia's CDR consent screen). Pressing Connect in Isar just
// links an already-connected BankSync bank to the owner's Isar account; no bank login happens here.

import { timingSafeEqual } from 'crypto';

const BS_BASE = 'https://api.banksync.io/v1';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGES = 8;                       // BankSync allows 10 requests a minute on Standard; more is flagged `partial`
const CACHE_MS = 5 * 60 * 1000;            // BankSync refreshes daily; no need to ask more often

export const name = 'banksync';
export const ownerOnly = true;             // banks.js asks for a sign-in before listing these banks

// --- The owner check ---
export function isOwner(user) {
    const owner = String(process.env.ISAR_OWNER_USER_ID || '').trim();
    if (!owner || !user || !user.id) return false;
    const given = Buffer.from(String(user.id));
    const expected = Buffer.from(owner);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

function requireOwner(user) {
    if (isOwner(user)) return;
    const error = new Error('Australian bank connections aren\'t available on this Isar account.');
    error.status = 403;
    error.code = 'owner_only';
    throw error;
}

// --- Every BankSync request goes through here ---
// Returns BankSync's whole reply ({ success, data, ... }). Errors are readable and never
// include the key.
async function bsRequest(path, user) {
    requireOwner(user);
    const key = process.env.BANKSYNC_API_KEY;
    if (!key) throw new Error('BANKSYNC_API_KEY is not set in Vercel.');

    let reply;
    try {
        reply = await fetch(BS_BASE + path, {
            headers: { 'X-API-Key': key, Accept: 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (e) {
        throw new Error('BankSync didn\'t answer (' + (e.name === 'TimeoutError' ? 'timed out' : 'network error') + ').');
    }
    const text = await reply.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { /* not JSON: use the raw text below */ }

    if (!reply.ok || (body && body.success === false)) {
        const problem = body && (body.error || body.message);
        const detail = (typeof problem === 'string' ? problem : (problem && problem.message)) || text.slice(0, 200) || 'no detail';
        const code = body && body.code;
        let message;
        if (reply.status === 409 && code === 'reauth_required') message = 'consent_expired';   // reconnect it in the BankSync app
        else if (reply.status === 401) message = 'BankSync rejected Isar\'s key (401). Check BANKSYNC_API_KEY in Vercel.';
        else if (reply.status === 403) message = 'BankSync refused (403): ' + detail + '. The key may be missing the banks:read scope, or the plan may not include the API (Standard or above).';
        else if (reply.status === 429) message = 'BankSync is limiting requests (429). Isar will try again in ' + (reply.headers.get('retry-after') || '60') + ' seconds or later.';
        else message = 'BankSync said ' + reply.status + ': ' + detail;
        const error = new Error(message);
        error.status = reply.status;
        throw error;
    }
    return body;
}

function dataOf(body) {
    return body && Object.hasOwn(body, 'data') ? body.data : body;
}

// A short memory of recent answers, so the balance check every 5 minutes doesn't use up
// BankSync's 10-requests-a-minute limit. The owner check runs BEFORE the memory is read.
const recent = new Map();
async function cachedGet(path, user) {
    requireOwner(user);
    const hit = recent.get(path);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    const promise = bsRequest(path, user).then(dataOf);
    recent.set(path, { at: Date.now(), promise });
    promise.catch(() => recent.delete(path));      // never remember a failure
    return promise;
}

function asList(value) {
    return Array.isArray(value) ? value : [];
}

// Only plain web addresses are kept as logos (they're saved with the account).
function safeLogo(icon) {
    return typeof icon === 'string' && /^https:\/\/[^\s"'<>]+$/.test(icon) && icon.length < 500 ? icon : null;
}

function isConnected(bank) {
    return !(bank.connectionStatus && bank.connectionStatus.connected === false);
}

const BANK_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

// An account's real currency. Australia's open-banking standard says a missing currency means
// AUD, so Revolut's EUR and THB accounts arrive labelled "AUD" even though their amounts are in
// euros and baht. The name says the truth ("EUR Transaction Account"), so a currency code in
// the name wins over a reported AUD. A non-AUD reported currency is always trusted.
const ISO_CURRENCIES = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : []);

export function currencyOf(account) {
    const reported = account.currency ? String(account.currency).trim().toUpperCase() : null;
    if (reported && reported !== 'AUD') return reported;
    const words = String(account.accountName || '') + ' ' + String(account.accountType || '');
    const named = (words.match(/\b[A-Z]{3}\b/g) || []).find(code => ISO_CURRENCIES.has(code));
    return named || reported;
}

async function findBank(id, user) {
    if (!BANK_ID_PATTERN.test(String(id || ''))) return null;
    const banks = asList(await cachedGet('/banks', user));
    return banks.find(bank => bank.id === id) || null;
}

// --- The bank list: the banks connected in the owner's BankSync workspace ---
export async function listBanks(country, { user } = {}) {
    const banks = asList(await cachedGet('/banks', user));
    return banks.map(bank => ({
        name: bank.name,
        country: 'AU',
        logo: safeLogo(bank.icon),
        maxConsentDays: null,
        bankId: bank.id,
        note: isConnected(bank) ? 'Connected in BankSync' : 'Reconnect it in the BankSync app first'
    }));
}

// --- Connecting: no bank login here (that happened in BankSync's app). Isar sends you straight
// back to itself with the BankSync bank id as the "code", so the normal finish step
// (bank-complete, which checks the signed ticket) saves it to your Isar account. ---
export async function startConnect({ bank, state, redirectUrl, user }) {
    const found = (await findBank(bank.id, user)) ||
        asList(await cachedGet('/banks', user)).find(b => b.name === bank.name);
    if (!found) throw new Error('That bank isn\'t in your BankSync account. Connect it in the BankSync app first.');
    if (!isConnected(found)) throw new Error(found.name + ' needs reconnecting in the BankSync app first.');
    return redirectUrl + '?code=' + encodeURIComponent(found.id) + '&state=' + encodeURIComponent(state);
}

// --- One card, several currencies (CommBank Travel Money, Revolut) ---
// Australia's open-banking standard sends a multi-currency card as ONE account with extra
// "purses" (one balance per currency). BankSync's documented account has only one amount and
// one currency, so purses may be missing, or passed along under a name it doesn't document.
// So this looks anywhere in the account (up to 3 levels deep) for a list of
// { currency, amount } items, whatever it's called, and makes each one its own Isar account
// ("Travel Money Card · EUR"). The bank screen shows them together under the card.

// Both are "number or null" in BankSync's spec. Number(null) is 0, so null is caught first,
// or a missing balance would show as $0 instead of as a problem.
function numberOrNaN(value) {
    if (value && typeof value === 'object') value = value.amount ?? value.value;
    return value === null || value === undefined || value === '' ? NaN : Number(value);
}

const PURSE_AMOUNT_KEYS = ['amount', 'balance', 'currentBalance', 'availableBalance', 'value'];

function purseAmount(item) {
    for (const key of PURSE_AMOUNT_KEYS) {
        const n = numberOrNaN(item[key]);
        if (Number.isFinite(n)) return n;
    }
    return NaN;
}

function isPurse(item) {
    return item && typeof item === 'object' && !Array.isArray(item) &&
        ISO_CURRENCIES.has(String(item.currency || '').toUpperCase()) && Number.isFinite(purseAmount(item));
}

function findPurses(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 3) return [];
    for (const [key, inner] of Object.entries(value)) {
        if (key === 'links') continue;
        if (Array.isArray(inner) && inner.length && inner.every(isPurse)) {
            return inner.map(p => ({ currency: String(p.currency).toUpperCase(), balance: purseAmount(p) }));
        }
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            const found = findPurses(inner, depth + 1);
            if (found.length) return found;
        }
    }
    return [];
}

// One BankSync account -> one or more Isar accounts, each with ONE currency and its balance.
function expandAccount(account) {
    const name = account.accountName || null;
    const currency = currencyOf(account);
    const balance = numberOrNaN(account.balance ?? account.availableBalance);
    const purses = findPurses(account);
    if (!purses.length) return [{ uid: account.id, accountId: account.id, name: name, currency: currency, balance: balance, product: account.accountType || null }];

    const label = name || 'Account';
    const list = purses.map(p => ({
        uid: account.id + ':' + p.currency, accountId: account.id, parentName: label, purseCurrency: p.currency,
        name: label + ' · ' + p.currency, currency: p.currency, balance: p.balance, product: account.accountType || null
    }));
    // The main balance is a currency of its own, unless a purse already covers it.
    if (Number.isFinite(balance) && balance !== 0 && !purses.some(p => p.currency === currency || p.balance === balance)) {
        // Its label may be the "missing means AUD" default, so its transactions are "everything
        // not in another purse" rather than "only AUD".
        list.unshift({ uid: account.id, accountId: account.id, parentName: label, otherCurrencies: purses.map(p => p.currency),
            name: label + ' · ' + currency, currency: currency, balance: balance, product: account.accountType || null });
    }
    return list;
}

// What's saved in bank_connections for each Isar account (no balances: those are read live).
function savedShape(expanded, bankId, logo) {
    return {
        uid: expanded.uid,
        accountId: expanded.accountId,
        bankId: bankId,
        name: expanded.name,
        parentName: expanded.parentName || null,
        purseCurrency: expanded.purseCurrency || null,
        otherCurrencies: expanded.otherCurrencies || null,
        currency: expanded.currency,
        product: expanded.product,
        logo: logo
    };
}

async function liveAccounts(bankId, user) {
    return asList(await cachedGet('/banks/' + encodeURIComponent(bankId) + '/accounts', user)).filter(a => a && a.id);
}

export async function completeConnect({ code, user }) {
    const bank = await findBank(code, user);
    if (!bank) throw new Error('That bank isn\'t in your BankSync account any more.');
    const accounts = asList(dataOf(await bsRequest('/banks/' + encodeURIComponent(bank.id) + '/accounts', user)))
        .filter(account => account && account.id);
    const logo = safeLogo(bank.icon);
    return {
        bankName: bank.name || 'Bank',
        country: 'AU',
        sessionId: bank.id,              // not a secret: useless without the key, which only the owner's requests can use
        validUntil: null,                // consent is managed in BankSync's app
        accounts: accounts.flatMap(expandAccount).map(e => savedShape(e, bank.id, logo))
    };
}

// The bank's accounts as BankSync lists them right now, in the saved shape. bank-sync.js uses
// this to keep the saved list current (new accounts, a card that gained a currency).
export async function refreshAccounts({ connection, user }) {
    const bankId = connection.session_id;
    const logo = (asList(connection.accounts)[0] || {}).logo || null;
    return (await liveAccounts(bankId, user)).flatMap(expandAccount).map(e => savedShape(e, bankId, logo));
}

// Exactly what BankSync sends for this bank's accounts, for the "What BankSync sends" screen,
// so a reading problem can be seen instead of guessed. Account numbers are cut to the last 4.
export async function rawAccounts({ connection, user }) {
    return (await liveAccounts(connection.session_id, user)).map(a => {
        const copy = JSON.parse(JSON.stringify(a));
        if (typeof copy.accountNumber === 'string') copy.accountNumber = '…' + copy.accountNumber.slice(-4);
        delete copy.links;
        return copy;
    });
}

// --- Balances: one request per bank covers all its accounts ---
export async function getBalance({ account, user }) {
    const accountId = account.accountId || account.uid;
    const found = (await liveAccounts(account.bankId, user)).find(a => a.id === accountId);
    if (!found) throw new Error('BankSync no longer lists this account. Connect the bank again in Isar.');
    const mine = expandAccount(found).find(e => e.uid === account.uid);
    if (!mine) throw new Error('BankSync no longer lists this currency on the account.');
    if (!Number.isFinite(mine.balance)) throw new Error('BankSync hasn\'t received a balance for this account yet. Open the BankSync app and let it sync.');
    return { balance: mine.balance, currency: mine.currency || account.currency, balanceType: 'current' };
}

// --- Transactions ---
function isoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function textOf(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.filter(v => typeof v === 'string').join(', ');
    if (value && typeof value === 'object') return String(value.primary || value.name || value.detailed || '');
    return '';
}

// The amount, signed the way Isar needs it (positive = money in). BankSync's spec doesn't say
// how it signs `amount`, but it always sends `creditAmount` and `debitAmount`, which can't be
// misread: money in minus money out. `amount` is only the fallback. If the two disagree on the
// direction, the transaction is marked `signConflict`, and nothing is worked out from it.
function signedAmountOf(tx) {
    const credit = Number(tx.creditAmount), debit = Number(tx.debitAmount);
    const plain = Number(tx.amount);
    const fromParts = Number.isFinite(credit) && Number.isFinite(debit) && (credit !== 0 || debit !== 0) ? credit - debit : null;
    const amount = fromParts !== null ? fromParts : plain;
    const conflict = fromParts !== null && Number.isFinite(plain) && plain !== 0 && Math.sign(plain) !== Math.sign(fromParts);
    return { amount: amount, conflict: conflict };
}

function toIsarTransaction(tx, index) {
    const { amount, conflict } = signedAmountOf(tx);
    const date = isoDate(tx.date) || isoDate(tx.authorizedDate);
    if (!Number.isFinite(amount) || !date) return null;
    const description = String(tx.merchantName || tx.description || tx.originalDescription || (amount >= 0 ? 'Money in' : 'Money out'));
    const result = {
        id: 'bs-' + (tx.id || [date, amount, index].join('-')),
        date: date,
        description: description.trim().slice(0, 140),
        category: tx.pending ? 'Pending' : (textOf(tx.category) || textOf(tx.providerCategory)).slice(0, 60),
        amount: Math.round(amount * 100) / 100,
        // Which currency `amount` is in. On a multi-currency card (CommBank Travel Money) one
        // account's transactions come in several currencies, and this is how the app tells them
        // apart. BankSync always fills it in, writing "AUD" when the bank left it out, so on a
        // card "AUD" can't be fully trusted (js/bankconnect.js deals with that).
        currency: /^[A-Za-z]{3}$/.test(String(tx.currency || '')) ? String(tx.currency).toUpperCase() : undefined
    };
    // A pending payment, and the posted payment that replaces it, are two different transactions.
    // These let the app keep only one of them (js/bankconnect.js).
    if (tx.pending) result.pending = true;
    if (tx.pendingTransactionId) result.replacesPending = 'bs-' + tx.pendingTransactionId;
    if (conflict) result.signConflict = true;
    return result;
}

// BankSync's spec: `meta.cursor` carries on to the next page while `meta.hasMore` is true.
function nextCursorOf(body) {
    const meta = body && body.meta;
    if (!meta || meta.hasMore === false) return null;
    return typeof meta.cursor === 'string' && meta.cursor ? meta.cursor : null;
}

export async function getTransactions({ account, from, user }) {
    const to = new Date().toISOString().slice(0, 10);
    const path = '/banks/' + encodeURIComponent(account.bankId) + '/accounts/' + encodeURIComponent(account.accountId || account.uid) + '/transactions';
    // One currency of a multi-currency card: keep only that currency's transactions (or, for
    // the card's main balance, everything not in one of its other currencies).
    const only = account.purseCurrency || null;
    const others = Array.isArray(account.otherCurrencies) ? account.otherCurrencies : [];
    const transactions = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
        const body = await bsRequest(path + '?from=' + from + '&to=' + to + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), user);
        const data = dataOf(body);
        const list = Array.isArray(data) ? data : asList(data && (data.transactions || data.items));
        list.forEach(tx => {
            const txCurrency = tx.currency ? String(tx.currency).toUpperCase() : null;
            // A transaction with no currency belongs to the card's main balance only, so it's never
            // counted in two currencies at once.
            if (only && txCurrency !== only) return;
            if (txCurrency && others.includes(txCurrency)) return;
            const converted = toIsarTransaction(tx, transactions.length);
            if (converted) transactions.push(converted);
        });
        cursor = nextCursorOf(body);
        if (!cursor) break;
    }
    // Stopped at the page limit with more still to come: the list is incomplete, so the app
    // mustn't add anything up from it (bank-transactions.js passes this on as `partial`).
    if (cursor) transactions.partial = true;
    return transactions;
}

// A sample of the account's raw transactions, for the "What BankSync sends" screen: the last
// 90 days, one page, only the fields that decide the maths. Nothing is converted or filtered.
const RAW_TX_FIELDS = ['id', 'date', 'authorizedDate', 'description', 'merchantName', 'type', 'category', 'amount',
    'creditAmount', 'debitAmount', 'currency', 'pending', 'pendingTransactionId'];

export async function rawTransactions({ connection, accountId, user }) {
    const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const body = await bsRequest('/banks/' + encodeURIComponent(connection.session_id) + '/accounts/' + encodeURIComponent(accountId) +
        '/transactions?from=' + from + '&to=' + to, user);
    const data = dataOf(body);
    const list = Array.isArray(data) ? data : asList(data && (data.transactions || data.items));
    const known = new Set(RAW_TX_FIELDS);
    return {
        meta: body && body.meta ? { count: body.meta.count, hasMore: body.meta.hasMore, partial: body.meta.partial } : null,
        transactions: list.slice(0, 60).map(tx => {
            const row = {};
            RAW_TX_FIELDS.forEach(f => { if (tx[f] !== undefined) row[f] = tx[f]; });
            const others = Object.keys(tx).filter(k => !known.has(k));
            if (others.length) row.otherFields = others;      // names only, in case the answer hides there
            return row;
        })
    };
}

export function logoFor(connection) {
    const first = asList(connection.accounts)[0];
    return (first && safeLogo(first.logo)) || null;
}
