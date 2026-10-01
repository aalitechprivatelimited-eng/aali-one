// Collaborations of Aali Conssultancy: the colleges and employers it has tied up with. Management only.
import { useState } from 'react';
import { useStore, store, list, create, update } from '../api.js';
import { isTop, fmtDate, diff, today } from '../lib.js';
import { Tabs, Pill, Empty, Field, In, Area, Seg, Modal, Attachments, DeleteButton, Log, attempt } from '../ui.jsx';

const KIND = { college: ['College', 'Colleges', 'Courses offered', 'e.g. B.Tech, MBA, Nursing'], employer: ['Employer', 'Employers', 'Roles they hire for', 'e.g. Sales executive, Accountant'] };
const BLANK = { name: '', city: '', contact: '', phone: '', email: '', offers: '', since: '', validTill: '', terms: '', notes: '', status: 'active', files: [] };
const validity = (c) => c.status !== 'active' ? ['Ended', ''] : !c.validTill ? ['Active', 'ok'] : diff(c.validTill) < 0 ? ['Agreement expired', 'bad'] : diff(c.validTill) <= 30 ? [`Renew in ${diff(c.validTill)} days`, 'warn'] : ['Active', 'ok'];

export default function Collab() {
  useStore(); const me = store.me, canEdit = me.isAdmin || ['ops', 'cs'].includes(me.title);
  const [tab, setTab] = useState('college'), [q, setQ] = useState(''), [edit, setEdit] = useState(null), [busy, setBusy] = useState(false);
  if (!isTop(me)) return <Empty>This section is for management only.</Empty>;
  const all = list('collab'), rows = all.filter((c) => c.kind === tab && (!q.trim() || `${c.name} ${c.city} ${c.offers} ${c.contact}`.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));
  const count = (k) => all.filter((c) => c.kind === k && c.status === 'active').length, soon = all.filter((c) => ['warn', 'bad'].includes(validity(c)[1]));
  const [one, many, offersLabel, offersHint] = KIND[tab], f = edit, up = (k) => (e) => setEdit({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true); const { id, type, createdAt, updatedAt, createdBy, updatedBy, sample, log, ...data } = f;
    const ok = await attempt(() => (id ? update(id, data) : create('collab', data)), id ? 'Saved.' : `${KIND[f.kind][0]} added.`); setBusy(false); if (ok) setEdit(null);
  }
  return <>
    <div className="topbar"><h1>Collaborations <small>Aali Conssultancy · colleges and employers we have tied up with</small></h1>
      {canEdit && <button className="btn primary" type="button" onClick={() => setEdit({ ...BLANK, kind: tab, since: today() })}>+ Add {one.toLowerCase()}</button>}</div>
    <div className="stats">
      <div className="stat"><span className="l">Colleges tied up</span><span className="v">{count('college')}</span></div>
      <div className="stat"><span className="l">Employers tied up</span><span className="v">{count('employer')}</span></div>
      <div className={'stat' + (soon.length ? ' warm' : '')}><span className="l">Agreements to renew</span><span className="v">{soon.length}</span><span className="small muted">expired or ending within 30 days</span></div>
    </div>
    <div className="banner info" style={{ marginBottom: 12 }}>Only the Operations Manager, Company Secretary and Chairman can see this section. {canEdit ? '' : 'You can read it; changes are made by the Operations Manager or Company Secretary.'}</div>
    <Tabs value={tab} onChange={setTab} tabs={[['college', `Colleges (${all.filter((c) => c.kind === 'college').length})`], ['employer', `Employers (${all.filter((c) => c.kind === 'employer').length})`]]} />
    <div className="row" style={{ marginBottom: 10 }}><input className="in" style={{ maxWidth: 320 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${many.toLowerCase()} by name, place or ${tab === 'college' ? 'course' : 'role'}`} aria-label="Search" /></div>
    {rows.length ? <div className="tbl"><table><thead><tr><th>{one}</th><th>Place</th><th>{offersLabel}</th><th>Contact person</th><th>Tied up since</th><th>Agreement</th><th /></tr></thead><tbody>
      {rows.map((c) => { const [l, k] = validity(c); return <tr key={c.id} className="click" onClick={() => setEdit({ ...BLANK, ...c })}>
        <td><b>{c.name}</b>{c.files?.length ? <div className="small muted">{c.files.length} file{c.files.length === 1 ? '' : 's'}</div> : null}</td><td>{c.city || '—'}</td><td style={{ maxWidth: 260 }}>{c.offers || '—'}</td>
        <td>{c.contact || '—'}{c.phone && <div className="small muted num">{c.phone}</div>}</td><td className="num">{c.since ? fmtDate(c.since) : '—'}</td>
        <td><Pill k={k}>{l}</Pill>{c.validTill && <div className="small muted">till {fmtDate(c.validTill)}</div>}</td><td className="small muted">Open</td></tr>; })}</tbody></table></div>
      : <Empty>{q ? 'Nothing matches the search.' : `No ${many.toLowerCase()} added yet.${canEdit ? ` Press “+ Add ${one.toLowerCase()}”.` : ''}`}</Empty>}
    {f && <Modal wide title={f.id ? f.name : `Add ${KIND[f.kind][0].toLowerCase()}`} onClose={() => setEdit(null)} footer={canEdit ? <><div className="row">{f.id && <DeleteButton id={f.id} after={() => setEdit(null)} />}</div>
      <div className="row"><button className="btn" type="button" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" type="button" disabled={busy || !f.name.trim()} onClick={save}>{f.id ? 'Save' : 'Add'}</button></div></> : <button className="btn" type="button" onClick={() => setEdit(null)}>Close</button>}>
      <fieldset disabled={!canEdit} style={{ border: 'none', padding: 0, margin: 0 }}><div className="form">
        <Field label={`${KIND[f.kind][0]} name`}><In value={f.name} onChange={up('name')} autoFocus /></Field>
        <Field label="Place"><In value={f.city} onChange={up('city')} placeholder="City / town" /></Field>
        <Field label={KIND[f.kind][2]} full hint={KIND[f.kind][3]}><Area value={f.offers} onChange={up('offers')} style={{ minHeight: 56 }} /></Field>
        <Field label="Contact person"><In value={f.contact} onChange={up('contact')} placeholder="Name and designation" /></Field>
        <Field label="Phone"><In value={f.phone} onChange={up('phone')} inputMode="tel" /></Field>
        <Field label="Email"><In type="email" value={f.email} onChange={up('email')} /></Field>
        <Field label="Status"><Seg value={f.status} onChange={(v) => setEdit({ ...f, status: v })} options={[['active', 'Active'], ['ended', 'Ended']]} /></Field>
        <Field label="Tied up since"><In type="date" value={f.since} onChange={up('since')} /></Field>
        <Field label="Agreement valid till" hint="Leave empty if there is no end date."><In type="date" value={f.validTill} onChange={up('validTill')} /></Field>
        <Field label="Terms" full hint="Commission, fee share, what each side does."><Area value={f.terms} onChange={up('terms')} /></Field>
        <Field label="Notes" full><Area value={f.notes} onChange={up('notes')} style={{ minHeight: 56 }} /></Field>
        <Field label="Agreement and other files" full><Attachments value={f.files || []} onChange={(v) => setEdit({ ...f, files: v })} /></Field>
      </div></fieldset>
      {f.id && <div style={{ marginTop: 14 }}><span className="lbl">History</span><Log items={f.log || []} /></div>}</Modal>}
  </>;
}
