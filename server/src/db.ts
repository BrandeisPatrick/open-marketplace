import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { config } from './config.js';
import { seedDatabase } from './marketplace/seed.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('buyer', 'seller')),
  api_token   TEXT UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,
  seller_id     TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  currency      TEXT NOT NULL DEFAULT 'USD',
  stock         INTEGER NOT NULL CHECK (stock >= 0),
  category      TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '[]',
  emoji         TEXT NOT NULL DEFAULT '📦',
  rating        REAL NOT NULL DEFAULT 0,
  review_count  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS cart_items (
  buyer_id    TEXT NOT NULL REFERENCES users(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (buyer_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  buyer_id          TEXT NOT NULL REFERENCES users(id),
  seller_id         TEXT NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL CHECK (status IN ('placed', 'shipped', 'delivered', 'cancelled')),
  subtotal_cents    INTEGER NOT NULL,
  shipping_cents    INTEGER NOT NULL,
  total_cents       INTEGER NOT NULL,
  shipping_address  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);

CREATE TABLE IF NOT EXISTS order_items (
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        TEXT NOT NULL,
  title             TEXT NOT NULL,
  emoji             TEXT NOT NULL,
  unit_price_cents  INTEGER NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS conversations (
  id                  TEXT PRIMARY KEY,
  actor_id            TEXT NOT NULL REFERENCES users(id),
  role                TEXT NOT NULL CHECK (role IN ('buyer', 'seller')),
  messages            TEXT NOT NULL DEFAULT '[]',
  prompt_fingerprint  TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_actor ON conversations(actor_id, role);
`;

let current: DatabaseSync | null = null;
const statementCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

/** Opens (creating the parent directory if needed), applies the schema and seeds on first run. */
export function openDatabase(file: string = config.dbPath): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  seedDatabase(db);
  return db;
}

/** Additive migrations for databases created by earlier versions of this schema. */
function migrate(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'prompt_fingerprint')) {
    db.exec('ALTER TABLE conversations ADD COLUMN prompt_fingerprint TEXT');
  }
}

export function getDb(): DatabaseSync {
  current ??= openDatabase();
  return current;
}

/** Closes and reopens the database (tests use this with `:memory:` for a fresh seeded store). */
export function resetDb(file: string = config.dbPath): DatabaseSync {
  closeDb();
  current = openDatabase(file);
  return current;
}

export function closeDb(): void {
  if (current?.isOpen) current.close();
  current = null;
}

function prepared(sql: string): StatementSync {
  const db = getDb();
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return prepared(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return prepared(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]): number {
  return Number(prepared(sql).run(...params).changes);
}

/** Runs `fn` atomically. Nested calls join the outer transaction. */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}
