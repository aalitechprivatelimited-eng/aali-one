import { useEffect, useState } from 'react';
import { NavLink, Link, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useStore, store, http, saveSetting, setMe, upsertUser, poll, upload } from '../api.js';
import { settings, isTop, TEAMS, uname, fmtDT, fmtDate, today, addDays, parse, waLink, myJuniors, canAddPeople, COMPANIES, GROUP, desig, activeUsers, user } from '../lib.js';
import { SECTIONS, ROLES, ROLE_NAME, ADMIN_TITLES, levelOf, levelText, HR_TITLE, isAccessManager, roleLevel } from '../../shared/access.js';
import { Field, In, Sel, Seg, Area, Pill, Empty, Modal, Avatar, attempt, toast, PersonSearch } from '../ui.jsx';
import { TITLE_TEAM } from '../../shared/defaults.js';
import { ThemeToggle } from '../theme.jsx';
import { displayOk, displayChoices } from '../../shared/names.js';
import { openGuide } from '../guide.jsx';
import { PayslipSheet } from '../doc.jsx';
import { monthLabel } from '../../shared/payroll.js';
import { hasSound, mySound, rememberSound, playSound } from '../sound.js';
import { inr } from '../../shared/money.js';

export default function Settings() {
  useStore(); const admin = store.me.isAdmin, top = isTop(), people = canAddPeople() || top;
  const L = ({ to, children }) => <NavLink to={'/settings/' + to} className={({ isActive }) => 'btn sm' + (isActive ? ' primary' : '')}>{children}</NavLink>;
  // A page opens only for a role that may use it; anyone else lands on My profile, even with a typed link.
  const only = (ok, page) => (ok ? page : <Navigate to="/settings/me" replace />);
  return <>
    <div className="topbar"><h1>Settings</h1></div>
    <div className="row" style={{ marginBottom: 16 }}><L to="me">My profile</L>{people && <L to="people">{top ? 'People & teams' : 'My team members'}</L>}{top && <L to="access">Who can see what</L>}{admin && <L to="business">Letterhead & documents</L>}{admin && <L to="sales">Sales & report setup</L>}
      {admin && <L to="templates">Message templates</L>}{admin && <L to="plans">Follow-up plans & quick actions</L>}{top && <L to="connections">Connections</L>}
      {top && <L to="audit">Audit log</L>}{top && <L to="staff">Staff register</L>}{admin && <L to="trash">Recycle bin</L>}{admin && <L to="data">Sample data</L>}<L to="help">Help</L></div>
    <Routes>
      <Route path="me" element={<Me />} /><Route path="people" element={only(people, <People />)} /><Route path="access" element={only(top, <AccessChart />)} /><Route path="business" element={only(admin, <Business />)} /><Route path="sales" element={only(admin, <Sales />)} />
      <Route path="templates" element={only(admin, <Templates />)} /><Route path="plans" element={only(admin, <Plans />)} /><Route path="connections" element={only(top, <Connections />)} />
      <Route path="audit" element={only(top, <Audit />)} /><Route path="staff" element={only(top, <Staff />)} /><Route path="trash" element={only(admin, <Trash />)} /><Route path="data" element={only(admin, <Data />)} /><Route path="help" element={<Help />} /><Route path="payslip/:month" element={<MyPayslip />} /><Route path="*" element={<Navigate to="me" replace />} />
    </Routes>
  </>;
}

