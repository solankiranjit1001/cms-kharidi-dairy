-- v7 (owner's request, 26 Oct 2026):
-- 1) One-time fresh start: delete all test entries, traders and vegetables. Users / logins are kept.
TRUNCATE purchase_lines, purchases, sales, waste, purchase_returns, stock_adjustments, stock_counts,
  day_closings, day_sales, payments, trader_adjustments, expenses, market_prices, plans,
  audit_log, import_batches, traders, vegetables RESTART IDENTITY CASCADE;

-- 2) Fixed vegetable list (Gujarati names). New items added from the purchase form are saved permanently.
INSERT INTO vegetables(name, name_key, unit) VALUES
  ('ડુંગળી', 'ડુંગળી', 'kg'), ('લસણ', 'લસણ', 'kg'), ('શેડિયા', 'શેડિયા', 'kg'), ('ભોલર', 'ભોલર', 'kg'),
  ('G4', 'g4', 'kg'), ('સૂરણ', 'સૂરણ', 'kg'), ('વાલોળ', 'વાલોળ', 'kg'), ('ટીંડોરા', 'ટીંડોરા', 'kg');

-- 3) Commission per purchase line: 0 = included in rate ("ભેગું"), 6 or 7 = added on top ("અલગ").
ALTER TABLE purchase_lines ADD COLUMN commission_pct SMALLINT NOT NULL DEFAULT 0 CHECK (commission_pct IN (0, 6, 7));
UPDATE purchase_lines SET commission_pct = 6 WHERE commission_excl;

-- 4) Bill status. A payment made against a bill ("ચુકવો" on the bill) counts for that bill.
--    A general payment to the trader (and returns / advances) is used for that trader's oldest unpaid bills first.
CREATE VIEW purchase_paid AS
WITH linked AS (
  SELECT p.id, p.trader_id, p.entry_date, p.total_amount,
         coalesce((SELECT sum(amount) FROM payments WHERE purchase_id = p.id AND voided_at IS NULL), 0) AS linked
    FROM purchases p WHERE p.voided_at IS NULL
), pool AS (
  SELECT t.id AS trader_id,
         coalesce((SELECT sum(amount) FROM payments WHERE trader_id = t.id AND purchase_id IS NULL AND voided_at IS NULL), 0)
       + coalesce((SELECT sum(amount) FROM purchase_returns WHERE trader_id = t.id AND voided_at IS NULL), 0)
       - coalesce((SELECT sum(amount) FROM trader_adjustments WHERE trader_id = t.id AND voided_at IS NULL), 0)
       - t.opening_balance AS u
    FROM traders t
), ordered AS (
  SELECT l.*, greatest(l.total_amount - l.linked, 0) AS rem,
         coalesce(sum(greatest(l.total_amount - l.linked, 0)) OVER (PARTITION BY l.trader_id ORDER BY l.entry_date, l.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
    FROM linked l
)
SELECT o.id AS purchase_id, o.linked,
       least(o.rem, greatest(coalesce(pl.u, 0) - o.before, 0)) AS allocated,
       o.linked + least(o.rem, greatest(coalesce(pl.u, 0) - o.before, 0)) AS paid
  FROM ordered o LEFT JOIN pool pl ON pl.trader_id = o.trader_id;
