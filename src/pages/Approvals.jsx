import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, list, get, update } from '../api.js';
import { uname, fmtDT, can } from '../lib.js';
import { Empty, Pill, In, attempt } from '../ui.jsx';

const KIND = { discount: 'Discount above the limit', earlystart: 'Start work without advance', livenosign: 'Live without client sign-off' };
export default function Approvals() {
  useStore(); const [note, setNote] = useState({});
  if (!can('approvals')) return <Empty>Only managers decide approvals.</Empty>;
  const all = list('approval').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), pending = all.filter((a) => a.status === 'pending');
  const link = (a) => a.relType === 'quote' ? '/quotes/' + a.relId : a.relType === 'project' ? '/projects/' + a.relId : '/';
  const decide = (a, status) => attempt(() => update(a.id, { status, decisionNote: note[a.id] || '' }), status === 'approved' ? 'Approved.' : 'Rejected.');
  return <>
    <div className="topbar"><h1>Approvals <small>{pending.length} waiting</small></h1></div>
    {pending.length ? <div className="list">{pending.map((a) => <div className="li" key={a.id}><Pill k="warn">{KIND[a.kind] || a.kind}</Pill>
      <div className="grow"><Link to={link(a)} className="t">{a.reason}</Link><div className="small muted">Asked by {uname(a.requestedBy)} · {fmtDT(a.createdAt)}{get(a.relId)?.totals ? ` · total ${get(a.relId).totals.total}` : ''}</div></div>
      <In placeholder="Note (optional)" value={note[a.id] || ''} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} style={{ maxWidth: 200 }} />
      <button className="btn sm" type="button" onClick={() => decide(a, 'rejected')}>Reject</button><button className="btn sm primary" type="button" onClick={() => decide(a, 'approved')}>Approve</button></div>)}</div>
      : <Empty>Nothing waiting for approval.</Empty>}
    {all.length > pending.length && <><h2 style={{ margin: '20px 0 8px' }}>Decided</h2><div className="list">{all.filter((a) => a.status !== 'pending').slice(0, 30).map((a) => <div className="li" key={a.id}>
      <Pill k={a.status === 'approved' ? 'ok' : 'bad'}>{a.status}</Pill><span className="grow">{a.reason}{a.decisionNote ? ` – ${a.decisionNote}` : ''}</span><span className="small muted">{uname(a.decidedBy)} · {fmtDT(a.decidedAt)}</span></div>)}</div></>}
  </>;
}
