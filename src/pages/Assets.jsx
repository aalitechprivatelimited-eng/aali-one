// Client assets: what a client gives their BDE (logo, photos, documents, videos). The BDE uploads them here and sends them to the
// Sales Manager or the IT Manager, who gives them to the person who will do the work. Everyone concerned is told at each step.
import { useState } from 'react';
import { useStore, store, list, create, update } from '../api.js';
import { uname, fmtDT, canEdit, activeUsers, desig } from '../lib.js';
import { Seg, Pill, Empty, Field, In, Sel, Pick, Area, Modal, Attachments, Log, RO, ViewOnly, attempt } from '../ui.jsx';

const ST = { sent: ['Waiting for the manager', 'warn'], allotted: ['Given to a person', 'info'], done: ['Done', 'ok'] };
const TO = { sales: 'Sales Manager', it: 'IT Manager' };
const isBoss = (a, me) => me.isAdmin || (a.to === 'it' ? me.title === 'itmgr' : me.title === 'salesmgr');

export default function Assets() {
  useStore(); const me = store.me, canAdd = canEdit('assets') && (me.team === 'sales' || me.isAdmin);
  const [f, setF] = useState({ q: '', st: '' }), [add, setAdd] = useState(null), [open, setOpen] = useState(null), [busy, setBusy] = useState(false);
  const all = list('asset'), q = f.q.trim().toLowerCase(), cur = open && all.find((a) => a.id === open);
  const rows = all.filter((a) => (!f.st || a.status === f.st) && (!q || `${a.clientName} ${a.what} ${uname(a.owner)} ${a.note}`.toLowerCase().includes(q))).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const n = (st) => all.filter((a) => a.status === st).length, clients = list('client').filter((c) => !c.card);
  async function send() {
    setBusy(true); const c = clients.find((x) => x.id === add.clientId);
    const r = await attempt(() => create('asset', { ...add, clientName: c ? c.name : add.clientName }), `Sent to the ${TO[add.to]}. They have been told.`); setBusy(false); if (r) setAdd(null);
  }
  return <>
    <div className="topbar"><h1>Client assets <small>{rows.length} shown</small> <ViewOnly when={!canEdit('assets')} /></h1>
      {canAdd && <button className="btn primary" type="button" onClick={() => setAdd({ clientId: '', clientName: '', what: '', to: '', files: [], link: '', note: '' })}>+ Upload assets</button>}</div>
    <div className="banner info" style={{ marginBottom: 12 }}>When a client gives you a logo, photos, documents or videos, upload them here and choose who they go to. The manager gives them to the person who will do the work. Each file can be up to 3 MB; for bigger files such as videos, paste the link (Google Drive or similar).</div>
    <div className="stats">
      <div className={'stat' + (n('sent') ? ' warm' : '')}><span className="l">Waiting for the manager</span><span className="v">{n('sent')}</span></div>
      <div className="stat"><span className="l">Given to a person</span><span className="v">{n('allotted')}</span></div>
      <div className="stat"><span className="l">Done</span><span className="v">{n('done')}</span></div>
    </div>
    <div className="row" style={{ marginBottom: 12 }}><In placeholder="Search client, work or person" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ maxWidth: 280 }} />
      <Seg value={f.st} onChange={(v) => setF({ ...f, st: v })} options={[['', 'All'], ['sent', 'Waiting'], ['allotted', 'Given'], ['done', 'Done']]} /></div>
    {rows.length ? <div className="tbl"><table><thead><tr><th>Client</th><th>For</th><th>From</th><th>Sent to</th><th>Given to</th><th className="n">Files</th><th>Status</th><th>When</th></tr></thead><tbody>
      {rows.map((a) => { const [l, k] = ST[a.status] || ST.sent; return <tr key={a.id} className="click" onClick={() => setOpen(a.id)}>
        <td><b>{a.clientName}</b></td><td>{a.what || '—'}</td><td>{uname(a.owner)}</td><td>{TO[a.to]}</td><td>{a.assignee ? uname(a.assignee) : '—'}</td>
        <td className="n">{(a.files || []).length}{a.link ? ' + link' : ''}</td><td><Pill k={k}>{l}</Pill></td><td className="num small">{fmtDT(a.createdAt)}</td></tr>; })}</tbody></table></div>
      : <Empty>{all.length ? 'Nothing matches.' : canAdd ? 'No assets yet. When a client sends you files, press “+ Upload assets”.' : 'No client assets have been sent to you yet.'}</Empty>}
    {add && <Modal wide title="Upload client assets" onClose={() => setAdd(null)} footer={<><button className="btn" type="button" onClick={() => setAdd(null)}>Cancel</button>
      <button className="btn primary" type="button" disabled={busy || !(add.clientId || add.clientName.trim()) || !add.to || !(add.files.length || add.link.trim())} onClick={send}>{busy ? 'Sending…' : add.to ? `Send to the ${TO[add.to]}` : 'Send'}</button></>}>
      <div className="form">
        <Field label="Which client's assets are these? *"><Pick value={add.clientId} onChange={(v) => setAdd({ ...add, clientId: v })} options={clients.map((c) => [c.id, c.name, c.city])} blank="Not in my clients – I will type the name" /></Field>
        {!add.clientId && <Field label="Client name *"><In value={add.clientName} maxLength={120} onChange={(e) => setAdd({ ...add, clientName: e.target.value })} placeholder="e.g. Hotel Palm Grove" /></Field>}
        <Field label="What is the work?" full><In value={add.what} maxLength={120} onChange={(e) => setAdd({ ...add, what: e.target.value })} placeholder="e.g. Video making, digital marketing posts, website photos" /></Field>
        <Field label="Who should get them? *" full><Seg value={add.to} onChange={(v) => setAdd({ ...add, to: v })} options={[['it', 'IT Manager'], ['sales', 'Sales Manager']]} /></Field>
        <Field label="Files (up to 3 MB each)" full><Attachments value={add.files} onChange={(files) => setAdd({ ...add, files })} /></Field>
        <Field label="Link for big files" full hint="For videos and other large files: upload them to Google Drive (or similar) and paste the link here."><In value={add.link} maxLength={500} onChange={(e) => setAdd({ ...add, link: e.target.value })} placeholder="https://drive.google.com/…" /></Field>
        <Field label="Note from the client / instructions" full><Area value={add.note} maxLength={1000} onChange={(e) => setAdd({ ...add, note: e.target.value })} placeholder="What the client wants done with these" /></Field>
      </div>
      <p className="small muted" style={{ margin: '10px 0 0' }}>The {add.to ? TO[add.to] : 'manager you choose'} is told at once.{add.to === 'it' ? ' The Sales Manager is told too.' : ''} The Operations Manager and Company Secretary are also told.</p></Modal>}
    {cur && <Detail a={cur} me={me} onClose={() => setOpen(null)} />}
  </>;
}

