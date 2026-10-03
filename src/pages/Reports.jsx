import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, list, create, update, store } from '../api.js';
import { settings, uname, inr, today, addDays, diff, stageProb, stageLabel, pStageLabel, isTop, can, bdes, activeUsers, MONTHS, csvCell } from '../lib.js';
import { Empty, Pill, In, Sel, Field, Tabs, attempt } from '../ui.jsx';
import { progress } from './Projects.jsx';

function Bars({ rows, money }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return <div className="stack gap4">{rows.map(([l, v, sub]) => <div key={l} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,170px) 1fr 90px', gap: 10, alignItems: 'center', fontSize: 13 }}>
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l}>{l}</span><div className="bar" style={{ height: 10 }}><i style={{ width: (100 * v / max) + '%' }} /></div>
    <span className="num" style={{ textAlign: 'right' }}>{money ? inr(v) : v}{sub ? <span className="muted"> {sub}</span> : null}</span></div>)}</div>;
}

export default function Reports() {
  useStore(); const team = store.me.team;
  const tabs = [isTop() && ['overview', 'Overview'], (isTop() || team === 'sales') && ['sales', 'Sales & BDEs'], (isTop() || team === 'it') && ['delivery', 'Projects & IT'], ['custom', 'Build a report']].filter(Boolean);
  const [tab, setTab] = useState(tabs[0][0]);
  return <><div className="topbar"><h1>Reports</h1></div>
    <Tabs value={tab} onChange={setTab} tabs={tabs} />
    {tab === 'overview' && <Overview />}{tab === 'sales' && <Sales />}{tab === 'delivery' && <Delivery />}{tab === 'custom' && <Custom />}</>;
}

function Overview() {
  const t = today(), month = t.slice(0, 7), deals = list('deal'), open = deals.filter((d) => !['won', 'lost'].includes(d.stage));
  const won = deals.filter((d) => d.stage === 'won' && (d.wonAt || '').startsWith(month)), target = list('target').filter((x) => x.month === month).reduce((s, x) => s + (+x.amount || 0), 0);
  const got = list('receipt').filter((r) => r.date.startsWith(month)).reduce((s, r) => s + (r.totals?.received || 0), 0);
  const overdue = list('payment').filter((p) => p.status !== 'paid' && p.due < t).reduce((s, p) => s + Math.max(0, p.amount - (p.paid || 0)), 0);
  const projects = list('project'), active = projects.filter((p) => !['live', 'onhold', 'awaiting'].includes(p.stage));
  const ratings = list('signoff').map((s) => +s.rating).filter(Boolean), avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const leads = list('lead'), qual = leads.filter((l) => ['qualified', 'converted'].includes(l.status)).length, quoted = deals.filter((d) => d.quoteNo).length, wonAll = deals.filter((d) => d.stage === 'won').length;
  const lost = deals.filter((d) => d.stage === 'lost'), reasons = {}; lost.forEach((d) => (reasons[d.lostReason || 'Not given'] = (reasons[d.lostReason || 'Not given'] || 0) + 1));
  const src = {}; leads.forEach((l) => { const s = (src[l.source] ||= { n: 0, won: 0 }); s.n++; const d = deals.find((x) => x.leadId === l.id); if (d?.stage === 'won') s.won += +d.value || 0; });
  return <div className="stack gap16">
    <div className="stats">
      <div className="stat"><span className="l">Open pipeline</span><span className="v">{inr(open.reduce((s, d) => s + (+d.value || 0), 0))}</span><span className="small muted">likely {inr(open.reduce((s, d) => s + (+d.value || 0) * stageProb(d.stage) / 100, 0))}</span></div>
      <div className="stat"><span className="l">Won in {MONTHS[+month.slice(5) - 1]}</span><span className="v">{inr(won.reduce((s, d) => s + (+d.value || 0), 0))}</span><span className="small muted">{target ? `target ${inr(target)}` : 'no target set'}</span></div>
      <div className="stat"><span className="l">Received this month</span><span className="v">{inr(got)}</span></div>
      <div className={'stat' + (overdue ? ' hot' : '')}><span className="l">Overdue money</span><span className="v">{inr(overdue)}</span></div>
      <div className="stat"><span className="l">Active projects</span><span className="v">{active.length}</span><span className="small muted">{active.filter((p) => p.deadline && diff(p.deadline) < 0).length} past deadline</span></div>
      <div className="stat"><span className="l">Client happiness</span><span className="v">{avg ? avg.toFixed(1) + ' ★' : '—'}</span><span className="small muted">{ratings.length} ratings</span></div>
    </div>
    <div className="grid2">
      <div className="card"><h2>Sales funnel</h2><Bars rows={[['Leads', leads.length], ['Qualified / converted', qual], ['Quotation sent', quoted], ['Won', wonAll]]} /></div>
      <div className="card"><h2>Pipeline by stage</h2><Bars money rows={settings().pipeline.filter((s) => s.key !== 'lost').map((s) => [s.label, deals.filter((d) => d.stage === s.key).reduce((a, d) => a + (+d.value || 0), 0)])} /></div>
      <div className="card"><h2>Leads by source</h2>{Object.keys(src).length ? <div className="tbl"><table><thead><tr><th>Source</th><th className="n">Leads</th><th className="n">Won value</th></tr></thead><tbody>
        {Object.entries(src).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => <tr key={k}><td>{k}</td><td className="n">{v.n}</td><td className="n">{inr(v.won)}</td></tr>)}</tbody></table></div> : <p className="muted">No leads yet.</p>}</div>
      <div className="card"><h2>Why deals were lost</h2>{lost.length ? <Bars rows={Object.entries(reasons).sort((a, b) => b[1] - a[1])} /> : <p className="muted">No lost deals.</p>}
        <p className="small muted">Win rate: {wonAll + lost.length ? Math.round(100 * wonAll / (wonAll + lost.length)) : 0}% of closed deals.</p></div>
      <div className="card"><h2>Low ratings to follow up</h2>{list('signoff').filter((s) => +s.rating && +s.rating <= 3).map((s) => <div key={s.id} className="small">{'★'.repeat(s.rating)} {s.project} – {s.ratingComment || 'no comment'}</div>)}
        {!list('signoff').some((s) => +s.rating && +s.rating <= 3) && <p className="muted small">None. Every rating is 4★ or above.</p>}</div>
    </div></div>;
}

