// api/_server.js — Isar's own server helpers, the same whichever bank provider is used.
// Files starting with "_" aren't web addresses; they're just code the other api/ files use.
//
//   requireUser()                       is this request from a signed-in Isar person?
//   saveRowAsUser() / readRowsAsUser()  the database, AS that person (no master key exists)
//   makeState() / checkState()          the signed ticket that travels to the bank and back

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

// The Supabase project. Both values are public by design (same ones as in js/auth.js).
const SUPABASE_URL = 'https://ditlmphsrvglmetljxdl.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JfRW2WmTKhkH9Mg0TCLWtg_QznUHiUr';
const STATE_LIFETIME_MS = 30 * 60 * 1000; // time allowed at the bank, plus signing in on return

// Checks the person is signed in to Isar, and returns their user.
// Every endpoint that touches someone's money data must call this first.
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
    return JSON.parse(text)[0];
}

export async function readRowsAsUser(request, table, columns) {
    const reply = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?select=' + encodeURIComponent(columns), {
        headers: userHeaders(request)
    });
    const text = await reply.text();
    if (!reply.ok) throw new Error('Database refused the read: ' + text.slice(0, 200));
    return JSON.parse(text);
}

// --- The `state` ticket that travels to the bank and back ---
// Signed by this server, naming the Isar person who started the connection and the provider
// it went through. Because the server can check it alone, the returned code can be saved even
// when the bank sends you back to a different browser than the one you left from (on iPhone:
// Safari, not the home-screen app). And it can only ever be saved to the person named in it.
// The signing key is derived from the Enable Banking private key, so there's no extra secret
// to manage (ISAR_STATE_SECRET replaces it if ever set).
function stateKey() {
    let secret = process.env.ISAR_STATE_SECRET || process.env.ENABLE_BANKING_PRIVATE_KEY;
    if (!secret) throw new Error('No secret is set in Vercel to sign bank tickets with.');
    if (!process.env.ISAR_STATE_SECRET && secret.includes('\\n')) secret = secret.replace(/\\n/g, '\n');
    return createHash('sha256').update('isar-bank-state:' + secret).digest();
}

function base64url(input) {
    return Buffer.from(input).toString('base64url');
}

export function makeState(userId, provider) {
    const body = base64url(JSON.stringify({ u: userId, p: provider, n: randomBytes(12).toString('hex'), e: Date.now() + STATE_LIFETIME_MS }));
    return body + '.' + createHmac('sha256', stateKey()).update(body).digest('base64url');
}

// The ticket's contents if it's genuine, unexpired and names this person; otherwise null.
export function checkState(state, userId) {
    const [body, signature] = String(state || '').split('.');
    if (!body || !signature) return null;
    const expected = createHmac('sha256', stateKey()).update(body).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const data = JSON.parse(Buffer.from(body, 'base64url').toString());
        return data.u === userId && data.e > Date.now() ? data : null;
    } catch (e) {
        return null;
    }
}
