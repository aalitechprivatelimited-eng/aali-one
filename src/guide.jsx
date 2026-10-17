// The guide: a tour that takes the person to each section their login can open and explains, on that very page, what they do there.
// The words depend on the person's role and access (shared/access.js): a BDE hears about their own sales work, a manager about
// the team, the Operations Manager about the whole group. It offers itself on a person's first sign-in on a device, and it is
// always there behind the Guide button at the top of the dashboard (and in Settings → Help).
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { store } from './api.js';
import { can, canEdit, scope, isTop, isManager, settings } from './lib.js';
import { SECTIONS } from '../shared/access.js';
import { Modal } from './ui.jsx';
import { m, AnimatePresence, EASE, SPRING, useDraw } from './motion.jsx';
import { Ico } from './icons.jsx';

export const openGuide = () => dispatchEvent(new Event('aali-guide'));
const key = (id) => 'aali-guide:' + id;
const seen = (id) => { try { return localStorage.getItem(key(id)) === 'done'; } catch { return true; } }; // if the device cannot remember, do not nag
const remember = (id) => { try { localStorage.setItem(key(id), 'done'); } catch {} };
const ORDER = ['', 'Overview', 'Sales', 'Delivery', 'Money', 'Management', 'Account']; // the order of the sidebar
const GROUP = 'AaliTech, Aali Conssultancy and Aali Builders';

