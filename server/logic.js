// Business rules that must hold whoever calls the API: numbering, duplicate checks, auto-assign,
// the advance gate, sign-off before Live, payments updating reminders, approvals, recurring tasks.
import { newId, newKey } from './auth.js';
import { docTotals, receiptTotals, fyLabel, dayLabel, mobile10, num, round2, inr } from '../shared/money.js';
import { MANAGER_TITLES, TOP_TITLES, DEFAULT_SETTINGS, GROUP, COMPANIES, BILL_KINDS, BILL_PAID_BY, PAY_MODES } from '../shared/defaults.js';
import { canSee, canEdit, scopeOf, canClose } from '../shared/access.js';
import { applyCalls, checkCalls, claimForLead, holderOf, prospectCreate, prospectUpdate } from './prospects.js';
import { payFor, clientPay, grossOf, fromSheet, sheetAttendance, attendanceDays, onBasis, daysIn, monthLabel, loanLeft, salaryFor } from '../shared/payroll.js';
import { hrmMonth, hrmConnected, hrmEmailOf, hrmFind } from './hrm.js';
import { queueReport } from './whatsapp.js';
import { deadlineItems, SOON_DAYS } from '../shared/deadlines.js';

export class Rule extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India date
// A date in a message, the Indian way: 2026-10-08 → 8 Oct 2026.
const SHORT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const inDate = (s) => (/^\d{4}-\d\d-\d\d/.test(s || '') ? `${+s.slice(8, 10)} ${SHORT_MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : s || '');
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };
export const nextDue = (iso, rep) => rep === 'weekly' ? addDays(iso, 7) : rep === 'daily' ? addDays(iso, 1)
  : addMonths(iso, { monthly: 1, quarterly: 3, half: 6, yearly: 12 }[rep] || 1);
const WORK = ['planning', 'design', 'development', 'testing', 'live'];
export const isManager = (u) => u && (u.is_admin || MANAGER_TITLES.includes(u.title));
export const isTop = (u) => !!u && (u.is_admin || TOP_TITLES.includes(u.title));
// Daily reports: the writer, the manager of that department, and top management (Ops Manager, Company Secretary, Chairman) can read.
// leadSees: the "IT Team Lead can read developers' reports" switch (off by default; an admin turns it on).
export const canSeeReport = (u, d, leadSees = false) => !!u && (d.owner === u.id || isTop(u) || (isManager(u) && u.team === d.team)
  || (leadSees && u.title === 'itlead' && d.team === 'it' && d.ownerTitle === 'dev'));
export const NO_REPORT_TITLES = ['chairman', 'ops', 'cs', 'admin']; // top management reads reports, it does not write them
// Send back / delete: the department manager, or an admin (Ops Manager, Company Secretary). The Chairman reads and remarks only.
const canRunReport = (u, d) => d.owner !== u.id && (u.is_admin || (isManager(u) && !TOP_TITLES.includes(u.title) && u.team === d.team));
// Management by title (not the admin switch): who approves a discount above the limit (the user, 10 Oct 2026).
const MANAGEMENT = (u) => !!u && (TOP_TITLES.includes(u.title) || u.title === 'admin');
// One business, one caller (security review 10 Oct 2026): the same check as a new lead, also when a BDE adds a client or a deal, and when
// a lead's, deal's or client's number changes – so a number another BDE is working on cannot be taken through another door.
async function callerCheck(t, user, phone, org) {
  const m = mobile10(phone);
  if (!user || m.length !== 10 || scopeOf(user, 'leads') !== 'own') return;
  const [v] = await checkCalls(t, user, [{ phone: m, org: org || '', dupOk: true }]);
  if (!v.ok && ['held', 'dnc'].includes(v.kind)) throw new Rule(v.msg, 409);
}
const phones = (d) => [d.phone, ...(Array.isArray(d.contacts) ? d.contacts.map((c) => c?.phone) : [])].map(mobile10).filter((m) => m.length === 10);
// A discount above the limit asks management; they are told at once.
async function askDiscount(t, quoteId, q, user, sample) {
  await insertRec(t, 'approval', { kind: 'discount', relType: 'quote', relId: quoteId, status: 'pending', requestedBy: user?.id || null,
    reason: `Discount ${q.totals.discountPct}% on ${q.number}` }, user, { sample });
  for (const u of (await t.query('select id from users where active and removed_at is null and title = any($1)', [TOP_TITLES])).rows)
    await notify(t, u.id, `${user?.name || 'Someone'} asks you to approve a ${q.totals.discountPct}% discount on quotation ${q.number}.`, 'approval', '', user, sample);
}
// Money papers – quotations, invoices, receipts and payments – are for the Sales Manager and management only (shared/access.js).
export const MONEY = ['quote', 'invoice', 'receipt', 'payment'];
export const canMoney = (u) => canSee(u, 'money');
// Collaborations (colleges and employers): top management reads; the Operations Manager, Company Secretary and admins change them.
export const canEditCollab = (u) => canEdit(u, 'collab');
const log = (d, by, text) => { d.log = [{ at: new Date().toISOString(), by, text }, ...(d.log || [])].slice(0, 80); };

async function counter(t, key) {
  const r = await t.query('insert into counters (key, n) values ($1, 1) on conflict (key) do update set n = counters.n + 1 returning n', [key]);
  return r.rows[0].n;
}
export async function getSetting(t, key, fallback) {
  const r = await t.query('select value from settings where key = $1', [key]);
  return r.rows[0] ? r.rows[0].value : fallback;
}
export async function setSetting(t, key, value) {
  await t.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = $2, updated_at = now()', [key, JSON.stringify(value)]);
}
// A record by its id – only if it is of the kind expected. Ids come from what people send, so a payment, approval or quotation
// must never be able to point the server at some other kind of record (for example a signed agreement).
async function getRec(t, id, type) {
  const r = await t.query('select * from records where id = $1 and type = $2 and deleted_at is null', [id, type]);
  return r.rows[0] || null;
}
async function putRec(t, rec, user) {
  await t.query('update records set data = $2, updated_by = $3, updated_at = now() where id = $1', [rec.id, JSON.stringify(rec.data), user?.id || null]);
}
export async function insertRec(t, type, data, user, { id, sample = false } = {}) {
  const rid = id || newId(type.slice(0, 2) + '_');
  await t.query('insert into records (id, type, data, sample, created_by, updated_by) values ($1,$2,$3,$4,$5,$5)',
    [rid, type, JSON.stringify(data), sample, user?.id || null]);
  return rid;
}
export async function notify(t, to, text, relType, relId, user, sample = false) {
  if (!to || to === user?.id) return;
  await insertRec(t, 'notice', { to, text, relType, relId, read: false }, user, { sample });
}
async function brandSetting(t) { return getSetting(t, 'business', {}); }

// ---------- several services under one client (the user, 17 Oct 2026: AS Group wants a POS, billing software and two websites) ----------
// A lead or a deal lists every service in `services`; `service` stays the first one, for everything that shows one.
export const svcOf = (d) => (Array.isArray(d?.services) && d.services.length ? d.services : d?.service ? [d.service] : []);
// The BDE writes services in their own words: "restaurant pos" and "Restaurant POS" are the same service.
const svcKey = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sameSvc = (a, b) => a.some((x) => b.some((y) => svcKey(x) === svcKey(y)));
function cleanServices(d) {
  const all = [];
  for (const x of Array.isArray(d.services) && d.services.length ? d.services : [d.service]) { const v = String(x || '').trim().replace(/\s+/g, ' ').slice(0, 80); if (v && !all.some((y) => svcKey(y) === svcKey(v))) all.push(v); }
  all.splice(12);
  if (all.length) { d.services = all; d.service = all[0]; } else delete d.services;
  return all;
}
// One deal with several services, or one deal per service: only the Operations Manager and the Company Secretary decide, and only
// while no quotation, invoice, payment, receipt, agreement or project hangs on the deal – the money must never be split by guesswork.
const SPLITTERS = ['ops', 'cs'];
async function dealIsBare(t, id, title) {
  const r = (await t.query("select type from records where deleted_at is null and data->>'dealId' = $1 and type = any($2) limit 1", [id, ['quote', 'invoice', 'payment', 'receipt', 'agreement', 'project']])).rows[0];
  if (r) throw new Rule(`${title} already has a ${({ quote: 'quotation', invoice: 'tax invoice', payment: 'payment', receipt: 'receipt', agreement: 'agreement', project: 'project' })[r.type]}, so its services can no longer be split or joined.`);
}
// The advance has come for a deal: every project of the deal (one per service) can start.
async function advanceProjects(t, dealId, user, why) {
  for (const pr of (await t.query("select * from records where deleted_at is null and type = 'project' and data->>'dealId' = $1", [dealId])).rows) {
    if (pr.data.advance && pr.data.stage !== 'awaiting') continue;
    pr.data.advance = true; if (pr.data.stage === 'awaiting') pr.data.stage = 'planning'; log(pr.data, user?.id, why); await putRec(t, pr, user);
    await notify(t, pr.data.lead || '', `Advance received for ${pr.data.name}. Work can start.`, 'project', pr.id, user, pr.sample);
  }
}

// ---------- leads: duplicate check on mobile + service, then assign ----------
async function leadIntake(t, data, user, sample) {
  // Every field has a sensible length, so the public form cannot fill the database with huge text (audit DOS-1).
  for (const [k, n] of [['name', 120], ['company', 120], ['email', 120], ['service', 80], ['mobile', 20], ['source', 60], ['message', 1000]]) if (data[k] != null) data[k] = String(data[k]).slice(0, n);
  const m = mobile10(data.mobile);
  if (!data.name?.trim()) throw new Rule('Enter the name.');
  if (m.length !== 10) throw new Rule('Enter a 10-digit mobile number.');
  const svcs = cleanServices(data); if (!svcs.length) throw new Rule('Choose the service they want.');
  data.mobile10 = m;
  // One business, one caller: a BDE cannot enter a business that is with another BDE or on the Do Not Call list.
  if (user && scopeOf(user, 'leads') === 'own') { const [v] = await checkCalls(t, user, [{ phone: m, org: data.company || data.name, dupOk: true }]); if (!v.ok && ['held', 'dnc'].includes(v.kind)) throw new Rule(v.msg, 409); }
  const force = !!data._new && !!user; delete data._new; // "New requirement" chosen after the repeat-enquiry question
  const matches = (await t.query(`select * from records where deleted_at is null and type in ('lead','deal','client')
    and (data->>'mobile10' = $1 or data->'contacts' @> $2::jsonb) order by updated_at desc`, [m, JSON.stringify([{ mobile10: m }])])).rows;
  const enquiry = { at: new Date().toISOString(), source: data.source || 'Other', message: data.message || '' };
  const open = !force && matches.find((r) => sameSvc(svcOf(r.data), svcs) &&
    ((r.type === 'lead' && !['converted', 'junk'].includes(r.data.status)) || (r.type === 'deal' && !['won', 'lost'].includes(r.data.stage))));
  if (open) {
    const d = open.data, same = svcs.filter((x) => sameSvc([x], svcOf(d))).join(', '); d.enquiries = [enquiry, ...(d.enquiries || [])]; d.repeatPending = true;
    log(d, user?.id || null, `Asked again about ${same} (${enquiry.source}) – ask the client: earlier enquiry or new requirement?`);
    await putRec(t, open, user);
    await notify(t, d.owner, `${d.name || d.title} asked again about ${same}. Ask: earlier enquiry or new requirement?`, open.type, open.id, user, sample);
    return { merged: true, id: open.id, type: open.type };
  }
  const known = matches.find((r) => r.data.owner);
  if (known) { data.owner = data.owner || known.data.owner; data.existingClient = true; data.clientId = known.type === 'client' ? known.id : known.data.clientId || ''; }
  // The sales team finds its own potential clients: a lead a salesperson enters is theirs. Only enquiries that come from outside
  // (the website form, or entered by management) are shared out in turns.
  else if (!data.owner) { // the BDE who already calls this business keeps it; then the lead rule for its service; then every BDE in turn
    data.owner = user && user.team === 'sales' ? user.id : (await holderOf(t, m)) || '';
    if (!data.owner) { const rule = (await getSetting(t, 'leadRules', [])).find((r) => Array.isArray(r?.bdes) && r.bdes.length && sameSvc([r.service], svcs));
      if (rule) { data.owner = await roundRobin(t, rule.bdes); if (data.owner) data.byRule = rule.service; } }
    data.owner ||= await roundRobin(t);
  }
  data.status ||= 'new'; data.score ||= ''; data.enquiries = [enquiry]; data.followUp ||= today();
  log(data, user?.id || null, known ? `Existing client asked about ${svcs.join(', ')}; given to their BDE` : data.owner === user?.id ? `New potential client (${enquiry.source}); found by ${user.name}`
    : data.byRule ? `New enquiry (${enquiry.source}); given by the lead rule for ${data.byRule}` : `New enquiry (${enquiry.source}); auto-assigned`);
  return { merged: false };
}
// among: only these BDEs (a lead rule); none of them active → every BDE in turn, as before.
async function roundRobin(t, among = null) {
  let bdes = (await t.query("select id from users where active and removed_at is null and title = 'bde' order by created_at")).rows.map((r) => r.id);
  if (among) { const some = bdes.filter((id) => among.includes(id)); if (!some.length) return ''; bdes = some; }
  if (!bdes.length) return '';
  const rr = await getSetting(t, 'rr', {});
  bdes.sort((a, b) => (rr[a] || '').localeCompare(rr[b] || ''));
  rr[bdes[0]] = new Date().toISOString(); await setSetting(t, 'rr', rr);
  return bdes[0];
}

// ---------- old documents and B2B / B2C tax invoices (the user, 17 Oct 2026) ----------
// An old agreement, quotation or tax invoice uploaded and checked by the person (server/importdoc.js reads it): the uploaded file is kept on
// the record, it is saved as signed / accepted / issued, and the number printed on it is kept – a tax invoice never takes a new number
// from the series, so the GST invoice numbering stays continuous.
const DOC_FILE = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;
async function takeImport(t, type, data, user) {
  const imp = data._import; delete data._import; delete data.imported; if (!imp) return null;
  const f = (await t.query('select id, name, mime, size from files where id = $1 and created_by = $2', [String(imp.fileId || '').slice(0, 40), user.id])).rows[0];
  if (!f) throw new Rule('Upload the old document again.');
  if (!DOC_FILE.test(f.mime)) throw new Rule('The old document must be the Word file or a PDF saved from Word.');
  const old = String(data.oldNumber || '').trim().slice(0, 40); delete data.oldNumber;
  if (old && (await t.query('select 1 from records where deleted_at is null and type = $1 and data->>\'number\' = $2', [type, old])).rowCount) throw new Rule(`Number ${old} is already in Aali One.`);
  return { file: { id: f.id, name: f.name, mime: f.mime, size: +f.size, at: new Date().toISOString(), by: user.id }, old, how: String(imp.how || '').slice(0, 10) };
}
// The number of an old document: the one printed on it, or – for an agreement or quotation that had none – the next in the series.
async function oldOrNext(t, imp, data, key, make) {
  if (imp?.old) { data.number = imp.old; data.fy = fyLabel(data.date || today()); delete data.seq; return; }
  data.seq = await counter(t, key); data.fy = fyLabel(data.date || today()); data.number = make(data.seq);
}
export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// B2B: the client is GST-registered, so its GSTIN is on the invoice. B2C: an unregistered buyer – name and place of supply, no GSTIN.
function invoiceParty(d) {
  d.gstin = String(d.gstin || '').trim().toUpperCase(); d.kind = d.kind === 'b2c' ? 'b2c' : d.kind === 'b2b' ? 'b2b' : d.gstin ? 'b2b' : 'b2c';
  if (!String(d.clientName || '').trim()) throw new Rule('Enter the client name.');
  if (d.kind === 'b2b' && !GSTIN.test(d.gstin)) throw new Rule('A B2B invoice needs the client\'s GSTIN (15 characters, e.g. 37AAACL1234M1Z2).');
  if (d.kind === 'b2c') delete d.gstin;
  if (!String(d.placeOfSupply || '').trim()) throw new Rule('Enter the place of supply (the client\'s state).');
}

// ---------- create ----------
export async function beforeCreate(t, type, data, user, sample) {
  const me = user?.id || null;
  switch (type) {
    case 'lead': { const r = await leadIntake(t, data, user, sample); if (r.merged) return r; break; }
    case 'client': if (!data.name?.trim()) throw new Rule('Enter the client name.'); data.mobile10 = mobile10(data.phone);
      data.contacts = (data.contacts || []).map((c) => ({ ...c, mobile10: mobile10(c.phone) }));
      for (const m of phones(data)) await callerCheck(t, user, m, data.name); break;
    case 'deal': if (!data.title?.trim()) throw new Rule('Enter a deal name.'); data.mobile10 = mobile10(data.phone); await callerCheck(t, user, data.phone, data.title); cleanServices(data);
      data.stage ||= 'lead'; data.stageHistory = [{ stage: data.stage, at: new Date().toISOString() }]; log(data, me, 'Deal created'); break;
    case 'quote': {
      const fy = fyLabel(data.date || today()), b = await brandSetting(t), imp = await takeImport(t, 'quote', data, user);
      await oldOrNext(t, imp, data, 'quote:' + fy, (n) => `${b.quotePrefix || 'AC'}/${fy}/${String(n).padStart(3, '0')}`);
      for (const k of FLOW_KEYS) delete data[k]; delete data.discountApprovedAt; delete data.discountApprovedBy; delete data.discountApprovedPct;
      data.totals = docTotals(data); data.status = 'draft';
      if (imp) { // an old quotation the client signed on paper: accepted, the uploaded file is its signed copy
        Object.assign(data, { status: 'accepted', imported: { at: imp.file.at, by: me, file: imp.file, how: imp.how },
          signed: { how: 'paper', name: String(data.contactName || data.clientName || '').slice(0, 120), role: '', signature: '', files: [imp.file], at: imp.file.at, by: me, v: 1, date: data.date || today(), imported: true } });
        log(data, me, `Old quotation uploaded (${imp.file.name})`); break;
      }
      await quoteApproval(t, data, user, null, sample); break;
    }
    case 'invoice': {
      const fy = fyLabel(data.date || today()), b = await brandSetting(t), imp = await takeImport(t, 'invoice', data, user);
      if (imp && !imp.old) throw new Rule('Enter the invoice number printed on the old invoice.');
      invoiceParty(data);
      await oldOrNext(t, imp, data, 'invoice:' + fy, (n) => `${b.invoicePrefix || 'AI'}/${fy}/${String(n).padStart(3, '0')}`);
      data.totals = docTotals(data); data.status ||= 'issued';
      if (imp) { data.imported = { at: imp.file.at, by: me, file: imp.file, how: imp.how }; log(data, me, `Old tax invoice uploaded (${imp.file.name})`); }
      break;
    }
    case 'receipt': {
      data.date ||= today(); const day = dayLabel(data.date), b = await brandSetting(t);
      data.seq = await counter(t, 'receipt:' + day); data.number = `${b.receiptPrefix || 'ACY'}-${day}/${String(data.seq).padStart(3, '0')}`;
      data.fy = fyLabel(data.date); data.totals = receiptTotals(data);
      if (!(data.totals.total > 0)) throw new Rule('Enter the amount received.'); break;
    }
    case 'signoff': {
      if (!data.signerName?.trim()) throw new Rule("Enter the client's name."); if (!data.signature) throw new Rule('The client must sign.');
      if (!data.confirmed) throw new Rule('The client must tick the confirmation box.');
      if (data.photo && !data.photoConsent) throw new Rule('Photo needs the client\'s consent.');
      const d = today().replace(/-/g, ''); data.certNo = `DAC-${d}-${String(await counter(t, 'cert:' + d)).padStart(3, '0')}`;
      data.signedAt = new Date().toISOString(); data.collectedBy = me; break;
    }
    case 'agreement': { // a client service agreement, or the closure (completion and delivery) agreement at the end of a project
      // Only the two plain words – never a list, an object or a built-in name (review of the agreements feature).
      if (!(typeof data.kind === 'string' && Object.hasOwn(AGREEMENT, data.kind))) throw new Rule('Choose the kind of agreement.');
      if (!String(data.clientName || '').trim()) throw new Rule('Enter the client name.');
      const imp = await takeImport(t, 'agreement', data, user); // an old signed agreement may be for a project made before Aali One
      if (data.kind === 'closure' && !data.projectId && !imp) throw new Rule('Choose the project this closure agreement is for.');
      data.date ||= today(); if (!/^\d{4}-\d\d-\d\d$/.test(data.date)) throw new Rule('Enter a proper agreement date.');
      const fy = fyLabel(data.date);
      await oldOrNext(t, imp, data, `agreement:${data.kind}:${fy}`, (n) => `${AGREEMENT[data.kind].prefix}/${fy}/${String(n).padStart(3, '0')}`);
      const signedOn = data.signedOn; data.status = 'draft'; for (const k of ['signedOn', 'signedAt', 'signedBy', 'signedCopy', 'sentOn', 'log', ...FLOW_KEYS]) delete data[k];
      if (imp) { // an old agreement both sides signed on paper: signed and locked, the uploaded file is its signed copy
        Object.assign(data, { status: 'signed', signedOn: /^\d{4}-\d\d-\d\d$/.test(signedOn || '') && signedOn <= today() ? signedOn : data.date, signedAt: imp.file.at, signedBy: me, signedCopy: imp.file,
          imported: { at: imp.file.at, by: me, file: imp.file, how: imp.how } });
        log(data, me, `Old signed ${AGREEMENT[data.kind].name.toLowerCase()} uploaded (${imp.file.name})`); break;
      }
      log(data, me, `${AGREEMENT[data.kind].name} made`); break;
    }
    case 'pclient': {
      const clean = cleanPclient(data);
      if ((await t.query("select 1 from records where deleted_at is null and type = 'pclient' and lower(data->>'name') = lower($1)", [clean.name])).rowCount) throw new Rule(`${clean.name} is already a payroll client.`);
      await hrmCodeFree(t, clean.hrmCode, '');
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, clean); log(data, me, 'Added as a payroll client'); break;
    }
    case 'pemp': {
      const pc = await getRec(t, txt(data.pclientId, 40), 'pclient'); if (!pc) throw new Rule('Choose the payroll client.');
      const clean = cleanPemp(data, pc.data.payModel); await pempCodeFree(t, pc.id, clean.code, '');
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, clean, { pclientId: pc.id }); log(data, me, clean.payType === 'daily' ? `Added: ₹${clean.rate} a day` : `Added: ₹${clean.gross} a month`); break;
    }
    case 'payee': {
      const clean = cleanPayee(data); await payeeEmailFree(t, clean.email, '');
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, clean); log(data, me, 'Added as staff without a login'); break;
    }
    case 'salary': { // one salary sheet per person, kept by HR; the Founder & Chairman is not on the payroll
      const u = await payPerson(t, data.userId);
      if (!u) throw new Rule('Choose a person on the payroll.');
      if ((await t.query("select 1 from records where deleted_at is null and type = 'salary' and data->>'userId' = $1", [u.id])).rowCount) throw new Rule(`${u.name} already has a salary sheet. Open it to change it.`);
      const clean = { ...cleanSalary(data), userId: u.id, name: u.name };
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, clean, { revisions: [{ from: clean.from, gross: clean.gross, at: new Date().toISOString(), by: me }] });
      log(data, me, `Salary sheet made: ₹${clean.gross} a month`); break;
    }
    case 'loan': { // a loan or a salary advance, cut from the pay month by month (an advance in one go)
      const u = await payPerson(t, data.userId);
      if (!u) throw new Rule('Choose the person.');
      const clean = { ...cleanLoan(data), userId: u.id, name: u.name, recovered: [], closed: false };
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, clean); log(data, me, `${clean.kind === 'advance' ? 'Advance' : 'Loan'} of ₹${clean.amount}${clean.givenOn ? ' given on ' + clean.givenOn : ''}; cutting from ${monthLabel(clean.from)}`); break;
    }
    case 'payrun': { // one month's payroll: made from the salary sheets, Aali HRM's attendance, loans and HR's changes for the month
      // – or, with pclientId, a payroll client's month: its employees and the attendance Excel the client sends (each client's months apart)
      const month = mon(data.month); if (!month) throw new Rule('Choose the month.');
      if (month > today().slice(0, 7)) throw new Rule('Payroll can be made for this month or a month before.');
      const pcId = txt(data.pclientId, 40), pc = pcId ? await getRec(t, pcId, 'pclient') : null;
      if (pcId && (!pc || pc.data.active === false)) throw new Rule('Choose the payroll client.');
      if ((await t.query("select 1 from records where deleted_at is null and type = 'payrun' and data->>'month' = $1 and coalesce(data->>'pclientId', '') = $2", [month, pcId])).rowCount) throw new Rule(`Payroll for ${monthLabel(month)} is already made. Open it.`);
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, { month, ...(pc ? { pclientId: pc.id } : {}), title: `${pc ? pc.data.name + ' – payroll' : 'Payroll'} ${monthLabel(month)}`, status: 'draft', adj: {}, remarks: [] });
      await buildRun(t, data); log(data, me, 'Payroll made'); break;
    }
    case 'ticket': if (!data.title?.trim()) throw new Rule('Describe the problem.');
      data.number = 'T-' + String(await counter(t, 'ticket')).padStart(4, '0'); data.status ||= 'open'; log(data, me, 'Support request opened'); break;
    case 'project': // what the gates depend on is the server's (security review 10 Oct 2026): no sign-off, approvals or Live from the browser
      for (const k of ['signoffId', 'liveNoSign', 'startApproved', 'liveAt', 'advance']) delete data[k];
      // A new project starts at the beginning – except that management may record one already further on (a project finished before
      // Aali One, for example); they are the ones who approve the gates anyway.
      if (!DEFAULT_SETTINGS.projectStages.some((s) => s.key === data.stage) || (!MANAGEMENT(user) && !['awaiting', 'planning', 'onhold'].includes(data.stage))) data.stage = 'planning';
      data.progressToken = newKey(); // the client's progress link: long and never chosen by the browser
      // IT cannot open the deal, so the project itself remembers whether the advance has come.
      if (data.dealId) { const deal = await getRec(t, data.dealId, 'deal'); if (deal?.data.handoff?.advance) data.advance = true; else delete data.advance; }
      log(data, me, 'Project created'); break;
    case 'task': if (!data.title?.trim()) throw new Rule('Enter the task.'); data.status ||= 'todo'; break;
    case 'payment': if (!data.title?.trim()) throw new Rule('Enter what the payment is for.'); data.status ||= 'open'; data.paid ||= 0; data.baseAmount ??= num(data.amount); break;
    case 'approval': data.status = 'pending'; data.requestedBy = me; break;
    case 'prospect': return prospectCreate(t, data, user); // a manager adds a number to the Do Not Call list
    case 'asset': { // files a client gave their BDE, passed on to the Sales Manager or the IT Manager
      if (!String(data.clientName || '').trim()) throw new Rule('Choose or type the client these assets belong to.');
      if (!['sales', 'it'].includes(data.to)) throw new Rule('Choose who the assets go to: the Sales Manager or the IT Manager.');
      const files = (Array.isArray(data.files) ? data.files : []).slice(0, 30), link = String(data.link || '').trim().slice(0, 500);
      if (!files.length && !link) throw new Rule('Attach at least one file, or paste the link where the files are.');
      const keep = { clientId: data.clientId || '', clientName: String(data.clientName).trim().slice(0, 120), what: String(data.what || '').trim().slice(0, 120), note: String(data.note || '').trim().slice(0, 1000), to: data.to, files, link, owner: me, team: user.team, status: 'sent', assignee: '' };
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, keep); log(data, me, `Uploaded and sent to the ${data.to === 'it' ? 'IT Manager' : 'Sales Manager'}`); break;
    }
    case 'bill': { // a bill the person paid for the company, to be paid back to their UPI QR code (the user, 9 Oct 2026)
      if (!user) throw new Rule('Please sign in.', 401);
      if (user.team === 'management') throw new Rule('Management does not submit bills here.');
      const b = cleanBill(data); await ownFiles(t, b.files, me);
      const qr = (await t.query('select upi_qr from users where id = $1', [me])).rows[0]?.upi_qr || '';
      if (!qr) throw new Rule('Add your UPI QR code first, so management can pay you back.');
      for (const k of Object.keys(data)) delete data[k];
      // qr: the QR code as it was when the bill was submitted – it cannot change while the bill waits (server/app.js, PATCH /users).
      Object.assign(data, b, { owner: me, team: user.team, qr, status: 'submitted', number: 'B-' + String(await counter(t, 'bill')).padStart(4, '0') });
      log(data, me, 'Bill submitted'); break;
    }
    case 'collab':
      if (!canEditCollab(user)) throw new Rule('Only the Operations Manager or Company Secretary can add a collaboration.', 403);
      if (!['college', 'employer'].includes(data.kind)) throw new Rule('Choose college or employer.');
      if (!data.name?.trim()) throw new Rule('Enter the name.'); data.status ||= 'active'; log(data, me, 'Collaboration added'); break;
    case 'report': {
      if (!user) throw new Rule('Please sign in.', 401);
      if (NO_REPORT_TITLES.includes(user.title)) throw new Rule('Top management does not write a daily report.');
      data.owner = me; data.team = user.team; data.ownerTitle = user.title; data.date ||= today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || data.date > today()) throw new Rule('A report cannot be for a future date.');
      if (data.date < addDays(today(), -3) && !user.is_admin) throw new Rule('You can fill a report for the last 3 days only.');
      const ex = (await t.query("select id from records where deleted_at is null and type = 'report' and data->>'owner' = $1 and data->>'date' = $2", [me, data.date])).rows[0];
      if (ex) return { merged: true, id: ex.id, type: 'report' }; // one report per person per day
      data.status = 'open'; data.entries = cleanEntries(data.entries); checkVisits(data.entries); data.calls = cleanCalls(data.calls);
      for (const k of ['plan', 'blockers']) if (data[k] !== undefined) data[k] = String(data[k] ?? '').slice(0, 2000); // always text (a number broke the page)
      await applyCalls(t, user, [], data.calls, sample); await leadsFromCalls(t, user, [], data.calls, sample); await setPresence(t, user, data, sample);
      if (data.date === today()) data.dayStart = new Date().toISOString(); else delete data.dayStart; // the day starts when the report is opened
      delete data.dayEnd;
      for (const k of ['remarks', 'reviewed', 'submittedAt', 'log', 'shareToken']) delete data[k];
      break;
    }
  }
  return { merged: false };
}
const cleanEntries = (list) => (Array.isArray(list) ? list : []).filter((e) => String(e?.text || '').trim()).slice(0, 100).map((e) => ({
  id: e.id || newId('e_'), at: e.at || new Date().toISOString(), text: String(e.text).trim().slice(0, 500),
  ...(e.kind ? { kind: String(e.kind).slice(0, 60) } : {}), ...(Number(e.mins) > 0 ? { mins: Math.min(1440, Math.round(Number(e.mins))) } : {}),
  // A task can be started and finished: the time taken is worked out from the two moments.
  ...(e.start ? { start: String(e.start).slice(0, 30) } : {}), ...(e.end ? { end: String(e.end).slice(0, 30) } : {}), ...(e.state === 'running' ? { state: 'running' } : {}), ...(e.brk ? { brk: true } : {}), ...(e.out || /visit/i.test(e.kind || '') ? { out: true } : {}), // out: away from the office (a client visit always is)
  ...(e.visit?.client ? { visit: { client: String(e.visit.client).trim().slice(0, 120), person: String(e.visit.person || '').trim().slice(0, 80), phone: String(e.visit.phone || '').trim().slice(0, 40), place: String(e.visit.place || '').trim().slice(0, 120),
    // the check-ins asked by the app (src/visit.jsx): when they reached the client, when they left, how it went, and the next follow-up
    ...(e.visit.reachedAt ? { reachedAt: String(e.visit.reachedAt).slice(0, 30) } : {}), ...(e.visit.leftAt ? { leftAt: String(e.visit.leftAt).slice(0, 30) } : {}),
    ...(VISIT_OUTCOMES.includes(e.visit.outcome) ? { outcome: e.visit.outcome } : {}), ...(/^\d{4}-\d\d-\d\d$/.test(e.visit.next || '') ? { next: e.visit.next } : {}) } } : {}),
  // the trip back to the office after a visit, and when the person got there
  ...(e.trip?.to === 'office' ? { trip: { to: 'office', from: String(e.trip.from || '').slice(0, 120), ...(e.trip.reachedAt ? { reachedAt: String(e.trip.reachedAt).slice(0, 30) } : {}) } } : {}),
  ...(e.proj ? { proj: String(e.proj).trim().slice(0, 120) } : {}), ...(e.note ? { note: String(e.note).trim().slice(0, 300) } : {}),
  ...(e.refId ? { refId: e.refId, refLabel: String(e.refLabel || '').slice(0, 120), refLink: String(e.refLink || '').slice(0, 120) } : {}) }));
// A bill's details as the form sends them: every field checked, nothing else kept.
function cleanBill(d) {
  const b = { date: String(d.date || ''), amount: round2(num(d.amount)), kind: String(d.kind || ''), paidTo: String(d.paidTo || '').trim().slice(0, 120),
    purpose: String(d.purpose || '').trim().slice(0, 500), paidBy: String(d.paidBy || ''), clientId: String(d.clientId || '').slice(0, 40), clientName: String(d.clientName || '').trim().slice(0, 120),
    files: (Array.isArray(d.files) ? d.files : []).slice(0, 10).map((f) => ({ id: String(f?.id || ''), name: String(f?.name || 'bill').slice(0, 200), size: +f?.size || 0, mime: String(f?.mime || '').slice(0, 100), at: String(f?.at || ''), by: String(f?.by || '') })) };
  if (!/^\d{4}-\d\d-\d\d$/.test(b.date) || b.date > today()) throw new Rule('Enter the date on the bill (not a future date).');
  if (!(b.amount > 0)) throw new Rule('Enter the amount of the bill.');
  if (b.amount > 500000) throw new Rule('That amount looks too large for a bill. Check it.');
  if (!BILL_KINDS.includes(b.kind)) throw new Rule('Choose the type of expense.');
  if (!b.paidTo) throw new Rule('Enter the shop or the person you paid.');
  if (!b.purpose) throw new Rule('Write what the bill was for.');
  if (!BILL_PAID_BY.includes(b.paidBy)) throw new Rule('Choose how you paid.');
  if (!b.files.length) throw new Rule('Attach a photo of the bill.');
  if (!b.clientId) delete b.clientId; if (!b.clientName) delete b.clientName;
  return b;
}
// Bill photos: only pictures or PDFs the person uploaded themselves – knowing a file's number must not bring someone else's file into view.
async function ownFiles(t, files, me, what = 'the bill') {
  const ids = [...new Set(files.map((f) => f.id))]; if (!ids.length) return;
  const ok = (await t.query('select id, mime from files where id = any($1) and created_by = $2', [ids, me])).rows;
  if (ok.length !== ids.length) throw new Rule(`Attach the photo of ${what} again.`);
  if (ok.some((f) => !/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.mime))) throw new Rule(`The photo of ${what} must be a picture (JPG or PNG) or a PDF.`);
}
const fileList = (arr, me, max = 10) => (Array.isArray(arr) ? arr : []).slice(0, max).map((f) => ({ id: String(f?.id || '').slice(0, 40), name: String(f?.name || 'photo').slice(0, 200),
  size: +f?.size || 0, mime: String(f?.mime || '').slice(0, 100), at: new Date().toISOString(), by: me })).filter((f) => f.id);
export const VISIT_OUTCOMES = ['Deal accepted', 'Next meeting fixed', 'Interested – follow up', 'Will think – call back', 'Not interested', 'Could not meet'];
// A client visit must say who was visited: client name, the person met, their number and the place.
// A client visit says who and where from the start (client name and place) – enough when a client asks to meet out of the blue.
// The person met and their number are needed before the visit ends, unless the client could not be met.
const checkVisits = (list) => { for (const e of list) { if (!/visit/i.test(e.kind || '') && !e.visit) continue;
  if (!(e.visit?.client && e.visit.place)) throw new Rule('For a client visit, enter the client name and the place.');
  if ((e.visit.outcome || e.state === 'done') && e.visit.outcome !== 'Could not meet' && !(e.visit.person && e.visit.phone)) throw new Rule(`Before the visit to ${e.visit.client} ends, enter the person you met and their contact number.`); } };
// Out of office: while a task marked "out" is running (a client visit, work outside, or a permission), the person's manager and management
// see them as out (teammates do not). One 'presence' record per person, kept true by the server whenever their report is saved.
async function setPresence(t, user, rep, sample) {
  const run = rep.status !== 'submitted' && rep.date === today() ? (rep.entries || []).find((e) => e.state === 'running' && e.out) : null, id = 'pz_' + user.id;
  const cur = (await t.query('select data from records where id = $1', [id])).rows[0];
  const why = run?.visit ? (run.visit.reachedAt ? `At a client – ${run.visit.client}` : `Going to a client – ${run.visit.client}`) : run?.trip ? 'Returning to the office' : run?.brk ? 'Permission' : 'Work outside the office';
  const data = run ? { user: user.id, team: user.team, out: true, why, since: run.start || new Date().toISOString(), date: rep.date } : { user: user.id, team: user.team, out: false, date: rep.date };
  if (!cur) { if (run) await insertRec(t, 'presence', data, user, { id, sample }); return; }
  if (!!cur.data.out === data.out && (cur.data.since || '') === (data.since || '') && (cur.data.why || '') === (data.why || '')) return;
  await t.query('update records set data = $2, updated_by = $3, updated_at = now(), deleted_at = null where id = $1', [id, JSON.stringify(data), user.id]);
}
// The call sheet inside a report: one row per call, as the BDEs kept in Excel.
const cleanCalls = (list) => (Array.isArray(list) ? list : []).filter((c) => String(c?.org || '').trim()).slice(0, 400).map((c) => ({
  id: c.id || newId('c_'), at: c.at || new Date().toISOString(), org: String(c.org).trim().slice(0, 120), phone: String(c.phone || '').trim().slice(0, 40),
  place: String(c.place || '').trim().slice(0, 60), resp: String(c.resp || '').trim().slice(0, 40), meeting: String(c.meeting || '').trim().slice(0, 80),
  met: !!c.met, note: String(c.note || '').trim().slice(0, 300), ...(c.ind ? { ind: String(c.ind).slice(0, 60) } : {}), ...(c.src ? { src: String(c.src).slice(0, 40) } : {}), ...(c.dupOk ? { dupOk: true } : {}),
  ...(c.paste && /^[\w-]{4,40}$/.test(c.paste) ? { paste: c.paste } : {}), // rows added together by one paste, so they can be removed together
  ...(c.resp === 'Call back' && /^\d{4}-\d\d-\d\d$/.test(c.back || '') ? { back: c.back } : {}),
  ...(c.resp === 'Interested' && Array.isArray(c.services) ? { services: c.services.map((x) => String(x || '').trim().slice(0, 80)).filter(Boolean).slice(0, 12) } : {}),
  ...(/^le_[\w-]{4,40}$/.test(c.leadId || '') ? { leadId: c.leadId } : {}) }));
// A business said "Interested" on a call (the user, 17 Oct 2026): it becomes a lead at once, through the same intake as any enquiry –
// the BDE's own, Warm, follow-up tomorrow, the services it wants. The same mobile + a service already open joins that lead instead.
async function leadsFromCalls(t, user, prev, next, sample) {
  const seen = new Set(prev.map((c) => c.id));
  for (const c of next) {
    if (seen.has(c.id) || c.resp !== 'Interested' || c.leadId || !c.services?.length || mobile10(c.phone).length !== 10) continue;
    const data = { name: c.org, company: c.org, mobile: c.phone, services: c.services, source: c.src ? `Call list – ${c.src}` : 'Phone call',
      message: [c.note, c.meeting && `Meeting: ${c.meeting}`, c.place].filter(Boolean).join(' · '), score: 'warm', followUp: addDays(today(), 1), owner: user.id, fromCall: c.id };
    const r = await beforeCreate(t, 'lead', data, user, sample);
    if (r?.merged) { c.leadId = r.type === 'lead' ? r.id : ''; continue; }
    const id = await insertRec(t, 'lead', data, user, { sample }); await afterCreate(t, 'lead', id, data, user, sample); c.leadId = id;
  }
}
// Who is told when a report is submitted: the department manager; for a manager's own report, the Ops Manager and Company Secretary.
async function reportWatchers(t, d) {
  const us = (await t.query('select id, title, team from users where active and id <> $1', [d.owner])).rows;
  const mgr = us.filter((u) => MANAGER_TITLES.includes(u.title) && !TOP_TITLES.includes(u.title) && u.team === d.team);
  return (mgr.length ? mgr : us.filter((u) => ['ops', 'cs'].includes(u.title))).map((u) => u.id);
}

// Discounts above the limit (the user, 10 Oct 2026): management approves them – the Operations Manager, Company Secretary or Founder & Chairman.
// Management's own quotations count as approved by them; anyone else's (the Sales Manager's) waits. The approval is recorded by the server
// with the percentage approved, so raising the discount later asks again, and nothing about it can be sent from the browser.
async function quoteApproval(t, q, user, prev, sample) {
  const limit = num(await getSetting(t, 'discountApprovalPct', 10)), pct = num(q.totals.discountPct);
  for (const k of ['discountApprovedAt', 'discountApprovedBy', 'discountApprovedPct', 'discountRejected']) { if (prev?.[k] === undefined) delete q[k]; else q[k] = prev[k]; }
  const allowed = q.discountApprovedAt ? num(q.discountApprovedPct ?? prev?.totals?.discountPct ?? 0) : -1;
  if (pct <= limit || pct <= allowed) { if (q.status === 'needs approval') q.status = q.assignedTo ? 'sent' : 'draft'; return; }
  if (MANAGEMENT(user)) { Object.assign(q, { discountApprovedAt: new Date().toISOString(), discountApprovedBy: user.id, discountApprovedPct: pct }); delete q.discountRejected; if (q.status === 'needs approval') q.status = q.assignedTo ? 'sent' : 'draft'; return; }
  q.status = 'needs approval';
  if (!prev || prev.status !== 'needs approval') q._askApproval = true;
}

export async function afterCreate(t, type, id, data, user, sample) {
  const me = user?.id || null;
  if (type === 'quote' && data._askApproval) {
    delete data._askApproval; await t.query('update records set data = $2 where id = $1', [id, JSON.stringify(data)]);
    await askDiscount(t, id, data, user, sample);
  }
  if ((type === 'quote' || type === 'invoice') && data.dealId) {
    const deal = await getRec(t, data.dealId, 'deal');
    if (deal && type === 'quote') { deal.data.quoteNo = data.number; deal.data.quoteId = id; deal.data.value = data.totals.total; log(deal.data, me, `Quotation ${data.number} made (${data.totals.total})`); await putRec(t, deal, user); }
  }
  if (type === 'receipt') await applyReceipt(t, id, data, user);
  if (type === 'signoff') {
    const p = await getRec(t, data.projectId, 'project');
    if (p) { const go = p.data.stage !== 'live'; p.data.signoffId = id; if (go) { p.data.stage = 'live'; p.data.liveAt = today(); }
      log(p.data, me, `Client sign-off by ${data.signerName} (${data.certNo})${go ? ' – moved to Live' : ''}`); await putRec(t, p, user); }
  }
  if (type === 'agreement') await tellAgreement(t, ['ops', 'salesmgr'], `${user.name} made ${AGREEMENT[data.kind].name.toLowerCase()} ${data.number} for ${data.clientName} (draft).`, id, user, sample);
  if (type === 'comment') for (const to of data.mentions || []) await notify(t, to, `${user?.name || 'Someone'} mentioned you: "${String(data.text).slice(0, 80)}"`, data.relType, data.relId, user, sample);
  if (type === 'lead') await claimForLead(t, id, data, user, sample); // the business now belongs to this lead's BDE
  if (type === 'bill') // management hears of every bill at once (the user, 9 Oct 2026)
    for (const u of (await t.query('select id from users where active and removed_at is null and title = any($1)', [TOP_TITLES])).rows)
      await notify(t, u.id, `${user.name} submitted a bill: ${inr(data.amount)} · ${data.kind} · ${data.paidTo} (${data.number}).`, 'bill', id, user, sample);
  if (type === 'asset') { // tell the manager they go to; the Sales Manager always (the BDE is in her team); the Operations Manager and Company Secretary always
    const dest = data.to === 'it' ? 'the IT Manager' : 'the Sales Manager', n = (data.files || []).length, what = `${n ? `${n} file${n === 1 ? '' : 's'}` : 'a link'}${data.what ? ` for ${data.what}` : ''}`;
    for (const u of (await t.query("select id, title from users where active and title in ('salesmgr', 'itmgr', 'ops', 'cs')")).rows) {
      if (u.title === 'itmgr' && data.to !== 'it') continue;
      const yours = (u.title === 'itmgr' && data.to === 'it') || (u.title === 'salesmgr' && data.to === 'sales');
      await notify(t, u.id, yours ? `${user.name} sent you client assets: ${data.clientName} – ${what}. Please give them to the right person.` : `${user.name} sent client assets of ${data.clientName} (${what}) to ${dest}.`, 'asset', id, user, sample);
    }
  }
  if (type === 'lead' || type === 'task' || type === 'ticket') { const to = data.owner; if (to) await notify(t, to, `New ${type === 'lead' ? 'lead' : type === 'ticket' ? 'support request' : 'task'}: ${data.name || data.title}`, type, id, user, sample); }
  if (type === 'approval') { const mgrs = (await t.query(`select id from users where active and (is_admin or title = any($1))`, [['salesmgr', 'itmgr', 'ops']])).rows;
    for (const m of mgrs) await notify(t, m.id, `Approval needed: ${data.reason}`, 'approval', id, user, sample); }
}

// Agreements: SA/2026-27/001 for a client service agreement, PCA/2026-27/001 for a project closure agreement.
export const AGREEMENT = { service: { prefix: 'SA', name: 'Service agreement' }, closure: { prefix: 'PCA', name: 'Closure agreement' } };
// Agreement news goes to the people of these access levels who are still working here, never to the person who did it.
async function tellAgreement(t, titles, text, id, user, sample) {
  for (const u of (await t.query('select id from users where active and title = any($1) and id <> $2', [titles, user?.id || ''])).rows) await notify(t, u.id, text, 'agreement', id, user, sample);
}

// ---------- payroll (shared/payroll.js does the arithmetic) ----------
const NOT_ON_PAYROLL = ['chairman', 'admin']; // the Founder & Chairman, and the setup account
const money = (v) => Math.max(0, Math.round(+v || 0));
// The same value whatever the order of its fields: Postgres keeps an object's fields in its own order (shorter names first), so text
// compared with what was just cleaned differed although nothing had changed – a locked payroll could not be reopened (17 Oct 2026).
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}` : JSON.stringify(v ?? null));
const same = (a, b) => stable(a) === stable(b);
const txt = (v, n) => String(v ?? '').trim().slice(0, n);
const day = (v) => { if (!/^\d{4}-\d\d-\d\d$/.test(v || '')) return ''; const d = new Date(v + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === v ? v : ''; }; // a real date only
const mon = (v) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(v || '') ? v : '');
function cleanSalary(d) {
  const gross = money(d.gross); if (!gross) throw new Rule('Enter the monthly gross salary.');
  const b = d.bank || {}, account = txt(b.account, 30).replace(/\s/g, ''), ifsc = txt(b.ifsc, 11).toUpperCase(), pan = txt(d.pan, 10).toUpperCase();
  if (account && !/^\d{6,20}$/.test(account)) throw new Rule('The bank account number should be 6 to 20 digits.');
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Rule('The IFSC looks wrong: 11 characters, like ICIC0001234.');
  if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw new Rule('The PAN looks wrong: 10 characters, like ABCDE1234F.');
  const pct = d.basicPct === '' || d.basicPct == null ? null : Math.round(+d.basicPct);
  if (pct !== null && !(pct >= 10 && pct <= 100)) throw new Rule('Basic must be between 10% and 100% of the gross.');
  return { gross, from: mon(d.from), basicPct: pct, pf: !!d.pf, pfCap: d.pfCap !== false, esi: !!d.esi, pt: d.pt !== false,
    fixed: (Array.isArray(d.fixed) ? d.fixed : []).slice(0, 20).map((x) => ({ name: txt(x?.name, 60), amount: money(x?.amount) })).filter((x) => x.name),
    bank: { holder: txt(b.holder, 80), account, ifsc, name: txt(b.name, 60) }, pan, uan: txt(d.uan, 12), esiNo: txt(d.esiNo, 17),
    joined: day(d.joined), left: day(d.left), stopped: !!d.stopped, note: txt(d.note, 500) };
}
// Payroll rules as HR saves them (Aali's own, or a client's): numbers only, in sensible ranges. dayBasis 26 / 30: one day's pay is the
// gross ÷ 26 or ÷ 30 instead of ÷ the days in the month (some clients pay that way).
export function cleanRules(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Rule('Send the payroll rules.');
  const n = (k, lo, hi) => Math.min(hi, Math.max(lo, +v[k] || 0)), d = DEFAULT_SETTINGS.payroll;
  return { payDay: n('payDay', 1, 28) || d.payDay, basicPct: n('basicPct', 10, 100) || d.basicPct, hraPct: n('hraPct', 0, 100), pfEe: n('pfEe', 0, 30), pfEr: n('pfEr', 0, 30), pfCeiling: n('pfCeiling', 0, 1e7),
    esiEe: n('esiEe', 0, 10), esiEr: n('esiEr', 0, 10), esiLimit: n('esiLimit', 0, 1e7), freeLeaves: n('freeLeaves', 0, 31), dayBasis: [26, 30].includes(+v.dayBasis) ? +v.dayBasis : 0,
    // a payroll client's daily-wage workers, overtime, and extras
    dailyBasicPct: n('dailyBasicPct', 10, 100) || 100, shiftHours: n('shiftHours', 1, 24) || 8, otMultiplier: n('otMultiplier', 1, 4) || 2,
    dailyPaid: { leave: v.dailyPaid?.leave !== false, holidays: v.dailyPaid?.holidays !== false, offs: !!v.dailyPaid?.offs }, extras: cleanExtras(v.extras),
    ptSlabs: (Array.isArray(v.ptSlabs) ? v.ptSlabs : d.ptSlabs).slice(0, 10).map((r) => [Math.max(0, Math.round(+r?.[0] || 0)), Math.max(0, Math.round(+r?.[1] || 0))]) };
}
// A client's extras (shared/payroll.js extrasFor): up to 20, each with a short key the attendance Excel's column is read into.
const HOW = ['fixed', 'perDay', 'perUnit', 'amount', 'tiers', 'overtime'];
function cleanExtras(list) {
  const keys = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 20).map((e) => {
    const name = txt(e?.name, 40); if (!name) return null;
    let key = /^[a-z0-9]{1,24}$/.test(e.key || '') ? e.key : name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'extra';
    for (let i = 2; keys.has(key); i++) key = key.replace(/\d*$/, '') + i; keys.add(key);
    const how = HOW.includes(e.how) ? e.how : 'fixed', side = how === 'overtime' || how === 'tiers' ? 'earn' : e.side === 'cut' ? 'cut' : 'earn';
    return { key, name, side, how, amount: Math.max(0, Math.round((+e.amount || 0) * 100) / 100), wages: side === 'earn' && !!e.wages, who: ['all', 'daily', 'monthly'].includes(e.who) ? e.who : 'all',
      tiers: how === 'tiers' ? (Array.isArray(e.tiers) ? e.tiers : []).slice(0, 6).map((t) => [Math.max(0, Math.min(31, +t?.[0] || 0)), Math.max(0, Math.round((+t?.[1] || 0) * 100) / 100)]).filter((t) => t[0] > 0) : [],
      tierMode: e.tierMode === 'day' ? 'day' : 'month' };
  }).filter(Boolean);
}
const email = (v, what) => { const e = txt(v, 120).toLowerCase(); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Rule(`The ${what} looks wrong.`); return e; };
const phone = (v) => txt(v, 15).replace(/[^\d+]/g, '');
// A payroll client: the company whose employees Aali Conssultancy pays as a service. The client is the employer, so its name,
// address and PF/ESI numbers go on the payslips; its own pay rules; where its attendance comes from; Aali's fee (for the bill).
function cleanPclient(d) {
  const name = txt(d.name, 120); if (name.length < 2) throw new Rule('Enter the client\'s name as it should be on the payslips.');
  const gstin = txt(d.gstin, 15).toUpperCase(); if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) throw new Rule('The GSTIN looks wrong: 15 characters, like 37ABCDE1234F1Z5.');
  const fee = d.fee && typeof d.fee === 'object' ? d.fee : {}, attendance = d.attendance === 'hrm' ? 'hrm' : 'excel';
  // Their own HRM: a short link code names the hosting setting with its connection (HRM_DATABASE_URL_<code>, server/hrm.js).
  const hrmCode = attendance === 'hrm' ? txt(d.hrmCode, 20).toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  if (attendance === 'hrm' && !/^[A-Z0-9]{2,12}$/.test(hrmCode)) throw new Rule('Give their HRM a short link code: 2 to 12 letters or numbers, like GSM.');
  return { name, address: txt(d.address, 300), gstin, clientId: txt(d.clientId, 40), contactName: txt(d.contactName, 80), contactPhone: phone(d.contactPhone), contactEmail: email(d.contactEmail, 'contact email'),
    pfCode: txt(d.pfCode, 30).toUpperCase(), esiCode: txt(d.esiCode, 30), ptState: txt(d.ptState, 40), rules: cleanRules(d.rules && typeof d.rules === 'object' ? d.rules : {}),
    payModel: ['daily', 'monthly', 'both'].includes(d.payModel) ? d.payModel : 'monthly', attendance, hrmCode, fee: { kind: ['employee', 'month', 'percent'].includes(fee.kind) ? fee.kind : 'employee', amount: Math.max(0, Math.round((+fee.amount || 0) * 100) / 100) },
    note: txt(d.note, 500), active: d.active !== false };
}
// A payroll client's employee (no login): an employee code unique within the client, and the same pay details as a salary sheet.
// model: the client's pay model – 'daily' or 'monthly' fixes the pay type, 'both' lets each employee be either.
function cleanPemp(d, model = 'monthly') {
  const code = txt(d.code, 20).toUpperCase(); if (!code) throw new Rule('Enter the employee code.');
  const name = txt(d.name, 80); if (name.length < 2) throw new Rule(`Enter the name of employee ${code}.`);
  const payType = model === 'daily' ? 'daily' : model === 'monthly' ? 'monthly' : d.payType === 'daily' ? 'daily' : 'monthly';
  const rate = payType === 'daily' ? Math.max(0, Math.round((+d.rate || 0) * 100) / 100) : 0;
  if (payType === 'daily' && !rate) throw new Rule(`Enter the daily wage of employee ${code}.`);
  const { from, ...pay } = cleanSalary(payType === 'daily' ? { ...d, gross: 1 } : d);
  return { ...pay, gross: payType === 'daily' ? 0 : pay.gross, rate, code, name, designation: txt(d.designation, 60), department: txt(d.department, 60), payType,
    phone: phone(d.phone), personalEmail: email(d.personalEmail, 'personal email'), active: d.active !== false };
}
async function hrmCodeFree(t, code, id) { // one link code, one client's HRM
  if (code && (await t.query("select 1 from records where deleted_at is null and type = 'pclient' and data->>'hrmCode' = $1 and id <> $2", [code, id])).rowCount) throw new Rule(`The link code ${code} is already another client's.`);
}
async function pempCodeFree(t, pclientId, code, id) {
  if ((await t.query("select 1 from records where deleted_at is null and type = 'pemp' and data->>'pclientId' = $1 and upper(data->>'code') = $2 and id <> $3", [pclientId, code, id || ''])).rowCount)
    throw new Rule(`Employee code ${code} is already used for this client.`);
}
// A month's attendance Excel for a client: rows { code, present, half, paidLeave, unpaidLeave, absent, offs, holidays, paidDays } →
// { employeeId: row }. Every code must be one of the client's employees; numbers are days from 0 to 31 (halves allowed).
export async function readAttendance(t, pclientId, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Rule('The attendance file has no rows.');
  const emps = new Map((await t.query("select id, data from records where deleted_at is null and type = 'pemp' and data->>'pclientId' = $1", [pclientId])).rows.map((r) => [String(r.data.code).toUpperCase(), r.id]));
  const cols = ((await getRec(t, pclientId, 'pclient'))?.data.rules?.extras || []).filter(fromSheet), out = {}, unknown = [];
  for (const r of rows.slice(0, 5000)) {
    const code = txt(r?.code, 20).toUpperCase(); if (!code) continue;
    const id = emps.get(code); if (!id) { unknown.push(code); continue; }
    const num = (k) => { const x = r[k]; if (x === '' || x == null) return ''; const v = Math.round(+x * 2) / 2; if (!(v >= 0 && v <= 31)) throw new Rule(`Employee ${code}: days must be a number from 0 to 31.`); return v; };
    const ex = r.extra && typeof r.extra === 'object' ? r.extra : {}, extra = {};
    for (const c of cols) { const x = ex[c.key]; if (x === '' || x == null) continue; const v = Math.round(+x * 100) / 100;
      if (!(v >= 0 && v <= (c.how === 'amount' ? 1e6 : 1000))) throw new Rule(`Employee ${code}: "${c.name}" must be a number${c.how === 'amount' ? ' of rupees' : ''}.`); extra[c.key] = v; }
    out[id] = { present: num('present'), half: num('half'), double: num('double'), paidLeave: num('paidLeave'), unpaidLeave: num('unpaidLeave'), absent: num('absent'), offs: num('offs'), holidays: num('holidays'), paidDays: num('paidDays'), extra };
  }
  if (unknown.length) throw new Rule(`These employee codes are not in this client's list: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ' …' : ''}. Add them in Employees first.`);
  if (!Object.keys(out).length) throw new Rule('No employee code was found in the file.');
  return out;
}
// Staff without a login (a maid, a personal secretary…): on the payroll and given payslips, but never signing in to Aali One.
// HR keeps their details in a 'payee' record; their salary sheet, loans and payroll lines use its id where others use their login's.
function cleanPayee(d) {
  const name = txt(d.name, 80); if (name.length < 2) throw new Rule('Enter the person\'s full name.');
  const mail = (v, what) => { const e = txt(v, 120).toLowerCase(); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Rule(`The ${what} looks wrong.`); return e; };
  return { name, designation: txt(d.designation, 60), company: [GROUP, ...COMPANIES].includes(d.company) ? d.company : COMPANIES[0], email: mail(d.email, 'Aali HRM email'),
    personalEmail: mail(d.personalEmail, 'personal email'), phone: txt(d.phone, 15).replace(/[^\d+]/g, ''), active: d.active !== false };
}
// One Aali HRM email, one person: not someone who signs in with it, not another payee, not someone HR matched to it by hand.
async function payeeEmailFree(t, email, id) {
  if (!email) return;
  if ((await t.query('select 1 from users where lower(email) = $1', [email])).rowCount) throw new Rule('Someone in Aali One already signs in with that email – they are matched to Aali HRM already.');
  if ((await t.query("select 1 from records where deleted_at is null and type = 'payee' and lower(data->>'email') = $1 and id <> $2", [email, id || ''])).rowCount) throw new Rule('Another person without a login already has that Aali HRM email.');
  if (Object.values(await getSetting(t, 'hrmLinks', {})).includes(email)) throw new Rule('HR has matched someone in Aali One to that Aali HRM email by hand.');
}
// Who a salary sheet or a loan can be for: a login on the payroll (not the Founder & Chairman), or a payee still working here.
async function payPerson(t, id) {
  const u = (await t.query('select id, name, title from users where id = $1', [String(id || '')])).rows[0]; if (u) return NOT_ON_PAYROLL.includes(u.title) ? null : u;
  const p = (await t.query("select id, data from records where id = $1 and type = 'payee' and deleted_at is null", [String(id || '')])).rows[0];
  return p && p.data.active !== false ? { id: p.id, name: p.data.name, title: 'payee' } : null;
}
function cleanLoan(d) {
  const kind = d.kind === 'advance' ? 'advance' : 'loan', amount = money(d.amount); if (!amount) throw new Rule('Enter the amount given.');
  const from = mon(d.from); if (!from) throw new Rule('Choose the month the cutting starts.');
  const cut = kind === 'advance' ? amount : money(d.cut); if (!cut) throw new Rule('Enter how much is cut each month.');
  return { kind, amount, cut: Math.min(cut, amount), from, givenOn: day(d.givenOn), note: txt(d.note, 300) };
}
// HR's changes for one month, person by person: paid days typed by hand (with why), TDS, another deduction, extra pay, a different loan cut.
function cleanAdj(a) {
  const out = {};
  for (const [uid, v] of Object.entries(a && typeof a === 'object' ? a : {}).slice(0, 300)) {
    if (!/^[\w-]{1,40}$/.test(uid) || !v || typeof v !== 'object') continue;
    const o = {};
    if (v.days !== undefined && v.days !== null && v.days !== '') { const d = Math.round(+v.days * 2) / 2; if (!(d >= 0 && d <= 31)) throw new Rule('Paid days must be between 0 and 31.'); o.days = d; o.daysWhy = txt(v.daysWhy, 200); }
    for (const k of ['tds', 'other', 'extra']) if (money(v[k])) o[k] = money(v[k]);
    if (o.other) { o.otherWhy = txt(v.otherWhy, 120); if (!o.otherWhy) throw new Rule('Say what the other deduction is for.'); }
    if (o.extra) { o.extraWhy = txt(v.extraWhy, 120); if (!o.extraWhy) throw new Rule('Say what the extra pay is for (bonus, arrears…).'); }
    if (v.loans && typeof v.loans === 'object') { const l = {}; for (const [id, x] of Object.entries(v.loans).slice(0, 20)) if (/^[\w-]{1,40}$/.test(id) && x !== '' && x != null) l[id] = money(x); if (Object.keys(l).length) o.loans = l; }
    if (Object.keys(o).length) out[uid] = o;
  }
  return out;
}
// Works out every person's pay for the month, fresh: salary sheets + Aali HRM attendance + open loans + HR's changes.
async function buildRun(t, run) {
  if (run.pclientId) return buildClientRun(t, run);
  const month = run.month, start = `${month}-01`, end = `${month}-${String(daysIn(month)).padStart(2, '0')}`;
  const rules = { ...DEFAULT_SETTINGS.payroll, ...(await getSetting(t, 'payroll', {})) }, now = today(), adj = run.adj || {};
  const sal = (await t.query("select id, data from records where deleted_at is null and type = 'salary'")).rows;
  const loans = (await t.query("select id, data from records where deleted_at is null and type = 'loan'")).rows;
  const users = new Map((await t.query('select id, email, name, title, designation, company, team, active, removed_at from users')).rows.map((u) => [u.id, u]));
  const links = await getSetting(t, 'hrmLinks', {}); // people HR matched by hand in Rules & Aali HRM
  for (const { id, data: p } of (await t.query("select id, data from records where deleted_at is null and type = 'payee'")).rows) // staff without a login
    users.set(id, { id, email: p.email || '', name: p.name, title: 'payee', designation: p.designation || '', company: p.company || '', team: '', active: p.active !== false, removed_at: null });
  let hrm = null, error = '';
  if (hrmConnected()) try { hrm = await hrmMonth(month); } catch (e) { console.error('Aali HRM:', e?.message || e); error = 'Aali HRM could not be reached when this was made. Press "Read attendance again" later.'; }
  // If Aali HRM cannot be reached now, the attendance read last time is kept (a salary change must not wipe it).
  const before = !hrm && error && run.att?.source !== 'none' ? new Map((run.items || []).filter((i) => i.days?.att).map((i) => [i.userId, i.days.att])) : new Map(), keptAt = run.att?.at;
  const items = [];
  for (const { id, data: s } of sal) {
    const u = users.get(s.userId), then = salaryFor(s, month); // the gross in force in this month (review #4)
    if (!then || !u || NOT_ON_PAYROLL.includes(u.title) || s.stopped || (s.joined && s.joined > end) || (s.left && s.left < start)) continue;
    if ((!u.active || u.removed_at) && !s.left) continue; // a person switched off is paid only up to the leaving date HR enters on the sheet
    const h = hrm?.people.get(hrmEmailOf(u, links));
    const att = h ? attendanceDays({ month, today: now, joined: s.joined || h.joined, left: s.left || h.left, records: h.records, leaves: h.leaves, holidays: hrm.holidays, freeLeaves: +rules.freeLeaves || 0 }) : before.get(u.id) || null;
    const mine = loans.filter((l) => l.data.userId === u.id && (!l.data.closed || (l.data.recovered || []).some((x) => x.month === month))).map((l) => ({ id: l.id, ...l.data }));
    const p = payFor({ month, salary: then, att, rules, loans: mine, adj: adj[u.id] || {} });
    if (hrm && !h) p.warn.unshift(hrmEmailOf(u, links) ? `Not found in Aali HRM – no one there has the email ${hrmEmailOf(u, links)}. HR can match the person by hand in Rules & Aali HRM.`
      : 'No Aali HRM email on this person\'s details – add it in Salaries (Details), or type the paid days.');
    if (!s.bank?.account || !s.bank?.ifsc) p.warn.push('No bank account on the salary sheet.');
    items.push({ userId: u.id, salaryId: id, name: u.name, designation: u.designation || '', company: u.team === 'management' ? GROUP : u.company || '', bank: s.bank || {}, pan: s.pan || '', uan: s.uan || '', esiNo: s.esiNo || '', ...p });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  const add = (f) => items.reduce((a, i) => a + f(i), 0);
  Object.assign(run, { items, rules, totals: { people: items.length, gross: add((i) => i.earned.gross + i.extra), deductions: add((i) => i.ded.total), net: add((i) => i.net), employerPf: add((i) => i.employer.pf), employerEsi: add((i) => i.employer.esi) },
    att: { connected: hrmConnected(), source: hrm ? 'hrm' : before.size ? 'kept' : 'none', at: !hrm && before.size ? keptAt : new Date().toISOString(), error, found: items.filter((i) => i.days.att).length },
    warnMonth: end >= now ? `${monthLabel(month)} is not over yet: the days still to come are not counted.` : '' });
}
// A payroll client's month: the client's employees, their attendance, the client's own rules, and the client's name and PF/ESI
// numbers for the payslips (kept on the month, so a locked month never changes).
// Attendance: from the client's own HRM when it is linked (pclient.hrmCode; paid days by Aali HRM's rules, as for Aali's own staff),
// with the attendance Excel (run.sheet) bringing only the numbers for the extras – overtime hours, canteen tokens, a store bill.
// Someone the HRM does not have gets their days from the Excel if it gives them, or HR types them. Without a link: the Excel, as sent.
// If the HRM cannot be reached when the month is worked out again, the days read from it last time are kept.
const hasDays = (row) => ['present', 'half', 'double', 'paidLeave', 'unpaidLeave', 'absent', 'offs', 'holidays', 'paidDays'].some((k) => row?.[k] !== '' && row?.[k] != null);
async function buildClientRun(t, run) {
  const month = run.month, start = `${month}-01`, end = `${month}-${String(daysIn(month)).padStart(2, '0')}`, adj = run.adj || {};
  const pc = (await getRec(t, run.pclientId, 'pclient'))?.data || {}, rules = { ...DEFAULT_SETTINGS.payroll, ...(pc.rules || {}) };
  const key = pc.attendance === 'hrm' ? pc.hrmCode || '' : '', linked = !!key && hrmConnected(key), theirs = `${pc.name || 'the client'}'s HRM`, now = today();
  let hrm = null, error = '';
  if (linked) try { hrm = await hrmMonth(month, key); } catch (e) { console.error(`${theirs}:`, e?.message || e); error = `${theirs} could not be reached when this was made. Press "Read attendance again" later.`; }
  const kept = !hrm && error ? new Map((run.items || []).filter((i) => i.days?.att?.src === 'hrm').map((i) => [i.userId, i.days.att])) : new Map();
  const items = [];
  for (const { id, data: e } of (await t.query("select id, data from records where deleted_at is null and type = 'pemp' and data->>'pclientId' = $1", [run.pclientId])).rows) {
    if ((e.joined && e.joined > end) || (e.left && e.left < start) || e.stopped || (e.active === false && !e.left)) continue;
    const row = run.sheet?.[id], sheet = row ? sheetAttendance(row) : null, h = hrmFind(hrm, e);
    const fromHrm = h ? { ...onBasis(attendanceDays({ month, today: now, joined: e.joined || h.joined, left: e.left || h.left, records: h.records, leaves: h.leaves, holidays: hrm.holidays, freeLeaves: +rules.freeLeaves || 0 }), rules, e), src: 'hrm' } : kept.get(id) || null;
    const att = fromHrm || (!linked || hasDays(row) ? sheet : null);
    const p = clientPay({ month, emp: e, att, rules, adj: adj[id] || {}, from: fromHrm || (linked && !att) ? theirs : 'the attendance Excel', extra: sheet?.extra });
    if (hrm && !h && !att) p.warn = [`Not found in ${theirs} – no one there has the Employee ID ${e.code}${e.personalEmail ? ` or the email ${e.personalEmail}` : ''}. Make the employee code the same as their Employee ID in the HRM, or type the paid days.`, ...p.warn.filter((w) => !w.startsWith('No attendance from'))];
    if (!linked && run.sheet && !row) p.warn.unshift(`Not in the attendance Excel (employee code ${e.code}).`);
    if (!e.bank?.account || !e.bank?.ifsc) p.warn.push('No bank account on the employee\'s details.');
    items.push({ userId: id, salaryId: id, code: e.code, name: e.name, designation: e.designation || '', department: e.department || '', company: pc.name || '', bank: e.bank || {}, pan: e.pan || '', uan: e.uan || '', esiNo: e.esiNo || '', ...p });
  }
  items.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  const add = (f) => items.reduce((a, i) => a + f(i), 0);
  Object.assign(run, { items, rules, employer: { name: pc.name || '', address: pc.address || '', pfCode: pc.pfCode || '', esiCode: pc.esiCode || '', gstin: pc.gstin || '' },
    totals: { people: items.length, gross: add(grossOf), deductions: add((i) => i.ded.total), net: add((i) => i.net), employerPf: add((i) => i.employer.pf), employerEsi: add((i) => i.employer.esi) },
    att: { connected: linked, key, source: hrm ? 'hrm' : kept.size ? 'kept' : run.sheet ? 'excel' : 'none', at: hrm ? new Date().toISOString() : kept.size ? run.att?.at : run.sheetAt || '', error,
      found: items.filter((i) => i.days.att).length, inHrm: items.filter((i) => i.days.att?.src === 'hrm').length },
    warnMonth: hrm && end >= now ? `${monthLabel(month)} is not over yet: the days still to come are not counted.` : '' });
}
// A salary sheet, loan or advance was saved or deleted: every month still in draft is worked out again, so a draft never shows
// old figures (the user added a bank account to a salary sheet and the draft month still said "No bank account").
// pclientId: a payroll client's drafts ('' = Aali's own).
export async function refreshDrafts(t, user, pclientId = '') {
  for (const r of (await t.query("select * from records where deleted_at is null and type = 'payrun' and data->>'status' = 'draft' and coalesce(data->>'pclientId', '') = $1 for update", [pclientId])).rows) {
    await buildRun(t, r.data); await putRec(t, r, user);
  }
}
// Locking a month records what it cuts from each loan; reopening it takes those cuts back.
async function cutLoans(t, run, user, on) {
  if (run.pclientId) return; // loans and advances are Aali's own staff's; a client's month never touches them
  const cuts = new Map(); for (const i of run.items) for (const c of i.ded.loans) cuts.set(c.id, (cuts.get(c.id) || 0) + c.amount);
  for (const l of (await t.query("select * from records where deleted_at is null and type = 'loan' for update")).rows) {
    const had = (l.data.recovered || []).some((x) => x.month === run.month), amt = cuts.get(l.id) || 0;
    if (!had && !(on && amt > 0)) continue;
    l.data.recovered = (l.data.recovered || []).filter((x) => x.month !== run.month);
    if (on && amt > 0) l.data.recovered.push({ month: run.month, amount: amt });
    const left = loanLeft(l.data);
    if (left === 0) { l.data.closed = true; l.data.paidOff = true; } else if (l.data.paidOff) { l.data.closed = false; l.data.paidOff = false; }
    log(l.data, user.id, on ? `₹${amt} cut in ${monthLabel(run.month)}; ₹${left} left` : `Cut of ${monthLabel(run.month)} taken back (payroll reopened); ₹${left} left`);
    await putRec(t, l, user);
  }
}
// Payroll news goes to the Operations Manager ('ops') or to HR ('hr') – never to the person who did it.
// who: 'ops' (the Operations Manager) or 'hr'. When the Founder & Chairman steps in, HR and the Operations Manager are both told.
async function tellPayroll(t, who, text, id, user, sample, rel = 'payroll') {
  const ops = "title = 'ops'", hr = "hr and title = 'cs'", where = user?.title === 'chairman' ? `(${ops} or ${hr})` : who === 'ops' ? ops : hr;
  const rows = (await t.query(`select id from users where active and ${where} and id <> $1`, [user?.id || ''])).rows;
  for (const u of rows) await notify(t, u.id, text, rel, id, user, sample);
}

// ---------- deadline reminders ----------
// Once a day (the first time anyone opens Aali One that day), every deadline (shared/deadlines.js) that is 2 days away or less – and
// every deadline that was missed – is told to the people who must act: management (Operations Manager, Company Secretary, Chairman),
// the Sales Manager, and the IT Manager only when it is IT work. Each reminder is sent once ('deadlineSent' remembers it).
let sweptDay = ''; // this server has already checked today: the many polls in between cost nothing
export async function deadlineSweep(db, force = false) {
  const day = today();
  if (!force && sweptDay === day) return 0;
  sweptDay = day;
  if (!force) { // only one request a day does the work, however many arrive at once
    const claim = await db.query("insert into settings (key, value) values ('deadlineSweep', $1) on conflict (key) do update set value = $1, updated_at = now() where settings.value <> $1::jsonb returning key", [JSON.stringify(day)]);
    if (!claim.rowCount) return 0;
  }
  const rows = (await db.query("select id, type, data, sample from records where deleted_at is null and type in ('project', 'client', 'task', 'ticket', 'payment')")).rows.map((r) => ({ ...r.data, id: r.id, type: r.type, sample: r.sample }));
  const users = (await db.query("select id, title from users where active and removed_at is null and title in ('ops', 'cs', 'chairman', 'salesmgr', 'itmgr')")).rows;
  const sent = await getSetting(db, 'deadlineSent', {}), dmy = inDate; let n = 0;
  for (const it of deadlineItems(rows)) {
    const left = Math.round((Date.parse(it.due) - Date.parse(day)) / 864e5);
    const stage = left >= 0 && left <= SOON_DAYS ? 'soon' : left < 0 && left >= -7 ? 'missed' : '';
    const key = `${it.key}:${it.due}:${stage}`;
    if (!stage || sent[key]) continue;
    const text = stage === 'missed' ? `Deadline missed: ${it.title} was due on ${dmy(it.due)}.`
      : left === 0 ? `Deadline today: ${it.title}.` : `Deadline in ${left} day${left === 1 ? '' : 's'}: ${it.title} – due ${dmy(it.due)}.`;
    for (const u of users) if (u.title !== 'itmgr' || it.team === 'it') { await notify(db, u.id, text, it.relType, it.relId, null, it.sample); n++; }
    sent[key] = day;
  }
  const keep = Object.fromEntries(Object.entries(sent).filter(([, d]) => d >= addDays(day, -60)));
  await setSetting(db, 'deadlineSent', keep);
  return n;
}

// A receipt settles its payment reminder; an advance unlocks the project.
async function applyReceipt(t, id, r, user) {
  if (!r.paymentId) return;
  const p = await getRec(t, r.paymentId, 'payment'); if (!p) return;
  const d = p.data, got = r.totals.received;
  d.receipts = [{ id, number: r.number, at: r.date, amount: got }, ...(d.receipts || [])];
  d.paid = round2(num(d.paid) + got);
  if (d.paid + 0.5 >= num(d.amount) && num(d.amount) > 0) {
    if (d.repeat && d.repeat !== 'none') { d.due = nextDue(d.due, d.repeat); d.paid = 0; d.amount = num(d.baseAmount) || num(d.amount); log(d, user?.id, `Paid in full (${r.number}); next due ${inDate(d.due)}`); }
    else { d.status = 'paid'; d.paidAt = r.date; log(d, user?.id, `Paid in full (${r.number})`); }
  } else log(d, user?.id, `Part payment ${got} (${r.number}); balance ${round2(num(d.amount) - d.paid)}`);
  await putRec(t, p, user);
  if (d.kind === 'advance' && d.dealId) {
    const deal = await getRec(t, d.dealId, 'deal');
    if (deal) { deal.data.handoff = { ...(deal.data.handoff || {}), advance: true, advanceAmt: got }; log(deal.data, user?.id, `Advance received (${r.number})`); await putRec(t, deal, user); }
    await advanceProjects(t, d.dealId, user, 'Advance received – work can start');
  }
}

// The steps the old project templates made (5-page website, mobile app, AMC setup) – only to recognise them for removal.
export const OLD_TEMPLATE_STEPS = new Set(['Collect content and logo from client', 'Design home page', 'Design approved by client', 'Build all pages', 'Contact form + WhatsApp button',
  'Testing on mobile and desktop', 'Website ready for client review', 'Go live + domain connect', ...DEFAULT_SETTINGS.projectTemplates.flatMap((x) => (x.tasks || []).map((k) => k.title))]);

// ---------- update ----------
// ---------- agreements and quotations: a manager makes them, a BDE takes them to the client (the user, 16 Oct 2026) ----------
// draft → submitted and given to a BDE ('sent') → the client asks for changes ('changes') → a manager changes it: a new version, which
// the BDE reconfirms with the client → an agreement: the BDE collects the advance, a manager confirms it and the receipt is made (it
// is not sent to the client) → the client signs on the BDE's phone, or on paper and the BDE uploads the photo → it can never change.
// The BDE never changes the contents and never makes one; only these steps (data._flow) are open to them (server/access.js).
const FLOW_KEYS = ['assignedTo', 'version', 'versions', 'reconfirm', 'requests', 'advance', 'signed'];
const keepFlow = (prev, next) => { for (const k of FLOW_KEYS) if (k in prev) next[k] = prev[k]; else delete next[k]; };
const docWord = (rec) => (rec.type === 'quote' ? 'Quotation' : AGREEMENT[rec.data.kind]?.name || 'Agreement');
const agTotal = (a) => { const sub = (Array.isArray(a.lines) ? a.lines : []).reduce((s, x) => s + num(x?.amount), 0); return sub + (a.gst === 'extra' ? Math.round(sub * num(a.gstRate)) / 100 : 0); };
// Who is told about a document's steps: the managers who may change it, and the person who made it.
async function docMakers(t, rec) {
  const titles = rec.type === 'agreement' && rec.data.kind !== 'service' ? ['ops'] : ['ops', 'salesmgr'];
  const ids = (await t.query('select id from users where active and removed_at is null and title = any($1)', [titles])).rows.map((r) => r.id);
  return [...new Set([...ids, rec.created_by].filter(Boolean))];
}
async function tellMakers(t, rec, text, user) { for (const id of await docMakers(t, rec)) await notify(t, id, text, rec.type, rec.id, user, rec.sample); }
const SKIP_DIFF = new Set(['id', 'type', 'number', 'seq', 'fy', 'date', 'kind', 'log', 'status', 'totals', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample', 'sentOn',
  'signedOn', 'signedAt', 'signedBy', 'signedCopy', 'discountApprovedAt', 'discountApprovedBy', 'discountApprovedPct', 'discountRejected', 'clientId', 'quoteId', ...FLOW_KEYS]);
const DIFF_LABEL = { clientName: 'Client', contactName: 'Signs for the client', contactRole: 'Their designation', phone: 'Phone', email: 'Email', address: 'Address', gstin: 'GSTIN',
  subject: 'Subject', validUntil: 'Valid until', items: 'Lines', discountType: 'Discount type', discountValue: 'Discount', taxMode: 'GST', taxRate: 'GST rate %', roundOff: 'Round off',
  showTds: 'TDS note', terms: 'Terms', dealId: 'Deal', projectId: 'Project', seat: 'Address type', title: 'Service', purpose: 'Purpose', scope: 'Scope of work', excluded: 'Not included',
  lines: 'Fees', gst: 'GST', gstRate: 'GST rate %', schedule: 'Payment schedule', recurring: 'Recurring charges', annex: 'Annexure', handover: 'Handover', amc: 'AMC',
  supportUntil: 'Support until', clauses: 'Clauses', coSigner: 'Signs for us', coRole: 'Our signer’s designation', value: 'Value', started: 'Started', delivered: 'Delivered',
  received: 'Received', pending: 'Pending', balanceBy: 'Balance by', co: 'Company' };
const shortVal = (v) => (v === undefined || v === null || v === '' ? '(empty)' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : /^\d{4}-\d\d-\d\d$/.test(v) ? inDate(v) : String(v));
// Rows (quotation lines, fees, the payment schedule…): which row, and what in it – "Line 1 (Website): rate ₹45,000 → ₹40,000".
const ROW = { items: 'Line', lines: 'Fee', schedule: 'Payment', recurring: 'Recurring charge', handover: 'Handover item', annex: 'Annexure item' };
const ROW_KEY = { desc: 'description', text: 'description', note: 'details', qty: 'qty', unit: 'unit', rate: 'rate', amount: 'amount', pct: '%' };
const MONEY_KEY = new Set(['rate', 'amount']);
function rowChanges(k, a, b) {
  const lab = ROW[k] || DIFF_LABEL[k] || k, name = (x) => String(x?.desc ?? x?.text ?? x?.name ?? '').trim().slice(0, 40), out = [];
  const val = (f, v) => (MONEY_KEY.has(f) && v !== '' && v != null && !isNaN(+v) ? inr(+v) : shortVal(v));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i], n = name(y || x), at = `${lab} ${i + 1}${n ? ` (${n})` : ''}`;
    if (!x) { out.push(`${lab} added: ${n || '(new)'}`); continue; }
    if (!y) { out.push(`${lab} removed: ${n || i + 1}`); continue; }
    for (const f of [...new Set([...Object.keys(x), ...Object.keys(y)])]) {
      if (same(x[f] ?? '', y[f] ?? '')) continue;
      const short = (v) => v == null || (['string', 'number', 'boolean'].includes(typeof v) && String(v).length <= 60);
      out.push(short(x[f]) && short(y[f]) ? `${at}: ${ROW_KEY[f] || f} ${val(f, x[f])} → ${val(f, y[f])}` : `${at}: ${ROW_KEY[f] || f} changed`);
    }
  }
  return out.slice(0, 12);
}
// What changed between two versions, in plain words: "Valid until: 31 Oct 2026 → 15 Nov 2026", "Lines changed", "Total ₹40,000 → ₹35,000".
export function docChanges(type, prev, next) {
  const out = [], plain = (v) => v === undefined || v === null || (['string', 'number', 'boolean'].includes(typeof v) && String(v).length <= 60 && !String(v).includes('\n'));
  for (const k of [...new Set([...Object.keys(prev), ...Object.keys(next)])]) {
    if (SKIP_DIFF.has(k) || k.startsWith('_')) continue;
    const a = prev[k], b = next[k]; if (same(a ?? '', b ?? '')) continue;
    const label = DIFF_LABEL[k] || k;
    if ((Array.isArray(a) || a == null) && (Array.isArray(b) || b == null) && [...(a || []), ...(b || [])].every((x) => x && typeof x === 'object')) { out.push(...rowChanges(k, a || [], b || [])); continue; }
    out.push(plain(a) && plain(b) ? `${label}: ${shortVal(a)} → ${shortVal(b)}` : `${label} changed`);
  }
  const was = type === 'quote' ? num(prev.totals?.total) : agTotal(prev), now = type === 'quote' ? num(next.totals?.total) : agTotal(next);
  if (was !== now) out.unshift(`Total ${inr(was)} → ${inr(now)}`);
  return out;
}
// A manager changed a document that is with a BDE: a new version, which the BDE must reconfirm with the client. Asked-for changes count as done.
async function docVersion(t, rec, next, user) {
  const prev = rec.data;
  if (!prev.assignedTo || !['sent', 'changes', 'needs approval'].includes(prev.status)) return;
  const changes = docChanges(rec.type, prev, next); if (!changes.length) return;
  const v = (prev.version || 1) + 1, at = new Date().toISOString(), few = changes.slice(0, 3).join('; ') + (changes.length > 3 ? '…' : '');
  next.version = v; next.versions = [...(prev.versions || []), { v, at, by: user.id, changes: changes.slice(0, 30) }].slice(-40);
  next.reconfirm = true; if (next.status !== 'needs approval') next.status = 'sent';
  next.requests = (prev.requests || []).map((r) => (r.done ? r : { ...r, done: v }));
  log(next, user.id, `Version ${v}: ${few}`);
  await notify(t, prev.assignedTo, `${user.name} changed ${docWord(rec).toLowerCase()} ${prev.number} for ${prev.clientName} – now version ${v}: ${few}. Reconfirm it with the client.`, rec.type, rec.id, user, rec.sample);
}
// One step of the flow (data._flow = { action, … }). Returns true when it was a step: nothing else in the change is kept.
async function docFlow(t, rec, next, user) {
  const f = next._flow; delete next._flow; if (f === undefined) return false;
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw new Rule('Unknown step.');
  const prev = rec.data, me = user.id, word = docWord(rec), no = prev.number, client = prev.clientName, at = new Date().toISOString(), ag = rec.type === 'agreement';
  for (const k of Object.keys(next)) delete next[k]; Object.assign(next, JSON.parse(JSON.stringify(prev)));
  const boss = canEdit(user, ag ? 'agreements' : 'quotes') && (!ag || prev.kind === 'service' || canClose(user)), bde = !!prev.assignedTo && prev.assignedTo === me;
  if (ag ? prev.status === 'signed' : !!prev.signed) throw new Rule(`${word} ${no} is signed and cannot be changed.`);
  const needBoss = () => { if (!boss) throw new Rule('Only the Operations Manager or the Sales Manager can do this.', 403); };
  const needBde = () => { if (!bde && !boss) throw new Rule(`Only the BDE this ${word.toLowerCase()} is given to can do this.`, 403); };
  const ready = () => {
    if (prev.status === 'changes') throw new Rule('The client asked for changes. A manager must change it first.');
    if (prev.status === 'needs approval') throw new Rule('The discount waits for approval first.');
    if (prev.status !== 'sent') throw new Rule(`Give this ${word.toLowerCase()} to a BDE first.`);
    if (prev.reconfirm) throw new Rule(`It was changed to version ${prev.version}. Reconfirm the new version with the client first.`);
  };
  switch (f.action) {
    case 'submit': { // submit and give it to a BDE – or give it to another BDE
      needBoss();
      const u = (await t.query("select id, name from users where id = $1 and active and removed_at is null and title = 'bde'", [String(f.to || '').slice(0, 40)])).rows[0];
      if (!u) throw new Rule('Choose the BDE who takes it to the client.');
      if (prev.status === 'needs approval') throw new Rule('The discount waits for approval. Give it to a BDE after it is approved.');
      if (!['draft', 'sent', 'changes'].includes(prev.status)) throw new Rule(`This ${word.toLowerCase()} is ${prev.status}.`);
      if (u.id === prev.assignedTo) throw new Rule(`It is already with ${u.name}.`);
      const first = !prev.version;
      next.assignedTo = u.id;
      if (first) { next.version = 1; next.versions = [{ v: 1, at, by: me, changes: ['First version'] }]; next.status = 'sent'; next.sentOn ||= today(); next.reconfirm = false; }
      log(next, me, first ? `Submitted and given to ${u.name}` : `Given to ${u.name}`);
      await notify(t, u.id, `${user.name} gave you ${word.toLowerCase()} ${no} for ${client}. Take it to the client.`, rec.type, rec.id, user, rec.sample);
      if (prev.assignedTo) await notify(t, prev.assignedTo, `${word} ${no} for ${client} was given to ${u.name}.`, rec.type, rec.id, user, rec.sample);
      return true;
    }
    case 'changes': { // the client wants something changed: the BDE tells the managers
      if (!bde) throw new Rule(`Only the BDE this ${word.toLowerCase()} is given to can report the client's changes.`, 403);
      if (prev.status !== 'sent') throw new Rule(prev.status === 'changes' ? 'The changes are already with the managers.' : `This ${word.toLowerCase()} is not with you now.`);
      const note = String(f.note || '').trim().slice(0, 1000); if (note.length < 3) throw new Rule('Write what the client wants changed.');
      next.status = 'changes'; next.reconfirm = false; next.requests = [...(prev.requests || []), { at, by: me, v: prev.version || 1, note }].slice(-30);
      log(next, me, `The client asked for changes: ${note.slice(0, 200)}`);
      await tellMakers(t, rec, `${user.name}: ${client} wants changes in ${word.toLowerCase()} ${no} – ${note.slice(0, 200)}`, user);
      return true;
    }
    case 'reconfirmed': { // the client agreed to the new version
      needBde();
      if (prev.status !== 'sent' || !prev.reconfirm) throw new Rule('There is no new version to reconfirm.');
      next.reconfirm = false; log(next, me, `The client agreed to version ${prev.version}`);
      await tellMakers(t, rec, `${user.name}: ${client} agreed to version ${prev.version} of ${word.toLowerCase()} ${no}.`, user);
      return true;
    }
    case 'advance': { // an agreement: the client paid the advance; a manager confirms it
      if (!ag) throw new Rule('Only an agreement takes an advance before signing.');
      needBde(); ready();
      if (prev.advance?.confirmed) throw new Rule('The advance is already confirmed.');
      const amount = round2(num(f.amount)), mode = PAY_MODES.includes(f.mode) ? f.mode : '', date = /^\d{4}-\d\d-\d\d$/.test(f.date || '') && f.date <= today() ? f.date : today();
      if (!(amount > 0)) throw new Rule('Enter the advance received.');
      if (amount > Math.max(agTotal(prev), 1)) throw new Rule(`The advance cannot be more than the total, ${inr(agTotal(prev))}.`);
      if (!mode) throw new Rule('Choose how the client paid.');
      const files = fileList(f.files, me, 4); await ownFiles(t, files, me, 'the payment');
      if (mode !== 'Cash' && !files.length) throw new Rule('Attach a photo or screenshot of the payment.');
      next.advance = { amount, mode, date, reference: String(f.reference || '').trim().slice(0, 80), files, at, by: me };
      log(next, me, `Advance collected: ${inr(amount)} by ${mode}`);
      await tellMakers(t, rec, `${user.name} collected the advance ${inr(amount)} (${mode}) for ${word.toLowerCase()} ${no} – ${client}. Confirm it to make the receipt.`, user);
      return true;
    }
    case 'confirmAdvance': { // a manager confirms the advance: the receipt is made at once (it is not sent to the client)
      needBoss(); const a = prev.advance;
      if (!a || a.confirmed) throw new Rule('No advance waits for confirmation.');
      if (!canSee(user, 'money')) throw new Rule('Receipts are made by the Sales Manager and management.', 403);
      const r = { date: a.date || today(), clientId: prev.clientId || '', dealId: prev.dealId || '', payerName: client, payerPhone: prev.phone || '', payerAddress: prev.address || '',
        payerGstin: prev.gstin || '', items: [{ desc: `Advance – ${prev.title || word} (${no})`, amount: a.amount, incl: true }], taxMode: prev.gst === 'none' ? 'none' : 'intra',
        taxRate: num(prev.gstRate) || 18, balance: 0, mode: a.mode, reference: a.reference || '', against: no, forText: '', agreementId: rec.id };
      await beforeCreate(t, 'receipt', r, user, rec.sample);
      const rid = await insertRec(t, 'receipt', r, user, { sample: rec.sample }); await afterCreate(t, 'receipt', rid, r, user, rec.sample);
      next.advance = { ...a, confirmed: { at, by: me, receiptId: rid, receiptNo: r.number } };
      const deal = prev.dealId ? await getRec(t, prev.dealId, 'deal') : null; // the deal's advance has come: its projects can start
      if (deal && !deal.data.handoff?.advance) { deal.data.handoff = { ...(deal.data.handoff || {}), advance: true, advanceAmt: a.amount }; log(deal.data, me, `Advance received with agreement ${no} (${r.number})`); await putRec(t, deal, user);
        await advanceProjects(t, deal.id, user, 'Advance received – work can start'); }
      log(next, me, `Advance ${inr(a.amount)} confirmed – receipt ${r.number}`);
      await notify(t, a.by, `${user.name} confirmed the advance ${inr(a.amount)} for ${no} (receipt ${r.number}). The client can sign now.`, rec.type, rec.id, user, rec.sample);
      return true;
    }
    case 'rejectAdvance': {
      needBoss(); const a = prev.advance;
      if (!a || a.confirmed) throw new Rule('No advance waits for confirmation.');
      const why = String(f.note || '').trim().slice(0, 300); if (why.length < 3) throw new Rule('Write why the advance is not accepted.');
      delete next.advance; log(next, me, `Advance ${inr(a.amount)} not accepted: ${why}`);
      await notify(t, a.by, `${user.name} did not accept the advance ${inr(a.amount)} for ${no}: ${why}`, rec.type, rec.id, user, rec.sample);
      return true;
    }
    case 'sign': { // the client signs: on the screen, or on paper (the photo of the signed pages is uploaded)
      needBde(); ready();
      if (ag && !prev.advance?.confirmed) throw new Rule('The advance must be collected and confirmed by a manager before the client signs.');
      const how = f.how === 'paper' ? 'paper' : 'screen', name = String(f.name || '').trim().slice(0, 120), role = String(f.role || '').trim().slice(0, 80);
      if (!name) throw new Rule('Enter the name of the person who signs for the client.');
      let signature = '', files = [];
      if (how === 'screen') {
        signature = String(f.signature || '');
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length < 200) throw new Rule('The client must sign in the box.');
        if (signature.length > 400000) throw new Rule('The signature is too large. Clear it and sign again.');
        if (!f.agree) throw new Rule('The client must tick that they agree.');
      } else { files = fileList(f.files, me, 12); if (!files.length) throw new Rule('Attach the photo of every signed page.'); await ownFiles(t, files, me, 'the signed pages'); }
      const v = prev.version || 1, date = today();
      next.signed = { how, name, role, signature, files, at, by: me, v, date };
      log(next, me, `Signed by ${name} for the client (${how === 'paper' ? 'on paper' : 'on screen'}), version ${v}`);
      if (ag) {
        Object.assign(next, { status: 'signed', signedOn: date, contactName: name, signedAt: at, signedBy: me }); if (role) next.contactRole = role;
        if (files.length) next.signedCopy = files[0];
        // The deal's handoff box "Service agreement signed" ticks itself (the deal shows no number or detail of the agreement).
        const deal = prev.kind === 'service' && prev.dealId ? await getRec(t, prev.dealId, 'deal') : null;
        if (deal && !deal.data.handoff?.agreement) { deal.data.handoff = { ...(deal.data.handoff || {}), agreement: true }; log(deal.data, me, 'Service agreement signed'); await putRec(t, deal, user); }
        await tellAgreement(t, ['ops', 'salesmgr', 'cs', 'chairman'], `${word} ${no} with ${client} is signed.`, rec.id, user, rec.sample);
      } else {
        next.status = 'accepted';
        await tellMakers(t, rec, `${client} signed quotation ${no} (${inr(prev.totals?.total)}).`, user);
      }
      return true;
    }
    default: throw new Rule('Unknown step.');
  }
}