function Sales() {
  const month = today().slice(0, 7), from = addDays(today(), -6), [m, setM] = useState(month);
  const rows = bdes().map((u) => {
    const ds = list('deal').filter((d) => d.owner === u.id), open = ds.filter((d) => !['won', 'lost'].includes(d.stage)), won = ds.filter((d) => d.stage === 'won' && (d.wonAt || '').startsWith(m));
    const calls = list('activity').filter((a) => a.owner === u.id && a.kind === 'call' && (a.at || '') >= from).length;
    const fuLate = [...list('lead').filter((l) => l.owner === u.id && !['converted', 'junk'].includes(l.status)), ...open].filter((x) => x.followUp && diff(x.followUp) < 0).length;
    const target = +(list('target').find((x) => x.userId === u.id && x.month === m)?.amount || 0), wonV = won.reduce((s, d) => s + (+d.value || 0), 0);
    const payLate = list('payment').filter((p) => p.owner === u.id && p.status !== 'paid' && diff(p.due) < 0).reduce((s, p) => s + Math.max(0, p.amount - (p.paid || 0)), 0);
    return { u, open: open.length, pipe: open.reduce((s, d) => s + (+d.value || 0), 0), calls, fuLate, wonV, wonN: won.length, target, payLate, leads: list('lead').filter((l) => l.owner === u.id && (l.createdAt || '').startsWith(m)).length };
  }).sort((a, b) => b.wonV - a.wonV);
  return <div className="stack gap16"><div className="row"><Field label="Month"><In type="month" value={m} onChange={(e) => setM(e.target.value)} /></Field></div>
    <div className="tbl"><table><thead><tr><th>BDE</th><th className="n">New leads</th><th className="n">Calls (7 days)</th><th className="n">Open deals</th><th className="n">Pipeline</th><th className="n">Follow-ups late</th><th className="n">Won</th><th className="n">Target</th><th className="n">Payments late</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.u.id}><td><b>{r.u.name}</b></td><td className="n">{r.leads}</td><td className="n">{r.calls}</td><td className="n">{r.open}</td><td className="n">{inr(r.pipe)}</td><td className="n" style={{ color: r.fuLate ? 'var(--bad)' : '' }}>{r.fuLate}</td>
        <td className="n">{inr(r.wonV)} ({r.wonN})</td><td className="n">{r.target ? `${Math.round(100 * r.wonV / r.target)}% of ${inr(r.target)}` : '—'}</td><td className="n" style={{ color: r.payLate ? 'var(--bad)' : '' }}>{r.payLate ? inr(r.payLate) : '—'}</td></tr>)}
      {!rows.length && <tr><td colSpan="9" className="muted">Add BDEs in Settings → People.</td></tr>}</tbody></table></div>
    {(store.me.isAdmin || store.me.title === 'salesmgr') && <Targets month={m} />}</div>;
}

