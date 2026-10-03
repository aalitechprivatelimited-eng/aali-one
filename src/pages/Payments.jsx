import { useState } from 'react';
import { Link, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useStore, list, get, create, update, store } from '../api.js';
import { settings, uname, fmtDate, today, addDays, inr, clientName, diff, canMoney, canEdit, csvCell } from '../lib.js';
import { receiptTotals, docTotals, fyLabel } from '../../shared/money.js';
import { Modal, Field, In, Sel, Pick, Area, Pill, Due, Empty, Sample, DeleteButton, Person, Message, attempt, toast, Tabs, RO, ViewOnly, TeamFilter, byTeam } from '../ui.jsx';
import { ReceiptSheet, QuoteSheet } from '../doc.jsx';

export default function Payments() {
  useStore(); const p = useParams()['*'] || '', [kind, id] = p.split('/');
  if (!canMoney()) return <Empty>Quotations, receipts and payments are handled by the Sales Manager and management.</Empty>;
  if (id === 'new' && !canEdit('money')) return <Empty>Your access to payments is view only. <Link to="/payments">Back</Link></Empty>;
  if (kind === 'receipt' && id) return <ReceiptEditor id={id === 'new' ? null : id} />;
  if (kind === 'invoice' && id) return <InvoiceEditor id={id === 'new' ? null : id} />;
  return <Home />;
}

