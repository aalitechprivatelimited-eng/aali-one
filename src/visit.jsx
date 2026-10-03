// Client visits: the app asks the BDE where they are, so the manager knows without having to phone them.
//  · A client visit starts – planned from the daily report, or "Client visit now" when a client asks to meet out of the blue
//    (only the client and the place are needed to start; the person met and their number are asked before it ends).
//  · 10 minutes later: "Have you reached the client?" (Not yet: asked again 10 minutes later).
//  · Reached → after 20 minutes: "Are you leaving the client now?" (Not yet: asked again 15 minutes later).
//  · Leaving → "How did the visit go?": outcome, remark, follow-up or next meeting – and "Where are you going now?":
//    back to the office (a trip that ends with "Are you back at the office?"), another client (the next visit starts at once),
//    lunch / break, or home. "Deal accepted" tells the Sales Manager at once (server/logic.js).
// The same steps are on the running task's card (Daily reports), so nobody has to wait for the question.
import { useEffect, useState } from 'react';
import { useStore, store, list, update, create } from './api.js';
import { Modal, Pick, attempt, toast } from './ui.jsx';
import { today, addDays, settings } from './lib.js';
import { Ico } from './icons.jsx';

export const OUTCOMES = ['Deal accepted', 'Next meeting fixed', 'Interested – follow up', 'Will think – call back', 'Not interested', 'Could not meet'];
const FOLLOW = ['Interested – follow up', 'Will think – call back'];
const WHERE = [['office', 'Back to the office'], ['client', 'Another client'], ['break', 'Lunch / break'], ['home', 'Home – my day is over']];
const MIN = 60000, FIRST = { reached: 10 * MIN, leaving: 20 * MIN, back: 15 * MIN }, AGAIN = { reached: 10 * MIN, leaving: 15 * MIN, back: 10 * MIN };
const hm = (s) => new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const later = (id, stage) => `aali-visit:${id}:${stage}`;
const readLater = (k) => { try { return +localStorage.getItem(k) || 0; } catch { return 0; } };
const askLater = (k, ms) => { try { localStorage.setItem(k, String(Date.now() + ms)); } catch {} };
const newId = () => Math.random().toString(36).slice(2, 10);
const mins = (from) => Math.max(1, Math.round((Date.now() - new Date(from)) / 60000));
// The kind of work a visit is written under: the sales team's own "visit" kind, as set in Settings.
const visitKind = () => (settings().workTypes?.sales || []).find((k) => /visit/i.test(k)) || 'Client visit';
const visitLine = (v, at) => ({ id: newId(), at, text: `Visit to ${v.client}`, kind: visitKind(), state: 'running', start: at, out: true, proj: v.client, visit: { client: v.client.trim(), person: v.person.trim(), phone: v.phone.trim(), place: v.place.trim() } });
const finishRunning = (entries, at) => entries.map((x) => (x.state === 'running' ? { ...x, state: 'done', end: at, mins: mins(x.start) } : x));

let openSet = null;
// Opens one of the questions now: 'reached', 'leaving', 'outcome', 'back' (to the office) or 'now' (a client visit starting now).
export const askVisit = (what) => openSet?.(what);
export const openVisitNow = () => openSet?.('now');
const myReport = () => { const me = store.me; return me && list('report').find((x) => x.owner === me.id && x.date === today()); };
// What is running in my report today: a client visit, or the trip back to the office.
export function runningVisit() {
  const r = myReport(), e = r && r.status !== 'submitted' && (r.entries || []).find((x) => x.state === 'running' && (x.visit || x.trip));
  return e ? { r, e } : null;
}
const setLine = (r, id, fn, ok) => attempt(() => update(r.id, { entries: r.entries.map((x) => (x.id === id ? fn(x) : x)) }), ok);

