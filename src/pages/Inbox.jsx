import { useNavigate } from 'react-router-dom';
import { useStore, list, update, store } from '../api.js';
import { fmtDT, uname } from '../lib.js';
import { Empty, attempt } from '../ui.jsx';

const LINK = { lead: '/leads/', deal: '/deals/', project: '/projects/', quote: '/quotes/', client: '/clients/', task: '/tasks', ticket: '/support', approval: '/approvals' };
export default function Inbox() {
  useStore(); const nav = useNavigate();
  const rows = list('notice').filter((n) => n.to === store.me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = rows.filter((n) => !n.read);
  async function open(n) { if (!n.read) await update(n.id, { read: true }).catch(() => {}); const base = LINK[n.relType] || '/'; nav(base.endsWith('/') ? base + n.relId : base); }
  return <>
    <div className="topbar"><h1>Notifications <small>{unread.length} unread</small></h1>{unread.length > 0 && <button className="btn" type="button" onClick={() => attempt(async () => { for (const n of unread) await update(n.id, { read: true }); }, 'All marked as read.')}>Mark all as read</button>}</div>
    {rows.length ? <div className="list">{rows.slice(0, 100).map((n) => <button type="button" key={n.id} className="li" onClick={() => open(n)} style={{ width: '100%', background: n.read ? 'none' : 'var(--gold-50)', border: 'none', borderTop: '1px solid var(--line)', textAlign: 'left' }}>
      <span className={'av'} aria-hidden>{n.read ? '' : '•'}</span><div className="grow"><div style={{ fontWeight: n.read ? 400 : 600 }}>{n.text}</div><div className="small muted">{fmtDT(n.createdAt)} · from {uname(n.createdBy)}</div></div></button>)}</div>
      : <Empty>No notifications. You'll be told here when something is assigned to you, you're @mentioned, or a request is decided.</Empty>}
  </>;
}
