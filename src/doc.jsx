// Printed A4 documents: quotation, tax invoice, receipt, delivery certificate, service and closure agreements.
import { inWords, inr2, docTotals, receiptTotals } from '../shared/money.js';
import { settings, fmtDate, fmtDT, uname } from './lib.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import { monthLabel, grossOf } from '../shared/payroll.js';

function Head({ title, meta }) {
  const b = settings().business;
  return <>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div><div className="co">{b.name}</div><div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a6400' }}>{b.parentLine}</div>
        <div style={{ whiteSpace: 'pre-line', color: '#5e5236', fontSize: 11 }}>{b.address}{'\n'}{[b.phone, b.email, b.website].filter(Boolean).join('  ·  ')}{b.gstin ? `\nGSTIN ${b.gstin}` : ''}{b.pan ? `  ·  PAN ${b.pan}` : ''}</div></div>
      <div><div className="doct">{title}</div><table style={{ marginTop: 6 }}><tbody>{meta.filter((m) => m[1]).map(([k, v]) => <tr key={k}><td style={{ border: 'none', padding: '1px 6px', color: '#6b5c3c', textAlign: 'right' }}>{k}</td><td className="num" style={{ border: 'none', padding: '1px 0', textAlign: 'right' }}>{v}</td></tr>)}</tbody></table></div>
    </div><div className="rule" />
  </>;
}
function Party({ label, name, lines }) {
  return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a6400', fontWeight: 700 }}>{label}</div>
    <div style={{ fontFamily: 'var(--doc)', fontSize: 15, fontWeight: 600 }}>{name || '—'}</div><div style={{ whiteSpace: 'pre-line', color: '#5e5236', fontSize: 11.5 }}>{lines.filter(Boolean).join('\n')}</div></div>;
}
function TaxRows({ t, mode }) {
  return <>
    {mode === 'intra' && <><tr><td>CGST @ {t.rate / 2}%</td><td className="n">{inr2(t.cgst)}</td></tr><tr><td>SGST @ {t.rate / 2}%</td><td className="n">{inr2(t.sgst)}</td></tr></>}
    {mode === 'inter' && <tr><td>IGST @ {t.rate}%</td><td className="n">{inr2(t.igst)}</td></tr>}
  </>;
}
function Sign() { const b = settings().business; return <div style={{ textAlign: 'right', marginTop: 28 }}><div style={{ fontFamily: 'var(--doc)', fontWeight: 600 }}>For {b.name}</div><div style={{ marginTop: 36, borderTop: '1px solid #33280f', display: 'inline-block', minWidth: 200, paddingTop: 4, textAlign: 'center' }}>{b.signName || 'Authorised Signatory'}<div style={{ fontSize: 10.5, color: '#6b5c3c' }}>{b.signRole}</div></div></div>; }

