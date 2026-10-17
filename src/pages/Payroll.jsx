// Payroll. HR (a person with the "HR & payroll" switch – today the Company Secretary) keeps each person's salary sheet, loans and
// advances, and runs each month's payroll from Aali HRM's attendance (server/hrm.js). The Operations Manager reads everything, reviews
// each month and writes remarks. The Founder & Chairman sees everything and can step in and change it (HR and the Operations Manager
// are then told). Nobody else sees this page or its data (shared/access.js).
// All the arithmetic is in shared/payroll.js; the server saves the figures, this page shows the same figures before saving.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore, list, get, create, update, store, http, saveSetting, download } from '../api.js';
import { settings, uname, fmtDate, fmtDT, today, inr, can, canEdit, desig, COMPANIES, GROUP } from '../lib.js';
import { DEFAULT_SETTINGS } from '../../shared/defaults.js';
import { payFor, splitGross, employerCost, monthLabel, addMonths, daysIn, loanLeft, grossOf } from '../../shared/payroll.js';
import { Field, In, Sel, Pick, Pill, Seg, Tabs, Empty, Modal, Stat, DeleteButton, Log, attempt, toast, RO, ViewOnly } from '../ui.jsx';
import { PayslipSheet } from '../doc.jsx';
import ClientPayroll, { AttendanceUpload, attendanceTemplate, statutoryFile, sheetLine, employeesOf, extrasOnly, sheetExtras } from './ClientPayroll.jsx';
import { xlsxBlob } from '../xlsx.js';

const rules = () => ({ ...DEFAULT_SETTINGS.payroll, ...(settings().payroll || {}) });
const thisMonth = () => today().slice(0, 7);
// Everyone on the payroll: all the staff except the Founder & Chairman (and the setup account).
// … and the staff without a login (a maid, a personal secretary) whom HR adds here.
const payees = () => list('payee').filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name, fullName: p.name, designation: p.designation || 'Staff', company: p.company, payee: p }));
const staff = () => [...store.users.filter((u) => u.active && !u.removedAt && !['chairman', 'admin'].includes(u.title)), ...payees()].sort((a, b) => a.name.localeCompare(b.name));
const META = ['id', 'type', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'sample', 'log', 'revisions', 'recovered', 'name'];
const strip = (o) => { const d = { ...o }; META.forEach((k) => delete d[k]); return d; };
const STATUS = { draft: ['Draft – HR is preparing it', 'warn'], locked: ['Locked – ready to pay', 'info'], paid: ['Paid', 'ok'] };

export default function Payroll() {
  useStore(); const loc = useLocation(), nav = useNavigate(), seg = loc.pathname.split('/')[2] || 'month', hr = canEdit('payroll');
  if (!can('payroll')) return <Empty>Payroll is seen by HR, the Operations Manager and the Founder & Chairman only.</Empty>;
  if (seg === 'slips') return <Slips id={loc.pathname.split('/')[3]} />;
  return <>
    <div className="topbar"><h1>Payroll <ViewOnly when={!hr} /></h1></div>
    {!hr && <div className="banner info" style={{ marginBottom: 12 }}>You can read every figure, review each month and write remarks. HR makes the changes.</div>}
    {hr && store.me.title === 'chairman' && <div className="banner info" style={{ marginBottom: 12 }}>You can see and change everything here. When you change something, HR and the Operations Manager are told.</div>}
    <Tabs value={seg} onChange={(v) => nav(v === 'month' ? '/payroll' : '/payroll/' + v)} tabs={[['month', 'Monthly payroll'], ['salaries', 'Salaries'], ['loans', 'Loans & advances'], ['rules', 'Rules & Aali HRM']]} />
    <div style={{ marginTop: 16 }}>{seg === 'salaries' ? <Salaries hr={hr} /> : seg === 'loans' ? <Loans hr={hr} /> : seg === 'rules' ? <Rules hr={hr} /> : <Month hr={hr} />}</div>
  </>;
}

