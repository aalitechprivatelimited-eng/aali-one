// One tiny database layer: real PostgreSQL (Neon / VPS) when DATABASE_URL is set, otherwise
// an in-process PGlite database for local development and tests.
import { SCHEMA } from './schema.js';
let dbPromise = null;

async function open() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { default: pg } = await import('pg');
    // The database's certificate is checked, so nobody in between can pose as the database.
    // (Set DB_SSL_NO_VERIFY=1 only for a private server that uses a certificate it made itself.)
    // No encryption only for a database on this same machine, or when the address says sslmode=disable (a private network). The host is read
    // from the address itself – "localhost" inside a password or a query no longer switches encryption off (security review 10 Oct 2026).
    let host = ''; try { host = new URL(url).hostname; } catch { /* the driver reports a bad address */ }
    const plain = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || /[?&]sslmode=disable(&|$)/.test(url), address = url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
    const pool = new pg.Pool({ connectionString: address, max: 3, ssl: plain ? false : { rejectUnauthorized: process.env.DB_SSL_NO_VERIFY !== '1' } });
    // A connection the database drops while idle (a restart, the pooler) is reported here instead of stopping the whole server.
    pool.on('error', (e) => console.error('database connection dropped:', e.message));
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
// A first connection that fails is not kept: the next request tries again (it used to stay broken until a restart).
export const getDb = () => (dbPromise ??= open().catch((e) => { dbPromise = null; throw e; }));
