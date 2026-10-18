// Aali One as a set of apps, like Zoho One (the user, 17 Oct 2026): after signing in, the app launcher shows the apps this person's role
// has (shared/access.js decides each section); an app opens with its own menu of only its sections, and the 9-dot button brings the
// launcher back. Today's work is the Overview, the first card on the launcher (18 Oct 2026).
import { Link } from 'react-router-dom';
import { SECTIONS } from '../shared/access.js';
import { can, isTop } from './lib.js';
import { Ico } from './icons.jsx';
import { sectionCounts } from './tiles.jsx';

export const APPS = [
  { k: 'crm', name: 'Aali CRM', icon: 'deals', about: 'Leads, deals and clients', items: ['leads', 'deals', 'clients'] },
  { k: 'calling', name: 'Aali Calling', icon: 'calls', about: 'The call register', items: ['calls'] },
  { k: 'desk', name: 'Aali Deals Desk', icon: 'agreements', about: 'Quotations and agreements', items: ['quotes', 'agreements'] },
  { k: 'books', name: 'Aali Books', icon: 'money', about: 'Payments, receipts and bills', items: ['money', 'bills'] },
  { k: 'invoices', name: 'Aali Invoices', icon: 'invoices', about: 'B2B and B2C tax invoices', items: ['invoices'] },
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
// An app opens on the page this person last used in it (kept on this device only); the first time, on its first page.
const lastKey = (k) => 'aali-app-last:' + k;
export const appStart = (a) => { let to = ''; try { to = localStorage.getItem(lastKey(a.k)) || ''; } catch {} return a.items.some((k) => SEC[k].to === to) ? to : SEC[a.items[0]].to; };
export const rememberApp = (a, path) => { const k = a.items.find((x) => path === SEC[x].to || path.startsWith(SEC[x].to + '/')); if (k) try { localStorage.setItem(lastKey(a.k), SEC[k].to); } catch {} };
export const appOf = (path) => myApps().find((a) => a.items.some((k) => { const to = SEC[k].to; return path === to || path.startsWith(to + '/'); }) || (EXTRA[a.k] || []).some((p) => path.startsWith(p + '/')));

export function AppLauncher() {
  const cnt = sectionCounts(), apps = myApps();
  // Each app as a card: its name, in plain words what it is for, the pages inside it, and how many things wait there (18 Oct 2026).
  return <section className="home-tiles" aria-label="Your apps" data-guide="tiles">
    <div className="apps-h"><h2>Your apps</h2><span className="small muted">Open an app to see its pages in the menu.<span className="keys"> <kbd>Ctrl</kbd> + <kbd>K</kbd> finds anything.</span></span></div>
    <div className="tiles apps">
      <Link to="/overview" className="tile dash" aria-label={`Overview: today's work${cnt.today ? `, ${cnt.today} late` : ''}`}>
        <span className="tile-ico"><Ico k="today" size={24} /></span><span className="tile-body"><span className="tile-t">Overview</span><span className="tile-a">Today’s work: what is due, your numbers, what needs attention</span></span>
        {cnt.today ? <span className="cnt" title={`${cnt.today} late`}>{cnt.today}</span> : null}<span className="tile-go" aria-hidden="true">→</span></Link>
      {apps.map((a) => { const n = a.items.reduce((s, k) => s + (cnt[k] || 0), 0);
      return <Link key={a.k} to={appStart(a)} className="tile" aria-label={`${a.name}: ${a.about}${n ? `, ${n} waiting` : ''}`}>
        <span className="tile-ico"><Ico k={a.icon} size={24} /></span><span className="tile-body"><span className="tile-t">{a.name}</span><span className="tile-a">{a.about}</span>
        <span className="tile-s">{a.items.map(secLabel).join(' · ')}</span></span>{n ? <span className="cnt" title={`${n} waiting`}>{n}</span> : null}<span className="tile-go" aria-hidden="true">→</span></Link>; })}</div>
  </section>;
}
