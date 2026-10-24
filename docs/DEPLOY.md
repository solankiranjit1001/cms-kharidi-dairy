# Deployment, database and migration guide

## Architecture
* **Frontend**: static Gujarati PWA in `public/` (no build step, ES modules, strict CSP — no inline scripts).
* **API**: one Vercel Node.js function `api/index.js` → `lib/router.js` (all `/api/*` routes; keeps Hobby under the function limit).
* **Database**: Neon PostgreSQL, accessed only on the server through `DATABASE_URL` (`pg` driver, pooled URL).
* **Migrations**: `migrations/NNN_name.sql`, applied in order by `scripts/migrate.js` during the Vercel build
  (`npm run build`), each in its own transaction, tracked in `schema_migrations`, protected by an advisory lock.
  If the build has no `DATABASE_URL` it skips and `/api/health` reports `not_configured`.

## Environments
| Vercel env | Neon branch | Notes |
|---|---|---|
| Production (`main`) | `production` | real records — migrate only after approval |
| Preview (other branches, e.g. `dev`) | auto-created preview branch (Neon integration) | safe test data |
| Development (CLI) | `vercel-dev` | local `vercel dev` |

## Environment variables (server-only, never in the browser)
| Name | Set by | Purpose |
|---|---|---|
| `DATABASE_URL` | Neon integration | pooled connection used by the API |
| `DATABASE_URL_UNPOOLED` | Neon integration | direct connection used by migrations |
| `SETUP_CODE` | you (Vercel → Settings → Environment Variables, mark **Sensitive**) | one-time code (≥ 8 chars) needed to create the first owner. Only works while there are no users. |

## Health check
`GET /api/health` → `{ ok, db: "connected", latency_ms, schema, expected_schema, env }`. `ok: true` means the
deployed app itself reached the database and the schema is current. No secrets are returned.

## First run
1. Add `SETUP_CODE` to Vercel (Preview first, Production later).
2. Open the app → "પ્રથમ સેટઅપ" → enter the code, owner name, mobile, PIN.
3. Settings → પરિવારના સભ્યો → add family members (role: એન્ટ્રી / ફક્ત જોવું).

## Migrating old browser data (no data is ever overwritten)
1. **Backup first:** on every phone, open the *old* address(es) and download the JSON backup.
   After `main` is updated, the GitHub Pages address shows a page that downloads the old data
   (`index.html` + `legacy-export.js` at repo root) and its `sw.js` removes the stale offline copy.
2. In the new app (owner): Settings → જૂની એપનો ડેટા લાવો → choose the file (or "આ ફોનમાં મળ્યો" if the old data
   is on the same address) → **તપાસો** (dry run: counts, invalid rows, possible duplicates) → **ઇમ્પોર્ટ કરો**.
3. Each imported row gets a unique `import_key` (`v4:purchase:<old id>`), so importing the same file again adds nothing.
   Dates are preserved. Unknown trader → "અન્ય (નામ વગર)". Existing trader opening balances are never changed.
4. After import, check the dashboard warnings (e.g. negative stock from old data) and compare totals with the paper diary.
   Fix with a reasoned stock adjustment.

## Backups / recovery
* Owner: Settings → સંપૂર્ણ બેકઅપ (JSON) or CSV per table.
* Neon free plan keeps 6 hours of history (point-in-time restore via Neon console → Backup & Restore).
  Take the JSON backup regularly (e.g. weekly).

## Local development & tests
```
# Postgres 16+ locally; then
DATABASE_URL=postgres://... npm run migrate
SETUP_CODE=dev-code-123 DATABASE_URL=postgres://... npm run dev   # http://localhost:3000
npm test                                                           # API/unit tests (needs TEST_PG_ADMIN or local socket)
BASE=http://localhost:3000 SETUP_CODE=dev-code-123 node test/e2e/ui-smoke.mjs   # browser test (fresh DB)
```