export function QuoteSheet({ q, invoice }) {
  const t = docTotals(q), b = settings().business;
  // The Aali Conssultancy "a" behind a quotation (the user, 16 Oct 2026); a tax invoice has none.
  return <div className={'paper' + (invoice ? '' : ' wm')}>{!invoice && <img className="wm-img" src="/aali-mark.png" alt="" />}
    <Head title={invoice ? 'Tax Invoice' : 'Quotation'} meta={[[invoice ? 'Invoice No.' : 'Quote No.', q.number || 'Given on save'], ['Date', fmtDate(q.date)], [invoice ? 'Due' : 'Valid until', fmtDate(invoice ? q.dueDate : q.validUntil)], invoice && ['Against', q.quoteNo]].filter(Boolean)} />
    <div className="row between" style={{ alignItems: 'flex-start' }}><Party label={invoice ? 'Bill to' : 'Quotation for'} name={q.clientName} lines={[q.contactName && 'Attn: ' + q.contactName, q.address, [q.phone, q.email].filter(Boolean).join('  ·  '), q.gstin && 'GSTIN ' + q.gstin, invoice && q.placeOfSupply && 'Place of supply: ' + q.placeOfSupply]} />
      {q.subject && <Party label="Subject" name={q.subject} lines={[]} />}</div>
    <table><thead><tr><th style={{ width: 30 }}>#</th><th>Description</th>{invoice && <th>SAC</th>}<th className="n">Qty</th><th className="n">Rate</th><th className="n">Amount</th></tr></thead><tbody>
      {(q.items || []).map((it, i) => <tr key={i}><td>{i + 1}</td><td><b>{it.desc}</b>{it.note && <div style={{ color: '#6b5c3c', fontSize: 11 }}>{it.note}</div>}</td>{invoice && <td>{it.sac || '998314'}</td>}<td className="n">{it.qty} {it.unit}</td><td className="n">{inr2(it.rate)}</td><td className="n">{inr2((+it.qty || 0) * (+it.rate || 0))}</td></tr>)}
    </tbody></table>
    <div className="row between" style={{ alignItems: 'flex-start', marginTop: 10 }}>
      <div style={{ maxWidth: '55%' }}><div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a6400', fontWeight: 700 }}>Amount in words</div><div style={{ fontFamily: 'var(--doc)', fontWeight: 600 }}>{inWords(t.total)}</div>
        {q.showTds && <div style={{ fontSize: 11, marginTop: 6, color: '#6b5c3c' }}>TDS u/s 194J @ 2% ({inr2(t.taxable * 0.02)}) may be deducted; net payable {inr2(t.total - t.taxable * 0.02)}.</div>}</div>
      <table className="tot" style={{ width: '42%' }}><tbody>
        <tr><td>Subtotal</td><td className="n">{inr2(t.subtotal)}</td></tr>
        {t.discount > 0 && <><tr><td>Discount{q.discountType === 'percent' ? ` (${q.discountValue}%)` : ''}</td><td className="n">− {inr2(t.discount)}</td></tr><tr><td>Taxable value</td><td className="n">{inr2(t.taxable)}</td></tr></>}
        <TaxRows t={t} mode={q.taxMode} />{Math.abs(t.roundOff) >= 0.01 && <tr><td>Round off</td><td className="n">{inr2(t.roundOff)}</td></tr>}
        <tr className="grand"><td>Total</td><td className="n">{inr2(t.total)}</td></tr></tbody></table>
    </div>
    <div className="row between" style={{ alignItems: 'flex-start', marginTop: 14, borderTop: '1px solid #efe3c6', paddingTop: 10, gap: 24 }}>
      <div style={{ flex: 1.3, whiteSpace: 'pre-line', fontSize: 11 }}><b style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a6400' }}>Terms & conditions</b>{'\n'}{q.terms ?? b.quoteTerms}</div>
      <div style={{ flex: 1, whiteSpace: 'pre-line', fontSize: 11 }}><b style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a6400' }}>Payment details</b>{'\n'}{b.bank}<Sign /></div>
    </div>
    {invoice && <div style={{ fontSize: 10, color: '#6b5c3c', marginTop: 10 }}>This is a computer-generated invoice. Format to be confirmed by the company's CA before live use.</div>}
  </div>;
}

export function ReceiptSheet({ r }) {
  const t = receiptTotals(r), b = settings().business;
  // The Aali Conssultancy logo with its name behind a receipt (the user, 16 Oct 2026).
  return <div className="paper wm wm-receipt"><img className="wm-img" src="/receipt-mark.png" alt="" />
    <Head title="Payment Receipt" meta={[['Receipt No.', r.number || 'Given on save'], ['Date', fmtDate(r.date)], ['Status', r.balance > 0 ? 'Part paid' : 'Received']]} />
    <Party label="Received from" name={r.payerName} lines={[r.payerPhone, r.payerAddress, r.payerGstin && 'GSTIN ' + r.payerGstin]} />
    <p style={{ margin: '4px 0 10px' }}>{b.name === 'AALI CONSSULTANCY' ? 'Thank you for your payment. We have received your payment successfully.' : 'Received with thanks.'}</p>
    <table><thead><tr><th>#</th><th>Description</th><th className="n">Amount</th></tr></thead><tbody>
      {(r.items || []).map((it, i) => <tr key={i}><td>{i + 1}</td><td><b>{it.desc}</b>{it.incl && r.taxMode !== 'none' ? <div style={{ fontSize: 11, color: '#6b5c3c' }}>Round figure, GST included</div> : null}</td><td className="n">{inr2(it.amount)}</td></tr>)}
      <tr><td /><td>Taxable value</td><td className="n">{inr2(t.subtotal)}</td></tr><TaxRows t={t} mode={r.taxMode} />
      <tr className="grand"><td /><td>Total amount</td><td className="n">{inr2(t.total)}</td></tr>
      {t.balance > 0 && <><tr><td /><td>Received now</td><td className="n">{inr2(t.received)}</td></tr><tr><td /><td>Balance still due</td><td className="n">{inr2(t.balance)}</td></tr></>}
    </tbody></table>
    <div style={{ marginTop: 8 }}><b>Amount received in words:</b> {inWords(t.received)}</div>
    <table style={{ marginTop: 10, width: '60%' }}><tbody>{[['Payment method', r.mode], ['Transaction / UTR / cheque', r.reference], ['Against', r.against], ['For', r.forText]].filter((x) => x[1]).map(([k, v]) => <tr key={k}><td style={{ color: '#6b5c3c' }}>{k}</td><td>{v}</td></tr>)}</tbody></table>
    <div className="row between" style={{ alignItems: 'flex-start', marginTop: 14, gap: 24 }}>
      <div style={{ flex: 1, whiteSpace: 'pre-line', fontSize: 11 }}><b style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a6400' }}>Terms</b>{'\n'}{b.receiptTerms}</div>
      <div style={{ flex: 1, fontSize: 11 }}><Sign /></div></div>
  </div>;
}

export function CertificateSheet({ s, project }) {
  const b = settings().business;
  return <div className="paper" style={{ minHeight: 0 }}>
    <Head title="Delivery Acceptance" meta={[['Certificate', s.certNo], ['Signed', fmtDT(s.signedAt)]]} />
    <table><tbody>
      <tr><th style={{ width: '30%' }}>Project</th><td>{project?.name || s.project}</td></tr><tr><th>Client</th><td>{project?.clientName || s.client || '—'}</td></tr>
      <tr><th>What was delivered</th><td style={{ whiteSpace: 'pre-wrap' }}>{s.scope}</td></tr>{s.remarks && <tr><th>Client's remarks</th><td>{s.remarks}</td></tr>}
      <tr><th>Collected by</th><td>{uname(s.collectedBy)}, {b.name}</td></tr></tbody></table>
    <p style={{ padding: '10px 12px', background: '#fffcf3', borderLeft: '3px solid #b87400', margin: '12px 0' }}>I, <b>{s.signerName}</b>{s.signerRole ? `, ${s.signerRole}` : ''}, confirm that I have received the product / service described above.</p>
    <div className="row" style={{ alignItems: 'flex-end', gap: 24 }}>
      <div style={{ flex: 1 }}><img src={s.signature} alt={'Signature of ' + s.signerName} style={{ height: 110, maxWidth: '100%', objectFit: 'contain', borderBottom: '1px solid #33280f', display: 'block' }} />
        <div style={{ fontSize: 11, color: '#6b5c3c' }}>Signature · {s.signerName}{s.signerPhone ? ' · ' + s.signerPhone : ''}</div></div>
      {s.photo && <div><img src={s.photo} alt={'Photo of ' + s.signerName} style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 8 }} /><div style={{ fontSize: 11, color: '#6b5c3c' }}>Photo at signing, with consent</div></div>}
    </div>
    <div style={{ fontSize: 10.5, color: '#6b5c3c', marginTop: 14, borderTop: '1px solid #efe3c6', paddingTop: 8 }}>Signed electronically on {fmtDT(s.signedAt)} and recorded in Aali One. This is an acknowledgement of delivery, not a tax invoice.</div>
  </div>;
}

