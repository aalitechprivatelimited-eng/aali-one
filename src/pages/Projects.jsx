import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, list, get, create, update, store } from '../api.js';
import { settings, uname, fmtDate, today, addDays, diff, pStageLabel, isManager, clientName, parse, canEdit, scope } from '../lib.js';
import { Modal, Field, In, Sel, Pick, Area, Pill, Due, Empty, Sample, Log, Comments, Attachments, DeleteButton, Person, People, attempt, toast, Seg, Avs, Message, RO, ViewOnly } from '../ui.jsx';
import { TaskModal, TaskRow, TSTATUS, tLabel } from '../task.jsx';
import { CertificateSheet } from '../doc.jsx';
import { useId } from '../App.jsx';

const WORK = ['planning', 'design', 'development', 'testing', 'live'];
export const advanceOk = (p) => !p.dealId || !!p.advance || !!get(p.dealId)?.handoff?.advance || !!p.startApproved;
export const progress = (id) => { const ts = list('task').filter((t) => t.projectId === id); return ts.length ? Math.round(100 * ts.filter((t) => t.status === 'done').length / ts.length) : 0; };
const atRisk = (p) => p.deadline && !['live', 'onhold', 'awaiting'].includes(p.stage) && (diff(p.deadline) < 0 || (diff(p.deadline) <= 7 && progress(p.id) < 70));

export default function Projects() { useStore(); const id = useId(); return id ? <ProjectView id={id} /> : <Board />; }

function Board() {
  const [add, setAdd] = useState(false), [f, setF] = useState({ lead: '', q: '' }), edit = canEdit('projects'), own = scope('projects') === 'own';
  const rows = list('project').filter((p) => (!f.lead || p.lead === f.lead) && (!f.q || `${p.name} ${clientName(p.clientId)}`.toLowerCase().includes(f.q.toLowerCase())));
  async function move(id, stage) {
    const p = get(id); if (!p || p.stage === stage) return;
    if (!edit) return toast('Your access to projects is view only.', true);
    if (stage === 'live' && !p.signoffId && !p.liveNoSign) return toast("Get the client's sign-off first. Open the project → Sign-off.", true);
    await attempt(() => update(id, { stage }), `Moved to ${pStageLabel(stage)}.`);
  }
  return <>
    <div className="topbar"><h1>{own ? 'My projects' : 'Projects'} <ViewOnly when={!edit} /></h1>{edit && !own && <button className="btn primary" type="button" onClick={() => setAdd(true)}>+ Project</button>}</div>
    <div className="stats">
      <div className="stat"><span className="l">Active</span><span className="v">{rows.filter((p) => !['live', 'onhold', 'awaiting'].includes(p.stage)).length}</span></div>
      <div className={'stat' + (rows.some(atRisk) ? ' warm' : '')}><span className="l">At risk</span><span className="v">{rows.filter(atRisk).length}</span></div>
      <div className="stat"><span className="l">Waiting for advance</span><span className="v">{rows.filter((p) => p.stage === 'awaiting').length}</span></div>
      <div className="stat"><span className="l">Need a lead</span><span className="v">{rows.filter((p) => !p.lead && !['live', 'onhold'].includes(p.stage)).length}</span></div>
    </div>
    <div className="row" style={{ marginBottom: 12 }}><In placeholder="Search projects" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ maxWidth: 260 }} /><Person value={f.lead} onChange={(v) => setF({ ...f, lead: v })} blank="All project leads" filter={(u) => u.team === 'it'} /></div>
    <div className="board"><div className="cols">{settings().projectStages.map((s) => {
      const cs = rows.filter((p) => p.stage === s.key).sort((a, b) => (!!b.priority - !!a.priority) || (a.deadline || '9').localeCompare(b.deadline || '9'));
      return <div className="col" key={s.key} onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drop'); }} onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
        onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drop'); move(e.dataTransfer.getData('text'), s.key); }}>
        <div className="col-h"><b>{s.label}<span className="num">{cs.length}</span></b></div>
        <div className="cards">{cs.map((p) => { const pr = progress(p.id); return <Link key={p.id} to={'/projects/' + p.id} className="kc" draggable onDragStart={(e) => e.dataTransfer.setData('text', p.id)}>
          <div className="row between"><span className="t">{p.name}</span><Avs ids={[p.lead, ...(p.people || [])]} /></div>
          <div className="small muted">{clientName(p.clientId) || p.clientName || 'Internal'}</div>
          <div className="bar" title={pr + '% done'}><i style={{ width: pr + '%' }} /></div>
          <div className="row">{p.deadline && !['live', 'onhold'].includes(p.stage) && <Due date={p.deadline} />}{!advanceOk(p) && p.stage !== 'live' && <Pill k="bad">Advance pending</Pill>}
            {!p.lead && p.stage !== 'live' && <Pill k="warn">Needs a lead</Pill>}{atRisk(p) && <Pill k="warn">At risk</Pill>}{p.priority && <Pill k="warn">Priority</Pill>}
            {p.signoffId ? <Pill k="ok">Signed off</Pill> : p.stage === 'live' && !p.liveNoSign ? <Pill k="bad">No sign-off</Pill> : null}<Sample on={p.sample} /></div>
        </Link>; })}</div></div>;
    })}</div></div>
    {add && <NewProject onClose={() => setAdd(false)} />}
  </>;
}