// Money → Client payroll: its own page, for the same people as Payroll; each client's months use this page's monthly payroll screen.
export function ClientPayrollPage() {
  useStore(); const loc = useLocation(), hr = canEdit('clientpay');
  if (!can('clientpay')) return <Empty>Client payroll is seen by HR and the Operations Manager only.</Empty>;
  if (loc.pathname.split('/')[2] === 'slips') return <Slips id={loc.pathname.split('/')[3]} />;
  return <>
    <div className="topbar"><h1>Client payroll <ViewOnly when={!hr} /></h1></div>
    {!hr && <div className="banner info" style={{ marginBottom: 12 }}>You can read every client's payroll, review each month and write remarks. HR makes the changes.</div>}
    {hr && store.me.title === 'chairman' && <div className="banner info" style={{ marginBottom: 12 }}>You can see and change every client's payroll. When you change something, HR and the Operations Manager are told.</div>}
    <ClientPayroll hr={hr} Month={Month} Cal={AttendanceMonth} parts={loc.pathname.split('/').slice(2)} />
  </>;
}

// ---------- one month ----------
// pc: a payroll client's months (Client payroll); without it, Aali's own.
function Month({ hr, pc }) {
  const [sp, setSp] = useSearchParams(), runs = list('payrun').filter((r) => (r.pclientId || '') === (pc?.id || '')).sort((a, b) => b.month.localeCompare(a.month));
  const ready = pc ? employeesOf(pc).length > 0 : list('salary').length > 0;
  const m = /^\d{4}-\d\d$/.test(sp.get('m') || '') ? sp.get('m') : addMonths(thisMonth(), -1), run = runs.find((r) => r.month === m), [busy, setBusy] = useState(false);
  const months = Array.from({ length: 13 }, (_, i) => addMonths(thisMonth(), -i));
  return <div className="stack">
    <div className="row"><span className="lbl">Month</span><Sel value={m} onChange={(v) => setSp({ m: v })} options={months.map((x) => [x, monthLabel(x) + (runs.some((r) => r.month === x) ? '' : ' – not made')])} style={{ width: 'auto' }} /></div>
    {run ? <Run run={run} hr={hr} /> : <div className="card stack"><h2 style={{ margin: 0 }}>{monthLabel(m)}</h2>
      <p style={{ margin: 0 }}>The payroll for this month is not made yet.{!hr ? ' HR makes it.' : pc ? ` Making it lists ${pc.name}'s employees${pc.attendance === 'hrm' ? ' and reads their attendance from their HRM' : '; then upload the attendance Excel they sent'}. Nothing is paid until you lock it and pay it.` : ' Making it reads everyone’s attendance from Aali HRM and works out each person’s pay. Nothing is paid until you lock it and pay it.'}</p>
      {hr && <div><button className="btn primary" type="button" disabled={busy || !ready || pc?.active === false} onClick={async () => { setBusy(true); await attempt(() => create('payrun', { month: m, ...(pc ? { pclientId: pc.id } : {}) }), `Payroll for ${monthLabel(m)} is made.`); setBusy(false); }}>Make payroll for {monthLabel(m)}</button>
        {!ready && <span className="small muted" style={{ marginLeft: 10 }}>{pc ? 'Add the employees first (Employees tab).' : 'Enter the salaries first (Salaries tab).'}</span>}</div>}</div>}
    {runs.length > 0 && <div className="card stack"><h3 style={{ margin: 0 }}>All months</h3><div className="tbl"><table><thead><tr><th>Month</th><th>Status</th><th className="n">People</th><th className="n">Net paid</th><th>Paid on</th></tr></thead><tbody>
      {runs.map((r) => <tr key={r.id} className="click" onClick={() => setSp({ m: r.month })}><td><b>{monthLabel(r.month)}</b></td><td><Pill k={STATUS[r.status][1]}>{STATUS[r.status][0].split(' –')[0]}</Pill></td>
        <td className="n">{r.totals?.people}</td><td className="n">{inr(r.totals?.net)}</td><td>{r.paidOn ? fmtDate(r.paidOn) : '—'}</td></tr>)}</tbody></table></div></div>}
  </div>;
}

function Run({ run, hr }) {
  const [person, setPerson] = useState(null), [ask, setAsk] = useState(null), [busy, setBusy] = useState(false), [rm, setRm] = useState({ text: '', userId: '' }), [sheet, setSheet] = useState(false), client = !!run.pclientId;
  const t = run.totals || {}, label = monthLabel(run.month), draft = run.status === 'draft', att = run.att || {};
  const theirs = client && att.connected, xs = client ? sheetExtras(get(run.pclientId)) : []; // a client's own HRM gives the days; an Excel then brings only the extras
  const act = async (data, ok) => { setBusy(true); const r = await attempt(() => update(run.id, data), ok); setBusy(false); return r; };
  const stuck = (run.items || []).filter((i) => i.net < 0 || (!i.days.typed && !i.days.att));
  return <div className="stack">
    <div className="row" style={{ alignItems: 'center' }}><h2 style={{ margin: 0 }}>{label}</h2><Pill k={STATUS[run.status][1]}>{STATUS[run.status][0]}</Pill><span className="grow" />
      {hr && draft && (!client || theirs) && <button className="btn" type="button" disabled={busy} onClick={() => act({ _refresh: true }, `Attendance read again from ${client ? run.employer?.name + '\'s HRM' : 'Aali HRM'}.`)}>Read attendance again</button>}
      {hr && draft && client && (!theirs || xs.length > 0) && <><button className="btn ghost" type="button" onClick={() => attendanceTemplate(run)}>{extrasOnly(run) ? 'Extras template' : 'Attendance template'}</button><button className="btn" type="button" onClick={() => setSheet(true)}>{extrasOnly(run) ? 'Extras Excel' : 'Attendance Excel'}</button></>}
      {hr && draft && <button className="btn primary" type="button" disabled={busy || !!stuck.length} title={stuck.length ? 'Fix the people marked first' : ''} onClick={() => setAsk('lock')}>Lock payroll</button>}
      {hr && run.status === 'locked' && <><button className="btn" type="button" onClick={() => setAsk('reopen')}>Reopen…</button><button className="btn primary" type="button" onClick={() => setAsk('paid')}>Mark as paid…</button></>}
      {run.status !== 'draft' && <><Link className="btn" to={`${client ? '/client-payroll' : '/payroll'}/slips/${run.id}`}>Payslips</Link><button className="btn" type="button" onClick={() => bankFile(run)}>Bank list (Excel)</button>
        <button className="btn" type="button" onClick={() => statutoryFile(run)}>PF · ESI · PT (Excel)</button></>}</div>
    <div className="stats"><Stat label="People" value={t.people || 0} /><Stat label="Gross for the month" value={inr(t.gross)} /><Stat label="Deductions" value={inr(t.deductions)} />
      <Stat label="Net to pay" value={inr(t.net)} tone="ok" /><Stat label={client ? "Employer's PF + ESI" : "Company's PF + ESI"} value={inr((t.employerPf || 0) + (t.employerEsi || 0))} sub="on top of the gross" /></div>
    <div className={'banner ' + (['hrm', 'excel'].includes(att.source) ? 'info' : 'warn')}>{client ? sheetLine(run, t, att) : att.source === 'hrm' ? `Attendance read from Aali HRM on ${fmtDT(att.at)} – ${att.found} of ${t.people} people found.`
      : att.source === 'kept' ? `Aali HRM could not be reached just now, so the attendance read on ${fmtDT(att.at)} is kept. Press “Read attendance again” later.`
      : att.connected ? `Aali HRM could not be read. ${att.error || ''} Try “Read attendance again”, or type the paid days for each person.` : 'Aali HRM is not linked yet (see Rules & Aali HRM). Until then, open each person and type their paid days.'}
      {run.warnMonth ? ' ' + run.warnMonth : ''}</div>
    {run.status === 'locked' && <div className="small muted">Locked by {uname(run.lockedBy)} on {fmtDT(run.lockedAt)}. Pay the salaries through the bank, then press “Mark as paid”.</div>}
    {run.status === 'paid' && <div className="small muted">Paid on {fmtDate(run.paidOn)} (marked by {uname(run.paidBy)}).</div>}
    {hr && draft && stuck.length > 0 && <div className="banner bad">To lock, fix: {stuck.map((i) => i.name).join(', ')} – open them to see why.</div>}
    <div className="tbl"><table><thead><tr><th>Person</th><th className="n">Paid days</th><th className="n">Gross</th><th className="n">Deductions</th><th className="n">Net pay</th><th>Notes</th></tr></thead><tbody>
      {(run.items || []).map((i) => { const notes = (i.warn || []).length + (run.remarks || []).filter((r) => r.userId === i.userId).length;
        return <tr key={i.userId} className="click" onClick={() => setPerson(i.userId)}><td>{i.code && <span className="num faint">{i.code} · </span>}<b>{i.name}</b><div className="small muted">{[i.designation, client ? i.department : i.company].filter(Boolean).join(' · ')}</div></td>
          <td className="n">{i.days.payable} / {i.days.total}{i.days.typed && <div className="small muted">typed by HR</div>}</td><td className="n">{inr(grossOf(i))}{i.payType === 'daily' && <div className="small muted">{inr(i.rate)} a day</div>}</td><td className="n">{inr(i.ded.total)}</td>
          <td className="n"><b>{inr(i.net)}</b></td><td>{(i.warn || []).length ? <Pill k="warn">{i.warn.length} to check</Pill> : null}{notes > (i.warn || []).length && <Pill k="info">Remark</Pill>}</td></tr>; })}
    </tbody></table></div>
    <div className="card stack"><h3 style={{ margin: 0 }}>Remarks</h3>
      {(run.remarks || []).length ? (run.remarks || []).map((r, k) => <div key={k} className="small"><b>{uname(r.by)}</b> <span className="faint">{fmtDT(r.at)}{r.userId ? ' · about ' + (run.items.find((i) => i.userId === r.userId)?.name || 'a person') : ''}</span><div>{r.text}</div></div>)
        : <p className="small muted" style={{ margin: 0 }}>No remarks yet.</p>}
      <div className="row"><Sel value={rm.userId} onChange={(v) => setRm({ ...rm, userId: v })} options={(run.items || []).map((i) => [i.userId, i.name])} blank="About the whole month" style={{ width: 'auto' }} />
        <In className="in grow" value={rm.text} onChange={(e) => setRm({ ...rm, text: e.target.value })} placeholder={hr ? 'Reply or note…' : 'Your remark for HR…'} aria-label="Remark" />
        <button className="btn" type="button" disabled={busy || !rm.text.trim()} onClick={async () => { if (await act({ _remark: { text: rm.text, userId: rm.userId } }, 'Remark added.')) setRm({ text: '', userId: '' }); }}>Add remark</button></div></div>
    <details><summary className="small muted">History</summary><Log items={run.log} /></details>
    {hr && draft && <div><DeleteButton id={run.id} needsReason label="Delete this draft" /></div>}
    {person && <PersonPay run={run} item={run.items.find((i) => i.userId === person)} hr={hr && draft} onClose={() => setPerson(null)} />}
    {ask && <Ask kind={ask} run={run} busy={busy} onClose={() => setAsk(null)} onDo={async (data, ok) => { if (await act(data, ok)) setAsk(null); }} />}
    {sheet && <AttendanceUpload run={run} onClose={() => setSheet(false)} />}
  </div>;
}

function Ask({ kind, run, busy, onClose, onDo }) {
  const [v, setV] = useState(kind === 'paid' ? today() : ''), label = monthLabel(run.month);
  const say = { lock: [`Lock payroll for ${label}?`, `${run.totals.people} people, net ${inr(run.totals.net)}. After locking, the figures stay as they are; the Operations Manager is told to review it, and loan and advance cuts are recorded.`, 'Lock'],
    reopen: [`Reopen payroll for ${label}?`, 'It goes back to draft so it can be changed. The loan cuts of this month are taken back. Say why.', 'Reopen'],
    paid: [`Mark ${label} as paid?`, 'Only after the salaries have gone out from the bank. After this the month cannot change.', 'Mark as paid'] }[kind];
  return <Modal title={say[0]} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button>
    <button className="btn primary" type="button" disabled={busy || (kind === 'reopen' && v.trim().length < 5) || (kind === 'paid' && !v)}
      onClick={() => onDo(kind === 'lock' ? { status: 'locked' } : kind === 'reopen' ? { status: 'draft', _reason: v.trim() } : { status: 'paid', paidOn: v }, kind === 'lock' ? 'Locked. The Operations Manager is told.' : kind === 'reopen' ? 'Reopened.' : 'Marked as paid.')}>{say[2]}</button></>}>
    <div className="stack"><p style={{ margin: 0 }}>{say[1]}</p>
      {kind === 'reopen' && <Field label="Why (5+ characters)"><In value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>}
      {kind === 'paid' && <Field label="Paid on"><In type="date" value={v} max={today()} onChange={(e) => setV(e.target.value)} /></Field>}</div></Modal>;
}

// One person's pay for the month: where every figure comes from, and HR's changes for this month only.
function PersonPay({ run, item: i, hr, onClose }) {
  const a = run.adj?.[i.userId] || {}, [f, setF] = useState({ days: a.days ?? '', daysWhy: a.daysWhy || '', tds: a.tds || '', other: a.other || '', otherWhy: a.otherWhy || '', extra: a.extra || '', extraWhy: a.extraWhy || '', loans: { ...(a.loans || {}) } });
  const [busy, setBusy] = useState(false), [cal, setCal] = useState(false), at = i.days.att, up = (k) => (e) => setF({ ...f, [k]: e.target.value }), client = !!run.pclientId;
  const hrmDays = !client || at?.src === 'hrm', from = !client ? 'Aali HRM' : hrmDays || (run.att?.connected && !at) ? 'their HRM' : 'the Excel';
  async function save() {
    const mine = Object.fromEntries(Object.entries({ ...f, loans: Object.fromEntries(Object.entries(f.loans).filter(([, v]) => v !== '' && v != null)) }).filter(([k, v]) => k === 'loans' ? Object.keys(v).length : v !== '' && v != null));
    const adj = { ...(run.adj || {}) }; if (Object.keys(mine).length) adj[i.userId] = mine; else delete adj[i.userId];
    setBusy(true); const r = await attempt(() => update(run.id, { adj }), 'Saved. The pay is worked out again.'); setBusy(false); if (r) onClose();
  }
  const row = (k, v) => <tr key={k}><td>{k}</td><td className="n">{v}</td></tr>;
  // Loss of pay (the user, 17 Oct 2026): what the days not paid cost against the full monthly salary, shown before the pay that is left.
  const base = at?.basis || i.days.total, lopDays = Math.max(0, Math.round((base - i.days.payable) * 2) / 2), lop = i.payType === 'daily' ? 0 : Math.max(0, (i.full?.gross || 0) - (i.earned?.gross || 0));
  return <Modal wide title={`${i.name} – ${monthLabel(run.month)}`} onClose={onClose} footer={<><Link className="btn" to={`${run.pclientId ? '/client-payroll' : '/payroll'}/slips/${run.id}?u=${i.userId}`}>Payslip</Link><span className="grow" />
    <button className="btn" type="button" onClick={onClose}>Close</button>{hr && <button className="btn primary" type="button" disabled={busy} onClick={save}>Save changes</button>}</>}>
    {cal && <AttendanceMonth userId={i.userId} name={i.name} month={run.month} pc={client ? get(run.pclientId) : null} onClose={() => setCal(false)} />}
    <div className="stack">
      {(i.warn || []).map((w, k) => <div key={k} className="banner warn">{w}</div>)}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="stack"><h3 style={{ margin: 0 }}>Paid days: {i.days.payable} of {i.days.total}</h3>
          {at ? <table className="kv"><tbody>{row('Present', at.present)}{row('Half days (½ each)', at.half)}{at.double ? row('Double shifts (one more day each)', at.double) : null}{row('Paid leave', at.paidLeave)}{row('Unpaid leave', at.unpaidLeave)}{row('Absent', at.absent)}
            {row(hrmDays ? 'Sundays' : 'Weekly offs', at.sundays)}{row('Holidays', at.holidays)}{at.toCome ? row('Days still to come (not counted)', at.toCome) : null}{row('Late arrivals (for reference only)', at.late)}
            {at.basis ? row(`One day's pay = the salary ÷ ${at.basis}: days lost (absent, unpaid leave, half of each half day${at.toCome ? ', days to come' : ''})`, '− ' + at.lost) : null}
            <tr><td><b>Paid days from {from}</b>{at.basis ? <span className="faint"> ({at.basis} − {at.lost})</span> : null}</td><td className="n"><b>{at.payable}</b></td></tr></tbody></table> : <p className="small muted" style={{ margin: 0 }}>No attendance from {from} for this person.</p>}
          {at && hrmDays && <div><button className="btn sm" type="button" onClick={() => setCal(true)}>See each day</button></div>}
          {i.days.typed && <div className="small">Paid days typed by HR: <b>{i.days.payable}</b>{a.daysWhy ? ` – ${a.daysWhy}` : ''}</div>}</div>
        <div className="stack"><h3 style={{ margin: 0 }}>Pay</h3>
          <table className="kv"><tbody>{i.payType === 'daily' ? row(`Wages: ${inr(i.rate)} a day × ${i.days.payable} days`, inr(i.earned.gross))
            : <>{lop > 0 && <>{row('Monthly salary', inr(i.full.gross))}
              {row(`Loss of pay: ${lopDays} ${lopDays === 1 ? 'day' : 'days'} of ${base}${at?.toCome ? ` (${at.toCome} still to come)` : ''}`, '− ' + inr(lop))}</>}
              {row('Basic', inr(i.earned.basic))}{i.earned.hra ? row('HRA', inr(i.earned.hra)) : null}{row('Special allowance', inr(i.earned.special))}</>}{i.extra ? row(`Extra: ${i.extraWhy}`, inr(i.extra)) : null}
            {(i.earnExtras || []).map((x) => row(`${x.name}${x.note ? ` (${x.note})` : ''}`, inr(x.amount)))}
            <tr><td><b>Earned this month</b>{i.payType !== 'daily' && <> <span className="faint">(salary {inr(i.full.gross)})</span></>}</td><td className="n"><b>{inr(grossOf(i))}</b></td></tr>
            {i.ded.pf ? row(`PF (${run.rules?.pfEe ?? 12}% of ${i.payType === 'daily' ? 'the wage' : 'basic'})`, '− ' + inr(i.ded.pf)) : null}{i.ded.esi ? row('ESI', '− ' + inr(i.ded.esi)) : null}{i.ded.pt ? row('Professional Tax', '− ' + inr(i.ded.pt)) : null}{i.ded.tds ? row('TDS', '− ' + inr(i.ded.tds)) : null}
            {i.ded.fixed.map((x) => row(x.name, '− ' + inr(x.amount)))}{i.ded.loans.map((x) => row(x.kind === 'advance' ? 'Advance' : 'Loan', '− ' + inr(x.amount)))}{(i.ded.extras || []).map((x) => row(`${x.name}${x.note ? ` (${x.note})` : ''}`, '− ' + inr(x.amount)))}{i.ded.other ? row(i.ded.otherWhy || 'Other', '− ' + inr(i.ded.other)) : null}
            <tr><td><b>Net pay</b></td><td className="n"><b>{inr(i.net)}</b></td></tr></tbody></table>
          <div className="small muted">The {client ? 'employer' : 'company'} also pays PF {inr(i.employer.pf)} and ESI {inr(i.employer.esi)}.</div></div></div>
      {hr && <div className="card form" style={{ background: 'var(--gold-50)', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}><h3 className="full" style={{ margin: 0 }}>Changes for {monthLabel(run.month)} only</h3>
        <Field label={`Paid days (leave empty to use ${from})`}><In type="number" min="0" max={i.days.total} step="0.5" value={f.days} onChange={up('days')} /></Field>
        <Field label="Why typed by hand"><In value={f.daysWhy} onChange={up('daysWhy')} placeholder="e.g. worked at the client site" /></Field>
        <Field label="TDS (income tax) ₹"><In type="number" min="0" value={f.tds} onChange={up('tds')} /></Field><span />
        <Field label="Other deduction ₹"><In type="number" min="0" value={f.other} onChange={up('other')} /></Field><Field label="For what"><In value={f.otherWhy} onChange={up('otherWhy')} placeholder="e.g. fine, damage" /></Field>
        <Field label="Extra pay ₹ (not cut for leave)"><In type="number" min="0" value={f.extra} onChange={up('extra')} /></Field><Field label="For what"><In value={f.extraWhy} onChange={up('extraWhy')} placeholder="e.g. bonus, arrears" /></Field>
        {i.ded.loans.map((x) => <Field key={x.id} label={`${x.kind === 'advance' ? 'Advance' : 'Loan'} cut this month ₹ (due ${inr(x.due)})`}><In type="number" min="0" value={f.loans[x.id] ?? ''} placeholder={String(x.due)} onChange={(e) => setF({ ...f, loans: { ...f.loans, [x.id]: e.target.value } })} /></Field>)}</div>}
      {(run.remarks || []).filter((r) => r.userId === i.userId).map((r, k) => <div key={k} className="small"><b>{uname(r.by)}</b> <span className="faint">{fmtDT(r.at)}</span> – {r.text}</div>)}
    </div></Modal>;
}

// The list the bank needs to send the salaries: an Excel file (text cells, so long account numbers stay exact).
function bankFile(run) {
  const rows = (run.items || []).filter((i) => i.net > 0);
  const blob = xlsxBlob([{ name: 'Salaries ' + run.month, widths: [[30, 2], [22, 2], [14, 2], [12, 2], [30, 2]],
    rows: [['Beneficiary name', 'Account number', 'IFSC', 'Amount', 'Narration'].map((c) => [c, 1]), ...rows.map((i) => [i.bank?.holder || i.name, i.bank?.account || 'MISSING', i.bank?.ifsc || 'MISSING', String(i.net), `Salary ${monthLabel(run.month)}`])] }]);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Salaries-${run.month}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  if (rows.some((i) => !i.bank?.account || !i.bank?.ifsc)) toast('Some people have no bank account on their salary sheet – marked MISSING in the file.', true);
}

// Download (the user, 17 Oct 2026): every payslip of the month as its own PDF, together in one ZIP – or one person's PDF.
function DownloadSlips({ run, u }) {
  const [busy, setBusy] = useState(false), go = async () => { setBusy(true); await attempt(() => download(`/payroll/runs/${run.id}/payslips${u ? '?u=' + u : ''}`, u ? 'Payslip.pdf' : 'Payslips.zip'), u ? 'Payslip downloaded.' : 'Payslips downloaded – one PDF for each person, in a ZIP.'); setBusy(false); };
  return <button className="btn primary" type="button" disabled={busy} onClick={go}>{busy ? 'Making the PDFs…' : u ? 'Download PDF' : `Download all (${(run.items || []).length} PDFs in a ZIP)`}</button>;
}
function Slips({ id }) {
  const [sp] = useSearchParams(), run = get(id), u = sp.get('u');
  if (!run) return <Empty>This payroll was not found. <Link to="/payroll">Back</Link></Empty>;
  const items = (run.items || []).filter((i) => !u || i.userId === u);
  return <>
    <div className="topbar no-print"><h1>Payslips <small>{monthLabel(run.month)}{u && items[0] ? ' · ' + items[0].name : ` · ${items.length} people`}</small></h1>
      <div className="row"><Link className="btn" to={run.pclientId ? `/client-payroll/${run.pclientId}?m=${run.month}` : `/payroll?m=${run.month}`}>Back</Link>{run.status !== 'draft' && <DownloadSlips run={run} u={u} />}</div></div>
    {run.status === 'draft' && <div className="banner warn no-print" style={{ marginBottom: 12 }}>This month is still a draft – the figures may change until HR locks it.</div>}
    {items.map((i) => <div key={i.userId} className="paper-wrap slip-page"><PayslipSheet run={run} i={i} /></div>)}
  </>;
}

// ---------- salary sheets ----------
function Salaries({ hr }) {
  const [open, setOpen] = useState(null), [pe, setPe] = useState(null), r = rules(), m = thisMonth(), sheets = list('salary'), by = new Map(sheets.map((s) => [s.userId, s]));
  const people = staff(), gone = sheets.filter((s) => !people.some((u) => u.id === s.userId));
  const est = (s) => payFor({ month: m, salary: s, att: null, rules: r, adj: { days: daysIn(m) } });
  const done = people.filter((u) => by.has(u.id)), gross = done.reduce((a, u) => a + by.get(u.id).gross, 0), ctc = done.reduce((a, u) => a + employerCost(by.get(u.id), r).ctc, 0);
  const line = (u, s, left) => { const e = s && est(s), c = s && employerCost(s, r);
    return <tr key={u?.id || s.id} className={s || hr ? 'click' : ''} onClick={() => (s || hr) && setOpen({ u: u || { id: s.userId, name: s.name }, s })}><td><b>{u?.name || s.name}</b>{left && <> <Pill>No longer here</Pill></>}{u?.payee && <> <Pill>No login</Pill></>}<div className="small muted">{u ? `${desig(u)} · ${u.company}` : ''}</div>
      {hr && (u?.payee || list('payee').find((p) => p.id === s?.userId)) && <button className="btn ghost sm" type="button" onClick={(e) => { e.stopPropagation(); setPe({ p: u?.payee || list('payee').find((p) => p.id === s.userId) }); }}>Details</button>}</td>
      {s ? <><td className="n">{inr(s.gross)}</td><td className="n">{inr(e.ded.total)}</td><td className="n"><b>{inr(e.net)}</b></td><td className="n">{inr(c.ctc)}</td>
        <td>{[s.pf && 'PF', s.esi && s.gross <= r.esiLimit && 'ESI', s.pt && 'PT'].filter(Boolean).join(' · ') || '—'}</td><td>{s.bank?.account && s.bank?.ifsc ? <Pill k="ok">Bank ✓</Pill> : <Pill k="warn">No bank</Pill>}</td></>
        : <td colSpan={6}><span className="muted">Not entered yet</span>{hr && <button className="btn sm" type="button" style={{ marginLeft: 10 }}>+ Enter salary</button>}</td>}</tr>; };
  return <div className="stack">
    <div className="stats"><Stat label="On the payroll" value={done.length} sub={`${people.length - done.length} still to enter`} /><Stat label="Monthly gross" value={inr(gross)} /><Stat label="Monthly cost (CTC)" value={inr(ctc)} sub="gross + company's PF and ESI" /></div>
    <div className="row"><p className="small muted grow" style={{ margin: 0 }}>Everyone working here except the Founder & Chairman. Figures are for a full month; the monthly payroll cuts unpaid days.</p>
      {hr && <button className="btn" type="button" onClick={() => setPe({})}>+ Staff without a login</button>}</div>
    <div className="tbl"><table><thead><tr><th>Person</th><th className="n">Monthly gross</th><th className="n">Deductions</th><th className="n">Take-home</th><th className="n">CTC</th><th>Statutory</th><th>Bank</th></tr></thead>
      <tbody>{people.map((u) => line(u, by.get(u.id)))}{gone.map((s) => line(null, s, true))}</tbody></table></div>
    {open && <SalarySheet {...open} hr={hr} onClose={() => setOpen(null)} />}
    {pe && <PayeeForm p={pe.p} onClose={() => setPe(null)} />}
  </div>;
}

// Someone on the payroll who does not use Aali One: HR keeps their details here; they never sign in.
export function PayeeForm({ p, prefill, onClose }) {
  const [f, setF] = useState(() => ({ name: '', designation: '', company: COMPANIES[0], email: '', personalEmail: '', phone: '', active: true, ...(p || {}), ...(prefill || {}) }));
  const [busy, setBusy] = useState(false), up = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  async function save() {
    const data = { name: f.name, designation: f.designation, company: f.company, email: f.email, personalEmail: f.personalEmail, phone: f.phone, active: f.active };
    setBusy(true); const ok = await attempt(() => (p ? update(p.id, data) : create('payee', data)), p ? 'Saved.' : `${f.name.trim()} added. Enter their salary next.`); setBusy(false); if (ok) onClose(true);
  }
  return <Modal title={p ? p.name : 'Staff without a login'} onClose={() => onClose()} footer={<><button className="btn" type="button" onClick={() => onClose()}>Cancel</button>
    <button className="btn primary" type="button" disabled={busy || f.name.trim().length < 2} onClick={save}>{p ? 'Save' : 'Add to the payroll'}</button></>}>
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>For someone on the payroll who does not use Aali One, such as a maid or a personal secretary. They never sign in; HR prints or sends their payslips. Their attendance is read from Aali HRM with the email below.</p>
      <div className="form">
        <Field label="Full name *"><In value={f.name} onChange={up('name')} /></Field>
        <Field label="Designation"><In value={f.designation} onChange={up('designation')} placeholder="e.g. Personal Secretary" /></Field>
        <Field label="Company"><Sel value={f.company} onChange={up('company')} options={[GROUP, ...COMPANIES]} /></Field>
        <Field label="Phone"><In inputMode="tel" value={f.phone} onChange={up('phone')} /></Field>
        <Field label="Email in Aali HRM" hint="The email they punch in with. Leave empty if they are not in Aali HRM – HR then types their paid days."><In type="email" value={f.email} onChange={up('email')} /></Field>
        <Field label="Personal email" hint="For sending payslips later. If they have none, leave it empty: HR prints the payslip and hands it over (WhatsApp to the phone above can come later)."><In type="email" value={f.personalEmail} onChange={up('personalEmail')} /></Field>
        {p && <label className="check full"><input type="checkbox" checked={f.active} onChange={up('active')} /> <span><b>Still working here</b><br /><span className="small muted">Untick when they leave: they come off the payroll after the leaving date on their salary sheet.</span></span></label>}
      </div></div></Modal>;
}

function SalarySheet({ u, s, hr, onClose }) {
  const r = rules(), [f, setF] = useState(() => (s ? { ...s, bank: { ...(s.bank || {}) }, fixed: [...(s.fixed || [])], basicPct: s.basicPct ?? '' }
    : { userId: u.id, gross: '', from: '', basicPct: '', pf: true, pfCap: true, esi: false, pt: true, fixed: [], bank: { holder: u.fullName || u.name }, pan: '', uan: '', esiNo: '', joined: '', left: '', note: '' }));
  const [busy, setBusy] = useState(false), up = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }), bank = (k) => (e) => setF({ ...f, bank: { ...f.bank, [k]: e.target.value } });
  const g = +f.gross || 0, split = splitGross(g, r, f), est = payFor({ month: thisMonth(), salary: { ...f, gross: g }, att: null, rules: r, adj: { days: daysIn(thisMonth()) } }), c = employerCost({ ...f, gross: g }, r);
  async function save() { setBusy(true); const data = strip(f); const res = s ? await attempt(() => update(s.id, data), 'Salary saved.') : await attempt(() => create('salary', data), 'Salary sheet made.'); setBusy(false); if (res) onClose(); }
  return <Modal wide title={`Salary – ${u.name}`} onClose={onClose} footer={<>{s && hr && <DeleteButton id={s.id} needsReason label="Delete sheet" after={onClose} />}<span className="grow" /><button className="btn" type="button" onClick={onClose}>Close</button>
    {hr && <button className="btn primary" type="button" disabled={busy || !g} onClick={save}>{s ? 'Save' : 'Make salary sheet'}</button>}</>}>
    <RO when={!hr}><div className="stack">
      <div className="form"><Field label="Monthly gross salary ₹ *" hint="What the person earns in a full month, before deductions"><In type="number" min="0" value={f.gross} onChange={up('gross')} autoFocus={!s} /></Field>
        <Field label="From month" hint={s ? 'When the gross changes, choose the month the new amount starts.' : 'Empty: from the start.'}><In type="month" value={f.from || ''} onChange={up('from')} /></Field>
        <Field label={`Basic % of gross (usual: ${r.basicPct}%)`}><In type="number" min="10" max="100" value={f.basicPct} onChange={up('basicPct')} placeholder={String(r.basicPct)} /></Field>
        <div className="field"><label>Split</label><span className="small">Basic {inr(split.basic)} · HRA {inr(split.hra)} · Special {inr(split.special)}</span></div></div>
      <div className="stack gap4"><span className="lbl">Statutory deductions</span>
        <label className="check"><input type="checkbox" checked={!!f.pf} onChange={up('pf')} /> PF – {r.pfEe}% of basic (the company adds {r.pfEr}%)</label>
        {f.pf && <label className="check" style={{ marginLeft: 26 }}><input type="checkbox" checked={f.pfCap !== false} onChange={(e) => setF({ ...f, pfCap: e.target.checked })} /> Only on basic up to {inr(r.pfCeiling)}</label>}
        <label className="check"><input type="checkbox" checked={!!f.esi} onChange={up('esi')} /> ESI – {r.esiEe}% (the company adds {r.esiEr}%){f.esi && g > r.esiLimit && <span className="small" style={{ color: 'var(--warn)' }}> · not due: gross is above {inr(r.esiLimit)}</span>}</label>
        <label className="check"><input type="checkbox" checked={f.pt !== false} onChange={up('pt')} /> Professional Tax (Andhra Pradesh)</label></div>
      <div className="stack gap4"><span className="lbl">Fixed deductions every month</span>
        {f.fixed.map((x, k) => <div key={k} className="row ag-sched"><In className="in grow" value={x.name} onChange={(e) => setF({ ...f, fixed: f.fixed.map((y, j) => (j === k ? { ...y, name: e.target.value } : y)) })} placeholder="e.g. Health insurance" aria-label="Deduction" />
          <In type="number" min="0" value={x.amount} onChange={(e) => setF({ ...f, fixed: f.fixed.map((y, j) => (j === k ? { ...y, amount: e.target.value } : y)) })} aria-label="Amount a month" style={{ width: 120 }} />
          <button className="btn ghost sm ag-x" type="button" aria-label="Remove" onClick={() => setF({ ...f, fixed: f.fixed.filter((_, j) => j !== k) })}>×</button></div>)}
        <div><button className="btn sm" type="button" onClick={() => setF({ ...f, fixed: [...f.fixed, { name: f.fixed.length ? '' : 'Health insurance', amount: '' }] })}>+ Add a fixed deduction</button></div></div>
      <div className="form"><h3 className="full" style={{ margin: 0 }}>Bank and IDs</h3>
        <Field label="Account holder's name"><In value={f.bank.holder || ''} onChange={bank('holder')} /></Field><Field label="Bank"><In value={f.bank.name || ''} onChange={bank('name')} /></Field>
        <Field label="Account number"><In inputMode="numeric" value={f.bank.account || ''} onChange={bank('account')} autoComplete="off" /></Field><Field label="IFSC"><In value={f.bank.ifsc || ''} onChange={bank('ifsc')} placeholder="ICIC0001234" /></Field>
        <Field label="PAN"><In value={f.pan} onChange={up('pan')} /></Field><Field label="UAN (PF)"><In value={f.uan} onChange={up('uan')} /></Field><Field label="ESI number"><In value={f.esiNo} onChange={up('esiNo')} /></Field><span />
        <Field label="Joined on" hint="Empty: taken from Aali HRM"><In type="date" value={f.joined} onChange={up('joined')} /></Field><Field label="Left on" hint="Only when the person leaves"><In type="date" value={f.left} onChange={up('left')} /></Field>
        <Field label="Note" full><In value={f.note} onChange={up('note')} /></Field></div>
      <div className="banner info">A full month: gross {inr(g)} − deductions {inr(est.ded.total)} = <b>take-home {inr(est.net)}</b>. The company also pays PF {inr(c.pf)} and ESI {inr(c.esi)}, so the cost to company is <b>{inr(c.ctc)}</b> a month.</div>
      {s?.revisions?.length > 0 && <details><summary className="small muted">Salary history</summary>{s.revisions.slice().reverse().map((v, k) => <div key={k} className="small">{inr(v.gross)} a month{v.from ? ' from ' + monthLabel(v.from) : ''} – set by {uname(v.by)} on {fmtDT(v.at)}</div>)}</details>}
    </div></RO></Modal>;
}

