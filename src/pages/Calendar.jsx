// Calendar: every dated thing by day, plus every project's run from start to delivery with how far it has really come.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, store, list, get } from '../api.js';
import { feedItems, forScope, iso, parse, MONTHS, today, addDays, diff, rel, fmtDate, isManager, pStageLabel, projectProgress, daysBetween, uname, reach, can } from '../lib.js';
import { Seg, Pill, Empty, Sample } from '../ui.jsx';

const COLOR = { task: 'info', lead: 'gold', deal: 'gold', cadence: 'gold', activity: 'ok', payment: 'warn', project: 'bad', ticket: 'bad', start: '', milestone: 'info', delivery: 'bad', delivered: 'ok' };
const GROUPS = [['proj', 'Projects', 'bad', ['project', 'start', 'milestone', 'delivery', 'delivered'], 'projects'], ['follow', 'Follow-ups', 'gold', ['lead', 'deal', 'cadence'], 'leads'], ['meet', 'Calls & meetings', 'ok', ['activity', 'callback'], 'leads'],
  ['task', 'Tasks', 'info', ['task'], 'tasks'], ['pay', 'Payments', 'warn', ['payment'], 'money'], ['help', 'Support', 'bad', ['ticket'], 'support']];
const HUES = ['#b87400', '#2f5fa8', '#2f7d54', '#8a4fa8', '#b23a32', '#1f8a8a', '#a8620a', '#5b6b7a'];
const STEPS = ['planning', 'design', 'development', 'testing', 'live'];
const clamp = (n) => Math.max(0, Math.min(100, n));

// One row per project: dates, real progress, where it should be by today, and its milestones.
function projectRows(scope) {
  const me = store.me;
  return list('project').filter((p) => scope !== 'mine' || isManager() || p.lead === me.id || (p.people || []).includes(me.id) || p.createdBy === me.id).map((p) => {
    const live = p.stage === 'live', start = p.start || (p.createdAt || '').slice(0, 10) || today();
    const end = live ? p.liveAt || p.deadline || start : p.deadline || '', span = end ? Math.max(1, daysBetween(start, end)) : 0, pct = projectProgress(p);
    const should = !end || live ? null : clamp(Math.round(100 * daysBetween(start, today()) / span));
    const ms = list('task').filter((t) => t.projectId === p.id && t.milestone && t.due).sort((a, b) => a.due.localeCompare(b.due));
    const state = live ? ['Delivered', 'ok'] : p.stage === 'onhold' ? ['On hold', ''] : p.stage === 'awaiting' ? ['Waiting for advance', 'warn'] : !p.deadline ? ['No delivery date', '']
      : diff(p.deadline) < 0 ? [`${-diff(p.deadline)} day${diff(p.deadline) === -1 ? '' : 's'} late`, 'bad'] : pct + 15 < should ? ['Behind plan', 'warn'] : ['On track', 'ok'];
    return { p, live, start, end, pct, should, ms, state, reach: end ? addDays(start, Math.round(span * pct / 100)) : start };
  }).sort((a, b) => a.live - b.live || (a.end || '9').localeCompare(b.end || '9')).map((r, i) => ({ ...r, color: HUES[i % HUES.length] }));
}
function projectEvents(rows) {
  const out = [];
  for (const { p, live, start, pct, ms, color } of rows) {
    const base = { link: '/projects/' + p.id, sample: p.sample, color, owner: p.lead };
    out.push({ ...base, kind: 'start', id: p.id + ':s', due: start, title: `Start: ${p.name}` });
    for (const t of ms) out.push({ ...base, kind: 'milestone', id: t.id, due: t.due, done: t.status === 'done', title: `${t.status === 'done' ? '◆✓' : '◆'} ${t.title} – ${p.name}` });
    if (live) out.push({ ...base, kind: 'delivered', id: p.id + ':l', due: p.liveAt || p.deadline || start, title: `Delivered: ${p.name}` });
    else if (p.deadline) out.push({ ...base, kind: 'delivery', id: p.id + ':d', due: p.deadline, title: `Delivery: ${p.name} · ${pStageLabel(p.stage)} · ${pct}%` });
  }
  return out;
}

