import { useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { useStore, store, http, saveSetting, setMe, upsertUser, poll } from '../api.js';
import { settings, isManager, TITLES, TEAMS, uname, fmtDT, waLink, myJuniors, canAddPeople } from '../lib.js';
import { Field, In, Sel, Area, Pill, Empty, Modal, attempt, toast } from '../ui.jsx';
import { TITLE_TEAM } from '../../shared/defaults.js';
import { ThemeToggle } from '../theme.jsx';

export default function Settings() {
  useStore(); const admin = store.me.isAdmin;
  const L = ({ to, children }) => <NavLink to={'/settings/' + to} className={({ isActive }) => 'btn sm' + (isActive ? ' primary' : '')}>{children}</NavLink>;
  return <>
    <div className="topbar"><h1>Settings</h1></div>
    <div className="row" style={{ marginBottom: 16 }}><L to="me">My profile</L>{canAddPeople() && <L to="people">{admin ? 'People & teams' : 'My team members'}</L>}{admin && <L to="business">Letterhead & documents</L>}{admin && <L to="sales">Sales setup</L>}
      {admin && <L to="templates">Message templates</L>}{admin && <L to="plans">Follow-up plans & quick actions</L>}{admin && <L to="projects">Project templates</L>}<L to="connections">Connections</L>
      {isManager() && <L to="audit">Audit log</L>}{admin && <L to="trash">Recycle bin</L>}{admin && <L to="data">Sample data</L>}<L to="help">Help</L></div>
    <Routes>
      <Route path="me" element={<Me />} /><Route path="people" element={<People />} /><Route path="business" element={<Business />} /><Route path="sales" element={<Sales />} />
      <Route path="templates" element={<Templates />} /><Route path="plans" element={<Plans />} /><Route path="projects" element={<ProjTemplates />} /><Route path="connections" element={<Connections />} />
      <Route path="audit" element={<Audit />} /><Route path="trash" element={<Trash />} /><Route path="data" element={<Data />} /><Route path="help" element={<Help />} /><Route path="*" element={<Navigate to="me" replace />} />
    </Routes>
  </>;
}

function Me() {
  const me = store.me, [f, setF] = useState({ name: me.name, phone: me.phone, currentPassword: '', password: '' });
  return <div className="card stack" style={{ maxWidth: 520 }}><h2>My profile</h2>
    <Field label="Name"><In value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="Mobile (for WhatsApp lists)"><In value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
    <Field label="Role"><In value={TITLES[me.title]} disabled /></Field>
    <h3>Change password</h3><Field label="Current password"><In type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} autoComplete="current-password" /></Field>
    <Field label="New password (8+ characters)"><In type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
    <button className="btn primary" type="button" onClick={async () => { const r = await attempt(() => http('PATCH', '/users/' + me.id, { name: f.name, phone: f.phone, ...(f.password ? { password: f.password, currentPassword: f.currentPassword } : {}) }), 'Saved.'); if (r) { setMe(r.user); setF({ ...f, password: '', currentPassword: '' }); } }}>Save</button>
    <div className="row"><span className="lbl">Look</span><ThemeToggle label /></div>
    <p className="small muted">Install on your phone: open Aali One in Chrome → menu → “Add to Home screen”.</p></div>;
}

