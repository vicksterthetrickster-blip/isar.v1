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
const MAX_PAGES = 5;                       // BankSync allows 10 requests a minute on Standard
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
        let message;
        if (reply.status === 401) message = 'BankSync rejected Isar\'s key (401). Check BANKSYNC_API_KEY in Vercel.';
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

export async function completeConnect({ code, user }) {
    const bank = await findBank(code, user);
    if (!bank) throw new Error('That bank isn\'t in your BankSync account any more.');
    const accounts = asList(dataOf(await bsRequest('/banks/' + encodeURIComponent(bank.id) + '/accounts', user)));
    const logo = safeLogo(bank.icon);
    return {
        bankName: bank.name || 'Bank',
        country: 'AU',
        sessionId: bank.id,              // not a secret: useless without the key, which only the owner's requests can use
        validUntil: null,                // consent is managed in BankSync's app
        accounts: accounts.map(account => ({
            uid: account.id,
            bankId: bank.id,
            name: account.accountName || null,
            currency: account.currency || null,
            product: account.accountType || null,
            logo: logo
        }))
    };
}

// --- Balances: one request per bank covers all its accounts ---
export async function getBalance({ account, user }) {
    const accounts = asList(await cachedGet('/banks/' + encodeURIComponent(account.bankId) + '/accounts', user));
    const found = accounts.find(a => a.id === account.uid);
    if (!found) throw new Error('account_not_found_in_banksync');
    const balance = Number(found.balance ?? found.availableBalance);
    if (!Number.isFinite(balance)) throw new Error('no_balance_reported');
    return { balance: balance, currency: found.currency || account.currency, balanceType: 'current' };
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

function toIsarTransaction(tx, index) {
    const amount = Number(tx.amount);                  // BankSync signs it: positive = money in, like Isar
    const date = isoDate(tx.date) || isoDate(tx.authorizedDate);
    if (!Number.isFinite(amount) || !date) return null;
    const description = String(tx.merchantName || tx.description || tx.originalDescription || (amount >= 0 ? 'Money in' : 'Money out'));
    return {
        id: 'bs-' + (tx.id || [date, amount, index].join('-')),
        date: date,
        description: description.trim().slice(0, 140),
        category: tx.pending ? 'Pending' : (textOf(tx.category) || textOf(tx.providerCategory)).slice(0, 60),
        amount: amount
    };
}

function nextCursorOf(body) {
    if (!body) return null;
    const data = body.data && !Array.isArray(body.data) ? body.data : {};
    return body.nextCursor || (body.pagination && body.pagination.nextCursor) || (body.meta && body.meta.nextCursor) || data.nextCursor || null;
}

export async function getTransactions({ account, from, user }) {
    const to = new Date().toISOString().slice(0, 10);
    const path = '/banks/' + encodeURIComponent(account.bankId) + '/accounts/' + encodeURIComponent(account.uid) + '/transactions';
    const transactions = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
        const body = await bsRequest(path + '?from=' + from + '&to=' + to + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), user);
        const data = dataOf(body);
        const list = Array.isArray(data) ? data : asList(data && (data.transactions || data.items));
        list.forEach(tx => {
            const converted = toIsarTransaction(tx, transactions.length);
            if (converted) transactions.push(converted);
        });
        cursor = nextCursorOf(body);
        if (!cursor) break;
    }
    return transactions;
}

export function logoFor(connection) {
    const first = asList(connection.accounts)[0];
    return (first && safeLogo(first.logo)) || null;
}
