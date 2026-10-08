// Call register: every number the sales team has kept or called, who holds it, how it answered, and the Do Not Call list.
// The rule behind it (server/prospects.js): one business, one caller – and nobody keeps ringing a business that said no.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore, store, list, create, update, http, poll } from '../api.js';
import { uname, fmtDate, fmtDT, settings, canEdit, scope, addDays, today, mobile10 } from '../lib.js';
import { Seg, Pill, Empty, Field, In, Sel, Area, Modal, Person, Log, Stat, usePaged, attempt, toast, ViewOnly, TeamFilter, byTeam } from '../ui.jsx';
import { readSheets, xlsxBlob } from '../xlsx.js';

const STATE = { open: ['Open', 'ok'], tired: ['Stopped – no answer', 'warn'], closed: ['Stopped – said no', 'warn'], dnc: ['Do not call', 'bad'] };
// Until when a number stays with its BDE: holdDays after the last call; a number kept but never called, emptyHoldDays.
const holdEnd = (p, cfg) => { const from = (p.lastAt || p.since || '').slice(0, 10); return from ? addDays(from, p.tries ? cfg.holdDays : cfg.emptyHoldDays) : ''; };

export default function Calls() {
  useStore(); const me = store.me, own = scope('calls') === 'own', edit = canEdit('calls'), mgr = edit && !own, cfg = settings().calling;
  const loc = useLocation(), from = loc.state?.q || ''; // arriving from Search: the register opens on that business
  useEffect(() => { if (from) setF({ q: from, state: '', owner: '', company: '' }); }, [loc.key]);
  const [f, setF] = useState({ q: from, state: '', owner: '', company: '' }), [open, setOpen] = useState(null), [dnc, setDnc] = useState(null), [chk, setChk] = useState(null);
  const all = list('prospect'), q = f.q.trim().toLowerCase();
  const rows = all.filter((p) => (!f.state || (f.state === 'stopped' ? ['tired', 'closed'].includes(p.state) : f.state === 'new' ? p.state === 'open' && !p.tries : p.state === f.state)) && byTeam(p.owner, f)
    && (!q || `${p.name} ${p.phone} ${p.phone10} ${p.place} ${p.ind}`.toLowerCase().includes(q))).sort((a, b) => (b.lastAt || b.since || '').localeCompare(a.lastAt || a.since || ''));
  const n = (fn) => all.filter(fn).length, cur = open && all.find((p) => p.id === open);
  const [shown, pager] = usePaged(rows, 25, JSON.stringify(f)); // a long register is read 25 businesses at a time
  return <>
    <div className="topbar"><h1>{own ? 'My call register' : 'Call register'} <small>{rows.length} {rows.length === 1 ? 'business' : 'businesses'}</small> <ViewOnly when={!edit} /></h1>
      <div className="row">{edit && me.team === 'sales' && <button className="btn primary" type="button" onClick={() => setChk({ text: '', res: null })}>Upload my calling list</button>}
        {mgr && <button className="btn" type="button" onClick={() => setDnc({ phone: '', name: '', place: '', reason: '' })}>+ Do Not Call number</button>}
        {me.isAdmin && <button className="btn" type="button" onClick={() => attempt(async () => { const r = await http('POST', '/prospects/rebuild'); await poll(); toast(`Past call sheets read: ${r.rows} calls.`); })}>Bring in past call sheets</button>}</div></div>
    <div className="banner info" style={{ marginBottom: 12 }}><b>One business, one caller.</b> {me.team === 'sales' ? 'Check a number here or on your call sheet before you call it.' : 'Every BDE checks a number before calling it.'} The first person to check it keeps it for {cfg.holdDays} days after the last call.
      After {cfg.maxTries} calls in a row with no answer, or a “Not interested”, everyone must stop. A number on the Do Not Call list is never called.</div>
    <div className="stats">
      <Stat icon="clients" label={own ? 'My businesses' : 'Businesses in the register'} value={n((p) => p.state === 'open')} sub={`${n((p) => p.state === 'open' && !p.tries)} kept, not called yet`} />
      <Stat icon="calls" label="Calls made" value={all.reduce((s, p) => s + (p.tries || 0), 0)} />
      <Stat icon="clock" label="Stopped" value={n((p) => ['tired', 'closed'].includes(p.state))} tone={n((p) => ['tired', 'closed'].includes(p.state)) ? 'warm' : ''} sub={`no answer ${cfg.maxTries} times, or said no`} />
      <Stat icon="stop" label="Do not call" value={n((p) => p.state === 'dnc')} tone={n((p) => p.state === 'dnc') ? 'hot' : ''} />
    </div>
    <div className="row" style={{ marginBottom: 12 }}><In placeholder="Search name, number, place, industry" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ maxWidth: 280 }} />
      <Seg value={f.state} onChange={(v) => setF({ ...f, state: v })} options={[['', 'All'], ['open', 'Open'], ['new', 'Not called yet'], ['stopped', 'Stopped'], ['dnc', 'Do not call']]} />
      {!own && <TeamFilter value={f} onChange={(v) => setF({ ...f, ...v })} />}</div>
    {rows.length ? <><div className="tbl cards"><table><thead><tr><th>Business</th><th>Number</th><th>Held by</th><th className="n">Calls</th><th>Last call</th><th>Status</th><th /></tr></thead><tbody>
      {shown.map((p) => { const [l0, k] = STATE[p.state] || STATE.open, l = p.closed?.why === 'Wrong number' ? 'Stopped – wrong number' : l0, end = holdEnd(p, cfg), over = p.state === 'open' && !p.leadId && end && end < today();
        return <tr key={p.id} className="click" onClick={() => setOpen(p.id)}>
          <td><b>{p.name || 'No name yet'}</b><div className="small muted">{[p.place, p.ind, p.src && 'from ' + p.src].filter(Boolean).join(' · ') || '—'}</div></td><td className="num">{p.phone}</td>
          <td>{p.owner ? uname(p.owner) : '—'}{p.state === 'open' && p.owner && <div className="small muted">{p.leadId ? 'has a lead' : over ? 'hold ended – free to take' : `till ${fmtDate(end)}`}</div>}</td>
          <td className="n">{p.tries || 0}</td><td>{p.lastAt ? <>{fmtDate(p.lastAt.slice(0, 10))}<div className="small muted">{p.lastResp || 'no response written'}</div></> : <span className="muted">Not called yet</span>}</td>
          <td><Pill k={k}>{l}</Pill>{p.state === 'open' && p.noTries > 0 && <div className="small muted">{p.noTries} of {cfg.maxTries} unanswered</div>}</td><td className="small muted">Open ›</td></tr>; })}</tbody></table></div>{pager}</>
      : <Empty>{all.length ? 'Nothing matches.' : 'No numbers yet. They appear here as soon as someone checks a number or writes a call on their call sheet.'}</Empty>}
    {cur && <Detail p={cur} cfg={cfg} mgr={mgr} mine={edit && (mgr || cur.owner === me.id)} onClose={() => setOpen(null)} />}
    {dnc && <Modal title="Add a number to the Do Not Call list" onClose={() => setDnc(null)} footer={<><button className="btn" type="button" onClick={() => setDnc(null)}>Cancel</button>
      <button className="btn danger" type="button" disabled={mobile10(dnc.phone).length !== 10 || dnc.reason.trim().length < 3} onClick={async () => (await attempt(() => create('prospect', dnc), 'Added. Nobody can call or log this number now.')) && setDnc(null)}>Add to Do Not Call</button></>}>
      <div className="form"><Field label="Number *" hint="10 digits; add the STD code for a landline."><In value={dnc.phone} inputMode="tel" onChange={(e) => setDnc({ ...dnc, phone: e.target.value })} autoFocus /></Field>
        <Field label="Business / person"><In value={dnc.name} onChange={(e) => setDnc({ ...dnc, name: e.target.value })} /></Field>
        <Field label="Place"><In value={dnc.place} onChange={(e) => setDnc({ ...dnc, place: e.target.value })} /></Field>
        <Field label="Why must it not be called? *" full><In value={dnc.reason} onChange={(e) => setDnc({ ...dnc, reason: e.target.value })} placeholder="e.g. Complained about repeated calls" /></Field></div></Modal>}
    {chk && <Check chk={chk} setChk={setChk} />}
  </>;
}

