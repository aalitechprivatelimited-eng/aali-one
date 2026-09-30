// Printed A4 documents: quotation, tax invoice, receipt, delivery certificate.
import { inWords, inr2, docTotals, receiptTotals } from '../shared/money.js';
import { settings, fmtDate, fmtDT, uname } from './lib.js';

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
  return <div className="paper">
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
  return <div className="paper">
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
