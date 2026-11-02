# GST Invoice Generator

Tally-style GST tax invoice (A4) with live calculation, saved invoices, product catalogue and company settings.
No external packages needed: Node.js backend + built-in SQLite database.

## Run
Needs **Node.js 22.13 or newer** (https://nodejs.org).

    cd gst-invoice
    npm start                # or:  node --no-warnings server.js

Open http://localhost:3000 — it opens directly on **New Invoice**.
Options: `PORT=4000 npm start`, `DB_FILE=/path/to/invoices.db npm start`.
Your data lives in `data/invoices.db`. **Back this file up** (copy it while the app is stopped).

## Printing / PDF
* **Print / Save as PDF** uses the browser print dialog (A4 is preset, margins 8 mm, only the invoice prints).
  Choose "Save as PDF" as the printer to get a PDF file.
* Optional one-click **Download PDF** button: run `npm install playwright && npx playwright install chromium`
  once in this folder and restart. The button appears automatically when it is available.

## How the numbers work
* All money maths is exact (integer paise / BigInt), identical in browser and server (`public/calc.js`).
* Line amount = quantity x rate (qty up to 3 decimals, rate up to 4), rounded half-up to paise.
* GST is calculated per HSN + rate group on the taxable value: intra-state = CGST + SGST (half rate each),
  inter-state (place of supply state differs from seller state) = IGST. Per-row GST % is editable.
* Round-off: automatic to the nearest rupee, or manual (between -1.00 and +1.00).
* Each saved invoice stores a full snapshot (seller, buyer, bank, rows, rates, declaration), so later changes
  in Company Settings never alter old invoices. Editing an invoice edits that snapshot only.
* Invoice numbers are unique (enforced by the database, case-insensitive). Set prefix / next number / padding in Company Settings.

## Tests
    npm test            # calculation + API tests (sample invoice figures, numbering, duplicates, snapshots, persistence)

## Files
    server.js  db.js            backend + SQLite
    public/calc.js              shared calculation + validation
    public/invoice.js           invoice HTML (the exact reference layout)
    public/sheet.css            invoice + print stylesheet
    public/app.js, app.css      the application pages

Note: this app has no login; run it on your own computer / trusted network only.