const KINDS = [['advance', 'Advance'], ['milestone', 'Instalment'], ['final', 'Final / balance'], ['maintenance', 'Maintenance fee'], ['renewal', 'Domain / hosting renewal'], ['other', 'Other']];
const REP = [['none', 'No'], ['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['half', 'Every 6 months'], ['yearly', 'Every year']];

function Home() {
  const nav = useNavigate(), [tab, setTab] = useState('collect'), [add, setAdd] = useState(false), [remind, setRemind] = useState(null), [tf, setTf] = useState({ owner: '', company: '' });
  const t = today(), month = t.slice(0, 7), edit = canEdit('money');
  const open = list('payment').filter((p) => p.status !== 'paid' && byTeam(p.owner, tf)).sort((a, b) => a.due.localeCompare(b.due));
  const bal = (p) => Math.max(0, (+p.amount || 0) - (+p.paid || 0));
  const groups = [['Overdue', open.filter((p) => p.due < t)], ['Rest of this month', open.filter((p) => p.due >= t && p.due.slice(0, 7) === month)], ['Later', open.filter((p) => p.due.slice(0, 7) > month)]];
  const receipts = list('receipt').sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number)), invoices = list('invoice').sort((a, b) => (b.seq || 0) - (a.seq || 0));
  const gotMonth = receipts.filter((r) => r.date.slice(0, 7) === month).reduce((s, r) => s + (r.totals?.received || 0), 0);
  return <>
    <div className="topbar"><h1>Payments & receipts <ViewOnly when={!edit} /></h1>{edit && <div className="row"><button className="btn" type="button" onClick={() => setAdd(true)}>+ Payment to collect</button><Link className="btn" to="/payments/invoice/new">+ Tax invoice</Link><Link className="btn primary" to="/payments/receipt/new">+ Receipt</Link></div>}</div>
    <div className="stats">
      <div className="stat"><span className="l">Received this month</span><span className="v">{inr(gotMonth)}</span></div>
      <div className={'stat' + (groups[0][1].length ? ' hot' : '')}><span className="l">Overdue</span><span className="v">{inr(groups[0][1].reduce((s, p) => s + bal(p), 0))}</span><span className="small muted">{groups[0][1].length} items</span></div>
      <div className="stat"><span className="l">Due this month</span><span className="v">{inr(groups[1][1].reduce((s, p) => s + bal(p), 0))}</span></div>
      <div className="stat"><span className="l">Total still to collect</span><span className="v">{inr(open.reduce((s, p) => s + bal(p), 0))}</span></div>
    </div>
    <Tabs value={tab} onChange={setTab} tabs={[['collect', 'To collect'], ['receipts', `Receipts (${receipts.length})`], ['invoices', `Tax invoices (${invoices.length})`], ['clients', 'Who owes what'], ['export', 'Export for Tally / accounts']]} />
    {tab === 'collect' && <div className="stack"><div className="row"><TeamFilter value={tf} onChange={setTf} /><span className="small muted">Each BDE collects from their own clients. Record payment makes the receipt and updates the balance.</span></div>
      {!open.length && <Empty>Nothing to collect. Add payments from a won deal, or with “+ Payment to collect”.</Empty>}
      {groups.map(([title, rows]) => rows.length ? <section key={title}><h2 style={{ marginBottom: 8 }}>{title} <span className="num small muted">{inr(rows.reduce((s, p) => s + bal(p), 0))}</span></h2>
        <div className="list">{rows.map((p) => <div className="li" key={p.id}>
          <div className="grow"><div className="t">{p.title}{p.clientId ? ' – ' + clientName(p.clientId) : ''}</div>
            <div className="row small"><Due date={p.due} /><Pill>{KINDS.find((k) => k[0] === p.kind)?.[1] || p.kind}</Pill>{p.repeat && p.repeat !== 'none' && <span className="muted">↻ {REP.find((r) => r[0] === p.repeat)?.[1]}</span>}
              <span className="muted">{uname(p.owner)}</span>{+p.paid > 0 && <span className="muted">paid {inr(p.paid)} so far</span>}<Sample on={p.sample} /></div></div>
          <b className="num">{inr(bal(p))}</b>
          {edit && <button className="btn sm" type="button" onClick={() => setRemind(p)}>Remind client</button>}
          {edit && <Link className="btn sm primary" to={`/payments/receipt/new?payment=${p.id}`}>Record payment</Link>}</div>)}</div></section> : null)}</div>}
    {tab === 'receipts' && (receipts.length ? <div className="tbl"><table><thead><tr><th>Receipt</th><th>Date</th><th>From</th><th>Mode</th><th className="n">Received</th><th className="n">Balance</th><th>By</th></tr></thead><tbody>
      {receipts.map((r) => <tr key={r.id} className="click" onClick={() => nav('/payments/receipt/' + r.id)}><td className="num"><b>{r.number}</b></td><td>{fmtDate(r.date)}</td><td>{r.payerName}<Sample on={r.sample} /></td><td>{r.mode}</td>
        <td className="n">{inr(r.totals?.received)}</td><td className="n">{r.totals?.balance ? inr(r.totals.balance) : '—'}</td><td>{uname(r.createdBy)}</td></tr>)}</tbody></table></div> : <Empty>No receipts yet.</Empty>)}
    {tab === 'invoices' && (invoices.length ? <div className="tbl"><table><thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th className="n">Total</th><th>Status</th></tr></thead><tbody>
      {invoices.map((r) => <tr key={r.id} className="click" onClick={() => nav('/payments/invoice/' + r.id)}><td className="num"><b>{r.number}</b></td><td>{fmtDate(r.date)}</td><td>{r.clientName}</td><td className="n">{inr(r.totals?.total)}</td><td>{r.status}</td></tr>)}</tbody></table></div>
      : <Empty>No tax invoices yet. Make one from an accepted quotation. (Format to be confirmed by the CA.)</Empty>)}
    {tab === 'clients' && <Owes />}
    {tab === 'export' && <Export />}
    {add && <PaymentModal onClose={() => setAdd(false)} />}
    {remind && <Modal title={`Remind ${clientName(remind.clientId) || 'the client'}`} onClose={() => setRemind(null)}>
      <Message phone={get(remind.dealId)?.phone || get(remind.clientId)?.phone} defaultId="tp-pay" vars={{ client: (get(remind.dealId)?.contactName || clientName(remind.clientId)).split(' ')[0], amount: inr(bal(remind)), item: remind.title, due: fmtDate(remind.due) }} /></Modal>}
  </>;
}

