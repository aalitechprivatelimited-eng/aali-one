// End-to-end API tests against an in-process PGlite database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handle } from '../server/app.js';
import { getDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

process.env.PGLITE_DIR = 'memory://';
function call(method, path, body, cookie = '') {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url: '/api' + path, headers: { cookie, 'content-type': 'application/json' } });
  return new Promise((resolve) => {
    const res = { status: 0, headers: {}, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) {
      const txt = Buffer.isBuffer(b) ? b.toString() : b; let json; try { json = JSON.parse(txt); } catch { json = txt; }
      resolve({ status: this.status, body: json, cookie: (this.headers['set-cookie'] || '').split(';')[0] }); } };
    handle(req, res);
  });
}
const add = async (c, type, data) => { const r = await call('POST', '/records', { type, data }, c); if (r.status !== 200) throw new Error(r.body.error); return r.body; };
const patch = (c, id, data) => call('PATCH', '/records/' + id, { data }, c);

let admin, bde1, bde2;
test('setup and logins', async () => {
  const s = await call('POST', '/setup', { name: 'Nikhil', email: 'ops@test.in', password: 'password123' });
  assert.equal(s.status, 200); admin = s.cookie;
  const db = await getDb();
  for (const [id, email, title] of [['u_b1', 'b1@test.in', 'bde'], ['u_b2', 'b2@test.in', 'bde'], ['u_it', 'it@test.in', 'itmgr']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email, title, title === 'bde' ? 'sales' : 'it', hashPassword('password123')]);
  bde1 = (await call('POST', '/auth/login', { email: 'b1@test.in', password: 'password123' })).cookie;
  bde2 = (await call('POST', '/auth/login', { email: 'b2@test.in', password: 'password123' })).cookie;
  assert.equal((await call('POST', '/auth/login', { email: 'b1@test.in', password: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/bootstrap')).status, 401);
});

test('leads: round-robin, duplicate mobile+service merges, new service keeps BDE', async () => {
  const a = await add(admin, 'lead', { name: 'Ravi', mobile: '98765 43210', service: 'Website – 5 pages', source: 'Walk-in' });
  const b = await add(admin, 'lead', { name: 'Sita', mobile: '9000000001', service: 'Mobile app (Android + iOS)', source: 'Referral' });
  assert.notEqual(a.record.owner, b.record.owner, 'turns alternate between BDEs');
  const again = await call('POST', '/public/enquiry', { name: 'Ravi K', mobile: '+91 98765-43210', service: 'Website – 5 pages', message: 'Still interested' });
  assert.equal(again.body.merged, true);
  const other = await add(admin, 'lead', { name: 'Ravi', mobile: '9876543210', service: 'SEO & digital marketing' });
  assert.equal(other.record.owner, a.record.owner); assert.equal(other.record.existingClient, true);
  const bad = await call('POST', '/records', { type: 'lead', data: { name: 'X', mobile: '123', service: 'Website – 5 pages' } }, admin);
  assert.equal(bad.status, 400);
});

test('quotes: numbering, discount approval, deal value follows', async () => {
  const deal = (await add(bde1, 'deal', { title: 'Website – Sunrise', phone: '9876543210', value: 0 })).record;
  const q1 = (await add(bde1, 'quote', { dealId: deal.id, date: '2026-09-30', items: [{ desc: 'Site', qty: 1, rate: 40000 }], taxMode: 'intra', taxRate: 18, discountType: 'percent', discountValue: 20 })).record;
  const q2 = (await add(bde1, 'quote', { date: '2026-09-30', items: [{ desc: 'App', qty: 1, rate: 1000 }], taxMode: 'none' })).record;
  assert.equal(q1.number, 'AC/2026-27/001'); assert.equal(q2.number, 'AC/2026-27/002');
  assert.equal(q1.status, 'needs approval'); assert.equal(q1.totals.total, 37760);
  const boot = (await call('GET', '/bootstrap', null, admin)).body;
  const appr = boot.records.find((r) => r.type === 'approval' && r.relId === q1.id); assert.ok(appr);
  assert.equal((await patch(bde1, appr.id, { status: 'approved' })).status, 403);
  assert.equal((await patch(admin, appr.id, { status: 'approved' })).status, 200);
  const d = (await call('GET', '/bootstrap', null, admin)).body.records.find((r) => r.id === deal.id);
  assert.equal(d.value, 37760); assert.equal(d.quoteNo, 'AC/2026-27/001');
  const del = await call('DELETE', '/records/' + q2.id, { reason: 'no' }, bde1); assert.equal(del.status, 400);
  assert.equal((await call('DELETE', '/records/' + q2.id, { reason: 'Made by mistake' }, bde1)).status, 200);
  const q3 = (await add(bde1, 'quote', { date: '2026-09-30', items: [{ desc: 'x', qty: 1, rate: 1 }], taxMode: 'none' })).record;
  assert.equal(q3.number, 'AC/2026-27/003', 'deleted numbers are never reused');
});

test('advance gate, receipt unlocks project, sign-off makes it live', async () => {
  const deal = (await add(bde1, 'deal', { title: 'App – Kaveri', stage: 'won', handoff: { advance: false } })).record;
  const proj = (await add(bde1, 'project', { name: 'App – Kaveri', dealId: deal.id, stage: 'awaiting', deadline: '2026-11-30' })).record;
  const blocked = await patch(bde1, proj.id, { stage: 'planning' }); assert.equal(blocked.status, 400); assert.match(blocked.body.error, /No advance/);
  const pay = (await add(bde1, 'payment', { title: 'Advance', kind: 'advance', dealId: deal.id, amount: 50000, due: '2026-10-02' })).record;
  const rc = (await add(bde1, 'receipt', { date: '2026-09-30', paymentId: pay.id, items: [{ desc: 'Advance', amount: 50000, incl: true }], taxMode: 'intra', taxRate: 18 })).record;
  assert.match(rc.number, /^ACY-300926\/001$/);
  const all = (await call('GET', '/bootstrap', null, admin)).body.records;
  assert.equal(all.find((r) => r.id === proj.id).stage, 'planning');
  assert.equal(all.find((r) => r.id === pay.id).status, 'paid');
  assert.equal((await patch(bde1, rc.id, { date: '2026-10-01' })).status, 400, 'receipt date is frozen');
  assert.equal((await patch(bde1, proj.id, { deadline: '2026-11-15' })).status, 400, 'deadline change needs a reason');
  assert.equal((await patch(bde1, proj.id, { deadline: '2026-11-15', _reason: 'Client launch event' })).status, 200);
  assert.equal((await patch(bde1, proj.id, { stage: 'live' })).status, 400, 'live needs sign-off');
  const so = (await add(bde1, 'signoff', { projectId: proj.id, signerName: 'Suresh', signature: 'data:image/png;base64,AA', confirmed: true, rating: 5 })).record;
  assert.match(so.certNo, /^DAC-\d{8}-001$/);
  const p2 = (await call('GET', '/bootstrap', null, admin)).body.records.find((r) => r.id === proj.id);
  assert.equal(p2.stage, 'live'); assert.equal(p2.signoffId, so.id);
  const pub = await call('GET', '/public/progress/' + p2.progressToken); assert.equal(pub.status, 200); assert.equal(pub.body.stage, 'live');
});

test('recurring task makes the next one; mentions notify', async () => {
  const t1 = (await add(admin, 'task', { title: 'Backup sites', due: '2026-10-05', recurrence: 'weekly', owner: 'u_b1' })).record;
  await patch(admin, t1.id, { status: 'done' });
  const recs = (await call('GET', '/bootstrap', null, admin)).body.records;
  assert.ok(recs.some((r) => r.type === 'task' && r.title === 'Backup sites' && r.due === '2026-10-12' && r.status === 'todo'));
  await add(admin, 'comment', { relType: 'task', relId: t1.id, text: '@b1 check this', mentions: ['u_b1'] });
  const mine = (await call('GET', '/bootstrap', null, bde1)).body.records.filter((r) => r.type === 'notice' && r.to === 'u_b1');
  assert.ok(mine.some((n) => /mentioned you/.test(n.text)));
});

test('daily reports: one per day, private to writer + manager + top, submit locks, send back', async () => {
  const db = await getDb();
  for (const [id, email, title, team] of [['u_sm', 'sm@test.in', 'salesmgr', 'sales'], ['u_ch', 'ch@test.in', 'chairman', 'management']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email, title, team, hashPassword('password123')]);
  const login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  const sm = await login('sm@test.in'), ch = await login('ch@test.in'), it = await login('it@test.in');
  const r = (await add(bde1, 'report', { entries: [], owner: 'u_b2', status: 'submitted' })).record;
  assert.equal(r.owner, 'u_b1'); assert.equal(r.team, 'sales'); assert.equal(r.status, 'open');
  assert.equal((await add(bde1, 'report', {})).record.id, r.id, 'second report the same day is the same one');
  assert.equal((await call('POST', '/records', { type: 'report', data: { date: '2999-01-01' } }, bde1)).status, 400);
  const sees = async (c) => (await call('GET', '/bootstrap', null, c)).body.records.some((x) => x.id === r.id);
  assert.equal(await sees(bde1), true); assert.equal(await sees(bde2), false, 'another BDE cannot read it');
  assert.equal(await sees(it), false, 'the IT manager cannot read a sales report');
  assert.equal(await sees(sm), true); assert.equal(await sees(ch), true); assert.equal(await sees(admin), true);
  assert.equal((await patch(bde2, r.id, { plan: 'x' })).status, 403);
  assert.equal((await patch(sm, r.id, { plan: 'x' })).status, 403, 'a manager cannot rewrite it');
  assert.equal((await patch(bde1, r.id, { status: 'submitted' })).status, 400, 'empty report cannot be submitted');
  const up = await patch(bde1, r.id, { entries: [{ text: 'Called 20 clinics', kind: 'Calling', mins: '95' }], nums: { calls: 20 } });
  assert.equal(up.status, 200); assert.equal(up.body.record.entries.length, 1);
  assert.equal(up.body.record.entries[0].kind, 'Calling'); assert.equal(up.body.record.entries[0].mins, 95);
  const since = new Date(Date.now() - 5e3).toISOString();
  assert.ok((await call('GET', '/changes?since=' + encodeURIComponent(since), null, sm)).body.records.some((x) => x.id === r.id), 'the manager gets the update live');
  assert.ok(!(await call('GET', '/changes?since=' + encodeURIComponent(since), null, bde2)).body.records.some((x) => x.id === r.id));
  assert.equal((await patch(sm, r.id, { _reviewed: true })).status, 400, 'review only after submit');
  assert.equal((await patch(bde1, r.id, { status: 'submitted' })).status, 200);
  assert.equal((await patch(bde1, r.id, { entries: [] })).status, 400, 'locked after submit');
  assert.ok((await call('GET', '/bootstrap', null, sm)).body.records.some((x) => x.type === 'notice' && x.relId === r.id));
  assert.equal((await patch(ch, r.id, { _remark: 'Good' })).status, 200);
  assert.equal((await patch(ch, r.id, { status: 'open', _remark: 'Redo' })).status, 403, 'the Chairman reads and remarks only');
  assert.equal((await patch(sm, r.id, { _reviewed: true })).body.record.reviewed.by, 'u_sm');
  assert.equal((await patch(sm, r.id, { status: 'open' })).status, 400, 'send back needs a remark');
  const back = await patch(admin, r.id, { status: 'open', _remark: 'Add the numbers' });
  assert.equal(back.status, 200); assert.equal(back.body.record.reviewed, undefined); assert.equal(back.body.record.remarks.length, 2);
  assert.equal((await call('DELETE', '/records/' + r.id, {}, bde2)).status, 403);
});

test('changes feed and admin-only actions', async () => {
  const since = new Date(Date.now() - 60e3).toISOString();
  const ch = await call('GET', '/changes?since=' + encodeURIComponent(since), null, bde1);
  assert.equal(ch.status, 200); assert.ok(ch.body.records.length > 0);
  assert.equal((await call('PUT', '/settings/business', { value: { name: 'X' } }, bde1)).status, 403);
  assert.equal((await call('GET', '/trash', null, admin)).status, 200);
  assert.equal((await call('POST', '/users', { name: 'New', email: 'n@test.in', password: 'password123', title: 'bde', company: 'Aali Conssultancy', designation: 'BDE - Sales' }, admin)).status, 200);
});

test('daily reports: top management does not write one; IT Team Lead switch', async () => {
  const db = await getDb();
  for (const [id, email, title] of [['u_tl', 'tl@test.in', 'itlead'], ['u_dev', 'dev@test.in', 'dev'], ['u_ops', 'ops2@test.in', 'ops']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email, title, title === 'ops' ? 'management' : 'it', hashPassword('password123')]);
  const login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  const tl = await login('tl@test.in'), dev = await login('dev@test.in'), ops = await login('ops2@test.in'), it = await login('it@test.in');
  assert.equal((await call('POST', '/records', { type: 'report', data: {} }, ops)).status, 400);
  const r = (await add(dev, 'report', { entries: [{ text: 'Built the login page' }] })).record;
  const mgr = (await add(it, 'report', { entries: [{ text: 'Reviewed projects' }] })).record;
  const sees = async (c, id) => (await call('GET', '/bootstrap', null, c)).body.records.some((x) => x.id === id);
  assert.equal(await sees(tl, r.id), false, 'off by default');
  assert.equal((await patch(tl, r.id, { _remark: 'hi' })).status, 403);
  assert.equal((await call('PUT', '/settings/leadSeesReports', { value: true }, tl)).status, 403);
  assert.equal((await call('PUT', '/settings/leadSeesReports', { value: true }, admin)).status, 403, 'only the Operations Manager flips the switch');
  assert.equal((await call('PUT', '/settings/leadSeesReports', { value: true }, ops)).status, 200);
  assert.equal(await sees(tl, r.id), true); assert.equal(await sees(tl, mgr.id), false, "not the IT Manager's report");
  assert.equal((await patch(tl, r.id, { _remark: 'Nice' })).status, 200);
  assert.equal((await call('PUT', '/settings/leadSeesReports', { value: false }, ops)).status, 200);
  assert.equal(await sees(tl, r.id), false);
});

test('managers add and look after members of their own team only', async () => {
  const login = async (e, p = 'password123') => (await call('POST', '/auth/login', { email: e, password: p })).cookie;
  const sm = await login('sm@test.in'), it = await login('it@test.in');
  const mk = (c, title, email, extra = {}) => call('POST', '/users', { name: 'New ' + title, email, password: 'password123', title, company: 'Aali Conssultancy', designation: 'Member', ...extra }, c);
  assert.equal((await mk(bde1, 'bde', 'x1@test.in')).status, 403, 'a BDE cannot add people');
  const nb = await mk(sm, 'bde', 'nb@test.in'); assert.equal(nb.status, 200); assert.equal(nb.body.user.team, 'sales');
  assert.equal((await mk(sm, 'dev', 'x2@test.in')).status, 403, 'not into another team');
  assert.equal((await mk(sm, 'salesmgr', 'x3@test.in')).status, 403, 'not another manager');
  assert.equal((await mk(sm, 'bde', 'x4@test.in', { isAdmin: true })).status, 403, 'not an admin');
  assert.equal((await mk(it, 'dev', 'nd@test.in')).status, 200);
  const id = nb.body.user.id;
  assert.equal((await call('PATCH', '/users/' + id, { password: 'changed-pass1' }, sm)).status, 200);
  assert.ok(await login('nb@test.in', 'changed-pass1'));
  assert.equal((await call('PATCH', '/users/' + id, { active: false }, it)).status, 403, 'the IT manager cannot touch a BDE');
  assert.equal((await call('PATCH', '/users/' + id, { title: 'salesmgr' }, sm)).status, 403);
  assert.equal((await call('PATCH', '/users/' + id, { isAdmin: true }, sm)).body.user.isAdmin, false);
  assert.equal((await call('PATCH', '/users/' + id, { active: false }, sm)).body.user.active, false);
  assert.equal((await call('PATCH', '/users/u_it', { active: false }, sm)).status, 403);
});

test('company on staff; collaborations are for management only; task timing', async () => {
  const login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  const sm = await login('sm@test.in'), ch = await login('ch@test.in'), ops = await login('ops2@test.in');
  assert.equal((await call('POST', '/users', { name: 'No Co', email: 'noco@test.in', password: 'password123', title: 'bde', designation: 'BDE' }, admin)).status, 400, 'company is required');
  const b = await call('POST', '/users', { name: 'Builder', email: 'bld@test.in', password: 'password123', title: 'bde', company: 'Aali Builders', designation: 'BDE - Digital Marketing and Sales' }, admin);
  assert.equal(b.body.user.designation, 'BDE - Digital Marketing and Sales');
  assert.equal((await call('POST', '/users', { name: 'No Des', email: 'nodes@test.in', password: 'password123', title: 'bde', company: 'AaliTech' }, admin)).status, 400, 'designation is required');
  assert.equal((await call('PATCH', '/users/' + b.body.user.id, { designation: 'BDE - Sales' }, admin)).body.user.designation, 'BDE - Sales');
  assert.equal(b.body.user.company, 'Aali Builders');
  const m = await call('POST', '/users', { name: 'Sec', email: 'cs9@test.in', password: 'password123', title: 'cs', company: 'AaliTech', designation: 'Company Secretary' }, admin);
  assert.equal(m.body.user.company, 'Aali Group', 'management always belongs to the group');
  assert.equal((await call('PATCH', '/users/' + b.body.user.id, { company: 'AaliTech' }, admin)).body.user.company, 'AaliTech');
  assert.equal((await call('POST', '/records', { type: 'collab', data: { kind: 'college', name: 'X College' } }, sm)).status, 403);
  assert.equal((await call('POST', '/records', { type: 'collab', data: { kind: 'college', name: 'X College' } }, ch)).status, 403, 'the Chairman reads only');
  const c = (await add(ops, 'collab', { kind: 'college', name: 'ABC Engineering College', city: 'Guntur' })).record;
  const sees = async (k) => (await call('GET', '/bootstrap', null, k)).body.records.some((x) => x.id === c.id);
  assert.equal(await sees(ch), true); assert.equal(await sees(admin), true); assert.equal(await sees(sm), false); assert.equal(await sees(bde1), false);
  assert.equal((await patch(sm, c.id, { name: 'Hacked' })).status, 403);
  assert.equal((await call('DELETE', '/records/' + c.id, {}, sm)).status, 403);
  const r = (await add(bde2, 'report', { entries: [{ text: 'Poster for client', kind: 'Poster / design work', state: 'running', start: new Date().toISOString() }] })).record;
  assert.equal(r.entries[0].state, 'running'); assert.ok(r.dayStart, 'the day starts when the report is opened');
  assert.equal((await patch(bde2, r.id, { dayStart: '2000-01-01T00:00:00Z' })).body.record.dayStart, r.dayStart, 'the start time cannot be changed');
  assert.equal((await patch(bde2, r.id, { status: 'submitted' })).status, 400, 'a running task blocks submit');
  const done = await patch(bde2, r.id, { entries: [{ ...r.entries[0], state: 'done', end: new Date().toISOString(), mins: 42 }] });
  assert.equal(done.body.record.entries[0].mins, 42); assert.equal(done.body.record.entries[0].state, undefined);
  const cs = await patch(bde2, r.id, { calls: [{ org: 'Gems High School', phone: '9963522158', place: 'Bapatla', resp: 'Interested', meeting: 'Tomorrow', met: 1, note: 'Wants quotation' }, { org: '  ' }] });
  assert.equal(cs.body.record.calls.length, 1); assert.equal(cs.body.record.calls[0].met, true);
  const cur = cs.body.record.entries, v = { text: 'Website discussion', kind: 'Client visit / meeting', mins: 60 };
  assert.equal((await patch(bde2, r.id, { entries: [...cur, v] })).status, 400, 'a client visit needs the client details');
  const vis = await patch(bde2, r.id, { entries: [...cur, { ...v, visit: { client: 'Gems High School', person: 'Principal', phone: '9963522158', place: 'Bapatla' } }] });
  assert.equal(vis.status, 200); assert.equal(vis.body.record.entries[1].visit.client, 'Gems High School');
  const fin = await patch(bde2, r.id, { status: 'submitted' });
  assert.equal((await patch(bde2, r.id, { calls: [] })).status, 400, 'the call sheet is locked after submit');
  assert.equal(fin.status, 200); assert.ok(fin.body.record.dayEnd, 'the day ends at submit');
});

test('name and surname; a salesperson keeps the leads they find', async () => {
  const u = await call('POST', '/users', { firstName: 'Sana', surname: 'Sai', email: 'sana@test.in', password: 'password123', title: 'bde', company: 'Aali Conssultancy', designation: 'BDE - Sales' }, admin);
  assert.equal(u.status, 200); assert.equal(u.body.user.name, 'Sana Sai'); assert.equal(u.body.user.firstName, 'Sana'); assert.equal(u.body.user.surname, 'Sai');
  assert.equal((await call('POST', '/users', { firstName: 'Only', surname: '', email: 'only@test.in', password: 'password123', title: 'bde', company: 'AaliTech', designation: 'BDE' }, admin)).status, 400);
  const e = await call('PATCH', '/users/' + u.body.user.id, { firstName: 'Sana', surname: 'Shaik' }, admin);
  assert.equal(e.body.user.name, 'Sana Shaik'); assert.equal(e.body.user.surname, 'Shaik');
  const mine = await add(bde1, 'lead', { name: 'Elite Glam Studio', mobile: '7013644335', service: 'Website – 5 pages', source: 'Phone call' });
  assert.equal(mine.record.owner, 'u_b1', 'not passed to another BDE');
  const two = await add(bde1, 'lead', { name: 'Lotus Saloon', mobile: '9000120405', service: 'Website – 5 pages', source: 'Phone call' });
  assert.equal(two.record.owner, 'u_b1');
});

test('removing a person: only when they have no work; otherwise deactivate', async () => {
  const mk = async (e) => (await call('POST', '/users', { firstName: 'Test', surname: 'Person', email: e, password: 'password123', title: 'bde', company: 'Aali Conssultancy', designation: 'BDE' }, admin)).body.user;
  const t1 = await mk('gone1@test.in'), c1 = (await call('POST', '/auth/login', { email: 'gone1@test.in', password: 'password123' })).cookie;
  await add(c1, 'report', { entries: [{ text: 'Trying the app', kind: 'Other', mins: 5 }] });
  assert.equal((await call('DELETE', '/users/' + t1.id, null, bde1)).status, 403);
  assert.equal((await call('POST', '/users/' + t1.id + '/signout', null, admin)).status, 200);
  assert.equal((await call('GET', '/bootstrap', null, c1)).status, 401, 'signed out everywhere');
  assert.equal((await call('GET', '/users/' + t1.id + '/work', null, admin)).body.reports, 1);
  assert.equal((await call('DELETE', '/users/' + t1.id, null, admin)).status, 200, 'a test person with only a report can be removed');
  const boot = (await call('GET', '/bootstrap', null, admin)).body;
  assert.ok(!boot.users.some((u) => u.id === t1.id)); assert.ok(!boot.records.some((r) => r.type === 'report' && r.owner === t1.id));
  assert.equal((await call('POST', '/auth/login', { email: 'gone1@test.in', password: 'password123' })).status, 401);
  const busy = await call('DELETE', '/users/u_b1', null, admin);
  assert.equal(busy.status, 409); assert.match(busy.body.error, /Deactivate/);
});