// Who this person is in the system, in one or two sentences.
function intro(me, n) {
  const tour = `This guide visits each of the ${n} sections your login can open and shows, on the page itself, what you do there.`;
  switch (me.title) {
    case 'bde': return `Your work is sales: finding businesses, calling them, and turning enquiries into deals. ${tour}`;
    case 'salesmgr': return `You run the Sales team: you see every lead, deal, client, quotation and payment, and each BDE’s day. ${tour}`;
    case 'itmgr': return `You run the IT team: every project and support request, and your team’s day. ${tour}`;
    case 'itlead': return `You lead project work in the IT team: projects, support requests and your own day. ${tour}`;
    case 'dev': return `Your work is delivery: the projects and support requests given to you, and your own day. ${tour}`;
    case 'chairman': return `You can see everything across Aali Group – ${GROUP}. Most pages are for reading; you can write remarks on reports and decide approvals. ${tour}`;
    default: return `You look after every activity across Aali Group – ${GROUP}: sales, delivery, money, people and the set-up of this system. ${tour}`;
  }
}
// What one section is for, in the words that fit this person's access to it. Returns the text; the title is the section's name.
function about(k, me) {
  const own = scope(k) === 'own', edit = canEdit(k), top = isTop(me), mgr = isManager(me), t = me.title, sales = me.team === 'sales';
  const ro = edit ? '' : ' Your login can read this page but not change it.', all = top ? ', across all three companies' : '';
  switch (k) {
    case 'daily':
      if (['chairman', 'ops', 'cs', 'admin'].includes(t)) return `Every person writes their day here as it happens. You see all departments side by side: who has started, what each one is doing now, who is out of the office and who needs help. Open a person to read the full report${t === 'chairman' ? ' and write a remark.' : ', remark on it, mark it reviewed or send it back.'}`;
      if (mgr) return 'Two parts. “My team” shows each member’s day as they write it: open one to remark, mark it reviewed or send it back. “My report” is your own day: Start my day, add each task, and submit in the evening.';
      return sales ? 'This is where you work all day. Press Start my day. For each piece of work choose the kind, write the task and press Start. Choosing “Calling” opens your calling list: pick the business, call, tap what happened. Going to meet a client – planned, or one who asks to meet right now? Press “Client visit now” on the dashboard (or choose “Client visit” here): the app asks when you have reached, when you are leaving, how the visit went and where you go next – the office, another client, a break or home. In the evening open “Finish my day”, write tomorrow’s plan and press Submit.'
        : 'This is where you work all day. Press Start my day. For each piece of work choose the kind, write exactly what you are doing and press Start; press Finish when it is done. In the evening open “Finish my day” and press Submit.';
    case 'tasks': return `Small jobs with a date. “My tasks” are yours; the team list is shared with ${top ? 'each team' : 'your team'}. Type in the quick-add box, for example “Send brochure tomorrow 5pm”. A task can be ticked only by the people it is given to${mgr ? ' or by you as a manager' : ', or by a manager'}.`;
    case 'inbox': return 'Messages the system sends to you – for example a new lead, a report that needs your eye, or client files received. The red number in the sidebar counts the ones you have not read.';
    case 'approvals': return `Requests waiting for a yes or a no: a discount above the limit, or work that must start before the advance comes. ${top ? 'You decide for every team.' : 'You decide for your own team.'}`;
    case 'calendar': return `Separate calendars instead of one crowded one${top ? ': the Sales team’s, the IT team’s and Deadlines' : sales ? ': your team’s (follow-ups, calls and meetings, tasks' + (can('money') ? ', payments' : '') + ') and Deadlines' : ': your team’s (projects, milestones, tasks, support) and Deadlines'}. Deadlines shows every date that must not be missed – red when missed, orange when 2 days or less are left; management and the Sales Manager are told 2 days before (the IT Manager for IT work). Tap a day to see everything on it, and to add a task for that day.${t === 'bde' ? '' : ' “Project progress” in the IT calendar shows each project as a bar from its start to its delivery date.'}`;
    case 'reports': return `Totals for ${top ? 'the whole group' : 'your team'}: leads by source, deals won, money collected, calls made and time by kind of work.${ro}`;
    case 'leads': return own ? 'Every enquiry that is yours. “+ New enquiry” adds one; the system checks the mobile number and the service so the same person is not entered twice. Set the next follow-up date after every talk, and press Convert when they agree – that makes the client and the deal.'
      : `Every enquiry of every BDE${all}. Filter by company, or type a BDE’s name.${edit ? ' You can add or import enquiries and move a lead to another BDE.' : ro}`;
    case 'calls': return own ? `Every business kept for you to call. Upload your list here; each number is checked first, because one business must have only one caller. A business that says no, or does not answer ${settings().calling?.maxTries || 3} times, is stopped for everyone until the Sales Manager reopens it.`
      : `The whole call register: which BDE holds which business, how each one answered, and the Do Not Call list.${edit ? ' You can add a Do Not Call number, reopen a stopped business, or give it to another BDE.' : ro}`;
    case 'deals': return own ? 'Your deals, each card in its stage from left to right. Drag a card to move it. When a deal is won, write the handoff note – that starts the project for the IT team.'
      : `Every deal by stage, with its value and its chance of being won${all}.${ro}`;
    case 'clients': return own ? 'Your clients, each with their contacts, deals and projects in one place.' : `Every client${all}, with contacts, deals, projects and payments.${ro}`;
    case 'quotes': return `Quotations. Pick the client and the items; a discount above the limit asks for approval. Print it, or send it on WhatsApp with one tap.${ro}`;
    case 'clientpay': return canEdit('clientpay') ? 'Client payroll: the payroll Aali Conssultancy does for its clients. “+ New payroll client” first asks whether they pay daily wages, a monthly salary or both, then their details, PF/ESI codes, rules and extras (attendance bonus, overtime, canteen…). Add their employees (or upload the Excel), and each month upload the attendance Excel the client sends – or, for a client whose own HRM Aali set up, the days are read from it (Their HRM tab). Aali One works out every payslip in the client’s name.'
      : 'Client payroll: the payroll Aali Conssultancy does for its clients, each kept apart. You can read every client’s months and payslips and write remarks; HR makes the changes.';
    case 'payroll': return canEdit('payroll') ? 'Payroll. Enter each person’s monthly gross, PF / ESI / Professional Tax and fixed deductions such as health insurance once, under Salaries. Each month press “Make payroll”: Aali One reads everyone’s attendance from Aali HRM, works out paid days and the pay, and you check, lock and pay it. Loans and advances are cut by themselves. The Operations Manager reviews it and can write remarks.'
      : 'Payroll, made by HR from Aali HRM’s attendance. You can read every salary and every month, review it and write remarks for HR; HR makes the changes.';
    case 'agreements': return t === 'ops' ? 'Client agreements. A service agreement is made when a client says yes – start it from the deal or the accepted quotation and most of it is filled in. When a project is finished, you make the closure agreement from the project: what was delivered, what was handed over and what is still to be paid. Print it, get it signed, mark it signed and attach the signed copy. A signed agreement cannot be changed.'
      : t === 'salesmgr' ? 'Client agreements. Make the service agreement when a client says yes – start it from the deal or the accepted quotation and most of it is filled in. Print it, get it signed, mark it signed and attach the signed copy. Closure agreements at the end of a project are made by the Operations Manager; you can read them.'
      : 'Every client service agreement and project closure agreement, with the signed copy. The Operations Manager and the Sales Manager make them. Your login can read this page but not change it.';
    case 'projects': return t === 'bde' ? 'The projects of your own clients, so you can tell a client how far the work has come. You can read here, not change.'
      : t === 'dev' ? 'The projects you work on: your tasks, the milestones and the stage of each one.'
      : me.team === 'it' ? `Every project: its stage, tasks, milestones and delivery date. Work starts only after the advance is received, and changing a delivery date needs a reason.${t === 'itmgr' ? ' You choose the lead for each project.' : ''}`
      : `Every project${all} and how far it has come.${ro}`;
    case 'support': return `Requests from clients after delivery, each with a promised date.${own ? ' You see the ones that are yours.' : ''}${ro}`;
    case 'assets': return t === 'bde' ? 'When a client sends you a logo, photos or documents, upload them here and choose who they go to – the IT Manager or the Sales Manager. You can follow what happens to them.'
      : t === 'salesmgr' ? 'Client files uploaded by the BDEs. The ones sent to you wait here: give each to the person who will do the work. You are also told when a BDE sends files to the IT Manager.'
      : t === 'itmgr' ? 'Client files sent to the IT team wait here: give each to the person who will do the work.'
      : top ? `Every client file uploaded: who it went to, who is working on it, and whether it is done.${ro}` : 'Client files given to you for your work. Mark them done when you have used them.';
    case 'bills': return top ? 'Bills the team paid for work – petrol, a courier, a client lunch. You are told the moment one comes in. Open it, check the photo, press Approve; pay it by scanning the person’s UPI QR code shown on the bill, then press “Mark paid”. A wrong bill can be rejected with the reason.'
      : 'Paid for something for work – petrol for a client visit, a courier, a client lunch? Add your UPI QR code once, then press “+ Submit a bill”, fill the form and take a photo of the bill. Management is told at once, approves it and pays it back to your QR code. You are told at each step.';
    case 'money': return `Payments to collect, receipts and tax invoices. “Record payment” makes the receipt and updates the balance; overdue amounts are in red.${ro}`;
    case 'collab': return `The colleges and employers that work with Aali Conssultancy, with their contacts and terms.${ro}`;
    case 'messages': return `Ready-made WhatsApp messages. They open with one tap from a lead, a deal or a payment, with the names already filled in.${ro}`;
    case 'people': return top ? `Everyone in the group, team by team. Add a person, choose their access level, set a new password, or switch a login off. Nobody is ever erased: a removed person moves to the Staff register.${ro}`
      : 'Your team members. You can add a member, set a password, and switch a login off or on. Access levels are set by management.';
    case 'settings': return 'My profile: your photo, the name shown on screen, your mobile number and your password. On the right you can read exactly what your login can open.';
    default: return '';
  }
}
function build(me) {
  const top = isTop(me), mgr = isManager(me), own = scope('leads') === 'own', name = me.display || me.name.split(' ')[0];
  const secs = ORDER.flatMap((g) => SECTIONS.filter((s) => s[3] === g && s[0] !== 'today' && can(s[0]))), S = [];
  const add = (to, icon, title, text, spot = '.page .topbar') => S.push({ to, icon, title, text, spot });
  add('/', 'today', `Welcome, ${name}`, intro(me, secs.length + 1), '[data-guide="hero"]');
  add('/', 'trend', 'Dashboard – your numbers', `${top ? `These tiles are today’s figures for the whole group – ${GROUP}` : mgr ? 'These tiles are today’s figures for your team' : 'These tiles are your own figures for today'}. Tap any tile to open that section.`, '[data-guide="numbers"]');
  add('/', 'alert', 'Dashboard – what needs attention', `Everything that is late or due today is listed here${top ? '; anything left 3 or more days late is sent up to you' : mgr ? ': switch between “For me” and “My team”' : ''}.${own ? ' A call back you promised shows on its day with a “Call now” button.' : ''}`, '[data-guide="attention"]');
  for (const [k, label, to] of secs) {
    add(k === 'settings' ? '/settings/me' : to, k, k === 'people' && !top ? 'My team members' : label, about(k, me));
    if (k !== 'settings') continue;
    if (top) add('/settings/access', 'approvals', 'Settings – who can see what', 'The whole access table: every section against every role. Use it when someone asks why they cannot see a page.');
    if (me.isAdmin) add('/settings/sales', 'settings', 'Settings – sales and report set-up', 'The lists and rules the team works with: services, lead sources, kinds of work, and the calling rules – how long a business stays with a BDE and how many unanswered tries are allowed.');
    if (top) add('/settings/staff', 'people', 'Settings – staff register', 'Every person ever added, when they last signed in, and the ones removed. A removed person can be restored from here.');
    if (top) add('/settings/audit', 'daily', 'Settings – audit log', 'Who did what and when: sign-ins, wrong password tries, changes and deletions.');
  }
  add(null, 'search', 'Search anything', 'Press Search in the sidebar, or Ctrl + K, and type part of a name or a mobile number. It finds leads, clients, businesses and sections that your login can open.', '.side-search');
  add('/', 'help', 'The guide is always here', 'That is everything your login can open. Whenever you are unsure, press Guide at the top of the dashboard; use the list in this box to jump straight to one section.', '[data-guide="guide-btn"]');
  return S;
}

