// End-to-end API tests against an in-process PGlite database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handle } from '../server/app.js';
import { getDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

process.env.PGLITE_DIR = 'memory://';
function call(method, path, body, cookie = '', more = {}) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url: '/api' + path, headers: { cookie, 'content-type': 'application/json', ...more } });
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

test('agreements: the Operations and Sales Managers make them, only Operations makes a closure; the Company Secretary and Chairman read; nobody else sees them', async () => {
  const db = await getDb(), login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  for (const [id, email, title] of [['u_agops', 'agops@test.in', 'ops'], ['u_agcs', 'agcs@test.in', 'cs'], ['u_agch', 'agch@test.in', 'chairman'], ['u_agb', 'agb@test.in', 'bde']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email, title, title === 'bde' ? 'sales' : 'management', hashPassword('password123')]);
  const OPS = await login('agops@test.in'), CS = await login('agcs@test.in'), CH = await login('agch@test.in'), B = await login('agb@test.in');
  const recs = async (c) => { const r = await call('GET', '/bootstrap', null, c); assert.equal(r.status, 200); return r.body.records; };
  const deal = (await add(sm, 'deal', { title: 'Agreement deal', phone: '9000077701' })).record;
  // The Sales Manager makes a service agreement: it gets its number, and the Operations Manager is told.
  const sa = (await add(sm, 'agreement', { kind: 'service', clientName: 'Ravi Traders', title: 'Website', dealId: deal.id, amount: 45000, gst: 'extra', gstRate: 18 })).record;
  assert.match(sa.number, /^SA\/\d{4}-\d\d\/\d{3}$/); assert.equal(sa.status, 'draft');
  assert.ok((await recs(OPS)).some((r) => r.type === 'notice' && r.relId === sa.id), 'the Operations Manager is told');
  // Only the Operations Manager makes a closure agreement.
  const proj = (await add(OPS, 'project', { name: 'Ravi website', dealId: deal.id })).record;
  assert.equal((await call('POST', '/records', { type: 'agreement', data: { kind: 'closure', clientName: 'Ravi Traders', projectId: proj.id } }, sm)).status, 403);
  const ca = (await add(OPS, 'agreement', { kind: 'closure', clientName: 'Ravi Traders', projectId: proj.id, serviceId: sa.id })).record;
  assert.match(ca.number, /^PCA\/\d{4}-\d\d\/\d{3}$/);
  // The Company Secretary and the Chairman read both, and can neither make nor change one.
  for (const c of [CS, CH]) { const r = await recs(c); assert.ok(r.some((x) => x.id === sa.id) && r.some((x) => x.id === ca.id), 'they read both');
    assert.equal((await call('POST', '/records', { type: 'agreement', data: { kind: 'service', clientName: 'X' } }, c)).status, 403); assert.equal((await patch(c, sa.id, { title: 'Changed' })).status, 403); }
  // The Sales Manager reads the closure agreement but cannot change it.
  assert.ok((await recs(sm)).some((x) => x.id === ca.id)); assert.equal((await patch(sm, ca.id, { pending: 'x' })).status, 403);
  // Nobody else: a BDE, the IT Manager, and an administrator who is none of these four.
  for (const c of [B, it0, admin]) { assert.ok(!(await recs(c)).some((r) => r.type === 'agreement'), 'no agreement is sent');
    assert.equal((await patch(c, sa.id, { title: 'x' })).status, 403); assert.equal((await call('POST', '/records', { type: 'agreement', data: { kind: 'service', clientName: 'X' } }, c)).status, 403); }
  // Signing needs the date; after that nothing changes except the scanned signed copy; the deal's handoff box ticks itself.
  assert.equal((await patch(sm, sa.id, { status: 'signed' })).status, 400);
  const signed = await patch(sm, sa.id, { status: 'signed', signedOn: '2026-10-01', contactName: 'Ravi' }); assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal((await patch(sm, sa.id, { amount: 1 })).status, 400);
  const f = (await call('POST', '/files', { name: 'signed.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 signed').toString('base64') }, sm)).body;
  assert.equal((await patch(sm, sa.id, { signedCopy: { id: f.id, name: 'signed.pdf' } })).status, 200);
  assert.equal((await call('GET', '/files/' + f.id, null, CS)).status, 200, 'the Company Secretary opens the signed copy');
  assert.equal((await call('GET', '/files/' + f.id, null, B)).status, 404, 'a BDE does not');
  assert.equal((await recs(sm)).find((r) => r.id === deal.id).handoff?.agreement, true);
  // Review findings: nothing reaches a signed agreement through another kind of item, an odd kind, a rewritten history, or management's shortcuts.
  const ap = (await add(it0, 'approval', { kind: 'discount', relType: 'project', relId: sa.id, reason: 'x' })).record;
  assert.equal((await patch(it0, ap.id, { status: 'approved' })).status, 200);
  assert.equal((await call('POST', '/records', { type: 'receipt', data: { paymentId: sa.id, payerName: 'X', items: [{ desc: 'x', amount: 100 }], taxMode: 'none', mode: 'Cash' } }, sm)).status, 200);
  assert.equal((await call('POST', '/records', { type: 'agreement', data: { kind: ['closure'], clientName: 'X' } }, sm)).status, 403, 'a list is not "service"');
  assert.equal((await call('POST', '/records', { type: 'agreement', data: { kind: 'toString', clientName: 'X' } }, OPS)).status, 400);
  assert.equal((await call('POST', '/records', { type: 'agreement', data: { kind: 'service', clientName: 'X', date: 'soon' } }, OPS)).status, 400);
  assert.equal((await patch(sm, sa.id, { log: [{ by: 'u_agch', text: 'Approved by Chairman' }], _note: 'Approved by Chairman' })).status, 200);
  const still = (await recs(OPS)).find((r) => r.id === sa.id);
  assert.equal(still.status, 'signed'); assert.ok(!('paid' in still) && !still.log.some((l) => /Chairman/.test(l.text)), 'the signed agreement was not touched');
  assert.equal((await call('GET', '/files/' + f.id, null, admin)).status, 404, 'an administrator outside the four cannot open the signed copy');
  assert.ok(!(await call('GET', '/audit', null, admin)).body.rows.some((r) => r.type === 'agreement'), 'nor read agreement lines in the audit log');
  assert.ok((await call('GET', '/audit', null, OPS)).body.rows.some((r) => r.type === 'agreement'));
  assert.equal((await call('POST', '/records', { type: 'comment', data: { relType: 'agreement', relId: sa.id, text: 'x' } }, OPS)).status, 403);
  assert.ok((await recs(CH)).some((r) => r.type === 'notice' && r.relId === sa.id && /signed/.test(r.text)), 'the Chairman is told it is signed');
  // A signed agreement is deleted only by the Operations Manager, with a reason; the Company Secretary cannot restore it, the Operations Manager can.
  assert.equal((await call('DELETE', '/records/' + sa.id, { reason: 'Wrong client name' }, sm)).status, 403);
  assert.equal((await call('DELETE', '/records/' + sa.id, { reason: 'x' }, OPS)).status, 400);
  assert.equal((await call('DELETE', '/records/' + sa.id, { reason: 'Wrong client name' }, OPS)).status, 200);
  assert.equal((await call('POST', '/records/' + sa.id + '/restore', null, CS)).status, 403);
  assert.equal((await call('POST', '/records/' + sa.id + '/restore', null, OPS)).status, 200);
});