function Targets({ month }) {
  const [v, setV] = useState({});
  return <div className="card stack"><h2>Monthly targets ({month})</h2><p className="small muted" style={{ margin: 0 }}>Set how much each BDE should win this month. It shows on the scoreboard and the pipeline.</p>
    {bdes().map((u) => { const t = list('target').find((x) => x.userId === u.id && x.month === month); return <div key={u.id} className="row"><span style={{ width: 180 }}>{u.name}</span>
      <In type="number" placeholder="₹ target" defaultValue={t?.amount || ''} onChange={(e) => setV({ ...v, [u.id]: e.target.value })} style={{ maxWidth: 160 }} />
      <button className="btn sm" type="button" disabled={v[u.id] === undefined} onClick={() => attempt(() => (t ? update(t.id, { amount: +v[u.id] || 0 }) : create('target', { userId: u.id, month, amount: +v[u.id] || 0 })), 'Target saved.')}>Save</button></div>; })}</div>;
}

function Delivery() {
  const projects = list('project'), tasks = list('task').filter((t) => t.status !== 'done');
  const it = activeUsers().filter((u) => u.team === 'it').map((u) => ({ u, open: tasks.filter((t) => t.owner === u.id).length, late: tasks.filter((t) => t.owner === u.id && t.due && diff(t.due) < 0).length, lead: projects.filter((p) => p.lead === u.id && !['live', 'onhold'].includes(p.stage)).length })).sort((a, b) => b.open - a.open);
  const risk = projects.filter((p) => p.deadline && !['live', 'onhold', 'awaiting'].includes(p.stage) && (diff(p.deadline) < 0 || (diff(p.deadline) <= 7 && progress(p.id) < 70)));
  const tickets = list('ticket');
  return <div className="grid2">
    <div className="card"><h2>Projects by stage</h2><Bars rows={settings().projectStages.map((s) => [s.label, projects.filter((p) => p.stage === s.key).length])} /></div>
    <div className="card"><h2>Projects at risk</h2>{risk.length ? risk.map((p) => <div key={p.id} className="row small"><Link to={'/projects/' + p.id} className="grow">{p.name}</Link><span>{pStageLabel(p.stage)}</span><span className="num">{progress(p.id)}%</span><span className="num" style={{ color: diff(p.deadline) < 0 ? 'var(--bad)' : '' }}>{p.deadline}</span></div>) : <p className="muted small">None.</p>}</div>
    <div className="card"><h2>IT workload</h2><div className="tbl"><table><thead><tr><th>Person</th><th className="n">Leading</th><th className="n">Open tasks</th><th className="n">Late</th></tr></thead><tbody>
      {it.map((r) => <tr key={r.u.id}><td>{r.u.name}</td><td className="n">{r.lead}</td><td className="n">{r.open}</td><td className="n" style={{ color: r.late ? 'var(--bad)' : '' }}>{r.late}</td></tr>)}</tbody></table></div></div>
    <div className="card"><h2>Support</h2><Bars rows={[['Open', tickets.filter((t) => t.status !== 'resolved').length], ['Past promised date', tickets.filter((t) => t.status !== 'resolved' && t.promised && diff(t.promised) < 0).length], ['Resolved', tickets.filter((t) => t.status === 'resolved').length]]} /></div>
  </div>;
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
