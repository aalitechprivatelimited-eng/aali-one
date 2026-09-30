// One tiny database layer: real PostgreSQL (Neon / VPS) when DATABASE_URL is set, otherwise
// an in-process PGlite database for local development and tests.
import { SCHEMA } from './schema.js';
let dbPromise = null;

async function open() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } });
    const db = {
      query: (text, params) => pool.query(text, params),
      async tx(fn) {
        const c = await pool.connect();
        try { await c.query('begin'); const r = await fn({ query: (t, p) => c.query(t, p) }); await c.query('commit'); return r; }
        catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
      },
    };
    await pool.query(SCHEMA);
    return db;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(process.env.PGLITE_DIR || '.devdb'); // tests use memory://
  await lite.exec(SCHEMA);
  return {
    query: (text, params) => lite.query(text, params),
    tx: (fn) => lite.transaction((t) => fn({ query: (q, p) => t.query(q, p) })),
  };
}
export const getDb = () => (dbPromise ??= open());