const TEAM_ROLES = { sales: ['salesmgr', 'bde'], it: ['itmgr', 'itlead', 'dev'], management: ['ops', 'cs', 'chairman'] };
const TEAM_NOTE = { sales: 'Sales Manager and BDEs. They work on leads, deals, quotations and payments.', it: 'IT Manager, Team Lead and developers. They deliver the projects.', management: 'Operations Manager, Company Secretary and Chairman. They see every department.' };
// What each role can see and do, in plain words. Shown next to every person and when a role is chosen.
const ACCESS = {
  bde: ['Works on own leads, deals, quotations and payments', 'Writes a daily report; sees only their own'],
  salesmgr: ['Sees the whole Sales team’s work', 'Reads and reviews Sales daily reports', 'Approves discounts; adds BDEs', 'Writes a daily report'],
  dev: ['Works on own tasks and projects', 'Writes a daily report; sees only their own'],
  itlead: ['Leads projects and their tasks', 'Writes a daily report', 'Reads developers’ reports only when the Operations Manager switches that on'],
  itmgr: ['Sees the whole IT team’s work', 'Reads and reviews IT daily reports', 'Approves early starts; adds Team Leads and developers', 'Writes a daily report'],
  ops: ['Sees every department', 'Reads all daily reports', 'Controls the Team Lead report switch', 'Does not write a daily report'],
  cs: ['Sees every department', 'Reads all daily reports', 'Does not write a daily report'],
  chairman: ['Sees every department', 'Reads all daily reports and can remark', 'Does not write a daily report'],
  admin: ['Sees every department'],
};
const ADMIN_ACCESS = 'Admin: adds people in any team, changes settings, sends back or deletes reports, opens the recycle bin';
const accessOf = (u) => [...(ACCESS[u.title] || []), ...(u.isAdmin ? [ADMIN_ACCESS] : [])];
const newPassword = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return 'Aali-' + [...a].map((n) => n.toString(36)).join('').slice(0, 9); };
// Pick a role by reading what it can do, instead of a bare dropdown.
function RolePicker({ roles, value, onChange }) {
  return <div className="roles" role="radiogroup" aria-label="Role">{roles.map((k) => <label key={k} className={'rolecard' + (value === k ? ' on' : '')}>
    <input type="radio" name="role" checked={value === k} onChange={() => onChange(k)} /><div><b>{TITLES[k]}</b> <span className="small muted">· {TEAMS[TITLE_TEAM[k]]} team</span>
      <ul>{ACCESS[k].map((x) => <li key={x}>{x}</li>)}</ul></div></label>)}</div>;
}
// People are added here, team by team. Nothing needs to be done in the database.
function People() {
  const [add, setAdd] = useState(null), [pw, setPw] = useState(null), [made, setMade] = useState(null), [busy, setBusy] = useState(false), [edit, setEdit] = useState(null);
  const me = store.me, adm = me.isAdmin, jun = myJuniors(), can = (u) => adm || (u.id !== me.id && jun.includes(u.title) && !u.isAdmin);
  if (!canAddPeople()) return <Empty>Only an admin or a department manager can add people.</Empty>;
  const patch = (u, data, ok) => attempt(async () => upsertUser((await http('PATCH', '/users/' + u.id, data)).user), ok);
  const rolesFor = (team) => (adm ? TEAM_ROLES[team] : jun);
  async function save() {
    setBusy(true); const r = await attempt(() => http('POST', '/users', add)); setBusy(false);
    if (r) { upsertUser(r.user); setMade({ ...r.user, password: add.password }); setAdd(null); }
  }
  async function saveEdit() {
    setBusy(true); const ok = await patch(edit.u, { title: edit.title, ...(adm && edit.u.id !== me.id ? { isAdmin: edit.isAdmin } : {}) }, 'Access changed.'); setBusy(false); if (ok) setEdit(null);
  }
  const loginText = (u) => `Hi ${u.name.split(' ')[0]}, your Aali One login:\n${location.origin}\nEmail: ${u.email}\nPassword: ${u.password}\nPlease change the password after you sign in (Settings → My profile).`;
  return <div className="stack gap16">
    <p className="small muted" style={{ margin: 0 }}>{adm ? 'Add each person under their team. Beside every name you can read exactly what that person can see and do.' : 'Add and look after the members of your own team. Other teams and manager roles are handled by the Operations Manager or Company Secretary.'}</p>
    {Object.entries(TEAMS).filter(([team]) => adm || team === me.team).map(([team, label]) => { const us = store.users.filter((u) => u.team === team).sort((x, y) => TEAM_ROLES[team].indexOf(x.title) - TEAM_ROLES[team].indexOf(y.title) || x.name.localeCompare(y.name));
      return <section key={team} className="stack" style={{ gap: 8 }}>
        <div className="row between"><div><h2 style={{ margin: 0 }}>{label} team <span className="small muted">{us.filter((u) => u.active).length} active</span></h2><span className="small muted">{TEAM_NOTE[team]}</span></div>
          <button className="btn primary" type="button" onClick={() => setAdd({ team, title: rolesFor(team).at(-1), password: newPassword() })}>+ Add {label} member</button></div>
        {us.length ? <div className="tbl"><table><thead><tr><th>Person</th><th>Role</th><th>What they can see and do</th><th>Active</th><th /></tr></thead><tbody>
          {us.map((u) => <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
            <td><b>{u.name}</b>{u.id === me.id && <span className="small muted"> (you)</span>}<div className="small muted">{u.email}</div><div className="small muted num">{u.phone || 'No mobile'}</div></td>
            <td><Pill k="gold">{TITLES[u.title] || u.title}</Pill>{u.isAdmin && <> <Pill k="info">Admin</Pill></>}</td>
            <td><ul className="access">{accessOf(u).map((x) => <li key={x}>{x}</li>)}</ul></td>
            <td><input type="checkbox" aria-label={`${u.name} can sign in`} checked={u.active} disabled={!can(u) || u.id === me.id} onChange={(e) => patch(u, { active: e.target.checked }, e.target.checked ? 'Switched on.' : 'Switched off. They can no longer sign in.')} /></td>
            <td>{can(u) && <div className="row" style={{ justifyContent: 'flex-end' }}>{(adm || jun.length > 1) && <button className="btn sm" type="button" onClick={() => setEdit({ u, title: u.title, isAdmin: u.isAdmin })}>Change access</button>}
              <button className="btn sm" type="button" onClick={() => setPw({ ...u, p: newPassword() })}>Set password</button></div>}</td></tr>)}</tbody></table></div>
          : <Empty>No one in the {label} team yet.</Empty>}
      </section>; })}
    {add && <Modal wide title={`Add ${TEAMS[add.team]} member`} onClose={() => setAdd(null)} footer={<><button className="btn" type="button" onClick={() => setAdd(null)}>Cancel</button>
      <button className="btn primary" type="button" disabled={busy || !add.name?.trim() || !add.email?.trim() || (add.password || '').length < 8} onClick={save}>{busy ? 'Adding…' : 'Add member'}</button></>}>
      <div className="form">
        <Field label="Full name"><In value={add.name || ''} onChange={(e) => setAdd({ ...add, name: e.target.value })} autoFocus /></Field>
        <Field label="Mobile (for WhatsApp)"><In value={add.phone || ''} inputMode="tel" onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></Field>
        <Field label="Email (this is their login)" full><In type="email" value={add.email || ''} onChange={(e) => setAdd({ ...add, email: e.target.value })} autoComplete="off" /></Field>
        <Field label="First password (8+ characters)" full hint="They can change it after signing in."><div className="row"><In className="in grow" value={add.password || ''} onChange={(e) => setAdd({ ...add, password: e.target.value })} autoComplete="new-password" />
          <button className="btn sm" type="button" onClick={() => setAdd({ ...add, password: newPassword() })}>New one</button></div></Field>
        <Field label={`Role in the ${TEAMS[add.team]} team – choose what this person should be able to do`} full><RolePicker roles={rolesFor(add.team)} value={add.title} onChange={(v) => setAdd({ ...add, title: v })} /></Field>
        {adm && add.team === 'management' && <label className="check full"><input type="checkbox" checked={!!add.isAdmin} onChange={(e) => setAdd({ ...add, isAdmin: e.target.checked })} /> <span><b>Also make them an admin</b><br /><span className="small muted">{ADMIN_ACCESS}</span></span></label>}</div></Modal>}
    {edit && <Modal wide title={`Access for ${edit.u.name}`} onClose={() => setEdit(null)} footer={<><button className="btn" type="button" onClick={() => setEdit(null)}>Cancel</button>
      <button className="btn primary" type="button" disabled={busy || (edit.title === edit.u.title && edit.isAdmin === edit.u.isAdmin)} onClick={saveEdit}>Save access</button></>}>
      <div className="stack">{(adm ? Object.keys(TEAMS) : [edit.u.team]).map((t) => <div key={t}><span className="lbl">{TEAMS[t]} team</span><RolePicker roles={rolesFor(t)} value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} /></div>)}
        {TITLE_TEAM[edit.title] !== edit.u.team && <div className="banner">This moves {edit.u.name.split(' ')[0]} from the {TEAMS[edit.u.team]} team to the {TEAMS[TITLE_TEAM[edit.title]]} team.</div>}
        {adm && <label className="check"><input type="checkbox" checked={!!edit.isAdmin} disabled={edit.u.id === me.id} onChange={(e) => setEdit({ ...edit, isAdmin: e.target.checked })} /> <span><b>Admin</b>{edit.u.id === me.id && <span className="small muted"> (you cannot remove your own admin right)</span>}<br /><span className="small muted">{ADMIN_ACCESS}</span></span></label>}</div></Modal>}
    {made && <Modal title={`${made.name} is added`} onClose={() => setMade(null)} footer={<button className="btn primary" type="button" onClick={() => setMade(null)}>Done</button>}>
      <div className="stack"><div className="banner ok">Added to the {TEAMS[made.team]} team as {TITLES[made.title]}. Share this login with them privately. The password is shown only now.</div>
        <textarea className="in" readOnly value={loginText(made)} style={{ minHeight: 120 }} />
        <div className="row"><button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(loginText(made)).then(() => toast('Copied.'), () => toast('Select the text and copy it.', true))}>Copy</button>
          {waLink(made.phone, loginText(made)) ? <a className="btn wa" href={waLink(made.phone, loginText(made))} target="_blank" rel="noreferrer">Send on WhatsApp</a> : <span className="small muted">Add a mobile number to send it on WhatsApp.</span>}</div></div></Modal>}
    {pw && <Modal title={`New password for ${pw.name}`} onClose={() => setPw(null)} footer={<button className="btn primary" type="button" disabled={(pw.p || '').length < 8} onClick={async () => (await attempt(() => http('PATCH', '/users/' + pw.id, { password: pw.p }), 'Password set. They are signed out everywhere.')) && setPw(null)}>Set password</button>}>
      <Field label="New password (8+ characters)" hint="Note it down and share it with them privately before you press Set password."><In value={pw.p || ''} onChange={(e) => setPw({ ...pw, p: e.target.value })} autoComplete="new-password" /></Field></Modal>}
  </div>;
}

