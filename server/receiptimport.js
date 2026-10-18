// Copying the old Aali Receipt generator into Aali One (the user, 18 Oct 2026). The generator keeps its receipts in its own Supabase project
// with no sign-in; this reads them over Supabase's REST address with the publishable key (env RECEIPTS_SUPABASE_URL / RECEIPTS_SUPABASE_KEY,
// entered by the user in Coolify). It only reads there. In Aali One each receipt keeps its own printed number and figures, the day's
// counter is raised past the copied numbers so new receipts never repeat one, and the untouched source is kept as a JSON file.
import { newId } from './auth.js';
import { dayLabel, fyLabel, num, round2, receiptTotals } from '../shared/money.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';

const env = () => ({ url: String(process.env.RECEIPTS_SUPABASE_URL || '').trim().replace(/\/+$/, ''), key: String(process.env.RECEIPTS_SUPABASE_KEY || '').trim() });
export const generatorConnected = () => { const e = env(); return /^https:\/\/[\w.-]+$/.test(e.url) && !!e.key; };
let fetcher = (...a) => fetch(...a);
export const setGeneratorFetch = (f) => { fetcher = f; }; // tests use a stand-in generator

async function rest(path) {
  const { url, key } = env(), out = [];
  for (let from = 0; ; from += 1000) { // Supabase gives at most 1000 rows per answer
    const r = await fetcher(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error(`The Receipt generator answered ${r.status}${r.status === 401 ? ' – check the key in Coolify' : ''}.`);
    const rows = await r.json(); if (!Array.isArray(rows)) throw new Error('The Receipt generator sent something unexpected.');
    out.push(...rows); if (rows.length < 1000) return out;
  }
}
export async function readGenerator() {
  const receipts = await rest('receipts?select=*&order=payment_date.asc,seq.asc');
  let business = null; try { business = (await rest('business_settings?select=*&id=eq.1'))[0] || null; } catch { /* the letterhead is optional */ }
  return { receipts, business };
}

const S = (v, n = 2000) => String(v ?? '').slice(0, n);
const STATUS = ['received', 'partial', 'pending', 'refunded'];
// One generator receipt as an Aali One receipt record.
export function mapReceipt(x, user, at) {
  const d = {
    number: S(x.receipt_no, 40), seq: Math.trunc(num(x.seq)), date: S(x.payment_date, 10), status: STATUS.includes(x.status) ? x.status : 'received',
    currency: x.currency === 'USD' ? 'USD' : 'INR', payerName: S(x.payer_name, 200), payerContact: S(x.payer_contact, 200), payerAddress: S(x.payer_address),
    payerEmail: S(x.payer_email, 200), payerPhone: S(x.payer_phone, 200), payerGstin: S(x.payer_gstin, 20).toUpperCase(),
    items: (Array.isArray(x.items) ? x.items : []).slice(0, 40).map((it) => ({ desc: S(it?.desc, 300), note: S(it?.note, 300), amount: round2(num(it?.amount)), incl: !!it?.incl })),
    taxMode: ['intra', 'inter', 'none'].includes(x.tax_mode) ? x.tax_mode : 'none', taxRate: num(x.tax_rate), balance: round2(num(x.balance)),
    mode: S(x.method, 200), reference: S(x.reference, 200), forText: S(x.payment_for, 200), description: S(x.description), intro: S(x.intro), terms: S(x.terms), bank: S(x.bank),
    notes: S(x.notes), preparedBy: S(x.prepared_by, 200), receivedBy: S(x.received_by, 200),
    printed: { subtotal: round2(num(x.subtotal)), tax: round2(num(x.tax_amount)), total: round2(num(x.total)) },
    settlesNo: S(x.settles_no, 40) || undefined,
    imported: { from: 'receipt-generator', id: String(x.id), at, by: user.id },
  };
  if (d.currency === 'USD') d.taxMode = 'none';
  d.fy = S(x.fy, 10) || fyLabel(d.date);
  d.totals = receiptTotals(d); // the printed figures (receiptTotals uses "printed" when it is there)
  return d;
}

// What would happen: counts only, nothing written.
export async function previewImport(db) {
  const { receipts } = await readGenerator(), have = await numbersInAaliOne(db);
  const fresh = receipts.filter((x) => !have.has(String(x.receipt_no)));
  const dates = receipts.map((x) => String(x.payment_date)).filter(Boolean).sort();
  return { total: receipts.length, fresh: fresh.length, already: receipts.length - fresh.length, deleted: receipts.filter((x) => x.deleted_at).length,
    zero: receipts.filter((x) => !(num(x.total) > 0)).length, first: dates[0] || '', last: dates[dates.length - 1] || '',
    lastNumbers: lastPerDay(receipts).slice(-5) };
}
async function numbersInAaliOne(t) {
  return new Set((await t.query("select data->>'number' n from records where type = 'receipt'")).rows.map((r) => r.n)); // deleted ones too: a number is never used twice
}
const lastPerDay = (rows) => { const m = new Map(); for (const x of rows) { const day = String(x.payment_date); if (!m.has(day) || num(x.seq) > num(m.get(day).seq)) m.set(day, x); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, x]) => ({ day, number: String(x.receipt_no) })); };

