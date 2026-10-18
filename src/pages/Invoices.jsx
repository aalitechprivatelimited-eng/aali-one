// Aali Invoices (the user, 18 Oct 2026): tax invoices are their own app, apart from payments and receipts. The kind is chosen before an
// invoice is started – "+ B2B invoice" or "+ B2C invoice" – instead of being switched inside the maker.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useStore, list, get, create, update } from '../api.js';
import { settings, fmtDate, today, addDays, inr, canMoney, canEdit, csvCell } from '../lib.js';
import { fyLabel } from '../../shared/money.js';
import { Field, In, Sel, Area, Empty, DeleteButton, attempt, toast, Seg, RO, ViewOnly } from '../ui.jsx';
import { QuoteSheet } from '../doc.jsx';

// B2B (the client's GSTIN is on the invoice) or B2C (an unregistered buyer) – the user, 17 Oct 2026. Older invoices: B2B when a GSTIN is on them.
export const kindOf = (q) => (q.kind === 'b2b' || q.kind === 'b2c' ? q.kind : q.gstin ? 'b2b' : 'b2c');
// For the CA's GSTR-1: B2B, B2C large (inter-state above ₹1,00,000) or B2C small.
export const gstrType = (r) => (kindOf(r) === 'b2b' ? 'B2B' : r.taxMode === 'inter' && (r.totals?.total || 0) > 100000 ? 'B2CL' : 'B2CS');
const KIND = { b2b: 'B2B', b2c: 'B2C' };

export default function Invoices() {
  useStore(); const id = useParams()['*']?.split('/')[0] || '';
  if (!canMoney()) return <Empty>Tax invoices are handled by the Sales Manager and management.</Empty>;
  if (id === 'new' && !canEdit('invoices')) return <Empty>Your access to tax invoices is view only. <Link to="/invoices">Back</Link></Empty>;
  if (id) return <InvoiceEditor key={id} id={id === 'new' ? null : id} />;
  return <Register />;
}

function Register() {
  const nav = useNavigate(), edit = canEdit('invoices'), [q, setQ] = useState(''), [kind, setKind] = useState('all'), [fy, setFy] = useState('');
  const all = list('invoice').sort((a, b) => (b.date + (b.number || '')).localeCompare(a.date + (a.number || '')));
  const years = [...new Set(all.map((r) => r.fy || fyLabel(r.date)))].sort().reverse(), text = q.trim().toLowerCase();
  const rows = all.filter((r) => (kind === 'all' || kindOf(r) === kind) && (!fy || (r.fy || fyLabel(r.date)) === fy)
    && (!text || `${r.number} ${r.clientName} ${r.gstin || ''}`.toLowerCase().includes(text)));
  const sum = (xs, f) => xs.reduce((s, r) => s + (f(r) || 0), 0), tax = (r) => (r.totals?.cgst || 0) + (r.totals?.sgst || 0) + (r.totals?.igst || 0);
  return <>
    <div className="topbar"><h1>Tax invoices <small>{rows.length}</small> <ViewOnly when={!edit} /></h1>
      {edit && <div className="row"><Link className="btn" to="/invoices/new?kind=b2c">+ B2C invoice</Link><Link className="btn primary" to="/invoices/new?kind=b2b">+ B2B invoice</Link></div>}</div>
    <div className="stats">
      <div className="stat"><span className="l">Invoices</span><span className="v">{rows.length}</span></div>
      <div className="stat"><span className="l">B2B (registered clients)</span><span className="v">{inr(sum(rows.filter((r) => kindOf(r) === 'b2b'), (r) => r.totals?.total))}</span></div>
      <div className="stat"><span className="l">B2C (unregistered buyers)</span><span className="v">{inr(sum(rows.filter((r) => kindOf(r) === 'b2c'), (r) => r.totals?.total))}</span></div>
      <div className="stat"><span className="l">GST on these</span><span className="v">{inr(sum(rows, tax))}</span></div>
    </div>
    <div className="row" style={{ marginBottom: 12 }}><In placeholder="Search number, client or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
      <Seg value={kind} onChange={setKind} options={[['all', 'All'], ['b2b', 'B2B'], ['b2c', 'B2C']]} />
      <Sel value={fy} onChange={setFy} options={years.map((y) => [y, 'FY ' + y])} blank="All years" style={{ width: 'auto' }} aria-label="Financial year" />
      <span className="grow" /><Gstr1 rows={rows} /></div>
    {rows.length ? <div className="tbl cards"><table><thead><tr><th>Invoice</th><th>Kind</th><th>Date</th><th>Client</th><th>GSTIN</th><th className="n">GST</th><th className="n">Total</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.id} className="click" onClick={() => nav('/invoices/' + r.id)}><td className="num"><b>{r.number}</b></td><td>{KIND[kindOf(r)]}</td><td>{fmtDate(r.date)}</td><td>{r.clientName}</td>
        <td className="num">{r.gstin || '—'}</td><td className="n">{inr(tax(r))}</td><td className="n">{inr(r.totals?.total)}</td></tr>)}</tbody></table></div>
      : <Empty>{all.length ? 'No invoice matches.' : 'No tax invoices yet. Start one with “+ B2B invoice” (a GST-registered client) or “+ B2C invoice” (an unregistered buyer), or copy one from an accepted quotation.'}</Empty>}
  </>;
}

