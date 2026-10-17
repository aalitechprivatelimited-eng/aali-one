// Uploading an old document (the user, 17 Oct 2026): a service agreement, closure agreement, quotation or tax invoice made before Aali One.
// The server reads it – the Word file or a PDF saved from Word, exactly (no OCR: the old ones are uploaded once, from the computer) – and picks out the details.
// Everything it found is shown here to be checked and corrected next to the text it read; nothing is saved until "Save".
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { create, http, upload } from './api.js';
import { settings, inr, today } from './lib.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import { docTotals } from '../shared/money.js';
import { Modal, Field, In, Sel, Area, Seg, attempt, toast } from './ui.jsx';

const KIND = { service: 'Service agreement', closure: 'Closure agreement', quote: 'Quotation', invoice: 'Tax invoice' };
const HOW = { word: 'read from the Word file', text: 'read from the PDF' };
const agreementCo = () => { const s = { ...DEFAULT_SETTINGS.agreements, ...(settings().agreements || {}) }; return { co: { name: s.name, unit: s.unit, about: s.about, office: s.office, parent: s.parent }, coSigner: s.signName, coRole: s.signRole }; };

export function ImportOld({ kinds, onClose }) {
  const nav = useNavigate(), [kind, setKind] = useState(kinds[0]), [busy, setBusy] = useState(''), [got, setGot] = useState(null), [f, setF] = useState(null);
  async function read(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    setBusy('Uploading…'); const up = await attempt(() => upload(file)); if (!up) return setBusy('');
    setBusy('Reading…');
    const r = await attempt(() => http('POST', '/imports/read', { kind, fileId: up.id })); setBusy(''); if (!r) return;
    setGot({ ...r, file: up }); setF({ ...r.fields, date: r.fields.date || '' });
  }
  async function save() {
    const x = { ...f }, imp = { fileId: got.file.id, how: got.how };
    let type = 'agreement', data;
    if (kind === 'quote') { type = 'quote'; data = { clientName: x.clientName, contactName: x.contactName || '', subject: x.subject, date: x.date, validUntil: x.validUntil || x.date, items: x.items, taxMode: x.taxMode, taxRate: +x.taxRate || 0, discountType: 'none', discountValue: 0, roundOff: true, oldNumber: x.oldNumber }; }
    else if (kind === 'invoice') { type = 'invoice'; data = { kind: x.kind, clientName: x.clientName, gstin: x.gstin, placeOfSupply: x.placeOfSupply, date: x.date, dueDate: x.date, items: x.items, taxMode: x.taxMode, taxRate: +x.taxRate || 0, discountType: 'none', discountValue: 0, roundOff: true, oldNumber: x.oldNumber }; }
    else data = { kind, ...agreementCo(), ...x, clauses: '', signedOn: x.date };
    if (!String(data.clientName || '').trim()) return toast('Enter the client name.', true);
    if (!/^\d{4}-\d\d-\d\d$/.test(data.date || '')) return toast('Enter the date on the document.', true);
    setBusy('Saving…'); const r = await attempt(() => create(type, { ...data, _import: imp })); setBusy(''); if (!r) return;
    toast(`Saved as ${r.record.number}. The uploaded file is kept with it.`); onClose();
    nav(type === 'agreement' ? '/agreements/' + r.record.id : type === 'quote' ? '/quotes/' + r.record.id : '/payments/invoice/' + r.record.id);
  }
  const up = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v }), missing = (k) => (got && !got.found.includes(k) ? ' (not found – fill in)' : '');
  return <Modal wide title={got ? `Check the details – ${KIND[kind]}` : 'Upload an old document'} onClose={onClose} footer={got ? <><span className="small muted grow">{got.file.name} – {HOW[got.how] || got.how}</span>
    <button className="btn" type="button" disabled={!!busy} onClick={() => { setGot(null); setF(null); }}>Another file</button><button className="btn primary" type="button" disabled={!!busy} onClick={save}>{busy || 'Save'}</button></> : null}>
    {!got ? <div className="stack">
      {kinds.length > 1 && <Seg value={kind} onChange={setKind} options={kinds.map((k) => [k, KIND[k]])} />}
      <p className="small muted" style={{ margin: 0 }}>Upload the Word file (.docx), or a PDF saved from Word – not a scan or a photo. You check every detail before it is saved{kind === 'invoice' ? '; the invoice keeps the number printed on it' : kind === 'quote' ? ', and it is saved as accepted (signed on paper)' : ', and it is saved as signed, with the file as the signed copy'}.</p>
      <label className={'btn primary filebtn' + (busy ? ' disabled' : '')} style={{ alignSelf: 'flex-start' }}>{busy || `Choose the ${KIND[kind].toLowerCase()} file`}
        <input type="file" hidden disabled={!!busy} accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" onChange={read} /></label>
    </div> : <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', alignItems: 'start' }}>
      <div className="stack">
        <div className="form">
          <Field label={`Number on the document${missing('oldNumber')}`} hint={kind === 'invoice' ? 'Required: a tax invoice keeps its own number' : 'Leave empty if it had none – the next number is given'}><In value={f.oldNumber || ''} onChange={up('oldNumber')} /></Field>
          <Field label={`Date${missing('date')}`}><In type="date" value={f.date || ''} max={today()} onChange={up('date')} /></Field>
          <Field label={`Client${missing('clientName')}`} full><In value={f.clientName || ''} onChange={up('clientName')} /></Field>
          {kind !== 'quote' && kind !== 'invoice' && <Field label={`Address${missing('address')}`} full><Area value={f.address || ''} onChange={up('address')} /></Field>}
          {kind === 'invoice' && <><Field label="Kind of invoice"><Seg value={f.kind || 'b2c'} onChange={up('kind')} options={[['b2b', 'B2B (client has GSTIN)'], ['b2c', 'B2C']]} /></Field>
            {f.kind === 'b2b' && <Field label={`Client's GSTIN${missing('gstin')}`}><In value={f.gstin || ''} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field>}
            <Field label={`Place of supply${missing('placeOfSupply')}`}><In value={f.placeOfSupply || ''} onChange={up('placeOfSupply')} placeholder="Andhra Pradesh" /></Field></>}
          {kind === 'quote' && <Field label={`Subject${missing('subject')}`} full><In value={f.subject || ''} onChange={up('subject')} /></Field>}
          {(kind === 'service' || kind === 'closure') && <><Field label={`Service (short name)${missing('title')}`} full><In value={f.title || ''} onChange={up('title')} /></Field>
            <Field label={`The client engaged us for…${missing('purpose')}`} full><Area value={f.purpose || ''} onChange={up('purpose')} /></Field>
            <Field label={`Signed for the client by${missing('contactName')}`}><In value={f.contactName || ''} onChange={up('contactName')} /></Field><Field label="Their designation"><In value={f.contactRole || ''} onChange={up('contactRole')} /></Field></>}
          {kind === 'closure' && <><Field label={`Service agreement dated${missing('serviceDate')}`}><In type="date" value={f.serviceDate || ''} onChange={up('serviceDate')} /></Field>
            <Field label={`Delivered / live on${missing('delivered')}`}><In type="date" value={f.delivered || ''} onChange={up('delivered')} /></Field>
            <Field label={`Total fees (₹)${missing('value')}`}><In type="number" value={f.value || ''} onChange={up('value')} /></Field><Field label={`Received (₹)${missing('received')}`}><In type="number" value={f.received || ''} onChange={up('received')} /></Field></>}
        </div>
        {kind === 'service' && <Rows title="Fees" rows={f.lines || []} set={(lines) => setF({ ...f, lines })} cols={[['text', 'What', 3], ['amount', '₹', 1, 'number']]} blank={{ text: '', amount: 0 }} />}
        {kind === 'service' && <div className="form"><Field label="GST"><Sel value={f.gst || 'extra'} onChange={up('gst')} options={[['extra', 'Plus GST'], ['included', 'GST included'], ['none', 'No GST']]} /></Field>
          <Field label="GST rate %"><In type="number" value={f.gstRate ?? 18} onChange={up('gstRate')} /></Field></div>}
        {kind === 'service' && <Rows title="Payment schedule" rows={f.schedule || []} set={(schedule) => setF({ ...f, schedule })} cols={[['pct', '%', 1, 'number'], ['text', 'When', 3]]} blank={{ pct: 0, text: '' }} />}
        {(kind === 'quote' || kind === 'invoice') && <><Rows title="Lines" rows={f.items || []} set={(items) => setF({ ...f, items })} cols={[['desc', 'Description', 3], ['qty', 'Qty', 1, 'number'], ['rate', 'Rate ₹', 1, 'number']]} blank={{ desc: '', qty: 1, unit: 'Nos', rate: 0, sac: '998314' }} />
          <div className="form"><Field label="GST"><Sel value={f.taxMode} onChange={up('taxMode')} options={[['intra', 'CGST + SGST'], ['inter', 'IGST'], ['none', 'No GST']]} /></Field><Field label="GST rate %"><In type="number" value={f.taxRate ?? 18} onChange={up('taxRate')} /></Field></div></>}
        <Check kind={kind} f={f} />
      </div>
      <div className="stack"><b className="small">What was read from the document</b>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 480, overflow: 'auto', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 10, padding: 10, margin: 0 }}>{got.text || '(no text could be read)'}</pre>
        <a className="small" href={'/api/files/' + got.file.id} target="_blank" rel="noreferrer">Open the uploaded file</a></div>
    </div>}
  </Modal>;
}

