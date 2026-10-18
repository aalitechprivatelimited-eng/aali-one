import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useStore, list, get, create, update, store, http, poll } from '../api.js';
import { settings, uname, fmtDate, today, addDays, inr, clientName, diff, canMoney, canEdit, csvCell } from '../lib.js';
import { receiptTotals } from '../../shared/money.js';
import { Modal, Field, In, Sel, Pick, Area, Pill, Due, Empty, Sample, DeleteButton, Person, Message, attempt, toast, Tabs, RO, ViewOnly, TeamFilter, byTeam } from '../ui.jsx';
import { ReceiptSheet } from '../doc.jsx';

export default function Payments() {
  useStore(); const p = useParams()['*'] || '', [kind, id] = p.split('/'), { search } = useLocation();
  if (!canMoney()) return <Empty>Quotations, receipts and payments are handled by the Sales Manager and management.</Empty>;
  if (id === 'new' && !canEdit('money')) return <Empty>Your access to payments is view only. <Link to="/payments">Back</Link></Empty>;
  if (kind === 'receipt' && id) return <ReceiptEditor id={id === 'new' ? null : id} />;
  if (kind === 'invoice') return <Navigate to={'/invoices/' + (id || '') + search} replace />; // tax invoices moved to Aali Invoices (18 Oct 2026)
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
  const receipts = list('receipt').sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  const gotMonth = receipts.filter((r) => r.date.slice(0, 7) === month && r.currency !== 'USD' && !['pending', 'refunded'].includes(r.status)).reduce((s, r) => s + (r.totals?.received || 0), 0);
  return <>
    <div className="topbar"><h1>Payments & receipts <ViewOnly when={!edit} /></h1>{edit && <div className="row"><button className="btn" type="button" onClick={() => setAdd(true)}>+ Payment to collect</button><Link className="btn primary" to="/payments/receipt/new">+ Receipt</Link></div>}</div>
    <div className="stats">
      <div className="stat"><span className="l">Received this month</span><span className="v">{inr(gotMonth)}</span></div>
      <div className={'stat' + (groups[0][1].length ? ' hot' : '')}><span className="l">Overdue</span><span className="v">{inr(groups[0][1].reduce((s, p) => s + bal(p), 0))}</span><span className="small muted">{groups[0][1].length} items</span></div>
      <div className="stat"><span className="l">Due this month</span><span className="v">{inr(groups[1][1].reduce((s, p) => s + bal(p), 0))}</span></div>
      <div className="stat"><span className="l">Total still to collect</span><span className="v">{inr(open.reduce((s, p) => s + bal(p), 0))}</span></div>
    </div>
    <Tabs value={tab} onChange={setTab} tabs={[['collect', 'To collect'], ['receipts', `Receipts (${receipts.length})`], ['clients', 'Who owes what'], ['export', 'Export for Tally / accounts']]} />
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
    {tab === 'receipts' && <ReceiptRegister />}
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
  return <div className="card stack" style={{ maxWidth: 640 }}><p style={{ margin: 0 }}>Download receipts as CSV. Your CA can import them into Tally or Zoho Books, so nobody retypes. Tax invoices are downloaded from Aali Invoices (for GSTR-1).</p>
    <div className="row"><Field label="From"><In type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><In type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
    <div className="row"><button className="btn" type="button" onClick={() => dl(`receipts_${from}_${to}.csv`, [['Receipt No', 'Date', 'Payer', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Received', 'Balance', 'Mode', 'Reference'],
      ...list('receipt').filter((r) => inRange(r.date)).map((r) => [r.number, r.date, r.payerName, r.payerGstin, r.totals.subtotal, r.totals.cgst, r.totals.sgst, r.totals.igst, r.totals.total, r.totals.received, r.totals.balance, r.mode, r.reference])])}>Download receipts</button></div>
    <div className="banner info">A direct connection to Tally / Zoho Books can be switched on later (Settings → Connections).</div></div>;
}

// ---------- receipts (everything the Receipt generator did, 18 Oct 2026) ----------
export const RSTATUS = [['received', 'Received'], ['partial', 'Part payment'], ['pending', 'Pending clearance'], ['refunded', 'Refunded']];
const MODES = ['UPI', 'Bank transfer / NEFT', 'RTGS', 'IMPS', 'Cash', 'Cheque', 'Card'];
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// A line carries one stored amount: before GST, or after GST when "incl" is on. Both boxes show; the one typed into last drives the line.
const netOf = (it, rate, taxed) => { const a = +it.amount || 0; return taxed && it.incl ? r2(a / (1 + rate / 100)) : a; };
const grossOf = (it, rate, taxed) => { const a = +it.amount || 0; return taxed && !it.incl ? r2(a * (1 + rate / 100)) : a; };
// What later receipts brought in against each receipt they settle ("Record balance"). Built from every receipt, never a filtered list.
export const settledBy = (all) => { const m = new Map(); for (const x of all) if (x.settlesId) m.set(x.settlesId, (m.get(x.settlesId) || 0) + (x.totals?.received || 0)); return m; };
export const owing = (r, m) => Math.max(0, r2((r.totals?.balance || 0) - (m.get(r.id) || 0)));
const usdFmt = (n) => '$' + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ReceiptRegister() {
  const nav = useNavigate(), [q, setQ] = useState(''), [st, setSt] = useState(''), [fy, setFy] = useState(''), [imp, setImp] = useState(false), me = store.me;
  const all = list('receipt').sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number)), settled = settledBy(all);
  const years = [...new Set(all.map((r) => r.fy))].filter(Boolean).sort().reverse(), text = q.trim().toLowerCase();
  const stOf = (r) => r.status || (r.totals?.balance > 0 ? 'partial' : 'received');
  const rows = all.filter((r) => (!st || stOf(r) === st) && (!fy || r.fy === fy)
    && (!text || `${r.number} ${r.payerName} ${r.forText || ''} ${r.description || ''} ${(r.items || []).map((x) => x.desc).join(' ')} ${r.reference || ''}`.toLowerCase().includes(text)));
  const inrRows = rows.filter((r) => r.currency !== 'USD'), sum = (f) => inrRows.reduce((s, r) => s + (f(r) || 0), 0), arrived = (r) => !['pending', 'refunded'].includes(r.status);
  const money = (r, n) => (r.currency === 'USD' ? usdFmt(n) : inr(n)), out = sum((r) => owing(r, settled));
  return <div className="stack">
    <div className="stats">
      <div className="stat"><span className="l">Receipts</span><span className="v">{rows.length}</span></div>
      <div className="stat"><span className="l">Total amount</span><span className="v">{inr(sum((r) => !r.settlesId && r.status !== 'refunded' && r.totals?.total))}</span><span className="small muted">balance receipts not counted twice</span></div>
      <div className="stat"><span className="l">Cash received</span><span className="v">{inr(sum((r) => arrived(r) && r.totals?.received))}</span></div>
      <div className={'stat' + (out ? ' warm' : '')}><span className="l">Still outstanding</span><span className="v">{inr(out)}</span></div>
    </div>
    {imp && <ImportGenerator onClose={() => setImp(false)} />}
    <div className="row"><In placeholder="Search number, payer, purpose or UTR" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
      <Sel value={st} onChange={setSt} options={RSTATUS} blank="Every status" style={{ width: 'auto' }} aria-label="Status" />
      <Sel value={fy} onChange={setFy} options={years.map((y) => [y, 'FY ' + y])} blank="All years" style={{ width: 'auto' }} aria-label="Financial year" />
      {(me.isAdmin || me.title === 'ops') && <><span className="grow" /><button className="btn sm" type="button" onClick={() => setImp(true)}>Import from Receipt generator</button></>}</div>
    {rows.length ? <div className="tbl cards"><table><thead><tr><th>Receipt</th><th>Date</th><th>From</th><th>Status</th><th className="n">Total</th><th className="n">Paid</th><th className="n">Balance due</th><th>Mode</th><th>By</th></tr></thead><tbody>
      {rows.map((r) => { const o = owing(r, settled), stl = (r.totals?.balance || 0) > 0 && !o;
        return <tr key={r.id} className="click" onClick={() => nav('/payments/receipt/' + r.id)}><td className="num"><b>{r.number}</b>{r.settlesNo && <div className="small muted">against {r.settlesNo}</div>}</td><td>{fmtDate(r.date)}</td>
          <td>{r.payerName}<Sample on={r.sample} />{r.imported && <div className="small muted">from the Receipt generator</div>}</td>
          <td><Pill k={{ received: 'ok', partial: 'warn', pending: 'info', refunded: 'bad' }[stOf(r)]}>{RSTATUS.find((x) => x[0] === stOf(r))[1]}</Pill></td>
          <td className="n">{money(r, r.totals?.total || 0)}</td><td className="n">{money(r, r.totals?.received || 0)}</td><td className="n">{stl ? <Pill k="ok">settled</Pill> : o ? money(r, o) : '—'}</td><td>{r.mode}</td><td>{r.imported ? '—' : uname(r.createdBy)}</td></tr>; })}</tbody></table></div>
      : <Empty>{all.length ? 'No receipt matches.' : 'No receipts yet. “+ Receipt” makes one, or “Record payment” on a payment to collect.'}</Empty>}
  </div>;
}

