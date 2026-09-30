import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, store, list, update, get } from '../api.js';
import { feedItems, forScope, diff, parse, MONTHS, escalated, inr, isManager, TITLES, today, addDays } from '../lib.js';
import { Seg, Pill, Due, Avs, Empty, Sample, attempt } from '../ui.jsx';

const KIND = { task: 'Task', lead: 'Lead', deal: 'Deal', cadence: 'Follow-up plan', activity: 'Call / meeting', payment: 'Payment', project: 'Project', ticket: 'Support' };

export default function Today() {
  useStore();
  const me = store.me, [scope, setScope] = useState(isManager() ? 'mine' : 'mine');
  const items = forScope(feedItems(), scope), t = today();
  const over = items.filter((i) => i.due < t), now = items.filter((i) => i.due === t), week = items.filter((i) => i.due > t && diff(i.due) <= 7);
  const esc = items.filter((i) => escalated(i.due));
  const pending = isManager() ? list('approval').filter((a) => a.status === 'pending') : [];
  const notes = list('notice').filter((n) => n.to === me.id && !n.read).slice(0, 5);
  const hour = new Date().getHours();
  return (
    <>
      <div className="topbar"><h1>Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {me.name.split(' ')[0]} <small>{TITLES[me.title]} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</small></h1>
        <Seg value={scope} onChange={setScope} options={[['mine', 'For me'], ['team', 'My team'], ['all', 'Everyone']]} /></div>
      <div className="stats">
        <div className={'stat' + (over.length ? ' hot' : '')}><span className="l">Overdue</span><span className="v">{over.length}</span><span className="small muted">{esc.length ? `${esc.length} escalated to management` : 'follow-ups, tasks, payments'}</span></div>
        <div className={'stat' + (now.length ? ' warm' : '')}><span className="l">Due today</span><span className="v">{now.length}</span></div>
        <div className="stat"><span className="l">Next 7 days</span><span className="v">{week.length}</span></div>
        <div className="stat"><span className="l">Unread notifications</span><span className="v">{notes.length}</span><Link className="small" to="/inbox">Open notifications</Link></div>
        {isManager() && <div className={'stat' + (pending.length ? ' warm' : '')}><span className="l">Waiting for your approval</span><span className="v">{pending.length}</span><Link className="small" to="/approvals">Open approvals</Link></div>}
      </div>
      {!items.length && <Empty>Nothing due in the next 7 days{scope !== 'all' ? ' for this view' : ''}. Add follow-up dates to leads and deals, or create a task.</Empty>}
      <Group title="Overdue" list={over} /><Group title="Due today" list={now} /><Group title="Next 7 days" list={week} />
    </>
  );
}

function Group({ title, list: items }) {
  if (!items.length) return null;
  return <section style={{ marginBottom: 18 }}><h2 style={{ marginBottom: 8 }}>{title} <span className="num small muted">{items.length}</span></h2>
    <div className="list">{items.map((i) => <Row key={i.kind + i.id} i={i} />)}</div></section>;
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
      <Link className="btn sm ghost" to={i.link}>Open</Link>
    </div>
  );
}
