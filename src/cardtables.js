// On a phone, a wide table marked .tbl.cards shows one card per row (styles.css), each value under its column's name – instead of a
// table cut off at the screen's edge that has to be scrolled sideways. Each cell is given its heading as data-label, here, whenever the
// page changes, so no table needs to repeat its headings by hand.
let queued = false;
function label() {
  queued = false;
  for (const t of document.querySelectorAll('.tbl.cards table')) {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { const h = heads[i] || ''; if (td.dataset.label !== h) td.dataset.label = h; });
  }
}
export function watchCardTables() {
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(label); } });
  mo.observe(document.body, { childList: true, subtree: true }); label();
}
