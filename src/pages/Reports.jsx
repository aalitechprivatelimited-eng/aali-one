// Reports: an overview of everything for a day, a week or a month – daily work, sales, projects and money – and each area in detail.
// Every number that stands for a set of records opens the list behind it (the leads, the deals, the projects, the tasks), and Daily work
// opens each person's daily reports in full. What anyone sees is what their access allows: the store only holds what they may open.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, list, get, create, update, store } from '../api.js';
import { settings, uname, inr, today, addDays, diff, parse, fmtDate, stageProb, stageLabel, pStageLabel, isTop, isManager, can, bdes, activeUsers, desig, MONTHS, csvCell } from '../lib.js';
import { Empty, Pill, In, Sel, Seg, Field, Tabs, Modal, attempt } from '../ui.jsx';
import { progress } from './Projects.jsx';
import { ReportView, TimeBars, dayLine, callStats, fmtMins } from './Daily.jsx';

// A bar chart; with onPick each bar opens what it counts.
function Bars({ rows, money, onPick }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return <div className="stack gap4">{rows.map(([l, v, sub]) => { const line = <><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l}>{l}</span><div className="bar" style={{ height: 10 }}><i style={{ width: (100 * v / max) + '%' }} /></div>
    <span className="num" style={{ textAlign: 'right' }}>{money ? inr(v) : v}{sub ? <span className="muted"> {sub}</span> : null}</span></>, grid = { display: 'grid', gridTemplateColumns: 'minmax(90px,170px) 1fr 90px', gap: 10, alignItems: 'center', fontSize: 13 };
    return onPick && v ? <button key={l} type="button" className="barpick" style={grid} onClick={() => onPick(l)} title="See the list">{line}</button> : <div key={l} style={grid}>{line}</div>; })}</div>;
}
// The records behind a number: each one opens.
function Drill({ d, onClose }) {
  const parts = d.sections || [['', d.rows]], row = (r) => <Link key={r.id} to={r.to} className="li" onClick={onClose}>
    <span className="grow"><b>{r.title}</b>{r.sub && <div className="small muted">{r.sub}</div>}</span>{r.right && <span className="small">{r.right}</span>}</Link>;
  return <Modal wide title={d.title} onClose={onClose}>{parts.some(([, xs]) => xs.length) ? <div className="stack">{parts.map(([label, xs]) => <div key={label} className="stack gap4">
    {label && <h3 style={{ margin: 0 }}>{label} <span className="num muted">{xs.length}</span></h3>}<div className="list">{xs.map(row)}</div></div>)}</div> : <Empty>Nothing here.</Empty>}</Modal>;
}
const leadRow = (l) => ({ id: l.id, to: '/leads/' + l.id, title: l.name, sub: [l.service, l.source, uname(l.owner)].filter(Boolean).join(' · '), right: l.followUp ? `follow-up ${fmtDate(l.followUp)}` : l.status });
const dealRow = (d) => ({ id: d.id, to: '/deals/' + d.id, title: d.title, sub: [stageLabel(d.stage), uname(d.owner), d.lostReason].filter(Boolean).join(' · '), right: inr(+d.value || 0) });
const projRow = (p) => ({ id: p.id, to: '/projects/' + p.id, title: p.name, sub: [pStageLabel(p.stage), `${progress(p.id)}% done`, p.lead ? 'lead ' + uname(p.lead) : ''].filter(Boolean).join(' · '), right: p.deadline ? `delivery ${fmtDate(p.deadline)}` : '' });
const taskRow = (t) => ({ id: t.id, to: t.projectId ? '/projects/' + t.projectId : '/tasks', title: t.title, sub: [uname(t.owner), get(t.projectId)?.name].filter(Boolean).join(' · '), right: t.due ? `due ${fmtDate(t.due)}` : '' });

