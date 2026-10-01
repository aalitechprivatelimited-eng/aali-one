// Daily work reports: everyone writes their day as it happens; the department manager and top management watch it live.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, store, list, create, update, poll, saveSetting } from '../api.js';
import { today, addDays, fmtDate, fmtDT, iso, parse, isManager, isTop, activeUsers, uname, TITLES, TEAMS, inr, waLink, settings, desig } from '../lib.js';
import { Tabs, Seg, Pill, Av, Empty, Field, In, Area, Sel, Sample, DeleteButton, attempt } from '../ui.jsx';

const NUMS = { sales: [['calls', 'Calls made'], ['connected', 'Calls connected'], ['meetings', 'Meetings / visits'], ['leads', 'New leads found']], it: [['hours', 'Hours worked']], management: [] };
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtMins = (m) => (!m ? '0 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const typesFor = (team) => settings().workTypes?.[team] || [...new Set(Object.values(settings().workTypes || {}).flat())];
// Minutes per kind of work, biggest first, across one or many reports.
function timeByType(reports) {
  const m = new Map();
  for (const r of reports) for (const e of r?.entries || []) if (e.mins) m.set(e.kind || 'Other', (m.get(e.kind || 'Other') || 0) + e.mins);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { rows, total: rows.reduce((t, x) => t + x[1], 0), count: (k) => reports.reduce((t, r) => t + (r?.entries || []).filter((e) => (e.kind || 'Other') === k && e.mins).length, 0) };
}
function TimeBars({ reports, empty }) {
  const t = timeByType(reports);
  if (!t.total) return empty ? <p className="small muted" style={{ margin: 0 }}>{empty}</p> : null;
  return <div className="stack gap4">{t.rows.map(([k, m]) => <div key={k} className="timerow"><span>{k}</span><div className="bar"><i style={{ width: Math.round(100 * m / t.rows[0][1]) + '%' }} /></div>
    <span className="num">{fmtMins(m)}</span><span className="small muted">{t.count(k)} line{t.count(k) === 1 ? '' : 's'}</span></div>)}
    <div className="timerow" style={{ fontWeight: 700 }}><span>Total time written</span><span /><span className="num">{fmtMins(t.total)}</span><span /></div></div>;
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
function refOptions(me) {
  const mine = (x, k) => isManager(me) || x[k] === me.id || (x.people || []).includes(me.id);
  const taskProjects = new Set(list('task').filter((t) => t.owner === me.id).map((t) => t.projectId));
  return [
    ...list('project').filter((p) => p.stage !== 'live' && (mine(p, 'lead') || taskProjects.has(p.id))).map((p) => [p.id, 'Project: ' + p.name, '/projects/' + p.id]),
    ...list('deal').filter((d) => !['won', 'lost'].includes(d.stage) && mine(d, 'owner')).map((d) => [d.id, 'Deal: ' + d.title, '/deals/' + d.id]),
  ];
}

// The department in one box: goes with the manager's own report, so top management reads one page per team.
function TeamSummary({ team, date }) {
  const people = expected().filter((u) => u.team === team && !isManager(u)), rs = people.map((u) => reportOf(u.id, date)).filter(Boolean);
  const sum = (k) => rs.reduce((t, r) => t + (+r.nums?.[k] || 0), 0), help = rs.filter((r) => r.blockers?.trim());
  return <div className="card stack"><div className="row between"><h3 style={{ margin: 0 }}>{TEAMS[team]} team summary · {dayName(date)}</h3>
    <span className="small muted">{rs.filter((r) => r.status === 'submitted').length} of {people.length} submitted · {rs.filter((r) => r.status === 'open').length} still writing · {people.length - rs.length} not started</span></div>
    <div className="row small">{(NUMS[team] || []).map(([k, lb]) => <Pill key={k} k="gold">{lb}: {sum(k)}</Pill>)}</div>
    <TimeBars reports={rs} empty="The team has not written any timed work for this day yet." />
    {help.length > 0 && <div className="banner bad">{help.map((r) => <div key={r.id}><b>{uname(r.owner)}:</b> {r.blockers}</div>)}</div>}
    <span className="small muted">Filled by itself from the team’s reports. It updates as they write.</span></div>;
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
function Editor({ date, r }) {
  const me = store.me, locked = r?.status === 'submitted', refs = refOptions(me), fields = NUMS[me.team] || [];
  const [text, setText] = useState(''), [ref, setRef] = useState(''), [busy, setBusy] = useState(false), [mins, setMins] = useState('');
  const types = typesFor(me.team), [kind, setKind] = useState(() => { try { const k = localStorage.getItem('aali-worktype'); return types.includes(k) ? k : ''; } catch { return ''; } });
  const ready = text.trim() && kind, timed = +mins > 0;
  const [f, setF] = useState({ plan: r?.plan || '', blockers: r?.blockers || '', nums: r?.nums || {} });
  const save = (data) => (r ? update(r.id, data) : create('report', { date, ...data }));
  const dirty = f.plan !== (r?.plan || '') || f.blockers !== (r?.blockers || '') || JSON.stringify(f.nums) !== JSON.stringify(r?.nums || {});
  const blur = () => { if (dirty && !locked) attempt(() => save(f)); };
  // Two ways to add a task: start it now and press Finish later (the app works out the time), or add one already done with its minutes.
  async function add(running) {
    const t = text.trim(); if (!ready || busy || (!running && !timed)) return; setBusy(true);
    try { localStorage.setItem('aali-worktype', kind); } catch {}
    const o = refs.find((x) => x[0] === ref), now = new Date().toISOString();
    const line = { id: Math.random().toString(36).slice(2, 10), at: now, text: t, kind, ...(running ? { state: 'running', start: now } : { mins: Math.round(+mins) }), ...(o ? { refId: o[0], refLabel: o[1], refLink: o[2] } : {}) };
    if (await attempt(() => save({ ...f, entries: [...(r?.entries || []), line] }), running ? 'Task started. Press Finish when it is done.' : '')) { setText(''); setMins(''); }
    setBusy(false);
  }
  const change = (id, fn, ok) => attempt(() => update(r.id, { ...f, entries: r.entries.map((x) => (x.id === id ? fn(x) : x)) }), ok);
  const finish = (id) => change(id, (x) => ({ ...x, state: 'done', end: new Date().toISOString(), mins: Math.max(1, Math.round((Date.now() - new Date(x.start)) / 60000)) }), 'Task finished. Time saved.');
  const fix = (id, m) => change(id, (x) => ({ ...x, mins: Math.max(1, Math.round(m)) }), 'Time corrected.');
  const drop = (id) => attempt(() => update(r.id, { ...f, entries: r.entries.filter((x) => x.id !== id) }));
  const submit = () => attempt(() => update(r.id, { ...f, status: 'submitted' }), 'Report submitted. Your manager has been told.');
  const [l, k] = status(r), auto = autoStats(me.id, date);
  return <div className="card stack">
    <div className="row between"><h2 style={{ margin: 0 }}>{dayName(date)} <span className="small muted">{fmtDate(date)}</span></h2>
      <div className="row"><Pill k={k}>{l}</Pill>{r && <span className="small muted">last saved {ago(r.updatedAt)}</span>}<Sample on={r?.sample} /></div></div>
    {locked ? <div className="banner ok">Submitted{r.submittedAt ? ' at ' + hm(r.submittedAt) : ''}. It is locked now. If something must change, ask your manager to send it back.</div>
      : <div className="banner info">Add each task as you take it up. Your manager sees it as soon as you add it. Press Submit at the end of the day.</div>}
    {(r?.remarks || []).length > 0 && <Remarks r={r} />}
    {!locked && <form className="stack gap4" onSubmit={(e) => { e.preventDefault(); add(!timed); }}>
      <span className="lbl">1. Kind of work</span>
      <div className="row">{types.map((t) => <button key={t} type="button" className={'chip' + (kind === t ? ' on' : '')} aria-pressed={kind === t} onClick={() => setKind(t)}>{t}</button>)}</div>
      <span className="lbl" style={{ marginTop: 6 }}>2. The task</span>
      <div className="row">
        <input className="in grow" style={{ minWidth: 220 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Poster for Vaaradhi Cafe opening offer" autoFocus maxLength={500} />
        {refs.length > 0 && <Sel value={ref} onChange={setRef} blank="About… (optional)" options={refs.map(([v, lb]) => [v, lb])} style={{ width: 'auto', maxWidth: 240 }} />}</div>
      <span className="lbl" style={{ marginTop: 6 }}>3. Time</span>
      <div className="row">
        <button className="btn primary" type="button" disabled={!ready || busy} onClick={() => add(true)}>▶ Start this task now</button>
        <span className="small muted">or, if it is already done, it took</span>
        <input className="in" style={{ width: 100 }} type="number" min="1" max="1440" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} placeholder="Minutes" aria-label="Minutes the task took" />
        <button className="btn" type="button" disabled={!ready || !timed || busy} onClick={() => add(false)}>Add finished task</button></div>
      <span className="small muted">Start a task when you begin it and press Finish when it is done. Aali One works out the time taken. Your manager sees it as you go.</span></form>}
    <Entries r={r} onDrop={!locked && drop} onFinish={!locked && finish} onFix={!locked && fix} />
    {r && <div><span className="lbl">Time by kind of work</span><TimeBars reports={[r]} empty="No timed work yet." /></div>}
    {auto.length > 0 && <div className="row small"><span className="lbl">Recorded by Aali One</span>{auto.map((a) => <Pill key={a} k="gold">{a}</Pill>)}</div>}
    <div className="form">
      {fields.map(([key, lb]) => <Field key={key} label={lb}><In type="number" min="0" inputMode="numeric" disabled={locked} value={f.nums[key] ?? ''} onBlur={blur}
        onChange={(e) => setF({ ...f, nums: { ...f.nums, [key]: e.target.value === '' ? undefined : Math.max(0, +e.target.value) } })} /></Field>)}
      <Field label="Plan for tomorrow" full><Area disabled={locked} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} onBlur={blur} placeholder="What you will do next" /></Field>
      <Field label="Problems / help needed" full><Area disabled={locked} value={f.blockers} onChange={(e) => setF({ ...f, blockers: e.target.value })} onBlur={blur} placeholder="Anything stopping your work. Leave empty if none." /></Field>
    </div>
    {!locked && <div className="row between"><span className="small muted">{dirty ? 'Not saved yet – click outside the box to save.' : r ? 'All changes saved.' : 'Nothing written yet.'}</span>
      <div className="row">{r && <DeleteButton id={r.id} label="Delete report" />}<button className="btn primary" type="button" disabled={!r?.entries?.length || r.entries.some((e) => e.state === 'running')} title={r?.entries?.some((e) => e.state === 'running') ? 'Finish the running task first' : ''} onClick={submit}>Submit for the day</button></div></div>}
  </div>;
}
function Entries({ r, onDrop, onFinish, onFix }) {
  const es = r?.entries || [], [edit, setEdit] = useState(null);
  if (!es.length) return <p className="muted small" style={{ margin: 0 }}>No tasks yet.</p>;
  const sofar = (e) => Math.max(0, Math.round((Date.now() - new Date(e.start)) / 60000));
  return <div className="list">{es.map((e) => { const run = e.state === 'running';
    return <div className="li" key={e.id} style={{ padding: '7px 12px', background: run ? 'var(--warn-bg)' : '' }}>
      <span className="num small muted" style={{ width: 118, flex: 'none' }}>{hm(e.start || e.at)}{e.end ? ' – ' + hm(e.end) : ''}</span>
      <div className="grow">{e.kind && <><Pill k="info">{e.kind}</Pill> </>}{e.text}{e.refId && <> <Link className="pill gold" to={e.refLink || '/'} style={{ textDecoration: 'none' }}>{e.refLabel}</Link></>}</div>
      {run ? <><Pill k="warn">In progress · {fmtMins(sofar(e))} so far</Pill>{onFinish && <button className="btn primary sm" type="button" onClick={() => onFinish(e.id)}>■ Finish</button>}</>
        : edit?.id === e.id ? <><input className="in" style={{ width: 80 }} type="number" min="1" max="1440" value={edit.v} onChange={(ev) => setEdit({ id: e.id, v: ev.target.value })} aria-label="Minutes" autoFocus />
            <button className="btn sm" type="button" disabled={!(+edit.v > 0)} onClick={() => { onFix(e.id, +edit.v); setEdit(null); }}>Save</button></>
          : <><Pill k="ok">Done</Pill><span className="num small" style={{ minWidth: 64, textAlign: 'right' }}>{fmtMins(e.mins || 0)}</span>
            {onFix && <button className="btn ghost sm" type="button" title="Use this if you forgot to press Finish on time" onClick={() => setEdit({ id: e.id, v: e.mins || '' })}>Fix time</button>}</>}
      {onDrop && <button className="btn ghost sm" type="button" aria-label="Remove this task" onClick={() => onDrop(e.id)}>Remove</button>}</div>; })}</div>;
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
      <div className="stat"><span className="l">Submitted</span><span className="v">{n((x) => x.r?.status === 'submitted')}<span className="muted small"> of {rows.length}</span></span></div>
      <div className={'stat' + (n((x) => x.r?.status === 'open') ? ' warm' : '')}><span className="l">In progress</span><span className="v">{n((x) => x.r?.status === 'open')}</span></div>
      <div className={'stat' + (n((x) => !x.r) ? ' hot' : '')}><span className="l">Not started</span><span className="v">{n((x) => !x.r)}</span></div>
      <div className="stat"><span className="l">Waiting for review</span><span className="v">{n((x) => x.r?.status === 'submitted' && !x.r.reviewed)}</span></div>
      <div className={'stat' + (help.length ? ' hot' : '')}><span className="l">Need help</span><span className="v">{help.length}</span></div>
    </div>
    {me.title === 'ops' && <label className="check card" style={{ marginBottom: 12 }}><input type="checkbox" checked={!!settings().leadSeesReports}
      onChange={(e) => attempt(() => saveSetting('leadSeesReports', e.target.checked), e.target.checked ? "On: the IT Team Lead can now read the developers' reports." : "Off: only the IT Manager and top management read the developers' reports.")} />
      <span><b>IT Team Lead can read the developers' daily reports</b><br /><span className="small muted">Off for now. Switch it on when the IT team grows. The Team Lead can read and remark; review and send-back stay with the IT Manager.</span></span></label>}
    {!rows.length && <Empty>No people in this view. Add people in Settings → People.</Empty>}
    {view === 'week' ? <Week people={people} end={date} pick={(d, id) => { setDate(d); setView('day'); setOpen(id); }} />
      : <div className="split">
        <div className="list">{rows.map(({ u, r }, i) => <PersonRow key={u.id} u={u} r={r} date={date} first={!i} open={open === u.id} toggle={() => setOpen(open === u.id ? '' : u.id)} />)}</div>
        <div className="stack">
          <div className="card"><h3>Time by kind of work</h3><TimeBars reports={rows.map((x) => x.r)} empty="No timed work written for this day yet." /></div>
          <div className="card"><h3>Latest updates</h3>{feed.length ? <div className="stack gap4">{feed.map((e) => <div key={e.u.id + e.id} className="small"><span className="num faint">{hm(e.at)}</span> <b>{e.u.name.split(' ')[0]}</b> · {e.kind ? e.kind + ': ' : ''}{e.text}{e.mins ? ` (${fmtMins(e.mins)})` : ''}</div>)}</div> : <p className="small muted" style={{ margin: 0 }}>Nothing written for this day yet. New lines show here by themselves.</p>}</div>
          {help.length > 0 && <div className="card"><h3>Problems / help needed</h3><div className="stack gap4">{help.map(({ u, r }) => <div key={u.id} className="small"><b>{u.name}</b> · {r.blockers}</div>)}</div></div>}
        </div></div>}
  </>;
}
function PersonRow({ u, r, date, open, toggle, first }) {
  const me = store.me, [l, k] = status(r), nums = (NUMS[u.team] || []).filter(([key]) => r?.nums?.[key] != null);
  const nudge = waLink(u.phone, `Hi ${u.name.split(' ')[0]}, please update your daily work report for ${fmtDate(date)} in Aali One: ${location.origin}/daily`);
  return <div style={{ borderTop: first ? 'none' : '1px solid var(--line)' }}>
    <button type="button" className="li" onClick={toggle} aria-expanded={open} style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }}>
      <Av id={u.id} /><div className="grow"><div className="t">{u.name}</div><div className="small muted">{desig(u)} · {TEAMS[u.team]}{r ? ` · ${r.entries?.length || 0} update${r.entries?.length === 1 ? '' : 's'} · last ${ago(r.updatedAt)}` : ''}</div></div>
      {timeByType([r]).total > 0 && <span className="small muted"><span className="num">{fmtMins(timeByType([r]).total)}</span> written</span>}
      {nums.map(([key, lb]) => <span key={key} className="small muted"><span className="num">{r.nums[key]}</span> {lb.toLowerCase()}</span>)}
      {r?.blockers?.trim() && <Pill k="bad">Needs help</Pill>}<Pill k={k}>{l}</Pill><Sample on={r?.sample} /><span className="faint" aria-hidden>{open ? '▾' : '▸'}</span></button>
    {open && <div className="stack" style={{ padding: '4px 14px 14px 52px' }}>
      {!r ? <div className="row"><span className="muted small">No report for {dayName(date).toLowerCase()} yet.</span>{nudge && <a className="btn wa sm" href={nudge} target="_blank" rel="noreferrer">Remind on WhatsApp</a>}</div>
        : <ReportView r={r} me={me} />}</div>}
  </div>;
}
function ReportView({ r, me }) {
  const [note, setNote] = useState(''), auto = autoStats(r.owner, r.date), sub = r.status === 'submitted';
  const act = (data, ok) => attempt(() => update(r.id, data), ok).then((done) => done && setNote(''));
  return <>
    <Entries r={r} />
    <div><span className="lbl">Time by kind of work</span><TimeBars reports={[r]} empty="No timed work in this report." /></div>
    {['salesmgr', 'itmgr'].includes(r.ownerTitle) && <TeamSummary team={r.team} date={r.date} />}
    {auto.length > 0 && <div className="row small"><span className="lbl">Recorded by Aali One</span>{auto.map((a) => <Pill key={a} k="gold">{a}</Pill>)}</div>}
    {r.plan?.trim() && <div className="small"><span className="lbl">Plan for tomorrow</span><div style={{ whiteSpace: 'pre-wrap' }}>{r.plan}</div></div>}
    {r.blockers?.trim() && <div className="banner bad"><b>Problems / help needed:</b> {r.blockers}</div>}
    <div className="small muted">{sub ? `Submitted ${fmtDT(r.submittedAt)}` : 'Still being written – not submitted yet'}{r.reviewed ? ` · reviewed by ${uname(r.reviewed.by)} ${fmtDT(r.reviewed.at)}` : ''}</div>
    {(r.remarks || []).length > 0 && <Remarks r={r} />}
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
