// Client payroll (Money → Client payroll): Aali Conssultancy runs payroll for its clients as a service. The client is the employer –
// its name, address and PF/ESI numbers go on the payslips – with its own pay rules, its own employees (no logins) and its own months,
// kept apart from Aali's own payroll. A client pays daily wages, a fixed monthly salary, or both (asked before the form opens), and
// has its own extras: attendance bonus, overtime, canteen, store bills… Attendance comes from the Excel the client sends each month,
// or from the client's own HRM (a copy of Aali HRM that Aali sets up for them), linked by a short code – then the Excel brings only the
// extras' numbers (server/hrm.js, logic.js buildClientRun). HR makes it, the Operations Manager reviews it, the Chairman may change it, nobody else sees it
// (records pclient and pemp, and payrun with pclientId; the arithmetic is shared/payroll.js clientPay).
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { list, get, create, update, http, refreshUsers } from '../api.js';
import { inr, fmtDT, fmtDate } from '../lib.js';
import { DEFAULT_SETTINGS } from '../../shared/defaults.js';
import { payFor, clientPay, splitGross, employerCost, monthLabel, addMonths, daysIn, sheetAttendance, dailyUnits, grossOf, fromSheet, EXTRA_HOW } from '../../shared/payroll.js';
import { Field, In, Sel, Pick, Pill, Empty, Modal, Stat, DeleteButton, Log, attempt, toast, RO, Tabs } from '../ui.jsx';
import { readSheets, xlsxBlob } from '../xlsx.js';

const byCode = (a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true });
export const employeesOf = (pc) => list('pemp').filter((e) => e.pclientId === pc.id).sort(byCode);
const rulesOf = (pc) => ({ ...DEFAULT_SETTINGS.payroll, dayBasis: 0, dailyBasicPct: 100, shiftHours: 8, otMultiplier: 2, dailyPaid: { leave: true, holidays: true, offs: false }, extras: [], ...(pc?.rules || {}) });
const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
const BASIS = [['0', 'the days in that month'], ['26', '26 days'], ['30', '30 days']];
const FEE = [['employee', 'Per employee, a month'], ['month', 'A fixed amount a month'], ['percent', '% of the gross wages']];
export const MODEL = { daily: ['Daily wages', 'Workers paid for each day they work'], monthly: ['Fixed monthly salary', 'Staff on a fixed monthly gross, cut for unpaid days'], both: ['Both', 'Staff on a monthly salary and workers on daily wages'] };
const hasDaily = (pc) => pc?.payModel === 'daily' || pc?.payModel === 'both';
const hasMonthly = (pc) => pc?.payModel !== 'daily';
const payText = (e) => (e.payType === 'daily' ? `${inr(e.rate)} a day` : `${inr(e.gross)} a month`);
// A guess for a full month, to show on the employee's form and list (a daily worker: 26 days).
const fullMonth = (e, r) => (e.payType === 'daily' ? clientPay({ month: thisMonth(), emp: e, att: { present: 26, half: 0, double: 0, paidLeave: 0, unpaidLeave: 0, absent: 0, sundays: 0, holidays: 0, payable: 26, extra: {} }, rules: { ...r, extras: [] } })
  : payFor({ month: thisMonth(), salary: e, att: null, rules: r, adj: { days: +r.dayBasis || daysIn(thisMonth()) } }));

// ---------- the list of payroll clients ----------
// Month: one month's payroll (Payroll.jsx); Cal: one person's attendance, day by day (Payroll.jsx AttendanceMonth).
export default function ClientPayroll({ hr, Month, Cal, parts }) {
  const nav = useNavigate(), [ask, setAsk] = useState(false), [model, setModel] = useState(''), [id, sub] = parts;
  if (id) { const pc = get(id); return pc?.type === 'pclient' ? <ClientBook pc={pc} hr={hr} sub={sub || 'month'} Month={Month} Cal={Cal} /> : <Empty>This payroll client was not found. <Link to="/client-payroll">Back</Link></Empty>; }
  const all = list('pclient').sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name)), runs = list('payrun');
  return <div className="stack">
    <div className="row"><p className="small muted grow" style={{ margin: 0 }}>Payroll Aali Conssultancy does for its clients. Each client is the employer of its own staff: their payslips carry the client's name and PF/ESI numbers, with the client's own rules. Kept apart from Aali's own payroll.</p>
      {hr && <button className="btn primary" type="button" onClick={() => setAsk(true)}>+ New payroll client</button>}</div>
    {all.length ? <div className="tbl"><table><thead><tr><th>Client</th><th>Pays</th><th className="n">Employees</th><th>Attendance</th><th>Latest month</th><th className="n">Net paid</th></tr></thead><tbody>
      {all.map((pc) => { const last = runs.filter((r) => r.pclientId === pc.id).sort((a, b) => b.month.localeCompare(a.month))[0], n = employeesOf(pc).filter((e) => e.active !== false && !e.left).length;
        return <tr key={pc.id} className="click" onClick={() => nav('/client-payroll/' + pc.id)}><td><b>{pc.name}</b>{pc.active === false && <> <Pill>Stopped</Pill></>}<div className="small muted">{pc.address}</div></td>
          <td>{MODEL[pc.payModel || 'monthly'][0]}</td><td className="n">{n}</td><td>{pc.attendance === 'hrm' ? `Their HRM (${pc.hrmCode})` : 'Excel each month'}</td>
          <td>{last ? <>{monthLabel(last.month)} <Pill k={last.status === 'paid' ? 'ok' : last.status === 'locked' ? 'info' : 'warn'}>{last.status === 'paid' ? 'Paid' : last.status === 'locked' ? 'Locked' : 'Draft'}</Pill></> : <span className="muted">None yet</span>}</td>
          <td className="n">{last ? inr(last.totals?.net) : '—'}</td></tr>; })}</tbody></table></div>
      : <Empty>No payroll clients yet.{hr ? ' Add one with “+ New payroll client”.' : ''}</Empty>}
    {/* The one question before the form: how this client pays – the form then shows only what that needs. */}
    {ask && <Modal title="How does this client pay its employees?" onClose={() => setAsk(false)}>
      <div className="stack">{Object.entries(MODEL).map(([k, [label, hint]]) => <button key={k} type="button" className="act" onClick={() => { setAsk(false); setModel(k); }}><b>{label}</b><span>{hint}</span></button>)}</div></Modal>}
    {model && <Modal wide title={`New payroll client – ${MODEL[model][0].toLowerCase()}`} onClose={() => setModel('')}><ClientForm hr model={model} onSaved={(r) => { setModel(''); if (r?.record?.id) nav('/client-payroll/' + r.record.id + '/employees'); }} /></Modal>}
  </div>;
}

// ---------- one client: its months, its employees, its details and rules ----------
function ClientBook({ pc, hr, sub, Month, Cal }) {
  const nav = useNavigate(), go = (v) => nav(`/client-payroll/${pc.id}${v === 'month' ? '' : '/' + v}`), theirs = pc.attendance === 'hrm';
  if (sub === 'hrm' && !theirs) sub = 'month';
  return <div className="stack">
    <div className="row" style={{ alignItems: 'center' }}><Link className="btn ghost sm" to="/client-payroll">‹ All payroll clients</Link><h2 style={{ margin: 0 }}>{pc.name}</h2>
      <Pill>{MODEL[pc.payModel || 'monthly'][0]}</Pill>{pc.active === false && <Pill>Payroll stopped</Pill>}<span className="grow" />
      <span className="small muted">Attendance: {theirs ? `their HRM (link code ${pc.hrmCode})` : 'Excel each month'}</span></div>
    <Tabs value={sub} onChange={go} tabs={[['month', 'Months'], ['employees', `Employees (${employeesOf(pc).filter((e) => e.active !== false && !e.left).length})`], ...(theirs ? [['hrm', 'Their HRM']] : []), ['details', 'Details & rules']]} />
    {sub === 'employees' ? <Employees pc={pc} hr={hr} /> : sub === 'hrm' ? <TheirHrm pc={pc} hr={hr} Cal={Cal} /> : sub === 'details' ? <div className="card"><ClientForm pc={pc} hr={hr} /></div> : <Month hr={hr} pc={pc} />}
  </div>;
}

