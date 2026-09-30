import { Link } from 'react-router-dom';
import { useStore, list, store } from '../api.js';
import { feedItems, forScope, today, addDays, diff, escalated, inr, isManager, isTop, activeUsers, TITLES, waLink, stageProb, MONTHS } from '../lib.js';
import { Empty, Pill, toast } from '../ui.jsx';

function digest(u) {
  const items = forScope(feedItems(), 'mine', u), t = today(), tm = addDays(t, 1);
  const mine = items.filter((i) => (i.owner === u.id || (i.people || []).includes(u.id)) && i.due <= tm);
  const team = items.filter((i) => !mine.includes(i) && i.due <= t && !escalated(i.due));
  const esc = items.filter((i) => !mine.includes(i) && escalated(i.due));
  if (!mine.length && !team.length && !esc.length) return null;
  const line = (i) => `• ${i.title}${diff(i.due) < 0 ? ` (${-diff(i.due)} days late)` : ''}`;
  const out = [`*Aali One · ${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}*`, `Hi ${u.name.split(' ')[0]}, here's your list.`];
  const sec = (title, arr) => arr.length && out.push('', `*${title} (${arr.length})*`, ...arr.slice(0, 12).map(line), ...(arr.length > 12 ? [`…and ${arr.length - 12} more`] : []));
  sec('Overdue', mine.filter((i) => i.due < t)); sec('Due today', mine.filter((i) => i.due === t)); sec('Tomorrow', mine.filter((i) => i.due === tm));
  sec('Your team – late or due today', team); sec('Escalated – 3+ days late', esc);
  out.push('', `Open Aali One: ${location.origin}`);
  return { text: out.join('\n'), n: mine.length + team.length + esc.length };
}
function weekly() {
  const t = today(), from = addDays(t, -6), inW = (d) => d && d.slice(0, 10) >= from && d.slice(0, 10) <= t, deals = list('deal');
  const open = deals.filter((d) => !['won', 'lost'].includes(d.stage)), won = deals.filter((d) => d.stage === 'won' && inW(d.wonAt));
  const got = list('receipt').filter((r) => inW(r.date)).reduce((s, r) => s + (r.totals?.received || 0), 0);
  const overdue = list('payment').filter((p) => p.status !== 'paid' && p.due < t);
  const esc = feedItems().filter((i) => escalated(i.due));
  return [`*Aali One · Weekly summary*`, `${from} to ${t}`, '', '*Sales*', `• New leads: ${list('lead').filter((l) => inW(l.createdAt)).length}`, `• Won: ${won.length} · ${inr(won.reduce((s, d) => s + (+d.value || 0), 0))}`,
    `• Open pipeline: ${inr(open.reduce((s, d) => s + (+d.value || 0), 0))} (likely ${inr(open.reduce((s, d) => s + (+d.value || 0) * stageProb(d.stage) / 100, 0))})`,
    '', '*Delivery*', `• Active projects: ${list('project').filter((p) => !['live', 'onhold', 'awaiting'].includes(p.stage)).length}`, `• Waiting for advance: ${list('project').filter((p) => p.stage === 'awaiting').length}`,
    `• Client sign-offs this week: ${list('signoff').filter((s) => inW(s.signedAt)).length}`, `• Support requests open: ${list('ticket').filter((x) => x.status !== 'resolved').length}`,
    '', '*Money*', `• Received this week: ${inr(got)}`, `• Overdue: ${inr(overdue.reduce((s, p) => s + Math.max(0, p.amount - (p.paid || 0)), 0))} (${overdue.length})`,
    ...(esc.length ? ['', `*Escalated – 3+ days late (${esc.length})*`, ...esc.slice(0, 10).map((i) => `• ${i.title}`)] : []), '', `Open Aali One: ${location.origin}`].join('\n');
}
function Card({ u, text, sub }) {
  const link = waLink(u.phone, text);
  return <div className="card stack"><div className="row between"><b>{u.name}</b><span className="small muted">{TITLES[u.title]}</span></div><span className="small muted">{sub}</span>
    <textarea className="in" readOnly value={text} style={{ minHeight: 150, fontSize: 12.5 }} />
    <div className="row">{link ? <a className="btn wa sm" href={link} target="_blank" rel="noreferrer">Send on WhatsApp</a> : <span className="small muted">No mobile number – add it in Settings → People.</span>}
      <button className="btn sm" type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied.'))}>Copy</button></div></div>;
}
export default function Messages() {
  useStore(); const me = store.me, all = isManager() ? activeUsers() : [me];
  const cards = all.map((u) => ({ u, d: digest(u) })).filter((x) => x.d);
  const tops = activeUsers().filter((u) => isTop(u) && !u.isAdmin || ['ops', 'cs', 'chairman'].includes(u.title));
  return <>
    <div className="topbar"><h1>WhatsApp messages</h1><Link className="btn" to="/settings/connections">Switch on automatic sending</Link></div>
    <div className="banner info" style={{ marginBottom: 14 }}>Today these are one tap: tap “Send on WhatsApp” and press send. Automatic sending every morning needs a WhatsApp Business API account (Settings → Connections).</div>
    <h2 style={{ marginBottom: 8 }}>Daily lists <span className="small muted">{cards.length}</span></h2>
    {cards.length ? <div className="grid2">{cards.map(({ u, d }) => <Card key={u.id} u={u} text={d.text} sub={`${d.n} item${d.n === 1 ? '' : 's'}`} />)}</div> : <Empty>Nobody has anything due today or tomorrow.</Empty>}
    {isManager() && <><h2 style={{ margin: '20px 0 8px' }}>Monday summary for top management</h2>
      {tops.length ? <div className="grid2">{tops.map((u) => <Card key={u.id} u={u} text={weekly()} sub="Last 7 days" />)}</div> : <Empty>Add the Operations Manager, Company Secretary or Chairman in Settings → People.</Empty>}</>}
  </>;
}