// ---------- the period every report is for: a day, a week (Monday to Sunday) or a month ----------
const lastOf = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
function rangeOf({ kind, date }) {
  if (kind === 'day') return [date, date];
  if (kind === 'month') return [date.slice(0, 7) + '-01', lastOf(date.slice(0, 7))];
  const s = addDays(date, -((parse(date).getDay() + 6) % 7)); return [s, addDays(s, 6)];
}
function shift({ kind, date }, n) {
  if (kind === 'day') return addDays(date, n); if (kind === 'week') return addDays(date, 7 * n);
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 10);
}
const periodLabel = (p) => { const [s, e] = rangeOf(p); return p.kind === 'day' ? parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  : p.kind === 'week' ? `${fmtDate(s)} – ${fmtDate(e)}` : `${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`; };
function Period({ p, setP }) {
  return <div className="row" style={{ alignItems: 'center' }}><Seg value={p.kind} onChange={(k) => setP({ ...p, kind: k })} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month']]} />
    <button className="btn sm" type="button" aria-label="Before" onClick={() => setP({ ...p, date: shift(p, -1) })}>‹</button><b style={{ minWidth: 150, textAlign: 'center' }}>{periodLabel(p)}</b>
    <button className="btn sm" type="button" aria-label="After" disabled={rangeOf(p)[1] >= today()} onClick={() => setP({ ...p, date: shift(p, 1) })}>›</button>
    {rangeOf(p)[1] < today() && <button className="btn ghost sm" type="button" onClick={() => setP({ ...p, date: today() })}>Back to today</button>}</div>;
}

// The people whose daily reports this person reads: management everyone, a manager their team, anyone else themselves.
const NO_REPORT = ['chairman', 'ops', 'cs', 'admin'];
const writers = (me = store.me) => activeUsers().filter((u) => !NO_REPORT.includes(u.title) && (isTop(me) || (me.title === 'salesmgr' ? u.team === 'sales' : me.title === 'itmgr' ? u.team === 'it' : u.id === me.id)));
function workOf(reps) {
  const w = { days: reps.length, sub: 0, worked: 0, idle: 0, calls: 0, pos: 0, back: 0, meet: 0, visits: 0 };
  for (const r of reps) { const d = dayLine(r), k = callStats(r); w.worked += d.worked; w.idle += d.idle; w.calls += k.n; w.pos += k.pos; w.back += k.back; w.meet += k.meet;
    w.visits += (r.entries || []).filter((e) => e.visit).length; if (r.status === 'submitted') w.sub++; }
  return w;
}

export default function Reports() {
  useStore(); const team = store.me.team;
  const tabs = [(isTop() || isManager()) && ['overview', 'Overview'], ['work', 'Daily work'], (isTop() || team === 'sales') && ['sales', 'Sales & BDEs'], (isTop() || team === 'it') && ['delivery', 'Projects & IT'], ['custom', 'Build a report']].filter(Boolean);
  const [tab, setTab] = useState(tabs[0][0]), [p, setP] = useState({ kind: 'week', date: today() });
  return <><div className="topbar"><h1>Reports</h1></div>
    <Tabs value={tab} onChange={setTab} tabs={tabs} />
    <div className="stack gap16" style={{ marginTop: 14 }}>
      {tab !== 'custom' && <Period p={p} setP={setP} />}
      {tab === 'overview' && <Overview p={p} go={setTab} />}{tab === 'work' && <DailyWork p={p} />}{tab === 'sales' && <Sales p={p} />}{tab === 'delivery' && <Delivery p={p} />}{tab === 'custom' && <Custom />}
    </div></>;
}