// ---------- a client's details and payroll rules (the "+ New payroll client" form, and the Details & rules tab) ----------
const code = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const initials = (name) => code(String(name || '').split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w) && !/^(pvt|private|ltd|limited|llp|the|and|&)$/i.test(w)).map((w) => w[0]).join('')).slice(0, 6);
// Ready-made extras HR can add with one tap, then change.
const PRESETS = [['Attendance bonus', { side: 'earn', how: 'tiers', tiers: [[26, 40], [24, 37], [22, 35]], tierMode: 'day', who: 'daily' }], ['Overtime', { name: 'OT hours', side: 'earn', how: 'overtime', wages: true }],
  ['Time incentive', { name: 'On-time days', side: 'earn', how: 'perUnit', amount: 5 }], ['Canteen', { name: 'Canteen tokens', side: 'cut', how: 'perUnit', amount: 10 }],
  ['Store bill', { side: 'cut', how: 'amount' }], ['Insurance', { side: 'cut', how: 'fixed', amount: 100 }], ['Fine', { side: 'cut', how: 'amount' }], ['Advance', { name: 'Advance recovery', side: 'cut', how: 'amount' }]];
function ClientForm({ pc, hr, model, onSaved }) {
  const [f, setF] = useState(() => {
    const base = { name: '', address: '', gstin: '', clientId: '', contactName: '', contactPhone: '', contactEmail: '', pfCode: '', esiCode: '', ptState: 'Andhra Pradesh', payModel: model || 'monthly', attendance: 'excel', hrmCode: '', fee: { kind: 'employee', amount: '' }, note: '', active: true };
    const r = rulesOf(pc);
    return { ...base, ...(pc || {}), fee: { ...base.fee, ...(pc?.fee || {}) }, rules: { ...r, dayBasis: String(r.dayBasis || 0), ptSlabs: r.ptSlabs.map((x) => [...x]), dailyPaid: { ...r.dailyPaid }, extras: (r.extras || []).map((e) => ({ ...e, tiers: (e.tiers || []).map((t) => [...t]) })) } };
  });
  const [busy, setBusy] = useState(false), up = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const ru = (k) => (e) => setF({ ...f, rules: { ...f.rules, [k]: e?.target ? e.target.value : e } }), slabs = f.rules.ptSlabs, ex = f.rules.extras, both = f.payModel === 'both';
  const daily = f.payModel !== 'monthly', monthly = f.payModel !== 'daily';
  const setSlab = (k, i, v) => setF({ ...f, rules: { ...f.rules, ptSlabs: slabs.map((x, j) => (j === k ? (i ? [x[0], v] : [v, x[1]]) : x)) } });
  const setEx = (k, patch) => setF({ ...f, rules: { ...f.rules, extras: ex.map((x, j) => (j === k ? { ...x, ...patch } : x)) } });
  const addEx = (label, p) => setF({ ...f, rules: { ...f.rules, extras: [...ex, { name: label, amount: '', wages: false, tiers: [], tierMode: 'month', ...p, who: both ? p.who || 'all' : 'all', tiers: (p.tiers || []).map((t) => [...t]) }] } });
  async function save() {
    const { id, type, createdAt, updatedAt, createdBy, updatedBy, sample, log, ...data } = f;
    data.rules = { ...Object.fromEntries(Object.entries(f.rules).filter(([k]) => !['ptSlabs', 'dailyPaid', 'extras'].includes(k)).map(([k, x]) => [k, +x])),
      ptSlabs: slabs.map((r) => r.map(Number)), dailyPaid: f.rules.dailyPaid, extras: ex.map((e) => ({ ...e, amount: +e.amount || 0, tiers: (e.tiers || []).map((t) => t.map(Number)) })) };
    data.fee = { kind: f.fee.kind, amount: +f.fee.amount || 0 };
    setBusy(true); const r = await attempt(() => (pc ? update(pc.id, data) : create('pclient', data)), pc ? 'Saved. Months still in draft are worked out again.' : `${f.name.trim()} added. Now add the employees.`); setBusy(false);
    if (r && onSaved) onSaved(r);
  }
  return <RO when={!hr}><div className="stack">
    <div className="form"><h3 className="full" style={{ margin: 0 }}>The client – the employer on the payslips</h3>
      <Field label="Name on the payslips *" full><In value={f.name} onChange={up('name')} placeholder="e.g. Sri Lakshmi Textiles Pvt Ltd" autoFocus={!pc} /></Field>
      <Field label="Address on the payslips" full><In value={f.address} onChange={up('address')} /></Field>
      <Field label="GSTIN"><In value={f.gstin} onChange={up('gstin')} placeholder="37ABCDE1234F1Z5" /></Field>
      <Field label="The same client in Aali One's Clients" hint="Optional: for the monthly bill later"><Pick value={f.clientId} onChange={up('clientId')} options={list('client').filter((c) => !c.card).map((c) => [c.id, c.name, c.city])} blank="Not linked" /></Field>
      <Field label="Their contact for payroll"><In value={f.contactName} onChange={up('contactName')} placeholder="e.g. their HR or accountant" /></Field>
      <Field label="Contact phone"><In inputMode="tel" value={f.contactPhone} onChange={up('contactPhone')} /></Field>
      <Field label="Contact email"><In type="email" value={f.contactEmail} onChange={up('contactEmail')} /></Field>
      {pc ? <Field label="How they pay" hint="Changing this keeps each employee's pay type as it is"><Sel value={f.payModel} onChange={up('payModel')} options={Object.entries(MODEL).map(([k, v]) => [k, v[0]])} /></Field> : <span />}
      <Field label="PF establishment code"><In value={f.pfCode} onChange={up('pfCode')} placeholder="e.g. APGNT1234567000" /></Field>
      <Field label="ESI employer code"><In value={f.esiCode} onChange={up('esiCode')} placeholder="17 digits" /></Field></div>
    {monthly && <div className="form"><h3 className="full" style={{ margin: 0 }}>{both ? 'Monthly-salary staff' : 'Their monthly salary rules'}</h3>
      <Field label="One day's pay = monthly gross ÷"><Sel value={f.rules.dayBasis} onChange={ru('dayBasis')} options={BASIS} /></Field><span />
      <Field label="Basic, % of gross"><In type="number" value={f.rules.basicPct} onChange={ru('basicPct')} /></Field><Field label="HRA, % of basic"><In type="number" value={f.rules.hraPct} onChange={ru('hraPct')} /></Field></div>}
    {daily && <div className="form"><h3 className="full" style={{ margin: 0 }}>{both ? 'Daily-wage workers' : 'Their daily wage rules'}</h3>
      <p className="small muted full" style={{ margin: 0 }}>A worker's wage is the daily wage × the days paid for. A half day counts half; a double shift counts one more day (write it in the attendance Excel's "Double shifts" column).</p>
      <div className="field full"><label>Paid for these days without work</label><div className="row">
        {[['holidays', 'Holidays'], ['leave', 'Paid leave'], ['offs', 'Weekly offs']].map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={!!f.rules.dailyPaid[k]} onChange={(e) => setF({ ...f, rules: { ...f.rules, dailyPaid: { ...f.rules.dailyPaid, [k]: e.target.checked } } })} /> {l}</label>)}</div></div>
      <Field label="PF on this % of the wage" hint="Usually 100: the whole daily wage is basic + DA"><In type="number" min="10" max="100" value={f.rules.dailyBasicPct} onChange={ru('dailyBasicPct')} /></Field></div>}
    <div className="form"><h3 className="full" style={{ margin: 0 }}>PF, ESI and Professional Tax</h3>
      <Field label="PF – employee %"><In type="number" step="0.01" value={f.rules.pfEe} onChange={ru('pfEe')} /></Field><Field label="PF – employer %"><In type="number" step="0.01" value={f.rules.pfEr} onChange={ru('pfEr')} /></Field>
      <Field label="PF wage ceiling ₹" hint="0: PF on the whole basic"><In type="number" value={f.rules.pfCeiling} onChange={ru('pfCeiling')} /></Field><Field label="Salary day (of the next month)"><In type="number" min="1" max="28" value={f.rules.payDay} onChange={ru('payDay')} /></Field>
      <Field label="ESI – employee %"><In type="number" step="0.01" value={f.rules.esiEe} onChange={ru('esiEe')} /></Field><Field label="ESI – employer %"><In type="number" step="0.01" value={f.rules.esiEr} onChange={ru('esiEr')} /></Field>
      <Field label="ESI only up to a gross of ₹"><In type="number" value={f.rules.esiLimit} onChange={ru('esiLimit')} /></Field>
      <Field label="State (for Professional Tax)"><In value={f.ptState} onChange={up('ptState')} /></Field>
      <div className="field full"><label>Professional Tax, a month</label>
        {slabs.map((s, k) => <div key={k} className="row ag-sched"><span className="small" style={{ width: 120 }}>{+s[0] || k < slabs.length - 1 ? 'Gross up to ₹' : 'Above that'}</span>
          {+s[0] || k < slabs.length - 1 ? <In type="number" value={s[0]} onChange={(e) => setSlab(k, 0, e.target.value)} aria-label="Up to" style={{ width: 120 }} /> : null}
          <span className="small">tax ₹</span><In type="number" value={s[1]} onChange={(e) => setSlab(k, 1, e.target.value)} aria-label="Tax" style={{ width: 100 }} /></div>)}
        <span className="small muted">Filled with Andhra Pradesh's slabs. Change them for a client in another state.</span></div></div>
    {/* The client's own extras: what it pays beside the wage, and what it recovers. */}
    <div className="stack"><h3 style={{ margin: 0 }}>Extras – what they pay and recover</h3>
      <p className="small muted" style={{ margin: 0 }}>Each extra is worked out by itself every month. One that needs a number per person (overtime hours, canteen tokens, a store bill) gets its own column in the attendance Excel, named as written here.</p>
      {ex.map((e, k) => <div key={k} className="card form" style={{ padding: 12, background: 'var(--paper-2)' }}>
        <Field label="Name"><In value={e.name} onChange={(v) => setEx(k, { name: v.target.value })} aria-label="Extra name" /></Field>
        <Field label="It is"><Sel value={e.how === 'tiers' || e.how === 'overtime' ? 'earn' : e.side} disabled={e.how === 'tiers' || e.how === 'overtime'} onChange={(v) => setEx(k, { side: v, wages: v === 'cut' ? false : e.wages })} options={[['earn', 'Paid to the employee'], ['cut', 'Recovered (cut from pay)']]} /></Field>
        <Field label="Worked out as"><Sel value={e.how} onChange={(v) => setEx(k, { how: v, side: v === 'tiers' || v === 'overtime' ? 'earn' : e.side })} options={Object.entries(EXTRA_HOW)} /></Field>
        {['fixed', 'perDay', 'perUnit'].includes(e.how) && <Field label={e.how === 'fixed' ? 'Amount a month ₹' : e.how === 'perDay' ? '₹ per day worked' : '₹ per unit'}><In type="number" min="0" step="0.01" value={e.amount} onChange={(v) => setEx(k, { amount: v.target.value })} /></Field>}
        {e.how === 'amount' && <div className="field"><label>Amount</label><span className="small muted">Written in the attendance Excel for each person, in rupees.</span></div>}
        {e.how === 'overtime' && <div className="field"><label>Overtime pay</label><span className="small">Hours in the Excel × (the daily wage, or the monthly gross ÷ {+f.rules.dayBasis || 26}) ÷ {f.rules.shiftHours} h × {f.rules.otMultiplier}</span></div>}
        {e.how === 'tiers' && <div className="field full"><label>Tiers – days worked in the month</label>
          {(e.tiers || []).map((t, j) => <div key={j} className="row ag-sched"><span className="small">At least</span><In type="number" min="1" max="31" value={t[0]} onChange={(v) => setEx(k, { tiers: e.tiers.map((x, i) => (i === j ? [v.target.value, x[1]] : x)) })} aria-label="Days" style={{ width: 80 }} />
            <span className="small">days: ₹</span><In type="number" min="0" value={t[1]} onChange={(v) => setEx(k, { tiers: e.tiers.map((x, i) => (i === j ? [x[0], v.target.value] : x)) })} aria-label="Amount" style={{ width: 100 }} />
            <button className="btn ghost sm ag-x" type="button" aria-label="Remove tier" onClick={() => setEx(k, { tiers: e.tiers.filter((_, i) => i !== j) })}>×</button></div>)}
          <div className="row"><button className="btn sm" type="button" onClick={() => setEx(k, { tiers: [...(e.tiers || []), ['', '']] })}>+ Add a tier</button>
            <Sel value={e.tierMode} onChange={(v) => setEx(k, { tierMode: v })} options={[['day', 'The amount is per day worked'], ['month', 'The amount is for the month']]} style={{ width: 'auto' }} /></div></div>}
        {both && <Field label="For"><Sel value={e.who} onChange={(v) => setEx(k, { who: v })} options={[['all', 'Everyone'], ['daily', 'Daily-wage workers'], ['monthly', 'Monthly-salary staff']]} /></Field>}
        {e.side !== 'cut' && e.how !== 'tiers' && <label className="check full"><input type="checkbox" checked={!!e.wages} onChange={(v) => setEx(k, { wages: v.target.checked })} /> <span>Counts as wages for ESI and Professional Tax <span className="small muted">(ask the client's CA; overtime usually does)</span></span></label>}
        <div className="full"><button className="btn ghost sm" type="button" onClick={() => setF({ ...f, rules: { ...f.rules, extras: ex.filter((_, j) => j !== k) } })}>Remove this extra</button></div></div>)}
      <div className="row"><span className="small muted">Add:</span>{PRESETS.map(([l, p]) => <button key={l} className="btn sm" type="button" onClick={() => addEx(p.name || l, p)}>+ {l}</button>)}<button className="btn sm" type="button" onClick={() => addEx('', { side: 'earn', how: 'fixed' })}>+ Other</button></div>
      {ex.some((e) => e.how === 'overtime') && <div className="form"><Field label="One shift is (hours)"><In type="number" min="1" max="24" value={f.rules.shiftHours} onChange={ru('shiftHours')} /></Field>
        <Field label="Overtime is paid at × the hourly rate"><In type="number" min="1" max="4" step="0.5" value={f.rules.otMultiplier} onChange={ru('otMultiplier')} /></Field></div>}</div>
    <div className="form"><h3 className="full" style={{ margin: 0 }}>Attendance and Aali's fee</h3>
      <Field label="Attendance comes from"><Sel value={f.attendance} onChange={(v) => setF({ ...f, attendance: v, hrmCode: v === 'hrm' && !f.hrmCode ? initials(f.name) : f.hrmCode })} options={[['excel', 'An Excel the client sends each month'], ['hrm', 'Their own HRM (set up by Aali)']]} /></Field>
      {f.attendance === 'hrm' && <Field label="Link code for their HRM *" hint={`2–12 letters or numbers. Hosting setting: HRM_DATABASE_URL_${code(f.hrmCode) || '…'}`}><In value={f.hrmCode} onChange={(e) => setF({ ...f, hrmCode: code(e.target.value) })} placeholder="e.g. GSM" maxLength={12} /></Field>}
      {f.attendance === 'hrm' && <Field label="Paid leave days a month (other than earned leave)" hint="Leave in their HRM beyond this is unpaid"><In type="number" min="0" max="31" value={f.rules.freeLeaves} onChange={ru('freeLeaves')} /></Field>}
      <Field label="Aali's fee" hint="For the monthly bill to the client (coming later)"><div className="row"><Sel value={f.fee.kind} onChange={(v) => setF({ ...f, fee: { ...f.fee, kind: v } })} options={FEE} style={{ width: 'auto' }} />
        <In type="number" min="0" step="0.01" value={f.fee.amount} onChange={(e) => setF({ ...f, fee: { ...f.fee, amount: e.target.value } })} aria-label="Fee" style={{ width: 110 }} placeholder={f.fee.kind === 'percent' ? '%' : '₹'} /></div></Field>
      <Field label="Note" full><In value={f.note} onChange={up('note')} /></Field>
      {pc && <label className="check full"><input type="checkbox" checked={f.active !== false} onChange={up('active')} /> <span><b>Payroll active</b><br /><span className="small muted">Untick when Aali stops doing this client's payroll. Their months and payslips are kept.</span></span></label>}</div>
    <p className="small muted" style={{ margin: 0 }}>Check the rules with the client's CA. A change applies to months worked out after it; locked and paid months keep the rules they were made with.</p>
    {hr && <div className="row">{pc && <DeleteButton id={pc.id} needsReason label="Delete this client" />}<span className="grow" /><button className="btn primary" type="button" disabled={busy || f.name.trim().length < 2 || ex.some((e) => !String(e.name || '').trim()) || (f.attendance === 'hrm' && code(f.hrmCode).length < 2)} onClick={save}>{pc ? 'Save details and rules' : 'Add the client'}</button></div>}
    {pc && <details><summary className="small muted">History</summary><Log items={pc.log} /></details>}
  </div></RO>;
}

// ---------- a client's employees ----------
function Employees({ pc, hr }) {
  const [open, setOpen] = useState(null), [up, setUp] = useState(false), r = rulesOf(pc), all = employeesOf(pc);
  const now = all.filter((e) => e.active !== false && !e.left), monthly = now.filter((e) => e.payType !== 'daily'), dailies = now.filter((e) => e.payType === 'daily');
  const gross = monthly.reduce((a, e) => a + e.gross, 0);
  return <div className="stack">
    <div className="stats"><Stat label="Employees" value={now.length} sub={all.length > now.length ? `${all.length - now.length} have left` : ''} />
      {hasMonthly(pc) && <Stat label="Monthly salaries" value={inr(gross)} sub={`${monthly.length} on a monthly salary`} />}
      {hasDaily(pc) && <Stat label="Daily-wage workers" value={dailies.length} sub={dailies.length ? `${inr(Math.min(...dailies.map((e) => e.rate)))}–${inr(Math.max(...dailies.map((e) => e.rate)))} a day` : ''} />}</div>
    {hr && <div className="row"><button className="btn primary" type="button" onClick={() => setOpen({})}>+ Add employee</button><button className="btn" type="button" onClick={() => setUp(true)}>Upload employees (Excel)</button>
      <button className="btn ghost" type="button" onClick={() => employeeTemplate(pc)}>Excel template</button></div>}
    {all.length ? <div className="tbl"><table><thead><tr><th>Code</th><th>Employee</th><th className="n">Pay</th><th className="n">Take-home, full month</th><th>Statutory</th><th>Bank</th></tr></thead><tbody>
      {all.map((e) => { const est = fullMonth(e, r), gone = e.active === false || !!e.left;
        return <tr key={e.id} className="click" onClick={() => setOpen({ e })} style={gone ? { opacity: 0.6 } : undefined}><td className="num" style={{ whiteSpace: 'nowrap' }}>{e.code}</td>
          <td><b>{e.name}</b>{gone && <> <Pill>Left</Pill></>}<div className="small muted">{[e.designation, e.department].filter(Boolean).join(' · ')}</div></td>
          <td className="n">{payText(e)}</td><td className="n">{inr(est.net)}{e.payType === 'daily' && <div className="small muted">26 days</div>}</td><td>{[e.pf && 'PF', e.esi && 'ESI', e.pt && 'PT'].filter(Boolean).join(' · ') || '—'}</td>
          <td>{e.bank?.account && e.bank?.ifsc ? <Pill k="ok">Bank ✓</Pill> : <Pill k="warn">No bank</Pill>}</td></tr>; })}</tbody></table></div>
      : <Empty>No employees yet.{hr ? ' Add them one by one, or upload the list from Excel (download the template first).' : ''}</Empty>}
    {open && <EmployeeForm pc={pc} e={open.e} hr={hr} onClose={() => setOpen(null)} />}
    {up && <EmployeeUpload pc={pc} onClose={() => setUp(false)} />}
  </div>;
}

// ---------- their HRM: who of the employees is found there, and who works there but is not on this payroll ----------
function TheirHrm({ pc, hr, Cal }) {
  const [m, setM] = useState(() => addMonths(thisMonth(), -1)), [st, setSt] = useState(null), [tick, setTick] = useState(0), [cal, setCal] = useState(null), [add, setAdd] = useState(null);
  useEffect(() => { let on = true; setSt(null); http('GET', `/payroll/clients/${pc.id}/hrm?month=${m}`).then((r) => on && setSt(r), (e) => on && setSt({ error: e.message })); return () => { on = false; }; }, [pc.id, pc.hrmCode, m, tick]);
  const loose = (st?.unmatched || []).filter((x) => x.active); // people who have left their HRM are not listed
  return <div className="card stack"><h3 style={{ margin: 0 }}>{pc.name}'s HRM – attendance</h3>
    {cal && <Cal pc={pc} userId={cal.empId} name={cal.name} month={m} onClose={() => setCal(null)} />}
    {add && <EmployeeForm pc={pc} hr={hr} prefill={add} onClose={() => { setAdd(null); setTick((n) => n + 1); }} />}
    {!st ? <p className="small muted" style={{ margin: 0 }}>Checking…</p> : st.connected === false ? <div className="banner warn">Not linked yet. Jayanth runs <code>scripts/client-hrm-reader.sql</code> in {pc.name}'s HRM database (it gives Aali One a read-only login that sees only attendance, leaves, holidays, Employee IDs and joining dates) and adds its connection to the hosting settings as <code>{st.setting}</code>. Until then, the attendance comes from the Excel the client sends each month.</div>
      : st.error ? <div className="banner bad">{st.error}</div> : <>
        <div className="row"><Pill k="ok">Linked</Pill><span className="small muted">Employees are matched by their Employee ID in the HRM (the employee code here), or else by email. Paid days in</span><In type="month" value={m} onChange={(e) => setM(e.target.value)} style={{ width: 'auto' }} /></div>
        {st.people.length ? <div className="tbl cards"><table><thead><tr><th>Code</th><th>Employee</th><th>In their HRM</th><th className="n">Present</th><th className="n">Leave</th><th className="n">Absent</th><th className="n">Paid days</th></tr></thead><tbody>
          {st.people.map((p) => <tr key={p.empId}><td className="num" style={{ whiteSpace: 'nowrap' }}>{p.code}</td>
            <td><b>{p.name}</b>{p.found && <div><button className="btn sm" type="button" style={{ marginTop: 6 }} onClick={() => setCal(p)}>See each day</button></div>}</td>
            <td>{p.found ? <><Pill k="ok">{p.by === 'code' ? 'Found by Employee ID' : 'Found by email'}</Pill>{p.hrmName && p.hrmName !== p.name && <div className="small muted">There: {p.hrmName}</div>}</>
              : <><Pill k="warn">Not found</Pill><div className="small muted">No one there has Employee ID {p.code}. Change the code in Employees to their Employee ID, or HR types their paid days.</div></>}</td>
            {p.att ? <><td className="n">{p.att.present}{p.att.half ? ` + ${p.att.half} half` : ''}</td><td className="n">{p.att.paidLeave} paid · {p.att.unpaidLeave} unpaid</td><td className="n">{p.att.absent}</td>
              <td className="n"><b>{p.paid}</b> <span className="small muted">/ {p.of}</span>{p.daily && <div className="small muted">daily wage</div>}</td></> : <td colSpan={4} />}</tr>)}</tbody></table></div>
          : <Empty>No employees on this payroll yet.</Empty>}
        {loose.length > 0 && <div className="stack gap4"><h3 style={{ margin: '6px 0 0' }}>Working in their HRM, not on this payroll <span className="num muted">{loose.length}</span></h3>
          <div className="tbl cards"><table><thead><tr><th>Employee ID</th><th>Name in their HRM</th><th>Designation</th><th className="n">Days punched in {monthLabel(m)}</th><th>Last punch</th>{hr && <th />}</tr></thead><tbody>
            {loose.map((x, k) => <tr key={x.code || x.email || k}><td className="num">{x.code || '—'}</td><td><b>{x.name}</b><div className="small muted">{x.email}</div></td><td className="small">{[x.designation, x.department].filter(Boolean).join(' · ') || '—'}</td>
              <td className="n">{x.punched}</td><td className="small">{x.last ? fmtDate(x.last) : '—'}</td>
              {hr && <td style={{ textAlign: 'right' }}><button className="btn sm" type="button" onClick={() => setAdd({ code: x.code || '', name: x.name, designation: x.designation || '', department: x.department || '', joined: x.joined || '', personalEmail: x.email || '' })}>Add to the payroll</button></td>}</tr>)}</tbody></table></div>
          <p className="small muted" style={{ margin: 0 }}>Adding someone opens the employee form filled from their HRM; enter their pay, PF/ESI and bank details. Someone who has left is switched off in their HRM.</p></div>}</>}
    <p className="small muted" style={{ margin: 0 }}>The days follow the HRM's rules (as in Aali HRM): 8 hours or more is a full day, 5 to 8 hours a half day; earned leave is paid; the first {rulesOf(pc).freeLeaves} other leave days of a month are paid. Then the client's own rules give the paid days:
      {+rulesOf(pc).dayBasis ? ` a monthly salary is ${rulesOf(pc).dayBasis} days less the days lost (absent, unpaid leave, half of each half day${+rulesOf(pc).dayBasis === 26 ? '; Sundays are not working days' : ''})` : ' a monthly salary is paid for the days in the month less the days lost'}{hasDaily(pc) ? '; a daily-wage worker is paid for the days worked, plus the days the rules pay without work' : ''}. Overtime hours and other extras come from the extras Excel each month.</p>
  </div>;
}

// prefill: a new employee's details from their HRM (Their HRM → "Add to the payroll").
function EmployeeForm({ pc, e, hr, prefill, onClose }) {
  const r = rulesOf(pc), [f, setF] = useState(() => (e ? { ...e, bank: { ...(e.bank || {}) }, fixed: [...(e.fixed || [])], basicPct: e.basicPct ?? '', rate: e.rate || '', gross: e.gross || '' }
    : { code: '', name: '', designation: '', department: '', payType: pc.payModel === 'daily' ? 'daily' : 'monthly', gross: '', rate: '', basicPct: '', pf: false, pfCap: true, esi: false, pt: true, fixed: [], bank: {}, pan: '', uan: '', esiNo: '', joined: '', left: '', phone: '', personalEmail: '', note: '', active: true, ...(prefill || {}) }));
  const [busy, setBusy] = useState(false), up = (k) => (ev) => setF({ ...f, [k]: ev?.target ? (ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value) : ev }), bank = (k) => (ev) => setF({ ...f, bank: { ...f.bank, [k]: ev.target.value } });
  const daily = f.payType === 'daily', g = +f.gross || 0, rate = +f.rate || 0, split = splitGross(g, r, f), emp = { ...f, gross: daily ? 0 : g, rate: daily ? rate : 0 }, est = fullMonth(emp, r);
  const c = employerCost(daily ? { ...emp, gross: rate * 26, basicPct: r.dailyBasicPct } : emp, daily ? { ...r, hraPct: 0 } : r);
  async function save() {
    const { id, type, createdAt, updatedAt, createdBy, updatedBy, sample, log, ...data } = f;
    setBusy(true); const ok = await attempt(() => (e ? update(e.id, data) : create('pemp', { ...data, pclientId: pc.id })), e ? 'Saved.' : `${f.name.trim()} added.`); setBusy(false); if (ok) onClose();
  }
  return <Modal wide title={e ? `${e.code} – ${e.name}` : `New employee – ${pc.name}`} onClose={onClose} footer={<>{e && hr && <DeleteButton id={e.id} needsReason label="Delete" after={onClose} />}<span className="grow" />
    <button className="btn" type="button" onClick={onClose}>Close</button>{hr && <button className="btn primary" type="button" disabled={busy || (daily ? !rate : !g) || !String(f.code).trim() || String(f.name).trim().length < 2} onClick={save}>{e ? 'Save' : 'Add employee'}</button>}</>}>
    <RO when={!hr}><div className="stack">
      <div className="form">
        <Field label="Employee code *" hint="As in the client's records and attendance"><In value={f.code} onChange={up('code')} autoFocus={!e} /></Field><Field label="Full name *"><In value={f.name} onChange={up('name')} /></Field>
        <Field label="Designation"><In value={f.designation} onChange={up('designation')} /></Field><Field label="Department"><In value={f.department} onChange={up('department')} /></Field>
        {pc.payModel === 'both' && <Field label="Paid by"><Sel value={f.payType} onChange={up('payType')} options={[['monthly', 'Monthly salary'], ['daily', 'Daily wage']]} /></Field>}
        {daily ? <Field label="Daily wage ₹ *"><In type="number" min="0" step="0.01" value={f.rate} onChange={up('rate')} /></Field>
          : <><Field label="Monthly gross salary ₹ *"><In type="number" min="0" value={f.gross} onChange={up('gross')} /></Field>
            <Field label={`Basic % of gross (the client's rule: ${r.basicPct}%)`}><In type="number" min="10" max="100" value={f.basicPct} onChange={up('basicPct')} placeholder={String(r.basicPct)} /></Field>
            <div className="field full"><label>Split</label><span className="small">Basic {inr(split.basic)} · HRA {inr(split.hra)} · Special {inr(split.special)}</span></div></>}</div>
      <div className="stack gap4"><span className="lbl">Statutory deductions</span>
        <label className="check"><input type="checkbox" checked={!!f.pf} onChange={up('pf')} /> PF – {r.pfEe}% of {daily ? `${r.dailyBasicPct}% of the wage` : 'basic'} (the employer adds {r.pfEr}%)</label>
        {f.pf && +r.pfCeiling > 0 && <label className="check" style={{ marginLeft: 26 }}><input type="checkbox" checked={f.pfCap !== false} onChange={(ev) => setF({ ...f, pfCap: ev.target.checked })} /> Only on wages up to {inr(r.pfCeiling)}</label>}
        <label className="check"><input type="checkbox" checked={!!f.esi} onChange={up('esi')} /> ESI – {r.esiEe}% (the employer adds {r.esiEr}%)</label>
        <label className="check"><input type="checkbox" checked={f.pt !== false} onChange={up('pt')} /> Professional Tax{pc.ptState ? ` (${pc.ptState})` : ''}</label></div>
      <div className="stack gap4"><span className="lbl">Fixed deductions for this person, every month</span>
        {f.fixed.map((x, k) => <div key={k} className="row ag-sched"><In className="in grow" value={x.name} onChange={(ev) => setF({ ...f, fixed: f.fixed.map((y, j) => (j === k ? { ...y, name: ev.target.value } : y)) })} placeholder="e.g. Quarters rent" aria-label="Deduction" />
          <In type="number" min="0" value={x.amount} onChange={(ev) => setF({ ...f, fixed: f.fixed.map((y, j) => (j === k ? { ...y, amount: ev.target.value } : y)) })} aria-label="Amount a month" style={{ width: 120 }} />
          <button className="btn ghost sm ag-x" type="button" aria-label="Remove" onClick={() => setF({ ...f, fixed: f.fixed.filter((_, j) => j !== k) })}>×</button></div>)}
        <div><button className="btn sm" type="button" onClick={() => setF({ ...f, fixed: [...f.fixed, { name: '', amount: '' }] })}>+ Add a fixed deduction</button></div></div>
      <div className="form"><h3 className="full" style={{ margin: 0 }}>Bank, IDs and dates</h3>
        <Field label="Account holder's name"><In value={f.bank.holder || ''} onChange={bank('holder')} placeholder={f.name} /></Field><Field label="Bank"><In value={f.bank.name || ''} onChange={bank('name')} /></Field>
        <Field label="Account number"><In inputMode="numeric" value={f.bank.account || ''} onChange={bank('account')} autoComplete="off" /></Field><Field label="IFSC"><In value={f.bank.ifsc || ''} onChange={bank('ifsc')} placeholder="SBIN0001234" /></Field>
        <Field label="PAN"><In value={f.pan} onChange={up('pan')} /></Field><Field label="UAN (PF)"><In value={f.uan} onChange={up('uan')} /></Field>
        <Field label="ESI number"><In value={f.esiNo} onChange={up('esiNo')} /></Field><Field label="Phone"><In inputMode="tel" value={f.phone} onChange={up('phone')} /></Field>
        <Field label="Personal email" hint="For sending payslips later; leave empty if none"><In type="email" value={f.personalEmail} onChange={up('personalEmail')} /></Field><span />
        <Field label="Joined on"><In type="date" value={f.joined} onChange={up('joined')} /></Field><Field label="Left on" hint="When they leave: paid up to this date"><In type="date" value={f.left} onChange={up('left')} /></Field>
        <Field label="Note" full><In value={f.note} onChange={up('note')} /></Field></div>
      <div className="banner info">{daily ? <>26 days at {inr(rate)}: wages {inr(est.earned.gross)} − deductions {inr(est.ded.total)} = <b>take-home {inr(est.net)}</b> (before the client's extras).</>
        : <>A full month: gross {inr(g)} − deductions {inr(est.ded.total)} = <b>take-home {inr(est.net)}</b> (before the client's extras).</>} The employer also pays PF {inr(c.pf)} and ESI {inr(c.esi)}.</div>
      {e && <details><summary className="small muted">History</summary><Log items={e.log} /></details>}
    </div></RO></Modal>;
}

// ---------- Excel: reading a list back, and the templates ----------
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// The first sheet with a heading row that names an employee code → [{ line, key: text }], by what each heading says.
function readTable(sheets, cols) {
  for (const sh of sheets) {
    const at = sh.rows.findIndex((row) => row.some((c) => /code/.test(norm(c)))); if (at < 0) continue;
    const keys = sh.rows[at].map((c) => cols.find(([, re]) => re.test(norm(c)))?.[0] || '');
    return sh.rows.slice(at + 1).map((row, k) => ({ line: at + k + 2, ...Object.fromEntries(keys.map((key, j) => [key, String(row[j] ?? '').trim()]).filter(([key]) => key)) }))
      .filter((x) => Object.entries(x).some(([k, v]) => k !== 'line' && v));
  }
  return null;
}
const yes = (v) => (/^(y|yes|true|1)$/i.test(v) ? true : /^(n|no|false|0)$/i.test(v) ? false : undefined);
const dateOf = (v) => { if (!v) return ''; if (/^\d{4}-\d\d-\d\d$/.test(v)) return v; const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + +v * 864e5).toISOString().slice(0, 10); return 'bad'; }; // an Excel date can arrive as its day number
const money = (v) => +String(v || '').replace(/[,₹\s]/g, '');
const EMP_COLS = [['code', /code/], ['holder', /holder/], ['personalEmail', /email/], ['name', /name/], ['designation', /desig/], ['department', /depart|dept/], ['payType', /^paytype|^paidby/], ['rate', /daily|wage/], ['gross', /gross|salary|ctc/],
  ['esiNo', /^esi(number|no)/], ['pf', /^pf/], ['esi', /^esi/], ['pt', /^pt|professionaltax/], ['bankName', /^bank(name)?$/], ['account', /^account|^acno/], ['ifsc', /ifsc/], ['pan', /^pan/], ['uan', /^uan/],
  ['joined', /^joined|^doj|dateofjoining/], ['phone', /phone|mobile/]];
const empHead = (pc) => ['Employee code *', 'Full name *', 'Designation', 'Department', ...(pc.payModel === 'both' ? ['Pay type (Monthly/Daily)'] : []), ...(hasMonthly(pc) ? ['Monthly gross ₹'] : []), ...(hasDaily(pc) ? ['Daily wage ₹'] : []),
  'PF (Yes/No)', 'ESI (Yes/No)', 'PT (Yes/No)', 'Account holder', 'Bank', 'Account number', 'IFSC', 'PAN', 'UAN', 'ESI number', 'Joined on (DD-MM-YYYY)', 'Phone', 'Personal email'];
const TEXT_COLS = /code|account|ifsc|pan|uan|esi number|joined|phone/i; // kept as text in the template, so 0863… keeps its zero
function employeeTemplate(pc) {
  const head = empHead(pc);
  download(xlsxBlob([{ name: 'Employees', widths: head.map((h) => (TEXT_COLS.test(h) ? [18, 2] : /name|holder|email/i.test(h) ? 26 : 16)), rows: [head.map((c) => [c, 1])] },
    { name: 'What to fill', widths: [28, 90], rows: [['Column', 1], ...[['Employee code', 'The code the client uses for the person. The attendance Excel each month uses the same code. Must be different for each person.'],
      ...(pc.payModel === 'both' ? [['Pay type', 'Monthly or Daily.']] : []), ...(hasMonthly(pc) ? [['Monthly gross ₹', 'For a monthly-salary person: the full month\'s gross, numbers only.']] : []),
      ...(hasDaily(pc) ? [['Daily wage ₹', 'For a daily-wage worker: the wage for one day, numbers only.']] : []),
      ['PF / ESI / PT', 'Yes or No. Empty means: PF No, ESI No, PT Yes.'], ['Joined on', 'Like 01-04-2026.'], ['Everything else', 'Can be left empty and filled in Aali One later.']].map(([a, b]) => [[a, 3], b])] }]),
    `Employees-${pc.name.replace(/[^\w]+/g, '-')}.xlsx`);
}
function EmployeeUpload({ pc, onClose }) {
  const [rows, setRows] = useState(null), [file, setFile] = useState(''), [busy, setBusy] = useState(false), have = new Set(employeesOf(pc).map((e) => String(e.code).toUpperCase()));
  async function pick(ev) { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; const sheets = await attempt(() => readSheets(f)); if (!sheets) return;
    const t = readTable(sheets, EMP_COLS); if (!t) return toast('No heading row with "Employee code" was found. Use the template.', true); setFile(f.name); setRows(t); }
  const seen = new Map(), checked = (rows || []).map((x) => {
    const code = String(x.code || '').trim().toUpperCase(), gross = money(x.gross), rate = money(x.rate), joined = dateOf(x.joined || ''), why = [];
    const payType = pc.payModel === 'daily' ? 'daily' : pc.payModel === 'monthly' ? 'monthly' : /^d/i.test(x.payType || '') ? 'daily' : /^m/i.test(x.payType || '') ? 'monthly' : rate > 0 && !(gross > 0) ? 'daily' : 'monthly';
    if (!code) why.push('no code'); else if (have.has(code)) why.push('code already added'); else if (seen.has(code)) why.push(`same code as row ${seen.get(code)}`); else seen.set(code, x.line);
    if (String(x.name || '').trim().length < 2) why.push('no name'); if (payType === 'daily' ? !(rate > 0) : !(gross > 0)) why.push(payType === 'daily' ? 'no daily wage' : 'no monthly gross'); if (joined === 'bad') why.push('joining date not like 01-04-2026');
    return { x, why, row: { code, name: x.name, designation: x.designation, department: x.department, payType, gross: payType === 'daily' ? 0 : gross, rate: payType === 'daily' ? rate : 0, pf: yes(x.pf), esi: yes(x.esi), pt: yes(x.pt),
      bank: { holder: x.holder || '', name: x.bankName || '', account: String(x.account || '').replace(/\s/g, ''), ifsc: x.ifsc || '' }, pan: x.pan, uan: x.uan, esiNo: x.esiNo, joined: joined === 'bad' ? '' : joined, phone: x.phone, personalEmail: x.personalEmail } }; });
  const bad = checked.filter((c) => c.why.length);
  async function keep() { setBusy(true); const r = await attempt(() => http('POST', `/payroll/clients/${pc.id}/employees`, { rows: checked.map((c) => c.row) })); setBusy(false);
    if (r) { await refreshUsers(); toast(`${r.added} employees added.`); onClose(); } }
  return <Modal wide title={`Upload employees – ${pc.name}`} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button>
    {rows && <button className="btn primary" type="button" disabled={busy || !checked.length || bad.length > 0} onClick={keep}>Add {checked.length} employees</button>}</>}>
    <div className="stack">
      {!rows ? <><p style={{ margin: 0 }}>Choose the Excel (.xlsx) or CSV file with the employees. It needs a heading row like the template's; columns can be in any order.</p>
        <div className="row"><label className="btn primary">Choose the file<input type="file" accept=".xlsx,.csv" hidden onChange={pick} /></label><button className="btn ghost" type="button" onClick={() => employeeTemplate(pc)}>Download the template</button></div></>
        : <><div className={'banner ' + (bad.length ? 'bad' : 'ok')}>{file}: {checked.length} employees read.{bad.length ? ` ${bad.length} rows need fixing in the file before anything is added.` : ' Everything looks right – check the list, then add them.'}</div>
          <div className="tbl" style={{ maxHeight: 420, overflow: 'auto' }}><table><thead><tr><th>Row</th><th>Code</th><th>Name</th><th className="n">Pay</th><th>PF · ESI · PT</th><th>Bank</th><th>To fix</th></tr></thead><tbody>
            {checked.map(({ x, why, row }) => <tr key={x.line} style={why.length ? { background: 'var(--bad-bg)' } : undefined}><td className="num">{x.line}</td><td style={{ whiteSpace: 'nowrap' }}>{row.code}</td><td>{row.name}</td>
              <td className="n">{row.payType === 'daily' ? (row.rate ? `${inr(row.rate)} a day` : '—') : row.gross ? `${inr(row.gross)} a month` : '—'}</td>
              <td className="small">{[row.pf ? 'PF' : '', row.esi ? 'ESI' : '', row.pt === false ? '' : 'PT'].filter(Boolean).join(' · ') || '—'}</td><td className="small">{row.bank.account ? '•••• ' + row.bank.account.slice(-4) : '—'}</td><td className="small" style={{ color: 'var(--bad)' }}>{why.join('; ')}</td></tr>)}</tbody></table></div>
          <div><button className="btn ghost sm" type="button" onClick={() => setRows(null)}>Choose another file</button></div></>}
    </div></Modal>;
}

// The attendance Excel for a client's month: the template comes filled with the client's employees, with a column for double shifts
// (when it pays daily wages) and one for each extra that needs a number per person.
const DAYS = [['present', 'Present'], ['half', 'Half days'], ['double', 'Double shifts'], ['paidLeave', 'Paid leave'], ['unpaidLeave', 'Unpaid leave'], ['absent', 'Absent'], ['offs', 'Weekly offs'], ['holidays', 'Holidays']];
const daysFor = (pc) => DAYS.filter(([k]) => k !== 'double' || hasDaily(pc));
const hasDays = (x) => [...DAYS.map((v) => v[0]), 'paidDays'].some((k) => x[k] !== undefined && x[k] !== '');
export const sheetExtras = (pc) => (pc?.rules?.extras || []).filter(fromSheet);
const attCols = (pc) => [...sheetExtras(pc).map((e) => ['x:' + e.key, new RegExp('^' + norm(e.name) + '$')]), ['code', /code/], ['name', /name/], ['paidLeave', /^paidleave/], ['unpaidLeave', /^unpaidleave|^lop|lossofpay/],
  ['paidDays', /^paiddays|^payabledays/], ['present', /^present/], ['half', /half/], ['double', /double/], ['absent', /^absent/], ['offs', /weeklyoff|weekoff|^offs?$/], ['holidays', /holiday/]];
// When their HRM is linked it gives the days, so the Excel carries only the extras' numbers.
export const extrasOnly = (run) => !!run.att?.connected;
export function attendanceTemplate(run) {
  const pc = get(run.pclientId), people = (run.items || []).map((i) => [i.code, i.name]), only = extrasOnly(run), d = only ? [] : daysFor(pc), xs = sheetExtras(pc);
  download(xlsxBlob([{ name: monthLabel(run.month), widths: [[16, 2], 28, ...d.map(() => 12), ...(only ? [] : [22]), ...xs.map(() => 16)], rows: [['Employee code *', 'Name (for checking)', ...d.map((x) => x[1]), ...(only ? [] : ['Paid days (optional)']), ...xs.map((e) => e.name)].map((c) => [c, 1]), ...people] },
    { name: 'What to fill', widths: [24, 92], rows: [['Column', 1], ...[...(only ? [['Days', 'Not needed: the days come from ' + (pc?.name || 'the client') + '\'s HRM.']] : [['Days', 'Numbers of days in ' + monthLabel(run.month) + '. Halves are fine (0.5).'],
      ...(hasDaily(pc) ? [['Double shifts', 'Days on which a daily-wage worker did two shifts (count the day in Present too); each pays one more day.']] : []),
      ['Paid days', 'Leave empty: Aali One counts them by the client\'s rules. Fill it only to give the paid days yourself.']]),
      ...xs.map((e) => [e.name, e.how === 'amount' ? 'Rupees for this person this month.' : e.how === 'overtime' ? 'Overtime hours this month.' : `How many this month (× ₹${e.amount} each).`]),
      ['Employee code', 'Do not change the codes. Someone missing from this list is added in Employees first.']].map(([a, b]) => [[a, 3], b])] }]),
    `${only ? 'Extras' : 'Attendance'}-${(pc?.name || 'client').replace(/[^\w]+/g, '-')}-${run.month}.xlsx`);
}
export function AttendanceUpload({ run, onClose }) {
  const [rows, setRows] = useState(null), [file, setFile] = useState(''), [busy, setBusy] = useState(false), pc = get(run.pclientId), r = rulesOf(pc), d = daysFor(pc), xs = sheetExtras(pc), only = extrasOnly(run);
  const known = new Map(employeesOf(pc || { id: run.pclientId }).map((e) => [String(e.code).toUpperCase(), e]));
  async function pick(ev) { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; const sheets = await attempt(() => readSheets(f)); if (!sheets) return;
    const t = readTable(sheets, attCols(pc)); if (!t) return toast('No heading row with "Employee code" was found. Use the template.', true); setFile(f.name); setRows(t); }
  const seen = new Set(), checked = (rows || []).map((x) => {
    const code = String(x.code || '').trim().toUpperCase(), e = known.get(code), why = [], daily = e?.payType === 'daily';
    if (!code) why.push('no code'); else if (!e) why.push('not one of this client\'s employees'); else if (seen.has(code)) why.push('twice in the file'); seen.add(code);
    for (const [k, l] of [...DAYS, ['paidDays', 'Paid days']]) { const v = x[k]; if (v !== undefined && v !== '' && !(+v >= 0 && +v <= 31 && (+v * 2) % 1 === 0)) why.push(`${l} is not a number of days`); }
    const extra = {}; for (const c of xs) { const v = x['x:' + c.key]; if (v === undefined || v === '') continue; const n = money(v); if (!(n >= 0)) why.push(`${c.name} is not a number`); else extra[c.key] = n; }
    const att = sheetAttendance({ ...x, extra }), max = daily ? 62 : +r.dayBasis || daysIn(run.month), paid = daily ? dailyUnits(att, r) : att.payable;
    if (paid > max) why.push(`${paid} paid days – more than ${max}`);
    return { x, e, why, paid, max, row: { code, ...Object.fromEntries([...DAYS.map((v) => v[0]), 'paidDays'].map((k) => [k, x[k] ?? ''])), extra } }; });
  const bad = checked.filter((c) => c.why.length), missing = only ? [] : [...known.values()].filter((e) => e.active !== false && !e.left && !seen.has(String(e.code).toUpperCase()));
  async function keep() { setBusy(true); const ok = await attempt(() => update(run.id, { _attendance: checked.map((c) => c.row), _attendanceFile: file }), only ? 'Extras taken. Everyone\'s pay is worked out again.' : 'Attendance taken. Everyone\'s pay is worked out again.'); setBusy(false); if (ok) onClose(); }
  return <Modal wide title={`${only ? 'Extras' : 'Attendance'} – ${pc?.name || ''} – ${monthLabel(run.month)}`} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancel</button>
    {rows && <button className="btn primary" type="button" disabled={busy || !checked.length || bad.length > 0} onClick={keep}>{only ? 'Use these extras' : 'Use this attendance'} ({checked.length} employees)</button>}</>}>
    <div className="stack">
      {!rows ? <><p style={{ margin: 0 }}>{only ? <>The days come from {pc?.name}'s HRM. Choose the Excel with this month's {xs.map((e) => e.name.toLowerCase()).join(', ')} for {monthLabel(run.month)}. The template lists this client's employees with a column for each – send it to the client to fill.</>
        : <>Choose the attendance Excel the client sent for {monthLabel(run.month)}. The template already lists this client's employees{xs.length ? ', with a column for each of their extras' : ''} – send it to the client to fill.</>}</p>
        <div className="row"><label className="btn primary">Choose the file<input type="file" accept=".xlsx,.csv" hidden onChange={pick} /></label><button className="btn ghost" type="button" onClick={() => attendanceTemplate(run)}>Download the template</button></div></>
        : <><div className={'banner ' + (bad.length ? 'bad' : missing.length ? 'warn' : 'ok')}>{file}: {checked.length} employees read.{bad.length ? ` ${bad.length} rows need fixing in the file.` : ''}{missing.length ? ` Not in the file (they get no paid days): ${missing.map((e) => `${e.code} ${e.name}`).join(', ')}.` : ''}</div>
          <div className="tbl" style={{ maxHeight: 420, overflow: 'auto' }}><table><thead><tr><th>Code</th><th>Employee</th><th>In the file</th><th className="n">Paid days</th><th>To fix</th></tr></thead><tbody>
            {checked.map(({ x, e, why, paid, max, row }) => <tr key={x.line} style={why.length ? { background: 'var(--bad-bg)' } : undefined}><td style={{ whiteSpace: 'nowrap' }}>{String(x.code || '').toUpperCase()}</td><td>{e?.name || x.name || '—'}{e?.payType === 'daily' && <div className="small muted">{inr(e.rate)} a day</div>}</td>
              <td className="small">{[...d.filter((v) => +x[v[0]]).map((v) => `${v[1]} ${x[v[0]]}`), ...xs.filter((c) => row.extra[c.key]).map((c) => `${c.name} ${row.extra[c.key]}`)].join(' · ') || (x.paidDays ? 'Paid days only' : '—')}</td>
              <td className="n">{only && !hasDays(x) ? <span className="small muted">from their HRM</span> : <><b>{paid}</b>{e?.payType !== 'daily' && <span className="small muted"> / {max}</span>}{x.paidDays ? <div className="small muted">as given</div> : null}</>}</td><td className="small" style={{ color: 'var(--bad)' }}>{why.join('; ')}</td></tr>)}</tbody></table></div>
          <div><button className="btn ghost sm" type="button" onClick={() => setRows(null)}>Choose another file</button></div></>}
    </div></Modal>;
}

// PF, ESI and Professional Tax, person by person, for a locked or paid month (Aali's own or a client's): for the returns.
export function statutoryFile(run) {
  const client = !!run.pclientId, its = run.items || [];
  const head = [...(client ? ['Employee code'] : []), 'Name', 'UAN', 'PF wages', 'PF employee', 'PF employer', 'ESI number', 'ESI wages', 'ESI employee', 'ESI employer', 'Professional Tax', 'Gross', 'Net pay'];
  const rows = its.map((i) => [...(client ? [i.code] : []), i.name, i.uan || '', String(i.wages?.pf ?? ''), String(i.ded.pf), String(i.employer.pf), i.esiNo || '', String(i.wages?.esi ?? ''), String(i.ded.esi), String(i.employer.esi), String(i.ded.pt), String(grossOf(i)), String(i.net)]);
  const sum = (k) => String(its.reduce((a, i) => a + (+k(i) || 0), 0));
  rows.push([...(client ? [''] : []), ['Total', 3], '', '', [sum((i) => i.ded.pf), 3], [sum((i) => i.employer.pf), 3], '', '', [sum((i) => i.ded.esi), 3], [sum((i) => i.employer.esi), 3], [sum((i) => i.ded.pt), 3], [sum(grossOf), 3], [sum((i) => i.net), 3]]);
  download(xlsxBlob([{ name: 'Statutory ' + run.month, widths: [...(client ? [[14, 2]] : []), 28, [15, 2], 11, 12, 12, [20, 2], 11, 12, 12, 16, 11, 11], rows: [head.map((c) => [c, 1]), ...rows] }]),
    `Statutory-${client ? (run.employer?.name || 'client').replace(/[^\w]+/g, '-') + '-' : ''}${run.month}.xlsx`);
}
export function sheetLine(run, t, att) {
  const theirs = `${run.employer?.name || 'The client'}'s HRM`, xl = run.sheet ? ` Extras from ${run.sheetFile || 'the Excel'}, taken on ${fmtDT(run.sheetAt)}.` : '';
  if (att.source === 'hrm') return `Attendance read from ${theirs} on ${fmtDT(att.at)} – ${att.inHrm} of ${t.people} employees found there.${xl}`;
  if (att.source === 'kept') return `${theirs} could not be reached just now, so the attendance read on ${fmtDT(att.at)} is kept. Press “Read attendance again” later.${xl}`;
  if (att.connected) return `${theirs} could not be read. ${att.error || ''} Try “Read attendance again”, or type the paid days.`;
  const wait = att.key ? `Their HRM is not linked yet (see the Their HRM tab), so the attendance comes from the Excel. ` : '';
  return wait + (att.source === 'excel' ? `Attendance from ${run.sheetFile || 'the Excel'}, taken on ${fmtDT(att.at)} – ${att.found} of ${t.people} employees.`
    : 'Upload the attendance Excel the client sent for this month (Attendance Excel). Until then, nobody has paid days.');
}
