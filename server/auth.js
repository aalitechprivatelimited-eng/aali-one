import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export const newId = (p = '') => p + randomBytes(9).toString('base64url');
export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 32).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const sha = (t) => createHash('sha256').update(t).digest('hex');
const DAYS = 30;

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.query('insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval \'30 days\')', [sha(token), userId]);
  return token;
}
export async function userFromToken(db, token) {
  if (!token) return null;
  const r = await db.query(`select u.* from sessions s join users u on u.id = s.user_id
    where s.token_hash = $1 and s.expires_at > now() and u.active`, [sha(token)]);
  return r.rows[0] || null;
}
export const dropSession = (db, token) => db.query('delete from sessions where token_hash = $1', [sha(token || '')]);
export function sessionCookie(token, secure) {
  return `aali_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? DAYS * 86400 : 0}${secure ? '; Secure' : ''}`;
}
export function readCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
export const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, title: u.title, team: u.team, phone: u.phone, isAdmin: u.is_admin, active: u.active, designation: u.designation || '', createdAt: u.created_at, removedAt: u.removed_at || null, removedReason: u.removed_reason || '', removedBy: u.removed_by || null,
  surname: u.surname && u.name.endsWith(u.surname) ? u.surname : '', firstName: u.surname && u.name.endsWith(u.surname) ? u.name.slice(0, -u.surname.length).trim() : u.name,
  company: u.team === 'management' ? 'Aali Group' : u.company || 'Aali Conssultancy' });

// Simple login throttle: 8 failures per email per 15 minutes (per server instance).
const fails = new Map();
export function tooManyFails(email) {
  const f = fails.get(email); if (!f) return false;
  if (Date.now() - f.at > 15 * 60e3) { fails.delete(email); return false; }
  return f.n >= 8;
}
export function noteFail(email) { const f = fails.get(email) || { n: 0, at: Date.now() }; f.n++; fails.set(email, f); }
export const clearFails = (email) => fails.delete(email);
