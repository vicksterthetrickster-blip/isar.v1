# Constible Code: Isar scorecard

Each metric gets a score from 0 to 5, with evidence (file:line). Higher layers only count if lower
layers hold up, as in the trust pyramid in `knowledge.md`.

Scores: 0 = missing · 1 = poor · 2 = weak · 3 = acceptable · 4 = good · 5 = excellent and enforced automatically

| # | Layer | Metric | Question it answers | Owner |
|---|---|---|---|---|
| M1 | 1 Design | Clear boundaries | Does each file do one job? Are browser code (`js/`) and server code (`api/`) cleanly separate? Do files reach into each other's globals? | Architecture |
| M2 | 1 Design | Consistent patterns | Is the same thing done the same way everywhere? Are there workarounds or hacks an agent would copy? | Architecture |
| M3 | 1 Design | Dead and stale code | Are there unused functions, leftover features or comments that no longer match the code? | Architecture |
| M4 | 2 Checks | Linting | Is there a linter or formatter, and does anything run it? | Architecture |
| M5 | 2 Checks | Type safety | Are data shapes checked (e.g. JSDoc + `tsc --checkJs`)? | Architecture |
| M6 | 2 Checks | Automated tests | Are there tests, especially on the money maths and bank data parsing? | Money |
| M7 | 3 Verify | Evidence it works | Is there a repeatable way to run the app and prove key flows work (scripts, screenshots)? | Verification |
| M8 | 3 Verify | Error handling | Do failures (network, bank API, bad data) show a clear message, without crashing or failing silently? | Verification |
| M9 | Critical | Security | Secrets, API auth, input checks, unsafe `innerHTML`, data stored in the browser, CORS | Security |
| M10 | Critical | Money correctness | Currency conversion, rounding, floating point, totals, duplicate transactions | Money |
| M11 | Product | Accessibility | Labels, keyboard use, contrast, screen readers | Verification |
| M12 | Product | Performance | Load size, wasted work, memory, heavy loops | Verification |
| M13 | 4 Rules | Rules and correction loop | Are the rules written down, and are the important ones turned into checks? | Architecture |

## Output format for each specialist
For each owned metric: score, a one-line reason, then findings. Each finding has:
severity (critical/high/medium/low), file:line, what's wrong, a concrete failure scenario, and the
suggested fix in plain language. Findings need evidence: no guesses, no style nitpicks.

## Ranking rule (Constible)
Critical paths first (money, auth, secrets). Then anything that adds a *deterministic check* (cheap and
permanent). Then design clean-ups. Prose rules last. Fixes are made **one at a time**, each a small diff
the user can read.
