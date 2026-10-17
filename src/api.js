// Talks to the server and keeps one shared, live copy of the data for every screen.
import { useSyncExternalStore } from 'react';
import { canSee } from '../shared/access.js';

const S = { ready: false, me: null, users: [], settings: null, recs: new Map(), serverTime: null, version: 0, error: '', signedOut: '' };
const subs = new Set();
const cache = new Map();
function emit() { S.version++; cache.clear(); subs.forEach((f) => f()); }
export const useStore = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => S.version);
export const store = S;

// When the person last tapped, typed or scrolled. Every request says how long ago that was (x-idle, seconds), so a page left open still
// ends its sign-in after an hour without use (server/auth.js) – the page's own checks for changes do not count as use.
let lastUse = Date.now();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true, capture: true });
export const idleFor = () => Date.now() - lastUse;

export async function http(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-idle': String(Math.floor(idleFor() / 1000)) }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const type = r.headers.get('content-type') || '';
  const data = type.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error(data?.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return data;
}

export function list(type) {
  if (!cache.has(type)) cache.set(type, [...S.recs.values()].filter((r) => r.type === type && !r.deletedAt));
  return cache.get(type);
}
export const get = (id) => (id ? S.recs.get(id) || null : null);
const put = (r) => { if (r.deletedAt) S.recs.delete(r.id); else S.recs.set(r.id, r); };

let timer = null, lastBoot = 0;
export async function boot() {
  try {
    const b = await http('GET', '/bootstrap'); lastBoot = Date.now();
    Object.assign(S, { me: b.me, users: b.users, settings: b.settings, serverTime: b.serverTime, ready: true, error: '' });
    S.recs = new Map(b.records.map((r) => [r.id, r]));
    emit(); clearInterval(timer); timer = setInterval(poll, 12000);
    return true;
  } catch (e) { S.ready = true; S.me = null; S.error = e.status === 401 ? '' : e.message; if (e.status === 401 && !/^Please sign in/.test(e.message)) S.signedOut = e.message; emit(); return false; }
}
let polling = false;
export async function poll() {
  if (!S.me || polling || document.hidden) return; polling = true;
  try {
    const c = await http('GET', '/changes?since=' + encodeURIComponent(S.serverTime));
    // Something new points at a client, deal or project this screen does not hold yet: my access grew
    // (for example a first task in a project), so load everything again. At most once a minute.
    const grew = c.records.some((r) => !r.deletedAt && ((r.clientId && !S.recs.has(r.clientId)) || (r.projectId && canSee(S.me, 'projects') && !S.recs.has(r.projectId)) || (r.dealId && canSee(S.me, 'deals') && !S.recs.has(r.dealId))));
    if (grew && Date.now() - lastBoot > 60000) { polling = false; return void boot(); }
    c.records.forEach(put);
    if (c.users.length) { const m = new Map(S.users.map((u) => [u.id, u])); c.users.forEach((u) => m.set(u.id, u)); S.users = [...m.values()].sort((a, b) => a.name.localeCompare(b.name)); }
    if (c.settings && !!c.settings.leadSeesReports !== !!S.settings.leadSeesReports && S.me.title === 'itlead') { polling = false; return void boot(); } // what I may read changed
    if (c.settings) S.settings = c.settings;
    S.serverTime = c.serverTime; if (c.records.length || c.users.length || c.settings) emit();
  } catch (e) { if (e.status === 401) { S.me = null; S.signedOut = e.message; clearInterval(timer); emit(); } } finally { polling = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

export async function login(email, password) { await http('POST', '/auth/login', { email, password }); S.signedOut = ''; return boot(); }
// why: shown on the sign-in screen (the page signs itself out after an hour without use)
export async function logout(why = '') { await http('POST', '/auth/logout').catch(() => {}); clearInterval(timer); S.me = null; S.recs = new Map(); S.signedOut = why; emit(); }
// hidden: the enquiry joined a lead that belongs to someone else, so there is nothing to show here.
export async function create(type, data) { const r = await http('POST', '/records', { type, data }); if (!r.hidden) put(r.record); emit(); poll(); return r; }
export async function update(id, data) { const r = await http('PATCH', '/records/' + id, { data }); put(r.record); emit(); poll(); return r.record; }
export async function remove(id, reason = '') { await http('DELETE', '/records/' + id, { reason }); S.recs.delete(id); emit(); poll(); }
export async function saveSetting(key, value) { await http('PUT', '/settings/' + key, { value }); S.settings = { ...S.settings, [key]: value }; emit(); }
export async function refreshUsers() { await poll(); }
export async function upload(file) {
  if (file.size > 3_000_000) throw new Error('That file is too large (max 3 MB).');
  const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file); });
  return http('POST', '/files', { name: file.name, mime: file.type || 'application/octet-stream', data });
}
export function setMe(u) { S.me = u; S.users = S.users.map((x) => (x.id === u.id ? u : x)); emit(); }
export function upsertUser(u) { const m = new Map(S.users.map((x) => [x.id, x])); m.set(u.id, u); S.users = [...m.values()].sort((a, b) => a.name.localeCompare(b.name)); emit(); }
// A file the server makes (payslip PDFs, a ZIP of them) saved to the device under the server's file name (17 Oct 2026).
export async function download(path, fallback = 'download') {
  const r = await fetch('/api' + path, { credentials: 'same-origin', headers: { 'x-idle': String(Math.floor(idleFor() / 1000)) } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Download failed (${r.status})`); }
  const cd = r.headers.get('content-disposition') || '', m = cd.match(/filename\*=UTF-8''([^;]+)/), name = m ? decodeURIComponent(m[1]) : fallback;
  const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
