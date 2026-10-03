import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, list, get, create, update, store } from '../api.js';
import { settings, uname, fmtDate, today, addDays, inr, stageLabel, stageProb, isManager, dealReceived, diff, clientName, canMoney, canEdit, scope } from '../lib.js';
import { Modal, Field, In, Sel, Pick, Area, Pill, Due, Empty, Sample, Log, Comments, Attachments, Message, DeleteButton, Person, People, attempt, toast, Seg, Avs, RO, ViewOnly, TeamFilter, byTeam } from '../ui.jsx';
import { Activities } from '../activity.jsx';
import { services } from './Leads.jsx';
import { useId } from '../App.jsx';

export default function Deals() { useStore(); const id = useId(); return id === 'new' ? <DealForm /> : id ? <DealView id={id} /> : <Pipeline />; }

const open = (d) => !['won', 'lost'].includes(d.stage);
function Pipeline() {
  const nav = useNavigate(), [view, setView] = useState('board'), [f, setF] = useState({ owner: '', company: '', q: '', tag: '' }), [lost, setLost] = useState(null);
  const deals = list('deal').filter((d) => byTeam(d.owner, f) && (!f.tag || (d.tags || []).includes(f.tag)) && (!f.q || `${d.title} ${d.contactName} ${clientName(d.clientId)}`.toLowerCase().includes(f.q.toLowerCase())));
  const month = today().slice(0, 7), openDeals = deals.filter(open);
  const pipe = openDeals.reduce((s, d) => s + (+d.value || 0), 0), weighted = openDeals.reduce((s, d) => s + (+d.value || 0) * stageProb(d.stage) / 100, 0);
  const won = deals.filter((d) => d.stage === 'won' && (d.wonAt || '').startsWith(month)), wonV = won.reduce((s, d) => s + (+d.value || 0), 0);
  const target = list('target').filter((t) => t.month === month && byTeam(t.userId, f)).reduce((s, t) => s + (+t.amount || 0), 0);
  const lateClose = openDeals.filter((d) => d.closeDate && diff(d.closeDate) < 0).length;
  const tags = [...new Set(list('deal').flatMap((d) => d.tags || []))], edit = canEdit('deals'), own = scope('deals') === 'own';
  async function move(id, stage) {
    const d = get(id); if (!d || d.stage === stage) return;
    if (!edit) return toast('Your access to deals is view only.', true);
    if (stage === 'lost') return setLost(d);
    if (await attempt(() => update(id, { stage }), `Moved to ${stageLabel(stage)}.`) && stage === 'won') toast('Deal won! Open it to write the handoff note for IT.');
  }
  return (
    <>
      <div className="topbar"><h1>{own ? 'My deals' : 'Deals pipeline'} <ViewOnly when={!edit} /></h1><div className="row"><Seg value={view} onChange={setView} options={[['board', 'Board'], ['list', 'List']]} />{edit && <Link className="btn primary" to="/deals/new">+ New deal</Link>}</div></div>
      <div className="stats">
        <div className="stat"><span className="l">Open pipeline</span><span className="v">{inr(pipe)}</span><span className="small muted">{openDeals.length} deals</span></div>
        <div className="stat"><span className="l">Likely income</span><span className="v">{inr(weighted)}</span><span className="small muted">value × win chance of each stage</span></div>
        <div className="stat"><span className="l">Won this month</span><span className="v">{inr(wonV)}</span><span className="small muted">{target ? `${Math.round(100 * wonV / target)}% of ${inr(target)} target` : 'No target set'}</span></div>
        <div className={'stat' + (lateClose ? ' warm' : '')}><span className="l">Past closing date</span><span className="v">{lateClose}</span></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}><In placeholder="Search deals" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ maxWidth: 260 }} />
        {!own && <TeamFilter value={f} onChange={(v) => setF({ ...f, ...v })} />}
        {tags.length > 0 && <Sel value={f.tag} onChange={(v) => setF({ ...f, tag: v })} options={tags} blank="Any tag" style={{ width: 'auto' }} />}</div>
      {view === 'board' ? <div className="board"><div className="cols">{settings().pipeline.map((s) => {
        const cs = deals.filter((d) => d.stage === s.key).sort((a, b) => (!!b.priority - !!a.priority) || (a.followUp || '9').localeCompare(b.followUp || '9'));
        return <div className="col" key={s.key} onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drop'); }} onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drop'); move(e.dataTransfer.getData('text'), s.key); }}>
          <div className="col-h"><b>{s.label}<span className="num">{cs.length}</span></b><div className="num small muted">{inr(cs.reduce((a, d) => a + (+d.value || 0), 0))} · {s.p}% chance</div></div>
          <div className="cards">{cs.map((d) => <Link key={d.id} to={'/deals/' + d.id} className="kc" draggable onDragStart={(e) => e.dataTransfer.setData('text', d.id)}>
            <div className="row between"><span className="t">{d.title}</span><Avs ids={[d.owner, ...(d.people || [])]} /></div>
            <div className="small muted">{clientName(d.clientId) || d.contactName}{d.quoteNo ? ` · ${d.quoteNo}` : ''}</div>
            <div className="row"><span className="num">{inr(d.value)}</span>{open(d) && d.followUp && <Due date={d.followUp} />}{d.priority && <Pill k="warn">Priority</Pill>}
              {d.repeatPending && <Pill k="warn">Asked again</Pill>}{d.stage === 'won' && !list('project').some((p) => p.dealId === d.id) && <Pill k="today">Not handed to IT</Pill>}
              {d.stage === 'lost' && <Pill>{d.lostReason}</Pill>}{(d.tags || []).map((t) => <Pill key={t} k="gold">{t}</Pill>)}<Sample on={d.sample} /></div>
          </Link>)}</div></div>;
      })}</div></div>
        : <div className="tbl"><table><thead><tr><th>Deal</th><th>Stage</th><th className="n">Value</th><th className="n">Chance</th><th>Closing</th><th>BDE</th><th>Follow-up</th></tr></thead><tbody>
          {deals.map((d) => <tr key={d.id} className="click" onClick={() => nav('/deals/' + d.id)}><td><b>{d.title}</b><div className="small muted">{clientName(d.clientId)}</div></td><td>{stageLabel(d.stage)}</td>
            <td className="n">{inr(d.value)}</td><td className="n">{stageProb(d.stage)}%</td><td>{fmtDate(d.closeDate)}</td><td>{uname(d.owner)}</td><td>{open(d) && d.followUp ? <Due date={d.followUp} /> : '—'}</td></tr>)}
        </tbody></table></div>}
      {lost && <LostModal deal={lost} onClose={() => setLost(null)} />}
    </>
  );
}

