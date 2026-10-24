// End-to-end smoke test in a real browser (Chromium via Playwright) against the local dev server.
// Usage: BASE=http://localhost:3000 SETUP_CODE=... SHOTS=/path node test/e2e/ui-smoke.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '.';
const errors = [];
const browser = await chromium.launch();
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'gu-IN' };

async function newPage(ctxOpts = mobile) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  // Expected: 400 from the deliberate oversell attempt; font CDN may be unreachable in CI sandboxes.
  page.on('console', (m) => { if (m.type() === 'error' && !/400 \(Bad Request\)|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const modal = (p) => p.locator('#modal');
const save = async (p) => { await p.click('#modalSave'); };
const pick = async (p, sel, text) => {
  const v = await p.$eval(sel, (el, t) => [...el.options].find((o) => o.textContent.includes(t))?.value, text);
  await p.selectOption(sel, v);
};
const waitClosed = (p) => p.waitForFunction(() => !document.querySelector('#modal').open);

const p = await newPage();
await p.goto(BASE + '/');
await p.waitForSelector('#loginForm');
await shot(p, '01-setup');
await p.fill('#f_setupCode', process.env.SETUP_CODE);
await p.fill('#f_name', 'પપ્પા');
await p.fill('#f_mobile', '9876543210');
await p.fill('#f_pin', '2580');
await p.click('#loginForm button[type=submit]');
await p.waitForSelector('#nav button.active');
await shot(p, '02-home-empty');

// Purchase with two lines, one new vegetable, partial payment and transport
await p.click('[data-action=new][data-type=purchases]');
await p.selectOption('#f_trader_id', '__new');
await p.fill('#f_new_trader', 'રમેશભાઈ');
await p.fill('[name=veg_0]', 'ટામેટાં');
await p.fill('[name=qty_0]', '100');
await p.fill('[name=rate_0]', '12.5');
await p.click('[data-add-line]');
await p.fill('[name=veg_1]', 'મરચાં');
await p.fill('[name=qty_1]', '20');
await p.fill('[name=rate_1]', '40');
assert.equal(await p.textContent('[data-total]'), '₹2,050.00');
await p.fill('#f_paid_amount', '1000');
await p.fill('#f_transport_amount', '150');
await shot(p, '03-purchase-form');
await save(p); await waitClosed(p);
await p.click('#nav [data-page=purchase]');
await p.waitForSelector('.record');
assert.match(await p.textContent('.record'), /આંશિક/);
await shot(p, '04-purchase-list');

// Sale, then an oversell attempt (must show error and keep the dialog open)
await p.click('#nav [data-page=sales]');
await p.click('[data-action=new][data-type=sales]');
await p.waitForSelector('#f_vegetable_id');
await pick(p, '#f_vegetable_id', 'ટામેટાં');
await p.fill('#f_qty', '80'); await p.fill('#f_rate', '20');
await save(p); await waitClosed(p);
await p.click('[data-action=new][data-type=sales]');
await pick(p, '#f_vegetable_id', 'ટામેટાં');
await p.fill('#f_qty', '50'); await p.fill('#f_rate', '20');
await save(p);
await p.waitForSelector('.formerror:not([hidden])');
assert.match(await p.textContent('.formerror'), /પૂરતો સ્ટોક નથી/);
await shot(p, '05-oversell-error');
await p.click('#modalCancel');
// Waste
await p.click('[data-action=new][data-type=waste]');
await p.waitForSelector('#f_vegetable_id');
await pick(p, '#f_vegetable_id', 'ટામેટાં');
await p.fill('#f_qty', '5');
await save(p); await waitClosed(p);
await shot(p, '06-sales');

// Stock count + closing value
await p.click('#nav [data-page=stock]');
await p.click('[data-action=count]');
await p.waitForSelector('#modal[open] input[data-num]');
const inputs = await p.$$('#modal input[data-num]');
await inputs[0].fill('14');
await save(p); await waitClosed(p);
await p.click('#closingCard [data-action=closing]');
await p.fill('#f_closing_stock_value', '1200');
await save(p); await waitClosed(p);
await shot(p, '07-stock');

// Home shows the computed result
await p.click('#nav [data-page=home]');
await p.waitForSelector('.diary');
const diary = await p.textContent('.diary');
// opening 0 + purchases 2050 − closing 1200 = 850 COGS; sales 1600 → gross 750; expenses 150 → 600
assert.match(diary, /₹850\.00/); assert.match(diary, /₹600\.00/);
await shot(p, '08-home');

// Add a family member, log in from a second device and see the same data
await p.click('#nav [data-page=settings]');
await p.click('[data-action=user-new]');
await p.fill('#f_name', 'ભાઈ'); await p.fill('#f_mobile', '9000000001'); await p.selectOption('#f_role', 'entry'); await p.fill('#f_pin', '4826');
await save(p); await waitClosed(p);
await shot(p, '09-settings');
const p2 = await newPage({ viewport: { width: 1280, height: 900 }, locale: 'gu-IN' });
await p2.goto(BASE + '/');
await p2.fill('#f_mobile', '9000000001'); await p2.fill('#f_pin', '4826');
await p2.click('#loginForm button[type=submit]');
await p2.waitForSelector('.diary');
assert.match(await p2.textContent('.diary'), /₹600\.00/);
assert.equal(await p2.locator('[data-action=void]').count(), 0); // entry role cannot void
await p2.click('#nav [data-page=traders]');
await p2.waitForSelector('text=રમેશભાઈ');
await shot(p2, '10-desktop-traders');

// Edit with reason from device 2, void from device 1
await p2.click('#nav [data-page=sales]');
await p2.click('[data-action=edit][data-type=sales]');
await p2.fill('#f_qty', '70');
await save(p2);
await p2.waitForSelector('.formerror:not([hidden]), #f_reason:invalid');
await p2.fill('#f_reason', 'જથ્થો ખોટો');
await save(p2); await waitClosed(p2);

// Reports: daily diary to PDF (A4 landscape) and check page count
await p2.click('#nav [data-page=reports]');
await p2.waitForSelector('.diarysheet');
await shot(p2, '11-diary-screen');
await p2.emulateMedia({ media: 'print' });
const pdf = await p2.pdf({ path: `${SHOTS}/diary.pdf`, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log('diary pdf pages:', pages);
if (pages !== 1) errors.push(`daily diary prints on ${pages} pages, expected 1`);
await p2.emulateMedia({ media: 'screen' });

// History + audit
await p.click('#nav [data-page=history]');
await p.waitForSelector('#historyOut table');
await p.click('#historyOut [data-action=audit]');
await p.waitForSelector('#modal[open] table');
await shot(p, '12-audit');
await p.click('#modalCancel');

// No horizontal page scroll on phone width
for (const pg of ['home', 'purchase', 'sales', 'stock', 'traders', 'expenses', 'reports', 'market', 'history', 'plan', 'settings']) {
  await p.click(`#nav [data-page=${pg}]`);
  await p.waitForTimeout(300);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) errors.push(`horizontal overflow on ${pg}: ${overflow}px`);
}
await shot(p, '13-settings-bottom');
await browser.close();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('UI smoke test passed');
