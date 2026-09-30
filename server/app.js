// The whole API as one request handler, used by Vercel (api/[...path].js) and by server/dev.js (VPS / local).
import { getDb } from './db.js';
import { newId, hashPassword, checkPassword, createSession, userFromToken, dropSession, sessionCookie, readCookie,
  publicUser, tooManyFails, noteFail, clearFails } from './auth.js';
import { beforeCreate, afterCreate, beforeUpdate, insertRec, getSetting, setSetting, isManager, Rule, NEEDS_REASON, ADMIN_ONLY_DELETE } from './logic.js';
import { DEFAULT_SETTINGS, TITLE_TEAM } from '../shared/defaults.js';

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const MAX_BODY = 4_000_000;

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isBuf ? headers['content-type'] : 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}
async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Rule('That file is too large (max 3 MB).', 413); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8'); return raw ? JSON.parse(raw) : {};
}
const toClient = (r) => ({ ...r.data, id: r.id, type: r.type, sample: r.sample, createdBy: r.created_by, updatedBy: r.updated_by,
  createdAt: r.created_at, updatedAt: r.updated_at, ...(r.deleted_at ? { deletedAt: r.deleted_at, deleteReason: r.delete_reason } : {}) });
async function allSettings(db) {
  const rows = (await db.query('select key, value from settings')).rows, s = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (SETTING_KEYS.includes(r.key)) s[r.key] = r.value;
  return s;
}
const audit = (db, user, rec, action, summary) => db.query('insert into audit (user_id, record_id, type, action, summary) values ($1,$2,$3,$4,$5)',
  [user?.id || null, rec?.id || null, rec?.type || null, action, summary || '']);
const label = (d) => d.number || d.certNo || d.title || d.name || d.signerName || d.text?.slice(0, 40) || '';

