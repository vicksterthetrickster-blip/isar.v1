// api/_enablebanking.js — shared helper for talking to Enable Banking.
// Files starting with "_" aren't web addresses; they're just code the other api/ files use.
//
// Every request to Enable Banking must be signed with Isar's private RSA key, proving the
// request really comes from our registered application. The signed note is a "JWT": a short
// token saying who we are and when it expires. Node can sign it with built-in tools, so
// there are no libraries to install.
//
// The private key lives ONLY in Vercel's environment variables, never in this code.

import { createSign } from 'crypto';

const EB_BASE = 'https://api.enablebanking.com';
const JWT_LIFETIME_SECONDS = 3600;        // 1 hour (their maximum is 24)

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

// Calls the Enable Banking API. Throws a readable error if it refuses, so the
// endpoints can report something useful instead of a blank failure.
export async function ebRequest(path, options = {}) {
    const reply = await fetch(EB_BASE + path, {
        method: options.method || 'GET',
        headers: {
            Authorization: 'Bearer ' + makeJWT(),
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
