// Aali HRM – the attendance app (face check-in), on its own Supabase database – read only.
// For payroll, Aali One reads one month of each person's check-ins, approved leaves, the holidays and joining/leaving dates,
// and counts paid days with Aali HRM's own rules (shared/payroll.js attendanceDays). It is read whenever HR or the Operations
// Manager opens or refreshes a month's payroll, so it is always as fresh as Aali HRM itself.
// The login in HRM_DATABASE_URL can read only those columns (scripts/hrm-reader.sql): bank details, Aadhaar, photos and faces stay in Aali HRM.
// People are matched by their email address (the same email in both apps).
// A payroll client's own HRM (a copy of Aali HRM that Aali sets up for the client, on its own database) is read the same way: its
// link code (pclient.hrmCode, e.g. GSM) names its connection, HRM_DATABASE_URL_GSM, and its employees are matched by the HRM's
// Employee ID = the employee code in Client payroll (or by email). Its read-only login: scripts/client-hrm-reader.sql.
import { SUPABASE_ROOT_CA } from './supabase-ca.js';
const pools = new Map(), testSources = new Map();
// key: '' for Aali HRM, a client's link code for the client's HRM.
export const hrmEnv = (key = '') => 'HRM_DATABASE_URL' + (key ? '_' + key : '');
export const hrmConnected = (key = '') => !!(testSources.get(key) || process.env[hrmEnv(key)]);
export const setHrmSource = (fn, key = '') => { if (fn) testSources.set(key, fn); else testSources.delete(key); pools.delete(key); }; // tests: (sql, params) => rows, from a stand-in database
// Who a person is in Aali HRM: the email HR matched by hand (Payroll → Rules & Aali HRM, setting 'hrmLinks' = { userId: email })
// when the two apps have different emails for them, otherwise their Aali One login email. Nobody's login changes.
export const hrmEmailOf = (u, links) => String(links?.[u.id] || u.email || '').trim().toLowerCase();

// Certificates from a settings value, however it was pasted: the .crt as downloaded, squashed onto one line by a one-line value box
// (which is what broke the first link – PEM needs its line breaks), with \n written out, or base64. Anything else (a web link) gives none.
export function readCerts(raw) {
  let v = String(raw || '').replace(/\\n/g, '\n').trim();
  if (v && !v.includes('BEGIN')) { const d = Buffer.from(v, 'base64').toString(); if (d.includes('BEGIN CERTIFICATE')) v = d; }
  return [...v.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((m) => m[1].replace(/\s+/g, '')).filter(Boolean)
    .map((b) => `-----BEGIN CERTIFICATE-----\n${b.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
}

async function q(sql, params, key = '') {
  if (testSources.get(key)) return testSources.get(key)(sql, params);
  let pool = pools.get(key);
  if (!pool) {
    const { default: pg } = await import('pg'), url = process.env[hrmEnv(key)].replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
    // The link is always checked. Supabase signs its database certificates with its own root (server/supabase-ca.js, built in), so a
    // *.supabase.com address needs nothing more; HRM_SSL_CA can add certificates for another server. HRM_SSL_NO_VERIFY skips the check
    // (last resort). The 15 s query limit is set on the reader login itself (scripts/hrm-reader.sql) – the pooler may refuse one sent at sign-in.
    let host = ''; try { host = new URL(url).hostname; } catch { /* the driver reports a bad address */ }
    const ca = [...readCerts(process.env.HRM_SSL_CA), ...(/\.supabase\.(com|co)$/.test(host) ? [SUPABASE_ROOT_CA] : [])];
    pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: !process.env.HRM_SSL_NO_VERIFY, ...(ca.length && { ca }) } });
    pools.set(key, pool);
  }
  return (await pool.query(sql, params)).rows;
}

// Everyone in Aali HRM, without attendance: for HR to choose from when matching by hand.
export const hrmPeople = () => q('select lower(email) as email, full_name as name, is_active as active from users where email is not null', []);

// month 'YYYY-MM' → { holidays: ['YYYY-MM-DD'], people: Map(email → { name, active, joined, left, records, leaves }) }
// key: a client's link code – then each person also has their Employee ID (code), designation and department, and byCode finds them by it.
export async function hrmMonth(month, key = '') {
  const from = `${month}-01`, to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10), Q = (sql, p) => q(sql, p, key);
  const [users, recs, leaves, hols] = await Promise.all([
    Q(`select u.id, lower(u.email) as email, u.full_name as name, u.is_active as active,
         coalesce(d.date_of_joining, u.joining_date)::text as joined, d.exit_date::text as "left"${key ? ', d.employee_id as code, u.designation, u.department' : ''}
       from users u left join employee_details d on d.user_id = u.id`, []),
    Q(`select user_id, date::text as date, check_in is not null as "checkIn", check_out is not null as "checkOut",
         to_char(check_in at time zone 'Asia/Kolkata', 'HH24:MI') as "inAt", to_char(check_out at time zone 'Asia/Kolkata', 'HH24:MI') as "outAt",
         coalesce(extract(epoch from working_hours), extract(epoch from (check_out - check_in))) / 3600.0 as hours,
         office_time is null as flexible,
         office_time is not null and check_in is not null and to_char(check_in at time zone 'Asia/Kolkata', 'HH24:MI') > to_char(office_time, 'HH24:MI') as late
       from attendance where date between $1::date and $2::date`, [from, to]),
    Q(`select user_id, start_date::text as "from", end_date::text as "to", leave_type as type
       from leave_requests where status = 'approved' and start_date <= $2::date and end_date >= $1::date`, [from, to]),
    Q('select date::text as date from holidays where date between $1::date and $2::date', [from, to]),
  ]);
  const byId = new Map(), people = new Map(), byCode = new Map();
  for (const u of users) {
    const code = String(u.code || '').trim().toUpperCase(); if (!u.email && !code) continue;
    const p = { name: u.name || '', active: u.active !== false, joined: u.joined || '', left: u.left || '', records: [], leaves: [], ...(key && { email: u.email || '', code, designation: u.designation || '', department: u.department || '' }) };
    byId.set(u.id, p); if (u.email) people.set(u.email, p); if (key && code) byCode.set(code, p);
  }
  for (const r of recs) byId.get(r.user_id)?.records.push({ date: r.date, checkIn: !!r.checkIn, checkOut: !!r.checkOut, inAt: r.inAt || '', outAt: r.outAt || '', hours: Number(r.hours) || 0, flexible: !!r.flexible, late: !!r.late });
  for (const l of leaves) byId.get(l.user_id)?.leaves.push({ from: l.from, to: l.to, type: l.type });
  return { holidays: hols.map((h) => h.date), people, byCode, all: [...byId.values()] };
}
// A payroll client's employee in the client's HRM: by Employee ID (= the employee code), else by their personal email.
export const hrmFind = (h, e) => h?.byCode?.get(String(e.code || '').trim().toUpperCase()) || (e.personalEmail ? h?.people.get(String(e.personalEmail).toLowerCase()) : null) || null;