export default function Calendar() {
  useStore();
  const wide = reach('calendar'), [scope, setScope] = useState(wide.at(-1)[0]), [view, setView] = useState('month'), [sel, setSel] = useState(today()), [off, setOff] = useState([]);
  const [m, setM] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const first = new Date(m), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = [...Array(42)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return iso(d); });
  const shift = (n) => setM(new Date(m.getFullYear(), m.getMonth() + n, 1));
  const rows = projectRows(scope), hidden = GROUPS.filter((g) => off.includes(g[0])).flatMap((g) => g[3]);
  // The feed's own project-deadline and milestone lines are replaced by the richer project events.
  const feed = forScope(feedItems(), scope).filter((i) => !(i.kind === 'project' && !i.id.endsWith(':lead')) && !(i.kind === 'task' && get(i.id)?.milestone && get(i.id)?.projectId));
  const items = [...feed, ...projectEvents(rows)].filter((i) => !hidden.includes(i.kind));
  const lanes = off.includes('proj') ? [] : rows.filter((r) => r.end && r.start <= days[41] && r.end >= days[0]).slice(0, 8);
  return <>
    <div className="topbar"><h1>{MONTHS[m.getMonth()]} {m.getFullYear()}</h1><div className="row">
      <Seg value={view} onChange={setView} options={[['month', 'Month'], ['projects', 'Project progress']]} />
      {wide.length > 1 && <Seg value={scope} onChange={setScope} options={wide} />}
      <button className="btn sm" type="button" onClick={() => shift(-1)} aria-label="Previous month">←</button><button className="btn sm" type="button" onClick={() => { setM(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); setSel(today()); }}>Today</button><button className="btn sm" type="button" onClick={() => shift(1)} aria-label="Next month">→</button></div></div>
    {view === 'projects' ? <Timeline rows={rows} from={addDays(days[0], -28)} /> : <>
      <div className="row small" style={{ marginBottom: 8 }}><span className="muted">Show:</span>{GROUPS.filter((g) => can(g[4])).map(([k, l, c]) => <button key={k} type="button" className={'pill ' + (off.includes(k) ? '' : c)} aria-pressed={!off.includes(k)}
        style={{ border: 'none', opacity: off.includes(k) ? 0.55 : 1, textDecoration: off.includes(k) ? 'line-through' : 'none' }} onClick={() => setOff(off.includes(k) ? off.filter((x) => x !== k) : [...off, k])}>{l}</button>)}</div>
      <div className="tbl"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(110px,1fr))', minWidth: 780 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="calhead">{d}</div>)}
        {days.map((d) => { const its = items.filter((i) => i.due === d), inMonth = parse(d).getMonth() === m.getMonth();
          return <div key={d} className={'calday' + (d === today() ? ' now' : '') + (d === sel ? ' sel' : '')} style={{ opacity: inMonth ? 1 : 0.5 }} onClick={() => setSel(d)}>
            <div className="num small" style={{ fontWeight: d === today() ? 700 : 400 }}>{parse(d).getDate()}</div>
            {lanes.map((r) => <div key={r.p.id} className="lane" title={`${r.p.name} · ${pStageLabel(r.p.stage)} · ${r.pct}%`} style={d < r.start || d > r.end ? { background: 'none' } : { background: r.color, opacity: d <= r.reach ? 1 : 0.25,
              borderRadius: `${d === r.start ? 4 : 0}px ${d === r.end ? 4 : 0}px ${d === r.end ? 4 : 0}px ${d === r.start ? 4 : 0}px`, marginLeft: d === r.start ? 0 : -5, marginRight: d === r.end ? 0 : -5 }} />)}
            {its.slice(0, 4).map((i) => <Link key={i.kind + i.id} to={i.link} className={'pill ' + COLOR[i.kind]} style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '2px 0', textDecoration: 'none', borderLeft: i.color ? `3px solid ${i.color}` : '' }} title={i.title}>{i.time ? i.time + ' ' : ''}{i.title}</Link>)}
            {its.length > 4 && <div className="small muted">+{its.length - 4} more</div>}</div>; })}
      </div></div>
      {lanes.length > 0 && <div className="row small" style={{ margin: '8px 0' }}><span className="muted">Project lines (dark = work done so far, light = still to do):</span>
        {lanes.map((r) => <Link key={r.p.id} to={'/projects/' + r.p.id} className="row" style={{ gap: 5, textDecoration: 'none', color: 'inherit' }}><i style={{ width: 14, height: 6, borderRadius: 3, background: r.color, display: 'inline-block' }} />{r.p.name} <span className="num muted">{r.pct}%</span></Link>)}</div>}
      <Day d={sel} items={items.filter((i) => i.due === sel)} running={off.includes('proj') ? [] : rows.filter((r) => r.end && r.start <= sel && r.end >= sel)} />
    </>}
  </>;
}