// Rows of cells (read from an Excel or CSV file, or pasted) → businesses to check. The phone number is found in each row;
// the name is the cell before it, the place a cell after it, and the industry is picked up when a cell matches the list in Settings.
// The template's own "(Example)" rows are never read as businesses.
function parseList(rows) {
  const inds = settings().industries || [], hit = (x) => inds.findIndex((n) => n.toLowerCase() === x.toLowerCase() || n.toLowerCase().split(' / ').includes(x.toLowerCase()));
  return rows.map((raw) => { const c = raw.map((x) => String(x || '').trim()), i = c.findIndex((x) => x.replace(/\D/g, '').length >= 10 && !/[a-z]{3}/i.test(x)); if (i < 0) return null;
    const word = (x) => x && !/^\d{1,4}$/.test(x), org = word(c[i - 1]) ? c[i - 1] : c.find((x, j) => j !== i && word(x)) || '', after = c.slice(i + 1), k = after.find((x) => x && hit(x) >= 0);
    const srcs = settings().listSources || [], from = after.find((x) => x && srcs.some((n) => n.toLowerCase() === x.toLowerCase()));
    return { phone: c[i], org, place: after[0] && after[0] !== k && after[0] !== from ? after[0] : '', ind: k ? inds[hit(k)] : '', src: from ? srcs.find((n) => n.toLowerCase() === from.toLowerCase()) : '' }; }).filter((x) => x && !/^\(example\)/i.test(x.org));
}
// What a calling list holds: [heading, needed or helpful, what goes in it]. The same five columns are shown in the upload window
// and written into the Excel template, so a caller sees what Aali One accepts before filling anything in.
const MAX = 400;
const COLS = [['Business name', 'Needed', 'The shop, clinic, school… you will call'], ['Contact number', 'Needed', '10-digit mobile, or a landline with its STD code'], ['Place', 'Helpful', 'Town or area'], ['Industry', 'Helpful', 'Chosen from a list'], ['Source', 'Helpful', 'Where you found it']];
const HOW = ['One business in one row. Keep the headings in row 1 as they are.',
  'Business name and Contact number are needed. Place, Industry and Source are helpful, and can be left empty.',
  'Contact number: a 10-digit mobile (like 9876543210), or a landline with its STD code (like 0863 2234567). +91 in front, spaces and dashes are all fine.',
  'Only one number in a cell. If a business has two numbers, write the second one in a new row.',
  'Industry and Source: click the cell and choose from the little arrow. The choices are in columns A and B of this sheet. An industry that is not in the list is left out.',
  'If Source is left empty, Aali One asks you once where the whole list came from.',
  `Up to ${MAX} businesses in one upload. If you have more, upload a second file.`,
  'The rows that start with (Example) only show you how. Leave them or delete them: they are never uploaded.',
  'Save the file as Excel (.xlsx), then choose it in Aali One: Daily reports › My calls › Upload my list.',
  'Every number is checked. A number another caller already holds, a number that was stopped, or one on the Do Not Call list is refused – and you are told why.'];
