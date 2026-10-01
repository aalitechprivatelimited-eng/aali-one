// Creates demo logins and sample data by driving the real API (so every rule, number and log is genuine).
// Usage: DATABASE_URL=... DEMO_PASSWORD=... node scripts/seed.js   (writes DEMO-LOGINS.md, which is git-ignored)
import { Readable } from 'node:stream';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { handle } from '../server/app.js';
import { getDb } from '../server/db.js';
import { hashPassword, createSession, dropSession } from '../server/auth.js';

if (!process.env.DATABASE_URL && !process.env.PGLITE_DIR && existsSync('.env.local')) for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^(DATABASE_URL)="?([^"]*)"?$/); if (m) process.env[m[1]] = m[2]; }
const PW = process.env.DEMO_PASSWORD || 'Aali-' + randomBytes(4).toString('hex');
let pwSet = false; const tokens = [];
const DOMAIN = 'aali.demo';

function call(method, path, body, cookie = '') {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url: '/api' + path, headers: { cookie, 'content-type': 'application/json' } });
  return new Promise((resolve, reject) => {
    const res = { writeHead(s, h) { this.s = s; this.h = h; }, end(b) { const j = JSON.parse(Buffer.isBuffer(b) ? b.toString() : b); if (this.s >= 400) reject(new Error(`${method} ${path}: ${j.error}`)); else resolve({ body: j, cookie: String(this.h['set-cookie'] || '').split(';')[0] }); } };
    handle(req, res);
  });
}
const d = (n) => { const x = new Date(Date.now() + 5.5 * 3600e3); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const PEOPLE = [
  ['nikhil', 'Nikhil', 'ops', true], ['chairman', 'Azagar Ali Shaik', 'chairman', false], ['cs', 'Kavya Reddy', 'cs', true], ['sales', 'Rahul Varma', 'salesmgr', false],
  ['ravi', 'Ravi Kumar', 'bde', false], ['sneha', 'Sneha Patel', 'bde', false], ['arjun', 'Arjun Rao', 'bde', false],
  ['it', 'Suresh Babu', 'itmgr', false], ['priya', 'Priya Nair', 'itlead', false], ['kiran', 'Kiran Teja', 'dev', false],
];

const DESIG = { nikhil: 'Operations Manager', chairman: 'Founder & Chairman', cs: 'Company Secretary', sales: 'Sales Manager', ravi: 'BDE - Sales', sneha: 'BDE - Digital Marketing and Sales', arjun: 'BDE - Sales',
  it: 'IT Manager', priya: 'IT Team Lead', kiran: 'Operations Executive' };

const db = await getDb();
const start = (await db.query('select now() as t')).rows[0].t;
const ids = {}, c = {};
for (const [key, name, title, admin] of PEOPLE) {
  const email = `${key}@${DOMAIN}`, team = { ops: 'management', chairman: 'management', cs: 'management', salesmgr: 'sales', bde: 'sales', itmgr: 'it', itlead: 'it', dev: 'it' }[title];
  const ex = (await db.query('select id from users where email = $1', [email])).rows[0];
  const id = ex?.id || 'u_' + key;
  if (!ex) await db.query('insert into users (id,email,name,title,team,phone,is_admin,pass_hash,company,designation,surname) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, email, name, title, team, '9' + String(100000000 + PEOPLE.findIndex((p) => p[0] === key) * 1111111).slice(0, 9), admin, hashPassword(PW),
    team === 'management' ? 'Aali Group' : 'Aali Conssultancy', DESIG[key], name.includes(' ') ? name.split(' ').slice(1).join(' ') : '']);
  else await db.query('update users set is_admin = $2, updated_at = now() where id = $1 and is_admin <> $2', [id, admin]);
  // Existing logins keep their password unless DEMO_PASSWORD is given.
  if (ex && process.env.DEMO_PASSWORD) await db.query('update users set pass_hash = $2 where id = $1', [id, hashPassword(PW)]);
  if (!ex || process.env.DEMO_PASSWORD) pwSet = true;
  const tk = await createSession(db, id); tokens.push(tk); ids[key] = id; c[key] = 'aali_session=' + tk;
}
const already = (await db.query('select count(*)::int n from records where sample')).rows[0].n;
if (already && !process.argv.includes('--again')) { console.log(`Sample data already present (${already} records). Logins refreshed.`); }
else {
  const add = async (who, type, data) => (await call('POST', '/records', { type, data }, c[who])).body.record;
  const upd = (who, id, data) => call('PATCH', '/records/' + id, { data }, c[who]);

  // Clients
  const cl = {};
  for (const [k, name, phone, city, gstin, owner] of [['sun', 'Sunrise Dental Clinic', '9876543210', 'Guntur', '37ABCDE1234F1Z5', 'ravi'], ['kav', 'Kaveri Traders', '9848022338', 'Vijayawada', '', 'sneha'],
    ['city', 'City Care Pharmacy', '9000011122', 'Guntur', '37PQRSX5678L1Z2', 'ravi'], ['uday', 'Uday Boys Hostel', '9123456780', 'Guntur', '', 'arjun'], ['palm', 'Hotel Palm Grove', '9988776655', 'Tenali', '', 'sneha'], ['green', 'Green Valley School', '9012345678', 'Mangalagiri', '', 'arjun']])
    cl[k] = await add('sales', 'client', { name, phone, city, gstin, owner: ids[owner], address: `${city}, Andhra Pradesh`, contacts: [{ name: { sun: 'Dr. Mehta', kav: 'Suresh', city: 'Mr. Rao', uday: 'Uday Kiran', palm: 'Manager', green: 'Principal' }[k], phone, role: 'Owner' }] });

  // Leads (auto-assigned in turns; one repeat enquiry; one import-style)
  const L = [];
  for (const [name, mobile, service, source, score, status] of [['Anil Kumar', '9701234501', 'Website – 5 pages', 'Website', 'hot', 'contacted'], ['Meena Stores', '9701234502', 'E-commerce website', 'Walk-in', 'warm', 'new'],
    ['Dr. Lakshmi', '9701234503', 'Mobile app (Android + iOS)', 'Referral', 'hot', 'qualified'], ['Sai Constructions', '9701234504', 'Software / ERP', 'Phone call', 'cold', 'contacted'],
    ['Fresh Mart', '9701234505', 'SEO & digital marketing', 'Facebook / Instagram', 'warm', 'new'], ['Royal Tailors', '9701234506', 'Website – 5 pages', 'WhatsApp', '', 'new']])
    L.push(await add('nikhil', 'lead', { name, mobile, service, source, score, status, company: name, message: `Needs ${service.toLowerCase()}`, followUp: d(L.length % 3 - 1) }));
  await call('POST', '/public/enquiry', { name: 'Anil Kumar', mobile: '97012 34501', service: 'Website – 5 pages', message: 'Asked again on the website form' });
  await add('ravi', 'activity', { kind: 'call', status: 'done', leadId: L[0].id, owner: L[0].owner, at: new Date().toISOString(), outcome: 'Interested', duration: 6, notes: 'Wants online booking. Send quote.' });
  await add('sneha', 'activity', { kind: 'meeting', status: 'planned', leadId: L[2].id, owner: L[2].owner, at: `${d(1)}T16:00`, place: 'Clinic, Brodipet', subject: 'Demo of patient app' });

  // Deals across the pipeline
  const deal = async (who, k, title, service, value, stage, extra = {}) => { const x = await add(who, 'deal', { title, clientId: cl[k].id, contactName: cl[k].contacts[0].name, phone: cl[k].phone, service, value, stage: 'lead', owner: ids[who], closeDate: d(20), followUp: d(1), source: 'Referral', ...extra });
    if (stage !== 'lead') await upd(who, x.id, stage === 'lost' ? { stage, lostReason: 'Price too high' } : { stage }); return x; };
  const dSun = await deal('ravi', 'sun', 'Website – Sunrise Dental', 'Website – 5 pages', 45000, 'proposal', { followUp: d(-2), priority: true });
  const dKav = await deal('sneha', 'kav', 'Mobile app – Kaveri Traders', 'Mobile app (Android + iOS)', 250000, 'negotiation', { followUp: d(0) });
  const dCity = await deal('ravi', 'city', 'Website – City Care Pharmacy', 'Website – 5 pages', 38000, 'won');
  const dUday = await deal('arjun', 'uday', 'Hostel management app – Uday', 'Software / ERP', 120000, 'won', { priority: true });
  await deal('sneha', 'palm', 'SEO – Hotel Palm Grove', 'SEO & digital marketing', 30000, 'meeting', { followUp: d(3) });
  await deal('arjun', 'green', 'Fee software – Green Valley', 'Software / ERP', 180000, 'lost');
  await deal('arjun', 'green', 'Website – Green Valley School', 'Website – 5 pages', 55000, 'contacted', { followUp: d(-4) });
  await upd('ravi', dSun.id, { cadence: { id: 'cd-quote', start: d(-3), done: [0] } });

  // Quotations (one over the discount limit → approval)
  const line = (desc, rate, note = '') => ({ desc, note, qty: 1, unit: 'Project', rate });
  await add('sales', 'quote', { dealId: dSun.id, clientId: cl.sun.id, clientName: cl.sun.name, contactName: 'Dr. Mehta', phone: cl.sun.phone, subject: 'Clinic website with online booking', date: d(-3), validUntil: d(12), items: [line('Website – 5 pages', 40000, 'Design, 5 pages, booking form'), line('Online appointment booking', 5000)], taxMode: 'intra', taxRate: 18, discountType: 'none', status: 'sent' });
  await add('sales', 'quote', { dealId: dKav.id, clientId: cl.kav.id, clientName: cl.kav.name, contactName: 'Suresh', phone: cl.kav.phone, subject: 'Ordering app for retailers', date: d(-1), validUntil: d(14), items: [line('Mobile app (Android + iOS)', 250000)], taxMode: 'intra', taxRate: 18, discountType: 'percent', discountValue: 15 });
  const qCity = await add('sales', 'quote', { dealId: dCity.id, clientId: cl.city.id, clientName: cl.city.name, contactName: 'Mr. Rao', phone: cl.city.phone, subject: 'Pharmacy website', date: d(-25), validUntil: d(-10), items: [line('Website – 5 pages', 38000)], taxMode: 'intra', taxRate: 18, discountType: 'none' });
  await upd('sales', qCity.id, { status: 'accepted' });

  // Won deals → handoff → projects
  await upd('ravi', dCity.id, { handoff: { scope: '5-page website: Home, About, Products, Offers, Contact. Contact form + WhatsApp button. Not included: online ordering.', deadline: d(8), advance: false } });
  const pCity = await add('ravi', 'project', { name: 'Website – City Care Pharmacy', clientId: cl.city.id, clientName: cl.city.name, dealId: dCity.id, stage: 'awaiting', deadline: d(8), start: d(-12), scope: '5-page website with contact form and WhatsApp button.', people: [ids.ravi], lead: '' });
  const adv = await add('sales', 'payment', { title: 'Advance (50%)', kind: 'advance', clientId: cl.city.id, dealId: dCity.id, amount: 19000, due: d(-11), owner: ids.ravi });
  await add('sales', 'receipt', { date: d(-10), paymentId: adv.id, clientId: cl.city.id, dealId: dCity.id, payerName: cl.city.name, payerPhone: cl.city.phone, items: [{ desc: 'Advance – pharmacy website', amount: 19000, incl: true }], taxMode: 'intra', taxRate: 18, mode: 'UPI', reference: 'UPI 4411 2290 7731', against: qCity.number });
  await upd('it', pCity.id, { lead: ids.priya, stage: 'development', people: [ids.ravi, ids.kiran] });
  const tpl = [['Collect content and logo from client', -9, false, 'done'], ['Design home page', -6, false, 'done'], ['Design approved by client', -4, true, 'done'], ['Build all pages', 2, false, 'doing'], ['Contact form + WhatsApp button', 4, false, 'todo'], ['Testing on mobile and desktop', 6, false, 'todo'], ['Go live + domain connect', 8, true, 'todo']];
  let prev = '';
  for (const [title, day, ms, status] of tpl) { const t = await add('priya', 'task', { title, projectId: pCity.id, due: d(day), start: d(day - 3), milestone: ms, status: 'todo', priority: day < 3 ? 'high' : 'medium', owner: ms ? ids.priya : ids.kiran, team: 'it', dependsOn: prev, estimate: 6, timeLogs: status === 'done' ? [{ at: d(day), by: ids.kiran, hours: 5 }] : [] }); if (status !== 'todo') await upd('priya', t.id, { status }); prev = t.id; }
  await upd('priya', pCity.id, { changes: [{ id: 'ch1', text: 'Client wants a bigger logo on mobile', from: 'client', severity: 'normal', owner: ids.kiran, status: 'open', at: new Date().toISOString(), by: ids.ravi }] });
  await add('sales', 'payment', { title: 'Balance on delivery', kind: 'final', clientId: cl.city.id, dealId: dCity.id, amount: 19000, due: d(9), owner: ids.ravi });

  await upd('arjun', dUday.id, { handoff: { scope: 'Hostel app: rooms, residents, fee collection, receipts, reports.', deadline: d(30), advance: false } });
  const pUday = await add('arjun', 'project', { name: 'Hostel management app – Uday', clientId: cl.uday.id, clientName: cl.uday.name, dealId: dUday.id, stage: 'awaiting', deadline: d(30), start: d(0), scope: 'Hostel app: rooms, residents, fee collection, receipts, reports.', people: [ids.arjun], priority: true });
  await add('sales', 'payment', { title: 'Advance (50%)', kind: 'advance', clientId: cl.uday.id, dealId: dUday.id, amount: 60000, due: d(-1), owner: ids.arjun });

  // A delivered project with sign-off, and maintenance
  const pDone = await add('it', 'project', { name: 'Website – Green Valley School (phase 1)', clientId: cl.green.id, clientName: cl.green.name, stage: 'testing', deadline: d(-5), start: d(-40), lead: ids.priya, scope: 'Admissions website, 6 pages.' });
  const sig = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><path d="M20 80 C 60 20, 90 110, 130 60 S 200 30, 230 80 S 300 90, 380 40" stroke="#111" stroke-width="3" fill="none"/></svg>');
  await add('priya', 'signoff', { projectId: pDone.id, project: pDone.name, client: cl.green.name, scope: 'Admissions website with 6 pages and enquiry form.', signerName: 'Principal, Green Valley', signerRole: 'Principal', signerPhone: cl.green.phone, rating: 4, ratingComment: 'Good work, slightly late.', signature: sig, confirmed: true });
  await add('sales', 'payment', { title: 'Website maintenance fee', kind: 'maintenance', clientId: cl.green.id, amount: 1500, due: d(-3), repeat: 'monthly', owner: ids.arjun });
  await add('sales', 'payment', { title: 'Domain + hosting renewal', kind: 'renewal', clientId: cl.palm.id, amount: 4500, due: d(20), repeat: 'yearly', owner: ids.sneha });

  // Support, tasks, targets, comments
  await add('it', 'ticket', { title: 'Enquiry form not sending emails', clientId: cl.green.id, projectId: pDone.id, priority: 'urgent', owner: ids.kiran, promised: d(-1), detail: 'Parents say the form shows an error.' });
  await add('it', 'ticket', { title: 'Add new fee category', clientId: cl.uday.id, priority: 'normal', owner: ids.priya, promised: d(4) });
  await add('nikhil', 'task', { title: 'Prepare Monday review for the Chairman', owner: ids.nikhil, due: d(0), priority: 'high', status: 'todo', team: 'management', recurrence: 'weekly', remindAt: '10:00' });
  await add('nikhil', 'task', { title: 'Renew office internet', owner: ids.nikhil, due: d(5), priority: 'low', status: 'todo', subtasks: [{ t: 'Compare plans', done: true }, { t: 'Pay bill', done: false }] });
  await add('sales', 'task', { title: 'Plan hospital outreach list', owner: ids.sales, due: d(2), priority: 'medium', status: 'doing', team: 'sales', people: [ids.ravi, ids.sneha] });
  const month = d(0).slice(0, 7);
  for (const [k, amt] of [['ravi', 300000], ['sneha', 400000], ['arjun', 250000]]) await add('sales', 'target', { userId: ids[k], month, amount: amt });
  await add('sales', 'comment', { relType: 'deal', relId: dKav.id, text: '@Sneha please confirm the 15% discount with me before sending.', mentions: [ids.sneha] });
  await db.query('update records set sample = true where created_at >= $1', [start]);
  console.log('Sample data created:', (await db.query('select count(*)::int n from records where sample')).rows[0].n, 'records');
}