function Detail({ a, me, onClose }) {
  const [to, setTo] = useState(a.assignee || ''), boss = isBoss(a, me) && canEdit('assets'), mine = a.owner === me.id, given = a.assignee === me.id, [l, k] = ST[a.status] || ST.sent;
  const set = (data, ok) => attempt(() => update(a.id, data), ok), team = activeUsers().filter((u) => u.team === (a.to === 'it' ? 'it' : 'sales'));
  const href = /^https?:\/\//i.test(a.link || '') ? a.link : a.link ? 'https://' + a.link : '';
  return <Modal wide title={`${a.clientName}${a.what ? ' – ' + a.what : ''}`} onClose={onClose} footer={<><span>{(boss || given) && a.status === 'allotted' && <button className="btn primary" type="button" onClick={() => set({ status: 'done' }, 'Marked done. The BDE is told.')}>Mark the work done</button>}</span>
    <button className="btn" type="button" onClick={onClose}>Close</button></>}>
    <div className="stack">
      <div className="row"><Pill k={k}>{l}</Pill><span className="small muted">From {uname(a.owner)} · {fmtDT(a.createdAt)} · sent to the {TO[a.to]}{a.assignee ? ` · given to ${uname(a.assignee)}` : ''}</span></div>
      {a.note && <div className="comment">{a.note}</div>}
      <div><span className="lbl">Files</span><RO when={!(mine || boss) || !canEdit('assets')}><Attachments value={a.files || []} onChange={(files) => set({ files }, 'Files updated.')} /></RO></div>
      {href && <div><span className="lbl">Link</span><div><a href={href} target="_blank" rel="noreferrer">{a.link}</a></div></div>}
      {boss && a.status !== 'done' && <div className="card stack"><span className="lbl">Give these assets to</span>
        <div className="row"><Sel value={to} onChange={setTo} options={team.map((u) => [u.id, `${u.name} · ${desig(u)}`])} blank="Choose the person who will do the work" style={{ flex: '1 1 260px', width: 'auto' }} />
          <button className="btn primary" type="button" disabled={!to || to === a.assignee} onClick={() => set({ assignee: to }, `Given to ${uname(to)}. They have been told.`)}>{a.assignee ? 'Change person' : 'Give'}</button></div></div>}
      {!boss && a.status === 'sent' && <div className="banner">Waiting for the {TO[a.to]} to give these to a person.</div>}
      <div><span className="lbl">History</span><Log items={a.log} /></div>
    </div></Modal>;
}
