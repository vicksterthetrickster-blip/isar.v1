// api/_enablebanking.js — shared helper for talking to Enable Banking.
// Files starting with "_" aren't web addresses; they're just code the other api/ files use.
//
// Every request to Enable Banking must be signed with Isar's private RSA key, proving the
// request really comes from our registered application. The signed note is a "JWT": a short
// token saying who we are and when it expires. Node can sign it with built-in tools, so
// there are no libraries to install.
//
// The private key lives ONLY in Vercel's environment variables, never in this code.

import { createSign, createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

const EB_BASE = 'https://api.enablebanking.com';
const JWT_LIFETIME_SECONDS = 3600;        // 1 hour (their maximum is 24)
const STATE_LIFETIME_MS = 30 * 60 * 1000; // time allowed at the bank, plus signing in on return

// JWTs use "base64url": like base64, but safe inside a web address.
function base64url(input) {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Vercel normally keeps the key's line breaks, but some ways of pasting turn them into the
// characters \ and n. This repairs that, so either form works.
function readPrivateKey() {
    const key = process.env.ENABLE_BANKING_PRIVATE_KEY;
    if (!key) throw new Error('ENABLE_BANKING_PRIVATE_KEY is not set in Vercel.');
    return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

// Builds and signs the token proving this is Isar's application.
function makeJWT() {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    if (!appId) throw new Error('ENABLE_BANKING_APP_ID is not set in Vercel.');

    const now = Math.floor(Date.now() / 1000);
    const header = { typ: 'JWT', alg: 'RS256', kid: appId };
    const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + JWT_LIFETIME_SECONDS };
    const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));

    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    const signature = signer.sign(readPrivateKey(), 'base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return unsigned + '.' + signature;
}

// --- The `state` ticket that travels to the bank and back ---
// Signed by this server and naming the Isar person who started the connection. Because the
// server can check it alone, the returned code can be saved even when the bank sends you back
// to a different browser than the one you left from (on iPhone: Safari, not the home-screen
// app). And it can only ever be saved to the person named in it.
// The signing key is derived from the private key, so there's no extra secret to manage.
function stateKey() {
    return createHash('sha256').update('isar-bank-state:' + readPrivateKey()).digest();
}

export function makeState(userId) {
    const body = base64url(JSON.stringify({ u: userId, n: randomBytes(12).toString('hex'), e: Date.now() + STATE_LIFETIME_MS }));
    return body + '.' + createHmac('sha256', stateKey()).update(body).digest('base64url');
}

export function checkState(state, userId) {
    const [body, signature] = String(state || '').split('.');
    if (!body || !signature) return false;
    const expected = createHmac('sha256', stateKey()).update(body).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    try {
        const data = JSON.parse(Buffer.from(body, 'base64url').toString());
        return data.u === userId && data.e > Date.now();
    } catch (e) {
        return false;
    }
}

// "The person is here right now." Without these, banks treat a read as a background job and
// allow only about 4 a day (PSD2), which Isar's balance checks used up before transactions
// were read. Pass the incoming request as `options.psu` when the person opened the app.
function psuHeaders(request) {
    if (!request) return {};
    const headers = {};
    const ip = String(request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || '').split(',')[0].trim();
    if (ip) headers['Psu-Ip-Address'] = ip;
    if (request.headers['user-agent']) headers['Psu-User-Agent'] = request.headers['user-agent'];
    if (request.headers['accept-language']) headers['Psu-Accept-Language'] = request.headers['accept-language'];
    return headers;
}

// Calls the Enable Banking API. Throws a readable error if it refuses, so the
// endpoints can report something useful instead of a blank failure.
export async function ebRequest(path, options = {}) {
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

// Checks the person is signed in to Isar, and returns their user id.
// Every endpoint that touches someone's money data must call this first.
const SUPABASE_URL = 'https://ditlmphsrvglmetljxdl.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JfRW2WmTKhkH9Mg0TCLWtg_QznUHiUr';

// --- Talking to the database AS THE PERSON, never as an admin ---
// This is the heart of keeping bank connections private. The server has NO master key for
// the database. When it saves or reads a row it forwards the person's own sign-in pass, so
// Supabase applies the same "you can only touch your own rows" rules it applies in the app.
// A bug here can't leak someone else's connections: the database itself refuses.
function userHeaders(request) {
    return {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: request.headers.authorization,
        'Content-Type': 'application/json'
    };
}

export async function saveRowAsUser(request, table, row) {
    const reply = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: { ...userHeaders(request), Prefer: 'return=representation' },
        body: JSON.stringify(row)
    });
    const text = await reply.text();
    if (!reply.ok) throw new Error('Database refused the save: ' + text.slice(0, 200));
    const rows = JSON.parse(text);
    return rows[0];
}

export async function readRowsAsUser(request, table, columns) {
    const reply = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?select=' + encodeURIComponent(columns), {
        headers: userHeaders(request)
    });
    const text = await reply.text();
    if (!reply.ok) throw new Error('Database refused the read: ' + text.slice(0, 200));
    return JSON.parse(text);
}

export async function requireUser(request) {
    const auth = request.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    try {
        const check = await fetch(SUPABASE_URL + '/auth/v1/user', {
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: auth }
        });
        if (!check.ok) return null;
        const user = await check.json();
        return user && user.id ? user : null;
    } catch (e) {
        return null;
    }
}
