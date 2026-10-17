// Pop-up notifications: when something arrives for you while Aali One is open – a lead given to you, a mention, a decision on your
// request – a card slides in at the top right. Click it to open what it is about. It leaves by itself after a few seconds, and stays
// in Notifications until it is read. On sign-in, one card says how many are waiting. If the window is hidden, the computer's own
// notification is shown too (when the person has allowed it).
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, store, list, update } from './api.js';
import { m, AnimatePresence, SPRING } from './motion.jsx';
import { Ico } from './icons.jsx';
import { uname } from './lib.js';
import { notifySound } from './sound.js';

const LINK = { lead: '/leads/', deal: '/deals/', project: '/projects/', quote: '/quotes/', client: '/clients/', task: '/tasks', ticket: '/support', approval: '/approvals', report: '/daily', prospect: '/calls', asset: '/assets', bill: '/bills/', agreement: '/agreements/', payroll: '/payroll', clientpay: '/client-payroll', payment: '/payments' };
// Where a notification leads: the lead, deal, project… it is about.
export const noticeLink = (n) => { const base = LINK[n.relType] || '/'; return base.endsWith('/') ? base + n.relId : base; };

function Card({ c, onOpen, onClose }) {
  const [hold, setHold] = useState(false); // it waits while the pointer is on it
  useEffect(() => { if (hold) return; const h = setTimeout(onClose, 9000); return () => clearTimeout(h); }, [hold]);
  return <m.div layout className="popup" role="status" initial={{ opacity: 0, x: 60, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 60, transition: { duration: 0.18 } }} transition={SPRING}
    onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
    <button type="button" className="popup-b" onClick={onOpen}><span className="ic"><Ico k="inbox" /></span>
      <span className="grow"><b>{c.title}</b><span className="small muted">{c.sub}</span></span></button>
    <button type="button" className="popup-x" aria-label="Close this notification" onClick={onClose}>×</button>
  </m.div>;
}
export function Popups() {
  useStore(); const nav = useNavigate(), me = store.me, [cards, setCards] = useState([]), known = useRef(null);
  const mine = list('notice').filter((n) => n.to === me.id && !n.read), ids = mine.map((n) => n.id).sort().join();
  useEffect(() => {
    if (!known.current) { // just signed in: one card for everything that was already waiting
      known.current = new Set(mine.map((n) => n.id));
      if (mine.length) setCards([{ id: 'waiting', title: `${mine.length} unread notification${mine.length === 1 ? '' : 's'}`, sub: 'Open Notifications to read them', to: '/inbox' }]);
      return;
    }
    const fresh = mine.filter((n) => !known.current.has(n.id)); if (!fresh.length) return;
    for (const n of fresh) known.current.add(n.id);
    setCards((c) => [...c, ...fresh.map((n) => ({ id: n.id, title: n.text, sub: `from ${uname(n.createdBy)} · click to open`, to: noticeLink(n), notice: n.id }))].slice(-4));
    notifySound(); // the person's own sound, if they set one (Settings → My profile)
    try { if (document.hidden && Notification.permission === 'granted') new Notification('Aali One', { body: fresh.length === 1 ? fresh[0].text : `${fresh.length} new notifications`, icon: '/icon.svg' }); } catch {}
  }, [ids]);
  const close = (id) => setCards((c) => c.filter((x) => x.id !== id));
  const open = (c) => { close(c.id); if (c.notice) update(c.notice, { read: true }).catch(() => {}); nav(c.to); };
  return <div className="popups" aria-live="polite"><AnimatePresence>{cards.map((c) => <Card key={c.id} c={c} onOpen={() => open(c)} onClose={() => close(c.id)} />)}</AnimatePresence></div>;
}
