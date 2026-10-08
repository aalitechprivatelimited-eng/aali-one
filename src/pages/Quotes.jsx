import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore, list, get, create, update, store } from '../api.js';
import { settings, uname, fmtDate, today, addDays, inr, clientName, can, canEdit } from '../lib.js';
import { docTotals, fyLabel } from '../../shared/money.js';
import { Field, In, Sel, Pick, Area, Pill, Empty, Sample, DeleteButton, Message, attempt, toast, RO, ViewOnly } from '../ui.jsx';
import { QuoteSheet } from '../doc.jsx';
import { useId } from '../App.jsx';

export const STATUS = ['draft', 'needs approval', 'sent', 'accepted', 'declined', 'expired'];
const tone = { accepted: 'ok', 'needs approval': 'warn', declined: 'bad', expired: 'bad', sent: 'info' };
export default function Quotes() { useStore(); const id = useId(); if (!can('quotes')) return <Empty>Quotations, receipts and payments are handled by the Sales Manager and management.</Empty>; return id ? <Editor id={id === 'new' ? null : id} /> : <Register />; }

function Register() {
  const nav = useNavigate(), [f, setF] = useState({ q: '', status: '', fy: fyLabel(today()) });
  const rows = list('quote').filter((q) => (!f.status || q.status === f.status) && (!f.fy || q.fy === f.fy) && (!f.q || `${q.number} ${q.clientName} ${q.subject}`.toLowerCase().includes(f.q.toLowerCase()))).sort((a, b) => (b.seq || 0) - (a.seq || 0));
  const fys = [...new Set(list('quote').map((q) => q.fy))];
  const sum = (s) => rows.filter((q) => !s || q.status === s).reduce((a, q) => a + (q.totals?.total || 0), 0);
  return <>
    <div className="topbar"><h1>Quotations <small>{rows.length}</small> <ViewOnly when={!canEdit('quotes')} /></h1>{canEdit('quotes') && <Link className="btn primary" to="/quotes/new">+ New quotation</Link>}</div>
    <div className="stats"><div className="stat"><span className="l">Quoted</span><span className="v">{inr(sum())}</span></div><div className="stat"><span className="l">Accepted</span><span className="v">{inr(sum('accepted'))}</span></div>
      <div className="stat"><span className="l">Waiting for approval</span><span className="v">{rows.filter((q) => q.status === 'needs approval').length}</span></div></div>
    <div className="row" style={{ marginBottom: 12 }}><In placeholder="Search number, client, subject" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ maxWidth: 280 }} />
      <Sel value={f.status} onChange={(v) => setF({ ...f, status: v })} options={STATUS} blank="All statuses" style={{ width: 'auto' }} /><Sel value={f.fy} onChange={(v) => setF({ ...f, fy: v })} options={fys} blank="All years" style={{ width: 'auto' }} /></div>
    {rows.length ? <div className="tbl cards"><table><thead><tr><th>Number</th><th>Client</th><th>Subject</th><th>Date</th><th className="n">Total</th><th>Status</th><th>By</th></tr></thead><tbody>
      {rows.map((q) => <tr key={q.id} className="click" onClick={() => nav('/quotes/' + q.id)}><td className="num"><b>{q.number}</b></td><td>{q.clientName}<Sample on={q.sample} /></td><td>{q.subject}</td><td>{fmtDate(q.date)}</td>
        <td className="n">{inr(q.totals?.total)}</td><td><span className={'pill ' + (tone[q.status] || '')}>{q.status}</span></td><td>{uname(q.createdBy)}</td></tr>)}
    </tbody></table></div> : <Empty>No quotations yet. Make one from a deal, or with “+ New quotation”.</Empty>}
  </>;
}

function blankFrom(deal) {
  const c = deal && get(deal.clientId), svc = deal && settings().services.find((s) => s.name === deal.service);
  return { dealId: deal?.id || '', clientId: deal?.clientId || '', clientName: c?.name || deal?.contactName || '', contactName: deal?.contactName || '', phone: deal?.phone || c?.phone || '',
    email: c?.email || '', address: c?.address || '', gstin: c?.gstin || '', subject: deal?.title || '', date: today(), validUntil: addDays(today(), 15),
    items: svc ? [{ desc: svc.name, note: svc.note, qty: 1, unit: svc.unit, rate: svc.rate }] : [{ desc: '', note: '', qty: 1, unit: 'Nos', rate: 0 }],
    discountType: 'none', discountValue: 0, taxMode: 'intra', taxRate: 18, roundOff: true, showTds: false, terms: settings().business.quoteTerms };
}

