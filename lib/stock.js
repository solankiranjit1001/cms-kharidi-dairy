import { bad } from './errors.js';

/** Lock vegetable rows (sorted to avoid deadlocks) so concurrent stock changes for the same vegetable serialize. */
export async function lockVegetables(c, ids) {
  const list = [...new Set(ids.filter(Boolean).map(Number))].sort((a, b) => a - b);
  if (list.length) await c.query('SELECT id FROM vegetables WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [list]);
  return list;
}

/**
 * Stock may never go negative on any date from `fromDate` onward.
 * Called after a change is applied inside the transaction; throws (→ rollback) if violated.
 */
export async function assertStock(c, vegIds, fromDate) {
  for (const vid of [...new Set(vegIds.filter(Boolean))]) {
    const { rows } = await c.query(
      `WITH m AS (SELECT d, sum(qty) AS q FROM stock_moves WHERE vegetable_id = $1 GROUP BY d),
            r AS (SELECT d, sum(q) OVER (ORDER BY d) AS bal FROM m)
       SELECT r.d, r.bal, v.name, v.unit FROM r, vegetables v
        WHERE v.id = $1 AND r.d >= $2 AND r.bal < 0 ORDER BY r.d LIMIT 1`, [vid, fromDate]);
    if (rows.length) {
      const { d, bal, name, unit } = rows[0];
      throw bad(`પૂરતો સ્ટોક નથી: ${name} — ${d} ના રોજ સ્ટોક ${Number(bal).toFixed(3).replace(/\.?0+$/, '')} ${unit} થઈ જાય છે.`,
        { stock: { vegetable: name, date: d, balance: bal } });
    }
  }
}

/** Quantity available for one vegetable at end of `date`, and the minimum over later dates (what can still be taken out on `date`). */
export async function available(c, vegId, date) {
  const { rows: [r] } = await c.query(
    `WITH m AS (SELECT d, sum(qty) AS q FROM stock_moves WHERE vegetable_id = $1 GROUP BY d),
          r AS (SELECT d, sum(q) OVER (ORDER BY d) AS bal FROM m)
     SELECT coalesce((SELECT sum(q) FROM m WHERE d <= $2), 0) AS on_date,
            (SELECT min(bal) FROM r WHERE d >= $2) AS min_after`, [vegId, date]);
  const onDate = r.on_date;
  const can = r.min_after === null ? onDate : (Number(r.min_after) < Number(onDate) ? r.min_after : onDate);
  return { onDate, canTake: can };
}

/** Per-vegetable stock table for one day. */
export async function dayStock(c, date) {
  const { rows } = await c.query(
    `WITH mv AS (SELECT * FROM stock_moves WHERE d <= $1),
     agg AS (
       SELECT vegetable_id,
         coalesce(sum(qty) FILTER (WHERE d < $1), 0)                    AS opening,
         coalesce(sum(qty) FILTER (WHERE d = $1 AND kind='purchase'), 0) AS purchased,
         coalesce(-sum(qty) FILTER (WHERE d = $1 AND kind='sale'), 0)    AS sold,
         coalesce(-sum(qty) FILTER (WHERE d = $1 AND kind='waste'), 0)   AS wasted,
         coalesce(-sum(qty) FILTER (WHERE d = $1 AND kind='return'), 0)  AS returned,
         coalesce(sum(qty) FILTER (WHERE d = $1 AND kind='adjust'), 0)   AS adjusted,
         coalesce(sum(qty), 0)                                           AS closing,
         count(*) FILTER (WHERE d = $1)                                   AS today_moves
       FROM mv GROUP BY vegetable_id),
     cost AS (
       SELECT pl.vegetable_id, round(sum(pl.amount) / nullif(sum(pl.qty), 0), 2) AS avg_rate
         FROM purchase_lines pl JOIN purchases p ON p.id = pl.purchase_id
        WHERE p.voided_at IS NULL AND p.entry_date <= $1 GROUP BY pl.vegetable_id)
     SELECT v.id AS vegetable_id, v.name, v.unit, a.opening, a.purchased, a.sold, a.wasted, a.returned, a.adjusted, a.closing,
            sc.physical_qty, sc.id AS count_id, coalesce(cost.avg_rate, 0) AS avg_rate
       FROM agg a JOIN vegetables v ON v.id = a.vegetable_id
       LEFT JOIN stock_counts sc ON sc.vegetable_id = v.id AND sc.count_date = $1
       LEFT JOIN cost ON cost.vegetable_id = v.id
      WHERE a.closing <> 0 OR a.today_moves > 0 OR a.opening <> 0 OR sc.id IS NOT NULL
      ORDER BY v.name`, [date]);
  return rows.map((r) => ({
    ...r,
    diff: r.physical_qty === null ? null : (Number(r.physical_qty) - Number(r.closing)).toFixed(3),
  }));
}
