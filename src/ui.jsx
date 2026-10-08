import { Children, cloneElement, isValidElement, useEffect, useId as useUid, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { create, remove, upload, list, store } from './api.js';
import { m, AnimatePresence, SPRING, EASE, CountUp, useDraw } from './motion.jsx';
import { Ico } from './icons.jsx';
import { uname, initials, fmtDT, fmtDate, rel, due, activeUsers, TITLES, desig, fill, waLink, settings, isManager, user, COMPANIES } from './lib.js';

// ---------- toast ----------
let toastSet = null;
export function Toaster() {
  const [t, setT] = useState(null); toastSet = setT;
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), t.bad ? 5000 : 3000); return () => clearTimeout(h); }, [t]);
  return <AnimatePresence>{t && <m.div key={t.k} className={'toast' + (t.bad ? ' bad' : '')} role="status" initial={{ opacity: 0, y: 26, x: '-50%', scale: 0.94 }} animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }} exit={{ opacity: 0, y: 14, x: '-50%', scale: 0.97, transition: { duration: 0.16 } }} transition={SPRING}>
    <Ico k={t.bad ? 'alert' : 'check'} />{t.msg}</m.div>}</AnimatePresence>;
}
export const toast = (msg, bad = false) => toastSet?.({ msg, bad, k: Math.random() });
export async function attempt(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r ?? true; } catch (e) { toast(e.message, true); return false; } }

// The page behind stays still while a pop-up (or the phone menu) is open. The room its scroll bar took is kept, so nothing jumps sideways.
let locks = 0;
export function lockPage(by) {
  const el = document.documentElement, was = locks; locks += by;
  if (!was && locks) { const bar = innerWidth - el.clientWidth; el.style.overflow = 'hidden'; document.body.style.paddingRight = bar ? bar + 'px' : ''; }
  if (was && !locks) { el.style.overflow = ''; document.body.style.paddingRight = ''; }
}
const openModals = []; // a pop-up opened over another one: Esc closes only the top one
export function Modal({ title, onClose, children, footer, wide }) {
  const [shut, setShut] = useState(false), close = () => setShut(true), me = useRef({}); // closing plays first; the page is told when it has finished
  useEffect(() => { openModals.push(me.current); const k = (e) => e.key === 'Escape' && openModals[openModals.length - 1] === me.current && close(); addEventListener('keydown', k);
    return () => { removeEventListener('keydown', k); openModals.splice(openModals.indexOf(me.current), 1); }; }, []);
  useEffect(() => { lockPage(1); return () => lockPage(-1); }, []);
  return createPortal(
    <m.div className="modal-bg" initial={{ opacity: 0 }} animate={{ opacity: shut ? 0 : 1 }} transition={{ duration: shut ? 0.15 : 0.22 }} onAnimationComplete={() => shut && onClose()} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <m.div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 28, scale: 0.96 }} animate={shut ? { opacity: 0, y: 14, scale: 0.98 } : { opacity: 1, y: 0, scale: 1 }} transition={shut ? { duration: 0.15, ease: 'easeIn' } : SPRING}>
        <div className="modal-h"><h2>{title}</h2><button className="btn ghost sm" onClick={close} type="button">Close</button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </m.div>
    </m.div>, document.body);
}
export function Field({ label, children, full, hint }) {
  // The label is tied to its box, so a screen reader names the box and a click on the label puts the cursor in it.
  const id = useUid(), kids = Children.toArray(children), at = kids.findIndex((c) => isValidElement(c) && typeof c.type !== 'string' && !c.props.id);
  if (at >= 0) kids[at] = cloneElement(kids[at], { id }); // the first box inside the field is the one the label names
  return <div className={'field' + (full ? ' full' : '')}><label htmlFor={at >= 0 ? id : undefined}>{label}</label>{kids}{hint && <span className="small muted">{hint}</span>}</div>;
}
export const In = (p) => (p.type === 'date' ? <DateIn {...p} /> : <input className="in" {...p} />);

// A date box the Indian way – shown and typed as DD-MM-YYYY whatever language the browser is set to (a plain date box follows the
// browser, so a US-English one shows mm/dd/yyyy). The value stays YYYY-MM-DD as before. Typed as 08-10-2026, 8/10/2026, 08102026
// or 2026-10-08; the calendar button opens the browser's own date picker. A date outside min/max is marked and not taken.
const isoDate = (y, mo, d) => { const s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, t = Date.parse(s + 'T00:00:00Z'); return +y > 1900 && !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s ? s : ''; };
const readDate = (t) => { const s = String(t || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d\d)-(\d\d)$/))) return isoDate(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/)) || (m = s.match(/^(\d\d)(\d\d)(\d{4})$/))) return isoDate(m[3], m[2], m[1]);
  return ''; };
