// WhatsApp messages sent by Aali One itself, through Meta's WhatsApp Cloud API (the user chose it, 8 Oct 2026).
// Today: each daily report goes to management on WhatsApp the moment its writer submits it, one message per report.
//
// Hosting settings (never in the database or the browser):
//   WHATSAPP_TOKEN            a permanent access token (Meta Business → System users → Generate token, whatsapp_business_messaging)
//   WHATSAPP_PHONE_NUMBER_ID  the business number's ID (WhatsApp Manager → Phone numbers)
//   WHATSAPP_REPORT_TEMPLATE  the approved template's name (default daily_report), WHATSAPP_TEMPLATE_LANG (default en)
//   WHATSAPP_API_VERSION      Graph API version (default v25.0) · APP_URL  the address in links (default https://one.aaliconssultancy.com)
//   WHATSAPP_BUSINESS_ACCOUNT_ID  the WhatsApp Business Account's ID – only for "Check the template with Meta" in Settings
// A business may write first only with a template Meta has approved, so the report goes as the template's six fields (see
// REPORT_TEMPLATE below, which is what is pasted into WhatsApp Manager), one line each, and an "Open full report" button whose
// link opens that one report without sign-in (/daily/<key>), like a project's client progress link.
//
// Messages wait in the outbox table: queued in the same transaction as the report, sent right after, tried again with a growing
// pause if WhatsApp refuses or cannot be reached (5 tries), and listed in Settings → WhatsApp with what happened to each.
import { getSetting } from './logic.js';
import { ROLE_NAME } from '../shared/access.js';

// The user's order (8 Oct 2026): 1. the employee's name and designation, 2. the hours worked with their details, 3. the final report.
// Meta refused seven blanks in a short text ("too many variables for its length"), so the link to the report is the template's
// button – "Open full report", a website button whose address ends in a blank – and the body has more words of its own.
export const REPORT_TEMPLATE = `👤 {{1}}
Daily work report · Aali One

⏱️ Worked hours: {{2}}
Work done: {{3}}

📋 Final report
Calls: {{4}}
Plan for tomorrow: {{5}}
Problem: {{6}}

This report was just submitted in Aali One. Tap the button below to open it in full.`;
export const TEMPLATE_FIELDS = 6;
// What Meta asks for when the template is made: a sample for each blank (shown in Settings → WhatsApp and on the setup page).
export const TEMPLATE_SAMPLES = ['*Rasheed Shaik*, BDE · Thu 8 Oct 2026', '4 h 40 min (9:40 am – 3:51 pm · Break 40 min · Nothing recorded 1 h 30 min)',
  'Calling 2 h 25 min · Client visit 1 h 30 min · Quotations 45 min', '3 calls · 1 interested · 1 to call back · 1 meeting fixed · 0 met in person',
  'Visit Ravi Stores and send the demo link to Sri Sai Traders', 'Need the new price list from the office'];
