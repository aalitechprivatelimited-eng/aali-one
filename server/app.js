// The whole API as one request handler, used by Vercel (api/[...path].js) and by server/dev.js (VPS / local).
import { getDb } from './db.js';
import { newId, hashPassword, checkPassword, isOldHash, passwordProblem, fakeCheck, sessionKey, createSession, sessionUser, dropSession, sessionCookie, readCookie, publicUser, IDLE_MIN } from './auth.js';
import { beforeCreate, afterCreate, beforeUpdate, insertRec, notify, deadlineSweep, refreshDrafts, cleanRules, getSetting, setSetting, isManager, isTop, canEditCollab, MONEY, canMoney, Rule, NEEDS_REASON, ADMIN_ONLY_DELETE, canSeeReport, canDeleteReport } from './logic.js';
import { DEFAULT_SETTINGS, TITLE_TEAM, MANAGER_ADDS, COMPANIES, GROUP } from '../shared/defaults.js';
import { isAdminUser, canEdit, canSee, hiddenFrom, SECRET, HR_TITLE } from '../shared/access.js';
import { hrmConnected, hrmMonth, hrmPeople, hrmEmailOf, hrmEnv, hrmFind } from './hrm.js';
import { waReady, waTemplate, waNumber, kickOutbox, waitForSending, queueTest, checkTemplate, REPORT_TEMPLATE } from './whatsapp.js';
// WhatsApp sending: in the background on the VPS; waited for on Vercel, which may stop a function once it has answered (server/whatsapp.js).
const sendWa = async (db, now) => { const k = kickOutbox(db, now); if (waitForSending()) await k; };
import { attendanceDays, onBasis, clientPay } from '../shared/payroll.js';
import { buildAccess, loadIndex } from './access.js';
import { checkCalls, rebuild, dropList } from './prospects.js';
import { displayOk } from '../shared/names.js';

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const PAY_INPUTS = ['salary', 'loan', 'payee', 'pclient', 'pemp']; // what a payroll month is made from: saving one works out the draft months again
const draftsOf = (type, id, data) => (type === 'pclient' ? id : type === 'pemp' ? data?.pclientId || '' : ''); // whose drafts: a client's, or Aali's ('')
const MAX_BODY = 4_000_000, MAX_ITEM = 600_000; // MAX_ITEM: one item's data (a day's report with 400 calls is far below this)

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isBuf ? headers['content-type'] : 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
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
// The Founder & Chairman and the Operations Manager are told whenever someone gains or loses HR & payroll (never the person who did it).
async function tellHrChange(db, by, text) { for (const x of (await db.query("select id from users where active and title in ('ops', 'chairman') and id <> $1", [by.id])).rows) await notify(db, x.id, text, '', '', by); }
// A personal email (payslips will be sent there): empty, or one plain address.
const cleanPersonal = (v) => { const e = String(v || '').trim().toLowerCase().slice(0, 120); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Rule('The personal email does not look right.'); return e; };
async function allSettings(db, user) {
  const rows = (await db.query('select key, value from settings')).rows, s = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (SETTING_KEYS.includes(r.key)) s[r.key] = r.value;
  if (user && !canSee(user, 'agreements')) delete s.agreements; // the agreement wording goes only to those who see agreements
  if (user && !canSee(user, 'payroll')) delete s.payroll; // and the payroll rules only to HR and the Operations Manager
  return s;
}
// Everyone payroll can be about: the logins, and the staff without a login (Payroll → Salaries).
async function payrollPeople(db) {
  const us = (await db.query('select id, name, email, title, active, removed_at from users')).rows;
  const ps = (await db.query("select id, data from records where deleted_at is null and type = 'payee'")).rows
    .map((p) => ({ id: p.id, name: p.data.name, email: p.data.email || '', title: 'payee', active: p.data.active !== false, removed_at: null, payee: true }));
  return [...us, ...ps].sort((a, b) => a.name.localeCompare(b.name));
}
const audit = (db, user, rec, action, summary) => db.query('insert into audit (user_id, record_id, type, action, summary) values ($1,$2,$3,$4,$5)',
  [user?.id || null, rec?.id || null, rec?.type || null, action, summary || '']);
const label = (d) => d.number || d.certNo || d.title || d.name || d.signerName || d.text?.slice(0, 40) || '';
// IT sees only a client's name (it is printed on their projects), never the contact details or the money.
const clientCard = (r) => ({ id: r.id, type: 'client', name: r.data.name, city: r.data.city || '', card: true, createdAt: r.created_at, updatedAt: r.updated_at });
const gone = (r) => ({ id: r.id, type: r.type, deletedAt: r.deleted_at || r.updated_at });
const MOVES = ['lead', 'deal', 'client', 'project', 'task', 'ticket', 'prospect']; // kinds of record that can pass from one person to another
// Where a request comes from, for the limits on wrong passwords and on the public enquiry form.
const clientIp = (req) => String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim().slice(0, 60);
// Limits. Wrong passwords: 8 for one email, 40 from one connection, in 15 minutes. They are counted in the database, so they hold on every server instance.
const FAILS_EMAIL = 8, FAILS_IP = 40, ENQUIRIES_IP = 30, UPLOAD_DAY = 80_000_000;
// A stored file is shown in the browser only if it is a plain picture or a PDF. Anything else (a web page, an SVG drawing with a script inside) is
// handed over as a download, so a file someone uploads can never run inside Aali One with another person's login.
const SHOWN_INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/, PHOTO = /^image\/(png|jpeg|gif|webp)$/;

