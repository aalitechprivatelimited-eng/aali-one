// Payslips as real PDF files (the user, 17 Oct 2026): text that can be read and searched, not pictures – one PDF for each person,
// and all of a month's payslips together in one ZIP, for Aali's own payroll and for each client's. The layout follows the payslip on
// screen (src/doc.jsx PayslipSheet). The font is Noto Sans; its ₹ sign lives in a second file (latin-ext), so ₹ is drawn with that one.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';
import { inWords } from '../shared/money.js';
import { monthLabel, grossOf } from '../shared/payroll.js';

const req = createRequire(import.meta.url), FONTS = join(dirname(req.resolve('@fontsource/noto-sans/package.json')), 'files');
const font = (sub, w) => readFileSync(join(FONTS, `noto-sans-${sub}-${w}-normal.woff`));
let F = null; // read once
const fonts = () => (F ||= { r: font('latin', 400), b: font('latin', 700), rx: font('latin-ext', 400), bx: font('latin-ext', 700) });

const GOLD = '#9a6400', INK = '#1f1a0e', SOFT = '#5e5236', BAND = '#f7efd9', LINE = '#e6d9b8';
const money = (v) => (+v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (s) => (/^\d{4}-\d\d-\d\d/.test(s || '') ? `${+s.slice(8, 10)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : '');

// Text that may hold ₹: the ₹ in the second font, the rest in the first. align right = ends at x + width.
function say(doc, text, x, y, { width, align = 'left', size = 9, bold = false, color = INK } = {}) {
  const parts = String(text ?? '').split(/(₹)/).filter((p) => p !== ''), fa = bold ? 'b' : 'r', fx = bold ? 'bx' : 'rx';
  doc.fontSize(size).fillColor(color);
  const wOf = (p) => doc.font(p === '₹' ? fx : fa).widthOfString(p), w = parts.reduce((s, p) => s + wOf(p), 0);
  let cx = align === 'right' ? x + width - w : align === 'center' ? x + (width - w) / 2 : x;
  for (const p of parts) { doc.font(p === '₹' ? fx : fa).text(p, cx, y, { lineBreak: false }); cx += wOf(p); }
  return w;
}
const amt = (v) => '₹' + money(v);

function page(doc, run, i, biz) {
  const emp = run.pclientId ? run.employer || {} : null, co = ((emp && emp.name) || i.company || biz.name || '').toUpperCase(), L = 40, R = 555, W = R - L;
  const daily = i.payType === 'daily';
  // Header: the employer on the left, PAYSLIP and the month on the right.
  say(doc, co, L, 40, { size: 15, bold: true });
  let y = 60;
  if (!emp && !co.includes('GROUP')) { say(doc, 'A UNIT OF AALI GROUP', L, y, { size: 7, color: GOLD, bold: true }); y += 11; }
  const addr = String((emp ? emp.address : biz.address) || '').replace(/\s*\n\s*/g, ', ');
  if (addr) { doc.font('r').fontSize(8).fillColor(SOFT).text(addr, L, y, { width: 330 }); y = doc.y + 2; }
  if (emp && (emp.pfCode || emp.esiCode)) { say(doc, [emp.pfCode && 'PF code ' + emp.pfCode, emp.esiCode && 'ESI code ' + emp.esiCode].filter(Boolean).join(' · '), L, y, { size: 8, color: SOFT }); y += 11; }
  say(doc, 'PAYSLIP', R - 160, 40, { width: 160, align: 'right', size: 13, color: GOLD, bold: true });
  say(doc, monthLabel(run.month), R - 160, 58, { width: 160, align: 'right', size: 11, bold: true });
  y = Math.max(y, 80) + 6; doc.moveTo(L, y).lineTo(R, y).lineWidth(1.5).strokeColor('#33280f').stroke(); y += 10;

  // The person: four rows of two label/value pairs.
  const acct = i.bank?.account ? String(i.bank.account) : '—';
  const rows = [['Name', i.name, 'Designation', i.designation || '—'],
    [emp ? 'Employee code' : 'Company', emp ? i.code || '—' : i.company || '—', 'Bank account', acct],
    ['IFSC', i.bank?.ifsc || '—', 'UAN (PF)', i.uan || '—'],
    [daily ? 'Daily wage' : run.rules?.dayBasis ? 'Days for a full month' : 'Days in the month', daily ? amt(i.rate) : String(i.days.total), 'Paid days', `${i.days.payable}${i.days.typed ? ' (entered by HR)' : ''}`]];
  const cw = [100, W / 2 - 100, 100, W / 2 - 100];
  for (const r of rows) {
    let x = L;
    for (let k = 0; k < 4; k++) {
      if (k % 2 === 0) doc.rect(x, y, cw[k], 20).fill(BAND);
      say(doc, r[k], x + 6, y + 6, { size: k % 2 === 0 ? 7.5 : 8.5, bold: k % 2 === 0, color: k % 2 === 0 ? '#4a3400' : INK });
      x += cw[k];
    }
    doc.moveTo(L, y + 20).lineTo(R, y + 20).lineWidth(0.5).strokeColor(LINE).stroke(); y += 20;
  }
  y += 14;

  // Earnings on the left, deductions on the right.
  const wages = daily ? [[`Wages – ₹${i.rate} a day × ${i.days.payable} days`, '', i.earned.gross]]
    : [['Basic', i.full.basic, i.earned.basic], ['House rent allowance (HRA)', i.full.hra, i.earned.hra], ['Special allowance', i.full.special, i.earned.special]].filter(([k, f, e]) => k === 'Basic' || +f || +e);
  const earn = [...wages, ...(i.extra ? [[i.extraWhy || 'Extra pay', '', i.extra]] : []), ...(i.earnExtras || []).map((x) => [`${x.name}${x.note ? ` (${x.note})` : ''}`, '', x.amount])];
  const ded = [['Provident Fund (PF)', i.ded.pf], ['ESI', i.ded.esi], ['Professional Tax', i.ded.pt], ['Income tax (TDS)', i.ded.tds], ...(i.ded.fixed || []).map((x) => [x.name, x.amount]),
    ...(i.ded.loans || []).map((x) => [x.kind === 'advance' ? 'Salary advance' : 'Loan repayment', x.amount]), ...(i.ded.extras || []).map((x) => [`${x.name}${x.note ? ` (${x.note})` : ''}`, x.amount]),
    [i.ded.otherWhy || 'Other deduction', i.ded.other]].filter((x) => +x[1]);
  const gap = 16, lw = (W - gap) * 0.56, rw = W - gap - lw, rx = L + lw + gap, top = y;
  const head = (x, w, cols) => { doc.rect(x, y, w, 18).fill(BAND); for (const [t, cx, cwid, al] of cols) say(doc, t, cx, y + 5, { width: cwid, align: al, size: 7.5, bold: true, color: '#4a3400' }); };
  head(L, lw, [['EARNINGS', L + 6, 120, 'left'], [daily ? '' : 'FULL MONTH', L + lw - 170, 80, 'right'], ['THIS MONTH', L + lw - 86, 80, 'right']]);
  head(rx, rw, [['DEDUCTIONS', rx + 6, 120, 'left'], ['AMOUNT', rx + rw - 86, 80, 'right']]);
  let ly = y + 18, ry = y + 18;
  const line = (x, w, yy) => doc.moveTo(x, yy).lineTo(x + w, yy).lineWidth(0.5).strokeColor(LINE).stroke();
  for (const [k, f, e] of earn) { say(doc, k, L + 6, ly + 6, { size: 8.5 }); if (f !== '') say(doc, amt(f), L + lw - 170, ly + 6, { width: 80, align: 'right', size: 8.5 }); say(doc, amt(e), L + lw - 86, ly + 6, { width: 80, align: 'right', size: 8.5 }); ly += 20; line(L, lw, ly); }
  for (const [k, v] of ded.length ? ded : [['None', 0]]) { say(doc, k, rx + 6, ry + 6, { size: 8.5 }); say(doc, amt(v), rx + rw - 86, ry + 6, { width: 80, align: 'right', size: 8.5 }); ry += 20; line(rx, rw, ry); }
  const end = Math.max(ly, ry);
  const total = (x, w, yy, label, cols) => { doc.moveTo(x, yy).lineTo(x + w, yy).lineWidth(1.5).strokeColor('#33280f').stroke(); say(doc, label, x + 6, yy + 6, { size: 8.5, bold: true }); for (const [v, cx] of cols) say(doc, v, cx, yy + 6, { width: 80, align: 'right', size: 8.5, bold: true }); };
  total(L, lw, end, 'Total earnings', [...(daily ? [] : [[amt(i.full.gross), L + lw - 170]]), [amt(grossOf(i)), L + lw - 86]]);
  total(rx, rw, end, 'Total deductions', [[amt(i.ded.total), rx + rw - 86]]);
  y = end + 34; void top;

  // Net pay, in figures and in words.
  doc.rect(L, y, 3, 40).fill(GOLD);
  say(doc, 'NET PAY', L + 12, y + 4, { size: 7.5, bold: true, color: GOLD });
  doc.font('b').fontSize(9).fillColor(INK).text(inWords(i.net), L + 12, y + 17, { width: 330 });
  say(doc, amt(i.net), R - 200, y + 12, { width: 200, align: 'right', size: 16, bold: true });
  y += 54;
  if (i.employer?.pf || i.employer?.esi) { say(doc, `Paid by the ${emp ? 'employer' : 'company'} on top of the salary (not part of take-home): PF ${amt(i.employer.pf)}${i.employer.esi ? ` · ESI ${amt(i.employer.esi)}` : ''}.`, L, y, { size: 8, color: SOFT }); y += 16; }
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke(); y += 6;
  doc.font('r').fontSize(7.5).fillColor('#6b5c3c').text(`${run.paidOn ? `Paid on ${day(run.paidOn)}. ` : ''}${emp ? `This is a computer-generated payslip, prepared for ${emp.name || 'the employer'} by Aali Conssultancy, and needs no signature.` : 'This is a computer-generated payslip from Aali One and needs no signature.'}`, L, y, { width: W });
}

// One person's payslip as a PDF file (a Buffer).
export function payslipPdf(run, i, biz) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Payslip ${monthLabel(run.month)} – ${i.name}`, Author: 'Aali One' } }), out = [];
    const f = fonts(); doc.registerFont('r', f.r); doc.registerFont('b', f.b); doc.registerFont('rx', f.rx); doc.registerFont('bx', f.bx);
    doc.on('data', (c) => out.push(c)); doc.on('end', () => resolve(Buffer.concat(out))); doc.on('error', reject);
    page(doc, run, i, biz); doc.end();
  });
}
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Payslip';
export const slipName = (run, i) => `${safe(i.name)}${i.code ? ' ' + safe(i.code) : ''} - Payslip ${monthLabel(run.month)}.pdf`;

// Every payslip of a month, each its own PDF, in one ZIP.
export async function payslipsZip(run, items, biz) {
  const zip = new JSZip(), used = new Set();
  for (const i of items) {
    let name = slipName(run, i); for (let n = 2; used.has(name.toLowerCase()); n++) name = slipName(run, i).replace(/\.pdf$/, ` (${n}).pdf`);
    used.add(name.toLowerCase()); zip.file(name, await payslipPdf(run, i, biz));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