export const REPORT_BUTTON = { text: 'Open full report', url: () => `${appUrl()}/daily/{{1}}` }; // the blank: the report's key
const env = (k, d = '') => process.env[k] || d;
let testSender = null;
export const setWaSender = (fn) => { testSender = fn; }; // tests: (to, template) => message id, or throw
export const waReady = () => !!(testSender || (env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID')));
export const waTemplate = () => ({ name: env('WHATSAPP_REPORT_TEMPLATE', 'daily_report'), lang: env('WHATSAPP_TEMPLATE_LANG', 'en') });
const appUrl = () => env('APP_URL', 'https://one.aaliconssultancy.com').replace(/\/+$/, '');

// An Indian mobile as WhatsApp wants it: 91 and the 10 digits. Anything else that is long enough is taken as written with its country code.
export function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length === 10 && /^[6-9]/.test(d) ? '91' + d : d.length === 12 && d.startsWith('91') ? d : d.length >= 11 && d.length <= 15 && !d.startsWith('91') ? d : '';
}
// A template field: one line, no tabs, never more than 4 spaces together (Meta refuses those), and not too long.
const field = (s, max) => { const t = String(s || '').replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').replace(/( · ){2,}/g, ' · ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t || '–'; };

// ---------- one daily report, line by line, as the Daily reports page writes it (src/pages/Daily.jsx dayLine, dayText, timeByType) ----------
// A template's blank may not hold a line break, so each line is its own blank; the kinds of work share one line.
const SHORT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayOf = (s) => `${DAYS[new Date(s + 'T00:00:00Z').getUTCDay()]} ${+s.slice(8, 10)} ${SHORT_MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
const clock = (ms) => { const d = new Date(ms + 5.5 * 3600e3), h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0'); return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`; }; // India time, 10:50 am
export const fmtMins = (m) => (!m ? '0 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const GAP = 10 * 60000; // gaps shorter than 10 minutes are not "nothing recorded"
const bounds = (e) => { const s = e.start ? Date.parse(e.start) : Date.parse(e.at) - (e.mins || 0) * 60000; return [s, e.state === 'running' ? Date.now() : e.end ? Date.parse(e.end) : s + (e.mins || 0) * 60000]; };
const kindLabel = (k) => String(k || 'Other').replace(/\s+/g, ' ').trim().replace(/(– )(\p{Ll})/u, (_, a, b) => a + b.toUpperCase());
export function dayLine(r) {
  const es = (r.entries || []).map((e) => { const [s, en] = bounds(e); return { e, s, en }; }).filter((x) => !isNaN(x.s)).sort((a, b) => a.s - b.s);
  const open = r.status !== 'submitted', running = es.some((x) => x.e.state === 'running');
  const ds = r.dayStart ? Date.parse(r.dayStart) : 0, start = ds && es[0] ? Math.min(ds, es[0].s) : ds || es[0]?.s, last = es.reduce((m, x) => Math.max(m, x.en), start || 0);
  const end = r.dayEnd ? Date.parse(r.dayEnd) : last;
  let cur = start, idle = 0;
  for (const x of es) { if (x.s - cur >= GAP) idle += x.s - cur; cur = Math.max(cur, x.en); }
  if (start && !running && end - cur >= GAP) idle += end - cur;
  const sum = (f) => Math.round(es.filter(f).reduce((t, x) => t + (x.en - x.s), 0) / 60000);
  return { start, end, open, worked: sum((x) => !x.e.brk), brk: sum((x) => x.e.brk), idle: Math.round(idle / 60000) };
}
// The report's lines: [hours worked with their details, kinds of work, calls, plan for tomorrow, problem].
export function reportLines(r) {
  const d = dayLine(r), c = r.calls || [], n = (f) => c.filter(f).length, meet = n((x) => x.meeting);
  const hours = d.start ? `${fmtMins(d.worked)} (${clock(d.start)} – ${d.open ? 'still on' : clock(d.end)}${d.brk ? ` · Break ${fmtMins(d.brk)}` : ''} · Nothing recorded ${fmtMins(d.idle)})` : 'No time recorded';
  const calls = c.length ? `${c.length} call${c.length === 1 ? '' : 's'} · ${n((x) => x.resp === 'Interested')} interested · ${n((x) => x.resp === 'Call back')} to call back · ${meet} meeting${meet === 1 ? '' : 's'} fixed · ${n((x) => x.met)} met in person` : 'No calls';
  const kinds = new Map();
  for (const e of r.entries || []) { if (e.brk) continue; const [s0, e0] = bounds(e), m = +e.mins || Math.max(0, Math.round((e0 - s0) / 60000)); if (!m) continue;
    const k = kindLabel(e.kind).toLowerCase(), x = kinds.get(k) || { label: kindLabel(e.kind), mins: 0 }; x.mins += m; kinds.set(k, x); }
  const work = [...kinds.values()].sort((a, b) => b.mins - a.mins).map((x) => `${x.label} ${fmtMins(x.mins)}`).join(' · ') || 'No timed work';
  return [hours, work, calls, r.plan?.trim() || 'Not written', r.blockers?.trim() || 'None'];
}

// ---------- the outbox ----------
// Who gets each report: everyone active in management (Chairman, Operations Manager, Company Secretary) with a mobile number,
// except the writer and anyone switched off in Settings → WhatsApp (setting waReports.skip).
export async function reportRecipients(t, writerId) {
  const s = await getSetting(t, 'waReports', { on: true, skip: [] });
  if (s.on === false) return [];
  return (await t.query("select id, name, phone from users where active and removed_at is null and team = 'management' and title <> 'admin' and id <> $1 order by name", [writerId])).rows
    .filter((u) => !(s.skip || []).includes(u.id) && waNumber(u.phone));
}
export async function queueReport(t, report, writer) {
  if (!waReady() || report.sample) return 0;
  const to = await reportRecipients(t, writer.id); if (!to.length) return 0;
  const [hours, work, calls, plan, problem] = reportLines(report), role = (writer.designation || '').trim() || ROLE_NAME[writer.title] || '';
  const params = [field(`*${writer.name}*${role ? `, ${role}` : ''} · ${dayOf(report.date)}`, 120), field(hours, 160), field(work, 220), field(calls, 120), field(plan, 200), field(problem, 200)];
  // The button opens /daily/<key>: that report alone, with no sign-in (the user, 8 Oct 2026). Every submitted report has its key.
  const button = report.shareToken || `${report.date}/${encodeURIComponent(report.owner)}`;
  for (const u of to) await t.query("insert into outbox (kind, to_user, to_phone, payload, ref) values ('report', $1, $2, $3, $4)", [u.id, waNumber(u.phone), JSON.stringify({ params, button }), report.id]);
  return to.length;
}
export async function queueTest(t, u) {
  if (!waReady()) throw new Error('WhatsApp is not linked yet.');
  if (!waNumber(u.phone)) throw new Error('Add your mobile number in Settings → My profile first.');
  const params = [field(`*${u.name}* (a test message) · ${dayOf(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10))}`, 120), '7 h 45 min (9:30 am – 6:10 pm · Break 40 min · Nothing recorded 25 min)',
    'Calling 4 h 10 min · Client visit 2 h 5 min · Information gathering 1 h 30 min', '42 calls · 7 interested · 5 to call back · 2 meetings fixed · 0 met in person',
    'Follow up the 5 call-backs', 'None – daily reports will arrive like this'];
  // The test's button opens the latest submitted report's link, to see the page a real message opens.
  const last = (await t.query("select data->>'shareToken' k from records where type = 'report' and deleted_at is null and data->>'shareToken' is not null order by updated_at desc limit 1")).rows[0];
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  await t.query("insert into outbox (kind, to_user, to_phone, payload) values ('test', $1, $2, $3)", [u.id, waNumber(u.phone), JSON.stringify({ params, button: last?.k || `${today}/${encodeURIComponent(u.id)}` })]);
}

async function send(to, { params, button }) {
  const tpl = waTemplate(), template = { name: tpl.name, language: { code: tpl.lang }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
    ...(button ? [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: button }] }] : [])] };
  if (testSender) return testSender(to, template);
  const r = await fetch(`https://graph.facebook.com/${env('WHATSAPP_API_VERSION', 'v25.0')}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST', headers: { authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${j.error?.message || 'WhatsApp refused the message'}${j.error?.code ? ` (code ${j.error.code})` : ''}`.slice(0, 300));
  return j.messages?.[0]?.id || '';
}
// Settings → WhatsApp → "Check the template with Meta": is the template Aali One sends approved, in which category and language,
// and is its text the same as REPORT_TEMPLATE (four fields, in the same places)? Read only.
let testTemplates = null;
export const setWaTemplates = (fn) => { testTemplates = fn; }; // tests: () => [{ name, status, category, language, components }]
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export async function checkTemplate() {
  const tpl = waTemplate(), waba = env('WHATSAPP_BUSINESS_ACCOUNT_ID');
  if (!testTemplates && !(env('WHATSAPP_TOKEN') && waba)) return { ok: false, problems: ['Add WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID to the hosting settings first.'] };
  let list;
  if (testTemplates) list = await testTemplates();
  else {
    const r = await fetch(`https://graph.facebook.com/${env('WHATSAPP_API_VERSION', 'v25.0')}/${waba}/message_templates?name=${encodeURIComponent(tpl.name)}&fields=name,status,category,language,components,rejected_reason&limit=50`,
      { headers: { authorization: `Bearer ${env('WHATSAPP_TOKEN')}` }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, problems: [`Meta answered: ${j.error?.message || r.status}${j.error?.code ? ` (code ${j.error.code})` : ''}`] };
    list = j.data || [];
  }
  const same = (list || []).filter((t) => t.name === tpl.name), t = same.find((x) => x.language === tpl.lang);
  if (!t) return { ok: false, name: tpl.name, lang: tpl.lang, problems: [same.length ? `"${tpl.name}" exists in ${same.map((x) => x.language).join(', ')}, not in "${tpl.lang}". Make it in English (en), or set WHATSAPP_TEMPLATE_LANG to its language.` : `No template named "${tpl.name}" in this WhatsApp account yet.`] };
  const body = (t.components || []).find((c) => c.type === 'BODY')?.text || '', fields = new Set(body.match(/\{\{\d+\}\}/g) || []), problems = [];
  if (t.status !== 'APPROVED') problems.push(t.status === 'REJECTED' ? `Meta rejected it${t.rejected_reason && t.rejected_reason !== 'NONE' ? ': ' + t.rejected_reason : ''}. Edit it in WhatsApp Manager and submit again.` : `Not approved yet – Meta says ${t.status}.`);
  if (t.category !== 'UTILITY') problems.push(`Its category is ${t.category}, not UTILITY. Meta may have changed it; utility costs less and is not limited like marketing.`);
  if (fields.size !== TEMPLATE_FIELDS || !Array.from({ length: TEMPLATE_FIELDS }, (_, i) => i + 1).every((n) => fields.has(`{{${n}}}`))) problems.push(`It has ${fields.size} field${fields.size === 1 ? '' : 's'}; Aali One fills ${TEMPLATE_FIELDS}: {{1}} to {{${TEMPLATE_FIELDS}}}.`);
  const btn = (t.components || []).find((c) => c.type === 'BUTTONS')?.buttons?.find((b) => b.type === 'URL'), want = REPORT_BUTTON.url();
  if (!btn) problems.push(`It has no "${REPORT_BUTTON.text}" button. Add a "Visit website" button with a dynamic address: ${want}`);
  else if (btn.url !== want) problems.push(`Its button opens ${btn.url}; it must open ${want} (a dynamic address ending in {{1}}).`);
  const sameText = flat(body) === flat(REPORT_TEMPLATE);
  return { ok: !problems.length, name: t.name, lang: t.language, status: t.status, category: t.category, sameText, body, problems };
}

// Sends what is waiting. Each message is claimed first, so two servers (or two requests) never send it twice.
export async function flushOutbox(db, max = 25) {
  if (!waReady()) return 0;
  await unstick(db);
  const rows = (await db.query(`update outbox set status = 'sending', tries = tries + 1, claimed_at = now() where id in (
      select id from outbox where status = 'queued' and next_at <= now() order by id limit $1 for update skip locked) returning *`, [max])).rows;
  for (const m of rows) {
    try { const id = await send(m.to_phone, m.payload); await db.query("update outbox set status = 'sent', sent_at = now(), wa_id = $2, error = '' where id = $1", [m.id, String(id || '')]); }
    catch (e) { const last = m.tries >= 5; // tried again after 2, 4, 8, 16 minutes, then left as failed
      await db.query(`update outbox set status = $2, error = $3, next_at = now() + make_interval(mins => $4) where id = $1`, [m.id, last ? 'failed' : 'queued', String(e?.message || e).slice(0, 300), 2 ** m.tries]); }
  }
  return rows.length;
}
// Started after a report is submitted, and by the page's regular checks (at most every 30 seconds), so a message that could not go
// at once is tried again without anyone pressing anything. Never more than one at a time on this server.
// On the VPS the sending carries on after the page has its answer. On Vercel a function may be stopped once it has answered –
// a message could then wait, or go twice – so there the request waits until WhatsApp has taken the messages (waitForSending).
let busy = false, lastKick = 0;
export const waitForSending = () => !!process.env.VERCEL;
export function kickOutbox(db, now = false) {
  if (!waReady() || busy || (!now && Date.now() - lastKick < 30000)) return Promise.resolve();
  busy = true; lastKick = Date.now();
  return flushOutbox(db).catch((e) => console.error('whatsapp outbox', e.message)).finally(() => { busy = false; });
}
// A message stuck in 'sending' (the server stopped half way) goes back to the queue after 10 minutes.
const unstick = (db) => db.query("update outbox set status = 'queued' where status = 'sending' and claimed_at < now() - interval '10 minutes'");
