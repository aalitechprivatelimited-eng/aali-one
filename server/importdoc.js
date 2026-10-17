// Old documents into Aali One (the user, 17 Oct 2026): service agreements, closure agreements and quotations made by hand before Aali One.
// A Word file or a PDF made from Word is read exactly – no OCR: the old documents are uploaded once, from the computer, and every new one
// is made in Aali One (the user, 17 Oct 2026). Then the details are picked out of the text the way Aali's own templates write them, and
// shown to the person for checking before anything is saved (src/importdoc.jsx).
import JSZip from 'jszip';

// ---------- reading ----------
async function docxText(buf) {
  const z = await JSZip.loadAsync(buf), f = z.file('word/document.xml'); if (!f) throw new Error('This Word file has no text.');
  return (await f.async('string')).replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:tc>/g, ' | ')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, '\n\n');
}
async function pdfText(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p), tc = await page.getTextContent();
    let lastY = null; for (const it of tc.items) { const y = it.transform?.[5]; if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n'; else if (lastY !== null) text += ' '; text += it.str; lastY = y; }
    text += '\n';
  }
  if (text.replace(/\s/g, '').length < 100) throw new Error('This PDF is a scan (a picture, with no text in it). Upload the Word file, or a PDF saved from Word.');
  return { text, how: 'text' };
}
export async function readDocument(buf, mime, name = '') {
  if (/wordprocessingml/.test(mime) || /\.docx$/i.test(name)) return { text: await docxText(buf), how: 'word' };
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return pdfText(buf);
  throw new Error('Upload the Word file (.docx), or a PDF saved from Word.');
}

