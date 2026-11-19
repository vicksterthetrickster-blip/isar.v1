// api/status.js — Isar's first server function.
//
// Everything in the api/ folder runs ON VERCEL'S SERVERS, not in the browser. That's the
// whole point: bank providers and price services need SECRET keys, and anything in the app
// can be read by anyone. Secrets live only here, as environment variables set in
// Vercel → Settings → Environment Variables. They are never written in code.
//
// This endpoint is the health check: open https://<your-app>/api/status in a browser and it
// reports that the server runs, where it runs, whether your sign-in reaches it, and which
// provider keys are configured (true/false only — never the keys themselves).
//
// The env var names the later bank/price functions will look for:
//   ENABLE_BANKING_APP_ID, ENABLE_BANKING_PRIVATE_KEY   (imagin, CaixaBank — EU/UK)
//   BANKSYNC_API_KEY                                     (CommBank, Revolut AU — owner only)
//   ISAR_OWNER_USER_ID                                   (the one Isar user id allowed to use BankSync and SnapTrade)
//   SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY          (CommSec, through SnapTrade Personal — owner only)
//   PRICE_API_KEY                                        (share and ETF prices)

// The Supabase project. Both values are public by design (same ones as in js/auth.js);
// checking a sign-in pass against Supabase is how the server knows who's calling.
const SUPABASE_URL = 'https://ditlmphsrvglmetljxdl.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JfRW2WmTKhkH9Mg0TCLWtg_QznUHiUr';

export default async function handler(request, response) {
    const report = {
        ok: true,
        server: 'isar',
        time: new Date().toISOString(),
        region: process.env.VERCEL_REGION || 'unknown',   // should say fra1 (Frankfurt), near the database
        signedIn: false,
        providers: {
            enableBanking: !!(process.env.ENABLE_BANKING_APP_ID && process.env.ENABLE_BANKING_PRIVATE_KEY),
            banksync: !!process.env.BANKSYNC_API_KEY,
            snaptrade: !!(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY),
            ownerSet: !!process.env.ISAR_OWNER_USER_ID,
            prices: !!process.env.PRICE_API_KEY
        }
    };

    // If the app sent the person's sign-in pass, ask Supabase who it belongs to.
    // An invalid or missing pass isn't an error here: the page just reports signedIn: false.
    const auth = request.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
        try {
            const check = await fetch(SUPABASE_URL + '/auth/v1/user', {
                headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: auth }
            });
            if (check.ok) {
                const user = await check.json();
                report.signedIn = true;
                report.email = user.email;
                report.userId = user.id;          // your own id, shown only to you
                report.isOwner = !!process.env.ISAR_OWNER_USER_ID && process.env.ISAR_OWNER_USER_ID.trim() === user.id;
            }
        } catch (e) { /* Supabase unreachable: report stays signedIn: false */ }
    }

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json(report);
}