// The invoices shown, as a CSV for the CA's GSTR-1 (Type B2B / B2CL / B2CS).
function Gstr1({ rows }) {
  const dl = () => { const csv = [['Invoice No', 'Type', 'Date', 'Client', 'GSTIN', 'Place of supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round off', 'Total'],
    ...rows.map((r) => [r.number, gstrType(r), r.date, r.clientName, r.gstin || '', r.placeOfSupply || '', r.totals?.taxable, r.totals?.cgst, r.totals?.sgst, r.totals?.igst, r.totals?.roundOff, r.totals?.total])].map((x) => x.map(csvCell).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `invoices_gstr1_${today()}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  return <button className="btn sm" type="button" disabled={!rows.length} onClick={dl}>Download for GSTR-1 (CSV)</button>;
}

function InvoiceEditor({ id }) {
  const nav = useNavigate(), [sp] = useSearchParams(), saved = id ? get(id) : null, edit = canEdit('invoices');
  const [q, setQ] = useState(() => {
    if (saved) return { ...saved }; const src = get(sp.get('quote'));
    const base = src ? { ...src } : { items: [{ desc: '', qty: 1, unit: 'Nos', rate: 0, sac: '998314' }], taxMode: 'intra', taxRate: 18, discountType: 'none', discountValue: 0, roundOff: true };
    ['id', 'number', 'seq', 'fy', 'status', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'totals', 'sample', 'type', 'validUntil'].forEach((k) => delete base[k]);
    const kind = sp.get('kind') === 'b2c' ? 'b2c' : 'b2b';
    return { ...base, kind, ...(kind === 'b2c' ? { gstin: '' } : {}), quoteId: src?.id || '', quoteNo: src?.number || '', date: today(), dueDate: addDays(today(), 15), placeOfSupply: settings().business.state, terms: 'Payment due by the date above. Please quote the invoice number when paying.' };
  });
  if (id && !saved) return <Empty>Invoice not found. <Link to="/invoices">Back</Link></Empty>;
  const k = kindOf(q), up = (f) => (v) => setQ({ ...q, [f]: v?.target ? v.target.value : v }), item = (i, f, v) => setQ({ ...q, items: q.items.map((x, j) => (j === i ? { ...x, [f]: v } : x)) });
  async function save() {
    const data = { ...q, kind: k }; ['id', 'type', 'number', 'seq', 'totals', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample'].forEach((f) => delete data[f]);
    const res = saved ? await attempt(() => update(id, data), 'Saved.') : await attempt(() => create('invoice', data));
    if (res && !saved) { toast(`Invoice ${res.record.number} saved.`); nav('/invoices/' + res.record.id, { replace: true }); }
  }
  return <>
    <div className="topbar no-print"><h1>{saved ? saved.number : `New ${KIND[k]} tax invoice`} <small>{saved ? KIND[k] + ' tax invoice' : ''}</small> <ViewOnly when={!edit} /></h1><div className="row"><Link className="btn" to="/invoices">Invoices</Link>{saved && <button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>}{edit && <button className="btn primary" type="button" onClick={save}>{saved ? 'Save changes' : 'Save & get number'}</button>}</div></div>
    <div className="banner info no-print" style={{ marginBottom: 12 }}>{k === 'b2b' ? 'B2B: the client is GST-registered, so its GSTIN goes on the invoice.' : 'B2C: an unregistered buyer (a person or a small shop) – no GSTIN.'} Tax invoice format to be confirmed by the company's CA before live use. E-invoicing (IRN) is not switched on.</div>
    <div className="grid2 no-print" style={{ gridTemplateColumns: 'minmax(300px,1fr) minmax(0,1.4fr)', alignItems: 'start' }}>
      <RO when={!edit}><div className="stack"><div className="card form">
        {!saved && <Field label="Copy from quotation" full><Sel value={q.quoteId} onChange={(v) => nav(`/invoices/new?kind=${k}&quote=${v}`)} options={list('quote').map((x) => [x.id, `${x.number} – ${x.clientName}`])} blank="None" /></Field>}
        <Field label="Client *"><In value={q.clientName || ''} onChange={up('clientName')} /></Field>{k === 'b2b' && <Field label="Client's GSTIN *"><In value={q.gstin || ''} onChange={(e) => setQ({ ...q, gstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>}
        <Field label="Date"><In type="date" value={q.date} onChange={up('date')} disabled={!!saved} /></Field><Field label="Due date"><In type="date" value={q.dueDate} onChange={up('dueDate')} /></Field>
        <Field label="Place of supply *" hint="The client's state"><In value={q.placeOfSupply || ''} onChange={up('placeOfSupply')} /></Field>
        <Field label="GST"><Sel value={q.taxMode} onChange={up('taxMode')} options={[['intra', 'CGST + SGST'], ['inter', 'IGST'], ['export', 'Export (LUT)'], ['none', 'No GST']]} /></Field>
        <Field label="Address" full><Area value={q.address || ''} onChange={up('address')} /></Field></div>
        <div className="card stack"><h3>Lines</h3>{q.items.map((it, i) => <div key={i} className="form"><Field label="Description" full><In value={it.desc} onChange={(e) => item(i, 'desc', e.target.value)} /></Field>
          <Field label="SAC"><In value={it.sac || '998314'} onChange={(e) => item(i, 'sac', e.target.value)} /></Field><Field label="Qty"><In type="number" value={it.qty} onChange={(e) => item(i, 'qty', e.target.value)} /></Field><Field label="Rate"><In type="number" value={it.rate} onChange={(e) => item(i, 'rate', e.target.value)} /></Field></div>)}
          <button className="btn sm" type="button" onClick={() => setQ({ ...q, items: [...q.items, { desc: '', qty: 1, unit: 'Nos', rate: 0, sac: '998314' }] })}>+ Line</button></div>
        {saved && <div className="row"><span className="grow" /><DeleteButton id={saved.id} needsReason after={() => nav('/invoices')} /></div>}</div></RO>
      <div className="paper-wrap"><div style={{ transform: 'scale(.72)', transformOrigin: 'top left', width: '139%' }}><QuoteSheet invoice q={{ ...q, kind: k, number: saved?.number }} /></div></div>
    </div>
    <style>{'@media print{.paper-wrap>div{transform:none!important;width:auto!important}.grid2.no-print{display:block!important}.grid2.no-print>.stack{display:none!important}.banner.no-print{display:none!important}}'}</style>
  </>;
}
