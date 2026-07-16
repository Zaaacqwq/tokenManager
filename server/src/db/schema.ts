import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/token_manager.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key TEXT,
      org_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      input_price_per_m REAL NOT NULL DEFAULT 0,
      output_price_per_m REAL NOT NULL DEFAULT 0,
      cache_input_price_per_m REAL DEFAULT 0,
      cache_output_price_per_m REAL DEFAULT 0,
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL,
      model_id INTEGER,
      source TEXT NOT NULL,
      session_id TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_input_tokens INTEGER DEFAULT 0,
      cache_output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      is_error INTEGER DEFAULT 0,
      recorded_at TEXT NOT NULL,
      synced_at TEXT DEFAULT (datetime('now')),
      raw_data TEXT,
      FOREIGN KEY (provider_id) REFERENCES providers(id),
      FOREIGN KEY (model_id) REFERENCES models(id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      source TEXT PRIMARY KEY,
      last_offset INTEGER DEFAULT 0,
      last_timestamp TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_usage_recorded_at ON usage_records(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_records(provider_id);
    CREATE INDEX IF NOT EXISTS idx_usage_source ON usage_records(source);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model_id);
  `);

  // Migration: exact-dedup key for collectors that have stable per-record IDs
  // (multi-machine sources can't rely on a shared timestamp watermark).
  const cols = db.prepare('PRAGMA table_info(usage_records)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'external_id')) {
    db.exec('ALTER TABLE usage_records ADD COLUMN external_id TEXT');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_external
      ON usage_records(source, external_id) WHERE external_id IS NOT NULL
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