function useDraft(key) { const [v, setV] = useState(() => structuredClone(settings()[key])); return [v, setV, () => attempt(() => saveSetting(key, v), 'Saved.')]; }

function Business() {
  const [b, setB, save] = useDraft('business'); const up = (k) => (e) => setB({ ...b, [k]: e.target.value });
  const F = (k, l, area) => <Field label={l} full={area}>{area ? <Area value={b[k] || ''} onChange={up(k)} style={{ minHeight: 90 }} /> : <In value={b[k] || ''} onChange={up(k)} />}</Field>;
  return <div className="card stack" style={{ maxWidth: 820 }}><h2>Letterhead & documents</h2><p className="small muted" style={{ margin: 0 }}>Used on every quotation, invoice, receipt and certificate.</p>
    <div className="form">{F('name', 'Business name')}{F('parentLine', 'Line under the name')}{F('phone', 'Phone')}{F('email', 'Email')}{F('website', 'Website')}{F('gstin', 'GSTIN')}{F('pan', 'PAN')}{F('state', 'State (place of supply)')}
      {F('address', 'Address', true)}{F('bank', 'Payment / bank details', true)}{F('quoteTerms', 'Quotation terms', true)}{F('receiptTerms', 'Receipt terms', true)}
      {F('quotePrefix', 'Quotation prefix (AC → AC/2026-27/001)')}{F('receiptPrefix', 'Receipt prefix (ACY → ACY-300926/001)')}{F('invoicePrefix', 'Invoice prefix')}{F('signName', 'Signatory name')}{F('signRole', 'Signatory designation')}</div>
    <button className="btn primary" type="button" onClick={save}>Save</button></div>;
}

