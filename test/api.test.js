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
      resolve({ status: this.status, body: json, headers: this.headers, cookie: (this.headers['set-cookie'] || '').split(';')[0] }); } };
    handle(req, res);
  });
}
const add = async (c, type, data) => { const r = await call('POST', '/records', { type, data }, c); if (r.status !== 200) throw new Error(r.body.error); return r.body; };
const patch = (c, id, data) => call('PATCH', '/records/' + id, { data }, c);

let admin, bde1, bde2, sm, it0;
test('setup and logins', async () => {
  const s = await call('POST', '/setup', { name: 'Nikhil', email: 'ops@test.in', password: 'password123' });
  assert.equal(s.status, 200); admin = s.cookie;
  const db = await getDb();
  for (const [id, email, title] of [['u_b1', 'b1@test.in', 'bde'], ['u_b2', 'b2@test.in', 'bde'], ['u_it', 'it@test.in', 'itmgr'], ['u_sm', 'sm@test.in', 'salesmgr']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email, title, title === 'itmgr' ? 'it' : 'sales', hashPassword('password123')]);
  sm = (await call('POST', '/auth/login', { email: 'sm@test.in', password: 'password123' })).cookie;
  it0 = (await call('POST', '/auth/login', { email: 'it@test.in', password: 'password123' })).cookie;
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

test('quotes: numbering, deal value follows; only the Sales Manager and management handle money papers', async () => {
  const deal = (await add(bde1, 'deal', { title: 'Website – Sunrise', phone: '9876543210', value: 0 })).record;
  const body = { dealId: deal.id, date: '2026-09-30', items: [{ desc: 'Site', qty: 1, rate: 40000 }], taxMode: 'intra', taxRate: 18, discountType: 'percent', discountValue: 20 };
  assert.equal((await call('POST', '/records', { type: 'quote', data: body }, bde1)).status, 403, 'a BDE cannot make a quotation');
  assert.equal((await call('POST', '/records', { type: 'payment', data: { title: 'Advance', amount: 1 } }, bde1)).status, 403);
  const q1 = (await add(sm, 'quote', body)).record;
  const q2 = (await add(sm, 'quote', { date: '2026-09-30', items: [{ desc: 'App', qty: 1, rate: 1000 }], taxMode: 'none' })).record;
  assert.equal(q1.number, 'AC/2026-27/001'); assert.equal(q2.number, 'AC/2026-27/002');
  assert.equal(q1.status, 'draft'); assert.ok(q1.discountApprovedAt, 'a manager\'s own discount needs no second approval'); assert.equal(q1.totals.total, 37760);
  const d = (await call('GET', '/bootstrap', null, admin)).body.records.find((r) => r.id === deal.id);
  assert.equal(d.value, 37760); assert.equal(d.quoteNo, 'AC/2026-27/001');
  const types = async (c) => new Set((await call('GET', '/bootstrap', null, c)).body.records.map((r) => r.type));
  assert.ok((await types(sm)).has('quote')); assert.ok((await types(admin)).has('quote'));
  assert.ok(!(await types(bde1)).has('quote'), 'a BDE cannot see quotations'); assert.ok(!(await types(it0)).has('quote'), 'the IT team cannot see quotations');
  assert.equal((await patch(bde1, q1.id, { status: 'sent' })).status, 403);
  assert.equal((await call('DELETE', '/records/' + q2.id, { reason: 'Made by mistake' }, bde1)).status, 403);
  const del = await call('DELETE', '/records/' + q2.id, { reason: 'no' }, sm); assert.equal(del.status, 400);
  assert.equal((await call('DELETE', '/records/' + q2.id, { reason: 'Made by mistake' }, sm)).status, 200);
  const q3 = (await add(sm, 'quote', { date: '2026-09-30', items: [{ desc: 'x', qty: 1, rate: 1 }], taxMode: 'none' })).record;
  assert.equal(q3.number, 'AC/2026-27/003', 'deleted numbers are never reused');
});

test('advance gate, receipt unlocks project, sign-off makes it live', async () => {
  const deal = (await add(bde1, 'deal', { title: 'App – Kaveri', stage: 'won', handoff: { advance: false } })).record;
  const proj = (await add(bde1, 'project', { name: 'App – Kaveri', dealId: deal.id, stage: 'awaiting', deadline: '2026-11-30', templateId: 'pt-amc' })).record;
  const recs0 = (await call('GET', '/bootstrap', null, it0)).body.records;
  assert.equal(recs0.filter((r) => r.type === 'task' && r.projectId === proj.id).length, 2, 'the template tasks are made at handoff');
  assert.ok(!recs0.some((r) => r.id === deal.id), 'the IT team cannot open the deal');
  assert.equal((await patch(bde1, proj.id, { stage: 'planning' })).status, 403, 'the BDE only views the project after handing it over');
  const blocked = await patch(it0, proj.id, { stage: 'planning' }); assert.equal(blocked.status, 400); assert.match(blocked.body.error, /No advance/);
  const pay = (await add(sm, 'payment', { title: 'Advance', kind: 'advance', dealId: deal.id, amount: 50000, due: '2026-10-02' })).record;
  const rc = (await add(sm, 'receipt', { date: '2026-09-30', paymentId: pay.id, items: [{ desc: 'Advance', amount: 50000, incl: true }], taxMode: 'intra', taxRate: 18 })).record;
  assert.match(rc.number, /^ACY-300926\/001$/);
  const all = (await call('GET', '/bootstrap', null, admin)).body.records;
  assert.equal(all.find((r) => r.id === proj.id).stage, 'planning');
  assert.equal((await call('GET', '/bootstrap', null, it0)).body.records.find((r) => r.id === proj.id).advance, true, 'IT sees that the advance has come without opening the deal');
  assert.equal(all.find((r) => r.id === pay.id).status, 'paid');
  assert.equal((await patch(sm, rc.id, { date: '2026-10-01' })).status, 400, 'receipt date is frozen');
  assert.ok(!(await call('GET', '/bootstrap', null, bde1)).body.records.some((r) => ['payment', 'receipt'].includes(r.type)), 'a BDE cannot see payments or receipts');
  assert.equal((await patch(it0, proj.id, { deadline: '2026-11-15' })).status, 400, 'deadline change needs a reason');
  assert.equal((await patch(it0, proj.id, { deadline: '2026-11-15', _reason: 'Client launch event' })).status, 200);
  assert.equal((await patch(it0, proj.id, { stage: 'live' })).status, 400, 'live needs sign-off');
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
  for (const [id, email, title, team] of [['u_ch', 'ch@test.in', 'chairman', 'management']])
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
  const nb = await mk(sm, 'bde', 'nb@test.in', { company: 'Aali Builders' }); assert.equal(nb.status, 200); assert.equal(nb.body.user.team, 'sales');
  assert.equal(nb.body.user.company, 'Aali Conssultancy', 'a manager cannot choose another company');
  for (const change of [{ company: 'AaliTech' }, { designation: 'Senior BDE' }, { firstName: 'X', surname: 'Y' }, { title: 'bde' }])
    assert.equal((await call('PATCH', '/users/' + nb.body.user.id, change, sm)).status, 403, 'only management changes ' + Object.keys(change)[0]);
  assert.equal((await call('PATCH', '/users/' + nb.body.user.id, { company: 'AaliTech', designation: 'Senior BDE' }, admin)).body.user.company, 'AaliTech');
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

test('role based level access: each role sees and changes only its own part', async () => {
  const login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  const ch = await login('ch@test.in'), dev = await login('dev@test.in'), tl = await login('tl@test.in'), ops = await login('ops2@test.in');
  const boot = async (c) => (await call('GET', '/bootstrap', null, c)).body;
  const sees = async (c, id) => (await boot(c)).records.some((r) => r.id === id);
  const post = (c, type, data) => call('POST', '/records', { type, data }, c);
  const svc = 'Website – 5 pages';

  // Leads: a BDE has only their own; the Sales Manager and management have all; IT has none.
  const l1 = (await add(bde1, 'lead', { name: 'Own Lead One', mobile: '9111111111', service: svc, source: 'Phone call' })).record;
  for (const [c, yes] of [[bde1, true], [bde2, false], [sm, true], [ch, true], [admin, true], [it0, false], [tl, false], [dev, false]]) assert.equal(await sees(c, l1.id), yes);
  assert.equal((await patch(bde2, l1.id, { score: 'hot' })).status, 403, "not another BDE's lead");
  assert.equal((await patch(bde1, l1.id, { score: 'hot' })).status, 200);
  assert.equal((await patch(bde1, l1.id, { owner: 'u_b2' })).status, 403, 'only a manager gives a lead to someone else');
  assert.equal((await patch(ch, l1.id, { score: 'cold' })).status, 403, 'the Chairman views only');
  assert.equal((await post(it0, 'lead', { name: 'X', mobile: '9333333333', service: svc })).status, 403, 'IT does not add leads');
  assert.equal((await add(bde2, 'lead', { name: 'Mine Anyway', mobile: '9222222222', service: svc, owner: 'u_b1' })).record.owner, 'u_b2', 'a BDE owns what they add');
  const rep = await post(bde2, 'lead', { name: 'Own Lead One', mobile: '9111111111', service: svc });
  assert.equal(rep.status, 409, 'a business that is with one BDE cannot be entered by another'); assert.match(rep.body.error, /already with/);
  const since = new Date(Date.now() - 2e3).toISOString();
  assert.equal((await patch(sm, l1.id, { owner: 'u_b2' })).status, 200, 'the Sales Manager can reassign');
  const ch1 = (await call('GET', '/changes?since=' + encodeURIComponent(since), null, bde1)).body.records.find((r) => r.id === l1.id);
  assert.ok(ch1.deletedAt && ch1.name === undefined, 'the lead leaves the first BDE’s screen');
  assert.equal(await sees(bde1, l1.id), false); assert.equal(await sees(bde2, l1.id), true);

  // Clients: IT gets the name only (for the project), never the contact details.
  const cl = (await add(sm, 'client', { name: 'Kaveri Foods', phone: '9444444444', owner: 'u_b1' })).record;
  const card = (await boot(it0)).records.find((r) => r.id === cl.id);
  assert.equal(card.name, 'Kaveri Foods'); assert.equal(card.card, true); assert.equal(card.phone, undefined);
  assert.equal(await sees(bde1, cl.id), true); assert.equal(await sees(bde2, cl.id), false);
  assert.equal((await patch(it0, cl.id, { name: 'Hacked' })).status, 403);

  // Projects: the IT Manager and Team Lead have all; a developer has only the ones they work on; sales views.
  const pr = (await add(it0, 'project', { name: 'Internal tool', stage: 'planning' })).record;
  assert.equal(await sees(tl, pr.id), true); assert.equal(await sees(dev, pr.id), false); assert.equal(await sees(sm, pr.id), true); assert.equal(await sees(bde1, pr.id), false);
  const tk = (await add(it0, 'task', { title: 'Build the page', projectId: pr.id, owner: 'u_dev' })).record;
  assert.equal(await sees(dev, pr.id), true, 'a task in the project brings the developer in'); assert.equal(await sees(dev, tk.id), true);
  assert.equal((await patch(dev, tk.id, { status: 'doing' })).status, 200);
  assert.equal((await post(dev, 'project', { name: 'Side project' })).status, 403, 'a developer does not create projects');
  assert.equal((await patch(tl, pr.id, { lead: 'u_tl' })).status, 403, 'the lead is set by the IT Manager');
  assert.equal((await patch(it0, pr.id, { lead: 'u_tl' })).status, 200);
  assert.equal((await patch(sm, pr.id, { stage: 'design' })).status, 403, 'the Sales Manager views projects only');
  assert.equal((await post(sm, 'task', { title: 'Sneak', projectId: pr.id })).status, 403);

  // Tasks: a personal task is private; a team list is for that team.
  const mineT = (await add(bde1, 'task', { title: 'Call the printer' })).record, teamT = (await add(bde1, 'task', { title: 'Stall at the expo', team: 'sales' })).record;
  assert.equal(await sees(bde2, mineT.id), false); assert.equal(await sees(bde2, teamT.id), true); assert.equal(await sees(dev, teamT.id), false); assert.equal(await sees(ch, mineT.id), true);
  assert.equal((await patch(bde2, teamT.id, { status: 'done' })).status, 403, "a teammate can read a team task but cannot tick someone else's task");
  assert.equal((await call('DELETE', '/records/' + teamT.id, {}, bde2)).status, 403);
  assert.equal((await patch(bde1, teamT.id, { status: 'doing' })).status, 200); assert.equal((await patch(sm, teamT.id, { status: 'done' })).status, 200, 'the manager can');

  // Display name and photo: a person chooses how their name is shown, but only from their own name; the full name is set by management.
  const self = (c, id, body) => call('PATCH', '/users/' + id, body, c), meOf = async (c) => (await boot(c)).me;
  await call('PATCH', '/users/u_b2', { name: 'Nikhilesh Venkata Sai Tanniru' }, admin);
  for (const good of ['Nikhil', 'Nikhi', 'Nikhilesh', 'Venkat', 'Sai', 'Venkata Sai']) assert.equal((await self(bde2, 'u_b2', { display: good })).status, 200, good);
  for (const bad of ['DEMIGOD', 'Sai Kumar', 'Ni', 'Sai Sai']) assert.equal((await self(bde2, 'u_b2', { display: bad })).status, 400, bad);
  assert.equal((await meOf(bde2)).name, 'Venkata Sai'); assert.equal((await meOf(bde2)).fullName, 'Nikhilesh Venkata Sai Tanniru');
  assert.equal((await boot(bde1)).users.find((u) => u.id === 'u_b2').name, 'Venkata Sai', 'everyone sees the display name');
  assert.equal((await self(bde2, 'u_b2', { name: 'Demigod' })).body.user.fullName, 'Nikhilesh Venkata Sai Tanniru', 'a person cannot rename themselves');
  assert.equal((await self(bde1, 'u_b2', { display: 'Sai' })).status, 403, "not someone else's");
  const img = (await call('POST', '/files', { name: 'me.jpg', mime: 'image/jpeg', data: Buffer.from('fakejpeg').toString('base64') }, bde2)).body, doc = (await call('POST', '/files', { name: 'a.pdf', mime: 'application/pdf', data: Buffer.from('pdf').toString('base64') }, bde2)).body;
  assert.equal((await self(bde2, 'u_b2', { photo: img.id })).body.user.photo, img.id); assert.equal((await self(bde2, 'u_b2', { photo: doc.id })).status, 400, 'a photo must be a picture');
  assert.equal((await self(bde2, 'u_b2', { photo: '' })).body.user.photo, '');
  assert.equal((await call('PATCH', '/users/u_b2', { name: 'b2@test.in', display: '' }, admin)).body.user.name, 'b2@test.in');

  // Money and settings: the Chairman looks, the Operations Manager and Company Secretary act.
  assert.equal((await post(ch, 'quote', { date: '2026-09-30', items: [{ desc: 'x', qty: 1, rate: 1 }], taxMode: 'none' })).status, 403, 'the Chairman cannot make a quotation');
  assert.ok((await boot(ch)).records.some((r) => r.type === 'quote'), 'but can see them');
  assert.equal((await post(bde1, 'target', { userId: 'u_b1', month: '2026-10', amount: 1 })).status, 403);
  assert.equal((await post(sm, 'target', { userId: 'u_b1', month: '2026-10', amount: 100000 })).status, 200);
  assert.equal((await boot(ops)).me.isAdmin, true, 'the Operations Manager is always an admin');
  assert.equal((await call('PUT', '/settings/escalateDays', { value: 3 }, ops)).status, 200);
  assert.equal((await call('PUT', '/settings/escalateDays', { value: 3 }, ch)).status, 403);
  assert.equal((await call('GET', '/audit', null, sm)).status, 403); assert.equal((await call('GET', '/audit', null, ch)).status, 200);
  // The audit log is kept short: the same person doing the same thing to the same item in a day is one line, with how many times.
  assert.equal((await call('PUT', '/settings/escalateDays', { value: 3 }, ops)).status, 200);
  const log = (await call('GET', '/audit?days=1', null, ch)).body.rows, sameSetting = log.filter((r) => r.action === 'settings' && r.summary === 'escalateDays');
  assert.ok(sameSetting.some((r) => r.n >= 2) && sameSetting.every((r) => /^\d{4}-\d\d-\d\d$/.test(r.day)), 'two changes of one setting by one person are one line of the day');
  assert.ok(log.filter((r) => r.action === 'login').every((r) => log.filter((x) => x.action === 'login' && x.user_id === r.user_id && x.day === r.day).length === 1), 'sign-ins: one line for a person in a day');
  assert.ok(log.filter((r) => r.action === 'create').every((r) => r.n === 1 || log.filter((x) => x.action === 'create' && x.record_id === r.record_id).length === 1), 'different additions stay separate lines');
  assert.equal((await call('GET', '/staff', null, ch)).status, 200); assert.equal((await call('GET', '/staff', null, sm)).status, 403);

  // Other people's login email and mobile: management, their own manager and themselves only.
  const users = async (c) => (await boot(c)).users;
  assert.equal((await users(bde1)).find((u) => u.id === 'u_it').email, ''); assert.equal((await users(bde1)).find((u) => u.id === 'u_b1').email, 'b1@test.in');
  assert.equal((await users(sm)).find((u) => u.id === 'u_b1').email, 'b1@test.in'); assert.equal((await users(sm)).find((u) => u.id === 'u_dev').email, '');
  assert.equal((await users(ch)).find((u) => u.id === 'u_dev').email, 'dev@test.in');
});

test('one business, one caller: the call register stops repeat calls', async () => {
  const B = (await call('POST', '/auth/login', { email: 'sana@test.in', password: 'password123' })).cookie, A = bde1; // A = u_b1, B = Sana
  const check = async (c, item, claim = false) => (await call('POST', '/prospects/check', { items: [item], claim }, c)).body.results[0];
  let n = 0; const row = (org, phone, resp, extra = {}) => ({ id: 'row' + ++n, at: new Date(Date.now() + n * 1000).toISOString(), org, phone, place: 'Guntur', resp, ...extra });
  const mineRep = async (c) => (await add(c, 'report', {})).record;
  const sai = { org: 'Sri Sai Medicals', phone: '90000 11111', place: 'Guntur', ind: 'Pharmacy' };

  // Check before calling: the first person keeps the number, the second is told not to call.
  assert.equal((await check(A, sai, true)).kind, 'free');
  const no = await check(B, sai, true); assert.equal(no.ok, false); assert.equal(no.kind, 'held'); assert.match(no.msg, /Do not call.*already with/);
  assert.equal((await check(A, sai)).kind, 'mine');
  // The same business under another number is caught by its name; "Different business" lets it through.
  const twin = { org: 'Sai Medicals Pvt. Ltd.', phone: '9000022222', place: 'guntur' };
  assert.equal((await check(B, twin)).kind, 'similar'); assert.equal((await check(B, { ...twin, dupOk: true })).ok, true);
  assert.equal((await check(B, { org: 'Sai Medicals', phone: '9000022223', place: 'Vijayawada', ind: 'Pharmacy' })).ok, true, 'another town is allowed, with a note');
  assert.match((await check(B, { org: 'Sai Medicals', phone: '9000022223', place: 'Vijayawada', ind: 'Pharmacy' })).msg, /may be a branch/);

  // Logging a call another person holds is refused, even without checking first.
  const rb = await mineRep(B), ra = await mineRep(A);
  assert.equal((await patch(B, rb.id, { calls: [row('Sai Medicals', '9000011111', 'Interested')] })).status, 409);
  assert.equal((await patch(B, rb.id, { calls: [row('No number shop', '', 'Busy')] })).status, 409, 'a call needs its number');
  // Three unanswered calls in a row: everyone must stop until the Sales Manager reopens it.
  let calls = ra.calls || [];
  for (let i = 0; i < 3; i++) { calls = [...calls, row('Sri Sai Medicals', '9000011111', 'No answer')]; assert.equal((await patch(A, ra.id, { calls })).status, 200); }
  assert.equal((await check(A, sai)).kind, 'tired');
  assert.equal((await patch(A, ra.id, { calls: [...calls, row('Sri Sai Medicals', '9000011111', 'Busy')] })).status, 409);
  const reg = async (c) => (await call('GET', '/bootstrap', null, c)).body.records.filter((r) => r.type === 'prospect');
  const p = (await reg(sm)).find((r) => r.phone10 === '9000011111');
  assert.equal(p.tries, 3); assert.equal(p.state, 'tired'); assert.equal(p.owner, 'u_b1'); assert.equal(p.ind, 'Pharmacy');
  assert.ok((await reg(A)).some((r) => r.id === p.id)); assert.ok(!(await reg(B)).some((r) => r.id === p.id), 'a BDE sees only their own numbers'); assert.equal((await reg(it0)).length, 0);
  assert.equal((await patch(A, p.id, { _action: 'reopen', _why: 'let me try' })).status, 403);
  assert.equal((await patch(sm, p.id, { _action: 'reopen', _why: 'Owner asked for a call back' })).status, 200);
  calls = [...calls, row('Sri Sai Medicals', '9000011111', 'Not interested')];
  assert.equal((await patch(A, ra.id, { calls })).status, 200);
  // "Not interested" closes the number for everyone, the holder included.
  assert.equal((await check(A, sai)).kind, 'closed'); assert.equal((await check(B, sai)).kind, 'closed');
  // Removing the row (written by mistake) puts the number back.
  calls = calls.slice(0, -1); assert.equal((await patch(A, ra.id, { calls })).status, 200); assert.equal((await check(A, sai)).ok, true);

  // Do Not Call list: a manager adds a number; "Asked not to call" on the sheet adds it too. Nobody can call or log it.
  assert.equal((await call('POST', '/records', { type: 'prospect', data: { phone: '9000033333', name: 'Angry Traders', reason: 'Complained about repeated calls' } }, A)).status, 403);
  const dnc = (await add(sm, 'prospect', { phone: '90000-33333', name: 'Angry Traders', reason: 'Complained about repeated calls' })).record; assert.equal(dnc.state, 'dnc');
  for (const c of [A, B, sm]) assert.equal((await check(c, { org: 'Angry Traders', phone: '9000033333' })).kind, 'dnc');
  assert.equal((await patch(A, ra.id, { calls: [...calls, row('Angry Traders', '9000033333', 'Busy')] })).status, 409);
  calls = [...calls, row('Lotus Clinic', '9000044444', 'Asked not to call')]; assert.equal((await patch(A, ra.id, { calls })).status, 200);
  assert.equal((await check(B, { org: 'Lotus Clinic', phone: '9000044444' })).kind, 'dnc');
  assert.equal((await patch(sm, dnc.id, { _action: 'reopen', _why: 'The owner called us and asked for a quotation' })).body.record.state, 'open');

  // Leads follow the same register: no second BDE, and an enquiry from the website goes to the BDE who already calls them.
  calls = [...calls, row('Hill View School', '9000055555', 'Call back')]; assert.equal((await patch(A, ra.id, { calls })).status, 200);
  assert.equal((await call('POST', '/records', { type: 'lead', data: { name: 'Hill View School', mobile: '9000055555', service: 'Website – 5 pages' } }, B)).status, 409);
  const web = await call('POST', '/public/enquiry', { name: 'Hill View School', mobile: '9000055555', service: 'Website – 5 pages' }); assert.equal(web.status, 200);
  const lead = (await call('GET', '/bootstrap', null, sm)).body.records.find((r) => r.type === 'lead' && r.mobile10 === '9000055555');
  assert.equal(lead.owner, 'u_b1', 'the enquiry goes to the BDE who holds the business');
  // The Sales Manager can give a business to someone else; then only that person may call.
  const hv = (await reg(sm)).find((r) => r.phone10 === '9000044444');
  assert.equal((await patch(sm, hv.id, { _action: 'give', owner: 'u_b2' })).body.record.owner, 'u_b2');
  assert.equal((await patch(A, hv.id, { name: 'Mine again' })).status, 403);
});

test('out of office is shown to the manager and management only; client assets reach the right manager and everyone concerned is told', async () => {
  const login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  const ch = await login('ch@test.in'), dev = await login('dev@test.in'), tl = await login('tl@test.in'), ops = await login('ops2@test.in'), A = bde1;
  const recs = async (c) => (await call('GET', '/bootstrap', null, c)).body.records, post = (c, type, data) => call('POST', '/records', { type, data }, c);
  const pres = async (c) => (await recs(c)).find((r) => r.type === 'presence' && r.user === 'u_b1');

  // A client visit that is running shows the BDE as out of the office – to the manager and management, not to teammates or another team.
  const ra = (await add(A, 'report', {})).record, now = new Date().toISOString();
  const visit = { id: 'v1', at: now, text: 'Demo of the app', kind: 'Client visit / meeting', state: 'running', start: now, visit: { client: 'Gems School', person: 'Principal', phone: '9963522158', place: 'Bapatla' } };
  assert.equal((await patch(A, ra.id, { entries: [...ra.entries, visit] })).status, 200);
  for (const c of [sm, admin, ch]) { const p = await pres(c); assert.equal(p.out, true); assert.equal(p.why, 'Going to a client – Gems School'); }
  assert.equal(await pres(bde2), undefined, 'a teammate does not see it'); assert.equal(await pres(A), undefined);
  assert.equal(await pres(it0), undefined, 'another team does not see it');
  assert.equal((await patch(A, ra.id, { entries: [...ra.entries, { ...visit, state: 'done', end: now, mins: 30 }] })).status, 200);
  assert.equal((await pres(sm)).out, false, 'back in the office when the visit is finished');
  // Going out with permission.
  const perm = { id: 'p1', at: now, text: 'Bank work', kind: 'Out of office', brk: true, out: true, state: 'running', start: now };
  assert.equal((await patch(A, ra.id, { entries: [...ra.entries, { ...visit, state: 'done', end: now, mins: 30 }, perm] })).status, 200);
  assert.equal((await pres(sm)).why, 'Permission'); assert.equal(await pres(bde2), undefined, 'a permission stays between the person, the manager and management');
  assert.equal((await post(A, 'presence', { user: 'u_b2', out: true })).status, 403, 'nobody sets it by hand');
  assert.equal((await patch(A, (await pres(sm)).id, { out: false })).status, 403);

  // Client assets: the BDE uploads and chooses the manager.
  assert.equal((await post(A, 'asset', { clientName: 'Kaveri Foods', to: 'it' })).status, 400, 'a file or a link is needed');
  assert.equal((await post(it0, 'asset', { clientName: 'Kaveri Foods', to: 'it', link: 'drive.google.com/x' })).status, 403, 'only the Sales team uploads');
  const as = (await add(A, 'asset', { clientName: 'Kaveri Foods', what: 'Video making', to: 'it', link: 'drive.google.com/x', owner: 'u_b2' })).record;
  assert.equal(as.owner, 'u_b1'); assert.equal(as.status, 'sent');
  const told = async (c, re) => (await recs(c)).some((r) => r.type === 'notice' && r.relId === as.id && re.test(r.text));
  assert.ok(await told(it0, /sent you client assets/), 'the IT Manager is told'); assert.ok(await told(sm, /to the IT Manager/), 'the Sales Manager is told too');
  assert.ok(await told(ops, /to the IT Manager/), 'the Operations Manager is told'); assert.ok(!(await told(ch, /./)), 'the Chairman is not disturbed');
  const sees = async (c, id) => (await recs(c)).some((r) => r.id === id);
  for (const [c, yes] of [[A, true], [it0, true], [sm, true], [admin, true], [ch, true], [bde2, false], [dev, false], [tl, false]]) assert.equal(await sees(c, as.id), yes);
  // The manager it was sent to gives it to a person; that person and the BDE are told.
  assert.equal((await patch(sm, as.id, { assignee: 'u_dev' })).status, 403, 'sent to IT, so the IT Manager decides');
  const given = await patch(it0, as.id, { assignee: 'u_dev' }); assert.equal(given.status, 200); assert.equal(given.body.record.status, 'allotted');
  assert.equal(await sees(dev, as.id), true); assert.ok(await told(dev, /gave you client assets/)); assert.ok(await told(A, /were given to/));
  assert.equal((await patch(A, as.id, { status: 'done' })).status, 403); assert.equal((await patch(dev, as.id, { status: 'done' })).body.record.status, 'done');
  assert.equal((await patch(ch, as.id, { note: 'x' })).status, 403, 'the Chairman views only');
  // Sent to the Sales Manager: the IT team does not see it.
  const a2 = (await add(A, 'asset', { clientName: 'Hill View School', to: 'sales', link: 'x.in/y' })).record;
  assert.equal(await sees(it0, a2.id), false); assert.equal(await sees(sm, a2.id), true);
});

test('removing a person keeps them in the staff register; they lose access and can be restored', async () => {
  const mk = async (e) => (await call('POST', '/users', { firstName: 'Test', surname: 'Person', email: e, password: 'password123', title: 'bde', company: 'Aali Conssultancy', designation: 'BDE' }, admin)).body.user;
  const t1 = await mk('gone1@test.in'), c1 = (await call('POST', '/auth/login', { email: 'gone1@test.in', password: 'password123' })).cookie;
  const rp = (await add(c1, 'report', { entries: [{ text: 'Trying the app', kind: 'Other', mins: 5 }] })).record;
  assert.equal((await call('DELETE', '/users/' + t1.id, { reason: 'Test entry' }, bde1)).status, 403);
  assert.equal((await call('DELETE', '/users/' + t1.id, { reason: '' }, admin)).status, 400, 'a reason is needed');
  const rm = await call('DELETE', '/users/' + t1.id, { reason: 'Test entry' }, admin);
  assert.equal(rm.status, 200); assert.ok(rm.body.user.removedAt); assert.equal(rm.body.user.active, false); assert.equal(rm.body.user.removedReason, 'Test entry');
  assert.equal((await call('GET', '/bootstrap', null, c1)).status, 401, 'signed out');
  assert.equal((await call('POST', '/auth/login', { email: 'gone1@test.in', password: 'password123' })).status, 401, 'cannot sign in');
  const boot = (await call('GET', '/bootstrap', null, admin)).body;
  assert.ok(boot.users.some((u) => u.id === t1.id && u.removedAt), 'still in the system'); assert.ok(boot.records.some((r) => r.id === rp.id), 'their report is kept, not sent to the bin');
  assert.equal((await call('GET', '/staff', null, bde1)).status, 403);
  const staff = (await call('GET', '/staff', null, admin)).body.staff.find((u) => u.id === t1.id);
  assert.ok(staff.lastLogin); assert.equal(staff.logins, 1);
  const hist = (await call('GET', '/users/' + t1.id + '/history', null, admin)).body;
  assert.ok(hist.history.some((h) => /Removed/.test(h.summary))); assert.equal(hist.work.reports, 1);
  assert.equal((await call('PATCH', '/users/' + t1.id, { active: true }, admin)).status, 400, 'must be restored, not just switched on');
  assert.match((await call('POST', '/users', { firstName: 'Again', surname: 'Person', email: 'gone1@test.in', password: 'password123', title: 'bde', company: 'AaliTech', designation: 'BDE' }, admin)).body.error, /Restore/);
  const back = await call('POST', '/users/' + t1.id + '/restore', null, admin);
  assert.equal(back.body.user.active, true); assert.equal(back.body.user.removedAt, null);
  assert.equal((await call('POST', '/auth/login', { email: 'gone1@test.in', password: 'password123' })).status, 200);
  assert.equal((await call('DELETE', '/users/u_b1', { reason: 'Left the company' }, admin)).status, 200, 'a person with work can be removed too; the work keeps their name');
});

test('a call back carries its day: it shows for the BDE until the business is called again', async () => {
  const login = (email) => call('POST', '/auth/login', { email, password: 'password123' });
  assert.equal((await call('POST', '/users', { firstName: 'Call', surname: 'Back', email: 'cb@test.in', password: 'password123', title: 'bde', designation: 'BDE', company: 'AaliTech' }, admin)).status, 200);
  const C = (await login('cb@test.in')).cookie, rep = (await add(C, 'report', {})).record, day = '2030-01-15';
  const reg = async () => (await call('GET', '/bootstrap', null, C)).body.records.find((r) => r.type === 'prospect' && r.phone10 === '9000077001');
  const row = (id, resp, extra = {}) => ({ id, org: 'Sunrise Tiles', phone: '9000077001', place: 'Guntur', resp, ...extra });
  assert.equal((await patch(C, rep.id, { calls: [row('k1', 'Call back', { back: day })] })).status, 200);
  assert.equal((await reg()).backOn, day); assert.equal((await call('GET', '/bootstrap', null, C)).body.records.find((r) => r.id === rep.id).calls[0].back, day);
  assert.equal((await patch(C, rep.id, { calls: [row('k1', 'Call back', { back: 'tomorrow please' })] })).body.record.calls[0].back, undefined, 'only a real date is kept');
  assert.equal((await patch(C, rep.id, { calls: [row('k1', 'Call back', { back: day }), row('k2', 'Interested', { back: day })] })).status, 200);
  assert.equal((await reg()).backOn, '', 'the next call clears the reminder'); assert.equal((await reg()).lastResp, 'Interested');
});

test('the place typed is kept, and a list kept by mistake can be deleted (only what was not called yet)', async () => {
  const login = (email) => call('POST', '/auth/login', { email, password: 'password123' });
  for (const [f, e] of [['Place', 'pl1@test.in'], ['Other', 'pl2@test.in']]) assert.equal((await call('POST', '/users', { firstName: f, surname: 'Bde', email: e, password: 'password123', title: 'bde', designation: 'BDE', company: 'AaliTech' }, admin)).status, 200);
  const P = (await login('pl1@test.in')).cookie, O = (await login('pl2@test.in')).cookie;
  const check = async (c, items, extra = {}) => (await call('POST', '/prospects/check', { items, claim: true, ...extra }, c)).body.results;
  const reg = async (c, m) => (await call('GET', '/bootstrap', null, c)).body.records.find((r) => r.type === 'prospect' && r.phone10 === m);
  // Kept before the place was typed, then kept again with it: the place is saved (it used to be lost).
  assert.equal((await check(P, [{ org: 'Lakshmi Bakery', phone: '9000088001' }]))[0].kind, 'free');
  assert.equal((await check(P, [{ org: 'Lakshmi Bakery', phone: '9000088001', place: 'Tenali', ind: 'Retail shop' }]))[0].kind, 'mine');
  assert.equal((await reg(P, '9000088001')).place, 'Tenali'); assert.equal((await reg(P, '9000088001')).ind, 'Retail shop');
  // A call row with a place fills the register's empty place too.
  await check(P, [{ org: 'Ravi Opticals', phone: '9000088009' }]); const rep = (await add(P, 'report', {})).record;
  assert.equal((await patch(P, rep.id, { calls: [{ id: 'pl-a', org: 'Ravi Opticals', phone: '9000088009', place: 'Bapatla', resp: 'Busy' }] })).status, 200);
  assert.equal((await reg(P, '9000088009')).place, 'Bapatla');
  // An uploaded list is one list: it can be deleted, but a business already called stays.
  const items = [1, 2, 3].map((i) => ({ org: 'List shop ' + i, phone: '900008810' + i, place: 'Guntur', src: 'Google Maps' }));
  const got = await check(P, items, { batch: 'list-test-1', src: 'Google Maps' }); assert.ok(got.every((v) => v.ok));
  assert.equal((await reg(P, '9000088101')).batch.id, 'list-test-1');
  assert.equal((await patch(P, rep.id, { calls: [{ id: 'pl-a', org: 'Ravi Opticals', phone: '9000088009', place: 'Bapatla', resp: 'Busy' }, { id: 'pl-b', org: 'List shop 1', phone: '9000088101', place: 'Guntur', resp: 'Busy' }] })).status, 200);
  assert.equal((await call('POST', '/prospects/drop', { ids: got.map((v) => v.id) }, O)).status, 403, 'another BDE cannot delete my list');
  const r = await call('POST', '/prospects/drop', { ids: got.map((v) => v.id) }, P); assert.deepEqual(r.body, { deleted: 2, kept: 1 });
  assert.ok(await reg(P, '9000088101'), 'the called one stays'); assert.equal(await reg(P, '9000088102'), undefined, 'the others are gone');
  assert.equal((await check(O, [{ org: 'List shop 2', phone: '9000088102' }]))[0].kind, 'free', 'a deleted number is free again');
});

test('a client visit keeps its check-ins and outcome; an accepted deal tells the Sales Manager', async () => {
  assert.equal((await call('POST', '/users', { firstName: 'Visit', surname: 'Bde', email: 'vis@test.in', password: 'password123', title: 'bde', designation: 'BDE', company: 'AaliTech' }, admin)).status, 200);
  const V = (await call('POST', '/auth/login', { email: 'vis@test.in', password: 'password123' })).cookie, rep = (await add(V, 'report', {})).record;
  const start = new Date(Date.now() - 50 * 60000).toISOString(), reached = new Date(Date.now() - 30 * 60000).toISOString(), left = new Date().toISOString();
  const visit = { client: 'Sunrise Dental', person: 'Dr. Rao', phone: '9000099001', place: 'Guntur' };
  const entry = (extra = {}, v = {}) => ({ id: 'v1', at: start, text: 'Visit to Sunrise Dental', kind: 'Client visit', state: 'running', start, ...extra, visit: { ...visit, ...v } });
  const presence = async () => (await call('GET', '/bootstrap', null, sm)).body.records.find((r) => r.type === 'presence' && r.user === rep.owner);
  assert.equal((await patch(V, rep.id, { entries: [entry()] })).status, 200); assert.match((await presence()).why, /^Going to a client – Sunrise Dental/);
  assert.equal((await patch(V, rep.id, { entries: [entry({}, { reachedAt: reached })] })).body.record.entries[0].visit.reachedAt, reached);
  assert.match((await presence()).why, /^At a client – Sunrise Dental/, 'the manager sees that the BDE has reached');
  const done = (await patch(V, rep.id, { entries: [entry({ state: 'done', end: left, mins: 50, note: 'Agreed to the website, advance on Monday' }, { reachedAt: reached, leftAt: left, outcome: 'Deal accepted', next: 'not a date' })] })).body.record.entries[0];
  assert.equal(done.visit.outcome, 'Deal accepted'); assert.equal(done.visit.leftAt, left); assert.equal(done.visit.next, undefined, 'only a real date is kept');
  assert.equal((await presence()).out, false, 'the visit is over');
  const told = (await call('GET', '/bootstrap', null, sm)).body.records.filter((r) => r.type === 'notice' && /Sunrise Dental accepted the deal/.test(r.text));
  assert.equal(told.length, 1, 'the Sales Manager is told once'); assert.match(told[0].text, /advance on Monday/);
  assert.equal((await patch(V, rep.id, { entries: [entry({ state: 'done', end: left, mins: 50 }, { outcome: 'Something else' })] })).body.record.entries[0].visit.outcome, undefined, 'only a known outcome is kept');
  // Out of the blue: a visit starts with just the client and the place; the person and number are needed before it ends.
  const quick = (extra = {}, v = {}) => ({ id: 'v2', at: left, text: 'Visit to Ravi Opticals', kind: 'Client visit', state: 'running', start: left, ...extra, visit: { client: 'Ravi Opticals', place: 'Tenali', ...v } });
  const done1 = entry({ state: 'done', end: left, mins: 50, note: 'ok' }, { reachedAt: reached, leftAt: left, outcome: 'Deal accepted' });
  assert.equal((await patch(V, rep.id, { entries: [done1, quick()] })).status, 200, 'client and place are enough to start');
  assert.equal((await patch(V, rep.id, { entries: [done1, quick({}, { place: '' })] })).status, 400, 'the place is needed');
  assert.equal((await patch(V, rep.id, { entries: [done1, quick({ state: 'done', end: left, mins: 5 }, { outcome: 'Interested – follow up' })] })).status, 400, 'the person met is needed to end it');
  assert.equal((await patch(V, rep.id, { entries: [done1, quick({ state: 'done', end: left, mins: 5 }, { outcome: 'Could not meet' })] })).status, 200, '"Could not meet" ends it without a person');
  // The trip back to the office is kept, and the manager sees it.
  const trip = { id: 't1', at: left, text: 'Travelling back to the office', kind: 'Travel', state: 'running', start: left, out: true, trip: { to: 'office', from: 'Ravi Opticals' } };
  assert.equal((await patch(V, rep.id, { entries: [done1, quick({ state: 'done', end: left, mins: 5 }, { outcome: 'Could not meet' }), trip] })).body.record.entries[2].trip.from, 'Ravi Opticals');
  assert.equal((await presence()).why, 'Returning to the office');
});

test('security audit (Trail of Bits style): notifications, unknown items, file links, huge text', async () => {
  const login = (email) => call('POST', '/auth/login', { email, password: 'password123' });
  for (const [f, e, t] of [['Audit', 'au1@test.in', 'bde'], ['Other', 'au2@test.in', 'dev']]) assert.equal((await call('POST', '/users', { firstName: f, surname: 'Check', email: e, password: 'password123', title: t, designation: t, company: 'AaliTech' }, admin)).status, 200);
  const X = (await login('au1@test.in')).cookie, Y = (await login('au2@test.in')).cookie, xId = (await call('GET', '/me', null, X)).body.user.id;
  // ACB-1, ACB-3: notifications come only from Aali One; unknown kinds of item cannot be added.
  assert.equal((await call('POST', '/records', { type: 'notice', data: { to: xId, text: 'fake' } }, Y)).status, 403);
  assert.equal((await call('POST', '/records', { type: 'zzjunk', data: {} }, X)).status, 403);
  // ACB-2: a notification can be marked as read, but not re-addressed or re-worded.
  assert.equal((await call('POST', '/records', { type: 'task', data: { title: 'Audit task', owner: xId } }, admin)).status, 200);
  const n = (await call('GET', '/bootstrap', null, X)).body.records.find((r) => r.type === 'notice' && /Audit task/.test(r.text));
  assert.equal((await patch(X, n.id, { to: 'u_someone', text: 'changed' })).status, 403); assert.equal((await patch(X, n.id, { read: true })).status, 200);
  // ACB-4: a file opens for the uploader, for people who can open the item it is attached to, and not for others with just the link.
  const f = (await call('POST', '/files', { name: 'c.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 x').toString('base64') }, X)).body;
  const get = async (c) => (await call('GET', '/files/' + f.id, null, c)).status;
  assert.equal(await get(X), 200); assert.equal(await get(Y), 404, 'a link alone is not enough'); assert.equal(await get(admin), 200, 'management can open it');
  const lead = (await add(X, 'lead', { name: 'File Lead', mobile: '9000066601', service: 'Website', source: 'Referral', files: [f] })).record;
  assert.ok(lead.files?.length, 'the file is attached'); assert.equal(await get(sm), 200, 'the Sales Manager can open a file on a lead they can open'); assert.equal(await get(Y), 404);
  // DOS-1: the public form keeps sensible lengths.
  assert.equal((await call('POST', '/public/enquiry', { name: 'N'.repeat(50000), mobile: '9000066602', service: 'Website' })).status, 200);
  assert.ok((await call('GET', '/bootstrap', null, admin)).body.records.filter((r) => r.type === 'lead').every((l) => (l.name || '').length <= 120));
  // DOS-2: one item cannot be made huge.
  assert.equal((await call('POST', '/records', { type: 'task', data: { title: 'Big', notes: 'x'.repeat(700000) } }, X)).status, 413);
});

test('security: uploaded files cannot run as pages, sign-in is limited, your own password needs the current one', async () => {
  // Two fresh people for this test, so it does not depend on what the earlier tests left behind.
  const login = (email, password) => call('POST', '/auth/login', { email, password });
  const person = async (n) => { const r = await call('POST', '/users', { firstName: 'Sec', surname: n, email: `sec${n}@test.in`, password: 'password123', title: 'bde', designation: 'BDE', company: 'AaliTech' }, admin); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.user.id; };
  const idA = await person('a'); await person('b');
  let A = (await login('seca@test.in', 'password123')).cookie; const B = (await login('secb@test.in', 'password123')).cookie;
  const up = async (name, mime, text, c = A) => (await call('POST', '/files', { name, mime, data: Buffer.from(text).toString('base64') }, c)).body;
  const get = (id, c = A) => call('GET', '/files/' + id, null, c); // the uploader opens it; how it is served is what is checked here
  // A web page or an SVG drawing uploaded by a BDE is handed to the next person as a download, never shown as a page of Aali One.
  for (const [name, mime] of [['x.html', 'text/html'], ['x.svg', 'image/svg+xml'], ['x.js', 'text/javascript']]) {
    const f = await up(name, mime, '<script>fetch("/api/users")</script>'), r = await get(f.id);
    assert.equal(r.headers['content-type'], 'application/octet-stream', name); assert.match(r.headers['content-disposition'], /^attachment/, name);
    assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.match(r.headers['content-security-policy'], /sandbox/);
  }
  const pic = await up('me.png', 'image/png', 'png'), shown = await get(pic.id);
  assert.equal(shown.headers['content-type'], 'image/png'); assert.match(shown.headers['content-disposition'], /^inline/);
  assert.equal((await get((await up('a.pdf', 'application/pdf', 'pdf')).id)).headers['content-type'], 'application/pdf');
  assert.equal((await call('PATCH', '/users/' + idA, { photo: (await up('me.svg', 'image/svg+xml', '<svg/>')).id }, A)).status, 400, 'an SVG cannot be a profile photo');
  assert.equal((await get(pic.id, '')).status, 401, 'files need a sign-in');

  // Your own password: the current one is always asked, an admin too; other devices are signed out, this one stays in.
  const other = (await login('ops@test.in', 'password123')).cookie;
  assert.equal((await call('PATCH', '/users/' + idA, { password: 'changed-by-admin1' }, admin)).status, 200, 'an admin sets a member\'s password without knowing the old one');
  const me = (await call('GET', '/me', null, admin)).body.user;
  assert.equal((await call('PATCH', '/users/' + me.id, { password: 'new-password-1' }, admin)).status, 400, 'not without the current password');
  assert.equal((await call('PATCH', '/users/' + me.id, { password: 'new-password-1', currentPassword: 'password123' }, admin)).status, 200);
  assert.equal((await call('GET', '/me', null, admin)).status, 200, 'this device stays signed in'); assert.equal((await call('GET', '/me', null, other)).status, 401, 'the other device is signed out');
  assert.equal((await call('GET', '/me', null, A)).status, 401, 'a member whose password was reset is signed out everywhere');
  A = (await login('seca@test.in', 'changed-by-admin1')).cookie; assert.equal((await call('GET', '/me', null, A)).status, 200);

  // Wrong passwords: after 8 for one email the door stays shut for 15 minutes, even with the right password. A right sign-in clears the count.
  for (let i = 0; i < 3; i++) assert.equal((await login('secb@test.in', 'nope' + i)).status, 401);
  assert.equal((await login('secb@test.in', 'password123')).status, 200);
  for (let i = 0; i < 8; i++) assert.equal((await login('secb@test.in', 'nope' + i)).status, 401);
  assert.equal((await login('secb@test.in', 'password123')).status, 429);
  assert.equal((await login('nobody@test.in', 'whatever1')).status, 401, 'an unknown email is refused the same way');
  assert.equal((await login('seca@test.in', 'changed-by-admin1')).status, 200, 'other people are not locked out');
  assert.equal((await call('GET', '/health')).headers['x-content-type-options'], 'nosniff');
});
