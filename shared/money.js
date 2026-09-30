// Money maths shared by the browser and the server, so a total is never computed two ways.
export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function fyLabel(iso) {
  const d = iso ? new Date(iso + 'T00:00:00') : new Date();
  const y = d.getFullYear(), start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
export const dayLabel = (iso) => { const [y, m, d] = iso.split('-'); return `${d}${m}${y.slice(2)}`; };

// Quotation / invoice: qty × rate lines, discount, GST on top, optional round-off.
export function docTotals(q) {
  const subtotal = (q.items || []).reduce((a, it) => a + num(it.qty) * num(it.rate), 0);
  const dv = num(q.discountValue);
  let discount = q.discountType === 'percent' ? subtotal * dv / 100 : q.discountType === 'flat' ? dv : 0;
  if (discount > subtotal) discount = subtotal;
  const taxable = subtotal - discount, rate = num(q.taxRate ?? 18);
  const taxed = q.taxMode === 'intra' || q.taxMode === 'inter';
  const tax = taxed ? taxable * rate / 100 : 0;
  const cgst = q.taxMode === 'intra' ? round2(tax / 2) : 0;
  const sgst = q.taxMode === 'intra' ? round2(round2(tax) - cgst) : 0;
  const igst = q.taxMode === 'inter' ? round2(tax) : 0;
  const gross = taxable + tax, roundOff = q.roundOff === false ? 0 : Math.round(gross) - gross;
  const discountPct = subtotal ? discount / subtotal * 100 : 0;
  return { subtotal: round2(subtotal), discount: round2(discount), discountPct: round2(discountPct), taxable: round2(taxable),
    tax: round2(tax), cgst, sgst, igst, roundOff: round2(roundOff), total: round2(gross + roundOff), rate };
}

// Receipt: each line is either before GST, or a GST-inclusive round figure (incl) with tax divided out.
export function receiptTotals(r) {
  const rate = num(r.taxRate ?? 18), taxed = r.taxMode === 'intra' || r.taxMode === 'inter', f = 1 + rate / 100;
  const parts = (r.items || []).map((it) => {
    if (it.incl && taxed) { const gross = round2(num(it.amount)), taxable = round2(gross / f); return { taxable, tax: gross - taxable }; }
    const taxable = num(it.amount); return { taxable, tax: taxed ? taxable * rate / 100 : 0 };
  });
  const subtotal = parts.reduce((a, p) => a + p.taxable, 0), tax = parts.reduce((a, p) => a + p.tax, 0);
  const cgst = r.taxMode === 'intra' ? round2(tax / 2) : 0;
  const sgst = r.taxMode === 'intra' ? round2(round2(tax) - cgst) : 0;
  const igst = r.taxMode === 'inter' ? round2(tax) : 0;
  const total = round2(subtotal + tax), balance = round2(num(r.balance));
  return { subtotal: round2(subtotal), tax: round2(tax), cgst, sgst, igst, total, balance, received: round2(Math.max(0, total - balance)), rate };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
const three = (n) => { const h = Math.floor(n / 100), r = n % 100; return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : ''); };
export function inWords(amount) {
  let n = Math.floor(Math.abs(amount)); const paise = Math.round((Math.abs(amount) - n) * 100);
  if (!n && !paise) return 'Rupees Zero Only';
  let out = '';
  const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) out += three(cr) + ' Crore '; if (lk) out += three(lk) + ' Lakh '; if (th) out += three(th) + ' Thousand '; if (n) out += three(n);
  out = 'Rupees ' + out.trim();
  if (paise) out += ' and ' + two(paise) + ' Paise';
  return out + ' Only';
}
export const inr = (v) => '₹' + Math.round(num(v)).toLocaleString('en-IN');
export const inr2 = (v) => '₹' + num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const mobile10 = (m) => String(m || '').replace(/\D/g, '').slice(-10);
