# CMS ખરીદી ડાયરી — V4 Full Implementation

ગુજરાતી-first, mobile-first PWA for a vegetable wholesale business in Bhavnagar.

## Included
- Daily dashboard and date-wise bookkeeping
- Purchase entries with trader, quantity, rate, calculated amount and notes
- Sales entries limited to available stock for the selected date; edit mode retains the existing vegetable
- Waste entries reduce stock and are not counted as sales revenue
- Expenses separated from trader settlements
- Stock ledger: opening quantity + purchases − sales − waste ± authorized adjustments
- Physical stock reconciliation records calculated quantity, actual quantity and variance without silently overwriting the ledger
- Trader directory, phone, opening payable, purchase ledger, cash/UPI/bank payment entries, running statement and outstanding balance
- Market observations for Gujarat markets; comparisons are based only on saved observations
- Historical/yearly and month-of-year market summaries with sample counts
- Next-day planning
- Entry edit/delete confirmations; derived totals recalculate from saved entries
- JSON backup/restore, CSV export, print view and A4 landscape daily diary layout
- Optional voice recognition when supported by the browser; recognized text must be reviewed before saving
- Installable offline-first PWA and Gujarati mobile-friendly UI

## Publish to GitHub Pages
Upload every file in this folder to the repository root and commit. Wait for GitHub Pages to finish deployment, then hard-refresh the site. On iPhone, open in Safari and choose Share → Add to Home Screen.

## Important operational notes
1. **Local data only:** entries are stored in this browser/device. This release does not synchronize family phones. GitHub Pages is static hosting, not a database. Cloud synchronization needs a configured backend, authentication, and access rules; do not put a service-role secret in a public website.
2. **Stock quantity vs value:** stock quantity reconciliation is ledger-based. Rupee value is an indicative weighted-average purchase-cost estimate, not batch-level FIFO accounting. Verify financial carry-forward with the paper diary before using for formal accounts.
3. **Trader returns/credits:** opening balance, purchases, and payments are recorded. A dedicated purchase-return/credit-note transaction is not yet included; don't subtract informal credits without recording them separately outside this app.
4. **Print:** use A4 landscape and inspect print preview. This layout is designed as a practical print report; it has not been certified against the exact dimensions of the family's paper diary.
5. **Voice:** browser/device support varies; recognition may be processed by the browser vendor. Manual entry remains available.
6. **Migration:** existing V1/V2 data is not automatically migrated. Export a JSON backup before updating the website.

## Suggested acceptance test before live bookkeeping
- Enter one purchase, then one partial sale, then waste; verify available stock and daily totals.
- Attempt a sale greater than stock; it should be rejected.
- Edit and delete an entry and confirm stock and totals recalculate.
- Add a trader, enter two purchases and a partial payment; verify outstanding balance.
- Reconcile physical stock and check variance.
- Export JSON and CSV; restore the JSON backup in a test browser profile.
- Print one busy day and compare it with the paper diary.
