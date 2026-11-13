import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Neon / Vercel Postgres give DATABASE_URL. Neon needs SSL.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

let ready = null;
export function ensureSchema() {
  if (!ready) {
    const sql = readFileSync(join(here, "..", "schema.sql"), "utf8");
    ready = pool.query(sql);
  }
  return ready;
}

export async function q(text, params = []) {
  await ensureSchema();
  return pool.query(text, params);
}
