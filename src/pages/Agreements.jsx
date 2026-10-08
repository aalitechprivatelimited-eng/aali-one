// Client agreements: the Client Service Agreement made when a client says yes, and the Project Closure Agreement at the end of a
// project – both in the company's own template (shared/agreement-text.js, laid out in doc.jsx). Service agreements are made by the
// Operations Manager and the Sales Manager; a closure agreement by the Operations Manager only. The Company Secretary and the
// Chairman read them. Nobody else sees this page or its data (server/access.js).
import { useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore, list, get, create, update, upload, store } from '../api.js';
import { settings, uname, fmtDate, today, addDays, inr, can, canEdit, dealReceived } from '../lib.js';
import { canClose } from '../../shared/access.js';
import { DEFAULT_SETTINGS } from '../../shared/defaults.js';
import { Field, In, Sel, Pick, Area, Pill, Seg, Empty, Modal, Sample, Log, DeleteButton, attempt, toast, RO, ViewOnly } from '../ui.jsx';
import { AgreementSheet, agreementTotal, agreementSub, agreementGst } from '../doc.jsx';
import { useId } from '../App.jsx';

export const KIND = { service: 'Client service agreement', closure: 'Project closure agreement' };
const STATUS = { draft: ['Draft', ''], sent: ['Sent to sign', 'info'], signed: ['Signed', 'ok'] };
const Status = ({ s }) => <Pill k={STATUS[s]?.[1]}>{STATUS[s]?.[0] || s}</Pill>;
// Who may change this agreement: a closure agreement only the Operations Manager; a service agreement the Operations or Sales Manager.
const mayChange = (a) => (a.kind === 'closure' ? canClose(store.me) : canEdit('agreements'));
const std = () => ({ ...DEFAULT_SETTINGS.agreements, ...(settings().agreements || {}) });
// The company that signs, kept on each agreement as it was on the day it was made.
const company = () => { const s = std(); return { name: s.name, unit: s.unit, about: s.about, office: s.office, parent: s.parent }; };

export default function Agreements() {
  useStore(); const id = useId();
  if (!can('agreements')) return <Empty>Agreements are seen by the Operations Manager, the Sales Manager, the Company Secretary and the Chairman.</Empty>;
  return id ? <Editor key={id} id={id === 'new' ? null : id} /> : <Register />;
}

function Register() {
  const nav = useNavigate(), [f, setF] = useState({ kind: '', q: '', status: '' }), all = list('agreement');
  const rows = all.filter((a) => (!f.kind || a.kind === f.kind) && (!f.status || a.status === f.status)
    && (!f.q || `${a.number} ${a.clientName} ${a.title} ${a.project}`.toLowerCase().includes(f.q.toLowerCase())))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.seq || 0) - (a.seq || 0));
  const count = (k) => all.filter((a) => a.kind === k), signed = (k) => count(k).filter((a) => a.status === 'signed').length;
  return <>
    <div className="topbar"><h1>Agreements <small>{rows.length}</small> <ViewOnly when={!canEdit('agreements')} /></h1>
      <div className="row">{canEdit('agreements') && <Link className="btn primary" to="/agreements/new?kind=service">+ Service agreement</Link>}
        {canClose(store.me) && <Link className="btn" to="/agreements/new?kind=closure">+ Closure agreement</Link>}</div></div>
    <div className="stats">
      <div className="stat"><span className="l">Client service agreements</span><span className="v">{count('service').length}</span><span className="small muted">{signed('service')} signed</span></div>
      <div className="stat"><span className="l">Project closure agreements</span><span className="v">{count('closure').length}</span><span className="small muted">{signed('closure')} signed</span></div>
      <div className="stat"><span className="l">Waiting for the client to sign</span><span className="v">{all.filter((a) => a.status === 'sent').length}</span></div>
    </div>
    <div className="row" style={{ marginBottom: 12 }}>
      <Seg value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[['', 'All'], ['service', 'Service'], ['closure', 'Closure']]} />
      <In placeholder="Search number, client, work" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ maxWidth: 260 }} />
      <Sel value={f.status} onChange={(v) => setF({ ...f, status: v })} options={Object.entries(STATUS).map(([k, [l]]) => [k, l])} blank="Any status" style={{ width: 'auto' }} /></div>
    {rows.length ? <div className="tbl"><table><thead><tr><th>Number</th><th>Kind</th><th>Client</th><th>For</th><th>Date</th><th className="n">Value</th><th>Status</th><th>Made by</th></tr></thead><tbody>
      {rows.map((a) => <tr key={a.id} className="click" onClick={() => nav('/agreements/' + a.id)}><td className="num"><b>{a.number}</b></td><td>{a.kind === 'closure' ? 'Closure' : 'Service'}</td>
        <td>{a.clientName}<Sample on={a.sample} /></td><td>{a.kind === 'closure' ? a.project : a.title}</td><td>{fmtDate(a.date)}</td>
        <td className="n">{inr(a.kind === 'closure' ? a.value : agreementTotal(a))}</td><td><Status s={a.status} /></td><td>{uname(a.createdBy)}</td></tr>)}
    </tbody></table></div>
      : <Empty>{all.length ? 'No agreement matches.' : canEdit('agreements') ? 'No agreements yet. Make one with “+ Service agreement”, or from a deal or a quotation.' : 'No agreements yet.'}</Empty>}
  </>;
}

