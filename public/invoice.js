/* Renders the tax invoice HTML from an invoice snapshot. Pure function: same input => same output. */
(function (root) {
  'use strict';
  const C = root.Calc;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = (s) => esc(s).split('\n').join('<br>');
  const cell = (label, value, cls) => '<div class="mc' + (cls ? ' ' + cls : '') + '"><div class="lb">' + label + '</div><div class="vb">' + esc(value) + '</div></div>';

  function render(inv) {
    const c = C.compute(inv);
    const s = inv.seller, b = inv.buyer, m = inv.meta || {}, bk = inv.bank;
    const pos = inv.placeOfSupply;
    const rup = '₹';

    /* ---- header ---- */
    const seller = '<div class="party seller"><b class="nm">' + esc(s.name) + '</b><br>' + lines(s.address) +
      (s.phone ? '<br>Ph:-' + esc(s.phone) : '') +
      (s.gstin ? '<br>GSTIN/UIN: ' + esc(s.gstin) : '') +
      '<br>State Name : ' + esc(s.state) + ', Code : ' + esc(s.stateCode) +
      (s.email ? '<br>E-Mail : ' + esc(s.email) : '') + '</div>';
    const buyer = '<div class="party buyer">Buyer<br><b class="nm">' + esc(b.name) + '</b><br>' + lines(b.address) +
      '<table class="kv">' +
      (b.gstin ? '<tr><td>GSTIN/UIN</td><td>: ' + esc(b.gstin) + '</td></tr>' : '') +
      '<tr><td>State Name</td><td>: ' + esc(b.state) + ', Code : ' + esc(b.stateCode) + '</td></tr>' +
      '<tr><td>Place of Supply</td><td>: ' + esc(pos.state) + '</td></tr></table></div>';
    const meta =
      cell('Invoice No.', inv.number) + cell('Dated', C.fmtDate(inv.date)) +
      cell('Delivery Note', m.deliveryNote) + cell('Mode/Terms of Payment', m.paymentTerms) +
      cell('Supplier’s Ref.', m.supplierRef) + cell('Other Reference(s)', m.otherRef) +
      cell('Buyer’s Order No.', m.orderNo) + cell('Dated', C.fmtDate(m.orderDate)) +
      cell('Despatch Document No.', m.despatchDocNo) + cell('Delivery Note Date', C.fmtDate(m.deliveryNoteDate)) +
      cell('Despatched through', m.despatchedThrough) + cell('Destination', m.destination) +
      cell('Terms of Delivery', m.termsOfDelivery, 'terms');

    /* ---- items table ---- */
    let rows = '';
    c.lines.forEach((l, i) => {
      rows += '<tr class="it"><td class="sl">' + (i + 1) + '</td><td class="desc"><b>' + lines(l.description) + '</b></td><td>' + esc(l.hsn) +
        '</td><td class="r"><b>' + C.fmtQty(l.qtyMilli) + ' ' + esc(l.unit) + '</b></td><td class="r">' + C.fmtRate(l.ratePts) +
        '</td><td>' + esc(l.unit) + '</td><td class="r"><b>' + C.fmtMoney(l.amount) + '</b></td></tr>';
    });
    const tail = [];
    if (c.intra) { tail.push(['CGST', c.cgst]); tail.push(['SGST', c.sgst]); } else { tail.push(['IGST', c.igst]); }
    const hasTail = tail.some((t) => t[1] !== 0) || c.roundOff !== 0;
    if (hasTail) {
      rows += '<tr class="sp"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
      rows += '<tr class="sub"><td></td><td></td><td></td><td></td><td></td><td></td><td class="r"><b>' + C.fmtMoney(c.taxable) + '</b></td></tr>';
      tail.forEach((t) => { rows += '<tr class="tx"><td></td><td class="lab">' + t[0] + '</td><td></td><td></td><td></td><td></td><td class="r"><b>' + C.fmtMoney(t[1]) + '</b></td></tr>'; });
      if (c.roundOff !== 0) {
        const roTxt = c.roundOff < 0 ? '(-)' + C.fmtMoney(-c.roundOff) : C.fmtMoney(c.roundOff);
        rows += '<tr class="tx"><td></td><td class="lab"><i class="less">Less :</i>Roundoff</td><td></td><td></td><td></td><td></td><td class="r"><b>' + roTxt + '</b></td></tr>';
      }
    } else {
      rows += '<tr class="tx"><td></td><td class="lab"><i class="less">Less :</i></td><td></td><td></td><td></td><td></td><td></td></tr>';
    }
    rows += '<tr class="fill"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
    rows += '<tr class="tot"><td></td><td class="r tl">Total</td><td></td><td class="r"><b>' + esc(c.qtyText) + '</b></td><td></td><td></td><td class="r"><b class="ta">' + rup + ' ' + C.fmtMoney(c.grand) + '</b></td></tr>';

    /* ---- HSN / tax summary ---- */
    let sum = '';
    const tot = { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    c.summary.forEach((g) => {
      Object.keys(tot).forEach((k) => { tot[k] += g[k]; });
      sum += c.intra
        ? '<tr><td class="l">' + esc(g.hsn) + '</td><td class="r">' + C.fmtMoney(g.taxable) + '</td><td class="r">' + C.fmtPct(g.halfRateH) + '%</td><td class="r">' + C.fmtMoney(g.cgst) +
          '</td><td class="r">' + C.fmtPct(g.halfRateH) + '%</td><td class="r">' + C.fmtMoney(g.sgst) + '</td><td class="r">' + C.fmtMoney(g.tax) + '</td></tr>'
        : '<tr><td class="l">' + esc(g.hsn) + '</td><td class="r">' + C.fmtMoney(g.taxable) + '</td><td class="r">' + C.fmtPct(g.rateH) + '%</td><td class="r">' + C.fmtMoney(g.igst) +
          '</td><td class="r">' + C.fmtMoney(g.tax) + '</td></tr>';
    });
    const sumTotal = c.intra
      ? '<tr class="tr"><td class="r">Total</td><td class="r">' + C.fmtMoney(tot.taxable) + '</td><td></td><td class="r">' + C.fmtMoney(tot.cgst) + '</td><td></td><td class="r">' + C.fmtMoney(tot.sgst) + '</td><td class="r">' + C.fmtMoney(tot.tax) + '</td></tr>'
      : '<tr class="tr"><td class="r">Total</td><td class="r">' + C.fmtMoney(tot.taxable) + '</td><td></td><td class="r">' + C.fmtMoney(tot.igst) + '</td><td class="r">' + C.fmtMoney(tot.tax) + '</td></tr>';
    const sumHead = c.intra
      ? '<colgroup><col style="width:41%"><col style="width:12%"><col style="width:6%"><col style="width:12%"><col style="width:6%"><col style="width:11%"><col style="width:12%"></colgroup>' +
        '<thead><tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable<br>Value</th><th colspan="2">Central Tax</th><th colspan="2">State Tax</th><th rowspan="2">Total<br>Tax Amount</th></tr><tr><th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th></tr></thead>'
      : '<colgroup><col style="width:46%"><col style="width:15%"><col style="width:8%"><col style="width:15%"><col style="width:16%"></colgroup>' +
        '<thead><tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable<br>Value</th><th colspan="2">Integrated Tax</th><th rowspan="2">Total<br>Tax Amount</th></tr><tr><th>Rate</th><th>Amount</th></tr></thead>';

    return '<div class="sheet' + (c.intra ? '' : ' inter') + '">' +
      '<div class="t-row"><span class="t-title">Tax Invoice</span><span class="t-copy">(' + esc(inv.copyLabel) + ')</span></div>' +
      '<div class="main">' +
        '<div class="head"><div class="head-l">' + seller + buyer + '</div><div class="head-r">' + meta + '</div></div>' +
        '<table class="items"><colgroup><col style="width:4.6%"><col style="width:45.9%"><col style="width:9.9%"><col style="width:11.6%"><col style="width:8.1%"><col style="width:7.6%"><col style="width:12.3%"></colgroup>' +
        '<thead><tr><th>Sl<br>No.</th><th>Description of Goods</th><th>HSN/SAC</th><th>Quantity</th><th>Rate</th><th>per</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="keep">' +
          '<div class="words"><div class="w1"><span>Amount Chargeable (in words)</span><span class="eoe">E. &amp; O.E</span></div><b>' + esc(C.amountInWords(c.grand)) + '</b></div>' +
          '<table class="hsn">' + sumHead + '<tbody>' + sum + sumTotal + '</tbody></table>' +
          '<div class="taxwords">Tax Amount (in words) : <b>' + esc(C.amountInWords(c.totalTax)) + '</b></div>' +
          '<div class="foot"><div class="foot-l"><div class="decl"><u>Declaration</u><br>' + esc(inv.declaration) + '</div></div>' +
            '<div class="foot-r"><div class="bank"><u>Company’s Bank Details</u><table class="kv2">' +
              '<tr><td>Bank Name</td><td>: <b>' + esc(bk.bankName) + '</b></td></tr>' +
              '<tr><td>A/c No.</td><td>: <b>' + esc(bk.accountNo) + '</b></td></tr>' +
              '<tr><td>Branch &amp; IFS Code</td><td>: <b>' + esc(bk.branch) + ' &amp; ' + esc(bk.ifsc) + '</b></td></tr></table></div>' +
              '<div class="sig"><b>for ' + esc(s.name) + '</b><span>Authorised Signatory</span></div></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="end">' + esc(inv.jurisdiction) + '<br>this is computer generated invoice</div></div>';
  }
  root.InvoiceView = { render };
})(window);
