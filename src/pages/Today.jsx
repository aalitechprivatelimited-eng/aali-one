import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, store, list, update, get } from '../api.js';
import { feedItems, forScope, diff, parse, MONTHS, escalated, inr, can, reach, desig, today, addDays, isTop, isManager, scope as level, activeUsers, stageProb, uname } from '../lib.js';
import { Seg, Pill, Due, Avs, Empty, Sample, Stat, attempt } from '../ui.jsx';
import { Reveal, Ring, m, EASE } from '../motion.jsx';
import { Ico } from '../icons.jsx';
import { openGuide } from '../guide.jsx';

// The dashboard: the numbers that matter to this person's role, each one a link to its page.
// It is built from what the person is allowed to see, so a BDE gets their own numbers, a manager the team's, management the whole group's.
const NO_REPORT = ['chairman', 'ops', 'cs', 'admin'];
function Numbers() {
  const me = store.me, t = today(), month = t.slice(0, 7), top = isTop(), mgr = isManager(), mine = level('leads') === 'own', tiles = [];
  const add = (l, v, sub, to, icon, tone = '', format) => tiles.push({ l, v, sub, to, icon, tone, format }), plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const reps = list('report').filter((r) => r.date === t);
  if (can('leads')) {
    const calls = reps.filter((r) => r.team === 'sales').flatMap((r) => r.calls || []), yes = calls.filter((c) => c.resp === 'Interested').length, back = calls.filter((c) => c.resp === 'Call back').length;
    add(mine ? 'My calls today' : 'Calls today', calls.length, `${yes} interested · ${back} to call back`, '/daily', 'calls');
    if (mine) { const mineP = list('prospect').filter((p) => p.owner === me.id && p.state === 'open'), back = mineP.filter((p) => p.backOn && p.backOn <= t).length;
      add('Still to call', mineP.filter((p) => !p.tries).length + back, back ? `${back} to call back today` : 'kept for me, not called yet', '/daily', 'clock', back ? 'warm' : ''); }
    const leads = list('lead').filter((l) => !['converted', 'junk'].includes(l.status)), late = leads.filter((l) => l.followUp && l.followUp < t).length;
    add(mine ? 'My open leads' : 'Open leads', leads.length, late ? `${plural(late, 'follow-up')} late` : 'no follow-up is late', '/leads', 'leads', late ? 'warm' : '');
    const deals = list('deal'), open = deals.filter((d) => !['won', 'lost'].includes(d.stage)), won = deals.filter((d) => d.stage === 'won' && (d.wonAt || '').startsWith(month)).reduce((s, d) => s + (+d.value || 0), 0);
    const target = list('target').filter((x) => x.month === month).reduce((s, x) => s + (+x.amount || 0), 0);
    add(mine ? 'My pipeline' : 'Open pipeline', open.reduce((s, d) => s + (+d.value || 0), 0), `${plural(open.length, 'deal')} · likely ${inr(open.reduce((s, d) => s + (+d.value || 0) * stageProb(d.stage) / 100, 0))}`, '/deals', 'deals', '', inr);
    add(`Won in ${MONTHS[+month.slice(5) - 1]}`, won, target ? `${Math.round(100 * won / target)}% of ${inr(target)} target` : 'no target set', '/deals', 'trophy', '', inr);
  }
  if (can('money')) {
    const got = list('receipt').filter((r) => (r.date || '').startsWith(month)).reduce((s, r) => s + (r.totals?.received || 0), 0);
    const due = list('payment').filter((p) => p.status !== 'paid' && p.due < t), owed = due.reduce((s, p) => s + Math.max(0, (+p.amount || 0) - (+p.paid || 0)), 0);
    add('Received this month', got, '', '/payments', 'money', '', inr); add('Overdue money', owed, due.length ? `${plural(due.length, 'payment')} past the due date` : 'nothing overdue', '/payments', 'alert', owed ? 'hot' : '', inr);
  }
  if (can('projects') && (top || me.team === 'it')) {
    const ps = list('project'), act = ps.filter((p) => !['live', 'onhold', 'awaiting'].includes(p.stage)), late = act.filter((p) => p.deadline && p.deadline < t).length, wait = ps.filter((p) => p.stage === 'awaiting').length;
    add(level('projects') === 'own' ? 'My projects' : 'Active projects', act.length, `${late ? `${late} past the delivery date` : 'none past the delivery date'}${wait ? ` · ${wait} waiting for advance` : ''}`, '/calendar', 'projects', late ? 'hot' : '');
    const tk = list('ticket').filter((x) => x.status !== 'resolved'), tl = tk.filter((x) => x.promised && x.promised < t).length;
    add('Support requests open', tk.length, tl ? `${tl} past the promised date` : 'none past the promised date', '/support', 'support', tl ? 'warm' : '');
  }
  if (!top) { const ts = list('task').filter((x) => x.status !== 'done' && (x.owner === me.id || (x.people || []).includes(me.id))), late = ts.filter((x) => x.due && x.due < t).length;
    add('My open tasks', ts.length, late ? `${late} late` : 'none late', '/tasks', 'tasks', late ? 'warm' : ''); }
  if (mgr) { // who should write a report today, and how far they are
    const writers = activeUsers().filter((u) => !NO_REPORT.includes(u.title) && (top || u.team === me.team)), ids = new Set(writers.map((u) => u.id));
    const seen = reps.filter((r) => ids.has(r.owner)), done = seen.filter((r) => r.status === 'submitted').length;
    add('Daily reports today', `${done} of ${writers.length}`, `${seen.length - done} in progress · ${writers.length - seen.length} not started`, '/daily', 'daily', writers.length - seen.length ? 'warm' : '');
  } else { const r = reps.find((x) => x.owner === me.id);
    add('My daily report', !r ? 'Not started' : r.status === 'submitted' ? 'Submitted' : 'In progress', !r ? 'press Start my day' : r.status === 'submitted' ? 'well done' : 'submit it at the end of the day', '/daily', 'daily', r ? '' : 'warm'); }
  if (can('assets') && mgr) { const w = list('asset').filter((a) => a.status === 'sent' && (top || (a.to === 'it') === (me.team === 'it'))).length;
    add('Client assets waiting', w, 'to be given to a person', '/assets', 'assets', w ? 'warm' : ''); }
  if (can('calls') && !mine) { const ps = list('prospect'), dnc = ps.filter((p) => p.state === 'dnc').length;
    add('Do not call', dnc, `${ps.filter((p) => ['tired', 'closed'].includes(p.state)).length} more stopped`, '/calls', 'stop', dnc ? 'hot' : ''); }
  return <div className="stats" data-guide="numbers">{tiles.map((x) => <Stat key={x.l} label={x.l} value={x.v} format={x.format} sub={x.sub} to={x.to} icon={x.icon} tone={x.tone} />)}</div>;
}

