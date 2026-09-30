import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../api.js';
import { feedItems, forScope, iso, parse, MONTHS, today } from '../lib.js';
import { Seg, Pill } from '../ui.jsx';

const COLOR = { task: 'info', lead: 'gold', deal: 'gold', cadence: 'gold', activity: 'ok', payment: 'warn', project: 'bad', ticket: 'bad' };
export default function Calendar() {
  useStore(); const [scope, setScope] = useState('mine'), [m, setM] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const items = forScope(feedItems(), scope), first = new Date(m), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = [...Array(42)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return iso(d); });
  const shift = (n) => setM(new Date(m.getFullYear(), m.getMonth() + n, 1));
  return <>
    <div className="topbar"><h1>{MONTHS[m.getMonth()]} {m.getFullYear()}</h1><div className="row"><Seg value={scope} onChange={setScope} options={[['mine', 'For me'], ['team', 'My team'], ['all', 'Everyone']]} />
      <button className="btn sm" type="button" onClick={() => shift(-1)}>←</button><button className="btn sm" type="button" onClick={() => setM(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button><button className="btn sm" type="button" onClick={() => shift(1)}>→</button></div></div>
    <div className="row small" style={{ marginBottom: 8 }}>{[['Follow-ups', 'gold'], ['Calls & meetings', 'ok'], ['Tasks', 'info'], ['Payments', 'warn'], ['Deadlines & support', 'bad']].map(([l, k]) => <Pill key={l} k={k}>{l}</Pill>)}</div>
    <div className="tbl" style={{ overflowX: 'auto' }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(110px,1fr))', minWidth: 780 }}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', background: 'var(--gold-50)' }}>{d}</div>)}
      {days.map((d) => { const its = items.filter((i) => i.due === d), inMonth = parse(d).getMonth() === m.getMonth();
        return <div key={d} style={{ minHeight: 104, borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)', padding: 5, background: d === today() ? 'var(--gold-50)' : '', opacity: inMonth ? 1 : 0.5 }}>
          <div className="num small" style={{ fontWeight: d === today() ? 700 : 400 }}>{parse(d).getDate()}</div>
          {its.slice(0, 4).map((i) => <Link key={i.kind + i.id} to={i.link} className={'pill ' + COLOR[i.kind]} style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '2px 0', textDecoration: 'none' }} title={i.title}>{i.time ? i.time + ' ' : ''}{i.title}</Link>)}
          {its.length > 4 && <div className="small muted">+{its.length - 4} more</div>}</div>; })}
    </div></div>
  </>;
}