// ---------- Overview: every report at a glance for the period; each part opens its details ----------
function Overview({ p, go }) {
  const [s, e] = rangeOf(p), inR = (d) => !!d && String(d).slice(0, 10) >= s && String(d).slice(0, 10) <= e, [drill, setDrill] = useState(null);
  const people = writers(), reps = list('report').filter((r) => inR(r.date) && people.some((u) => u.id === r.owner)), w = workOf(reps);
  const leads = list('lead'), deals = list('deal'), open = deals.filter((d) => !['won', 'lost'].includes(d.stage)), won = deals.filter((d) => d.stage === 'won' && inR(d.wonAt));
  const newLeads = leads.filter((l) => inR(l.createdAt)), lateFu = [...leads.filter((l) => !['converted', 'junk'].includes(l.status)), ...open].filter((x) => x.followUp && diff(x.followUp) < 0);
  const projects = list('project'), active = projects.filter((x) => !['live', 'onhold', 'awaiting'].includes(x.stage)), pastDl = active.filter((x) => x.deadline && diff(x.deadline) < 0);
  const tasks = list('task'), doneT = tasks.filter((t) => t.status === 'done' && inR(t.doneAt)), lateT = tasks.filter((t) => t.status !== 'done' && t.due && diff(t.due) < 0);
  const tickets = list('ticket'), openTk = tickets.filter((t) => t.status !== 'resolved'), delivered = projects.filter((x) => x.stage === 'live' && inR(x.liveAt));
  const got = list('receipt').filter((r) => inR(r.date)).reduce((a, r) => a + (r.totals?.received || 0), 0), overdue = list('payment').filter((x) => x.status !== 'paid' && x.due < today()).reduce((a, x) => a + Math.max(0, x.amount - (x.paid || 0)), 0);
  const kv = (rows) => <table className="kv"><tbody>{rows.filter(Boolean).map(([k, v, pick]) => <tr key={k}><td>{k}</td><td className="n">{pick ? <button type="button" className="btn ghost sm" onClick={pick}>{v}</button> : v}</td></tr>)}</tbody></table>;
  const card = (title, body, tab) => <div className="card stack"><h2 style={{ margin: 0 }}>{title}</h2>{body}<div><button className="btn sm" type="button" onClick={() => go(tab)}>See the details →</button></div></div>;
  return <><div className="grid2" style={{ alignItems: 'start' }}>
    {card('Daily work', kv([[p.kind === 'day' ? 'Reports written' : 'Reports written (person-days)', `${w.days}${p.kind === 'day' ? ' of ' + people.length : ''}`], ['Submitted', w.sub], ['Time worked', fmtMins(w.worked)],
      ['Nothing recorded', fmtMins(w.idle)], ['Calls made', w.calls], ['Interested', w.pos], ['Meetings fixed', w.meet], ['Client visits', w.visits]]), 'work')}
    {(can('leads') || can('deals')) && card('Sales', kv([['New leads', newLeads.length, () => setDrill({ title: `New leads – ${periodLabel(p)}`, rows: newLeads.map(leadRow) })],
      ['Deals won', `${won.length} · ${inr(won.reduce((a, d) => a + (+d.value || 0), 0))}`, () => setDrill({ title: `Deals won – ${periodLabel(p)}`, rows: won.map(dealRow) })],
      ['Open pipeline now', `${open.length} · ${inr(open.reduce((a, d) => a + (+d.value || 0), 0))}`, () => setDrill({ title: 'Open deals', rows: open.map(dealRow) })],
      ['Follow-ups late now', lateFu.length, () => setDrill({ title: 'Follow-ups that are late', rows: lateFu.map((x) => (x.type === 'deal' ? dealRow(x) : leadRow(x))) })]]), 'sales')}
    {can('projects') && card('Projects & IT', kv([['Active projects', active.length, () => setDrill({ title: 'Active projects', rows: active.map(projRow) })],
      ['Past the delivery date', pastDl.length, () => setDrill({ title: 'Projects past the delivery date', rows: pastDl.map(projRow) })],
      ['Delivered', delivered.length, () => setDrill({ title: `Delivered – ${periodLabel(p)}`, rows: delivered.map(projRow) })],
      ['Tasks done', doneT.length, () => setDrill({ title: `Tasks done – ${periodLabel(p)}`, rows: doneT.map(taskRow) })], ['Tasks late now', lateT.length, () => setDrill({ title: 'Late tasks', rows: lateT.map(taskRow) })],
      can('support') && ['Support requests open', openTk.length]]), 'delivery')}
    {can('money') && <div className="card stack"><h2 style={{ margin: 0 }}>Money</h2>{kv([['Received', inr(got)], ['Overdue now', inr(overdue)]])}<div><Link className="btn sm" to="/payments">Payments & receipts →</Link></div></div>}
  </div>{drill && <Drill d={drill} onClose={() => setDrill(null)} />}</>;
}