export const dmy = (iso) => (/^\d{4}-\d\d-\d\d$/.test(iso || '') ? iso.split('-').reverse().join('-') : '');
function DateIn({ value, onChange, min, max, disabled, style, className, type, ...p }) {
  const [text, setText] = useState(() => dmy(value)), pick = useRef(null);
  useEffect(() => { if (readDate(text) !== (value || '')) setText(dmy(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps -- only a change from outside
  const iso = readDate(text), bad = !!text && (!iso || (min && iso < min) || (max && iso > max));
  const send = (v) => onChange?.({ target: { value: v, type: 'date', name: p.name } });
  const typed = (e) => { const t = e.target.value.slice(0, 10), d = readDate(t); setText(t);
    if (!t.trim()) send(''); else if (d && (!min || d >= min) && (!max || d <= max)) send(d); };
  return <span className={'datein' + (bad ? ' bad' : '')} style={style}>
    <input className={className || 'in'} {...p} type="text" inputMode="numeric" autoComplete="off" placeholder="DD-MM-YYYY" value={text} onChange={typed} disabled={disabled}
      aria-invalid={bad || undefined} onBlur={(e) => { if (!bad) setText(dmy(value)); p.onBlur?.(e); }} />
    <button type="button" className="datein-pick" aria-label="Choose the date from a calendar" title="Calendar" disabled={disabled} tabIndex={-1}
      onClick={() => { try { pick.current.showPicker(); } catch { pick.current.focus(); } }}><Ico k="calendar" size={16} /></button>
    <input ref={pick} type="date" className="datein-native" tabIndex={-1} aria-hidden="true" value={value || ''} min={min} max={max} disabled={disabled}
      onChange={(e) => { setText(dmy(e.target.value)); send(e.target.value); }} />
  </span>;
}
export const Area = (p) => <textarea className="in" {...p} />;
export function Sel({ options, value, onChange, blank, ...p }) {
  const opts = Array.isArray(options) ? options.map((o) => (typeof o === 'string' ? [o, o] : o)) : Object.entries(options);
  return <select className="in" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p}>{blank !== undefined && <option value="">{blank}</option>}{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
export function Seg({ value, onChange, options }) {
  const id = useUid();
  return <div className="seg" role="group">{options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{value === v && <m.span layoutId={'seg' + id} className="seg-pill" transition={SPRING} />}{l}</button>)}</div>;
}
export function Tabs({ value, onChange, tabs }) {
  const id = useUid();
  return <div className="tabs" role="tablist">{tabs.map(([v, l]) => <button key={v} role="tab" type="button" aria-selected={value === v} onClick={() => onChange(v)}>{l}{value === v && <m.span layoutId={'tab' + id} className="tab-line" transition={SPRING} />}</button>)}</div>;
}
export const Pill = ({ k = '', children }) => <span className={'pill ' + k}>{children}</span>;
export const Sample = ({ on }) => on ? <Pill k="sample">Sample</Pill> : null;
export function Due({ date }) { return date ? <Pill k={due(date)}>{rel(date)}</Pill> : null; }
// A person's round picture: their photo if they added one, otherwise their initials.
export const Avatar = ({ u, title }) => (u?.photo ? <img className="av" src={'/api/files/' + u.photo} alt="" title={title} /> : <span className="av" title={title}>{initials(u?.fullName || u?.name)}</span>);
export const Av = ({ id }) => (id ? <Avatar u={user(id) || { name: uname(id) }} title={uname(id)} /> : <span className="av">–</span>);
export const Avs = ({ ids }) => { const u = [...new Set(ids.filter(Boolean))]; return <span className="avs">{u.slice(0, 3).map((i) => <Av key={i} id={i} />)}{u.length > 3 && <span className="small muted">+{u.length - 3}</span>}</span>; };
export function Empty({ children }) {
  const draw = useDraw();
  return <m.div className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}><span className="empty-ic" ref={draw}><Ico k="empty" size={22} /></span><div>{children}</div></m.div>;
}
// A number tile. A number counts up; text is shown as it is. With "to" the whole tile is a link.
export function Stat({ label, value, format, sub, tone = '', to, icon, children }) {
  const body = <>{icon && <span className="ic"><Ico k={icon} /></span>}<span className="l">{label}</span>
    <span className={'v' + (typeof value === 'number' ? '' : ' txt')}>{typeof value === 'number' ? <CountUp value={value} format={format} /> : value}</span>
    {sub && <span className="small muted">{sub}</span>}{children}</>;
  const cls = 'stat' + (tone ? ' ' + tone : '');
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
// A long list shown a page at a time. usePaged(rows, 25, resetKey) → the rows of this page, and the page turner to put under the table.
export function usePaged(rows, size = 25, resetKey = '') {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(rows.length / size)), at = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [resetKey]);
  const from = at * size, to = Math.min(rows.length, from + size);
  const pager = rows.length > size ? <div className="pager"><span className="small muted">Showing <b>{from + 1}–{to}</b> of {rows.length}</span>
    <div className="row"><button className="btn sm" type="button" disabled={!at} onClick={() => setPage(at - 1)}>← Previous</button><span className="small muted">Page {at + 1} of {pages}</span>
      <button className="btn sm" type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next →</button></div></div> : null;
  return [rows.slice(from, to), pager];
}
// View-only access: everything inside can be read, nothing can be changed.
export const RO = ({ when, children }) => (when ? <fieldset disabled className="ro">{children}</fieldset> : children);
export const ViewOnly = ({ when }) => (when ? <Pill k="info">View only</Pill> : null);

// Choose one from a list that keeps growing – a client among hundreds, a deal, a person – by typing part of its name.
// It opens like a drop-down (click it and the list shows); typing narrows the list; ↑ ↓ and Enter work too.
// options: [[value, name, small text]]. Short fixed lists stay ordinary drop-downs (Sel).
export function Pick({ options, value, onChange, blank = 'Choose…', disabled, id, style }) {
  const [q, setQ] = useState(''), [open, setOpen] = useState(false), [at, setAt] = useState(0), [box, setBox] = useState(null), ref = useRef(null), pop = useRef(null);
  const cur = options.find((o) => o[0] === value), text = q.trim().toLowerCase(), found = text ? options.filter((o) => `${o[1]} ${o[2] || ''}`.toLowerCase().includes(text)) : options;
  const rows = [...(text ? [] : [['', blank]]), ...found.slice(0, 60)], more = found.length - 60; // the "none" choice leads the list until you type
  const pick = (v) => { onChange(v); setOpen(false); setQ(''); }, show = () => { if (!disabled) { setOpen(true); setAt(0); } };
  // The list is drawn over everything (a pop-up window would cut it off), right under the box – or above it when there is no room below.
  useEffect(() => { if (!open) return; const place = () => { const r = ref.current.getBoundingClientRect(), up = innerHeight - r.bottom < 250 && r.top > innerHeight - r.bottom;
    setBox({ left: r.left, width: r.width, ...(up ? { bottom: innerHeight - r.top + 6, maxHeight: Math.min(320, r.top - 16) } : { top: r.bottom + 6, maxHeight: Math.min(320, innerHeight - r.bottom - 16) }) }); };
    place(); addEventListener('scroll', place, true); addEventListener('resize', place); return () => { removeEventListener('scroll', place, true); removeEventListener('resize', place); }; }, [open]);
  useEffect(() => { pop.current?.children[at]?.scrollIntoView({ block: 'nearest' }); }, [at]);
  function key(e) {
    if (!open) { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); show(); } return; }
    if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setOpen(false); setQ(''); } // closes the list, not the pop-up window behind it
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(0, Math.min(rows.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1)))); }
    if (e.key === 'Enter') { e.preventDefault(); if (rows[at]) pick(rows[at][0]); }
  }
  return <div className={'pick' + (disabled ? ' off' : '')} style={style} ref={ref}>
    <input className="in" id={id} role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off" disabled={disabled} value={open ? q : cur ? cur[1] : ''} placeholder={open && cur ? cur[1] : open ? 'Type a name to search' : blank}
      onFocus={show} onClick={show} onBlur={() => { setOpen(false); setQ(''); }} onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }} onKeyDown={key} />
    {cur && !open && !disabled ? <button type="button" className="clear" aria-label={`Clear: back to “${blank}”`} title={`Back to “${blank}”`} onClick={() => pick('')}>×</button> : <span className="caret" aria-hidden="true" />}
    {open && box && createPortal(<div className="pick-pop" role="listbox" ref={pop} style={box} onMouseDown={(e) => e.preventDefault()}>
      {rows.map((o, i) => <button key={o[0] || 'none'} type="button" role="option" tabIndex={-1} aria-selected={o[0] === (value || '')} className={i === at ? 'at' : ''} onMouseEnter={() => setAt(i)} onClick={() => pick(o[0])}>{o[0] ? <b>{o[1]}</b> : <span className="muted">{o[1]}</span>}{o[2] && <span className="small muted"> · {o[2]}</span>}</button>)}
      {!found.length && <div className="small muted note">Nothing matches “{q}”.</div>}
      {more > 0 && <div className="small muted note">{more} more – type a few letters to find one.</div>}</div>, document.body)}
  </div>;
}
export function Person({ value, onChange, filter, blank = 'Unassigned', disabled, id }) {
  const us = activeUsers().filter(filter || (() => true));
  return <Pick id={id} value={value} onChange={onChange} blank={blank} disabled={disabled} options={us.map((u) => [u.id, u.name, desig(u)])} />;
}
// Find a person by typing part of their name, instead of scrolling a long list.
export function PersonSearch({ value, onChange, filter, blank = 'Everyone', company }) {
  const [q, setQ] = useState(''), [open, setOpen] = useState(false), cur = user(value), text = q.trim().toLowerCase();
  const hits = activeUsers().filter(filter || (() => true)).filter((u) => (!company || u.company === company) && (!text || `${u.name} ${desig(u)} ${u.company}`.toLowerCase().includes(text))).slice(0, 40);
  const pick = (id) => { onChange(id); setOpen(false); setQ(''); };
  return <div className="psearch" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
    <input className="in" role="combobox" aria-expanded={open} aria-label={`${blank}: type a name to search`} value={open ? q : cur ? cur.name : ''} placeholder={`${blank} – type a name`}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQ(''); } if (e.key === 'Enter' && open && hits[0]) { e.preventDefault(); pick(hits[0].id); } }} />
    {value && !open && <button type="button" className="clear" aria-label={`Back to ${blank}`} title={`Back to ${blank}`} onClick={() => pick('')}>×</button>}
    {open && <div className="pop" role="listbox">
      <button type="button" role="option" aria-selected={!value} onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')}>{blank}</button>
      {hits.map((u) => <button key={u.id} type="button" role="option" aria-selected={u.id === value} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(u.id)}><b>{u.name}</b><span className="small muted"> · {desig(u)} · {u.company}</span></button>)}
      {!hits.length && <div className="small muted" style={{ padding: '8px 10px' }}>No one matches “{q}”.</div>}</div>}
  </div>;
}
// The "All BDEs" filter on the list pages: narrow to one company of the group, or type a person's name.
export function TeamFilter({ value, onChange, filter = (u) => u.team === 'sales', blank = 'All BDEs' }) {
  return <><Sel value={value.company || ''} onChange={(v) => onChange({ company: v, owner: '' })} options={COMPANIES} blank="All companies" style={{ width: 'auto' }} aria-label="Company" />
    <PersonSearch value={value.owner || ''} onChange={(v) => onChange({ company: value.company || '', owner: v })} filter={filter} blank={blank} company={value.company} /></>;
}
export const byTeam = (ownerId, f) => (!f.owner || ownerId === f.owner) && (!f.company || user(ownerId)?.company === f.company);

