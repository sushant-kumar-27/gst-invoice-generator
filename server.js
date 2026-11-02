'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { open, DEFAULT_SETTINGS } = require('./db');
const Calc = require('./public/calc.js');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

class HttpError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors || [message]; }
}

function createApp(dbFile) {
  const db = open(dbFile);
  const now = () => new Date().toISOString();

  /* ---------------- settings ---------------- */
  function getSettings() {
    const row = db.prepare('SELECT data FROM settings WHERE id = 1').get();
    return Object.assign({}, DEFAULT_SETTINGS, row ? JSON.parse(row.data) : {});
  }
  function saveSettings(s) {
    db.prepare('INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(JSON.stringify(s));
  }
  function cleanSettings(b) {
    const t = (v, n) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, n);
    const s = {
      companyName: t(b.companyName, 120), address: t(b.address, 300), phone: t(b.phone, 40),
      gstin: t(b.gstin, 15).toUpperCase(), stateCode: t(b.stateCode, 2), email: t(b.email, 100),
      bankName: t(b.bankName, 80), accountNo: t(b.accountNo, 40), branch: t(b.branch, 80), ifsc: t(b.ifsc, 20).toUpperCase(),
      declaration: t(b.declaration, 500), jurisdiction: t(b.jurisdiction, 100),
      defaultGstRate: t(b.defaultGstRate, 8), ratePresets: t(b.ratePresets, 80),
      prefix: t(b.prefix, 10), nextNumber: Number(b.nextNumber), padding: Number(b.padding)
    };
    const e = [];
    if (!s.companyName) e.push('Company name is required.');
    if (!s.address) e.push('Address is required.');
    if (s.gstin && !Calc.GSTIN_RE.test(s.gstin)) e.push('GSTIN format is invalid.');
    if (!Calc.stateByCode(s.stateCode)) e.push('State is invalid.');
    if (s.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) e.push('Email is invalid.');
    if (!/^[A-Za-z0-9\-_/.]*$/.test(s.prefix)) e.push('Invoice prefix may only contain letters, digits and - _ / .');
    if (!Number.isInteger(s.nextNumber) || s.nextNumber < 1 || s.nextNumber > 999999999) e.push('Next invoice number must be a whole number of 1 or more.');
    if (!Number.isInteger(s.padding) || s.padding < 0 || s.padding > 8) e.push('Number padding must be between 0 and 8.');
    const dg = Calc.parseScaled(s.defaultGstRate, 2);
    if (dg === null || dg > 10000n) e.push('Default GST rate must be between 0 and 100.');
    const presets = s.ratePresets.split(',').map((x) => x.trim()).filter(Boolean);
    if (!presets.length || presets.some((x) => { const v = Calc.parseScaled(x, 2); return v === null || v > 10000n; })) e.push('GST rate list must be comma separated numbers between 0 and 100.');
    if (e.length) throw new HttpError(400, 'Invalid settings', e);
    s.state = Calc.stateByCode(s.stateCode);
    s.ratePresets = presets.join(', ');
    return s;
  }

  /* ---------------- invoice numbering ---------------- */
  const fmtNumber = (s, n) => s.prefix + String(n).padStart(s.padding, '0');
  function suggestNumber() {
    const s = getSettings();
    let n = s.nextNumber;
    const q = db.prepare('SELECT 1 FROM invoices WHERE number = ?');
    while (q.get(fmtNumber(s, n))) n++;
    return { number: fmtNumber(s, n), n };
  }
  function bumpCounter(number) {
    const s = getSettings();
    if (!number.startsWith(s.prefix)) return;
    const rest = number.slice(s.prefix.length);
    if (!/^\d{1,9}$/.test(rest)) return;
    const n = parseInt(rest, 10);
    if (n >= s.nextNumber) { s.nextNumber = n + 1; saveSettings(s); }
  }

  /* ---------------- invoices ---------------- */
  function prepareInvoice(body, assignNumber) {
    if (!body || typeof body.invoice !== 'object') throw new HttpError(400, 'Missing invoice data');
    const inv = Calc.normalize(body.invoice);
    if (!inv.number && assignNumber) inv.number = suggestNumber().number;
    const errs = Calc.validate(inv);
    if (errs.length) throw new HttpError(400, 'Validation failed', errs);
    const c = Calc.compute(inv);
    if (body.expectedGrand != null && Number(body.expectedGrand) !== c.grand) {
      throw new HttpError(400, 'Total mismatch', ['Invoice total does not match the server calculation (' + Calc.fmtMoney(c.grand) + '). Please recheck and save again.']);
    }
    return { inv, c };
  }
  function rowToInvoice(r) {
    return { id: r.id, number: r.number, createdAt: r.created_at, updatedAt: r.updated_at, data: JSON.parse(r.data) };
  }
  const dupMsg = (n) => 'Invoice number "' + n + '" already exists. Use a different number.';
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ } throw e; }
  }
  function isUnique(e) { return /UNIQUE/i.test(String(e && e.message)); }

  function createInvoice(body) {
    return tx(() => {
      const { inv, c } = prepareInvoice(body, true);
      try {
        const t = now();
        const r = db.prepare('INSERT INTO invoices (number, date, buyer_name, grand, total_tax, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(inv.number, inv.date, inv.buyer.name, c.grand, c.totalTax, JSON.stringify(inv), t, t);
        bumpCounter(inv.number);
        return rowToInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.lastInsertRowid));
      } catch (e) { if (isUnique(e)) throw new HttpError(409, dupMsg(inv.number)); throw e; }
    });
  }
  function updateInvoice(id, body) {
    return tx(() => {
      const old = db.prepare('SELECT id FROM invoices WHERE id = ?').get(id);
      if (!old) throw new HttpError(404, 'Invoice not found');
      const { inv, c } = prepareInvoice(body, false);
      try {
        db.prepare('UPDATE invoices SET number=?, date=?, buyer_name=?, grand=?, total_tax=?, data=?, updated_at=? WHERE id=?')
          .run(inv.number, inv.date, inv.buyer.name, c.grand, c.totalTax, JSON.stringify(inv), now(), id);
        bumpCounter(inv.number);
      } catch (e) { if (isUnique(e)) throw new HttpError(409, dupMsg(inv.number)); throw e; }
      return rowToInvoice(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
    });
  }

  /* ---------------- catalogue ---------------- */
  const catRow = (r) => ({ id: r.id, name: r.name, hsn: r.hsn, unit: r.unit, rate: r.rate, gstRate: r.gst_rate });
  function cleanProduct(b) {
    const t = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const p = { name: t(b.name, 300), hsn: t(b.hsn, 8), unit: t(b.unit, 10).toUpperCase() || 'PCS', rate: t(b.rate, 24) || '0', gstRate: t(b.gstRate, 8) };
    const e = [];
    if (!p.name) e.push('Product name is required.');
    if (p.hsn && !Calc.HSN_RE.test(p.hsn)) e.push('HSN/SAC must be 4 to 8 digits.');
    const r = Calc.parseScaled(p.rate, 4);
    if (r === null) e.push('Rate must be a number (max 4 decimals).');
    const g = Calc.parseScaled(p.gstRate === '' ? '0' : p.gstRate, 2);
    if (g === null || g > 10000n) e.push('GST rate must be between 0 and 100.');
    if (p.gstRate === '') p.gstRate = getSettings().defaultGstRate;
    if (e.length) throw new HttpError(400, 'Invalid product', e);
    return p;
  }

  /* ---------------- routing ---------------- */
  async function api(req, res, url) {
    const m = req.method; const p = url.pathname;
    const id = (re) => { const x = re.exec(p); return x ? parseInt(x[1], 10) : null; };
    let x;
    if (p === '/api/settings') {
      if (m === 'GET') return send(res, 200, getSettings());
      if (m === 'PUT') { const s = cleanSettings(await readJson(req)); saveSettings(s); return send(res, 200, getSettings()); }
    }
    if (p === '/api/next-number' && m === 'GET') return send(res, 200, suggestNumber());
    if (p === '/api/capabilities' && m === 'GET') return send(res, 200, { pdf: pdfAvailable() });

    if (p === '/api/catalogue') {
      if (m === 'GET') return send(res, 200, db.prepare('SELECT * FROM catalogue ORDER BY name COLLATE NOCASE').all().map(catRow));
      if (m === 'POST') {
        const c = cleanProduct(await readJson(req));
        const r = db.prepare('INSERT INTO catalogue (name, hsn, unit, rate, gst_rate) VALUES (?,?,?,?,?)').run(c.name, c.hsn, c.unit, c.rate, c.gstRate);
        return send(res, 201, catRow(db.prepare('SELECT * FROM catalogue WHERE id = ?').get(r.lastInsertRowid)));
      }
    }
    if ((x = id(/^\/api\/catalogue\/(\d+)$/)) !== null) {
      if (m === 'PUT') {
        const c = cleanProduct(await readJson(req));
        const r = db.prepare('UPDATE catalogue SET name=?, hsn=?, unit=?, rate=?, gst_rate=? WHERE id=?').run(c.name, c.hsn, c.unit, c.rate, c.gstRate, x);
        if (!r.changes) throw new HttpError(404, 'Product not found');
        return send(res, 200, catRow(db.prepare('SELECT * FROM catalogue WHERE id = ?').get(x)));
      }
      if (m === 'DELETE') {
        const r = db.prepare('DELETE FROM catalogue WHERE id = ?').run(x);
        if (!r.changes) throw new HttpError(404, 'Product not found');
        return send(res, 200, { ok: true });
      }
    }

    if (p === '/api/invoices') {
      if (m === 'GET') {
        const q = (url.searchParams.get('q') || '').trim();
        const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
        const rows = q
          ? db.prepare("SELECT id, number, date, buyer_name, grand, total_tax, updated_at FROM invoices WHERE number LIKE ? ESCAPE '\\' OR buyer_name LIKE ? ESCAPE '\\' ORDER BY date DESC, id DESC").all(like, like)
          : db.prepare('SELECT id, number, date, buyer_name, grand, total_tax, updated_at FROM invoices ORDER BY date DESC, id DESC').all();
        return send(res, 200, rows.map((r) => ({ id: r.id, number: r.number, date: r.date, buyerName: r.buyer_name, grand: r.grand, totalTax: r.total_tax, updatedAt: r.updated_at })));
      }
      if (m === 'POST') return send(res, 201, createInvoice(await readJson(req)));
    }
    if ((x = id(/^\/api\/invoices\/(\d+)\/pdf$/)) !== null && m === 'GET') {
      const row = db.prepare('SELECT number FROM invoices WHERE id = ?').get(x);
      if (!row) throw new HttpError(404, 'Invoice not found');
      const buf = await renderPdf(x, req);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Invoice-' + row.number.replace(/[^A-Za-z0-9._-]/g, '_') + '.pdf"' });
      return res.end(buf);
    }
    if ((x = id(/^\/api\/invoices\/(\d+)$/)) !== null) {
      if (m === 'GET') {
        const r = db.prepare('SELECT * FROM invoices WHERE id = ?').get(x);
        if (!r) throw new HttpError(404, 'Invoice not found');
        return send(res, 200, rowToInvoice(r));
      }
      if (m === 'PUT') return send(res, 200, updateInvoice(x, await readJson(req)));
      if (m === 'DELETE') {
        const r = db.prepare('DELETE FROM invoices WHERE id = ?').run(x);
        if (!r.changes) throw new HttpError(404, 'Invoice not found');
        return send(res, 200, { ok: true });
      }
    }
    throw new HttpError(404, 'Not found');
  }

  /* ---------------- optional server-side PDF (needs the "playwright" package) ---------------- */
  let pw = null; let browser = null; let pdfTried = false;
  function loadPw() { if (!pdfTried) { pdfTried = true; try { pw = require('playwright'); } catch (_) { pw = null; } } return pw; }
  function pdfAvailable() {
    const p = loadPw(); if (!p) return false;
    try { const ex = p.chromium.executablePath(); return !!ex && fs.existsSync(ex); } catch (_) { return false; }
  }
  async function renderPdf(id, req) {
    if (!pdfAvailable()) throw new HttpError(501, 'PDF download is not available on this server. Use Print and choose "Save as PDF".');
    if (!browser) browser = await pw.chromium.launch();
    const page = await browser.newPage();
    try {
      const port = req.socket.localPort;
      await page.goto('http://127.0.0.1:' + port + '/#/pdf/' + id, { waitUntil: 'load' });
      await page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });
      await page.emulateMedia({ media: 'print' });
      return await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } finally { await page.close(); }
  }

  /* ---------------- http plumbing ---------------- */
  function send(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (_) { reject(new HttpError(400, 'Invalid JSON')); } });
      req.on('error', reject);
    });
  }
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }
  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, errors: e.errors });
      console.error(e);
      return send(res, 500, { error: 'Server error', errors: ['Something went wrong on the server.'] });
    }
  }
  async function close() { if (browser) { await browser.close(); browser = null; } db.close(); }
  return { handler, close, db };
}

module.exports = { createApp };

if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = process.env.HOST || '0.0.0.0';
  const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'invoices.db');
  const app = createApp(DB_FILE);
  http.createServer(app.handler).listen(PORT, HOST, () => {
    console.log('GST Invoice Generator running at http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT);
    console.log('Database: ' + DB_FILE);
  });
  const stop = () => app.close().finally(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