// ---------- filling a new agreement from what Aali One already knows ----------
const CLIENT = ['clientId', 'clientName', 'contactName', 'contactRole', 'address', 'seat'];
const filled = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
const only = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const purposeOf = (what) => (what ? `the design, development and delivery of ${what}` : '');
const fromClient = (c) => !c ? {} : filled({ clientId: c.id, clientName: c.name, address: [c.address, c.city].filter(Boolean).join(', ') || c.city, contactName: c.contacts?.[0]?.name, contactRole: c.contacts?.[0]?.role });
const fromDeal = (d) => !d ? {} : { ...fromClient(get(d.clientId)), ...filled({ dealId: d.id, title: d.title, purpose: purposeOf(d.title), contactName: d.contactName, scope: d.handoff?.scope }),
  ...(d.value ? { lines: [{ text: d.title || d.service || 'Fees', amount: d.value }], gst: 'included' } : {}) };
function fromQuote(q) {
  if (!q) return {};
  const items = (q.items || []).filter((it) => it.desc), disc = +q.totals?.discount || 0;
  return { ...fromDeal(get(q.dealId)), ...filled({ quoteId: q.id, clientName: q.clientName, contactName: q.contactName, address: q.address, title: q.subject, purpose: purposeOf(q.subject),
    scope: items.map((it) => it.desc + (it.note ? '\n– ' + it.note : '')).join('\n') }),
    lines: [...items.map((it) => ({ text: `${it.desc}${it.note ? ' — ' + it.note : ''}`, amount: Math.round((+it.qty || 0) * (+it.rate || 0) * 100) / 100 })), ...(disc > 0 ? [{ text: 'Less: discount', amount: -disc }] : [])],
    gst: ['none', 'export'].includes(q.taxMode) ? 'none' : 'extra', gstRate: +q.taxRate || 18 };
}
// The service agreement a project came from: one for the same deal, or else the same client – a signed one first.
const serviceFor = (p) => list('agreement').filter((a) => a.kind === 'service' && ((p.dealId && a.dealId === p.dealId) || (p.clientId && a.clientId === p.clientId)))
  .sort((a, b) => (b.status === 'signed') - (a.status === 'signed') || (b.date || '').localeCompare(a.date || ''))[0];
