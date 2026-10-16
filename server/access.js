// Record by record: may this person read it, may they change it? Built on the role table in shared/access.js.
import { scopeOf, canSee, canEdit, canClose, SECTION_OF, SECRET } from '../shared/access.js';
import { TOP_TITLES, MANAGER_TITLES } from '../shared/defaults.js';

const isTop = (u) => u.is_admin || TOP_TITLES.includes(u.title);
const isManager = (u) => u.is_admin || MANAGER_TITLES.includes(u.title);
// A light list of who owns what, enough to work out "own" items without loading every record in full.
const INDEX_TYPES = ['lead', 'deal', 'client', 'project', 'task', 'ticket'];
export const loadIndex = async (db) => (await db.query(`select id, type, created_by, jsonb_build_object('owner', data->'owner', 'lead', data->'lead', 'people', data->'people',
  'clientId', data->'clientId', 'dealId', data->'dealId', 'projectId', data->'projectId', 'team', data->'team') as data from records where deleted_at is null and type = any($1)`, [INDEX_TYPES])).rows;

// The kinds of item people add themselves. Notifications, presence and anything unknown are made by the server only (audit ACB-1, ACB-3).
const CREATABLE = new Set(['lead', 'deal', 'client', 'quote', 'invoice', 'receipt', 'payment', 'project', 'task', 'ticket', 'activity', 'comment', 'approval', 'target', 'signoff', 'asset', 'bill', 'collab', 'report', 'prospect', 'agreement', 'salary', 'payrun', 'loan', 'payee', 'pclient', 'pemp']);
const LABEL = { assets: 'client assets', calls: 'the call register', leads: 'leads', deals: 'deals', clients: 'clients', quotes: 'quotations', money: 'receipts and payments', projects: 'projects', support: 'support requests', collab: 'collaborations', agreements: 'agreements', payroll: 'payroll' };