test('payroll: HR keeps salaries and runs the month from Aali HRM attendance; the Operations Manager reviews and remarks; nobody else sees it', async () => {
  const { setHrmSource } = await import('../server/hrm.js'), { PGlite } = await import('@electric-sql/pglite');
  const db = await getDb(), login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  for (const [id, email, title, team] of [['u_pops', 'pops@test.in', 'ops', 'management'], ['u_pcs', 'pcs@test.in', 'cs', 'management'], ['u_pch', 'pch@test.in', 'chairman', 'management'],
    ['u_pb', 'pb@test.in', 'bde', 'sales'], ['u_pd', 'pd@test.in', 'dev', 'it']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email.split('@')[0], title, team, hashPassword('password123')]);
  const OPS = await login('pops@test.in'), CS = await login('pcs@test.in'), CH = await login('pch@test.in'), B = await login('pb@test.in');
  const recs = async (c) => (await call('GET', '/bootstrap', null, c)).body;
  // A stand-in for Aali HRM: September 2026 for the BDE – 19 full days, 1 half day, 1 short day, casual leave 22–24 (2 paid, 1 unpaid), 1 day with no record.
  const hrm = new PGlite('memory://');
  await hrm.exec(`create table users (id text, email text, full_name text, is_active boolean, joining_date date);
    create table employee_details (user_id text, date_of_joining date, exit_date date);
    create table attendance (user_id text, date date, check_in timestamptz, check_out timestamptz, working_hours interval, office_time time);
    create table leave_requests (user_id text, start_date date, end_date date, leave_type text, status text);
    create table holidays (date date);
    insert into users values ('h1', 'PB@test.in', 'PB', true, '2025-01-01');
    insert into holidays values ('2026-09-15');
    insert into leave_requests values ('h1', '2026-09-22', '2026-09-24', 'casual', 'approved'), ('h1', '2026-09-25', '2026-09-25', 'sick', 'rejected');`);
  let full = 0;
  for (let d = 1; d <= 30; d++) { const s = `2026-09-${String(d).padStart(2, '0')}`; if (new Date(s + 'T00:00:00Z').getUTCDay() === 0 || s === '2026-09-15' || (s >= '2026-09-22' && s <= '2026-09-24')) continue;
    const hours = s === '2026-09-10' ? 6 : s === '2026-09-11' ? 3 : s === '2026-09-30' ? 0 : 9; if (!hours) continue; if (hours === 9) full++;
    await hrm.query('insert into attendance values ($1, $2, $3, $4, null, $5)', ['h1', s, `${s}T03:30:00Z`, new Date(Date.parse(`${s}T03:30:00Z`) + hours * 3600e3).toISOString(), '09:00']); }
  assert.equal(full, 19);
  setHrmSource((sql, p) => hrm.query(sql, p).then((r) => r.rows));
  // HR is a switch on a person (today the Company Secretary). Only the Founder & Chairman switches it on – not an admin, not the person,
  // never for the Operations Manager; an admin or the Chairman can switch it off.
  assert.equal((await call('POST', '/records', { type: 'salary', data: { userId: 'u_pb', gross: 20000 } }, CS)).status, 403, 'not HR yet');
  assert.equal((await call('PATCH', '/users/u_pcs', { hr: true }, CS)).status, 403, 'not on yourself');
  assert.equal((await call('PATCH', '/users/u_pcs', { hr: true }, admin)).status, 403, 'not an admin');
  assert.equal((await call('PATCH', '/users/u_pcs', { hr: true }, OPS)).status, 403, 'not the Operations Manager');
  assert.equal((await call('PATCH', '/users/u_pops', { hr: true }, CH)).status, 400, 'the Operations Manager reviews payroll');
  assert.equal((await call('PATCH', '/users/u_pb', { hr: true }, CH)).status, 400, 'only the Company Secretary can be HR – not a BDE');
  assert.equal((await call('PATCH', '/users/u_pd', { hr: true }, CH)).status, 400, 'only the Company Secretary can be HR – not a developer');
  assert.equal((await call('PATCH', '/users/u_pb', { hr: true, title: 'ops' }, CH)).status, 403, 'the Chairman changes only the switch');
  assert.equal((await call('PATCH', '/users/u_pcs', { hr: true }, CH)).status, 200);
  assert.ok((await recs(OPS)).records.some((r) => r.type === 'notice' && /switched HR & payroll ON/.test(r.text)), 'the Operations Manager is told');
  assert.equal((await call('GET', '/me', null, CS)).body.user.hr, true);
  // Salary sheets: HR makes them; the Founder & Chairman is not on the payroll; the Operations Manager cannot change them.
  const sal = (await add(CS, 'salary', { userId: 'u_pb', gross: 20000, pf: true, esi: true, pt: true, fixed: [{ name: 'Health insurance', amount: 500 }], bank: { holder: 'PB', account: '123456789012', ifsc: 'icic0001234', name: 'ICICI' } })).record;
  assert.equal(sal.bank.ifsc, 'ICIC0001234');
  assert.equal((await call('POST', '/records', { type: 'salary', data: { userId: 'u_pch', gross: 99000 } }, CS)).status, 400);
  assert.equal((await call('POST', '/records', { type: 'salary', data: { userId: 'u_pb', gross: 1 } }, CS)).status, 400, 'one sheet per person');
  assert.equal((await call('POST', '/records', { type: 'salary', data: { userId: 'u_pd', gross: 30000 } }, OPS)).status, 403);
  assert.equal((await patch(OPS, sal.id, { gross: 50000 })).status, 403);
  await add(CS, 'salary', { userId: 'u_pd', gross: 30000, pt: true, bank: { account: '99887766', ifsc: 'HDFC0000001' } });
  const adv = (await add(CS, 'loan', { userId: 'u_pb', kind: 'advance', amount: 2000, from: '2026-09', givenOn: '2026-09-05' })).record;
  // Nobody else sees any of it – not a BDE; the payroll rules are not sent to them either. The Founder & Chairman sees it all.
  for (const c of [B]) { const b = await recs(c); assert.ok(!b.records.some((r) => ['salary', 'payrun', 'loan'].includes(r.type)) && !b.settings.payroll, 'payroll hidden'); }
  assert.ok((await recs(CH)).records.some((r) => r.id === sal.id) && (await recs(CH)).settings.payroll, 'the Chairman sees payroll');
  assert.ok((await recs(OPS)).records.some((r) => r.id === sal.id) && (await recs(OPS)).settings.payroll);
  // September from Aali HRM: paid days = 19 + ½ + 2 paid leave + 4 Sundays + 1 holiday = 26.5 of 30.
  const run = (await add(CS, 'payrun', { month: '2026-09' })).record, pb = run.items.find((i) => i.userId === 'u_pb'), pd = run.items.find((i) => i.userId === 'u_pd');
  assert.equal(pb.days.payable, 26.5); assert.equal(pb.days.att.unpaidLeave, 1); assert.equal(pb.days.att.absent, 2);
  // Earned 20,000 × 26.5/30 = 17,667: PF 12% of basic 8,833 = 1,060 · ESI 0.75% = 133 · PT 150 · insurance 500 · advance 2,000 → net 13,824.
  assert.deepEqual([pb.earned.gross, pb.ded.pf, pb.ded.esi, pb.ded.pt, pb.ded.total, pb.net, pb.employer.pf, pb.employer.esi], [17667, 1060, 133, 150, 3843, 13824, 1060, 575]);
  assert.ok(pd.warn.some((w) => /Not found in Aali HRM/.test(w)), 'the developer is not in Aali HRM');
  // It cannot be locked while someone has no paid days; HR types them (with why), then it locks and the Operations Manager is told.
  assert.equal((await patch(CS, run.id, { status: 'locked' })).status, 400);
  assert.equal((await patch(CS, run.id, { adj: { u_pd: { days: 30, daysWhy: 'Works from the client site; no face check-in' } } })).status, 200);
  assert.equal((await patch(OPS, run.id, { status: 'locked' })).status, 403, 'the Operations Manager does not run payroll');
  const locked = await patch(CS, run.id, { status: 'locked' }); assert.equal(locked.status, 200, JSON.stringify(locked.body));
  assert.ok((await recs(OPS)).records.some((r) => r.type === 'notice' && /ready/.test(r.text)), 'the Operations Manager is told');
  let loan = (await recs(CS)).records.find((r) => r.id === adv.id); assert.deepEqual(loan.recovered, [{ month: '2026-09', amount: 2000 }]); assert.equal(loan.closed, true);
  assert.deepEqual((await call('GET', '/payroll/mine', null, B)).body.slips, [], 'no payslip before the month is paid');
  // The Operations Manager remarks (and nothing else); HR is told. A locked month cannot change until it is reopened with a reason.
  assert.equal((await patch(OPS, run.id, { _remark: { text: 'Why is the developer on 30 days?', userId: 'u_pd' } })).status, 200);
  assert.ok((await recs(CS)).records.some((r) => r.type === 'notice' && /remarked/.test(r.text)));
  assert.equal((await patch(CS, run.id, { adj: { u_pd: { days: 29 } } })).status, 400);
  assert.equal((await call('PATCH', '/records/' + run.id, { data: { status: 'draft' } }, CS)).status, 400, 'needs a reason');
  assert.equal((await patch(CS, run.id, { status: 'draft', _reason: 'Developer was on leave one day' })).status, 200);
  loan = (await recs(CS)).records.find((r) => r.id === adv.id); assert.deepEqual(loan.recovered, []); assert.equal(loan.closed, false);
  assert.equal((await patch(CS, run.id, { adj: { u_pd: { days: 29, daysWhy: 'On leave 12 Sep' } }, status: 'locked' })).status, 200);
  assert.equal((await patch(CS, run.id, { status: 'paid', paidOn: '2099-10-07' })).status, 400, 'not a future date');
  assert.equal((await patch(CS, run.id, { status: 'paid', paidOn: '2026-10-01' })).status, 200);
  assert.equal((await call('DELETE', '/records/' + run.id, { reason: 'Made by mistake' }, CS)).status, 403, 'a paid payroll stays');
  // My payslips: once paid, each person sees their own payslip – and only their own; the Chairman is not on the payroll.
  const mine = (await call('GET', '/payroll/mine', null, B)).body.slips; assert.equal(mine.length, 1); assert.equal(mine[0].month, '2026-09');
  assert.equal(mine[0].item.userId, 'u_pb'); assert.equal(mine[0].item.net, 13824); assert.ok(!('warn' in mine[0].item), 'HR\'s notes are not shown');
  assert.deepEqual((await call('GET', '/payroll/mine', null, CH)).body.slips, []);
  // A personal email is taken when a person is added (payslips will go there); colleagues do not see it.
  assert.equal((await call('POST', '/users', { firstName: 'Pe', surname: 'Mail', email: 'pe@test.in', password: 'password123', title: 'bde', designation: 'BDE', company: 'AaliTech', personalEmail: 'not-an-email' }, admin)).status, 400);
  const pe = (await call('POST', '/users', { firstName: 'Pe', surname: 'Mail', email: 'pe@test.in', password: 'password123', title: 'bde', designation: 'BDE', company: 'AaliTech', personalEmail: 'Pe.Mail@Gmail.com' }, admin)).body.user;
  assert.equal(pe.personalEmail, 'pe.mail@gmail.com');
  assert.equal((await recs(B)).users.find((u) => u.id === pe.id).personalEmail, '', 'a colleague does not see it');
  assert.equal((await recs(OPS)).users.find((u) => u.id === pe.id).personalEmail, 'pe.mail@gmail.com');
  assert.equal((await call('PATCH', '/users/u_pb', { personalEmail: 'pb.home@example.com' }, B)).body.user.personalEmail, 'pb.home@example.com', 'each person can change their own');
  // Rules are set by HR (or the Chairman); the audit log shows payroll work to the Chairman (who may step in) but not to the admin; Aali HRM status for HR and the Operations Manager.
  assert.equal((await call('PUT', '/settings/payroll', { value: { basicPct: 40 } }, OPS)).status, 403);
  assert.equal((await call('PUT', '/settings/payroll', { value: { ...(await recs(CS)).settings.payroll, basicPct: 40 } }, CS)).status, 200);
  assert.ok((await call('GET', '/audit', null, CH)).body.rows.some((r) => ['salary', 'payrun', 'loan'].includes(r.type)), 'the Chairman sees payroll work');
  assert.ok(!(await call('GET', '/audit', null, admin)).body.rows.some((r) => ['salary', 'payrun', 'loan'].includes(r.type)), 'the admin does not');
  // The audit log's sections: payroll work, sign-ins, and HR's switch are each in their own.
  const au = (await call('GET', '/audit', null, CH)).body.rows;
  assert.ok(au.filter((r) => ['salary', 'payrun', 'loan'].includes(r.type)).every((r) => r.section === 'payroll') && au.some((r) => r.action === 'people' && /HR & payroll on/.test(r.summary) && r.section === 'payroll'));
  assert.ok(au.filter((r) => r.action === 'login').every((r) => r.section === 'signin') && au.some((r) => r.section === 'signin'));
  const st = (await call('GET', '/payroll/hrm?month=2026-09', null, OPS)).body; assert.equal(st.connected, true); assert.equal(st.people.find((p) => p.userId === 'u_pb').found, true);
  assert.equal((await call('GET', '/payroll/hrm', null, B)).status, 403);
  // Review fixes. A raise counts only from its own month: August is still paid at the old gross.
  const pdSheet = (await recs(CS)).records.find((r) => r.type === 'salary' && r.userId === 'u_pd');
  assert.equal((await patch(CS, pdSheet.id, { ...pdSheet, gross: 40000, from: '2026-10' })).status, 200);
  const aug = (await add(CS, 'payrun', { month: '2026-08' })).record;
  assert.equal(aug.items.find((i) => i.userId === 'u_pd').full.gross, 30000, 'August keeps the old gross');
  // A deleted month cannot be restored next to a new one (it would pay twice); impossible months are refused.
  assert.equal((await call('DELETE', '/records/' + aug.id, { reason: 'Made again' }, CS)).status, 200);
  await add(CS, 'payrun', { month: '2026-08' });
  assert.equal((await call('POST', '/records/' + aug.id + '/restore', null, CS)).status, 400);
  assert.equal((await call('POST', '/records', { type: 'payrun', data: { month: '2025-13' } }, CS)).status, 400);
  assert.equal((await call('PUT', '/settings/payroll', { value: null }, CS)).status, 400, 'no crash on empty rules');
  // Different emails in the two apps: HR matches the person by hand (nobody's login changes); the Operations Manager only looks.
  await hrm.exec("insert into users values ('h2', 'PD.Dev@hrm.test', 'PD in HRM', true, '2025-01-01')");
  const hrmView = async (c) => (await call('GET', '/payroll/hrm?month=2026-09', null, c)).body, pdRow = (v) => v.people.find((x) => x.userId === 'u_pd');
  let v = await hrmView(CS);
  assert.equal(pdRow(v).found, false);
  assert.deepEqual(v.unmatched.map((x) => x.email), ['pd.dev@hrm.test'], 'the people in Aali HRM nobody is matched to');
  const link = (c, userId, email) => call('POST', '/payroll/hrm-link', { userId, email }, c);
  assert.equal((await link(OPS, 'u_pd', 'pd.dev@hrm.test')).status, 403, 'the Operations Manager only reviews');
  assert.equal((await link(B, 'u_pd', 'pd.dev@hrm.test')).status, 403);
  assert.equal((await link(CS, 'u_pd', 'nobody@hrm.test')).status, 400, 'must be someone in Aali HRM');
  assert.equal((await link(CS, 'u_pd', 'pb@test.in')).status, 400, 'already the BDE');
  assert.equal((await link(CS, 'u_pch', 'pd.dev@hrm.test')).status, 400, 'the Chairman is not on the payroll');
  assert.equal((await link(CS, 'u_pd', 'PD.Dev@hrm.test')).status, 200);
  v = await hrmView(OPS);
  assert.ok(pdRow(v).found && pdRow(v).byHand && pdRow(v).matched === 'pd.dev@hrm.test', 'found, matched by hand');
  assert.equal(v.unmatched.length, 0);
  assert.equal((await link(CS, 'u_pb', 'pd.dev@hrm.test')).status, 400, 'one Aali HRM person, one Aali One person');
  const augRun = (await recs(CS)).records.find((r) => r.type === 'payrun' && r.month === '2026-08');
  const pdItem = (await patch(CS, augRun.id, { _refresh: true })).body.record.items.find((x) => x.userId === 'u_pd');
  assert.ok(!pdItem.warn.some((w) => /Not found in Aali HRM/.test(w)), 'the monthly payroll uses the match too');
  assert.equal((await link(CS, 'u_pd', '')).status, 200, 'undo');
  assert.equal(pdRow(await hrmView(CS)).found, false);
  assert.ok((await recs(CS)).settings.hrmLinks === undefined, 'the matches are not sent with the settings');
  // The attendance calendar: one person, every day of the month, made by the same rules as the paid days.
  assert.equal((await hrmView(CS)).people[0].att?.list, undefined, 'the list of everyone carries only the counts');
  const one = (await call('GET', '/payroll/hrm?month=2026-09&userId=u_pb', null, OPS)).body;
  assert.equal(one.people.length, 1); const cal = one.people[0].att, day = (d) => cal.list.find((x) => x.date === '2026-09-' + d);
  assert.equal(cal.list.length, 30);
  for (const k of ['present', 'half', 'absent', 'paidLeave', 'unpaidLeave', 'sundays', 'holidays']) assert.equal(cal.list.filter((x) => x.kind === k).length, cal[k], k + ': the calendar agrees with the count');
  assert.deepEqual([day('01').kind, day('01').inAt, day('01').outAt, day('01').hours], ['present', '09:00', '18:00', 9], 'times in India time');
  assert.deepEqual([day('10').kind, day('10').note], ['half', '5 to 8 hours']);
  assert.deepEqual([day('11').kind, day('11').note], ['absent', 'Under 5 hours']);
  assert.deepEqual([day('15').kind, day('22').kind, day('23').kind, day('24').kind, day('24').leave], ['holidays', 'paidLeave', 'paidLeave', 'unpaidLeave', 'casual']);
  assert.deepEqual([day('30').kind, day('30').note], ['absent', 'No check-in']);
  assert.equal((await call('GET', '/payroll/hrm?month=2026-09&userId=u_pb', null, B)).status, 403, 'a BDE cannot read it');
  // A month in draft follows its salary sheets at once (the user added a bank account and the draft still said "No bank account").
  const augNow = async () => (await recs(CS)).records.find((r) => r.id === augRun.id), pbItem = (run) => run.items.find((x) => x.userId === 'u_pb');
  assert.equal((await patch(CS, sal.id, { bank: { holder: 'PB', account: '555566667777', ifsc: 'icic0001234', name: 'ICICI' } })).status, 200);
  assert.equal(pbItem(await augNow()).bank.account, '555566667777', 'the draft month shows the new bank account');
  // … and if Aali HRM cannot be reached at that moment, the attendance read last time is kept, not wiped.
  setHrmSource(() => { throw new Error('connection timed out'); });
  assert.equal((await patch(CS, sal.id, { note: 'Bank checked' })).status, 200);
  const kept = await augNow();
  assert.equal(kept.att.source, 'kept'); assert.ok(pbItem(kept).days.att, 'attendance kept');
  setHrmSource((sql, p) => hrm.query(sql, p).then((r) => r.rows));
  // Staff without a login (a maid, a personal secretary): HR adds them inside Payroll; they are paid and get payslips, and never sign in.
  assert.equal((await call('POST', '/records', { type: 'payee', data: { name: 'Lakshmi K' } }, OPS)).status, 403, 'the Operations Manager only reviews');
  assert.equal((await call('POST', '/records', { type: 'payee', data: { name: 'Lakshmi K' } }, B)).status, 403);
  assert.equal((await call('POST', '/records', { type: 'payee', data: { name: 'Someone', email: 'pb@test.in' } }, CS)).status, 400, 'that email is a login already');
  await hrm.exec("insert into users values ('h3', 'lakshmi@hrm.test', 'Lakshmi K', true, '2025-01-01')");
  const maid = (await add(CS, 'payee', { name: 'Lakshmi K', designation: 'Housekeeping', company: 'Aali Group', email: 'Lakshmi@HRM.test', personalEmail: 'lk@example.test', phone: '98765 43210' })).record;
  assert.deepEqual([maid.email, maid.phone, maid.active], ['lakshmi@hrm.test', '9876543210', true]);
  assert.equal((await call('POST', '/records', { type: 'payee', data: { name: 'Twin', email: 'lakshmi@hrm.test' } }, CS)).status, 400, 'one Aali HRM email, one person');
  assert.ok(!(await recs(B)).records.some((r) => r.type === 'payee'), 'a BDE never sees them');
  assert.ok((await recs(CH)).records.some((r) => r.type === 'payee'), 'the Chairman sees them');
  assert.ok((await recs(OPS)).records.some((r) => r.type === 'payee'), 'the Operations Manager reviews them');
  const maidSal = (await add(CS, 'salary', { userId: maid.id, gross: 12000, pt: true, bank: { account: '11112222', ifsc: 'SBIN0001234' } })).record;
  assert.equal(maidSal.name, 'Lakshmi K');
  assert.equal((await call('POST', '/records', { type: 'loan', data: { userId: maid.id, kind: 'advance', amount: 1000, from: '2026-08' } }, CS)).status, 200, 'an advance too');
  const mrow = (await hrmView(CS)).people.find((x) => x.userId === maid.id);
  assert.ok(mrow.payee && mrow.found, 'in Rules & Aali HRM, found by the email on her details');
  const maidAug = (await augNow()).items.find((x) => x.userId === maid.id);
  assert.ok(maidAug && maidAug.company === 'Aali Group' && maidAug.designation === 'Housekeeping' && maidAug.ded.loans.length === 1, 'on the draft payroll at once, with her advance');
  assert.equal((await call('DELETE', '/records/' + maid.id, { reason: 'Added by mistake' }, CS)).status, 400, 'she has a salary sheet: not deleted');
  assert.equal((await patch(CS, maid.id, { active: false })).status, 200);
  assert.ok(!(await augNow()).items.some((x) => x.userId === maid.id), 'off the draft payroll once she no longer works here');
  assert.notEqual((await call('POST', '/auth/login', { email: 'lakshmi@hrm.test', password: 'password123' })).status, 200, 'no login');
  // Staff history does not tell the admin that salary sheets or loans exist.
  assert.ok(!(await call('GET', '/users/u_pb/history', null, admin)).body.work.types.some((x) => ['salary', 'loan', 'payrun'].includes(x.type)));
  // A password set by someone else switches HR & payroll off, so nobody can take over the HR login; the Operations Manager is told.
  assert.equal((await call('PATCH', '/users/u_pcs', { password: 'newpassword1' }, admin)).status, 200);
  assert.equal((await call('POST', '/records', { type: 'salary', data: { userId: 'u_pops', gross: 1 } }, await login('pcs@test.in').catch(() => ''))).status, 401);
  const csAgain = (await call('POST', '/auth/login', { email: 'pcs@test.in', password: 'newpassword1' })).cookie;
  assert.equal((await call('GET', '/me', null, csAgain)).body.user.hr, false);
  assert.equal((await call('POST', '/records', { type: 'salary', data: { userId: 'u_pops', gross: 1 } }, csAgain)).status, 403);
  assert.ok((await recs(OPS)).records.some((r) => r.type === 'notice' && /switched off/.test(r.text)));
  setHrmSource(null);
});

