'use strict';
const fs = require('fs');
const path = require('path');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {
  console.error('This app needs Node.js 22.13 or newer (built-in SQLite). Current: ' + process.version);
  process.exit(1);
}

const DEFAULT_SETTINGS = {
  companyName: 'Casanova Inc. (2022-2023)',
  address: '29, 2nd Floor, Chauhan Arcade,\nLalji-Hirji Road, Ranchi',
  phone: '2200707',
  gstin: '20AAZPK7528G1ZF',
  state: 'Jharkhand',
  stateCode: '20',
  email: 'casanovaranichi@yahoo.com',
  bankName: 'Union Bank of India',
  accountNo: '047811100000247',
  branch: 'Ranchi',
  ifsc: 'UBIN0804789',
  declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  jurisdiction: 'SUBJECT TO RANCHI JURISDICTION',
  defaultGstRate: '18',
  ratePresets: '0, 5, 12, 18, 28',
  prefix: '',
  nextNumber: 1,
  padding: 0
};

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS catalogue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, hsn TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'PCS', rate TEXT NOT NULL DEFAULT '0', gst_rate TEXT NOT NULL DEFAULT '18');
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL COLLATE NOCASE UNIQUE,
      date TEXT NOT NULL, buyer_name TEXT NOT NULL,
      grand INTEGER NOT NULL, total_tax INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
  `);
  return db;
}

module.exports = { open, DEFAULT_SETTINGS };