// rows: every live record (or the light index). canSeeReport: the daily-report rule, passed in from logic.js.
export function buildAccess(user, rows, canSeeReport) {
  const uid = user.id, top = isTop(user), sc = (s) => scopeOf(user, s), by = new Map(rows.map((r) => [r.id, r]));
  // Mine: I look after it, lead it or am named on it. For a lead, deal or client the person in charge decides – once a manager
  // gives it to someone else it leaves my list, even though I entered it. Anything else I made (a task, a support request) stays mine.
  const mine = (r) => r.data.owner === uid || r.data.lead === uid || (Array.isArray(r.data.people) && r.data.people.includes(uid))
    || (r.created_by === uid && (!['lead', 'deal', 'client'].includes(r.type) || !r.data.owner));
  const own = (type, extra = () => false) => new Set(rows.filter((r) => r.type === type && (mine(r) || extra(r))).map((r) => r.id));
  const myLeads = sc('leads') === 'own' ? own('lead') : null, myDeals = sc('deals') === 'own' ? own('deal') : null;
  // A project is "mine" if I lead it, am named on it, have a task in it, or it came from my deal.
  const taskProjects = new Set(rows.filter((r) => r.type === 'task' && r.data.projectId && mine(r)).map((r) => r.data.projectId));
  const myProjects = sc('projects') === 'own' ? own('project', (r) => taskProjects.has(r.id) || !!myDeals?.has(r.data.dealId)) : null;
  // A client is "mine" if I look after it, or one of my leads or deals belongs to it.
  let myClients = null;
  if (sc('clients') === 'own') { myClients = own('client');
    for (const r of rows) if (r.data.clientId && ((r.type === 'deal' && myDeals?.has(r.id)) || (r.type === 'lead' && myLeads?.has(r.id)))) myClients.add(r.data.clientId); }
  const within = (section, set, id) => { const s = sc(section); return s === 'all' || s === 'team' ? true : s === 'own' ? !!set?.has(id) : false; };
  const parent = (id) => { const p = by.get(id); return !!p && read(p) === true; };

  // true = may read · false = may not · 'card' = only the client's name (IT needs the name on a project, nothing else).
  function read(r) {
    const d = r.data || {};
    switch (r.type) {
      case 'notice': return d.to === uid;
      case 'report': return canSeeReport(user, d);
      case 'collab': return canSee(user, 'collab');
      // Operations Manager, Sales Manager, Company Secretary and Chairman; a BDE only the ones given to them.
      case 'quote': return sc('quotes') === 'own' ? d.assignedTo === uid : canSee(user, 'quotes');
      case 'agreement': return sc('agreements') === 'own' ? d.assignedTo === uid : canSee(user, 'agreements');
      case 'salary': case 'payrun': case 'loan': case 'payee': case 'pclient': case 'pemp': return canSee(user, 'payroll'); // HR and the Operations Manager only
      case 'invoice': case 'receipt': case 'payment': return canSee(user, 'money');
      case 'lead': return within('leads', myLeads, r.id) || (sc('leads') === 'own' && mine(r));
      case 'deal': return within('deals', myDeals, r.id) || (sc('deals') === 'own' && mine(r));
      case 'client': return sc('clients') ? within('clients', myClients, r.id) || (sc('clients') === 'own' && mine(r)) : canSee(user, 'projects') || canSee(user, 'support') ? 'card' : false;
      case 'project': return within('projects', myProjects, r.id) || (sc('projects') === 'own' && mine(r));
      case 'signoff': return within('projects', myProjects, d.projectId);
      case 'task': return d.projectId ? within('projects', myProjects, d.projectId) : top || mine(r) || (!!d.team && d.team === user.team);
      case 'ticket': { const s = sc('support'); return s === 'all' ? true : s === 'own' ? mine(r) || !!myProjects?.has(d.projectId) || !!myClients?.has(d.clientId) : false; }
      case 'activity': return d.leadId ? (sc('leads') === 'all' || parent(d.leadId)) : d.dealId ? (sc('deals') === 'all' || parent(d.dealId)) : top || mine(r);
      case 'comment': return SECRET[d.relType] ? sc(SECRET[d.relType]) === 'all' : by.has(d.relId) ? parent(d.relId) : d.relType === 'quote' ? sc('quotes') === 'all' : top || r.created_by === uid;
      case 'approval': return d.requestedBy === uid || (isManager(user) && (top || (d.relType === 'quote' ? user.team === 'sales' : d.relType === 'project' ? user.team === 'it' : false)));
      case 'target': return top || user.title === 'salesmgr' || d.userId === uid;
      case 'presence': return top || (isManager(user) && d.team === user.team); // who is out of the office: only the person's manager and management, not teammates
      // Client assets: the BDE who uploaded them, the manager they were sent to, the person they were given to, the Sales Manager and management.
      case 'asset': return top || user.title === 'salesmgr' || d.owner === uid || d.assignee === uid || (user.title === 'itmgr' && d.to === 'it');
      case 'bill': return top || d.owner === uid; // the person who submitted it, and management
      case 'prospect': { const s = sc('calls'); return s === 'all' ? true : s === 'own' ? d.owner === uid : false; } // a number in the call register
      default: return top;
    }
  }

  // Links (security review 10 Oct 2026): a new or changed client, lead, deal or project link must point at something this person may open.
  // Otherwise naming another BDE's client in a deal – or someone else's project in a task – would open it to them. Management sees all.
  function linkBlock(fields, r) {
    if (top) return '';
    for (const k of ['clientId', 'leadId', 'dealId', 'projectId']) {
      const v = fields?.[k]; if (!v || v === (r?.data?.[k] || '')) continue;
      const p = by.get(v); if (!p || !read(p)) return 'You cannot link this to an item you cannot open.';
    }
    return '';
  }
  // Why this person cannot add a record of this type ('' when they can). It may adjust the data (an own-level person owns what they add).
  function createBlock(type, data) {
    const section = SECTION_OF[type];
    if (!CREATABLE.has(type)) return type === 'notice' ? 'Notifications are sent by Aali One itself.' : 'This kind of item cannot be added.';
    const lb = linkBlock(data, null); if (lb) return lb;
    if (type === 'project' && data.dealId && canEdit(user, 'deals') && parent(data.dealId)) return ''; // handing a won deal over to IT
    if (section && !canEdit(user, section)) return `Your access does not allow adding ${LABEL[section]}.`;
    if (section && sc(section) === 'own' && ['lead', 'deal', 'client'].includes(type)) data.owner = uid;
    if (type === 'project' && sc('projects') === 'own') return 'Projects are created by the IT Manager or the Team Lead.';
    if (type === 'presence') return 'This is set by the system from the daily report.';
    if (type === 'agreement' && data.kind !== 'service' && !canClose(user)) return 'Only the Operations Manager makes a closure agreement.'; // anything but a plain service agreement
    if (type === 'comment' && SECRET[data.relType]) return 'This kind of item has no comments.';
    if (type === 'asset' && !(user.team === 'sales' || user.is_admin)) return 'Client assets are uploaded by the Sales team.';
    if (type === 'prospect' && sc('calls') !== 'all') return 'Numbers join the call register from your call sheet. Only a manager adds a Do Not Call number directly.';
    if (type === 'task' && data.projectId && !(canEdit(user, 'projects') && within('projects', myProjects, data.projectId))) return 'Your access does not allow adding tasks to this project.';
    if (type === 'activity' && !(canEdit(user, 'leads') && (data.leadId ? sc('leads') === 'all' || parent(data.leadId) : data.dealId ? sc('deals') === 'all' || parent(data.dealId) : true))) return 'Your access does not allow logging calls or meetings here.';
    if (type === 'comment' && by.has(data.relId) && !parent(data.relId)) return 'You cannot comment on something you cannot open.';
    if (type === 'signoff' && !within('projects', myProjects, data.projectId)) return 'You cannot open this project.';
    if (type === 'approval' && by.has(data.relId) && !parent(data.relId)) return 'You cannot open this item.';
    if (type === 'target' && !(user.is_admin || user.title === 'salesmgr')) return 'Only the Sales Manager or an admin sets targets.';
    if (type === 'bill' && user.team === 'management') return 'Management does not submit bills here.';
    return '';
  }
  // Why this person cannot change or delete this record ('' when they can). patch: the fields being changed (empty for a delete).
  function writeBlock(r, patch = {}) {
    if (read(r) !== true) return 'Your access does not allow opening this item.';
    const lb = linkBlock(patch, r); if (lb) return lb;
    // A number in the call register is removed only by a manager: a BDE deleting one would wipe "not interested" or Do Not Call.
    if (r.type === 'prospect' && !Object.keys(patch).length && !isManager(user)) return 'Only a manager removes a number from the call register.';
    if (r.type === 'presence') return 'This is set by the system from the daily report.';
    // A notification can only be marked as read – never re-addressed or re-worded (audit ACB-2).
    if (r.type === 'notice' && Object.keys(patch).some((k) => k !== 'read')) return 'A notification can only be marked as read.';
    const section = SECTION_OF[r.type], d = r.data || {};
    // Payroll: the Operations Manager reviews – the only change open to him is a remark on a month's payroll.
    if (section === 'payroll' && !canEdit(user, 'payroll')) return r.type === 'payrun' && Object.keys(patch).length && Object.keys(patch).every((k) => k === '_remark') ? '' : 'Payroll is changed by HR. You can review it and write remarks.';
    if (r.type === 'payrun' && !Object.keys(patch).length && d.status !== 'draft') return 'A locked or paid payroll cannot be deleted. A locked one can be reopened first.';
    if (r.type === 'loan' && !Object.keys(patch).length && (d.recovered || []).length) return 'Money has already been cut for this loan. Stop it instead of deleting it.';
    // The BDE a quotation or an agreement is given to: only its steps (the client's changes, reconfirmed, the advance, the sign) – never its contents.
    if ((r.type === 'quote' || r.type === 'agreement') && section && !canEdit(user, section))
      return d.assignedTo === uid && Object.keys(patch).length === 1 && '_flow' in patch ? '' : `Your access is view only for ${LABEL[section]}.`;
    if (section && !canEdit(user, section)) return `Your access is view only for ${LABEL[section]}.`;
    if (section && sc(section) === 'own' && 'owner' in patch && (patch.owner || '') !== (d.owner || '')) return 'Only a manager can give this to another person.';
    if (r.type === 'project' && 'lead' in patch && (patch.lead || '') !== (d.lead || '') && !isManager(user)) return 'The project lead is set by the IT Manager.';
    if (r.type === 'task' && d.projectId && !canEdit(user, 'projects')) return 'Your access is view only for this project.';
    if (r.type === 'agreement' && d.kind !== 'service' && !canClose(user)) return 'Only the Operations Manager changes a closure agreement.';
    if (r.type === 'agreement' && d.status === 'signed' && !Object.keys(patch).length && !canClose(user)) return 'Only the Operations Manager can delete a signed agreement.';
    // A task on the team list can be read by the whole team, but only the people it is given to, the person who made it, or a manager may change it.
    if (r.type === 'task' && !d.projectId && !(mine(r) || isManager(user))) return 'This task is not yours. Only the person it is given to, or a manager, can change it.';
    if (r.type === 'activity' && !canEdit(user, 'leads')) return 'Your access is view only here.';
    if (r.type === 'comment' && r.created_by !== uid && !user.is_admin) return 'Only the writer can change a comment.';
    if (r.type === 'target' && !(user.is_admin || user.title === 'salesmgr')) return 'Only the Sales Manager or an admin sets targets.';
    // A bill is deleted by the person who submitted it while it waits for approval, or by management.
    if (r.type === 'bill' && !Object.keys(patch).length && !top && d.status !== 'submitted') return 'This bill is already approved. Ask management if it must be removed.';
    return '';
  }
  return { read, createBlock, writeBlock };
}
