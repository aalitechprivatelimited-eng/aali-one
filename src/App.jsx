import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useParams } from 'react-router-dom';
import { boot, useStore, store, login, logout, http, list } from './api.js';
import { Toaster, In, Field, attempt, toast } from './ui.jsx';
import { TITLES, feedItems, forScope, diff, isManager, canAddPeople } from './lib.js';

const Today = lazy(() => import('./pages/Today.jsx'));
const Leads = lazy(() => import('./pages/Leads.jsx'));
const Deals = lazy(() => import('./pages/Deals.jsx'));
const Clients = lazy(() => import('./pages/Clients.jsx'));
const Quotes = lazy(() => import('./pages/Quotes.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const Tasks = lazy(() => import('./pages/Tasks.jsx'));
const Payments = lazy(() => import('./pages/Payments.jsx'));
const Support = lazy(() => import('./pages/Support.jsx'));
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const Daily = lazy(() => import('./pages/Daily.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Approvals = lazy(() => import('./pages/Approvals.jsx'));
const Inbox = lazy(() => import('./pages/Inbox.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Signoff = lazy(() => import('./pages/Signoff.jsx'));
const Enquire = lazy(() => import('./pages/Public.jsx').then((m) => ({ default: m.Enquire })));
const Progress = lazy(() => import('./pages/Public.jsx').then((m) => ({ default: m.Progress })));

export default function App() {
  const loc = useLocation();
  if (loc.pathname === '/enquire') return <Suspense fallback={null}><Enquire /><Toaster /></Suspense>;
  if (loc.pathname.startsWith('/p/')) return <Suspense fallback={null}><Routes><Route path="/p/:token" element={<Progress />} /></Routes></Suspense>;
  return <Private />;
}

function Private() {
  useStore();
  const [started, setStarted] = useState(false), [setup, setSetup] = useState(null);
  useEffect(() => { boot().then(async (ok) => { if (!ok) setSetup((await http('GET', '/setup')).needsSetup); setStarted(true); }); }, []);
  if (!started) return <div className="empty" style={{ margin: 40 }}>Loading Aali One…</div>;
  if (!store.me) return <><Login setup={setup} /><Toaster /></>;
  return <><Shell /><Toaster /></>;
}

function Login({ setup }) {
  const [f, setF] = useState({ name: '', email: '', password: '' }), [busy, setBusy] = useState(false), [show, setShow] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function go(e) {
    e.preventDefault(); setBusy(true);
    if (setup) await attempt(async () => { await http('POST', '/setup', f); await boot(); });
    else await attempt(() => login(f.email, f.password).then((ok) => { if (!ok) throw new Error(store.error || 'Could not sign in.'); }));
    setBusy(false);
  }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card stack" style={{ width: 'min(400px,100%)', padding: 24 }} onSubmit={go}>
        <div className="row"><img src="/icon.svg" alt="" width="40" height="40" /><div><h1>Aali One</h1><div className="small muted">Aali Group · sales, delivery and payments in one place</div></div></div>
        {setup && <div className="banner info">First time here. Create the administrator account.</div>}
        {setup && <Field label="Your name"><In value={f.name} onChange={up('name')} required autoComplete="name" /></Field>}
        <Field label="Email"><In type="email" value={f.email} onChange={up('email')} required autoComplete="username" /></Field>
        <Field label="Password" hint={setup ? 'At least 8 characters.' : ''}><div className="pwbox"><In type={show ? 'text' : 'password'} value={f.password} onChange={up('password')} required autoComplete={setup ? 'new-password' : 'current-password'} />
          <button type="button" className="eye" aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />{show && <path d="M4 4l16 16" />}</svg></button></div></Field>
        <button className="btn primary" disabled={busy} type="submit">{busy ? 'Please wait…' : setup ? 'Create account' : 'Sign in'}</button>
        {!setup && <p className="small muted" style={{ margin: 0 }}>Forgot your password? Ask the admin to set a new one.</p>}
      </form>
    </div>
  );
}

// Task reminder times: alert while Aali One is open (and a browser notification if allowed).
function useReminders() {
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    const tick = () => {
      const now = new Date(), day = now.toISOString().slice(0, 10), hm = now.toTimeString().slice(0, 5);
      let seen = {}; try { seen = JSON.parse(localStorage.getItem('aali-reminded') || '{}'); } catch {}
      for (const t of list('task')) {
        if (t.status === 'done' || !t.remindAt || t.due !== day || t.remindAt > hm || (t.owner !== store.me?.id && !(t.people || []).includes(store.me?.id))) continue;
        const key = t.id + day; if (seen[key]) continue; seen[key] = 1;
        toast(`Reminder: ${t.title}`);
        try { if (Notification.permission === 'granted') new Notification('Aali One reminder', { body: t.title, icon: '/icon.svg' }); } catch {}
      }
      try { localStorage.setItem('aali-reminded', JSON.stringify(seen)); } catch {}
    };
    tick(); const h = setInterval(tick, 30000); return () => clearInterval(h);
  }, []);
}

function Shell() {
  const [open, setOpen] = useState(false), loc = useLocation(), me = store.me;
  useEffect(() => setOpen(false), [loc.pathname]);
  useReminders();
  const late = forScope(feedItems(), 'mine').filter((i) => diff(i.due) <= 0).length;
  const unread = list('notice').filter((n) => n.to === me.id && !n.read).length;
  const pending = isManager() ? list('approval').filter((a) => a.status === 'pending').length : 0;
  const toReview = isManager() ? list('report').filter((r) => r.owner !== me.id && r.status === 'submitted' && !r.reviewed).length : 0;
  const L = ({ to, children, cnt }) => <NavLink to={to}>{children}{cnt ? <span className="cnt">{cnt}</span> : null}</NavLink>;
  return (
    <div className="shell">
      <aside className={'side' + (open ? ' open' : '')}>
        <div className="brand"><img src="/icon.svg" alt="" /><div><b>Aali One</b><span>Aali Group</span></div></div>
        <nav className="nav">
          <L to="/" cnt={late}>Today</L><L to="/daily" cnt={toReview}>Daily reports</L><L to="/inbox" cnt={unread}>Notifications</L>{isManager() && <L to="/approvals" cnt={pending}>Approvals</L>}
          <div className="sec">Sales</div><L to="/leads">Leads & enquiries</L><L to="/deals">Deals pipeline</L><L to="/clients">Clients</L><L to="/quotes">Quotations</L>
          <div className="sec">Delivery</div><L to="/projects">Projects</L><L to="/tasks">Tasks</L><L to="/support">Support</L>
          <div className="sec">Money</div><L to="/payments">Payments & receipts</L>
          <div className="sec">Overview</div><L to="/calendar">Calendar</L><L to="/reports">Reports & dashboard</L><L to="/messages">WhatsApp messages</L>{canAddPeople() && <L to="/settings/people">{me.isAdmin ? 'People & teams' : 'My team members'}</L>}<NavLink to="/settings" className={({ isActive }) => (isActive && !loc.pathname.startsWith('/settings/people') ? 'active' : '')}>Settings</NavLink>
        </nav>
        <div className="me"><span className="av">{me.name.slice(0, 2).toUpperCase()}</span><div className="grow"><b>{me.name}</b><div className="faint">{TITLES[me.title]}</div></div>
          <button className="btn ghost sm" type="button" onClick={logout}>Sign out</button></div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div style={{ minWidth: 0 }}>
        <div className="mobilebar"><button className="btn sm" type="button" onClick={() => setOpen(true)} aria-label="Open menu">☰ Menu</button><b style={{ fontFamily: 'var(--doc)' }}>Aali One</b></div>
        <main className="main">
          <Suspense fallback={<div className="empty">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Today />} /><Route path="/inbox" element={<Inbox />} /><Route path="/approvals" element={<Approvals />} />
              <Route path="/leads/*" element={<Leads />} /><Route path="/deals/*" element={<Deals />} /><Route path="/clients/*" element={<Clients />} />
              <Route path="/quotes/*" element={<Quotes />} /><Route path="/projects/*" element={<Projects />} /><Route path="/tasks" element={<Tasks />} />
              <Route path="/support" element={<Support />} /><Route path="/payments/*" element={<Payments />} /><Route path="/calendar" element={<Calendar />} /><Route path="/daily" element={<Daily />} />
              <Route path="/reports" element={<Reports />} /><Route path="/messages" element={<Messages />} /><Route path="/settings/*" element={<Settings />} />
              <Route path="/signoff/:projectId" element={<Signoff />} /><Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
export const useId = () => useParams()['*']?.split('/')[0];