function LostModal({ deal, onClose }) {
  const [r, setR] = useState(''), [note, setNote] = useState('');
  return <Modal title={`Why was "${deal.title}" lost?`} onClose={onClose} footer={<button className="btn primary" type="button" disabled={!r}
    onClick={async () => (await attempt(() => update(deal.id, { stage: 'lost', lostReason: r, _note: note ? 'Lost: ' + note : '' }), 'Marked lost.')) && onClose()}>Mark lost</button>}>
    <div className="stack"><Field label="Reason"><Sel value={r} onChange={setR} options={settings().lostReasons} blank="Choose…" /></Field><Field label="Details (optional)"><In value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
  </Modal>;
}

function DealForm() {
  const nav = useNavigate(), [f, setF] = useState({ stage: 'lead', owner: store.me.id, closeDate: addDays(today(), 30), followUp: today(), source: 'Other' });
  const up = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v }), own = scope('deals') === 'own';
  if (!canEdit('deals')) return <Empty>Your access to deals is view only. <Link to="/deals">Back to the pipeline</Link></Empty>;
  return <div className="card stack" style={{ maxWidth: 720 }}><h1>New deal</h1>
    <div className="form">
      <Field label="Deal name *" full><In value={f.title || ''} onChange={up('title')} placeholder="Website – Sunrise Dental" /></Field>
      <Field label="Client"><Pick value={f.clientId} onChange={up('clientId')} options={list('client').map((c) => [c.id, c.name, c.city])} blank="Choose (or add on Clients)" /></Field>
      <Field label="Contact person"><In value={f.contactName || ''} onChange={up('contactName')} /></Field>
      <Field label="Phone"><In value={f.phone || ''} onChange={up('phone')} /></Field>
      <Field label="Service"><Sel value={f.service} onChange={(v) => setF({ ...f, service: v, value: f.value || settings().services.find((s) => s.name === v)?.rate })} options={services()} blank="Choose…" /></Field>
      <Field label="Value (₹)"><In type="number" value={f.value || ''} onChange={up('value')} /></Field>
      <Field label="Stage"><Sel value={f.stage} onChange={up('stage')} options={settings().pipeline.filter((s) => s.key !== 'lost').map((s) => [s.key, s.label])} /></Field>
      <Field label="Expected closing date"><In type="date" value={f.closeDate} onChange={up('closeDate')} /></Field>
      <Field label="Next follow-up"><In type="date" value={f.followUp} onChange={up('followUp')} /></Field>
      <Field label="BDE"><Person value={f.owner} onChange={up('owner')} disabled={own} filter={(u) => u.team === 'sales'} /></Field>
      <Field label="Source"><Sel value={f.source} onChange={up('source')} options={settings().sources} /></Field>
    </div>
    <div className="row"><button className="btn primary" type="button" onClick={async () => { const r = await attempt(() => create('deal', { ...f, value: +f.value || 0 })); if (r) nav('/deals/' + r.record.id); }}>Save deal</button><Link className="btn" to="/deals">Cancel</Link></div>
  </div>;
}