// A chosen picture is cut to a square from its middle and made small (256 px), so it loads fast everywhere.
async function squarePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a picture. Choose a photo (JPG or PNG).')); i.src = url; });
    const s = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 256, 256);
    return new File([await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86))], 'photo.jpg', { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(url); }
}
function Me() {
  const me = store.me, full = me.fullName || me.name, [f, setF] = useState({ name: full, display: me.display || '', phone: me.phone, personalEmail: me.personalEmail || '', currentPassword: '', password: '' }), [busy, setBusy] = useState(false);
  const fits = displayOk(f.display, me.isAdmin ? f.name : full), choices = displayChoices(me.isAdmin ? f.name : full);
  const savePhoto = (photo, ok) => attempt(async () => setMe((await http('PATCH', '/users/' + me.id, { photo })).user), ok);
  async function pick(e) { const file = e.target.files[0]; e.target.value = ''; if (!file) return; setBusy(true);
    await attempt(async () => { const up = await upload(await squarePhoto(file)); setMe((await http('PATCH', '/users/' + me.id, { photo: up.id })).user); }, 'Photo saved. Everyone sees it now.'); setBusy(false); }
  // Left: what I can change. Right: what I can only read, so a wide screen is used and the page is short.
  return <div className="profile-cols"><div className="card stack"><h2>My profile{isAccessManager(me) && <> <Pill k="gold">Accounts & permissions manager</Pill></>}</h2>
    <div className="row" style={{ gap: 14 }}>{me.photo ? <img className="photo-big" src={'/api/files/' + me.photo} alt="My photo" /> : <span className="photo-big" aria-hidden="true">{(full || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>}
      <div className="stack gap4"><b>My photo</b><span className="small muted">Shown beside your name everywhere, instead of your initials.</span>
        <div className="row"><label className="btn sm primary" style={{ cursor: 'pointer' }}>{busy ? 'Saving…' : me.photo ? 'Change photo' : 'Add my photo'}<input type="file" accept="image/*" hidden disabled={busy} onChange={pick} /></label>
          {me.photo && <button className="btn sm" type="button" onClick={() => savePhoto('', 'Photo removed.')}>Remove</button>}</div></div></div>
    <Field label="Full name" hint={me.isAdmin ? '' : 'Your full name is set by management. Ask them if it is wrong.'}><In value={f.name} disabled={!me.isAdmin} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="Display name – the name shown on screen" hint="Leave it empty to show your full name. It must be made from your own name.">
      <In value={f.display} maxLength={40} onChange={(e) => setF({ ...f, display: e.target.value })} placeholder={`e.g. ${choices[0] || 'your first name'}`} aria-invalid={!fits} />
      <div className="row" style={{ gap: 6 }}>{choices.map((x) => <button key={x} type="button" className={'chip' + (f.display.trim().toLowerCase() === x.toLowerCase() ? ' on' : '')} onClick={() => setF({ ...f, display: x })}>{x}</button>)}
        {f.display && <button type="button" className="btn ghost sm" onClick={() => setF({ ...f, display: '' })}>Use my full name</button>}</div>
      {!fits && <span className="small" style={{ color: 'var(--bad)' }}>“{f.display}” is not part of your name ({me.isAdmin ? f.name : full}). Each word must be the start of one of your names, at least 3 letters.</span>}</Field>
    <Field label="Mobile (for WhatsApp lists)"><In value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
    <Field label="Personal email" hint="Your payslips will be sent here."><In type="email" value={f.personalEmail} onChange={(e) => setF({ ...f, personalEmail: e.target.value })} autoComplete="email" /></Field>
    <Field label="Designation"><In value={desig(me)} disabled /></Field>
    <h3>Change password</h3><Field label="Current password"><In type="password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} autoComplete="current-password" /></Field>
    <Field label="New password (8+ characters)"><In type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
    <button className="btn primary" type="button" disabled={!fits} onClick={async () => { const r = await attempt(() => http('PATCH', '/users/' + me.id, { ...(me.isAdmin ? { name: f.name.trim() } : {}), display: f.display.trim(), phone: f.phone, personalEmail: f.personalEmail.trim(), ...(f.password ? { password: f.password, currentPassword: f.currentPassword } : {}) }), 'Saved.'); if (r) { setMe(r.user); setF({ ...f, password: '', currentPassword: '' }); } }}>Save</button></div>
    <div className="stack side-info">
      <MySlips />
      {hasSound() && <MySound />}
      <div className="card stack"><h2>What your login can open</h2>
        <ul className="access" style={{ fontSize: 14 }}>{SECTIONS.filter(([k]) => levelOf(me, k)).map(([k, l]) => <li key={k}><b>{l}</b> – {levelText(k, levelOf(me, k))}</li>)}</ul>
        <p className="small muted" style={{ margin: 0 }}>Anything not in this list is not part of your role. If you need it for your work, ask the Operations Manager.</p></div>
      <div className="card stack"><h2>Look and phone</h2>
        <div className="row"><span className="lbl">Look</span><ThemeToggle label /></div>
        <p className="small muted" style={{ margin: 0 }}>Install on your phone: open Aali One in Chrome → menu → “Add to Home screen”.</p></div>
    </div></div>;
}

// The whole access table on one screen: every section against every role.
// One person's access, section by section – only for the accounts & permissions manager (the user, 18 Oct 2026). Untouched sections follow
// the person's role; a level chosen here wins over it. The server enforces it on the person's next request and tells them what changed.
const LEVEL_OPTS = [['all', 'Full'], ['all:view', 'View only'], ['team', 'Own team'], ['own', 'Own only'], ['own:view', 'Own, view only'], ['', 'No access']];
const levelWord = (l) => (LEVEL_OPTS.find((x) => x[0] === l) || [l, l])[1];
function PersonAccess() {
  const me = store.me, [who, setWho] = useState(''), u = who ? user(who) : null, [draft, setDraft] = useState({}), [busy, setBusy] = useState(false);
  useEffect(() => { setDraft({ ...(u?.access || {}) }); }, [who, JSON.stringify(u?.access || {})]); // eslint-disable-line react-hooks/exhaustive-deps
  const changedPeople = activeUsers().filter((x) => x.id !== me.id && x.access && Object.keys(x.access).length);
  const diff = u ? SECTIONS.map(([k]) => k).filter((k) => (u.access || {})[k] !== draft[k]) : [];
  async function save() {
    const body = Object.fromEntries(diff.map((k) => [k, k in draft ? draft[k] : null]));
    setBusy(true); const r = await attempt(() => http('PUT', `/users/${u.id}/access`, { access: body }), `Saved. ${u.name.split(' ')[0]} sees the change at once.`); setBusy(false);
    if (r) upsertUser(r.user);
  }
  return <div className="card stack"><div className="row between"><h3 style={{ margin: 0 }}>Set one person's access</h3><Pill k="gold">Only you can change this</Pill></div>
    <p className="small muted" style={{ margin: 0 }}>Pick a person. Every section shows what their role gives them; choose another level to change it for this person only. “No access” hides the section from their menu and the server refuses its data.</p>
    <div className="row"><PersonSearch value={who} onChange={setWho} filter={(x) => x.id !== me.id} blank="Choose a person" />
      {changedPeople.length > 0 && <span className="small muted">Changed for: {changedPeople.map((x) => <button key={x.id} type="button" className="btn ghost sm" onClick={() => setWho(x.id)}>{x.name} ({Object.keys(x.access).length})</button>)}</span>}</div>
    {u && <><div className="tbl"><table><thead><tr><th>Section</th><th>Their role gives</th><th>For {u.name.split(' ')[0]}</th></tr></thead><tbody>
      {SECTIONS.map(([k, label]) => { const role = roleLevel(u, k), set = k in draft;
        return <tr key={k} className={(u.access || {})[k] !== draft[k] ? 'acc-changed' : set ? 'acc-own' : ''}><td><b>{label}</b></td><td className="muted">{levelWord(role)}</td>
          <td><Sel value={set ? draft[k] : '__role'} onChange={(v) => { const n = { ...draft }; if (v === '__role') delete n[k]; else n[k] = v; setDraft(n); }} aria-label={`${label} for ${u.name}`}
            options={[['__role', `As their role (${levelWord(role)})`], ...LEVEL_OPTS]} style={{ width: 'auto' }} /></td></tr>; })}</tbody></table></div>
      <div className="row"><span className="small muted grow">{diff.length ? `${diff.length} change${diff.length === 1 ? '' : 's'} not saved yet.` : 'No changes.'}</span>
        <button className="btn" type="button" disabled={!diff.length || busy} onClick={() => setDraft({ ...(u.access || {}) })}>Undo</button>
        <button className="btn primary" type="button" disabled={!diff.length || busy} onClick={save}>{busy ? 'Saving…' : 'Save access'}</button></div></>}
  </div>;
}

function AccessChart() {
  const tone = (l) => (!l ? '' : l.endsWith(':view') ? 'info' : l === 'all' ? 'ok' : 'gold');
  return <div className="stack">
    {isAccessManager(store.me) && <PersonAccess />}
    {!isAccessManager(store.me) && <div className="banner info">Who can see what is decided by Nikhil, the accounts & permissions manager. Ask him for a change.</div>}
    <p className="small muted" style={{ margin: 0 }}>This is the rule the whole system follows. A section marked “No access” does not appear in that person’s sidebar, its data is never sent to their screen, and the server refuses it even with a typed link.</p>
    <div className="row small"><Pill k="ok">Full</Pill><span className="muted">sees and changes everything</span><Pill k="gold">Own team / Own only</Pill><span className="muted">limited to their department or to what is theirs</span><Pill k="info">View only</Pill><span className="muted">can look, cannot change</span></div>
    <div className="tbl"><table className="chart"><thead><tr><th>Section</th>{ROLES.map((r) => <th key={r}>{ROLE_NAME[r]}</th>)}</tr></thead><tbody>
      {SECTIONS.map(([k, label]) => <tr key={k}><td><b>{label}</b></td>{ROLES.map((r) => { const l = levelOf({ title: r }, k);
        return <td key={r}>{l ? <Pill k={tone(l)}>{levelText(k, l)}</Pill> : <span className="faint">No access</span>}</td>; })}</tr>)}</tbody></table></div>
    <p className="small muted" style={{ margin: 0 }}>The Operations Manager and the Company Secretary also have the admin features: adding and removing people, settings, the recycle bin. Daily reports: the Operations Manager, Company Secretary and Chairman read them and do not write one. Payroll: the Company Secretary makes it once the Founder & Chairman gives “HR & payroll”; the Operations Manager reviews it; nobody else sees it.</p>
  </div>;
}

const TEAM_ROLES = { sales: ['salesmgr', 'bde'], it: ['itmgr', 'itlead', 'dev'], management: ['ops', 'cs', 'chairman'] };
const TEAM_NOTE = { sales: 'Sales Manager and BDEs. They work on leads, deals, quotations and payments.', it: 'IT Manager, Team Lead and developers. They deliver the projects.', management: 'Operations Manager, Company Secretary and Chairman. They see every department.' };
// What each role can see and do, in plain words. Shown next to every person and when a role is chosen.
const ACCESS = {
  bde: ['Works on own leads, deals and clients only', 'Sees the projects and support requests of own clients', 'No quotations, payments, reports page or other people’s leads', 'Writes a daily report; sees only their own'],
  salesmgr: ['Sees and works on all leads, deals and clients', 'Quotations, receipts and payments', 'Makes client service agreements; reads closure agreements','Sees projects (view only); raises support requests', 'Reads and reviews Sales daily reports; approves discounts; adds BDEs', 'Writes a daily report'],
  dev: ['Works on the projects, tasks and support requests given to them', 'No sales, client details or money', 'Writes a daily report; sees only their own'],
  itlead: ['Works on all projects, tasks and support requests', 'No sales, client details or money', 'Writes a daily report', 'Reads developers’ reports only when the Operations Manager switches that on'],
  itmgr: ['Runs all projects, tasks and support requests', 'No sales, client details or money', 'Reads and reviews IT daily reports; approves early starts; adds Team Leads and developers', 'Writes a daily report'],
  ops: ['Sees and changes every department', 'Makes client service agreements and project closure agreements', 'Reads payroll, reviews and writes remarks', 'Reads all daily reports', 'Controls the Team Lead report switch', 'Does not write a daily report'],
  cs: ['Sees and changes every department', 'Reads all client agreements (view only)', 'Makes the payroll, once the Founder & Chairman gives “HR & payroll”', 'Reads all daily reports', 'Does not write a daily report'],
  chairman: ['Sees every department, view only', 'Reads all client agreements', 'Reads all daily reports and can remark', 'Decides approvals', 'Does not write a daily report'],
  admin: ['Sees and changes every department'],
};
// Access levels are named by what they allow, because the designation is now typed by hand.
const LEVEL = { bde: 'Sales team member', salesmgr: 'Sales team manager', dev: 'IT team member', itlead: 'IT team lead', itmgr: 'IT team manager', ops: 'Operations Manager', cs: 'Company Secretary', chairman: 'Founder & Chairman', admin: 'Administrator' };
const ADMIN_ACCESS = 'Admin: adds people in any team, changes settings, sends back or deletes reports, opens the recycle bin';
const newPassword = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return 'Aali-' + [...a].map((n) => n.toString(36)).join('').slice(0, 9); };
// Which company of the group the person works for. Management always belongs to Aali Group itself.
function CompanyPicker({ team, value, onChange }) {
  if (team === 'management') return <div className="row"><span className="chip on">{GROUP}</span><span className="small muted">Management looks after every company in the group.</span></div>;
  return <div className="row">{COMPANIES.map((c) => <button key={c} type="button" className={'chip' + (value === c ? ' on' : '')} aria-pressed={value === c} onClick={() => onChange(c)}>{c}</button>)}</div>;
}
// A short burst of confetti when someone joins the team.
const CONFETTI = ['#b87400', '#f2bd52', '#2f7d54', '#2f5fa8', '#b23a32', '#8a4fa8'];
function Confetti() {
  const bits = useState(() => [...Array(70)].map((_, i) => ({ left: Math.random() * 100, delay: Math.random() * 0.5, time: 1.8 + Math.random() * 1.6, size: 6 + Math.random() * 7, turn: (Math.random() * 720 - 360) | 0, drift: (Math.random() * 160 - 80) | 0, color: CONFETTI[i % CONFETTI.length], round: i % 3 === 0 })))[0];
  return <div className="confetti" aria-hidden="true">{bits.map((b, i) => <i key={i} style={{ left: b.left + '%', width: b.size, height: b.round ? b.size : b.size * 0.45, borderRadius: b.round ? '50%' : 2, background: b.color,
    animationDelay: b.delay + 's', animationDuration: b.time + 's', '--turn': b.turn + 'deg', '--drift': b.drift + 'px' }} />)}</div>;
}
// Pick a role by reading what it can do, instead of a bare dropdown.
function RolePicker({ roles, value, onChange }) {
  return <div className="roles" role="radiogroup" aria-label="Access level">{roles.map((k) => <label key={k} className={'rolecard' + (value === k ? ' on' : '')}>
    <input type="radio" name="role" checked={value === k} onChange={() => onChange(k)} /><div><b>{LEVEL[k]}</b> <span className="small muted">· {TEAMS[TITLE_TEAM[k]]} team</span>
      <ul>{ACCESS[k].map((x) => <li key={x}>{x}</li>)}</ul></div></label>)}</div>;
}
// People are added here, team by team. Nothing needs to be done in the database.
function People() {
  const [add, setAdd] = useState(null), [pw, setPw] = useState(null), [made, setMade] = useState(null), [busy, setBusy] = useState(false), [edit, setEdit] = useState(null);
  const me = store.me, adm = me.isAdmin, mgr = isAccessManager(me), jun = myJuniors(), can = (u) => adm || (u.id !== me.id && jun.includes(u.title) && !u.isAdmin);
  if (!canAddPeople() && !isTop()) return <Empty>Only management or a department manager can open this page.</Empty>;
  const patch = (u, data, ok) => attempt(async () => upsertUser((await http('PATCH', '/users/' + u.id, data)).user), ok);
  const rolesFor = (team) => (adm ? TEAM_ROLES[team] : jun);
  const [ask, setAsk] = useState(null); // a confirm window: { kind: 'off' | 'remove', u, work }
  const [hrAsk, setHrAsk] = useState(null), chair = me.title === 'chairman', mayHr = (u) => chair && u.active && !u.removedAt && (u.title === HR_TITLE || u.hr); // the Chairman gives HR, only to the Company Secretary
  async function act(a, u) {
    if (a === 'edit') setEdit({ u, title: u.title, isAdmin: u.isAdmin, company: u.company, designation: u.designation || '', firstName: u.firstName || u.fullName || u.name, surname: u.surname || '', pw: '' });
    if (a === 'password') { if (await attempt(() => http('PATCH', '/users/' + u.id, { password: edit.pw }), u.id === me.id ? 'Your password is changed.' : `Password set. ${u.name} is signed out everywhere. Share the new password privately.`)) setEdit({ ...edit, pw: '' }); }
    if (a === 'on') { if (await patch(u, { active: true }, `${u.name} can sign in again.`)) setEdit(null); }
    if (a === 'off') { setEdit(null); setAsk({ kind: 'off', u }); }
    if (a === 'signout') attempt(() => http('POST', `/users/${u.id}/signout`), `${u.name} is signed out on every device.`);
    if (a === 'remove') { setEdit(null); setAsk({ kind: 'remove', u, reason: '' }); }
  }
  async function confirmAsk() {
    setBusy(true); const { kind, u } = ask;
    const ok = kind === 'off' ? await patch(u, { active: false }, `${u.name} is deactivated and signed out. Their work stays in the system.`).then(async (r) => { if (r) await http('POST', `/users/${u.id}/signout`).catch(() => {}); return r; })
      : await attempt(async () => upsertUser((await http('DELETE', '/users/' + u.id, { reason: ask.reason })).user), `${u.name} is removed and moved to the Staff register.`);
    setBusy(false); if (ok) setAsk(null);
  }
  async function save() {
    setBusy(true); const r = await attempt(() => http('POST', '/users', add)); setBusy(false);
    if (r) { upsertUser(r.user); setMade({ ...r.user, password: add.password }); setAdd(null); }
  }
  async function saveEdit() {
    setBusy(true); const ok = await patch(edit.u, { ...(mgr ? { title: edit.title } : {}), company: edit.company, designation: edit.designation, firstName: edit.firstName, surname: edit.surname, ...(mgr && edit.u.id !== me.id ? { isAdmin: edit.isAdmin } : {}) }, 'Saved.'); setBusy(false); if (ok) setEdit(null);
  }
  const loginText = (u) => `Hi ${u.name.split(' ')[0]}, your Aali One login:\n${location.origin}\nEmail: ${u.email}\nPassword: ${u.password}\nPlease change the password after you sign in (Settings → My profile).`;
  return <div className="stack gap16">
    <p className="small muted" style={{ margin: 0 }}>{adm ? 'Add each person under their team. Open “What each access level can see and do” to read what a person with that access can open.' : jun.length ? 'You can add members to your own team, set their password and switch them off or on. Details, company, access and removal are handled by management.' : 'You can read who is in each team and what each person can see and do. Changes are made by the Operations Manager or the Company Secretary.'}</p>
    {Object.entries(TEAMS).filter(([team]) => adm || isTop() || team === me.team).map(([team, label]) => { const us = store.users.filter((u) => u.team === team && !u.removedAt).sort((x, y) => TEAM_ROLES[team].indexOf(x.title) - TEAM_ROLES[team].indexOf(y.title) || x.name.localeCompare(y.name));
      return <section key={team} className="stack" style={{ gap: 8 }}>
        <div className="row between"><div><h2 style={{ margin: 0 }}>{label} team <span className="small muted">{us.filter((u) => u.active).length} active</span></h2><span className="small muted">{TEAM_NOTE[team]}</span></div>
          {(adm || jun.length > 0) && <button className="btn primary" type="button" onClick={() => setAdd({ team, title: rolesFor(team).at(-1), password: newPassword(), company: team === 'management' ? GROUP : me.team === 'management' ? '' : me.company })}>+ Add {label} member</button>}</div>
        {us.length > 0 && <details className="card" style={{ padding: '12px 16px' }}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>What each access level in the {label} team can see and do</summary>
          <div className="roles" style={{ marginTop: 10 }}>{[...new Set(us.map((u) => u.title))].map((k) => <div key={k} className="rolecard" style={{ cursor: 'default' }}><div><b>{LEVEL[k] || k}</b>
            <ul>{(ACCESS[k] || []).map((x) => <li key={x}>{x}</li>)}</ul></div></div>)}
            {us.some((u) => u.isAdmin) && <div className="rolecard" style={{ cursor: 'default' }}><div><b>Admin (extra)</b><ul><li>{ADMIN_ACCESS.replace('Admin: ', '')}</li></ul></div></div>}</div></details>}
        {us.length ? <div className="tbl"><table><thead><tr><th>Person</th><th>Designation</th><th>Access level</th><th>Company</th><th>Status</th><th /></tr></thead><tbody>
          {us.map((u) => <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
            <td><div className="row" style={{ flexWrap: 'nowrap', gap: 11 }}><Avatar u={u} /><div style={{ minWidth: 0 }}><b>{u.fullName || u.name}</b>{u.id === me.id && <span className="small muted"> (you)</span>}{u.display && <span className="small muted"> · shown as “{u.display}”</span>}
              <div className="small muted">{u.email}{u.phone ? <> · <span className="num">{u.phone}</span></> : ' · no mobile saved'}</div></div></div></td>
            <td>{desig(u)}</td>
            <td><Pill k="gold">{LEVEL[u.title] || u.title}</Pill>{u.isAdmin && <> <Pill k="info">Admin</Pill></>}{u.hr && <> <Pill k="ok">HR & payroll</Pill></>}</td>
            <td className="small muted">{u.company}</td>
            <td>{u.active ? <Pill k="ok">Active</Pill> : <Pill k="bad">Deactivated</Pill>}</td>
            <td style={{ textAlign: 'right' }}>{mayHr(u) && <button className="btn sm" type="button" style={{ marginRight: 6 }} onClick={() => setHrAsk(u)}>{u.hr ? 'Remove HR & payroll' : 'Give HR & payroll'}</button>}{can(u) || u.id === me.id ? <button className="btn sm" type="button" onClick={() => act('edit', u)}>Actions</button> : null}</td></tr>)}</tbody></table></div>
          : <Empty>No one in the {label} team yet.</Empty>}
      </section>; })}
    {add && <Modal wide title={`Add ${TEAMS[add.team]} member`} onClose={() => setAdd(null)} footer={<><button className="btn" type="button" onClick={() => setAdd(null)}>Cancel</button>
      <button className="btn primary" type="button" disabled={busy || !add.firstName?.trim() || !add.surname?.trim() || !add.email?.trim() || (add.password || '').length < 8 || !add.designation?.trim() || (add.team !== 'management' && !COMPANIES.includes(add.company))} onClick={save}>{busy ? 'Adding…' : 'Add member'}</button></>}>
      <div className="form">
        <Field label="Name"><In value={add.firstName || ''} maxLength={60} onChange={(e) => setAdd({ ...add, firstName: e.target.value })} autoFocus /></Field>
        <Field label="Surname"><In value={add.surname || ''} maxLength={60} onChange={(e) => setAdd({ ...add, surname: e.target.value })} /></Field>
        <Field label="Mobile (for WhatsApp)"><In value={add.phone || ''} inputMode="tel" onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></Field>
        <Field label="Email (this is their login)" full><In type="email" value={add.email || ''} onChange={(e) => setAdd({ ...add, email: e.target.value })} autoComplete="off" /></Field>
        <Field label="Personal email" full hint="Their own email, not the work one. Payslips will be sent here."><In type="email" value={add.personalEmail || ''} onChange={(e) => setAdd({ ...add, personalEmail: e.target.value })} autoComplete="off" /></Field>
        <Field label="First password (8+ characters)" full hint="They can change it after signing in."><div className="row"><In className="in grow" value={add.password || ''} onChange={(e) => setAdd({ ...add, password: e.target.value })} autoComplete="new-password" />
          <button className="btn sm" type="button" onClick={() => setAdd({ ...add, password: newPassword() })}>New one</button></div></Field>
        <Field label="Designation" full hint="Type it as it should appear, e.g. BDE - Digital Marketing and Sales."><In value={add.designation || ''} maxLength={80} autoComplete="off" onChange={(e) => setAdd({ ...add, designation: e.target.value })} /></Field>
        <Field label="Company" full>{adm ? <CompanyPicker team={add.team} value={add.company} onChange={(v) => setAdd({ ...add, company: v })} /> : <div className="row"><span className="chip on">{me.company}</span><span className="small muted">Same company as you. Only management can choose another company.</span></div>}</Field>
        <Field label="Access level – what this person should be able to see and do" full><RolePicker roles={rolesFor(add.team)} value={add.title} onChange={(v) => setAdd({ ...add, title: v })} /></Field>
        {mgr && add.team === 'management' && !ADMIN_TITLES.includes(add.title) && <label className="check full"><input type="checkbox" checked={!!add.isAdmin} onChange={(e) => setAdd({ ...add, isAdmin: e.target.checked })} /> <span><b>Also make them an admin</b><br /><span className="small muted">{ADMIN_ACCESS}</span></span></label>}</div></Modal>}
    {hrAsk && <Modal title={hrAsk.hr ? `Remove HR & payroll from ${hrAsk.name}?` : `Give HR & payroll to ${hrAsk.name}?`} onClose={() => setHrAsk(null)} footer={<><button className="btn" type="button" onClick={() => setHrAsk(null)}>Cancel</button>
      <button className="btn primary" type="button" disabled={busy} onClick={async () => { setBusy(true); const ok = await patch(hrAsk, { hr: !hrAsk.hr }, hrAsk.hr ? `${hrAsk.name} no longer has payroll.` : `${hrAsk.name} can now make payroll.`); setBusy(false); if (ok) setHrAsk(null); }}>{hrAsk.hr ? 'Remove' : 'Give HR & payroll'}</button></>}>
      <p style={{ margin: 0 }}>{hrAsk.hr ? 'They will no longer see salaries or make the payroll.' : 'They will see every salary, enter salaries, loans and advances, and make the monthly payroll. The Operations Manager reviews it. You are the only one who can give this.'}</p></Modal>}
    {edit && <Modal wide title={`Actions for ${edit.u.name}`} onClose={() => setEdit(null)} footer={<><button className="btn" type="button" onClick={() => setEdit(null)}>Close</button>
      {adm && <button className="btn primary" type="button" disabled={busy || (edit.title === edit.u.title && edit.isAdmin === edit.u.isAdmin && edit.company === edit.u.company && edit.designation === (edit.u.designation || '') && edit.firstName === (edit.u.firstName || edit.u.fullName || edit.u.name) && edit.surname === (edit.u.surname || '')) || !edit.firstName.trim() || !edit.surname.trim() || (TITLE_TEAM[edit.title] !== 'management' && !COMPANIES.includes(edit.company))} onClick={saveEdit}>Save details</button>}</>}>
      <div className="stack">{adm ? <><h3 style={{ margin: 0 }}>Details</h3><div className="form"><Field label="Name"><In value={edit.firstName} maxLength={60} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} /></Field>
        <Field label="Surname"><In value={edit.surname} maxLength={60} onChange={(e) => setEdit({ ...edit, surname: e.target.value })} /></Field></div>
        <Field label="Designation" hint="Leave empty to show the access level's name."><In value={edit.designation} maxLength={80} autoComplete="off" onChange={(e) => setEdit({ ...edit, designation: e.target.value })} /></Field>
        <div><span className="lbl">Company</span><CompanyPicker team={TITLE_TEAM[edit.title]} value={edit.company} onChange={(v) => setEdit({ ...edit, company: v })} /></div>
        {mgr ? (adm ? Object.keys(TEAMS) : [edit.u.team]).map((t) => <div key={t}><span className="lbl">Access level · {TEAMS[t]} team</span><RolePicker roles={rolesFor(t)} value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} /></div>)
          : <div className="banner info">Role: <b>{ROLE_NAME[edit.u.title] || edit.u.title}</b>. Only Nikhil, the accounts & permissions manager, changes a person's role, admin switch or access.</div>}
        {TITLE_TEAM[edit.title] !== edit.u.team && <div className="banner">This moves {edit.u.name.split(' ')[0]} from the {TEAMS[edit.u.team]} team to the {TEAMS[TITLE_TEAM[edit.title]]} team.</div>}
        {mgr && <label className="check"><input type="checkbox" checked={!!edit.isAdmin || ADMIN_TITLES.includes(edit.title)} disabled={edit.u.id === me.id || ADMIN_TITLES.includes(edit.title)} onChange={(e) => setEdit({ ...edit, isAdmin: e.target.checked })} /> <span><b>Admin</b>{ADMIN_TITLES.includes(edit.title) ? <span className="small muted"> (the Operations Manager and Company Secretary are always admins)</span> : edit.u.id === me.id && <span className="small muted"> (you cannot remove your own admin right)</span>}<br /><span className="small muted">{ADMIN_ACCESS}</span></span></label>}
        <PersonalEmail u={edit.u} busy={busy} save={async (v) => { if (await patch(edit.u, { personalEmail: v }, 'Personal email saved.')) setEdit({ ...edit, u: { ...edit.u, personalEmail: v } }); }} />
        {adm && edit.u.id !== me.id && (edit.u.title === HR_TITLE || edit.u.hr) && <div className="row" style={{ alignItems: 'center' }}><span className="grow"><b>HR & payroll</b> <Pill k={edit.u.hr ? 'ok' : ''}>{edit.u.hr ? 'On' : 'Off'}</Pill><br /><span className="small muted">Enters salaries, loans and advances, and makes the monthly payroll. The Operations Manager reviews payroll; nobody else sees it.</span></span>
          {edit.u.hr ? <button className="btn sm" type="button" disabled={busy} onClick={async () => { if (await patch(edit.u, { hr: false }, `${edit.u.name} no longer has payroll.`)) setEdit({ ...edit, u: { ...edit.u, hr: false } }); }}>Switch off</button>
            : <span className="small muted" style={{ maxWidth: 220 }}>Only the Founder & Chairman can switch it on.</span>}</div>}
        </> : <div className="stack gap4"><div className="row"><b>{edit.u.name}</b><Pill>{desig(edit.u)}</Pill><Pill>{edit.u.company}</Pill></div><div className="banner info">Name, designation, company and access can be changed only by management. You can set a password and switch this member off or on.</div></div>}
        <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}><h3 style={{ margin: 0 }}>Password</h3>
          {edit.u.id === me.id ? <span className="small muted">To change your own password, open <Link to="/settings/me">My profile</Link>. It asks for your current password first.</span> : <>
          <div className="row"><In className="in grow" style={{ minWidth: 180, maxWidth: 280 }} value={edit.pw} onChange={(e) => setEdit({ ...edit, pw: e.target.value })} placeholder="New password (8+ characters)" autoComplete="new-password" />
            <button className="btn sm" type="button" onClick={() => setEdit({ ...edit, pw: newPassword() })}>Suggest one</button>
            <button className="btn" type="button" disabled={(edit.pw || '').length < 8} onClick={() => act('password', edit.u)}>Set this password</button></div>
          <span className="small muted">Note the password down before you press the button. It is not shown again.</span></>}</div>
        <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}><h3 style={{ margin: 0 }}>Account</h3>
          <div className="row"><span className="small muted">Status:</span>{edit.u.active ? <Pill k="ok">Active</Pill> : <Pill k="bad">Deactivated</Pill>}</div>
          <div className="acts">
            {waLink(edit.u.phone, 'x') && <a className="act" href={waLink(edit.u.phone, `Hi ${edit.u.name.split(' ')[0]}, this is your Aali One link: ${location.origin}\nYour login email is ${edit.u.email}. If you forgot the password, tell me and I will set a new one.`)} target="_blank" rel="noreferrer"><b>Send login on WhatsApp</b><span>The app link and their login email</span></a>}
            {edit.u.id !== me.id && <button type="button" className="act" onClick={() => act('signout', edit.u)}><b>Sign out everywhere</b><span>For a lost or shared phone</span></button>}
            {edit.u.id !== me.id && (edit.u.active ? <button type="button" className="act danger" onClick={() => act('off', edit.u)}><b>Deactivate</b><span>Block sign-in for now; they stay on the team list</span></button>
              : <button type="button" className="act" onClick={() => act('on', edit.u)}><b>Reactivate</b><span>Let them sign in again</span></button>)}
            {edit.u.id !== me.id && adm && <button type="button" className="act danger" onClick={() => act('remove', edit.u)}><b>Remove from the team</b><span>They left: move them to the Staff register</span></button>}
          </div></div>
      </div></Modal>}
    {made && <Modal title={`${made.name} has joined`} onClose={() => setMade(null)} footer={<button className="btn primary" type="button" onClick={() => setMade(null)}>Done</button>}>
      <div className="stack"><Confetti />
        <div className="welcome"><div className="welcome-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
          <h2 style={{ margin: 0 }}>Welcome to the team, {made.firstName || made.name.split(' ')[0]}!</h2>
          <div className="muted">{desig(made)} · {TEAMS[made.team]} team · {made.company}</div></div>
        <div className="banner ok">Share this login with them privately. The password is shown only now.</div>
        <textarea className="in" readOnly value={loginText(made)} style={{ minHeight: 120 }} />
        <div className="row"><button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(loginText(made)).then(() => toast('Copied.'), () => toast('Select the text and copy it.', true))}>Copy</button>
          {waLink(made.phone, loginText(made)) ? <a className="btn wa" href={waLink(made.phone, loginText(made))} target="_blank" rel="noreferrer">Send on WhatsApp</a> : <span className="small muted">Add a mobile number to send it on WhatsApp.</span>}</div></div></Modal>}
    {ask && <Modal title={ask.kind === 'off' ? `Deactivate ${ask.u.name}?` : `Remove ${ask.u.name} from the team?`} onClose={() => setAsk(null)} footer={<><button className="btn" type="button" onClick={() => setAsk(null)}>Cancel</button>
      <button className="btn danger" type="button" disabled={busy || (ask.kind === 'remove' && ask.reason.trim().length < 3)} onClick={confirmAsk}>{ask.kind === 'off' ? 'Deactivate' : 'Remove from the team'}</button></>}>
      {ask.kind === 'off' ? <div className="stack"><p style={{ margin: 0 }}>Use this to block someone for a while, for example during long leave.</p><ul className="access" style={{ fontSize: 13.5 }}><li>They are signed out and cannot sign in.</li><li>They stay on the team list, marked Deactivated.</li><li>You can reactivate them any time.</li></ul></div>
        : <div className="stack"><p style={{ margin: 0 }}>Use this when someone leaves, or for a test entry. Nothing is erased.</p><ul className="access" style={{ fontSize: 13.5 }}><li>They are signed out and can no longer sign in.</li>
          <li>They leave the team list and move to the <b>Staff register</b>, with their details and history.</li><li>Everything they did stays in the system with their name.</li><li>You can restore them from the Staff register.</li></ul>
          <Field label="Reason (required)"><In value={ask.reason} maxLength={200} onChange={(e) => setAsk({ ...ask, reason: e.target.value })} placeholder="e.g. Resigned on 30 Sep, or Test entry" autoFocus /></Field></div>}</Modal>}
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
      {F('address', 'Address', true)}{F('bank', 'Payment / bank details', true)}{F('quoteTerms', 'Quotation terms', true)}{F('receiptTerms', 'Receipt terms', true)}{F('receiptIntro', 'Receipt opening line')}{F('receiptBank', 'Payment details on receipts (if different from above)', true)}
      {F('quotePrefix', 'Quotation prefix (AC → AC/2026-27/001)')}{F('receiptPrefix', 'Receipt prefix (ACY → ACY-300926/001)')}{F('invoicePrefix', 'Invoice prefix')}{F('signName', 'Signatory name')}{F('signRole', 'Signatory designation')}</div>
    <Stamp value={b.stamp || ''} onChange={(stamp) => setB({ ...b, stamp })} />
    <button className="btn primary" type="button" onClick={save}>Save</button></div>;
}
// The company's real rubber stamp, scanned: printed on receipts beside the signature. No drawn stand-in – without a scan, no stamp prints.
function Stamp({ value, onChange }) {
  async function pick(e) { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Choose a PNG or JPG picture of the stamp.', true);
    if (f.size > 200_000) return toast('That picture is too large (max 200 KB). Crop it to the stamp.', true);
    onChange(await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(f); })); }
  return <div className="row" style={{ gap: 14 }}>{value ? <img src={value} alt="Company stamp" style={{ height: 80, maxWidth: 160, objectFit: 'contain', background: '#fff', borderRadius: 8, border: '1px solid var(--line)' }} /> : null}
    <div className="stack gap4"><b>Company stamp</b><span className="small muted">A scan of the real stamp (PNG with a clear background is best). Printed on receipts. Press Save after choosing it.</span>
      <div className="row"><label className="btn sm">{value ? 'Choose another' : 'Choose the stamp picture'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} /></label>{value && <button className="btn sm ghost" type="button" onClick={() => onChange('')}>Remove</button>}</div></div></div>;
}

