// Business rules that must hold whoever calls the API: numbering, duplicate checks, auto-assign,
// the advance gate, sign-off before Live, payments updating reminders, approvals, recurring tasks.
import { newId } from './auth.js';
import { docTotals, receiptTotals, fyLabel, dayLabel, mobile10, num, round2 } from '../shared/money.js';
import { MANAGER_TITLES, TOP_TITLES } from '../shared/defaults.js';

export class Rule extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India date
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
const canRunReport = (u, d) => u.is_admin || (d.owner !== u.id && isManager(u) && !TOP_TITLES.includes(u.title) && u.team === d.team);
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
async function getRec(t, id) {
  const r = await t.query('select * from records where id = $1 and deleted_at is null', [id]);
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

// ---------- leads: duplicate check on mobile + service, then assign ----------
async function leadIntake(t, data, user, sample) {
  const m = mobile10(data.mobile);
  if (!data.name?.trim()) throw new Rule('Enter the name.');
  if (m.length !== 10) throw new Rule('Enter a 10-digit mobile number.');
  if (!data.service?.trim()) throw new Rule('Choose the service they want.');
  data.mobile10 = m;
  const force = !!data._new && !!user; delete data._new; // "New requirement" chosen after the repeat-enquiry question
  const matches = (await t.query(`select * from records where deleted_at is null and type in ('lead','deal','client')
    and (data->>'mobile10' = $1 or data->'contacts' @> $2::jsonb) order by updated_at desc`, [m, JSON.stringify([{ mobile10: m }])])).rows;
  const enquiry = { at: new Date().toISOString(), source: data.source || 'Other', message: data.message || '' };
  const open = !force && matches.find((r) => r.data.service === data.service &&
    ((r.type === 'lead' && !['converted', 'junk'].includes(r.data.status)) || (r.type === 'deal' && !['won', 'lost'].includes(r.data.stage))));
  if (open) {
    const d = open.data; d.enquiries = [enquiry, ...(d.enquiries || [])]; d.repeatPending = true;
    log(d, user?.id || null, `Asked again about ${data.service} (${enquiry.source}) – ask the client: earlier enquiry or new requirement?`);
    await putRec(t, open, user);
    await notify(t, d.owner, `${d.name || d.title} asked again about ${data.service}. Ask: earlier enquiry or new requirement?`, open.type, open.id, user, sample);
    return { merged: true, id: open.id, type: open.type };
  }
  const known = matches.find((r) => r.data.owner);
  if (known) { data.owner = data.owner || known.data.owner; data.existingClient = true; data.clientId = known.type === 'client' ? known.id : known.data.clientId || ''; }
  else if (!data.owner) data.owner = await roundRobin(t);
  data.status ||= 'new'; data.score ||= ''; data.enquiries = [enquiry]; data.followUp ||= today();
  log(data, user?.id || null, known ? `Existing client asked about ${data.service}; given to their BDE` : `New enquiry (${enquiry.source}); auto-assigned`);
  return { merged: false };
}
async function roundRobin(t) {
  const bdes = (await t.query("select id from users where active and title = 'bde' order by created_at")).rows.map((r) => r.id);
  if (!bdes.length) return '';
  const rr = await getSetting(t, 'rr', {});
  bdes.sort((a, b) => (rr[a] || '').localeCompare(rr[b] || ''));
  rr[bdes[0]] = new Date().toISOString(); await setSetting(t, 'rr', rr);
  return bdes[0];
}

// ---------- create ----------
export async function beforeCreate(t, type, data, user, sample) {
  const me = user?.id || null;
  switch (type) {
    case 'lead': { const r = await leadIntake(t, data, user, sample); if (r.merged) return r; break; }
    case 'client': if (!data.name?.trim()) throw new Rule('Enter the client name.'); data.mobile10 = mobile10(data.phone);
      data.contacts = (data.contacts || []).map((c) => ({ ...c, mobile10: mobile10(c.phone) })); break;
    case 'deal': if (!data.title?.trim()) throw new Rule('Enter a deal name.'); data.mobile10 = mobile10(data.phone);
      data.stage ||= 'lead'; data.stageHistory = [{ stage: data.stage, at: new Date().toISOString() }]; log(data, me, 'Deal created'); break;
    case 'quote': {
      const fy = fyLabel(data.date || today()), b = await brandSetting(t);
      data.seq = await counter(t, 'quote:' + fy); data.fy = fy;
      data.number = `${b.quotePrefix || 'AC'}/${fy}/${String(data.seq).padStart(3, '0')}`;
      data.totals = docTotals(data); data.status ||= 'draft';
      await quoteApproval(t, data, user, null, sample); break;
    }
    case 'invoice': {
      const fy = fyLabel(data.date || today()), b = await brandSetting(t);
      data.seq = await counter(t, 'invoice:' + fy); data.number = `${b.invoicePrefix || 'AI'}/${fy}/${String(data.seq).padStart(3, '0')}`;
      data.totals = docTotals(data); data.status ||= 'issued'; break;
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
    case 'ticket': if (!data.title?.trim()) throw new Rule('Describe the problem.');
      data.number = 'T-' + String(await counter(t, 'ticket')).padStart(4, '0'); data.status ||= 'open'; log(data, me, 'Support request opened'); break;
    case 'project': data.stage ||= 'planning'; data.progressToken ||= newId(''); log(data, me, 'Project created'); break;
    case 'task': if (!data.title?.trim()) throw new Rule('Enter the task.'); data.status ||= 'todo'; break;
    case 'payment': if (!data.title?.trim()) throw new Rule('Enter what the payment is for.'); data.status ||= 'open'; data.paid ||= 0; data.baseAmount ??= num(data.amount); break;
    case 'approval': data.status = 'pending'; data.requestedBy = me; break;
    case 'report': {
      if (!user) throw new Rule('Please sign in.', 401);
      if (NO_REPORT_TITLES.includes(user.title)) throw new Rule('Top management does not write a daily report.');
      data.owner = me; data.team = user.team; data.ownerTitle = user.title; data.date ||= today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || data.date > today()) throw new Rule('A report cannot be for a future date.');
      if (data.date < addDays(today(), -3) && !user.is_admin) throw new Rule('You can fill a report for the last 3 days only.');
      const ex = (await t.query("select id from records where deleted_at is null and type = 'report' and data->>'owner' = $1 and data->>'date' = $2", [me, data.date])).rows[0];
      if (ex) return { merged: true, id: ex.id, type: 'report' }; // one report per person per day
      data.status = 'open'; data.entries = cleanEntries(data.entries);
      for (const k of ['remarks', 'reviewed', 'submittedAt', 'log']) delete data[k];
      break;
    }
  }
  return { merged: false };
}
const cleanEntries = (list) => (Array.isArray(list) ? list : []).filter((e) => String(e?.text || '').trim()).slice(0, 100).map((e) => ({
  id: e.id || newId('e_'), at: e.at || new Date().toISOString(), text: String(e.text).trim().slice(0, 500),
  ...(e.refId ? { refId: e.refId, refLabel: String(e.refLabel || '').slice(0, 120), refLink: String(e.refLink || '').slice(0, 120) } : {}) }));
// Who is told when a report is submitted: the department manager; for a manager's own report, the Ops Manager and Company Secretary.
async function reportWatchers(t, d) {
  const us = (await t.query('select id, title, team from users where active and id <> $1', [d.owner])).rows;
  const mgr = us.filter((u) => MANAGER_TITLES.includes(u.title) && !TOP_TITLES.includes(u.title) && u.team === d.team);
  return (mgr.length ? mgr : us.filter((u) => ['ops', 'cs'].includes(u.title))).map((u) => u.id);
}

async function quoteApproval(t, q, user, prev, sample) {
  const limit = num(await getSetting(t, 'discountApprovalPct', 10));
  const over = q.totals.discountPct > limit;
  if (over && !isManager(user) && !q.discountApprovedAt) {
    q.status = 'needs approval';
    if (!prev || prev.status !== 'needs approval') q._askApproval = true;
  } else if (over && isManager(user) && !q.discountApprovedAt) { q.discountApprovedAt = new Date().toISOString(); q.discountApprovedBy = user.id; }
}

export async function afterCreate(t, type, id, data, user, sample) {
  const me = user?.id || null;
  if (type === 'quote' && data._askApproval) {
    delete data._askApproval; await t.query('update records set data = $2 where id = $1', [id, JSON.stringify(data)]);
    await insertRec(t, 'approval', { kind: 'discount', relType: 'quote', relId: id, status: 'pending', requestedBy: me,
      reason: `Discount ${data.totals.discountPct}% on ${data.number}` }, user, { sample });
  }
  if ((type === 'quote' || type === 'invoice') && data.dealId) {
    const deal = await getRec(t, data.dealId);
    if (deal && type === 'quote') { deal.data.quoteNo = data.number; deal.data.quoteId = id; deal.data.value = data.totals.total; log(deal.data, me, `Quotation ${data.number} made (${data.totals.total})`); await putRec(t, deal, user); }
  }
  if (type === 'receipt') await applyReceipt(t, id, data, user);
  if (type === 'signoff') {
    const p = await getRec(t, data.projectId);
    if (p) { const go = p.data.stage !== 'live'; p.data.signoffId = id; if (go) { p.data.stage = 'live'; p.data.liveAt = today(); }
      log(p.data, me, `Client sign-off by ${data.signerName} (${data.certNo})${go ? ' – moved to Live' : ''}`); await putRec(t, p, user); }
  }
  if (type === 'comment') for (const to of data.mentions || []) await notify(t, to, `${user?.name || 'Someone'} mentioned you: "${String(data.text).slice(0, 80)}"`, data.relType, data.relId, user, sample);
  if (type === 'lead' || type === 'task' || type === 'ticket') { const to = data.owner; if (to) await notify(t, to, `New ${type === 'lead' ? 'lead' : type === 'ticket' ? 'support request' : 'task'}: ${data.name || data.title}`, type, id, user, sample); }
  if (type === 'approval') { const mgrs = (await t.query(`select id from users where active and (is_admin or title = any($1))`, [['salesmgr', 'itmgr', 'ops']])).rows;
    for (const m of mgrs) await notify(t, m.id, `Approval needed: ${data.reason}`, 'approval', id, user, sample); }
}

// A receipt settles its payment reminder; an advance unlocks the project.
async function applyReceipt(t, id, r, user) {
  if (!r.paymentId) return;
  const p = await getRec(t, r.paymentId); if (!p) return;
  const d = p.data, got = r.totals.received;
  d.receipts = [{ id, number: r.number, at: r.date, amount: got }, ...(d.receipts || [])];
  d.paid = round2(num(d.paid) + got);
  if (d.paid + 0.5 >= num(d.amount) && num(d.amount) > 0) {
    if (d.repeat && d.repeat !== 'none') { d.due = nextDue(d.due, d.repeat); d.paid = 0; d.amount = num(d.baseAmount) || num(d.amount); log(d, user?.id, `Paid in full (${r.number}); next due ${d.due}`); }
    else { d.status = 'paid'; d.paidAt = r.date; log(d, user?.id, `Paid in full (${r.number})`); }
  } else log(d, user?.id, `Part payment ${got} (${r.number}); balance ${round2(num(d.amount) - d.paid)}`);
  await putRec(t, p, user);
  if (d.kind === 'advance' && d.dealId) {
    const deal = await getRec(t, d.dealId);
    if (deal) { deal.data.handoff = { ...(deal.data.handoff || {}), advance: true, advanceAmt: got }; log(deal.data, user?.id, `Advance received (${r.number})`); await putRec(t, deal, user); }
    const pr = (await t.query("select * from records where deleted_at is null and type = 'project' and data->>'dealId' = $1", [d.dealId])).rows[0];
    if (pr) { if (pr.data.stage === 'awaiting') pr.data.stage = 'planning'; log(pr.data, user?.id, 'Advance received – work can start'); await putRec(t, pr, user);
      await notify(t, pr.data.lead || '', `Advance received for ${pr.data.name}. Work can start.`, 'project', pr.id, user, pr.sample); }
  }
}

// ---------- update ----------
export async function beforeUpdate(t, rec, next, user) {
  const type = rec.type, prev = rec.data, me = user?.id || null;
  const reason = next._reason; delete next._reason;
  const note = next._note; delete next._note; if (note) log(next, me, note);
  switch (type) {
    case 'deal':
      next.mobile10 = mobile10(next.phone);
      if (next.stage !== prev.stage) {
        if (next.stage === 'lost' && !next.lostReason) throw new Rule('Choose why the deal was lost.');
        next.stageHistory = [...(prev.stageHistory || []), { stage: next.stage, at: new Date().toISOString() }];
        if (next.stage === 'won' && !next.wonAt) next.wonAt = today();
        log(next, me, `Moved to ${next.stage}${next.stage === 'lost' ? ` (${next.lostReason})` : ''}`);
      }
      if (next.handoff?.advance && !prev.handoff?.advance) {
        const pr = (await t.query("select * from records where deleted_at is null and type = 'project' and data->>'dealId' = $1", [rec.id])).rows[0];
        if (pr && pr.data.stage === 'awaiting') { pr.data.stage = 'planning'; log(pr.data, me, 'Advance confirmed on the deal – work can start'); await putRec(t, pr, user); }
      }
      break;
    case 'project': {
      if (next.stage !== prev.stage && WORK.includes(next.stage) && next.dealId && !next.startApproved) {
        const deal = await getRec(t, next.dealId);
        if (deal && !deal.data.handoff?.advance) throw new Rule('No advance, no work start. The BDE must record the advance first, or a manager approves an early start.');
      }
      if (next.stage === 'live' && prev.stage !== 'live' && !next.signoffId && !next.liveNoSign) throw new Rule("Get the client's sign-off first. It moves the project to Live by itself.");
      if ((next.deadline || '') !== (prev.deadline || '') && prev.deadline) {
        if (!reason) throw new Rule('Give a reason for changing the deadline.');
        log(next, me, `Deadline moved ${next.deadline < prev.deadline ? 'earlier' : 'later'}: ${prev.deadline} → ${next.deadline || 'none'} – ${reason}`);
        for (const to of new Set([next.lead, ...(next.people || [])])) await notify(t, to, `Deadline for ${next.name} moved to ${next.deadline}: ${reason}`, 'project', rec.id, user, rec.sample);
      }
      if (next.stage !== prev.stage) log(next, me, `Moved to ${next.stage}`);
      if (next.lead && next.lead !== prev.lead) { log(next, me, 'Project lead set'); await notify(t, next.lead, `You lead the project ${next.name}`, 'project', rec.id, user, rec.sample); }
      if (next.startApproved && !prev.startApproved) { if (!isManager(user)) throw new Rule('Only a manager can approve an early start.'); log(next, me, `Early start approved: ${next.startApproved.reason}`); }
      if (next.liveNoSign && !prev.liveNoSign) { if (!isManager(user)) throw new Rule('Only a manager can allow Live without sign-off.'); log(next, me, `Live without sign-off allowed: ${next.liveNoSign.reason}`); }
      break;
    }
    case 'quote':
      if (prev.number) { next.number = prev.number; next.seq = prev.seq; next.fy = prev.fy; }
      next.totals = docTotals(next); await quoteApproval(t, next, user, prev, rec.sample);
      if (next._askApproval) { delete next._askApproval; await insertRec(t, 'approval', { kind: 'discount', relType: 'quote', relId: rec.id, status: 'pending', requestedBy: me, reason: `Discount ${next.totals.discountPct}% on ${next.number}` }, user, { sample: rec.sample }); }
      if (next.dealId) { const deal = await getRec(t, next.dealId); if (deal) { deal.data.value = next.totals.total; deal.data.quoteNo = next.number; await putRec(t, deal, user); } }
      break;
    case 'invoice': next.number = prev.number; next.seq = prev.seq; next.totals = docTotals(next); break;
    case 'receipt':
      if (next.date !== prev.date) throw new Rule(`The date is part of receipt number ${prev.number} and can't change. Delete it with a reason and make a new one.`);
      next.number = prev.number; next.seq = prev.seq; next.totals = receiptTotals(next); break;
    case 'signoff': throw new Rule('A signed certificate cannot be changed.');
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
      if (next.status !== prev.status) {
        if (!isManager(user)) throw new Rule('Only a manager can decide approvals.', 403);
        next.decidedBy = me; next.decidedAt = new Date().toISOString();
        await applyApproval(t, next, user);
      }
      break;
    case 'lead':
      if (next.status !== prev.status) log(next, me, `Status: ${next.status}`);
      break;
    case 'report': {
      const mine = prev.owner === me, now = new Date().toISOString();
      if (!canSeeReport(user, prev, !!(await getSetting(t, 'leadSeesReports', false)))) throw new Rule('You cannot open this report.', 403);
      const remark = String(next._remark || '').trim().slice(0, 500), reviewed = !!next._reviewed; delete next._remark; delete next._reviewed;
      for (const k of ['owner', 'team', 'ownerTitle', 'date', 'remarks', 'reviewed', 'submittedAt']) { if (prev[k] === undefined) delete next[k]; else next[k] = prev[k]; }
      if (mine) next.entries = cleanEntries(next.entries);
      const edited = ['entries', 'plan', 'blockers', 'nums'].some((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(prev[k] ?? null));
      if (edited && !mine) throw new Rule('Only the writer can change a report. Managers can add a remark.', 403);
      if (edited && prev.status === 'submitted') throw new Rule('This report is already submitted. Ask your manager to send it back if it needs a change.');
      if (next.status !== prev.status) {
        if (next.status === 'submitted') {
          if (!mine) throw new Rule('Only the writer can submit a report.', 403);
          if (!next.entries.length) throw new Rule('Add at least one line of work before you submit.');
          next.submittedAt = now; log(next, me, 'Report submitted');
          for (const to of await reportWatchers(t, next)) await notify(t, to, `${user.name} submitted the daily report for ${next.date}.`, 'report', rec.id, user, rec.sample);
        } else if (next.status === 'open') {
          if (!canRunReport(user, prev)) throw new Rule('Only the department manager, the Operations Manager or the Company Secretary can send a report back.', 403);
          if (!remark) throw new Rule('Say what needs to change.');
          delete next.reviewed; delete next.submittedAt; log(next, me, `Sent back: ${remark}`);
        } else throw new Rule('Unknown report status.');
      }
      if (reviewed) {
        if (mine || !isManager(user)) throw new Rule('Only a manager can mark a report as reviewed.', 403);
        if (next.status !== 'submitted') throw new Rule('The report must be submitted before it is reviewed.');
        next.reviewed = { by: me, at: now }; log(next, me, 'Reviewed');
      }
      if (remark) next.remarks = [...(next.remarks || []), { by: me, at: now, text: remark }];
      if (!mine && (remark || reviewed)) await notify(t, prev.owner, remark ? `${user.name} on your ${prev.date} report: "${remark.slice(0, 80)}"` : `${user.name} reviewed your ${prev.date} report.`, 'report', rec.id, user, rec.sample);
      break;
    }
  }
}
export const canDeleteReport = (u, d) => canRunReport(u, d) || (d.owner === u.id && d.status !== 'submitted');
async function applyApproval(t, a, user) {
  const target = await getRec(t, a.relId); if (!target) return;
  const ok = a.status === 'approved';
  if (a.kind === 'discount') {
    target.data.status = ok ? 'draft' : 'needs approval'; if (ok) { target.data.discountApprovedAt = new Date().toISOString(); target.data.discountApprovedBy = user.id; }
    else target.data.discountRejected = a.decisionNote || 'Rejected';
  }
  if (a.kind === 'earlystart' && ok) { target.data.startApproved = { by: user.id, at: today(), reason: a.reason }; if (target.data.stage === 'awaiting') target.data.stage = 'planning'; }
  if (a.kind === 'livenosign' && ok) target.data.liveNoSign = { by: user.id, at: today(), reason: a.reason };
  log(target.data, user.id, `${a.kind} ${a.status}${a.decisionNote ? ': ' + a.decisionNote : ''}`);
  await putRec(t, target, user);
  await notify(t, a.requestedBy, `Your request "${a.reason}" was ${a.status}.`, a.relType, a.relId, user, target.sample);
}

export const NEEDS_REASON = ['quote', 'receipt', 'invoice', 'signoff'];
export const ADMIN_ONLY_DELETE = ['signoff'];
