import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, list, get, create, update, remove, store, http, poll } from '../api.js';
import { settings, uname, fmtDate, today, addDays, mobile10, isManager, canEdit, scope } from '../lib.js';
import { Modal, Field, In, Sel, Pick, Area, Pill, Due, Empty, Sample, Log, Comments, Attachments, Message, DeleteButton, Person, attempt, toast, Seg, RO, ViewOnly, TeamFilter, byTeam } from '../ui.jsx';
import { Activities } from '../activity.jsx';
import { useId } from '../App.jsx';

const SCORE = { hot: ['Hot', 'bad'], warm: ['Warm', 'warn'], cold: ['Cold', 'info'] };
const STATUS = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', converted: 'Converted', junk: 'Not a real lead' };
export const services = () => settings().services.map((s) => s.name);
// Several services under one client (the user, 17 Oct 2026). The BDE writes them, separated by commas – "Restaurant POS, billing software".
// A name written like one in the services list becomes that service (so it keeps its price); anything else is kept as written.
export const svcList = (d) => (d?.services?.length ? d.services : d?.service ? [d.service] : []);
export const svcText = (d) => svcList(d).join(', ');
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const parseServices = (text) => { const known = services(), out = [];
  for (const raw of String(text || '').split(/[,\n;]+/)) { const t = raw.trim().replace(/\s+/g, ' ').slice(0, 80); if (!t) continue;
    const x = known.find((k) => norm(k) === norm(t)) || t; if (!out.some((y) => norm(y) === norm(x))) out.push(x); }
  return out.slice(0, 12); };
// lazy: tell the page only when the person leaves the box (a saved lead or deal is not saved at every key press).
export function ServicesPick({ value = [], onChange, disabled, lazy, autoFocus }) {
  const [text, setText] = useState(() => value.join(', ')), list = parseServices(text), last = text.split(',').at(-1).trim().toLowerCase();
  const hints = norm(last).length >= 2 ? services().filter((k) => norm(k).includes(norm(last)) && !list.includes(k)).slice(0, 4) : [];
  const put = (t) => { setText(t); if (!lazy) onChange(parseServices(t)); };
  const take = (k) => put([...text.split(',').slice(0, -1).map((x) => x.trim()).filter(Boolean), k].join(', ') + ', ');
  return <div className="stack gap4" style={{ width: '100%' }}>
    <input className="in" value={text} disabled={disabled} autoFocus={autoFocus} aria-label="Services" placeholder="Write the services, separated by commas – e.g. Restaurant POS, billing software, 5-page website"
      onChange={(e) => put(e.target.value)} onBlur={() => { const v = parseServices(text); if (lazy && v.join('|') !== value.join('|')) onChange(v); }} />
    {hints.length > 0 && <div className="row small" style={{ gap: 6 }}><span className="muted">Did you mean:</span>{hints.map((k) => <button key={k} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => take(k)}>{k}</button>)}</div>}
  </div>;
}

export default function Leads() {
  useStore(); const id = useId();
  return id ? <LeadView id={id} /> : <LeadList />;
}

