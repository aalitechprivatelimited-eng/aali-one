// Moves Aali One's data from Neon (today's live database) to the new database on the VPS (Hostinger + Coolify).
// Neon is only read (a read-only transaction), so the live site is never changed by this. The VPS database must be empty – a
// second run refuses unless --replace is given (then the VPS copy is emptied and filled again, e.g. for the final move).
// Sign-in sessions are not copied: everyone signs in once on the new address with their usual password.
//
// usage, the easy way (15 Oct 2026) – inside the server, from Coolify → the app → Terminal:
//   node scripts/move-to-vps.mjs --here [--replace]
// It copies from FROM_URL (the Neon address, added for the copy as a secret setting of the app in Coolify, removed afterwards) into the
// app's own DATABASE_URL. The two databases talk over the internet encrypted (Neon) and over Coolify's private network (the VPS one).
// usage from this computer (through an SSH tunnel, see VPS-SETUP.md): node scripts/move-to-vps.mjs [--replace]
// It reads DATABASE_URL (the live Neon database) and VPS_DATABASE_URL from .env.local, which stays on this computer – the addresses
// hold passwords, so they are typed there, never sent in chat. FROM_URL / TO_URL override them.
import fs from 'node:fs';
import pg from 'pg';
import { SCHEMA } from '../server/schema.js';

const local = fs.existsSync(new URL('../.env.local', import.meta.url)) ? fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8') : '';
const read = (k) => ((local.match(new RegExp(`^${k}="?([^"\\n]+)`, 'm')) || [])[1] || '').trim();
const here = process.argv.includes('--here'); // running inside the server: the target is the app's own database
const fromUrl = (process.env.FROM_URL || (here ? '' : read('DATABASE_URL'))).trim(), toUrl = (process.env.TO_URL || (here ? process.env.DATABASE_URL : read('VPS_DATABASE_URL')) || '').trim();
if (!fromUrl || !toUrl) throw new Error(here ? 'Add FROM_URL (the Neon address) to the app\'s settings in Coolify, restart the app, and run this again.'
  : 'Put VPS_DATABASE_URL="postgres://…" (the VPS database\'s address) in .env.local, next to DATABASE_URL.');
const clean = (u) => { const x = new URL(u); for (const k of ['sslmode', 'channel_binding']) x.searchParams.delete(k); return x; };
const from = clean(fromUrl), to = clean(toUrl);
if (from.host === to.host && from.pathname === to.pathname) throw new Error('FROM and TO are the same database.');
// The copy carries every password hash, salary and file: it travels encrypted, or through an SSH tunnel to this computer (127.0.0.1).
// sslmode=disable to any other address is refused (security review 10 Oct 2026; see VPS-SETUP.md).
// A one-word host name is Coolify's private network inside the VPS (the app's own database), which never crosses the internet.
const localTo = /^(localhost|127\.0\.0\.1)$/.test(to.hostname) || !to.hostname.includes('.');
if (/sslmode=disable/.test(toUrl) && !localTo) throw new Error('Refusing to copy without encryption over the internet. Run it inside the server (--here) or through an SSH tunnel (VPS-SETUP.md).');
const plainTo = localTo;
const src = new pg.Client({ connectionString: from.toString(), ssl: { rejectUnauthorized: true } });
const dst = new pg.Client({ connectionString: to.toString(), ssl: plainTo ? false : { rejectUnauthorized: process.env.DB_SSL_NO_VERIFY !== '1' } });
const TABLES = ['users', 'settings', 'counters', 'records', 'files', 'audit']; // in this order; sessions and the WhatsApp outbox are not copied
src.on('error', (e) => console.error('Neon connection:', e.message)); dst.on('error', (e) => console.error('VPS database connection:', e.message));
// 1. Read everything from Neon in one short read-only transaction, then let Neon go (a connection kept open while writing was dropped).
await src.connect();
const data = {};
try {
  await src.query('begin read only');
  for (const table of TABLES) {
    if (table === 'files') { // the stored files are big: read a few at a time (one 58 MB answer was dropped on the way, 15 Oct 2026)
      const ids = (await src.query('select id from files order by id')).rows.map((r) => r.id), rows = [], { fields } = await src.query('select * from files limit 0');
      for (let i = 0; i < ids.length; i += 5) rows.push(...(await src.query('select * from files where id = any($1) order by id', [ids.slice(i, i + 5)])).rows);
      data[table] = { rows, fields };
    } else data[table] = await src.query(`select * from ${table}`);
    console.log(`read ${table}: ${data[table].rows.length}`);
  }
  await src.query('rollback');
} finally { await src.end().catch(() => {}); }
// 2. Write it all into the VPS database in one transaction: either everything arrives, or nothing does.
await dst.connect();
try {
  await dst.query(SCHEMA);
  const have = (await dst.query('select count(*)::int as n from users')).rows[0].n;
  if (have && !process.argv.includes('--replace')) throw new Error(`The VPS database already has ${have} people. Run again with --replace to empty it and copy afresh.`);
  await dst.query('begin');
  await dst.query(`truncate ${['sessions', 'outbox', ...TABLES].join(', ')} restart identity cascade`);
  const counts = {};
  for (const table of TABLES) {
    const { rows, fields } = data[table];
    const cols = fields.map((f) => f.name), json = new Set(fields.filter((f) => f.dataTypeID === 3802 || f.dataTypeID === 114).map((f) => f.name)); // jsonb / json go as text
    const step = table === 'files' ? 5 : 100; // files are big: a few at a time
    for (let i = 0; i < rows.length; i += step) {
      const part = rows.slice(i, i + step), vals = [];
      const sql = part.map((r, j) => `(${cols.map((c, k) => { vals.push(json.has(c) && r[c] != null ? JSON.stringify(r[c]) : r[c]); return `$${j * cols.length + k + 1}`; }).join(', ')})`).join(', ');
      await dst.query(`insert into ${table} (${cols.join(', ')}) values ${sql}`, vals);
    }
    counts[table] = rows.length; console.log(`wrote ${table}: ${rows.length}`);
  }
  await dst.query("select setval(pg_get_serial_sequence('audit', 'id'), coalesce((select max(id) from audit), 1))");
  // Check: every table has as many rows on the VPS as on Neon.
  for (const table of TABLES) { const n = (await dst.query(`select count(*)::int as n from ${table}`)).rows[0].n; if (n !== counts[table]) throw new Error(`${table}: ${counts[table]} read but ${n} written.`); }
  await dst.query('commit');
  for (const table of TABLES) console.log(`${table}: ${counts[table]} copied`);
  console.log(here ? 'Done. Aali One on the VPS now has the live data. Remove FROM_URL from the app\'s settings in Coolify.' : 'Done. Aali One on the VPS now has the live data. Close the tunnel and turn the database\'s public access off again in Coolify.');
} catch (e) { await dst.query('rollback').catch(() => {}); console.error('Stopped, nothing was kept on the VPS:', e.message); process.exitCode = 1; }
finally { await dst.end().catch(() => {}); }
