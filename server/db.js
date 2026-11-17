import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function openDatabase(directory = process.env.DATA_DIR || './data') {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'cumple.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, subject TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES rooms(code), game INTEGER NOT NULL, kind TEXT NOT NULL, bytes BLOB NOT NULL);
  `);
  return db;
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
