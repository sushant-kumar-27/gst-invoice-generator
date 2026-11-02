'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createApp } = require('../server');
const C = require('../public/calc.js');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } };

function boot(dbFile) {
  const app = createApp(dbFile);
  return new Promise((resolve) => {
    const srv = http.createServer(app.handler).listen(0, '127.0.0.1', () => {
      const base = 'http://127.0.0.1:' + srv.address().port;
      const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
      resolve({ call, base, stop: async () => { srv.close(); await app.close(); } });
    });
  });
}
const items = () => [
  { description: 'Canon-AS-120R II BK (MRP 450)', hsn: '84701000', qty: '5', unit: 'PCS', rate: '258.95', gstRate: '18' },
  { description: 'Canon-WS-1212R (MRP 660)', hsn: '84701000', qty: '20', unit: 'PCS', rate: '258.95', gstRate: '18' },
  { description: 'Canon-AS-2222R', hsn: '84701000', qty: '5', unit: 'PCS', rate: '471.87', gstRate: '18' }];
const mk = (settings, over) => C.normalize(Object.assign({
  number: '', date: '2026-10-12', copyLabel: 'ORIGINAL FOR RECIPIENT',
  seller: { name: settings.companyName, address: settings.address, phone: settings.phone, gstin: settings.gstin, state: settings.state, stateCode: settings.stateCode, email: settings.email },
  bank: { bankName: settings.bankName, accountNo: settings.accountNo, branch: settings.branch, ifsc: settings.ifsc },
  buyer: { name: 'S K ENTERPRISES', address: 'Dhanbad', gstin: '20AFWFS4755H1ZK', state: 'Jharkhand', stateCode: '20' },
  placeOfSupply: { state: 'Jharkhand', stateCode: '20' }, meta: {}, items: items(), roundOff: { mode: 'auto', value: '' },
  declaration: settings.declaration, jurisdiction: settings.jurisdiction }, over || {}));