function LeadList() {
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', status: 'open', source: '', owner: '', company: '', score: '' }), [add, setAdd] = useState(false), [imp, setImp] = useState(false);
  const rows = list('lead').filter((l) => (f.status === 'open' ? !['converted', 'junk'].includes(l.status) : !f.status || l.status === f.status)
    && (!f.source || l.source === f.source) && byTeam(l.owner, f) && (!f.score || l.score === f.score)
    && (!f.q || `${l.name} ${l.mobile} ${l.company} ${l.service}`.toLowerCase().includes(f.q.toLowerCase())))
    .sort((a, b) => (a.followUp || '9').localeCompare(b.followUp || '9'));
  const up = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v }), edit = canEdit('leads'), own = scope('leads') === 'own';
  return (
    <>
      <div className="topbar"><h1>{own ? 'My leads & enquiries' : 'Leads & enquiries'} <small>{rows.length} shown</small> <ViewOnly when={!edit} /></h1>
        <div className="row"><a className="btn" href="/enquire" target="_blank" rel="noreferrer">Website form ↗</a>{edit && <button className="btn" type="button" onClick={() => setImp(true)}>Import from Excel</button>}{edit && <button className="btn primary" type="button" onClick={() => setAdd(true)}>+ New enquiry</button>}</div></div>
      <div className="row" style={{ marginBottom: 12 }}>
        <In placeholder="Search name, mobile, company, service" value={f.q} onChange={up('q')} style={{ maxWidth: 280 }} />
        <Sel value={f.status} onChange={up('status')} options={[['open', 'Open leads'], ...Object.entries(STATUS)]} blank="All statuses" style={{ width: 'auto' }} />
        <Sel value={f.source} onChange={up('source')} options={settings().sources} blank="All sources" style={{ width: 'auto' }} />
        <Sel value={f.score} onChange={up('score')} options={[['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']]} blank="Any score" style={{ width: 'auto' }} />
        {!own && <TeamFilter value={f} onChange={(v) => setF({ ...f, ...v })} />}
      </div>
      {rows.length ? <div className="tbl cards"><table><thead><tr><th>Name</th><th>Service</th><th>Source</th><th>Score</th><th>BDE</th><th>Follow-up</th><th>Status</th></tr></thead><tbody>
        {rows.map((l) => <tr key={l.id} className="click" onClick={() => nav('/leads/' + l.id)}>
          <td><Link to={'/leads/' + l.id}><b>{l.name}</b></Link><div className="small muted num">{l.mobile}{l.company ? ' · ' + l.company : ''}</div>
            <div className="row">{l.repeatPending && <Pill k="warn">Asked again</Pill>}{l.existingClient && <Pill k="gold">Existing client</Pill>}<Sample on={l.sample} /></div></td>
          <td>{svcText(l)}</td><td>{l.source}</td><td>{l.score ? <Pill k={SCORE[l.score][1]}>{SCORE[l.score][0]}</Pill> : '—'}</td>
          <td>{uname(l.owner)}</td><td>{l.followUp ? <Due date={l.followUp} /> : '—'}</td><td>{STATUS[l.status] || l.status}</td></tr>)}
      </tbody></table></div> : <Empty>No leads match. Use “+ New enquiry”, import a sheet, or share the website form.</Empty>}
      {add && <NewEnquiry onClose={() => setAdd(false)} />}
      {imp && <ImportLeads onClose={() => setImp(false)} />}
    </>
  );
}

export function NewEnquiry({ onClose, preset = {} }) {
  const nav = useNavigate(), [f, setF] = useState({ source: 'Walk-in', ...preset }), [busy, setBusy] = useState(false);
  const up = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  const m = mobile10(f.mobile), existing = m.length === 10 ? [...list('lead'), ...list('deal')].filter((r) => r.mobile10 === m) : [];
  // One business, one caller: ask the call register about this number (it is with another BDE, or on the Do Not Call list).
  const [chk, setChk] = useState(null), stop = !!chk && !chk.ok && ['held', 'dnc'].includes(chk.kind);
  useEffect(() => {
    if (m.length !== 10) return setChk(null);
    let live = true; const h = setTimeout(() => http('POST', '/prospects/check', { items: [{ phone: m, org: f.company || f.name || '', dupOk: true }] }).then((x) => live && setChk(x.results[0]), () => {}), 500);
    return () => { live = false; clearTimeout(h); };
  }, [m]);
  async function save() {
    setBusy(true); const r = await attempt(() => create('lead', f)); setBusy(false); if (!r) return;
    if (r.hidden) { toast(`This mobile + service is already an open lead with ${uname(r.record.owner)}. Your enquiry was added to it as a repeat.`); return onClose(); }
    if (r.merged) toast(`Same mobile + same service is already open with ${uname(r.record.owner)}. Added as a repeat enquiry.`);
    else toast(r.record.existingClient ? `Existing client – given to ${uname(r.record.owner)}.` : `New lead given to ${uname(r.record.owner)}.`);
    onClose(); nav(`/${r.record.type === 'deal' ? 'deals' : 'leads'}/${r.record.id}`);
  }
  return (
    <Modal title="New enquiry" onClose={onClose} footer={<><span className="small muted">Same mobile + same service joins the existing lead. A known client asking for a new service goes to their BDE. Others go to BDEs in turn.</span>
      <button className="btn primary" type="button" disabled={busy || (stop && scope('leads') === 'own')} onClick={save}>Save enquiry</button></>}>
      <div className="form">
        <Field label="Name *"><In value={f.name || ''} onChange={up('name')} autoFocus /></Field>
        <Field label="Mobile *"><In type="tel" value={f.mobile || ''} onChange={up('mobile')} placeholder="98765 43210" /></Field>
        <Field label="Services wanted *" full><ServicesPick value={svcList(f)} onChange={(v) => setF({ ...f, services: v, service: v[0] || '' })} /></Field>
        <Field label="Source *"><Sel value={f.source} onChange={up('source')} options={settings().sources} /></Field>
        <Field label="Company"><In value={f.company || ''} onChange={up('company')} /></Field>
        <Field label="Email"><In type="email" value={f.email || ''} onChange={up('email')} /></Field>
        <Field label="Message / requirement" full><Area value={f.message || ''} onChange={up('message')} /></Field>
        {stop && <div className="banner bad full">{chk.msg}</div>}
        {existing.length > 0 && <div className="banner info full">This mobile is already known: {existing.map((e) => `${e.name || e.title} (${svcText(e)}, ${uname(e.owner)})`).join('; ')}.</div>}
      </div>
    </Modal>
  );
}

