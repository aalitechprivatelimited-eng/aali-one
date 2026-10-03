// Security audit proofs (Trail of Bits style): each check tries one attack against Aali One running on THIS computer with an empty,
// in-memory database – never the live site. "OPEN" means the attack worked; "closed" means the server refused it.
// usage: node e2e/audit-proof.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PORT = 3400 + Math.floor(Math.random() * 200), BASE = `http://127.0.0.1:${PORT}`, PW = 'T-' + randomBytes(9).toString('base64url');
const server = spawn(process.execPath, ['server/dev.js', String(PORT)], { env: { ...process.env, DATABASE_URL: '', POSTGRES_URL: '', PGLITE_DIR: 'memory://', PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, body, cookie = '') => { const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
const results = [];
const check = (id, what, open) => { results.push([id, what, open]); console.log(`${open ? 'OPEN  ' : 'closed'}  ${id}  ${what}`); };
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await sleep(250); }
  if ((await api('GET', '/setup')).body.needsSetup !== true) throw new Error('Not an empty database – stopping.');
  const admin = (await api('POST', '/setup', { name: 'Audit Admin', email: 'admin@audit.test', password: PW })).cookie;
  const add = (first, email, title) => api('POST', '/users', { firstName: first, surname: 'Test', email, password: PW, title, designation: title, company: 'AaliTech' }, admin);
  const adminId = (await api('GET', '/me', null, admin)).body.user.id;
  await add('Asha', 'a@audit.test', 'bde'); await add('Bala', 'b@audit.test', 'bde'); await add('Devi', 'dev@audit.test', 'dev');
  const A = (await api('POST', '/auth/login', { email: 'a@audit.test', password: PW })).cookie, B = (await api('POST', '/auth/login', { email: 'b@audit.test', password: PW })).cookie;
  const D = (await api('POST', '/auth/login', { email: 'dev@audit.test', password: PW })).cookie;

  // 1. Anyone signed in can send a made-up notification to anyone (for example to management).
  const fake = await api('POST', '/records', { type: 'notice', data: { to: adminId, text: 'Chairman: send me the client list today', relType: '', relId: '' } }, B);
  check('ACB-1', 'a BDE can create a notification addressed to management', fake.status === 200);
  // 2. A notification can be re-addressed to someone else by the person who received it.
  const mine = (await api('POST', '/records', { type: 'task', data: { title: 'Call Ravi', owner: (await api('GET', '/me', null, A)).body.user.id } }, admin)).status; // makes a real "New task" notice for A
  const noteA = (await api('GET', '/bootstrap', null, A)).body.records.find((r) => r.type === 'notice');
  const moved = noteA ? await api('PATCH', '/records/' + noteA.id, { data: { to: adminId, text: 'Changed text' } }, A) : { status: 0 };
  check('ACB-2', 'a received notification can be re-addressed and re-worded', mine === 200 && moved.status === 200);
  // 3. Records of any made-up type can be created.
  check('ACB-3', 'a record of an unknown type can be created', (await api('POST', '/records', { type: 'zzjunk', data: { x: 'y'.repeat(1000) } }, B)).status === 200);
  // 4. A file uploaded by one person can be downloaded by anyone signed in who has its link.
  const up = await api('POST', '/files', { name: 'contract.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 secret client contract').toString('base64') }, A);
  const peek = await fetch(`${BASE}/api/files/${up.body.id}`, { headers: { cookie: D } });
  check('ACB-4', 'a developer can download a file a BDE uploaded, given its link', peek.status === 200);
  // 5. The public enquiry form takes a name of any length.
  const big = await api('POST', '/public/enquiry', { name: 'N'.repeat(300000), mobile: '9000012345', service: 'Website' });
  const leads = (await api('GET', '/bootstrap', null, admin)).body.records.filter((r) => r.type === 'lead');
  check('DOS-1', 'the public form stores a 300,000-character name', big.status === 200 && leads.some((l) => (l.name || '').length > 1000));
  // 6. A name that Excel runs as a formula reaches the data, and the CSV downloads do not neutralise it (code review: Payments.jsx dl, Reports.jsx csv).
  const formula = await api('POST', '/public/enquiry', { name: '=HYPERLINK("http://example.invalid","Click for invoice")', mobile: '9000012346', service: 'Website' });
  // The name is kept as typed (it is data); what matters is the CSV download: the cell must not start with = when Excel opens it.
  const fs = await import('node:fs'), line = fs.readFileSync('src/lib.js', 'utf8').split(/\r?\n/).find((l) => l.startsWith('export const csvCell'));
  const csvCell = line ? eval(line.replace('export const csvCell = ', '(').replace(/;\s*$/, ')')) : (v) => `"${v}"`;
  check('CSV-1', 'a formula typed on the public form reaches a CSV download as a live formula', formula.status === 200 && csvCell('=HYPERLINK("http://example.invalid","Click")').startsWith('"='));
  // Controls that should hold (expected closed):
  check('AUTH-1', 'API without a session', (await api('GET', '/bootstrap')).status === 200);
  check('AUTH-2', 'a BDE opening the audit log', (await api('GET', '/audit', null, A)).status === 200);
  const ap = (await api('POST', '/records', { type: 'approval', data: { kind: 'discount', relType: 'quote', relId: 'x', reason: 'Discount 40%' } }, A)).body.record;
  check('AUTH-3', 'a BDE approving their own request', (await api('PATCH', '/records/' + ap.id, { data: { status: 'approved' } }, A)).status === 200);
  const wrong = []; for (let i = 0; i < 9; i++) wrong.push((await api('POST', '/auth/login', { email: 'b@audit.test', password: 'nope-' + i })).status);
  check('AUTH-4', '9 wrong passwords in a row are all allowed', !wrong.includes(429));
  check('UPL-1', 'an HTML file served inline (could run in the app)', (await fetch(`${BASE}/api/files/${(await api('POST', '/files', { name: 'x.html', mime: 'text/html', data: Buffer.from('<script>alert(1)</script>').toString('base64') }, A)).body.id}`, { headers: { cookie: A } })).headers.get('content-type') === 'text/html');
} catch (e) { console.error('The audit run could not finish:', e.message); process.exitCode = 1; }
finally { server.kill(); }
