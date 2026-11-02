(function () {
  'use strict';
  const C = window.Calc;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');

  const App = { settings: null, catalogue: [], caps: { pdf: false }, draft: null, editingId: null, pending: null, posManual: false };

  /* ------------------------------------------------------------ helpers */
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch (_) { /* no body */ }
    if (!r.ok) {
      const e = new Error((data && data.error) || 'Request failed');
      e.errors = (data && data.errors) || [e.message]; e.status = r.status; throw e;
    }
    return data;
  }
  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast no-print' + (isErr ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2500);
  }
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? '' : a[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const go = (h) => { if (location.hash === '#' + h) route(); else location.hash = h; };
  const stateOptions = (sel) => '<option value="">-- select state --</option>' + C.STATES.map((s) => '<option value="' + s[1] + '"' + (s[1] === String(sel) ? ' selected' : '') + '>' + esc(s[0]) + ' (' + s[1] + ')</option>').join('');
  const rateList = () => String(App.settings.ratePresets).split(',').map((x) => x.trim()).filter(Boolean);
  const errBox = (errs) => '<strong>Please fix the following:</strong><ul>' + errs.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>';

  async function loadBase() {
    const [s, c, caps] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/catalogue'), api('GET', '/api/capabilities')]);
    App.settings = s; App.catalogue = c; App.caps = caps;
  }

  /* ------------------------------------------------------------ drafts */
  const blankItem = () => ({ description: '', hsn: '', qty: '', unit: 'PCS', rate: '', gstRate: App.settings.defaultGstRate });
  function snapshotParties() {
    const s = App.settings;
    return {
      seller: { name: s.companyName, address: s.address, phone: s.phone, gstin: s.gstin, state: s.state, stateCode: s.stateCode, email: s.email },
      bank: { bankName: s.bankName, accountNo: s.accountNo, branch: s.branch, ifsc: s.ifsc }
    };
  }
  function newDraft() {
    const s = App.settings; const meta = {}; C.META_KEYS.forEach((k) => { meta[k] = ''; });
    return Object.assign({
      number: '', date: todayISO(), copyLabel: 'ORIGINAL FOR RECIPIENT',
      buyer: { name: '', address: '', gstin: '', state: s.state, stateCode: s.stateCode },
      placeOfSupply: { state: s.state, stateCode: s.stateCode },
      meta, items: [blankItem()], roundOff: { mode: 'auto', value: '0.00' },
      declaration: s.declaration, jurisdiction: s.jurisdiction
    }, snapshotParties());
  }
  const SAMPLE_BUYER = { name: 'S K ENTERPRISES', address: 'Black Diamond Enclave, Ground Floor, Dhanbad\nPolytechnic Road, Near Baramuri Khatal, Dhanbad', gstin: '20AFWFS4755H1ZK', state: 'Jharkhand', stateCode: '20' };
  const SAMPLE_ITEMS = [
    { description: 'Canon-AS-120R II BK (MRP 450)', hsn: '84701000', qty: '5', unit: 'PCS', rate: '258.95', gstRate: '18' },
    { description: 'Canon-WS-1212R (MRP 660)', hsn: '84701000', qty: '20', unit: 'PCS', rate: '258.95', gstRate: '18' },
    { description: 'Canon-AS-2222R', hsn: '84701000', qty: '5', unit: 'PCS', rate: '471.87', gstRate: '18' }
  ];

  /* ------------------------------------------------------------ New / Edit invoice */
  async function pageEditor(id) {
    if (id) { const r = await api('GET', '/api/invoices/' + id); App.draft = r.data; App.editingId = r.id; }
    else if (App.pending) { App.draft = App.pending; App.pending = null; App.editingId = null; }
    else { App.draft = newDraft(); App.editingId = null; }
    if (!App.editingId && !App.draft.number) { try { App.draft.number = (await api('GET', '/api/next-number')).number; } catch (_) { /* user can type one */ } }
    App.posManual = App.draft.placeOfSupply.stateCode !== App.draft.buyer.stateCode;
    renderEditor();
  }

  const fld = (path, label, attrs, cls) => '<label class="f ' + (cls || '') + '"><span>' + label + '</span><input data-f="' + path + '" value="' + esc(getPath(App.draft, path)) + '" ' + (attrs || '') + '></label>';

  function itemsHTML() {
    return App.draft.items.map((it, i) => '<div class="item"><div class="irow1"><span class="sn">' + (i + 1) + '</span>' +
      '<input data-i="' + i + '" data-k="description" list="dl-products" placeholder="Description of goods" value="' + esc(it.description) + '">' +
      '<button type="button" class="x" data-del="' + i + '" title="Delete this row">&#10005;</button></div>' +
      '<div class="irow2">' +
      '<label>HSN/SAC<input data-i="' + i + '" data-k="hsn" inputmode="numeric" maxlength="8" value="' + esc(it.hsn) + '"></label>' +
      '<label>Quantity<input data-i="' + i + '" data-k="qty" inputmode="decimal" value="' + esc(it.qty) + '"></label>' +
      '<label>Unit<input data-i="' + i + '" data-k="unit" list="dl-units" maxlength="10" value="' + esc(it.unit) + '"></label>' +
      '<label>Rate (&#8377;)<input data-i="' + i + '" data-k="rate" inputmode="decimal" value="' + esc(it.rate) + '"></label>' +
      '<label>GST %<input data-i="' + i + '" data-k="gstRate" list="dl-rates" inputmode="decimal" value="' + esc(it.gstRate) + '"></label>' +
      '<label>Amount<input data-amt="' + i + '" readonly tabindex="-1"></label></div></div>').join('');
  }

  function renderEditor() {
    const d = App.draft; const m = d.meta;
    const metaFld = (k, label, type) => '<label class="f"><span>' + label + '</span><input data-f="meta.' + k + '"' + (type ? ' type="' + type + '"' : '') + ' value="' + esc(m[k]) + '"></label>';
    view.innerHTML =
      '<div class="layout"><section class="form-col no-print">' +
      '<div class="panel bar"><h2>' + (App.editingId ? 'Edit Invoice ' + esc(d.number) : 'New Invoice') + '</h2>' +
      '<div class="row"><button type="button" id="b-sample" title="Fill the sample buyer and products from the reference invoice">Load Sample</button><button type="button" id="b-clear">Clear</button></div></div>' +
      '<div id="errs" class="errs" hidden></div>' +
      '<div class="panel"><h3>Invoice</h3><div class="grid3">' +
        fld('number', 'Invoice No.') + fld('date', 'Date', 'type="date"') +
        '<label class="f"><span>Copy label</span><select data-f="copyLabel">' + ['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SUPPLIER'].map((o) => '<option' + (o === d.copyLabel ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>' +
      '</div><div class="hint" style="margin-top:6px">Seller: <b>' + esc(d.seller.name) + '</b>, GSTIN ' + esc(d.seller.gstin) + ' &middot; bank details are taken from Company Settings.</div></div>' +
      '<div class="panel"><h3>Buyer</h3><div class="grid2">' +
        fld('buyer.name', 'Buyer name', '', 'span2') +
        '<label class="f span2"><span>Address</span><textarea rows="2" data-f="buyer.address">' + esc(d.buyer.address) + '</textarea></label>' +
        fld('buyer.gstin', 'GSTIN/UIN', 'maxlength="15" style="text-transform:uppercase"') +
        '<label class="f"><span>State</span><select data-f="buyer.stateCode">' + stateOptions(d.buyer.stateCode) + '</select></label>' +
        '<label class="f span2"><span>Place of supply (decides CGST+SGST or IGST)</span><select data-f="placeOfSupply.stateCode">' + stateOptions(d.placeOfSupply.stateCode) + '</select></label>' +
      '</div></div>' +
      '<div class="panel"><h3>Other details</h3><div class="grid2">' +
        metaFld('deliveryNote', 'Delivery Note') + metaFld('paymentTerms', 'Mode/Terms of Payment') +
        metaFld('supplierRef', 'Supplier’s Ref.') + metaFld('otherRef', 'Other Reference(s)') +
        metaFld('orderNo', 'Buyer’s Order No.') + metaFld('orderDate', 'Buyer’s Order Date', 'date') +
        metaFld('despatchDocNo', 'Despatch Document No.') + metaFld('deliveryNoteDate', 'Delivery Note Date', 'date') +
        metaFld('despatchedThrough', 'Despatched through') + metaFld('destination', 'Destination') +
        '<label class="f span2"><span>Terms of Delivery</span><input data-f="meta.termsOfDelivery" value="' + esc(m.termsOfDelivery) + '"></label>' +
      '</div></div>' +
      '<div class="panel"><h3>Products</h3><div id="items">' + itemsHTML() + '</div><button type="button" id="b-add">+ Add row</button></div>' +
      '<div class="panel"><h3>Totals</h3><div class="totals" id="totals"></div>' +
        '<div class="row" style="margin-top:8px"><label class="f" style="width:170px"><span>Round-off</span><select data-f="roundOff.mode"><option value="auto"' + (d.roundOff.mode === 'auto' ? ' selected' : '') + '>Automatic (nearest ₹1)</option><option value="manual"' + (d.roundOff.mode === 'manual' ? ' selected' : '') + '>Manual</option></select></label>' +
        '<label class="f" id="ro-manual" style="width:120px"' + (d.roundOff.mode === 'manual' ? '' : ' hidden') + '><span>Amount (− or +)</span><input data-f="roundOff.value" inputmode="decimal" value="' + esc(d.roundOff.value) + '"></label></div></div>' +
      '<div class="actions"><button type="button" class="primary" id="b-save">Save</button><button type="button" id="b-saveprint">Save &amp; Print</button>' +
        (App.caps.pdf ? '<button type="button" id="b-savepdf">Save &amp; Download PDF</button>' : '') +
        '<button type="button" id="b-print" title="Opens the browser print dialog. Choose &quot;Save as PDF&quot; as the printer to get a PDF.">Print / Save as PDF</button></div>' +
      '</section><section class="preview-col"><div class="scaler" id="scaler"><div class="paper" id="preview"></div></div></section></div>' +
      '<datalist id="dl-products">' + App.catalogue.map((p) => '<option value="' + esc(p.name) + '">').join('') + '</datalist>' +
      '<datalist id="dl-units">' + ['PCS', 'NOS', 'KGS', 'MTR', 'BOX', 'SET', 'LTR', 'PKT', 'DOZ', 'PAIR'].map((u) => '<option value="' + u + '">').join('') + '</datalist>' +
      '<datalist id="dl-rates">' + rateList().map((r) => '<option value="' + esc(r) + '">').join('') + '</datalist>';
    bindEditor(); refresh(); fitPreview();
  }

  function refresh() {
    const inv = C.normalize(App.draft); const c = C.compute(inv);
    const pv = $('#preview'); if (pv) pv.innerHTML = window.InvoiceView.render(inv);
    App.draft.items.forEach((it, i) => {
      const el = $('[data-amt="' + i + '"]'); const a = C.lineAmount(C.normalize({ items: [it] }).items[0]);
      if (el) el.value = a === null ? '' : C.fmtMoney(a);
    });
    const t = $('#totals');
    if (t) {
      const row = (l, v, cls) => '<div>' + l + '</div><div class="num ' + (cls || '') + '">' + v + '</div>';
      t.innerHTML = row('Taxable value', C.fmtMoney(c.taxable)) +
        (c.intra ? row('CGST', C.fmtMoney(c.cgst)) + row('SGST', C.fmtMoney(c.sgst)) : row('IGST', C.fmtMoney(c.igst))) +
        row('Round-off', c.roundOff < 0 ? '(-)' + C.fmtMoney(-c.roundOff) : C.fmtMoney(c.roundOff)) +
        '<div class="grand">Invoice total</div><div class="num grand">₹ ' + C.fmtMoney(c.grand) + '</div>' +
        '<div class="hint" style="grid-column:1/-1">' + (c.intra ? 'Intra-state supply: CGST + SGST applied.' : 'Inter-state supply: IGST applied.') + '</div>';
    }
  }
  function fitPreview() {
    const col = $('.preview-col'); const sc = $('#scaler'); if (!col || !sc) return;
    const paperPx = 210 * 96 / 25.4;
    const z = Math.min(1, (col.clientWidth - 6) / paperPx);
    sc.style.zoom = z > 0 ? z : 1;
  }
  window.addEventListener('resize', fitPreview);

  function bindEditor() {
    view.oninput = (e) => {
      const t = e.target;
      if (t.dataset.f) {
        let v = t.value; if (t.dataset.f.endsWith('gstin')) v = v.toUpperCase();
        setPath(App.draft, t.dataset.f, v);
        if (t.dataset.f === 'buyer.stateCode') {
          const nm = C.stateByCode(v); App.draft.buyer.state = nm;
          if (!App.posManual) { App.draft.placeOfSupply = { state: nm, stateCode: v }; const sel = $('[data-f="placeOfSupply.stateCode"]'); if (sel) sel.value = v; }
        }
        if (t.dataset.f === 'placeOfSupply.stateCode') { App.draft.placeOfSupply.state = C.stateByCode(v); App.posManual = v !== App.draft.buyer.stateCode; }
        refresh();
      } else if (t.dataset.i !== undefined) { App.draft.items[+t.dataset.i][t.dataset.k] = t.value; refresh(); }
    };
    view.onchange = (e) => {
      const t = e.target;
      if (t.dataset.f === 'roundOff.mode') { $('#ro-manual').hidden = t.value !== 'manual'; refresh(); }
      if (t.dataset.k === 'description') { // picked a catalogue product -> fill the rest of the row
        const it = App.draft.items[+t.dataset.i];
        const p = App.catalogue.find((x) => x.name.toLowerCase() === t.value.trim().toLowerCase());
        if (p && !it.hsn && !it.rate) { Object.assign(it, { description: p.name, hsn: p.hsn, unit: p.unit, rate: p.rate, gstRate: p.gstRate }); $('#items').innerHTML = itemsHTML(); refresh(); }
      }
    };
    view.onclick = async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.del !== undefined) {
        const i = +t.dataset.del;
        if (App.draft.items.length === 1) App.draft.items[0] = blankItem(); else App.draft.items.splice(i, 1);
        $('#items').innerHTML = itemsHTML(); refresh();
      } else if (t.id === 'b-add') { App.draft.items.push(blankItem()); $('#items').innerHTML = itemsHTML(); refresh(); const l = $$('[data-k="description"]'); l[l.length - 1].focus(); }
      else if (t.id === 'b-sample') { App.draft.buyer = Object.assign({}, SAMPLE_BUYER); App.draft.placeOfSupply = { state: 'Jharkhand', stateCode: '20' }; App.posManual = false; App.draft.items = SAMPLE_ITEMS.map((x) => Object.assign({}, x)); renderEditor(); toast('Sample buyer and products loaded'); }
      else if (t.id === 'b-clear') { if (confirm('Clear everything on this form?')) { const n = App.draft.number; App.draft = newDraft(); App.draft.number = n; renderEditor(); } }
      else if (t.id === 'b-print') window.print();
      else if (t.id === 'b-save') { const r = await save(); if (r) go('/invoice/' + r.id); }
      else if (t.id === 'b-saveprint') { const r = await save(); if (r) go('/invoice/' + r.id + '/print'); }
      else if (t.id === 'b-savepdf') { const r = await save(); if (r) { go('/invoice/' + r.id); location.assign('/api/invoices/' + r.id + '/pdf'); } }
    };
    $('#errs').hidden = true;
  }

  async function save() {
    const box = $('#errs'); box.hidden = true;
    const inv = C.normalize(App.draft); const errs = C.validate(inv);
    if (errs.length) { box.innerHTML = errBox(errs); box.hidden = false; box.scrollIntoView({ block: 'nearest' }); return null; }
    const body = { invoice: inv, expectedGrand: C.compute(inv).grand };
    try {
      const r = App.editingId ? await api('PUT', '/api/invoices/' + App.editingId, body) : await api('POST', '/api/invoices', body);
      App.editingId = r.id; App.draft = r.data; toast('Saved invoice ' + r.number); return r;
    } catch (e) { box.innerHTML = errBox(e.errors); box.hidden = false; box.scrollIntoView({ block: 'nearest' }); return null; }
  }

  /* ------------------------------------------------------------ Saved invoice view */
  async function pageInvoice(id, mode) {
    const r = await api('GET', '/api/invoices/' + id);
    const bare = mode === 'pdf';
    view.innerHTML = (bare ? '' : '<div class="viewbar no-print"><a class="btn" href="#/invoices">&larr; Saved Invoices</a><span class="sp"></span>' +
      '<button id="v-edit">Edit</button><button id="v-dup">Duplicate</button>' +
      '<button class="primary" id="v-print" title="Opens the print dialog. Choose &quot;Save as PDF&quot; to get a PDF.">Print / Save as PDF</button>' +
      (App.caps.pdf ? '<a class="btn" href="/api/invoices/' + id + '/pdf">Download PDF</a>' : '') +
      '<button class="danger" id="v-del">Delete</button></div>') +
      '<div class="paper">' + window.InvoiceView.render(C.normalize(r.data)) + '</div>';
    if (bare) { document.body.dataset.ready = '1'; return; }
    $('#v-edit').onclick = () => go('/edit/' + id);
    $('#v-print').onclick = () => window.print();
    $('#v-dup').onclick = () => duplicate(r.data);
    $('#v-del').onclick = () => deleteInvoice(r.id, r.number, () => go('/invoices'));
    if (mode === 'print') { history.replaceState(null, '', '#/invoice/' + id); setTimeout(() => window.print(), 250); }
  }
  function duplicate(data) {
    const d = JSON.parse(JSON.stringify(data));
    Object.assign(d, snapshotParties()); d.number = ''; d.date = todayISO();
    d.declaration = App.settings.declaration; d.jurisdiction = App.settings.jurisdiction;
    ['orderDate', 'deliveryNoteDate', 'deliveryNote', 'despatchDocNo'].forEach((k) => { d.meta[k] = ''; });
    App.pending = d; go('/new'); toast('Duplicated into a new, unsaved invoice');
  }
  async function deleteInvoice(id, number, done) {
    if (!confirm('Delete invoice ' + number + ' permanently? This cannot be undone.')) return;
    try { await api('DELETE', '/api/invoices/' + id); toast('Invoice ' + number + ' deleted'); done(); } catch (e) { toast(e.message, true); }
  }

  /* ------------------------------------------------------------ Saved invoices list */
  async function pageList() {
    view.innerHTML = '<div class="page-wrap"><div class="bar"><h2>Saved Invoices</h2><input id="q" type="search" placeholder="Search invoice number or buyer" style="max-width:320px"></div><div id="list"></div></div>';
    const load = async () => {
      const rows = await api('GET', '/api/invoices?q=' + encodeURIComponent($('#q').value));
      $('#list').innerHTML = rows.length ? '<table class="list"><thead><tr><th>Invoice No.</th><th>Date</th><th>Buyer</th><th class="r">Tax</th><th class="r">Total</th><th></th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td><b>' + esc(r.number) + '</b></td><td>' + C.fmtDate(r.date) + '</td><td>' + esc(r.buyerName) + '</td><td class="r">' + C.fmtMoney(r.totalTax) + '</td><td class="r">₹ ' + C.fmtMoney(r.grand) + '</td>' +
          '<td class="acts" data-id="' + r.id + '" data-no="' + esc(r.number) + '"><button class="small" data-a="open">Open</button><button class="small" data-a="edit">Edit</button><button class="small" data-a="dup">Duplicate</button><button class="small" data-a="print">Print</button>' +
          (App.caps.pdf ? '<a class="btn small" style="padding:3px 8px;font-size:12px;margin-left:3px" href="/api/invoices/' + r.id + '/pdf">PDF</a>' : '') + '<button class="small danger" data-a="del">Delete</button></td></tr>').join('') + '</tbody></table>'
        : '<div class="empty">' + ($('#q').value ? 'No invoices match your search.' : 'No invoices saved yet. Create one from New Invoice.') + '</div>';
    };
    let tm; $('#q').oninput = () => { clearTimeout(tm); tm = setTimeout(load, 200); };
    $('#list').onclick = async (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const td = b.closest('td'); const id = td.dataset.id; const a = b.dataset.a;
      if (a === 'open') go('/invoice/' + id); else if (a === 'edit') go('/edit/' + id); else if (a === 'print') go('/invoice/' + id + '/print');
      else if (a === 'dup') { try { duplicate((await api('GET', '/api/invoices/' + id)).data); } catch (err) { toast(err.message, true); } }
      else if (a === 'del') deleteInvoice(id, td.dataset.no, load);
    };
    await load();
  }

  /* ------------------------------------------------------------ Catalogue */
  async function pageCatalogue() {
    App.catalogue = await api('GET', '/api/catalogue');
    let editId = null;
    const draw = () => {
      const p = App.catalogue.find((x) => x.id === editId) || { name: '', hsn: '', unit: 'PCS', rate: '', gstRate: App.settings.defaultGstRate };
      view.innerHTML = '<div class="page-wrap"><h2>Product Catalogue</h2><div class="panel"><h3>' + (editId ? 'Edit product' : 'Add product') + '</h3><div id="errs" class="errs" hidden></div>' +
        '<div class="row" style="align-items:flex-end"><label class="f" style="flex:3;min-width:200px"><span>Description</span><input id="p-name" value="' + esc(p.name) + '"></label>' +
        '<label class="f" style="flex:1;min-width:90px"><span>HSN/SAC</span><input id="p-hsn" maxlength="8" value="' + esc(p.hsn) + '"></label>' +
        '<label class="f" style="width:80px"><span>Unit</span><input id="p-unit" maxlength="10" value="' + esc(p.unit) + '"></label>' +
        '<label class="f" style="width:110px"><span>Default rate (&#8377;)</span><input id="p-rate" inputmode="decimal" value="' + esc(p.rate) + '"></label>' +
        '<label class="f" style="width:80px"><span>GST %</span><input id="p-gst" inputmode="decimal" value="' + esc(p.gstRate) + '"></label>' +
        '<button class="primary" id="p-save">' + (editId ? 'Update' : 'Add') + '</button>' + (editId ? '<button id="p-cancel">Cancel</button>' : '') + '</div></div>' +
        (App.catalogue.length ? '<table class="list"><thead><tr><th>Description</th><th>HSN/SAC</th><th>Unit</th><th class="r">Rate</th><th class="r">GST %</th><th></th></tr></thead><tbody>' +
          App.catalogue.map((x) => '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.hsn) + '</td><td>' + esc(x.unit) + '</td><td class="r">' + esc(x.rate) + '</td><td class="r">' + esc(x.gstRate) + '</td><td class="acts" data-id="' + x.id + '"><button class="small" data-a="edit">Edit</button><button class="small danger" data-a="del">Delete</button></td></tr>').join('') + '</tbody></table>'
          : '<div class="empty">No products yet. Add the items you sell often; they will autocomplete on the invoice form.</div>') + '</div>';
      $('#p-save').onclick = async () => {
        const body = { name: $('#p-name').value, hsn: $('#p-hsn').value, unit: $('#p-unit').value, rate: $('#p-rate').value, gstRate: $('#p-gst').value };
        try { if (editId) await api('PUT', '/api/catalogue/' + editId, body); else await api('POST', '/api/catalogue', body); editId = null; App.catalogue = await api('GET', '/api/catalogue'); draw(); toast('Product saved'); }
        catch (e) { const b = $('#errs'); b.innerHTML = errBox(e.errors); b.hidden = false; }
      };
      if ($('#p-cancel')) $('#p-cancel').onclick = () => { editId = null; draw(); };
      $$('td.acts').forEach((td) => { td.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b) return; const id = +td.dataset.id;
        if (b.dataset.a === 'edit') { editId = id; draw(); window.scrollTo(0, 0); }
        else if (confirm('Delete this product from the catalogue?')) { try { await api('DELETE', '/api/catalogue/' + id); App.catalogue = await api('GET', '/api/catalogue'); editId = null; draw(); toast('Product deleted'); } catch (er) { toast(er.message, true); } }
      }; });
    };
    draw();
  }

  /* ------------------------------------------------------------ Company settings */
  function pageSettings() {
    const s = App.settings;
    const f = (id, label, val, attrs, cls) => '<label class="f ' + (cls || '') + '"><span>' + label + '</span><input id="s-' + id + '" value="' + esc(val) + '" ' + (attrs || '') + '></label>';
    view.innerHTML = '<div class="page-wrap narrow"><h2>Company Settings</h2>' +
      '<div class="notice">Your sample invoice carries the historical wording <b>' + esc(s.companyName) + '</b>. It is kept as given; please verify the current legal name, GSTIN and state before issuing real invoices.</div>' +
      '<div id="errs" class="errs" hidden></div>' +
      '<div class="panel"><h3>Seller details</h3><div class="grid2">' + f('companyName', 'Company name', s.companyName, '', 'span2') +
        '<label class="f span2"><span>Address (one line per row on the invoice)</span><textarea id="s-address" rows="2">' + esc(s.address) + '</textarea></label>' +
        f('phone', 'Phone', s.phone) + f('email', 'E-mail', s.email) + f('gstin', 'GSTIN/UIN', s.gstin, 'maxlength="15" style="text-transform:uppercase"') +
        '<label class="f"><span>State</span><select id="s-stateCode">' + stateOptions(s.stateCode) + '</select></label></div></div>' +
      '<div class="panel"><h3>Bank details</h3><div class="grid2">' + f('bankName', 'Bank name', s.bankName) + f('accountNo', 'A/c No.', s.accountNo) + f('branch', 'Branch', s.branch) + f('ifsc', 'IFS code', s.ifsc, 'style="text-transform:uppercase"') + '</div></div>' +
      '<div class="panel"><h3>Invoice text</h3><div class="grid2"><label class="f span2"><span>Declaration</span><textarea id="s-declaration" rows="2">' + esc(s.declaration) + '</textarea></label>' + f('jurisdiction', 'Jurisdiction line (footer)', s.jurisdiction, '', 'span2') + '</div></div>' +
      '<div class="panel"><h3>GST rates</h3><div class="grid2">' + f('defaultGstRate', 'Default GST rate % (total; split equally into CGST + SGST)', s.defaultGstRate) + f('ratePresets', 'Rate suggestions (comma separated)', s.ratePresets) + '</div></div>' +
      '<div class="panel"><h3>Invoice numbering</h3><div class="grid3">' + f('prefix', 'Prefix (optional)', s.prefix, 'maxlength="10"') + f('nextNumber', 'Next number', s.nextNumber, 'inputmode="numeric"') + f('padding', 'Pad to digits (0 = none)', s.padding, 'inputmode="numeric"') + '</div>' +
        '<div class="hint" style="margin-top:6px">Next invoice will be numbered <b id="s-preview"></b>. Numbers already used are always skipped, so duplicates cannot happen.</div></div>' +
      '<div><button class="primary" id="s-save">Save settings</button> <span class="hint">Changes apply to new invoices only. Saved invoices keep the details they were issued with.</span></div></div>';
    const prev = () => { const n = parseInt($('#s-nextNumber').value, 10) || 1; const p = parseInt($('#s-padding').value, 10) || 0; $('#s-preview').textContent = $('#s-prefix').value + String(n).padStart(Math.min(Math.max(p, 0), 8), '0'); };
    ['prefix', 'nextNumber', 'padding'].forEach((k) => { $('#s-' + k).oninput = prev; }); prev();
    $('#s-save').onclick = async () => {
      const body = {}; ['companyName', 'address', 'phone', 'email', 'gstin', 'stateCode', 'bankName', 'accountNo', 'branch', 'ifsc', 'declaration', 'jurisdiction', 'defaultGstRate', 'ratePresets', 'prefix', 'nextNumber', 'padding'].forEach((k) => { body[k] = $('#s-' + k).value; });
      try { App.settings = await api('PUT', '/api/settings', body); toast('Settings saved'); pageSettings(); }
      catch (e) { const b = $('#errs'); b.innerHTML = errBox(e.errors); b.hidden = false; window.scrollTo(0, 0); }
    };
  }

  /* ------------------------------------------------------------ router */
  async function route() {
    const parts = (location.hash.slice(1) || '/new').split('/').filter(Boolean);
    const page = parts[0] || 'new';
    document.body.dataset.ready = '0';
    document.body.classList.toggle('bare', page === 'pdf');
    $$('.topbar a').forEach((a) => a.classList.toggle('on', a.dataset.nav === (page === 'edit' || page === 'invoice' ? (page === 'edit' ? 'new' : 'invoices') : page)));
    try {
      if (!App.settings) await loadBase();
      if (page === 'new') await pageEditor(null);
      else if (page === 'edit') await pageEditor(parts[1]);
      else if (page === 'invoices') await pageList();
      else if (page === 'invoice') await pageInvoice(parts[1], parts[2]);
      else if (page === 'pdf') await pageInvoice(parts[1], 'pdf');
      else if (page === 'catalogue') await pageCatalogue();
      else if (page === 'settings') pageSettings();
      else go('/new');
    } catch (e) {
      view.innerHTML = '<div class="page-wrap narrow"><div class="errs">' + errBox(e.errors || [e.message]) + '</div></div>';
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  $$('.topbar a').forEach((a) => a.addEventListener('click', () => { if (location.hash === a.getAttribute('href')) route(); }));
  route();
})();
