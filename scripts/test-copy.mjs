// Fills the TEST SITE's database (aali_test, on the same Neon server) with a copy of the live data, so new features can be
// tried on real work without touching the live site. Run it again any time to start the test copy afresh.
// The live database is only read (a read-only transaction); this script refuses to write anywhere but a database named aali_test.
// Sign-in sessions are not copied: everyone signs in again on the test site with their usual password.
// usage: node scripts/test-copy.mjs        (the live address is read from .env.local)
import fs from 'node:fs';
import pg from 'pg';
import { SCHEMA } from '../server/schema.js';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const live = new URL(((env.match(/^DATABASE_URL="?([^"\n]+)/m) || [])[1] || '').trim());
for (const k of ['sslmode', 'channel_binding']) live.searchParams.delete(k);
const test = new URL(live); test.pathname = '/aali_test';
if (live.pathname === test.pathname || test.pathname !== '/aali_test') throw new Error('The test copy must go to the aali_test database, and never to the live one.');

const ssl = { rejectUnauthorized: true }, from = new pg.Client({ connectionString: live.toString(), ssl }), to = new pg.Client({ connectionString: test.toString(), ssl });
await from.connect(); await to.connect();
const TABLES = ['users', 'settings', 'counters', 'records', 'files', 'audit']; // in this order (sessions are left out on purpose)
try {
  await from.query('begin read only');
  await to.query(SCHEMA);
  await to.query('begin');
  await to.query(`truncate ${['sessions', ...TABLES].join(', ')} restart identity cascade`);
  for (const table of TABLES) {
    const { rows, fields } = await from.query(`select * from ${table}`);
    const cols = fields.map((f) => f.name), json = new Set(fields.filter((f) => f.dataTypeID === 3802 || f.dataTypeID === 114).map((f) => f.name)); // jsonb / json go back as text
    for (let i = 0; i < rows.length; i += 100) {
      const part = rows.slice(i, i + 100), vals = [];
      const sql = part.map((r, j) => `(${cols.map((c, k) => { vals.push(json.has(c) && r[c] != null ? JSON.stringify(r[c]) : r[c]); return `$${j * cols.length + k + 1}`; }).join(', ')})`).join(', ');
      await to.query(`insert into ${table} (${cols.join(', ')}) values ${sql}`, vals);
    }
    console.log(`${table}: ${rows.length} copied`);
  }
  await to.query("select setval(pg_get_serial_sequence('audit', 'id'), coalesce((select max(id) from audit), 1))");
  await to.query('commit'); await from.query('rollback');
  console.log('The test copy is ready.');
} catch (e) { await to.query('rollback').catch(() => {}); await from.query('rollback').catch(() => {}); console.error('Copy stopped, nothing was kept:', e.message); process.exitCode = 1; }
finally { await from.end(); await to.end(); }