test('deadline reminders: 2 days before (and when missed) to management and the Sales Manager; the IT Manager only for IT work', async () => {
  const { deadlineSweep } = await import('../server/logic.js'), db = await getDb();
  const day = (n) => { const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  for (const [id, email, title, team] of [['u_dops', 'dops@test.in', 'ops', 'management'], ['u_dch', 'dch@test.in', 'chairman', 'management'], ['u_dsm', 'dsm@test.in', 'salesmgr', 'sales'], ['u_dit', 'dit@test.in', 'itmgr', 'it'], ['u_dbde', 'dbde@test.in', 'bde', 'sales']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email.split('@')[0], title, team, hashPassword('password123')]);
  const proj = (await add(admin, 'project', { name: 'Deadline Website', stage: 'development', deadline: day(2) })).record;
  await add(admin, 'task', { title: 'Design sign-off', projectId: proj.id, milestone: true, due: day(-1), team: 'it' });
  await add(admin, 'payment', { title: 'Balance for Deadline Website', amount: 5000, due: day(1) });
  await add(admin, 'project', { name: 'Far Away Project', stage: 'planning', deadline: day(20) });
  const sent = await deadlineSweep(db, true); assert.ok(sent > 0);
  const notes = async (u) => (await db.query("select data->>'text' as t from records where type = 'notice' and data->>'to' = $1", [u])).rows.map((r) => r.t);
  const ops = await notes('u_dops'), ch = await notes('u_dch'), sm = await notes('u_dsm'), itm = await notes('u_dit'), bde = await notes('u_dbde');
  for (const box of [ops, ch, sm]) {
    assert.ok(box.some((t) => /Deadline in 2 days: Project delivery – Deadline Website/.test(t)), 'told of the project 2 days ahead');
    assert.ok(box.some((t) => /Deadline in 1 day: Payment due – Balance for Deadline Website/.test(t)), 'told of the payment');
    assert.ok(box.some((t) => /Deadline missed: Milestone – Design sign-off/.test(t)), 'told of the missed milestone');
    assert.ok(!box.some((t) => /Far Away Project/.test(t)), 'not told of a deadline far away');
  }
  assert.ok(itm.some((t) => /Project delivery – Deadline Website/.test(t)) && itm.some((t) => /Design sign-off/.test(t)), 'the IT Manager is told of IT work');
  assert.ok(!itm.some((t) => /Payment due/.test(t)), 'but not of sales deadlines');
  assert.equal(bde.length, 0, 'a BDE is not told');
  assert.equal(await deadlineSweep(db, true), 0, 'each reminder is sent once');
});

test('Aali HRM certificate: read however it was pasted; Supabase\'s own root is built in', async () => {
  const { readCerts } = await import('../server/hrm.js'), { SUPABASE_ROOT_CA } = await import('../server/supabase-ca.js');
  const one = SUPABASE_ROOT_CA.trim(), body = one.split('\n').slice(1, -1).join('');
  for (const [how, v] of [['as downloaded', one], ['squashed onto one line', one.replace(/\n/g, '')], ['with \n written out', one.replace(/\n/g, '\n')], ['as base64', Buffer.from(one).toString('base64')]]) {
    const got = readCerts(v);
    assert.equal(got.length, 1, how);
    assert.equal(got[0].split('\n').slice(1, -2).join(''), body, how + ': the same certificate, with its line breaks back');
  }
  assert.deepEqual(readCerts('https://example.test/prod-ca-2021.crt'), [], 'a web link is not a certificate');
  assert.match(SUPABASE_ROOT_CA, /^-----BEGIN CERTIFICATE-----\nMIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYw/);
});

test('client payroll: each client its own rules, employees, Excel attendance and payslips in the client\'s name', async () => {
  const db = await getDb();
  for (const [id, email, title, team] of [['u_qops', 'qops@test.in', 'ops', 'management'], ['u_qcs', 'qcs@test.in', 'cs', 'management'], ['u_qch', 'qch@test.in', 'chairman', 'management'], ['u_qb', 'qb@test.in', 'bde', 'sales']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email.split('@')[0], title, team, hashPassword('password123')]);
  await db.query("update users set hr = true where id = 'u_qcs'");
  const login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  const OPS = await login('qops@test.in'), HR = await login('qcs@test.in'), CH = await login('qch@test.in'), B = await login('qb@test.in');
  const recs = async (c) => (await call('GET', '/bootstrap', null, c)).body.records;
  // A client: the employer on its payslips, with its own rules (here one day's pay = gross ÷ 26, basic 60%).
  const client = { name: 'Sri Lakshmi Textiles', address: 'Auto Nagar, Guntur', gstin: '37ABCDE1234F1Z5', pfCode: 'apgnt1234567000', esiCode: '52000123450001001', ptState: 'Andhra Pradesh',
    rules: { basicPct: 60, hraPct: 0, dayBasis: 26, pfEe: 12, pfEr: 12, pfCeiling: 15000, esiEe: 0.75, esiEr: 3.25, esiLimit: 21000, ptSlabs: [[15000, 0], [20000, 150], [0, 200]], payDay: 7 }, fee: { kind: 'employee', amount: 150 } };
  assert.equal((await call('POST', '/records', { type: 'pclient', data: client }, OPS)).status, 403, 'the Operations Manager reviews only');
  assert.equal((await call('POST', '/records', { type: 'pclient', data: { ...client, gstin: '37ABC' } }, HR)).status, 400, 'a wrong GSTIN');
  const pc = (await add(HR, 'pclient', client)).record;
  assert.deepEqual([pc.pfCode, pc.rules.dayBasis, pc.rules.basicPct, pc.attendance, pc.fee.amount], ['APGNT1234567000', 26, 60, 'excel', 150]);
  assert.equal((await call('POST', '/records', { type: 'pclient', data: { name: 'sri lakshmi textiles' } }, HR)).status, 400, 'one book per client');
  assert.ok(!(await recs(B)).some((r) => r.type === 'pclient') && (await recs(CH)).some((r) => r.type === 'pclient'), 'HR, the Operations Manager and the Chairman see client payroll – not a BDE');
  // Employees: one at a time, or from an Excel list – where one wrong row means nothing is added.
  const e1 = (await add(HR, 'pemp', { pclientId: pc.id, code: 'st-001', name: 'Ramesh K', designation: 'Loom operator', gross: 13000, pf: true, esi: true, pt: true, bank: { account: '1234567890', ifsc: 'sbin0001234' } })).record;
  assert.equal(e1.code, 'ST-001');
  assert.equal((await call('POST', '/records', { type: 'pemp', data: { pclientId: pc.id, code: 'ST-001', name: 'Twin', gross: 1 } }, HR)).status, 400, 'one code, one employee');
  const imp = (rows) => call('POST', `/payroll/clients/${pc.id}/employees`, { rows }, HR);
  const bad = await imp([{ code: 'ST-002', name: 'Sita Devi', gross: 12000 }, { code: 'ST-003', name: '', gross: 9000 }]);
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Row 3/);
  assert.ok(!(await recs(HR)).some((r) => r.type === 'pemp' && r.code === 'ST-002'), 'nothing added from a list with a wrong row');
  assert.equal((await call('POST', `/payroll/clients/${pc.id}/employees`, { rows: [{ code: 'X', name: 'Xyz', gross: 1 }] }, OPS)).status, 403);
  assert.equal((await imp([{ code: 'ST-002', name: 'Sita Devi', gross: 12000, pf: true }, { code: 'ST-003', name: 'Venu G', gross: 26000, pt: true }])).body.added, 2);
  // A month for the client: its employees, waiting for the attendance Excel.
  assert.equal((await call('POST', '/records', { type: 'payrun', data: { month: '2026-09', pclientId: pc.id } }, OPS)).status, 403);
  const run = (await add(HR, 'payrun', { month: '2026-09', pclientId: pc.id })).record;
  assert.equal(run.items.length, 3); assert.equal(run.employer.name, 'Sri Lakshmi Textiles'); assert.equal(run.att.source, 'none');
  assert.ok(run.items.every((i) => i.warn.some((w) => /No attendance from the attendance Excel/.test(w))));
  assert.equal((await call('POST', '/records', { type: 'payrun', data: { month: '2026-09', pclientId: pc.id } }, HR)).status, 400, 'one month per client');
  // The attendance Excel: every code must be the client's; then each person's pay is worked out with the client's rules.
  assert.equal((await patch(HR, run.id, { _attendance: [{ code: 'ZZ-9', present: 20 }] })).status, 400, 'a code that is not the client\'s');
  assert.equal((await patch(OPS, run.id, { _attendance: [{ code: 'ST-001', present: 20 }] })).status, 403);
  const sheet = [{ code: 'ST-001', present: 22, half: 2, paidLeave: 1 }, { code: 'st-002', paidDays: 13 }, { code: 'ST-003', present: 26 }];
  const r2 = (await patch(HR, run.id, { _attendance: sheet, _attendanceFile: 'September.xlsx' })).body.record, it = (c) => r2.items.find((i) => i.code === c);
  assert.equal(r2.att.source, 'excel'); assert.equal(r2.sheetFile, 'September.xlsx');
  assert.deepEqual([it('ST-001').days.total, it('ST-001').days.payable, it('ST-001').earned.gross, it('ST-001').ded.pf, it('ST-001').ded.esi, it('ST-001').ded.pt, it('ST-001').net], [26, 24, 12000, 864, 90, 0, 11046], 'gross ÷ 26 × 24 days; PF on 60% basic; ESI 0.75%');
  assert.deepEqual([it('ST-002').days.payable, it('ST-002').earned.gross], [13, 6000], 'paid days written in the Excel');
  assert.deepEqual([it('ST-003').earned.gross, it('ST-003').ded.esi, it('ST-003').ded.pt], [26000, 0, 200]);
  assert.equal(it('ST-001').company, 'Sri Lakshmi Textiles', 'the payslip is in the client\'s name');
  // The Founder & Chairman can step in on a draft: the change is in the month's history, and HR and the Operations Manager are told.
  const byCh = await patch(CH, run.id, { adj: { [it('ST-003').userId]: { tds: 500 } } });
  assert.equal(byCh.status, 200); assert.equal(byCh.body.record.items.find((i) => i.code === 'ST-003').ded.tds, 500);
  assert.match(byCh.body.record.log[0].text, /Changed by the Founder & Chairman for Venu G/);
  const told = (await db.query("select data->>'to' as to from records where type = 'notice' and data->>'relId' = $1 and data->>'text' like '%changed payroll%Venu G%'", [run.id])).rows.map((x) => x.to);
  assert.ok(['u_qcs', 'u_qops'].every((x) => told.includes(x)) && !told.includes('u_qch'), 'HR and the Operations Manager are told (every one of them in this shared test database)');
  assert.equal((await patch(OPS, run.id, { adj: {} })).status, 403, 'the Operations Manager still only reads');
  await patch(HR, run.id, { adj: {} });
  assert.ok((await call('GET', '/audit', null, CH)).body.rows.some((r) => r.record_id === run.id && r.section === 'clientpay'), 'a client month is in the Client payroll section of the audit log');
  // Changing an employee works the client's draft out again at once.
  assert.equal((await patch(HR, e1.id, { gross: 15600 })).status, 200);
  assert.equal((await recs(HR)).find((r) => r.id === run.id).items.find((i) => i.code === 'ST-001').earned.gross, 14400);
  assert.equal((await patch(HR, run.id, { status: 'locked' })).status, 200);
  assert.equal((await call('DELETE', '/records/' + e1.id, { reason: 'Left the mill' }, HR)).status, 400, 'on a locked month: a leaving date instead');
  assert.equal((await call('DELETE', '/records/' + pc.id, { reason: 'Not a client now' }, HR)).status, 400, 'a client with employees stays');
  assert.equal((await patch(HR, run.id, { _attendance: sheet })).status, 400, 'a locked month keeps its attendance');
  assert.ok(!(await call('GET', '/payroll/mine', null, HR)).body.slips.some((x) => x.item?.code), 'client months are never anyone\'s own payslips');
});

