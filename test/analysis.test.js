import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysis, isStorable } from '../lib/analysis.js';

// v11: 🔮 વિશ્લેષણ — pure calculation (no database).
// Onion: cheap in May (₹16), costly in November (₹45); 2024 and 2025 complete, 2026 bought 20% more.
function onionRows() {
  const monthly = [];
  const rate = { 1: 18, 2: 18, 3: 12, 4: 13, 5: 16, 6: 20, 7: 25, 8: 30, 9: 36, 10: 42, 11: 45, 12: 30 };
  for (const y of [2024, 2025, 2026]) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 11) break;
      const qty = (y === 2026 ? 1200 : 1000) * (m === 11 && y === 2026 ? 0.4 : 1);
      monthly.push({ vegetable_id: 1, name: 'ડુંગળી', unit: 'kg', y, m, qty: String(qty), amount: String(qty * rate[m]), min_rate: rate[m], max_rate: rate[m] + 1, bills: 10, days: 10 });
    }
  }
  return { monthly, returns: [{ vegetable_id: 1, y: 2025, m: 11, qty: '100' }],
    window: [{ vegetable_id: 1, years_back: 1, d: '2025-11-20', qty: '300', amount: '13500' }, { vegetable_id: 1, years_back: 2, d: '2024-11-21', qty: '100', amount: '4500' }],
    traders: [{ vegetable_id: 1, trader: 'B', qty: '100', amount: '3000', bills: 2 }, { vegetable_id: 1, trader: 'A', qty: '100', amount: '2800', bills: 3 }],
    weekday: [{ vegetable_id: 1, dow: 1, qty: '500', days: 5 }] };
}

test('analysis: months, cheapest/costliest, growth, forecast, buy ahead', () => {
  const a = buildAnalysis(onionRows(), '2026-11-13');
  const v = a.vegetables[0];
  assert.equal(a.has_last_year, true);
  assert.equal(v.cheapest.m, 3);
  assert.equal(v.costliest.m, 11);
  // November: running month 2026 is not counted; 2024 = 1000, 2025 = 1000 − 100 returned
  const nov = v.month_of_year[10];
  assert.equal(nov.years, 2);
  assert.equal(nov.avg_qty, 950);
  assert.equal(nov.rate, 45);
  assert.equal(v.growth.ratio, 1.2); // last 6 months 2026 vs 2025
  const fNov = a.forecast.find((f) => f.m === 11);
  assert.equal(fNov.plan_qty, 1140); // 950 × 1.2
  assert.equal(fNov.bought_so_far, 480);
  assert.equal(fNov.season, 'costly');
  assert.equal(a.forecast.filter((f) => f.vegetable_id === 1).length, 4); // this month + next 3
  // storable: looks up to 6 months before November (May–Oct) → May (₹16) is cheapest
  const b = a.buy_ahead[0];
  assert.equal(b.storable, true);
  assert.equal(b.peak_month, 11);
  assert.equal(b.buy_month, 5);
  assert.equal(b.saving_per_unit, 29);
  assert.equal(b.est_saving, 29 * 950);
  // same dates in earlier years
  assert.equal(a.next30[0].years, 2);
  assert.equal(a.next30[0].avg_qty, 200);
  assert.equal(a.next30[0].rate, 45);
  // cheapest trader first
  assert.equal(v.traders[0].trader, 'A');
  assert.equal(a.calendar.length, 12);
});

test('analysis: perishable items get no saving amount; no data → empty', () => {
  const rows = onionRows();
  for (const r of rows.monthly) r.name = 'ભોલર';
  const a = buildAnalysis(rows, '2026-11-13');
  assert.equal(a.buy_ahead[0].storable, false);
  assert.equal(a.buy_ahead[0].est_saving, null);
  assert.ok(isStorable('ડુંગળી') && isStorable('લસણ') && !isStorable('ટીંડોરા'));
  const e = buildAnalysis({ monthly: [], returns: [], window: [], traders: [], weekday: [] }, '2026-11-13');
  assert.equal(e.vegetables.length, 0);
  assert.equal(e.forecast_ready, false);
  assert.equal(e.has_last_year, false);
});

test('analysis: only this year → no forecast yet, honest message', () => {
  const rows = { monthly: [{ vegetable_id: 1, name: 'ડુંગળી', unit: 'kg', y: 2026, m: 10, qty: '50', amount: '1000', min_rate: 20, max_rate: 20, bills: 1, days: 1 }],
    returns: [], window: [], traders: [], weekday: [] };
  const a = buildAnalysis(rows, '2026-11-13');
  assert.equal(a.has_last_year, false);
  assert.equal(a.forecast.length, 0);
  assert.equal(a.buy_ahead.length, 0);
  assert.equal(a.vegetables[0].cheapest, null); // needs 3 months
});
