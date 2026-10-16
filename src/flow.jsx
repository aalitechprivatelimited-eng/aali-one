// The steps of an agreement or a quotation after a manager makes it (the user, 16 Oct 2026): submitted and given to a BDE → the client
// asks for changes → a manager changes it (a new version the BDE sees at once, with what changed) → the BDE reconfirms with the client →
// an agreement: the advance is collected, a manager confirms it and the receipt is made → the client signs on the phone, or on paper
// and the BDE uploads the photo → locked. The BDE only takes these steps; the server checks every one (server/logic.js docFlow).
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { store, update } from './api.js';
import { uname, fmtDate, fmtDT, inr, today, bdes, canMoney } from './lib.js';
import { Field, In, Sel, Area, Modal, Seg, attempt, toast } from './ui.jsx';
import { BillPhotos } from './pages/Bills.jsx';
import { agreementTotal } from './doc.jsx';
import { PAY_MODES } from '../shared/defaults.js';

const totalOf = (type, d) => (type === 'quote' ? d.totals?.total || 0 : agreementTotal(d));

export function DocFlow({ doc, type, boss, onSaved }) {
  const [modal, setModal] = useState(''), [busy, setBusy] = useState(false), [to, setTo] = useState('');
  const word = type === 'quote' ? 'quotation' : 'agreement', me = store.me.id, bde = doc.assignedTo === me, ag = type === 'agreement';
  const signed = ag ? doc.status === 'signed' : !!doc.signed, ready = doc.status === 'sent' && !doc.reconfirm;
  const open = (doc.requests || []).filter((r) => !r.done), v = doc.version || 0, adv = doc.advance;
  async function step(f, done) {
    setBusy(true); const rec = await attempt(() => update(doc.id, { _flow: f }), done); setBusy(false);
    if (rec) { onSaved?.(rec); setModal(''); setTo(''); } return rec;
  }
  if (!doc.assignedTo && !boss && !signed) return null;
  const legacy = signed && !doc.signed; // signed before these steps existed
  return <section className="card stack docflow no-print" aria-label="Steps">
    <div className="row"><h3 style={{ margin: 0 }}>Steps</h3><span className="grow" />{v > 0 && <span className="small muted">Version {v}</span>}</div>
    <Track type={type} doc={doc} />

    {signed && !legacy && <Signed s={doc.signed} />}
    {legacy && <div className="small">Signed on {fmtDate(doc.signedOn)}{doc.contactName ? ` by ${doc.contactName}` : ''}.</div>}

    {!signed && boss && doc.status === 'needs approval' && <div className="banner">The discount waits for a manager's approval. It can be given to a BDE after that.</div>}
    {!signed && boss && ['draft', 'sent', 'changes'].includes(doc.status) && <div className="row">
      {doc.assignedTo && <span className="small">With <b>{uname(doc.assignedTo)}</b>{doc.sentOn ? ` since ${fmtDate(doc.sentOn)}` : ''}.</span>}
      <Sel value={to} onChange={setTo} options={bdes().filter((u) => u.id !== doc.assignedTo).map((u) => [u.id, u.name])} blank={doc.assignedTo ? 'Give to another BDE…' : 'Choose the BDE…'} style={{ width: 'auto', minWidth: 200 }} aria-label="BDE" />
      <button className={'btn' + (doc.assignedTo ? '' : ' primary')} type="button" disabled={busy || !to} onClick={() => step({ action: 'submit', to }, doc.assignedTo ? 'Given to the other BDE.' : 'Submitted. The BDE is told.')}>{doc.assignedTo ? 'Give' : 'Submit & give to the BDE'}</button></div>}
    {!signed && !boss && bde && doc.status === 'sent' && !doc.reconfirm && <div className="small">Take this {word} to the client. If they want anything changed, press “Client wants changes”.</div>}

    {open.map((r, i) => <div key={i} className="banner"><b>The client asked for changes</b> <span className="small">({uname(r.by)}, {fmtDT(r.at)}, version {r.v})</span><div style={{ whiteSpace: 'pre-wrap' }}>{r.note}</div>
      <div className="small">{boss ? `Change the ${word} above and save it. It becomes version ${v + 1} and ${uname(doc.assignedTo)} is told at once.` : 'Sent to the managers. You will be told as soon as it is changed.'}</div></div>)}

    {!signed && doc.reconfirm && <div className="banner info"><b>Changed to version {v}</b> <span className="small">by {uname(doc.versions?.at(-1)?.by)}, {fmtDT(doc.versions?.at(-1)?.at)}</span>
      <ul className="changes">{(doc.versions?.at(-1)?.changes || []).map((c, i) => <li key={i}>{c}</li>)}</ul>
      {bde || boss ? <div className="row"><button className="btn primary" type="button" disabled={busy} onClick={() => step({ action: 'reconfirmed' }, 'Noted: the client agrees.')}>Client agrees to version {v}</button>
        {bde && <button className="btn" type="button" disabled={busy} onClick={() => setModal('changes')}>Client wants more changes</button>}</div>
        : <div className="small">Waiting for {uname(doc.assignedTo)} to reconfirm it with the client.</div>}</div>}

    {!signed && bde && ready && <div className="row"><button className="btn" type="button" disabled={busy} onClick={() => setModal('changes')}>Client wants changes</button></div>}

    {ag && !signed && doc.assignedTo && <Advance doc={doc} adv={adv} boss={boss} may={(bde || boss) && ready} busy={busy} step={step} onReject={() => setModal('reject')} />}

    {!signed && (bde || boss) && doc.assignedTo && ready && (!ag || adv?.confirmed) && <div className="row">
      <button className="btn primary" type="button" disabled={busy} onClick={() => setModal('sign')}>Client signs…</button>
      <span className="small muted">On this phone, or on paper with a photo of the signed pages. After that it cannot change.</span></div>}

    {(doc.versions || []).length > 0 && <details><summary className="small muted">All versions ({doc.versions.length})</summary>
      <ol className="versions">{[...doc.versions].reverse().map((x) => <li key={x.v}><b>Version {x.v}</b> <span className="small muted">{uname(x.by)}, {fmtDT(x.at)}</span>
        <ul className="changes">{x.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></li>)}</ol></details>}

    {modal === 'changes' && <Ask title="What does the client want changed?" label="The client's changes" button="Send to the managers" hint="Write it the way the client said it, e.g. “Fees 40,000; delivery in 3 weeks; add the logo design”."
      busy={busy} onClose={() => setModal('')} onSend={(note) => step({ action: 'changes', note }, 'Sent. The managers are told.')} />}
    {modal === 'reject' && <Ask title="Advance not accepted" label="Why" button="Send back to the BDE" hint="For example: “The amount has not reached the bank.”"
      busy={busy} onClose={() => setModal('')} onSend={(note) => step({ action: 'rejectAdvance', note }, 'Sent back to the BDE.')} />}
    {modal === 'sign' && <SignModal doc={doc} type={type} busy={busy} onClose={() => setModal('')} onSign={(f) => step({ action: 'sign', ...f }, `Signed. The ${word} cannot be changed now.`)} />}
  </section>;
}

// Where it stands, as a short row of steps.
function Track({ type, doc }) {
  const ag = type === 'agreement', signed = ag ? doc.status === 'signed' : !!doc.signed;
  const steps = [['Made', true], [doc.assignedTo ? `With ${doc.assignedTo === store.me.id ? 'you' : uname(doc.assignedTo)}` : 'With the BDE', !!doc.assignedTo],
    [doc.status === 'changes' ? 'Changes asked' : doc.reconfirm ? 'Reconfirm' : 'Client agrees', !!doc.assignedTo && doc.status === 'sent' && !doc.reconfirm || signed],
    ...(ag ? [[doc.advance?.confirmed ? 'Advance received' : doc.advance ? 'Advance to confirm' : 'Advance', !!doc.advance?.confirmed]] : []), ['Signed', signed]];
  const now = steps.findIndex(([, ok]) => !ok);
  return <ol className="steprow">{steps.map(([t, ok], i) => <li key={i} className={ok ? 'done' : i === now ? 'here' : ''}>{t}</li>)}</ol>;
}

// The advance before an agreement is signed: the BDE (or a manager) records it; a manager confirms it and the receipt is made at once.
function Advance({ doc, adv, boss, may, busy, step, onReject }) {
  const first = (doc.schedule || [])[0], guess = first ? Math.round(agreementTotal(doc) * (+first.pct || 0) / 100) : '';
  const [f, setF] = useState({ amount: guess || '', mode: 'UPI', reference: '', date: today(), files: [] });
  if (adv?.confirmed) return <div className="banner ok"><b>Advance {inr(adv.amount)} received</b> ({adv.mode}{adv.reference ? ' · ' + adv.reference : ''}) – confirmed by {uname(adv.confirmed.by)}.
    {' '}Receipt {canMoney() ? <Link to={'/payments/receipt/' + adv.confirmed.receiptId}>{adv.confirmed.receiptNo}</Link> : adv.confirmed.receiptNo} is made (not sent to the client).</div>;
  if (adv) return <div className="banner"><b>Advance {inr(adv.amount)} collected</b> by {uname(adv.by)} on {fmtDate(adv.date)} – {adv.mode}{adv.reference ? ' · ' + adv.reference : ''}.
    {adv.files?.length > 0 && <div style={{ marginTop: 8 }}><BillPhotos value={adv.files} readOnly /></div>}
    {boss ? <div className="row" style={{ marginTop: 8 }}><button className="btn primary" type="button" disabled={busy} onClick={() => step({ action: 'confirmAdvance' }, 'Advance confirmed. The receipt is made.')}>Confirm – make the receipt</button>
      <button className="btn" type="button" disabled={busy} onClick={onReject}>Not received…</button></div>
      : <div className="small">Waiting for a manager to confirm it. Then the client can sign.</div>}</div>;
  if (!may) return <div className="small muted">The client pays the advance before signing{guess ? ` (${inr(guess)}, ${first.pct}% – ${first.text})` : ''}.</div>;
  const up = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  return <div className="card stack" style={{ background: 'var(--gold-50)' }}><b>Advance before signing</b>
    <div className="form"><Field label="Amount received (₹)" hint={guess ? `${first.pct}% of ${inr(agreementTotal(doc))}` : ''}><In type="number" min="0" value={f.amount} onChange={up('amount')} /></Field>
      <Field label="Paid by"><Sel value={f.mode} onChange={up('mode')} options={PAY_MODES} /></Field>
      <Field label="Date"><In type="date" value={f.date} max={today()} onChange={up('date')} /></Field>
      <Field label="UTR / cheque no." hint="Optional"><In value={f.reference} onChange={up('reference')} /></Field>
      <div className="field full"><label>Photo or screenshot of the payment{f.mode === 'Cash' ? ' (optional for cash)' : ' *'}</label><BillPhotos value={f.files} onChange={(files) => setF({ ...f, files })} label="photo of the payment" /></div></div>
    <div className="row"><button className="btn primary" type="button" disabled={busy || !(+f.amount > 0)} onClick={() => step({ action: 'advance', ...f, amount: +f.amount }, 'Saved. A manager confirms it next.')}>Advance collected</button></div></div>;
}

function Signed({ s }) {
  return <div className="banner ok stack gap4"><div><b>Signed by {s.name}</b>{s.role ? `, ${s.role}` : ''} on {fmtDate(s.date)} – version {s.v}, {s.how === 'paper' ? 'on paper' : 'on screen'} (collected by {uname(s.by)}). It cannot be changed now.</div>
    {s.signature && <img className="signed-sig" src={s.signature} alt={`Signature of ${s.name}`} />}
    {s.files?.length > 0 && <BillPhotos value={s.files} readOnly />}</div>;
}

function Ask({ title, label, hint, button, busy, onClose, onSend }) {
  const [t, setT] = useState('');
  return <Modal title={title} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button>
    <button className="btn primary" type="button" disabled={busy || t.trim().length < 3} onClick={() => onSend(t.trim())}>{button}</button></>}>
    <Field label={label} hint={hint}><Area autoFocus style={{ minHeight: 120 }} value={t} onChange={(e) => setT(e.target.value)} /></Field></Modal>;
}

// The client signs: on this screen (hand the phone over), or on paper – then the photo of every signed page is uploaded.
function SignModal({ doc, type, busy, onClose, onSign }) {
  const [how, setHow] = useState('screen'), [f, setF] = useState({ name: doc.contactName || '', role: doc.contactRole || '', agree: false, files: [] }), [ink, setInk] = useState(false), cv = useRef(null), pen = useRef(null);
  const word = type === 'quote' ? 'quotation' : 'agreement';
  // The pad is set up on the first touch, when the window has finished opening (its size is right then).
  function setup(c) {
    const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1; c.width = r.width * dpr; c.height = r.height * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr); x.fillStyle = '#fff'; x.fillRect(0, 0, r.width, r.height); x.strokeStyle = x.fillStyle = '#111'; x.lineWidth = 2.3; x.lineCap = x.lineJoin = 'round';
    pen.current = { x, last: null, draw: false };
  }
  const pt = (e) => { const b = cv.current.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const down = (e) => { e.preventDefault(); if (!pen.current) setup(cv.current); const p = pen.current; p.draw = true; p.last = pt(e); cv.current.setPointerCapture(e.pointerId); p.x.beginPath(); p.x.arc(p.last.x, p.last.y, 1.1, 0, 7); p.x.fill(); setInk(true); };
  const move = (e) => { const p = pen.current; if (!p?.draw) return; const q = pt(e); p.x.beginPath(); p.x.moveTo(p.last.x, p.last.y); p.x.lineTo(q.x, q.y); p.x.stroke(); p.last = q; };
  const up = () => { if (pen.current) pen.current.draw = false; };
  const clear = () => { pen.current = null; const c = cv.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setInk(false); };
  function save() {
    if (!f.name.trim()) return toast('Enter the name of the person who signs.', true);
    if (how === 'paper') return f.files.length ? onSign({ how, name: f.name, role: f.role, files: f.files }) : toast('Add the photo of every signed page.', true);
    if (!ink) return toast('Please sign in the box.', true); if (!f.agree) return toast('Please tick the box to agree.', true);
    const c = cv.current, r = c.getBoundingClientRect(), s = document.createElement('canvas'); s.width = r.width; s.height = r.height; s.getContext('2d').drawImage(c, 0, 0, r.width, r.height);
    onSign({ how, name: f.name, role: f.role, agree: true, signature: s.toDataURL('image/png') });
  }
  return <Modal title={`Client signs ${doc.number}`} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button>
    <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save – it is signed'}</button></>}>
    <div className="stack">
      <Seg value={how} onChange={setHow} options={[['screen', 'Sign on this phone'], ['paper', 'Signed on paper']]} />
      <div className="small">Version {doc.version || 1} · total {inr(totalOf(type, doc))}. After this the {word} cannot be changed.</div>
      <div className="form"><Field label="Name of the person signing *"><In value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" /></Field>
        <Field label="Designation"><In value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Owner, Partner, Director…" /></Field></div>
      {how === 'screen' ? <>
        <div className="banner info"><b>Please hand the phone to the client now.</b></div>
        <div className="field"><label>Sign here *</label><canvas ref={cv} className="sig" aria-label="Signature pad: sign with your finger, stylus or mouse" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          <div><button className="btn ghost sm" type="button" onClick={clear}>Clear signature</button></div></div>
        <label className="check"><input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} /> I have read this {word} ({doc.number}, version {doc.version || 1}) and I agree to it.</label>
      </> : <div className="field"><label>Photo of every signed page *</label><BillPhotos value={f.files} onChange={(files) => setF({ ...f, files })} label="photo of a signed page" /></div>}
    </div></Modal>;
}