test('client payroll: daily wages, double shifts, overtime, attendance bonus and the client\'s recoveries', async () => {
  const db = await getDb();
  for (const [id, email, title, team] of [['u_rops', 'rops@test.in', 'ops', 'management'], ['u_rcs', 'rcs@test.in', 'cs', 'management']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email.split('@')[0], title, team, hashPassword('password123')]);
  await db.query("update users set hr = true where id = 'u_rcs'");
  const HR = (await call('POST', '/auth/login', { email: 'rcs@test.in', password: 'password123' })).cookie;
  const rules = { basicPct: 60, hraPct: 0, dayBasis: 26, pfEe: 12, pfEr: 12, pfCeiling: 15000, esiEe: 0.75, esiEr: 3.25, esiLimit: 21000, ptSlabs: [[15000, 0], [20000, 150], [0, 200]],
    dailyBasicPct: 100, shiftHours: 8, otMultiplier: 2, dailyPaid: { leave: true, holidays: true, offs: false },
    extras: [{ name: 'Attendance bonus', how: 'tiers', tiers: [[26, 40], [24, 37], [22, 35]], tierMode: 'day', who: 'daily' }, { name: 'OT hours', how: 'overtime', wages: true },
      { name: 'Canteen tokens', side: 'cut', how: 'perUnit', amount: 10 }, { name: 'Insurance', side: 'cut', how: 'fixed', amount: 100 }, { name: 'Store bill', side: 'cut', how: 'amount' }] };
  const pc = (await add(HR, 'pclient', { name: 'Gowri Spinning Mills', payModel: 'both', rules })).record;
  assert.equal(pc.payModel, 'both');
  assert.deepEqual(pc.rules.extras.map((e) => e.key), ['attendancebonus', 'othours', 'canteentokens', 'insurance', 'storebill']);
  assert.deepEqual([pc.rules.extras[1].side, pc.rules.extras[0].side], ['earn', 'earn'], 'overtime and a bonus are always earnings');
  // A daily worker needs a daily wage; a monthly-only client has no daily workers.
  assert.equal((await call('POST', '/records', { type: 'pemp', data: { pclientId: pc.id, code: 'W-0', name: 'No Rate', payType: 'daily' } }, HR)).status, 400);
  const w = (await add(HR, 'pemp', { pclientId: pc.id, code: 'W-1', name: 'Ramulu', payType: 'daily', rate: 450, pf: true, esi: true, pt: true })).record;
  assert.deepEqual([w.payType, w.rate, w.gross], ['daily', 450, 0]);
  await add(HR, 'pemp', { pclientId: pc.id, code: 'S-1', name: 'Prakash', payType: 'monthly', gross: 26000, pf: true, pt: true });
  const mo = (await add(HR, 'pclient', { name: 'Monthly Only Ltd', payModel: 'monthly' })).record;
  assert.equal((await call('POST', '/records', { type: 'pemp', data: { pclientId: mo.id, code: 'X-1', name: 'Someone', payType: 'daily', rate: 300 } }, HR)).status, 400, 'a monthly-only client pays a monthly gross');
  const run = (await add(HR, 'payrun', { month: '2026-09', pclientId: pc.id })).record;
  assert.equal((await patch(HR, run.id, { _attendance: [{ code: 'W-1', present: 25, extra: { canteentokens: 'many' } }] })).status, 400, 'the extra columns must be numbers');
  const r2 = (await patch(HR, run.id, { _attendance: [{ code: 'W-1', present: 25, double: 1, holidays: 1, extra: { othours: 6, canteentokens: 20, storebill: 350 } }, { code: 'S-1', present: 26, extra: { othours: 4 } }] })).body.record;
  const W = r2.items.find((i) => i.code === 'W-1'), S = r2.items.find((i) => i.code === 'S-1'), names = (xs) => Object.fromEntries(xs.map((x) => [x.name, x.amount]));
  // Ramulu: 25 days + 1 double shift + 1 paid holiday = 27 days × ₹450 = ₹12,150; overtime 6 h × (450 ÷ 8 × 2) = ₹675 (wages);
  // attendance bonus: 25 days worked → the 24-day tier, ₹37 a day = ₹925 (beside the wages); PF 12% of ₹12,150; ESI 0.75% of ₹12,825 (wages + overtime).
  assert.deepEqual([W.payType, W.rate, W.days.payable, W.earned.gross], ['daily', 450, 27, 12150]);
  assert.deepEqual(names(W.earnExtras), { 'OT hours': 675, 'Attendance bonus': 925 });
  assert.deepEqual([W.ded.pf, W.ded.esi, W.ded.pt], [1458, 97, 0]);
  assert.deepEqual(names(W.ded.extras), { 'Canteen tokens': 200, Insurance: 100, 'Store bill': 350 });
  assert.equal(W.net, 12150 + 675 + 925 - 1458 - 97 - 650);
  // Prakash (monthly ₹26,000, one day = ÷ 26): overtime 4 h × (26,000 ÷ 26 ÷ 8 × 2) = ₹1,000; no attendance bonus (daily workers only); insurance for everyone.
  assert.deepEqual(names(S.earnExtras), { 'OT hours': 1000 });
  assert.deepEqual([S.earned.gross, S.ded.pf, S.ded.pt, names(S.ded.extras).Insurance, S.net], [26000, 1800, 200, 100, 27000 - 1800 - 200 - 100]);
  assert.equal(r2.totals.gross, 12150 + 675 + 925 + 26000 + 1000, 'everything earned');
});