async function userWork(db, id, viewer) {
  let r = (await db.query(`select type, count(*)::int n from records where deleted_at is null and type not in ('notice', 'comment')
    and (created_by = $1 or data->>'owner' = $1 or data->>'lead' = $1 or data->>'userId' = $1 or data->'people' ? $1) group by type`, [id])).rows;
  const reports = r.find((x) => x.type === 'report')?.n || 0; r = r.filter((x) => !hiddenFrom(viewer, x.type)); // review: not even how many salary sheets or loans
  return { reports, work: r.filter((x) => x.type !== 'report').reduce((n, x) => n + x.n, 0), types: r.filter((x) => x.type !== 'report') };
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), path = url.pathname.replace(/^\/api/, ''), method = req.method;
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
  try {
    const db = await getDb();
    // ---------- public ----------
    if (path === '/health') return send(res, 200, { ok: true, ...(process.env.TEST_SITE ? { test: true } : {}) }); // test: the practice copy, not the real Aali One
    if (path === '/setup' && method === 'GET') { const n = (await db.query('select count(*)::int n from users')).rows[0].n; return send(res, 200, { needsSetup: n === 0 }); }
    if (path === '/setup' && method === 'POST') {
      const b = await readBody(req);
      const r = await db.tx(async (t) => {
        const n = (await t.query('select count(*)::int n from users')).rows[0].n; if (n) throw new Rule('Setup is already done.', 409);
        if (!b.name || !b.email) throw new Rule('Enter name, email and a password.'); if (passwordProblem(b.password)) throw new Rule(passwordProblem(b.password));
        const id = newId('u_');
        await t.query('insert into users (id, email, name, title, team, is_admin, pass_hash) values ($1,$2,$3,$4,$5,true,$6)', [id, b.email.trim().toLowerCase(), b.name.trim(), 'admin', 'management', hashPassword(b.password)]);
        return id;
      });
      const token = await createSession(db, r);
      return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie(token, secure) });
    }
    if (path === '/auth/login' && method === 'POST') {
      const b = await readBody(req), email = String(b.email || '').trim().toLowerCase().slice(0, 120), pw = String(b.password || ''), ip = clientIp(req);
      // Wrong tries since this email last signed in (within 15 minutes), and wrong tries from this connection.
      const f = (await db.query(`select count(*) filter (where type = $1 and at > coalesce((select max(at) from audit where action = 'login' and summary = $1), '-infinity'))::int e,
        count(*) filter (where record_id = $2 and $2 <> '')::int i from audit where action = 'loginfail' and at > now() - interval '15 minutes'`, [email, ip])).rows[0];
      if (f.e >= FAILS_EMAIL || f.i >= FAILS_IP) throw new Rule('Too many tries. Wait 15 minutes and try again.', 429);
      const u = (await db.query('select * from users where email = $1 and active', [email])).rows[0];
      const right = u ? checkPassword(pw, u.pass_hash) : (fakeCheck(pw), false); // an unknown email takes just as long to refuse
      if (!right) {
        await db.query("insert into audit (type, record_id, action, summary) values ($1, $2, 'loginfail', $3)", [email, ip, `Wrong password tried for ${email}`]);
        throw new Rule('Wrong email or password.', 401); }
      if (isOldHash(u.pass_hash)) await db.query('update users set pass_hash = $2 where id = $1', [u.id, hashPassword(pw)]); // an older scrypt password becomes bcrypt
      const token = await createSession(db, u.id); await audit(db, u, null, 'login', u.email);
      return send(res, 200, { user: publicUser(u) }, { 'set-cookie': sessionCookie(token, secure) });
    }
    if (path === '/auth/logout' && method === 'POST') { await dropSession(db, readCookie(req, 'aali_session')); return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', secure) }); }
    if (path === '/public/enquiry' && method === 'POST') {
      const b = await readBody(req), ip = clientIp(req);
      if (b.website) return send(res, 200, { ok: true }); // honeypot
      if (ip && (await db.query("select count(*)::int n from audit where action = 'enquiry' and record_id = $1 and at > now() - interval '1 hour'", [ip])).rows[0].n >= ENQUIRIES_IP) throw new Rule('Too many enquiries from this connection. Please call us instead.', 429);
      await db.query("insert into audit (record_id, action, summary) values ($1, 'enquiry', $2)", [ip, `Website enquiry: ${String(b.name || '').slice(0, 60)}`]);
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
    // The JWT in the cookie and its session (server/auth.js); x-idle: seconds since the person last tapped or typed on the page.
    const signed = await sessionUser(db, readCookie(req, 'aali_session'), +req.headers['x-idle'] || 0), user = signed.user;
    if (!user) throw new Rule(signed.why === 'idle' ? `You were signed out after ${IDLE_MIN} minutes without use. Please sign in again.` : signed.why === 'ended' ? 'Your sign-in has ended. Please sign in again.' : 'Please sign in.', 401);
    user.is_admin = isAdminUser(user); // the Operations Manager and Company Secretary always have the admin features
    const admin = user.is_admin, juniors = MANAGER_ADDS[user.title] || [];
    const leadSees = user.title === 'itlead' && !!(await getSetting(db, 'leadSeesReports', false));
    // Role based level access (shared/access.js): what this person may read and change, record by record.
    // Top management sees everything, so it needs no index of who owns what.
    const access = async (rows) => buildAccess(user, rows || (isTop(user) ? [] : await loadIndex(db)), (u, d) => canSeeReport(u, d, leadSees));
    const shown = (acc, r) => { const a = acc.read(r); return a === true ? toClient(r) : a === 'card' ? clientCard(r) : null; };
    // Other people's login email and mobile go only to management, to their own manager, and to themselves.
    const seeUser = (u) => { const p = publicUser(u); return admin || isTop(user) || u.id === user.id || (isManager(user) && u.team === user.team) ? p : { ...p, email: '', phone: '', personalEmail: '', removedReason: '', removedBy: null }; };

    if (path === '/me') return send(res, 200, { user: publicUser(user) });
    // Deadline reminders: the first request of the day sends them (a quick check on every other request).
    if (path === '/bootstrap' || path === '/changes') { await deadlineSweep(db).catch((e) => console.error('deadline reminders', e.message)); await sendWa(db); } // WhatsApp messages still waiting
    if (path === '/bootstrap' && method === 'GET') {
      const [users, recs, settings, now] = await Promise.all([
        db.query('select * from users order by name'), db.query('select * from records where deleted_at is null'), allSettings(db, user), db.query('select now() as t')]);
      const acc = await access(recs.rows);
      return send(res, 200, { me: publicUser(user), users: users.rows.map(seeUser), settings, records: recs.rows.map((r) => shown(acc, r)).filter(Boolean), serverTime: now.rows[0].t });
    }
    if (path === '/changes' && method === 'GET') {
      const since = url.searchParams.get('since');
      const [recs, users, now] = await Promise.all([
        db.query('select * from records where updated_at > $1 or deleted_at > $1', [since]), db.query('select * from users where updated_at > $1', [since]), db.query('select now() as t')]);
      const sChanged = (await db.query('select count(*)::int n from settings where updated_at > $1', [since])).rows[0].n > 0;
      // A changed record this person may not (or may no longer) read is sent as "gone", so a lead given to someone else leaves their screen.
      const acc = recs.rows.length ? await access() : null;
      const out = recs.rows.map((r) => (hiddenFrom(user, r.type) ? null : r.deleted_at ? gone(r) : shown(acc, r) || (MOVES.includes(r.type) ? gone(r) : null))).filter(Boolean);
      return send(res, 200, { records: out, users: users.rows.map(seeUser), settings: sChanged ? await allSettings(db, user) : null, serverTime: now.rows[0].t });
    }
    if (path === '/records' && method === 'POST') {
      const b = await readBody(req), type = String(b.type || ''), data = { ...(b.data || {}) };
      if (JSON.stringify(data).length > MAX_ITEM) throw new Rule('This item is too large. Attach big text as a file instead.', 413); // audit DOS-2
      if (!/^[a-z]{2,20}$/.test(type)) throw new Rule('Unknown record type.');
      if (MONEY.includes(type) && !canMoney(user)) throw new Rule('Only the Sales Manager and management handle quotations, receipts and payments.', 403);
      const acc = await access(), no = acc.createBlock(type, data);
      if (no) throw new Rule(no, 403);
      const out = await db.tx(async (t) => {
        const r = await beforeCreate(t, type, data, user, false);
        // A repeat enquiry joins the lead that is already open. If that lead is someone else's, say so without showing it.
        if (r.merged) { const rec = (await t.query('select * from records where id = $1', [r.id])).rows[0];
          return acc.read(rec) === true ? { merged: true, record: toClient(rec) } : { merged: true, hidden: true, record: { id: rec.id, type: rec.type, owner: rec.data.owner || '' } }; }
        const id = await insertRec(t, type, data, user); await afterCreate(t, type, id, data, user, false);
        if (PAY_INPUTS.includes(type)) await refreshDrafts(t, user, draftsOf(type, id, data)); // the months still in draft show the new sheet at once
        const rec = (await t.query('select * from records where id = $1', [id])).rows[0];
        await t.query('insert into audit (user_id, record_id, type, action, summary) values ($1,$2,$3,$4,$5)', [user.id, id, type, 'create', label(rec.data)]);
        return { record: toClient(rec) };
      });
      return send(res, 200, out);
    }
    m = path.match(/^\/records\/([\w-]+)(\/restore)?$/);
    if (m && method === 'PATCH') {
      const b = await readBody(req), acc = await access();
      const out = await db.tx(async (t) => {
        const rec = (await t.query('select * from records where id = $1 and deleted_at is null for update', [m[1]])).rows[0];
        if (!rec) throw new Rule('That item no longer exists.', 404);
        if (MONEY.includes(rec.type) && !canMoney(user)) throw new Rule('Only the Sales Manager and management handle quotations, receipts and payments.', 403);
        const no = acc.writeBlock(rec, b.data || {});
        if (no) throw new Rule(no, 403);
        const next = { ...rec.data, ...(b.data || {}) };
        if (JSON.stringify(next).length > MAX_ITEM) throw new Rule('This item has become too large. Attach big text as a file instead.', 413); // audit DOS-2
        for (const k of Object.keys(next)) if (next[k] === null && b.data && k in b.data) delete next[k];
        await beforeUpdate(t, rec, next, user);
        await t.query('update records set data = $2, updated_by = $3, updated_at = now() where id = $1', [rec.id, JSON.stringify(next), user.id]);
        if (PAY_INPUTS.includes(rec.type)) await refreshDrafts(t, user, draftsOf(rec.type, rec.id, next));
        const changed = Object.keys(b.data || {}).filter((k) => !k.startsWith('_')).join(', ');
        await t.query('insert into audit (user_id, record_id, type, action, summary) values ($1,$2,$3,$4,$5)', [user.id, rec.id, rec.type, 'update', `${label(next)}: ${changed}`.slice(0, 300)]);
        return toClient((await t.query('select * from records where id = $1', [rec.id])).rows[0]);
      });
      if (out.type === 'report' && b.data?.status === 'submitted') await sendWa(db, true); // its WhatsApp messages go now
      return send(res, 200, { record: out });
    }
    if (m && method === 'DELETE') {
      const b = await readBody(req), reason = String(b.reason || '').trim();
      const rec = (await db.query('select * from records where id = $1 and deleted_at is null', [m[1]])).rows[0];
      if (!rec) throw new Rule('That item no longer exists.', 404);
      if (ADMIN_ONLY_DELETE.includes(rec.type) && !admin) throw new Rule('Only an admin can delete a signed certificate.', 403);
      if (NEEDS_REASON.includes(rec.type) && reason.length < 5) throw new Rule('Give a reason of at least 5 characters.');
      if (MONEY.includes(rec.type) && !canMoney(user)) throw new Rule('Only the Sales Manager and management handle quotations, receipts and payments.', 403);
      const no = (await access()).writeBlock(rec);
      if (no) throw new Rule(no, 403);
      if (rec.type === 'pclient' && (await db.query("select 1 from records where deleted_at is null and ((type = 'pemp' and data->>'pclientId' = $1) or (type = 'payrun' and data->>'pclientId' = $1))", [rec.id])).rowCount)
        throw new Rule('This client has employees or payroll months. Untick "Payroll active" in its details instead.');
      if (rec.type === 'pemp' && (await db.query("select 1 from records where deleted_at is null and type = 'payrun' and data->>'status' <> 'draft' and data->'items' @> $1::jsonb", [JSON.stringify([{ userId: rec.id }])])).rowCount)
        throw new Rule('This employee is on a locked or paid month. Enter a leaving date instead.');
      if (rec.type === 'payee' && (await db.query("select 1 from records where deleted_at is null and type in ('salary', 'loan') and data->>'userId' = $1", [rec.id])).rowCount)
        throw new Rule('This person has a salary sheet or a loan. Untick "Still working here" in their details instead.');
      if (rec.type === 'collab' && !canEditCollab(user)) throw new Rule('Only the Operations Manager or Company Secretary can delete a collaboration.', 403);
      if (rec.type === 'report' && !canDeleteReport(user, rec.data)) throw new Rule('Only the Operations Manager, the Company Secretary or the department manager can delete a report.', 403);
      if (['deal', 'project', 'client'].includes(rec.type) && !isManager(user) && rec.created_by !== user.id) throw new Rule('Only a manager can delete this.', 403);
      await db.query('update records set deleted_at = now(), deleted_by = $2, delete_reason = $3, updated_at = now() where id = $1', [rec.id, user.id, reason || null]);
      if (PAY_INPUTS.includes(rec.type)) await db.tx((t) => refreshDrafts(t, user, draftsOf(rec.type, rec.id, rec.data)));
      await audit(db, user, rec, 'delete', `${label(rec.data)}${reason ? ' – ' + reason : ''}`);
      return send(res, 200, { ok: true });
    }
    if (m && m[2] && method === 'POST') {
      if (!admin) throw new Rule('Only an admin can restore.', 403);
      const kind = (await db.query('select type from records where id = $1', [m[1]])).rows[0]?.type;
      if (SECRET[kind] && !canEdit(user, SECRET[kind])) throw new Rule(kind === 'agreement' ? 'An agreement is restored by the Operations Manager.' : 'Payroll items are restored by HR.', 403);
      if (kind === 'salary' || kind === 'payrun') { const key = kind === 'salary' ? 'userId' : 'month';
        const twin = (await db.query(`select 1 from records r where r.deleted_at is null and r.type = $1 and r.data->>'${key}' = (select data->>'${key}' from records where id = $2)
          and coalesce(r.data->>'pclientId', '') = (select coalesce(data->>'pclientId', '') from records where id = $2)`, [kind, m[1]])).rowCount;
        if (twin) throw new Rule(kind === 'salary' ? 'This person already has a salary sheet. Delete that one first.' : 'There is already a payroll for that month. Delete that draft first.'); }
      await db.query('update records set deleted_at = null, deleted_by = null, delete_reason = null, updated_at = now() where id = $1', [m[1]]);
      if (PAY_INPUTS.includes(kind)) { const r = (await db.query('select data from records where id = $1', [m[1]])).rows[0]; await db.tx((t) => refreshDrafts(t, user, draftsOf(kind, m[1], r?.data))); }
      await audit(db, user, { id: m[1] }, 'restore', ''); return send(res, 200, { ok: true });
    }
    if (path === '/trash' && method === 'GET') {
      if (!admin) throw new Rule('Only an admin can open the recycle bin.', 403);
      const r = await db.query('select * from records where deleted_at is not null order by deleted_at desc limit 300');
      return send(res, 200, { records: r.rows.filter((x) => !hiddenFrom(user, x.type)).map((x) => ({ ...toClient(x), deletedBy: x.deleted_by })) });
    }
    if (path === '/audit' && method === 'GET') {
      if (!isTop(user)) throw new Rule('Only management can see the audit log.', 403);
      // Kept short: the same person doing the same thing to the same item over one day (Indian time) is one line –
      // how many times, from when to when, and the latest details. Different additions, deletions and people changes stay separate lines.
      // Notifications being sent and read are left out: they are not anyone's work.
      const days = Math.min(90, Math.max(1, Math.round(+url.searchParams.get('days')) || 7));
      const r = await db.query(`select ((at at time zone 'UTC') + interval '330 minutes')::date::text as day, user_id, record_id, type, action, count(*)::int as n,
          min(at) as first, max(at) as at, (array_agg(summary order by at desc))[1] as summary
        from audit where at > now() - $1::int * interval '1 day' and coalesce(type, '') <> 'notice'
        group by 1, user_id, record_id, type, action, case when action in ('update', 'login', 'loginfail') then '' else summary end
        order by max(at) desc limit 3000`, [days]);
      // Each line's section, for the log's section filter (asked 8 Oct 2026: payroll, reports, sign-ins…). A month of client payroll is
      // a payrun with a client on it; HR matching people to Aali HRM and the HR & payroll switch are payroll work.
      const clientRuns = new Set((await db.query("select id from records where type = 'payrun' and data ? 'pclientId'")).rows.map((x) => x.id));
      const sectionOf = (x) => (['login', 'loginfail'].includes(x.action) ? 'signin' : ['pclient', 'pemp'].includes(x.type) || (x.type === 'payrun' && clientRuns.has(x.record_id)) ? 'clientpay'
        : ['salary', 'payrun', 'loan', 'payee'].includes(x.type) || x.action === 'people' || (x.action === 'settings' && x.summary === 'payroll') ? 'payroll'
        : x.type === 'report' ? 'reports' : ['lead', 'deal', 'client', 'quote', 'prospect', 'activity', 'target'].includes(x.type) || ['import', 'calls', 'enquiry'].includes(x.action) ? 'sales'
        : ['invoice', 'receipt', 'payment'].includes(x.type) ? 'money' : ['project', 'task', 'ticket', 'asset', 'collab', 'signoff', 'approval'].includes(x.type) ? 'projects'
        : x.type === 'agreement' ? 'agreements' : ['user', 'settings', 'sample'].includes(x.action) ? 'people' : 'other');
      return send(res, 200, { rows: r.rows.filter((x) => !hiddenFrom(user, x.type)).map((x) => ({ ...x, section: sectionOf(x) })) }); // agreement and payroll work only for those who see them
    }
    // My payslips: each person sees only their own payslip, once that month is marked paid – nothing else of payroll.
    if (path === '/payroll/mine' && method === 'GET') {
      const runs = (await db.query("select data from records where deleted_at is null and type = 'payrun' and data->>'status' = 'paid' and coalesce(data->>'pclientId', '') = '' order by data->>'month' desc")).rows;
      const slips = [];
      for (const { data } of runs) { const i = (data.items || []).find((x) => x.userId === user.id); if (i) { const { warn, ...mine } = i; slips.push({ month: data.month, paidOn: data.paidOn, item: mine }); } }
      return send(res, 200, { slips });
    }
    // Payroll → Rules: is Aali HRM linked, and who in Aali One is found there (by email, or as HR matched them by hand), with the
    // month's paid days; and the Aali HRM people nobody in Aali One is matched to, for HR to choose from.
    if (path === '/payroll/hrm' && method === 'GET') {
      if (!canSee(user, 'payroll')) throw new Rule('Payroll is for HR and the Operations Manager.', 403);
      const month = /^\d{4}-\d\d$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
      if (!hrmConnected()) return send(res, 200, { connected: false, month, people: [] });
      try {
        const h = await hrmMonth(month), rules = { ...DEFAULT_SETTINGS.payroll, ...(await getSetting(db, 'payroll', {})) }, today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
        const all = await payrollPeople(db), links = await getSetting(db, 'hrmLinks', {}), mail = admin || isTop(user);
        const one = url.searchParams.get('userId') || '', used = new Set(all.map((u) => hrmEmailOf(u, links)));
        const us = all.filter((u) => u.active && !u.removed_at && !['chairman', 'admin'].includes(u.title) && (!one || u.id === one)); // one person: the attendance calendar
        return send(res, 200, { connected: true, month, people: us.map((u) => { const p = h.people.get(hrmEmailOf(u, links));
          return { userId: u.id, name: u.name, email: mail ? u.email : '', payee: !!u.payee, byHand: !!links[u.id], matched: mail ? links[u.id] || '' : '', found: !!p,
            att: p ? attendanceDays({ month, today, joined: p.joined, left: p.left, records: p.records, leaves: p.leaves, holidays: h.holidays, freeLeaves: +rules.freeLeaves || 0, detail: !!one }) : null }; }),
          unmatched: !mail || one ? [] : [...h.people].filter(([e]) => !used.has(e)).map(([email, p]) => { const ins = p.records.filter((r) => r.checkIn).map((r) => r.date).sort();
            return { email, name: p.name, active: p.active, punched: ins.length, last: ins[ins.length - 1] || '' }; }).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)) });
      } catch (e) { return send(res, 200, { connected: true, month, error: 'Aali HRM could not be reached: ' + String(e?.message || e).slice(0, 160), people: [] }); }
    }
    // HR matches a person to someone in Aali HRM whose email differs (or undoes it with an empty email). Only HR: the Operations Manager reviews.
    if (path === '/payroll/hrm-link' && method === 'POST') {
      if (!canEdit(user, 'payroll')) throw new Rule('Only HR matches people to Aali HRM.', 403);
      if (!hrmConnected()) throw new Rule('Aali HRM is not linked yet.');
      const b = await readBody(req), email = String(b.email || '').trim().toLowerCase().slice(0, 200), links = await getSetting(db, 'hrmLinks', {});
      const all = await payrollPeople(db), u = all.find((x) => x.id === String(b.userId || ''));
      if (!u || !u.active || u.removed_at || ['chairman', 'admin'].includes(u.title)) throw new Rule('Choose a person on the payroll.');
      if (email) {
        let there; try { there = (await hrmPeople()).find((p) => p.email === email); } catch (e) { throw new Rule('Aali HRM could not be reached: ' + String(e?.message || e).slice(0, 160)); }
        if (!there) throw new Rule('Nobody in Aali HRM has that email.');
        const other = all.find((x) => x.id !== u.id && hrmEmailOf(x, links) === email);
        if (other) throw new Rule(`That person in Aali HRM is already matched to ${other.name}.`);
        links[u.id] = email;
      } else delete links[u.id];
      await setSetting(db, 'hrmLinks', links);
      await audit(db, user, null, 'people', email ? `${u.name}: matched by hand to ${email} in Aali HRM` : `${u.name}: Aali HRM match by hand removed`);
      return send(res, 200, { ok: true });
    }
    // A payroll client's employees from an Excel list: every row is checked; if any row is wrong nothing is added, and HR is told which rows.
    const pe = path.match(/^\/payroll\/clients\/([\w-]+)\/employees$/);
    if (pe && method === 'POST') {
      if (!canEdit(user, 'payroll')) throw new Rule('Only HR adds a client\'s employees.', 403);
      const b = await readBody(req), rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
      if (!rows.length) throw new Rule('The list has no employees.');
      const out = await db.tx(async (t) => {
        const pc = (await t.query("select id, data from records where id = $1 and type = 'pclient' and deleted_at is null", [pe[1]])).rows[0];
        if (!pc) throw new Rule('That payroll client was not found.', 404);
        const bad = []; let n = 0;
        for (const [k, row] of rows.entries()) {
          const data = { ...(row && typeof row === 'object' ? row : {}), pclientId: pc.id };
          try { await beforeCreate(t, 'pemp', data, user, false); const id = await insertRec(t, 'pemp', data, user); await afterCreate(t, 'pemp', id, data, user, false); n++; }
          catch (e) { if (!(e instanceof Rule)) throw e; bad.push(`Row ${k + 2}: ${e.message}`); }
        }
        if (bad.length) throw new Rule(`Nothing was added. Fix these rows and upload again – ${bad.slice(0, 8).join(' · ')}${bad.length > 8 ? ` · and ${bad.length - 8} more` : ''}`);
        await refreshDrafts(t, user, pc.id);
        await audit(t, user, { id: pc.id, type: 'pclient' }, 'create', `${pc.data.name}: ${n} employees added from Excel`);
        return { added: n };
      });
      return send(res, 200, out);
    }
    // Client payroll → Their HRM: is the client's own HRM linked, who of its employees is found there (by Employee ID = employee code, or
    // email) with the month's paid days, and who works in its HRM but is not on its payroll yet. empId: one employee, day by day.
    const ph = path.match(/^\/payroll\/clients\/([\w-]+)\/hrm$/);
    if (ph && method === 'GET') {
      if (!canSee(user, 'clientpay')) throw new Rule('Client payroll is for HR and the Operations Manager.', 403);
      const pc = (await db.query("select id, data from records where id = $1 and type = 'pclient' and deleted_at is null", [ph[1]])).rows[0];
      if (!pc) throw new Rule('That payroll client was not found.', 404);
      const month = /^\d{4}-\d\d$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
      const key = pc.data.attendance === 'hrm' ? pc.data.hrmCode || '' : '';
      if (!key || !hrmConnected(key)) return send(res, 200, { connected: false, month, key, setting: key ? hrmEnv(key) : '', people: [] });
      try {
        const h = await hrmMonth(month, key), rules = { ...DEFAULT_SETTINGS.payroll, ...(pc.data.rules || {}) }, today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
        const one = url.searchParams.get('empId') || '';
        const emps = (await db.query("select id, data from records where deleted_at is null and type = 'pemp' and data->>'pclientId' = $1", [pc.id])).rows.map(({ id, data: e }) => ({ id, e, p: hrmFind(h, e) }));
        const used = new Set(emps.map((x) => x.p).filter(Boolean)); // someone who has left the payroll is not listed as missing from it
        const people = emps.filter(({ id, e }) => e.active !== false && !e.left && (!one || id === one)).map(({ id, e, p }) => {
          // the paid days as the month's payroll counts them, by the client's own rules (onBasis; a daily wage: the days worked and paid)
          const att = p ? onBasis(attendanceDays({ month, today, joined: e.joined || p.joined, left: e.left || p.left, records: p.records, leaves: p.leaves, holidays: h.holidays, freeLeaves: +rules.freeLeaves || 0, detail: !!one }), rules, e) : null;
          const days = att ? clientPay({ month, emp: e, att, rules }).days : null;
          return { empId: id, code: e.code, name: e.name, daily: e.payType === 'daily', found: !!p, by: !p ? '' : h.byCode.get(String(e.code).toUpperCase()) === p ? 'code' : 'email', hrmName: p?.name || '',
            att, paid: days?.payable ?? null, of: days?.total ?? null }; })
          .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
        return send(res, 200, { connected: true, month, key, people,
          unmatched: one ? [] : h.all.filter((p) => !used.has(p)).map((p) => { const ins = p.records.filter((r) => r.checkIn).map((r) => r.date).sort();
            return { code: p.code, name: p.name, email: p.email, active: p.active, designation: p.designation, department: p.department, joined: p.joined, punched: ins.length, last: ins[ins.length - 1] || '' }; })
            .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)) });
      } catch (e) { return send(res, 200, { connected: true, month, key, error: `${pc.data.name}'s HRM could not be reached: ` + String(e?.message || e).slice(0, 160), people: [] }); }
    }
    if (path === '/import/leads' && method === 'POST') {
      if (!canEdit(user, 'leads')) throw new Rule('Your access does not allow adding leads.', 403);
      const b = await readBody(req), rows = Array.isArray(b.rows) ? b.rows.slice(0, 500) : [];
      const summary = { created: 0, merged: 0, failed: [], ids: [] }; // ids: the new leads, so a wrong import can be undone
      for (const [i, row] of rows.entries()) {
        try {
          await db.tx(async (t) => {
            const data = { name: row.name, mobile: row.mobile, email: row.email || '', company: row.company || '', service: row.service, source: row.source || 'Other', message: row.message || '' };
            const r = await beforeCreate(t, 'lead', data, user, false);
            if (r.merged) { summary.merged++; return; }
            const id = await insertRec(t, 'lead', data, user); await afterCreate(t, 'lead', id, data, user, false); summary.created++; summary.ids.push(id);
          });
        } catch (e) { summary.failed.push({ row: i + 2, error: e.message }); }
      }
      await audit(db, user, null, 'import', `Leads: ${summary.created} new, ${summary.merged} merged, ${summary.failed.length} failed`);
      return send(res, 200, summary);
    }
    // Check a number (or a pasted list) before calling: free, already with someone, or do not call. claim keeps the free ones for the caller.
    if (path === '/prospects/check' && method === 'POST') {
      if (!canSee(user, 'calls')) throw new Rule('The call register is for the Sales team and management.', 403);
      const b = await readBody(req), items = (Array.isArray(b.items) ? b.items : []).slice(0, 400);
      const batch = b.batch && /^[\w-]{4,40}$/.test(b.batch) ? { id: b.batch, at: new Date().toISOString(), src: String(b.src || '').slice(0, 40), n: items.length } : null;
      return send(res, 200, { results: await db.tx((t) => checkCalls(t, user, items, { claim: !!b.claim && canEdit(user, 'calls') && user.team === 'sales', batch })) });
    }
    if (path === '/prospects/drop' && method === 'POST') {
      if (!canEdit(user, 'calls')) throw new Rule('Your access does not allow changing the call register.', 403);
      const b = await readBody(req), r = await db.tx((t) => dropList(t, user, b.ids));
      if (r.deleted) await audit(db, user, null, 'delete', `Deleted ${r.deleted} business${r.deleted === 1 ? '' : 'es'} of an uploaded calling list${r.kept ? ` (${r.kept} already called were kept)` : ''}`);
      return send(res, 200, r);
    }
    if (path === '/prospects/rebuild' && method === 'POST') {
      if (!admin) throw new Rule('Only an admin can bring past call sheets into the register.', 403);
      const n = await db.tx((t) => rebuild(t)); await audit(db, user, null, 'calls', `Call register rebuilt from past call sheets (${n} rows read)`);
      return send(res, 200, { rows: n });
    }
    if (path === '/files' && method === 'POST') {
      const b = await readBody(req), buf = Buffer.from(String(b.data || ''), 'base64');
      if (!buf.length) throw new Rule('The file is empty.'); if (buf.length > 3_000_000) throw new Rule('That file is too large (max 3 MB).', 413);
      const today = +(await db.query("select coalesce(sum(size), 0)::bigint n from files where created_by = $1 and created_at > now() - interval '1 day'", [user.id])).rows[0].n;
      if (today + buf.length > UPLOAD_DAY) throw new Rule('You have uploaded a lot today. Share bigger files as a link (Google Drive), or try again tomorrow.', 429);
      const id = newId('f_');
      await db.query('insert into files (id, name, mime, size, data, created_by) values ($1,$2,$3,$4,$5,$6)', [id, String(b.name || 'file').slice(0, 200), String(b.mime || 'application/octet-stream').slice(0, 100), buf.length, buf, user.id]);
      return send(res, 200, { id, name: b.name, mime: b.mime, size: buf.length });
    }
    m = path.match(/^\/files\/([\w-]+)$/);
    if (m && method === 'GET') {
      const f = (await db.query('select * from files where id = $1', [m[1]])).rows[0]; if (!f) throw new Rule('File not found.', 404);
      // Who may open a file (audit ACB-4): the person who uploaded it, management, anyone for a profile photo, and anyone who can
      // open an item the file is attached to. Having the link alone is not enough. The signed copy of an agreement opens only for
      // the people who may see agreements – management and admins included.
      if (f.created_by !== user.id && !(await db.query('select 1 from users where photo = $1', [f.id])).rowCount) {
        const holders = (await db.query('select * from records where deleted_at is null and strpos(data::text, $1) > 0', ['"' + f.id + '"'])).rows;
        const open = holders.filter((r) => !hiddenFrom(user, r.type));
        if (!(isTop(user) && (!holders.length || open.length))) {
          const acc = open.length ? await access() : null;
          if (!open.some((r) => acc.read(r) === true)) throw new Rule('File not found.', 404);
        }
      }
      const show = SHOWN_INLINE.test(f.mime);
      return send(res, 200, Buffer.from(f.data), { 'content-type': show ? f.mime : 'application/octet-stream', 'content-disposition': `${show ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name)}"`, 'cache-control': 'private, max-age=86400',
        ...(f.mime === 'application/pdf' ? {} : { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }) });
    }
    // Settings → WhatsApp: is it linked, the template to set up in WhatsApp Manager, who gets the reports, and the latest messages.
    if (path === '/whatsapp' && method === 'GET') {
      if (!(admin || isTop(user))) throw new Rule('WhatsApp settings are for management and the admin.', 403);
      const people = (await db.query("select id, name, phone from users where active and removed_at is null and team = 'management' and title <> 'admin' order by name")).rows.map((u) => ({ id: u.id, name: u.name, number: waNumber(u.phone) }));
      const recent = (await db.query("select o.id, o.kind, o.to_user, o.status, o.tries, o.error, o.created_at, o.sent_at, r.data->>'owner' as writer, r.data->>'date' as date from outbox o left join records r on r.id = o.ref order by o.id desc limit 30")).rows;
      return send(res, 200, { ready: waReady(), template: { ...waTemplate(), text: REPORT_TEMPLATE }, people, recent });
    }
    if (path === '/whatsapp/template' && method === 'GET') {
      if (!(admin || isTop(user))) throw new Rule('WhatsApp settings are for management and the admin.', 403);
      return send(res, 200, await checkTemplate());
    }
    if (path === '/whatsapp/test' && method === 'POST') {
      if (!(admin || isTop(user))) throw new Rule('WhatsApp settings are for management and the admin.', 403);
      try { await queueTest(db, user); } catch (e) { throw new Rule(e.message); }
      await sendWa(db, true); return send(res, 200, { ok: true });
    }
    // ---------- admin ----------
    m = path.match(/^\/settings\/(\w+)$/);
    if (m && method === 'PUT') {
      if (m[1] === 'payroll' ? !canEdit(user, 'payroll') : m[1] === 'leadSeesReports' ? user.title !== 'ops' : m[1] === 'waReports' ? !(admin || user.title === 'ops') : !admin) throw new Rule(m[1] === 'payroll' ? 'Payroll rules are set by HR.' : m[1] === 'leadSeesReports' ? 'Only the Operations Manager can change this switch.' : 'Only an admin can change settings.', 403);
      if (!SETTING_KEYS.includes(m[1])) throw new Rule('Unknown setting.');
      if (m[1] === 'agreements' && user.title !== 'ops') throw new Rule('The standard wording of agreements is set by the Operations Manager.', 403);
      const b = await readBody(req); if (m[1] === 'payroll') b.value = cleanRules(b.value);
      await setSetting(db, m[1], b.value); await audit(db, user, null, 'settings', m[1]);
      return send(res, 200, { ok: true });
    }
    if (path === '/users' && method === 'POST') {
      const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
      const surname = String(b.surname || '').trim().slice(0, 60), fullName = b.firstName !== undefined ? [String(b.firstName).trim().slice(0, 60), surname].filter(Boolean).join(' ') : String(b.name || '').trim();
      if (b.firstName !== undefined && (!String(b.firstName).trim() || !surname)) throw new Rule('Enter both the name and the surname.');
      if (!fullName || !email) throw new Rule('Enter name, email and a password.'); if (passwordProblem(b.password)) throw new Rule(passwordProblem(b.password));
      if (b.title && !TITLE_TEAM[b.title]) throw new Rule('Choose a role from the list.');
      if (!admin && !(juniors.includes(b.title) && !b.isAdmin)) throw new Rule(juniors.length ? 'You can add members to your own team only.' : 'Only an admin or a department manager can add people.', 403);
      // A department manager adds people into their own company; only management chooses or changes the company.
      const team = TITLE_TEAM[b.title] || 'sales', company = team === 'management' ? GROUP : admin ? b.company : COMPANIES.includes(user.company) ? user.company : COMPANIES[0];
      if (team !== 'management' && !COMPANIES.includes(company)) throw new Rule('Choose the company this person works for.');
      const designation = String(b.designation || '').trim().slice(0, 80);
      if (!designation) throw new Rule('Enter the designation.');
      const personal = cleanPersonal(b.personalEmail);
      const id = newId('u_');
      try { await db.query('insert into users (id, email, name, title, team, phone, is_admin, pass_hash, company, designation, surname, personal_email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [id, email, fullName, b.title || 'bde', team, b.phone || '', !!b.isAdmin, hashPassword(b.password), company, designation, b.firstName !== undefined ? surname : '', personal]); }
      catch (e) { if (String(e.message).includes('unique') || e.code === '23505') { const ex = (await db.query('select name, removed_at from users where email = $1', [email])).rows[0];
        throw new Rule(ex?.removed_at ? `This email belongs to ${ex.name}, who was removed earlier. Restore them from the Staff register instead.` : 'Someone already uses that email.'); } throw e; }
      await audit(db, user, null, 'user', `Added ${email}`);
      return send(res, 200, { user: publicUser((await db.query('select * from users where id = $1', [id])).rows[0]) });
    }
    m = path.match(/^\/users\/([\w-]+)$/);
    if (m && method === 'PATCH') {
      const b = await readBody(req), self = m[1] === user.id;
      const u = (await db.query('select * from users where id = $1', [m[1]])).rows[0]; if (!u) throw new Rule('Person not found.', 404);
      if (u.removed_at) throw new Rule('This person was removed. Restore them from the Staff register first.');
      const lead = !admin && !self && juniors.includes(u.title) && !u.is_admin; // a manager looking after their own team member
      const chairHr = user.title === 'chairman' && !self && Object.keys(b).length === 1 && 'hr' in b; // the Chairman appoints HR, and that is all he changes here
      if (!admin && !self && !lead && !chairHr) throw new Rule('You can change members of your own team only.', 403);
      // A department manager can set a password and switch a member off or on. Name, designation, company and access are for management.
      if (lead && ['title', 'company', 'designation', 'firstName', 'surname', 'name', 'phone'].some((k) => b[k] !== undefined)) throw new Rule('Only management can change a person\'s details, company or access.', 403);
      let nSurname = u.surname || '';
      if (b.firstName !== undefined && (admin || lead || self)) { const fn = String(b.firstName).trim().slice(0, 60); nSurname = String(b.surname || '').trim().slice(0, 60);
        if (!fn || !nSurname) throw new Rule('Enter both the name and the surname.'); b.name = `${fn} ${nSurname}`; }
      if (b.name !== undefined && !admin) delete b.name; // a person's full name is set by management; they choose only how it is shown
      const next = { name: b.name ?? u.name, phone: b.phone ?? u.phone, title: admin || lead ? (b.title ?? u.title) : u.title, active: admin || lead ? (b.active ?? u.active) : u.active, is_admin: admin ? (b.isAdmin ?? u.is_admin) : u.is_admin };
      if (self && next.active === false) throw new Rule("You can't switch off your own account.");
      if (b.company !== undefined && (admin || lead) && !COMPANIES.includes(b.company) && (TITLE_TEAM[next.title] || u.team) !== 'management') throw new Rule('Choose a company from the list.');
      const nTeam = TITLE_TEAM[next.title] || u.team, nCompany = nTeam === 'management' ? GROUP : (admin || lead) && COMPANIES.includes(b.company) ? b.company : COMPANIES.includes(u.company) ? u.company : COMPANIES[0];
      const nDesig = (admin || lead) && b.designation !== undefined ? String(b.designation).trim().slice(0, 80) : u.designation || '';
      // Display name: only parts of the person's own name. Photo: a picture already uploaded to the files store.
      let nDisplay = u.display || '', nPhoto = u.photo || '';
      if (b.display !== undefined && (self || admin)) { nDisplay = String(b.display).trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!displayOk(nDisplay, next.name)) throw new Rule(`The display name must be made from ${self ? 'your' : 'the person\'s'} own name (${next.name}), for example "${next.name.split(' ')[0]}".`); }
      else if (!displayOk(nDisplay, next.name)) nDisplay = ''; // the full name was corrected and the old display name no longer fits
      if (b.photo !== undefined && (self || admin)) { nPhoto = String(b.photo || '');
        if (nPhoto) { const ph = (await db.query('select mime from files where id = $1', [nPhoto])).rows[0]; if (!ph || !PHOTO.test(ph.mime)) throw new Rule('Choose a picture file for the photo (JPG or PNG).'); } }
      // "HR & payroll": only the Company Secretary can hold it (the user's rule); the Operations Manager reviews payroll, the Chairman is not on it.
      if (b.hr !== undefined && !!b.hr !== !!u.hr) {
        // Switched ON only by the Founder & Chairman (the user's rule, after the payroll review): nobody who runs or reviews payroll can give
        // themselves – or a second login of theirs – the right to change it. Switched OFF by the Chairman, an admin, or the person themselves.
        if (b.hr ? user.title !== 'chairman' : !(admin || self || user.title === 'chairman')) throw new Rule(b.hr ? 'Only the Founder & Chairman can switch HR & payroll on.' : 'Only an admin or the Chairman can switch HR & payroll off.', 403);
        if (b.hr && (!u.active || u.removed_at)) throw new Rule('This person cannot sign in now, so they cannot be HR.');
        if (b.hr && next.title !== HR_TITLE) throw new Rule('HR & payroll can be given only to the Company Secretary.');
        await db.query('update users set hr = $2 where id = $1', [u.id, !!b.hr]); await audit(db, user, null, 'people', `${u.name}: HR & payroll ${b.hr ? 'on' : 'off'}`);
        await tellHrChange(db, user, `${user.name} switched HR & payroll ${b.hr ? 'ON' : 'off'} for ${u.name}.`);
        if (!self) await notify(db, u.id, b.hr ? `${user.name} gave you HR & payroll: you can now enter salaries and make the payroll.` : `${user.name} switched off your HR & payroll access.`, 'payroll', '', user);
      }
      if (next.title !== HR_TITLE && u.hr) await db.query('update users set hr = false where id = $1', [u.id]); // no longer the Company Secretary
      if (b.personalEmail !== undefined) await db.query('update users set personal_email = $2 where id = $1', [u.id, cleanPersonal(b.personalEmail)]); // self, admin or their manager (checked above)
      await db.query('update users set name=$2, phone=$3, title=$4, team=$5, active=$6, is_admin=$7, company=$8, designation=$9, surname=$10, display=$11, photo=$12, updated_at=now() where id=$1',
        [u.id, next.name, next.phone, next.title, nTeam, next.active, next.is_admin, nCompany, nDesig, nSurname, nDisplay, nPhoto]);
      if (b.password) {
        if (passwordProblem(b.password)) throw new Rule(passwordProblem(b.password));
        // Changing your own password always needs the current one – an admin too – so an unlocked computer is not enough to take the account.
        if (self && !checkPassword(String(b.currentPassword || ''), u.pass_hash)) throw new Rule('Your current password is not right.');
        await db.query('update users set pass_hash = $2 where id = $1', [u.id, hashPassword(b.password)]);
        // A password set by someone else switches HR & payroll off: nobody can take over the HR login to change payroll (review).
        if (!self && u.hr) { await db.query('update users set hr = false where id = $1', [u.id]); await audit(db, user, null, 'people', `${u.name}: HR & payroll off (password set by ${user.name})`);
          await tellHrChange(db, user, `${user.name} set a new password for ${u.name}, so HR & payroll was switched off for them. Switch it on again if that is right.`); }
        // The Operations Manager reads payroll, so a password set for him by someone else is always reported to the Chairman.
        if (!self && u.title === 'ops') await tellHrChange(db, user, `${user.name} set a new password for ${u.name} (Operations Manager).`);
        // Every other device is signed out; the person changing their own password stays signed in here.
        await db.query('delete from sessions where user_id = $1 and token_hash <> $2', [u.id, self ? await sessionKey(db, readCookie(req, 'aali_session')) : '']);
      }
      await audit(db, user, null, 'user', `Updated ${u.email}`);
      return send(res, 200, { user: publicUser((await db.query('select * from users where id = $1', [u.id])).rows[0]) });
    }
    // Sign a person out of every device (for example a lost phone).
    m = path.match(/^\/users\/([\w-]+)\/signout$/);
    if (m && method === 'POST') {
      const u = (await db.query('select * from users where id = $1', [m[1]])).rows[0]; if (!u) throw new Rule('Person not found.', 404);
      if (!admin && !(juniors.includes(u.title) && !u.is_admin)) throw new Rule('You can do this for members of your own team only.', 403);
      await db.query('delete from sessions where user_id = $1', [u.id]); await audit(db, user, null, 'user', `Signed out ${u.email} everywhere`);
      return send(res, 200, { ok: true });
    }
    // What a person has in the system, so the screen can say whether they can be removed.
    m = path.match(/^\/users\/([\w-]+)\/work$/);
    if (m && method === 'GET') {
      if (!admin) throw new Rule('Only an admin can check this.', 403);
      return send(res, 200, await userWork(db, m[1], user));
    }
    // Remove a person from the team. Like an HR register, the person is never erased: they lose access and move to the
    // Staff register with everything they did, and can be restored.
    m = path.match(/^\/users\/([\w-]+)$/);
    if (m && method === 'DELETE') {
      if (!admin) throw new Rule('Only an admin can remove a person.', 403);
      if (m[1] === user.id) throw new Rule("You can't remove your own account.");
      const b = await readBody(req), reason = String(b.reason || '').trim().slice(0, 200);
      if (reason.length < 3) throw new Rule('Write why this person is being removed.');
      const u = (await db.query('select * from users where id = $1', [m[1]])).rows[0]; if (!u) throw new Rule('Person not found.', 404);
      await db.query('delete from sessions where user_id = $1', [u.id]);
      await db.query('update users set active = false, removed_at = now(), removed_by = $2, removed_reason = $3, updated_at = now() where id = $1', [u.id, user.id, reason]);
      await audit(db, user, null, 'user', `Removed ${u.email} (${u.name}) – ${reason}`);
      return send(res, 200, { user: publicUser((await db.query('select * from users where id = $1', [u.id])).rows[0]) });
    }
    m = path.match(/^\/users\/([\w-]+)\/restore$/);
    if (m && method === 'POST') {
      if (!admin) throw new Rule('Only an admin can restore a person.', 403);
      const u = (await db.query('select * from users where id = $1', [m[1]])).rows[0]; if (!u) throw new Rule('Person not found.', 404);
      await db.query("update users set active = true, removed_at = null, removed_by = null, removed_reason = '', updated_at = now() where id = $1", [u.id]);
      await audit(db, user, null, 'user', `Restored ${u.email} (${u.name})`);
      return send(res, 200, { user: publicUser((await db.query('select * from users where id = $1', [u.id])).rows[0]) });
    }
    // Staff register: every person ever added, with when they last signed in.
    if (path === '/staff' && method === 'GET') {
      if (!admin && !isTop(user)) throw new Rule('Only management can open the staff register.', 403);
      const [us, logins] = await Promise.all([db.query('select * from users order by name'), db.query("select user_id, max(at) as at, count(*)::int n from audit where action = 'login' group by user_id")]);
      const last = new Map(logins.rows.map((r) => [r.user_id, r]));
      return send(res, 200, { staff: us.rows.map((u) => ({ ...publicUser(u), lastLogin: last.get(u.id)?.at || null, logins: last.get(u.id)?.n || 0 })) });
    }
    m = path.match(/^\/users\/([\w-]+)\/history$/);
    if (m && method === 'GET') {
      if (!admin && !isTop(user)) throw new Rule('Only management can open a person\'s history.', 403);
      const u = (await db.query('select * from users where id = $1', [m[1]])).rows[0]; if (!u) throw new Rule('Person not found.', 404);
      const rows = (await db.query("select a.at, a.summary, a.user_id from audit a where a.action = 'user' and a.summary ilike $1 order by a.at desc limit 100", ['%' + u.email + '%'])).rows;
      return send(res, 200, { history: rows, work: await userWork(db, u.id, user) });
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
