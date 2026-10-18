// Search everything: press Ctrl + K (or the Search button), type a name or a number, press Enter.
// It looks only through what this person's login can already see, and through the sections of the sidebar.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useStore, list, store } from './api.js';
import { can, canEdit, inr, stageLabel, pStageLabel, clientName, uname } from './lib.js';
import { SECTIONS } from '../shared/access.js';
import { m, AnimatePresence, EASE } from './motion.jsx';
import { Ico } from './icons.jsx';

export const openSearch = () => dispatchEvent(new Event('aali-search'));
// The pages this person opened lately, newest first – kept on this device only, so Ctrl + K brings them back in one tap (18 Oct 2026).
// Kept per person, so on a shared computer one person never sees another's pages; signing out removes them too (src/api.js).
const RECENT = () => 'aali-recent:' + (store.me?.id || '');
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT()) || '[]').filter((r) => r && r.to && r.title); } catch { return []; } };
const sectionOf = (path) => SECTIONS.filter(([, , to]) => to !== '/' && (path === to || path.startsWith(to + '/'))).sort((a, b) => b[2].length - a[2].length)[0];
export function rememberPage(path, title) {
  if (path === '/' || !title || !sectionOf(path)) return;
  try { localStorage.setItem(RECENT(), JSON.stringify([{ to: path, title: title.slice(0, 80) }, ...recent().filter((r) => r.to !== path)].slice(0, 8))); } catch {}
}
const EACH = 5; // results shown per kind
const SHORTCUTS = ['Recent', 'Go to', 'Start something new']; // the groups that are not records
// Things to start, for the people allowed to (18 Oct 2026): typing "new", "invoice" or "receipt" offers them, so nobody hunts for the button.
const ACTIONS = [['quotes', 'New quotation', '/quotes/new', 'quotes'], ['agreements', 'New service agreement', '/agreements/new?kind=service', 'agreements'],
  ['invoices', 'New B2B tax invoice', '/invoices/new?kind=b2b', 'invoices'], ['invoices', 'New B2C tax invoice', '/invoices/new?kind=b2c', 'invoices'], ['money', 'New receipt', '/payments/receipt/new', 'money']];

function find(q) {
  const text = q.trim().toLowerCase(), digits = text.replace(/\D/g, ''), out = [];
  const hit = (...f) => f.some((x) => String(x || '').toLowerCase().includes(text)) || (digits.length >= 4 && f.some((x) => String(x || '').replace(/\D/g, '').includes(digits)));
  const add = (group, icon, rows) => rows.length && out.push({ group, icon, rows: rows.slice(0, EACH) });
  add('Recent', 'clock', recent().filter((r) => r.to !== location.pathname && (!text || r.title.toLowerCase().includes(text))).map((r) => { const sec = sectionOf(r.to);
    return { id: 'r' + r.to, icon: sec && can(sec[0]) ? sec[0] : 'clock', title: r.title, sub: sec?.[1], to: r.to }; }).filter((r) => r.icon !== 'clock'));
  add('Go to', 'today', [...SECTIONS, ['today', 'Overview', '/overview']].filter(([k, label]) => can(k) && (!text || label.toLowerCase().includes(text))).map(([k, label, to]) => ({ id: 's' + to, icon: k, title: label, to })).slice(0, text ? EACH : 21));
  add('Start something new', 'check', ACTIONS.filter(([k, label]) => canEdit(k) && (!text || ['new', 'add', 'make', 'create'].some((w) => w.startsWith(text)) || label.toLowerCase().includes(text)))
    .map(([k, title, to, icon]) => ({ id: 'a' + to, icon, title, to })));
  if (text.length < 2) return out;
  if (can('leads')) add('Leads', 'leads', list('lead').filter((x) => hit(x.name, x.mobile, x.company, x.service)).map((x) => ({ id: x.id, title: x.name, sub: [x.mobile, x.company, x.service].filter(Boolean).join(' · '), to: `/leads/${x.id}` })));
  if (can('clients')) add('Clients', 'clients', list('client').filter((x) => !x.card && hit(x.name, x.phone, x.city)).map((x) => ({ id: x.id, title: x.name, sub: [x.phone, x.city].filter(Boolean).join(' · '), to: `/clients/${x.id}` })));
  if (can('deals')) add('Deals', 'deals', list('deal').filter((x) => hit(x.title, clientName(x.clientId), x.phone)).map((x) => ({ id: x.id, title: x.title, sub: `${inr(x.value)} · ${stageLabel(x.stage)}`, to: `/deals/${x.id}` })));
  if (can('calls')) add('Call register', 'calls', list('prospect').filter((x) => hit(x.name, x.phone, x.phone10, x.place)).map((x) => ({ id: x.id, title: x.name || x.phone, sub: [x.phone, x.place, x.owner && 'with ' + uname(x.owner)].filter(Boolean).join(' · '), to: '/calls', state: { q: x.phone10 || x.name } })));
  if (can('quotes')) add('Quotations', 'quotes', list('quote').filter((x) => hit(x.number, x.clientName, x.subject)).map((x) => ({ id: x.id, title: `${x.number || 'Draft'} · ${x.clientName || ''}`, sub: x.subject || '', to: `/quotes/${x.id}` })));
  if (can('agreements')) add('Agreements', 'agreements', list('agreement').filter((x) => hit(x.number, x.clientName, x.title, x.project)).map((x) => ({ id: x.id, title: `${x.number} · ${x.clientName || ''}`, sub: x.kind === 'closure' ? 'Closure – ' + (x.project || '') : x.title || '', to: `/agreements/${x.id}` })));
  if (can('projects')) add('Projects', 'projects', list('project').filter((x) => hit(x.name, x.clientName)).map((x) => ({ id: x.id, title: x.name, sub: [x.clientName, pStageLabel(x.stage)].filter(Boolean).join(' · '), to: `/projects/${x.id}` })));
  add('Tasks', 'tasks', list('task').filter((x) => x.status !== 'done' && hit(x.title)).map((x) => ({ id: x.id, title: x.title, sub: x.due ? 'due ' + x.due : '', to: x.projectId ? `/projects/${x.projectId}` : '/tasks' })));
  if (can('support')) add('Support', 'support', list('ticket').filter((x) => hit(x.number, x.title)).map((x) => ({ id: x.id, title: `${x.number} · ${x.title}`, sub: x.status, to: '/support' })));
  return out;
}