export async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), path = url.pathname.replace(/^\/api/, ''), method = req.method;
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
  try {
    const db = await getDb();
    // ---------- public ----------
    if (path === '/health') return send(res, 200, { ok: true });
    if (path === '/setup' && method === 'GET') { const n = (await db.query('select count(*)::int n from users')).rows[0].n; return send(res, 200, { needsSetup: n === 0 }); }
    if (path === '/setup' && method === 'POST') {
      const b = await readBody(req);
      const r = await db.tx(async (t) => {
        const n = (await t.query('select count(*)::int n from users')).rows[0].n; if (n) throw new Rule('Setup is already done.', 409);
        if (!b.name || !b.email || String(b.password || '').length < 8) throw new Rule('Enter name, email and a password of at least 8 characters.');
        const id = newId('u_');
        await t.query('insert into users (id, email, name, title, team, is_admin, pass_hash) values ($1,$2,$3,$4,$5,true,$6)', [id, b.email.trim().toLowerCase(), b.name.trim(), 'admin', 'management', hashPassword(b.password)]);
        return id;
      });
      const token = await createSession(db, r);
      return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie(token, secure) });
    }
    if (path === '/auth/login' && method === 'POST') {
      const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
      if (tooManyFails(email)) throw new Rule('Too many tries. Wait 15 minutes and try again.', 429);
      const u = (await db.query('select * from users where email = $1 and active', [email])).rows[0];
      if (!u || !checkPassword(String(b.password || ''), u.pass_hash)) { noteFail(email); throw new Rule('Wrong email or password.', 401); }
      clearFails(email);
      const token = await createSession(db, u.id); await audit(db, u, null, 'login', u.email);
      return send(res, 200, { user: publicUser(u) }, { 'set-cookie': sessionCookie(token, secure) });
    }
    if (path === '/auth/logout' && method === 'POST') { await dropSession(db, readCookie(req, 'aali_session')); return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', secure) }); }
    if (path === '/public/enquiry' && method === 'POST') {
      const b = await readBody(req);
      if (b.website) return send(res, 200, { ok: true }); // honeypot
      const out = await db.tx(async (t) => {
        const data = { name: b.name, mobile: b.mobile, email: b.email || '', company: b.company || '', service: b.service, source: 'Website', message: String(b.message || '').slice(0, 1000) };
        const r = await beforeCreate(t, 'lead', data, null, false);
        if (r.merged) return { merged: true };
        const id = await insertRec(t, 'lead', data, null); await afterCreate(t, 'lead', id, data, null, false); return { id };
      });
      return send(res, 200, { ok: true, ...out });
    }
    let m = path.match(/^\/public\/progress\/([\w-]+)$/);
    if (m && method === 'GET') {
      const p = (await db.query("select * from records where type = 'project' and deleted_at is null and data->>'progressToken' = $1", [m[1]])).rows[0];
      if (!p) throw new Rule('This progress link is not valid.', 404);
      const tasks = (await db.query("select data from records where type = 'task' and deleted_at is null and data->>'projectId' = $1", [p.id])).rows.map((r) => r.data);
      const ms = tasks.filter((x) => x.milestone).map((x) => ({ title: x.title, due: x.due, done: x.status === 'done' }));
      const done = tasks.filter((x) => x.status === 'done').length;
      const b = await getSetting(db, 'business', DEFAULT_SETTINGS.business);
      return send(res, 200, { name: p.data.name, client: p.data.clientName || '', stage: p.data.stage, deadline: p.data.deadline || '', progress: tasks.length ? Math.round(100 * done / tasks.length) : 0,
        milestones: ms.sort((a, c) => (a.due || '').localeCompare(c.due || '')), business: { name: b.name, phone: b.phone, email: b.email } });
    }

    // ---------- signed in ----------
    const user = await userFromToken(db, readCookie(req, 'aali_session'));
    if (!user) throw new Rule('Please sign in.', 401);
    const admin = user.is_admin;

    if (path === '/me') return send(res, 200, { user: publicUser(user) });
    if (path === '/bootstrap' && method === 'GET') {
      const [users, recs, settings, now] = await Promise.all([
        db.query('select * from users order by name'), db.query('select * from records where deleted_at is null'), allSettings(db), db.query('select now() as t')]);
      return send(res, 200, { me: publicUser(user), users: users.rows.map(publicUser), settings, records: recs.rows.map(toClient), serverTime: now.rows[0].t });
    }
    if (path === '/changes' && method === 'GET') {
      const since = url.searchParams.get('since');
      const [recs, users, now] = await Promise.all([
        db.query('select * from records where updated_at > $1 or deleted_at > $1', [since]), db.query('select * from users where updated_at > $1', [since]), db.query('select now() as t')]);
      const sChanged = (await db.query('select count(*)::int n from settings where updated_at > $1', [since])).rows[0].n > 0;
      return send(res, 200, { records: recs.rows.map(toClient), users: users.rows.map(publicUser), settings: sChanged ? await allSettings(db) : null, serverTime: now.rows[0].t });
    }
    if (path === '/records' && method === 'POST') {
      const b = await readBody(req), type = String(b.type || ''), data = { ...(b.data || {}) };
      if (!/^[a-z]{2,20}$/.test(type)) throw new Rule('Unknown record type.');
      const out = await db.tx(async (t) => {
        const r = await beforeCreate(t, type, data, user, false);
        if (r.merged) { const rec = (await t.query('select * from records where id = $1', [r.id])).rows[0]; return { merged: true, record: toClient(rec) }; }
        const id = await insertRec(t, type, data, user); await afterCreate(t, type, id, data, user, false);
        const rec = (await t.query('select * from records where id = $1', [id])).rows[0];
        await t.query('insert into audit (user_id, record_id, type, action, summary) values ($1,$2,$3,$4,$5)', [user.id, id, type, 'create', label(rec.data)]);
        return { record: toClient(rec) };
      });
      return send(res, 200, out);
    }
    m = path.match(/^\/records\/([\w-]+)(\/restore)?$/);
    if (m && method === 'PATCH') {
      const b = await readBody(req);
      const out = await db.tx(async (t) => {
        const rec = (await t.query('select * from records where id = $1 and deleted_at is null for update', [m[1]])).rows[0];
        if (!rec) throw new Rule('That item no longer exists.', 404);
        const next = { ...rec.data, ...(b.data || {}) };
        for (const k of Object.keys(next)) if (next[k] === null && b.data && k in b.data) delete next[k];
        await beforeUpdate(t, rec, next, user);
        await t.query('update records set data = $2, updated_by = $3, updated_at = now() where id = $1', [rec.id, JSON.stringify(next), user.id]);
        const changed = Object.keys(b.data || {}).filter((k) => !k.startsWith('_')).join(', ');
        await t.query('insert into audit (user_id, record_id, type, action, summary) values ($1,$2,$3,$4,$5)', [user.id, rec.id, rec.type, 'update', `${label(next)}: ${changed}`.slice(0, 300)]);
        return toClient((await t.query('select * from records where id = $1', [rec.id])).rows[0]);
      });
      return send(res, 200, { record: out });
    }
    if (m && method === 'DELETE') {
      const b = await readBody(req), reason = String(b.reason || '').trim();
      const rec = (await db.query('select * from records where id = $1 and deleted_at is null', [m[1]])).rows[0];
      if (!rec) throw new Rule('That item no longer exists.', 404);
      if (ADMIN_ONLY_DELETE.includes(rec.type) && !admin) throw new Rule('Only an admin can delete a signed certificate.', 403);
      if (NEEDS_REASON.includes(rec.type) && reason.length < 5) throw new Rule('Give a reason of at least 5 characters.');
      if (['deal', 'project', 'client'].includes(rec.type) && !isManager(user) && rec.created_by !== user.id) throw new Rule('Only a manager can delete this.', 403);
      await db.query('update records set deleted_at = now(), deleted_by = $2, delete_reason = $3, updated_at = now() where id = $1', [rec.id, user.id, reason || null]);
      await audit(db, user, rec, 'delete', `${label(rec.data)}${reason ? ' – ' + reason : ''}`);
      return send(res, 200, { ok: true });
    }
    if (m && m[2] && method === 'POST') {
      if (!admin) throw new Rule('Only an admin can restore.', 403);
      await db.query('update records set deleted_at = null, deleted_by = null, delete_reason = null, updated_at = now() where id = $1', [m[1]]);
      await audit(db, user, { id: m[1] }, 'restore', ''); return send(res, 200, { ok: true });
    }
    if (path === '/trash' && method === 'GET') {
      if (!admin) throw new Rule('Only an admin can open the recycle bin.', 403);
      const r = await db.query('select * from records where deleted_at is not null order by deleted_at desc limit 300');
      return send(res, 200, { records: r.rows.map((x) => ({ ...toClient(x), deletedBy: x.deleted_by })) });
    }
    if (path === '/audit' && method === 'GET') {
      if (!isManager(user)) throw new Rule('Only managers can see the audit log.', 403);
      const r = await db.query('select * from audit order by at desc limit $1', [Math.min(1000, +url.searchParams.get('limit') || 300)]);
      return send(res, 200, { rows: r.rows });
    }
    if (path === '/import/leads' && method === 'POST') {
      const b = await readBody(req), rows = Array.isArray(b.rows) ? b.rows.slice(0, 500) : [];
      const summary = { created: 0, merged: 0, failed: [] };
      for (const [i, row] of rows.entries()) {
        try {
          await db.tx(async (t) => {
            const data = { name: row.name, mobile: row.mobile, email: row.email || '', company: row.company || '', service: row.service, source: row.source || 'Other', message: row.message || '' };
            const r = await beforeCreate(t, 'lead', data, user, false);
            if (r.merged) { summary.merged++; return; }
            const id = await insertRec(t, 'lead', data, user); await afterCreate(t, 'lead', id, data, user, false); summary.created++;
          });
        } catch (e) { summary.failed.push({ row: i + 2, error: e.message }); }
      }
      await audit(db, user, null, 'import', `Leads: ${summary.created} new, ${summary.merged} merged, ${summary.failed.length} failed`);
      return send(res, 200, summary);
    }
    if (path === '/files' && method === 'POST') {
      const b = await readBody(req), buf = Buffer.from(String(b.data || ''), 'base64');
      if (!buf.length) throw new Rule('The file is empty.'); if (buf.length > 3_000_000) throw new Rule('That file is too large (max 3 MB).', 413);
      const id = newId('f_');
      await db.query('insert into files (id, name, mime, size, data, created_by) values ($1,$2,$3,$4,$5,$6)', [id, String(b.name || 'file').slice(0, 200), String(b.mime || 'application/octet-stream'), buf.length, buf, user.id]);
      return send(res, 200, { id, name: b.name, mime: b.mime, size: buf.length });
    }
    m = path.match(/^\/files\/([\w-]+)$/);
    if (m && method === 'GET') {
      const f = (await db.query('select * from files where id = $1', [m[1]])).rows[0]; if (!f) throw new Rule('File not found.', 404);
      return send(res, 200, Buffer.from(f.data), { 'content-type': f.mime, 'content-disposition': `inline; filename="${encodeURIComponent(f.name)}"`, 'cache-control': 'private, max-age=86400' });
    }
    // ---------- admin ----------
    m = path.match(/^\/settings\/(\w+)$/);
    if (m && method === 'PUT') {
      if (!admin) throw new Rule('Only an admin can change settings.', 403);
      if (!SETTING_KEYS.includes(m[1])) throw new Rule('Unknown setting.');
      const b = await readBody(req); await setSetting(db, m[1], b.value); await audit(db, user, null, 'settings', m[1]);
      return send(res, 200, { ok: true });
    }
    if (path === '/users' && method === 'POST') {
      if (!admin) throw new Rule('Only an admin can add people.', 403);
      const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
      if (!b.name || !email || String(b.password || '').length < 8) throw new Rule('Enter name, email and a password of at least 8 characters.');
      const id = newId('u_');
      try { await db.query('insert into users (id, email, name, title, team, phone, is_admin, pass_hash) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, email, b.name.trim(), b.title || 'bde', TITLE_TEAM[b.title] || 'sales', b.phone || '', !!b.isAdmin, hashPassword(b.password)]); }
      catch (e) { if (String(e.message).includes('unique') || e.code === '23505') throw new Rule('Someone already uses that email.'); throw e; }
      await audit(db, user, null, 'user', `Added ${email}`);
      return send(res, 200, { user: publicUser((await db.query('select * from users where id = $1', [id])).rows[0]) });
    }
    m = path.match(/^\/users\/([\w-]+)$/);
    if (m && method === 'PATCH') {
      const b = await readBody(req), self = m[1] === user.id;
      if (!admin && !self) throw new Rule('Only an admin can change other people.', 403);
      const u = (await db.query('select * from users where id = $1', [m[1]])).rows[0]; if (!u) throw new Rule('Person not found.', 404);
      const next = { name: b.name ?? u.name, phone: b.phone ?? u.phone, title: admin ? (b.title ?? u.title) : u.title, active: admin ? (b.active ?? u.active) : u.active, is_admin: admin ? (b.isAdmin ?? u.is_admin) : u.is_admin };
      if (self && next.active === false) throw new Rule("You can't switch off your own account.");
      await db.query('update users set name=$2, phone=$3, title=$4, team=$5, active=$6, is_admin=$7, updated_at=now() where id=$1',
        [u.id, next.name, next.phone, next.title, TITLE_TEAM[next.title] || u.team, next.active, next.is_admin]);
      if (b.password) {
        if (String(b.password).length < 8) throw new Rule('Password must be at least 8 characters.');
        if (self && !admin && !checkPassword(String(b.currentPassword || ''), u.pass_hash)) throw new Rule('Your current password is not right.');
        await db.query('update users set pass_hash = $2 where id = $1', [u.id, hashPassword(b.password)]);
        if (!self) await db.query('delete from sessions where user_id = $1', [u.id]);
      }
      await audit(db, user, null, 'user', `Updated ${u.email}`);
      return send(res, 200, { user: publicUser((await db.query('select * from users where id = $1', [u.id])).rows[0]) });
    }
    if (path === '/sample/clear' && method === 'POST') {
      if (!admin) throw new Rule('Only an admin can clear sample data.', 403);
      const r = await db.query('update records set deleted_at = now(), deleted_by = $1, delete_reason = $2, updated_at = now() where sample and deleted_at is null', [user.id, 'Sample data cleared']);
      await audit(db, user, null, 'sample', `Cleared ${r.rowCount} sample records`);
      return send(res, 200, { cleared: r.rowCount });
    }
    throw new Rule('Not found.', 404);
  } catch (e) {
    if (e instanceof Rule) return send(res, e.status, { error: e.message });
    if (e instanceof SyntaxError) return send(res, 400, { error: 'The request was not valid.' });
    console.error(e);
    return send(res, 500, { error: 'Something went wrong on the server. Try again; if it keeps happening, tell the admin.' });
  }
}