test('sign-in: a signed JWT that ends after 12 hours or an hour without use; passwords in bcrypt (older ones still work)', async () => {
  const db = await getDb(), { scryptSync, randomBytes } = await import('node:crypto');
  const scrypt = (pw) => { const salt = randomBytes(16); return `scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 32).toString('hex')}`; }; // how passwords were kept before
  await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', ['u_jw', 'jw@test.in', 'JW', 'bde', 'sales', scrypt('password123')]);
  const r = await call('POST', '/auth/login', { email: 'jw@test.in', password: 'password123' });
  assert.equal(r.status, 200, 'a password kept the old way still signs in');
  assert.match((await db.query("select pass_hash from users where id = 'u_jw'")).rows[0].pass_hash, /^\$2[aby]\$12\$/, 'and is kept as bcrypt from now on');
  assert.equal((await call('POST', '/auth/login', { email: 'jw@test.in', password: 'password123' })).status, 200, 'the bcrypt password signs in');
  assert.equal((await call('POST', '/auth/login', { email: 'jw@test.in', password: 'password124' })).status, 401);
  assert.match(r.headers['set-cookie'], /HttpOnly; SameSite=Lax; Max-Age=43200/, 'the cookie lasts 12 hours and scripts cannot read it');
  const C = r.cookie, token = C.split('=')[1], [h, p, sig] = token.split('.'), head = JSON.parse(Buffer.from(h, 'base64url')), claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual([head.alg, head.typ, claims.sub, claims.exp - claims.iat], ['HS256', 'JWT', 'u_jw', 12 * 3600]);
  assert.equal((await call('GET', '/me', null, C)).status, 200);
  // A token changed to name someone else, an unsigned one, or one past its time is refused.
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal((await call('GET', '/me', null, `aali_session=${h}.${enc({ ...claims, sub: 'u_admin' })}.${sig}`)).status, 401, 'changed');
  assert.equal((await call('GET', '/me', null, `aali_session=${enc({ alg: 'none', typ: 'JWT' })}.${p}.`)).status, 401, 'unsigned');
  assert.equal((await call('GET', '/me', null, `aali_session=${h}.${enc({ ...claims, exp: claims.iat - 1 })}.${sig}`)).status, 401, 'expired (and the signature no longer fits)');
  // An hour without a tap or keypress ends the session, even though the page keeps asking for changes.
  assert.equal((await call('GET', '/me', null, C, { 'x-idle': String(10 * 60) })).status, 200, 'ten minutes idle is fine');
  const gone = await call('GET', '/me', null, C, { 'x-idle': String(61 * 60 + 30) });
  assert.equal(gone.status, 401); assert.match(gone.body.error, /signed out after 60 minutes without use/);
  assert.equal((await call('GET', '/me', null, C)).status, 401, 'and it stays ended');
  // … and a page opened again after more than an hour away (its own idle count starts at zero) is signed out too.
  const C3 = (await call('POST', '/auth/login', { email: 'jw@test.in', password: 'password123' })).cookie;
  await db.query("update sessions set last_seen = now() - interval '2 hours' where user_id = 'u_jw'");
  assert.equal((await call('GET', '/me', null, C3, { 'x-idle': '0' })).status, 401);
  // Signing out ends the session at once (a JWT alone would stay valid until it expires).
  const C2 = (await call('POST', '/auth/login', { email: 'jw@test.in', password: 'password123' })).cookie;
  assert.equal((await call('POST', '/auth/logout', null, C2)).status, 200);
  assert.equal((await call('GET', '/me', null, C2)).status, 401);
  // bcrypt reads 72 bytes at most: a longer password is refused instead of being cut short.
  assert.equal((await call('POST', '/users', { firstName: 'Long', surname: 'Pass', email: 'lp@test.in', password: 'x'.repeat(73), title: 'bde', designation: 'BDE', company: 'Aali Conssultancy' }, admin)).status, 400);
  assert.ok(!(await call('GET', '/bootstrap', null, admin)).body.settings.jwtKey, 'the signing key never leaves the server');
});