const fromService = (s) => !s ? {} : { ...only(s, CLIENT), serviceId: s.id, serviceNo: s.number || '', serviceDate: s.date || '', purpose: s.purpose || '', value: agreementTotal(s) };
function fromProject(p) {
  if (!p) return {};
  const deal = get(p.dealId), sa = serviceFor(p), so = get(p.signoffId);
  return { ...only(fromDeal(deal), CLIENT), ...fromClient(get(p.clientId)), purpose: purposeOf(p.name), value: deal?.value || 0, ...fromService(sa),
    projectId: p.id, project: p.name, dealId: p.dealId || '', started: p.start || '', delivered: p.liveAt || so?.signedAt?.slice(0, 10) || today(),
    scope: p.scope || sa?.scope || '', signoffNo: so?.certNo || '', received: p.dealId ? dealReceived(p.dealId) : 0 };
}
function blank(kind, sp) {
  const s = std();
  const base = { kind, co: company(), date: today(), clientId: '', clientName: '', seat: 'office', address: '', contactName: '', contactRole: '', title: '', purpose: '', scope: '',
    coSigner: s.signName, coRole: s.signRole, clauses: kind === 'closure' ? s.closureClauses : s.serviceClauses };
  if (kind === 'closure') return { ...base, projectId: '', project: '', serviceId: '', serviceNo: '', serviceDate: '', started: '', delivered: today(), signoffNo: '',
    handover: s.handover.map((text) => ({ text, done: false, note: '' })), pending: '', value: 0, received: 0, balanceBy: '', supportUntil: addDays(today(), +s.supportDays || 60), amc: '',
    ...fromProject(get(sp.get('project'))) };
  return { ...base, dealId: '', quoteId: '', lines: [{ text: '', amount: 0 }], gst: 'extra', gstRate: 18, recurring: [], schedule: s.schedule.map(([text, pct]) => ({ text, pct })),
    annex: s.annex.map(([label, text]) => ({ label, text })), excluded: s.excluded.join('\n'),
    ...(sp.get('quote') ? fromQuote(get(sp.get('quote'))) : fromDeal(get(sp.get('deal')))) };
}
// Kept by the server, never sent back from the form.
const META = ['id', 'type', 'number', 'seq', 'fy', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample', 'log', 'signedAt', 'signedBy'];

function Editor({ id }) {
  const nav = useNavigate(), [sp] = useSearchParams(), saved = id ? get(id) : null, kind = saved?.kind || (sp.get('kind') === 'closure' ? 'closure' : 'service');
  const [a, setA] = useState(() => (saved ? { ...saved } : blank(kind, sp))), [busy, setBusy] = useState(false), [sign, setSign] = useState(false), [tab, setTab] = useState('form');
  if (id && !saved) return <Empty>This agreement was not found. <Link to="/agreements">Back</Link></Empty>;
  const closure = kind === 'closure', locked = saved?.status === 'signed', change = mayChange({ kind }) && !locked;
  if (!saved && !mayChange({ kind })) return <Empty>{closure ? 'A closure agreement is made by the Operations Manager.' : 'Your access to agreements is view only.'} <Link to="/agreements">Back</Link></Empty>;
  const up = (k) => (v) => setA({ ...a, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v });
  const row = (k, i, f, v) => setA({ ...a, [k]: a[k].map((x, j) => (j === i ? { ...x, [f]: v } : x)) });

  async function save(extra = {}) {
    if (!String(a.clientName || '').trim()) return toast('Enter the client name.', true);
    if (closure && !a.projectId) return toast('Choose the project.', true);
    setBusy(true);
    const data = { ...a, ...extra }; META.forEach((k) => delete data[k]);
    const r = saved ? await attempt(() => update(saved.id, data)) : await attempt(() => create('agreement', data));
    setBusy(false); if (!r) return null;
    const rec = saved ? r : r.record; setA({ ...rec });
    if (!saved) { toast(`Saved as ${rec.number}.`); nav('/agreements/' + rec.id, { replace: true }); } else toast(extra.status === 'sent' ? 'Marked as sent to the client.' : extra.status === 'signed' ? 'Marked as signed. It cannot be changed now.' : 'Saved.');
    return rec;
  }
  return <>
    <div className="topbar no-print"><h1>{saved ? saved.number : 'New ' + KIND[kind].toLowerCase()} <small>{KIND[kind]}{a.clientName ? ' · ' + a.clientName : ''}</small> {saved && <Status s={saved.status} />} <ViewOnly when={!mayChange({ kind })} /></h1>
      <div className="row"><Link className="btn" to="/agreements">All agreements</Link>
        {a.dealId && can('deals') && <Link className="btn" to={'/deals/' + a.dealId}>Deal</Link>}{a.projectId && <Link className="btn" to={'/projects/' + a.projectId}>Project</Link>}
        {saved && <button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>}
        {change && <button className="btn primary" type="button" disabled={busy} onClick={() => save()}>{saved ? 'Save changes' : 'Save & get number'}</button>}</div></div>
    {locked && <div className="banner ok no-print" style={{ marginBottom: 12 }}><b>Signed on {fmtDate(saved.signedOn)}.</b> A signed agreement cannot be changed. If something is wrong, the Operations Manager deletes it with a reason and a new one is made.</div>}
    <div className="seg-phone no-print"><Seg value={tab} onChange={setTab} options={[['form', 'Details'], ['paper', 'The agreement']]} /></div>
    <div className={'ag-edit show-' + tab}>
      <div className="ag-form"><RO when={!change}><div className="stack">
        {closure ? <ClosureForm a={a} setA={setA} up={up} row={row} saved={saved} /> : <ServiceForm a={a} setA={setA} up={up} row={row} saved={saved} />}
        <div className="card form"><h3 className="full">Clauses</h3>
          <p className="small muted full" style={{ margin: 0 }}>The company's standard clauses. A line like “4. Fees and Payment Terms” is a heading; “4.1 …” is a clause. The fees, payments, delivery time and support period are in Annexure B, so the clauses rarely need a change.</p>
          <Field label="Clauses" full><Area style={{ minHeight: 320, fontSize: 13.5 }} value={a.clauses} onChange={up('clauses')} /></Field>
          <div className="row full"><button className="btn ghost sm" type="button" onClick={() => setA({ ...a, clauses: closure ? std().closureClauses : std().serviceClauses })}>Put back the standard clauses</button></div></div>
        <div className="card form"><h3 className="full">Signs for {(a.co || company()).name}</h3>
          <Field label="Name"><In value={a.coSigner} onChange={up('coSigner')} /></Field><Field label="Designation"><In value={a.coRole} onChange={up('coRole')} /></Field></div>
      </div></RO>
      {saved && <div className="card stack" style={{ marginTop: 16 }}><h3>Signing</h3>
        {!locked && <p className="small muted" style={{ margin: 0 }}>Print it, both sides sign, then mark it as signed here and attach the scanned signed copy.</p>}
        {change && <div className="row">{saved.status === 'draft' && <button className="btn" type="button" disabled={busy} onClick={() => save({ status: 'sent' })}>Mark as sent to the client</button>}
          <button className="btn primary" type="button" disabled={busy} onClick={() => setSign(true)}>Mark as signed…</button></div>}
        {saved.sentOn && <div className="small">Sent to the client on {fmtDate(saved.sentOn)}.</div>}
        <SignedCopy a={saved} onChange={(rec) => setA({ ...rec })} />
        <div className="row"><Sample on={saved.sample} /><span className="grow" />
          {(locked ? canClose(store.me) : mayChange(saved)) && <DeleteButton id={saved.id} needsReason after={() => nav('/agreements')} />}</div>
        <details><summary className="small muted">History</summary><Log items={saved.log} /></details></div>}
      </div>
      <div className="ag-paper"><div className="paper-wrap"><div className="ag-scale"><AgreementSheet a={{ ...a, number: saved?.number }} /></div></div></div>
    </div>
    {sign && <SignModal a={a} onClose={() => setSign(false)} onSign={async (x) => { if (await save({ status: 'signed', ...x })) setSign(false); }} busy={busy} />}
  </>;
}

function ClientCard({ a, setA, up, children }) {
  return <div className="card form"><h3 className="full">Client</h3>{children}
    <Field label="Client from the client list"><Pick value={a.clientId} onChange={(v) => setA({ ...a, clientId: v, ...fromClient(get(v)) })} options={list('client').filter((c) => !c.card).map((c) => [c.id, c.name, c.city])} blank="Not linked" /></Field>
    <Field label="Client name *" hint="As it should read in the agreement, e.g. Sri Nulife Manjunadha Agro Foods LLP"><In value={a.clientName} onChange={up('clientName')} /></Field>
    <Field label="Having its"><Sel value={a.seat || 'office'} onChange={up('seat')} options={[['office', 'office at'], ['registered office', 'registered office at'], ['premises', 'premises at'], ['residence', 'residence at']]} /></Field>
    <Field label="Address" full><Area value={a.address} onChange={up('address')} placeholder="Plot No…, area, city, state – PIN" /></Field>
    <Field label="Signs for the client (name)"><In value={a.contactName} onChange={up('contactName')} /></Field><Field label="Their designation"><In value={a.contactRole} onChange={up('contactRole')} placeholder="Owner, Partner, Director…" /></Field></div>;
}
const DateField = ({ a, up, saved }) => <Field label="Agreement date" hint={saved ? 'Part of the agreement number; it does not change.' : ''}><In type="date" value={a.date} onChange={up('date')} disabled={!!saved} /></Field>;
const Rows = ({ list: rows, add, children }) => <div className="stack gap4">{rows}<div><button className="btn sm" type="button" onClick={add}>{children}</button></div></div>;
const Remove = ({ onClick }) => <button className="btn ghost sm ag-x" type="button" onClick={onClick} aria-label="Remove this line" title="Remove this line">×</button>;

function ServiceForm({ a, setA, up, row, saved }) {
  const pct = (a.schedule || []).reduce((s, x) => s + (+x.pct || 0), 0), total = agreementTotal(a), drop = (k, i) => setA({ ...a, [k]: a[k].filter((_, j) => j !== i) });
  return <>
    <ClientCard a={a} setA={setA} up={up}>
      <Field label="Fill from a deal"><Pick value={a.dealId} onChange={(v) => setA({ ...a, ...fromDeal(get(v)), dealId: v })} options={list('deal').map((d) => [d.id, d.title, d.contactName])} blank="Not linked" /></Field>
      <Field label="Fill from a quotation"><Pick value={a.quoteId} onChange={(v) => setA({ ...a, ...fromQuote(get(v)), quoteId: v })} options={list('quote').map((q) => [q.id, `${q.number} · ${q.clientName}`, q.subject])} blank="Not linked" /></Field>
    </ClientCard>
    <div className="card form"><h3 className="full">The agreement</h3>
      <DateField a={a} up={up} saved={saved} />
      <Field label="Service (short name) *" hint="For the list of agreements"><In value={a.title} onChange={up('title')} placeholder="Custom ERP Solution" /></Field>
      <Field label="The client engages us for…" full hint="Completes the sentence “WHEREAS the Client wishes to engage the Service Provider for …”"><Area value={a.purpose} onChange={up('purpose')} placeholder="the design, development and deployment of a Custom ERP Solution covering …" /></Field></div>
    <div className="card form"><h3 className="full">Annexure A — Scope of Work</h3>
      <Field label="What will be done" full hint="A line on its own is a heading; start a line with – for a point under it."><Area style={{ minHeight: 170 }} value={a.scope} onChange={up('scope')} placeholder={'Purchase & Mediator Management\n– Mediator purchase entry and admin verification workflow.\n– Purchase master with Purchase ID, item and quantity.'} /></Field>
      <Field label="Explicitly excluded (one per line)" full><Area style={{ minHeight: 120 }} value={a.excluded} onChange={up('excluded')} /></Field></div>
    <div className="card form"><h3 className="full">Annexure B — Fees and Payment Schedule</h3>
      <div className="field full"><label>Fees (one-time)</label>
        <Rows list={(a.lines || []).map((x, i) => <div key={i} className="row ag-sched"><In className="in grow" value={x.text} onChange={(e) => row('lines', i, 'text', e.target.value)} placeholder="Item, e.g. Custom ERP Solution — full scope as per Annexure A" aria-label="Item" />
          <In type="number" value={x.amount} onChange={(e) => row('lines', i, 'amount', e.target.value)} aria-label="Amount in rupees" style={{ width: 130 }} /><Remove onClick={() => drop('lines', i)} /></div>)}
          add={() => setA({ ...a, lines: [...(a.lines || []), { text: '', amount: 0 }] })}>+ Add a fee line</Rows></div>
      <Field label="GST"><Sel value={a.gst} onChange={up('gst')} options={[['extra', 'Plus GST'], ['included', 'GST included in the fees'], ['none', 'No GST']]} /></Field>
      <Field label="GST rate %"><In type="number" min="0" value={a.gstRate} onChange={up('gstRate')} disabled={a.gst === 'none'} /></Field>
      <div className="field full ag-sum"><span>Fees {inr(agreementSub(a))}</span>{a.gst === 'extra' && <span>GST {inr(agreementGst(a))}</span>}<b>Total payable {inr(total)}</b></div>
      <div className="field full"><label>Yearly or other charges (shown below the total)</label>
        <Rows list={(a.recurring || []).map((x, i) => <div key={i} className="row ag-sched"><In className="in grow" value={x.text} onChange={(e) => row('recurring', i, 'text', e.target.value)} aria-label="Charge" />
          <In value={x.amount} onChange={(e) => row('recurring', i, 'amount', e.target.value)} placeholder="₹25,000 to ₹35,000 yearly" aria-label="Amount" style={{ width: 200 }} /><Remove onClick={() => drop('recurring', i)} /></div>)}
          add={() => setA({ ...a, recurring: [...(a.recurring || []), { text: std().amc, amount: '' }] })}>+ Add AMC / yearly charge</Rows></div>
      <div className="field full"><label>Payment schedule</label>
        <Rows list={(a.schedule || []).map((x, i) => <div key={i} className="row ag-sched"><In type="number" min="0" max="100" value={x.pct} onChange={(e) => row('schedule', i, 'pct', e.target.value)} aria-label="Percent" style={{ width: 76 }} /><span className="small">%</span>
          <In className="in grow" value={x.text} onChange={(e) => row('schedule', i, 'text', e.target.value)} placeholder="When" aria-label="When it is paid" /><span className="num small" style={{ minWidth: 86, textAlign: 'right' }}>{inr(total * (+x.pct || 0) / 100)}</span>
          <Remove onClick={() => drop('schedule', i)} /></div>)} add={() => setA({ ...a, schedule: [...(a.schedule || []), { text: '', pct: 0 }] })}>+ Add a payment</Rows>
        {pct !== 100 && <span className="small" style={{ color: 'var(--bad)' }}>The payments add up to {pct}%, not 100%.</span>}</div>
      <div className="field full"><label>Other terms in Annexure B</label>
        <Rows list={(a.annex || []).map((x, i) => <div key={i} className="row ag-sched"><In value={x.label} onChange={(e) => row('annex', i, 'label', e.target.value)} aria-label="Heading" style={{ width: 150 }} />
          <In className="in grow" value={x.text} onChange={(e) => row('annex', i, 'text', e.target.value)} aria-label="Text" /><Remove onClick={() => drop('annex', i)} /></div>)}
          add={() => setA({ ...a, annex: [...(a.annex || []), { label: '', text: '' }] })}>+ Add a term</Rows>
        <span className="small muted">“Payable To”, “Payment Terms” and “Taxes” are written by Aali One from the figures above.</span></div></div>
  </>;
}

function ClosureForm({ a, setA, up, row, saved }) {
  const bal = Math.max(0, (+a.value || 0) - (+a.received || 0));
  return <>
    <ClientCard a={a} setA={setA} up={up}>
      <Field label="Project *"><Pick value={a.projectId} onChange={(v) => setA({ ...a, ...fromProject(get(v)) })} options={list('project').map((p) => [p.id, p.name, p.clientName])} blank="Choose the project" /></Field>
      <Field label="Client service agreement it closes"><Pick value={a.serviceId} onChange={(v) => setA({ ...a, serviceId: v, serviceNo: '', serviceDate: '', ...fromService(get(v)) })}
        options={list('agreement').filter((x) => x.kind === 'service').map((x) => [x.id, `${x.number} · ${x.clientName}`, x.title])} blank="None" /></Field>
    </ClientCard>
    <div className="card form"><h3 className="full">The agreement</h3>
      <DateField a={a} up={up} saved={saved} />
      <Field label="The project was for…" full hint="Completes the sentence “… (the Service Agreement) for …”"><Area value={a.purpose} onChange={up('purpose')} /></Field></div>
    <div className="card form"><h3 className="full">Annexure A — Delivered Work and Handover</h3>
      <Field label="Work started on"><In type="date" value={a.started} onChange={up('started')} /></Field><Field label="Delivered on"><In type="date" value={a.delivered} onChange={up('delivered')} /></Field>
      <Field label="Work delivered" full hint="A line on its own is a heading; start a line with – for a point under it."><Area style={{ minHeight: 120 }} value={a.scope} onChange={up('scope')} /></Field>
      {a.signoffNo && <div className="field full small">The client signed the delivery acceptance <b>{a.signoffNo}</b> – it is named in Annexure A.</div>}
      <div className="field full"><label>Handover (tick what was handed over)</label>
        <Rows list={(a.handover || []).map((h, i) => <div key={i} className="row ag-sched"><label className="check"><input type="checkbox" checked={!!h.done} onChange={(e) => row('handover', i, 'done', e.target.checked)} aria-label={'Handed over: ' + h.text} /></label>
          <In className="in grow" value={h.text} onChange={(e) => row('handover', i, 'text', e.target.value)} aria-label="Item" /><In value={h.note} onChange={(e) => row('handover', i, 'note', e.target.value)} placeholder="Note (optional)" aria-label="Note" style={{ maxWidth: 200 }} />
          <Remove onClick={() => setA({ ...a, handover: a.handover.filter((_, j) => j !== i) })} /></div>)}
          add={() => setA({ ...a, handover: [...(a.handover || []), { text: '', done: false, note: '' }] })}>+ Add an item</Rows></div>
      <Field label="Pending items, if any" full hint="Empty: nothing is pending from either side"><Area value={a.pending} onChange={up('pending')} /></Field></div>
    <div className="card form"><h3 className="full">Annexure B — Payment Summary and Support</h3>
      <Field label="Total value of the work (₹, with GST)"><In type="number" min="0" value={a.value} onChange={up('value')} /></Field>
      <Field label="Received so far (₹)" hint={a.dealId ? <button className="btn ghost sm" type="button" onClick={() => setA({ ...a, received: dealReceived(a.dealId) })}>Take from the receipts ({inr(dealReceived(a.dealId))})</button> : ''}><In type="number" min="0" value={a.received} onChange={up('received')} /></Field>
      <div className="field"><label>Balance</label><b className="num" style={{ fontSize: 18, color: bal > 0 ? 'var(--bad)' : 'var(--ok)' }}>{bal > 0 ? inr(bal) : 'Fully paid'}</b></div>
      {bal > 0 && <Field label="Balance to be paid by"><In type="date" value={a.balanceBy} onChange={up('balanceBy')} /></Field>}
      <Field label="Free support until"><In type="date" value={a.supportUntil} onChange={up('supportUntil')} /></Field>
      <Field label="AMC after that" hint="Optional, e.g. ₹25,000 to ₹35,000 yearly from Year 2"><In value={a.amc} onChange={up('amc')} /></Field></div>
  </>;
}

// Marking an agreement as signed: the date both sides signed, who signed for the client, and the scanned copy if it is ready.
function SignModal({ a, onClose, onSign, busy }) {
  const [f, setF] = useState({ signedOn: today(), contactName: a.contactName || '', contactRole: a.contactRole || '', signedCopy: null }), [up, setUp] = useState(false), ref = useRef();
  async function pick(e) { const file = e.target.files[0]; e.target.value = ''; if (!file) return; setUp(true); const r = await attempt(() => upload(file)); setUp(false);
    if (r) setF({ ...f, signedCopy: { id: r.id, name: r.name, size: r.size, mime: r.mime, at: new Date().toISOString(), by: store.me.id } }); }
  return <Modal title={`Mark ${a.number} as signed`} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button>
    <button className="btn primary" type="button" disabled={busy || up || !f.contactName.trim() || !f.signedOn} onClick={() => onSign(f.signedCopy ? f : { signedOn: f.signedOn, contactName: f.contactName, contactRole: f.contactRole })}>Mark as signed</button></>}>
    <div className="stack"><p style={{ margin: 0 }}>After this, the agreement cannot be changed. Only the scanned signed copy can still be added.</p>
      <div className="form"><Field label="Date both sides signed"><In type="date" value={f.signedOn} max={today()} onChange={(e) => setF({ ...f, signedOn: e.target.value })} /></Field>
        <Field label="Signed for the client by"><In value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Their designation"><In value={f.contactRole} onChange={(e) => setF({ ...f, contactRole: e.target.value })} /></Field>
        <div className="field full"><label>Scanned signed copy (PDF or photo, optional now)</label>
          <div className="row">{f.signedCopy ? <span className="small">{f.signedCopy.name}</span> : null}<button className="btn sm" type="button" disabled={up} onClick={() => ref.current.click()}>{up ? 'Uploading…' : f.signedCopy ? 'Choose another' : 'Choose file'}</button><span className="small faint">max 3 MB</span></div>
          <input ref={ref} type="file" accept="application/pdf,image/*" hidden onChange={pick} /></div></div></div>
  </Modal>;
}

