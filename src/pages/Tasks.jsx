import { useState } from 'react';
import { useStore, list, create, update, store } from '../api.js';
import { today, addDays, TEAMS, activeUsers, parse, MONTHS, iso } from '../lib.js';
import { Seg, Sel, In, Empty, Pill, Due, attempt, toast } from '../ui.jsx';
import { TaskModal, TaskRow, TSTATUS, PRIORITY, pTone } from '../task.jsx';

// Zoho ToDo: personal and team tasks, list / board / calendar views, quick add.
export function quickParse(text) {
  let t = ' ' + text + ' ', due = '', priority = 'medium', owner = store.me.id, remindAt = '';
  if (/ today /i.test(t)) { due = today(); t = t.replace(/ today /i, ' '); }
  if (/ tomorrow /i.test(t)) { due = addDays(today(), 1); t = t.replace(/ tomorrow /i, ' '); }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  days.forEach((d, i) => { const re = new RegExp(` (on )?${d} `, 'i'); if (re.test(t)) { const n = (i - new Date().getDay() + 7) % 7 || 7; due = addDays(today(), n); t = t.replace(re, ' '); } });
  const tm = t.match(/ (at )?(\d{1,2})(:(\d\d))? ?(am|pm) /i);
  if (tm) { let h = +tm[2] % 12 + (tm[5].toLowerCase() === 'pm' ? 12 : 0); remindAt = `${String(h).padStart(2, '0')}:${tm[4] || '00'}`; t = t.replace(tm[0], ' '); if (!due) due = today(); }
  if (/ !high /i.test(t) || / urgent /i.test(t)) { priority = 'high'; t = t.replace(/ (!high|urgent) /i, ' '); }
  const at = t.match(/ @(\w+)/); if (at) { const u = activeUsers().find((x) => x.name.toLowerCase().startsWith(at[1].toLowerCase())); if (u) { owner = u.id; t = t.replace(at[0], ' '); } }
  return { title: t.trim().replace(/\s+/g, ' '), due: due || today(), priority, owner, remindAt };
}

export default function Tasks() {
  useStore();
  const me = store.me, [scope, setScope] = useState('mine'), [view, setView] = useState('list'), [f, setF] = useState({ status: 'open', priority: '', category: '' }), [open, setOpen] = useState(null), [q, setQ] = useState('');
  const all = list('task').filter((t) => !t.projectId || scope !== 'personal');
  const rows = all.filter((t) => (scope === 'mine' ? t.owner === me.id || (t.people || []).includes(me.id) : scope === 'personal' ? !t.team && !t.projectId && (t.owner === me.id || t.createdBy === me.id) : scope.startsWith('team:') ? t.team === scope.slice(5) : true)
    && (f.status === 'open' ? t.status !== 'done' : !f.status || t.status === f.status) && (!f.priority || t.priority === f.priority) && (!f.category || t.category === f.category));
  const cats = [...new Set(all.map((t) => t.category).filter(Boolean))];
  async function quick() { const p = quickParse(q); if (!p.title) return; if (await attempt(() => create('task', { ...p, status: 'todo', team: scope.startsWith('team:') ? scope.slice(5) : '' }), `Added for ${p.due === today() ? 'today' : p.due}.`)) setQ(''); }
  return <>
    <div className="topbar"><h1>Tasks <small>{rows.length} shown</small></h1><div className="row"><Seg value={view} onChange={setView} options={[['list', 'List'], ['board', 'Board'], ['calendar', 'Calendar']]} /><button className="btn primary" type="button" onClick={() => setOpen({})}>+ Task</button></div></div>
    <div className="row" style={{ marginBottom: 10 }}><Seg value={scope} onChange={setScope} options={[['mine', 'My tasks'], ['personal', 'Personal'], ...Object.entries(TEAMS).map(([k, l]) => ['team:' + k, l + ' team']), ['all', 'Everything']]} /></div>
    <div className="card row" style={{ marginBottom: 12 }}><In className="in grow" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && quick()} placeholder='Quick add: "Send report to Ravi tomorrow 5pm !high @Priya"' style={{ flex: 1 }} />
      <button className="btn" type="button" onClick={quick} disabled={!q.trim()}>Add</button><span className="small muted">Understands today, tomorrow, weekdays, times, !high and @name.</span></div>
    <div className="row" style={{ marginBottom: 12 }}><Sel value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[['open', 'Not done'], ...TSTATUS]} blank="Any status" style={{ width: 'auto' }} />
      <Sel value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={PRIORITY} blank="Any priority" style={{ width: 'auto' }} />{cats.length > 0 && <Sel value={f.category} onChange={(v) => setF({ ...f, category: v })} options={cats} blank="Any category" style={{ width: 'auto' }} />}</div>
    {!rows.length ? <Empty>No tasks here. Use quick add above.</Empty> : view === 'list' ? <div className="list">{rows.sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '9').localeCompare(b.due || '9') || (a.priority === 'high' ? -1 : 1)).map((t) => <TaskRow key={t.id} t={t} onOpen={(x) => setOpen({ task: x })} />)}</div>
      : view === 'board' ? <div className="board"><div className="cols">{TSTATUS.map(([k, l]) => <div key={k} className="col" onDragOver={(e) => e.preventDefault()} onDrop={(e) => attempt(() => update(e.dataTransfer.getData('text'), { status: k }))}>
        <div className="col-h"><b>{l}<span className="num">{rows.filter((t) => t.status === k).length}</span></b></div>
        <div className="cards">{rows.filter((t) => t.status === k).map((t) => <div key={t.id} className="kc" draggable onDragStart={(e) => e.dataTransfer.setData('text', t.id)} onClick={() => setOpen({ task: t })}>
          <span className="t">{t.title}</span><div className="row small">{t.due && <Due date={t.due} />}<Pill k={pTone[t.priority]}>{t.priority}</Pill></div></div>)}</div></div>)}</div></div>
      : <Week rows={rows} onOpen={(t) => setOpen({ task: t })} />}
    {open && <TaskModal task={open.task} preset={scope.startsWith('team:') ? { team: scope.slice(5) } : {}} onClose={() => setOpen(null)} />}
  </>;
}

function Week({ rows, onOpen }) {
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); });
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  return <div className="stack"><div className="row"><button className="btn sm" type="button" onClick={() => setStart(addDays(start, -7))}>← Previous week</button><button className="btn sm" type="button" onClick={() => setStart(addDays(start, 7))}>Next week →</button></div>
    <div className="grid3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>{days.map((d) => { const dt = parse(d); return <div key={d} className="card stack gap4" style={{ background: d === today() ? 'var(--gold-50)' : '' }}>
      <b>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} {dt.getDate()} {MONTHS[dt.getMonth()]}</b>
      {rows.filter((t) => t.due === d).map((t) => <button key={t.id} type="button" className="btn sm" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left', textDecoration: t.status === 'done' ? 'line-through' : '' }} onClick={() => onOpen(t)}>{t.remindAt ? t.remindAt + ' ' : ''}{t.title}</button>)}</div>; })}</div></div>;
}