function NewProject({ onClose }) {
  const nav = useNavigate(), [f, setF] = useState({ name: '', clientId: '', deadline: addDays(today(), 30), template: '' });
  async function go() {
    const tpl = settings().projectTemplates.find((t) => t.id === f.template);
    const r = await attempt(() => create('project', { name: f.name, clientId: f.clientId, clientName: clientName(f.clientId), stage: 'planning', deadline: f.deadline, start: today(), lead: '', people: [store.me.id], template: tpl?.name || '', templateId: tpl?.id || '' }));
    if (!r) return;
    onClose(); nav('/projects/' + r.record.id);
  }
  return <Modal title="New project" onClose={onClose} footer={<button className="btn primary" type="button" disabled={!f.name.trim()} onClick={go}>Create project</button>}>
    <div className="form"><Field label="Project name *" full><In value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <Field label="Client (blank for internal work)"><Pick value={f.clientId} onChange={(v) => setF({ ...f, clientId: v })} options={list('client').map((c) => [c.id, c.name, c.city])} blank="Internal" /></Field>
      <Field label="Deadline"><In type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
      <Field label="Start from template" full><Sel value={f.template} onChange={(v) => setF({ ...f, template: v })} options={settings().projectTemplates.map((t) => [t.id, `${t.name} (${t.tasks.length} tasks)`])} blank="Empty project" /></Field>
      <p className="small muted full" style={{ margin: 0 }}>Client projects normally come from a won deal (Deal → Handoff), which also brings the advance rule.</p></div></Modal>;
}

