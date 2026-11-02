/* Shared calculation / validation module. Used by the browser AND the server,
   so totals are computed identically on both sides. All money maths uses
   integers (paise) / BigInt - no floating point. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATES = [
    ['Jammu & Kashmir', '01'], ['Himachal Pradesh', '02'], ['Punjab', '03'], ['Chandigarh', '04'],
    ['Uttarakhand', '05'], ['Haryana', '06'], ['Delhi', '07'], ['Rajasthan', '08'],
    ['Uttar Pradesh', '09'], ['Bihar', '10'], ['Sikkim', '11'], ['Arunachal Pradesh', '12'],
    ['Nagaland', '13'], ['Manipur', '14'], ['Mizoram', '15'], ['Tripura', '16'],
    ['Meghalaya', '17'], ['Assam', '18'], ['West Bengal', '19'], ['Jharkhand', '20'],
    ['Odisha', '21'], ['Chhattisgarh', '22'], ['Madhya Pradesh', '23'], ['Gujarat', '24'],
    ['Dadra & Nagar Haveli and Daman & Diu', '26'], ['Maharashtra', '27'], ['Karnataka', '29'],
    ['Goa', '30'], ['Lakshadweep', '31'], ['Kerala', '32'], ['Tamil Nadu', '33'],
    ['Puducherry', '34'], ['Andaman & Nicobar Islands', '35'], ['Telangana', '36'],
    ['Andhra Pradesh', '37'], ['Ladakh', '38'], ['Other Territory', '97']
  ];
  const stateByCode = (c) => { const s = STATES.find((x) => x[1] === String(c)); return s ? s[0] : ''; };

  const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const HSN_RE = /^\d{4,8}$/;
  const META_KEYS = ['deliveryNote', 'paymentTerms', 'supplierRef', 'otherRef', 'orderNo', 'orderDate',
    'despatchDocNo', 'deliveryNoteDate', 'despatchedThrough', 'destination', 'termsOfDelivery'];

  /* ---------- parsing helpers (BigInt, exact) ---------- */
  // "12.5" with scale 2 -> 1250n ; returns null if not a plain non-negative decimal or too many decimals
  function parseScaled(v, scale) {
    const s = String(v == null ? '' : v).trim().replace(/,/g, '');
    if (!/^\d+(\.\d*)?$/.test(s)) return null;
    const parts = s.split('.');
    const f = parts[1] || '';
    if (f.length > scale && /[1-9]/.test(f.slice(scale))) return null;
    return BigInt(parts[0] + (f + '0'.repeat(scale)).slice(0, scale));
  }
  function parseSigned(v, scale) {
    const s = String(v == null ? '' : v).trim();
    if (s === '') return 0n;
    if (s[0] === '-') { const p = parseScaled(s.slice(1), scale); return p === null ? null : -p; }
    if (s[0] === '+') return parseScaled(s.slice(1), scale);
    return parseScaled(s, scale);
  }
  const divRound = (n, d) => (n * 2n + d) / (2n * d); // half-up, n >= 0

  /* ---------- formatting ---------- */
  function groupIndian(intStr) {
    if (intStr.length <= 3) return intStr;
    const last3 = intStr.slice(-3);
    const rest = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return rest + ',' + last3;
  }
  function fmtMoney(paise) {
    const neg = paise < 0; const p = Math.abs(paise);
    const s = groupIndian(String(Math.floor(p / 100))) + '.' + String(p % 100).padStart(2, '0');
    return (neg ? '-' : '') + s;
  }
  function trimZeros(intPart, frac, minFrac) {
    let f = frac;
    while (f.length > minFrac && f.endsWith('0')) f = f.slice(0, -1);
    return f.length ? intPart + '.' + f : intPart;
  }
  function fmtQty(milli) { return trimZeros(String(Math.floor(milli / 1000)), String(milli % 1000).padStart(3, '0'), 0); }
  function fmtRate(pts) { return trimZeros(groupIndian(String(Math.floor(pts / 10000))), String(pts % 10000).padStart(4, '0'), 2); }
  function fmtPct(h) { return trimZeros(String(Math.floor(h / 100)), String(h % 100).padStart(2, '0'), 0); } // hundredths of a percent
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '-' + MONTHS[+m[2] - 1] + '-' + m[1] : (iso || '');
  }
  function isValidISODate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  /* ---------- amount in words (Indian numbering) ---------- */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
  function intWords(n) {
    if (n === 0) return 'Zero';
    const parts = [];
    const cr = Math.floor(n / 1e7); if (cr) { parts.push(intWords(cr) + ' Crore'); n %= 1e7; }
    const lk = Math.floor(n / 1e5); if (lk) { parts.push(two(lk) + ' Lakh'); n %= 1e5; }
    const th = Math.floor(n / 1e3); if (th) { parts.push(two(th) + ' Thousand'); n %= 1e3; }
    const h = Math.floor(n / 100); if (h) { parts.push(ONES[h] + ' Hundred'); n %= 100; }
    if (n) parts.push(two(n));
    return parts.join(' ');
  }
  function amountInWords(paise) {
    const neg = paise < 0; const p = Math.abs(paise);
    const r = Math.floor(p / 100); const ps = p % 100;
    let s = 'Indian Rupees ' + intWords(r);
    if (ps) s += ' and ' + two(ps) + ' paise';
    return (neg ? 'Minus ' : '') + s + ' Only';
  }

  /* ---------- normalisation ---------- */
  const str = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max || 200);
  function normalize(inv) {
    const i = inv || {}; const s = i.seller || {}; const b = i.buyer || {}; const bk = i.bank || {};
    const pos = i.placeOfSupply || {}; const m = i.meta || {}; const ro = i.roundOff || {};
    const meta = {}; META_KEYS.forEach((k) => { meta[k] = str(m[k], 120); });
    return {
      number: str(i.number, 30), date: str(i.date, 10),
      copyLabel: str(i.copyLabel, 60) || 'ORIGINAL FOR RECIPIENT',
      seller: { name: str(s.name, 120), address: str(s.address, 300), phone: str(s.phone, 40), gstin: str(s.gstin, 15).toUpperCase(),
        state: str(s.state, 60), stateCode: str(s.stateCode, 2), email: str(s.email, 100) },
      bank: { bankName: str(bk.bankName, 80), accountNo: str(bk.accountNo, 40), branch: str(bk.branch, 80), ifsc: str(bk.ifsc, 20).toUpperCase() },
      buyer: { name: str(b.name, 120), address: str(b.address, 300), gstin: str(b.gstin, 15).toUpperCase(), state: str(b.state, 60), stateCode: str(b.stateCode, 2) },
      placeOfSupply: { state: str(pos.state, 60), stateCode: str(pos.stateCode, 2) },
      meta,
      items: (Array.isArray(i.items) ? i.items : []).slice(0, 300).map((it) => ({
        description: str(it && it.description, 300), hsn: str(it && it.hsn, 8), qty: str(it && it.qty, 20),
        unit: str(it && it.unit, 10).toUpperCase(), rate: str(it && it.rate, 24), gstRate: str(it && it.gstRate, 8)
      })),
      roundOff: { mode: ro.mode === 'manual' ? 'manual' : 'auto', value: str(ro.value, 12) },
      declaration: str(i.declaration, 500), jurisdiction: str(i.jurisdiction, 100)
    };
  }
  const isBlankItem = (it) => !(it.description || it.hsn || it.qty || it.rate);

  /* ---------- the calculation ---------- */
  function compute(inv) {
    const intra = String(inv.placeOfSupply && inv.placeOfSupply.stateCode) === String(inv.seller && inv.seller.stateCode);
    const lines = []; const groups = new Map(); const units = new Map();
    let taxable = 0n;
    (inv.items || []).forEach((it) => {
      if (isBlankItem(it)) return;
      const qm = parseScaled(it.qty, 3) || 0n;
      const rp = parseScaled(it.rate, 4) || 0n;
      const amt = divRound(qm * rp, 100000n);
      const rh = parseScaled(it.gstRate === '' || it.gstRate == null ? '0' : it.gstRate, 2) || 0n;
      lines.push({ description: it.description, hsn: it.hsn, unit: it.unit, qtyMilli: Number(qm), ratePts: Number(rp), amount: Number(amt), rateH: Number(rh) });
      taxable += amt;
      const key = it.hsn + '|' + rh;
      const g = groups.get(key) || { hsn: it.hsn, rateH: rh, taxable: 0n };
      g.taxable += amt; groups.set(key, g);
      units.set(it.unit, (units.get(it.unit) || 0n) + qm);
    });
    let cgst = 0n, sgst = 0n, igst = 0n;
    const summary = [...groups.values()].map((g) => {
      let c = 0n, s = 0n, ig = 0n;
      if (intra) { c = divRound(g.taxable * g.rateH, 20000n); s = c; } else { ig = divRound(g.taxable * g.rateH, 10000n); }
      cgst += c; sgst += s; igst += ig;
      return { hsn: g.hsn, rateH: Number(g.rateH), halfRateH: Number(g.rateH) / 2, taxable: Number(g.taxable), cgst: Number(c), sgst: Number(s), igst: Number(ig), tax: Number(c + s + ig) };
    });
    summary.sort((a, b) => (a.hsn < b.hsn ? -1 : a.hsn > b.hsn ? 1 : a.rateH - b.rateH));
    const totalTax = cgst + sgst + igst;
    const raw = taxable + totalTax;
    let ro;
    if (inv.roundOff && inv.roundOff.mode === 'manual') ro = parseSigned(inv.roundOff.value, 2) || 0n;
    else ro = divRound(raw, 100n) * 100n - raw;
    const grand = raw + ro;
    const qtyText = [...units.entries()].filter((e) => e[1] > 0n).map((e) => fmtQty(Number(e[1])) + (e[0] ? ' ' + e[0] : '')).join(', ');
    return { intra, lines, summary, taxable: Number(taxable), cgst: Number(cgst), sgst: Number(sgst), igst: Number(igst),
      totalTax: Number(totalTax), raw: Number(raw), roundOff: Number(ro), grand: Number(grand), qtyText };
  }

  // amount in paise for one row (null when the row is blank or not yet parsable)
  function lineAmount(it) {
    if (isBlankItem(it)) return null;
    const q = parseScaled(it.qty, 3), r = parseScaled(it.rate, 4);
    return q === null || r === null ? null : Number(divRound(q * r, 100000n));
  }

  /* ---------- validation (returns list of messages) ---------- */
  function validate(inv) {
    const e = [];
    const MAXQ = 1000000n * 1000n; const MAXR = 100000000n * 10000n;
    if (!inv.number) e.push('Invoice number is required.');
    if (!isValidISODate(inv.date)) e.push('Invoice date is invalid.');
    ['orderDate', 'deliveryNoteDate'].forEach((k) => { if (inv.meta[k] && !isValidISODate(inv.meta[k])) e.push('Date "' + k + '" is invalid.'); });
    if (!inv.seller.name) e.push('Seller company name is required.');
    if (inv.seller.gstin && !GSTIN_RE.test(inv.seller.gstin)) e.push('Seller GSTIN format is invalid.');
    if (!stateByCode(inv.seller.stateCode)) e.push('Seller state is invalid.');
    if (!inv.buyer.name) e.push('Buyer name is required.');
    if (inv.buyer.gstin && !GSTIN_RE.test(inv.buyer.gstin)) e.push('Buyer GSTIN format is invalid (15 characters, e.g. 20AAAAA0000A1Z5).');
    if (!stateByCode(inv.buyer.stateCode)) e.push('Buyer state is required.');
    if (!stateByCode(inv.placeOfSupply.stateCode)) e.push('Place of supply is required.');
    const real = inv.items.map((it, idx) => ({ it, n: idx + 1 })).filter((x) => !isBlankItem(x.it));
    if (!real.length) e.push('Add at least one product row.');
    real.forEach(({ it, n }) => {
      const p = 'Row ' + n + ': ';
      if (!it.description) e.push(p + 'description is required.');
      if (it.hsn && !HSN_RE.test(it.hsn)) e.push(p + 'HSN/SAC must be 4 to 8 digits.');
      const q = parseScaled(it.qty, 3);
      if (q === null || q === 0n) e.push(p + 'quantity must be a number greater than 0 (max 3 decimals).');
      else if (q > MAXQ) e.push(p + 'quantity is too large.');
      const r = parseScaled(it.rate, 4);
      if (r === null) e.push(p + 'rate must be a number (max 4 decimals).');
      else if (r > MAXR) e.push(p + 'rate is too large.');
      if (!it.unit) e.push(p + 'unit is required.');
      const g = parseScaled(it.gstRate === '' ? '0' : it.gstRate, 2);
      if (g === null || g > 10000n) e.push(p + 'GST rate must be between 0 and 100.');
    });
    if (inv.roundOff.mode === 'manual') {
      const v = parseSigned(inv.roundOff.value, 2);
      if (v === null || v > 100n || v < -100n) e.push('Manual round-off must be between -1.00 and 1.00.');
    }
    if (!e.length) { const c = compute(inv); if (c.grand < 0) e.push('Invoice total cannot be negative.'); if (c.grand > 1e13) e.push('Invoice total is too large.'); }
    return e;
  }

  return { STATES, stateByCode, GSTIN_RE, HSN_RE, META_KEYS, parseScaled, parseSigned, fmtMoney, fmtQty, fmtRate, fmtPct, fmtDate,
    isValidISODate, amountInWords, normalize, compute, validate, groupIndian, lineAmount };
});
