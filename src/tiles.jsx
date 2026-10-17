// Home: the sections as tiles, grouped by kind of work, each with its live count (the user, 16 Oct 2026). People reach their work
// from here instead of hunting through the sidebar. Only the sections a person's role has (shared/access.js) are shown. Someone with
// few sections sees them all at once, under small headings; management and managers first pick a group, then a section.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { list, store } from './api.js';
import { feedItems, forScope, diff, isTop, can, canEdit, urgentDeadlines } from './lib.js';
import { SECTIONS } from '../shared/access.js';
import { Ico } from './icons.jsx';

const CATS = [
  { k: 'work', name: 'My work', icon: 'tasks', items: ['daily', 'tasks', 'calendar', 'inbox', 'bills', 'approvals', 'settings'] },
  { k: 'sales', name: 'Sales', icon: 'deals', items: ['leads', 'calls', 'deals', 'clients'] },
  { k: 'docs', name: 'Quotations & agreements', icon: 'agreements', items: ['quotes', 'agreements'] },
  { k: 'money', name: 'Money', icon: 'money', items: ['money', 'payroll', 'clientpay'] },
  { k: 'delivery', name: 'Delivery', icon: 'projects', items: ['projects', 'support', 'assets'] },
  { k: 'team', name: 'Management', icon: 'people', items: ['people', 'reports', 'messages', 'collab'] },
];
const FEW = 9; // up to this many sections: no groups to pick first

// What waits in each section, for the person looking: the numbers on the tiles and in the sidebar.
export function sectionCounts() {
  const me = store.me;
  const late = forScope(feedItems(), 'mine').filter((i) => diff(i.due) <= 0).length;
  const unread = list('notice').filter((n) => n.to === me.id && !n.read).length;
  const pending = can('approvals') ? list('approval').filter((a) => a.status === 'pending').length : 0;
  const toReview = can('approvals') ? list('report').filter((r) => r.owner !== me.id && r.status === 'submitted' && !r.reviewed).length : 0;
  const billsToDo = isTop() ? list('bill').filter((b) => b.status === 'submitted' || b.status === 'approved').length : 0; // management: to approve or to pay
  // Quotations and agreements: with me (a BDE) and not signed yet; for the managers, the client's changes and an advance to confirm.
  const docs = (type, section) => list(type).filter((d) => !(type === 'agreement' ? d.status === 'signed' : d.signed)
    && ((d.assignedTo === me.id && d.status !== 'changes') || (canEdit(section) && (d.status === 'changes' || (d.advance && !d.advance.confirmed))))).length;
  return { today: late, daily: toReview, bills: billsToDo, inbox: unread, approvals: pending, calendar: urgentDeadlines(), quotes: docs('quote', 'quotes'), agreements: docs('agreement', 'agreements') };
}

const LABEL = Object.fromEntries(SECTIONS.map(([k, label, to]) => [k, { label, to }]));
const label = (k) => (k === 'people' && !isTop() ? 'My team members' : LABEL[k].label);

function Tile({ k, n }) {
  return <Link to={LABEL[k].to} className="tile" aria-label={label(k) + (n ? `, ${n} waiting` : '')}>
    <span className="tile-ico"><Ico k={k} size={26} /></span><span className="tile-t">{label(k)}</span>{n ? <span className="cnt">{n}</span> : null}</Link>;
}

export function Tiles() {
  const cnt = sectionCounts(), cats = CATS.map((c) => ({ ...c, name: c.k === 'team' && !isTop() ? 'My team' : c.name, items: c.items.filter((k) => can(k)) })).filter((c) => c.items.length);
  const total = cats.reduce((s, c) => s + c.items.length, 0), [open, setOpen] = useState('');
  const sum = (c) => c.items.reduce((s, k) => s + (cnt[k] || 0), 0);
  if (total <= FEW) return <section className="home-tiles" aria-label="Your sections" data-guide="tiles">
    {cats.map((c) => <div key={c.k}><h3 className="tiles-h">{c.name}</h3><div className="tiles">{c.items.map((k) => <Tile key={k} k={k} n={cnt[k]} />)}</div></div>)}</section>;
  const cat = cats.find((c) => c.k === open);
  return <section className="home-tiles" aria-label="Your sections" data-guide="tiles">
    {cat ? <><div className="row"><button type="button" className="btn sm" onClick={() => setOpen('')}>← All groups</button><h3 className="tiles-h" style={{ margin: 0 }}>{cat.name}</h3></div>
      <div className="tiles">{cat.items.map((k) => <Tile key={k} k={k} n={cnt[k]} />)}</div></>
      : <div className="tiles">{cats.map((c) => <button key={c.k} type="button" className="tile" onClick={() => setOpen(c.k)} aria-label={`${c.name}: ${c.items.length} sections${sum(c) ? `, ${sum(c)} waiting` : ''}`}>
        <span className="tile-ico"><Ico k={c.icon} size={26} /></span><span className="tile-t">{c.name}</span><span className="tile-s">{c.items.length} {c.items.length === 1 ? 'section' : 'sections'}</span>{sum(c) ? <span className="cnt">{sum(c)}</span> : null}</button>)}</div>}
  </section>;
}