function ProjectView({ id }) {
  const nav = useNavigate(), p = get(id), [tab, setTab] = useState('overview'), [task, setTask] = useState(null), [dl, setDl] = useState(null), [appr, setAppr] = useState(null);
  if (!p) return <Empty>This project was not found. <Link to="/projects">Back</Link></Empty>;
  const set = (data, ok) => attempt(() => update(id, data), ok), edit = canEdit('projects');
  const deal = get(p.dealId), tasks = list('task').filter((t) => t.projectId === id), pr = progress(id), so = get(p.signoffId), ok = advanceOk(p);
  const link = `${location.origin}/p/${p.progressToken}`;
  return <>
    <div className="topbar"><h1>{p.name} <small>{clientName(p.clientId) || p.clientName || 'Internal'} · {pStageLabel(p.stage)} · {pr}% done</small> <ViewOnly when={!edit} /></h1>
      <div className="row"><Link className="btn" to="/projects">All projects</Link>{deal && <Link className="btn" to={'/deals/' + deal.id}>Deal</Link>}
        {!so && ['testing', 'live'].includes(p.stage) && <Link className="btn primary" to={'/signoff/' + id}>Get client sign-off</Link>}</div></div>
    {!ok && <div className="banner bad" style={{ marginBottom: 12 }}><b>Advance not received.</b> No work at all, not even planning, until the advance receipt is made.
      {isManager() && edit ? <button className="btn sm" type="button" style={{ marginLeft: 10 }} onClick={() => setAppr({ kind: 'start' })}>Approve early start</button>
        : <button className="btn sm" type="button" style={{ marginLeft: 10 }} onClick={() => setAppr({ kind: 'start', ask: true })}>Ask a manager for an early start</button>}</div>}
    <div className="tabs" role="tablist">{[['overview', 'Overview'], ['tasks', `Tasks (${tasks.filter((t) => t.status !== 'done').length})`], ['board', 'Task board'], ['timeline', 'Timeline'], ['changes', `Changes (${(p.changes || []).filter((c) => c.status !== 'closed').length})`], ['time', 'Time'], ['signoff', 'Sign-off'], ['talk', 'Comments & files'], ['history', 'History']].map(([k, l]) =>
      <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'overview' && <div className="grid2">
      <div className="card stack"><h2>Details</h2><RO when={!edit}><div className="form">
        <Field label="Name"><In defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && set({ name: e.target.value })} /></Field>
        <Field label="Stage"><Sel value={p.stage} onChange={(v) => (v === 'live' && !so && !p.liveNoSign ? toast("Get the client's sign-off first (Sign-off tab).", true) : set({ stage: v }))} options={settings().projectStages.map((s) => [s.key, s.label])} /></Field>
        <Field label="Project lead (set by IT Manager)"><Person value={p.lead} disabled={!isManager()} onChange={(v) => set({ lead: v }, 'Lead set.')} filter={(u) => u.team === 'it'} /></Field>
        <Field label="Start"><In type="date" value={p.start || ''} onChange={(e) => set({ start: e.target.value })} /></Field>
        <Field label="Deadline"><In type="date" value={p.deadline || ''} onChange={(e) => setDl(e.target.value)} /></Field>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={!!p.priority} onChange={(e) => set({ priority: e.target.checked })} /> Priority / big client</label>
        <Field label="Also involved" full><People value={p.people || []} onChange={(people) => set({ people })} /></Field>
        <Field label="Scope (from the handoff note)" full><Area style={{ minHeight: 110 }} defaultValue={p.scope} onBlur={(e) => set({ scope: e.target.value })} /></Field>
      </div></RO><div className="row"><Sample on={p.sample} />{p.startApproved && <Pill k="info">Early start approved: {p.startApproved.reason}</Pill>}<span className="grow" />{isManager() && edit && <DeleteButton id={id} after={() => nav('/projects')} />}</div></div>
      <div className="stack">
        <div className="card stack"><h2>Progress</h2><div className="bar"><i style={{ width: pr + '%' }} /></div><div className="small">{tasks.filter((t) => t.status === 'done').length} of {tasks.length} tasks done</div>
          {tasks.filter((t) => t.milestone).map((m) => <div key={m.id} className="row small"><span>{m.status === 'done' ? '◆✓' : '◆'}</span><span className="grow">{m.title}</span><span className="num">{fmtDate(m.due)}</span></div>)}</div>
        <div className="card stack"><h2>Client progress link</h2><p className="small muted" style={{ margin: 0 }}>Share with the client. They see the stage, progress and milestones, but not internal tasks or money.</p>
          <div className="row"><In readOnly value={link} onFocus={(e) => e.target.select()} /><button className="btn sm" type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied.'))}>Copy</button><a className="btn sm" href={link} target="_blank" rel="noreferrer">Open</a></div>
          {deal?.phone && <Message phone={deal.phone} defaultId="tp-thanks" vars={{ client: (deal.contactName || '').split(' ')[0], project: p.name }} />}</div>
      </div></div>}
    <RO when={!edit}>
    {tab === 'tasks' && <div className="stack"><div className="row"><button className="btn primary" type="button" onClick={() => setTask({ preset: { projectId: id, team: 'it', owner: p.lead || store.me.id } })}>+ Task</button>
      <button className="btn" type="button" onClick={() => setTask({ preset: { projectId: id, team: 'it', owner: p.lead || store.me.id, milestone: true, clientVisible: true } })}>+ Milestone</button></div>
      {tasks.length ? <div className="list">{tasks.sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.due || '9').localeCompare(b.due || '9')).map((t) => <TaskRow key={t.id} t={t} onOpen={(x) => setTask({ task: x })} />)}</div> : <Empty>No tasks yet.</Empty>}</div>}
    {tab === 'board' && <div className="board"><div className="cols">{TSTATUS.map(([k, l]) => <div className="col" key={k} onDragOver={(e) => e.preventDefault()} onDrop={(e) => edit && attempt(() => update(e.dataTransfer.getData('text'), { status: k }))}>
      <div className="col-h"><b>{l}<span className="num">{tasks.filter((t) => t.status === k).length}</span></b></div>
      <div className="cards">{tasks.filter((t) => t.status === k).map((t) => <div key={t.id} className="kc" draggable={edit} onDragStart={(e) => e.dataTransfer.setData('text', t.id)} onClick={() => edit && setTask({ task: t })}>
        <span className="t">{t.milestone ? '◆ ' : ''}{t.title}</span><div className="row small">{t.due && <Due date={t.due} />}<span className="muted">{uname(t.owner)}</span></div></div>)}</div></div>)}</div></div>}
    {tab === 'timeline' && <Timeline p={p} tasks={tasks} onOpen={(t) => edit && setTask({ task: t })} />}
    {tab === 'changes' && <Changes p={p} set={set} />}
    </RO>
    {tab === 'time' && <TimeTab tasks={tasks} />}
    {tab === 'signoff' && <div className="stack">{so ? <><div className="row no-print"><Pill k="ok">Signed by {so.signerName}</Pill><span>{'★'.repeat(+so.rating || 0)}</span><span className="muted">{so.ratingComment}</span><span className="grow" /><button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button></div>
      <div className="paper-wrap"><CertificateSheet s={so} project={p} /></div></> : <div className="card stack"><p style={{ margin: 0 }}>When the work is ready, hand your phone or tablet to the client. They sign on screen, a photo can be taken with their consent, and they rate the work. The project then moves to Live.</p>
        {(p.changes || []).some((c) => c.status === 'open') && <div className="banner">There are open client changes. Finish them, or tell the client before they sign.</div>}
        <div className="row"><Link className="btn primary" to={'/signoff/' + id}>Get client sign-off</Link>
          {!p.liveNoSign && <button className="btn" type="button" onClick={() => setAppr({ kind: 'nosign', ask: !(isManager() && edit) })}>{isManager() && edit ? 'Allow Live without sign-off' : 'Ask to go Live without sign-off'}</button>}
          {p.liveNoSign && <Pill k="info">Live without sign-off allowed: {p.liveNoSign.reason}</Pill>}</div></div>}</div>}
    {tab === 'talk' && <div className="grid2"><div className="card stack"><h2>Comments</h2><Comments relType="project" relId={id} /></div><div className="card stack"><h2>Files</h2><RO when={!edit}><Attachments value={p.files || []} onChange={(files) => set({ files })} /></RO></div></div>}
    {tab === 'history' && <div className="card"><Log items={p.log} /></div>}
    {task && <TaskModal task={task.task} preset={task.preset} onClose={() => setTask(null)} />}
    {dl !== null && <Reason title="Why is the deadline changing?" hint="Everyone involved, including the BDE, is told." onClose={() => setDl(null)} onSave={(r) => set({ deadline: dl, _reason: r }, 'Deadline changed. Everyone involved was told.').then((x) => x && setDl(null))} />}
    {appr && <Reason title={appr.kind === 'start' ? 'Approve early start without advance' : 'Allow Live without client sign-off'} hint="Recorded in the project history." onClose={() => setAppr(null)}
      onSave={(r) => appr.ask ? attempt(() => create('approval', { kind: appr.kind === 'start' ? 'earlystart' : 'livenosign', relType: 'project', relId: id, reason: `${appr.kind === 'start' ? 'Start without advance' : 'Live without sign-off'} – ${p.name}: ${r}` }), 'Sent to the managers for approval.').then((x) => x && setAppr(null)) : set(appr.kind === 'start' ? { startApproved: { by: store.me.id, at: today(), reason: r }, stage: p.stage === 'awaiting' ? 'planning' : p.stage } : { liveNoSign: { by: store.me.id, at: today(), reason: r } }, 'Approved.').then((x) => x && setAppr(null))} />}
  </>;
}