export function VisitPrompt() {
  useStore(); const [open, setOpen] = useState(null), [, tick] = useState(0); openSet = setOpen;
  useEffect(() => { const h = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(h); }, []);
  const cur = runningVisit(), e = cur?.e, v = e?.visit, stage = e?.trip ? 'back' : v?.reachedAt ? 'leaving' : 'reached', key = e && later(e.id, stage);
  const due = !!e && Date.now() >= Math.max(new Date(stage === 'leaving' ? v.reachedAt : e.start).getTime() + FIRST[stage], readLater(key));
  // Asked by itself when it is time and no other pop-up is open (otherwise at the next half-minute check); at once when a button is pressed.
  useEffect(() => { if (!open && due && !document.querySelector('.modal-bg')) setOpen(stage); });
  useEffect(() => { if (!cur && open && open !== 'now') setOpen(null); }, [!!cur]);
  if (open === 'now') return <StartVisit onClose={() => setOpen(null)} />;
  if (!cur || !open) return null;
  const { r } = cur, notYet = () => { askLater(key, AGAIN[stage]); setOpen(null); };
  if (open === 'outcome' && v) return <Outcome r={r} e={e} onClose={() => { askLater(later(e.id, 'leaving'), AGAIN.leaving); setOpen(null); }} />;
  if (open === 'back' && e.trip) return <Modal title="On the way back" onClose={notYet} footer={<><button className="btn" type="button" onClick={notYet}>Not yet</button>
    <button className="btn primary" type="button" onClick={async () => { const now = new Date().toISOString(); if (await setLine(r, e.id, (x) => ({ ...x, state: 'done', end: now, mins: mins(x.start), trip: { ...x.trip, reachedAt: now } }), 'Welcome back. Start your next task.')) setOpen(null); }}>Yes, I am back</button></>}>
    <div className="visit-q"><span className="visit-ic"><Ico k="door" size={22} /></span><div><b>Are you back at the office?</b><div className="small muted">Left the client at {hm(e.start)}</div></div></div>
  </Modal>;
  if (!v) return null;
  const reached = open === 'reached';
  return <Modal title="Client visit" onClose={notYet} footer={<><button className="btn" type="button" onClick={notYet}>Not yet</button>
    <button className="btn primary" type="button" onClick={async () => { if (reached) { const now = new Date().toISOString(); if (await setLine(r, e.id, (x) => ({ ...x, visit: { ...x.visit, reachedAt: now } }), `Noted: you reached ${v.client} at ${hm(now)}.`)) setOpen(null); } else setOpen('outcome'); }}>
      {reached ? 'Yes, I have reached' : 'Yes, I am leaving'}</button></>}>
    <div className="visit-q"><span className="visit-ic"><Ico k={reached ? 'check' : 'door'} size={22} /></span>
      <div><b>{reached ? `Have you reached ${v.client}?` : `Are you leaving ${v.client} now?`}</b>
        <div className="small muted">{[v.person, v.place].filter(Boolean).join(' · ')}{reached ? ` · left at ${hm(e.start)}` : ` · there since ${hm(v.reachedAt)}`}</div></div></div>
  </Modal>;
}

// Who to visit: chosen from my clients, leads and deals (it fills in the person, number and place), or typed in.
function VisitWho({ v, setV }) {
  const me = store.me.id, opts = [
    ...list('client').filter((c) => c.owner === me || !c.owner).map((c) => [`c:${c.id}`, c.name, [c.city, 'client'].filter(Boolean).join(' · ')]),
    ...list('lead').filter((l) => l.owner === me && !['converted', 'junk'].includes(l.status)).map((l) => [`l:${l.id}`, l.company || l.name, 'lead']),
    ...list('deal').filter((d) => d.owner === me && !['won', 'lost'].includes(d.stage)).map((d) => [`d:${d.id}`, d.title, 'deal'])];
  const fill = (key) => { if (!key) return setV({ ...v, pick: '' }); const [t, id] = key.split(':'), x = list(t === 'c' ? 'client' : t === 'l' ? 'lead' : 'deal').find((y) => y.id === id) || {};
    const c = x.contacts?.[0] || {};
    setV({ ...v, pick: key, client: x.name && t !== 'd' ? (t === 'l' ? x.company || x.name : x.name) : x.contactName || x.title || '', person: c.name || x.contactName || (t === 'l' ? x.name : '') || v.person, phone: c.phone || x.phone || x.mobile || v.phone, place: x.city || x.place || v.place }); };
  const up = (k) => (ev) => setV({ ...v, [k]: ev.target.value });
  return <div className="stack gap4">
    {opts.length > 0 && <Pick value={v.pick || ''} onChange={fill} blank="Choose from my clients, leads and deals" options={opts} />}
    <div className="row"><input className="in" style={{ flex: '2 1 200px' }} value={v.client} onChange={up('client')} placeholder="Client / business name *" maxLength={120} aria-label="Client or business name" />
      <input className="in" style={{ flex: '1 1 160px' }} value={v.place} onChange={up('place')} placeholder="Place / address *" maxLength={120} aria-label="Place or address" /></div>
    <div className="row"><input className="in" style={{ flex: '1 1 160px' }} value={v.person} onChange={up('person')} placeholder="Person you are meeting (can add later)" maxLength={80} aria-label="Person you are meeting" />
      <input className="in" style={{ flex: '1 1 130px' }} value={v.phone} onChange={up('phone')} placeholder="Their contact no. (can add later)" inputMode="tel" maxLength={40} aria-label="Their contact number" /></div>
  </div>;
}
const blankVisit = { pick: '', client: '', place: '', person: '', phone: '' };