// ---------- loans and advances ----------
function Loans({ hr }) {
  const [open, setOpen] = useState(null), rows = list('loan').sort((a, b) => (a.closed - b.closed) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const owed = rows.filter((l) => !l.closed).reduce((a, l) => a + loanLeft(l), 0);
  return <div className="stack">
    <div className="row"><div className="stats grow" style={{ marginBottom: 0 }}><Stat label="Open loans and advances" value={rows.filter((l) => !l.closed).length} /><Stat label="Still owed" value={inr(owed)} /></div>
      {hr && <button className="btn primary" type="button" onClick={() => setOpen({})}>+ Loan or advance</button>}</div>
    <p className="small muted" style={{ margin: 0 }}>A loan is cut a fixed amount every month; an advance is cut in one go. The cut happens when a month’s payroll is locked, and never more than the pay left after the other deductions.</p>
    {rows.length ? <div className="tbl"><table><thead><tr><th>Person</th><th>Kind</th><th className="n">Given</th><th className="n">Cut a month</th><th>From</th><th className="n">Cut so far</th><th className="n">Still owed</th><th>Status</th></tr></thead><tbody>
      {rows.map((l) => <tr key={l.id} className="click" onClick={() => setOpen(l)}><td><b>{l.name}</b></td><td>{l.kind === 'advance' ? 'Advance' : 'Loan'}</td><td className="n">{inr(l.amount)}{l.givenOn && <div className="small muted">{fmtDate(l.givenOn)}</div>}</td>
        <td className="n">{inr(l.cut)}</td><td>{monthLabel(l.from)}</td><td className="n">{inr(l.amount - loanLeft(l))}</td><td className="n"><b>{inr(loanLeft(l))}</b></td>
        <td>{l.paidOff ? <Pill k="ok">Paid off</Pill> : l.closed ? <Pill>Stopped</Pill> : <Pill k="info">Cutting</Pill>}</td></tr>)}</tbody></table></div> : <Empty>No loans or advances yet.</Empty>}
    {open && <LoanSheet l={open.id ? open : null} hr={hr} onClose={() => setOpen(null)} />}
  </div>;
}

function LoanSheet({ l, hr, onClose }) {
  const [f, setF] = useState(() => (l ? { ...l } : { userId: '', kind: 'loan', amount: '', cut: '', from: addMonths(thisMonth(), 1), givenOn: today(), note: '' })), [busy, setBusy] = useState(false), [why, setWhy] = useState('');
  const up = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e }), started = (l?.recovered || []).length > 0;
  const months = f.kind === 'advance' ? 1 : +f.cut > 0 ? Math.ceil((+f.amount || 0) / +f.cut) : 0;
  async function save(extra = {}) { setBusy(true); const data = { ...strip(f), ...extra }; const r = l ? await attempt(() => update(l.id, data), 'Saved.') : await attempt(() => create('loan', data), 'Saved. It is cut from the payroll from ' + monthLabel(f.from) + '.'); setBusy(false); if (r) onClose(); }
  return <Modal title={l ? `${l.kind === 'advance' ? 'Advance' : 'Loan'} – ${l.name}` : 'New loan or advance'} onClose={onClose} footer={<>{l && hr && !started && <DeleteButton id={l.id} needsReason after={onClose} />}<span className="grow" />
    <button className="btn" type="button" onClick={onClose}>Close</button>{hr && <button className="btn primary" type="button" disabled={busy || !f.userId || !+f.amount} onClick={() => save()}>Save</button>}</>}>
    <RO when={!hr}><div className="stack">
      <div className="form"><Field label="Person"><Pick value={f.userId} onChange={up('userId')} options={staff().map((u) => [u.id, u.name, desig(u)])} disabled={!!l} blank="Choose the person" /></Field>
        <div className="field"><label>Kind</label><Seg value={f.kind} onChange={(v) => !started && setF({ ...f, kind: v })} options={[['loan', 'Loan – cut monthly'], ['advance', 'Advance – cut in one go']]} /></div>
        <Field label="Amount given ₹"><In type="number" min="0" value={f.amount} onChange={up('amount')} /></Field><Field label="Given on"><In type="date" value={f.givenOn} onChange={up('givenOn')} /></Field>
        {f.kind === 'loan' && <Field label="Cut every month ₹"><In type="number" min="0" value={f.cut} onChange={up('cut')} /></Field>}
        <Field label="First month to cut"><In type="month" value={f.from} onChange={up('from')} disabled={started} /></Field>
        <Field label="Note" full><In value={f.note} onChange={up('note')} /></Field></div>
      {+f.amount > 0 && <div className="small muted">{f.kind === 'advance' ? `The whole ${inr(f.amount)} is cut in ${monthLabel(f.from)}.` : months ? `${months} month${months === 1 ? '' : 's'}, from ${monthLabel(f.from)} to ${monthLabel(addMonths(f.from, months - 1))}.` : ''}</div>}
      {l && <div className="stack gap4"><span className="lbl">Cut so far</span>{(l.recovered || []).length ? l.recovered.map((x) => <div key={x.month} className="small">{monthLabel(x.month)}: {inr(x.amount)}</div>) : <span className="small muted">Nothing yet.</span>}
        <div className="small"><b>Still owed: {inr(loanLeft(l))}</b></div></div>}
      {l && hr && !l.paidOff && <div className="row"><In className="in grow" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={l.closed ? '' : 'Why stop (e.g. waived, paid back in cash)'} aria-label="Reason" />
        <button className="btn" type="button" disabled={busy || (!l.closed && why.trim().length < 5)} onClick={() => save({ closed: !l.closed, _reason: why.trim() })}>{l.closed ? 'Start cutting again' : 'Stop cutting'}</button></div>}
      {l && <details><summary className="small muted">History</summary><Log items={l.log} /></details>}
    </div></RO></Modal>;
}