function Editor({ id }) {
  const nav = useNavigate(), [sp] = useSearchParams(), saved = id ? get(id) : null;
  const [q, setQ] = useState(() => saved ? { ...saved } : blankFrom(get(sp.get('deal')))), [busy, setBusy] = useState(false);
  const edit = canEdit('quotes');
  if (id && !saved) return <Empty>This quotation was not found. <Link to="/quotes">Back</Link></Empty>;
  if (!id && !edit) return <Empty>Your access to quotations is view only. <Link to="/quotes">Back</Link></Empty>;
  const up = (k) => (v) => setQ({ ...q, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v });
  const item = (i, k, v) => setQ({ ...q, items: q.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) });
  const t = docTotals(q), limit = settings().discountApprovalPct;
  async function save(extra = {}) {
    setBusy(true);
    const data = { ...q, ...extra }; ['id', 'type', 'number', 'seq', 'fy', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample', 'totals'].forEach((k) => delete data[k]);
    const r = id ? await attempt(() => update(id, data), 'Saved.') : await attempt(() => create('quote', data));
    setBusy(false); if (!r) return;
    const rec = id ? r : r.record; setQ({ ...rec });
    if (!id) { toast(`Saved as ${rec.number}.`); nav('/quotes/' + rec.id, { replace: true }); }
    if (rec.status === 'needs approval') toast(`Discount above ${limit}% – sent to the Sales Manager for approval.`);
  }
  async function setStatus(s) {
    await save({ status: s });
    if (s === 'accepted' && q.dealId && get(q.dealId)?.stage !== 'won') toast('Accepted. Open the deal and mark it Won to hand over to IT.');
  }
  return <>
    <div className="topbar no-print"><h1>{saved ? saved.number : 'New quotation'} {saved && <span className={'pill ' + (tone[saved.status] || '')}>{saved.status}</span>} <ViewOnly when={!edit} /></h1>
      <div className="row"><Link className="btn" to="/quotes">Register</Link>{q.dealId && <Link className="btn" to={'/deals/' + q.dealId}>Open deal</Link>}
        {saved && <button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>}
        {saved && canEdit('agreements') && <Link className="btn" to={`/agreements/new?kind=service&quote=${saved.id}`}>Make agreement</Link>}
        {saved && edit && <button className="btn" type="button" onClick={() => { const c = { ...q }; ['id', 'number', 'seq', 'fy', 'status', 'createdAt', 'discountApprovedAt'].forEach((k) => delete c[k]); setQ({ ...c, date: today(), validUntil: addDays(today(), 15) }); nav('/quotes/new'); }}>Duplicate</button>}
        {edit && <button className="btn primary" type="button" disabled={busy} onClick={() => save()}>{saved ? 'Save changes' : 'Save & get number'}</button>}</div></div>
    {saved?.status === 'needs approval' && <div className="banner no-print" style={{ marginBottom: 12 }}>Discount {saved.totals?.discountPct}% is above the {limit}% limit. It waits for a manager's approval before it can be sent.</div>}
    <div className="grid2 no-print" style={{ gridTemplateColumns: 'minmax(300px,1fr) minmax(0,1.4fr)', alignItems: 'start' }}>
      <RO when={!edit}><div className="stack">
        <div className="card form"><h3 className="full">Client</h3>
          <Field label="Deal"><Pick value={q.dealId} onChange={(v) => setQ({ ...q, ...(v ? blankFrom(get(v)) : {}), dealId: v, items: q.items })} options={list('deal').map((d) => [d.id, d.title, clientName(d.clientId)])} blank="Not linked" /></Field>
          <Field label="Client name"><In value={q.clientName} onChange={up('clientName')} /></Field><Field label="Attention (person)"><In value={q.contactName} onChange={up('contactName')} /></Field>
          <Field label="Phone"><In value={q.phone} onChange={up('phone')} /></Field><Field label="Email"><In value={q.email} onChange={up('email')} /></Field><Field label="GSTIN"><In value={q.gstin} onChange={up('gstin')} /></Field>
          <Field label="Address" full><Area value={q.address} onChange={up('address')} /></Field><Field label="Subject" full><In value={q.subject} onChange={up('subject')} /></Field>
          <Field label="Date"><In type="date" value={q.date} onChange={up('date')} disabled={!!saved} /></Field><Field label="Valid until"><In type="date" value={q.validUntil} onChange={up('validUntil')} /></Field>
        </div>
        <div className="card stack"><h3>Lines</h3>
          <div className="row">{settings().services.map((s) => <button key={s.id} type="button" className="btn sm" onClick={() => setQ({ ...q, items: [...q.items.filter((x) => x.desc || x.rate), { desc: s.name, note: s.note, qty: 1, unit: s.unit, rate: s.rate }] })}>+ {s.name}</button>)}</div>
          {q.items.map((it, i) => <div key={i} className="card" style={{ background: 'var(--gold-50)' }}><div className="form">
            <Field label={`Line ${i + 1}`} full><In value={it.desc} onChange={(e) => item(i, 'desc', e.target.value)} placeholder="Description" /></Field>
            <Field label="Details" full><In value={it.note || ''} onChange={(e) => item(i, 'note', e.target.value)} placeholder="What is included" /></Field>
            <Field label="Qty"><In type="number" value={it.qty} onChange={(e) => item(i, 'qty', e.target.value)} /></Field><Field label="Unit"><In value={it.unit} onChange={(e) => item(i, 'unit', e.target.value)} /></Field>
            <Field label="Rate (₹)"><In type="number" value={it.rate} onChange={(e) => item(i, 'rate', e.target.value)} /></Field>
            <div className="row" style={{ alignSelf: 'end' }}><span className="num">{inr((+it.qty || 0) * (+it.rate || 0))}</span><button className="btn ghost sm" type="button" onClick={() => setQ({ ...q, items: q.items.filter((_, j) => j !== i) })}>Remove</button></div>
          </div></div>)}
          <button className="btn sm" type="button" onClick={() => setQ({ ...q, items: [...q.items, { desc: '', qty: 1, unit: 'Nos', rate: 0 }] })}>+ Add line</button></div>
        <div className="card form"><h3 className="full">Discount & tax</h3>
          <Field label="Discount"><Sel value={q.discountType} onChange={up('discountType')} options={[['none', 'None'], ['percent', 'Percent'], ['flat', 'Flat ₹']]} /></Field>
          <Field label="Discount value" hint={`Above ${limit}% needs a manager's OK`}><In type="number" value={q.discountValue} onChange={up('discountValue')} disabled={q.discountType === 'none'} /></Field>
          <Field label="GST"><Sel value={q.taxMode} onChange={up('taxMode')} options={[['intra', 'CGST + SGST (same state)'], ['inter', 'IGST (other state)'], ['export', 'Export (LUT, 0%)'], ['none', 'No GST']]} /></Field>
          <Field label="GST rate %"><In type="number" value={q.taxRate} onChange={up('taxRate')} /></Field>
          <label className="check"><input type="checkbox" checked={q.roundOff !== false} onChange={up('roundOff')} /> Round off the total</label>
          <label className="check"><input type="checkbox" checked={!!q.showTds} onChange={up('showTds')} /> Show TDS note (194J, 2%)</label>
          <Field label="Terms" full><Area style={{ minHeight: 110 }} value={q.terms} onChange={up('terms')} /></Field>
        </div>
        {saved && <div className="card stack"><h3>Status</h3><div className="row">{['sent', 'accepted', 'declined', 'expired'].map((s) => <button key={s} type="button" className="btn sm" disabled={saved.status === 'needs approval'} onClick={() => setStatus(s)}>Mark {s}</button>)}</div>
          <Message phone={q.phone} defaultId="tp-quote" vars={{ client: (q.contactName || q.clientName || '').split(' ')[0], service: q.subject, quote: saved.number, amount: inr(t.total) }} />
          <div className="row"><Sample on={saved.sample} /><span className="grow" /><DeleteButton id={saved.id} needsReason after={() => nav('/quotes')} /></div></div>}
      </div></RO>
      <div className="paper-wrap"><div style={{ transform: 'scale(.72)', transformOrigin: 'top left', width: '139%' }}><QuoteSheet q={{ ...q, number: saved?.number }} /></div></div>
    </div>
    <div className="hide print-only" style={{ display: 'none' }} />
    <style>{'@media print{.paper-wrap>div{transform:none!important;width:auto!important}.paper-wrap{display:block!important}.grid2.no-print{display:block!important}.grid2.no-print>.stack{display:none!important}}'}</style>
  </>;
}