export async function beforeUpdate(t, rec, next, user) {
  const type = rec.type, prev = rec.data, me = user?.id || null;
  const reason = next._reason; delete next._reason;
  // The history (log) and a deal's stage history are written only by the server: one sent from the browser is ignored, so nobody can
  // rewrite what happened or add lines in someone else's name (security review 10 Oct 2026).
  if (prev.log === undefined) delete next.log; else next.log = prev.log;
  if (prev.stageHistory === undefined) delete next.stageHistory; else next.stageHistory = prev.stageHistory;
  const note = next._note; delete next._note; if (note) log(next, me, note);
  switch (type) {
    case 'client':
      next.mobile10 = mobile10(next.phone); next.contacts = (Array.isArray(next.contacts) ? next.contacts : []).map((c) => ({ ...c, mobile10: mobile10(c?.phone) }));
      for (const m of phones(next)) if (!phones(prev).includes(m)) await callerCheck(t, user, m, next.name);
      break;
    case 'deal': {
      const split = next._split === true, join = String(next._join || '').slice(0, 40); delete next._split; delete next._join;
      if (split || join) {
        if (!SPLITTERS.includes(user.title)) throw new Rule('Only the Operations Manager or the Company Secretary decides whether services are one deal or separate deals.', 403);
        for (const k of Object.keys(next)) delete next[k]; Object.assign(next, JSON.parse(JSON.stringify(prev))); // a split or a join changes nothing else
        await dealIsBare(t, rec.id, prev.title);
        if (split) { // one deal per service: this deal keeps the first, a new deal is made for each of the others
          const all = svcOf(prev); if (all.length < 2) throw new Rule('This deal has only one service.');
          const rates = await getSetting(t, 'services', DEFAULT_SETTINGS.services), who = prev.clientName || prev.contactName || prev.title;
          for (const x of all.slice(1)) {
            const d = { ...JSON.parse(JSON.stringify(prev)), title: `${x} – ${who}`, service: x, services: [x], value: num((rates || []).find((r) => r.name === x)?.rate),
              stageHistory: [{ stage: prev.stage, at: new Date().toISOString() }], log: [], splitFrom: rec.id };
            for (const k of ['quoteNo', 'quoteId', 'handoff', 'wonAt', 'repeatPending']) delete d[k];
            log(d, me, `Split from ${prev.title}`); await insertRec(t, 'deal', d, user, { sample: rec.sample });
          }
          next.services = [all[0]]; next.service = all[0]; log(next, me, `Split into separate deals: ${all.join(', ')}`);
        } else { // join another deal of the same client into this one
          const o = await getRec(t, join, 'deal');
          if (!o || o.id === rec.id) throw new Rule('Choose the other deal to join.');
          if (!prev.clientId || o.data.clientId !== prev.clientId) throw new Rule('Only deals of the same client can be joined.');
          if (['won', 'lost'].includes(o.data.stage)) throw new Rule('A won or lost deal cannot be joined.');
          await dealIsBare(t, o.id, o.data.title);
          next.services = [...svcOf(prev), ...svcOf(o.data)]; cleanServices(next); next.value = num(prev.value) + num(o.data.value);
          log(next, me, `Joined ${o.data.title} into this deal (${svcOf(o.data).join(', ')})`);
          await t.query('update records set deleted_at = now(), deleted_by = $2, delete_reason = $3 where id = $1', [o.id, me, `Joined into ${prev.title}`]);
        }
        break;
      }
      cleanServices(next);
      next.mobile10 = mobile10(next.phone);
      if (next.mobile10 !== (prev.mobile10 || mobile10(prev.phone))) await callerCheck(t, user, next.phone, next.title);
      if (next.stage !== prev.stage) {
        if (next.stage === 'lost' && !next.lostReason) throw new Rule('Choose why the deal was lost.');
        next.stageHistory = [...(prev.stageHistory || []), { stage: next.stage, at: new Date().toISOString() }];
        if (next.stage === 'won' && !next.wonAt) next.wonAt = today();
        log(next, me, `Moved to ${next.stage}${next.stage === 'lost' ? ` (${next.lostReason})` : ''}`);
      }
      if (next.handoff?.advance && !prev.handoff?.advance) await advanceProjects(t, rec.id, user, 'Advance confirmed on the deal – work can start');
      break;
    }
    case 'project': {
      // Project templates are gone (the user, 17 Oct 2026: IT writes its own tasks). The steps the old templates made and that nobody has
      // taken up can be removed in one go by the IT Manager or the Team Lead.
      const clearTpl = next._clearTemplate === true; delete next._clearTemplate; delete next.templateId;
      if (clearTpl) {
        if (!(user.is_admin || ['itmgr', 'itlead', 'ops'].includes(user.title))) throw new Rule('The IT Manager or the Team Lead removes these tasks.', 403);
        for (const k of Object.keys(next)) delete next[k]; Object.assign(next, JSON.parse(JSON.stringify(prev)));
        const gone = (await t.query("select id, data from records where deleted_at is null and type = 'task' and data->>'projectId' = $1", [rec.id])).rows
          .filter((r) => OLD_TEMPLATE_STEPS.has(r.data.title) && r.data.status === 'todo' && !r.data.owner && !(r.data.people || []).length);
        if (!gone.length) throw new Rule('No template task is left that nobody has taken up.');
        await t.query("update records set deleted_at = now(), deleted_by = $2, delete_reason = 'Old template task removed by IT' where id = any($1)", [gone.map((r) => r.id), me]);
        log(next, me, `${gone.length} old template tasks nobody had taken up were removed`);
        break;
      }
      // Set by the server only: the advance, the deal it came from, the client's sign-off and its time, the progress link (security review).
      for (const k of ['advance', 'dealId', 'signoffId', 'liveAt', 'progressToken']) { if (prev[k] === undefined) delete next[k]; else next[k] = prev[k]; }
      if (next.stage !== prev.stage && WORK.includes(next.stage) && next.dealId && !next.startApproved) {
        const deal = await getRec(t, next.dealId, 'deal');
        if (deal && !deal.data.handoff?.advance) throw new Rule('No advance, no work start. The BDE must record the advance first, or a manager approves an early start.');
      }
      if (next.stage === 'live' && prev.stage !== 'live' && !next.signoffId && !next.liveNoSign) throw new Rule("Get the client's sign-off first. It moves the project to Live by itself.");
      if ((next.deadline || '') !== (prev.deadline || '') && prev.deadline) {
        if (!reason) throw new Rule('Give a reason for changing the deadline.');
        log(next, me, `Deadline moved ${next.deadline < prev.deadline ? 'earlier' : 'later'}: ${inDate(prev.deadline)} → ${inDate(next.deadline) || 'none'} – ${reason}`);
        for (const to of new Set([next.lead, ...(next.people || [])])) await notify(t, to, `Deadline for ${next.name} moved to ${inDate(next.deadline)}: ${reason}`, 'project', rec.id, user, rec.sample);
      }
      if (next.stage !== prev.stage) log(next, me, `Moved to ${next.stage}`);
      if (next.lead && next.lead !== prev.lead) { log(next, me, 'Project lead set'); await notify(t, next.lead, `You lead the project ${next.name}`, 'project', rec.id, user, rec.sample); }
      if (next.startApproved && !prev.startApproved) { if (!isManager(user)) throw new Rule('Only a manager can approve an early start.'); log(next, me, `Early start approved: ${next.startApproved.reason}`); }
      if (next.liveNoSign && !prev.liveNoSign) { if (!isManager(user)) throw new Rule('Only a manager can allow Live without sign-off.'); log(next, me, `Live without sign-off allowed: ${next.liveNoSign.reason}`); }
      break;
    }
    case 'quote':
      if (await docFlow(t, rec, next, user)) break;
      if (prev.signed) throw new Rule(`Quotation ${prev.number} is signed by the client and cannot be changed. If something is wrong, delete it with a reason and make a new one.`);
      if (prev.number) { next.number = prev.number; next.seq = prev.seq; next.fy = prev.fy; }
      if ('imported' in prev) next.imported = prev.imported; else delete next.imported;
      keepFlow(prev, next);
      // The steps (with the BDE, changes asked, signed = accepted) move only through docFlow; a manager may still mark it declined or expired.
      if (next.status !== prev.status && !['declined', 'expired'].includes(next.status)) next.status = prev.status;
      next.totals = docTotals(next); await quoteApproval(t, next, user, prev, rec.sample);
      if (next._askApproval) { delete next._askApproval; await askDiscount(t, rec.id, next, user, rec.sample); }
      if (next.dealId) { const deal = await getRec(t, next.dealId, 'deal'); if (deal) { deal.data.value = next.totals.total; deal.data.quoteNo = next.number; await putRec(t, deal, user); } }
      await docVersion(t, rec, next, user);
      break;
    case 'invoice': next.number = prev.number; next.seq = prev.seq; if ('imported' in prev) next.imported = prev.imported; else delete next.imported; invoiceParty(next); next.totals = docTotals(next); break;
    case 'receipt':
      if (next.date !== prev.date) throw new Rule(`The date is part of receipt number ${prev.number} and can't change. Delete it with a reason and make a new one.`);
      next.number = prev.number; next.seq = prev.seq; next.totals = receiptTotals(next); break;
    case 'signoff': throw new Rule('A signed certificate cannot be changed.');
    case 'agreement': {
      if (await docFlow(t, rec, next, user)) break;
      // Kept by the server: the kind, the number, the date in the number, who signed – and the history, which only Aali One writes.
      for (const k of ['kind', 'number', 'seq', 'fy', 'date', 'signedAt', 'signedBy', 'signedOn', 'sentOn', 'log', 'imported']) if (k in prev) next[k] = prev[k]; else delete next[k];
      keepFlow(prev, next);
      const word = AGREEMENT[prev.kind].name;
      // A signed agreement is final: only the scanned signed copy can still be added. A mistake is fixed by deleting it with a reason and making a new one.
      if (prev.status === 'signed') {
        const rest = ({ signedCopy, ...x }) => JSON.stringify(x);
        if (rest(next) !== rest(prev)) throw new Rule(`${word} ${prev.number} is signed and cannot be changed. If something is wrong, delete it with a reason and make a new one.`);
        if (next.signedCopy?.id !== prev.signedCopy?.id) log(next, me, next.signedCopy ? 'Signed copy attached' : 'Signed copy removed');
        break;
      }
      next.status = prev.status; // the steps move only through docFlow (given to a BDE, changes asked, signed)
      if (!String(next.clientName || '').trim()) throw new Rule('Enter the client name.');
      await docVersion(t, rec, next, user);
      break;
    }
    case 'pclient': {
      const clean = cleanPclient({ ...prev, ...next });
      if ((await t.query("select 1 from records where deleted_at is null and type = 'pclient' and lower(data->>'name') = lower($1) and id <> $2", [clean.name, rec.id])).rowCount) throw new Rule(`${clean.name} is already a payroll client.`);
      await hrmCodeFree(t, clean.hrmCode, rec.id);
      for (const k of Object.keys(next)) delete next[k];
      Object.assign(next, clean, { log: prev.log }); log(next, me, clean.active !== (prev.active !== false) ? (clean.active ? 'Payroll started again' : 'Payroll stopped') : 'Details or rules changed'); break;
    }
    case 'pemp': {
      const clean = cleanPemp({ ...prev, ...next }, (await getRec(t, prev.pclientId, 'pclient'))?.data.payModel); await pempCodeFree(t, prev.pclientId, clean.code, rec.id);
      for (const k of Object.keys(next)) delete next[k];
      Object.assign(next, clean, { pclientId: prev.pclientId, log: prev.log });
      log(next, me, clean.rate !== (prev.rate || 0) ? `Daily wage ₹${prev.rate || 0} → ₹${clean.rate}` : clean.gross !== prev.gross ? `Gross ₹${prev.gross} → ₹${clean.gross}` : clean.active !== (prev.active !== false) ? (clean.active ? 'Working again' : 'Left') : 'Details changed'); break;
    }
    case 'payee': {
      const clean = cleanPayee({ ...prev, ...next }); await payeeEmailFree(t, clean.email, rec.id);
      for (const k of Object.keys(next)) delete next[k];
      Object.assign(next, clean, { log: prev.log });
      log(next, me, clean.active !== (prev.active !== false) ? (clean.active ? 'Working here again' : 'No longer working here') : 'Details changed'); break;
    }
    case 'salary': {
      const clean = { ...cleanSalary(next), userId: prev.userId, name: prev.name, revisions: prev.revisions || [], log: prev.log };
      for (const k of Object.keys(next)) delete next[k];
      Object.assign(next, clean);
      if (clean.gross !== prev.gross || clean.from !== (prev.from || '')) next.revisions = [...next.revisions, { from: clean.from, gross: clean.gross, at: new Date().toISOString(), by: me }].slice(-60);
      if (clean.gross !== prev.gross) {
        log(next, me, `Gross changed: ₹${prev.gross} → ₹${clean.gross}${clean.from ? ' from ' + monthLabel(clean.from) : ''}`);
        await tellPayroll(t, 'ops', `${user.name} changed the salary of ${prev.name}: ₹${prev.gross} → ₹${clean.gross} a month.`, rec.id, user, rec.sample);
      } else log(next, me, 'Salary sheet changed');
      break;
    }
    case 'loan': {
      const clean = cleanLoan({ ...prev, ...next }), done = (prev.recovered || []).reduce((a, x) => a + (+x.amount || 0), 0);
      if (done && (clean.kind !== prev.kind || clean.from !== prev.from)) throw new Rule('Cutting has already started; the kind and the first month cannot change.');
      if (clean.amount < done) throw new Rule(`₹${done} has already been cut, so the amount cannot be less than that.`);
      const closed = !!next.closed;
      for (const k of Object.keys(next)) delete next[k];
      Object.assign(next, clean, { userId: prev.userId, name: prev.name, recovered: prev.recovered || [], closed, paidOff: !!prev.paidOff && closed, log: prev.log });
      log(next, me, closed !== !!prev.closed ? (closed ? `Stopped${reason ? ': ' + reason : ''}` : 'Cutting started again') : 'Changed'); break;
    }
    case 'payrun': {
      // Kept by the server: what the month is made of. A client may send HR's changes (adj), a new status, the paid date, or a remark.
      const label = (prev.pclientId ? (prev.employer?.name || 'Client') + ' – ' : '') + monthLabel(prev.month), rel = prev.pclientId ? 'clientpay' : 'payroll';
      const want = { status: next.status || prev.status, adj: next.adj, refresh: !!next._refresh, paidOn: next.paidOn, remark: next._remark, sheet: next._attendance, file: txt(next._attendanceFile, 120) };
      for (const k of Object.keys(next)) delete next[k];
      for (const k of ['month', 'pclientId', 'title', 'status', 'adj', 'items', 'totals', 'att', 'rules', 'employer', 'sheet', 'sheetAt', 'sheetBy', 'sheetFile', 'warnMonth', 'remarks', 'log', 'lockedAt', 'lockedBy', 'paidOn', 'paidAt', 'paidBy']) if (k in prev) next[k] = prev[k];
      if (want.sheet !== undefined) { // a client's attendance Excel for the month, while it is a draft
        if (!prev.pclientId) throw new Rule('Aali\'s own payroll reads its attendance from Aali HRM.');
        if (prev.status !== 'draft') throw new Rule(`Payroll for ${label} is locked. Reopen it to change the attendance.`);
        Object.assign(next, { sheet: await readAttendance(t, prev.pclientId, want.sheet), sheetAt: new Date().toISOString(), sheetBy: me, sheetFile: want.file });
        want.refresh = true; log(next, me, `Attendance taken from ${want.file || 'an Excel file'}: ${Object.keys(next.sheet).length} employees`);
      }
      if (want.remark) {
        const text = txt(typeof want.remark === 'object' ? want.remark.text : want.remark, 1000), about = typeof want.remark === 'object' ? txt(want.remark.userId, 40) : '';
        if (!text) throw new Rule('Write the remark.');
        next.remarks = [...(prev.remarks || []), { by: me, at: new Date().toISOString(), text, userId: about }].slice(-300);
        await tellPayroll(t, canEdit(user, 'payroll') ? 'ops' : 'hr', `${user.name} remarked on payroll ${label}: "${text.slice(0, 90)}"`, rec.id, user, rec.sample, rel);
      }
      const adj = want.adj === undefined ? prev.adj || {} : cleanAdj(want.adj), adjChanged = !same(adj, prev.adj || {});
      if (adjChanged && user.title === 'chairman') { // the Chairman stepped in: written in the month's history, and HR and the Operations Manager are told
        const who = Object.keys({ ...adj, ...(prev.adj || {}) }).filter((k) => !same(adj[k] || null, prev.adj?.[k] || null)).map((k) => (prev.items || []).find((i) => i.userId === k)?.name || 'someone');
        log(next, me, `Changed by the Founder & Chairman for ${who.join(', ')}`);
        await tellPayroll(t, 'hr', `${user.name} changed payroll ${label} for ${who.join(', ')}.`, rec.id, user, rec.sample, rel);
      }
      if (prev.status === 'draft') {
        if (!['draft', 'locked'].includes(want.status)) throw new Rule('Lock the payroll first.');
        next.adj = adj;
        if (adjChanged || want.refresh || want.status === 'locked') await buildRun(t, next);
        if (want.status === 'locked') {
          if (!next.items.length) throw new Rule('Nobody is on this payroll yet. Enter the salaries first.');
          const stuck = next.items.filter((i) => i.net < 0 || (!i.days.typed && !i.days.att)).map((i) => i.name);
          if (stuck.length) throw new Rule(`Before locking, fix: ${stuck.join(', ')} – no paid days, or deductions more than the pay.`);
          Object.assign(next, { status: 'locked', lockedAt: new Date().toISOString(), lockedBy: me });
          await cutLoans(t, next, user, true); log(next, me, `Locked: ${next.items.length} people, net ₹${next.totals.net}`);
          await tellPayroll(t, 'ops', `Payroll for ${label} is ready: ${next.items.length} people, net ₹${next.totals.net}. Please review it.`, rec.id, user, rec.sample, rel);
        }
      } else if (prev.status === 'locked') {
        if (adjChanged) throw new Rule(`Payroll for ${label} is locked. Reopen it to make changes.`);
        if (want.status === 'draft') {
          if (String(reason || '').trim().length < 5) throw new Rule('Give a reason (5+ characters) for reopening.');
          next.status = 'draft'; delete next.lockedAt; delete next.lockedBy; await cutLoans(t, next, user, false);
          log(next, me, `Reopened: ${reason}`); await tellPayroll(t, 'ops', `${user.name} reopened payroll ${label}: ${reason}`, rec.id, user, rec.sample, rel);
        } else if (want.status === 'paid') {
          const on = day(want.paidOn); if (!on || on > today()) throw new Rule('Enter the date the salaries were paid (not a future date).');
          Object.assign(next, { status: 'paid', paidOn: on, paidAt: new Date().toISOString(), paidBy: me });
          log(next, me, `Paid on ${on}`); await tellPayroll(t, 'ops', `Salaries for ${label} were paid on ${on}: net ₹${next.totals.net}.`, rec.id, user, rec.sample, rel);
        } else if (want.status !== 'locked') throw new Rule('A locked payroll is either reopened or marked as paid.');
      } else if (want.status !== 'paid' || adjChanged) throw new Rule(`Payroll for ${label} is paid and cannot be changed.`);
      break;
    }
    case 'task':
      if (next.status === 'done' && prev.status !== 'done') {
        next.doneAt = new Date().toISOString();
        if (next.recurrence && next.recurrence !== 'none' && next.due) {
          const copy = { ...next, status: 'todo', due: nextDue(next.due, next.recurrence), doneAt: null, subtasks: (next.subtasks || []).map((s) => ({ ...s, done: false })), comments: [] };
          await insertRec(t, 'task', copy, user, { sample: rec.sample });
        }
      }
      break;
    case 'ticket':
      if (next.status !== prev.status) { log(next, me, `Status: ${next.status}`); if (next.status === 'resolved') next.resolvedAt = new Date().toISOString(); }
      if (next.promised !== prev.promised && prev.promised) { if (!reason) throw new Rule('Give a reason for changing the promised date.'); log(next, me, `Promised date moved to ${next.promised}: ${reason}`); }
      break;
    case 'approval':
      // What the request is about and who asked are fixed once asked (security review 10 Oct 2026).
      for (const k of ['kind', 'relType', 'relId', 'requestedBy', 'reason', 'decidedBy', 'decidedAt']) { if (prev[k] === undefined) delete next[k]; else next[k] = prev[k]; }
      if (next.status !== prev.status) {
        if (prev.status !== 'pending' || !['approved', 'rejected'].includes(next.status)) throw new Rule('This request is already decided.');
        if (!isManager(user)) throw new Rule('Only a manager can decide approvals.', 403);
        if (prev.requestedBy === me) throw new Rule("You can't decide your own request.", 403);
        if (prev.kind === 'discount' && !MANAGEMENT(user)) throw new Rule('A discount above the limit is approved by management: the Operations Manager, the Company Secretary or the Founder & Chairman.', 403);
        next.decidedBy = me; next.decidedAt = new Date().toISOString();
        await applyApproval(t, next, user);
      }
      break;
    case 'lead':
      next.mobile10 = mobile10(next.mobile); // never taken from the browser
      if (next.mobile10 !== prev.mobile10) { if (next.mobile10.length !== 10) throw new Rule('Enter a 10-digit mobile number.'); await callerCheck(t, user, next.mobile, next.company || next.name); }
      if (next.status !== prev.status) log(next, me, `Status: ${next.status}`);
      if ((next.owner || '') !== (prev.owner || '')) await claimForLead(t, rec.id, { ...next, mobile10: mobile10(next.mobile) }, user, rec.sample); // the business moves with the lead
      break;
    case 'prospect': await prospectUpdate(t, rec, next, user); break;
    case 'asset': {
      const boss = user.is_admin || (prev.to === 'it' ? user.title === 'itmgr' : user.title === 'salesmgr'), mineA = prev.owner === me, given = prev.assignee === me;
      const toIt = !!next._toIt; delete next._toIt;
      for (const k of ['clientId', 'clientName', 'to', 'owner', 'team']) next[k] = prev[k];
      // The Sales Manager sends IT work on to the IT Manager, who then gives it to the right person in the IT team.
      if (toIt) {
        if (!boss || prev.to !== 'sales') throw new Rule('Only the Sales Manager or an admin sends these assets to the IT Manager.', 403);
        if (prev.status === 'done') throw new Rule('The work on these assets is already done.');
        Object.assign(next, { to: 'it', assignee: '', status: 'sent' }); log(next, me, 'Sent on to the IT Manager');
        for (const u of (await t.query("select id from users where active and removed_at is null and title = 'itmgr'")).rows)
          await notify(t, u.id, `${user.name} sent you client assets: ${prev.clientName}${prev.what ? ' – ' + prev.what : ''}. Please give them to the right person.`, 'asset', rec.id, user, rec.sample);
        await notify(t, prev.owner, `Your assets for ${prev.clientName} were sent on to the IT Manager.`, 'asset', rec.id, user, rec.sample);
        break;
      }
      if ((next.assignee || '') !== (prev.assignee || '')) {
        if (!boss) throw new Rule(`Only ${prev.to === 'it' ? 'the IT Manager' : 'the Sales Manager'} or an admin gives these assets to a person.`, 403);
        const u = (await t.query('select id, name, team from users where id = $1 and active and removed_at is null', [next.assignee])).rows[0]; if (!u) throw new Rule('Choose a person.');
        if (!user.is_admin && u.team !== (prev.to === 'it' ? 'it' : 'sales')) throw new Rule(prev.to === 'it' ? 'IT assets are given to someone in the IT team.' : 'Choose someone in the Sales team, or send these on to the IT Manager.');
        next.status = 'allotted'; log(next, me, `Given to ${u.name}`);
        await notify(t, u.id, `${user.name} gave you client assets to work on: ${prev.clientName}${prev.what ? ' – ' + prev.what : ''}.`, 'asset', rec.id, user, rec.sample);
        await notify(t, prev.owner, `Your assets for ${prev.clientName} were given to ${u.name}.`, 'asset', rec.id, user, rec.sample);
      }
      if (next.status !== prev.status && next.status !== 'allotted') {
        if (!['sent', 'allotted', 'done'].includes(next.status) || !(boss || given)) throw new Rule('Only the person working on these assets or their manager can change the status.', 403);
        log(next, me, next.status === 'done' ? 'Marked done' : `Status: ${next.status}`);
        if (next.status === 'done') await notify(t, prev.owner, `The work on your assets for ${prev.clientName} is marked done.`, 'asset', rec.id, user, rec.sample);
      }
      const changed = ['files', 'link', 'note', 'what'].some((k) => JSON.stringify(next[k] ?? '') !== JSON.stringify(prev[k] ?? ''));
      if (changed && !(mineA || boss)) throw new Rule('Only the person who uploaded these assets or the manager can change them.', 403);
      if (JSON.stringify(next.files || []) !== JSON.stringify(prev.files || [])) log(next, me, 'Files changed');
      break;
    }
    case 'bill': {
      const mine = prev.owner === me, boss = isTop(user), what = `${prev.number} (${inr(prev.amount)} · ${prev.kind})`, now = new Date().toISOString();
      for (const k of ['owner', 'team', 'number', 'qr', 'approved', 'paid', 'rejected']) { if (prev[k] === undefined) delete next[k]; else next[k] = prev[k]; }
      // The person who submitted it may correct it until management approves it; management is told.
      if (['date', 'amount', 'kind', 'paidTo', 'purpose', 'paidBy', 'clientId', 'clientName', 'files'].some((k) => JSON.stringify(next[k] ?? '') !== JSON.stringify(prev[k] ?? ''))) {
        if (!mine) throw new Rule('Only the person who submitted the bill can change it.', 403);
        if (prev.status !== 'submitted') throw new Rule('This bill is already approved, so it cannot be changed.');
        const b = cleanBill(next); await ownFiles(t, b.files.filter((f) => !(prev.files || []).some((p) => p.id === f.id)), me);
        delete next.clientId; delete next.clientName; Object.assign(next, b); log(next, me, 'Bill changed');
        for (const u of (await t.query('select id from users where active and removed_at is null and title = any($1)', [TOP_TITLES])).rows)
          await notify(t, u.id, `${user.name} changed the bill ${next.number}: ${inr(next.amount)} · ${next.kind} · ${next.paidTo}.`, 'bill', rec.id, user, rec.sample);
      }
      // Management: approve → (pay to the person's UPI QR) → mark paid. A bill can be rejected, with the reason, until it is paid.
      if (next.status !== prev.status) {
        if (!boss) throw new Rule('Only management approves bills and marks them paid.', 403);
        if (mine) throw new Rule('You cannot approve, pay or reject your own bill.', 403);
        if (next.status === 'approved') {
          if (prev.status !== 'submitted') throw new Rule('Only a bill waiting for approval can be approved.');
          next.approved = { by: me, at: now }; log(next, me, 'Approved');
          await notify(t, prev.owner, `${user.name} approved your bill ${what}. It will be paid to your UPI QR code.`, 'bill', rec.id, user, rec.sample);
        } else if (next.status === 'paid') {
          if (prev.status !== 'approved') throw new Rule('Approve the bill before marking it paid.');
          next.paid = { by: me, at: now }; log(next, me, 'Marked paid');
          await notify(t, prev.owner, `${user.name} paid your bill ${what}. Check your UPI app.`, 'bill', rec.id, user, rec.sample);
        } else if (next.status === 'rejected') {
          if (!['submitted', 'approved'].includes(prev.status)) throw new Rule('A paid bill cannot be rejected.');
          const why = String(reason || '').trim(); if (why.length < 5) throw new Rule('Write why the bill is rejected (at least 5 characters).');
          next.rejected = { by: me, at: now, reason: why.slice(0, 300) }; log(next, me, `Rejected: ${why.slice(0, 300)}`);
          await notify(t, prev.owner, `${user.name} rejected your bill ${what}: ${why.slice(0, 200)}`, 'bill', rec.id, user, rec.sample);
        } else throw new Rule('Unknown bill status.');
      }
      break;
    }
    case 'collab':
      if (!canEditCollab(user)) throw new Rule('Only the Operations Manager or Company Secretary can change a collaboration.', 403);
      if (!next.name?.trim()) throw new Rule('Enter the name.'); next.kind = prev.kind;
      if (next.status !== prev.status) log(next, me, `Status: ${next.status}`);
      break;
    case 'report': {
      const mine = prev.owner === me, now = new Date().toISOString();
      if (!canSeeReport(user, prev, !!(await getSetting(t, 'leadSeesReports', false)))) throw new Rule('You cannot open this report.', 403);
      const remark = String(next._remark || '').trim().slice(0, 500), reviewed = !!next._reviewed; delete next._remark; delete next._reviewed;
      for (const k of ['owner', 'team', 'ownerTitle', 'date', 'remarks', 'reviewed', 'submittedAt', 'dayStart', 'dayEnd', 'shareToken']) { if (prev[k] === undefined) delete next[k]; else next[k] = prev[k]; }
      if (mine) { next.entries = cleanEntries(next.entries); if (prev.status !== 'submitted') checkVisits(next.entries); if (next.calls !== undefined) next.calls = cleanCalls(next.calls); }
      for (const k of ['plan', 'blockers']) if (next[k] !== undefined && next[k] !== prev[k]) next[k] = String(next[k] ?? '').slice(0, 2000); // always text
      const edited = ['entries', 'calls', 'plan', 'blockers', 'nums'].some((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(prev[k] ?? null));
      if (edited && !mine) throw new Rule('Only the writer can change a report. Managers can add a remark.', 403);
      if (edited && prev.status === 'submitted') throw new Rule('This report is already submitted. Ask your manager to send it back if it needs a change.');
      if (mine) await applyCalls(t, user, prev.calls || [], next.calls || [], rec.sample);
      if (mine) await leadsFromCalls(t, user, prev.calls || [], next.calls || [], rec.sample); // an interested business becomes a lead // one business, one caller: refuse a call that should not be made, count the rest
      // A client accepted the deal at a visit: the Sales Manager hears it at once, with the BDE's remark.
      if (mine) for (const e of next.entries || []) if (e.visit?.outcome === 'Deal accepted' && (prev.entries || []).find((x) => x.id === e.id)?.visit?.outcome !== 'Deal accepted')
        for (const u of (await t.query("select id from users where active and title = 'salesmgr'")).rows) await notify(t, u.id, `${user.name}: ${e.visit.client} accepted the deal at the client visit.${e.note ? ' ' + e.note.slice(0, 120) : ''}`, 'report', rec.id, user, rec.sample);
      if (next.status !== prev.status) {
        if (next.status === 'submitted') {
          if (!mine) throw new Rule('Only the writer can submit a report.', 403);
          if (!next.entries.length && !(next.calls || []).length) throw new Rule('Add at least one task or call before you submit.');
          if (next.entries.some((e) => e.state === 'running')) throw new Rule('A task is still running. Press Finish on it before you submit.');
          next.submittedAt = now; log(next, me, 'Report submitted');
          next.dayEnd = next.date === today() ? now : next.entries.map((e) => e.end || '').sort().pop() || now; // the day ends at submit
          next.shareToken ||= newKey(); // the report's own link, /daily/<key>, opens without sign-in (the WhatsApp button); kept when it is sent back and submitted again
          for (const to of await reportWatchers(t, next)) await notify(t, to, `${user.name} submitted the daily report for ${inDate(next.date)}.`, 'report', rec.id, user, rec.sample);
          await queueReport(t, { ...next, id: rec.id, sample: rec.sample }, user); // and to management on WhatsApp, once linked (server/whatsapp.js)
        } else if (next.status === 'open') {
          if (!canRunReport(user, prev)) throw new Rule('Only the department manager, the Operations Manager or the Company Secretary can send a report back.', 403);
          if (!remark) throw new Rule('Say what needs to change.');
          delete next.reviewed; delete next.submittedAt; delete next.dayEnd; log(next, me, `Sent back: ${remark}`);
        } else throw new Rule('Unknown report status.');
      }
      if (reviewed) {
        if (mine || !isManager(user)) throw new Rule('Only a manager can mark a report as reviewed.', 403);
        if (next.status !== 'submitted') throw new Rule('The report must be submitted before it is reviewed.');
        next.reviewed = { by: me, at: now }; log(next, me, 'Reviewed');
      }
      if (remark) next.remarks = [...(next.remarks || []), { by: me, at: now, text: remark }];
      if (mine) await setPresence(t, user, next, rec.sample);
      if (!mine && (remark || reviewed)) await notify(t, prev.owner, remark ? `${user.name} on your ${inDate(prev.date)} report: "${remark.slice(0, 80)}"` : `${user.name} reviewed your ${inDate(prev.date)} report.`, 'report', rec.id, user, rec.sample);
      break;
    }
  }
}
export const canDeleteReport = (u, d) => canRunReport(u, d) || (d.owner === u.id && d.status !== 'submitted');
async function applyApproval(t, a, user) {
  // A discount is decided on a quotation; an early start and Live without sign-off on a project. Nothing else can be changed by an approval.
  const target = await getRec(t, a.relId, { discount: 'quote', earlystart: 'project', livenosign: 'project' }[a.kind] || ''); if (!target) return;
  const ok = a.status === 'approved';
  if (a.kind === 'discount') {
    target.data.status = ok ? (target.data.assignedTo ? 'sent' : 'draft') : 'needs approval'; if (ok) { Object.assign(target.data, { discountApprovedAt: new Date().toISOString(), discountApprovedBy: user.id, discountApprovedPct: num(target.data.totals?.discountPct) }); delete target.data.discountRejected; }
    else target.data.discountRejected = a.decisionNote || 'Rejected';
  }
  if (a.kind === 'earlystart' && ok) { target.data.startApproved = { by: user.id, at: today(), reason: a.reason }; if (target.data.stage === 'awaiting') target.data.stage = 'planning'; }
  if (a.kind === 'livenosign' && ok) target.data.liveNoSign = { by: user.id, at: today(), reason: a.reason };
  log(target.data, user.id, `${a.kind} ${a.status}${a.decisionNote ? ': ' + a.decisionNote : ''}`);
  await putRec(t, target, user);
  await notify(t, a.requestedBy, `Your request "${a.reason}" was ${a.status}.`, a.relType, a.relId, user, target.sample);
}

export const NEEDS_REASON = ['quote', 'receipt', 'invoice', 'signoff', 'agreement', 'salary', 'payrun', 'loan', 'payee', 'pclient', 'pemp'];
export const ADMIN_ONLY_DELETE = ['signoff'];