// Leads from an Excel sheet (saved as CSV). Every row is shown as it was read before anything is imported, the person confirms,
// and a wrong import can be undone at once: the new leads go to the recycle bin (leads that joined an existing one are not touched).
function ImportLeads({ onClose }) {
  const [text, setText] = useState(''), [res, setRes] = useState(null), [busy, setBusy] = useState(false), [sure, setSure] = useState(false), [undo, setUndo] = useState(false);
  function parse(csv) {
    const lines = csv.trim().split(/\r?\n/).filter(Boolean); if (lines.length < 2) return [];
    const split = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    const head = split(lines[0]).map((h) => h.toLowerCase());
    return lines.slice(1).map((l) => { const c = split(l), o = {}; head.forEach((h, i) => (o[h] = c[i] || '')); return o; });
  }
  const rows = parse(text), why = (r) => (!r.name ? 'No name' : mobile10(r.mobile).length !== 10 ? 'No 10-digit mobile' : !r.service ? 'No service' : ''), bad = rows.filter(why).length;
  async function run() { setBusy(true); const r = await attempt(() => http('POST', '/import/leads', { rows })); setBusy(false); setSure(false); if (r) { setRes(r); poll(); } }
  async function undoAll() { setBusy(true); let n = 0; for (const id of res.ids || []) if (await remove(id, 'Import undone').then(() => true, () => false)) n++; setBusy(false);
    toast(`Import undone: ${n} lead${n === 1 ? '' : 's'} moved to the recycle bin.`); setUndo(false); setRes({ ...res, ids: [], undone: n }); }
  const footer = res ? <button className="btn" type="button" onClick={onClose}>Close</button>
    : sure ? <><span className="small"><b>Import {rows.length - bad} lead{rows.length - bad === 1 ? '' : 's'}?</b> Each goes through the duplicate check.</span>
      <div className="row"><button className="btn" type="button" onClick={() => setSure(false)}>Go back</button><button className="btn primary" type="button" disabled={busy} onClick={run}>{busy ? 'Importing…' : 'Yes, import'}</button></div></>
    : <><span className="small muted">{rows.length ? `${rows.length} row${rows.length === 1 ? '' : 's'} read${bad ? ` · ${bad} will fail` : ''}` : 'Nothing read yet'}</span>
      <button className="btn primary" type="button" disabled={!rows.length || bad === rows.length} onClick={() => setSure(true)}>Import</button></>;
  return (
    <Modal wide title="Import leads from Excel" onClose={onClose} footer={footer}>
      {!res ? <div className="stack">
        <p style={{ margin: 0 }}>In Excel, save the sheet as <b>CSV</b>, open it in Notepad, and paste it below. The first row must have these headings: <code>name, mobile, service, source, company, email, message</code>. You will see every row before anything is imported.</p>
        <Field label="Or choose the CSV file"><input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files[0]; if (f) { setText(await f.text()); setSure(false); } }} /></Field>
        <Area style={{ minHeight: rows.length ? 80 : 180, fontFamily: 'var(--num)', fontSize: 12 }} value={text} onChange={(e) => { setText(e.target.value); setSure(false); }} placeholder={'name,mobile,service,source\nRavi Kumar,9876543210,Website – 5 pages,Referral'} />
        {rows.length > 0 && <><span className="small" style={{ fontWeight: 600 }}>Check the rows – this is how each one was read</span>
          <div className="tbl readback"><table><thead><tr><th>Name</th><th>Mobile</th><th>Service</th><th>Source</th><th>Company</th></tr></thead><tbody>
            {rows.map((r, i) => <tr key={i} className={why(r) ? 'dim' : ''}><td><b>{r.name || '—'}</b>{why(r) && <div className="small" style={{ color: 'var(--bad)' }}>{why(r)} – this row will fail</div>}</td>
              <td className="num">{r.mobile || '—'}</td><td>{r.service || '—'}</td><td>{r.source || 'Other'}</td><td>{r.company || '—'}</td></tr>)}</tbody></table></div></>}
      </div> : <div className="stack">
        <div className="banner ok">{res.created} new lead{res.created === 1 ? '' : 's'}, {res.merged} joined existing leads, {res.failed.length} could not be imported.{res.failed.map((f) => <div key={f.row}>Row {f.row}: {f.error}</div>)}</div>
        {res.undone !== undefined ? <div className="banner info">This import was undone: {res.undone} lead{res.undone === 1 ? '' : 's'} moved to the recycle bin.</div>
          : (res.ids || []).length > 0 && (undo ? <div className="row"><span className="small"><b>Undo this import?</b> The {res.ids.length} new lead{res.ids.length === 1 ? '' : 's'} go to the recycle bin.</span>
            <button className="btn sm" type="button" onClick={() => setUndo(false)}>No</button><button className="btn danger sm" type="button" disabled={busy} onClick={undoAll}>{busy ? 'Undoing…' : 'Yes, undo'}</button></div>
            : <div className="row"><span className="small muted">Imported the wrong sheet?</span><button className="btn sm" type="button" onClick={() => setUndo(true)}>Undo this import</button></div>)}
      </div>}
    </Modal>
  );
}