function ReceiptEditor({ id }) {
  const nav = useNavigate(), [sp] = useSearchParams(), saved = id ? get(id) : null, b = settings().business, settled = settledBy(list('receipt'));
  const [r, setR] = useState(() => {
    if (saved) return { ...saved, paid: saved.totals ? r2(saved.totals.total - saved.totals.balance) : '' };
    const fresh = { date: today(), status: 'received', currency: 'INR', taxMode: 'intra', taxRate: 18, mode: 'UPI', reference: '', against: '', forText: '', description: '', payerEmail: '', payerContact: '', paid: '',
      intro: b.receiptIntro || 'Thank you for your payment. We have received your payment successfully.', terms: b.receiptTerms || '', bank: b.receiptBank || b.bank || '' };
    const s = get(sp.get('settles')), c0 = get(sp.get('copy'));
    if (s) return { ...fresh, settlesId: s.id, paymentId: s.paymentId || '', clientId: s.clientId || '', payerName: s.payerName, payerPhone: s.payerPhone || '', payerAddress: s.payerAddress || '', payerGstin: s.payerGstin || '', payerEmail: s.payerEmail || '', payerContact: s.payerContact || '',
      taxMode: s.taxMode, taxRate: s.taxRate, currency: s.currency || 'INR', items: [{ desc: `Balance against receipt ${s.number}`, note: '', amount: owing(s, settled), incl: true }] };
    if (c0) { const c = { ...c0 }; ['id', 'type', 'number', 'seq', 'fy', 'totals', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample', 'settlesId', 'settlesNo', 'imported', 'printed', 'notes', 'preparedBy', 'receivedBy', 'balance', 'status', 'reference', 'paymentId'].forEach((k) => delete c[k]); return { ...fresh, ...c, date: today(), status: 'received', paid: '' }; }
    const p = get(sp.get('payment')), cl = p && get(p.clientId), d = p && get(p.dealId), bal = p ? Math.max(0, (+p.amount || 0) - (+p.paid || 0)) : 0;
    return { ...fresh, paymentId: p?.id || '', clientId: p?.clientId || '', dealId: p?.dealId || '', payerName: cl?.name || d?.contactName || '', payerPhone: cl?.phone || d?.phone || '', payerAddress: cl?.address || '', payerGstin: cl?.gstin || '',
      items: [{ desc: p ? p.title + (d ? ' – ' + d.title : '') : '', note: '', amount: bal || '', incl: true }], against: d?.quoteNo || '' };
  });
  if (id && !saved) return <Empty>Receipt not found. <Link to="/payments">Back</Link></Empty>;
  const edit = canEdit('money') && !saved?.imported, usd = r.currency === 'USD', taxed = !usd && r.taxMode !== 'none', rate = +r.taxRate || 0;
  const whole = receiptTotals({ ...r, balance: 0 }).total, t = receiptTotals({ ...r, balance: r.paid === '' || r.paid == null ? 0 : Math.max(0, whole - (+r.paid || 0)) });
  const up = (k) => (v) => setR({ ...r, [k]: v?.target ? v.target.value : v });
  // Typing the amount paid moves the status with it: less than the total is a part payment, the full total is received.
  const paidTo = (v) => { const bal = v === '' ? 0 : Math.max(0, whole - (+v || 0)); setR({ ...r, paid: v, status: bal > 0 && r.status === 'received' ? 'partial' : !bal && r.status === 'partial' ? 'received' : r.status }); };
  const item = (i, patch) => setR({ ...r, items: r.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i, by) => { const xs = [...r.items], j = i + by; if (j < 0 || j >= xs.length) return; [xs[i], xs[j]] = [xs[j], xs[i]]; setR({ ...r, items: xs }); };
  const allIncl = taxed && r.items.length > 0 && r.items.every((x) => x.incl);
  const round = (on) => setR({ ...r, items: r.items.map((x) => ({ ...x, incl: on, amount: on ? grossOf(x, rate, taxed) : netOf(x, rate, taxed) })) });
  const left = saved ? owing(saved, settled) : 0, cur = (n) => (usd ? usdFmt(n) : inr(n));
  async function save() {
    const data = { ...r, items: r.items.map((x) => ({ ...x, amount: +x.amount || 0 })), paid: r.paid === '' || r.paid == null ? '' : +r.paid };
    ['id', 'type', 'number', 'seq', 'fy', 'totals', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample', 'balance', 'settlesNo', 'imported', 'printed'].forEach((k) => delete data[k]);
    const res = saved ? await attempt(() => update(id, data), 'Saved.') : await attempt(() => create('receipt', data));
    if (!res) return; const rec = saved ? res : res.record; setR({ ...rec, paid: r2(rec.totals.total - rec.totals.balance) });
    if (!saved) { toast(`Receipt ${rec.number} saved. ${r.paymentId ? 'The payment balance was updated.' : ''}`); nav('/payments/receipt/' + rec.id, { replace: true }); }
  }
  return <>
    <div className="topbar no-print"><h1>{saved ? saved.number : r.settlesId ? 'Balance receipt' : 'New receipt'} <ViewOnly when={!canEdit('money')} /></h1><div className="row"><Link className="btn" to="/payments">Payments</Link>
      {saved && <button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button>}
      {saved && canEdit('money') && <Link className="btn" to={'/payments/receipt/new?copy=' + saved.id}>Duplicate</Link>}
      {saved && canEdit('money') && left > 0 && <Link className="btn" to={'/payments/receipt/new?settles=' + saved.id}>Record balance ({cur(left)})</Link>}
      {edit && <button className="btn primary" type="button" onClick={save}>{saved ? 'Save changes' : 'Save & get number'}</button>}</div></div>
    {saved?.imported && <div className="banner info no-print" style={{ marginBottom: 12 }}>Copied from the Receipt generator on {fmtDate(saved.imported.at.slice(0, 10))}. It is kept exactly as it was printed, so it cannot be changed; if it is wrong, delete it with a reason and make a new one.</div>}
    {r.settlesId && !saved && <div className="banner info no-print" style={{ marginBottom: 12 }}>This receipt brings in the balance of receipt {get(r.settlesId)?.number}. It prints “Against Receipt No. …”, and the register then shows the earlier one as settled.</div>}
    <div className="grid2 no-print" style={{ gridTemplateColumns: 'minmax(300px,1fr) minmax(0,1.4fr)', alignItems: 'start' }}>
      <RO when={!edit}><div className="stack"><div className="card form">
        <Field label="Payment date" hint={saved ? 'The date is part of the number, so it cannot change.' : 'It becomes part of the number (ACY-DDMMYY/…).'}><In type="date" value={r.date} onChange={up('date')} disabled={!!saved} /></Field>
        <Field label="Status"><Sel value={r.status || 'received'} onChange={up('status')} options={RSTATUS} /></Field>
        <Field label="Client"><Pick value={r.clientId} onChange={(v) => { const c = get(v); setR({ ...r, clientId: v, payerName: c?.name || r.payerName, payerPhone: c?.phone || r.payerPhone, payerAddress: c?.address || r.payerAddress, payerGstin: c?.gstin || r.payerGstin }); }} options={list('client').map((c) => [c.id, c.name, c.city])} blank="Choose…" /></Field>
        {!r.settlesId && <Field label="Payment it settles"><Pick value={r.paymentId} onChange={up('paymentId')} options={list('payment').filter((p) => p.status !== 'paid' || p.id === r.paymentId).map((p) => [p.id, p.title, clientName(p.clientId)])} blank="None" disabled={!!saved} /></Field>}
        <Field label="Received from *"><In value={r.payerName || ''} onChange={up('payerName')} /></Field><Field label="Contact person"><In value={r.payerContact || ''} onChange={up('payerContact')} /></Field>
        <Field label="Phone"><In value={r.payerPhone || ''} onChange={up('payerPhone')} /></Field><Field label="Email"><In type="email" value={r.payerEmail || ''} onChange={up('payerEmail')} /></Field>
        <Field label="GSTIN"><In value={r.payerGstin || ''} onChange={(e) => setR({ ...r, payerGstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>
        <Field label="Address" full><Area value={r.payerAddress || ''} onChange={up('payerAddress')} /></Field>
      </div>
        <div className="card stack"><div className="row between"><h3 style={{ margin: 0 }}>What was paid for</h3>
          {taxed && <label className="check"><input type="checkbox" checked={allIncl} onChange={(e) => round(e.target.checked)} /> Client pays one round figure</label>}</div>
          {r.items.map((it, i) => <div key={i} className="rline">
            <div className="row"><b className="small muted">Line {i + 1}</b><span className="grow" />
              <button className="btn ghost sm" type="button" aria-label="Move up" title="Move up" disabled={!i} onClick={() => move(i, -1)}>↑</button>
              <button className="btn ghost sm" type="button" aria-label="Move down" title="Move down" disabled={i === r.items.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="btn ghost sm" type="button" aria-label="Remove line" title="Remove line" disabled={r.items.length === 1} onClick={() => setR({ ...r, items: r.items.filter((_, j) => j !== i) })}>✕</button></div>
            <Field label="What for" full><In value={it.desc} onChange={(e) => item(i, { desc: e.target.value })} /></Field>
            <Field label="Small note under it" full><In value={it.note || ''} onChange={(e) => item(i, { note: e.target.value })} placeholder="optional" /></Field>
            {taxed ? <div className="form two-amt">
              <Field label="Amount before GST" hint={it.incl ? 'worked out' : 'drives this line'}><In type="number" className={'in' + (it.incl ? ' live' : '')} value={it.incl ? netOf(it, rate, taxed) : it.amount} onChange={(e) => item(i, { amount: e.target.value, incl: false })} /></Field>
              <Field label="Amount after GST" hint={!it.incl ? 'worked out' : 'drives this line'}><In type="number" className={'in' + (!it.incl ? ' live' : '')} value={!it.incl ? grossOf(it, rate, taxed) : it.amount} onChange={(e) => item(i, { amount: e.target.value, incl: true })} /></Field></div>
              : <Field label={`Amount (${usd ? '$' : '₹'})`}><In type="number" value={it.amount} onChange={(e) => item(i, { amount: e.target.value, incl: false })} /></Field>}
          </div>)}
          <button className="btn sm" type="button" onClick={() => setR({ ...r, items: [...r.items, { desc: '', note: '', amount: '', incl: allIncl }] })}>+ Line</button>
          {taxed && r.items.some((x) => x.incl) && <div className="small muted">The client pays {cur(t.total)} and nothing is added to it. Of that, {cur(t.subtotal)} is earned and {cur(t.tax)} is GST payable to the government. (Shown only here, never on the receipt.)</div>}</div>
        <div className="card form">
          <Field label="Currency"><Sel value={r.currency || 'INR'} onChange={up('currency')} options={[['INR', '₹ Indian rupees'], ['USD', '$ US dollars (no GST)']]} /></Field>
          {!usd && <><Field label="GST"><Sel value={r.taxMode} onChange={up('taxMode')} options={[['intra', 'CGST + SGST (within the state)'], ['inter', 'IGST (another state)'], ['none', 'No GST (exempt only)']]} /></Field><Field label="Rate %"><In type="number" value={r.taxRate} onChange={up('taxRate')} /></Field></>}
          <Field label="Amount paid" hint={t.balance > 0 ? `Balance still due: ${cur(t.balance)}` : 'Leave it empty when the full amount was paid.'}><In type="number" value={r.paid ?? ''} placeholder={String(whole || '')} onChange={(e) => paidTo(e.target.value)} /></Field>
          <Field label="Payment method"><Sel value={r.mode} onChange={up('mode')} options={MODES.includes(r.mode) || !r.mode ? MODES : [r.mode, ...MODES]} /></Field>
          <Field label="UTR / transaction / cheque no."><In value={r.reference || ''} onChange={up('reference')} /></Field>
          <Field label="Payment for"><In value={r.forText || ''} onChange={up('forText')} placeholder="e.g. Advance for the website" /></Field><Field label="Against (quote / invoice no.)"><In value={r.against || ''} onChange={up('against')} /></Field>
          <Field label="Description" full><Area value={r.description || ''} onChange={up('description')} placeholder="optional" /></Field>
        </div>
        <div className="card form"><h3 style={{ gridColumn: '1 / -1', margin: 0 }}>Printed on the receipt</h3>
          <Field label="Opening line" full><In value={r.intro || ''} onChange={up('intro')} /></Field>
          <Field label="Payment / bank details" full hint="One per line – label : value"><Area value={r.bank || ''} onChange={up('bank')} /></Field>
          <Field label="Terms" full><Area value={r.terms || ''} onChange={up('terms')} /></Field></div>
        {saved && <div className="row"><Sample on={saved.sample} /><span className="grow" /><DeleteButton id={saved.id} needsReason after={() => nav('/payments')} /></div>}
      </div></RO>
      <FitSheet r={{ ...r, balance: t.balance, number: saved?.number, settlesNo: saved?.settlesNo || get(r.settlesId)?.number }} />
    </div>
    <style>{'@media print{.paper-wrap>div{transform:none!important;width:auto!important}.grid2.no-print{display:block!important}.grid2.no-print>.stack{display:none!important}.fit{display:none!important}}'}</style>
  </>;
}

// Copying the old Receipt generator (18 Oct 2026): what would happen, then copy, then a check list before the old app is deleted.
function ImportGenerator({ onClose }) {
  const [s, setS] = useState(null), [busy, setBusy] = useState(false), [rep, setRep] = useState(null);
  useEffect(() => { http('GET', '/imports/receipts').then(setS, (e) => setS({ error: e.message })); }, []);
  async function go() { setBusy(true); const r = await attempt(() => http('POST', '/imports/receipts')); setBusy(false); if (r) { setRep(r.report); await poll(); } }
  const p = s?.preview;
  return <Modal title="Import from the Receipt generator" wide onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Close</button>
    {p && !rep && <button className="btn primary" type="button" disabled={busy || !p.fresh} onClick={go}>{busy ? 'Copying…' : `Copy ${p.fresh} receipts`}</button>}</>}>
    {!s ? <p className="muted">Asking the Receipt generator…</p>
      : s.error ? <div className="banner bad">{s.error}</div>
      : !s.connected ? <div className="stack"><p style={{ margin: 0 }}>Aali One is not connected to the Receipt generator yet.</p>
        <p className="small muted" style={{ margin: 0 }}>In Coolify, add two environment variables to the Aali One app, then restart it: <b>RECEIPTS_SUPABASE_URL</b> (the generator's Supabase address, https://….supabase.co) and <b>RECEIPTS_SUPABASE_KEY</b> (its publishable key). Aali One only reads from it.</p></div>
      : rep ? <div className="stack">
        <div className="banner ok">{rep.copied} receipts copied{rep.copied ? ` (${rep.first} … ${rep.last})` : ''}. {rep.skipped.length} skipped. {rep.linked} balance receipts linked. Counters raised for {rep.counters} days.{rep.letterhead.length ? ` Letterhead: ${rep.letterhead.join(' and ')} copied.` : ''}</div>
        <p style={{ margin: 0 }}>The untouched copy of everything in the generator: <a href={'/api/files/' + rep.backup.id} download={rep.backup.name}>{rep.backup.name}</a>. Keep it.</p>
        {rep.skipped.length > 0 && <details><summary>Skipped ({rep.skipped.length})</summary><ul className="small">{rep.skipped.slice(0, 200).map((x, i) => <li key={i}>{x.number}: {x.why}</li>)}</ul></details>}
        <h3 style={{ margin: '8px 0 0' }}>Before you delete the old Receipt generator</h3>
        <ol className="small" style={{ margin: 0 }}><li>The receipts count in the generator = copied + skipped above.</li><li>The last receipt numbers in Receipts here match the generator.</li>
          <li>Make one test receipt here dated today: its number must be the next one, never one already used. Delete it with a reason after.</li>
          <li>Download and keep the backup file above.</li><li>Then delete only the generator's own Vercel project and its own Supabase project, and remove the two RECEIPTS_SUPABASE_ variables from Coolify.</li></ol></div>
      : <div className="stack">
        <div className="stats"><div className="stat"><span className="l">In the generator</span><span className="v">{p.total}</span></div><div className="stat"><span className="l">New to copy</span><span className="v">{p.fresh}</span></div>
          <div className="stat"><span className="l">Already here</span><span className="v">{p.already}</span></div><div className="stat"><span className="l">Deleted there</span><span className="v">{p.deleted}</span><span className="small muted">copied as deleted</span></div></div>
        <p className="small muted" style={{ margin: 0 }}>From {p.first ? fmtDate(p.first) : '—'} to {p.last ? fmtDate(p.last) : '—'}. Each receipt keeps its own number and printed figures and cannot be changed here. Numbers already in Aali One are skipped, so this can be run again safely. A full copy of the generator's data is saved first.</p>
        {p.clash?.length > 0 && <div className="banner">{p.clash.length} receipt number{p.clash.length === 1 ? '' : 's'} in the generator {p.clash.length === 1 ? 'is' : 'are'} already used by a different receipt made in Aali One: {p.clash.slice(0, 12).join(', ')}{p.clash.length > 12 ? '…' : ''}. {p.clash.length === 1 ? 'It' : 'They'} will not be copied (kept in the backup file) – check {p.clash.length === 1 ? 'it' : 'them'} with your CA.</div>}
        {p.lastNumbers?.length > 0 && <p className="small" style={{ margin: 0 }}>Last numbers: {p.lastNumbers.map((x) => x.number).join(', ')}</p>}</div>}
  </Modal>;
}

// The receipt preview with a one-page meter: how much of the A4 page the receipt fills; red when it would spill onto a second page.
const MM = 96 / 25.4;
function FitSheet({ r }) {
  const box = useRef(null), [used, setUsed] = useState(0);
  useLayoutEffect(() => {
    const el = box.current?.querySelector('.paper'); if (!el) return;
    const measure = () => { const rc = el.getBoundingClientRect(), scale = rc.width / (210 * MM); if (!scale || !el.children.length) return;
      const bottom = Math.max(...[...el.children].map((k) => k.getBoundingClientRect().bottom)) - rc.top;
      setUsed(Math.round(100 * (bottom / scale + 14 * MM) / (297 * MM))); };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, [r]);
  return <div className="stack gap4 sheet-col"><div className={'fit' + (used > 100 ? ' over' : '')} role="status"><span>{used > 100 ? `Too long for one page – ${used}% of the page. Shorten the lines or the terms.` : `Fits one page – ${used}% used`}</span><i style={{ width: Math.min(100, used) + '%' }} /></div>
    <div className="paper-wrap" ref={box}><div style={{ transform: 'scale(.72)', transformOrigin: 'top left', width: '139%' }}><ReceiptSheet r={r} /></div></div></div>;
}