// ---------- picking out the details ----------
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y, m, d) => { const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return +m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 && +y > 2000 && +y < 2100 ? s : ''; };
export function parseDate(s) {
  const t = String(s || ''); let m = t.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{4})/); if (m) return iso(m[3], m[2], m[1]);
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([A-Za-z]{3,9})[,\s]+(\d{4})/); if (m && MON.includes(m[2].slice(0, 3).toLowerCase())) return iso(m[3], MON.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[1]);
  m = t.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/); if (m && MON.includes(m[1].slice(0, 3).toLowerCase())) return iso(m[3], MON.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, m[2]);
  return '';
}
const amount = (s) => { const m = String(s || '').match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i) || String(s || '').match(/^\s*([\d,]{3,}(?:\.\d{1,2})?)\s*(?:\/-)?\s*$/); return m ? +m[1].replace(/,/g, '') : 0; };
const clean = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s|:–-]+|[\s|:–-]+$/g, '').trim().slice(0, n);
// Table rows as written in the Word files: "label | ₹ amount |" – each cell its own piece.
const cells = (block) => block.split(/\n|\|/).map((x) => clean(x, 400)).filter(Boolean);
function pricing(block) {
  const c = cells(block), rows = []; let total = 0, gst = 0;
  for (let k = 1; k < c.length; k++) {
    const a = amount(c[k]), label = c[k - 1];
    // not an amount, a heading, a dash, a sentence that only mentions money, or a small number (a rate per worker, a count)
    if (a < 100 || amount(label) || /^(item|amount|description|particulars)$/i.test(label) || !/[a-z]{2}/i.test(label) || (label.length > 90 && /\.$/.test(label))) continue;
    const per = /month/i.test(c[k]) ? 'month' : /year|annual/i.test(c[k] + label) ? 'year' : '';
    if (/total/i.test(label) && label.length < 45) { total ||= a; continue; } // "Total Payable (One-Time)"; a long "Total Project Cost — website…" is a fee line
    if (/gst|tax/i.test(label)) { gst ||= a; continue; }
    if (/^final payment|discount|balance|paid|received/i.test(label)) continue;
    rows.push({ text: clean(label, 160), amount: a, per });
  }
  return { rows, total, gst };
}
const section = (text, from, to) => { const i = text.search(from); if (i < 0) return ''; const rest = text.slice(i), j = to ? rest.slice(20).search(to) : -1; return j < 0 ? rest : rest.slice(0, j + 20); };
function party(text) { // the client: the paragraph after the line "AND"
  const m = text.match(/\n\s*AND\s*\n+\s*([^\n]+?),?\s+having its\s+([a-z ]+?)\s+at\s+([^\n(]+)/i);
  if (m) return { clientName: clean(m[1], 120), seat: /regist/i.test(m[2]) ? 'registered office' : /premis|place/i.test(m[2]) ? 'premises' : /resid/i.test(m[2]) ? 'residence' : 'office', address: clean(m[3].replace(/\(here.*$/i, ''), 300) };
  const x = text.match(/\n\s*AND\s*\n+\s*([^\n,]{3,120})/); return x ? { clientName: clean(x[1], 120) } : {};
}
function signer(text) { // the client's signatory: the second "Name:" that is filled in
  const names = [...text.matchAll(/Name\s*:\s*([^\n|_]{3,80})/gi)].map((m) => clean(m[1], 80)).filter((n) => n && !/^_+$/.test(n));
  const roles = [...text.matchAll(/Designation\s*:\s*([^\n|_]{2,80})/gi)].map((m) => clean(m[1], 80)).filter(Boolean);
  return { contactName: names[1] || '', contactRole: roles[1] || '' };
}
function schedule(text, total) {
  const pay = (text.match(/Payment (?:Terms|schedule)\s*:?\s*([^\n]+)/i) || [])[1] || '', out = [];
  for (const m of pay.matchAll(/(\d{1,3})\s*%\s*([^;.]+)/g)) out.push({ pct: +m[1], text: clean(m[2], 120) });
  if (!out.length && total) for (const m of pay.matchAll(/(?:₹|rs\.?)\s*([\d,]+)\s*\/?-?\s*([^;.]+)/gi)) { const a = +m[1].replace(/,/g, ''); if (a && a <= total) out.push({ pct: Math.round((a / total) * 100), text: clean(m[2], 120) }); }
  return out;
}

// kind: 'service' | 'closure' | 'quote' | 'invoice' (opts.ownGstin: ours, so it is not taken for the client's) → { fields, found: [names of the fields that were read] }
export function extract(kind, text, opts = {}) {
  const t = '\n' + String(text || '').replace(/\r/g, ''), f = {};
  const num = t.match(/\b((?:SA|PCA|AC)\/\d{4}-\d{2}\/\d{1,4})\b/); if (num) f.oldNumber = num[1];
  if (kind === 'invoice') { // a tax invoice, B2B (the client's GSTIN is on it) or B2C (none)
    const own = String(opts.ownGstin || '').toUpperCase(), gstins = [...t.toUpperCase().matchAll(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g)].map((m) => m[1]).filter((g) => g !== own);
    f.oldNumber ||= clean((t.match(/Invoice\s*(?:No\.?|Number|#)\s*[:|]?\s*([A-Za-z0-9/\-]{3,30})/i) || [])[1], 30);
    f.date = parseDate((t.match(/(?:Invoice\s*)?Date\s*[:|]?\s*([^\n|]{6,40})/i) || [])[1]);
    f.clientName = clean((t.match(/(?:Bill(?:ed)?\s*To|Buyer|Customer|Recipient)\s*[:|]?\s*\n?\s*\|?\s*([^\n|]{3,120})/i) || [])[1], 120);
    f.gstin = gstins[0] || ''; f.kind = f.gstin ? 'b2b' : 'b2c';
    f.placeOfSupply = clean((t.match(/Place of Supply\s*[:|]?\s*([^\n|]{3,40})/i) || [])[1], 40);
    const p = pricing(section(t, /\n[^\n]*(?:Description|Particulars|Item)/i, /Amount in words|Bank details|Terms/i) || t);
    f.items = p.rows.map((r) => ({ desc: r.text, qty: 1, unit: 'Nos', rate: r.amount, sac: (t.match(/\b(99\d{4})\b/) || [])[1] || '998314' }));
    f.taxMode = /IGST/i.test(t) ? 'inter' : /CGST|SGST/i.test(t) ? 'intra' : 'none'; f.taxRate = +((t.match(/(?:IGST|CGST|GST)\s*@?\s*(\d{1,2}(?:\.\d)?)\s*%/i) || [])[1] || 18);
    if (f.taxMode === 'intra' && f.taxRate <= 14) f.taxRate *= 2; // "CGST @ 9%" is half of 18%
    f.total = p.total;
  } else if (kind === 'quote') {
    const box = (label) => { const m = t.match(new RegExp(`${label}\\s*\\|?\\s*\\n?\\s*\\|?\\s*([^\\n|]{2,160})`, 'i')); return m ? clean(m[1], 160) : ''; };
    f.date = parseDate(box('Date')) || parseDate((t.match(/\bDate[d]?\s*[:|]?\s*([^\n]{6,40})/i) || [])[1]);
    f.clientName = box('Prepared For') || clean((t.match(/\bTo\s*[:,]?\s*\n\s*([^\n]{3,100})/i) || [])[1], 120);
    f.subject = box('Project') || box('Subject');
    const p = pricing(section(t, /\n\s*(?:\d\.\s*)?Pricing|Price Details|Commercials|Fees/i, /\n\s*(?:\d\.\s*)?Terms/i));
    f.items = p.rows.map((r) => ({ desc: r.text, note: '', qty: 1, unit: r.per ? (r.per === 'month' ? 'Month' : 'Year') : 'Nos', rate: r.amount }));
    f.taxMode = /no gst|gst not applicable|without gst/i.test(t) ? 'none' : 'intra'; f.taxRate = +((t.match(/(\d{1,2})\s*%\s*GST|GST\s*@\s*(\d{1,2})\s*%/i) || []).slice(1).find(Boolean) || 18);
    f.total = p.total; f.validUntil = '';
  } else {
    Object.assign(f, party(t));
    f.date = parseDate((t.match(/made on\s+([^\n(]{6,40})/i) || [])[1]) || parseDate((t.match(/dated\s+([^\n(]{6,40})/i) || [])[1]);
    f.purpose = clean((t.match(/engage the Service Provider for\s+(?:the\s+)?([^\n]+?)(?:,\s*as more particularly|;|\n)/i) || [])[1], 400);
    const short = f.purpose.replace(/^(?:the\s+)?(?:design,?\s*)?(?:development|delivery)?.{0,40}?of\s+(?:a|an|the)\s+/i, '').replace(/\s+for its (?:business|workforce).*$/i, '');
    f.title = short.length <= 70 ? clean(short, 70) : clean(short.slice(0, 70).replace(/[\s,]+\S*$/, ''), 70) + '…';
    Object.assign(f, signer(t));
    if (kind === 'service') {
      const p = pricing(section(t, /Annexure B/i, /Terms\s*&\s*Conditions|Payable To/i) || section(t, /Fees and Payment/i, /\n\s*5\./));
      f.lines = p.rows.filter((r) => !r.per).map((r) => ({ text: r.text, amount: r.amount })); f.recurring = p.rows.filter((r) => r.per).map((r) => ({ text: r.text, amount: `₹${r.amount.toLocaleString('en-IN')} / ${r.per}` }));
      f.gst = /no gst|gst not applicable|not paying any gst/i.test(t) ? 'none' : /inclusive of (?:all )?(?:taxes|gst)|gst included/i.test(t) ? 'included' : 'extra';
      f.gstRate = 18; f.total = p.total || f.lines.reduce((s, x) => s + x.amount, 0); f.schedule = schedule(t, f.total);
    } else {
      f.serviceDate = parseDate((t.match(/Service Agreement dated\s+([^\n(]{6,40})/i) || [])[1]);
      f.delivered = parseDate((t.match(/Go-Live Date[^\n]*?being\s+([^\n.]{6,30})/i) || [])[1]) || f.date;
      f.value = amount((t.match(/total Fees of\s+([^\n(]{3,30})/i) || [])[1]) || amount((t.match(/Total Fees[^\n|]*\|\s*([^\n|]+)/i) || [])[1]);
      f.received = amount((t.match(/Total amount paid[^\n|]*\|\s*([^\n|]+)/i) || [])[1]) || (/paid the Fees in full|paid in full/i.test(t) ? f.value : 0);
      f.pending = ''; f.website = clean((t.match(/https?:\/\/[^\s)]+/) || [])[0], 120);
    }
  }
  const found = Object.entries(f).filter(([, v]) => (Array.isArray(v) ? v.length : v !== '' && v !== 0 && v != null)).map(([k]) => k);
  return { fields: f, found };
}