// ---------- Daily work: everyone's day, and each person's reports in full ----------
function DailyWork({ p }) {
  const me = store.me, [team, setTeam] = useState('all'), [open, setOpen] = useState(null), [s, e] = rangeOf(p);
  const people = writers(me).filter((u) => team === 'all' || u.team === team), reps = list('report').filter((r) => r.date >= s && r.date <= e && people.some((u) => u.id === r.owner));
  const rows = people.map((u) => { const mine = reps.filter((r) => r.owner === u.id).sort((a, b) => b.date.localeCompare(a.date)); return { u, mine, w: workOf(mine) }; })
    .sort((a, b) => b.w.days - a.w.days || b.w.worked - a.w.worked || a.u.name.localeCompare(b.u.name)), all = workOf(reps), sel = rows.find((r) => r.u.id === open);
  return <>
    {isTop() && <Seg value={team} onChange={setTeam} options={[['all', 'Everyone'], ['sales', 'Sales team'], ['it', 'IT team']]} />}
    <div className="stats"><div className="stat"><span className="l">Reports written</span><span className="v">{all.days}{p.kind === 'day' ? <span className="small muted"> of {people.length}</span> : null}</span><span className="small muted">{all.sub} submitted</span></div>
      <div className="stat"><span className="l">Time worked</span><span className="v">{fmtMins(all.worked)}</span><span className="small muted">nothing recorded {fmtMins(all.idle)}</span></div>
      <div className="stat"><span className="l">Calls made</span><span className="v">{all.calls}</span><span className="small muted">{all.pos} interested · {all.back} to call back</span></div>
      <div className="stat"><span className="l">Meetings & visits</span><span className="v">{all.meet + all.visits}</span><span className="small muted">{all.meet} meetings fixed · {all.visits} client visits</span></div></div>
    {people.length ? <div className="tbl cards"><table><thead><tr><th>Person</th><th>{p.kind === 'day' ? 'Report' : 'Days written'}</th><th className="n">Worked</th><th className="n">Nothing recorded</th><th className="n">Calls</th><th className="n">Interested</th><th className="n">Meetings fixed</th><th className="n">Client visits</th></tr></thead><tbody>
      {rows.map(({ u, mine, w }) => <tr key={u.id} className="click" onClick={() => setOpen(u.id)}><td><b>{u.name}</b><div className="small muted">{desig(u)}</div></td>
        <td>{p.kind === 'day' ? (mine[0] ? <Pill k={mine[0].status === 'submitted' ? 'ok' : mine[0].status === 'closed' ? 'bad' : 'warn'}>{mine[0].status === 'submitted' ? 'Submitted' : mine[0].status === 'closed' ? 'Not ended' : 'Still writing'}</Pill> : <Pill k="bad">Not written</Pill>) : `${w.days} (${w.sub} submitted)`}</td>
        <td className="n">{fmtMins(w.worked)}</td><td className="n" style={{ color: w.idle >= 60 * Math.max(1, w.days) ? 'var(--bad)' : '' }}>{fmtMins(w.idle)}</td>
        <td className="n">{w.calls}</td><td className="n">{w.pos}</td><td className="n">{w.meet}</td><td className="n">{w.visits}</td></tr>)}</tbody></table></div>
      : <Empty>Nobody here writes a daily report.</Empty>}
    <div className="card stack"><h2 style={{ margin: 0 }}>Time by kind of work</h2><TimeBars reports={reps} empty="No timed work in this period." /></div>
    {sel && <PersonWork u={sel.u} reps={sel.mine} label={periodLabel(p)} onClose={() => setOpen(null)} />}
  </>;
}
// One person's daily reports in the period, a day at a time, in full – with the same remark, review and send-back as on Daily reports.
function PersonWork({ u, reps, label, onClose }) {
  const [day, setDay] = useState(reps[0]?.id || ''), r = reps.find((x) => x.id === day), w = workOf(reps);
  return <Modal wide title={`${u.name} – ${label}`} onClose={onClose}>{reps.length ? <div className="stack">
    {reps.length > 1 && <div className="small muted">{reps.length} days · worked {fmtMins(w.worked)} · {w.calls} calls · {w.visits} client visits</div>}
    {reps.length > 1 && <div className="row">{reps.map((x) => <button key={x.id} type="button" className={'chip' + (x.id === day ? ' on' : '')} aria-pressed={x.id === day} onClick={() => setDay(x.id)}>{parse(x.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</button>)}</div>}
    {r && <div className="stack"><h3 style={{ margin: 0 }}>{parse(r.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3><ReportView r={r} me={store.me} /></div>}
  </div> : <Empty>{u.name} has no daily report in this period.</Empty>}</Modal>;
}

// ---------- Sales & BDEs: the pipeline and each BDE for the period; every number opens its list ----------
function Sales({ p }) {
  const [s, e] = rangeOf(p), inR = (d) => !!d && String(d).slice(0, 10) >= s && String(d).slice(0, 10) <= e, [drill, setDrill] = useState(null), month = s.slice(0, 7);
  const leads = list('lead'), deals = list('deal'), reps = list('report').filter((r) => inR(r.date)), t = today();
  const qualL = leads.filter((l) => ['qualified', 'converted'].includes(l.status)), quotedD = deals.filter((d) => d.quoteNo), wonAll = deals.filter((d) => d.stage === 'won'), lost = deals.filter((d) => d.stage === 'lost');
  const reasons = {}; lost.forEach((d) => (reasons[d.lostReason || 'Not given'] = (reasons[d.lostReason || 'Not given'] || 0) + 1));
  const src = {}; leads.forEach((l) => { const x = (src[l.source || 'Not given'] ||= { n: 0, won: 0 }); x.n++; const d = deals.find((y) => y.leadId === l.id); if (d?.stage === 'won') x.won += +d.value || 0; });
  const show = (title, rows) => setDrill({ title, rows });
  const rows = bdes().map((u) => {
    const ds = deals.filter((d) => d.owner === u.id), open = ds.filter((d) => !['won', 'lost'].includes(d.stage)), won = ds.filter((d) => d.stage === 'won' && inR(d.wonAt));
    const myLeads = leads.filter((l) => l.owner === u.id), fuLate = [...myLeads.filter((l) => !['converted', 'junk'].includes(l.status)), ...open].filter((x) => x.followUp && diff(x.followUp) < 0);
    const calls = reps.filter((r) => r.owner === u.id).reduce((a, r) => a + callStats(r).n, 0), newL = myLeads.filter((l) => inR(l.createdAt));
    const target = +(list('target').find((x) => x.userId === u.id && x.month === month)?.amount || 0), wonV = won.reduce((a, d) => a + (+d.value || 0), 0);
    const payLate = list('payment').filter((x) => x.owner === u.id && x.status !== 'paid' && x.due < t);
    return { u, open, won, wonV, fuLate, calls, newL, target, payLate, pipe: open.reduce((a, d) => a + (+d.value || 0), 0) };
  }).sort((a, b) => b.wonV - a.wonV || b.calls - a.calls);
  const one = (r) => setDrill({ title: `${r.u.name} – ${periodLabel(p)}`, sections: [['Won in the period', r.won.map(dealRow)], ['Open deals', r.open.map(dealRow)], ['Follow-ups late', r.fuLate.map((x) => (x.type === 'deal' ? dealRow(x) : leadRow(x)))],
    ['New leads in the period', r.newL.map(leadRow)], ...(can('money') ? [['Payments late', r.payLate.map((x) => ({ id: x.id, to: '/payments', title: x.title || 'Payment', sub: uname(x.owner), right: inr(Math.max(0, x.amount - (x.paid || 0))) }))]] : [])].filter(([, xs]) => xs.length) });
  return <>
    <div className="tbl cards"><table><thead><tr><th>BDE</th><th className="n">New leads</th><th className="n">Calls made</th><th className="n">Open deals</th><th className="n">Pipeline</th><th className="n">Follow-ups late</th><th className="n">Won</th><th className="n">Target ({MONTHS[+month.slice(5) - 1]})</th>{can('money') && <th className="n">Payments late</th>}</tr></thead><tbody>
      {rows.map((r) => <tr key={r.u.id} className="click" onClick={() => one(r)}><td><b>{r.u.name}</b></td><td className="n">{r.newL.length}</td><td className="n">{r.calls}</td><td className="n">{r.open.length}</td><td className="n">{inr(r.pipe)}</td>
        <td className="n" style={{ color: r.fuLate.length ? 'var(--bad)' : '' }}>{r.fuLate.length}</td><td className="n">{inr(r.wonV)} ({r.won.length})</td><td className="n">{r.target ? `${Math.round(100 * r.wonV / r.target)}% of ${inr(r.target)}` : '—'}</td>
        {can('money') && <td className="n" style={{ color: r.payLate.length ? 'var(--bad)' : '' }}>{r.payLate.length ? inr(r.payLate.reduce((a, x) => a + Math.max(0, x.amount - (x.paid || 0)), 0)) : '—'}</td>}</tr>)}
      {!rows.length && <tr><td colSpan="9" className="muted">Add BDEs in Settings → People.</td></tr>}</tbody></table></div>
    <p className="small muted" style={{ margin: 0 }}>New leads, calls and deals won are for {periodLabel(p)}; open deals, follow-ups and payments are as they are now. Tap a BDE to see the deals and leads behind the numbers.</p>
    <div className="grid2">
      <div className="card"><h2>Sales funnel <span className="small muted">all time</span></h2><Bars rows={[['Leads', leads.length], ['Qualified / converted', qualL.length], ['Quotation sent', quotedD.length], ['Won', wonAll.length]]}
        onPick={(l) => (l === 'Leads' ? show('All leads', leads.map(leadRow)) : l === 'Qualified / converted' ? show('Qualified and converted leads', qualL.map(leadRow)) : l === 'Quotation sent' ? show('Deals with a quotation sent', quotedD.map(dealRow)) : show('Deals won', wonAll.map(dealRow)))} /></div>
      <div className="card"><h2>Pipeline by stage <span className="small muted">now</span></h2><Bars money rows={settings().pipeline.filter((x) => x.key !== 'lost').map((x) => [x.label, deals.filter((d) => d.stage === x.key).reduce((a, d) => a + (+d.value || 0), 0)])}
        onPick={(l) => { const st = settings().pipeline.find((x) => x.label === l); show(`Deals – ${l}`, deals.filter((d) => d.stage === st?.key).map(dealRow)); }} /></div>
      <div className="card"><h2>Leads by source</h2><Bars rows={Object.entries(src).sort((a, b) => b[1].n - a[1].n).map(([k, x]) => [k, x.n, x.won ? `· won ${inr(x.won)}` : ''])} onPick={(l) => show(`Leads from ${l}`, leads.filter((x) => (x.source || 'Not given') === l).map(leadRow))} />
        {!leads.length && <p className="muted">No leads yet.</p>}</div>
      <div className="card"><h2>Why deals were lost</h2>{lost.length ? <Bars rows={Object.entries(reasons).sort((a, b) => b[1] - a[1])} onPick={(l) => show(`Lost – ${l}`, lost.filter((d) => (d.lostReason || 'Not given') === l).map(dealRow))} /> : <p className="muted">No lost deals.</p>}
        <p className="small muted">Win rate: {wonAll.length + lost.length ? Math.round(100 * wonAll.length / (wonAll.length + lost.length)) : 0}% of closed deals.</p></div>
    </div>
    {(store.me.isAdmin || store.me.title === 'salesmgr') && <Targets month={month} />}
    {drill && <Drill d={drill} onClose={() => setDrill(null)} />}</>;
}

function Targets({ month }) {
  const [v, setV] = useState({});
  return <div className="card stack"><h2>Monthly targets ({month})</h2><p className="small muted" style={{ margin: 0 }}>Set how much each BDE should win this month. It shows on the scoreboard and the pipeline.</p>
    {bdes().map((u) => { const t = list('target').find((x) => x.userId === u.id && x.month === month); return <div key={u.id} className="row"><span style={{ width: 180 }}>{u.name}</span>
      <In type="number" placeholder="₹ target" defaultValue={t?.amount || ''} onChange={(e) => setV({ ...v, [u.id]: e.target.value })} style={{ maxWidth: 160 }} />
      <button className="btn sm" type="button" disabled={v[u.id] === undefined} onClick={() => attempt(() => (t ? update(t.id, { amount: +v[u.id] || 0 }) : create('target', { userId: u.id, month, amount: +v[u.id] || 0 })), 'Target saved.')}>Save</button></div>; })}</div>;
}

// ---------- Projects & IT: every bar and person opens its list ----------
function Delivery({ p }) {
  const [s, e] = rangeOf(p), inR = (d) => !!d && String(d).slice(0, 10) >= s && String(d).slice(0, 10) <= e, [drill, setDrill] = useState(null);
  const projects = list('project'), all = list('task'), tasks = all.filter((t) => t.status !== 'done');
  const it = activeUsers().filter((u) => u.team === 'it').map((u) => ({ u, open: tasks.filter((t) => t.owner === u.id), late: tasks.filter((t) => t.owner === u.id && t.due && diff(t.due) < 0),
    done: all.filter((t) => t.owner === u.id && t.status === 'done' && inR(t.doneAt)), lead: projects.filter((x) => x.lead === u.id && !['live', 'onhold'].includes(x.stage)) })).sort((a, b) => b.open.length - a.open.length);
  const risk = projects.filter((x) => x.deadline && !['live', 'onhold', 'awaiting'].includes(x.stage) && (diff(x.deadline) < 0 || (diff(x.deadline) <= 7 && progress(x.id) < 70)));
  const tickets = list('ticket'), tk = (t) => ({ id: t.id, to: '/support', title: t.title, sub: [t.number, t.clientName || get(t.clientId)?.name, uname(t.owner)].filter(Boolean).join(' · '), right: t.promised ? `promised ${fmtDate(t.promised)}` : t.status });
  const tkSets = { Open: tickets.filter((t) => t.status !== 'resolved'), 'Past promised date': tickets.filter((t) => t.status !== 'resolved' && t.promised && diff(t.promised) < 0), Resolved: tickets.filter((t) => t.status === 'resolved') };
  return <><div className="grid2">
    <div className="card"><h2>Projects by stage</h2><Bars rows={settings().projectStages.map((x) => [x.label, projects.filter((y) => y.stage === x.key).length])}
      onPick={(l) => { const st = settings().projectStages.find((x) => x.label === l); setDrill({ title: `Projects – ${l}`, rows: projects.filter((y) => y.stage === st?.key).map(projRow) }); }} /></div>
    <div className="card"><h2>Projects at risk</h2>{risk.length ? <div className="list">{risk.map((x) => <Link key={x.id} to={'/projects/' + x.id} className="li"><span className="grow">{x.name}</span><span className="small">{pStageLabel(x.stage)} · {progress(x.id)}%</span>
      <span className="num small" style={{ color: diff(x.deadline) < 0 ? 'var(--bad)' : '' }}>{fmtDate(x.deadline)}</span></Link>)}</div> : <p className="muted small">None. Every project is on track.</p>}</div>
    <div className="card"><h2>IT team <span className="small muted">tasks done in {periodLabel(p)}</span></h2><div className="tbl cards"><table><thead><tr><th>Person</th><th className="n">Leading</th><th className="n">Open tasks</th><th className="n">Late</th><th className="n">Done</th></tr></thead><tbody>
      {it.map((r) => <tr key={r.u.id} className="click" onClick={() => setDrill({ title: `${r.u.name}`, sections: [['Late tasks', r.late.map(taskRow)], ['Open tasks', r.open.filter((t) => !r.late.includes(t)).map(taskRow)], ['Done in the period', r.done.map(taskRow)], ['Leading', r.lead.map(projRow)]].filter(([, xs]) => xs.length) })}>
        <td><b>{r.u.name}</b></td><td className="n">{r.lead.length}</td><td className="n">{r.open.length}</td><td className="n" style={{ color: r.late.length ? 'var(--bad)' : '' }}>{r.late.length}</td><td className="n">{r.done.length}</td></tr>)}</tbody></table></div></div>
    <div className="card"><h2>Support</h2><Bars rows={Object.entries(tkSets).map(([k, xs]) => [k, xs.length])} onPick={(l) => setDrill({ title: `Support – ${l}`, rows: tkSets[l].map(tk) })} /></div>
  </div>{drill && <Drill d={drill} onClose={() => setDrill(null)} />}</>;
}

const TYPES = { lead: 'Leads', deal: 'Deals', quote: 'Quotations', receipt: 'Receipts', payment: 'Payments to collect', project: 'Projects', task: 'Tasks', ticket: 'Support requests', activity: 'Calls & meetings' };
const TYPE_SECTION = { lead: 'leads', deal: 'deals', quote: 'quotes', receipt: 'money', payment: 'money', project: 'projects', task: 'tasks', ticket: 'support', activity: 'leads' };
const GROUPS = { owner: 'Person', source: 'Source', stage: 'Stage', status: 'Status', service: 'Service', kind: 'Type', month: 'Month created', priority: 'Priority', outcome: 'Call outcome' };
const VALUE = (r) => +r.value || r.totals?.total || +r.amount || 0;
function Custom() {
  const types = Object.fromEntries(Object.entries(TYPES).filter(([k]) => can(TYPE_SECTION[k])));
  const [c, setC] = useState({ type: Object.keys(types)[0], by: 'owner', measure: 'count' });
  const rows = list(c.type), g = {};
  rows.forEach((r) => { const k = c.by === 'month' ? (r.createdAt || '').slice(0, 7) : c.by === 'owner' ? uname(r.owner || r.createdBy) : c.by === 'stage' && c.type === 'deal' ? stageLabel(r.stage) : r[c.by] || '—';
    (g[k] ||= { n: 0, v: 0 }); g[k].n++; g[k].v += VALUE(r); });
  const out = Object.entries(g).map(([k, x]) => [k, c.measure === 'count' ? x.n : x.v]).sort((a, b) => b[1] - a[1]);
  function csv() { const text = [[GROUPS[c.by], c.measure === 'count' ? 'Count' : 'Total ₹'], ...out].map((r) => r.map(csvCell).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = `report_${c.type}_by_${c.by}.csv`; a.click(); }
  return <div className="card stack"><div className="row">
    <Field label="Show"><Sel value={c.type} onChange={(v) => setC({ ...c, type: v })} options={types} /></Field>
    <Field label="Grouped by"><Sel value={c.by} onChange={(v) => setC({ ...c, by: v })} options={GROUPS} /></Field>
    <Field label="Measure"><Sel value={c.measure} onChange={(v) => setC({ ...c, measure: v })} options={[['count', 'How many'], ['sum', 'Total value ₹']]} /></Field>
    <button className="btn" type="button" onClick={csv} style={{ alignSelf: 'end' }}>Download CSV</button></div>
    {out.length ? <Bars rows={out} money={c.measure === 'sum'} /> : <Empty>No data for this report yet.</Empty>}</div>;
}