function Lines({ label, value, onChange }) { return <Field label={label} hint="One per line"><Area value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} onBlur={(e) => onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} style={{ minHeight: 120 }} /></Field>; }
function Sales() {
  const s = settings(), [pipe, setPipe] = useState(structuredClone(s.pipeline)), [srv, setSrv] = useState(structuredClone(s.services)), [src, setSrc] = useState(s.sources), [lost, setLost] = useState(s.lostReasons);
  const [disc, setDisc] = useState(s.discountApprovalPct), [esc, setEsc] = useState(s.escalateDays), [wt, setWt] = useState(structuredClone(s.workTypes));
  const [cl, setCl] = useState({ ...s.calling }), [inds, setInds] = useState(s.industries), [srcs, setSrcs] = useState(s.listSources);
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
    <div className="card stack"><h2>Calling rules – one business, one caller</h2><p className="small muted" style={{ margin: 0 }}>Every number is checked against the call register before it is called or written on a call sheet. These limits protect a business from being called again and again.</p>
      <div className="form"><Field label="A business stays with its BDE for (days after the last call)"><In type="number" min="1" value={cl.holdDays} onChange={(e) => setCl({ ...cl, holdDays: e.target.value })} /></Field>
        <Field label="A number kept but never called is freed after (days)"><In type="number" min="1" value={cl.emptyHoldDays} onChange={(e) => setCl({ ...cl, emptyHoldDays: e.target.value })} /></Field>
        <Field label="Stop after this many calls in a row with no answer"><In type="number" min="1" value={cl.maxTries} onChange={(e) => setCl({ ...cl, maxTries: e.target.value })} /></Field></div>
      <div className="grid2"><Lines label="Industries (picked on the call sheet)" value={inds} onChange={setInds} /><Lines label="Where calling lists come from (asked at upload)" value={srcs} onChange={setSrcs} /></div>
      <button className="btn primary sm" type="button" style={{ alignSelf: 'start' }} onClick={() => attempt(async () => { await saveSetting('calling', { holdDays: Math.max(1, +cl.holdDays || 15), emptyHoldDays: Math.max(1, +cl.emptyHoldDays || 2), maxTries: Math.max(1, +cl.maxTries || 3) }); await saveSetting('industries', inds.filter(Boolean)); await saveSetting('listSources', srcs.filter(Boolean)); }, 'Saved.')}>Save calling rules</button></div>
    <div className="card stack"><h2>Kinds of work in the daily report</h2><p className="small muted" style={{ margin: 0 }}>People pick one of these for every line they write, with the minutes spent. Add anything your teams do, such as video making or photo editing.</p>
      <div className="grid2"><Lines label="Sales team" value={wt.sales} onChange={(v) => setWt({ ...wt, sales: v })} /><Lines label="IT team" value={wt.it} onChange={(v) => setWt({ ...wt, it: v })} /></div>
      <button className="btn primary sm" type="button" style={{ alignSelf: 'start' }} onClick={() => attempt(() => saveSetting('workTypes', { sales: wt.sales.filter(Boolean), it: wt.it.filter(Boolean) }), 'Saved.')}>Save kinds of work</button></div>
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

const CONNECT = [
  ['More automatic WhatsApp', 'Daily lists, payment reminders and follow-ups sent by themselves (daily reports already go – see WhatsApp above).', 'The same WhatsApp Cloud API link, and one more Meta-approved template for each kind of message. Meta charges per message.'],
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
  return <div className="stack"><WhatsApp /><div className="banner info">These features need an outside account before they can work. Nothing here is switched on yet. Everything else in Aali One works today.</div>
    <div className="grid2">{CONNECT.map(([t, what, need]) => <div key={t} className="card stack gap4"><div className="row between"><h3>{t}</h3><Pill k="warn">Connect later</Pill></div><p style={{ margin: 0 }}>{what}</p><p className="small muted" style={{ margin: 0 }}><b>Needs:</b> {need}</p></div>)}</div></div>;
}

// ---------- WhatsApp: each daily report to management the moment it is submitted (server/whatsapp.js, Meta WhatsApp Cloud API) ----------
const WA_STATUS = { sent: ['Sent', 'ok'], queued: ['Waiting – tried again soon', 'warn'], sending: ['Sending', 'info'], failed: ['Not sent', 'bad'] };
function WhatsApp() {
  const [st, setSt] = useState(null), [tick, setTick] = useState(0), [busy, setBusy] = useState(false), [chk, setChk] = useState(null), me = store.me, mayEdit = me.isAdmin || me.title === 'ops';
  const check = async () => { setChk({ busy: true }); setChk(await http('GET', '/whatsapp/template').catch((e) => ({ ok: false, problems: [e.message] }))); };
  useEffect(() => { let on = true; http('GET', '/whatsapp').then((r) => on && setSt(r), (e) => on && setSt({ error: e.message })); return () => { on = false; }; }, [tick]);
  const s = settings().waReports || { on: true, skip: [] }, skip = s.skip || [];
  const save = (v, ok) => attempt(() => saveSetting('waReports', v), ok);
  if (!st) return <div className="card"><p className="small muted" style={{ margin: 0 }}>Checking WhatsApp…</p></div>;
  if (st.error) return <div className="banner bad">{st.error}</div>;
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copied.'), () => toast('Select the text and copy it.', true));
  return <div className="card stack">
    <div className="row between"><h3 style={{ margin: 0 }}>WhatsApp – daily reports to management</h3><Pill k={st.ready ? 'ok' : 'warn'}>{st.ready ? 'Linked' : 'Not linked yet'}</Pill></div>
    <p style={{ margin: 0 }}>When someone submits their daily report, each person below gets it on WhatsApp at once – one message per report, with an <b>Open full report</b> button that opens that one report – no sign-in needed, like a client's progress link.</p>
    {!st.ready && <div className="stack gap4"><div className="banner warn">Not linked yet, so nothing is sent. Reports submitted before the link is made are not sent later.</div>
      <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
        <li>Meta Business (business.facebook.com) → WhatsApp Manager → Add phone number: a new number kept only for Aali One (not on the ordinary WhatsApp or WhatsApp Business app). Display name <b>Aali One</b>, category Professional services, profile photo the Aali One logo. Meta checks the name against the website – one.aaliconssultancy.com shows "Aali One · Aali Group".</li>
        <li>Message templates → Create template: category <b>Utility</b>, name <code>{st.template.name}</code>, language <b>English</b> (<code>{st.template.lang}</code>), body as below. Submit it; Meta usually approves within minutes.</li>
        <li>Business settings → System users: make one (admin), give it the WhatsApp account, and generate a token with <code>whatsapp_business_messaging</code> (expiry: never).</li>
        <li>Hosting settings (the server): <code>WHATSAPP_TOKEN</code> = the token, <code>WHATSAPP_PHONE_NUMBER_ID</code> = the number's ID from WhatsApp Manager → Phone numbers. Restart Aali One. Never send these in chat.</li></ol></div>}
    <div className="stack gap4"><div className="row between"><span className="lbl">The template's body (paste it as it is)</span><button className="btn sm" type="button" onClick={() => copy(st.template.text)}>Copy</button></div>
      <pre className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', background: 'var(--paper-2)', padding: 12, borderRadius: 8 }}>{st.template.text}</pre>
      <span className="small muted">Sample values Meta asks for: {st.template.samples.map((s, i) => <span key={i}>{i ? ' · ' : ''}<b>{`{{${i + 1}}}`}</b> {s}</span>)}</span>
      <span className="small">Button: <b>Visit website</b>, text <b>Open full report</b>, address type <b>Dynamic</b>, address <code>{st.template.button.replace('{{1}}', '')}</code> (type it only up to <code>/daily/</code> – Meta adds <code>{'{{1}}'}</code> by itself), sample <code>{st.template.button.replace('{{1}}', 'Xq3Lm8Rt2Vb6Nw9Kd4Hs7Pa1')}</code></span>
      <div className="row"><button className="btn sm" type="button" disabled={chk?.busy} onClick={check}>{chk?.busy ? 'Asking Meta…' : 'Check the template with Meta'}</button>
        {chk && !chk.busy && (chk.ok ? <Pill k="ok">{chk.name} ({chk.lang}): approved · {chk.category.toLowerCase()}{chk.sameText ? ' · same text as here' : ''}</Pill> : <Pill k="bad">Not ready</Pill>)}</div>
      {chk && !chk.busy && (chk.problems || []).map((p, i) => <div key={i} className="small" style={{ color: 'var(--bad)' }}>• {p}</div>)}
      {chk?.ok && !chk.sameText && <div className="small" style={{ color: 'var(--warn)' }}>• Approved, but its wording differs from the text above. It still works if it has the same six fields; the messages will read as Meta has it.</div>}</div>
    <div className="stack gap4"><span className="lbl">Who gets the reports</span>
      <label className="check"><input type="checkbox" checked={s.on !== false} disabled={!mayEdit} onChange={(e) => save({ ...s, on: e.target.checked }, e.target.checked ? 'Reports go on WhatsApp again.' : 'Reports are no longer sent on WhatsApp.')} /> Send daily reports on WhatsApp</label>
      <div className="list">{st.people.map((p) => <div key={p.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
        <label className="check grow"><input type="checkbox" checked={!skip.includes(p.id) && !!p.number} disabled={!mayEdit || s.on === false || !p.number} onChange={(e) => save({ ...s, skip: e.target.checked ? skip.filter((x) => x !== p.id) : [...skip, p.id] }, 'Saved.')} /> <b>{p.name}</b></label>
        {p.number ? <span className="num small">+{p.number}</span> : <span className="small" style={{ color: 'var(--warn)' }}>No mobile number – add it in People & teams</span>}</div>)}</div>
      {!mayEdit && <span className="small muted">The Operations Manager or the admin changes who gets them.</span>}</div>
    {st.ready && <div><button className="btn" type="button" disabled={busy} onClick={async () => { setBusy(true); await attempt(() => http('POST', '/whatsapp/test'), 'A test message is on its way to your WhatsApp.'); setBusy(false); setTimeout(() => setTick((n) => n + 1), 2500); }}>Send me a test message</button></div>}
    {st.recent.length > 0 && <div className="stack gap4"><div className="row between"><span className="lbl">Latest messages</span><button className="btn ghost sm" type="button" onClick={() => setTick((n) => n + 1)}>Refresh</button></div>
      <div className="tbl cards"><table><thead><tr><th>When</th><th>To</th><th>What</th><th>Result</th></tr></thead><tbody>
        {st.recent.map((x) => <tr key={x.id}><td className="small">{fmtDT(x.sent_at || x.created_at)}</td><td>{uname(x.to_user)}</td><td className="small">{x.kind === 'test' ? 'Test message' : `${uname(x.writer)}'s report${x.date ? ' for ' + fmtDate(x.date) : ''}`}</td>
          <td><Pill k={(WA_STATUS[x.status] || [])[1]}>{(WA_STATUS[x.status] || [x.status])[0]}</Pill>{x.error && <div className="small" style={{ color: 'var(--bad)' }}>{x.error}</div>}</td></tr>)}</tbody></table></div></div>}
  </div>;
}

// Audit log: who did what, kept short on purpose. Every save is written down, so read line by line it never ends. Instead:
//  · the server folds repeats – the same person changing the same item over a day is one line;
//  · each day is one line, opened to read; inside it, what is worth a look (deletions, people, settings, money, wrong passwords)
//    is shown in full, everyday adding and editing is one line for each person, and sign-ins are one line for the day.
const THING = { lead: 'lead', deal: 'deal', client: 'client', quote: 'quotation', invoice: 'invoice', receipt: 'receipt', payment: 'payment', project: 'project', task: 'task', ticket: 'support request', report: 'daily report',
  prospect: 'call-register number', asset: 'client-asset upload', collab: 'collaboration', signoff: 'sign-off certificate', approval: 'approval request', target: 'target', activity: 'call or meeting note', comment: 'comment', presence: 'out-of-office note' };
const WATCH = ['delete', 'restore', 'user', 'settings', 'loginfail', 'import', 'calls', 'sample'], MONEY_TYPES = ['quote', 'invoice', 'receipt', 'payment', 'signoff'];
const kindOf = (r) => (r.action === 'login' ? 'signin' : WATCH.includes(r.action) || MONEY_TYPES.includes(r.type) ? 'watch' : 'work');
const thing = (r) => THING[r.type] || r.type || 'item', withA = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const clock = (s) => new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
// One line of the log in plain words: [what happened, the details].
function say(r) {
  const s = r.summary || '', times = r.n > 1 ? ` – ${r.n} times` : '', cut = s.lastIndexOf(': ');
  switch (r.action) {
    case 'login': return [r.n > 1 ? `Signed in ${r.n} times` : 'Signed in', ''];
    case 'loginfail': return [`Wrong password tried for ${r.type}${times}`, ''];
    case 'create': return [`Added ${withA(thing(r))}`, s];
    case 'update': return [`Changed ${withA(thing(r))}${times}`, cut > 0 ? `${s.slice(0, cut)} · last changed: ${s.slice(cut + 2)}` : s.replace(/^: /, 'last changed: ')];
    case 'delete': return [`Deleted ${withA(thing(r))}`, s];
    case 'restore': return ['Restored an item from the recycle bin', ''];
    case 'settings': return ['Changed a setting', s];
    case 'import': return ['Brought in a list of leads', s];
    default: return [s || r.action, ''];
  }
}
// "added 6 leads, changed 3 deals" – one person's everyday work in a day.
function workSum(rows) {
  const n = {}; for (const r of rows) { const k = r.action === 'enquiry' ? 'received|website enquiry' : (r.action === 'create' ? 'added' : 'changed') + '|' + thing(r); n[k] = (n[k] || 0) + (r.action === 'update' ? 1 : r.n); }
  return Object.entries(n).map(([k, c]) => { const [verb, w] = k.split('|'); return `${verb} ${c} ${c === 1 ? w : w.replace(/y$/, 'ie') + 's'}`; }).join(', ');
}
const LogLine = ({ r, who = true }) => { const [what, more] = say(r);
  return <div className="log-line"><span className="num muted">{r.n > 1 ? `${clock(r.first)} – ${clock(r.at)}` : clock(r.at)}</span>{who && <span>{r.user_id ? uname(r.user_id) : '—'}</span>}<span><b>{what}</b>{more && <span className="muted"> · {more}</span>}</span></div>; };
// flat: one section is chosen – every line of the day is listed in full, latest first, so each change can be checked.
function LogDay({ day, rows, open, flat }) {
  const t = today(), name = day === t ? 'Today' : day === addDays(t, -1) ? 'Yesterday' : parse(day).toLocaleDateString('en-IN', { weekday: 'long' });
  if (flat) return <details className="log-day" open={open}>
    <summary><b>{name}</b><span className="muted">{fmtDate(day)}</span><span className="grow" /><Pill>{rows.length} {rows.length === 1 ? 'line' : 'lines'}</Pill>
      <Pill>{new Set(rows.map((r) => r.user_id)).size} {new Set(rows.map((r) => r.user_id)).size === 1 ? 'person' : 'people'}</Pill></summary>
    {rows.map((r, i) => <LogLine key={i} r={r} />)}</details>;
  const watch = rows.filter((r) => kindOf(r) === 'watch'), work = rows.filter((r) => kindOf(r) === 'work'), sign = rows.filter((r) => kindOf(r) === 'signin'), people = [...new Set(work.map((r) => r.user_id))];
  return <details className="log-day" open={open}>
    <summary><b>{name}</b><span className="muted">{fmtDate(day)}</span><span className="grow" />
      {watch.length > 0 && <Pill k="warn">{watch.length} worth a look</Pill>}{people.length > 0 && <Pill>{people.length} {people.length === 1 ? 'person' : 'people'} worked</Pill>}{sign.length > 0 && <Pill>{sign.length} signed in</Pill>}</summary>
    {watch.length > 0 && <><h4>Worth a look</h4>{watch.map((r, i) => <LogLine key={i} r={r} />)}</>}
    {people.length > 0 && <><h4>Everyday work</h4>{people.map((id) => { const mine = work.filter((r) => r.user_id === id);
      return <details key={id || 'x'} className="log-who"><summary><b>{id ? uname(id) : 'From the website'}</b><span className="muted">{workSum(mine)}</span></summary>{mine.map((r, i) => <LogLine key={i} r={r} who={false} />)}</details>; })}</>}
    {sign.length > 0 && <><h4>Sign-ins</h4><details className="log-who"><summary><b>{sign.length} {sign.length === 1 ? 'person' : 'people'} signed in</b><span className="muted">{sign.slice(0, 6).map((r) => uname(r.user_id)).join(', ')}{sign.length > 6 ? ` and ${sign.length - 6} more` : ''}</span></summary>
      {sign.map((r, i) => <LogLine key={i} r={r} />)}</details></>}
  </details>;
}
// The log's sections (server: /audit sectionOf). Each shows how many lines it has for the chosen time and person; a tap shows only that.
const LOG_SECTIONS = [['signin', 'Sign-ins'], ['payroll', 'Payroll'], ['clientpay', 'Client payroll'], ['reports', 'Daily reports'], ['sales', 'Sales'], ['money', 'Money'],
  ['projects', 'Projects & IT'], ['agreements', 'Agreements'], ['people', 'People & settings'], ['other', 'Other']];
function Audit() {
  const [rows, setRows] = useState(null), [days, setDays] = useState(7), [who, setWho] = useState(''), [q, setQ] = useState(''), [sec, setSec] = useState('');
  useEffect(() => { setRows(null); http('GET', '/audit?days=' + days).then((r) => setRows(r.rows), (e) => toast(e.message, true)); }, [days]);
  if (!rows) return <Empty>Loading…</Empty>;
  const since = addDays(today(), 1 - days), text = q.trim().toLowerCase(), names = [...new Set(rows.map((r) => r.user_id).filter(Boolean))].map((id) => [id, uname(id)]).sort((x, y) => x[1].localeCompare(y[1]));
  const base = rows.filter((r) => r.day >= since && (!who || r.user_id === who) && (!text || `${uname(r.user_id)} ${say(r).join(' ')}`.toLowerCase().includes(text)));
  const shown = base.filter((r) => !sec || r.section === sec), count = (k) => base.filter((r) => r.section === k).length;
  const byDay = [...new Set(shown.map((r) => r.day))].sort().reverse(), secName = LOG_SECTIONS.find((x) => x[0] === sec)?.[1];
  return <div className="stack">
    <p className="small muted" style={{ margin: 0 }}>Who did what. Each day is one line: open it to read. Choose a section to see every change in it, line by line; choose a person to see only what they did.</p>
    <div className="row"><Seg value={days} onChange={setDays} options={[[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']]} />
      <Sel value={who} onChange={setWho} blank="Everyone" options={names} style={{ maxWidth: 220 }} aria-label="Show one person" />
      <In placeholder="Search the log" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} /></div>
    <div className="row" role="group" aria-label="Sections"><button type="button" className={'chip' + (!sec ? ' on' : '')} aria-pressed={!sec} onClick={() => setSec('')}>Everything <span className="num">{base.length}</span></button>
      {LOG_SECTIONS.filter(([k]) => count(k) || sec === k).map(([k, l]) => <button key={k} type="button" className={'chip' + (sec === k ? ' on' : '')} aria-pressed={sec === k} onClick={() => setSec(sec === k ? '' : k)}>{l} <span className="num">{count(k)}</span></button>)}</div>
    {byDay.length ? byDay.map((d, i) => <LogDay key={d} day={d} rows={shown.filter((r) => r.day === d)} open={i === 0 || !!text || !!sec} flat={!!sec} />)
      : <Empty>{sec ? `Nothing in ${secName} ${who ? 'by ' + uname(who) + ' ' : ''}in this time.` : who || text ? 'Nothing matches.' : 'Nothing was done in this time.'}</Empty>}
  </div>;
}
// Staff register: everyone ever added – active, deactivated and removed – with their details and history. Only active people can sign in.
function Staff() {
  const [rows, setRows] = useState(null), [f, setF] = useState('all'), [open, setOpen] = useState(null), [hist, setHist] = useState(null);
  const load = () => http('GET', '/staff').then((r) => setRows(r.staff)).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  const state = (u) => (u.removedAt ? ['Removed', 'bad'] : u.active ? ['Active', 'ok'] : ['Deactivated', 'warn']);
  const show = async (u) => { setOpen(u); setHist(null); setHist(await http('GET', `/users/${u.id}/history`).catch(() => ({ history: [], work: { work: 0, reports: 0, types: [] } }))); };
  const restore = async (u) => { const r = await attempt(() => http('POST', `/users/${u.id}/restore`), `${u.name} is restored and can sign in again.`); if (r) { upsertUser(r.user); setOpen(null); load(); } };
  if (!rows) return <Empty>Loading the staff register…</Empty>;
  const list = rows.filter((u) => f === 'all' || state(u)[0].toLowerCase() === f), n = (k) => rows.filter((u) => state(u)[0] === k).length;
  return <div className="stack">
    <p className="small muted" style={{ margin: 0 }}>Everyone who was ever added to Aali One. Nobody is erased: a person who leaves is kept here with their details and history, but only active people can sign in.</p>
    <div className="stats" style={{ marginBottom: 0 }}><div className="stat"><span className="l">Active</span><span className="v">{n('Active')}</span></div><div className="stat"><span className="l">Deactivated</span><span className="v">{n('Deactivated')}</span></div>
      <div className="stat"><span className="l">Removed</span><span className="v">{n('Removed')}</span></div><div className="stat"><span className="l">Total ever added</span><span className="v">{rows.length}</span></div></div>
    <div className="seg" role="group">{[['all', 'Everyone'], ['active', 'Active'], ['deactivated', 'Deactivated'], ['removed', 'Removed']].map(([v, l]) => <button key={v} type="button" aria-pressed={f === v} onClick={() => setF(v)}>{l}</button>)}</div>
    {list.length ? <div className="tbl"><table><thead><tr><th>Name</th><th>Designation</th><th>Company · team</th><th>Status</th><th>Joined</th><th>Last signed in</th><th>Left on</th><th>Reason</th><th /></tr></thead><tbody>
      {list.map((u) => { const [l, k] = state(u); return <tr key={u.id} className="click" onClick={() => show(u)} style={{ opacity: u.removedAt ? 0.8 : 1 }}>
        <td><b>{u.fullName || u.name}</b>{u.display && <span className="small muted"> · shown as “{u.display}”</span>}<div className="small muted">{u.email}</div><div className="small muted num">{u.phone || ''}</div></td><td>{desig(u)}</td><td>{u.company}<div className="small muted">{TEAMS[u.team]} team</div></td>
        <td><Pill k={k}>{l}</Pill>{u.isAdmin && <> <Pill k="info">Admin</Pill></>}</td><td className="num">{u.createdAt ? fmtDT(u.createdAt) : '—'}</td><td className="num">{u.lastLogin ? fmtDT(u.lastLogin) : 'Never'}</td>
        <td className="num">{u.removedAt ? fmtDT(u.removedAt) : '—'}</td><td style={{ maxWidth: 200 }}>{u.removedReason || '—'}</td><td className="small muted">History</td></tr>; })}</tbody></table></div> : <Empty>No one in this list.</Empty>}
    {open && <Modal wide title={open.fullName || open.name} onClose={() => setOpen(null)} footer={<><span />{open.removedAt && store.me.isAdmin ? <button className="btn primary" type="button" onClick={() => restore(open)}>Restore to the team</button> : <button className="btn" type="button" onClick={() => setOpen(null)}>Close</button>}</>}>
      <div className="stack"><div className="row"><Pill k={state(open)[1]}>{state(open)[0]}</Pill><Pill>{desig(open)}</Pill><Pill>{open.company}</Pill><Pill>{TEAMS[open.team]} team</Pill></div>
        <div className="form"><div><span className="lbl">Login email</span><div>{open.email}</div></div><div><span className="lbl">Mobile</span><div className="num">{open.phone || '—'}</div></div>
          <div><span className="lbl">Joined</span><div className="num">{open.createdAt ? fmtDT(open.createdAt) : '—'}</div></div><div><span className="lbl">Last signed in</span><div className="num">{open.lastLogin ? `${fmtDT(open.lastLogin)} · ${open.logins} sign-in${open.logins === 1 ? '' : 's'} in all` : 'Never'}</div></div>
          {open.removedAt && <><div><span className="lbl">Removed on</span><div className="num">{fmtDT(open.removedAt)} by {uname(open.removedBy)}</div></div><div><span className="lbl">Reason</span><div>{open.removedReason}</div></div></>}</div>
        <div><span className="lbl">Work in the system</span>{!hist ? <p className="small muted" style={{ margin: 0 }}>Loading…</p> : <div className="row small">{hist.work.reports > 0 && <Pill k="gold">{hist.work.reports} daily report{hist.work.reports === 1 ? '' : 's'}</Pill>}
          {hist.work.types.map((x) => <Pill key={x.type} k="gold">{x.n} {x.type}{x.n === 1 ? '' : 's'}</Pill>)}{!hist.work.reports && !hist.work.work && <span className="muted">Nothing recorded.</span>}</div>}</div>
        <div><span className="lbl">History of this account</span>{!hist ? null : hist.history.length ? <ul className="log">{hist.history.map((h, i) => <li key={i}><span className="num">{fmtDT(h.at)}</span><span>{h.summary} <span className="faint">· {uname(h.user_id)}</span></span></li>)}</ul> : <p className="small muted" style={{ margin: 0 }}>No changes recorded.</p>}</div>
      </div></Modal>}
  </div>;
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
  return <div className="card stack" style={{ maxWidth: 820 }}>
    <div className="row between"><h2 style={{ margin: 0 }}>How Aali One works</h2><button className="btn" type="button" onClick={openGuide}>Show the first-day guide again</button></div>
    <p className="small muted" style={{ margin: 0 }}>To find a lead, client or business quickly, press <b>Ctrl + K</b> anywhere and type a name or a number.</p><ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
    <li><b>Enquiry</b> (form, website /enquire, or import) → duplicate check on mobile + service → given to the next BDE, or the client's own BDE.</li>
    <li><b>Lead</b>: call, log the outcome, set the next follow-up, mark Hot / Warm / Cold. <b>Convert</b> → client + deal.</li>
    <li><b>Deal</b>: stages with win chance, quick actions, follow-up plans, quotation (discount over the limit needs approval).</li>
    <li><b>Won</b> → handoff note → project (from a template). No advance = no work start. The BDE collects the advance; the receipt unlocks the project.</li>
    <li><b>Project</b>: IT Manager sets the lead; tasks, milestones, timeline, changes list, time; deadline changes need a reason.</li>
    <li><b>Sign-off</b>: the client signs on screen (photo with consent, rating) → certificate → Live. Share the progress link with the client any time.</li>
    <li><b>After Live</b>: final payment, monthly maintenance fees, renewals, support requests with promised dates.</li>
    <li><b>Everyone</b> starts the day on <b>Today</b>. Managers see their team's late items; top management gets anything 3+ days late and the Monday summary.</li></ol></div>;
}

// A person's personal email (payslips will be sent there), in People → Actions.
function PersonalEmail({ u, busy, save }) {
  const [v, setV] = useState(u.personalEmail || '');
  return <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Personal email (payslips will be sent here)"><In type="email" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" style={{ minWidth: 260 }} /></Field>
    <button className="btn sm" type="button" disabled={busy || v.trim() === (u.personalEmail || '')} onClick={() => save(v.trim())}>Save email</button></div>;
}

// My notification sound (only for the people in SOUND_PEOPLE): choose a short sound once; every device you sign in on plays it when a
// notification arrives.
function MySound() {
  const [s, setS] = useState(undefined), [vol, setVol] = useState(0.8), [busy, setBusy] = useState(false);
  useEffect(() => { mySound(true).then((x) => { setS(x); if (x) setVol(x.volume); }); }, []);
  const save = async (body, ok) => { const r = await attempt(() => http('PUT', '/me/sound', body), ok); if (r) { rememberSound(r.sound); setS(r.sound); } };
  async function pick(e) { const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    if (!/^audio\//.test(file.type)) return toast('Choose a sound file: MP3, M4A, WAV or OGG.', true);
    setBusy(true); const up = await attempt(() => upload(file)); if (up) await save({ fileId: up.id, volume: vol }, 'Sound saved. All your devices use it now.'); setBusy(false); }
  return <div className="card stack"><h2>My notification sound</h2>
    <p className="small muted" style={{ margin: 0 }}>Plays when a new notification arrives, on every device you sign in on. Use a short sound (1–3 seconds, up to 3 MB). It plays once you have clicked anywhere on the page.</p>
    {s === undefined ? <span className="small muted">Loading…</span> : <>
      <div className="row">{s ? <><Pill k="gold">♪ {s.name}</Pill><button className="btn sm" type="button" onClick={() => playSound({ ...s, volume: vol })}>Play</button></> : <span className="small muted">No sound chosen – notifications are silent.</span>}</div>
      <Field label={`Loudness: ${Math.round(vol * 100)}%`}><input type="range" min="0.05" max="1" step="0.05" value={vol} onChange={(e) => setVol(+e.target.value)}
        onMouseUp={() => s && save({ fileId: s.fileId, volume: vol })} onTouchEnd={() => s && save({ fileId: s.fileId, volume: vol })} onKeyUp={() => s && save({ fileId: s.fileId, volume: vol })} /></Field>
      <div className="row"><label className="btn sm primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Saving…' : s ? 'Choose another sound' : 'Choose a sound'}
        <input type="file" accept="audio/*" hidden disabled={busy} onChange={pick} /></label>
        {s && <button className="btn sm ghost" type="button" onClick={() => save({ fileId: null }, 'Sound removed. Notifications are silent again.')}>Remove</button>}</div></>}
  </div>;
}

// My payslips: each person's own payslips, once HR has marked that month as paid. Nothing else of payroll is shown.
function useMySlips() {
  const [slips, setSlips] = useState(null);
  useEffect(() => { let on = true; http('GET', '/payroll/mine').then((r) => on && setSlips(r.slips), () => on && setSlips([])); return () => { on = false; }; }, []);
  return slips;
}
function MySlips() {
  const slips = useMySlips();
  if (!slips?.length) return null; // nothing to show until a month is paid (and nothing for the Chairman, who is not on the payroll)
  return <div className="card stack"><h2>My payslips</h2>
    {slips.slice(0, 12).map((x) => <Link key={x.month} to={'/settings/payslip/' + x.month} className="row between small" style={{ textDecoration: 'none', color: 'inherit' }}>
      <b>{monthLabel(x.month)}</b><span className="num">{inr(x.item.net)}</span></Link>)}
    <p className="small muted" style={{ margin: 0 }}>Only you can see your payslips here.</p></div>;
}
function MyPayslip() {
  const { month } = useParams(), slips = useMySlips(), x = slips?.find((s) => s.month === month);
  if (!slips) return <p className="muted">Loading…</p>;
  if (!x) return <Empty>No payslip for this month. <Link to="/settings/me">Back</Link></Empty>;
  return <><div className="row no-print" style={{ marginBottom: 12 }}><Link className="btn" to="/settings/me">My profile</Link><button className="btn primary" type="button" onClick={() => window.print()}>Print / Save PDF</button></div>
    <div className="paper-wrap"><PayslipSheet run={{ month: x.month, paidOn: x.paidOn }} i={x.item} /></div></>;
}