function LeadView({ id }) {
  const nav = useNavigate(), l = get(id), [conv, setConv] = useState(false);
  if (!l) return <Empty>This lead was not found. <Link to="/leads">Back to leads</Link></Empty>;
  const set = (data, ok) => attempt(() => update(id, data), ok), edit = canEdit('leads'), own = scope('leads') === 'own';
  return (
    <>
      <div className="topbar"><h1>{l.name} <small>{svcText(l)} · {l.source}</small> <ViewOnly when={!edit} /></h1>
        <div className="row"><Link className="btn" to="/leads">All leads</Link>
          {edit && l.status !== 'converted' && <button className="btn primary" type="button" onClick={() => setConv(true)}>Convert to client + deal</button>}
          {l.status === 'converted' && l.dealId && <Link className="btn primary" to={'/deals/' + l.dealId}>Open deal</Link>}</div></div>
      <RO when={!edit}>
      {l.repeatPending && <div className="banner" style={{ marginBottom: 14 }}>
        <b>This client asked again about {l.service}.</b> Ask them whether it is about the earlier enquiry or a new requirement:
        <div style={{ margin: '8px 0' }}><Message phone={l.mobile} defaultId="tp-repeat" vars={{ client: l.name.split(' ')[0], service: l.service }} /></div>
        <div className="row"><button className="btn sm" type="button" onClick={() => set({ repeatPending: false, _note: 'Client said: same as the earlier enquiry' }, 'Kept as the same lead.')}>Same as before</button>
          <button className="btn sm" type="button" onClick={async () => { const r = await attempt(() => create('lead', { name: l.name, mobile: l.mobile, service: l.service, source: 'Existing client', company: l.company, owner: l.owner, _new: true }));
            await set({ repeatPending: false, _note: 'Client said: new requirement – new lead made' }); if (r?.record) nav('/leads/' + r.record.id); }}>New requirement</button></div>
      </div>}
      <div className="grid2">
        <div className="card stack">
          <h2>Details</h2>
          <div className="form">
            <Field label="Name"><In defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && set({ name: e.target.value })} /></Field>
            <Field label="Mobile"><In defaultValue={l.mobile} onBlur={(e) => e.target.value !== l.mobile && set({ mobile: e.target.value, mobile10: mobile10(e.target.value) })} /></Field>
            <Field label="Company"><In defaultValue={l.company} onBlur={(e) => set({ company: e.target.value })} /></Field>
            <Field label="Email"><In defaultValue={l.email} onBlur={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Services" full><ServicesPick lazy value={svcList(l)} onChange={(v) => v.length && set({ services: v })} /></Field>
            <Field label="Source"><Sel value={l.source} onChange={(v) => set({ source: v })} options={settings().sources} /></Field>
            <Field label="BDE" hint={own ? 'Only the Sales Manager can give a lead to someone else.' : ''}><Person value={l.owner} disabled={own} onChange={(v) => set({ owner: v, _note: `Lead given to ${uname(v)}` }, 'Reassigned.')} filter={(u) => u.team === 'sales'} /></Field>
            <Field label="Next follow-up"><In type="date" value={l.followUp || ''} onChange={(e) => set({ followUp: e.target.value })} /></Field>
            <Field label="Score"><Seg value={l.score || ''} onChange={(v) => set({ score: v })} options={[['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']]} /></Field>
            <Field label="Status"><Sel value={l.status} onChange={(v) => set({ status: v })} options={STATUS} /></Field>
            <Field label="Requirement / notes" full><Area defaultValue={l.message} onBlur={(e) => set({ message: e.target.value })} /></Field>
          </div>
          <div className="row"><Sample on={l.sample} />{l.existingClient && <Pill k="gold">Existing client</Pill>}<span className="small muted">Created {fmtDate(l.createdAt?.slice(0, 10))}</span>
            <span className="grow" />{(isManager() || l.createdBy === store.me.id) && <DeleteButton id={l.id} after={() => nav('/leads')} />}</div>
        </div>
        <div className="card stack"><h2>Message the client</h2><Message phone={l.mobile} vars={{ client: l.name.split(' ')[0], service: l.service }} /></div>
        <div className="card stack"><h2>Calls & meetings</h2><Activities leadId={l.id} subject={l.name} /></div>
        <div className="card stack"><h2>Enquiries</h2>{(l.enquiries || []).map((e, i) => <div key={i} className="small"><b>{fmtDate(e.at.slice(0, 10))}</b> · {e.source}{e.message ? ' – ' + e.message : ''}</div>)}</div>
        <div className="card stack"><h2>Comments</h2><Comments relType="lead" relId={l.id} /></div>
        <div className="card stack"><h2>Files</h2><Attachments value={l.files || []} onChange={(files) => set({ files })} /></div>
        <div className="card stack" style={{ gridColumn: '1/-1' }}><h2>History</h2><Log items={l.log} /></div>
      </div>
      </RO>
      {conv && <Convert lead={l} onClose={() => setConv(false)} />}
    </>
  );
}

