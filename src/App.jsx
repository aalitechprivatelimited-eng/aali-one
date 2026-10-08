import { useEffect, useState, lazy, Suspense, Fragment } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { boot, useStore, store, login, logout, http, list, idleFor } from './api.js';
import { Toaster, In, Field, Empty, Avatar, Modal, attempt, toast, lockPage } from './ui.jsx';
import { feedItems, forScope, diff, isTop, can, desig, urgentDeadlines } from './lib.js';
import { SECTIONS } from '../shared/access.js';
import { ThemeToggle } from './theme.jsx';
import { Motion, Page, ScrollLine, ToTop, m, AnimatePresence, SPRING, EASE } from './motion.jsx';
import { Ico } from './icons.jsx';
import { Search, openSearch } from './search.jsx';
import { Guide } from './guide.jsx';
import { Popups } from './popups.jsx';
import { VisitPrompt } from './visit.jsx';

const Today = lazy(() => import('./pages/Today.jsx'));
const Leads = lazy(() => import('./pages/Leads.jsx'));
const Calls = lazy(() => import('./pages/Calls.jsx'));
const Assets = lazy(() => import('./pages/Assets.jsx'));
const Deals = lazy(() => import('./pages/Deals.jsx'));
const Clients = lazy(() => import('./pages/Clients.jsx'));
const Quotes = lazy(() => import('./pages/Quotes.jsx'));
const Agreements = lazy(() => import('./pages/Agreements.jsx'));
const Payroll = lazy(() => import('./pages/Payroll.jsx'));
const ClientPayrollPage = lazy(() => import('./pages/Payroll.jsx').then((m) => ({ default: m.ClientPayrollPage })));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const Tasks = lazy(() => import('./pages/Tasks.jsx'));
const Payments = lazy(() => import('./pages/Payments.jsx'));
const Support = lazy(() => import('./pages/Support.jsx'));
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const Daily = lazy(() => import('./pages/Daily.jsx'));
const Collab = lazy(() => import('./pages/Collab.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Approvals = lazy(() => import('./pages/Approvals.jsx'));
const Inbox = lazy(() => import('./pages/Inbox.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Signoff = lazy(() => import('./pages/Signoff.jsx'));
const Enquire = lazy(() => import('./pages/Public.jsx').then((m) => ({ default: m.Enquire })));
const Progress = lazy(() => import('./pages/Public.jsx').then((m) => ({ default: m.Progress })));

// The opening screen (index.html) slides up and away once the first screen is ready.
// It stays for at least a short moment so it never just flashes past.
function liftSplash() {
  const el = document.getElementById('splash'); if (!el || el.dataset.going) return; el.dataset.going = '1';
  setTimeout(() => { el.classList.add('up'); setTimeout(() => el.remove(), 950); }, Math.max(0, 900 - performance.now()));
}
// The practice copy of Aali One (the test site) says so on every screen, so nobody does real work there by mistake.
function TestSite() {
  const [on, setOn] = useState(false);
  useEffect(() => { fetch('/api/health').then((r) => r.json()).then((j) => { if (j.test) { setOn(true); document.title = 'TEST · ' + document.title; } }, () => {}); }, []);
  return on ? <><div className="testbar" role="note">TEST SITE – for practice only. Nothing done here reaches the real Aali One.</div><span className="testbadge" aria-hidden="true">TEST SITE</span></> : null;
}
export default function App() {
  const loc = useLocation(), open = loc.pathname === '/enquire' || loc.pathname.startsWith('/p/');
  useEffect(() => { if (open) liftSplash(); }, []); // the public pages need no sign-in check
  if (loc.pathname === '/enquire') return <Motion><Suspense fallback={null}><Enquire /><Toaster /></Suspense></Motion>;
  if (loc.pathname.startsWith('/p/')) return <Motion><Suspense fallback={null}><Routes><Route path="/p/:token" element={<Progress />} /></Routes></Suspense></Motion>;
  return <Motion><TestSite /><Private /></Motion>;
}
// While a section is loading.
const Waiting = () => <div className="stack" aria-busy="true" aria-label="Loading"><div className="skel" style={{ height: 38, width: 'min(340px,60%)' }} />
  <div className="stats" style={{ marginBottom: 0 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 104 }} />)}</div><div className="skel" style={{ height: 260 }} /></div>;

function Private() {
  useStore();
  const [started, setStarted] = useState(false), [setup, setSetup] = useState(null);
  useEffect(() => { boot().then(async (ok) => { if (!ok) setSetup((await http('GET', '/setup')).needsSetup); setStarted(true); liftSplash(); }); }, []);
  if (!started) return null; // the opening screen is still covering the window
  if (!store.me) return <><Login setup={setup} /><Toaster /></>;
  return <><Shell /><Toaster /></>;
}

// A sign-in ends after an hour without a tap or keypress (server/auth.js IDLE_MIN). A minute before, a warning counts down; any tap keeps
// the person signed in. The server checks the same thing, so a sleeping phone or a closed laptop is signed out too.
const IDLE_MS = 60 * 60000, WARN_MS = 60000;
function SessionTimeout() {
  const [left, setLeft] = useState(0);
  useEffect(() => { const h = setInterval(() => { const idle = idleFor();
    if (idle >= IDLE_MS) logout('You were signed out after 60 minutes without use. Please sign in again.');
    else setLeft(idle >= IDLE_MS - WARN_MS ? Math.ceil((IDLE_MS - idle) / 1000) : 0); }, 1000); return () => clearInterval(h); }, []);
  if (!left) return null;
  return <Modal title="Still there?" onClose={() => setLeft(0)} footer={<button className="btn primary" type="button" onClick={() => setLeft(0)}>Stay signed in</button>}>
    <p style={{ margin: 0 }}>Nothing has been tapped or typed for an hour. For safety you will be signed out in <b>{left} second{left === 1 ? '' : 's'}</b>.</p></Modal>;
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
    <div className="login">
      <m.form className="card stack" onSubmit={go} initial={{ opacity: 0, y: 26, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, ease: EASE }}>
        <div style={{ position: 'absolute', top: 26, right: 18 }}><ThemeToggle /></div>
        <div className="row" style={{ gap: 14, marginBottom: 4 }}><img className="logo-lg" src="/icon.svg" alt="" /><div><h1>Aali One</h1><div className="small muted">Aali Group · sales, delivery and payments in one place</div></div></div>
        {setup && <div className="banner info">First time here. Create the administrator account.</div>}
        {!setup && store.signedOut && <div className="banner info">{store.signedOut}</div>}
        {setup && <Field label="Your name"><In value={f.name} onChange={up('name')} required autoComplete="name" /></Field>}
        <Field label="Email"><In type="email" value={f.email} onChange={up('email')} required autoComplete="username" /></Field>
        <Field label="Password" hint={setup ? 'At least 8 characters.' : ''}><div className="pwbox"><In type={show ? 'text' : 'password'} value={f.password} onChange={up('password')} required autoComplete={setup ? 'new-password' : 'current-password'} />
          <button type="button" className="eye" aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />{show && <path d="M4 4l16 16" />}</svg></button></div></Field>
        <button className="btn primary" disabled={busy} type="submit">{busy ? 'Please wait…' : setup ? 'Create account' : 'Sign in'}</button>
        {!setup && <p className="small muted" style={{ margin: 0 }}>Forgot your password? Ask the admin to set a new one.</p>}
      </m.form>
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

// A page opens only for a role that has it in the access table (shared/access.js); the sidebar shows the same sections.
const Gate = ({ s, children }) => (can(s) ? children : <Empty>This section is not part of your access. If you need it for your work, ask the Operations Manager.</Empty>);

function Shell() {
  const [open, setOpen] = useState(false), loc = useLocation(), me = store.me;
  // The sidebar can be collapsed to a slim strip: the logo, the few everyday sections and the person. The choice is remembered on this device.
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('aali-side') === 'mini'; } catch { return false; } });
  const flip = (v) => { setMini(v); try { localStorage.setItem('aali-side', v ? 'mini' : 'full'); } catch {} };
  useEffect(() => setOpen(false), [loc.pathname]);
  // Signing out goes back to the start, so the next sign-in opens on the dashboard – not on the page someone left.
  const nav = useNavigate(), signOut = () => { nav('/', { replace: true }); logout(); };
  // While the phone menu is open the page behind it is held still: a fast swipe that reaches the end of the menu would otherwise
  // carry on into the page, and the phone's address bar would hide, making the open menu look as if it flows upwards.
  useEffect(() => { if (!open) return; lockPage(1); return () => lockPage(-1); }, [open]);
  // The phone menu closes with its Close button, a tap on the dim area beside it, the Esc key, or by choosing any page in it –
  // the page already open too (tapping Dashboard while on the dashboard closes the menu and shows it).
  useEffect(() => { if (!open) return; const k = (e) => e.key === 'Escape' && setOpen(false); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open]);
  useReminders();
  const late = forScope(feedItems(), 'mine').filter((i) => diff(i.due) <= 0).length;
  const unread = list('notice').filter((n) => n.to === me.id && !n.read).length;
  const pending = can('approvals') ? list('approval').filter((a) => a.status === 'pending').length : 0;
  const toReview = can('approvals') ? list('report').filter((r) => r.owner !== me.id && r.status === 'submitted' && !r.reviewed).length : 0;
  const cnt = { today: late, daily: toReview, inbox: unread, approvals: pending, calendar: urgentDeadlines() };
  // Which section is open: the gold mark in the sidebar slides to it, and the page changes with a short movement.
  const path = loc.pathname, seg = path.split('/')[1] || 'home';
  const on = (k, to) => (to === '/' ? path === '/' : k === 'settings' ? path.startsWith('/settings') && !path.startsWith('/settings/people') : path === to || path.startsWith(to + '/'));
  return (
    <div className={'shell' + (mini ? ' mini' : '')}>
      <ScrollLine />
      <aside className={'side' + (open ? ' open' : '')} onClick={(e) => open && e.target.closest('a') && setOpen(false)}>
        <div className="brand"><button type="button" className="logo" onClick={() => mini && flip(false)} title={mini ? 'Open the sidebar' : 'Aali One'} aria-label={mini ? 'Open the sidebar' : 'Aali One'}><img src="/icon.svg" alt="" /><Ico k="side" /></button>
          <div className="brand-t"><b>Aali One</b><span>Aali Group</span></div>
          <button type="button" className="btn ghost sm shut" onClick={() => setOpen(false)} aria-label="Close the menu">Close</button>
          <button type="button" className="collapse" onClick={() => flip(true)} title="Collapse the sidebar" aria-label="Collapse the sidebar"><Ico k="side" /></button></div>
        <button type="button" className="side-search" onClick={openSearch} data-tip="Search" aria-label="Search (Ctrl + K)"><Ico k="search" /><span className="lab">Search</span><kbd>Ctrl K</kbd></button>
        <m.nav className="nav" layoutScroll aria-label="Sections">
          {['', 'Overview', 'Sales', 'Delivery', 'Money', 'Management', 'Account'].map((g) => { const items = SECTIONS.filter((s) => s[3] === g && can(s[0])); if (!items.length) return null;
            return <Fragment key={g}>{g && <div className="sec">{g === 'Management' && !isTop() ? 'My team' : g}</div>}
              {items.map(([k, label, to]) => { const text = k === 'people' && !isTop() ? 'My team members' : label;
                // "rest" = every section outside the everyday group; the collapsed strip leaves these out (except the page that is open).
                return <Link key={k} to={to} data-tip={text} aria-label={text} aria-current={on(k, to) ? 'page' : undefined} className={(g ? 'rest ' : '') + (on(k, to) ? 'active' : '')}>
                  {on(k, to) && <m.span layoutId="nav-pill" className="nav-pill" transition={SPRING} />}
                  <Ico k={k} /><span className="lab">{text}</span>{cnt[k] ? <span className="cnt">{cnt[k]}</span> : null}</Link>; })}</Fragment>; })}
          <button type="button" className="more" data-tip="All sections" aria-label="Open the sidebar to see all sections" onClick={() => flip(false)}><Ico k="more" /></button>
        </m.nav>
        <div className="me"><Link to="/settings/me" className="me-who" title="My profile: photo, display name, password"><Avatar u={me} /><div className="grow"><b className="ell">{me.name}</b><div className="faint ell" title={desig(me)}>{desig(me)}</div><div className="faint ell">{me.company}</div></div></Link>
          <div className="me-act"><ThemeToggle label /><button className="btn sm" type="button" onClick={signOut}>Sign out</button></div></div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div style={{ minWidth: 0 }}>
        <div className="mobilebar"><button className="btn sm" type="button" onClick={() => setOpen(true)} aria-label="Open menu">☰ Menu</button><b style={{ fontFamily: 'var(--doc)' }} className="grow">Aali One</b><button type="button" className="eye theme" onClick={openSearch} aria-label="Search" title="Search"><Ico k="search" /></button><ThemeToggle /></div>
        <main className="main">
          <AnimatePresence mode="wait" onExitComplete={() => scrollTo(0, 0)}>
            <Page key={seg}><Suspense fallback={<Waiting />}>
            <Routes location={loc}>
              <Route path="/" element={<Today />} /><Route path="/inbox" element={<Inbox />} /><Route path="/approvals" element={<Gate s="approvals"><Approvals /></Gate>} />
              <Route path="/leads/*" element={<Gate s="leads"><Leads /></Gate>} /><Route path="/calls" element={<Gate s="calls"><Calls /></Gate>} /><Route path="/deals/*" element={<Gate s="deals"><Deals /></Gate>} /><Route path="/clients/*" element={<Gate s="clients"><Clients /></Gate>} />
              <Route path="/quotes/*" element={<Gate s="quotes"><Quotes /></Gate>} /><Route path="/agreements/*" element={<Gate s="agreements"><Agreements /></Gate>} /><Route path="/projects/*" element={<Gate s="projects"><Projects /></Gate>} /><Route path="/tasks" element={<Tasks />} />
              <Route path="/support" element={<Gate s="support"><Support /></Gate>} /><Route path="/assets" element={<Gate s="assets"><Assets /></Gate>} /><Route path="/payments/*" element={<Gate s="money"><Payments /></Gate>} /><Route path="/payroll/*" element={<Gate s="payroll"><Payroll /></Gate>} /><Route path="/client-payroll/*" element={<Gate s="clientpay"><ClientPayrollPage /></Gate>} /><Route path="/calendar/*" element={<Calendar />} /><Route path="/daily/*" element={<Daily />} /><Route path="/collab" element={<Gate s="collab"><Collab /></Gate>} />
              <Route path="/reports" element={<Gate s="reports"><Reports /></Gate>} /><Route path="/messages" element={<Gate s="messages"><Messages /></Gate>} /><Route path="/settings/*" element={<Settings />} />
              <Route path="/signoff/:projectId" element={<Gate s="projects"><Signoff /></Gate>} /><Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense></Page>
          </AnimatePresence>
        </main>
        <ToTop />
        <Search /><Guide /><Popups /><VisitPrompt /><SessionTimeout />
      </div>
    </div>
  );
}
export const useId = () => useParams()['*']?.split('/')[0];