export function Search() {
  useStore();
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [at, setAt] = useState(0), nav = useNavigate(), box = useRef(null);
  useEffect(() => {
    // Ctrl + K anywhere; "/" too, when the cursor is not in a box.
    const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e) && !document.querySelector('.modal, .tour')) { e.preventDefault(); setOpen(true); } }, show = () => setOpen(true);
    addEventListener('keydown', key); addEventListener('aali-search', show);
    return () => { removeEventListener('keydown', key); removeEventListener('aali-search', show); };
  }, []);
  useEffect(() => { if (open) { setQ(''); setAt(0); } }, [open]);
  const groups = useMemo(() => (open ? find(q) : []), [open, q]), flat = groups.flatMap((g) => g.rows.map((r) => ({ ...r, icon: r.icon || g.icon })));
  const go = (r) => { if (!r) return; setOpen(false); nav(r.to, r.state ? { state: r.state } : undefined); };
  const keys = (e) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = flat.length ? (at + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length : 0; setAt(n); box.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { e.preventDefault(); go(flat[at]); }
  };
  let i = -1;
  return createPortal(<AnimatePresence>{open && <m.div key="search" className="search-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18 }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
    <m.div className="search" role="dialog" aria-modal="true" aria-label="Search Aali One" initial={{ opacity: 0, y: -14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }} transition={{ duration: 0.22, ease: EASE }} onKeyDown={keys}>
      <div className="search-in"><Ico k="search" size={20} /><input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} placeholder="Search a name, a number, or a section" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="search-list" />
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Close</button></div>
      <div className="search-list" id="search-list" role="listbox" ref={box}>
        {groups.map((g) => <div key={g.group}><div className="search-h">{g.group}</div>
          {g.rows.map((r) => { i++; const n = i; return <button key={r.id} type="button" role="option" aria-selected={n === at} data-i={n} className={'search-row' + (n === at ? ' on' : '')} onMouseMove={() => n !== at && setAt(n)} onClick={() => go(r)}>
            <span className="ic"><Ico k={r.icon || g.icon} size={16} /></span><span className="grow"><b className="ell" style={{ display: 'block' }}>{r.title}</b>{r.sub && <span className="small muted ell" style={{ display: 'block' }}>{r.sub}</span>}</span></button>; })}</div>)}
        {q.trim().length >= 2 && !groups.length && <div className="search-none">Nothing found for “{q.trim()}”. Try the mobile number, or fewer letters.</div>}
        {q.trim().length >= 2 && groups.length > 0 && groups.every((g) => SHORTCUTS.includes(g.group)) && <div className="search-none">No lead, client or business matches “{q.trim()}”.</div>}
      </div>
      <div className="search-f"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>
    </m.div></m.div>}</AnimatePresence>, document.body);
}
