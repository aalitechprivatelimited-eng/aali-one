// Reads an Excel (.xlsx) file, or a CSV file, into rows of text cells.
// Small on purpose (no library): an .xlsx file is a zip of XML files, and the browser can unzip it by itself.
const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const inflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
async function unzip(buf) {
  const b = new Uint8Array(buf), files = {}; let e = b.length - 22;
  while (e >= 0 && u32(b, e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not an Excel file.');
  let p = u32(b, e + 16);
  for (let i = 0, n = u16(b, e + 10); i < n && u32(b, p) === 0x02014b50; i++) {
    const nameLen = u16(b, p + 28), at = u32(b, p + 42), start = at + 30 + u16(b, at + 26) + u16(b, at + 28);
    files[new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen))] = { stored: u16(b, p + 10) === 0, data: b.subarray(start, start + u32(b, p + 20)) };
    p += 46 + nameLen + u16(b, p + 30) + u16(b, p + 32);
  }
  return { names: Object.keys(files), text: async (name) => { const f = files[name]; return f ? new TextDecoder().decode(f.stored ? f.data : await inflate(f.data)) : ''; } };
}
// Every sheet of the workbook, in the order of its tabs: [{ name, rows }].
async function xlsxSheets(file) {
  const zip = await unzip(await file.arrayBuffer()), xml = (t) => new DOMParser().parseFromString(t, 'application/xml'), tags = (el, n) => [...el.getElementsByTagName(n)];
  const sst = await zip.text('xl/sharedStrings.xml'), strings = sst ? tags(xml(sst), 'si').map((si) => tags(si, 't').map((t) => t.textContent).join('')) : [];
  const rels = Object.fromEntries(tags(xml(await zip.text('xl/_rels/workbook.xml.rels')), 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target').replace(/^\/?(xl\/)?/, 'xl/')]));
  let list = tags(xml(await zip.text('xl/workbook.xml')), 'sheet').map((x) => ({ name: x.getAttribute('name'), path: rels[x.getAttribute('r:id')] })).filter((x) => zip.names.includes(x.path));
  if (!list.length) list = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((x, y) => x.length - y.length || x.localeCompare(y)).map((path, i) => ({ name: 'Sheet ' + (i + 1), path }));
  if (!list.length) throw new Error('No sheet was found in this Excel file.');
  const read = async (path) => tags(xml(await zip.text(path)), 'row').map((row) => { const cells = [];
    for (const c of tags(row, 'c')) { const col = [...(c.getAttribute('r') || '').replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1, t = c.getAttribute('t'), v = tags(c, 'v')[0]?.textContent ?? '';
      // a phone number typed as a number can be stored as 9.87654321E9 – write it out in full
      const text = t === 's' ? strings[+v] ?? '' : t === 'inlineStr' ? tags(c, 't').map((x) => x.textContent).join('') : !t && v !== '' && !isNaN(v) ? String(Number(v)) : v;
      cells[col < 0 ? cells.length : col] = String(text).trim(); }
    return [...cells].map((x) => x || ''); });
  const out = []; for (const x of list) out.push({ name: x.name, rows: await read(x.path) });
  return out;
}
const csvRows = (text) => text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => (l.includes('\t') ? l.split('\t') : l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))).map((c) => c.trim()));

// ---------- writing: a small Excel file (the calling-list template) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
// [[name, text]] → a zip. The files are kept as they are (not squeezed): they are tiny.
function zip(files) {
  const enc = new TextEncoder(), parts = [], dir = []; let at = 0;
  for (const [name, text] of files) { const n = enc.encode(name), d = enc.encode(text), sum = crc(d), h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true); h.setUint32(14, sum, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true); c.setUint32(16, sum, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true); c.setUint32(42, at, true);
    parts.push(h, n, d); dir.push(c, n); at += 30 + n.length + d.length; }
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, dir.reduce((s, x) => s + x.byteLength, 0), true); e.setUint32(16, at, true);
  return new Blob([...parts, ...dir, e], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', PKG = 'http://schemas.openxmlformats.org/package/2006', TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
// The looks a cell can have: 0 plain · 1 heading (white on gold) · 2 kept as text, so 0863… keeps its zero · 3 bold · 4 grey (an example)
const STYLES = `${XML}<styleSheet xmlns="${MAIN}"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF8A8170"/><name val="Calibri"/></font></fonts>`
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB87400"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>';
// sheets: [{ name, widths, rows, picks }] → an .xlsx file. A cell is text, or [text, look]. Row 1 stays in view while scrolling.
// widths: one per column, a number or [width, look for the empty cells]. picks: what a cell offers when it is selected –
// { at: 'D2:D401', list: "'Other sheet'!$A$2:$A$9" } for a drop-down list, { at, title, hint } for a note.
export function xlsxBlob(sheets) {
  const cell = (v, r, c) => { const [text, look] = Array.isArray(v) ? v : [v, 0]; return text === '' || text == null ? '' : `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"${look ? ` s="${look}"` : ''}><is><t xml:space="preserve">${esc(text)}</t></is></c>`; };
  const sheet = (s) => `${XML}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${s.widths.map((w, i) => { const [width, look] = Array.isArray(w) ? w : [w, 0]; return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"${look ? ` style="${look}"` : ''}/>`; }).join('')}</cols>`
    + `<sheetData>${s.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData>`
    + (s.picks?.length ? `<dataValidations count="${s.picks.length}">${s.picks.map((p) => `<dataValidation${p.list ? ' type="list"' : ''} allowBlank="1" showInputMessage="1" sqref="${p.at}"${p.title ? ` promptTitle="${esc(p.title)}"` : ''}${p.hint ? ` prompt="${esc(p.hint)}"` : ''}>${p.list ? `<formula1>${esc(p.list)}</formula1>` : ''}</dataValidation>`).join('')}</dataValidations>` : '')
    + '</worksheet>';
  return zip([
    ['[Content_Types].xml', `${XML}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${TYPE}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${TYPE}.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${TYPE}.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${DOC}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PKG}/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${DOC}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${DOC}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES], ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet(s)]),
  ]);
}

// → [{ name, rows }]: one entry per sheet (a CSV file has one).
export async function readSheets(file) {
  if (/\.xlsx$/i.test(file.name)) { try { return await xlsxSheets(file); } catch (e) { throw new Error('This Excel file could not be read. Copy the rows in Excel and paste them here instead.'); } }
  if (/\.xls$/i.test(file.name)) throw new Error('This is an old Excel format (.xls). Save it as .xlsx, or copy the rows and paste them here.');
  return [{ name: file.name, rows: csvRows(await file.text()) }];
}
