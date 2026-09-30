import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { http } from '../api.js';
import { DEFAULT_SETTINGS } from '../../shared/defaults.js';
import { Field, In, Sel, Area, attempt } from '../ui.jsx';

// The public website enquiry form (no login). Share /enquire or embed it on aaliconssultancy.com.
export function Enquire() {
  const [f, setF] = useState({ name: '', mobile: '', service: '', company: '', email: '', message: '', website: '' }), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function send(e) { e.preventDefault(); setBusy(true); if (await attempt(() => http('POST', '/public/enquiry', f))) setDone(true); setBusy(false); }
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
    <div className="card stack" style={{ width: 'min(520px,100%)', padding: 24 }}>
      <div className="row"><img src="/icon.svg" alt="" width="36" height="36" /><div><h1>Aali Conssultancy</h1><div className="small muted">Websites · apps · software · digital marketing</div></div></div>
      {done ? <div className="banner ok">Thank you! We have your enquiry and will call you soon.</div> : <form className="stack" onSubmit={send}>
        <p style={{ margin: 0 }}>Tell us what you need. We'll call you back.</p>
        <Field label="Your name *"><In value={f.name} onChange={up('name')} required autoComplete="name" /></Field>
        <Field label="Mobile *"><In type="tel" value={f.mobile} onChange={up('mobile')} required autoComplete="tel" /></Field>
        <Field label="What do you need? *"><Sel value={f.service} onChange={(v) => setF({ ...f, service: v })} options={DEFAULT_SETTINGS.services.map((s) => s.name)} blank="Choose…" required /></Field>
        <Field label="Company"><In value={f.company} onChange={up('company')} autoComplete="organization" /></Field>
        <Field label="Email"><In type="email" value={f.email} onChange={up('email')} autoComplete="email" /></Field>
        <Field label="Message"><Area value={f.message} onChange={up('message')} /></Field>
        <input tabIndex="-1" autoComplete="off" value={f.website} onChange={up('website')} style={{ position: 'absolute', left: -9999 }} aria-hidden="true" />
        <button className="btn primary" disabled={busy} type="submit">{busy ? 'Sending…' : 'Send enquiry'}</button></form>}
    </div></div>;
}

// Read-only client progress page (/p/:token).
export function Progress() {
  const { token } = useParams(), [d, setD] = useState(null), [err, setErr] = useState('');
  useEffect(() => { http('GET', '/public/progress/' + token).then(setD, (e) => setErr(e.message)); }, [token]);
  const stages = DEFAULT_SETTINGS.projectStages.filter((s) => !['onhold', 'awaiting'].includes(s.key));
  if (err) return <div className="empty" style={{ margin: 40 }}>{err}</div>;
  if (!d) return <div className="empty" style={{ margin: 40 }}>Loading…</div>;
  const at = stages.findIndex((s) => s.key === d.stage);
  return <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }} className="stack">
    <div className="row"><img src="/icon.svg" alt="" width="36" height="36" /><div><b style={{ fontFamily: 'var(--doc)', fontSize: 18 }}>{d.business.name}</b><div className="small muted">Project progress</div></div></div>
    <div className="card stack"><h1>{d.name}</h1><div className="muted">{d.client}{d.deadline ? ` · target date ${d.deadline}` : ''}</div>
      <div className="bar" style={{ height: 12 }}><i style={{ width: d.progress + '%' }} /></div><div className="small">{d.progress}% of the work is done</div>
      <div className="row">{stages.map((s, i) => <span key={s.key} className={'pill ' + (i < at ? 'ok' : i === at ? 'gold' : '')}>{i < at ? '✓ ' : ''}{s.label}</span>)}</div></div>
    <div className="card stack"><h2>Milestones</h2>{d.milestones.length ? d.milestones.map((m, i) => <div key={i} className="row"><span>{m.done ? '◆✓' : '◆'}</span><span className="grow">{m.title}</span><span className="num small">{m.due}</span></div>) : <p className="muted">Milestones will appear here.</p>}</div>
    <p className="small muted">Questions? Call {d.business.phone} or email {d.business.email}.</p></div>;
}