(async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gst-')), 'test.db');
  console.log('Calculation');
  await t('sample invoice matches the reference figures exactly', () => {
    const c = C.compute(mk(require('../db').DEFAULT_SETTINGS));
    assert.deepStrictEqual([c.lines.map((l) => l.amount), c.taxable, c.cgst, c.sgst, c.totalTax, c.roundOff, c.grand],
      [[129475, 517900, 235935], 883310, 79498, 79498, 158996, -6, 1042300]);
    assert.strictEqual(c.qtyText, '30 PCS');
    assert.strictEqual(C.amountInWords(c.grand), 'Indian Rupees Ten Thousand Four Hundred Twenty Three Only');
    assert.strictEqual(C.amountInWords(c.totalTax), 'Indian Rupees One Thousand Five Hundred Eighty Nine and Ninety Six paise Only');
  });
  await t('inter-state uses IGST only (same total tax)', () => {
    const c = C.compute(mk(require('../db').DEFAULT_SETTINGS, { placeOfSupply: { state: 'Bihar', stateCode: '10' } }));
    assert.deepStrictEqual([c.intra, c.cgst, c.sgst, c.igst, c.grand], [false, 0, 0, 158996, 1042300]);
  });
  await t('mixed GST rates are grouped per HSN+rate', () => {
    const it = [{ description: 'a', hsn: '1111', qty: '1', unit: 'PCS', rate: '100', gstRate: '5' }, { description: 'b', hsn: '1111', qty: '1', unit: 'PCS', rate: '100', gstRate: '18' }, { description: 'c', hsn: '2222', qty: '3', unit: 'KGS', rate: '10.5', gstRate: '12' }];
    const c = C.compute(mk(require('../db').DEFAULT_SETTINGS, { items: it }));
    assert.strictEqual(c.summary.length, 3);
    // 100@5% -> 2.50+2.50 ; 100@18% -> 9+9 ; 31.50@12% -> 1.89+1.89  => 26.78
    assert.strictEqual(c.totalTax, 500 + 1800 + 378);
  });
  await t('half-paise rounding is half-up and decimal safe (0.1+0.2 style)', () => {
    const it = [{ description: 'x', hsn: '', qty: '3', unit: 'PCS', rate: '0.1', gstRate: '0' }, { description: 'y', hsn: '', qty: '1', unit: 'PCS', rate: '0.2', gstRate: '0' }];
    assert.strictEqual(C.compute(mk(require('../db').DEFAULT_SETTINGS, { items: it })).taxable, 50);
  });
  await t('Indian grouping and words for crores', () => {
    assert.strictEqual(C.fmtMoney(123456789), '12,34,567.89');
    assert.strictEqual(C.amountInWords(1234567890000), 'Indian Rupees One Thousand Two Hundred Thirty Four Crore Fifty Six Lakh Seventy Eight Thousand Nine Hundred Only');
    assert.strictEqual(C.amountInWords(5), 'Indian Rupees Zero and Five paise Only');
  });
  await t('manual round-off is honoured', () => {
    const c = C.compute(mk(require('../db').DEFAULT_SETTINGS, { roundOff: { mode: 'manual', value: '0.04' } }));
    assert.strictEqual(c.grand, 1042310);
  });

  console.log('API');
  let srv = await boot(dbFile);
  const S = (await srv.call('GET', '/api/settings')).body;
  await t('seller and bank prefilled from the spec', () => {
    assert.strictEqual(S.gstin, '20AAZPK7528G1ZF'); assert.strictEqual(S.accountNo, '047811100000247'); assert.strictEqual(S.ifsc, 'UBIN0804789'); assert.strictEqual(S.stateCode, '20');
  });
  await t('configure prefix/start number, then numbers are sequential', async () => {
    const r = await srv.call('PUT', '/api/settings', Object.assign({}, S, { prefix: 'INV/', nextNumber: 48, padding: 3 }));
    assert.strictEqual(r.status, 200);
    const nums = [];
    for (let i = 0; i < 3; i++) { const inv = mk(S); const r2 = await srv.call('POST', '/api/invoices', { invoice: inv, expectedGrand: 1042300 }); assert.strictEqual(r2.status, 201); nums.push(r2.body.number); }
    assert.deepStrictEqual(nums, ['INV/048', 'INV/049', 'INV/050']);
    assert.strictEqual((await srv.call('GET', '/api/next-number')).body.number, 'INV/051');
  });
  await t('duplicate invoice numbers are rejected (409), case-insensitively', async () => {
    const r = await srv.call('POST', '/api/invoices', { invoice: mk(S, { number: 'inv/049' }) });
    assert.strictEqual(r.status, 409);
  });
  await t('parallel saves never produce duplicate numbers', async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => srv.call('POST', '/api/invoices', { invoice: mk(S) })));
    const nums = rs.map((r) => r.body.number); assert.strictEqual(new Set(nums).size, 6, nums.join()); assert.ok(rs.every((r) => r.status === 201));
  });
  await t('manual number higher than counter moves the counter forward', async () => {
    await srv.call('POST', '/api/invoices', { invoice: mk(S, { number: 'INV/100' }) });
    assert.strictEqual((await srv.call('GET', '/api/next-number')).body.number, 'INV/101');
  });
  await t('server rejects a wrong client total and bad data', async () => {
    assert.strictEqual((await srv.call('POST', '/api/invoices', { invoice: mk(S), expectedGrand: 1042301 })).status, 400);
    const bad = mk(S, { items: [{ description: 'x', hsn: '12', qty: '-1', unit: 'PCS', rate: 'abc', gstRate: '500' }], buyer: { name: '', gstin: 'BAD', stateCode: '20' } });
    const r = await srv.call('POST', '/api/invoices', { invoice: bad }); assert.strictEqual(r.status, 400); assert.ok(r.body.errors.length >= 4, r.body.errors.join('|'));
  });
  await t('snapshot: changing settings later does not alter a saved invoice', async () => {
    const list = (await srv.call('GET', '/api/invoices')).body; const first = list[list.length - 1];
    await srv.call('PUT', '/api/settings', Object.assign({}, S, { companyName: 'Renamed Co', accountNo: '999', prefix: 'INV/', nextNumber: 200, padding: 3 }));
    const inv = (await srv.call('GET', '/api/invoices/' + first.id)).body;
    assert.strictEqual(inv.data.seller.name, 'Casanova Inc. (2022-2023)'); assert.strictEqual(inv.data.bank.accountNo, '047811100000247');
    await srv.call('PUT', '/api/settings', Object.assign({}, S, { prefix: 'INV/', nextNumber: 200, padding: 3 }));
  });
  await t('edit keeps uniqueness and updates totals; search works', async () => {
    const list = (await srv.call('GET', '/api/invoices')).body; const a = list[0]; const b = list[1];
    const full = (await srv.call('GET', '/api/invoices/' + a.id)).body.data;
    assert.strictEqual((await srv.call('PUT', '/api/invoices/' + a.id, { invoice: Object.assign({}, full, { number: b.number }) })).status, 409);
    const edited = Object.assign({}, full, { buyer: Object.assign({}, full.buyer, { name: 'ZETA TRADERS' }), items: [full.items[0]] });
    const r = await srv.call('PUT', '/api/invoices/' + a.id, { invoice: edited }); assert.strictEqual(r.status, 200);
    assert.strictEqual((await srv.call('GET', '/api/invoices?q=zeta')).body.length, 1);
    assert.strictEqual((await srv.call('GET', '/api/invoices?q=INV%2F049')).body.length, 1);
    assert.strictEqual((await srv.call('GET', '/api/invoices?q=%25')).body.length, 0); // % is literal, not a wildcard
  });
  await t('catalogue CRUD', async () => {
    const c = await srv.call('POST', '/api/catalogue', { name: 'Widget', hsn: '84701000', unit: 'pcs', rate: '12.5', gstRate: '18' }); assert.strictEqual(c.status, 201);
    assert.strictEqual((await srv.call('PUT', '/api/catalogue/' + c.body.id, { name: 'Widget 2', hsn: '', unit: 'PCS', rate: '13', gstRate: '5' })).body.name, 'Widget 2');
    assert.strictEqual((await srv.call('POST', '/api/catalogue', { name: '', rate: 'x' })).status, 400);
    assert.strictEqual((await srv.call('DELETE', '/api/catalogue/' + c.body.id)).status, 200);
  });
  await t('delete invoice', async () => {
    const list = (await srv.call('GET', '/api/invoices')).body; const n = list.length;
    assert.strictEqual((await srv.call('DELETE', '/api/invoices/' + list[0].id)).status, 200);
    assert.strictEqual((await srv.call('GET', '/api/invoices')).body.length, n - 1);
  });
  const countBefore = (await srv.call('GET', '/api/invoices')).body.length;
  await srv.stop();
  srv = await boot(dbFile);
  await t('data persists after restarting the server', async () => {
    assert.strictEqual((await srv.call('GET', '/api/invoices')).body.length, countBefore);
    assert.strictEqual((await srv.call('GET', '/api/settings')).body.prefix, 'INV/');
  });
  await t('static files and path traversal', async () => {
    assert.strictEqual((await fetch(srv.base + '/')).status, 200);
    assert.strictEqual((await fetch(srv.base + '/..%2F..%2Fserver.js')).status, 403);
    assert.strictEqual((await fetch(srv.base + '/../server.js')).status === 200, false);
  });
  await srv.stop();
  console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
})();
