// WhatsApp messages sent by Aali One itself, through Meta's WhatsApp Cloud API (the user chose it, 8 Oct 2026).
// Today: each daily report goes to management on WhatsApp the moment its writer submits it, one message per report.
//
// Hosting settings (never in the database or the browser):
//   WHATSAPP_TOKEN            a permanent access token (Meta Business → System users → Generate token, whatsapp_business_messaging)
//   WHATSAPP_PHONE_NUMBER_ID  the business number's ID (WhatsApp Manager → Phone numbers)
//   WHATSAPP_REPORT_TEMPLATE  the approved template's name (default daily_report), WHATSAPP_TEMPLATE_LANG (default en)
//   WHATSAPP_API_VERSION      Graph API version (default v23.0) · APP_URL  the address in links (default https://one.aaligroup.co)
//   WHATSAPP_BUSINESS_ACCOUNT_ID  the WhatsApp Business Account's ID – only for "Check the template with Meta" in Settings
// A business may write first only with a template Meta has approved, so the report goes as the template's four fields (see
// REPORT_TEMPLATE below, which is what is pasted into WhatsApp Manager). Template fields may not hold line breaks, so the report is
// one line of summary plus a link straight to it in Aali One.
//
// Messages wait in the outbox table: queued in the same transaction as the report, sent right after, tried again with a growing
// pause if WhatsApp refuses or cannot be reached (5 tries), and listed in Settings → WhatsApp with what happened to each.
import { getSetting } from './logic.js';

