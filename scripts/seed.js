// Creates demo logins and sample data by driving the real API (so every rule, number and log is genuine).
// Usage: DATABASE_URL=... DEMO_PASSWORD=... node scripts/seed.js   (writes DEMO-LOGINS.md, which is git-ignored)
import { Readable } from 'node:stream';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { handle } from '../server/app.js';
import { getDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

if (!process.env.DATABASE_URL && !process.env.PGLITE_DIR && existsSync('.env.local')) for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^(DATABASE_URL)="?([^"]*)"?$/); if (m) process.env[m[1]] = m[2]; }
const PW = process.env.DEMO_PASSWORD || 'Aali-' + randomBytes(4).toString('hex');
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
  ['nikhil', 'Nikhil', 'ops', true], ['chairman', 'Azagar Ali Shaik', 'chairman', false], ['cs', 'Kavya Reddy', 'cs', false], ['sales', 'Rahul Varma', 'salesmgr', false],
  ['ravi', 'Ravi Kumar', 'bde', false], ['sneha', 'Sneha Patel', 'bde', false], ['arjun', 'Arjun Rao', 'bde', false],
  ['it', 'Suresh Babu', 'itmgr', false], ['priya', 'Priya Nair', 'itlead', false], ['kiran', 'Kiran Teja', 'dev', false],
];