// Agreements: the Client Service Agreement and the Project Closure Agreement, laid out like the company's own Word template –
// Times New Roman, a navy title, a gold line naming both sides, numbered clauses, Annexures A and B, and the Aali mark faded
// behind every page.
const dmy = (s) => (/^\d{4}-\d\d-\d\d/.test(s || '') ? s.slice(0, 10).split('-').reverse().join('-') : '____________');
const rs = (v) => { const n = Math.round((+v || 0) * 100) / 100; return (n < 0 ? '– ₹' : '₹') + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (Number.isInteger(n) ? '/-' : ''); };
const blank = (v, n = 24) => (String(v || '').trim() || '_'.repeat(n));
export const agreementLines = (a) => (a.lines || []).filter((x) => String(x.text || '').trim() || +x.amount);
export const agreementSub = (a) => agreementLines(a).reduce((s, x) => s + (+x.amount || 0), 0);
export const agreementGst = (a) => (a.gst === 'extra' ? Math.round(agreementSub(a) * (+a.gstRate || 0)) / 100 : 0);
// What the client pays in all under a service agreement (one-time): the fee lines, with GST added when it is "plus GST".
export const agreementTotal = (a) => agreementSub(a) + agreementGst(a);
export const scheduleText = (a) => (a.schedule || []).filter((x) => x.text || +x.pct).map((x) => `${+x.pct || 0}% (${rs(agreementTotal(a) * (+x.pct || 0) / 100)}) — ${x.text}`).join('; ') + '.';
const taxText = (a) => (a.gst === 'extra' ? `All prices are exclusive of ${+a.gstRate || 0}% GST, chargeable additionally as per statutory norms.` : a.gst === 'included' ? `All prices are inclusive of GST${+a.gstRate ? ' at ' + (+a.gstRate) + '%' : ''}.` : 'No GST is charged on these Fees.');