export function Reason({ title, hint, onClose, onSave }) {
  const [r, setR] = useState('');
  return <Modal title={title} onClose={onClose} footer={<button className="btn primary" type="button" disabled={r.trim().length < 3} onClick={() => onSave(r.trim())}>Save</button>}>
    <Field label="Reason *" hint={hint}><In value={r} onChange={(e) => setR(e.target.value)} autoFocus /></Field></Modal>;
}

function Timeline({ p, tasks, onOpen }) {
  const dated = tasks.filter((t) => t.due);
  if (!dated.length) return <Empty>Add tasks with due dates to see the timeline.</Empty>;
  const start = [p.start, ...dated.map((t) => t.start || (t.createdAt || '').slice(0, 10))].filter(Boolean).sort()[0] || today();
  const end = [p.deadline, ...dated.map((t) => t.due)].filter(Boolean).sort().pop();
  const span = Math.max(7, (parse(end) - parse(start)) / 864e5 + 1), x = (d) => ((parse(d) - parse(start)) / 864e5 / span) * 100;
  return <div className="card stack"><div className="small muted">{fmtDate(start)} → {fmtDate(end)} · bars run from start to due date; ◆ is a milestone; the red line is today.</div>
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: `calc(220px + (100% - 220px) * ${Math.min(100, Math.max(0, x(today()))) / 100})`, top: 0, bottom: 0, borderLeft: '2px solid var(--bad)', opacity: .5 }} />
      {dated.sort((a, b) => a.due.localeCompare(b.due)).map((t) => { const s = t.start || (t.createdAt || '').slice(0, 10) || t.due, l = Math.max(0, x(s)), w = Math.max(1.5, x(t.due) - l);
        return <div key={t.id} className="row" style={{ flexWrap: 'nowrap', padding: '3px 0', cursor: 'pointer' }} onClick={() => onOpen(t)}>
          <div style={{ width: 210, flex: 'none', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.milestone ? '◆ ' : ''}{t.title}</div>
          <div style={{ flex: 1, position: 'relative', height: 16, background: 'var(--gold-50)', borderRadius: 4 }}>
            <div title={`${fmtDate(s)} – ${fmtDate(t.due)} · ${tLabel(t.status)}${t.dependsOn ? ' · waits for ' + (get(t.dependsOn)?.title || '') : ''}`} style={{ position: 'absolute', left: l + '%', width: w + '%', top: 2, bottom: 2, borderRadius: 3,
              background: t.status === 'done' ? 'var(--ok)' : diff(t.due) < 0 ? 'var(--bad)' : t.milestone ? 'var(--gold-strong)' : 'var(--gold)' }} /></div></div>; })}
    </div></div>;
}