// Copy them. Safe to run again: a number already in Aali One is skipped.
export async function runImport(db, user) {
  const src = await readGenerator(), at = new Date().toISOString();
  return db.tx(async (t) => {
    const have = await numbersInAaliOne(t), byGen = new Map(), skipped = [], copied = [];
    // The untouched source first, so nothing is lost when the old app is deleted.
    const raw = Buffer.from(JSON.stringify({ exportedAt: at, from: env().url, receipts: src.receipts, business: src.business }, null, 1));
    const fileId = newId('f_');
    await t.query('insert into files (id, name, mime, size, data, created_by) values ($1,$2,$3,$4,$5,$6)', [fileId, `receipt-generator-backup-${at.slice(0, 10)}.json`, 'application/json', raw.length, raw, user.id]);
    const maxSeq = new Map();
    for (const x of src.receipts) {
      const no = String(x.receipt_no || '');
      if (!no) { skipped.push({ number: '(none)', why: 'no receipt number' }); continue; }
      if (have.has(no)) { skipped.push({ number: no, why: 'already in Aali One' }); continue; }
      const d = mapReceipt(x, user, at), id = newId('re_');
      await t.query('insert into records (id, type, data, created_by, updated_by, created_at, deleted_at, deleted_by, delete_reason) values ($1,$2,$3,$4,$4,$5,$6,$7,$8)',
        [id, 'receipt', JSON.stringify(d), user.id, x.created_at || at, x.deleted_at || null, x.deleted_at ? user.id : null, x.deleted_at ? S(x.delete_reason, 500) || 'Deleted in the Receipt generator' : null]);
      have.add(no); byGen.set(String(x.id), id); copied.push(no);
      const day = dayLabel(d.date); maxSeq.set(day, Math.max(maxSeq.get(day) || 0, d.seq));
    }
    // A balance receipt points at the receipt it clears: link it to that receipt's new record.
    let linked = 0;
    for (const x of src.receipts) if (x.settles_id && byGen.has(String(x.id)) && byGen.has(String(x.settles_id))) {
      await t.query("update records set data = jsonb_set(data, '{settlesId}', to_jsonb($2::text)) where id = $1", [byGen.get(String(x.id)), byGen.get(String(x.settles_id))]); linked++; }
    // Each day's counter goes past the highest copied number, so the next receipt Aali One makes that day is new.
    for (const [day, n] of maxSeq) await t.query('insert into counters (key, n) values ($1, $2) on conflict (key) do update set n = greatest(counters.n, excluded.n)', ['receipt:' + day, n]);
    // The letterhead's stamp scan and receipt texts, only where Aali One has none yet.
    let letterhead = [];
    if (src.business) {
      const cur = (await t.query("select value from settings where key = 'business'")).rows[0]?.value || DEFAULT_SETTINGS.business;
      { const next = { ...cur };
        if (!next.stamp && /^data:image\//.test(src.business.stamp_url || '')) { next.stamp = src.business.stamp_url; letterhead.push('stamp'); }
        if (!next.receiptBank && src.business.default_bank) { next.receiptBank = S(src.business.default_bank); letterhead.push('payment details'); }
        if (letterhead.length) await t.query("insert into settings (key, value) values ('business', $1) on conflict (key) do update set value = $1, updated_at = now()", [JSON.stringify(next)]); }
    }
    await t.query('insert into audit (user_id, record_id, type, action, summary) values ($1,$2,$3,$4,$5)', [user.id, fileId, 'receipt', 'import',
      `Receipt generator: ${copied.length} receipts copied, ${skipped.length} skipped${letterhead.length ? ', letterhead ' + letterhead.join(' and ') : ''}. Backup file ${fileId}.`.slice(0, 1500)]);
    return { copied: copied.length, skipped, linked, counters: maxSeq.size, letterhead, backup: { id: fileId, name: `receipt-generator-backup-${at.slice(0, 10)}.json` },
      first: copied[0] || '', last: copied[copied.length - 1] || '' };
  });
}