function Lines({ label, value, onChange }) { return <Field label={label} hint="One per line"><Area value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} onBlur={(e) => onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} style={{ minHeight: 120 }} /></Field>; }
function Sales() {
  const s = settings(), [pipe, setPipe] = useState(structuredClone(s.pipeline)), [srv, setSrv] = useState(structuredClone(s.services)), [src, setSrc] = useState(s.sources), [lost, setLost] = useState(s.lostReasons);
  const [disc, setDisc] = useState(s.discountApprovalPct), [esc, setEsc] = useState(s.escalateDays);
  return <div className="stack gap16" style={{ maxWidth: 900 }}>
    <div className="card stack"><h2>Deal stages and win chance</h2><p className="small muted" style={{ margin: 0 }}>Win chance is used for “likely income”. Stage keys stay the same; you can rename them.</p>
      {pipe.map((p, i) => <div key={p.key} className="row"><In value={p.label} onChange={(e) => setPipe(pipe.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ maxWidth: 260 }} />
        <In type="number" min="0" max="100" value={p.p} onChange={(e) => setPipe(pipe.map((x, j) => (j === i ? { ...x, p: +e.target.value } : x)))} style={{ maxWidth: 90 }} /><span className="small muted">%</span></div>)}
      <button className="btn primary sm" type="button" onClick={() => attempt(() => saveSetting('pipeline', pipe), 'Saved.')}>Save stages</button></div>
    <div className="card stack"><h2>Services and standard prices</h2><p className="small muted" style={{ margin: 0 }}>Used in enquiries, deals and quotation quick-add.</p>
      {srv.map((x, i) => <div key={x.id} className="row"><In value={x.name} onChange={(e) => setSrv(srv.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} style={{ maxWidth: 240 }} />
        <In type="number" value={x.rate} onChange={(e) => setSrv(srv.map((y, j) => (j === i ? { ...y, rate: +e.target.value } : y)))} style={{ maxWidth: 120 }} /><In value={x.unit} onChange={(e) => setSrv(srv.map((y, j) => (j === i ? { ...y, unit: e.target.value } : y)))} style={{ maxWidth: 90 }} />
        <In value={x.note} onChange={(e) => setSrv(srv.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} style={{ flex: 1, minWidth: 200 }} /><button className="btn ghost sm" type="button" onClick={() => setSrv(srv.filter((_, j) => j !== i))}>Remove</button></div>)}
      <div className="row"><button className="btn sm" type="button" onClick={() => setSrv([...srv, { id: 'svc-' + Date.now().toString(36), name: 'New service', unit: 'Project', rate: 0, note: '' }])}>+ Service</button><button className="btn primary sm" type="button" onClick={() => attempt(() => saveSetting('services', srv), 'Saved.')}>Save services</button></div></div>
    <div className="grid2"><div className="card stack"><Lines label="Lead sources" value={src} onChange={setSrc} /><button className="btn primary sm" type="button" onClick={() => attempt(() => saveSetting('sources', src.filter(Boolean)), 'Saved.')}>Save sources</button></div>
      <div className="card stack"><Lines label="Reasons a deal is lost" value={lost} onChange={setLost} /><button className="btn primary sm" type="button" onClick={() => attempt(() => saveSetting('lostReasons', lost.filter(Boolean)), 'Saved.')}>Save reasons</button></div></div>
    <div className="card form"><Field label="Discount above this % needs a manager's OK"><In type="number" value={disc} onChange={(e) => setDisc(e.target.value)} /></Field>
      <Field label="Escalate to top management after (days late)"><In type="number" value={esc} onChange={(e) => setEsc(e.target.value)} /></Field>
      <button className="btn primary sm" type="button" style={{ alignSelf: 'end' }} onClick={() => attempt(async () => { await saveSetting('discountApprovalPct', +disc); await saveSetting('escalateDays', +esc); }, 'Saved.')}>Save limits</button></div>
  </div>;
}

function Templates() {
  const [t, setT, save] = useDraft('templates');
  return <div className="card stack" style={{ maxWidth: 820 }}><h2>Message templates</h2><p className="small muted" style={{ margin: 0 }}>Placeholders: {'{client} {me} {service} {quote} {amount} {due} {item} {project}'}</p>
    {t.map((x, i) => <div key={x.id} className="stack gap4"><div className="row"><In value={x.name} onChange={(e) => setT(t.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} style={{ maxWidth: 300 }} /><button className="btn ghost sm" type="button" onClick={() => setT(t.filter((_, j) => j !== i))}>Remove</button></div>
      <Area value={x.text} onChange={(e) => setT(t.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} /></div>)}
    <div className="row"><button className="btn sm" type="button" onClick={() => setT([...t, { id: 'tp-' + Date.now().toString(36), name: 'New template', text: 'Hi {client}, ' }])}>+ Template</button><button className="btn primary" type="button" onClick={save}>Save</button></div></div>;
}

function Plans() {
  const [c, setC, saveC] = useDraft('cadences'), [m, setM, saveM] = useDraft('macros');
  const toText = (steps) => steps.map((s) => `${s.day} | ${s.action} | ${s.text}`).join('\n');
  const fromText = (txt) => txt.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[2]).map(([day, action, text]) => ({ day: +day || 0, action: ['call', 'whatsapp', 'task'].includes(action) ? action : 'task', text }));
  return <div className="grid2">
    <div className="card stack"><h2>Follow-up plans (cadences)</h2><p className="small muted" style={{ margin: 0 }}>Each line: <code>day | call / whatsapp / task | what to do</code>. BDEs start a plan on a deal; the steps appear in Today.</p>
      {c.map((x, i) => <div key={x.id} className="stack gap4"><In value={x.name} onChange={(e) => setC(c.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
        <Area defaultValue={toText(x.steps)} onBlur={(e) => setC(c.map((y, j) => (j === i ? { ...y, steps: fromText(e.target.value) } : y)))} style={{ fontFamily: 'var(--num)', fontSize: 12 }} /></div>)}
      <div className="row"><button className="btn sm" type="button" onClick={() => setC([...c, { id: 'cd-' + Date.now().toString(36), name: 'New plan', steps: [{ day: 0, action: 'call', text: 'First call' }] }])}>+ Plan</button><button className="btn primary sm" type="button" onClick={saveC}>Save plans</button></div></div>
    <div className="card stack"><h2>Quick actions (macros)</h2><p className="small muted" style={{ margin: 0 }}>One button on a deal that moves the stage, sets the next follow-up, writes a note and can start a plan.</p>
      {m.map((x, i) => { const up = (k, v) => setM(m.map((y, j) => (j === i ? { ...y, [k]: v } : y))); return <div key={x.id} className="form card">
        <Field label="Button name"><In value={x.name} onChange={(e) => up('name', e.target.value)} /></Field>
        <Field label="Move to stage"><Sel value={x.stage || ''} onChange={(v) => up('stage', v)} options={settings().pipeline.map((s) => [s.key, s.label])} blank="Don't move" /></Field>
        <Field label="Next follow-up in (days)"><In type="number" value={x.followDays || 0} onChange={(e) => up('followDays', +e.target.value)} /></Field>
        <Field label="Start plan"><Sel value={x.startCadence || ''} onChange={(v) => up('startCadence', v)} options={c.map((y) => [y.id, y.name])} blank="None" /></Field>
        <Field label="Note written in history" full><In value={x.note || ''} onChange={(e) => up('note', e.target.value)} /></Field></div>; })}
      <div className="row"><button className="btn sm" type="button" onClick={() => setM([...m, { id: 'mc-' + Date.now().toString(36), name: 'New action', followDays: 1, note: '' }])}>+ Quick action</button><button className="btn primary sm" type="button" onClick={saveM}>Save quick actions</button></div></div>
  </div>;
}

function ProjTemplates() {
  const [p, setP, save] = useDraft('projectTemplates');
  const toText = (ts) => ts.map((t) => `${t.days} | ${t.title}${t.milestone ? ' | milestone' : ''}`).join('\n');
  const fromText = (txt) => txt.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[1]).map(([d, title, m]) => ({ days: +d || 0, title, milestone: /mile/i.test(m || '') }));
  return <div className="card stack" style={{ maxWidth: 820 }}><h2>Project templates</h2><p className="small muted" style={{ margin: 0 }}>Each line: <code>day from start | task | milestone (optional)</code>. Picked at handoff; tasks are created with due dates.</p>
    {p.map((x, i) => <div key={x.id} className="stack gap4"><In value={x.name} onChange={(e) => setP(p.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
      <Area defaultValue={toText(x.tasks)} onBlur={(e) => setP(p.map((y, j) => (j === i ? { ...y, tasks: fromText(e.target.value) } : y)))} style={{ fontFamily: 'var(--num)', fontSize: 12, minHeight: 140 }} /></div>)}
    <div className="row"><button className="btn sm" type="button" onClick={() => setP([...p, { id: 'pt-' + Date.now().toString(36), name: 'New template', tasks: [{ days: 1, title: 'First task' }] }])}>+ Template</button><button className="btn primary" type="button" onClick={save}>Save</button></div></div>;
}

const CONNECT = [
  ['Automatic WhatsApp', 'Send the daily lists, payment reminders and follow-ups by themselves every morning.', 'A WhatsApp Business API account (e.g. Interakt, WATI, AiSensy, Gupshup) and Meta-approved message templates. Meta charges per conversation.'],
  ['Phone calls (click to call, recordings)', 'Tap a number to call; the call is logged with its length and recording.', 'A cloud telephony provider (e.g. Exotel, Knowlarity, MyOperator) and their API key.'],
  ['Email enquiries → leads', 'Emails to info@ become leads automatically; send and track email from Aali One.', 'Access to the company mailbox (IMAP / Google Workspace / Zoho Mail) or an email service.'],
  ['Facebook / Instagram lead ads', 'People who fill an ad form become leads with source “Facebook / Instagram”.', 'A Meta Business account with lead ads and a connected page.'],
  ['Website chat', 'A chat box on aaliconssultancy.com; chats become leads.', 'Adding one script to the website. (The website enquiry form already works: /enquire.)'],
  ['Visiting card scanner', 'Photo of a business card fills the enquiry form.', 'An OCR service (e.g. Google Vision) and its API key.'],
  ['Google / Outlook calendar', 'Meetings and deadlines show in your phone calendar.', 'Google Workspace or Microsoft 365 access.'],
  ['Tally / Zoho Books', 'Receipts and invoices go straight into the accounts.', 'Tally connector or Zoho Books API access. (CSV export already works: Payments → Export.)'],
  ['Online payment links (UPI / cards)', 'Send a pay link; the receipt is made by itself when paid.', 'A payment gateway account (Razorpay / Cashfree).'],
  ['E-invoicing (IRN)', 'Tax invoices registered with the GST portal.', 'Needed only above ₹5 crore turnover; GST IRP credentials. CA to confirm.'],
  ['AI assistant', 'Best time to call, lead scoring and email drafts.', 'Enough past data (months of use) and an AI service key.'],
  ['Single sign-on and 2-step login', 'Sign in with Google and a code on the phone.', 'Google Workspace or an authenticator app setup.'],
  ['Offline use', 'Keep working without internet; sync later.', 'Planned for the VPS version.'],
];
function Connections() {
  return <div className="stack"><div className="banner info">These features need an outside account before they can work. Nothing here is switched on yet. Everything else in Aali One works today.</div>
    <div className="grid2">{CONNECT.map(([t, what, need]) => <div key={t} className="card stack gap4"><div className="row between"><h3>{t}</h3><Pill k="warn">Connect later</Pill></div><p style={{ margin: 0 }}>{what}</p><p className="small muted" style={{ margin: 0 }}><b>Needs:</b> {need}</p></div>)}</div></div>;
}

function Audit() {
  const [rows, setRows] = useState(null);
  useEffect(() => { http('GET', '/audit?limit=400').then((r) => setRows(r.rows), (e) => toast(e.message, true)); }, []);
  if (!rows) return <Empty>Loading…</Empty>;
  return <div className="tbl"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Details</th></tr></thead><tbody>
    {rows.map((r) => <tr key={r.id}><td className="num">{fmtDT(r.at)}</td><td>{uname(r.user_id)}</td><td>{r.action}</td><td>{r.type}</td><td>{r.summary}</td></tr>)}</tbody></table></div>;
}
function Trash() {
  const [rows, setRows] = useState(null), load = () => http('GET', '/trash').then((r) => setRows(r.records), (e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!rows) return <Empty>Loading…</Empty>;
  return rows.length ? <div className="tbl"><table><thead><tr><th>Deleted</th><th>Type</th><th>Item</th><th>By</th><th>Reason</th><th /></tr></thead><tbody>
    {rows.map((r) => <tr key={r.id}><td className="num">{fmtDT(r.deletedAt)}</td><td>{r.type}</td><td>{r.number || r.title || r.name || r.certNo || r.text?.slice(0, 40)}</td><td>{uname(r.deletedBy)}</td><td>{r.deleteReason}</td>
      <td><button className="btn sm" type="button" onClick={() => attempt(async () => { await http('POST', `/records/${r.id}/restore`); await poll(); await load(); }, 'Restored.')}>Restore</button></td></tr>)}</tbody></table></div> : <Empty>The recycle bin is empty.</Empty>;
}
function Data() {
  return <div className="card stack" style={{ maxWidth: 620 }}><h2>Sample data</h2><p style={{ margin: 0 }}>The demo opened with sample clients, leads, deals, quotations, projects, payments and sign-offs, all marked “Sample”. When the team starts real work, remove them here. They go to the recycle bin.</p>
    <button className="btn danger" type="button" onClick={() => attempt(async () => { const r = await http('POST', '/sample/clear'); location.reload(); return r; }, 'Sample data removed.')}>Remove all sample data</button></div>;
}
function Help() {
  return <div className="card stack" style={{ maxWidth: 820 }}><h2>How Aali One works</h2><ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
    <li><b>Enquiry</b> (form, website /enquire, or import) → duplicate check on mobile + service → given to the next BDE, or the client's own BDE.</li>
    <li><b>Lead</b>: call, log the outcome, set the next follow-up, mark Hot / Warm / Cold. <b>Convert</b> → client + deal.</li>
    <li><b>Deal</b>: stages with win chance, quick actions, follow-up plans, quotation (discount over the limit needs approval).</li>
    <li><b>Won</b> → handoff note → project (from a template). No advance = no work start. The BDE collects the advance; the receipt unlocks the project.</li>
    <li><b>Project</b>: IT Manager sets the lead; tasks, milestones, timeline, changes list, time; deadline changes need a reason.</li>
    <li><b>Sign-off</b>: the client signs on screen (photo with consent, rating) → certificate → Live. Share the progress link with the client any time.</li>
    <li><b>After Live</b>: final payment, monthly maintenance fees, renewals, support requests with promised dates.</li>
    <li><b>Everyone</b> starts the day on <b>Today</b>. Managers see their team's late items; top management gets anything 3+ days late and the Monday summary.</li></ol></div>;
}