// ---------- one person's month, day by day, read live from Aali HRM (or, with pc, from a payroll client's own HRM) ----------
const DAY = { present: ['Present', 'ok'], half: ['Half day', 'warn'], absent: ['Absent', 'bad'], paidLeave: ['Paid leave', 'info'], unpaidLeave: ['Unpaid leave', 'bad'],
  sundays: ['Sunday', 'off'], holidays: ['Holiday', 'off'], toCome: ['', 'later'], outside: ['', 'later'] };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function AttendanceMonth({ userId, name, month, onClose, pc }) {
  const [m, setM] = useState(month), [st, setSt] = useState(null), src = pc ? `${pc.name}'s HRM` : 'Aali HRM';
  useEffect(() => { let on = true; setSt(null); http('GET', pc ? `/payroll/clients/${pc.id}/hrm?month=${m}&empId=${encodeURIComponent(userId)}` : `/payroll/hrm?month=${m}&userId=${encodeURIComponent(userId)}`)
    .then((r) => on && setSt(r), (e) => on && setSt({ error: e.message })); return () => { on = false; }; }, [m, userId, pc?.id]);
  const p = st?.people?.[0], at = p?.att, lead = (new Date(m + '-01T00:00:00Z').getUTCDay() + 6) % 7; // Monday first, as in the Calendar
  const count = (k, label, tone) => at?.[k] ? <Pill k={tone}>{label} {at[k]}</Pill> : null;
  return <Modal wide title={`${name} – attendance`} onClose={onClose} footer={<button className="btn" type="button" onClick={onClose}>Close</button>}>
    <div className="stack">
      <div className="row"><button className="btn sm" type="button" aria-label="Month before" onClick={() => setM(addMonths(m, -1))}>‹</button>
        <b style={{ minWidth: 130, textAlign: 'center' }}>{monthLabel(m)}</b><button className="btn sm" type="button" aria-label="Next month" onClick={() => setM(addMonths(m, 1))}>›</button>
        <span className="grow" /><span className="small muted">Read live from {src}</span></div>
      {!st ? <p className="small muted" style={{ margin: 0 }}>Reading {src}…</p> : st.connected === false ? <div className="banner warn">{src} is not linked yet.</div>
        : st.error ? <div className="banner bad">{st.error}</div> : !at ? <div className="banner warn">{name} is not found in {src}.{pc ? ' Their employee code must be the same as their Employee ID there.' : ' HR can match them by hand in Rules & Aali HRM.'}</div> : <>
        <div className="row" style={{ gap: 6 }}>{count('present', 'Present', 'ok')}{count('half', 'Half days', 'warn')}{count('paidLeave', 'Paid leave', 'info')}{count('unpaidLeave', 'Unpaid leave', 'bad')}
          {count('absent', 'Absent', 'bad')}{count('sundays', 'Sundays', '')}{count('holidays', 'Holidays', '')}{count('late', 'Late (not cut)', '')}<span className="grow" /><b>Paid days: {p.paid ?? at.payable}{p.of ? ` of ${p.of}` : ''}</b></div>
        <div className="tbl"><div className="att-grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="calhead">{d}</div>)}
          {Array.from({ length: lead }, (_, k) => <div key={'b' + k} className="att-day blank" />)}
          {at.list.map((d) => { const [label, tone] = DAY[d.kind] || ['', 'later'];
            return <div key={d.date} className={'att-day ' + tone} title={[label, d.note].filter(Boolean).join(' – ')}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b className="num">{+d.date.slice(8)} <span className="att-wd">{WD[new Date(d.date + 'T00:00:00Z').getUTCDay()]}</span></b>{d.late && <span className="small">Late</span>}</div>
              {label && <div className="att-k">{label}</div>}
              {(d.inAt || d.outAt) && <div className="small num">{d.inAt || '–'} → {d.outAt || '–'}{d.hours != null ? ` · ${d.hours} h` : ''}</div>}
              {d.note && <div className="small att-n">{d.note}</div>}
              {d.leave && d.leave !== 'earned' && <div className="small att-n">{d.leave[0].toUpperCase() + d.leave.slice(1)} leave</div>}</div>; })}
        </div></div>
        <p className="small muted" style={{ margin: 0 }}>8 hours or more is a full day, 5 to 8 hours a half day, under 5 hours or no check-out counts as absent. {pc ? `The paid days follow ${pc.name}'s own rules${p.daily ? ' for a daily wage' : ''}.` : 'Sundays and holidays are paid.'} Times are India time.</p></>}
    </div></Modal>;
}

