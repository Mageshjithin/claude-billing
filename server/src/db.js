import { promises as fs } from 'node:fs';
import pg from 'pg';

// Data lives in Neon Postgres as a single JSON document (products + bills).
// TLS is verified: use a DATABASE_URL with ?sslmode=require (Neon provides this).
// Deployed Vercel functions have a read-only filesystem, so local files cannot be used.
const empty = () => ({ products: [], bills: [] });
const seedFile = new URL('../data/db.json', import.meta.url);

let pool;
const getPool = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Connect the Neon integration.');
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
};

let ready;
function ensureSchema() {
  ready ??= (async () => {
    const db = getPool();
    await db.query('CREATE TABLE IF NOT EXISTS app_data (id INT PRIMARY KEY, data JSONB NOT NULL)');
    let seed = empty();
    try {
      seed = { ...seed, ...JSON.parse(await fs.readFile(seedFile, 'utf8')) };
    } catch {
      // No local seed file available (e.g. in production); start empty.
    }
    await db.query('INSERT INTO app_data (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(seed)]);
  })().catch((error) => { ready = undefined; throw error; });
  return ready;
}

// Returns the current data. Callers must treat it as read-only; use transaction() to change it.
export async function loadData() {
  await ensureSchema();
  const { rows } = await getPool().query('SELECT data FROM app_data WHERE id = 1');
  return { ...empty(), ...rows[0]?.data };
}

// Runs fn against the data inside a locked Postgres transaction. If fn throws,
// the transaction rolls back, so partial changes (e.g. stock already reduced) are discarded.
export async function transaction(fn) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT data FROM app_data WHERE id = 1 FOR UPDATE');
    const draft = { ...empty(), ...rows[0]?.data };
    const result = await fn(draft);
    await client.query('UPDATE app_data SET data = $1 WHERE id = 1', [JSON.stringify(draft)]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const httpError = (status, message) => Object.assign(new Error(message), { status });