// The scanned signed copy: everyone who can open the agreement can open it; the people who may change the agreement add or replace it.
function SignedCopy({ a, onChange }) {
  const ref = useRef(), [busy, setBusy] = useState(false), may = mayChange(a);
  async function pick(e) { const file = e.target.files[0]; e.target.value = ''; if (!file) return; setBusy(true);
    const r = await attempt(() => upload(file)); const rec = r && await attempt(() => update(a.id, { signedCopy: { id: r.id, name: r.name, size: r.size, mime: r.mime, at: new Date().toISOString(), by: store.me.id } }), 'Signed copy attached.');
    setBusy(false); if (rec) onChange(rec); }
  if (a.status !== 'signed') return null;
  return <div className="row small">{a.signedCopy ? <><span>Signed copy:</span><a href={'/api/files/' + a.signedCopy.id} target="_blank" rel="noreferrer">{a.signedCopy.name}</a><span className="faint">{uname(a.signedCopy.by)}</span></> : <span className="muted">The scanned signed copy is not attached yet.</span>}
    {may && <><button className="btn sm" type="button" disabled={busy} onClick={() => ref.current.click()}>{busy ? 'Uploading…' : a.signedCopy ? 'Replace' : 'Attach the signed copy'}</button><input ref={ref} type="file" accept="application/pdf,image/*" hidden onChange={pick} /></>}</div>;
}