function Changes({ p, set }) {
  const [f, setF] = useState({ text: '', from: 'client', severity: 'normal', owner: p.lead || '' });
  const items = p.changes || [];
  const put = (changes, ok) => set({ changes }, ok);
  return <div className="stack">
    <div className="card form"><Field label="Change or problem" full><In value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="e.g. Logo too small on mobile" /></Field>
      <Field label="From"><Seg value={f.from} onChange={(v) => setF({ ...f, from: v })} options={[['client', 'Client'], ['team', 'Our team']]} /></Field>
      <Field label="Severity"><Sel value={f.severity} onChange={(v) => setF({ ...f, severity: v })} options={[['high', 'High'], ['normal', 'Normal'], ['low', 'Low']]} /></Field>
      <Field label="Who fixes it"><Person value={f.owner} onChange={(v) => setF({ ...f, owner: v })} filter={(u) => u.team === 'it'} /></Field>
      <div className="row full"><button className="btn primary" type="button" disabled={!f.text.trim()} onClick={() => put([{ ...f, id: Date.now().toString(36), status: 'open', at: new Date().toISOString(), by: store.me.id }, ...items], 'Change logged.').then(() => setF({ ...f, text: '' }))}>Log change</button>
        <span className="small muted">Extra work outside the scope goes back to the BDE for a new quotation.</span></div></div>
    {items.length ? <div className="list">{items.map((c) => <div key={c.id} className="li"><Pill k={c.severity === 'high' ? 'bad' : ''}>{c.severity}</Pill><div className="grow"><div className="t">{c.text}</div>
      <div className="small muted">From {c.from} · {fmtDate(c.at.slice(0, 10))} · {uname(c.owner)}</div></div>
      <Sel value={c.status} onChange={(v) => put(items.map((x) => (x.id === c.id ? { ...x, status: v } : x)), 'Updated.')} options={[['open', 'Open'], ['fixed', 'Fixed – to test'], ['closed', 'Closed']]} style={{ width: 'auto' }} /></div>)}</div> : <Empty>No changes logged.</Empty>}
  </div>;
}

function TimeTab({ tasks }) {
  const rows = tasks.map((t) => ({ t, spent: (t.timeLogs || []).reduce((s, l) => s + (+l.hours || 0), 0) }));
  const byPerson = {}; tasks.forEach((t) => (t.timeLogs || []).forEach((l) => (byPerson[l.by] = (byPerson[l.by] || 0) + (+l.hours || 0))));
  const plan = rows.reduce((s, r) => s + (+r.t.estimate || 0), 0), act = rows.reduce((s, r) => s + r.spent, 0);
  return <div className="grid2"><div className="card stack"><h2>Planned vs actual</h2><div className="stats"><div className="stat"><span className="l">Planned</span><span className="v">{plan} h</span></div><div className={'stat' + (act > plan && plan ? ' warm' : '')}><span className="l">Actual</span><span className="v">{act} h</span></div></div>
    <div className="tbl"><table><thead><tr><th>Task</th><th className="n">Planned</th><th className="n">Actual</th></tr></thead><tbody>{rows.filter((r) => r.spent || r.t.estimate).map((r) => <tr key={r.t.id}><td>{r.t.title}</td><td className="n">{r.t.estimate || '—'}</td><td className="n">{r.spent}</td></tr>)}</tbody></table></div></div>
    <div className="card stack"><h2>Hours by person</h2>{Object.entries(byPerson).map(([u, h]) => <div key={u} className="row"><span className="grow">{uname(u)}</span><span className="num">{h} h</span></div>)}{!Object.keys(byPerson).length && <p className="small muted">Log time from any task.</p>}</div></div>;
}
