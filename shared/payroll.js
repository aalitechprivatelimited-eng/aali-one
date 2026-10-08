// Payroll arithmetic. The server works out and saves every figure; the screen uses the same functions to show a preview, so the
// two can never disagree. Rules (PF, ESI, Professional Tax, the basic/HRA split) come from Settings → payroll (DEFAULT_SETTINGS.payroll).
// One day's pay = monthly gross ÷ the days in that month (28–31), as the user chose and as Aali HRM's payroll already does.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m) => (/^\d{4}-\d\d$/.test(m || '') ? `${MONTH_NAMES[+m.slice(5) - 1]} ${m.slice(0, 4)}` : m || '');
export const daysIn = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
export const addMonths = (m, n) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const nextDay = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const isSunday = (s) => new Date(s + 'T00:00:00Z').getUTCDay() === 0;
const sum = (xs, f = (x) => x) => xs.reduce((a, x) => a + (+f(x) || 0), 0);
const r0 = (v) => Math.round(+v || 0);

// Paid days from Aali HRM attendance, rule for rule as Aali HRM's own payroll counts them (its Payroll.js calculateAttendanceSummary):
// · only the days from the joining date (and up to the leaving date) count
// · a holiday, then a Sunday, then an approved leave, then the attendance record decides what a day is
// · a check-in on a day with no office time (a flexible person) is present; check-in and check-out: 8 h or more present, 5–8 h half day, less absent
// · a check-in without a check-out on a past day is absent; no record on a past day is absent; days still to come are not counted
// · earned leave is always paid; of the other leaves, the first `freeLeaves` days of the month are paid and the rest are unpaid
// · leave never uses up a holiday or a Sunday
// · late arrivals are shown for reference only (from August 2026 they never reduce pay)
// One difference: a leave that runs across two months counts in both (Aali HRM's payroll left such leaves out).
// records: [{ date, checkIn: bool, checkOut: bool, hours, flexible: bool, late: bool }]; leaves: [{ from, to, type }]; holidays: ['YYYY-MM-DD']
// detail: true also gives `list`, one entry per day of the month ({ date, kind, inAt, outAt, hours, late, leave, note }) for the
// attendance calendar – made by the same loop, so the calendar and the paid days can never disagree. (The monthly payroll keeps only the counts.)
export function attendanceDays({ month, today, joined, left, records = [], leaves = [], holidays = [], freeLeaves = 2, detail = false }) {
  const n = daysIn(month), dates = [], list = []; let offOut = 0;
  for (let d = 1; d <= n; d++) { const s = `${month}-${String(d).padStart(2, '0')}`;
    if ((joined && s < joined) || (left && s > left)) { if (isSunday(s)) offOut++; if (detail) list.push({ date: s, kind: 'outside', note: joined && s < joined ? 'Before joining' : 'After leaving' }); continue; }
    dates.push(s); }
  const inWindow = new Set(dates), hol = new Set(holidays), rec = new Map(records.map((r) => [r.date, r]));
  const leave = new Map(), ltype = new Map(), others = [];
  for (const l of leaves) for (let s = l.from; s && s <= l.to; s = nextDay(s)) {
    if (!inWindow.has(s) || hol.has(s) || isSunday(s)) continue;
    ltype.set(s, l.type || 'leave');
    if (l.type === 'earned') leave.set(s, true); else others.push(s);
  }
  others.sort().forEach((s, i) => { if (!leave.has(s)) leave.set(s, i < freeLeaves); });
  const out = { present: 0, half: 0, absent: 0, paidLeave: 0, unpaidLeave: 0, holidays: 0, sundays: 0, late: 0, toCome: 0, window: dates.length, outside: n - dates.length, outsideSundays: offOut };
  for (const s of dates) {
    const past = s < today, r = rec.get(s); let kind, note = '';
    if (hol.has(s)) kind = 'holidays';
    else if (isSunday(s)) kind = 'sundays';
    else if (leave.has(s)) { kind = leave.get(s) ? 'paidLeave' : 'unpaidLeave'; note = ltype.get(s) === 'earned' ? 'Earned leave' : kind === 'unpaidLeave' ? `Over the ${freeLeaves} paid leave days of the month` : ''; }
    else if (r) {
      kind = r.flexible && r.checkIn ? 'present' : r.checkIn && !r.checkOut ? (past ? 'absent' : 'present') : r.checkIn && r.checkOut ? (r.hours >= 8 ? 'present' : r.hours >= 5 ? 'half' : 'absent') : 'absent';
      if (kind === 'present' && r.late && !r.flexible) out.late++;
      note = !r.checkIn ? 'No check-in' : !r.checkOut ? (past ? 'No check-out' : 'Checked in') : r.flexible ? 'Flexible hours' : kind === 'half' ? '5 to 8 hours' : kind === 'absent' ? 'Under 5 hours' : '';
    } else { kind = past ? 'absent' : 'toCome'; if (past) note = 'No check-in'; }
    out[kind]++;
    if (detail) list.push({ date: s, kind, inAt: r?.inAt || '', outAt: r?.outAt || '', hours: r?.checkIn && r?.checkOut ? Math.round((+r.hours || 0) * 10) / 10 : null,
      late: !!(r?.late && !r?.flexible && kind === 'present'), leave: ltype.get(s) || '', note });
  }
  out.payable = out.present + out.half * 0.5 + out.paidLeave + out.sundays + out.holidays;
  if (detail) out.list = list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Professional Tax (Andhra Pradesh) from the monthly slabs: [[up to ₹, tax], …, [0, tax above the last limit]].
export const ptFor = (gross, slabs = []) => { for (const [upTo, tax] of slabs) if (!+upTo || gross <= +upTo) return +tax || 0; return 0; };
// Basic, HRA and special allowance out of the monthly gross.
export function splitGross(gross, rules, salary = {}) {
  const g = r0(gross), basic = r0(g * (+(salary.basicPct ?? '') || +rules.basicPct || 50) / 100), hra = Math.min(r0(basic * (+rules.hraPct || 0) / 100), g - basic);
  return { basic, hra, special: g - basic - hra, gross: g };
}
// What the employer pays on top of the gross (PF and ESI), for the cost-to-company figure.
export function employerCost(salary, rules) {
  const g = +salary.gross || 0, { basic } = splitGross(g, rules, salary);
  const pfBase = salary.pf ? (salary.pfCap === false ? basic : Math.min(basic, +rules.pfCeiling || basic)) : 0;
  const pf = r0(pfBase * (+rules.pfEr || 0) / 100), esi = salary.esi && g <= +rules.esiLimit ? Math.ceil(g * (+rules.esiEr || 0) / 100) : 0;
  return { pf, esi, ctc: g + pf + esi };
}
// A loan or advance: what is still owed, and what is due in this month (before it is checked against the pay left).
export const loanLeft = (l, except = '') => Math.max(0, r0(l.amount) - sum((l.recovered || []).filter((x) => x.month !== except), (x) => x.amount));
export function loanDue(l, month, override) {
  if (l.closed || !l.from || month < l.from) return 0;
  const left = loanLeft(l, month); if (override !== undefined && override !== null && override !== '') return Math.min(left, Math.max(0, r0(override)));
  return Math.min(left, l.kind === 'advance' ? left : r0(l.cut) || left);
}

// The salary sheet as it was for a month: the gross from the latest change whose "from" month has come (an empty "from" means from
// the start). A sheet whose first gross starts after the month is not on that month's payroll (null). Review of the payroll feature.
export function salaryFor(s, month) {
  const revs = (s.revisions || []).map((r, i) => ({ ...r, i }));
  if (!revs.length) return s.from && s.from > month ? null : s;
  const due = revs.filter((r) => (r.from || '') <= month).sort((a, b) => (a.from || '').localeCompare(b.from || '') || a.i - b.i);
  return due.length ? { ...s, gross: due[due.length - 1].gross } : null;
}

// A client's attendance Excel, one employee's row → the same shape attendanceDays() gives, so pay is worked out the same way.
// The paid days are the count (present + half days ÷ 2 + paid leave + weekly offs + holidays) unless the client wrote them in.
export function sheetAttendance(r = {}) {
  const v = (k) => Math.max(0, Math.round((+r[k] || 0) * 2) / 2);
  const out = { present: v('present'), half: v('half'), double: v('double'), paidLeave: v('paidLeave'), unpaidLeave: v('unpaidLeave'), absent: v('absent'), sundays: v('offs'), holidays: v('holidays'), late: 0, toCome: 0 };
  const counted = out.present + out.half * 0.5 + out.paidLeave + out.sundays + out.holidays;
  out.given = r.paidDays !== '' && r.paidDays != null && !isNaN(+r.paidDays);
  out.payable = out.given ? v('paidDays') : counted;
  out.extra = Object.fromEntries(Object.entries(r.extra && typeof r.extra === 'object' ? r.extra : {}).map(([k, x]) => [k, Math.max(0, +x || 0)]));
  return out;
}

// ---------- payroll clients: daily wages and the client's own extras ----------
// A payroll client's HRM attendance (attendanceDays) for a monthly-salary employee, under the client's rule for one day's pay.
// Gross ÷ 26 or ÷ 30: the month is paid in full less the days lost – absent, unpaid leave, half of each half day, and the days before
// joining, after leaving or still to come (on ÷ 26 only working days are lost: Sundays are not working days). So a full February is
// paid in full, as payroll usually does. Gross ÷ the days in the month: the paid days as Aali HRM counts them (as for Aali's own staff).
// A daily-wage worker is paid for the days worked instead (dailyUnits), so this is for monthly salaries only.
export function onBasis(att, rules, emp = {}) {
  const n = +rules.dayBasis; if (!att || !n || emp.payType === 'daily') return att;
  const lost = att.absent + att.unpaidLeave + att.half * 0.5 + att.toCome + (n === 26 ? (att.outside || 0) - (att.outsideSundays || 0) : att.outside || 0);
  return { ...att, payable: Math.max(0, n - lost), basis: n, lost };
}
// Days worked: present, and a half day as half (a double-shift day is one day of showing up).
export const workedDays = (att) => (att ? att.present + att.half * 0.5 : 0);
// The days a daily-wage worker is paid for: the days worked, one more for each double shift, and the days the client pays without work
// (rules.dailyPaid: paid leave and holidays unless switched off, weekly offs only if switched on). Paid days written in the Excel win.
export function dailyUnits(att, rules = {}) {
  if (!att) return 0; if (att.given) return att.payable;
  const d = rules.dailyPaid || {};
  return workedDays(att) + (att.double || 0) + (d.leave !== false ? att.paidLeave : 0) + (d.holidays !== false ? att.holidays : 0) + (d.offs ? att.sundays : 0);
}
// One employee's extras for the month, from the client's rules.extras: a fixed amount; so much per day worked; so much per unit in
// the attendance Excel (canteen tokens, on-time days); an amount straight from the Excel (a store bill, a fine); tiers by days worked
// (attendance bonus, flat or per day); overtime hours from the Excel × the hourly rate × the overtime multiplier.
export const EXTRA_HOW = { fixed: 'A fixed amount every month', perDay: 'So much per day worked', perUnit: 'So much per unit in the attendance Excel', amount: 'An amount written in the attendance Excel',
  tiers: 'By days worked (tiers)', overtime: 'Overtime hours in the attendance Excel' };
export const fromSheet = (e) => ['perUnit', 'amount', 'overtime'].includes(e.how); // needs its own column in the attendance Excel
export const otHourly = (emp, rules) => (emp.payType === 'daily' ? +emp.rate || 0 : (+emp.gross || 0) / (+rules.dayBasis || 26)) / (+rules.shiftHours || 8) * (+rules.otMultiplier || 2);
// extra: the Excel's numbers for the extras, when the days come from elsewhere (the client's HRM).
export function extrasFor({ emp, att, rules, extra }) {
  const daily = emp.payType === 'daily', worked = workedDays(att), x = extra || att?.extra || {}, out = [];
  for (const e of rules.extras || []) {
    if ((e.who === 'daily' && !daily) || (e.who === 'monthly' && daily)) continue;
    const a = +e.amount || 0, v = +x[e.key] || 0; let amount = 0, note = '';
    if (e.how === 'fixed') amount = a;
    else if (e.how === 'perDay') { amount = a * worked; note = `${worked} days × ₹${a}`; }
    else if (e.how === 'perUnit') { amount = a * v; note = `${v} × ₹${a}`; }
    else if (e.how === 'amount') amount = v;
    else if (e.how === 'tiers') { const t = (e.tiers || []).filter(([d]) => +d > 0 && worked >= +d).sort((p, q) => q[0] - p[0])[0];
      if (t) { amount = e.tierMode === 'day' ? +t[1] * worked : +t[1]; note = e.tierMode === 'day' ? `${worked} days × ₹${t[1]}` : `${worked} days worked`; } }
    else if (e.how === 'overtime') { const h = otHourly(emp, rules); amount = h * v; note = `${v} h × ₹${Math.round(h * 100) / 100}`; }
    if (amount > 0) out.push({ key: e.key, name: e.name, side: e.side === 'cut' ? 'cut' : 'earn', amount: r0(amount), wages: e.side !== 'cut' && !!e.wages, note });
  }
  return out;
}
// A payroll client's employee for the month: a monthly salary works as Aali's does; a daily wage is the rate × the days paid for
// (PF on rules.dailyBasicPct of it). Then the client's extras.
export function clientPay({ month, emp, att, rules, adj = {}, from, extra }) {
  const extras = extrasFor({ emp, att, rules, extra });
  if (emp.payType !== 'daily') return { ...payFor({ month, salary: emp, att, rules, adj, from, extras }), payType: 'monthly' };
  const typed = adj.days !== undefined && adj.days !== null && adj.days !== '', units = dailyUnits(att, rules), rate = +emp.rate || 0;
  const n = Math.max(daysIn(month), Math.ceil(typed ? +adj.days : units)); // a double shift can take the days past the month's length
  const p = payFor({ month, salary: { ...emp, gross: rate * n, basicPct: +rules.dailyBasicPct || 100 }, att: att ? { ...att, payable: units } : null, rules: { ...rules, dayBasis: n, hraPct: 0 }, adj, from, extras });
  return { ...p, payType: 'daily', rate };
}
// Everything earned in the month: the wages (or salary), HR's extra pay, and the client's extras.
export const grossOf = (i) => i.earned.gross + (+i.extra || 0) + sum(i.earnExtras || [], (x) => x.amount);

// One person's pay for the month.
// salary: the salary sheet · att: attendanceDays(), or null when Aali HRM had nothing for them · adj: HR's changes for this month
// (days typed by hand, TDS, another deduction, extra pay, a different loan cut) · loans: their open loans and advances.
// from: where the attendance came from, for the warnings. rules.dayBasis: a client may count one day's pay as the gross ÷ 26 or ÷ 30.
// extras: a payroll client's own earnings and recoveries for the month (extrasFor) – an earning marked as wages counts for ESI and
// Professional Tax, the others are paid beside the wages; a recovery is cut before loans. Aali's own payroll has none.
export function payFor({ month, salary, att, rules, loans = [], adj = {}, from = 'Aali HRM', extras = [] }) {
  const n = +rules.dayBasis || daysIn(month), warn = [], typed = adj.days !== undefined && adj.days !== null && adj.days !== '';
  const payable = Math.max(0, Math.min(n, typed ? +adj.days : att ? att.payable : 0));
  if (!typed && !att) warn.push(`No attendance from ${from}. Type the paid days.`);
  const full = splitGross(salary.gross, rules, salary), f = payable / n;
  const earned = { basic: r0(full.basic * f), hra: r0(full.hra * f) }; earned.gross = r0(full.gross * f); earned.special = earned.gross - earned.basic - earned.hra;
  const plus = extras.filter((x) => x.side === 'earn' && +x.amount > 0).map((x) => ({ name: x.name, note: x.note || '', amount: r0(x.amount), wages: !!x.wages }));
  const extra = r0(adj.extra), pay = earned.gross + extra + sum(plus.filter((x) => x.wages), (x) => x.amount), beside = sum(plus.filter((x) => !x.wages), (x) => x.amount);
  const pfBase = salary.pf ? (salary.pfCap === false ? earned.basic : Math.min(earned.basic, +rules.pfCeiling || earned.basic)) : 0;
  const esiOn = !!salary.esi && full.gross <= +rules.esiLimit;
  const ded = {
    pf: r0(pfBase * (+rules.pfEe || 0) / 100), esi: esiOn ? Math.ceil(pay * (+rules.esiEe || 0) / 100) : 0, pt: salary.pt ? ptFor(pay, rules.ptSlabs) : 0,
    tds: r0(adj.tds), other: r0(adj.other), otherWhy: String(adj.otherWhy || ''),
    fixed: (salary.fixed || []).filter((x) => String(x.name || '').trim() && +x.amount > 0).map((x) => ({ name: String(x.name).trim(), amount: r0(x.amount) })),
    loans: [], extras: extras.filter((x) => x.side === 'cut' && +x.amount > 0).map((x) => ({ name: x.name, note: x.note || '', amount: r0(x.amount) })),
  };
  const employer = { pf: r0(pfBase * (+rules.pfEr || 0) / 100), esi: esiOn ? Math.ceil(pay * (+rules.esiEr || 0) / 100) : 0 };
  // Loans and advances are cut only from what is left after the other deductions, so take-home pay never goes below zero.
  let left = pay + beside - ded.pf - ded.esi - ded.pt - ded.tds - ded.other - sum(ded.fixed, (x) => x.amount) - sum(ded.extras, (x) => x.amount);
  for (const l of loans) { const due = loanDue(l, month, adj.loans?.[l.id]); if (!due) continue; const take = Math.max(0, Math.min(due, left)); left -= take;
    ded.loans.push({ id: l.id, kind: l.kind, due, amount: take }); if (take < due) warn.push(`Only ₹${take} of the ₹${due} ${l.kind === 'advance' ? 'advance' : 'loan'} cut fits in this month's pay; the rest stays owed.`); }
  ded.total = ded.pf + ded.esi + ded.pt + ded.tds + ded.other + sum(ded.fixed, (x) => x.amount) + sum(ded.loans, (x) => x.amount) + sum(ded.extras, (x) => x.amount);
  const net = pay + beside - ded.total;
  if (net < 0) warn.push('The deductions are more than the pay for this month.');
  if (typed && att && +adj.days !== att.payable) warn.push(`Paid days typed by hand (${adj.days}); ${from} says ${att.payable}. ${adj.daysWhy ? 'Reason: ' + adj.daysWhy : ''}`.trim());
  return { days: { total: n, payable, typed, ...(att ? { att } : {}) }, full, earned, extra, extraWhy: String(adj.extraWhy || ''), ded, employer, wages: { pf: pfBase, esi: esiOn ? pay : 0 }, earnExtras: plus, net, warn };
}
