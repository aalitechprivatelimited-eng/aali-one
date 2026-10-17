// Aali One as a set of apps, like Zoho One (the user, 17 Oct 2026): after signing in, the app launcher shows the apps this person's role
// has (shared/access.js decides each section); an app opens with its own menu of only its sections, and the 9-dot button brings the
// launcher back. Today's work (the old Dashboard) sits under the apps on the launcher.
import { Link } from 'react-router-dom';
import { SECTIONS } from '../shared/access.js';
import { can, isTop } from './lib.js';
import { Ico } from './icons.jsx';
import { sectionCounts } from './tiles.jsx';

export const APPS = [
  { k: 'crm', name: 'Aali CRM', icon: 'deals', about: 'Leads, deals and clients', items: ['leads', 'deals', 'clients'] },
  { k: 'calling', name: 'Aali Calling', icon: 'calls', about: 'The call register', items: ['calls'] },
  { k: 'desk', name: 'Aali Deals Desk', icon: 'agreements', about: 'Quotations and agreements', items: ['quotes', 'agreements'] },
  { k: 'books', name: 'Aali Books', icon: 'money', about: 'Payments, receipts, tax invoices, bills', items: ['money', 'bills'] },
  { k: 'projects', name: 'Aali Projects', icon: 'projects', about: 'Projects, tasks, support, client assets', items: ['projects', 'tasks', 'support', 'assets'] },
  { k: 'people', name: 'Aali People', icon: 'people', about: 'People, payroll, client payroll', items: ['people', 'payroll', 'clientpay'] },
  { k: 'work', name: 'Aali Work', icon: 'daily', about: 'Daily reports, calendar, approvals, notifications', items: ['daily', 'calendar', 'approvals', 'inbox'] },
  { k: 'insights', name: 'Aali Insights', icon: 'reports', about: 'Reports', items: ['reports'] },
  { k: 'connect', name: 'Aali Connect', icon: 'messages', about: 'WhatsApp messages, collaborations', items: ['messages', 'collab'] },
];
export const SEC = Object.fromEntries(SECTIONS.map(([k, label, to]) => [k, { label, to }]));
export const secLabel = (k) => (k === 'people' && !isTop() ? 'My team members' : SEC[k].label);
// The apps this person has, each with only the sections they may open.
export const myApps = () => APPS.map((a) => ({ ...a, items: a.items.filter((k) => can(k)) })).filter((a) => a.items.length);
// Which app a page belongs to (none for the launcher and Settings). Delivery sign-off pages belong to Projects.
const EXTRA = { projects: ['/signoff'] };
export const appOf = (path) => myApps().find((a) => a.items.some((k) => { const to = SEC[k].to; return path === to || path.startsWith(to + '/'); }) || (EXTRA[a.k] || []).some((p) => path.startsWith(p + '/')));

export function AppLauncher() {
  const cnt = sectionCounts(), apps = myApps();
  return <section className="home-tiles" aria-label="Your apps" data-guide="tiles">
    <div className="tiles apps">{apps.map((a) => { const n = a.items.reduce((s, k) => s + (cnt[k] || 0), 0);
      return <Link key={a.k} to={SEC[a.items[0]].to} className="tile" aria-label={`${a.name}: ${a.about}${n ? `, ${n} waiting` : ''}`}>
        <span className="tile-ico"><Ico k={a.icon} size={26} /></span><span className="tile-t">{a.name}</span><span className="tile-s">{a.items.map(secLabel).join(' · ')}</span>{n ? <span className="cnt">{n}</span> : null}</Link>; })}</div>
  </section>;
}
