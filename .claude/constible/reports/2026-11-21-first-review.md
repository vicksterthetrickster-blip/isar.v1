# Constible Code: first Isar review (21 Nov 2026)

Four specialists (security, money, architecture, verification) reviewed the code read-only.
Constible scored it against `scorecard.md` and ranked the fixes. Nothing was changed.
The two most serious findings (S1, F1) were double-checked directly in the code.

## Scorecard

| # | Metric | Score | One-line reason |
|---|---|---|---|
| M1 | Clear boundaries | 2 | Server side is clean; the browser side is 27 files sharing ~533 global names, with core helpers inside tab files |
| M2 | Consistent patterns | 2 | Owner check, account shape, country list and Supabase settings are each copied in 2–4 places; timer hacks |
| M3 | Dead and stale code | 2 | No dead functions, but README and comments contradict the code ("mock auth", "live banks aren't ready") |
| M4 | Linting | 0 | None |
| M5 | Type safety | 0 | None |
| M6 | Automated tests | 0 | None |
| M7 | Evidence it works | 1 | Only manual aids (/api/status, raw-data screen) |
| M8 | Error handling | 3 | Bank sync reports problems well; device and cloud saves can fail silently |
| M9 | Security | 3 | No secrets in the repo, every money endpoint checks sign-in; one cross-user read path, no CSP |
| M10 | Money correctness | 2 | Good design, but transactions can go missing or be counted twice without warning |
| M11 | Accessibility | 1 | Main actions are clickable `<div>`s with no keyboard or screen-reader support |
| M12 | Performance | 3 | Globe pauses off-screen; but storage grows without limit and the globe redoes work every frame |
| M13 | Rules and correction loop | 1 | README rules are partly out of date; none are checked automatically |

**Overall:** the foundations people *can* see (structure, server design) are reasonable. Layers 2 and 3 of the
trust pyramid (automatic checks and proof it works) are empty, so every change to money code relies on
someone reading it.

## Ranked fix list (do one at a time)

### Tier 1: money, login and secrets
- **S1 (High): one user could read another's Enable Banking data.** `api/bank-transactions.js:28` and `api/bank-sync.js`
  trust account uids from the user's own `bank_connections` row, then call Enable Banking with Isar's app-wide key
  (`api/_provider-enablebanking.js:135,183`). The fix is to check the uid belongs to the row's approved session, or let only the server write those rows.
  Risk is limited today because uids are long and random.
- **F1 (High): transactions are lost if the app isn't opened for over 10 days.** `js/bankconnect.js:313` always fetches
  from "10 days ago", never from the last fetch. The fix is to start from the earlier of (last fetch − 10 days) or 10 days ago.
- **A1 (High): the owner-only gate is copied per provider file and enforced only by a comment.** `api/_provider-banksync.js:34-48`,
  `api/_provider-snaptrade.js:34-40`. The fix is to check `provider.ownerOnly` once, centrally.
- **S2 (Medium): the database privacy rules (Supabase RLS) aren't in the repo.** The fix is to commit the policy SQL.
- **S3 (Medium): no Content Security Policy, and the Supabase CDN script has no integrity check.** `index.html:676`.
- **S4 (Medium): provider ids are pasted unescaped into `onclick` code.** `js/accounts.js:30,90`, `holdings.js:290,349`, etc.
  The fix is to use `data-id`, as `transactions.js:297` already does.
- **S6 (Medium): the Privacy page doesn't name Enable Banking, BankSync or SnapTrade.** `js/support.js:34-54`.

### Tier 2: cheap automatic checks (the talk's core advice)
- **A2: a minimal check setup.** `package.json` (dev tools only), ESLint with `no-undef`/`no-redeclare`, a `jsconfig.json` with
  `checkJs`, and one `npm run check` command.
- **M-tests: `node --test` tests for the money maths.** `rebuildHistoryFromTransactions`, each provider's
  `toIsarTransaction`, the transaction merge, and `getRecordTotal`.
- **V3: one Playwright script** that opens the demo and screenshots the main screens (the "proof it works" from the talk).

### Tier 3: other money and reliability bugs
- F3: bank transaction lists are silently cut off at 5 or 20 pages.
- F4: past balances shift if a payment books later on the day you connected.
- F5: snapshots taken offline keep stale exchange rates for good.
- F6 / V2: cloud sync can silently throw away a device's un-uploaded changes, and every upload error shows as "Offline".
- F7: broker margin debt is left out of net worth.
- F8: an old pending payment can be counted twice.
- F9: Australian morning syncs miss today's transactions (UTC date).
- F10: a missing credit/debit marker turns refunds into spending.
- V1: device saves fail silently while storage fills up (transactions, rates and logos have no size limit).
- V4: a server outage tells signed-in users to "Sign in".
- V5: Enable Banking calls have no timeout, so one slow bank blocks every sync.
- V6: a new pop-up replaces whatever pop-up is open.
- S5: the public bank-list endpoint spends the paid Enable Banking allowance, with no cache or rate limit.

### Tier 4: design clean-ups
- A3: one `makeAccount()` and one `ACCOUNT_FIELDS` list (fields are currently listed by hand in `connect.js:173-188`).
- A4: the old fake "Setting up…" link flow with its 2.2s delay (`connect.js:349-392`).
- A5: move `escapeHTML` and the save helpers out of `connect.js`.
- A6: code that runs on load outside `main.js`; hidden script-order dependencies.
- A7: timer hacks in auth, setup and signin.
- A8: the country list and Supabase settings are duplicated between browser and server.
- V7–V10: accessibility (buttons, toast `aria-live`, dialog roles, contrast, reduced motion) and globe performance.
- S7–S10: error messages leak internals; `/api/status` reveals which keys are set; return address built from the Host header; separate state secret.

### Tier 5: written rules
- A9: refresh the README (auth is no longer a mock, the file table is missing files, the tab names are wrong).

Logo.dev token restriction is already on the security to-do list and isn't counted here.
