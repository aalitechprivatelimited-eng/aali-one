// Bills: an employee paid for something for work – petrol for a client visit, a courier, a client lunch – and wants the money back.
// Everyone but management submits their own bills here: the form, a photo of the bill, and once, their UPI QR code. Management is
// told at once, approves the bill, pays it by scanning the QR code and marks it paid; the employee is told at each step (the user,
// 9 Oct 2026). The QR code cannot be changed while a bill waits to be paid (server/app.js); each bill keeps the QR it was sent with.
// Later: management uploads the payment screenshot.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore, store, list, create, update, http, upload, setMe } from '../api.js';
import { uname, fmtDate, fmtDT, desig, isTop, inr, inr2, today, user } from '../lib.js';
import { Seg, Pill, Empty, Field, In, Sel, Pick, Area, Modal, Log, Stat, DeleteButton, attempt } from '../ui.jsx';
import { BILL_KINDS, BILL_PAID_BY } from '../../shared/defaults.js';

const ST = { submitted: ['Waiting for approval', 'warn'], approved: ['Approved – to be paid', 'info'], paid: ['Paid', 'ok'], rejected: ['Rejected', 'bad'] };
const waiting = (b) => b.status === 'submitted' || b.status === 'approved';
const total = (bs) => bs.reduce((t, b) => t + (+b.amount || 0), 0);
const amt = (v) => (Number.isInteger(+v) ? inr(v) : inr2(v));
const blank = () => ({ date: today(), amount: '', kind: '', paidTo: '', purpose: '', paidBy: '', clientId: '', files: [] });

// A phone photo is often 4–8 MB: it is made smaller (longest side 1800 px, JPEG) before it is sent, so the 3 MB limit never stops a bill.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_000_000) return file;
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null); if (!img) return file;
  const k = Math.min(1, 1800 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}

export default function Bills() {
  useStore(); const me = store.me, boss = isTop(me), nav = useNavigate(), openId = useLocation().pathname.split('/')[2] || '';
  const [f, setF] = useState({ st: boss ? 'submitted' : '', q: '' }), [form, setForm] = useState(null);
  const all = list('bill').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')), q = f.q.trim().toLowerCase();
  const rows = all.filter((b) => (!f.st || b.status === f.st) && (!q || `${b.number} ${uname(b.owner)} ${b.paidTo} ${b.kind} ${b.purpose}`.toLowerCase().includes(q)));
  const by = (st) => all.filter((b) => b.status === st), month = today().slice(0, 7), paidNow = by('paid').filter((b) => (b.paid?.at || '').slice(0, 7) === month);
  const cur = openId && all.find((b) => b.id === openId);
  return <>
    <div className="topbar"><h1>Bills <small>{boss ? 'from the team, to approve and pay back' : 'money you spent for work, paid back to you'}</small></h1>
      {!boss && <button className="btn primary" type="button" onClick={() => setForm(blank())}>+ Submit a bill</button>}</div>
    {!boss && <MyQr />}
    <div className="stats">
      <Stat label="Waiting for approval" value={by('submitted').length} sub={amt(total(by('submitted')))} tone={boss && by('submitted').length ? 'warm' : ''} />
      <Stat label="Approved – to be paid" value={by('approved').length} sub={amt(total(by('approved')))} tone={boss && by('approved').length ? 'warm' : ''} />
      <Stat label="Paid this month" value={paidNow.length} sub={amt(total(paidNow))} />
      <Stat label="Rejected" value={by('rejected').length} />
    </div>
    <div className="row" style={{ marginBottom: 12 }}>
      <In placeholder={boss ? 'Search person, shop or bill no.' : 'Search shop or bill no.'} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ maxWidth: 280 }} />
      <Seg value={f.st} onChange={(v) => setF({ ...f, st: v })} options={[['', 'All'], ['submitted', 'To approve'], ['approved', 'To pay'], ['paid', 'Paid'], ['rejected', 'Rejected']]} /></div>
    {rows.length ? <div className="tbl cards"><table><thead><tr><th>Bill</th>{boss && <th>Person</th>}<th>Date</th><th>Type</th><th>Paid to</th><th className="n">Amount</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
      {rows.map((b) => { const [l, k] = ST[b.status] || ST.submitted; return <tr key={b.id} className="click" onClick={() => nav('/bills/' + b.id)}>
        <td className="num"><b>{b.number}</b></td>{boss && <td><b>{uname(b.owner)}</b><div className="small muted">{desig(user(b.owner))}</div></td>}
        <td className="num">{fmtDate(b.date)}</td><td>{b.kind}</td><td>{b.paidTo}</td><td className="n">{amt(b.amount)}</td><td><Pill k={k}>{l}</Pill></td><td className="num small">{fmtDT(b.createdAt)}</td></tr>; })}
    </tbody></table></div>
      : <Empty>{all.length ? 'No bills here.' : boss ? 'No bills have been submitted yet. You are told the moment one comes in.' : 'No bills yet. When you pay for something for work, press “+ Submit a bill”.'}</Empty>}
    {form && <BillForm init={form} onClose={() => setForm(null)} />}
    {cur && <Detail b={cur} me={me} onClose={() => nav('/bills')} change={() => { nav('/bills'); setForm({ ...cur, clientId: cur.clientId || '' }); }} />}
  </>;
}