function Day({ d, items, running }) {
  return <div className="card stack" style={{ marginTop: 12 }}><h2 style={{ margin: 0 }}>{parse(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} <span className="small muted">{rel(d)}</span></h2>
    {items.length ? <div className="list">{items.map((i) => <Link key={i.kind + i.id} to={i.link} className="li" style={{ padding: '7px 12px' }}>
      <Pill k={COLOR[i.kind]}>{{ start: 'Project start', milestone: 'Milestone', delivery: 'Delivery date', delivered: 'Delivered', activity: 'Call / meeting', cadence: 'Follow-up', lead: 'Lead', deal: 'Deal', task: 'Task', payment: 'Payment', ticket: 'Support', project: 'Project' }[i.kind]}</Pill>
      <span className="grow">{i.time ? i.time + ' · ' : ''}{i.title}</span>{i.owner && <span className="small muted">{uname(i.owner)}</span>}<Sample on={i.sample} /></Link>)}</div>
      : <p className="muted small" style={{ margin: 0 }}>Nothing is due on this day.</p>}
    {running.length > 0 && <><span className="lbl">Projects running on this day</span>
      {running.map((r) => <Link key={r.p.id} to={'/projects/' + r.p.id} className="row" style={{ textDecoration: 'none', color: 'inherit' }}><i style={{ width: 10, height: 10, borderRadius: 3, background: r.color, flex: 'none' }} />
        <span className="grow">{r.p.name}</span><Pill>{pStageLabel(r.p.stage)}</Pill><Pill k={r.state[1]}>{r.state[0]}</Pill>
        <div className="bar" style={{ width: 90 }}><i style={{ width: r.pct + '%', background: r.color }} /></div><span className="num small" style={{ width: 36, textAlign: 'right' }}>{r.pct}%</span></Link>)}</>}
  </div>;
}

// ---------- project progress: one line per project from start to delivery ----------
function Timeline({ rows, from: ws }) {
  // 12 weeks: 4 before the month on screen and 8 after its first week, so the finished part of long projects stays in view.
  const N = 84, we = addDays(ws, N - 1), weeks = [...Array(N / 7)].map((_, i) => addDays(ws, i * 7)), pos = (d, edge = 0) => clamp(100 * (daysBetween(ws, d) + edge) / N), t = today();
  const shown = rows.filter((r) => !r.live || (r.end >= ws && r.end <= we)), act = shown.filter((r) => !r.live);
  const n = (k) => act.filter((r) => r.state[1] === k && r.p.stage !== 'awaiting').length;
  const Axis = () => <div className="track axis">{weeks.filter((_, i) => i % 2 === 0).map((d) => <span key={d} className="num" style={{ left: pos(d) + '%' }}>{fmtDate(d)}</span>)}</div>;
  if (!shown.length) return <Empty>No projects to show. Projects appear here as soon as a won deal is handed to the IT team.</Empty>;
  return <>
    <div className="stats">
      <div className="stat"><span className="l">Projects in hand</span><span className="v">{act.length}</span></div>
      <div className="stat"><span className="l">On track</span><span className="v" style={{ color: 'var(--ok)' }}>{n('ok')}</span></div>
      <div className={'stat' + (n('warn') ? ' warm' : '')}><span className="l">Behind plan</span><span className="v">{n('warn')}</span></div>
      <div className={'stat' + (n('bad') ? ' hot' : '')}><span className="l">Past delivery date</span><span className="v">{n('bad')}</span></div>
      <div className="stat"><span className="l">Waiting for advance</span><span className="v">{act.filter((r) => r.p.stage === 'awaiting').length}</span></div>
    </div>
    <p className="small muted" style={{ marginTop: -6 }}>Each bar runs from the start date to the delivery date. The dark part is the work really finished. The red line is today: if the dark part stops before the red line, the project is behind. ◆ is a milestone, ⚑ is the delivery date.</p>
    <div className="card" style={{ padding: '6px 14px', marginBottom: 10 }}><Axis /></div>
    <div className="stack">{shown.map((r) => { const { p } = r, at = STEPS.indexOf(p.stage), next = r.ms.find((x) => x.status !== 'done');
      return <div className="card stack" key={p.id} style={{ gap: 8 }}>
        <div className="row between"><div className="row"><i style={{ width: 10, height: 10, borderRadius: 3, background: r.color, flex: 'none' }} /><Link to={'/projects/' + p.id} style={{ fontWeight: 700, color: 'inherit' }}>{p.name}</Link>
          <span className="small muted">{p.clientName || ''}{p.lead ? ` · lead ${uname(p.lead)}` : ' · no lead yet'}</span><Sample on={p.sample} /></div>
          <div className="row"><Pill k={r.state[1]}>{r.state[0]}</Pill><b className="num">{r.pct}%</b></div></div>
        <div className="row small" style={{ gap: 4 }}>{p.stage === 'awaiting' && <Pill k="warn">Waiting for advance – work not started</Pill>}{p.stage === 'onhold' && <Pill>On hold</Pill>}
          {STEPS.map((s, i) => <span key={s} className={'step' + (i < at ? ' done' : i === at ? ' cur' : '')}>{i < at ? '✓ ' : ''}{pStageLabel(s)}</span>)}</div>
        <div className="track">
          {weeks.map((d) => <i key={d} className="wk" style={{ left: pos(d) + '%' }} />)}
          {r.end && <><div className="tbar" style={{ left: pos(r.start) + '%', width: pos(r.end, 1) - pos(r.start) + '%', background: r.color, opacity: 0.25 }} />
            <div className="tbar" style={{ left: pos(r.start) + '%', width: Math.max(0, pos(r.start, (daysBetween(r.start, r.end) + 1) * r.pct / 100) - pos(r.start)) + '%', background: r.color }} />
            {r.end >= ws && r.end <= we && <span className="mark" style={{ left: pos(r.end, 0.5) + '%', color: r.live ? 'var(--ok)' : diff(r.end) < 0 ? 'var(--bad)' : 'var(--ink)', top: -3, fontSize: 15 }} title={`${r.live ? 'Delivered' : 'Delivery date'}: ${fmtDate(r.end)}`}>⚑</span>}</>}
          {r.ms.filter((x) => x.due >= ws && x.due <= we).map((x) => <span key={x.id} className="mark" title={`${x.title} · ${fmtDate(x.due)}${x.status === 'done' ? ' · done' : ''}`}
            style={{ left: pos(x.due, 0.5) + '%', color: x.status === 'done' ? 'var(--ok)' : diff(x.due) < 0 ? 'var(--bad)' : 'var(--ink)' }}>◆</span>)}
          {t >= ws && t <= we && <i className="now" style={{ left: pos(t, 0.5) + '%' }} />}
        </div>
        <div className="small muted">{r.end ? <>Start {fmtDate(r.start)} → {r.live ? 'delivered' : 'delivery'} <b style={{ color: 'var(--ink)' }}>{fmtDate(r.end)}</b>{!r.live && ` (${rel(r.end).toLowerCase()})`}</> : 'No delivery date set yet.'}
          {r.should != null && !['awaiting', 'onhold'].includes(p.stage) && <> · By today it should be about <b style={{ color: 'var(--ink)' }}>{r.should}%</b>; it is at <b style={{ color: 'var(--ink)' }}>{r.pct}%</b>.</>}
          {next && <> · Next milestone: {next.title} ({fmtDate(next.due)})</>}</div>
      </div>; })}</div>
  </>;
}