// Zoho-style conversion: the lead becomes (or joins) a client, plus a deal, in one step.
function Convert({ lead, onClose }) {
  const nav = useNavigate(), clients = list('client');
  const match = clients.find((c) => c.mobile10 === lead.mobile10 || (lead.company && c.name.toLowerCase() === lead.company.toLowerCase()));
  const all = svcList(lead), rate = all.reduce((s, x) => s + (+settings().services.find((y) => y.name === x)?.rate || 0), 0);
  const [f, setF] = useState({ clientId: match?.id || '', clientName: lead.company || lead.name, title: `${all.length > 1 ? `${all.length} services` : lead.service} – ${lead.company || lead.name}`, value: rate, closeDate: addDays(today(), 21), stage: 'contacted' });
  const up = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  async function go() {
    let clientId = f.clientId;
    if (!clientId) { const c = await attempt(() => create('client', { name: f.clientName, phone: lead.mobile, email: lead.email, owner: lead.owner, contacts: [{ name: lead.name, phone: lead.mobile, email: lead.email, role: '' }], source: lead.source })); if (!c) return; clientId = c.record.id; }
    const d = await attempt(() => create('deal', { title: f.title, clientId, contactName: lead.name, phone: lead.mobile, service: lead.service, services: all, source: lead.source, value: +f.value || 0, stage: f.stage, closeDate: f.closeDate, owner: lead.owner, followUp: lead.followUp || today(), leadId: lead.id, notes: lead.message, files: lead.files || [] }));
    if (!d) return;
    await update(lead.id, { status: 'converted', clientId, dealId: d.record.id, _note: 'Converted to client + deal' });
    toast('Converted. The client and deal are ready.'); onClose(); nav('/deals/' + d.record.id);
  }
  return (
    <Modal title="Convert lead" onClose={onClose} footer={<button className="btn primary" type="button" onClick={go}>Convert</button>}>
      <div className="form">
        <Field label="Client" full><Pick value={f.clientId} onChange={up('clientId')} options={clients.map((c) => [c.id, c.name, c.city])} blank="Create a new client" /></Field>
        {!f.clientId && <Field label="New client name" full><In value={f.clientName} onChange={up('clientName')} /></Field>}
        <Field label="Deal name" full><In value={f.title} onChange={up('title')} /></Field>
        <Field label="Expected value (₹)"><In type="number" value={f.value} onChange={up('value')} /></Field>
        <Field label="Expected closing date"><In type="date" value={f.closeDate} onChange={up('closeDate')} /></Field>
        <Field label="Stage"><Sel value={f.stage} onChange={up('stage')} options={settings().pipeline.filter((s) => !['won', 'lost'].includes(s.key)).map((s) => [s.key, s.label])} /></Field>
        {match && <div className="banner info full">Found an existing client with the same mobile or company: {match.name}. The deal will be added to it.</div>}
      </div>
    </Modal>
  );
}
