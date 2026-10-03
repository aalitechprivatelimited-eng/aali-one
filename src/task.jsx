// One task editor, used by Tasks (Zoho ToDo) and inside Projects (Zoho Projects).
import { useState } from 'react';
import { list, get, create, update, store } from './api.js';
import { uname, fmtDate, today, TEAMS, scope, isManager, canEdit } from './lib.js';
import { Modal, Field, In, Sel, Area, Pill, Due, Person, People, Comments, Attachments, DeleteButton, RO, attempt } from './ui.jsx';

export const PRIORITY = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
export const TSTATUS = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['waiting', 'Waiting for client'], ['done', 'Done']];
export const REPEAT = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']];
export const tLabel = (s) => TSTATUS.find((x) => x[0] === s)?.[1] || s;
export const pTone = { high: 'bad', medium: 'warn', low: 'info' };
// A task on a team list can be read by the whole team; only the people it is given to, the person who made it, or a manager can change it.
export const canChange = (t) => { const me = store.me.id; return t.projectId ? canEdit('projects') : t.owner === me || t.createdBy === me || (t.people || []).includes(me) || isManager(); };
export const blocked = (t) => t.dependsOn && get(t.dependsOn) && get(t.dependsOn).status !== 'done';

export function TaskModal({ task, preset = {}, onClose }) {
  const [t, setT] = useState(task ? { ...task } : { title: '', owner: store.me.id, due: today(), priority: 'medium', status: 'todo', recurrence: 'none', subtasks: [], people: [], ...preset });
  const [sub, setSub] = useState(''), [hrs, setHrs] = useState('');
  const up = (k) => (v) => setT({ ...t, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v });
  const siblings = t.projectId ? list('task').filter((x) => x.projectId === t.projectId && x.id !== t.id) : [];
  const spent = (t.timeLogs || []).reduce((s, l) => s + (+l.hours || 0), 0), mine = !task || canChange(task);
  async function save() {
    const data = { ...t }; ['id', 'type', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample'].forEach((k) => delete data[k]);
    const ok = task ? await attempt(() => update(task.id, data), 'Task saved.') : await attempt(() => create('task', data), 'Task added.');
    if (ok) onClose();
  }
  return (
    <Modal wide title={task ? 'Task' : 'New task'} onClose={onClose} footer={<>
      <span>{task && mine && <DeleteButton id={task.id} label="Move to trash" after={onClose} />}{!mine && <span className="small muted">This task belongs to {uname(task.owner)}. You can read it; only they or a manager can change it.</span>}</span>
      <span className="row"><button className="btn" type="button" onClick={onClose}>{mine ? 'Cancel' : 'Close'}</button>{mine && <button className="btn primary" type="button" onClick={save}>Save task</button>}</span></>}>
      <RO when={!mine}><div className="form">
        <Field label="Task *" full><In value={t.title} onChange={up('title')} autoFocus placeholder="e.g. Design home page" /></Field>
        <Field label="Owner"><Person value={t.owner} onChange={up('owner')} /></Field>
        <Field label="Due date"><In type="date" value={t.due || ''} onChange={up('due')} /></Field>
        <Field label="Reminder time"><In type="time" value={t.remindAt || ''} onChange={up('remindAt')} /></Field>
        <Field label="Start date"><In type="date" value={t.start || ''} onChange={up('start')} /></Field>
        <Field label="Priority"><Sel value={t.priority} onChange={up('priority')} options={PRIORITY} /></Field>
        <Field label="Status"><Sel value={t.status} onChange={up('status')} options={TSTATUS} /></Field>
        <Field label="Repeats"><Sel value={t.recurrence || 'none'} onChange={up('recurrence')} options={REPEAT} /></Field>
        {!t.projectId && <Field label="Team list"><Sel value={t.team || ''} onChange={up('team')} options={scope('tasks') === 'all' ? TEAMS : { [store.me.team]: TEAMS[store.me.team] }} blank="Personal (only me + people involved)" /></Field>}
        <Field label="Category"><In value={t.category || ''} onChange={up('category')} placeholder="e.g. Design, Content" /></Field>
        <Field label="Tags" hint="Comma separated"><In value={(t.tags || []).join(', ')} onChange={(e) => setT({ ...t, tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
        {t.projectId && <>
          <Field label="Waits for (dependency)"><Sel value={t.dependsOn || ''} onChange={up('dependsOn')} options={siblings.map((s) => [s.id, s.title])} blank="Nothing" /></Field>
          <Field label="Planned hours"><In type="number" min="0" value={t.estimate || ''} onChange={up('estimate')} /></Field>
          <label className="check"><input type="checkbox" checked={!!t.milestone} onChange={up('milestone')} /> Milestone (a checkpoint; not linked to bills)</label>
          <label className="check"><input type="checkbox" checked={!!t.clientVisible} onChange={up('clientVisible')} /> Show on the client's progress page</label>
        </>}
        <Field label="Also involved" full><People value={t.people || []} onChange={up('people')} /></Field>
        <Field label="Details" full><Area value={t.desc || ''} onChange={up('desc')} /></Field>
        <div className="full stack gap4"><span className="lbl">Subtasks</span>
          {(t.subtasks || []).map((s, i) => <label key={i} className="check"><input type="checkbox" checked={s.done} onChange={(e) => setT({ ...t, subtasks: t.subtasks.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
            <span className="grow" style={{ textDecoration: s.done ? 'line-through' : '' }}>{s.t}</span><button type="button" className="btn ghost sm" onClick={() => setT({ ...t, subtasks: t.subtasks.filter((_, j) => j !== i) })}>×</button></label>)}
          <div className="row"><In value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Add a subtask" onKeyDown={(e) => { if (e.key === 'Enter' && sub.trim()) { setT({ ...t, subtasks: [...(t.subtasks || []), { t: sub.trim(), done: false }] }); setSub(''); } }} style={{ maxWidth: 360 }} />
            <button className="btn sm" type="button" disabled={!sub.trim()} onClick={() => { setT({ ...t, subtasks: [...(t.subtasks || []), { t: sub.trim(), done: false }] }); setSub(''); }}>Add</button></div></div>
        {t.projectId && <div className="full stack gap4"><span className="lbl">Time spent: {spent} h{t.estimate ? ` of ${t.estimate} h planned` : ''}</span>
          {(t.timeLogs || []).map((l, i) => <div key={i} className="small">{fmtDate(l.at)} · {uname(l.by)} · {l.hours} h {l.note}</div>)}
          <div className="row"><In type="number" min="0" step="0.25" value={hrs} onChange={(e) => setHrs(e.target.value)} placeholder="Hours" style={{ maxWidth: 120 }} />
            <button className="btn sm" type="button" disabled={!(+hrs > 0)} onClick={() => { setT({ ...t, timeLogs: [...(t.timeLogs || []), { at: today(), by: store.me.id, hours: +hrs }] }); setHrs(''); }}>Log time</button></div></div>}
        <div className="full stack gap4"><span className="lbl">Files</span><Attachments value={t.files || []} onChange={(files) => setT({ ...t, files })} /></div>
      </div></RO>
      {task && <div className="stack gap4" style={{ marginTop: 12 }}><span className="lbl">Comments</span><Comments relType="task" relId={task.id} /></div>}
    </Modal>
  );
}

export function TaskRow({ t, onOpen }) {
  const doneSubs = (t.subtasks || []).filter((s) => s.done).length;
  return (
    <div className="li">
      <input type="checkbox" aria-label={'Done: ' + t.title} checked={t.status === 'done'} disabled={!canChange(t)} title={canChange(t) ? '' : `Only ${uname(t.owner)} or a manager can tick this`} onChange={(e) => attempt(() => update(t.id, { status: e.target.checked ? 'done' : 'todo' }), e.target.checked ? 'Done.' : 'Reopened.')} />
      <button type="button" className="grow" style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }} onClick={() => onOpen(t)}>
        <div className="t" style={{ textDecoration: t.status === 'done' ? 'line-through' : '' }}>{t.milestone ? '◆ ' : ''}{t.title}</div>
        <div className="row small">{t.due && t.status !== 'done' && <Due date={t.due} />}<Pill k={pTone[t.priority]}>{PRIORITY.find((p) => p[0] === t.priority)?.[1] || 'Medium'}</Pill><Pill>{tLabel(t.status)}</Pill>
          {t.subtasks?.length ? <span className="muted">{doneSubs}/{t.subtasks.length} subtasks</span> : null}{blocked(t) && <Pill k="warn">Waits for: {get(t.dependsOn).title}</Pill>}
          {t.recurrence && t.recurrence !== 'none' && <span className="muted">↻ {REPEAT.find((r) => r[0] === t.recurrence)?.[1]}</span>}{t.category && <Pill k="gold">{t.category}</Pill>}
          {(t.tags || []).map((g) => <Pill key={g}>{g}</Pill>)}<span className="muted">{uname(t.owner)}</span></div>
      </button>
    </div>
  );
}