export function Guide() {
  const me = store.me, nav = useNavigate(), loc = useLocation();
  // Not over a single report opened from a WhatsApp message (/daily/<date>/<person>): the welcome waits for the next ordinary visit.
  const [ask, setAsk] = useState(() => !seen(me.id) && !/^\/daily\/\d{4}-\d\d-\d\d\//.test(loc.pathname)), [on, setOn] = useState(false), [at, setAt] = useState(0), [box, setBox] = useState(null);
  const list = useMemo(() => (on || ask ? build(me) : []), [on, ask, me.title, me.isAdmin]), s = list[at], last = at === list.length - 1;
  useEffect(() => { const show = () => { setAsk(false); setAt(0); setOn(true); }; addEventListener('aali-guide', show); return () => removeEventListener('aali-guide', show); }, []);
  // Each step opens its own section.
  useEffect(() => { if (on && s?.to && loc.pathname !== s.to) nav(s.to); }, [on, at]);
  // A gold frame follows the part of the page being explained. It is measured again a few times a second, so it stays right while the page settles or scrolls.
  useEffect(() => {
    if (!on || !s) { setBox(null); return; }
    let moved = false;
    const look = () => { const el = s.spot && document.querySelector(s.spot), r = el?.getBoundingClientRect();
      if (!r || !r.width || !r.height) return setBox(null);
      if (!moved) { moved = true; if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const seenNow = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      setBox((b) => (!seenNow ? null : b && Math.abs(b.top - r.top) < 1 && Math.abs(b.left - r.left) < 1 && Math.abs(b.width - r.width) < 1 && Math.abs(b.height - r.height) < 1 ? b : { top: r.top, left: r.left, width: r.width, height: r.height })); };
    const first = setTimeout(look, 350), h = setInterval(look, 220);
    return () => { clearTimeout(first); clearInterval(h); };
  }, [on, at]);
  const end = () => { remember(me.id); setOn(false); setAsk(false); };
  const draw = useDraw(`${on}${ask}${at}`); // the step's icon draws itself each time the step changes
  if (ask) return <Modal title="Welcome to Aali One" onClose={end} footer={<><button className="btn ghost sm" type="button" onClick={end}>Not now</button>
    <button className="btn primary" type="button" autoFocus onClick={() => { remember(me.id); setAsk(false); setAt(0); setOn(true); }}><Ico k="play" size={15} />Start the guide</button></>}>
    <div className="guide"><span className="guide-ic" ref={draw}><Ico k="help" size={30} /></span><h2>{`Welcome, ${me.display || me.name.split(' ')[0]}`}</h2>
      <p>{intro(me, list.length ? SECTIONS.filter((x) => can(x[0])).length : 0)}</p><p className="small">It takes about two minutes. You can open it again any time with the Guide button at the top of the dashboard.</p></div></Modal>;
  return createPortal(<AnimatePresence>{on && s && <m.div key="tour" className="tour" role="dialog" aria-label="Guide" initial={{ opacity: 0, y: 26, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, transition: { duration: 0.14 } }} transition={SPRING}>
      <div className="tour-h"><span className="ic" ref={draw}><Ico k={s.icon} /></span><div className="grow"><div className="small muted">Guide · step {at + 1} of {list.length}</div>
        <AnimatePresence mode="wait" initial={false}><m.h3 key={at} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.2, ease: EASE }}>{s.title}</m.h3></AnimatePresence></div>
        <button className="btn ghost sm" type="button" onClick={end}>End guide</button></div>
      <AnimatePresence mode="wait" initial={false}><m.p key={at} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.22, ease: EASE }}>{s.text}</m.p></AnimatePresence>
      <div className="bar" aria-hidden="true"><i style={{ width: `${Math.round(100 * (at + 1) / list.length)}%` }} /></div>
      <div className="tour-f"><select className="in" value={at} onChange={(e) => setAt(+e.target.value)} aria-label="Jump to a section of the guide">{list.map((x, i) => <option key={i} value={i}>{i + 1}. {x.title}</option>)}</select>
        <button className="btn" type="button" disabled={!at} onClick={() => setAt(at - 1)}>Back</button>
        {last ? <button className="btn primary" type="button" onClick={end}>Finish</button> : <button className="btn primary" type="button" onClick={() => setAt(at + 1)}>Next</button>}</div>
    </m.div>}
    {on && box && <m.div key="ring" className="tour-ring" aria-hidden="true" initial={{ opacity: 0, ...pad(box) }} animate={{ opacity: 1, ...pad(box) }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} />}
  </AnimatePresence>, document.body);
}
const pad = (b) => ({ top: b.top - 6, left: b.left - 6, width: b.width + 12, height: b.height + 12 });

