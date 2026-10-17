// A notification sound of one's own (only the people in SOUND_PEOPLE – today Nikhil). It is kept on the server, so every device the person
// signs in on plays the same sound when a new notification arrives. Browsers play sound only after the person has clicked or typed on the
// page once; until then it stays silent instead of showing an error.
import { http, store } from './api.js';
import { SOUND_PEOPLE } from '../shared/access.js';

let mine; // the person's sound, once read: { fileId, name, volume } or null
export const hasSound = () => SOUND_PEOPLE.includes(store.me?.id);
export async function mySound(fresh = false) {
  if (!hasSound()) return null;
  if (mine === undefined || fresh) mine = (await http('GET', '/me/sound').catch(() => ({ sound: null }))).sound || null;
  return mine;
}
export function rememberSound(s) { mine = s; }
export async function playSound(s) {
  if (!s?.fileId) return;
  try { const a = new Audio('/api/files/' + s.fileId); a.volume = s.volume ?? 0.8; await a.play(); } catch {}
}
export async function notifySound() { if (hasSound()) await playSound(await mySound()); }