// "Client visit now": a client asks to meet out of the blue. Whatever was running ends; the visit starts at once.
function StartVisit({ onClose }) {
  const [v, setV] = useState(blankVisit), [busy, setBusy] = useState(false), cur = runningVisit(), ok = v.client.trim() && v.place.trim();
  if (cur?.e.visit && !cur.e.visit.outcome) return <Modal title="Client visit now" onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Close</button>
    <button className="btn primary" type="button" onClick={() => askVisit('outcome')}>End the visit to {cur.e.visit.client}</button></>}>
    <p style={{ margin: 0 }}>You are on a visit to <b>{cur.e.visit.client}</b>. End it first – say how it went – and choose <b>Another client</b> as where you are going.</p></Modal>;
  async function start() {
    setBusy(true); const r = myReport(), at = new Date().toISOString(), line = visitLine(v, at);
    if (r?.status === 'submitted') { setBusy(false); return toast('Your day is already submitted. Ask your manager to send it back first.', true); }
    const done = await attempt(() => (r ? update(r.id, { entries: [...finishRunning(r.entries || [], at), line] }) : create('report', { date: today(), entries: [line] })), `Visit to ${v.client.trim()} started. You are shown as out of office.`);
    setBusy(false); if (done) onClose();
  }
  return <Modal title="Client visit now" onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button>
    <button className="btn primary" type="button" disabled={!ok || busy} onClick={start}>{busy ? 'Starting…' : 'Start the visit'}</button></>}>
    <div className="stack"><p className="small muted" style={{ margin: 0 }}>A client wants to meet now? Start the visit here. Whatever you were doing ends, and your manager sees you are out with a client.</p>
      <VisitWho v={v} setV={setV} /></div></Modal>;
}