const db = await getDb();
const start = (await db.query('select now() as t')).rows[0].t;
const ids = {}, c = {};
for (const [key, name, title, admin] of PEOPLE) {
  const email = `${key}@${DOMAIN}`, team = { ops: 'management', chairman: 'management', cs: 'management', salesmgr: 'sales', bde: 'sales', itmgr: 'it', itlead: 'it', dev: 'it' }[title];
  const ex = (await db.query('select id from users where email = $1', [email])).rows[0];
  const id = ex?.id || 'u_' + key;
  if (!ex) await db.query('insert into users (id,email,name,title,team,phone,is_admin,pass_hash) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, email, name, title, team, '9' + String(100000000 + PEOPLE.findIndex((p) => p[0] === key) * 1111111).slice(0, 9), admin, hashPassword(PW)]);
  else await db.query('update users set pass_hash = $2 where id = $1', [id, hashPassword(PW)]);
  ids[key] = id; c[key] = (await call('POST', '/auth/login', { email, password: PW })).cookie;
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
  await add('ravi', 'quote', { dealId: dSun.id, clientId: cl.sun.id, clientName: cl.sun.name, contactName: 'Dr. Mehta', phone: cl.sun.phone, subject: 'Clinic website with online booking', date: d(-3), validUntil: d(12), items: [line('Website – 5 pages', 40000, 'Design, 5 pages, booking form'), line('Online appointment booking', 5000)], taxMode: 'intra', taxRate: 18, discountType: 'none', status: 'sent' });
  await add('sneha', 'quote', { dealId: dKav.id, clientId: cl.kav.id, clientName: cl.kav.name, contactName: 'Suresh', phone: cl.kav.phone, subject: 'Ordering app for retailers', date: d(-1), validUntil: d(14), items: [line('Mobile app (Android + iOS)', 250000)], taxMode: 'intra', taxRate: 18, discountType: 'percent', discountValue: 15 });
  const qCity = await add('ravi', 'quote', { dealId: dCity.id, clientId: cl.city.id, clientName: cl.city.name, contactName: 'Mr. Rao', phone: cl.city.phone, subject: 'Pharmacy website', date: d(-25), validUntil: d(-10), items: [line('Website – 5 pages', 38000)], taxMode: 'intra', taxRate: 18, discountType: 'none' });
  await upd('ravi', qCity.id, { status: 'accepted' });

  // Won deals → handoff → projects
  await upd('ravi', dCity.id, { handoff: { scope: '5-page website: Home, About, Products, Offers, Contact. Contact form + WhatsApp button. Not included: online ordering.', deadline: d(8), advance: false } });
  const pCity = await add('ravi', 'project', { name: 'Website – City Care Pharmacy', clientId: cl.city.id, clientName: cl.city.name, dealId: dCity.id, stage: 'awaiting', deadline: d(8), start: d(-12), scope: '5-page website with contact form and WhatsApp button.', people: [ids.ravi], lead: '' });
  const adv = await add('ravi', 'payment', { title: 'Advance (50%)', kind: 'advance', clientId: cl.city.id, dealId: dCity.id, amount: 19000, due: d(-11), owner: ids.ravi });
  await add('ravi', 'receipt', { date: d(-10), paymentId: adv.id, clientId: cl.city.id, dealId: dCity.id, payerName: cl.city.name, payerPhone: cl.city.phone, items: [{ desc: 'Advance – pharmacy website', amount: 19000, incl: true }], taxMode: 'intra', taxRate: 18, mode: 'UPI', reference: 'UPI 4411 2290 7731', against: qCity.number });
  await upd('it', pCity.id, { lead: ids.priya, stage: 'development', people: [ids.ravi, ids.kiran] });
  const tpl = [['Collect content and logo from client', -9, false, 'done'], ['Design home page', -6, false, 'done'], ['Design approved by client', -4, true, 'done'], ['Build all pages', 2, false, 'doing'], ['Contact form + WhatsApp button', 4, false, 'todo'], ['Testing on mobile and desktop', 6, false, 'todo'], ['Go live + domain connect', 8, true, 'todo']];
  let prev = '';
  for (const [title, day, ms, status] of tpl) { const t = await add('priya', 'task', { title, projectId: pCity.id, due: d(day), start: d(day - 3), milestone: ms, status: 'todo', priority: day < 3 ? 'high' : 'medium', owner: ms ? ids.priya : ids.kiran, team: 'it', dependsOn: prev, estimate: 6, timeLogs: status === 'done' ? [{ at: d(day), by: ids.kiran, hours: 5 }] : [] }); if (status !== 'todo') await upd('priya', t.id, { status }); prev = t.id; }
  await upd('priya', pCity.id, { changes: [{ id: 'ch1', text: 'Client wants a bigger logo on mobile', from: 'client', severity: 'normal', owner: ids.kiran, status: 'open', at: new Date().toISOString(), by: ids.ravi }] });
  await add('ravi', 'payment', { title: 'Balance on delivery', kind: 'final', clientId: cl.city.id, dealId: dCity.id, amount: 19000, due: d(9), owner: ids.ravi });

  await upd('arjun', dUday.id, { handoff: { scope: 'Hostel app: rooms, residents, fee collection, receipts, reports.', deadline: d(30), advance: false } });
  const pUday = await add('arjun', 'project', { name: 'Hostel management app – Uday', clientId: cl.uday.id, clientName: cl.uday.name, dealId: dUday.id, stage: 'awaiting', deadline: d(30), start: d(0), scope: 'Hostel app: rooms, residents, fee collection, receipts, reports.', people: [ids.arjun], priority: true });
  await add('arjun', 'payment', { title: 'Advance (50%)', kind: 'advance', clientId: cl.uday.id, dealId: dUday.id, amount: 60000, due: d(-1), owner: ids.arjun });

  // A delivered project with sign-off, and maintenance
  const pDone = await add('it', 'project', { name: 'Website – Green Valley School (phase 1)', clientId: cl.green.id, clientName: cl.green.name, stage: 'testing', deadline: d(-5), start: d(-40), lead: ids.priya, scope: 'Admissions website, 6 pages.' });
  const sig = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><path d="M20 80 C 60 20, 90 110, 130 60 S 200 30, 230 80 S 300 90, 380 40" stroke="#111" stroke-width="3" fill="none"/></svg>');
  await add('priya', 'signoff', { projectId: pDone.id, project: pDone.name, client: cl.green.name, scope: 'Admissions website with 6 pages and enquiry form.', signerName: 'Principal, Green Valley', signerRole: 'Principal', signerPhone: cl.green.phone, rating: 4, ratingComment: 'Good work, slightly late.', signature: sig, confirmed: true });
  await add('arjun', 'payment', { title: 'Website maintenance fee', kind: 'maintenance', clientId: cl.green.id, amount: 1500, due: d(-3), repeat: 'monthly', owner: ids.arjun });
  await add('sneha', 'payment', { title: 'Domain + hosting renewal', kind: 'renewal', clientId: cl.palm.id, amount: 4500, due: d(20), repeat: 'yearly', owner: ids.sneha });

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
writeFileSync('DEMO-LOGINS.md', `# Aali One demo logins (keep private – not in git)\n\nPassword for every demo account: \`${PW}\`\n\n| Login | Name | Role |\n|---|---|---|\n${PEOPLE.map(([k, n, t, a]) => `| ${k}@${DOMAIN} | ${n} | ${t}${a ? ' (admin)' : ''} |`).join('\n')}\n`);
console.log('Logins written to DEMO-LOGINS.md');
process.exit(0);