// The form (the full one the user chose): date, amount, type, shop, what it was for, how it was paid, the client, and the photo.
function BillForm({ init, onClose }) {
  const me = store.me, [b, setB] = useState(init), [busy, setBusy] = useState(false), clients = list('client').filter((c) => c.name);
  const up = (k) => (v) => setB({ ...b, [k]: v?.target ? v.target.value : v });
  const ready = b.date && +b.amount > 0 && b.kind && b.paidTo.trim() && b.purpose.trim() && b.paidBy && b.files.length && me.upiQr;
  async function save() {
    setBusy(true); const c = clients.find((x) => x.id === b.clientId);
    const data = { date: b.date, amount: b.amount, kind: b.kind, paidTo: b.paidTo, purpose: b.purpose, paidBy: b.paidBy, clientId: b.clientId || '', clientName: c ? c.name : '', files: b.files };
    const ok = await attempt(() => (init.id ? update(init.id, data) : create('bill', data)), init.id ? 'Bill changed. Management is told.' : 'Bill submitted. Management is told.');
    setBusy(false); if (ok) onClose();
  }
  return <Modal wide title={init.id ? `Change bill ${init.number}` : 'Submit a bill'} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button>
    <button className="btn primary" type="button" disabled={busy || !ready} onClick={save}>{busy ? 'Sending…' : init.id ? 'Save changes' : 'Submit the bill'}</button></>}>
    {!me.upiQr && <MyQr inForm />}
    <div className="form">
      <Field label="Date on the bill *"><In type="date" value={b.date} max={today()} onChange={up('date')} /></Field>
      <Field label="Amount (₹) *"><In type="number" inputMode="decimal" min="1" step="0.01" value={b.amount} onChange={up('amount')} placeholder="450" /></Field>
      <Field label="Type of expense *"><Sel value={b.kind} onChange={up('kind')} options={BILL_KINDS} blank="Choose…" /></Field>
      <Field label="Shop / paid to *"><In value={b.paidTo} maxLength={120} onChange={up('paidTo')} placeholder="e.g. Indian Oil, Brodipet" /></Field>
      <Field label="What it was for *" full><Area value={b.purpose} maxLength={500} onChange={up('purpose')} placeholder="e.g. Petrol for the client visit to Sri Sai Traders" /></Field>
      <Field label="How you paid *" full><Seg value={b.paidBy} onChange={up('paidBy')} options={BILL_PAID_BY.map((x) => [x, x])} /></Field>
      <Field label="Client (if it was for a client)" full><Pick value={b.clientId} onChange={up('clientId')} options={clients.map((c) => [c.id, c.name, c.city])} blank="Not for a client" /></Field>
      <Field label="Photo of the bill *" full hint="Take a photo with your phone, or choose a picture or PDF. You can add more than one."><BillPhotos value={b.files} onChange={(files) => setB({ ...b, files })} /></Field>
    </div>
  </Modal>;
}

