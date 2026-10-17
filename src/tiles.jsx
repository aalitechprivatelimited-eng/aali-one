// The live counts of every section – the numbers on the app launcher (src/apps.jsx) and in the sidebar.
import { list, store } from './api.js';
import { feedItems, forScope, diff, isTop, can, canEdit, urgentDeadlines } from './lib.js';

// What waits in each section, for the person looking: the numbers on the tiles and in the sidebar.
export function sectionCounts() {
  const me = store.me;
  const late = forScope(feedItems(), 'mine').filter((i) => diff(i.due) <= 0).length;
  const unread = list('notice').filter((n) => n.to === me.id && !n.read).length;
  const pending = can('approvals') ? list('approval').filter((a) => a.status === 'pending').length : 0;
  const toReview = can('approvals') ? list('report').filter((r) => r.owner !== me.id && r.status === 'submitted' && !r.reviewed).length : 0;
  const billsToDo = isTop() ? list('bill').filter((b) => b.status === 'submitted' || b.status === 'approved').length : 0; // management: to approve or to pay
  // Quotations and agreements: with me (a BDE) and not signed yet; for the managers, the client's changes and an advance to confirm.
  const docs = (type, section) => list(type).filter((d) => !(type === 'agreement' ? d.status === 'signed' : d.signed)
    && ((d.assignedTo === me.id && d.status !== 'changes') || (canEdit(section) && (d.status === 'changes' || (d.advance && !d.advance.confirmed))))).length;
  return { today: late, daily: toReview, bills: billsToDo, inbox: unread, approvals: pending, calendar: urgentDeadlines(), quotes: docs('quote', 'quotes'), agreements: docs('agreement', 'agreements') };
}
