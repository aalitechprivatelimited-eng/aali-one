import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, list, get, create, update, remove, store } from '../api.js';
import { uname, fmtDate, inr, stageLabel, pStageLabel, isManager, mobile10, canMoney, canEdit, scope } from '../lib.js';
import { Modal, Field, In, Area, Pill, Empty, Sample, Log, Comments, Attachments, Message, DeleteButton, Person, attempt, toast, RO, ViewOnly } from '../ui.jsx';
import { useId } from '../App.jsx';

export default function Clients() { useStore(); const id = useId(); return id ? <ClientView id={id} /> : <ClientList />; }

export function clientMoney(id) {
  const received = list('receipt').filter((r) => r.clientId === id).reduce((s, r) => s + (r.totals?.received || 0), 0);
  const due = list('payment').filter((p) => p.clientId === id && p.status !== 'paid').reduce((s, p) => s + ((+p.amount || 0) - (+p.paid || 0)), 0);
  const ratings = list('signoff').filter((s) => list('project').find((p) => p.id === s.projectId && p.clientId === id)).map((s) => +s.rating).filter(Boolean);
  return { received, due, rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0 };
}

function ClientList() {
  const nav = useNavigate(), [q, setQ] = useState(''), [add, setAdd] = useState(false), edit = canEdit('clients'), own = scope('clients') === 'own', money = canMoney();
  const rows = list('client').filter((c) => !q || `${c.name} ${c.phone} ${c.city} ${c.gstin}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return <>
    <div className="topbar"><h1>{own ? 'My clients' : 'Clients'} <small>{rows.length}</small> <ViewOnly when={!edit} /></h1>{edit && <button className="btn primary" type="button" onClick={() => setAdd(true)}>+ New client</button>}</div>
    <In placeholder="Search name, phone, city, GSTIN" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 12 }} />
    {rows.length ? <div className="tbl cards"><table><thead><tr><th>Client</th><th>BDE</th><th className="n">Deals</th><th className="n">Projects</th>{money && <th className="n">Received</th>}{money && <th className="n">Due</th>}<th>Rating</th></tr></thead><tbody>
      {rows.map((c) => { const m = clientMoney(c.id); return <tr key={c.id} className="click" onClick={() => nav('/clients/' + c.id)}>
        <td><b>{c.name}</b><div className="small muted">{c.phone}{c.city ? ' · ' + c.city : ''}</div><Sample on={c.sample} /></td><td>{uname(c.owner)}</td>
        <td className="n">{list('deal').filter((d) => d.clientId === c.id).length}</td><td className="n">{list('project').filter((p) => p.clientId === c.id).length}</td>
        {money && <td className="n">{inr(m.received)}</td>}{money && <td className="n">{m.due ? inr(m.due) : '—'}</td>}<td>{m.rating ? '★'.repeat(Math.round(m.rating)) : '—'}</td></tr>; })}
    </tbody></table></div> : <Empty>No clients yet. Convert a lead, or add one with “+ New client”.</Empty>}
    {add && <ClientForm onClose={() => setAdd(false)} />}
  </>;
}

export function ClientForm({ onClose }) {
  const nav = useNavigate(), [f, setF] = useState({ owner: store.me.id }), own = scope('clients') === 'own'; const up = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  return <Modal title="New client" onClose={onClose} footer={<button className="btn primary" type="button" onClick={async () => { const r = await attempt(() => create('client', { ...f, contacts: f.contact ? [{ name: f.contact, phone: f.phone, email: f.email, role: '' }] : [] })); if (r) { onClose(); nav('/clients/' + r.record.id); } }}>Save client</button>}>
    <div className="form">
      <Field label="Client / company name *" full><In value={f.name || ''} onChange={up('name')} autoFocus /></Field>
      <Field label="Main contact"><In value={f.contact || ''} onChange={up('contact')} /></Field><Field label="Phone"><In value={f.phone || ''} onChange={up('phone')} /></Field>
      <Field label="Email"><In value={f.email || ''} onChange={up('email')} /></Field><Field label="City"><In value={f.city || ''} onChange={up('city')} /></Field>
      <Field label="GSTIN"><In value={f.gstin || ''} onChange={up('gstin')} /></Field><Field label="BDE"><Person value={f.owner} onChange={up('owner')} disabled={own} filter={(u) => u.team === 'sales'} /></Field>
      <Field label="Address" full><Area value={f.address || ''} onChange={up('address')} /></Field>
    </div></Modal>;
}

function ClientView({ id }) {
  const nav = useNavigate(), c = get(id), [contact, setContact] = useState(null), [merge, setMerge] = useState(false);
  if (!c) return <Empty>This client was not found. <Link to="/clients">Back to clients</Link></Empty>;
  const set = (data, ok) => attempt(() => update(id, data), ok), m = clientMoney(id), edit = canEdit('clients'), own = scope('clients') === 'own';
  const deals = list('deal').filter((d) => d.clientId === id), quotes = list('quote').filter((q) => q.clientId === id || deals.some((d) => d.id === q.dealId));
  const projects = list('project').filter((p) => p.clientId === id), pays = list('payment').filter((p) => p.clientId === id);
  const receipts = list('receipt').filter((r) => r.clientId === id), invoices = list('invoice').filter((r) => r.clientId === id);
  const tickets = list('ticket').filter((t) => t.clientId === id), signoffs = list('signoff').filter((s) => projects.some((p) => p.id === s.projectId));
  const leads = list('lead').filter((l) => l.clientId === id || (c.mobile10 && l.mobile10 === c.mobile10));
  const Sec = ({ title, children, empty }) => <div className="card stack"><h2>{title}</h2>{children}{empty && <p className="small muted" style={{ margin: 0 }}>{empty}</p>}</div>;
  return <>
    <div className="topbar"><h1>{c.name} <small>{c.city}{c.gstin ? ' · GSTIN ' + c.gstin : ''}</small> <ViewOnly when={!edit} /></h1>
      <div className="row"><Link className="btn" to="/clients">All clients</Link>{canEdit('support') && <Link className="btn" to={`/support?client=${id}`}>+ Support request</Link>}{isManager() && edit && <button className="btn" type="button" onClick={() => setMerge(true)}>Merge duplicate</button>}</div></div>
    <div className="stats">
      {canMoney() && <div className="stat"><span className="l">Received</span><span className="v">{inr(m.received)}</span></div>}
      {canMoney() && <div className={'stat' + (m.due ? ' warm' : '')}><span className="l">Still due</span><span className="v">{inr(m.due)}</span></div>}
      <div className="stat"><span className="l">Deals</span><span className="v">{deals.length}</span></div>
      <div className="stat"><span className="l">Rating</span><span className="v">{m.rating ? m.rating.toFixed(1) + ' ★' : '—'}</span></div>
    </div>
    <RO when={!edit}><div className="grid2">
      <Sec title="Details"><div className="form">
        <Field label="Name"><In defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && set({ name: e.target.value })} /></Field>
        <Field label="Phone"><In defaultValue={c.phone} onBlur={(e) => set({ phone: e.target.value, mobile10: mobile10(e.target.value) })} /></Field>
        <Field label="Email"><In defaultValue={c.email} onBlur={(e) => set({ email: e.target.value })} /></Field>
        <Field label="City"><In defaultValue={c.city} onBlur={(e) => set({ city: e.target.value })} /></Field>
        <Field label="GSTIN"><In defaultValue={c.gstin} onBlur={(e) => set({ gstin: e.target.value })} /></Field>
        <Field label="BDE"><Person value={c.owner} disabled={own} onChange={(v) => set({ owner: v })} filter={(u) => u.team === 'sales'} /></Field>
        <Field label="Address" full><Area defaultValue={c.address} onBlur={(e) => set({ address: e.target.value })} /></Field>
        <Field label="Tags" full><In defaultValue={(c.tags || []).join(', ')} onBlur={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
      </div><div className="row"><Sample on={c.sample} /><span className="grow" />{isManager() && <DeleteButton id={id} after={() => nav('/clients')} />}</div></Sec>
      <Sec title="Contacts">{(c.contacts || []).map((p, i) => <div key={i} className="row small"><b>{p.name}</b><span>{p.role}</span><span className="num">{p.phone}</span><span>{p.email}</span>
        <button className="btn ghost sm" type="button" onClick={() => set({ contacts: c.contacts.filter((_, j) => j !== i) })}>Remove</button></div>)}
        <button className="btn sm" type="button" onClick={() => setContact({})}>+ Add contact</button>
        {c.phone && <Message phone={c.phone} vars={{ client: (c.contacts?.[0]?.name || c.name).split(' ')[0] }} />}</Sec>
      <Sec title="Leads & deals" empty={!deals.length && !leads.length ? 'None yet.' : ''}>
        {leads.map((l) => <Link key={l.id} to={'/leads/' + l.id} className="row small"><Pill>Lead</Pill><b>{l.name}</b><span>{l.service}</span><span className="muted">{l.status}</span></Link>)}
        {deals.map((d) => <Link key={d.id} to={'/deals/' + d.id} className="row small"><Pill k="gold">Deal</Pill><b>{d.title}</b><span className="num">{inr(d.value)}</span><span className="muted">{stageLabel(d.stage)}</span></Link>)}</Sec>
      {canMoney() && <Sec title="Quotations & invoices" empty={!quotes.length && !invoices.length ? 'None yet.' : ''}>
        {quotes.map((q) => <Link key={q.id} to={'/quotes/' + q.id} className="row small"><b className="num">{q.number}</b><span className="num">{inr(q.totals?.total)}</span><Pill>{q.status}</Pill></Link>)}
        {invoices.map((q) => <Link key={q.id} to={'/payments/invoice/' + q.id} className="row small"><b className="num">{q.number}</b><span className="num">{inr(q.totals?.total)}</span><Pill k="info">Invoice</Pill></Link>)}</Sec>}
      <Sec title="Projects" empty={!projects.length ? 'None yet.' : ''}>{projects.map((p) => <Link key={p.id} to={'/projects/' + p.id} className="row small"><b>{p.name}</b><Pill>{pStageLabel(p.stage)}</Pill>{p.signoffId && <Pill k="ok">Signed off</Pill>}</Link>)}
        {signoffs.map((s) => <div key={s.id} className="small">Sign-off <b className="num">{s.certNo}</b> by {s.signerName} · {'★'.repeat(+s.rating || 0)} {s.ratingComment}</div>)}</Sec>
      {canMoney() && <Sec title="Payments" empty={!pays.length && !receipts.length ? 'None yet.' : ''}>
        {pays.map((p) => <div key={p.id} className="row small"><span className="grow">{p.title}</span><span className="num">{inr(p.amount)}</span><Pill k={p.status === 'paid' ? 'ok' : ''}>{p.status === 'paid' ? 'Paid' : 'Due ' + fmtDate(p.due)}</Pill></div>)}
        {receipts.map((r) => <Link key={r.id} to={'/payments/receipt/' + r.id} className="row small"><b className="num">{r.number}</b><span className="num">{inr(r.totals?.received)}</span><span className="muted">{fmtDate(r.date)}</span></Link>)}</Sec>}
      <Sec title="Support requests" empty={!tickets.length ? 'None.' : ''}>{tickets.map((t) => <div key={t.id} className="row small"><b className="num">{t.number}</b><span className="grow">{t.title}</span><Pill k={t.status === 'resolved' ? 'ok' : 'warn'}>{t.status}</Pill></div>)}</Sec>
      <Sec title="Files"><Attachments value={c.files || []} onChange={(files) => set({ files })} /></Sec>
      <Sec title="Comments"><Comments relType="client" relId={id} /></Sec>
      <Sec title="History"><Log items={c.log} /></Sec>
    </div></RO>
    {contact && <Modal title="Add contact" onClose={() => setContact(null)} footer={<button className="btn primary" type="button" onClick={async () => (await set({ contacts: [...(c.contacts || []), { ...contact, mobile10: mobile10(contact.phone) }] }, 'Contact added.')) && setContact(null)}>Add</button>}>
      <div className="form">{['name', 'role', 'phone', 'email'].map((k) => <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><In value={contact[k] || ''} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} /></Field>)}</div></Modal>}
    {merge && <Merge keep={c} onClose={() => setMerge(false)} />}
  </>;
}

function Merge({ keep, onClose }) {
  const [other, setOther] = useState(''), cand = list('client').filter((c) => c.id !== keep.id);
  async function go() {
    const o = cand.find((c) => c.id === other); if (!o) return;
    for (const type of ['deal', 'project', 'payment', 'receipt', 'invoice', 'ticket', 'quote', 'lead']) for (const r of list(type).filter((x) => x.clientId === o.id)) await update(r.id, { clientId: keep.id });
    await update(keep.id, { contacts: [...(keep.contacts || []), ...(o.contacts || [])], files: [...(keep.files || []), ...(o.files || [])], _note: `Merged with ${o.name}` });
    await remove(o.id, `Merged into ${keep.name}`); toast('Merged.'); onClose();
  }
  return <Modal title={`Merge into ${keep.name}`} onClose={onClose} footer={<button className="btn primary" type="button" disabled={!other} onClick={() => attempt(go)}>Merge</button>}>
    <div className="stack"><p style={{ margin: 0 }}>Pick the duplicate. Its deals, projects, payments, receipts, invoices, support requests and contacts move to <b>{keep.name}</b>, and the duplicate goes to the recycle bin.</p>
      <select className="in" value={other} onChange={(e) => setOther(e.target.value)}><option value="">Choose the duplicate…</option>{cand.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone}</option>)}</select></div>
  </Modal>;
}