export function PaymentModal({ onClose, preset = {} }) {
  const [p, setP] = useState({ title: '', kind: 'other', amount: '', due: addDays(today(), 7), repeat: 'none', owner: store.me.id, ...preset });
  const up = (k) => (v) => setP({ ...p, [k]: v?.target ? v.target.value : v });
  return <Modal title="Payment to collect" onClose={onClose} footer={<button className="btn primary" type="button" onClick={async () => (await attempt(() => create('payment', { ...p, amount: +p.amount || 0, baseAmount: +p.amount || 0 }), 'Added. It shows in Today for the BDE.')) && onClose()}>Save</button>}>
    <div className="form"><Field label="For *"><In value={p.title} onChange={up('title')} placeholder="e.g. Website maintenance fee" /></Field>
      <Field label="Type"><Sel value={p.kind} onChange={up('kind')} options={KINDS} /></Field>
      <Field label="Client"><Pick value={p.clientId} onChange={up('clientId')} options={list('client').map((c) => [c.id, c.name, c.city])} blank="Choose…" /></Field>
      <Field label="Deal"><Pick value={p.dealId} onChange={up('dealId')} options={list('deal').filter((d) => !p.clientId || d.clientId === p.clientId).map((d) => [d.id, d.title, clientName(d.clientId)])} blank="None" /></Field>
      <Field label="Amount (₹)"><In type="number" value={p.amount} onChange={up('amount')} /></Field><Field label="Due date"><In type="date" value={p.due} onChange={up('due')} /></Field>
      <Field label="Repeats"><Sel value={p.repeat} onChange={up('repeat')} options={REP} /></Field><Field label="BDE who collects"><Person value={p.owner} onChange={up('owner')} filter={(u) => u.team === 'sales'} /></Field>
    </div></Modal>;
}

function Owes() {
  const rows = list('client').map((c) => { const pays = list('payment').filter((p) => p.clientId === c.id && p.status !== 'paid');
    return { c, due: pays.reduce((s, p) => s + Math.max(0, (+p.amount || 0) - (+p.paid || 0)), 0), over: pays.filter((p) => diff(p.due) < 0).reduce((s, p) => s + Math.max(0, (+p.amount || 0) - (+p.paid || 0)), 0),
      got: list('receipt').filter((r) => r.clientId === c.id).reduce((s, r) => s + (r.totals?.received || 0), 0) }; }).filter((r) => r.due || r.got).sort((a, b) => b.over - a.over || b.due - a.due);
  return rows.length ? <div className="tbl"><table><thead><tr><th>Client</th><th className="n">Received so far</th><th className="n">Still due</th><th className="n">Overdue</th><th>BDE</th></tr></thead><tbody>
    {rows.map(({ c, due, over, got }) => <tr key={c.id}><td><Link to={'/clients/' + c.id}>{c.name}</Link></td><td className="n">{inr(got)}</td><td className="n">{inr(due)}</td><td className="n" style={{ color: over ? 'var(--bad)' : '' }}>{over ? inr(over) : '—'}</td><td>{uname(c.owner)}</td></tr>)}
  </tbody></table></div> : <Empty>No money due.</Empty>;
}

