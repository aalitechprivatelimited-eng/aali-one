// Calls and meetings (Zoho CRM "Activities"), shared by leads and deals.
import { useState } from 'react';
import { list, create, update, store } from './api.js';
import { fmtDT, today, uname } from './lib.js';
import { Field, In, Sel, Area, Pill, attempt, Person } from './ui.jsx';

export const OUTCOMES = ['Interested', 'Call back later', 'No answer', 'Busy', 'Wrong number', 'Not interested', 'Meeting fixed', 'Quotation requested'];

export function Activities({ leadId, dealId, clientId, subject }) {
  const [mode, setMode] = useState(''), [f, setF] = useState({});
  const items = list('activity').filter((a) => (leadId && a.leadId === leadId) || (dealId && a.dealId === dealId)).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const up = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  async function save() {
    const base = { leadId: leadId || '', dealId: dealId || '', clientId: clientId || '', owner: f.owner || store.me.id, subject: f.subject || subject || '' };
    const data = mode === 'call'
      ? { ...base, kind: 'call', status: 'done', at: new Date().toISOString(), outcome: f.outcome || 'Interested', duration: +f.duration || 0, notes: f.notes || '' }
      : { ...base, kind: mode, status: 'planned', at: `${f.date || today()}T${f.time || '11:00'}`, place: f.place || '', notes: f.notes || '' };
    if (await attempt(() => create('activity', data), mode === 'call' ? 'Call logged.' : 'Scheduled. It shows in Today and the calendar.')) { setMode(''); setF({}); }
  }
  return (
    <div className="stack">
      <div className="row"><button className="btn sm" type="button" onClick={() => setMode('call')}>Log a call</button>
        <button className="btn sm" type="button" onClick={() => setMode('meeting')}>Schedule meeting / demo</button>
        <button className="btn sm" type="button" onClick={() => setMode('plannedcall')}>Schedule a call</button></div>
      {mode && <div className="card form">
        {mode === 'call' ? <>
          <Field label="Outcome"><Sel value={f.outcome || 'Interested'} onChange={up('outcome')} options={OUTCOMES} /></Field>
          <Field label="Minutes"><In type="number" min="0" value={f.duration || ''} onChange={up('duration')} /></Field>
        </> : <>
          <Field label="Date"><In type="date" value={f.date || today()} onChange={up('date')} /></Field>
          <Field label="Time"><In type="time" value={f.time || '11:00'} onChange={up('time')} /></Field>
          {mode === 'meeting' && <Field label="Place / link"><In value={f.place || ''} onChange={up('place')} placeholder="Client office, or a meeting link" /></Field>}
          <Field label="With (staff)"><Person value={f.owner || store.me.id} onChange={up('owner')} /></Field>
        </>}
        <Field label="Notes" full><Area value={f.notes || ''} onChange={up('notes')} placeholder="What was discussed / what to do" /></Field>
        <div className="row full"><button className="btn primary" type="button" onClick={save}>Save</button><button className="btn" type="button" onClick={() => setMode('')}>Cancel</button></div>
      </div>}
      {items.length ? <div className="list">{items.map((a) => <div className="li" key={a.id}>
        <Pill k={a.kind === 'call' ? 'info' : 'gold'}>{a.kind === 'call' ? 'Call' : a.kind === 'meeting' ? 'Meeting' : 'Call (planned)'}</Pill>
        <div className="grow"><div className="t">{a.outcome || a.subject || 'Activity'}{a.duration ? <span className="small muted"> · {a.duration} min</span> : null}</div>
          <div className="small muted">{fmtDT(a.at)} · {uname(a.owner)}{a.place ? ' · ' + a.place : ''}</div>{a.notes && <div className="small">{a.notes}</div>}</div>
        {a.status !== 'done' ? <button className="btn sm" type="button" onClick={() => attempt(() => update(a.id, { status: 'done' }), 'Marked done.')}>Mark done</button> : <Pill k="ok">Done</Pill>}
      </div>)}</div> : <p className="small muted" style={{ margin: 0 }}>No calls or meetings yet.</p>}
    </div>
  );
}