// Two spellings of one name: every word of the shorter one is in the longer one ("Rahila Shaik" / "Rahila Sulthana Shaik").
const words = (n) => String(n || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
const sameName = (a, b) => { const [s, l] = [words(a), words(b)].sort((x, y) => x.length - y.length); return s.length > 0 && s.join('').length >= 4 && s.every((w) => l.includes(w)); };

// ---------- rules and the Aali HRM link ----------
function Rules({ hr }) {
  const [f, setF] = useState(rules), [busy, setBusy] = useState(false), [st, setSt] = useState(null), [m, setM] = useState(() => addMonths(thisMonth(), -1)), [tick, setTick] = useState(0);
  useEffect(() => { let on = true; http('GET', '/payroll/hrm?month=' + m).then((r) => on && setSt(r), (e) => on && setSt({ error: e.message })); return () => { on = false; }; }, [m, tick]);
  // HR matches someone whose email differs between the two apps (an empty email undoes it). Nobody's login changes.
  const match = (p, email) => attempt(async () => { await http('POST', '/payroll/hrm-link', { userId: p.userId, email }); setTick((n) => n + 1); },
    email ? `${p.name} matched. A month still in draft needs “Read attendance again”.` : `${p.name} is no longer matched by hand.`);
  const choices = (st?.unmatched || []).map((x) => [x.email, x.name, x.email + (x.active ? '' : ' · not active in Aali HRM')]), [cal, setCal] = useState(null);
  const loose = (st?.unmatched || []).filter((x) => x.active), [pe, setPe] = useState(null); // people who have left Aali HRM are not listed
  // Someone in Aali One not found by email whose name looks the same: suggest matching them, so nobody is added twice.
  const looksLike = (x) => (st?.people || []).find((p) => !p.found && sameName(p.name, x.name));
  const n = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return <div className="stack">
    {cal && <AttendanceMonth userId={cal.userId} name={cal.name} month={m} onClose={() => setCal(null)} />}
    {pe && <PayeeForm prefill={pe} onClose={(saved) => { setPe(null); if (saved) setTick((n) => n + 1); }} />}
    <div className="card stack"><h3 style={{ margin: 0 }}>Aali HRM – attendance</h3>
      {!st ? <p className="small muted" style={{ margin: 0 }}>Checking…</p> : st.connected === false ? <div className="banner warn">Not linked yet. Jayanth runs <code>scripts/hrm-reader.sql</code> in Aali HRM's database (it gives Aali One a read-only login that sees only attendance, leaves, holidays and joining dates) and adds the connection to the hosting settings. Until then, HR types each person's paid days in the monthly payroll.</div>
        : st.error ? <div className="banner bad">{st.error}</div> : <>
          <div className="row"><Pill k="ok">Linked</Pill><span className="small muted">People are matched by email. Paid days in</span><In type="month" value={m} onChange={(e) => setM(e.target.value)} style={{ width: 'auto' }} /></div>
          <div className="tbl"><table><thead><tr><th>Person</th><th>In Aali HRM</th><th className="n">Present</th><th className="n">Leave (paid / unpaid)</th><th className="n">Absent</th><th className="n">Paid days</th></tr></thead><tbody>
            {st.people.map((p) => <tr key={p.userId}><td><b>{p.name}</b>{p.payee && <> <Pill>No login</Pill></>}<div className="small muted">{p.email}</div>
                {p.found && <button className="btn sm" type="button" style={{ marginTop: 6 }} onClick={() => setCal(p)}>See each day</button>}</td>
              <td>{p.found ? <Pill k="ok">Found</Pill> : <Pill k="warn">{p.byHand ? 'Not found – the matched email is not in Aali HRM' : 'Not found by email'}</Pill>}
                {p.byHand && <div className="small muted">Matched by hand{p.matched ? ' to ' + p.matched : ''}{hr && <> · <button className="btn ghost sm" type="button" onClick={() => match(p, '')}>Undo</button></>}</div>}
                {!p.found && (hr ? <div style={{ marginTop: 6, minWidth: 220 }}><Pick value="" onChange={(v) => v && match(p, v)} options={choices} blank={choices.length ? 'Match by hand: who is this in Aali HRM?' : 'Everyone in Aali HRM is already matched'} /></div>
                  : <div className="small muted">HR can match this person by hand.</div>)}</td>
              {p.att ? <><td className="n">{p.att.present}{p.att.half ? ` + ${p.att.half} half` : ''}</td><td className="n">{p.att.paidLeave} / {p.att.unpaidLeave}</td><td className="n">{p.att.absent}</td><td className="n"><b>{p.att.payable}</b></td></> : <td colSpan={4} />}</tr>)}</tbody></table></div>
          {loose.length > 0 && <div className="stack gap4"><h3 style={{ margin: '6px 0 0' }}>Working in Aali HRM, not in Aali One <span className="num muted">{loose.length}</span></h3>
            <p className="small muted" style={{ margin: 0 }}>Active in Aali HRM, but nobody in Aali One is matched to them, so they are not on this payroll.</p>
            <div className="tbl"><table><thead><tr><th>Name in Aali HRM</th><th>Email in Aali HRM</th><th className="n">Days punched in {monthLabel(m)}</th><th>Last punch</th>{hr && <th />}</tr></thead><tbody>
              {loose.map((x) => <tr key={x.email}><td><b>{x.name}</b></td><td className="small">{x.email}</td><td className="n">{x.punched}</td><td className="small">{x.last ? fmtDate(x.last) : '—'}</td>
                {hr && <td style={{ textAlign: 'right' }}>{looksLike(x) ? <span className="row" style={{ justifyContent: 'flex-end' }}><span className="small">Looks like <b>{looksLike(x).name}</b> in Aali One</span>
                  <button className="btn sm primary" type="button" onClick={() => match(looksLike(x), x.email)}>Match</button><button className="btn ghost sm" type="button" onClick={() => setPe({ name: x.name, email: x.email })}>Someone else</button></span>
                  : <button className="btn sm" type="button" onClick={() => setPe({ name: x.name, email: x.email })}>Add as staff without a login</button>}</td>}</tr>)}</tbody></table></div>
            <p className="small muted" style={{ margin: 0 }}>Someone who uses Aali One for work is added in People & teams instead (with this email, they are matched at once). Someone who has left is switched off in Aali HRM.</p></div>}</>}
      <p className="small muted" style={{ margin: 0 }}>Paid days follow Aali HRM's rules: 8 hours or more is a full day, 5 to 8 hours a half day; earned leave is paid; the first {f.freeLeaves} other leave days of a month are paid; Sundays and holidays are paid; late arrivals do not cut pay. One day's pay is the monthly gross divided by the days in that month.</p></div>
    <RO when={!hr}><div className="card form"><h3 className="full" style={{ margin: 0 }}>Rules</h3>
      <Field label="Salary day (of the next month)"><In type="number" min="1" max="28" value={f.payDay} onChange={n('payDay')} /></Field>
      <Field label="Paid leave days a month (other than earned leave)"><In type="number" min="0" value={f.freeLeaves} onChange={n('freeLeaves')} /></Field>
      <Field label="Basic, % of gross"><In type="number" value={f.basicPct} onChange={n('basicPct')} /></Field><Field label="HRA, % of basic"><In type="number" value={f.hraPct} onChange={n('hraPct')} /></Field>
      <Field label="PF – employee %"><In type="number" step="0.01" value={f.pfEe} onChange={n('pfEe')} /></Field><Field label="PF – company %"><In type="number" step="0.01" value={f.pfEr} onChange={n('pfEr')} /></Field>
      <Field label="PF wage ceiling ₹"><In type="number" value={f.pfCeiling} onChange={n('pfCeiling')} /></Field><span />
      <Field label="ESI – employee %"><In type="number" step="0.01" value={f.esiEe} onChange={n('esiEe')} /></Field><Field label="ESI – company %"><In type="number" step="0.01" value={f.esiEr} onChange={n('esiEr')} /></Field>
      <Field label="ESI only up to a gross of ₹"><In type="number" value={f.esiLimit} onChange={n('esiLimit')} /></Field><span />
      <div className="field full"><label>Professional Tax (Andhra Pradesh), a month</label>
        {(f.ptSlabs || []).map((s, k) => <div key={k} className="row ag-sched"><span className="small" style={{ width: 120 }}>{+s[0] ? `Gross up to ₹` : 'Above that'}</span>{+s[0] || k < f.ptSlabs.length - 1 ? <In type="number" value={s[0]} onChange={(e) => setF({ ...f, ptSlabs: f.ptSlabs.map((x, j) => (j === k ? [e.target.value, x[1]] : x)) })} aria-label="Up to" style={{ width: 120 }} /> : null}
          <span className="small">tax ₹</span><In type="number" value={s[1]} onChange={(e) => setF({ ...f, ptSlabs: f.ptSlabs.map((x, j) => (j === k ? [x[0], e.target.value] : x)) })} aria-label="Tax" style={{ width: 100 }} /></div>)}</div>
      <p className="small muted full" style={{ margin: 0 }}>Check these with the company's CA when the law changes. A change here applies to months worked out after it; locked and paid months keep the rules they were made with.</p>
      {hr && <div className="full"><button className="btn primary" type="button" disabled={busy} onClick={async () => { setBusy(true); await attempt(() => saveSetting('payroll', Object.fromEntries(Object.entries(f).map(([k, x]) => [k, k === 'ptSlabs' ? x.map((r) => r.map(Number)) : +x]))), 'Rules saved.'); setBusy(false); }}>Save rules</button></div>}
    </div></RO>
  </div>;
}