function Export() {
  const [from, setFrom] = useState(today().slice(0, 8) + '01'), [to, setTo] = useState(today());
  function dl(name, rows) {
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  const inRange = (d) => d >= from && d <= to;
  return <div className="card stack" style={{ maxWidth: 640 }}><p style={{ margin: 0 }}>Download receipts and invoices as CSV. Your CA can import them into Tally or Zoho Books, so nobody retypes.</p>
    <div className="row"><Field label="From"><In type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><In type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
    <div className="row"><button className="btn" type="button" onClick={() => dl(`receipts_${from}_${to}.csv`, [['Receipt No', 'Date', 'Payer', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Received', 'Balance', 'Mode', 'Reference'],
      ...list('receipt').filter((r) => inRange(r.date)).map((r) => [r.number, r.date, r.payerName, r.payerGstin, r.totals.subtotal, r.totals.cgst, r.totals.sgst, r.totals.igst, r.totals.total, r.totals.received, r.totals.balance, r.mode, r.reference])])}>Download receipts</button>
      <button className="btn" type="button" onClick={() => dl(`invoices_${from}_${to}.csv`, [['Invoice No', 'Date', 'Client', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round off', 'Total'],
        ...list('invoice').filter((r) => inRange(r.date)).map((r) => [r.number, r.date, r.clientName, r.gstin, r.totals.taxable, r.totals.cgst, r.totals.sgst, r.totals.igst, r.totals.roundOff, r.totals.total])])}>Download invoices</button></div>
    <div className="banner info">A direct connection to Tally / Zoho Books can be switched on later (Settings → Connections).</div></div>;
}

function ReceiptEditor({ id }) {
  const nav = useNavigate(), [sp] = useSearchParams(), saved = id ? get(id) : null;
  const [r, setR] = useState(() => {
    if (saved) return { ...saved };
    const p = get(sp.get('payment')), c = p && get(p.clientId), d = p && get(p.dealId), bal = p ? Math.max(0, (+p.amount || 0) - (+p.paid || 0)) : 0;
    return { date: today(), paymentId: p?.id || '', clientId: p?.clientId || '', dealId: p?.dealId || '', payerName: c?.name || d?.contactName || '', payerPhone: c?.phone || d?.phone || '', payerAddress: c?.address || '', payerGstin: c?.gstin || '',
      items: [{ desc: p ? p.title + (d ? ' – ' + d.title : '') : '', amount: bal || '', incl: true }], taxMode: 'intra', taxRate: 18, balance: 0, mode: 'UPI', reference: '', against: d?.quoteNo || '', forText: '' };
  });
  if (id && !saved) return <Empty>Receipt not found. <Link to="/payments">Back</Link></Empty>;
  const up = (k) => (v) => setR({ ...r, [k]: v?.target ? v.target.value : v }), t = receiptTotals(r);
  const item = (i, k, v) => setR({ ...r, items: r.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  async function save() {
    const data = { ...r, items: r.items.map((x) => ({ ...x, amount: +x.amount || 0 })), balance: +r.balance || 0 };
    ['id', 'type', 'number', 'seq', 'fy', 'totals', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample'].forEach((k) => delete data[k]);
    const res = saved ? await attempt(() => update(id, data), 'Saved.') : await attempt(() => create('receipt', data));
    if (!res) return; const rec = saved ? res : res.record; setR({ ...rec });
    if (!saved) { toast(`Receipt ${rec.number} saved. ${r.paymentId ? 'The payment balance was updated.' : ''}`); nav('/payments/receipt/' + rec.id, { replace: true }); }
  }
  return <>
    <div className="topbar no-print"><h1>{saved ? saved.number : 'New receipt'} <ViewOnly when={!canEdit('money')} /></h1><div className="row"><Link className="btn" to="/payments">Payments</Link>{saved && <button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>}{canEdit('money') && <button className="btn primary" type="button" onClick={save}>{saved ? 'Save changes' : 'Save & get number'}</button>}</div></div>
    <div className="grid2 no-print" style={{ gridTemplateColumns: 'minmax(300px,1fr) minmax(0,1.4fr)', alignItems: 'start' }}>
      <RO when={!canEdit('money')}><div className="stack"><div className="card form">
        <Field label="Date" hint={saved ? 'The date is part of the number, so it cannot change.' : ''}><In type="date" value={r.date} onChange={up('date')} disabled={!!saved} /></Field>
        <Field label="Client"><Pick value={r.clientId} onChange={(v) => { const c = get(v); setR({ ...r, clientId: v, payerName: c?.name || r.payerName, payerPhone: c?.phone || r.payerPhone, payerAddress: c?.address || r.payerAddress, payerGstin: c?.gstin || r.payerGstin }); }} options={list('client').map((c) => [c.id, c.name, c.city])} blank="Choose…" /></Field>
        <Field label="Payment it settles"><Pick value={r.paymentId} onChange={up('paymentId')} options={list('payment').filter((p) => p.status !== 'paid' || p.id === r.paymentId).map((p) => [p.id, p.title, clientName(p.clientId)])} blank="None" disabled={!!saved} /></Field>
        <Field label="Received from"><In value={r.payerName} onChange={up('payerName')} /></Field><Field label="Phone"><In value={r.payerPhone} onChange={up('payerPhone')} /></Field><Field label="GSTIN"><In value={r.payerGstin} onChange={up('payerGstin')} /></Field>
        <Field label="Address" full><Area value={r.payerAddress} onChange={up('payerAddress')} /></Field>
      </div>
        <div className="card stack"><h3>What was paid for</h3>
          {r.items.map((it, i) => <div key={i} className="form" style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 8 }}>
            <Field label={`Line ${i + 1}`} full><In value={it.desc} onChange={(e) => item(i, 'desc', e.target.value)} /></Field>
            <Field label="Amount (₹)"><In type="number" value={it.amount} onChange={(e) => item(i, 'amount', e.target.value)} /></Field>
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={!!it.incl} onChange={(e) => item(i, 'incl', e.target.checked)} /> Round figure, GST included</label></div>)}
          <button className="btn sm" type="button" onClick={() => setR({ ...r, items: [...r.items, { desc: '', amount: '', incl: true }] })}>+ Line</button>
          {r.taxMode !== 'none' && r.items.some((x) => x.incl) && <div className="small muted">Client pays {inr(t.total)}: of that {inr(t.subtotal)} is earned and {inr(t.tax)} is GST payable. (Shown only here, not on the receipt.)</div>}</div>
        <div className="card form">
          <Field label="GST"><Sel value={r.taxMode} onChange={up('taxMode')} options={[['intra', 'CGST + SGST'], ['inter', 'IGST'], ['none', 'No GST (exempt only)']]} /></Field><Field label="Rate %"><In type="number" value={r.taxRate} onChange={up('taxRate')} /></Field>
          <Field label="Balance still due (₹)" hint="For a part payment"><In type="number" value={r.balance} onChange={up('balance')} /></Field>
          <Field label="Mode"><Sel value={r.mode} onChange={up('mode')} options={['UPI', 'Bank transfer / NEFT', 'RTGS', 'Cash', 'Cheque', 'Card']} /></Field>
          <Field label="UTR / transaction / cheque no."><In value={r.reference} onChange={up('reference')} /></Field><Field label="Against (quote / invoice no.)"><In value={r.against} onChange={up('against')} /></Field>
        </div>
        {saved && <div className="row"><Sample on={saved.sample} /><span className="grow" /><DeleteButton id={saved.id} needsReason after={() => nav('/payments')} /></div>}
      </div></RO>
      <div className="paper-wrap"><div style={{ transform: 'scale(.72)', transformOrigin: 'top left', width: '139%' }}><ReceiptSheet r={{ ...r, number: saved?.number }} /></div></div>
    </div>
    <style>{'@media print{.paper-wrap>div{transform:none!important;width:auto!important}.grid2.no-print{display:block!important}.grid2.no-print>.stack{display:none!important}}'}</style>
  </>;
}

function InvoiceEditor({ id }) {
  const nav = useNavigate(), [sp] = useSearchParams(), saved = id ? get(id) : null;
  const [q, setQ] = useState(() => {
    if (saved) return { ...saved }; const src = get(sp.get('quote'));
    const base = src ? { ...src } : { items: [{ desc: '', qty: 1, unit: 'Nos', rate: 0, sac: '998314' }], taxMode: 'intra', taxRate: 18, discountType: 'none', discountValue: 0, roundOff: true };
    ['id', 'number', 'seq', 'fy', 'status', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'totals', 'sample', 'type', 'validUntil'].forEach((k) => delete base[k]);
    return { ...base, quoteId: src?.id || '', quoteNo: src?.number || '', date: today(), dueDate: addDays(today(), 15), placeOfSupply: settings().business.state, terms: 'Payment due by the date above. Please quote the invoice number when paying.' };
  });
  if (id && !saved) return <Empty>Invoice not found. <Link to="/payments">Back</Link></Empty>;
  const up = (k) => (v) => setQ({ ...q, [k]: v?.target ? v.target.value : v }), item = (i, k, v) => setQ({ ...q, items: q.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  async function save() {
    const data = { ...q }; ['id', 'type', 'number', 'seq', 'totals', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample'].forEach((k) => delete data[k]);
    const res = saved ? await attempt(() => update(id, data), 'Saved.') : await attempt(() => create('invoice', data));
    if (res && !saved) { toast(`Invoice ${res.record.number} saved.`); nav('/payments/invoice/' + res.record.id, { replace: true }); }
  }
  return <>
    <div className="topbar no-print"><h1>{saved ? saved.number : 'New tax invoice'} <ViewOnly when={!canEdit('money')} /></h1><div className="row"><Link className="btn" to="/payments">Payments</Link>{saved && <button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>}{canEdit('money') && <button className="btn primary" type="button" onClick={save}>{saved ? 'Save changes' : 'Save & get number'}</button>}</div></div>
    <div className="banner info no-print" style={{ marginBottom: 12 }}>Tax invoice format to be confirmed by the company's CA before live use. E-invoicing (IRN) is not switched on.</div>
    <div className="grid2 no-print" style={{ gridTemplateColumns: 'minmax(300px,1fr) minmax(0,1.4fr)', alignItems: 'start' }}>
      <RO when={!canEdit('money')}><div className="stack"><div className="card form">
        {!saved && <Field label="Copy from quotation" full><Sel value={q.quoteId} onChange={(v) => nav('/payments/invoice/new?quote=' + v)} options={list('quote').map((x) => [x.id, `${x.number} – ${x.clientName}`])} blank="None" /></Field>}
        <Field label="Client"><In value={q.clientName || ''} onChange={up('clientName')} /></Field><Field label="GSTIN"><In value={q.gstin || ''} onChange={up('gstin')} /></Field>
        <Field label="Date"><In type="date" value={q.date} onChange={up('date')} disabled={!!saved} /></Field><Field label="Due date"><In type="date" value={q.dueDate} onChange={up('dueDate')} /></Field>
        <Field label="Place of supply"><In value={q.placeOfSupply || ''} onChange={up('placeOfSupply')} /></Field>
        <Field label="GST"><Sel value={q.taxMode} onChange={up('taxMode')} options={[['intra', 'CGST + SGST'], ['inter', 'IGST'], ['export', 'Export (LUT)'], ['none', 'No GST']]} /></Field>
        <Field label="Address" full><Area value={q.address || ''} onChange={up('address')} /></Field></div>
        <div className="card stack"><h3>Lines</h3>{q.items.map((it, i) => <div key={i} className="form"><Field label="Description" full><In value={it.desc} onChange={(e) => item(i, 'desc', e.target.value)} /></Field>
          <Field label="SAC"><In value={it.sac || '998314'} onChange={(e) => item(i, 'sac', e.target.value)} /></Field><Field label="Qty"><In type="number" value={it.qty} onChange={(e) => item(i, 'qty', e.target.value)} /></Field><Field label="Rate"><In type="number" value={it.rate} onChange={(e) => item(i, 'rate', e.target.value)} /></Field></div>)}
          <button className="btn sm" type="button" onClick={() => setQ({ ...q, items: [...q.items, { desc: '', qty: 1, unit: 'Nos', rate: 0, sac: '998314' }] })}>+ Line</button></div>
        {saved && <div className="row"><span className="grow" /><DeleteButton id={saved.id} needsReason after={() => nav('/payments')} /></div>}</div></RO>
      <div className="paper-wrap"><div style={{ transform: 'scale(.72)', transformOrigin: 'top left', width: '139%' }}><QuoteSheet invoice q={{ ...q, number: saved?.number }} /></div></div>
    </div>
    <style>{'@media print{.paper-wrap>div{transform:none!important;width:auto!important}.grid2.no-print{display:block!important}.grid2.no-print>.stack{display:none!important}.banner.no-print{display:none!important}}'}</style>
  </>;
}