// Clause text: "4. Fees and Payment Terms" is a heading, "4.1 …" a clause, "Note: …" a note under the clause above it.
function Clauses({ text }) {
  return String(text || '').split('\n').map((l, i) => { const t = l.trim(); if (!t) return null;
    return /^\d+\.\s/.test(t) ? <h4 key={i} className="ag-h">{t}</h4> : <p key={i} className={/^note\s*:/i.test(t) ? 'ag-note' : ''}>{t}</p>; });
}
// Scope text: a line starting with – or • is a point under the heading line above it.
function Points({ text }) {
  const groups = [];
  for (const l of String(text || '').split('\n')) { const t = l.trim(); if (!t) continue; const m = t.match(/^[-–•*]\s*(.+)$/);
    if (m) { const g = groups[groups.length - 1]; if (g) g.items.push(m[1]); else groups.push({ head: '', items: [m[1]] }); }
    else groups.push({ head: t, items: [] }); }
  // A line is a heading only when points follow it; a line on its own is plain text.
  return groups.map((g, i) => <div key={i} className="ag-grp">{g.head && <p className={g.items.length ? 'ag-gh' : ''}>{g.head}</p>}{g.items.length > 0 && <ul>{g.items.map((x, j) => <li key={j}>{x}</li>)}</ul>}</div>);
}
function Signs({ a, co, client, word }) {
  const box = (who, name, role) => <td><b>For {who}</b><div>Signature: ______________________</div><div>Name: {blank(name)}</div><div>Designation: {blank(role)}</div><div>Date: {a.signedOn ? dmy(a.signedOn) : '_______________'}</div></td>;
  return <><p>IN WITNESS WHEREOF, the Parties have executed this {word} as of the Effective Date.</p>
    <table className="ag-signs"><tbody><tr>{box(`${co.name}${co.unit ? ` (${co.unit})` : ''}`, a.coSigner, a.coRole)}{box(client, a.contactName, a.contactRole)}</tr></tbody></table></>;
}
export function AgreementSheet({ a }) {
  const co = { ...DEFAULT_SETTINGS.agreements, ...(a.co || {}) }, closure = a.kind === 'closure', client = blank(a.clientName, 20), word = closure ? 'Closure Agreement' : 'Agreement';
  const parties = <>
    <p><b>{co.name}</b>, {co.about}, having its registered office at {co.office} (hereinafter “Service Provider”, which expression shall include its successors and permitted assigns);</p>
    <p className="ag-and">AND</p>
    <p><b>{client}</b>, having its {a.seat || 'office'} at {blank(a.address, 30)} (hereinafter “Client”, which expression shall include its successors and permitted assigns).</p>
    <p>Service Provider and Client are individually a “Party” and collectively the “Parties”.</p></>;
  const kv = (rows) => <table className="ag-tbl ag-kv"><tbody>{rows.filter(Boolean).map(([k, v], i) => <tr key={i}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>;
  const value = +a.value || 0, got = +a.received || 0, bal = Math.max(0, value - got), excluded = String(a.excluded || '').split('\n').map((x) => x.replace(/^[-–•*]\s*/, '').trim()).filter(Boolean);
  return <div className="paper agree">
    <img className="ag-wm" src="/aali-mark.png" alt="" />
    {a.number && <div className="ag-no">Agreement No. {a.number}</div>}
    <div className="ag-title">{closure ? 'PROJECT CLOSURE AGREEMENT' : 'CLIENT SERVICE AGREEMENT'}</div>
    <div className="ag-sub">{client} × {co.name}{co.unit ? ` (${co.unit})` : ''}</div>
    <p>This {closure ? 'Project Closure Agreement (“Closure Agreement”)' : 'Client Service Agreement (“Agreement”)'} is made on {dmy(a.date)} between:</p>
    {parties}
    <h4 className="ag-rec">Recitals</h4>
    {closure ? <>
      <p>WHEREAS the Parties entered into a Client Service Agreement{a.serviceNo ? <> No. <b>{a.serviceNo}</b>{a.serviceDate ? ` dated ${dmy(a.serviceDate)}` : ''}</> : ''} (the “Service Agreement”) for {blank(a.purpose || a.project, 30)};</p>
      <p>AND WHEREAS the Service Provider has completed and delivered the Services and Deliverables described in Annexure A, and the Client has received them;</p>
      <p>NOW THEREFORE, the Parties record the completion, delivery, and closure of the project on the terms of this Closure Agreement.</p>
    </> : <>
      <p>WHEREAS the Client wishes to engage the Service Provider for {blank(a.purpose, 30)}, as more particularly described in Annexure A (Scope of Work);</p>
      <p>AND WHEREAS the Service Provider is {co.unit} (the “Parent Company”), and all payments due under this Agreement shall accordingly be made by the Client to the Parent Company, as set out in Clause 4;</p>
      <p>NOW THEREFORE, the Service Provider has agreed to provide such Services on the terms of this Agreement.</p>
    </>}
    <Clauses text={a.clauses} />
    <Signs a={a} co={co} client={client} word={word} />
    {closure ? <>
      <h3 className="ag-annex">Annexure A — Delivered Work and Handover</h3>
      {kv([['Project', a.project || '—'], a.serviceNo && ['Service Agreement', a.serviceNo + (a.serviceDate ? ` dated ${dmy(a.serviceDate)}` : '')], ['Work Started On', dmy(a.started)], ['Delivered On', dmy(a.delivered)],
        a.signoffNo && ['Delivery Acceptance', `${a.signoffNo}, signed by the Client`]])}
      <p className="ag-gh">Work Delivered</p><Points text={a.scope} />
      <p className="ag-gh">Handover</p>
      <table className="ag-tbl"><thead><tr><th>Item</th><th style={{ width: '18%' }}>Status</th><th style={{ width: '32%' }}>Note</th></tr></thead><tbody>
        {(a.handover || []).filter((x) => x.text).map((x, i) => <tr key={i}><td>{x.text}</td><td>{x.done ? 'Handed over' : 'Pending'}</td><td>{x.note}</td></tr>)}</tbody></table>
      <p className="ag-gh">Pending Items</p>{String(a.pending || '').trim() ? <Points text={a.pending} /> : <p>None. Nothing is pending from either Party.</p>}
      <h3 className="ag-annex">Annexure B — Payment Summary and Support</h3>
      <table className="ag-tbl"><thead><tr><th>Item</th><th style={{ width: '28%' }}>Amount</th></tr></thead><tbody>
        <tr><td>Total value of the work (including GST)</td><td>{rs(value)}</td></tr><tr><td>Received</td><td>{rs(got)}</td></tr>
        <tr className="ag-total"><td>Balance</td><td>{bal > 0 ? rs(bal) : 'Nil – fully paid'}</td></tr></tbody></table>
      {kv([bal > 0 && ['Balance Due By', a.balanceBy ? dmy(a.balanceBy) : 'As agreed'], ['Payable To', `All amounts are payable to ${co.parent} (Parent Company of the Service Provider), per bank/payment details on the invoice.`],
        ['Support', `Complimentary post-launch support until ${dmy(a.supportUntil)}.`], String(a.amc || '').trim() && ['AMC', a.amc]])}
    </> : <>
      <h3 className="ag-annex">Annexure A — Scope of Work</h3>
      <Points text={a.scope} />
      {excluded.length > 0 && <div className="ag-grp"><p className="ag-gh">Explicitly Excluded</p><ul>{excluded.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      <h3 className="ag-annex">Annexure B — Fees and Payment Schedule</h3>
      <table className="ag-tbl"><thead><tr><th>Item</th><th style={{ width: '28%' }}>Amount</th></tr></thead><tbody>
        {agreementLines(a).map((x, i) => <tr key={i}><td>{x.text}</td><td>{rs(x.amount)}</td></tr>)}
        {a.gst === 'extra' && <tr><td>GST @ {+a.gstRate || 0}%</td><td>{rs(agreementGst(a))}</td></tr>}
        <tr className="ag-total"><td>Total Payable (One-Time{a.gst === 'included' ? ', GST included' : ''})</td><td>{rs(agreementTotal(a))}</td></tr>
        {(a.recurring || []).filter((x) => x.text).map((x, i) => <tr key={'r' + i}><td>{x.text}</td><td>{x.amount}</td></tr>)}</tbody></table>
      {kv([['Payable To', `All amounts above are payable to ${co.parent} (Parent Company of the Service Provider), per bank/payment details on the invoice.`],
        (a.schedule || []).some((x) => x.text || +x.pct) && ['Payment Terms', scheduleText(a)], ...(a.annex || []).filter((x) => x.label && x.text).map((x) => [x.label, x.text]), ['Taxes', taxText(a)]])}
    </>}
  </div>;
}

// Payslip: one person's pay for one month (pages/Payroll.jsx), from the figures saved on the month's payroll.
export function PayslipSheet({ run, i }) {
  const b = settings().business, a = i.days.att, emp = run.pclientId ? run.employer || {} : null, co = ((emp && emp.name) || i.company || b.name || '').toUpperCase(), acct = i.bank?.account ? '•••• ' + String(i.bank.account).slice(-4) : '—';
  const ded = [['Provident Fund (PF)', i.ded.pf], ['ESI', i.ded.esi], ['Professional Tax', i.ded.pt], ['Income tax (TDS)', i.ded.tds], ...i.ded.fixed.map((x) => [x.name, x.amount]),
    ...i.ded.loans.map((x) => [x.kind === 'advance' ? 'Salary advance' : 'Loan repayment', x.amount]), ...(i.ded.extras || []).map((x) => [`${x.name}${x.note ? ` (${x.note})` : ''}`, x.amount]), [i.ded.otherWhy || 'Other deduction', i.ded.other]].filter((x) => +x[1]);
  const daily = i.payType === 'daily', wages = daily ? [[`Wages – ₹${i.rate} a day × ${i.days.payable} days`, '', i.earned.gross]]
    : [['Basic', i.full.basic, i.earned.basic], ['House rent allowance (HRA)', i.full.hra, i.earned.hra], ['Special allowance', i.full.special, i.earned.special]].filter(([k, f, e]) => k === 'Basic' || +f || +e); // HRA 0% is left out
  const earn = [...wages, ...(i.extra ? [[i.extraWhy || 'Extra pay', '', i.extra]] : []), ...(i.earnExtras || []).map((x) => [`${x.name}${x.note ? ` (${x.note})` : ''}`, '', x.amount])];
  return <div className="paper slip">
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div><div className="co">{co}</div>{!emp && <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a6400' }}>{co.includes('GROUP') ? '' : 'A unit of Aali Group'}</div>}
        <div style={{ color: '#5e5236', fontSize: 11 }}>{emp ? emp.address : b.address}</div>
        {emp && (emp.pfCode || emp.esiCode) && <div style={{ color: '#5e5236', fontSize: 10.5 }}>{[emp.pfCode && 'PF code ' + emp.pfCode, emp.esiCode && 'ESI code ' + emp.esiCode].filter(Boolean).join(' · ')}</div>}</div>
      <div style={{ textAlign: 'right' }}><div className="doct">Payslip</div><div style={{ fontFamily: 'var(--doc)', fontSize: 15, fontWeight: 600 }}>{monthLabel(run.month)}</div></div></div>
    <div className="rule" />
    <table className="slip-kv"><tbody>
      <tr><th>Name</th><td>{i.name}</td><th>Designation</th><td>{i.designation || '—'}</td></tr>
      <tr>{emp ? <><th>Employee code</th><td>{i.code || '—'}</td></> : <><th>Company</th><td>{i.company || '—'}</td></>}<th>Bank account</th><td>{acct}{i.bank?.ifsc ? ' · ' + i.bank.ifsc : ''}</td></tr>
      <tr><th>PAN</th><td>{i.pan || '—'}</td><th>UAN (PF)</th><td>{i.uan || '—'}</td></tr>
      <tr><th>{daily ? 'Daily wage' : run.rules?.dayBasis ? 'Days for a full month' : 'Days in the month'}</th><td>{daily ? `₹${i.rate}` : i.days.total}</td><th>Paid days</th><td><b>{i.days.payable}</b>{i.days.typed ? ' (entered by HR)' : ''}</td></tr>
      {a && <tr><th>Attendance</th><td colSpan={3}>Present {a.present}{a.half ? ` · half days ${a.half}` : ''}{a.double ? ` · double shifts ${a.double}` : ''} · paid leave {a.paidLeave} · unpaid leave {a.unpaidLeave} · absent {a.absent} · {emp ? 'weekly offs' : 'Sundays'} {a.sundays} · holidays {a.holidays}</td></tr>}
    </tbody></table>
    <div className="slip-two">
      <table><thead><tr><th>Earnings</th><th className="n">{daily ? '' : 'Full month'}</th><th className="n">This month</th></tr></thead><tbody>
        {earn.map(([k, f, e]) => <tr key={k}><td>{k}</td><td className="n">{f === '' ? '' : inr2(f)}</td><td className="n">{inr2(e)}</td></tr>)}
        <tr className="grand"><td>Total earnings</td><td className="n">{daily ? '' : inr2(i.full.gross)}</td><td className="n">{inr2(grossOf(i))}</td></tr></tbody></table>
      <table><thead><tr><th>Deductions</th><th className="n">Amount</th></tr></thead><tbody>
        {ded.length ? ded.map(([k, v]) => <tr key={k}><td>{k}</td><td className="n">{inr2(v)}</td></tr>) : <tr><td>None</td><td className="n">{inr2(0)}</td></tr>}
        <tr className="grand"><td>Total deductions</td><td className="n">{inr2(i.ded.total)}</td></tr></tbody></table>
    </div>
    <div className="slip-net"><div><div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a6400', fontWeight: 700 }}>Net pay</div>
      <div style={{ fontFamily: 'var(--doc)', fontWeight: 600 }}>{inWords(i.net)}</div></div><div className="slip-amt">{inr2(i.net)}</div></div>
    {(i.employer.pf || i.employer.esi) ? <div style={{ fontSize: 11, color: '#5e5236', marginTop: 8 }}>Paid by the {emp ? 'employer' : 'company'} on top of the salary (not part of take-home): PF {inr2(i.employer.pf)}{i.employer.esi ? ` · ESI ${inr2(i.employer.esi)}` : ''}.</div> : null}
    <div style={{ fontSize: 10.5, color: '#6b5c3c', marginTop: 14, borderTop: '1px solid #efe3c6', paddingTop: 8 }}>{run.paidOn ? `Paid on ${fmtDate(run.paidOn)}. ` : ''}{emp ? `This is a computer-generated payslip, prepared for ${emp.name || 'the employer'} by Aali Conssultancy, and needs no signature.` : 'This is a computer-generated payslip from Aali One and needs no signature.'}</div>
  </div>;
}
