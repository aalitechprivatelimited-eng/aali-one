import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useStore, list, get, create, update, store } from '../api.js';
import { uname, fmtDate, today, addDays, clientName, escalated } from '../lib.js';
import { Modal, Field, In, Sel, Area, Pill, Due, Empty, Sample, Log, Comments, Person, attempt, Seg } from '../ui.jsx';
import { Reason } from './Projects.jsx';

const ST = [['open', 'Open'], ['progress', 'In progress'], ['waiting', 'Waiting for client'], ['resolved', 'Resolved']];
export default function Support() {
  useStore(); const [sp] = useSearchParams(), [view, setView] = useState('open'), [open, setOpen] = useState(sp.get('client') ? { preset: { clientId: sp.get('client') } } : null);
  const rows = list('ticket').filter((t) => (view === 'open' ? t.status !== 'resolved' : view === 'mine' ? t.owner === store.me.id && t.status !== 'resolved' : t.status === 'resolved'))
    .sort((a, b) => (a.priority === 'urgent' ? -1 : 1) - (b.priority === 'urgent' ? -1 : 1) || (a.promised || '9').localeCompare(b.promised || '9'));
  const all = list('ticket'), late = all.filter((t) => t.status !== 'resolved' && t.promised && t.promised < today()).length;
  return <>
    <div className="topbar"><h1>Support requests</h1><button className="btn primary" type="button" onClick={() => setOpen({})}>+ Support request</button></div>
    <div className="stats"><div className="stat"><span className="l">Open</span><span className="v">{all.filter((t) => t.status !== 'resolved').length}</span></div>
      <div className={'stat' + (late ? ' hot' : '')}><span className="l">Past promised date</span><span className="v">{late}</span></div>
      <div className="stat"><span className="l">Resolved this month</span><span className="v">{all.filter((t) => (t.resolvedAt || '').startsWith(today().slice(0, 7))).length}</span></div></div>
    <div style={{ marginBottom: 12 }}><Seg value={view} onChange={setView} options={[['open', 'Open'], ['mine', 'Mine'], ['resolved', 'Resolved']]} /></div>
    {rows.length ? <div className="list">{rows.map((t) => <button type="button" key={t.id} className="li" style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid var(--line)', textAlign: 'left' }} onClick={() => setOpen({ id: t.id })}>
      <b className="num">{t.number}</b><div className="grow"><div className="t">{t.title}</div><div className="row small"><span>{clientName(t.clientId) || 'No client'}</span>{t.priority === 'urgent' && <Pill k="bad">Urgent</Pill>}
        <Pill>{ST.find((s) => s[0] === t.status)?.[1]}</Pill>{t.promised && t.status !== 'resolved' && <>Promised <Due date={t.promised} /></>}{t.promised && escalated(t.promised) && t.status !== 'resolved' && <Pill k="esc">Escalated</Pill>}<span className="muted">{uname(t.owner)}</span><Sample on={t.sample} /></div></div></button>)}</div>
      : <Empty>No support requests here.</Empty>}
    {open && (open.id ? <Ticket id={open.id} onClose={() => setOpen(null)} /> : <NewTicket preset={open.preset} onClose={() => setOpen(null)} />)}
  </>;
}

function NewTicket({ onClose, preset = {} }) {
  const [t, setT] = useState({ priority: 'normal', promised: addDays(today(), 2), owner: '', ...preset }); const up = (k) => (v) => setT({ ...t, [k]: v?.target ? v.target.value : v });
  const projects = list('project').filter((p) => !t.clientId || p.clientId === t.clientId);
  return <Modal title="New support request" onClose={onClose} footer={<button className="btn primary" type="button" onClick={async () => (await attempt(() => create('ticket', t), 'Support request opened.')) && onClose()}>Save</button>}>
    <div className="form"><Field label="Problem *" full><In value={t.title || ''} onChange={up('title')} autoFocus placeholder="e.g. Contact form not sending emails" /></Field>
      <Field label="Client"><Sel value={t.clientId} onChange={up('clientId')} options={list('client').map((c) => [c.id, c.name])} blank="Choose…" /></Field>
      <Field label="Project"><Sel value={t.projectId} onChange={up('projectId')} options={projects.map((p) => [p.id, p.name])} blank="None" /></Field>
      <Field label="Priority"><Seg value={t.priority} onChange={up('priority')} options={[['normal', 'Normal'], ['urgent', 'Urgent']]} /></Field>
      <Field label="Promised fix date"><In type="date" value={t.promised} onChange={up('promised')} /></Field>
      <Field label="Who fixes it"><Person value={t.owner} onChange={up('owner')} filter={(u) => u.team === 'it'} /></Field>
      <Field label="Details" full><Area value={t.detail || ''} onChange={up('detail')} /></Field></div></Modal>;
}

function Ticket({ id, onClose }) {
  const t = get(id), [pd, setPd] = useState(null); if (!t) return null;
  const set = (d, ok) => attempt(() => update(id, d), ok), p = get(t.projectId);
  return <Modal wide title={`${t.number} · ${t.title}`} onClose={onClose}>
    <div className="grid2"><div className="stack"><div className="form">
      <Field label="Status"><Sel value={t.status} onChange={(v) => set({ status: v }, 'Updated.')} options={ST} /></Field>
      <Field label="Priority"><Seg value={t.priority} onChange={(v) => set({ priority: v })} options={[['normal', 'Normal'], ['urgent', 'Urgent']]} /></Field>
      <Field label="Promised fix date"><In type="date" value={t.promised || ''} onChange={(e) => setPd(e.target.value)} /></Field>
      <Field label="Who fixes it"><Person value={t.owner} onChange={(v) => set({ owner: v })} filter={(u) => u.team === 'it'} /></Field>
      <Field label="Details" full><Area defaultValue={t.detail} onBlur={(e) => set({ detail: e.target.value })} /></Field></div>
      <div className="small">Client: <b>{clientName(t.clientId) || '—'}</b>{p && <> · Project <Link to={'/projects/' + p.id}>{p.name}</Link></>}</div>
      {p && <button className="btn sm" type="button" onClick={() => attempt(() => update(p.id, { changes: [{ id: Date.now().toString(36), text: `${t.number}: ${t.title}`, from: 'client', severity: t.priority === 'urgent' ? 'high' : 'normal', owner: t.owner, status: 'open', at: new Date().toISOString(), by: store.me.id }, ...(p.changes || [])] }), 'Added to the project changes list.')}>Add to project changes</button>}</div>
      <div className="stack"><h3>Comments</h3><Comments relType="ticket" relId={id} /><h3>History</h3><Log items={t.log} /></div></div>
    {pd !== null && <Reason title="Why is the promised date changing?" onClose={() => setPd(null)} onSave={(r) => set({ promised: pd, _reason: r }, 'Promised date changed.').then((x) => x && setPd(null))} />}
  </Modal>;
}