// "How did the visit go?" – the outcome, a remark, the follow-up or next meeting, and where the person goes next. Saving ends the visit.
function Outcome({ r, e, onClose }) {
  const v = e.visit, [o, setO] = useState(''), [note, setNote] = useState(e.note || ''), [next, setNext] = useState(addDays(today(), 2)), [time, setTime] = useState('11:00');
  const [who, setWho] = useState({ person: v.person || '', phone: v.phone || '' }), [go, setGo] = useState(''), [nv, setNv] = useState(blankVisit), [busy, setBusy] = useState(false);
  const follow = FOLLOW.includes(o), meet = o === 'Next meeting fixed', met = o && o !== 'Could not meet';
  const missing = met && !(who.person.trim() && who.phone.trim());
  const ok = o && note.trim().length >= 5 && !missing && go && (go !== 'client' || (nv.client.trim() && nv.place.trim()));
  async function save() {
    setBusy(true); const now = new Date().toISOString();
    const ended = r.entries.map((x) => (x.id === e.id ? { ...x, state: 'done', end: now, mins: mins(x.start), note: note.trim(),
      visit: { ...x.visit, person: who.person.trim(), phone: who.phone.trim(), reachedAt: x.visit.reachedAt || '', leftAt: now, outcome: o, ...(follow || meet ? { next } : {}) } } : x));
    const then = go === 'office' ? [{ id: newId(), at: now, text: 'Travelling back to the office', kind: 'Travel', state: 'running', start: now, out: true, trip: { to: 'office', from: v.client } }]
      : go === 'client' ? [visitLine(nv, now)] : go === 'break' ? [{ id: newId(), at: now, text: 'Lunch / break', kind: 'Break', brk: true, state: 'running', start: now }] : [];
    const word = { office: 'Have a safe trip back.', client: `Visit to ${nv.client.trim()} started.`, break: 'Enjoy your break.', home: 'Remember to submit your day from “Finish my day”.' }[go];
    const done = await attempt(() => update(r.id, { entries: [...ended, ...then] }), `Visit saved.${o === 'Deal accepted' ? ' The Sales Manager has been told the deal was accepted.' : ''} ${word}`);
    if (done && follow) await attempt(() => create('task', { title: `Follow up with ${v.client} (${o.toLowerCase()})`, due: next, owner: store.me.id, status: 'todo' }), `A follow-up task is set for ${next}.`);
    if (done && meet) await attempt(() => create('activity', { kind: 'meeting', status: 'planned', at: `${next}T${time}`, subject: `Meeting with ${v.client}`, place: v.place, owner: store.me.id, notes: note.trim(), leadId: '', dealId: '', clientId: '' }), 'The next meeting is on your calendar.');
    setBusy(false); if (done) onClose();
  }
  const chips = (pairs, val, set) => pairs.map(([k, l]) => <button key={k} type="button" className={'chip' + (val === k ? ' on' : '')} aria-pressed={val === k} onClick={() => set(k)}>{l}</button>);
  return <Modal wide title={`How did the visit to ${v.client} go?`} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Later</button>
    <button className="btn primary" type="button" disabled={!ok || busy} title={ok ? '' : 'Choose the outcome, write a remark and say where you are going'} onClick={save}>{busy ? 'Saving…' : 'Save and end the visit'}</button></>}>
    <div className="stack">
      <span className="lbl">Outcome</span>
      <div className="row">{chips(OUTCOMES.map((x) => [x, x]), o, setO)}</div>
      {met && (!v.person || !v.phone) && <div className="row"><input className="in" style={{ flex: '1 1 160px' }} value={who.person} onChange={(ev) => setWho({ ...who, person: ev.target.value })} placeholder="Person you met *" maxLength={80} aria-label="Person you met" />
        <input className="in" style={{ flex: '1 1 130px' }} value={who.phone} onChange={(ev) => setWho({ ...who, phone: ev.target.value })} placeholder="Their contact no. *" inputMode="tel" maxLength={40} aria-label="Their contact number" /></div>}
      <label className="lbl" htmlFor="visit-note">Remark – what was discussed, what the client wants</label>
      <textarea id="visit-note" className="in" style={{ minHeight: 80 }} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={300}
        placeholder={o === 'Deal accepted' ? 'e.g. Agreed to the 5-page website at ₹25,000; advance on Monday' : 'e.g. Owner wants a quotation for a website and Google ads'} />
      {(follow || meet) && <div className="row"><span className="small" style={{ fontWeight: 600 }}>{meet ? 'Next meeting on' : 'Follow up on'}</span>
        {chips([[addDays(today(), 1), 'Tomorrow'], [addDays(today(), 2), 'In 2 days'], [addDays(today(), 7), 'Next week']], next, setNext)}
        <input className="in" type="date" style={{ width: 'auto' }} min={today()} value={next} onChange={(ev) => ev.target.value && setNext(ev.target.value)} aria-label={meet ? 'Next meeting on this date' : 'Follow up on this date'} />
        {meet && <input className="in" type="time" style={{ width: 'auto' }} value={time} onChange={(ev) => setTime(ev.target.value)} aria-label="Next meeting at this time" />}</div>}
      {o === 'Deal accepted' && <div className="banner ok">The Sales Manager is told straight away. Remember to mark the deal as won on the Deals page.</div>}
      <span className="lbl">Where are you going now?</span>
      <div className="row">{chips(WHERE, go, setGo)}</div>
      {go === 'client' && <VisitWho v={nv} setV={setNv} />}
      {go === 'office' && <span className="small muted">Your manager sees you are on the way back. The app asks when you reach the office.</span>}
    </div>
  </Modal>;
}