// Editable rows (fees, schedule, quotation lines).
function Rows({ title, rows, set, cols, blank }) {
  const put = (i, k, v) => set(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return <div className="stack gap4"><b className="small">{title}</b>
    {rows.map((r, i) => <div key={i} className="row" style={{ gap: 6 }}>{cols.map(([k, label, w, type]) => <In key={k} type={type || 'text'} value={r[k] ?? ''} aria-label={label} placeholder={label}
      onChange={(e) => put(i, k, type === 'number' ? +e.target.value : e.target.value)} style={{ flex: `${w} 1 ${w * 60}px`, minWidth: 0 }} />)}
      <button className="btn ghost sm" type="button" onClick={() => set(rows.filter((_, j) => j !== i))} aria-label="Remove this line">×</button></div>)}
    <div><button className="btn sm" type="button" onClick={() => set([...rows, { ...blank }])}>+ Add a line</button></div></div>;
}

// The total the document states against the total of the lines as read: a difference means a line was missed or misread.
function Check({ kind, f }) {
  if (kind === 'closure') return null;
  const doc = +f.total || 0, sub = kind === 'service' ? (f.lines || []).reduce((s, x) => s + (+x.amount || 0), 0) : 0;
  const mine = kind === 'service' ? sub + (f.gst === 'extra' ? Math.round(sub * (+f.gstRate || 0)) / 100 : 0) : docTotals({ ...f, discountType: 'none', roundOff: true }).total;
  if (!doc) return <div className="small muted">Total of the lines: <b>{inr(mine)}</b> (no total was found in the document to compare).</div>;
  return <div className={'banner' + (Math.abs(doc - mine) <= 1 ? ' ok' : '')}>Total in the document <b>{inr(doc)}</b> · total of the lines here <b>{inr(mine)}</b>{Math.abs(doc - mine) > 1 ? ' – they differ: check the lines and the GST.' : ' – they match.'}</div>;
}
