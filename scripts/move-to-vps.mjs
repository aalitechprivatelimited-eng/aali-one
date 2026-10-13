// Moves Aali One's data from Neon (today's live database) to the new database on the VPS (Hostinger + Coolify).
// Neon is only read (a read-only transaction), so the live site is never changed by this. The VPS database must be empty – a
// second run refuses unless --replace is given (then the VPS copy is emptied and filled again, e.g. for the final move).
// Sign-in sessions are not copied: everyone signs in once on the new address with their usual password.
//
// usage (from this computer, while the VPS database is reachable – Coolify → the database → "Make it publicly available"):
//   node scripts/move-to-vps.mjs [--replace]
// It reads DATABASE_URL (the live Neon database) and VPS_DATABASE_URL (the VPS database's public address) from .env.local, which
// stays on this computer – the addresses hold passwords, so they are typed there, never sent in chat. FROM_URL / TO_URL override them.
// Turn the database's public access off again afterwards.
import fs from 'node:fs';
import pg from 'pg';
import { SCHEMA } from '../server/schema.js';

const local = fs.existsSync(new URL('../.env.local', import.meta.url)) ? fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8') : '';
const read = (k) => ((local.match(new RegExp(`^${k}="?([^"\\n]+)`, 'm')) || [])[1] || '').trim();
const fromUrl = process.env.FROM_URL || read('DATABASE_URL'), toUrl = (process.env.TO_URL || read('VPS_DATABASE_URL')).trim();
if (!fromUrl || !toUrl) throw new Error('Put VPS_DATABASE_URL="postgres://…" (the VPS database\'s public address) in .env.local, next to DATABASE_URL.');
const clean = (u) => { const x = new URL(u); for (const k of ['sslmode', 'channel_binding']) x.searchParams.delete(k); return x; };
const from = clean(fromUrl), to = clean(toUrl);
if (from.host === to.host && from.pathname === to.pathname) throw new Error('FROM and TO are the same database.');
// The copy carries every password hash, salary and file: it travels encrypted, or through an SSH tunnel to this computer (127.0.0.1).
// sslmode=disable to any other address is refused (security review 10 Oct 2026; see VPS-SETUP.md).
const localTo = /^(localhost|127\.0\.0\.1)$/.test(to.hostname);
if (/sslmode=disable/.test(toUrl) && !localTo) throw new Error('Refusing to copy without encryption over the internet. Open an SSH tunnel and use 127.0.0.1 (VPS-SETUP.md), or remove sslmode=disable.');
const plainTo = localTo;
const src = new pg.Client({ connectionString: from.toString(), ssl: { rejectUnauthorized: true } });
const dst = new pg.Client({ connectionString: to.toString(), ssl: plainTo ? false : { rejectUnauthorized: process.env.DB_SSL_NO_VERIFY !== '1' } });
const TABLES = ['users', 'settings', 'counters', 'records', 'files', 'audit']; // in this order; sessions and the WhatsApp outbox are not copied
await src.connect(); await dst.connect();
try {
  await src.query('begin read only');
  await dst.query(SCHEMA);
  const have = (await dst.query('select count(*)::int as n from users')).rows[0].n;
  if (have && !process.argv.includes('--replace')) throw new Error(`The VPS database already has ${have} people. Run again with --replace to empty it and copy afresh.`);
  await dst.query('begin');
  await dst.query(`truncate ${['sessions', 'outbox', ...TABLES].join(', ')} restart identity cascade`);
  const counts = {};
  for (const table of TABLES) {
    const { rows, fields } = await src.query(`select * from ${table}`);
    const cols = fields.map((f) => f.name), json = new Set(fields.filter((f) => f.dataTypeID === 3802 || f.dataTypeID === 114).map((f) => f.name)); // jsonb / json go as text
    for (let i = 0; i < rows.length; i += 100) {
      const part = rows.slice(i, i + 100), vals = [];
      const sql = part.map((r, j) => `(${cols.map((c, k) => { vals.push(json.has(c) && r[c] != null ? JSON.stringify(r[c]) : r[c]); return `$${j * cols.length + k + 1}`; }).join(', ')})`).join(', ');
      await dst.query(`insert into ${table} (${cols.join(', ')}) values ${sql}`, vals);
    }
    counts[table] = rows.length;
  }
  await dst.query("select setval(pg_get_serial_sequence('audit', 'id'), coalesce((select max(id) from audit), 1))");
  // Check: every table has as many rows on the VPS as on Neon.
  for (const table of TABLES) { const n = (await dst.query(`select count(*)::int as n from ${table}`)).rows[0].n; if (n !== counts[table]) throw new Error(`${table}: ${counts[table]} read but ${n} written.`); }
  await dst.query('commit'); await src.query('rollback');
  for (const table of TABLES) console.log(`${table}: ${counts[table]} copied`);
  console.log('Done. Aali One on the VPS now has the live data. Turn the database\'s public access off again in Coolify.');
} catch (e) { await dst.query('rollback').catch(() => {}); await src.query('rollback').catch(() => {}); console.error('Stopped, nothing was kept on the VPS:', e.message); process.exitCode = 1; }
finally { await src.end(); await dst.end(); }