// Second sample set (added once): more projects for the calendar, and three days of daily work reports.
if (!(await db.query("select count(*)::int n from records where type = 'report'")).rows[0].n) {
  const start2 = (await db.query('select now() as t')).rows[0].t;
  const add = async (who, type, data) => (await call('POST', '/records', { type, data }, c[who])).body.record;
  const upd = (who, id, data) => call('PATCH', '/records/' + id, { data }, c[who]);
  const byName = async (type, name) => (await db.query("select id from records where deleted_at is null and type = $1 and data->>'name' = $2 limit 1", [type, name])).rows[0]?.id || '';

  const proj = async (name, client, stage, from, to, lead, tasks) => {
    const p = await add('it', 'project', { name, clientId: await byName('client', client), clientName: client, stage, start: d(from), deadline: d(to), lead: ids[lead], people: [ids.kiran, ids.priya], scope: name });
    for (const [title, day, ms, status] of tasks) { const t = await add('priya', 'task', { title, projectId: p.id, due: d(day), start: d(day - 3), milestone: ms, status: 'todo', priority: 'medium', owner: ms ? ids.priya : ids.kiran, team: 'it' }); if (status !== 'todo') await upd('priya', t.id, { status }); }
    return p;
  };
  const pPalm = await proj('Website revamp – Hotel Palm Grove', 'Hotel Palm Grove', 'design', -5, 16, 'priya', [['Collect photos and room details', -3, false, 'done'], ['Design home page', 1, false, 'doing'], ['Design approved by client', 4, true, 'todo'], ['Build all pages', 11, false, 'todo'], ['Website ready for client review', 13, true, 'todo'], ['Go live + domain connect', 16, true, 'todo']]);
  const pKav = await proj('Billing software – Kaveri Traders', 'Kaveri Traders', 'testing', -24, 3, 'priya', [['Requirements signed by client', -20, true, 'done'], ['Item master and billing screens', -10, false, 'done'], ['Stock and sales reports', -4, false, 'done'], ['GST invoice print approved', -2, true, 'done'], ['Testing with client data', 1, false, 'doing'], ['Training and handover', 3, true, 'todo']]);
  const pGreen = await proj('Admissions portal – Green Valley School', 'Green Valley School', 'development', -30, -2, 'kiran', [['Screen designs approved', -22, true, 'done'], ['Application form', -12, false, 'done'], ['Fee payment page', -5, false, 'doing'], ['Parent login', -3, false, 'todo'], ['Go live', -2, true, 'todo']]);
  const pCity = await byName('project', 'Website – City Care Pharmacy');
  const P = (id, name) => (id ? { refId: id, refLabel: 'Project: ' + name, refLink: '/projects/' + id } : {});

  // ---- daily reports: timed tasks, client visits, breaks and call sheets ----
  const dayMs = (day, hhmm) => new Date(`${d(day)}T${hhmm}:00+05:30`).getTime();
  const iso2 = (ms) => new Date(ms).toISOString();
  // tasks: [startHH:MM, minutes, kind, text, extra]; for today the times are worked back from now.
  const tasks = (day, list) => { let t0 = day ? 0 : Date.now() - list.reduce((n, x) => n + x[1] + 5, 0) * 60e3; return list.map(([hh, mins, kind, text, extra = {}]) => {
    const st = day ? dayMs(day, hh) : t0; t0 = st + (mins + 5) * 60e3;
    return { text, kind, start: iso2(st), end: iso2(st + mins * 60e3), mins, at: iso2(st), ...(kind === 'Break' ? { brk: true } : {}), ...extra }; }); };
  const visit = (client, person, phone, place, note) => ({ visit: { client, person, phone, place }, proj: client, ...(note ? { note } : {}) });
  const ORGS = ['Sri Sai Furniture', 'Lotus Salon & Spa', 'Green Leaf Restaurant', 'Vijaya Dall Mill', 'Hotel R5', 'Crown Furnitures', 'Elite Glam Studio', 'Cake Box', 'GKR School', 'Ahalya Nursing Home', 'MF Foods', 'VR Boutique',
    'Trends Beauty Hub', 'Raksha Pipes', 'KK Distributors', 'US Travels', 'Manikanta Industries', 'Venu Packaging', 'Bakers Pride', 'Shilpa Collection', 'Hi Tech Furniture', 'Balaji Furnitures', 'Youth Hostel', 'Sai Kusuma Boys Hostel'];
  const PLACES = ['Guntur', 'Vijayawada', 'Tenali', 'Bapatla', 'Eluru', 'Ongole'];
  const RESP = ['Not interested', 'Not interested', 'No answer', 'Not interested', 'Call back', 'Busy', 'Interested', 'Not interested', 'Wrong number', 'No answer', 'Not reachable', 'Call back'];
  let seedN = 7; const rnd = () => (seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648;
  const calls = (n, off) => [...Array(n)].map((_, i) => { const resp = RESP[(i * 5 + off) % RESP.length], org = ORGS[(i * 7 + off * 3) % ORGS.length];
    return { org, phone: '9' + String(Math.floor(rnd() * 9e8) + 1e8), place: PLACES[(i + off) % PLACES.length], resp, meeting: resp === 'Interested' ? (i % 2 ? 'Tomorrow 11 am' : 'Friday 4 pm') : '', met: false,
      note: resp === 'Interested' ? 'Wants a quotation for a 5-page website' : resp === 'Call back' ? 'Asked to call after 2 days' : '' }; });
  const report = async (who, day, data, { submit = true, review = '', remark = '' } = {}) => {
    const r = await add(who, 'report', { date: d(day), plan: '', blockers: '', ...data });
    if (submit) await upd(who, r.id, { status: 'submitted' });
    if (review) await upd(review, r.id, { _reviewed: true, ...(remark ? { _remark: remark } : {}) });
  };
  const B = (hh, m = 60) => [hh, m, 'Break', 'Break'];
  for (const day of [-2, -1]) {
    await report('ravi', day, { calls: calls(22 + day, 1), entries: tasks(day, [['09:15', 105, 'Calling', 'Calling clinics and salons from the Guntur list'], ['11:05', 50, 'Information gathering', 'Collected 30 new numbers of furniture shops in Eluru from Google Maps'],
      ['12:00', 80, 'Client visit / meeting', 'Explained the website quotation and booking feature', visit('Sunrise Dental Clinic', 'Dr. Mehta, Owner', '9876543210', 'Brodipet, Guntur', 'Agreed in principle; wants to start next week')],
      B('13:30'), ['14:35', 120, 'Calling', 'Second round of calls; follow-ups from yesterday'], ['16:45', 70, 'Follow-up messages', 'Sent website samples on WhatsApp to 6 interested shops'], ['18:00', 45, 'Quotation / paperwork', 'Noted requirements for the Sales Manager to prepare two quotations']]),
      plan: 'Follow up Sunrise Dental; visit two clinics in Brodipet.' }, { review: 'sales', remark: day === -1 ? 'Good. Push Sunrise Dental to close this week.' : '' });
    await report('sneha', day, { calls: calls(15, 4), entries: tasks(day, [['09:20', 70, 'Poster / design work', 'Dasara offer poster for Aali Conssultancy social pages'], ['10:35', 95, 'Calling', 'Calling retailers in Vijayawada'],
      ['12:15', 75, 'Video making', 'Shot and edited a 30-second reel for the café client', { proj: 'Vaaradhi Cafe', note: 'Waiting for the logo file from the client' }], B('13:30'),
      ['14:40', 110, 'Client work (photo editing etc.)', 'Edited 12 room photos for the hotel gallery', { proj: 'Hotel Palm Grove' }], ['16:40', 90, 'Calling', 'Follow-up calls; sent SEO plan to Hotel Palm Grove']]),
      plan: 'Demo for Dr. Lakshmi at 4 pm.' }, { review: 'sales' });
    await report('arjun', day, { calls: calls(12, 8), entries: tasks(day, [['09:40', 60, 'Calling', 'Calling hostels in Guntur'], ['11:00', 100, 'Client visit / meeting', 'Went to collect the advance; owner asked for two more days', visit('Uday Boys Hostel', 'Uday Kiran, Owner', '9123456780', 'Lakshmipuram, Guntur', 'Advance promised by Friday')],
      B('13:30'), ['15:20', 90, 'Calling', 'Called schools about websites']]),
      plan: 'Collect the Uday advance.', blockers: day === -1 ? 'Uday advance still not received, so the project cannot start.' : '' }, { review: day === -2 ? 'sales' : '' });
    await report('sales', day, { entries: tasks(day, [['09:10', 50, 'Team management', 'Morning call with the BDE team; checked every follow-up'], ['10:10', 110, 'Quotation / paperwork', 'Prepared quotations for Sunrise Dental and Kaveri Traders'],
      ['12:10', 60, 'Calling', 'Spoke to Kaveri Traders about the 15% discount request'], B('13:30'), ['14:40', 120, 'Team management', 'Reviewed call sheets and planned the hospital outreach list'], ['17:00', 60, 'Payment collection', 'Followed up two overdue payments']]),
      plan: 'Plan the hospital outreach list.' }, { review: day === -2 ? 'nikhil' : '' });
    await report('priya', day, { entries: tasks(day, [['09:10', 110, 'Design', 'Home page design for the hotel website, mobile and desktop', { proj: 'Hotel Palm Grove' }], ['11:10', 130, 'Testing', 'Tested GST invoice print with the client’s real items', { proj: 'Kaveri Traders', note: 'Two rounding issues found and fixed' }],
      B('13:30'), ['14:40', 100, 'Client changes', 'Fixed the mobile menu and bigger logo', { proj: 'City Care Pharmacy' }], ['16:30', 90, 'Team management', 'Reviewed Kiran’s pages; planned tomorrow’s work']]),
      plan: 'Client training plan for Kaveri Traders.' }, { review: 'it' });
    await report('kiran', day, { entries: tasks(day, [['09:20', 150, 'Development', 'Built the Products and Offers pages', { proj: 'City Care Pharmacy' }], ['12:00', 80, 'Development', 'Fee payment page: gateway test payments working', { proj: 'Green Valley School' }],
      B('13:30'), ['14:35', 140, 'Development', 'Parent login with OTP', { proj: 'Green Valley School' }], ['17:05', 55, 'Testing', 'Checked all pages on three phones', { proj: 'City Care Pharmacy' }]]),
      plan: 'Finish parent login.', blockers: day === -1 ? 'Waiting for the school to send the fee structure.' : '' }, { review: day === -2 ? 'it' : '' });
    await report('it', day, { entries: tasks(day, [['09:15', 60, 'Team management', 'Checked progress on all projects with the Team Lead'], ['10:20', 170, 'Development', 'Login and roles for the hostel app', { proj: 'Uday Boys Hostel' }], B('13:30'),
      ['14:40', 90, 'Meeting', 'Call with Green Valley School about the late portal; agreed a new plan', { proj: 'Green Valley School' }], ['16:20', 100, 'Testing', 'Verified the Team Lead’s corrections before deployment']]),
      plan: 'Assign a lead for the Uday hostel app once the advance comes.' }, {});
  }
  // today: some people are mid-day, one has a gap, one is on a visit, one has not started
  await report('ravi', 0, { calls: calls(14, 2), entries: tasks(0, [['', 95, 'Calling', 'Calling clinics; 6 picked up'], ['', 40, 'Follow-up messages', 'Sent website samples to three interested clinics'],
    ['', 70, 'Client visit / meeting', 'Second meeting about the clinic website', visit('Sunrise Dental Clinic', 'Dr. Mehta, Owner', '9876543210', 'Brodipet, Guntur', 'Confirmed; advance on Monday')]]) }, { submit: false });
  await report('sneha', 0, { calls: calls(6, 5), entries: tasks(0, [['', 80, 'Video making', 'Reel for the café opening offer', { proj: 'Vaaradhi Cafe' }], ['', 60, 'Break', 'Break'], ['', 55, 'Calling', 'Kaveri Traders asked for the 15% discount again']]),
    blockers: 'Need the Sales Manager to decide the Kaveri discount today.' }, { submit: false });
  await report('sales', 0, { entries: tasks(0, [['', 45, 'Team management', 'Morning call with the BDE team'], ['', 90, 'Quotation / paperwork', 'Revised quotation for Kaveri Traders']]) }, { submit: false });
  await report('priya', 0, { entries: tasks(0, [['', 120, 'Design', 'Home page design sent to the client for approval', { proj: 'Hotel Palm Grove' }], ['', 100, 'Testing', 'Testing billing with 200 real items', { proj: 'Kaveri Traders' }]]) }, { submit: false });
  await report('kiran', 0, { entries: tasks(0, [['', 130, 'Development', 'Contact form and WhatsApp button working', { proj: 'City Care Pharmacy' }], ['', 110, 'Development', 'Parent login: OTP screen done', { proj: 'Green Valley School' }]]), plan: 'Finish parent login.' });

  // ---- collaborations of Aali Conssultancy (management only) ----
  for (const [kind, name, city, offers, contact, since, till, terms] of [
    ['college', 'Sri Vidya College of Engineering', 'Guntur', 'B.Tech (CSE, ECE, Mechanical), MBA', 'Dr. Ramana, Admissions Head', -400, 200, '8% of first-year fee per admitted student.'],
    ['college', 'Narmada Nursing College', 'Vijayawada', 'B.Sc Nursing, GNM', 'Sister Mary, Principal', -200, 20, 'Fixed ₹15,000 per admission.'],
    ['college', 'Krishna Degree College', 'Tenali', 'B.Com, B.Sc, BBA', 'Mr. Prasad, Correspondent', -700, -15, '5% of first-year fee.'],
    ['employer', 'Sunrise Hospitals', 'Guntur', 'Staff nurses, front office, billing', 'Ms. Anitha, HR', -150, 215, 'One month salary per placed candidate.'],
    ['employer', 'Kaveri Retail', 'Vijayawada', 'Sales executives, store supervisors', 'Mr. Suresh, Owner', -90, '', '₹5,000 per joined candidate after 30 days.'],
  ]) await add('nikhil', 'collab', { kind, name, city, offers, contact, phone: '9' + String(Math.floor(rnd() * 9e8) + 1e8), since: d(since), validTill: till === '' ? '' : d(till), terms, status: 'active' });

  // ---- one person on long leave (deactivated) and one who left (removed): both stay in the Staff register ----
  const mk = async (first, sur, email, title, designation) => (await call('POST', '/users', { firstName: first, surname: sur, email, password: PW, title, company: 'Aali Conssultancy', designation, phone: '9' + String(Math.floor(rnd() * 9e8) + 1e8) }, c.nikhil)).body.user;
  const leave = await mk('Praveen', 'Kumar', `praveen@${DOMAIN}`, 'bde', 'BDE - Sales'), left = await mk('Divya', 'Rani', `divya@${DOMAIN}`, 'dev', 'Junior Developer');
  await call('PATCH', '/users/' + leave.id, { active: false }, c.nikhil);
  await call('DELETE', '/users/' + left.id, { reason: 'Resigned – last working day 26 Sep' }, c.nikhil);
  await db.query('update records set sample = true where created_at >= $1', [start2]);
  console.log('Second sample set created: 3 projects and', (await db.query("select count(*)::int n from records where type = 'report'")).rows[0].n, 'daily reports');
}
for (const tk of tokens) await dropSession(db, tk);
if (pwSet && !process.env.NO_LOGIN_FILE) {
  writeFileSync('DEMO-LOGINS.md', `# Aali One demo logins (keep private – not in git)\n\nPassword for every demo account: \`${PW}\`\n\n| Login | Name | Role |\n|---|---|---|\n${PEOPLE.map(([k, n, t, a]) => `| ${k}@${DOMAIN} | ${n} | ${t}${a ? ' (admin)' : ''} |`).join('\n')}\n`);
  console.log('Logins written to DEMO-LOGINS.md');
} else console.log('Existing logins kept (password not changed).');
process.exit(0);
