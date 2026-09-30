import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore, get, create } from '../api.js';
import { clientName } from '../lib.js';
import { Field, In, Area, Empty, attempt, toast } from '../ui.jsx';
import { CertificateSheet } from '../doc.jsx';

const shrink = (src, max, q) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
  c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q)); }; im.onerror = rej; im.src = src; });

export default function Signoff() {
  useStore(); const { projectId } = useParams(), p = get(projectId), deal = p && get(p.dealId);
  const [f, setF] = useState({ signerName: deal?.contactName || '', signerRole: clientName(p?.clientId) || '', signerPhone: deal?.phone || '', remarks: '', rating: 0, ratingComment: '', scope: p?.scope || '' });
  const [photo, setPhoto] = useState(''), [consent, setConsent] = useState(false), [ok, setOk] = useState(false), [ink, setInk] = useState(false), [cam, setCam] = useState(false), [done, setDone] = useState(null), [busy, setBusy] = useState(false);
  const cv = useRef(), vid = useRef(), stream = useRef(), fileRef = useRef();
  useEffect(() => {
    const c = cv.current; if (!c) return; const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1; c.width = r.width * dpr; c.height = r.height * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr); x.fillStyle = '#fff'; x.fillRect(0, 0, r.width, r.height); x.strokeStyle = x.fillStyle = '#111'; x.lineWidth = 2.3; x.lineCap = x.lineJoin = 'round';
    let draw = false, last = null; const pt = (e) => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const down = (e) => { e.preventDefault(); draw = true; last = pt(e); c.setPointerCapture(e.pointerId); x.beginPath(); x.arc(last.x, last.y, 1.1, 0, 7); x.fill(); setInk(true); };
    const move = (e) => { if (!draw) return; const q = pt(e); x.beginPath(); x.moveTo(last.x, last.y); x.lineTo(q.x, q.y); x.stroke(); last = q; };
    const up = () => (draw = false);
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); };
  }, [p?.id, done]);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  if (!p) return <Empty>Project not found. <Link to="/projects">Back</Link></Empty>;
  const existing = get(p.signoffId);
  if (done || existing) { const s = done || existing; return <><div className="topbar no-print"><h1>Signed – thank you</h1><div className="row"><Link className="btn" to={'/projects/' + p.id}>Back to project</Link><button className="btn primary" type="button" onClick={() => window.print()}>Print / Save PDF</button></div></div><div className="paper-wrap"><CertificateSheet s={s} project={p} /></div></>; }
  function clear() { const c = cv.current, x = c.getContext('2d'), r = c.getBoundingClientRect(); x.fillStyle = '#fff'; x.fillRect(0, 0, r.width, r.height); x.fillStyle = '#111'; setInk(false); }
  async function startCam() {
    try { stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }); setCam(true); setTimeout(() => { vid.current.srcObject = stream.current; vid.current.play(); }, 50); }
    catch { toast('Camera not available here. Choose a photo instead.', true); fileRef.current.click(); }
  }
  async function snap() { const v = vid.current, c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    setPhoto(await shrink(c.toDataURL('image/jpeg', 0.9), 640, 0.72)); stream.current.getTracks().forEach((t) => t.stop()); setCam(false); }
  async function submit() {
    if (!f.signerName.trim()) return toast('Please enter your name.', true); if (!ink) return toast('Please sign in the box.', true);
    if (!ok) return toast('Please tick the box to confirm you received the work.', true); if (photo && !consent) return toast('Tick the photo consent box, or remove the photo.', true);
    const c = cv.current, s = document.createElement('canvas'), r = c.getBoundingClientRect(); s.width = r.width; s.height = r.height; s.getContext('2d').drawImage(c, 0, 0, r.width, r.height);
    setBusy(true);
    const res = await attempt(() => create('signoff', { projectId: p.id, project: p.name, client: clientName(p.clientId), ...f, rating: +f.rating || 0, signature: s.toDataURL('image/png'), photo, photoConsent: !!photo && consent, confirmed: ok }));
    setBusy(false); if (res) { setDone(res.record); toast('Signed. The project is now Live.'); }
  }
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return <div className="stack" style={{ maxWidth: 760, margin: '0 auto' }}>
    <div className="topbar"><h1>Delivery sign-off <small>{p.name}</small></h1><Link className="btn" to={'/projects/' + p.id}>Cancel</Link></div>
    <div className="card stack"><Field label="What was delivered"><Area style={{ minHeight: 100 }} value={f.scope} onChange={up('scope')} /></Field>
      {(p.changes || []).some((c) => c.status === 'open') && <div className="banner">Some client changes are still open.</div>}</div>
    <div className="banner info"><b>Please hand the device to the client now.</b></div>
    <div className="card form">
      <Field label="Your full name *"><In value={f.signerName} onChange={up('signerName')} autoComplete="name" /></Field>
      <Field label="Designation / company"><In value={f.signerRole} onChange={up('signerRole')} /></Field>
      <Field label="Phone"><In type="tel" value={f.signerPhone} onChange={up('signerPhone')} /></Field>
      <Field label="Remarks (optional)"><In value={f.remarks} onChange={up('remarks')} /></Field>
      <div className="field full"><label>How happy are you with the work?</label><div className="stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={+f.rating === n} aria-label={n + ' stars'} className={n <= f.rating ? 'on' : ''} onClick={() => setF({ ...f, rating: n })}>★</button>)}</div>
        <In value={f.ratingComment} onChange={up('ratingComment')} placeholder="Any comment on our work (optional)" /></div>
      <div className="field full"><label>Sign here *</label><canvas ref={cv} className="sig" aria-label="Signature pad: sign with your finger, stylus or mouse" /><div><button className="btn ghost sm" type="button" onClick={clear}>Clear signature</button></div></div>
      <div className="field full"><label>Photo at the time of signing (optional)</label>
        {cam ? <div className="stack"><video ref={vid} playsInline muted style={{ width: '100%', maxWidth: 360, borderRadius: 10 }} /><div className="row"><button className="btn primary" type="button" onClick={snap}>Take photo</button><button className="btn" type="button" onClick={() => { stream.current?.getTracks().forEach((t) => t.stop()); setCam(false); }}>Cancel</button></div></div>
          : <div className="row">{photo && <img src={photo} alt="Photo of the client" style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 10 }} />}
            <button className="btn" type="button" onClick={startCam}>{photo ? 'Retake' : 'Open camera'}</button><button className="btn" type="button" onClick={() => fileRef.current.click()}>Choose photo</button>
            {photo && <button className="btn ghost" type="button" onClick={() => { setPhoto(''); setConsent(false); }}>Remove</button>}</div>}
        <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (!file) return; const fr = new FileReader(); fr.onload = async () => setPhoto(await shrink(fr.result, 640, 0.72)); fr.readAsDataURL(file); }} />
        {photo && <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree to this photo being kept by Aali Conssultancy as proof of delivery.</label>}</div>
      <label className="check full"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I confirm I have received the product / service described above.</label>
    </div>
    <button className="btn primary" type="button" disabled={busy} onClick={submit} style={{ alignSelf: 'flex-start', padding: '10px 22px' }}>{busy ? 'Saving…' : 'Sign & submit'}</button>
  </div>;
}