// The welcome card: who you are, what today is, and the one thing to do next.
function Hero() {
  const me = store.me, t = today(), month = t.slice(0, 7), hour = new Date().getHours(), top = isTop(), mgr = isManager(), writes = !NO_REPORT.includes(me.title);
  const rep = list('report').find((r) => r.owner === me.id && r.date === t), caller = me.team === 'sales' && level('leads') === 'own';
  const won = can('leads') ? list('deal').filter((d) => d.stage === 'won' && (d.wonAt || '').startsWith(month)).reduce((s, d) => s + (+d.value || 0), 0) : 0;
  const target = can('leads') ? list('target').filter((x) => x.month === month).reduce((s, x) => s + (+x.amount || 0), 0) : 0;
  const next = !writes ? 'Here is how the group is doing today.' : !rep ? 'Your day has not started yet. Start it and add each task as you take it up.' : rep.status === 'submitted' ? 'Your report for today is submitted. Well done.' : 'Your day is running. Keep adding each task as you take it up.';
  return <m.section className="hero" data-guide="hero" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: EASE }}>
    <button type="button" className="btn sm guide-btn" data-guide="guide-btn" onClick={openGuide} title="A guided walk through every section your login can open"><Ico k="help" size={16} />Guide</button>
    <div><h1>Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {me.display || me.name.split(' ')[0]}</h1>
      <div className="sub">{desig(me)} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div className="sub">{next}</div>
      <div className="acts-row">
        {writes && rep?.status !== 'submitted' && <Link className="btn primary" to="/daily"><Ico k="play" size={15} />{rep ? 'Continue my report' : 'Start my day'}</Link>}
        {caller && rep && rep.status !== 'submitted' && <Link className="btn" to="/daily" state={{ dial: true }}><Ico k="calls" size={16} />Open my calling list</Link>}
        {mgr && <Link className="btn" to="/daily"><Ico k="daily" size={16} />{top ? 'Read today’s reports' : 'My team’s reports'}</Link>}
        {can('reports') && <Link className="btn" to="/reports"><Ico k="reports" size={16} />Full reports</Link>}
      </div></div>
    {target > 0 && <div className="hero-side"><Ring pct={Math.round(100 * won / target)} label="of target" />
      <div className="cap"><b>{inr(won)}</b>won in {MONTHS[+month.slice(5) - 1]}, of a {inr(target)} target</div></div>}
  </m.section>;
}

