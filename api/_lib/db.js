// Database access. In production this talks to Postgres (Neon, through Vercel).
// Tests and local dev plug in an in-memory Postgres with setDb().

import { neon } from '@neondatabase/serverless';

let db = null;
let schemaReady = null;

/** Use a custom database (tests, local dev). It must have query(text, params) → rows. */
export function setDb(custom) {
  db = custom;
  schemaReady = null;
}

function connect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    const err = new Error('No database configured. Set DATABASE_URL.');
    err.status = 503;
    throw err;
  }
  const sql = neon(url);
  return { query: (text, params = []) => sql.query(text, params) };
}

// Tables are created on first use, so a fresh database needs no manual setup.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     email text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS projects (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name text NOT NULL,
     data jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS projects_by_user ON projects (user_id, updated_at DESC)`,
  // One row per counted event (a failed login, a reset email), used to slow down attackers.
  `CREATE TABLE IF NOT EXISTS rate_limits (
     key text NOT NULL,
     at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS rate_limits_by_key ON rate_limits (key, at)`,
  `CREATE TABLE IF NOT EXISTS password_resets (
     token_hash text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at timestamptz NOT NULL,
     used_at timestamptz
   )`,
];

/** Run a query and return the rows. */
export async function query(text, params = []) {
  if (!db) db = connect();
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of SCHEMA) await db.query(statement);
    })().catch((err) => {
      schemaReady = null; // try again on the next request
      throw err;
    });
  }
  await schemaReady;
  return db.query(text, params);
}