function template() {
  const inds = settings().industries || [], srcs = settings().listSources || [], end = MAX + 1, has = (x) => (inds.includes(x) ? x : inds[0] || '');
  const eg = [['(Example) Sri Sai Medicals', '9876543210', 'Guntur', has('Pharmacy'), srcs[0] || ''], ['(Example) Lotus Clinic', '0863 2234567', 'Brodipet', has('Hospital / clinic'), srcs[1] || '']];
  const blob = xlsxBlob([
    { name: 'My calling list', widths: [[38, 2], [22, 2], [20, 2], [26, 2], [20, 2]], rows: [COLS.map((c) => [c[0], 1]), ...eg.map((r) => r.map((x) => [x, 4]))],
      picks: [{ at: `A2:A${end}`, title: 'Business name', hint: 'Needed. One business in one row.' }, { at: `B2:B${end}`, title: 'Contact number', hint: 'Needed. A 10-digit mobile, or a landline with its STD code. Only one number in a cell.' },
        ...(inds.length ? [{ at: `D2:D${end}`, list: `'What to fill'!$A$2:$A$${inds.length + 1}`, title: 'Industry', hint: 'Choose from the little arrow.' }] : []),
        ...(srcs.length ? [{ at: `E2:E${end}`, list: `'What to fill'!$B$2:$B$${srcs.length + 1}`, title: 'Source', hint: 'Where you found this business. Choose from the little arrow.' }] : [])] },
    { name: 'What to fill', widths: [28, 22, 3, 130], rows: [[['Industry – choose one', 1], ['Source – choose one', 1], '', ['How to fill “My calling list”', 1]],
      ...Array.from({ length: Math.max(inds.length, srcs.length, HOW.length) }, (_, i) => [inds[i] || '', srcs[i] || '', '', HOW[i] ? `${i + 1}. ${HOW[i]}` : ''])] },
  ]);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Aali-One-calling-list-template.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// A row that does not look like a business – a web link, opening hours, or a name with hardly any letters. This happens when a list is
// copied from Google Maps with its columns out of place. Such rows start unticked, so they are not kept unless the person ticks them.
const odd = (x) => (/https?:|www\.|^[^\p{L}\p{N}]|\b\d{1,2}(:\d\d)?\s?(am|pm)\b|^(open|opens|closes?|closed)\b/iu.test(x.org) || x.org.replace(/[^\p{L}]/gu, '').length < 3 ? 'The name does not look like a business'
  : /https?:|www\./i.test(x.place) ? 'The place is a web link' : '');
const newId = () => Math.random().toString(36).slice(2, 12);
// My lists of the last 7 days, newest first: [{ id, at, src, all, open }] – open: the businesses not called yet, which can still be deleted.
// Lists kept before lists were named are grouped by the minute they were kept.
function myLists() {
  const me = store.me.id, from = new Date(Date.now() - 7 * 864e5).toISOString(), g = new Map();
  for (const p of list('prospect')) {
    if (p.owner !== me || p.leadId || p.dnc) continue;
    const at = p.batch?.at || p.since || '', legacy = !p.batch && (p.log || []).at(-1)?.text === 'Kept before calling'; if (at < from || (!p.batch && !legacy)) continue;
    const id = p.batch?.id || 'm' + at.slice(0, 16), x = g.get(id) || { id, at, src: p.batch?.src || p.src || '', all: [], open: [], legacy };
    x.all.push(p); if (!p.tries && !p.closed) x.open.push(p); g.set(id, x);
  }
  return [...g.values()].filter((x) => !x.legacy || x.all.length >= 3).sort((a, b) => b.at.localeCompare(a.at));
}
function MyLists() {
  const [ask, setAsk] = useState(null), [busy, setBusy] = useState(false), lists = myLists();
  if (!lists.length) return null;
  async function drop(x) { setBusy(true); const r = await attempt(() => http('POST', '/prospects/drop', { ids: x.open.map((p) => p.id) })); setBusy(false);
    if (r) { toast(`List deleted: ${r.deleted} business${r.deleted === 1 ? '' : 'es'} removed${r.kept ? `; ${r.kept} already called stay` : ''}.`); setAsk(null); poll(); } }
  return <div className="stack gap4"><span className="small" style={{ fontWeight: 600 }}>Your lists of the last 7 days</span>
    <div className="list">{lists.map((x) => <div key={x.id} className="li">
      <div className="grow"><div className="t">{fmtDT(x.at)}{x.src ? ' · ' + x.src : ''}</div><div className="small muted">{x.all.length} business{x.all.length === 1 ? '' : 'es'} · {x.open.length} not called yet</div></div>
      {ask === x.id ? <div className="row"><span className="small">Delete the {x.open.length} not called yet?{x.all.length > x.open.length ? ` The ${x.all.length - x.open.length} already called stay.` : ''}</span>
        <button className="btn sm" type="button" onClick={() => setAsk(null)}>No</button><button className="btn sm danger" type="button" disabled={busy} onClick={() => drop(x)}>Yes, delete</button></div>
        : <button className="btn sm" type="button" disabled={!x.open.length} title={x.open.length ? '' : 'Every business in this list has been called'} onClick={() => setAsk(x.id)}>Delete this list</button>}
    </div>)}</div>
    <span className="small muted">Kept a wrong list by mistake? Delete it here. Only the businesses you have not called yet are removed.</span></div>;
}

// Upload or paste a list gathered from Google Maps or social media. Every row is shown first, as it was read, so a mistake is seen before
// anything is kept; the person then confirms. Every number is checked, and the free ones are kept for them as one list that can be deleted again.
// onCalls(text): the file turns out to be calls already made (it has responses) – put them on today's call sheet instead.
export function Check({ chk, setChk, onCalls }) {
  const [busy, setBusy] = useState(false), [sheets, setSheets] = useState([]), [at, setAt] = useState(0), [src, setSrc] = useState(''); // src: where this list came from, when the sheet does not say
  const [off, setOff] = useState(null), [sure, setSure] = useState(false), [batch, setBatch] = useState(''); // off: rows left out (null = the rows that look wrong)
  const show = (list, i) => { setAt(i); setOff(null); setSure(false); setChk({ text: list[i].rows.map((r) => r.join('\t')).join('\n'), res: null }); };
  const read = parseList(chk.text.split(/\r?\n/).map((l) => (l.includes('\t') ? l.split('\t') : l.split(',')))).slice(0, MAX).map((x) => ({ ...x, why: odd(x) }));
  const skip = off || new Set(read.flatMap((x, i) => (x.why ? [i] : []))), items = read.filter((_, i) => !skip.has(i)).map(({ why, ...x }) => ({ ...x, src: x.src || src }));
  const needSrc = items.some((x) => !x.src), noPlace = items.filter((x) => !x.place).length, wrong = read.filter((x) => x.why).length;
  const tick = (i) => { const n = new Set(skip); n.has(i) ? n.delete(i) : n.add(i); setOff(n); setSure(false); };
  async function run() { setBusy(true); const id = newId(); const r = await attempt(() => http('POST', '/prospects/check', { items, claim: true, batch: id, src: items[0]?.src || '' })); setBusy(false);
    if (r) { setBatch(id); setSure(false); setChk({ ...chk, res: r.results.map((v, i) => ({ ...v, item: items[i] })) }); poll(); } }
  // Only the sheets that hold numbers are offered (the template's "What to fill" sheet is not a list); with no numbers anywhere, the first sheet is shown.
  async function pick(e) { const file = e.target.files[0]; e.target.value = ''; if (!file) return; const all = await attempt(() => readSheets(file)); if (!all) return;
    const list = all.filter((x) => parseList(x.rows).length), use = list.length ? list : all.slice(0, 1); setSheets(use); show(use, 0); }
  const ok = (chk.res || []).filter((v) => v.ok), no = (chk.res || []).filter((v) => !v.ok);
  // A call sheet (calls already made, with what each business said) uploaded here would only keep the numbers – say so before anything is kept.
  const lines = chk.text.split(/\r?\n/).slice(0, 400), saidCells = lines.join('\t').match(/\b(not interested|interested|call ?back|no answer|not reachable|switch(ed)? off|busy|wrong number|ringing)\b/gi) || [];
  const callSheet = !chk.res && (/\b(response|feedback|outcome)\b/i.test(lines.slice(0, 3).join(' ')) || saidCells.length >= 3);
  const footer = chk.res ? <><span className="small muted">Kept for you: {ok.length} · Not allowed: {no.length}</span><button className="btn" type="button" onClick={() => setChk(null)}>Close</button></>
    : sure ? <><span className="small"><b>Keep {items.length} business{items.length === 1 ? '' : 'es'} for you?</b> Nobody else can call them while you hold them.</span>
      <div className="row"><button className="btn" type="button" onClick={() => setSure(false)}>Go back</button><button className="btn primary" type="button" disabled={busy} onClick={run}>{busy ? 'Checking…' : 'Yes, keep them'}</button></div></>
    : <><span className="small muted">{read.length ? `${items.length} of ${read.length} rows ticked` : 'No business with a number found yet'}</span>
      <button className="btn primary" type="button" disabled={!items.length || (needSrc && !src)} title={needSrc && !src ? 'First choose where this list came from' : ''} onClick={() => setSure(true)}>Keep the {items.length} ticked</button></>;
  return <Modal wide title="Upload my calling list" onClose={() => setChk(null)} footer={footer}>
    {!chk.res ? <div className="stack"><p style={{ margin: 0 }}>Download the template, fill it in Excel and choose the file – or copy your rows and paste them below. You will see every row before anything is kept.</p>
      <div className="fmt"><div className="small" style={{ fontWeight: 600 }}>What your list must hold – one business in one row</div>
        <div className="tbl"><table><thead><tr>{COLS.map(([h, need]) => <th key={h}>{h} <span className={'pill' + (need === 'Needed' ? ' warn' : '')}>{need}</span></th>)}</tr></thead>
          <tbody><tr>{COLS.map(([h, , what]) => <td key={h} className="small muted">{what}</td>)}</tr><tr>{['Sri Sai Medicals', '9876543210', 'Guntur', 'Pharmacy', 'Google Maps'].map((x) => <td key={x} className="num small">{x}</td>)}</tr></tbody></table></div></div>
      <div className="row"><button className="btn" type="button" onClick={template}>Download the Excel template</button>
        <label className="btn primary" style={{ cursor: 'pointer' }}>Choose my filled file<input type="file" accept=".xlsx,.csv,.txt" hidden onChange={pick} /></label><span className="small muted">Excel (.xlsx) or CSV · up to {MAX} businesses at a time</span></div>
      {sheets.length > 1 && <div className="row"><span className="small muted">This file has {sheets.length} sheets. Choose yours:</span>{sheets.map((x, i) => <button key={i} type="button" className={'chip' + (i === at ? ' on' : '')} aria-pressed={i === at} onClick={() => show(sheets, i)}>{x.name}</button>)}</div>}
      <Area style={{ minHeight: read.length ? 70 : 130, fontFamily: 'var(--num)', fontSize: 12.5 }} value={chk.text} onChange={(e) => { setOff(null); setSure(false); setChk({ text: e.target.value, res: null }); }} placeholder={'Or paste / type here, one business per line:\nSri Sai Medicals, 9876543210, Guntur, Pharmacy\nLotus Clinic, 0863 2234567, Brodipet'} />
      {read.length > 0 && <div className="stack gap4"><span className="small" style={{ fontWeight: 600 }}>Check your list – this is how each row was read</span>
        <div className="row small">{wrong > 0 && <Pill k="bad">{wrong} look wrong – left out</Pill>}{noPlace > 0 && <Pill k="warn">{noPlace} without a place</Pill>}<Pill k="ok">{items.length} will be kept</Pill></div>
        <div className="tbl readback"><table><thead><tr><th /><th>Business</th><th>Number</th><th>Place</th><th>Industry</th><th>Source</th></tr></thead><tbody>
          {read.map((x, i) => <tr key={i} className={skip.has(i) ? 'dim' : ''}><td><input type="checkbox" checked={!skip.has(i)} onChange={() => tick(i)} aria-label={`Keep ${x.org || x.phone}`} /></td>
            <td><b>{x.org || '—'}</b>{x.why && <div className="small" style={{ color: 'var(--bad)' }}>{x.why}</div>}</td><td className="num">{x.phone}</td>
            <td>{x.place || <span className="small" style={{ color: 'var(--warn)' }}>no place</span>}</td><td>{x.ind || '—'}</td><td>{x.src || src || '—'}</td></tr>)}</tbody></table></div>
        <span className="small muted">Untick a row to leave it out. If the names or places are in the wrong columns, fix the file (or use the template) and choose it again.</span></div>}
      {items.length > 0 && needSrc && <div className="row"><span className="small" style={{ fontWeight: 600 }}>Where did you get this list?</span>{(settings().listSources || []).map((x) => <button key={x} type="button" className={'chip' + (src === x ? ' on' : '')} aria-pressed={src === x} onClick={() => { setSrc(x); setSure(false); }}>{x}</button>)}</div>}
      {callSheet && <div className="banner warn"><b>This looks like calls you already made</b> – it has responses (interested, call back…). This upload only keeps numbers <b>to call</b>; the responses would be lost.
        {onCalls ? <button className="btn sm" type="button" style={{ marginLeft: 10 }} onClick={() => onCalls(chk.text)}>Add them to today's call sheet instead</button>
          : <> To put them on today's call sheet, open <Link to="/daily" onClick={() => setChk(null)}>Daily reports</Link> → My calls → <b>Upload calls I already made</b>.</>}</div>}
      {!read.length && <MyLists />}
    </div> : <div className="stack">
      {no.length > 0 && <div className="banner bad"><b>Do not call these {no.length}:</b><ul className="access">{no.map((v, i) => <li key={i}><b>{v.item.org || v.item.phone}</b> ({v.item.phone}) – {v.msg}</li>)}</ul></div>}
      {ok.length > 0 && <div className="banner ok"><b>You can call these {ok.length}.</b> They are now in your calling list on the <Link to="/daily" onClick={() => setChk(null)}>Daily reports</Link> page: call from there and tap the response.
        <ul className="access">{ok.map((v, i) => <li key={i}><b>{v.item.org || v.item.phone}</b> ({v.item.phone}){v.kind !== 'free' ? ' – ' + v.msg : ''}</li>)}</ul></div>}
      <MyLists key={batch} />
    </div>}
  </Modal>;
}

function Detail({ p, cfg, mgr, mine, onClose }) {
  const [f, setF] = useState({ name: p.name, place: p.place || '', ind: p.ind || '' }), [act, setAct] = useState(null), [why, setWhy] = useState(''), [to, setTo] = useState('');
  const [l, k] = STATE[p.state] || STATE.open, set = (data, ok) => attempt(() => update(p.id, data), ok);
  const dirty = f.name !== p.name || f.place !== (p.place || '') || f.ind !== (p.ind || '');
  async function go() { const ok = await set(act === 'give' ? { _action: 'give', owner: to } : { _action: act, _why: why }, act === 'dnc' ? 'On the Do Not Call list now.' : act === 'reopen' ? 'Reopened. Calls are allowed again.' : 'Done.'); if (ok) { setAct(null); setWhy(''); } }
  return <Modal wide title={p.name || p.phone} onClose={onClose} footer={<><div className="row">{mine && p.state !== 'dnc' && <button className="btn danger" type="button" onClick={() => setAct('dnc')}>Do not call</button>}
    {mgr && p.state !== 'open' && <button className="btn" type="button" onClick={() => setAct('reopen')}>Reopen – allow calls</button>}
    {mgr && <button className="btn" type="button" onClick={() => setAct('give')}>Give to…</button>}{mgr && p.owner && <button className="btn" type="button" onClick={() => set({ _action: 'release' }, 'Released. The next person who checks it may call.')}>Release</button>}</div>
    <div className="row">{mine && dirty && <button className="btn primary" type="button" onClick={() => set(f, 'Saved.')}>Save details</button>}<button className="btn" type="button" onClick={onClose}>Close</button></div></>}>
    <div className="stack">
      <div className="row"><Pill k={k}>{l}</Pill><span className="num">{p.phone}</span><span className="small muted">{p.owner ? `Held by ${uname(p.owner)} since ${fmtDate((p.since || '').slice(0, 10))}` : 'Nobody holds it'}</span></div>
      {p.dnc && <div className="banner bad"><b>Do not call</b> since {fmtDate(p.dnc.at.slice(0, 10))}: {p.dnc.reason} <span className="small">({uname(p.dnc.by)})</span></div>}
      {p.closed && <div className="banner">{p.closed.why} on {fmtDate(p.closed.at.slice(0, 10))} ({uname(p.closed.by)}). No more calls unless the Sales Manager reopens it.</div>}
      {p.state === 'tired' && <div className="banner">Called {p.noTries} times in a row with no answer. Stop calling unless the Sales Manager reopens it.</div>}
      <fieldset disabled={!mine} className="ro"><div className="form"><Field label="Business / person"><In value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Place"><In value={f.place} maxLength={60} onChange={(e) => setF({ ...f, place: e.target.value })} /></Field>
        <Field label="Industry"><Sel value={f.ind} onChange={(v) => setF({ ...f, ind: v })} options={settings().industries} blank="Not set" /></Field></div></fieldset>
      {act && <div className="card stack">{act === 'give' ? <Field label="Give this business to"><Person value={to} onChange={setTo} blank="Choose…" filter={(u) => u.team === 'sales'} /></Field>
        : <Field label={act === 'dnc' ? 'Why must it not be called? *' : 'Why are calls allowed again? *'}><In value={why} onChange={(e) => setWhy(e.target.value)} autoFocus placeholder={act === 'dnc' ? 'e.g. The owner asked us to stop calling' : 'e.g. The owner called back and asked for a quotation'} /></Field>}
        <div className="row"><button className={'btn ' + (act === 'dnc' ? 'danger' : 'primary')} type="button" disabled={act === 'give' ? !to : why.trim().length < 3} onClick={go}>{act === 'dnc' ? 'Put on the Do Not Call list' : act === 'reopen' ? 'Reopen' : 'Give'}</button><button className="btn" type="button" onClick={() => setAct(null)}>Cancel</button></div></div>}
      <div><span className="lbl">Calls made ({p.tries || 0}){p.state === 'open' && p.noTries > 0 ? ` · ${p.noTries} of ${cfg.maxTries} unanswered in a row` : ''}</span>
        {(p.calls || []).length ? <ul className="log">{[...p.calls].reverse().map((c, i) => <li key={i}><span className="num">{fmtDT(c.at)}</span><span>{c.resp || 'no response written'} <span className="faint">· {uname(c.by)}</span></span></li>)}</ul> : <p className="small muted" style={{ margin: 0 }}>Not called yet.</p>}</div>
      <div><span className="lbl">History</span><Log items={p.log} /></div>
    </div></Modal>;
}