// People in my team (for management: everyone) who are out of the office right now – on a client visit, or out with permission.
function OutNow() {
  const t = today(), out = list('presence').filter((p) => p.out && p.date === t && p.user !== store.me.id);
  if (!out.length) return null;
  return <Reveal className="out-now"><Ico k="door" /><b>Out of office now ({out.length})</b>
    {out.map((p) => <span key={p.user} className="pill warn" style={{ background: 'var(--paper)' }}>{uname(p.user)} · {p.why} · since {new Date(p.since).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>)}</Reveal>;
}

const KIND = { task: 'Task', lead: 'Lead', deal: 'Deal', cadence: 'Follow-up plan', activity: 'Call / meeting', payment: 'Payment', project: 'Project', ticket: 'Support', callback: 'Call back' };

export default function Today() {
  useStore();
  const me = store.me, [scope, setScope] = useState('mine'), wide = reach('today');
  const items = forScope(feedItems(), scope), t = today();
  const over = items.filter((i) => i.due < t), now = items.filter((i) => i.due === t), week = items.filter((i) => i.due > t && diff(i.due) <= 7);
  const esc = items.filter((i) => escalated(i.due));
  const pending = can('approvals') ? list('approval').filter((a) => a.status === 'pending') : [];
  const notes = list('notice').filter((n) => n.to === me.id && !n.read).slice(0, 5);
  return (
    <>
      <Hero />
      <OutNow />
      <Numbers />
      <div className="row between" style={{ margin: '8px 0 10px' }}><h2 style={{ margin: 0 }}>What needs attention</h2>{wide.length > 1 && <Seg value={scope} onChange={setScope} options={wide} />}</div>
      <div className="stats" data-guide="attention">
        <Stat label="Overdue" value={over.length} tone={over.length ? 'hot' : ''} sub={esc.length ? `${esc.length} escalated to management` : 'follow-ups, tasks, payments'} />
        <Stat label="Due today" value={now.length} tone={now.length ? 'warm' : ''} />
        <Stat label="Next 7 days" value={week.length} />
        <Stat label="Unread notifications" value={notes.length} to="/inbox" />
        {can('approvals') && <Stat label="Waiting for your approval" value={pending.length} tone={pending.length ? 'warm' : ''} to="/approvals" />}
      </div>
      {!items.length && <Empty>Nothing due in the next 7 days{scope !== 'all' ? ' for this view' : ''}. Add follow-up dates to leads and deals, or create a task.</Empty>}
      <Group title="Overdue" list={over} /><Group title="Due today" list={now} /><Group title="Next 7 days" list={week} />
    </>
  );
}

function Group({ title, list: items }) {
  if (!items.length) return null;
  return <Reveal style={{ marginBottom: 22 }}><h2 style={{ marginBottom: 10 }}>{title} <span className="pill">{items.length}</span></h2>
    <div className="list">{items.map((i) => <Row key={i.kind + i.id} i={i} />)}</div></Reveal>;
}
function Row({ i }) {
  const d = parse(i.due);
  const cls = i.due < today() ? 'over' : i.due === today() ? 'today' : '';
  async function done() {
    if (i.kind === 'task') await attempt(() => update(i.id, { status: 'done' }), 'Task done.');
    if (i.kind === 'activity') await attempt(() => update(i.id, { status: 'done' }), 'Marked done.');
    if (i.kind === 'cadence') { const [id, step] = i.id.split(':'); const deal = get(id); await attempt(() => update(id, { cadence: { ...deal.cadence, done: [...(deal.cadence.done || []), +step] }, _note: `Follow-up step done: ${i.title}` }), 'Step done.'); }
    if (i.kind === 'deal' || i.kind === 'lead') await attempt(() => update(i.id, { followUp: addDays(today(), 2), _note: 'Follow-up done; next in 2 days' }), 'Next follow-up set for 2 days from now.');
  }
  return (
    <div className="li">
      <div className={'when ' + cls}><b>{d.getDate()}</b><span>{MONTHS[d.getMonth()]}</span></div>
      <div className="grow"><Link to={i.link} className="t" style={{ color: 'inherit' }}>{i.title}</Link>
        <div className="row small" style={{ marginTop: 2 }}><Due date={i.due} />{i.time && <span className="num">{i.time}</span>}{escalated(i.due) && <Pill k="esc">Escalated</Pill>}<Pill>{KIND[i.kind]}</Pill>
          {i.priority === 'high' && <Pill k="warn">High priority</Pill>}{i.amount ? <span className="num">{inr(i.amount)}</span> : null}<Sample on={i.sample} /></div></div>
      <Avs ids={[i.owner, ...(i.people || [])]} />
      {['task', 'activity', 'cadence', 'deal', 'lead'].includes(i.kind) && <button className="btn sm" type="button" onClick={done}>Done</button>}
      {i.kind === 'callback' ? (i.owner === store.me.id ? <Link className="btn sm primary" to="/daily" state={{ dial: true, pick: i.id }}>Call now</Link> : <Link className="btn sm ghost" to="/calls">Open</Link>)
        : <Link className="btn sm ghost" to={i.link}>Open</Link>}
    </div>
  );
}
