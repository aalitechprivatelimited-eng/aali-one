import { useEffect, useRef, useState } from 'react';
import { create, remove, upload, list, store } from './api.js';
import { uname, initials, fmtDT, fmtDate, rel, due, activeUsers, TITLES, fill, waLink, settings, isManager } from './lib.js';

// ---------- toast ----------
let toastSet = null;
export function Toaster() {
  const [t, setT] = useState(null); toastSet = setT;
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), t.bad ? 5000 : 3000); return () => clearTimeout(h); }, [t]);
  return t ? <div className={'toast' + (t.bad ? ' bad' : '')} role="status">{t.msg}</div> : null;
}
export const toast = (msg, bad = false) => toastSet?.({ msg, bad, k: Math.random() });
export async function attempt(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r ?? true; } catch (e) { toast(e.message, true); return false; } }

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} type="button">Close</button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}
export function Field({ label, children, full, hint }) {
  return <div className={'field' + (full ? ' full' : '')}><label>{label}</label>{children}{hint && <span className="small muted">{hint}</span>}</div>;
}
export const In = (p) => <input className="in" {...p} />;
export const Area = (p) => <textarea className="in" {...p} />;
export function Sel({ options, value, onChange, blank, ...p }) {
  const opts = Array.isArray(options) ? options.map((o) => (typeof o === 'string' ? [o, o] : o)) : Object.entries(options);
  return <select className="in" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p}>{blank !== undefined && <option value="">{blank}</option>}{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
export function Seg({ value, onChange, options }) {
  return <div className="seg" role="group">{options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export function Tabs({ value, onChange, tabs }) {
  return <div className="tabs" role="tablist">{tabs.map(([v, l]) => <button key={v} role="tab" type="button" aria-selected={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export const Pill = ({ k = '', children }) => <span className={'pill ' + k}>{children}</span>;
export const Sample = ({ on }) => on ? <Pill k="sample">Sample</Pill> : null;
export function Due({ date }) { return date ? <Pill k={due(date)}>{rel(date)}</Pill> : null; }
export const Av = ({ id }) => <span className="av" title={uname(id)}>{id ? initials(uname(id) === 'You' ? store.me.name : uname(id)) : '–'}</span>;
export const Avs = ({ ids }) => { const u = [...new Set(ids.filter(Boolean))]; return <span className="avs">{u.slice(0, 3).map((i) => <Av key={i} id={i} />)}{u.length > 3 && <span className="small muted">+{u.length - 3}</span>}</span>; };
export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function Person({ value, onChange, filter, blank = 'Unassigned', disabled }) {
  const us = activeUsers().filter(filter || (() => true));
  return <Sel value={value} onChange={onChange} blank={blank} disabled={disabled} options={us.map((u) => [u.id, `${u.name} · ${TITLES[u.title] || u.title}`])} />;
}
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
