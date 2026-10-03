// One business, one caller. Every number the sales team calls is kept here once (record type 'prospect'), with who holds it,
// how many times it was called and how it answered. Before anyone calls or logs a number, it is checked against this register,
// so two people never chase the same business and nobody keeps ringing a business that said no.
import { mobile10 } from '../shared/money.js';
import { DEFAULT_SETTINGS, MANAGER_TITLES } from '../shared/defaults.js';
import { Rule, notify, insertRec } from './logic.js';

const STOP = new Set(['sri', 'shri', 'sree', 'the', 'ms', 'pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company', 'and', 'inc']);
// "Sri Sai Medicals Pvt. Ltd." and "sai medicals" are the same name.
export const nameKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w)).join('');
export const placeKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const UNANSWERED = ['No answer', 'Busy', 'Not reachable'];
const CLOSES = { 'Not interested': 'Said not interested', 'Wrong number': 'Wrong number' };
export const DNC_RESP = 'Asked not to call';
const KEEP = 40; // calls remembered per number; older ones are only counted

const isManager = (u) => u.is_admin || MANAGER_TITLES.includes(u.title);
const first = (n) => String(n || '').split(' ')[0];
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
const note = (d, by, text) => { d.log = [{ at: new Date().toISOString(), by, text }, ...(d.log || [])].slice(0, 60); };
const put = (t, rec, user) => t.query('update records set data = $2, updated_by = $3, updated_at = now() where id = $1', [rec.id, JSON.stringify(rec.data), user?.id || null]);
const byPhone = async (t, m) => (await t.query("select * from records where deleted_at is null and type = 'prospect' and data->>'phone10' = $1 limit 1", [m])).rows[0] || null;
async function rules(t) { const r = await t.query("select value from settings where key = 'calling'"); return { ...DEFAULT_SETTINGS.calling, ...(r.rows[0]?.value || {}) }; }
// Unanswered calls in a row, counted from the latest call back. A manager's "reopen" starts the count again:
// resetN is how many calls had been made by then (a count, not a time, so a wrong clock on someone's phone cannot upset it).
const trailing = (d) => { let n = 0; const h = d.calls || []; for (let i = h.length - 1; i >= 0; i--) { if (!UNANSWERED.includes(h[i].resp) || (d.older || 0) + i < (d.resetN || 0)) break; n++; } return n; };
function refresh(d, cfg) {
  const h = d.calls || [], last = h.at(-1);
  d.tries = (d.older || 0) + h.length; d.lastAt = last?.at || ''; d.lastBy = last?.by || ''; d.lastResp = last?.resp || '';
  d.nameKey = nameKey(d.name); d.placeKey = placeKey(d.place); d.noTries = trailing(d);
  d.backOn = last?.resp === 'Call back' && last.back ? last.back : ''; // the day this business asked to be called again; the next call clears it
  d.state = d.dnc ? 'dnc' : d.closed ? 'closed' : d.noTries >= cfg.maxTries ? 'tired' : 'open';
  return d;
}
const blank = (m, c) => ({ phone10: m, phone: String(c.phone || m).trim().slice(0, 40), name: String(c.org || '').trim().slice(0, 120), place: String(c.place || '').trim().slice(0, 60), ind: String(c.ind || '').slice(0, 60), src: String(c.src || '').slice(0, 40), owner: '', since: '', calls: [], log: [] });

