# Test plan and status

Automated: `npm test` (22 API/unit tests against real PostgreSQL) and `test/e2e/ui-smoke.mjs` (Chromium, phone + desktop).

| # | Area | How it is tested | Status |
|---|---|---|---|
| 1 | Purchase entry, multi-vegetable bill, qty × rate, partial payment, transport expense | business.test.js, ui-smoke | ✅ automated |
| 2 | Sale limited to stock, incl. backdated entries | business.test.js, ui-smoke (error shown, form stays open) | ✅ |
| 3 | Waste reduces stock, not revenue | business.test.js | ✅ |
| 4 | Physical count, difference warning, reasoned adjustment | business.test.js, ui-smoke | ✅ |
| 5 | Trader opening, purchases, returns, payments, adjustments, statement | business.test.js | ✅ |
| 6 | Daily formulas (COGS, gross, result, cash ≠ profit) | business.test.js, ui-smoke | ✅ |
| 7 | Edit (reason required, audited) / void (owner) and recalculation | business.test.js, ui-smoke | ✅ |
| 8 | Duplicate submission (same client_id) and concurrent sales from two devices | business.test.js | ✅ |
| 9 | Login, lockout, roles, no anonymous access, CSRF | auth.test.js | ✅ |
| 10 | Shared data across two sessions | business.test.js, ui-smoke (2 browsers) | ✅ |
| 11 | Old data import: dry run, commit, re-import, V1 & V4 formats | import.test.js, unit.test.js | ✅ |
| 12 | Gujarati UI, phone width (no horizontal scroll), A4 landscape diary = 1 page | ui-smoke | ✅ (compare once with the real paper diary) |
| 13 | Network failure: message shown, form kept, retry is idempotent | code path + idempotency test | ⚠️ manual check on a phone (airplane mode) |
| 14 | Deployment: preview build runs migrations, `/api/health` ok on preview DB | after push to `dev` | ⏳ pending deployment |