// The bill's photos: small pictures that open full size. Big phone photos are made smaller before they are sent.
function BillPhotos({ value, onChange, readOnly }) {
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return; setBusy(true); const got = [];
    for (const file of fs) { const r = await attempt(async () => { const x = await upload(await shrink(file)); return { id: x.id, name: x.name, size: x.size, mime: x.mime, at: new Date().toISOString(), by: store.me.id }; }); if (r) got.push(r); }
    setBusy(false); if (got.length) onChange([...value, ...got]);
  }
  return <div className="stack gap4">
    {value.length > 0 && <div className="billpics">{value.map((f) => <div key={f.id} className="billpic">
      <a href={'/api/files/' + f.id} target="_blank" rel="noreferrer" title="Open full size">{/^image\//.test(f.mime) ? <img src={'/api/files/' + f.id} alt={`Bill: ${f.name}`} loading="lazy" /> : <span className="billpdf">PDF<small>{f.name}</small></span>}</a>
      {!readOnly && <button className="btn ghost sm" type="button" onClick={() => onChange(value.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`}>Remove</button>}</div>)}</div>}
    {!readOnly && <label className="btn sm filebtn">{busy ? 'Uploading…' : value.length ? '+ Add another photo' : '+ Add photo of the bill'}<input type="file" accept="image/*,application/pdf" multiple hidden disabled={busy} onChange={pick} /></label>}
  </div>;
}

// The person's UPI QR code: added once, shown to management on each bill. It cannot be changed while a bill waits to be paid.
function MyQr({ inForm }) {
  const me = store.me, [busy, setBusy] = useState(false), open = list('bill').filter((b) => b.owner === me.id && waiting(b)).length;
  async function pick(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return; setBusy(true);
    await attempt(async () => { if (!/^image\//.test(file.type)) throw new Error('Choose a picture of your UPI QR code (JPG or PNG).');
      const up = await upload(await shrink(file)); setMe((await http('PATCH', '/users/' + me.id, { upiQr: up.id })).user); }, 'UPI QR code saved. Management scans it to pay your bills.');
    setBusy(false);
  }
  return <div className={(inForm ? 'banner warn' : 'card') + ' row qrcard'} style={{ marginBottom: 12 }}>
    {me.upiQr && <a href={'/api/files/' + me.upiQr} target="_blank" rel="noreferrer" title="Open full size"><img className="qr-thumb" src={'/api/files/' + me.upiQr} alt="My UPI QR code" /></a>}
    <div className="grow stack gap4" style={{ minWidth: 0 }}><b>My UPI QR code{me.upiQr ? '' : ' – needed before your first bill'}</b>
      <span className="small muted">{me.upiQr ? 'Management scans this to pay your bills back.' : 'Add the QR code from your UPI app (Google Pay, PhonePe, Paytm…) once. Management scans it to pay your bills back.'}</span>
      {me.upiQr && open > 0 ? <span className="small">You have {open} bill{open === 1 ? '' : 's'} waiting to be paid, so the QR code can be changed only after {open === 1 ? 'it is' : 'they are'} paid.</span>
        : <div><label className={'btn sm filebtn' + (me.upiQr ? '' : ' primary')}>{busy ? 'Saving…' : me.upiQr ? 'Change QR code' : 'Add my UPI QR code'}<input type="file" accept="image/*" hidden disabled={busy} onChange={pick} /></label></div>}</div>
  </div>;
}

function Detail({ b, me, onClose, change }) {
  const boss = isTop(me), mine = b.owner === me.id, [l, k] = ST[b.status] || ST.submitted, [why, setWhy] = useState(''), [rej, setRej] = useState(false);
  const act = (data, ok) => attempt(() => update(b.id, data), ok).then((done) => done && setRej(false));
  const facts = [['Date on the bill', fmtDate(b.date)], ['Amount', amt(b.amount)], ['Type of expense', b.kind], ['Shop / paid to', b.paidTo], ['What it was for', b.purpose], ['How they paid', b.paidBy],
    ...(b.clientName ? [['Client', b.clientName]] : []), ['Submitted', fmtDT(b.createdAt)],
    ...(b.approved ? [['Approved', `${fmtDT(b.approved.at)} by ${uname(b.approved.by)}`]] : []), ...(b.paid ? [['Paid', `${fmtDT(b.paid.at)} by ${uname(b.paid.by)}`]] : [])];
  return <Modal wide title={`Bill ${b.number} · ${amt(b.amount)}`} onClose={onClose} footer={<><span className="row">
      {mine && b.status === 'submitted' && <><button className="btn" type="button" onClick={change}>Change</button><DeleteButton id={b.id} after={onClose} /></>}
      {boss && b.status === 'submitted' && <button className="btn primary" type="button" onClick={() => act({ status: 'approved' }, `Approved. ${uname(b.owner)} is told.`)}>Approve</button>}
      {boss && b.status === 'approved' && <button className="btn primary" type="button" onClick={() => act({ status: 'paid' }, `Marked paid. ${uname(b.owner)} is told.`)}>Mark paid</button>}
      {boss && waiting(b) && !rej && <button className="btn" type="button" onClick={() => setRej(true)}>Reject…</button>}</span>
    <button className="btn" type="button" onClick={onClose}>Close</button></>}>
    <div className="stack">
      <div className="row"><Pill k={k}>{l}</Pill><span className="small muted">{uname(b.owner)} · {desig(user(b.owner))}</span></div>
      {b.status === 'rejected' && b.rejected && <div className="banner bad"><b>Rejected</b> by {uname(b.rejected.by)} on {fmtDT(b.rejected.at)}: {b.rejected.reason}</div>}
      {rej && <div className="card stack gap4"><span className="lbl">Why is this bill rejected? {uname(b.owner)} reads this.</span>
        <Area value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. The photo is not clear – submit it again" autoFocus />
        <div className="row"><button className="btn danger" type="button" disabled={why.trim().length < 5} onClick={() => act({ status: 'rejected', _reason: why }, `Rejected. ${uname(b.owner)} is told.`)}>Reject the bill</button>
          <button className="btn ghost" type="button" onClick={() => setRej(false)}>Cancel</button></div></div>}
      <div className="billwrap">
        <dl className="billfacts">{facts.map(([t, v]) => <div key={t}><dt>{t}</dt><dd>{v}</dd></div>)}</dl>
        {boss && b.qr && <div className="billqr"><span className="lbl">{b.status === 'paid' ? 'Paid to this UPI QR code' : 'Pay to this UPI QR code'}</span>
          <a href={'/api/files/' + b.qr} target="_blank" rel="noreferrer" title="Open full size"><img src={'/api/files/' + b.qr} alt={`UPI QR code of ${uname(b.owner)}`} /></a>
          <span className="small muted">Scan it with your UPI app and pay {amt(b.amount)}, then press “Mark paid”.</span></div>}
      </div>
      <div><span className="lbl">Photo of the bill</span><BillPhotos value={b.files || []} readOnly /></div>
      <div><span className="lbl">History</span><Log items={b.log} /></div>
    </div></Modal>;
}