export function People({ value = [], onChange }) {
  const rest = activeUsers().filter((u) => !value.includes(u.id));
  return (
    <div className="row">
      {value.map((id) => <span key={id} className="pill gold">{uname(id)} <button type="button" className="btn ghost sm" style={{ padding: 0 }} aria-label={'Remove ' + uname(id)} onClick={() => onChange(value.filter((x) => x !== id))}>×</button></span>)}
      {!!rest.length && <select className="in" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label="Add person">
        <option value="">+ Add person</option>{rest.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
    </div>
  );
}

export function DeleteButton({ id, needsReason, label = 'Delete', after }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState('');
  return <>
    <button className="btn danger" type="button" onClick={() => setOpen(true)}>{label}</button>
    {open && <Modal title="Delete" onClose={() => setOpen(false)} footer={<>
      <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
      <button className="btn danger" type="button" disabled={needsReason && reason.trim().length < 5}
        onClick={async () => { if (await attempt(() => remove(id, reason), 'Deleted. An admin can restore it from the recycle bin.')) { setOpen(false); after?.(); } }}>Delete</button></>}>
      <div className="stack"><p style={{ margin: 0 }}>It goes to the recycle bin. Its number is never reused.</p>
        <Field label={needsReason ? 'Reason (required, 5+ characters)' : 'Reason (optional)'}><In value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field></div>
    </Modal>}
  </>;
}

export function Log({ items = [] }) {
  if (!items.length) return <p className="muted small">No history yet.</p>;
  return <ul className="log">{items.map((l, i) => <li key={i}><span className="num">{fmtDT(l.at)}</span><span>{l.text} <span className="faint">· {uname(l.by)}</span></span></li>)}</ul>;
}

// Comments with @mentions, stored as 'comment' records.
export function Comments({ relType, relId }) {
  const [text, setText] = useState('');
  const items = list('comment').filter((c) => c.relType === relType && c.relId === relId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const users = activeUsers();
  async function send() {
    const mentions = users.filter((u) => text.toLowerCase().includes('@' + u.name.split(' ')[0].toLowerCase())).map((u) => u.id);
    if (await attempt(() => create('comment', { relType, relId, text, mentions }))) setText('');
  }
  return (
    <div className="stack">
      {items.map((c) => <div className="comment" key={c.id}><div className="row between small"><b>{uname(c.createdBy)}</b><span className="faint">{fmtDT(c.createdAt)}</span></div>
        <div>{c.text.split(/(@\w+)/g).map((p, i) => p.startsWith('@') ? <span key={i} className="mention">{p}</span> : p)}</div></div>)}
      <div className="row"><input className="in grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment. Type @name to mention someone." onKeyDown={(e) => e.key === 'Enter' && text.trim() && send()} />
        <button className="btn" type="button" disabled={!text.trim()} onClick={send}>Post</button></div>
      <span className="small faint">People: {users.map((u) => '@' + u.name.split(' ')[0]).join(' ')}</span>
    </div>
  );
}

export function Attachments({ value = [], onChange }) {
  const ref = useRef(); const [busy, setBusy] = useState(false);
  async function pick(e) {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return; setBusy(true);
    const r = await attempt(() => upload(f), 'File attached.'); setBusy(false);
    if (r) onChange([...value, { id: r.id, name: r.name, size: r.size, mime: r.mime, at: new Date().toISOString(), by: store.me.id }]);
  }
  return (
    <div className="stack gap4">
      {value.map((f) => <div className="row small" key={f.id}><a href={'/api/files/' + f.id} target="_blank" rel="noreferrer">{f.name}</a><span className="faint">{Math.round(f.size / 1024)} KB · {uname(f.by)}</span>
        <button className="btn ghost sm" type="button" onClick={() => onChange(value.filter((x) => x.id !== f.id))}>Remove</button></div>)}
      <div className="row"><button className="btn sm" type="button" disabled={busy} onClick={() => ref.current.click()}>{busy ? 'Uploading…' : '+ Attach file'}</button><span className="small faint">Images, PDF, Word, Excel · max 3 MB</span></div>
      <input ref={ref} type="file" hidden onChange={pick} />
    </div>
  );
}

// WhatsApp message from a template, opened in WhatsApp with one tap.
export function Message({ phone, vars, defaultId }) {
  const tps = settings().templates; const [id, setId] = useState(defaultId || tps[0]?.id);
  const tp = tps.find((t) => t.id === id) || tps[0]; const text = tp ? fill(tp.text, { me: store.me.name.split(' ')[0], ...vars }) : '';
  const link = waLink(phone, text);
  return (
    <div className="stack gap4">
      <div className="row"><Sel value={id} onChange={setId} options={tps.map((t) => [t.id, t.name])} style={{ width: 'auto' }} />
        {link ? <a className="btn wa sm" href={link} target="_blank" rel="noreferrer">Open in WhatsApp</a> : <span className="small faint">Add a 10-digit phone number to send.</span>}
        <button className="btn sm" type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Message copied.'), () => toast('Select the text and copy it.', true))}>Copy</button></div>
      <div className="small muted" style={{ whiteSpace: 'pre-wrap', background: 'var(--gold-50)', padding: 8, borderRadius: 8 }}>{text}</div>
    </div>
  );
}
export const canDelete = (rec) => isManager() || rec.createdBy === store.me.id;
export { fmtDate, fmtDT };
