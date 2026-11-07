import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseText, paymentText, balanceText, rs, dmy, balanceLine } from '../lib/msgtext.js';

// v9: Gujarati message text for traders (no database needed).
const bill = {
  id: 12, trader_name: 'મહેશભાઈ', entry_date: '2026-11-07', total_amount: '5000.00', paid_amount: '4000.00', due_amount: '1000.00',
  lines: [
    { vegetable: 'મરચાં', qty: '50.000', unit: 'kg', rate: '60.00', amount: '3000.00', commission_excl: false, mudda: null },
    { vegetable: 'ડુંગળી', qty: '200.500', unit: 'kg', rate: '10.25', amount: '2000.00', commission_excl: true, commission_pct: 7, mudda: 12 },
  ],
};

test('money, dates and balance lines', () => {
  assert.equal(rs('125000.00'), '₹1,25,000');
  assert.equal(rs('62.50'), '₹62.50');
  assert.equal(dmy('2026-11-07'), '07-11-2026');
  assert.equal(balanceLine('1000.00'), 'તમારી કુલ બાકી: ₹1,000');
  assert.equal(balanceLine('-500'), 'તમારી પાસે અમારો એડવાન્સ: ₹500');
  assert.match(balanceLine('0.00'), /હિસાબ પૂરો/);
});

test('purchase bill message: lines, commission, mudda, part payment, total baaki', () => {
  const t = purchaseText(bill, '21585.00', 'CMS');
  assert.ok(t.startsWith('નમસ્તે મહેશભાઈ,\nતારીખ - 07-11-2026\n'));
  assert.ok(t.includes('મરચાં 50 kg × ₹60 = ₹3,000'));
  assert.ok(t.includes('ડુંગળી 200.5 kg (12 મુદ્દા) × ₹10.25 + 7% = ₹2,000'));
  assert.ok(t.includes('કુલ બિલ: ₹5,000\nચૂકવ્યા: ₹4,000\nઆ બિલની બાકી: ₹1,000\nતમારી કુલ બાકી: ₹21,585'));
  assert.ok(t.endsWith('\nCMS'));
  const paid = purchaseText({ ...bill, paid_amount: '5000.00', due_amount: '0.00' }, '0', '');
  assert.ok(paid.includes('ચૂકવ્યા: ₹5,000 (આખું બિલ ચૂકવેલ)'));
  assert.ok(paid.endsWith('તમારો હિસાબ પૂરો — કોઈ બાકી નથી.'));
  const unpaid = purchaseText({ ...bill, paid_amount: '0.00', due_amount: '5000.00' }, '5000', 'CMS');
  assert.ok(!unpaid.includes('ચૂકવ્યા'));
});

test('payment and account messages', () => {
  const p = paymentText({ trader_name: 'JK', amount: '1000.00', method: 'UPI', entry_date: '2026-11-07', purchase_id: 12, reference: null }, '3026.00', 'CMS');
  assert.equal(p, 'નમસ્તે JK,\nતારીખ - 07-11-2026\nચૂકવ્યા: ₹1,000 (UPI)\nતમારી કુલ બાકી: ₹3,026\nCMS');
  assert.equal(balanceText({ name: 'JK' }, '4026.00', '2026-11-07', ''), 'નમસ્તે JK,\nતારીખ - 07-11-2026\nતમારી કુલ બાકી: ₹4,026');
});