// "What is this page?" – one tap from anywhere, for someone new (the user, 18 Oct 2026: easy for a beginner, without hiding anything).
// It says what the open page is for, in the words of this person's role, and can start the full guide.
const sectionAt = (path) => (path === '/' ? 'today' : SECTIONS.filter(([, , to]) => to !== '/' && (path === to || path.startsWith(to + '/'))).sort((a, b) => b[2].length - a[2].length)[0]?.[0]);
export function HelpButton({ className = 'btn sm', label = true, hotkey = false }) {
  const [open, setOpen] = useState(false), { pathname } = useLocation(), me = store.me, k = sectionAt(pathname), name = pathname === '/overview' ? 'Overview' : SECTIONS.find((s) => s[0] === k)?.[1];
  // "?" opens it from anywhere (only one of the Help buttons listens), unless the cursor is in a box or a pop-up is open.
  useEffect(() => { if (!hotkey) return; const key = (e) => e.key === '?' && !e.ctrlKey && !e.metaKey && !e.target.closest?.('input, textarea, select, [contenteditable="true"]') && !document.querySelector('.modal, .search') && setOpen(true);
    addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, [hotkey]);
  const text = pathname === '/overview' ? 'The Overview is today’s work in one place: your numbers, what is late, what is due today and in the next 7 days, and what waits for your approval. Each number opens its page.'
    : (k && about(k, me)) || 'Each app on the Home page holds a few pages. Open one, and its pages are listed in the menu on the left. Press Ctrl + K to find anything by name or number.';
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)} aria-label="What is this page?" title="What is this page?"><Ico k="help" size={16} />{label && <span>Help</span>}</button>
    {open && <Modal title={name ? `${name}: what is this page?` : 'How Aali One works'} onClose={() => setOpen(false)} footer={<>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Got it</button>
      <button type="button" className="btn primary" onClick={() => { setOpen(false); setTimeout(openGuide, 200); }}>Show me around</button></>}>
      <p style={{ margin: 0 }}>{text}</p>
      <p className="small muted" style={{ margin: '12px 0 0' }}>Shortcuts: <kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd> to search any name or number, open a recent page or start something new · <kbd>?</kbd> for this help · <kbd>Esc</kbd> to close a pop-up.</p>
    </Modal>}
  </>;
}