test('client payroll: attendance from the client\'s own HRM (by Employee ID or email), extras from the Excel, the last reading kept when it is down', async () => {
  const { setHrmSource } = await import('../server/hrm.js'), { PGlite } = await import('@electric-sql/pglite');
  const db = await getDb();
  for (const [id, email, title, team] of [['u_hops', 'hops@test.in', 'ops', 'management'], ['u_hcs', 'hcs@test.in', 'cs', 'management'], ['u_hb', 'hb@test.in', 'bde', 'sales']])
    await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', [id, email, email.split('@')[0], title, team, hashPassword('password123')]);
  await db.query("update users set hr = true where id = 'u_hcs'");
  const login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  const HR = await login('hcs@test.in'), OPS = await login('hops@test.in'), B = await login('hb@test.in');
  // Their HRM needs a short link code; one code, one client.
  const rules = { basicPct: 100, hraPct: 0, dayBasis: 0, pfEe: 12, pfEr: 12, pfCeiling: 15000, esiEe: 0.75, esiEr: 3.25, esiLimit: 21000, ptSlabs: [[0, 0]], shiftHours: 8, otMultiplier: 2,
    dailyPaid: { leave: true, holidays: true, offs: false }, extras: [{ name: 'OT hours', how: 'overtime', wages: true }] };
  assert.equal((await call('POST', '/records', { type: 'pclient', data: { name: 'Gowtham Sizing', payModel: 'both', attendance: 'hrm', rules } }, HR)).status, 400, 'no link code');
  const pc = (await add(HR, 'pclient', { name: 'Gowtham Sizing', payModel: 'both', attendance: 'hrm', hrmCode: 'gsm', rules })).record;
  assert.equal(pc.hrmCode, 'GSM');
  assert.equal((await call('POST', '/records', { type: 'pclient', data: { name: 'Other Mills', attendance: 'hrm', hrmCode: 'GSM' } }, HR)).status, 400, 'the code is another client\'s');
  await add(HR, 'pemp', { pclientId: pc.id, code: 'G-1', name: 'Suresh', gross: 26000 });
  await add(HR, 'pemp', { pclientId: pc.id, code: 'G-2', name: 'Mani', payType: 'daily', rate: 500, personalEmail: 'Mani@mail.in' });
  await add(HR, 'pemp', { pclientId: pc.id, code: 'G-3', name: 'Lakshmi', gross: 20000 });
  // Not linked yet: the page names the hosting setting to add, and the month waits for the Excel as before.
  const off = (await call('GET', `/payroll/clients/${pc.id}/hrm?month=2026-09`, null, HR)).body;
  assert.deepEqual([off.connected, off.setting], [false, 'HRM_DATABASE_URL_GSM']);
  // Their HRM (a copy of Aali HRM): Suresh by Employee ID, 25 full days in September 2026 (absent on the 30th); Mani by email (another
  // Employee ID), 10 full days and one of 6 hours; Ravi is in the HRM but not on the payroll; Lakshmi is not in the HRM.
  const hrm = new PGlite('memory://');
  await hrm.exec(`create table users (id text, email text, full_name text, is_active boolean, joining_date date, designation text, department text);
    create table employee_details (user_id text, employee_id text, date_of_joining date, exit_date date);
    create table attendance (user_id text, date date, check_in timestamptz, check_out timestamptz, working_hours interval, office_time time);
    create table leave_requests (user_id text, start_date date, end_date date, leave_type text, status text);
    create table holidays (date date);
    insert into users values ('h1', 'suresh@gs.in', 'Suresh K', true, '2025-01-01', 'Sizer', 'Sizing'), ('h2', 'mani@mail.in', 'Mani', true, '2025-01-01', 'Helper', 'Sizing'),
      ('h9', 'ravi@gs.in', 'Ravi Teja', true, '2026-09-01', 'Fitter', 'Maintenance');
    insert into employee_details values ('h1', 'g-1', null, null), ('h2', 'EMP0002', null, null), ('h9', 'G-9', '2026-09-01', null);`);
  const punch = (u, s, h) => hrm.query("insert into attendance values ($1, $2, $3, $4, null, '09:00')", [u, s, `${s}T03:30:00Z`, new Date(Date.parse(`${s}T03:30:00Z`) + h * 3600e3).toISOString()]);
  for (let d = 1; d <= 29; d++) { const s = `2026-09-${String(d).padStart(2, '0')}`; if (new Date(s + 'T00:00:00Z').getUTCDay()) await punch('h1', s, 9); }
  for (const d of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) await punch('h2', `2026-09-${String(d).padStart(2, '0')}`, 9);
  await punch('h2', '2026-09-12', 6); await punch('h9', '2026-09-02', 9);
  setHrmSource((sql, p) => hrm.query(sql, p).then((r) => r.rows), 'GSM');
  try {
    const run = (await add(HR, 'payrun', { month: '2026-09', pclientId: pc.id })).record, it = (r, c) => r.items.find((i) => i.code === c);
    assert.deepEqual([run.att.connected, run.att.source, run.att.inHrm], [true, 'hrm', 2]);
    // Suresh: 25 days + 4 Sundays = 29 of 30 → ₹26,000 × 29 ÷ 30. Mani (daily): 10 days + a half day = 10.5 × ₹500 (Sundays not paid).
    assert.deepEqual([it(run, 'G-1').days.att.src, it(run, 'G-1').days.att.present, it(run, 'G-1').days.payable, it(run, 'G-1').earned.gross], ['hrm', 25, 29, 25133]);
    assert.deepEqual([it(run, 'G-2').days.payable, it(run, 'G-2').earned.gross], [10.5, 5250]);
    assert.match(it(run, 'G-3').warn[0], /Not found in Gowtham Sizing's HRM – no one there has the Employee ID G-3/);
    assert.ok(!it(run, 'G-3').days.att && !it(run, 'G-3').warn.some((w) => /^No attendance from/.test(w)), 'one clear warning');
    // The Excel brings the overtime hours (the days stay the HRM's) – and the days of someone the HRM does not have.
    const r2 = (await patch(HR, run.id, { _attendance: [{ code: 'G-1', present: 3, extra: { othours: 4 } }, { code: 'G-3', present: 26, offs: 4 }], _attendanceFile: 'Extras.xlsx' })).body.record;
    assert.deepEqual([it(r2, 'G-1').days.payable, it(r2, 'G-1').earnExtras[0]?.amount], [29, 1000], '4 h × ₹26,000 ÷ 26 ÷ 8 × 2; the HRM\'s days win');
    assert.deepEqual([it(r2, 'G-3').days.payable, it(r2, 'G-3').earned.gross, it(r2, 'G-3').warn], [30, 20000, ['No bank account on the employee\'s details.']], 'no longer "not found"');
    // Their HRM cannot be reached: the days read last time are kept.
    setHrmSource(() => { throw new Error('connection timed out'); }, 'GSM');
    const r3 = (await patch(HR, run.id, { _refresh: true })).body.record;
    assert.deepEqual([r3.att.source, it(r3, 'G-1').days.payable, it(r3, 'G-2').days.payable], ['kept', 29, 10.5]); assert.match(r3.att.error, /could not be reached/);
    setHrmSource((sql, p) => hrm.query(sql, p).then((r) => r.rows), 'GSM');
    // Their HRM tab: who is found and how, and who works there but is not on the payroll; one employee day by day.
    const st = (await call('GET', `/payroll/clients/${pc.id}/hrm?month=2026-09`, null, OPS)).body, p = (c) => st.people.find((x) => x.code === c);
    assert.deepEqual([st.connected, p('G-1').by, p('G-2').by, p('G-3').found, p('G-1').att.payable], [true, 'code', 'email', false, 29]);
    assert.deepEqual(st.unmatched.map((x) => [x.code, x.name, x.punched]), [['G-9', 'Ravi Teja', 1]]);
    const day = (await call('GET', `/payroll/clients/${pc.id}/hrm?month=2026-09&empId=${it(run, 'G-1').userId}`, null, HR)).body;
    assert.deepEqual([day.people.length, day.people[0].att.list.length, day.unmatched.length], [1, 30, 0]);
    assert.equal((await call('GET', `/payroll/clients/${pc.id}/hrm?month=2026-09`, null, B)).status, 403, 'only HR and the Operations Manager');
  } finally { setHrmSource(null, 'GSM'); }
});

test('client payroll from an HRM: on a ÷ 26 or ÷ 30 rule a monthly salary is paid in full less the days lost (a full February too)', async () => {
  const { attendanceDays, onBasis } = await import('../shared/payroll.js');
  const days = (month, from, to, skip = []) => { const r = []; for (let d = from; d <= to; d++) { const s = `${month}-${String(d).padStart(2, '0')}`; if (new Date(s + 'T00:00:00Z').getUTCDay() && !skip.includes(d)) r.push({ date: s, checkIn: true, checkOut: true, hours: 9 }); } return r; };
  const feb = attendanceDays({ month: '2026-02', today: '2026-10-08', records: days('2026-02', 1, 28) });
  assert.deepEqual([feb.present, onBasis(feb, { dayBasis: 26 }).payable, onBasis(feb, { dayBasis: 30 }).payable, onBasis(feb, { dayBasis: 0 }).payable], [24, 26, 30, 28], 'February: 24 working days, paid in full');
  const sep = attendanceDays({ month: '2026-09', today: '2026-10-08', records: days('2026-09', 1, 30, [10, 11]) });
  assert.deepEqual([onBasis(sep, { dayBasis: 26 }).payable, onBasis(sep, { dayBasis: 26 }).lost, sep.payable], [24, 2, 28], 'two days absent: 24 of 26 (Sundays are not added on top)');
  const joined = attendanceDays({ month: '2026-09', today: '2026-10-08', joined: '2026-09-16', records: days('2026-09', 16, 30) });
  assert.deepEqual([onBasis(joined, { dayBasis: 26 }).payable, onBasis(joined, { dayBasis: 30 }).payable], [13, 15], 'joined on the 16th: the working days from then (÷ 26), or the days from then (÷ 30)');
  assert.equal(onBasis(joined, { dayBasis: 26 }, { payType: 'daily' }), joined, 'a daily wage counts the days worked instead');
});

test('WhatsApp: a submitted daily report goes to each person in management on WhatsApp at once, as the approved template; failures are tried again', async () => {
  const { setWaSender, flushOutbox, reportLine } = await import('../server/whatsapp.js');
  const db = await getDb(), login = async (e) => (await call('POST', '/auth/login', { email: e, password: 'password123' })).cookie;
  for (const [id, email, title, team, phone] of [['u_wops', 'wops@test.in', 'ops', 'management', '98480 22334'], ['u_wcs', 'wcs@test.in', 'cs', 'management', '+91 9000011111'], ['u_wch', 'wch@test.in', 'chairman', 'management', ''],
    ['u_wb', 'wb@test.in', 'bde', 'sales', '9123456780'], ['u_wb2', 'wb2@test.in', 'bde', 'sales', ''], ['u_wsm', 'wsm@test.in', 'salesmgr', 'sales', '9876501234']])
    await db.query('insert into users (id,email,name,title,team,phone,designation,pass_hash) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, email, email.split('@')[0], title, team, phone, title === 'bde' ? 'BDE' : '', hashPassword('password123')]);
  const B = await login('wb@test.in'), OPS = await login('wops@test.in');
  const sent = [], wait = () => new Promise((r) => setTimeout(r, 300));
  // Not linked yet: a report submitted now is not queued (and not sent later in a flood).
  const early = (await add(await login('wsm@test.in'), 'report', { entries: [{ text: 'Planned the week' }] })).record;
  assert.equal((await patch(await login('wsm@test.in'), early.id, { status: 'submitted' })).status, 200);
  assert.equal((await db.query("select count(*)::int as n from outbox where ref = $1", [early.id])).rows[0].n, 0);
  setWaSender((to, template) => { sent.push({ to, template }); return 'wamid.' + sent.length; });
  try {
    const t0 = new Date(Date.now() - 3 * 3600e3).toISOString(), t1 = new Date(Date.now() - 3600e3).toISOString();
    const r = (await add(B, 'report', { entries: [{ text: 'Called the Guntur list\twith 4 spaces    here', kind: 'Calling', start: t0, end: t1, state: 'done' }] })).record;
    await patch(B, r.id, { calls: [{ org: 'Sri Sai Traders', phone: '9988776655', resp: 'Interested', meeting: 'Fri 11 am' }, { org: 'Ravi Stores', phone: '9988776644', resp: 'Call back' }], plan: 'Visit Sri Sai Traders\nand send the quote' });
    assert.equal((await patch(B, r.id, { status: 'submitted' })).status, 200);
    await wait();
    // The Operations Manager and the Company Secretary (each with a mobile); not the Chairman (no number yet), not the Sales Manager (not management).
    assert.deepEqual(sent.map((m) => m.to).sort(), ['919000011111', '919848022334']);
    const p = sent[0].template.components[0].parameters.map((x) => x.text);
    assert.equal(sent[0].template.name, 'daily_report'); assert.equal(p.length, 4);
    assert.match(p[0], /^wb, BDE$/); assert.match(p[2], /1 task: Called the Guntur list · with 4 spaces   here · 2 calls: 1 interested, 1 call back, 1 meeting fixed · Tomorrow: Visit Sri Sai Traders · and send the quote/);
    assert.ok(p.every((x) => !/[\n\t]| {4}/.test(x)), 'no line breaks, tabs or 4 spaces in a field (Meta refuses them)');
    assert.match(p[3], new RegExp(`/daily\\?d=${r.date}&p=u_wb$`));
    assert.deepEqual((await db.query("select status, wa_id from outbox where ref = $1 order by id", [r.id])).rows.map((x) => x.status), ['sent', 'sent']);
    // Someone in management can switch the messages off for themselves.
    assert.equal((await call('PUT', '/settings/waReports', { value: { on: true, skip: ['u_wcs'] } }, B)).status, 403);
    assert.equal((await call('PUT', '/settings/waReports', { value: { on: true, skip: ['u_wcs'] } }, OPS)).status, 200);
    // WhatsApp refuses: tried again later, the reason kept for Settings → WhatsApp.
    setWaSender(() => { throw new Error('Template name does not exist in the translation (code 132001)'); });
    const B2 = await login('wb2@test.in'), r2 = (await add(B2, 'report', { entries: [{ text: 'Follow-ups' }] })).record;
    await patch(B2, r2.id, { status: 'submitted' }); await wait();
    const q = (await db.query("select status, tries, error from outbox where ref = $1", [r2.id])).rows;
    assert.ok(q.length === 1 && q.every((x) => x.status === 'queued' && x.tries === 1 && /132001/.test(x.error)), 'only the Operations Manager now (the Company Secretary switched it off): ' + JSON.stringify(q));
    // Settings → WhatsApp shows it, for management only.
    const st = (await call('GET', '/whatsapp', null, OPS)).body;
    assert.equal(st.ready, true); assert.match(st.template.text, /Daily report from \{\{1\}\} for \{\{2\}\}/); assert.ok(st.recent.some((x) => /132001/.test(x.error)));
    assert.equal((await call('GET', '/whatsapp', null, B)).status, 403);
    // When WhatsApp takes it again, the waiting messages go (once the pause is over).
    setWaSender((to, template) => { sent.push({ to, template }); return 'wamid.x'; });
    await db.query("update outbox set next_at = now() where status = 'queued'");
    await flushOutbox(db);
    assert.ok((await db.query("select status from outbox where ref = $1", [r2.id])).rows.every((x) => x.status === 'sent'));
    assert.equal(reportLine({ entries: [], calls: [] }), '');
  } finally { setWaSender(null); }
});

test('WhatsApp: "Check the template with Meta" says whether the template is approved, a utility one, in English and with its four fields', async () => {
  const { setWaTemplates, REPORT_TEMPLATE } = await import('../server/whatsapp.js');
  const db = await getDb();
  await db.query('insert into users (id,email,name,title,team,pass_hash) values ($1,$2,$3,$4,$5,$6)', ['u_tch', 'tch@test.in', 'tch', 'chairman', 'management', hashPassword('password123')]);
  const CH = (await call('POST', '/auth/login', { email: 'tch@test.in', password: 'password123' })).cookie, ask = async () => (await call('GET', '/whatsapp/template', null, CH)).body;
  const tpl = (over) => ({ name: 'daily_report', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: REPORT_TEMPLATE }], ...over });
  try {
    assert.match((await ask()).problems[0], /WHATSAPP_BUSINESS_ACCOUNT_ID/, 'not linked yet');
    setWaTemplates(() => []); assert.match((await ask()).problems[0], /No template named "daily_report"/);
    setWaTemplates(() => [tpl({ language: 'en_US' })]); assert.match((await ask()).problems[0], /exists in en_US, not in "en"/);
    setWaTemplates(() => [tpl({ status: 'PENDING' })]); assert.match((await ask()).problems[0], /Not approved yet – Meta says PENDING/);
    setWaTemplates(() => [tpl({ status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' })]); assert.match((await ask()).problems[0], /rejected it: INVALID_FORMAT/);
    setWaTemplates(() => [tpl({ category: 'MARKETING', components: [{ type: 'BODY', text: 'Report {{1}} {{2}} {{3}}.' }] })]);
    const two = await ask(); assert.equal(two.ok, false); assert.ok(two.problems.some((p) => /MARKETING/.test(p)) && two.problems.some((p) => /3 fields/.test(p)));
    setWaTemplates(() => [tpl()]); const good = await ask(); assert.deepEqual([good.ok, good.status, good.category, good.sameText], [true, 'APPROVED', 'UTILITY', true]);
    assert.equal((await call('GET', '/whatsapp/template', null, (await call('POST', '/auth/login', { email: 'wb@test.in', password: 'password123' })).cookie)).status, 403, 'not for a BDE');
  } finally { setWaTemplates(null); }
});
