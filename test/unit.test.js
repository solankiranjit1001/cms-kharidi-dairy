import test from 'node:test';
import assert from 'node:assert/strict';
import { paise, milli, lineAmount, rupees, qtyStr, sumStr } from '../lib/money.js';
import { normalize, detectSource } from '../lib/importer.js';
import { pin, mobile, txDate, todayIST, addDays } from '../lib/validate.js';

test('money: qty × rate is exact and rounds half-up to paise', () => {
  assert.equal(rupees(lineAmount(milli('12.5'), paise('18.40'))), '230.00');
  assert.equal(rupees(lineAmount(milli('0.105'), paise('10.50'))), '1.10'); // 1.1025 → 1.10
  assert.equal(rupees(lineAmount(milli('0.333'), paise('15'))), '5.00');    // 4.995 → 5.00 (half-up)
  assert.equal(rupees(lineAmount(milli(0.1), paise(0.2))), '0.02');
  assert.equal(sumStr(['0.10', '0.20']), '0.30');
});

test('money: rejects bad input', () => {
  assert.throws(() => paise('1.234'), /દશાંશ/);
  assert.throws(() => paise('-5'), /ઋણ/);
  assert.throws(() => milli('abc'));
  assert.throws(() => milli('1e5'));
  assert.equal(qtyStr(milli('૧૨.૫')), '12.500'); // Gujarati digits
});

test('validate: pin, mobile, dates', () => {
  assert.throws(() => pin('1111'));
  assert.throws(() => pin('123'));
  assert.equal(pin('2580'), '2580');
  assert.equal(mobile('+91 98765 43210'), '9876543210');
  assert.throws(() => mobile('12345'));
  assert.throws(() => txDate(addDays(todayIST(), 1)), /ભવિષ્ય/);
  assert.throws(() => txDate('2026-02-30'));
});

test('import: detects and normalizes V4 and V1 formats', () => {
  const v4 = { purchases: [{ id: 'a1', date: '2026-10-01', veg: 'ટામેટાં', qty: 10, rate: 20, trader: 'રમેશ' }], sales: [], waste: [], payments: [],
    surveys: [], plans: [], recons: [], adjustments: [], traders: [{ id: 't1', name: 'રમેશ', opening: 500 }], expenses: [] };
  assert.equal(detectSource(v4), 'v4');
  const n = normalize(v4, 'v4');
  assert.equal(n.items.length, 2);
  assert.equal(n.items[1].key, 'v4:purchase:a1');
  const v1 = [{ id: 'x', type: 'ખરીદી', date: '2026-10-01', veg: 'બટાકા', qty: 5, rate: 12, party: 'મહેશ', extra: 30 },
    { id: 'y', type: 'મજા', date: '2026-10-01' }, { id: 'z', type: 'વેચાણ', date: 'bad', veg: 'બટાકા', qty: 1, rate: 1 }];
  assert.equal(detectSource(v1), 'v1');
  const m = normalize(v1, 'v1');
  assert.deepEqual(m.items.map((i) => i.type), ['purchase', 'expense']);
  assert.equal(m.errors.length, 2);
});
