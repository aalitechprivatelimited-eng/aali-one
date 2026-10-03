// Daily work reports: everyone writes their day as it happens; the department manager and top management watch it live.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore, store, list, create, update, poll, saveSetting, http } from '../api.js';
import { m, AnimatePresence, SPRING, EASE } from '../motion.jsx';
import { Ico } from '../icons.jsx';
import { today, addDays, fmtDate, fmtDT, iso, parse, rel, isManager, isTop, activeUsers, uname, TITLES, TEAMS, inr, waLink, settings, desig, user, mobile10 } from '../lib.js';
import { Tabs, Seg, Pill, Av, Empty, Field, In, Area, Sel, Sample, Stat, DeleteButton, Modal, attempt, toast } from '../ui.jsx';
import { Check } from './Calls.jsx';

// Call sheet: the responses a BDE can pick, and what counts as positive.
const RESP = [['Interested', 'ok'], ['Call back', 'warn'], ['Not interested', ''], ['No answer', ''], ['Busy', ''], ['Not reachable', ''], ['Wrong number', ''], ['Asked not to call', 'bad']];
const respKind = (x) => RESP.find((r) => r[0] === x)?.[1] ?? '';
const callStats = (r) => { const c = r?.calls || []; return { n: c.length, pos: c.filter((x) => x.resp === 'Interested').length, back: c.filter((x) => x.resp === 'Call back').length, meet: c.filter((x) => x.meeting).length, met: c.filter((x) => x.met).length }; };
const callLine = (k) => `${k.n} call${k.n === 1 ? '' : 's'} · ${k.pos} interested · ${k.back} to call back · ${k.meet} meeting${k.meet === 1 ? '' : 's'} fixed · ${k.met} met in person`;
// Turn whatever was typed in Excel ("NOT INTEREST", "follow up tomorrow", "not lifting") into one of our responses.
function guessResp(t) {
  const x = String(t || '').toLowerCase();
  if (!x.trim()) return '';
  if (/do\s*n.?t\s*call|dnd|stop\s*call|harass|complain/.test(x)) return 'Asked not to call';
  if (/wrong/.test(x)) return 'Wrong number';
  if (/not\s*reach|switch/.test(x)) return 'Not reachable';
  if (/busy/.test(x)) return 'Busy';
  if (/not\s*(answer|lift)|no\s*(answer|response)|call cut/.test(x)) return 'No answer';
  if (/^(no|not)$|not\s*int/.test(x.trim())) return 'Not interested';
  if (/follow|call|tomorrow|later|after|next|confirm/.test(x)) return 'Call back';
  if (/int|yes|meet|quot/.test(x)) return 'Interested';
  return '';
}
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtMins = (m) => (!m ? '0 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const typesFor = (team) => settings().workTypes?.[team] || [...new Set(Object.values(settings().workTypes || {}).flat())];
// Minutes per kind of work, biggest first, across one or many reports.
function timeByType(reports) {
  const m = new Map();
  for (const r of reports) for (const e of r?.entries || []) if (e.mins && !e.brk) m.set(e.kind || 'Other', (m.get(e.kind || 'Other') || 0) + e.mins);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { rows, total: rows.reduce((t, x) => t + x[1], 0), count: (k) => reports.reduce((t, r) => t + (r?.entries || []).filter((e) => (e.kind || 'Other') === k && e.mins && !e.brk).length, 0) };
}
function TimeBars({ reports, empty }) {
  const t = timeByType(reports);
  if (!t.total) return empty ? <p className="small muted" style={{ margin: 0 }}>{empty}</p> : null;
  return <div className="stack gap4">{t.rows.map(([k, m]) => <div key={k} className="timerow"><span>{k}</span><div className="bar"><i style={{ width: Math.round(100 * m / t.rows[0][1]) + '%' }} /></div>
    <span className="num">{fmtMins(m)}</span><span className="small muted">{t.count(k)} line{t.count(k) === 1 ? '' : 's'}</span></div>)}
    <div className="timerow" style={{ fontWeight: 700 }}><span>Total time written</span><span /><span className="num">{fmtMins(t.total)}</span><span /></div></div>;
}
// ----- the whole day, start to end: tasks in order, breaks, and the gaps where nothing was recorded -----
const GAP = 10 * 60000; // gaps shorter than 10 minutes are ignored
const hm24 = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function bounds(e) {
  const s = e.start ? new Date(e.start).getTime() : new Date(e.at).getTime() - (e.mins || 0) * 60000;
  return [s, e.state === 'running' ? Date.now() : e.end ? new Date(e.end).getTime() : s + (e.mins || 0) * 60000];
}
function dayLine(r) {
  const es = (r?.entries || []).map((e) => { const [s, en] = bounds(e); return { e, s, en }; }).sort((a, b) => a.s - b.s);
  const open = r?.status !== 'submitted', running = es.some((x) => x.e.state === 'running');
  const ds = r?.dayStart ? new Date(r.dayStart).getTime() : 0, start = ds && es[0] ? Math.min(ds, es[0].s) : ds || es[0]?.s, last = es.reduce((m, x) => Math.max(m, x.en), start || 0);
  const end = r?.dayEnd ? new Date(r.dayEnd).getTime() : open && r?.date === today() ? Date.now() : last;
  const rows = []; let cur = start, idle = 0;
  for (const x of es) { if (x.s - cur >= GAP) { rows.push({ gap: true, s: cur, en: x.s }); idle += x.s - cur; } rows.push(x); cur = Math.max(cur, x.en); }
  if (start && !running && end - cur >= GAP) { rows.push({ gap: true, s: cur, en: end, tail: open }); idle += end - cur; }
  const sum = (f) => Math.round(es.filter(f).reduce((t, x) => t + (x.en - x.s), 0) / 60000);
  return { rows, start, end, open, worked: sum((x) => !x.e.brk), brk: sum((x) => x.e.brk), idle: Math.round(idle / 60000) };
}
function DaySummary({ r, small }) {
  if (!r) return null; const d = dayLine(r); if (!d.start) return null;
  return <div className={'row' + (small ? ' small' : '')}><Pill k="gold">Day {hm(d.start)} – {d.open ? 'still on' : hm(d.end)}</Pill><Pill k="ok">Worked {fmtMins(d.worked)}</Pill>
    {d.brk > 0 && <Pill>Break {fmtMins(d.brk)}</Pill>}<Pill k={d.idle >= 60 ? 'bad' : d.idle ? 'warn' : ''}>Nothing recorded {fmtMins(d.idle)}</Pill></div>;
}
// ----- WhatsApp: the report as a message, one tap per person -----
const fullDate = (d) => parse(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dayText = (d) => `Day ${hm(d.start)} – ${d.open ? 'still on' : hm(d.end)} · Worked ${fmtMins(d.worked)}${d.brk ? ` · Break ${fmtMins(d.brk)}` : ''} · Nothing recorded ${fmtMins(d.idle)}`;
function reportText(r) {
  const u = user(r.owner), d = dayLine(r), t = timeByType([r]);
  const out = [`*Daily report · ${u?.name || ''}* (${desig(u)})`, fullDate(r.date), d.start ? dayText(d) : '', '', '*Tasks*'];
  for (const x of d.rows.slice(0, 30)) out.push(x.gap ? `• ${hm(x.s)}–${hm(x.en)} _Nothing recorded (${fmtMins(Math.round((x.en - x.s) / 60000))})_` : x.e.brk ? `• ${hm(x.s)}–${hm(x.en)} Break` : `• ${hm(x.s)}–${x.e.state === 'running' ? 'now' : hm(x.en)} ${x.e.kind ? x.e.kind + ': ' : ''}${x.e.text}${x.e.visit ? ` [Client: ${x.e.visit.client}, met ${x.e.visit.person}, ${x.e.visit.phone}, ${x.e.visit.place}]` : x.e.proj ? ' [' + x.e.proj + ']' : ''}${x.e.note ? ' – ' + x.e.note : ''} (${fmtMins(Math.round((x.en - x.s) / 60000))}${x.e.state === 'running' ? ', in progress' : ''})`);
  if (t.total) out.push('', '*Time by kind of work*', ...t.rows.map(([k, m]) => `• ${k}: ${fmtMins(m)}`));
  if (r.calls?.length) out.push('', `*Calls:* ${callLine(callStats(r))}`, ...r.calls.filter((c) => ['Interested', 'Call back'].includes(c.resp) || c.met).slice(0, 15).map((c) => `• ${c.org}${c.place ? ', ' + c.place : ''} – ${c.resp}${c.meeting ? ', meeting: ' + c.meeting : ''}${c.note ? ' – ' + c.note : ''}`));
  if (r.blockers?.trim()) out.push('', `*Problems / help needed:* ${r.blockers.trim()}`);
  if (r.plan?.trim()) out.push('', `*Plan for tomorrow:* ${r.plan.trim()}`);
  out.push('', r.status === 'submitted' ? 'Status: submitted' : 'Status: still being written', `Aali One: ${location.origin}/daily`);
  return out.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
}
function teamText(rows, date, label) {
  const got = rows.filter((x) => x.r), t = timeByType(got.map((x) => x.r));
  const out = [`*${label} · daily work report*`, fullDate(date), `${got.filter((x) => x.r.status === 'submitted').length} of ${rows.length} submitted · ${got.filter((x) => x.r.status !== 'submitted').length} still writing · ${rows.length - got.length} not started`, ''];
  for (const { u, r } of rows) { out.push(`*${u.name}* (${desig(u)})`); if (!r) { out.push('No report', ''); continue; } const d = dayLine(r);
    out.push(d.start ? dayText(d) : 'No time recorded', ...(r.calls?.length ? [callLine(callStats(r))] : []), ...timeByType([r]).rows.slice(0, 4).map(([k, m]) => `• ${k}: ${fmtMins(m)}`), ...(r.blockers?.trim() ? [`Problem: ${r.blockers.trim()}`] : []), ''); }
  if (t.total) out.push('*Team time by kind of work*', ...t.rows.map(([k, m]) => `• ${k}: ${fmtMins(m)}`), `Total: ${fmtMins(t.total)}`, '');
  out.push(`Aali One: ${location.origin}/daily`);
  return out.join('\n');
}
const management = (me) => activeUsers().filter((u) => u.id !== me.id && ['ops', 'cs', 'chairman'].includes(u.title));
// WhatsApp sending is for management only.
function WaSend({ text, to, title = 'Send on WhatsApp to' }) {
  if (!isTop(store.me)) return null;
  const ok = to.filter((u) => waLink(u.phone, text)), missing = to.filter((u) => !waLink(u.phone, text));
  return <div className="row small"><span className="lbl">{title}</span>
    {ok.map((u) => <a key={u.id} className="btn wa sm" href={waLink(u.phone, text)} target="_blank" rel="noreferrer">{u.name.split(' ')[0]} · {desig(u)}</a>)}
    <button className="btn sm" type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Report copied. Paste it in any chat or group.'), () => toast('Could not copy.', true))}>Copy the message</button>
    {missing.length > 0 && <span className="muted">No mobile number saved for {missing.map((u) => u.name.split(' ')[0]).join(', ')}.</span>}
    {!to.length && <span className="muted">No management members added yet.</span>}</div>;
}
const reportOf = (uid, date) => list('report').find((r) => r.owner === uid && r.date === date);
const dayOf = (s) => (s ? iso(new Date(s)) : '');
const hm = (s) => new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const ago = (s) => { const m = Math.round((Date.now() - new Date(s)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : fmtDT(s); };
const status = (r) => !r ? ['Not started', ''] : r.status === 'submitted' ? (r.reviewed ? ['Reviewed', 'ok'] : ['Submitted', 'info']) : ['In progress', 'warn'];
const dayName = (d) => d === today() ? 'Today' : d === addDays(today(), -1) ? 'Yesterday' : `${WEEKDAY[parse(d).getDay()]} ${fmtDate(d)}`;
const NO_REPORT = ['chairman', 'ops', 'cs', 'admin']; // top management reads reports, it does not write them
const expected = () => activeUsers().filter((u) => !NO_REPORT.includes(u.title));
const leadOn = (me) => me.title === 'itlead' && !!settings().leadSeesReports;
// Whose reports I look after: my department if I manage one; everyone if I am top management; the developers if I am the IT Team Lead and the switch is on.
const watched = (me) => expected().filter((u) => u.id !== me.id && (leadOn(me) ? u.title === 'dev' : isTop(me) || u.team === me.team));
const canRun = (me, r) => me.isAdmin || (r.owner !== me.id && isManager(me) && !['ops', 'cs', 'chairman'].includes(me.title) && me.team === r.team);

// What Aali One itself recorded for this person on this day.
function autoStats(uid, date) {
  const on = (s) => dayOf(s) === date, out = [];
  const acts = list('activity').filter((a) => a.owner === uid && a.status === 'done' && on(a.at));
  const add = (n, one, many) => n && out.push(`${n} ${n === 1 ? one : many}`);
  const calls = acts.filter((a) => a.kind !== 'meeting'), cm = calls.reduce((t, a) => t + (+a.duration || 0), 0);
  if (calls.length) out.push(`${calls.length} ${calls.length === 1 ? 'call' : 'calls'} logged on leads and deals${cm ? ` (${fmtMins(cm)}, about ${Math.round(cm / calls.length)} min each)` : ''}`);
  add(acts.filter((a) => a.kind === 'meeting').length, 'meeting held', 'meetings held');
  add(list('lead').filter((l) => l.createdBy === uid && on(l.createdAt)).length, 'lead added', 'leads added');
  add(list('quote').filter((q) => q.createdBy === uid && q.date === date).length, 'quotation made', 'quotations made');
  add(list('task').filter((t) => t.owner === uid && t.status === 'done' && on(t.doneAt)).length, 'task finished', 'tasks finished');
  const got = list('receipt').filter((r) => r.createdBy === uid && r.date === date).reduce((s, r) => s + (r.totals?.received || 0), 0);
  if (got) out.push(`${inr(got)} collected`);
  return out;
}

// The department in one box: goes with the manager's own report, so top management reads one page per team.
function TeamSummary({ team, date }) {
  const people = expected().filter((u) => u.team === team && !isManager(u)), rows = people.map((u) => ({ u, r: reportOf(u.id, date) })), rs = rows.map((x) => x.r).filter(Boolean);
  const help = rs.filter((r) => r.blockers?.trim()), tot = rs.reduce((t, r) => { const k = callStats(r); for (const x in k) t[x] += k[x]; return t; }, { n: 0, pos: 0, back: 0, meet: 0, met: 0 });
  return <div className="card stack"><div className="row between"><h3 style={{ margin: 0 }}>{TEAMS[team]} team summary · {dayName(date)}</h3>
    <span className="small muted">{rs.length} present · {people.length - rs.length} not started · {rs.filter((r) => r.status === 'submitted').length} submitted</span></div>
    {team === 'sales' && <div className="row small"><Pill k="gold">Calls made: {tot.n}</Pill><Pill k="ok">Interested: {tot.pos}</Pill><Pill k="warn">Call back: {tot.back}</Pill><Pill k="gold">Meetings fixed: {tot.meet}</Pill><Pill k="gold">Met in person: {tot.met}</Pill></div>}
    <div className="tbl"><table><thead><tr><th>Name</th><th>Attendance</th>{team === 'sales' && <><th className="n">Calls</th><th className="n">Interested</th><th className="n">Call back</th><th className="n">Meetings</th><th className="n">Met</th></>}<th className="n">Worked</th><th className="n">Nothing recorded</th></tr></thead>
      <tbody>{rows.map(({ u, r }) => { const k = callStats(r), d = r ? dayLine(r) : null; return <tr key={u.id}><td><b>{u.name}</b><div className="small muted">{desig(u)}</div></td><td>{r ? <Pill k="ok">Present{d.start ? ' · ' + hm(d.start) : ''}</Pill> : <Pill k="bad">No report</Pill>}</td>
        {team === 'sales' && <><td className="n">{k.n}</td><td className="n">{k.pos}</td><td className="n">{k.back}</td><td className="n">{k.meet}</td><td className="n">{k.met}</td></>}<td className="n">{d ? fmtMins(d.worked) : '—'}</td><td className="n">{d ? fmtMins(d.idle) : '—'}</td></tr>; })}</tbody></table></div>
    <TimeBars reports={rs} empty="The team has not written any timed work for this day yet." />
    {help.length > 0 && <div className="banner bad">{help.map((r) => <div key={r.id}><b>{uname(r.owner)}:</b> {r.blockers}</div>)}</div>}
    <span className="small muted">Filled by itself from the team’s reports. It updates as they write.</span></div>;
}

// ---------- call sheet (sales team) ----------
function CallTable({ calls, onDrop }) {
  if (!calls.length) return <p className="muted small" style={{ margin: 0 }}>No calls written yet.</p>;
  return <div className="tbl"><table><thead><tr><th className="n">#</th><th>Organisation</th><th>Contact no.</th><th>Location</th><th>Response</th><th>Meeting fixed</th><th>Met</th><th>Status / remark</th>{onDrop && <th />}</tr></thead>
    <tbody>{calls.map((c, i) => <tr key={c.id}><td className="n">{i + 1}</td><td><b>{c.org}</b>{c.ind && <div className="small muted">{c.ind}</div>}</td><td className="num">{c.phone || '—'}</td><td>{c.place || '—'}</td><td>{c.resp ? <Pill k={respKind(c.resp)}>{c.resp}</Pill> : '—'}{c.back && <div className="small muted">on {fmtDate(c.back)}</div>}</td>
      <td>{c.meeting || '—'}</td><td>{c.met ? 'Yes' : '—'}</td><td style={{ maxWidth: 260 }}>{c.note || '—'}</td>{onDrop && <td><button className="btn ghost sm" type="button" aria-label={`Remove ${c.org}`} onClick={() => onDrop(c.id)}>Remove</button></td>}</tr>)}</tbody></table></div>;
}
function CallSheet({ r, show, locked, save, dial, setDial, pickId }) {
  const [busy, setBusy] = useState(false), [paste, setPaste] = useState(null), [skipped, setSkipped] = useState([]), [upl, setUpl] = useState(null), [sure, setSure] = useState(false), [drop, setDrop] = useState('');
  const calls = r?.calls || [], k = callStats(r);
  const row = (x) => ({ id: Math.random().toString(36).slice(2, 10), at: new Date().toISOString(), ...x });
  // My calling list: the businesses kept for me that I have not called today – new ones first, then the ones to try again.
  const doneToday = new Set(calls.map((x) => mobile10(x.phone)));
  const kept = !locked && (!r || r.date === today()) ? list('prospect').filter((p) => p.owner === store.me.id && p.state === 'open' && !doneToday.has(p.phone10)) : [];
  const backDue = (p) => !!p.backOn && p.backOn <= today();
  const todo = [...kept.filter(backDue), ...kept.filter((p) => !p.tries), ...kept.filter((p) => p.tries && !backDue(p) && p.lastResp !== 'Interested')];
  // Calls already made and kept in Excel: pasted rows are checked too; the ones another person holds, or that must not be called, are left out and listed.
  async function addPasted() {
    setBusy(true); const good = parsed.filter((x) => mobile10(x.phone).length === 10), none = parsed.length - good.length;
    const res = await attempt(() => http('POST', '/prospects/check', { items: good, claim: true }));
    if (res) { const ok = good.filter((_, i) => res.results[i].ok), no = good.map((x, i) => ({ x, v: res.results[i] })).filter((y) => !y.v.ok), id = Math.random().toString(36).slice(2, 12);
      if (!ok.length || await attempt(() => save({ calls: [...calls, ...ok.map((x) => row({ ...x, paste: id }))] }), `${ok.length} call${ok.length === 1 ? '' : 's'} added.`)) {
        setSkipped([...no.map(({ x, v }) => `${x.org} (${x.phone}) – ${v.msg}`), ...(none ? [`${none} row${none === 1 ? '' : 's'} without a 10-digit number ${none === 1 ? 'was' : 'were'} left out.`] : [])]); setPaste(null); } }
    setBusy(false); setSure(false);
  }
  // Calls added by one paste, so a wrong paste can be taken off the sheet in one go (until the day is submitted).
  const pastes = [...calls.reduce((g, c) => (c.paste ? g.set(c.paste, [...(g.get(c.paste) || []), c]) : g), new Map())];
  const dropPaste = async (id) => { if (await attempt(() => save({ calls: calls.filter((c) => c.paste !== id) }), 'Those pasted calls were removed.')) setDrop(''); };
  // Rows copied from Excel: find the phone number in each row; the organisation is the cell before it, and location, response, meeting, physical meet and status follow it.
  const parsed = (paste || '').split(/\r?\n/).map((l) => l.split('\t').map((x) => x.trim())).map((p) => {
    let i = p.findIndex((x, n) => n > 0 && x.replace(/\D/g, '').length >= 6 && !/[a-z]{3}/i.test(x));
    if (i < 0) { const o = p.findIndex((x) => x && !/^\d{1,3}$/.test(x)); if (o < 0) return null; i = o + 1; }
    const org = p[i - 1], raw = p[i + 2] || '', resp = guessResp(raw), blank = (x) => /^(no|nil|"|-|—)?$/i.test(x || '');
    if (!org || /^(name of|business|company|organi|s\.?\s*no)/i.test(org)) return null;
    return { org, phone: /\d/.test(p[i] || '') ? p[i] : '', place: p[i + 1] || '', resp, meeting: blank(p[i + 3]) ? '' : p[i + 3], met: /^(yes|y|1|met)/i.test(p[i + 4] || ''),
      note: [raw && raw.toLowerCase() !== resp.toLowerCase() ? raw : '', blank(p[i + 5]) ? '' : p[i + 5]].filter(Boolean).join(' · ') };
  }).filter(Boolean), okRows = parsed.filter((x) => mobile10(x.phone).length === 10).length;
  return <>{show && <m.div className="stack" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE }}>
    <div className="row between"><h3 style={{ margin: 0 }}>My calls <span className="small muted">one row for every call</span></h3>
      <div className="row small"><Pill k="gold">Calls made: {k.n}</Pill><Pill k="ok">Interested: {k.pos}</Pill><Pill k="warn">Call back: {k.back}</Pill><Pill k="gold">Meetings fixed: {k.meet}</Pill><Pill k="gold">Met in person: {k.met}</Pill></div></div>
    {!locked && <><div className="row"><button className="btn primary" type="button" style={{ padding: '11px 20px', fontSize: 15 }} onClick={() => setDial(true)}><Ico k="calls" size={16} />Open my calling list{todo.length ? ` · ${todo.length} to call` : ''}</button>
      <button className="btn" type="button" onClick={() => setUpl({ text: '', res: null })}>Upload my list (Excel)</button>
      <button className="btn ghost sm" type="button" onClick={() => setPaste(paste === null ? '' : null)}>{paste === null ? 'Paste calls I already made' : 'Close paste'}</button></div>
      <span className="small muted">Upload the businesses you collected. When you choose “Calling” as the kind of work, your list opens: pick the client you are calling and tap what happened.</span></>}
    {paste !== null && <div className="stack gap4"><span className="small muted">Copy the rows in Excel (organisation, contact no., location, response, meeting, physical meet, status) and paste them here.</span>
      <textarea className="in" style={{ minHeight: 90, fontFamily: 'var(--num)', fontSize: 12 }} value={paste} onChange={(e) => { setPaste(e.target.value); setSure(false); }} placeholder="Paste rows here" />
      {parsed.length > 0 && <><span className="small" style={{ fontWeight: 600 }}>Check the rows – this is how each one was read</span>
        <div className="tbl readback"><table><thead><tr><th>Organisation</th><th>Contact no.</th><th>Location</th><th>Response</th><th>Meeting</th><th>Met</th><th>Remark</th></tr></thead><tbody>
          {parsed.map((x, i) => { const bad = mobile10(x.phone).length !== 10; return <tr key={i} className={bad ? 'dim' : ''}><td><b>{x.org}</b>{bad && <div className="small" style={{ color: 'var(--bad)' }}>No 10-digit number – left out</div>}</td>
            <td className="num">{x.phone || '—'}</td><td>{x.place || <span className="small" style={{ color: 'var(--warn)' }}>no place</span>}</td><td>{x.resp || <span className="small muted">not understood</span>}</td><td>{x.meeting || '—'}</td><td>{x.met ? 'Yes' : '—'}</td><td className="small">{x.note || '—'}</td></tr>; })}</tbody></table></div></>}
      {sure ? <div className="row"><span className="small"><b>Add {okRows} call{okRows === 1 ? '' : 's'} to today's call sheet?</b> Each number is checked first.</span>
        <button className="btn sm" type="button" onClick={() => setSure(false)}>Go back</button><button className="btn primary sm" type="button" disabled={busy} onClick={addPasted}>{busy ? 'Adding…' : 'Yes, add them'}</button></div>
        : <div className="row"><button className="btn primary sm" type="button" disabled={!okRows || busy} onClick={() => setSure(true)}>Add {okRows} call{okRows === 1 ? '' : 's'}</button>
          {parsed.length > okRows && <span className="small muted">{parsed.length - okRows} row{parsed.length - okRows === 1 ? '' : 's'} without a 10-digit number will be left out.</span>}</div>}</div>}
    {skipped.length > 0 && <div className="banner bad"><div className="row between"><b>Not added to your call sheet ({skipped.length}):</b><button className="btn ghost sm" type="button" onClick={() => setSkipped([])}>Hide</button></div>
      <ul className="access">{skipped.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    <CallTable calls={calls} onDrop={!locked && ((id) => attempt(() => save({ calls: calls.filter((x) => x.id !== id) })))} />
    {!locked && pastes.length > 0 && <div className="stack gap4">{pastes.map(([id, rows]) => <div key={id} className="row small">
      <span className="muted">Pasted at {new Date(rows[0].at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}: {rows.length} call{rows.length === 1 ? '' : 's'}</span>
      {drop === id ? <><b>Remove these {rows.length} from today's call sheet?</b><button className="btn ghost sm" type="button" onClick={() => setDrop('')}>No</button><button className="btn danger sm" type="button" onClick={() => dropPaste(id)}>Yes, remove</button></>
        : <button className="btn ghost sm" type="button" onClick={() => setDrop(id)}>Remove this paste</button>}</div>)}</div>}
  </m.div>}
    {upl && <Check chk={upl} setChk={setUpl} />}
    {dial && !locked && <Dialer todo={todo} calls={calls} k={k} row={row} save={save} pickId={pickId} onClose={() => setDial(false)} onUpload={() => { setDial(false); setUpl({ text: '', res: null }); }} />}</>;
}
// The calling window. It opens when "Calling" is chosen as the kind of work: pick the client from my list, call, tap what happened.
const MAIN = ['Interested', 'Call back', 'No answer', 'Not interested'], REST = ['Busy', 'Not reachable', 'Wrong number', 'Asked not to call'];
function Dialer({ todo, calls, k, row, save, onClose, onUpload, pickId }) {
  const none = { meeting: '', met: false, note: '', back: addDays(today(), 1) }, fresh = { org: '', phone: '', place: '', ind: '', src: '', dupOk: false };
  const [q, setQ] = useState(''), [pick, setPick] = useState(() => todo.find((x) => x.id === pickId) || null), [resp, setResp] = useState(''), [d, setD] = useState(none), [rest, setRest] = useState(false), [busy, setBusy] = useState(false);
  const [n, setN] = useState(null), [chk, setChk] = useState(null), [pl, setPl] = useState(''); // n: a number that is not in the list yet; chk: what the call register says about it; pl: a place added during the call
  const text = q.trim().toLowerCase(), shown = todo.filter((p) => !text || `${p.name} ${p.phone} ${p.place} ${p.ind}`.toLowerCase().includes(text));
  // The business as the call register has it, with the place, industry and source just typed when the register has none yet.
  const found = pick && todo.find((x) => x.id === pick.id), p = pick && (found ? { ...found, place: found.place || pick.place || '', ind: found.ind || pick.ind || '', src: found.src || pick.src || '' } : pick);
  const m10 = mobile10(n?.phone), named = (n?.org || '').trim().length >= 3;
  useEffect(() => {
    if (!n || m10.length !== 10 || !named) return setChk(null);
    // Only a look while typing: the number is kept for the person when they press "Use this number", with everything typed by then.
    let live = true; const h = setTimeout(() => http('POST', '/prospects/check', { items: [n] }).then((x) => live && setChk(x.results[0]), () => {}), 600);
    return () => { live = false; clearTimeout(h); };
  }, [m10, named && n?.org.trim(), n?.place, n?.dupOk]);
  const back = () => { setPick(null); setResp(''); setD(none); setRest(false); setPl(''); };
  async function keep() { setBusy(true); const r = await attempt(() => http('POST', '/prospects/check', { items: [n], claim: true })); setBusy(false); const v = r?.results?.[0]; if (!v) return;
    if (!v.ok) return setChk(v); setPick({ id: v.id, name: n.org.trim(), phone: n.phone.trim(), place: n.place.trim(), ind: n.ind, src: n.src, dupOk: n.dupOk, tries: 0 }); setN(null); setChk(null); poll(); }
  async function log(r2) {
    setBusy(true);
    const ok = await attempt(() => save({ calls: [...calls, row({ org: p.name || p.phone, phone: p.phone, place: p.place || pl.trim(), ind: p.ind || '', src: p.src || '', resp: r2, meeting: d.meeting, met: d.met, note: d.note, dupOk: !!p.dupOk, ...(r2 === 'Call back' ? { back: d.back } : {}) })] }), r2 === 'Call back' ? `${p.name || p.phone}: call back on ${fmtDate(d.back)}. It will show on your dashboard that day.` : `${p.name || p.phone}: ${r2}. Written on your call sheet.`);
    setBusy(false); if (ok) back();
  }
  const tap = (x) => (['Interested', 'Call back'].includes(x) ? setResp(x) : log(x)), upN = (key) => (e) => setN({ ...n, [key]: e.target.value });
  return <Modal wide title={p ? p.name || p.phone : n ? 'A number that is not in my list' : 'Who are you calling?'} onClose={onClose} footer={<><span className="small muted">Calls today {k.n} · Interested {k.pos} · Call back {k.back}</span>
    <div className="row">{(p || n) && <button className="btn" type="button" onClick={() => { back(); setN(null); setChk(null); }}>← Back to my list</button>}<button className="btn" type="button" onClick={onClose}>Close</button></div></>}>
    {p ? <div className="stack">
      <div className="row between"><div><div className="small muted">{[p.place, p.ind, p.src].filter(Boolean).join(' · ') || 'No place or industry written'}</div>
        {!p.place && <input className="in" style={{ margin: '6px 0 2px', maxWidth: 260 }} value={pl} onChange={(e) => setPl(e.target.value)} placeholder="Add the place (town or area)" maxLength={60} aria-label="Place of this business" />}
        <div className="small muted">{p.tries ? `Called ${p.tries} time${p.tries === 1 ? '' : 's'} before, last: ${p.lastResp || 'no response written'}` : 'Not called yet'}</div></div>
        <a className="btn primary num" style={{ fontSize: 17, padding: '10px 16px' }} href={'tel:' + p.phone.replace(/[^\d+]/g, '')}>Call {p.phone}</a></div>
      <span className="lbl">After the call – what happened?</span>
      <div className="bigrow">{MAIN.map((x) => <button key={x} type="button" className={'btn big' + (resp === x ? ' primary' : '')} disabled={busy} onClick={() => tap(x)}>{x}</button>)}</div>
      {rest ? <div className="row">{REST.map((x) => <button key={x} type="button" className="chip" disabled={busy} onClick={() => tap(x)}>{x}</button>)}</div>
        : <button className="btn ghost sm" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => setRest(true)}>More: busy, not reachable, wrong number, asked not to call</button>}
      {resp && <div className="stack gap4" style={{ background: 'var(--gold-50)', border: '1px solid var(--line-2)', borderRadius: 10, padding: 10 }}>
        <span className="lbl">{resp} – add the details</span>
        {resp === 'Call back' && <div className="row"><span className="small" style={{ fontWeight: 600 }}>Call back on</span>
          {[[1, 'Tomorrow'], [2, 'In 2 days'], [7, 'Next week']].map(([n, lab]) => <button key={n} type="button" className={'chip' + (d.back === addDays(today(), n) ? ' on' : '')} aria-pressed={d.back === addDays(today(), n)} onClick={() => setD({ ...d, back: addDays(today(), n) })}>{lab}</button>)}
          <input className="in" type="date" style={{ width: 'auto' }} min={today()} value={d.back} onChange={(e) => e.target.value && setD({ ...d, back: e.target.value })} aria-label="Call back on this date" /></div>}
        <input className="in" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder={resp === 'Interested' ? 'What do they want? e.g. quotation for a 5-page website' : 'What did they say? e.g. owner is travelling, call after 4 pm'} maxLength={300} autoFocus />
        <div className="row"><input className="in" style={{ flex: '1 1 200px' }} value={d.meeting} onChange={(e) => setD({ ...d, meeting: e.target.value })} placeholder="Meeting fixed for… (if any)" maxLength={80} />
          <label className="check" style={{ alignItems: 'center' }}><input type="checkbox" style={{ margin: 0 }} checked={d.met} onChange={(e) => setD({ ...d, met: e.target.checked })} /> Met in person</label>
          <button className="btn primary" type="button" disabled={busy} onClick={() => log(resp)}>Save this call</button></div></div>}
    </div> : n ? <div className="stack">
      <div className="row"><input className="in" style={{ flex: '2 1 200px' }} value={n.org} onChange={upN('org')} placeholder="Business / person name" maxLength={120} autoFocus />
        <input className="in" style={{ flex: '1 1 150px' }} value={n.phone} onChange={upN('phone')} placeholder="Contact no. (10 digits)" inputMode="tel" maxLength={40} /></div>
      <div className="row"><input className="in" style={{ flex: '1 1 140px' }} value={n.place} onChange={upN('place')} placeholder="Place" maxLength={60} />
        <Sel value={n.ind} onChange={(v) => setN({ ...n, ind: v })} options={settings().industries || []} blank="Industry" style={{ flex: '1 1 150px', width: 'auto' }} aria-label="Industry" />
        <Sel value={n.src} onChange={(v) => setN({ ...n, src: v })} options={settings().listSources || []} blank="Where did you find it?" style={{ flex: '1 1 170px', width: 'auto' }} aria-label="Source" /></div>
      {chk ? <div className={'banner ' + (chk.ok ? 'ok' : 'bad')}>{chk.ok ? '✓ ' : ''}{chk.msg}
        {chk.kind === 'similar' && <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={n.dupOk} onChange={(e) => setN({ ...n, dupOk: e.target.checked })} /> This is a different business (the Sales Manager is told)</label>}</div>
        : <div className="small muted">{m10.length === 10 && named ? 'Checking the call register…' : 'Type the name and the 10-digit number. The system tells you if you may call it.'}</div>}
      <button className="btn primary" type="button" style={{ alignSelf: 'flex-start' }} disabled={!chk?.ok || busy} onClick={keep}>Use this number</button>
    </div> : <div className="stack">
      <div className="row"><input className="in grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your list: name, number or place" autoFocus />
        <button className="btn" type="button" onClick={() => setN(fresh)}>+ Not in my list</button><button className="btn" type="button" onClick={onUpload}>Upload a list</button></div>
      {shown.length ? <div className="list" style={{ maxHeight: 380, overflow: 'auto' }}>{shown.slice(0, 200).map((x) => <button key={x.id} type="button" className="li" style={{ width: '100%', border: 'none', borderTop: '1px solid var(--line)', background: 'none', textAlign: 'left' }} onClick={() => setPick(x)}>
        <div className="grow"><div className="t">{x.name || 'No name'}</div><div className="small muted">{[x.place, x.ind].filter(Boolean).join(' · ')}{x.tries ? `${x.place || x.ind ? ' · ' : ''}called ${x.tries} time${x.tries === 1 ? '' : 's'}, last: ${x.lastResp || 'no response'}` : ''}</div></div>
        <span className="num">{x.phone}</span>{x.backOn ? <Pill k={x.backOn <= today() ? 'bad' : 'info'}>Call back {rel(x.backOn).toLowerCase()}</Pill> : x.tries ? <Pill k="warn">Try again</Pill> : <Pill k="ok">New</Pill>}</button>)}</div>
        : <Empty>{todo.length ? 'Nothing in your list matches.' : 'Your calling list is empty. Upload the list you collected, or add one number with “+ Not in my list”.'}</Empty>}
      <span className="small muted">Pick the client you are about to call. A business you have already called today leaves the list.</span>
    </div>}
  </Modal>;
}

export default function Daily() {
  useStore(); const me = store.me, boss = isManager(me) || leadOn(me), [tab, setTab] = useState(boss ? 'team' : 'mine'), [, tick] = useState(0);
  // Faster refresh while this page is open, so a manager sees each update within a few seconds.
  useEffect(() => { poll(); const a = setInterval(poll, 4000), b = setInterval(() => tick((n) => n + 1), 20000); return () => { clearInterval(a); clearInterval(b); }; }, []);
  const noReport = NO_REPORT.includes(me.title);
  return <>
    <div className="topbar"><h1>Daily work reports <small>{boss ? (isTop(me) ? 'all departments' : leadOn(me) ? 'developers' : TEAMS[me.team] + ' team') : 'your day, as it happens'}</small></h1>
      <span className="pill ok" title="This page checks for new updates every few seconds">● Live</span></div>
    {boss && !noReport && <Tabs value={tab} onChange={setTab} tabs={[['team', isTop(me) ? 'All reports' : 'My team'], ['mine', 'My report']]} />}
    {boss && (tab === 'team' || noReport) ? <Team /> : <Mine />}
  </>;
}

// ---------- my report ----------
function Mine() {
  const me = store.me, [date, setDate] = useState(today()), r = reportOf(me.id, date);
  const past = [...Array(7)].map((_, i) => addDays(today(), -i));
  return <div className="stack gap16">
    <div><Seg value={date} onChange={setDate} options={[0, -1, -2].map((n) => [addDays(today(), n), dayName(addDays(today(), n))])} /></div>
    <Editor key={date + (r?.id || '')} date={date} r={r} />
    {['salesmgr', 'itmgr'].includes(me.title) && <TeamSummary team={me.team} date={date} />}
    <div className="card"><h3>My last 7 days</h3><div className="row">{past.map((d) => { const x = reportOf(me.id, d), [l, k] = status(x);
      return <button key={d} type="button" className="btn sm" disabled={d < addDays(today(), -2)} onClick={() => setDate(d)} title={l}><span className="num">{fmtDate(d)}</span><Pill k={k}>{l}</Pill></button>; })}</div></div>
  </div>;
}
// What is running right now, with a live clock and one big Finish button.
function NowCard({ e, onFinish }) {
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(h); }, []);
  const sec = Math.max(0, Math.floor((Date.now() - new Date(e.start)) / 1000)), two = (n) => String(n).padStart(2, '0');
  return <m.div className={'nowcard' + (e.out ? ' out' : '')} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
    <span className="pulse" aria-hidden="true" />
    <div className="grow" style={{ minWidth: 200 }}><div className="small muted">{e.out ? 'Out of office' : e.brk ? 'On a break' : 'Working on now'} · since {hm(e.start)}</div>
      <div><b>{e.brk && !e.out ? 'Break' : e.text}</b>{e.kind && !e.brk && <> <Pill k="info">{e.kind}</Pill></>}</div>
      {e.out && <div className="small">Your manager and management see you as Out of office until you press Finish or start your next task.</div>}</div>
    <span className="clock" aria-label="Time so far">{two(Math.floor(sec / 3600))}:{two(Math.floor(sec / 60) % 60)}:{two(sec % 60)}</span>
    {onFinish && <button className="btn primary" type="button" onClick={() => onFinish(e.id)}>■ Finish</button>}
  </m.div>;
}
function Editor({ date, r }) {
  const me = store.me, locked = r?.status === 'submitted', loc = useLocation();
  const [vis, setVis] = useState({ client: '', person: '', phone: '', place: '' }), upV = (k) => (e) => setVis({ ...vis, [k]: e.target.value });
  const [text, setText] = useState(''), [proj, setProj] = useState(''), [busy, setBusy] = useState(false), [mins, setMins] = useState(''), [from, setFrom] = useState('');
  const lastEnd = r ? (r.entries || []).reduce((m, e) => Math.max(m, bounds(e)[1]), r.dayStart ? new Date(r.dayStart).getTime() : 0) : 0, fromV = from || (lastEnd ? hm24(lastEnd) : '');
  const running = r?.entries?.find((e) => e.state === 'running'), onBreak = !!running?.brk;
  const types = typesFor(me.team), [kind, setKind] = useState('');
  const isVisit = /visit/i.test(kind), visitOk = !isVisit || (vis.client.trim() && vis.person.trim() && vis.phone.trim() && vis.place.trim());
  const [dial, setDial] = useState(false), [away, setAway] = useState(false), [perm, setPerm] = useState(null), [late, setLate] = useState(false); // the calling window; "I will be out of the office"; a permission to go out; adding a task that is already over
  const [step, setStep] = useState('day'), sales = me.team === 'sales' && !!r; // the three steps of the report: my day, my calls, finish my day
  const [other, setOther] = useState(''), isOther = /^other$/i.test(kind), kindV = isOther && other.trim() ? `Other – ${other.trim()}` : kind; // "Other" must say what it is
  const ready = text.trim() && kind && visitOk && (!isOther || other.trim()), timed = +mins > 0 && /^\d\d:\d\d$/.test(fromV);
  const [f, setF] = useState({ plan: r?.plan || '', blockers: r?.blockers || '', nums: r?.nums || {} });
  const save = (data) => (r ? update(r.id, data) : create('report', { date, ...data }));
  const dirty = f.plan !== (r?.plan || '') || f.blockers !== (r?.blockers || '') || JSON.stringify(f.nums) !== JSON.stringify(r?.nums || {});
  const blur = () => { if (dirty && !locked) attempt(() => save(f)); };
  // Coming from "Open my calling list" on the dashboard: the calling window opens straight away.
  useEffect(() => { if (loc.state?.dial && sales && !locked && date === today()) { setStep('calls'); setDial(true); } }, []);
  const pickId = loc.state?.pick;
  // Starting a new task (or a break) finishes whatever was running, so nobody has to press Finish in between.
  const closeRunning = (list) => list.map((x) => (x.state === 'running' ? { ...x, state: 'done', end: new Date().toISOString(), mins: Math.max(1, Math.round((Date.now() - new Date(x.start)) / 60000)) } : x));
  // Two ways to add a task: start it now and press Finish later (the app works out the time), or add one already done with its minutes.
  async function add(now) {
    const t = text.trim(); if (!ready || busy || (!now && !timed)) return; setBusy(true);
    const at = new Date().toISOString(), st = now ? 0 : new Date(`${date}T${fromV}:00`).getTime(), m2 = Math.round(+mins);
    const line = { id: Math.random().toString(36).slice(2, 10), at, text: t, kind: kindV, ...(now ? { state: 'running', start: at } : { mins: m2, start: new Date(st).toISOString(), end: new Date(st + m2 * 60000).toISOString() }), ...(isVisit ? { visit: vis, proj: vis.client.trim() } : proj.trim() ? { proj: proj.trim() } : {}), ...(isVisit || (isOther && away) ? { out: true } : {}) };
    if (await attempt(() => save({ ...f, entries: [...(now ? closeRunning(r?.entries || []) : r?.entries || []), line] }), now ? 'Task started. The earlier task is closed.' : 'Task added.')) { setText(''); setMins(''); setFrom(''); setProj(''); setOther(''); setAway(false); setKind(''); setLate(false); setVis({ client: '', person: '', phone: '', place: '' }); }
    setBusy(false);
  }
  const change = (id, fn, ok) => attempt(() => update(r.id, { ...f, entries: r.entries.map((x) => (x.id === id ? fn(x) : x)) }), ok);
  const finish = (id) => change(id, (x) => ({ ...x, state: 'done', end: new Date().toISOString(), mins: Math.max(1, Math.round((Date.now() - new Date(x.start)) / 60000)) }), 'Task finished. Time saved.');
  const fix = (id, m2) => change(id, (x) => { const n = Math.max(1, Math.round(m2)), st = bounds(x)[0]; return { ...x, mins: n, start: new Date(st).toISOString(), end: new Date(st + n * 60000).toISOString() }; }, 'Time corrected.');
  const remark = (id, note) => change(id, (x) => ({ ...x, note }), 'Remark saved.');
  const startBreak = () => { const now = new Date().toISOString(); return attempt(() => save({ ...f, entries: [...closeRunning(r?.entries || []), { id: Math.random().toString(36).slice(2, 10), at: now, text: 'Break', kind: 'Break', brk: true, state: 'running', start: now }] }), 'Break started. Press Finish when you are back.'); };
  const startDay = () => attempt(() => create('report', { date }), 'Your day has started. Add each task as you take it up.');
  // Going out with permission (personal work, bank …): shown to the manager and management as Out of office and not counted as work time.
  const goOut = async () => { const now = new Date().toISOString(), why = perm.trim(); if (why.length < 3) return;
    if (await attempt(() => save({ ...f, entries: [...closeRunning(r?.entries || []), { id: Math.random().toString(36).slice(2, 10), at: now, text: why, kind: 'Out of office', brk: true, out: true, state: 'running', start: now }] }), 'You are shown as Out of office. Press Finish when you are back.')) setPerm(null); };
  // Choosing "Calling" starts the calling time by itself and opens my calling list.
  const pickKind = async (t) => {
    if (me.team !== 'sales' || !/^calling$/i.test(t) || !r || date !== today()) return setKind(kind === t ? '' : t);
    if (!(r.entries || []).some((e) => e.state === 'running' && /^calling$/i.test(e.kind || ''))) { const now = new Date().toISOString();
      await attempt(() => save({ ...f, entries: [...closeRunning(r.entries || []), { id: Math.random().toString(36).slice(2, 10), at: now, text: 'Calling clients from my calling list', kind: t, state: 'running', start: now }] }), 'Calling time started. Pick the client you are calling.'); }
    setKind(''); setStep('calls'); setDial(true); };
  const drop = (id) => attempt(() => update(r.id, { ...f, entries: r.entries.filter((x) => x.id !== id) }));
  const submit = () => attempt(() => update(r.id, { ...f, status: 'submitted' }), 'Report submitted. Your day is closed and your manager has been told.');
  const [l, k] = status(r), auto = autoStats(me.id, date);
  if (!r && date === today()) return <m.div className="card stack" style={{ alignItems: 'center', textAlign: 'center', padding: '44px 24px' }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
    <span className="empty-ic" style={{ width: 60, height: 60 }}><Ico k="clock" size={28} /></span>
    <h2 style={{ margin: 0, fontSize: 24 }}>Ready to start, {me.display || me.name.split(' ')[0]}?</h2>
    <p className="muted" style={{ margin: 0, maxWidth: 460 }}>Press the button when you begin work. Aali One notes the time your day started, and your manager can see you are in.</p>
    <button className="btn primary" type="button" style={{ fontSize: 16, padding: '13px 26px', borderRadius: 14 }} onClick={startDay}><Ico k="play" size={16} />Start my day</button></m.div>;
  const steps = [['day', 'My day'], ...(sales ? [['calls', `My calls${r.calls?.length ? ' · ' + r.calls.length : ''}`]] : []), ['end', locked ? 'End of day' : 'Finish my day']];
  return <div className="card stack">
    <div className="row between"><h2 style={{ margin: 0 }}>{dayName(date)} <span className="small muted">{fmtDate(date)}</span></h2>
      <div className="row"><Pill k={k}>{l}</Pill>{r && <span className="small muted">last saved {ago(r.updatedAt)}</span>}<Sample on={r?.sample} /></div></div>
    {locked && <div className="banner ok">Submitted{r.submittedAt ? ' at ' + hm(r.submittedAt) : ''}. It is locked now. If something must change, ask your manager to send it back.</div>}
    <DaySummary r={r} />
    {(r?.remarks || []).length > 0 && <Remarks r={r} />}
    <div className="steps" role="tablist" aria-label="Parts of my report">{steps.map(([v, lab], i) => <button key={v} type="button" role="tab" aria-selected={step === v} onClick={() => setStep(v)}>
      {step === v && <m.span layoutId="day-step" className="seg-pill" style={{ borderRadius: 11 }} transition={SPRING} />}<span className="n">{i + 1}</span>{lab}</button>)}</div>
    <AnimatePresence mode="wait" initial={false}><m.div key={step} className="stack" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14, transition: { duration: 0.12 } }} transition={{ duration: 0.3, ease: EASE }}>
      {step === 'day' && <>
        {running && <NowCard e={running} onFinish={!locked && finish} />}
        {!locked && <form className="composer" onSubmit={(e) => { e.preventDefault(); add(!(late && timed)); }}>
          <span className="q">{running ? 'What are you starting next?' : 'What are you starting now?'}</span>
          <div className="row" role="group" aria-label="Kind of work">{types.map((t) => <button key={t} type="button" className={'chip' + (kind === t ? ' on' : '')} aria-pressed={kind === t} onClick={() => pickKind(t)}>{t}</button>)}</div>
          <AnimatePresence initial={false}>{kind && <m.div key="task" className="stack" style={{ overflow: 'hidden', padding: 4, margin: -4 }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE }}>
            {isOther && <div className="row"><input className="in" style={{ flex: '1 1 260px', maxWidth: 380 }} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Type the kind of work, e.g. Bank work" maxLength={40} autoFocus aria-label="Type the kind of work" />
              <label className="check" style={{ alignItems: 'center' }}><input type="checkbox" style={{ margin: 0 }} checked={away} onChange={(e) => setAway(e.target.checked)} /> I will be out of the office for this</label></div>}
            <span className="lbl">Write exactly what you are doing</span>
            <div className="row">
              <input className="in" style={{ flex: '3 1 260px' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Editing 6 photos for Hotel Leela Imperial gallery page" autoFocus={!isOther} maxLength={500} />
              {!isVisit && <input className="in" style={{ flex: '1 1 170px' }} value={proj} onChange={(e) => setProj(e.target.value)} placeholder="Client / project" maxLength={120} />}</div>
            {isVisit && <div className="panel stack gap4">
              <span className="lbl">Client visit – who are you visiting? (all four are needed)</span>
              <div className="row"><input className="in" style={{ flex: '2 1 200px' }} value={vis.client} onChange={upV('client')} placeholder="Client / business name" maxLength={120} />
                <input className="in" style={{ flex: '1 1 160px' }} value={vis.person} onChange={upV('person')} placeholder="Person you are meeting" maxLength={80} />
                <input className="in" style={{ flex: '1 1 130px' }} value={vis.phone} onChange={upV('phone')} placeholder="Their contact no." inputMode="tel" maxLength={40} />
                <input className="in" style={{ flex: '1 1 160px' }} value={vis.place} onChange={upV('place')} placeholder="Place / address" maxLength={120} /></div>
              <span className="small muted">In the task box above, write the purpose of the visit. When you are back, press “Add outcome” on the visit to write what was decided.</span></div>}
            {(isVisit || (isOther && away)) && <span className="small muted">While this task runs, your manager and management see you as <b>Out of office</b>.</span>}
            {late && <div className="panel row"><span className="small muted">It started at</span>
              <input className="in" style={{ width: 130 }} type="time" value={fromV} onChange={(e) => setFrom(e.target.value)} aria-label="Time the task started" />
              <span className="small muted">and took</span>
              <input className="in" style={{ width: 110 }} type="number" min="1" max="1440" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} placeholder="Minutes" aria-label="Minutes the task took" /></div>}
            <div className="row">{late ? <button className="btn primary" type="button" disabled={!ready || !timed || busy} onClick={() => add(false)}>Add this finished task</button>
              : <button className="btn primary" type="button" style={{ padding: '11px 20px', fontSize: 15 }} disabled={!ready || busy} onClick={() => add(true)}><Ico k="play" size={15} />Start this task now</button>}
              <button className="btn ghost sm" type="button" onClick={() => setLate(!late)}>{late ? 'No, I am starting it now' : 'I already finished this task'}</button></div>
          </m.div>}</AnimatePresence>
          <div className="quiet"><span className="small muted">Not a task?</span>
            <button className="btn sm" type="button" disabled={busy || onBreak || !r} onClick={startBreak}><Ico k="cup" size={15} />Start a break</button>
            <button className="btn sm" type="button" disabled={busy || !r} aria-expanded={perm !== null} onClick={() => setPerm(perm === null ? '' : null)}><Ico k="door" size={15} />Going out (permission)</button></div>
          {perm !== null && <div className="panel row">
            <input className="in" style={{ flex: '1 1 260px' }} value={perm} onChange={(e) => setPerm(e.target.value)} placeholder="Reason, e.g. personal work, bank, hospital" maxLength={120} autoFocus />
            <button className="btn primary" type="button" disabled={perm.trim().length < 3} onClick={goOut}>I am going out now</button>
            <span className="small muted">Your manager and management will see you as Out of office until you press Finish.</span></div>}
          <span className="small muted">When you start the next task or a break, the earlier one is closed by itself and its time is saved.</span></form>}
        <Entries r={r} onDrop={!locked && drop} onFinish={!locked && finish} onFix={!locked && fix} onNote={!locked && remark} />
        {!locked && r && <div className="row between"><span className="small muted">Done with your work for today?</span><button className="btn" type="button" onClick={() => setStep('end')}>Finish my day →</button></div>}
      </>}
      {step === 'end' && <>
        {r && <div><span className="lbl">Time by kind of work</span><TimeBars reports={[r]} empty="No timed work yet." /></div>}
        {auto.length > 0 && <div className="row small"><span className="lbl">Recorded by Aali One</span>{auto.map((x) => <Pill key={x} k="gold">{x}</Pill>)}</div>}
        <div className="form">
          <Field label="Plan for tomorrow" full><Area disabled={locked} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} onBlur={blur} placeholder="What you will do next" /></Field>
          <Field label="Problems / help needed" full><Area disabled={locked} value={f.blockers} onChange={(e) => setF({ ...f, blockers: e.target.value })} onBlur={blur} placeholder="Anything stopping your work. Leave empty if none." /></Field>
        </div>
        {(r?.entries?.length > 0 || r?.calls?.length > 0) && <WaSend text={reportText(r)} to={activeUsers().filter((u) => u.id !== me.id && (['ops', 'cs', 'chairman'].includes(u.title) || (isManager(u) && u.team === me.team)))} title="Send my report on WhatsApp to" />}
        {!locked && running && <div className="banner">A task is still running. Go to “My day” and press Finish first.</div>}
        {!locked && <div className="row between"><span className="small muted">{dirty ? 'Not saved yet – click outside the box to save.' : r ? 'All changes saved.' : 'Nothing written yet.'}</span>
          <div className="row">{r && <DeleteButton id={r.id} label="Delete report" />}<button className="btn primary" type="button" style={{ padding: '11px 20px', fontSize: 15 }} disabled={!(r?.entries?.length || r?.calls?.length) || !!running} title={running ? 'Finish the running task first' : ''} onClick={submit}><Ico k="check" size={16} />Submit for the day</button></div></div>}
      </>}
    </m.div></AnimatePresence>
    {sales && <CallSheet r={r} show={step === 'calls'} pickId={pickId} locked={locked} save={(data) => update(r.id, { ...f, ...data })} dial={dial} setDial={setDial} />}
  </div>;
}
function Entries({ r, onDrop, onFinish, onFix, onNote }) {
  const [edit, setEdit] = useState(null), [rem, setRem] = useState(null), d = dayLine(r), mark = { padding: '6px 12px', fontSize: 12.5 };
  if (!r || (!d.rows.length && !r.dayStart)) return <p className="muted small" style={{ margin: 0 }}>No tasks yet.</p>;
  return <div className="list">
    {r.dayStart && <div className="li" style={mark}><span className="num muted" style={{ width: 132, flex: 'none' }}>{hm(d.start)}</span><b>Day started</b></div>}
    {d.rows.map((x, i) => { const dur = Math.round((x.en - x.s) / 60000);
      if (x.gap) return <div className="li" key={'g' + i} style={{ ...mark, background: 'var(--bad-bg)', color: 'var(--bad)' }}><span className="num" style={{ width: 132, flex: 'none' }}>{hm(x.s)} – {x.tail ? 'now' : hm(x.en)}</span><span className="grow">Nothing recorded</span><span className="num">{fmtMins(dur)}</span></div>;
      const e = x.e, run = e.state === 'running';
      return <div className="li" key={e.id} style={{ padding: '7px 12px', background: run ? 'var(--warn-bg)' : '' }}>
        <span className="num small muted" style={{ width: 118, flex: 'none' }}>{hm(x.s)} – {run ? 'now' : hm(x.en)}</span>
        <div className="grow">{e.brk ? (e.out ? <><Pill k="warn">Out of office</Pill> {e.text}</> : <Pill>Break</Pill>) : <>{e.kind && <><Pill k="info">{e.kind}</Pill> </>}{e.out && <><Pill k="warn">Out of office</Pill> </>}{e.text}{e.proj && !e.visit && <> <Pill k="gold">{e.proj}</Pill></>}{e.visit && <div className="small"><b>Client:</b> {e.visit.client} · <b>Met:</b> {e.visit.person} · <span className="num">{e.visit.phone}</span> · {e.visit.place}</div>}{e.refId && <> <Link className="pill gold" to={e.refLink || '/'} style={{ textDecoration: 'none' }}>{e.refLabel}</Link></>}</>}
          {rem?.id === e.id ? <div className="row" style={{ marginTop: 4 }}><input className="in grow" value={rem.v} onChange={(ev) => setRem({ id: e.id, v: ev.target.value })} placeholder="Result, issue or remark" maxLength={300} autoFocus /><button className="btn sm" type="button" onClick={() => { onNote(e.id, rem.v.trim()); setRem(null); }}>Save</button></div>
            : e.note ? <div className="small muted">{e.visit ? 'Outcome' : 'Remark'}: {e.note}</div> : null}</div>
        {run ? <><Pill k="warn">{e.out ? 'Out of office' : e.brk ? 'On break' : 'In progress'} · {fmtMins(dur)} so far</Pill>{onFinish && <button className="btn primary sm" type="button" onClick={() => onFinish(e.id)}>■ Finish</button>}</>
          : edit?.id === e.id ? <><input className="in" style={{ width: 80 }} type="number" min="1" max="1440" value={edit.v} onChange={(ev) => setEdit({ id: e.id, v: ev.target.value })} aria-label="Minutes" autoFocus />
              <button className="btn sm" type="button" disabled={!(+edit.v > 0)} onClick={() => { onFix(e.id, +edit.v); setEdit(null); }}>Save</button></>
            : <>{!e.brk && <Pill k="ok">Done</Pill>}<span className="num small" style={{ minWidth: 64, textAlign: 'right' }}>{fmtMins(e.mins || dur)}</span>
              {onFix && <button className="btn ghost sm" type="button" title="Use this if you forgot to press Finish on time" onClick={() => setEdit({ id: e.id, v: e.mins || dur || '' })}>Fix time</button>}</>}
        {onNote && !e.brk && <button className="btn ghost sm" type="button" onClick={() => setRem({ id: e.id, v: e.note || '' })}>{e.visit ? (e.note ? 'Edit outcome' : 'Add outcome') : e.note ? 'Edit remark' : 'Add remark'}</button>}
        {onDrop && <button className="btn ghost sm" type="button" aria-label="Remove this line" onClick={() => onDrop(e.id)}>Remove</button>}</div>; })}
    {r.dayEnd && <div className="li" style={mark}><span className="num muted" style={{ width: 132, flex: 'none' }}>{hm(d.end)}</span><b>Day ended</b></div>}
  </div>;
}
const Remarks = ({ r }) => <div className="stack gap4">{r.remarks.map((x, i) => <div className="comment" key={i}><div className="row between small"><b>{uname(x.by)}</b><span className="faint">{fmtDT(x.at)}</span></div>{x.text}</div>)}</div>;

// ---------- manager and top-management view ----------
function Team() {
  const me = store.me, [date, setDate] = useState(today()), [team, setTeam] = useState('all'), [view, setView] = useState('day'), [open, setOpen] = useState('');
  const people = watched(me).filter((u) => team === 'all' || u.team === team).sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  const rows = people.map((u) => ({ u, r: reportOf(u.id, date) }));
  const n = (f) => rows.filter(f).length;
  const feed = rows.flatMap(({ u, r }) => (r?.entries || []).map((e) => ({ ...e, u }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const help = rows.filter(({ r }) => r?.blockers?.trim());
  return <>
    <div className="row between" style={{ marginBottom: 12 }}>
      <div className="row"><button className="btn sm" type="button" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">←</button>
        <input className="in" type="date" style={{ width: 'auto' }} value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="btn sm" type="button" disabled={date >= today()} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">→</button>
        {date !== today() && <button className="btn sm" type="button" onClick={() => setDate(today())}>Today</button>}<b>{dayName(date)}</b></div>
      <div className="row">{isTop(me) && <Seg value={team} onChange={setTeam} options={[['all', 'All'], ['sales', 'Sales'], ['it', 'IT'], ['management', 'Management']]} />}
        <Seg value={view} onChange={setView} options={[['day', 'Day'], ['week', 'Week']]} /></div></div>
    <div className="stats">
      <Stat label="Submitted" value={n((x) => x.r?.status === 'submitted')} sub={`of ${rows.length} people`} />
      <Stat label="In progress" value={n((x) => x.r?.status === 'open')} tone={n((x) => x.r?.status === 'open') ? 'warm' : ''} />
      <Stat label="Not started" value={n((x) => !x.r)} tone={n((x) => !x.r) ? 'hot' : ''} />
      <Stat label="Waiting for review" value={n((x) => x.r?.status === 'submitted' && !x.r.reviewed)} />
      <Stat label="Need help" value={help.length} tone={help.length ? 'hot' : ''} />
    </div>
    {me.title === 'ops' && <label className="check card" style={{ marginBottom: 12 }}><input type="checkbox" checked={!!settings().leadSeesReports}
      onChange={(e) => attempt(() => saveSetting('leadSeesReports', e.target.checked), e.target.checked ? "On: the IT Team Lead can now read the developers' reports." : "Off: only the IT Manager and top management read the developers' reports.")} />
      <span><b>IT Team Lead can read the developers' daily reports</b><br /><span className="small muted">Off for now. Switch it on when the IT team grows. The Team Lead can read and remark; review and send-back stay with the IT Manager.</span></span></label>}
    {rows.length > 0 && isTop(me) && <div className="card" style={{ marginBottom: 12 }}><WaSend text={teamText(rows, date, team === 'all' ? (isTop(me) ? 'All departments' : TEAMS[me.team] + ' team') : TEAMS[team] + ' team')} to={management(me)} title={`Send the ${dayName(date).toLowerCase()} team report on WhatsApp to`} />
      <span className="small muted">One tap opens WhatsApp with the report typed in; you press send. Sending by itself every evening needs a WhatsApp Business account (Settings → Connections).</span></div>}
    {!rows.length && <Empty>No people in this view. Add people in Settings → People.</Empty>}
    {view === 'week' ? <Week people={people} end={date} pick={(d, id) => { setDate(d); setView('day'); setOpen(id); }} />
      : <div className={isTop(me) ? 'stack gap16' : 'split'}>
        {/* Management sees the departments side by side (Sales | IT); a department manager keeps the single list with the side panel. */}
        <div className={isTop(me) ? 'deptcols' : 'stack gap16'}>{['sales', 'it', 'management'].map((t) => { const g = rows.filter((x) => x.u.team === t); if (!g.length) return null;
          const parts = [['Manager', g.filter((x) => isManager(x.u))], ['Team', g.filter((x) => !isManager(x.u))]].filter((x) => x[1].length), cs = g.reduce((n, x) => n + callStats(x.r).n, 0);
          return <section key={t} className={isTop(me) ? 'deptcol' : ''}><div className="row between" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>{TEAMS[t]} Team</h2>
            <span className="small muted">{g.filter((x) => x.r).length} of {g.length} present · {g.filter((x) => x.r?.status === 'submitted').length} submitted{t === 'sales' ? ` · ${cs} calls` : ''}</span></div>
            {parts.map(([label, list]) => <div key={label} style={{ marginBottom: 10 }}><span className="lbl">{TEAMS[t]} {label}{label === 'Team' ? ` · ${list.length}` : ''}</span>
              <div className="list" style={{ marginTop: 4 }}>{list.map(({ u, r }, i) => <PersonRow key={u.id} u={u} r={r} date={date} first={!i} open={open === u.id} toggle={() => setOpen(open === u.id ? '' : u.id)} />)}</div></div>)}
          </section>; })}</div>
        <div className={isTop(me) ? 'grid3' : 'stack'} style={{ alignItems: 'start' }}>
          <div className="card"><h3>Time by kind of work</h3><TimeBars reports={rows.map((x) => x.r)} empty="No timed work written for this day yet." /></div>
          <div className="card"><h3>Latest updates</h3>{feed.length ? <div className="stack gap4">{feed.map((e) => <div key={e.u.id + e.id} className="small"><span className="num faint">{hm(e.at)}</span> <b>{e.u.name.split(' ')[0]}</b> · {e.brk ? 'Break' : (e.kind ? e.kind + ': ' : '') + e.text}{e.state === 'running' ? ' (in progress)' : e.mins ? ` (${fmtMins(e.mins)})` : ''}</div>)}</div> : <p className="small muted" style={{ margin: 0 }}>Nothing written for this day yet. New lines show here by themselves.</p>}</div>
          {help.length > 0 && <div className="card"><h3>Problems / help needed</h3><div className="stack gap4">{help.map(({ u, r }) => <div key={u.id} className="small"><b>{u.name}</b> · {r.blockers}</div>)}</div></div>}
        </div></div>}
  </>;
}
function PersonRow({ u, r, date, open, toggle, first }) {
  const me = store.me, [l, k] = status(r), cs = callStats(r), out = date === today() && list('presence').find((x) => x.user === u.id && x.out && x.date === date);
  const nudge = waLink(u.phone, `Hi ${u.name.split(' ')[0]}, please update your daily work report for ${fmtDate(date)} in Aali One: ${location.origin}/daily`);
  return <div style={{ borderTop: first ? 'none' : '1px solid var(--line)' }}>
    <button type="button" className="li" onClick={toggle} aria-expanded={open} style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }}>
      <Av id={u.id} /><div className="grow" style={{ minWidth: 150 }}><div className="t">{u.name}</div><div className="small muted">{desig(u)} · {TEAMS[u.team]}{r ? ` · ${r.entries?.length || 0} task${r.entries?.length === 1 ? '' : 's'} · last ${ago(r.updatedAt)}` : ''}</div></div>
      {r && <div style={{ flexBasis: '100%', order: 9, paddingLeft: 38 }}><DaySummary r={r} small /></div>}
      {cs.n > 0 && <span className="small muted"><span className="num">{cs.n}</span> calls · <span className="num">{cs.pos}</span> interested</span>}
      {out && <Pill k="warn">Out of office · {out.why} since {hm(out.since)}</Pill>}{r?.blockers?.trim() && <Pill k="bad">Needs help</Pill>}<Pill k={k}>{l}</Pill><Sample on={r?.sample} /><span className="faint" aria-hidden>{open ? '▾' : '▸'}</span></button>
    {open && <div className="stack" style={{ padding: '4px 14px 14px 52px' }}>
      {!r ? <div className="row"><span className="muted small">No report for {dayName(date).toLowerCase()} yet.</span>{nudge && isTop(me) && <a className="btn wa sm" href={nudge} target="_blank" rel="noreferrer">Remind on WhatsApp</a>}</div>
        : <ReportView r={r} me={me} />}</div>}
  </div>;
}
function ReportView({ r, me }) {
  const [note, setNote] = useState(''), auto = autoStats(r.owner, r.date), sub = r.status === 'submitted';
  const act = (data, ok) => attempt(() => update(r.id, data), ok).then((done) => done && setNote(''));
  return <>
    <DaySummary r={r} />
    <Entries r={r} />
    {r.calls?.length > 0 && <div className="stack gap4"><span className="lbl">Call sheet · {callLine(callStats(r))}</span><CallTable calls={r.calls} /></div>}
    <div><span className="lbl">Time by kind of work</span><TimeBars reports={[r]} empty="No timed work in this report." /></div>
    {['salesmgr', 'itmgr'].includes(r.ownerTitle) && <TeamSummary team={r.team} date={r.date} />}
    {auto.length > 0 && <div className="row small"><span className="lbl">Recorded by Aali One</span>{auto.map((a) => <Pill key={a} k="gold">{a}</Pill>)}</div>}
    {r.plan?.trim() && <div className="small"><span className="lbl">Plan for tomorrow</span><div style={{ whiteSpace: 'pre-wrap' }}>{r.plan}</div></div>}
    {r.blockers?.trim() && <div className="banner bad"><b>Problems / help needed:</b> {r.blockers}</div>}
    <div className="small muted">{sub ? `Submitted ${fmtDT(r.submittedAt)}` : 'Still being written – not submitted yet'}{r.reviewed ? ` · reviewed by ${uname(r.reviewed.by)} ${fmtDT(r.reviewed.at)}` : ''}</div>
    {(r.remarks || []).length > 0 && <Remarks r={r} />}
    <WaSend text={reportText(r)} to={management(me)} title="Send this report on WhatsApp to" />
    {r.owner !== me.id && <div className="row">
      <input className="in grow" style={{ minWidth: 180 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a remark for them (optional)" maxLength={500} />
      <button className="btn sm" type="button" disabled={!note.trim()} onClick={() => act({ _remark: note }, 'Remark sent.')}>Send remark</button>
      {sub && !r.reviewed && isManager(me) && <button className="btn primary sm" type="button" onClick={() => act({ _reviewed: true, ...(note.trim() ? { _remark: note } : {}) }, 'Marked as reviewed.')}>Mark reviewed</button>}
      {sub && canRun(me, r) && <button className="btn sm" type="button" disabled={!note.trim()} title="Write what must change in the remark box first" onClick={() => act({ status: 'open', _remark: note }, 'Sent back to be corrected.')}>Send back</button>}
      {canRun(me, r) && <DeleteButton id={r.id} label="Delete" />}</div>}
  </>;
}
function Week({ people, end, pick }) {
  const days = [...Array(7)].map((_, i) => addDays(end, i - 6));
  const mark = (r) => !r ? ['–', 'var(--ink-faint)'] : r.status === 'submitted' ? [r.reviewed ? '✓✓' : '✓', 'var(--ok)'] : ['…', 'var(--warn)'];
  return <><div className="tbl"><table><thead><tr><th>Person</th>{days.map((d) => <th key={d} style={{ textAlign: 'center' }}>{WEEKDAY[parse(d).getDay()]} {parse(d).getDate()}</th>)}<th className="n">Submitted</th></tr></thead>
    <tbody>{people.map((u) => { const rs = days.map((d) => reportOf(u.id, d));
      return <tr key={u.id}><td><b>{u.name}</b><div className="small muted">{desig(u)}</div></td>
        {rs.map((r, i) => { const [m, c] = mark(r); return <td key={i} style={{ textAlign: 'center', background: parse(days[i]).getDay() === 0 ? 'var(--gold-50)' : '' }}>
          <button type="button" className="btn ghost sm" style={{ color: c, fontWeight: 700 }} title={`${u.name} · ${fmtDate(days[i])} · ${status(r)[0]}`} onClick={() => pick(days[i], u.id)}>{m}</button></td>; })}
        <td className="n">{rs.filter((r) => r?.status === 'submitted').length} / 7</td></tr>; })}</tbody></table></div>
    <p className="small muted">✓ submitted · ✓✓ reviewed · … still being written · – no report. Click a mark to open that day.</p></>;
}