export const REPORT_TEMPLATE = `Daily report from {{1}} for {{2}}.

{{3}}

Full report: {{4}}

– Aali One`;
const env = (k, d = '') => process.env[k] || d;
let testSender = null;
export const setWaSender = (fn) => { testSender = fn; }; // tests: (to, template) => message id, or throw
export const waReady = () => !!(testSender || (env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID')));
export const waTemplate = () => ({ name: env('WHATSAPP_REPORT_TEMPLATE', 'daily_report'), lang: env('WHATSAPP_TEMPLATE_LANG', 'en') });
const appUrl = () => env('APP_URL', 'https://one.aaligroup.co').replace(/\/+$/, '');

// An Indian mobile as WhatsApp wants it: 91 and the 10 digits. Anything else that is long enough is taken as written with its country code.
export function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length === 10 && /^[6-9]/.test(d) ? '91' + d : d.length === 12 && d.startsWith('91') ? d : d.length >= 11 && d.length <= 15 && !d.startsWith('91') ? d : '';
}
// A template field: one line, no tabs, never more than 4 spaces together (Meta refuses those), and not too long.
const field = (s, max) => { const t = String(s || '').replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').replace(/( · ){2,}/g, ' · ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t || '–'; };

// ---------- one daily report as one line ----------
const SHORT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayOf = (s) => `${DAYS[new Date(s + 'T00:00:00Z').getUTCDay()]} ${+s.slice(8, 10)} ${SHORT_MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
const hm = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(11, 16); // India time
const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
const span = (e) => { const s = e.start ? Date.parse(e.start) : Date.parse(e.at) - (e.mins || 0) * 60000; return [s, e.end ? Date.parse(e.end) : s + (e.mins || 0) * 60000]; };
export function reportLine(r) {
  const es = (r.entries || []).map((e) => { const [s, en] = span(e); return { e, s, en }; }).filter((x) => !isNaN(x.s)).sort((a, b) => a.s - b.s);
  const work = es.filter((x) => !x.e.brk), worked = Math.round(work.reduce((t, x) => t + Math.max(0, x.en - x.s), 0) / 60000), out = [];
  // the day as the Daily page counts it: from "Start my day" or the first task, whichever is earlier, to the submit
  const start = Math.min(...[r.dayStart ? Date.parse(r.dayStart) : NaN, es[0]?.s].filter((x) => x > 0)), end = r.dayEnd ? Date.parse(r.dayEnd) : es.reduce((m, x) => Math.max(m, x.en), 0);
  if (isFinite(start)) out.push(`Day ${hm(start)}–${end ? hm(end) : '…'}, worked ${mins(worked)}`);
  const what = work.map(({ e }) => (e.visit ? `visit ${e.visit.client}${e.visit.outcome ? ' (' + e.visit.outcome + ')' : ''}` : e.trip ? '' : e.text)).filter(Boolean);
  if (what.length) out.push(`${what.length} task${what.length === 1 ? '' : 's'}: ${what.slice(0, 6).join('; ')}${what.length > 6 ? `; ${what.length - 6} more` : ''}`);
  const c = r.calls || [];
  if (c.length) { const n = (f) => c.filter(f).length, meet = n((x) => x.meeting);
    out.push(`${c.length} call${c.length === 1 ? '' : 's'}: ${n((x) => x.resp === 'Interested')} interested, ${n((x) => x.resp === 'Call back')} call back${meet ? `, ${meet} meeting${meet === 1 ? '' : 's'} fixed` : ''}`); }
  if (r.blockers?.trim()) out.push(`Help needed: ${r.blockers.trim()}`);
  if (r.plan?.trim()) out.push(`Tomorrow: ${r.plan.trim()}`);
  return out.join(' · ');
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
  const who = [writer.name, writer.designation].filter(Boolean).join(', ');
  const params = [field(who, 120), field(dayOf(report.date), 40), field(reportLine(report), 700), `${appUrl()}/daily?d=${report.date}&p=${encodeURIComponent(report.owner)}`];
  for (const u of to) await t.query("insert into outbox (kind, to_user, to_phone, payload, ref) values ('report', $1, $2, $3, $4)", [u.id, waNumber(u.phone), JSON.stringify({ params }), report.id]);
  return to.length;
}
export async function queueTest(t, u) {
  if (!waReady()) throw new Error('WhatsApp is not linked yet.');
  if (!waNumber(u.phone)) throw new Error('Add your mobile number in Settings → My profile first.');
  const params = [field(u.name + ' (a test)', 120), field(dayOf(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)), 40), 'This is a test message from Aali One. Daily reports will arrive like this.', `${appUrl()}/daily`];
  await t.query("insert into outbox (kind, to_user, to_phone, payload) values ('test', $1, $2, $3)", [u.id, waNumber(u.phone), JSON.stringify({ params })]);
}

async function send(to, params) {
  const tpl = waTemplate(), template = { name: tpl.name, language: { code: tpl.lang }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] };
  if (testSender) return testSender(to, template);
  const r = await fetch(`https://graph.facebook.com/${env('WHATSAPP_API_VERSION', 'v23.0')}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
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
    const r = await fetch(`https://graph.facebook.com/${env('WHATSAPP_API_VERSION', 'v23.0')}/${waba}/message_templates?name=${encodeURIComponent(tpl.name)}&fields=name,status,category,language,components,rejected_reason&limit=50`,
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
  if (fields.size !== 4 || ![1, 2, 3, 4].every((n) => fields.has(`{{${n}}}`))) problems.push(`It has ${fields.size} field${fields.size === 1 ? '' : 's'}; Aali One fills four: {{1}} to {{4}}.`);
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
    try { const id = await send(m.to_phone, m.payload.params); await db.query("update outbox set status = 'sent', sent_at = now(), wa_id = $2, error = '' where id = $1", [m.id, String(id || '')]); }
    catch (e) { const last = m.tries >= 5; // tried again after 2, 4, 8, 16 minutes, then left as failed
      await db.query(`update outbox set status = $2, error = $3, next_at = now() + make_interval(mins => $4) where id = $1`, [m.id, last ? 'failed' : 'queued', String(e?.message || e).slice(0, 300), 2 ** m.tries]); }
  }
  return rows.length;
}
// Started after a report is submitted, and by the page's regular checks (at most every 30 seconds), so a message that could not go
// at once is tried again without anyone pressing anything. Never more than one at a time on this server.
let busy = false, lastKick = 0;
export function kickOutbox(db, now = false) {
  if (!waReady() || busy || (!now && Date.now() - lastKick < 30000)) return;
  busy = true; lastKick = Date.now();
  flushOutbox(db).catch((e) => console.error('whatsapp outbox', e.message)).finally(() => { busy = false; });
}
// A message stuck in 'sending' (the server stopped half way) goes back to the queue after 10 minutes.
const unstick = (db) => db.query("update outbox set status = 'queued' where status = 'sending' and claimed_at < now() - interval '10 minutes'");
