// Small shared helpers: dates, people, labels, and the "what needs me" feed.
import { store, list, get } from './api.js';
import { TITLES, TEAMS, MANAGER_TITLES, TOP_TITLES, MANAGER_ADDS, COMPANIES, GROUP } from '../shared/defaults.js';
export { COMPANIES, GROUP };
export { inr, inr2, num, mobile10 } from '../shared/money.js';
export { TITLES, TEAMS };

const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const diff = (s) => Math.round((parse(s) - parse(today())) / 864e5);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (s) => { if (!s) return ''; const d = parse(s); return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };
export const fmtDT = (s) => s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
export const rel = (s) => { const n = diff(s); return n < -1 ? `${-n} days late` : n === -1 ? '1 day late' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`; };
export const due = (s) => (!s ? '' : diff(s) < 0 ? 'over' : diff(s) === 0 ? 'today' : '');
export const MONTHS = MON;

export const settings = () => store.settings;
export const me = () => store.me;
export const user = (id) => store.users.find((u) => u.id === id);
export const uname = (id) => (!id ? 'Unassigned' : id === store.me?.id ? 'You' : user(id)?.name || 'Former staff');
export const realName = (id) => user(id)?.name || '';
export const isManager = (u = store.me) => !!u && (u.isAdmin || MANAGER_TITLES.includes(u.title));
export const isTop = (u = store.me) => !!u && (TOP_TITLES.includes(u.title) || u.isAdmin);
export const myJuniors = (u = store.me) => MANAGER_ADDS[u?.title] || [];
export const canAddPeople = (u = store.me) => !!u && (u.isAdmin || myJuniors(u).length > 0);
// What we call a person on screen: the designation typed for them; the access level's name if none was typed.
export const desig = (u) => (u?.designation || '').trim() || TITLES[u?.title] || '';
export const teamOf = (id) => user(id)?.team || '';
export const initials = (n) => (n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const stageLabel = (k) => settings().pipeline.find((s) => s.key === k)?.label || k;
export const stageProb = (k) => settings().pipeline.find((s) => s.key === k)?.p ?? 0;
export const pStageLabel = (k) => settings().projectStages.find((s) => s.key === k)?.label || k;
export const clientName = (id) => get(id)?.name || '';
export const activeUsers = () => store.users.filter((u) => u.active);
export const bdes = () => activeUsers().filter((u) => u.title === 'bde');

export function fill(text, vars) { return String(text).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); }
export function waLink(phone, text) { let d = String(phone || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return d.length >= 11 ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : ''; }

// Everything with a date that someone must act on.
export function feedItems() {
  const t = today(), out = [];
  const push = (o) => o.due && out.push(o);
  for (const x of list('task')) if (x.status !== 'done' && !x.trashed) push({ kind: 'task', id: x.id, title: x.title, due: x.due, owner: x.owner, people: x.people || [], team: x.team || teamOf(x.owner), priority: x.priority, link: x.projectId ? `/projects/${x.projectId}` : '/tasks', sample: x.sample });
  for (const x of list('lead')) if (!['converted', 'junk'].includes(x.status)) push({ kind: 'lead', id: x.id, title: `${x.repeatPending ? 'Repeat enquiry – ' : 'Follow up lead: '}${x.name}`, due: x.followUp, owner: x.owner, team: 'sales', link: `/leads/${x.id}`, sample: x.sample });
  for (const x of list('deal')) if (!['won', 'lost'].includes(x.stage)) {
    push({ kind: 'deal', id: x.id, title: `${x.repeatPending ? 'Repeat enquiry – ' : 'Follow up: '}${x.title}`, due: x.followUp, owner: x.owner, people: x.people || [], team: 'sales', priority: x.priority ? 'high' : '', link: `/deals/${x.id}`, sample: x.sample });
    const c = x.cadence && settings().cadences.find((cd) => cd.id === x.cadence.id);
    if (c) c.steps.forEach((s, i) => { if (!(x.cadence.done || []).includes(i)) push({ kind: 'cadence', id: x.id + ':' + i, title: `${c.name}: ${s.text} – ${x.title}`, due: addDays(x.cadence.start, s.day), owner: x.owner, team: 'sales', link: `/deals/${x.id}`, sample: x.sample }); });
  }
  for (const x of list('activity')) if (x.status !== 'done') push({ kind: 'activity', id: x.id, title: `${x.kind === 'meeting' ? 'Meeting' : 'Call'}: ${x.subject || ''}`, due: (x.at || '').slice(0, 10), time: (x.at || '').slice(11, 16), owner: x.owner, team: 'sales', link: x.dealId ? `/deals/${x.dealId}` : x.leadId ? `/leads/${x.leadId}` : '/calendar', sample: x.sample });
  for (const x of list('payment')) if (x.status !== 'paid') push({ kind: 'payment', id: x.id, title: `Collect ${x.title}${x.clientId ? ' – ' + clientName(x.clientId) : ''}`, due: x.due, owner: x.owner, people: x.people || [], team: 'sales', amount: x.amount - (x.paid || 0), link: '/payments', sample: x.sample });
  for (const x of list('project')) if (!['live', 'onhold', 'awaiting'].includes(x.stage) && x.deadline) push({ kind: 'project', id: x.id, title: `Deadline: ${x.name}`, due: x.deadline, owner: x.lead, people: x.people || [], team: 'it', link: `/projects/${x.id}`, sample: x.sample });
  for (const x of list('project')) if (!x.lead && !['live', 'onhold', 'awaiting'].includes(x.stage)) push({ kind: 'project', id: x.id + ':lead', title: `Assign a lead: ${x.name}`, due: (x.createdAt || '').slice(0, 10) || t, owner: '', team: 'it', link: `/projects/${x.id}`, sample: x.sample });
  for (const x of list('ticket')) if (x.status !== 'resolved') push({ kind: 'ticket', id: x.id, title: `${x.number} ${x.title}`, due: x.promised || (x.createdAt || '').slice(0, 10), owner: x.owner, team: 'it', priority: x.priority === 'urgent' ? 'high' : '', link: '/support', sample: x.sample });
  return out.sort((a, b) => (a.due + (a.time || '')).localeCompare(b.due + (b.time || '')));
}
export function forScope(items, scope, m = store.me) {
  const esc = settings().escalateDays ?? 3;
  if (scope === 'all') return items;
  return items.filter((i) => {
    if (i.owner === m.id || (i.people || []).includes(m.id)) return true;
    if (scope === 'team') return i.team === m.team || m.team === 'management';
    if (!i.owner && isManager(m) && (i.team === m.team || m.team === 'management')) return true;
    if (isManager(m) && !isTop(m) && i.team === m.team && diff(i.due) <= 0) return true;
    if (isTop(m) && diff(i.due) <= -esc) return true;
    return false;
  });
}
// How far a project has come: done tasks out of all tasks; with no tasks yet, a rough figure from its stage.
const STAGE_PCT = { awaiting: 0, planning: 10, design: 30, development: 55, testing: 85, live: 100 };
export function projectProgress(p) {
  if (p.stage === 'live') return 100;
  const ts = list('task').filter((t) => t.projectId === p.id);
  return ts.length ? Math.round(100 * ts.filter((t) => t.status === 'done').length / ts.length) : STAGE_PCT[p.stage] ?? 0;
}
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export const escalated = (d) => diff(d) <= -(settings().escalateDays ?? 3);
export const dealReceived = (dealId) => list('receipt').filter((r) => r.dealId === dealId).reduce((s, r) => s + (r.totals?.received || 0), 0);
