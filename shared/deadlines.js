// Deadlines: the dates that must not be missed. The same list feeds the Deadline calendar (pages/Calendar.jsx) and the daily
// reminder (server/logic.js deadlineSweep), which tells management, the Sales Manager and – for IT work only – the IT Manager when a
// deadline is 2 days away, and again if it is missed.
// rows: records as plain objects { id, type, sample, ...data } (the screen's list() gives exactly this; the server flattens its rows).
// team 'it' marks IT work (projects, milestones, support, IT tasks) – the IT Manager is told only about these.
export const SOON_DAYS = 2;
export function deadlineItems(rows) {
  const name = new Map(rows.filter((r) => r.type === 'project' || r.type === 'client').map((r) => [r.id, r.name]));
  const out = [], push = (o) => o.due && /^\d{4}-\d\d-\d\d$/.test(o.due) && out.push(o);
  for (const r of rows) {
    const base = { id: r.id, sample: !!r.sample };
    if (r.type === 'project' && !['live', 'onhold'].includes(r.stage))
      push({ ...base, kind: 'delivery', key: 'p:' + r.id, due: r.deadline, title: `Project delivery – ${r.name}`, team: 'it', owner: r.lead || '', people: r.people || [], relType: 'project', relId: r.id, link: '/projects/' + r.id });
    else if (r.type === 'task' && r.status !== 'done' && !r.trashed && r.milestone && r.projectId)
      push({ ...base, kind: 'milestone', key: 't:' + r.id, due: r.due, title: `Milestone – ${r.title}${name.get(r.projectId) ? ' (' + name.get(r.projectId) + ')' : ''}`, team: 'it', owner: r.owner || '', people: r.people || [], relType: 'project', relId: r.projectId, link: '/projects/' + r.projectId });
    else if (r.type === 'task' && r.status !== 'done' && !r.trashed && r.priority === 'high')
      push({ ...base, kind: 'task', key: 't:' + r.id, due: r.due, title: `Important task – ${r.title}`, team: r.projectId ? 'it' : r.team || '', owner: r.owner || '', people: r.people || [], relType: 'task', relId: r.id, link: r.projectId ? '/projects/' + r.projectId : '/tasks' });
    else if (r.type === 'ticket' && r.status !== 'resolved')
      push({ ...base, kind: 'promise', key: 's:' + r.id, due: r.promised, title: `Support promise – ${r.number || ''} ${r.title || ''}`.replace(/\s+/g, ' ').trim(), team: 'it', owner: r.owner || '', people: [], relType: 'ticket', relId: r.id, link: '/support' });
    else if (r.type === 'payment' && r.status !== 'paid')
      push({ ...base, kind: 'payment', key: 'm:' + r.id + ':' + r.due, due: r.due, title: `Payment due – ${r.title}${name.get(r.clientId) ? ' – ' + name.get(r.clientId) : ''}`, team: 'sales', owner: r.owner || '', people: r.people || [], relType: 'payment', relId: r.id, link: '/payments' });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
export const DEADLINE_KIND = { delivery: 'Project delivery', milestone: 'Milestone', task: 'Important task', promise: 'Support promise', payment: 'Payment due' };