// items: [{ phone, org, place, ind, dupOk }] → one answer each: may this person call (or log) this number?
// claim: keep the free numbers for this person straight away, so a second person checking a minute later is told.
export async function checkCalls(t, user, items, { claim = false, sample = false } = {}) {
  const cfg = await rules(t), now = Date.now(), mgr = isManager(user);
  const phones = [...new Set(items.map((i) => mobile10(i.phone)).filter((m) => m.length === 10))], keys = [...new Set(items.map((i) => nameKey(i.org)).filter((k) => k.length >= 3))];
  const pros = (await t.query("select * from records where deleted_at is null and type = 'prospect' and (data->>'phone10' = any($1) or data->>'nameKey' = any($2))", [phones.length ? phones : ['-'], keys.length ? keys : ['-']])).rows;
  // Leads, deals and clients are held by their BDE for as long as they are open.
  const held = (await t.query(`select type, data->>'owner' as owner, data->>'mobile10' as m, data->>'status' as status, data->>'stage' as stage from records
    where deleted_at is null and type in ('lead', 'deal', 'client') and data->>'mobile10' = any($1)`, [phones.length ? phones : ['-']])).rows;
  const users = new Map((await t.query('select id, name, active from users')).rows.map((u) => [u.id, u])), who = (id) => users.get(id)?.name || 'a former colleague';
  const out = [];
  for (const it of items) {
    const m = mobile10(it.phone), biz = String(it.org || '').trim() || 'This number';
    if (m.length !== 10) { out.push({ ok: false, kind: 'nophone', msg: `Enter the contact number for ${biz} (10 digits; add the STD code for a landline).` }); continue; }
    let rec = pros.find((r) => r.data.phone10 === m); const d = rec?.data, name = d?.name || biz;
    if (d?.dnc) { out.push({ ok: false, kind: 'dnc', id: rec.id, msg: `Do not call. ${name} is on the Do Not Call list since ${dmy(d.dnc.at)} (${d.dnc.reason}). Nobody may call this number.` }); continue; }
    const rel = held.find((h) => h.m === m && h.owner && h.owner !== user.id && users.get(h.owner)?.active && (h.type === 'client' || (h.type === 'lead' && !['converted', 'junk'].includes(h.status)) || (h.type === 'deal' && h.stage !== 'lost')));
    if (rel && !mgr) { out.push({ ok: false, kind: 'held', by: who(rel.owner), msg: `Do not call. ${name} is already with ${who(rel.owner)} (${rel.type === 'client' ? 'a client' : rel.type === 'deal' ? 'a deal in progress' : 'an open lead'}). Only ${first(who(rel.owner))} may call this business.` }); continue; }
    let kind = 'free', msg = 'Free to call. It is now kept for you.';
    if (d) {
      if (d.closed) { out.push({ ok: false, kind: 'closed', id: rec.id, msg: `Do not call. ${name}: ${d.closed.why.toLowerCase()} on ${dmy(d.closed.at)} (${who(d.closed.by)}). Only the Sales Manager can reopen it.` }); continue; }
      const n = trailing(d);
      if (n >= cfg.maxTries) { out.push({ ok: false, kind: 'tired', id: rec.id, msg: `Stop calling. ${name} was called ${n} times with no answer (last on ${dmy(d.lastAt)}). Only the Sales Manager can allow more calls.` }); continue; }
      const live = !!d.owner && !!users.get(d.owner)?.active && now - Date.parse(d.lastAt || d.since || 0) < (d.tries ? cfg.holdDays : cfg.emptyHoldDays) * 864e5;
      if (live && d.owner !== user.id && !mgr) { out.push({ ok: false, kind: 'held', id: rec.id, by: who(d.owner), msg: `Do not call. ${name} is already with ${who(d.owner)} since ${dmy(d.since)}${d.lastAt ? ` (last call ${dmy(d.lastAt)}: ${d.lastResp || 'no response written'})` : ''}. Only ${first(who(d.owner))} may call this business.` }); continue; }
      const left = cfg.maxTries - n, history = d.tries ? `Called ${d.tries} time${d.tries === 1 ? '' : 's'} so far, last on ${dmy(d.lastAt)}: ${d.lastResp || 'no response written'}.` : 'Not called yet.';
      if (d.owner === user.id) { kind = 'mine'; msg = `Yours since ${dmy(d.since)}. ${history}${n ? ` ${left} more unanswered ${left === 1 ? 'try' : 'tries'} allowed.` : ''}`; }
      else if (live) { kind = 'manager'; msg = `With ${who(d.owner)}. ${history} As a manager you may call; it stays with ${first(who(d.owner))}.`; }
      else { kind = 'takeover'; msg = `Free to call – ${d.owner ? `${who(d.owner)}'s hold has ended` : 'nobody holds it'}. ${history}${n ? ` ${left} more unanswered ${left === 1 ? 'try' : 'tries'} allowed.` : ''}`; }
    } else {
      // A new number: does the name look like a business someone else already has?
      const k = nameKey(it.org), pk = placeKey(it.place), sim = k.length >= 3 ? pros.filter((r) => r.data.nameKey === k && r.data.owner !== user.id) : [];
      const same = sim.find((r) => !pk || !r.data.placeKey || r.data.placeKey === pk);
      if (same && !it.dupOk) { out.push({ ok: false, kind: 'similar', msg: `Check first: "${same.data.name}"${same.data.place ? ' in ' + same.data.place : ''} is already ${same.data.dnc ? 'on the Do Not Call list' : same.data.owner ? 'with ' + who(same.data.owner) : 'in the call register'} under another number. Call only if this is a different business.` }); continue; }
      const branch = !same && sim.find((r) => it.ind && r.data.ind === it.ind);
      if (rel && mgr) { kind = 'manager'; msg = `With ${who(rel.owner)}. As a manager you may call; it stays with ${first(who(rel.owner))}.`; }
      else if (branch) msg += ` Note: "${branch.data.name}" in ${branch.data.place || 'another place'} is ${branch.data.owner ? 'with ' + who(branch.data.owner) : 'in the register'} – this may be a branch.`;
    }
    if (claim && (kind === 'free' || kind === 'takeover')) {
      const at = new Date().toISOString();
      if (rec) { Object.assign(d, { owner: user.id, since: at }); if (!d.name && it.org) d.name = String(it.org).trim().slice(0, 120); if (!d.src && it.src) d.src = String(it.src).slice(0, 40); note(d, user.id, 'Taken over (the earlier hold had ended)'); refresh(d, cfg); await put(t, rec, user); }
      else { const nd = refresh({ ...blank(m, it), owner: user.id, since: at, log: [{ at, by: user.id, text: 'Kept before calling' }] }, cfg); const id = await insertRec(t, 'prospect', nd, user, { sample }); rec = { id, data: nd }; pros.push(rec); }
    }
    out.push({ ok: true, kind, id: rec?.id, msg });
  }
  return out;
}

async function logCall(t, user, c, cfg, sample, take) {
  const m = mobile10(c.phone); if (m.length !== 10) return;
  const rec = await byPhone(t, m), at = c.at || new Date().toISOString(), d = rec ? rec.data : blank(m, c);
  if ((d.calls || []).some((x) => x.row === c.id)) return; // already counted
  if (!d.name) d.name = String(c.org || '').trim().slice(0, 120);
  if (!d.place && c.place) d.place = String(c.place).trim().slice(0, 60);
  if (!d.ind && c.ind) d.ind = String(c.ind).slice(0, 60);
  if (!d.src && c.src) d.src = String(c.src).slice(0, 40);
  if ((take || !d.owner) && d.owner !== user.id) { note(d, user.id, d.owner ? 'Taken over (the earlier hold had ended)' : 'First call'); d.owner = user.id; d.since = at; }
  d.calls = [...(d.calls || []), { row: c.id, at, by: user.id, resp: c.resp || '', ...(c.back ? { back: c.back } : {}) }].sort((a, b) => a.at.localeCompare(b.at));
  if (d.calls.length > KEEP) { d.older = (d.older || 0) + d.calls.length - KEEP; d.calls = d.calls.slice(-KEEP); }
  if (c.resp === DNC_RESP && !d.dnc) { d.dnc = { at, by: user.id, reason: 'Asked on the call not to be called' }; note(d, user.id, 'Put on the Do Not Call list: asked on the call not to be called'); }
  if (CLOSES[c.resp]) { d.closed = { at, by: user.id, why: CLOSES[c.resp], row: c.id }; note(d, user.id, `${CLOSES[c.resp]} – no more calls`); }
  refresh(d, cfg);
  if (rec) return put(t, rec, user);
  await insertRec(t, 'prospect', d, user, { sample });
  if (c.dupOk) for (const u of (await t.query("select id from users where active and title = 'salesmgr'")).rows)
    await notify(t, u.id, `${user.name} added ${d.name} (${d.phone}) although a business with the same name is already in the call register. Please check it is a different business.`, 'prospect', '', user, sample);
}
// A row's response was changed, or the row was removed: keep the register true.
async function fixCall(t, user, c, cfg, removed) {
  const m = mobile10(c.phone), rec = m.length === 10 && await byPhone(t, m); if (!rec) return;
  const d = rec.data, i = (d.calls || []).findIndex((x) => x.row === c.id); if (i < 0) return;
  if (d.closed?.row === c.id) delete d.closed;
  if (removed) d.calls.splice(i, 1);
  else { d.calls[i].resp = c.resp || ''; if (c.back) d.calls[i].back = c.back; else delete d.calls[i].back; if (CLOSES[c.resp]) d.closed = { at: d.calls[i].at, by: user.id, why: CLOSES[c.resp], row: c.id };
    if (c.resp === DNC_RESP && !d.dnc) { d.dnc = { at: new Date().toISOString(), by: user.id, reason: 'Asked on the call not to be called' }; note(d, user.id, 'Put on the Do Not Call list: asked on the call not to be called'); } }
  refresh(d, cfg); await put(t, rec, user);
}
// Called whenever a daily report's call sheet is saved: refuse a call that should not have been made, then count the new ones.
export async function applyCalls(t, user, prev = [], next = [], sample = false) {
  const before = new Map(prev.map((c) => [c.id, c])), moved = (c) => before.has(c.id) && mobile10(before.get(c.id).phone) !== mobile10(c.phone);
  const fresh = next.filter((c) => !before.has(c.id) || moved(c)), gone = prev.filter((c) => !next.some((n) => n.id === c.id) || moved(next.find((n) => n.id === c.id)));
  const changed = next.filter((c) => before.has(c.id) && !moved(c) && (before.get(c.id).resp || '') !== (c.resp || ''));
  if (!fresh.length && !gone.length && !changed.length) return;
  const cfg = await rules(t), verdicts = fresh.length ? await checkCalls(t, user, fresh) : [], bad = verdicts.find((v) => !v.ok);
  if (bad) throw new Rule(bad.msg, 409);
  for (const c of gone) await fixCall(t, user, c, cfg, true);
  for (const [i, c] of fresh.entries()) await logCall(t, user, c, cfg, sample, ['free', 'takeover'].includes(verdicts[i].kind));
  for (const c of changed) await fixCall(t, user, c, cfg, false);
}

// The holder of a number, if their hold is still on (used to give an inbound enquiry to the BDE who already speaks to that business).
export async function holderOf(t, m) {
  const rec = await byPhone(t, m), d = rec?.data; if (!d?.owner || d.dnc) return '';
  const cfg = await rules(t), u = (await t.query('select active from users where id = $1', [d.owner])).rows[0];
  return u?.active && Date.now() - Date.parse(d.lastAt || d.since || 0) < (d.tries ? cfg.holdDays : cfg.emptyHoldDays) * 864e5 ? d.owner : '';
}
// A lead was entered: the business now belongs to that lead's BDE, and interest shown reopens a number that had said no.
export async function claimForLead(t, leadId, lead, user, sample) {
  const m = lead.mobile10; if (!m || m.length !== 10 || !lead.owner) return;
  const rec = await byPhone(t, m), cfg = await rules(t), at = new Date().toISOString();
  const d = rec ? rec.data : blank(m, { phone: lead.mobile, org: lead.company || lead.name });
  if (d.owner !== lead.owner) { d.owner = lead.owner; d.since = at; }
  if (d.closed) { delete d.closed; d.resetN = (d.older || 0) + (d.calls || []).length; }
  d.leadId = leadId; note(d, user?.id || null, 'Entered as a lead'); refresh(d, cfg);
  if (rec) await put(t, rec, user); else await insertRec(t, 'prospect', d, user, { sample });
}

// A manager adds a number straight to the Do Not Call list.
export async function prospectCreate(t, data, user) {
  const m = mobile10(data.phone), reason = String(data.reason || '').trim().slice(0, 200), at = new Date().toISOString();
  if (m.length !== 10) throw new Rule('Enter the 10-digit number (add the STD code for a landline).');
  if (reason.length < 3) throw new Rule('Write why this number must not be called.');
  const rec = await byPhone(t, m), cfg = await rules(t), dnc = { at, by: user.id, reason };
  if (rec) { rec.data.dnc = dnc; note(rec.data, user.id, `Put on the Do Not Call list: ${reason}`); refresh(rec.data, cfg); await put(t, rec, user); return { merged: true, id: rec.id, type: 'prospect' }; }
  const d = refresh({ ...blank(m, { phone: data.phone, org: data.name, place: data.place, ind: data.ind }), dnc, log: [{ at, by: user.id, text: `Put on the Do Not Call list: ${reason}` }] }, cfg);
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, d);
  return { merged: false };
}
// Changes from the Call register page. _action: 'dnc' | 'reopen' | 'give' | 'release'. Counts and history are never set by hand.
export async function prospectUpdate(t, rec, next, user) {
  const prev = rec.data, act = next._action, why = String(next._why || '').trim().slice(0, 200), at = new Date().toISOString(), mgr = isManager(user);
  const d = { ...prev, name: String(next.name ?? prev.name).trim().slice(0, 120) || prev.name, place: String(next.place ?? prev.place ?? '').trim().slice(0, 60), ind: String(next.ind ?? prev.ind ?? '').slice(0, 60) };
  if (act === 'dnc') { if (why.length < 3) throw new Rule('Write why this number must not be called.'); d.dnc = { at, by: user.id, reason: why }; note(d, user.id, `Put on the Do Not Call list: ${why}`); }
  else if (act === 'reopen') {
    if (!mgr) throw new Rule('Only the Sales Manager or management can reopen a number.', 403);
    if (why.length < 3) throw new Rule('Write why calls are allowed again.');
    delete d.dnc; delete d.closed; d.resetN = (d.older || 0) + (d.calls || []).length; note(d, user.id, `Reopened – calls allowed again: ${why}`);
  } else if (act === 'give') {
    if (!mgr) throw new Rule('Only the Sales Manager or management can give a business to another person.', 403);
    const u = (await t.query("select id, name from users where id = $1 and active and team = 'sales'", [next.owner])).rows[0]; if (!u) throw new Rule('Choose a person from the Sales team.');
    d.owner = u.id; d.since = at; note(d, user.id, `Given to ${u.name}`); await notify(t, u.id, `${d.name} (${d.phone}) is now yours to call.`, 'prospect', rec.id, user, rec.sample);
  } else if (act === 'release') {
    if (!mgr) throw new Rule('Only the Sales Manager or management can release a business.', 403);
    d.owner = ''; d.since = ''; note(d, user.id, 'Released – the next person who checks it may call');
  } else if (act) throw new Rule('Unknown action.');
  refresh(d, await rules(t));
  for (const k of Object.keys(next)) delete next[k];
  Object.assign(next, d);
}

// Bring the calls written before this register existed into it, oldest first. Safe to run again: a counted call is skipped.
export async function rebuild(t) {
  const cfg = await rules(t), users = new Map((await t.query('select * from users')).rows.map((u) => [u.id, u]));
  const reps = (await t.query("select data, sample from records where deleted_at is null and type = 'report' order by data->>'date', created_at")).rows;
  let n = 0;
  for (const r of reps) { const u = users.get(r.data.owner); if (!u) continue;
    for (const c of r.data.calls || []) { if (mobile10(c.phone).length !== 10) continue; await logCall(t, u, c, cfg, r.sample, false); n++; } }
  const leads = (await t.query("select id, data, sample from records where deleted_at is null and type = 'lead' and data->>'status' not in ('converted', 'junk')")).rows;
  for (const l of leads) if (l.data.owner && !(await byPhone(t, l.data.mobile10 || ''))) { await claimForLead(t, l.id, l.data, null, l.sample); n++; }
  return n;
}
