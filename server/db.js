import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {config} from './config.js';

export function openDb() {
  fs.mkdirSync(path.join(config.dataDir, 'receipts'), {recursive: true, mode: 0o700});
  const db = new DatabaseSync(path.join(config.dataDir, 'events.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      time_label TEXT NOT NULL DEFAULT 'ساعت ۱۴:۰۰',
      capacity INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_code TEXT NOT NULL UNIQUE,
      submit_token TEXT NOT NULL UNIQUE,
      session_id INTEGER NOT NULL REFERENCES sessions(id),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      receipt_file TEXT NOT NULL,
      receipt_mime TEXT NOT NULL,
      receipt_size INTEGER NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      reject_reason TEXT,
      reviewed_at TEXT,
      reviewed_by TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- One live (pending/approved) registration per mobile per day, and one live use of each receipt image.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_reg_mobile_session ON registrations(mobile, session_id) WHERE status <> 'rejected';
    CREATE UNIQUE INDEX IF NOT EXISTS ux_reg_receipt ON registrations(receipt_sha256) WHERE status <> 'rejected';
    CREATE INDEX IF NOT EXISTS ix_reg_status ON registrations(status, created_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (db.prepare('SELECT COUNT(*) c FROM sessions').get().c === 0) {
    const ins = db.prepare('INSERT INTO sessions (title, time_label, sort_order) VALUES (?,?,?)');
    ['۲۳ آبان', '۲۴ آبان', '۲۵ آبان'].forEach((t, i) => ins.run(t, 'ساعت ۱۴:۰۰', i + 1));
  }
  return db;
}

export function getSettings(db) {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  return {
    feeToman: Number.parseInt(rows.fee_toman, 10) || config.feeToman,
    registeredBase: rows.registered_base != null ? Number.parseInt(rows.registered_base, 10) || 0 : config.registeredBase,
    cardNumber: (rows.card_number ?? config.paymentCardNumber).replace(/\D/g, ''),
    cardHolder: rows.card_holder ?? config.paymentCardHolder,
  };
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
