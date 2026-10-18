// The ledger view (the user, 18 Oct 2026: "show me receipts and invoices like a ledger" – the old account books of the American frontier).
// The same rows as the table, written into a book: aged paper, ruled lines, a red margin, entries in pen, a page per month with its
// total ruled off. An original look, drawn with CSS only – no pictures.
import '@fontsource/im-fell-english/400.css'; import '@fontsource/im-fell-english/400-italic.css'; import '@fontsource/caveat/500.css'; import '@fontsource/caveat/700.css';
import { useNavigate } from 'react-router-dom';
import { settings } from './lib.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const amt = (n, usd) => (n ? (usd ? '$' : '') + (+n).toLocaleString(usd ? 'en-US' : 'en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const day = (iso) => String(+String(iso).slice(8, 10)).padStart(2, ' ');
// Newest month first, oldest entry first inside a month – as a book is read.
function byMonth(rows) {
  const m = new Map(); for (const r of rows) { const k = String(r.date).slice(0, 7); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, xs]) => [k, xs.sort((a, b) => (a.date + (a.number || '')).localeCompare(b.date + (b.number || '')))]);
}
const title = (k) => `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;

function Book({ heading, sub, children }) {
  return <div className="ledger" role="region" aria-label={heading}>
    <div className="ledger-head"><span className="ledger-co">{settings().business.name}</span><h2>{heading}</h2><span className="ledger-sub">{sub}</span><Flourish /></div>
    {children}
  </div>;
}
const Flourish = () => <svg className="ledger-flourish" viewBox="0 0 240 14" aria-hidden="true"><path d="M2 7 C40 7 60 1 90 6 S 112 13 120 7 S 150 1 160 6 S 200 7 238 7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><circle cx="120" cy="7" r="2.2" fill="currentColor" /></svg>;

// Receipts: money received, by month. A part payment carries a red stamp, a cheque not yet cleared is pencilled, a refund struck through.
export function ReceiptLedger({ rows, owing }) {
  const nav = useNavigate(), months = byMonth(rows);
  if (!months.length) return <Book heading="Ledger of Receipts" sub="No entries"><p className="ledger-empty">Nothing written in this book yet.</p></Book>;
  return <Book heading="Ledger of Receipts" sub={`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · ${title(months[months.length - 1][0])} – ${title(months[0][0])}`}>
    {months.map(([k, xs]) => { const counted = xs.filter((r) => r.currency !== 'USD' && !['pending', 'refunded'].includes(r.status));
      const got = counted.reduce((s, r) => s + (r.totals?.received || 0), 0), due = xs.filter((r) => r.currency !== 'USD').reduce((s, r) => s + owing(r), 0);
      return <section className="ledger-page" key={k}><h3 className="ledger-month">{title(k)}</h3>
        <table className="ledger-table"><thead><tr><th className="d">Date</th><th className="no">Folio</th><th>Received of, for</th><th className="md">By</th><th className="n">Received</th><th className="n">Owing</th></tr></thead>
          <tbody>{xs.map((r) => { const st = r.status || (r.totals?.balance > 0 ? 'partial' : 'received'), usd = r.currency === 'USD', o = owing(r);
            const what = r.forText || (r.items || []).map((x) => x.desc).filter(Boolean).join(', ');
            return <tr key={r.id} className={'ink st-' + st} tabIndex={0} onClick={() => nav('/payments/receipt/' + r.id)} onKeyDown={(e) => e.key === 'Enter' && nav('/payments/receipt/' + r.id)}>
              <td className="d">{day(r.date)}</td><td className="no">{r.number}</td>
              <td><span className="who">{r.payerName}</span>{what && <span className="for"> – {what}</span>}{r.settlesNo && <span className="for"> (against {r.settlesNo})</span>}
                {st === 'partial' && <span className="stamp">Part paid</span>}{st === 'pending' && <span className="pencil">awaiting clearance</span>}{st === 'refunded' && <span className="stamp red">Refunded</span>}</td>
              <td className="md">{r.mode}</td><td className="n">{amt(r.totals?.received, usd)}</td><td className="n">{o ? amt(o, usd) : (r.totals?.balance > 0 ? <span className="settled">settled</span> : '')}</td></tr>; })}</tbody>
          <tfoot><tr><td colSpan={4} className="tot-l">Received in {MONTHS[+k.slice(5, 7) - 1]}</td><td className="n tot">{amt(got)}</td><td className="n tot">{due ? amt(due) : '—'}</td></tr></tfoot></table>
      </section>; })}
  </Book>;
}

// Tax invoices: what was billed, by month, B2B and B2C.
export function InvoiceLedger({ rows, kindOf }) {
  const nav = useNavigate(), months = byMonth(rows), tax = (r) => (r.totals?.cgst || 0) + (r.totals?.sgst || 0) + (r.totals?.igst || 0);
  if (!months.length) return <Book heading="Ledger of Tax Invoices" sub="No entries"><p className="ledger-empty">Nothing written in this book yet.</p></Book>;
  return <Book heading="Ledger of Tax Invoices" sub={`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · ${title(months[months.length - 1][0])} – ${title(months[0][0])}`}>
    {months.map(([k, xs]) => <section className="ledger-page" key={k}><h3 className="ledger-month">{title(k)}</h3>
      <table className="ledger-table"><thead><tr><th className="d">Date</th><th className="no">Folio</th><th>Billed to</th><th className="md">Kind</th><th className="n">Taxable</th><th className="n">GST</th><th className="n">Total</th></tr></thead>
        <tbody>{xs.map((r) => <tr key={r.id} className="ink" tabIndex={0} onClick={() => nav('/invoices/' + r.id)} onKeyDown={(e) => e.key === 'Enter' && nav('/invoices/' + r.id)}>
          <td className="d">{day(r.date)}</td><td className="no">{r.number}</td><td><span className="who">{r.clientName}</span>{r.gstin && <span className="for"> – GSTIN {r.gstin}</span>}</td>
          <td className="md">{kindOf(r).toUpperCase()}</td><td className="n">{amt(r.totals?.taxable)}</td><td className="n">{amt(tax(r))}</td><td className="n">{amt(r.totals?.total)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4} className="tot-l">Billed in {MONTHS[+k.slice(5, 7) - 1]}</td><td className="n tot">{amt(xs.reduce((s, r) => s + (r.totals?.taxable || 0), 0))}</td>
          <td className="n tot">{amt(xs.reduce((s, r) => s + tax(r), 0))}</td><td className="n tot">{amt(xs.reduce((s, r) => s + (r.totals?.total || 0), 0))}</td></tr></tfoot></table>
    </section>)}
  </Book>;
}

// Table or ledger: the choice is remembered on this device.
export const viewKey = 'aali-ledger-view';
export const readView = () => { try { return localStorage.getItem(viewKey) === 'ledger' ? 'ledger' : 'table'; } catch { return 'table'; } };
export const saveView = (v) => { try { localStorage.setItem(viewKey, v); } catch { /* not remembered */ } };