function DealView({ id }) {
  const nav = useNavigate(), d = get(id), [lost, setLost] = useState(false), [tab, setTab] = useState('work');
  if (!d) return <Empty>This deal was not found. <Link to="/deals">Back to the pipeline</Link></Empty>;
  const set = (data, ok) => attempt(() => update(id, data), ok), edit = canEdit('deals'), own = scope('deals') === 'own';
  const client = get(d.clientId), quotes = list('quote').filter((q) => q.dealId === id), pays = list('payment').filter((p) => p.dealId === id);
  const project = list('project').find((p) => p.dealId === id), received = dealReceived(id);
  const days = (d.stageHistory || []).map((h, i, a) => ({ ...h, days: Math.max(0, Math.round(((i + 1 < a.length ? new Date(a[i + 1].at) : new Date()) - new Date(h.at)) / 864e5)) }));
  function macro(m) {
    const data = { followUp: addDays(today(), m.followDays || 1), _note: m.note };
    if (m.stage) data.stage = m.stage; if (m.startCadence) data.cadence = { id: m.startCadence, start: today(), done: [] };
    return set(data, `Done: ${m.name}`);
  }
  return (
    <>
      <div className="topbar"><h1>{d.title} <small>{stageLabel(d.stage)} · {stageProb(d.stage)}% chance · {inr(d.value)}</small> <ViewOnly when={!edit} /></h1>
        <div className="row"><Link className="btn" to="/deals">Pipeline</Link>{canEdit('quotes') && <Link className="btn" to={`/quotes/new?deal=${id}`}>+ Quotation</Link>}
          {edit && d.stage !== 'lost' && d.stage !== 'won' && <button className="btn" type="button" onClick={() => setLost(true)}>Mark lost</button>}
          {edit && d.stage !== 'won' && <button className="btn primary" type="button" onClick={() => set({ stage: 'won' }, 'Deal won! Write the handoff note for IT below.').then(() => setTab('handoff'))}>Mark won</button>}</div></div>
      <RO when={!edit}>
      {d.repeatPending && <div className="banner" style={{ marginBottom: 12 }}><b>This client asked again about {d.service}.</b> Ask them: earlier enquiry or new requirement?
        <div style={{ margin: '8px 0' }}><Message phone={d.phone} defaultId="tp-repeat" vars={{ client: (d.contactName || '').split(' ')[0], service: d.service }} /></div>
        <div className="row"><button className="btn sm" type="button" onClick={() => set({ repeatPending: false, _note: 'Client said: same as the earlier enquiry' })}>Same as before</button>
          <button className="btn sm" type="button" onClick={async () => { await attempt(() => create('lead', { name: d.contactName || d.title, mobile: d.phone, service: d.service, source: 'Existing client', owner: d.owner, _new: true })); set({ repeatPending: false, _note: 'Client said: new requirement – new lead made' }, 'New lead made for the new requirement.'); }}>New requirement</button></div></div>}
      <div className="row" style={{ marginBottom: 12 }}><span className="lbl">Quick actions</span>{settings().macros.map((m) => <button key={m.id} className="btn sm" type="button" onClick={() => macro(m)}>{m.name}</button>)}</div>
      </RO>
      <div className="tabs" role="tablist">{[['work', 'Details & follow-up'], ['handoff', 'Handoff & payments'], ['talk', 'Calls, messages & comments'], ['history', 'History']].map(([k, l]) =>
        <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      <RO when={!edit}>
      {tab === 'work' && <div className="grid2">
        <div className="card stack"><h2>Details</h2><div className="form">
          <Field label="Deal name"><In defaultValue={d.title} onBlur={(e) => e.target.value !== d.title && set({ title: e.target.value })} /></Field>
          <Field label="Client"><Pick value={d.clientId} onChange={(v) => set({ clientId: v })} options={list('client').map((c) => [c.id, c.name, c.city])} blank="None" /></Field>
          <Field label="Contact person"><In defaultValue={d.contactName} onBlur={(e) => set({ contactName: e.target.value })} /></Field>
          <Field label="Phone"><In defaultValue={d.phone} onBlur={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Service"><Sel value={d.service} onChange={(v) => set({ service: v })} options={services()} blank="Choose…" /></Field>
          <Field label="Value (₹)"><In type="number" defaultValue={d.value} onBlur={(e) => +e.target.value !== +d.value && set({ value: +e.target.value || 0 })} /></Field>
          <Field label="Stage"><Sel value={d.stage} onChange={(v) => (v === 'lost' ? setLost(true) : set({ stage: v }))} options={settings().pipeline.map((s) => [s.key, `${s.label} (${s.p}%)`])} /></Field>
          <Field label="Expected closing date"><In type="date" value={d.closeDate || ''} onChange={(e) => set({ closeDate: e.target.value })} /></Field>
          <Field label="Next follow-up"><In type="date" value={d.followUp || ''} onChange={(e) => set({ followUp: e.target.value })} /></Field>
          <Field label="BDE in charge"><Person value={d.owner} disabled={own} onChange={(v) => set({ owner: v })} filter={(u) => u.team === 'sales'} /></Field>
          <Field label="Source"><Sel value={d.source} onChange={(v) => set({ source: v })} options={settings().sources} /></Field>
          <Field label="Tags" hint="Comma separated, e.g. Hospital, Government"><In defaultValue={(d.tags || []).join(', ')} onBlur={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
          <Field label="Also involved" full><People value={d.people || []} onChange={(people) => set({ people })} /></Field>
          <label className="check full"><input type="checkbox" checked={!!d.priority} onChange={(e) => set({ priority: e.target.checked })} /> Priority / big client</label>
          <Field label="Notes" full><Area defaultValue={d.notes} onBlur={(e) => set({ notes: e.target.value })} /></Field>
        </div><div className="row"><Sample on={d.sample} />{d.stage === 'lost' && <Pill k="bad">Lost: {d.lostReason}</Pill>}<span className="grow" />{(isManager() || d.createdBy === store.me.id) && <DeleteButton id={id} after={() => nav('/deals')} />}</div></div>
        <div className="stack">
          <div className="card stack"><h2>Follow-up plan</h2>
            {d.cadence ? (() => { const c = settings().cadences.find((x) => x.id === d.cadence.id); return c ? <>
              <div className="small muted">{c.name}, started {fmtDate(d.cadence.start)}</div>
              {c.steps.map((s, i) => <div key={i} className="row small"><input type="checkbox" checked={(d.cadence.done || []).includes(i)} onChange={(e) => set({ cadence: { ...d.cadence, done: e.target.checked ? [...(d.cadence.done || []), i] : (d.cadence.done || []).filter((x) => x !== i) } })} />
                <span className="num">{fmtDate(addDays(d.cadence.start, s.day))}</span><span>{s.action === 'whatsapp' ? 'WhatsApp' : s.action === 'call' ? 'Call' : 'Task'}: {s.text}</span></div>)}
              <button className="btn sm ghost" type="button" onClick={() => set({ cadence: null, _note: 'Follow-up plan stopped' })}>Stop plan</button></> : null; })()
              : <div className="row">{settings().cadences.map((c) => <button key={c.id} className="btn sm" type="button" onClick={() => set({ cadence: { id: c.id, start: today(), done: [] }, _note: `Started follow-up plan: ${c.name}` }, 'Plan started. Steps appear in Today.')}>Start: {c.name}</button>)}</div>}
          </div>
          {canMoney() && <div className="card stack"><h2>Quotations</h2>
            {quotes.length ? quotes.map((q) => <Link key={q.id} to={'/quotes/' + q.id} className="row small"><b className="num">{q.number}</b><span>{inr(q.totals?.total)}</span><Pill k={q.status === 'accepted' ? 'ok' : q.status === 'needs approval' ? 'warn' : ''}>{q.status}</Pill></Link>) : <p className="small muted" style={{ margin: 0 }}>No quotation yet.</p>}
            {canEdit('quotes') && <Link className="btn sm" to={`/quotes/new?deal=${id}`}>+ New quotation</Link>}</div>}
          <div className="card stack"><h2>Time in each stage</h2>{days.map((h, i) => <div key={i} className="row small"><span className="grow">{stageLabel(h.stage)}</span><span className="num">{fmtDate(h.at.slice(0, 10))}</span><span className="num">{h.days} days</span></div>)}</div>
        </div></div>}
      {tab === 'handoff' && <Handoff d={d} set={set} project={project} pays={pays} received={received} client={client} />}
      {tab === 'talk' && <div className="grid2">
        <div className="card stack"><h2>Calls & meetings</h2><Activities dealId={id} clientId={d.clientId} subject={d.title} /></div>
        <div className="card stack"><h2>Message the client</h2><Message phone={d.phone} vars={{ client: (d.contactName || clientName(d.clientId)).split(' ')[0], service: d.service, quote: d.quoteNo, amount: inr(d.value) }} /></div>
        <div className="card stack"><h2>Comments</h2><Comments relType="deal" relId={id} /></div>
        <div className="card stack"><h2>Files</h2><Attachments value={d.files || []} onChange={(files) => set({ files })} /></div></div>}
      {tab === 'history' && <div className="card"><Log items={d.log} /></div>}
      </RO>
      {lost && <LostModal deal={d} onClose={() => setLost(false)} />}
    </>
  );
}

function Handoff({ d, set, project, pays, received, client }) {
  const nav = useNavigate(), h = d.handoff || {}, [f, setF] = useState({ scope: h.scope || d.notes || '', deadline: h.deadline || addDays(today(), 30), agreement: !!h.agreement, template: settings().projectTemplates[0]?.id || '' });
  const [pay, setPay] = useState(null);
  if (d.stage !== 'won') return <Empty>The handoff to IT opens when the deal is marked Won.</Empty>;
  async function handOver() {
    if (!f.scope.trim()) return toast('Write what was promised (scope) first, so IT knows what to build.', true);
    await set({ handoff: { ...h, scope: f.scope, deadline: f.deadline, agreement: f.agreement } });
    const tpl = settings().projectTemplates.find((t) => t.id === f.template);
    const p = await attempt(() => create('project', { name: d.title, clientId: d.clientId, clientName: client?.name || '', dealId: d.id, stage: h.advance ? 'planning' : 'awaiting', deadline: f.deadline, start: today(),
      scope: f.scope, lead: '', people: [d.owner, ...(d.people || [])].filter(Boolean), priority: !!d.priority, template: tpl?.name || '', templateId: tpl?.id || '' }));
    if (!p) return;
    if (canEdit('money') && !h.advance && !pays.some((x) => x.kind === 'advance')) await create('payment', { title: 'Advance', kind: 'advance', clientId: d.clientId, dealId: d.id, amount: Math.round((+d.value || 0) / 2), due: addDays(today(), 2), owner: d.owner, repeat: 'none' });
    toast(h.advance ? 'Handed over. The IT Manager will assign a lead.' : canEdit('money') ? 'Handed over. It waits for the advance – a “Collect advance” payment was added.' : 'Handed over. It waits for the advance. The Sales Manager records the payment.');
    nav('/projects/' + p.record.id);
  }
  return <div className="grid2">
    <div className="card stack"><h2>Handoff note for IT</h2>
      {project ? <div className="banner ok">Handed over: <Link to={'/projects/' + project.id}>{project.name}</Link></div> : null}
      <Field label="What exactly was promised (scope) *"><Area style={{ minHeight: 120 }} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="Pages, features, and what is NOT included" disabled={!!project} /></Field>
      <div className="form"><Field label="Deadline promised to client"><In type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} disabled={!!project} /></Field>
        <Field label="Project template"><Sel value={f.template} onChange={(v) => setF({ ...f, template: v })} options={settings().projectTemplates.map((t) => [t.id, t.name])} blank="No template" disabled={!!project} /></Field></div>
      <label className="check"><input type="checkbox" checked={f.agreement} onChange={(e) => setF({ ...f, agreement: e.target.checked })} /> Agreement signed (Company Secretary, for bigger deals)</label>
      <div className={'banner ' + (h.advance ? 'ok' : '')}>{h.advance ? 'Advance received – IT can start work.' : 'No advance yet. IT can see the project but cannot start work (not even planning) until the advance receipt is made.'}</div>
      {!project && <button className="btn primary" type="button" onClick={handOver}>Save & hand over to IT</button>}
    </div>
    {canMoney() ? <div className="card stack"><h2>Payment plan</h2>
      <div className="small">Received <b className="num">{inr(received)}</b> of <b className="num">{inr(d.value)}</b>{+d.value > received ? <> · balance <b className="num">{inr(d.value - received)}</b></> : null}</div>
      {pays.map((p) => <div key={p.id} className="row small"><span className="grow">{p.title}</span><span className="num">{inr(p.amount)}</span><Due date={p.status === 'paid' ? '' : p.due} /><Pill k={p.status === 'paid' ? 'ok' : ''}>{p.status === 'paid' ? 'Paid' : `Paid ${inr(p.paid || 0)}`}</Pill></div>)}
      <div className="row"><button className="btn sm" type="button" onClick={() => setPay({ title: 'Balance', kind: 'final', amount: Math.max(0, (+d.value || 0) - received), due: addDays(today(), 30) })}>+ Payment</button>
        <button className="btn sm" type="button" onClick={() => setPay({ title: 'Website maintenance', kind: 'maintenance', amount: 1500, due: addDays(today(), 30), repeat: 'monthly' })}>+ Maintenance fee</button>
        {canEdit('money') && <Link className="btn sm" to="/payments">Record a payment</Link>}</div>
    </div> : <div className="card stack"><h2>Payments</h2><p className="small muted" style={{ margin: 0 }}>Quotations, receipts and payments for this deal are handled by the Sales Manager and management.</p></div>}
    {pay && <Modal title="Add to payment plan" onClose={() => setPay(null)} footer={<button className="btn primary" type="button" onClick={async () => (await attempt(() => create('payment', { ...pay, amount: +pay.amount || 0, clientId: d.clientId, dealId: d.id, owner: d.owner, repeat: pay.repeat || 'none' }), 'Added.')) && setPay(null)}>Add</button>}>
      <div className="form">
        <Field label="For"><In value={pay.title} onChange={(e) => setPay({ ...pay, title: e.target.value })} /></Field>
        <Field label="Type"><Sel value={pay.kind} onChange={(v) => setPay({ ...pay, kind: v })} options={[['advance', 'Advance'], ['milestone', 'Instalment'], ['final', 'Final / balance'], ['maintenance', 'Maintenance fee'], ['renewal', 'Domain / hosting renewal'], ['other', 'Other']]} /></Field>
        <Field label="Amount (₹)"><In type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
        <Field label="Due date"><In type="date" value={pay.due} onChange={(e) => setPay({ ...pay, due: e.target.value })} /></Field>
        <Field label="Repeats"><Sel value={pay.repeat || 'none'} onChange={(v) => setPay({ ...pay, repeat: v })} options={[['none', 'No'], ['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['half', 'Every 6 months'], ['yearly', 'Every year']]} /></Field>
      </div></Modal>}
  </div>;
}
