import { scryptSync, randomBytes, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { isAdminUser } from '../shared/access.js';

export const newId = (p = '') => p + randomBytes(9).toString('base64url');
export const newKey = () => randomBytes(18).toString('base64url'); // 24 letters that cannot be guessed: a public link's key

// ---------- passwords: bcrypt ----------
// New and changed passwords are kept as bcrypt hashes (cost 12; BCRYPT_ROUNDS can lower it for the tests). Passwords kept earlier as
// scrypt still work, and are turned into bcrypt the next time that person signs in (login in server/app.js), so nobody has to reset one.
const rounds = () => Math.max(4, Math.min(14, +process.env.BCRYPT_ROUNDS || 12));
export const hashPassword = (pw) => bcrypt.hashSync(String(pw), rounds());
export const isOldHash = (stored) => String(stored).startsWith('scrypt:');
export function checkPassword(pw, stored) {
  const s = String(stored || '');
  if (s.startsWith('$2')) return bcrypt.compareSync(String(pw), s);
  const [kind, salt, hash] = s.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const a = scryptSync(String(pw), Buffer.from(salt, 'hex'), 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
// bcrypt reads only the first 72 bytes of a password, so a longer one is refused rather than cut short without saying.
export const passwordProblem = (pw) => (String(pw || '').length < 8 ? 'The password must have at least 8 characters.'
  : Buffer.byteLength(String(pw)) > 72 ? 'The password is too long: 72 letters at most.' : '');
// A wrong email takes as long to refuse as a wrong password, so the timing does not show which emails exist.
let NOBODY = '';
export const fakeCheck = (pw) => checkPassword(pw, (NOBODY ||= hashPassword(randomBytes(12).toString('hex'))));

// ---------- sign-in: a JWT in an HttpOnly cookie, tied to a session row ----------
// The cookie holds a JSON Web Token (HS256) naming the person and their session, which ends 12 hours after signing in. Every request
// checks the signature and the expiry, and then the session row – so signing out, being switched off, a password change or "sign out
// everywhere" end it at once, which a JWT alone cannot do. A session also ends after an hour with no tap or keypress (IDLE_MIN): the
// page sends how long it has been idle (x-idle) and the server keeps the last moment of real use, so a page left open (it keeps asking
// for changes) or a closed laptop still ends its session.
export const LIFE_HOURS = 12, IDLE_MIN = 60;
const sha = (t) => createHash('sha256').update(t).digest('hex');
const b64 = (v) => Buffer.from(v).toString('base64url');
// The signing key: JWT_SECRET when the host sets one (32+ characters), or else a random key made once and kept in the database
// (settings 'jwtKey' – never sent to a browser: only the keys in DEFAULT_SETTINGS are).
let KEY = '';
async function jwtKey(db) {
  if ((process.env.JWT_SECRET || '').length >= 32) return process.env.JWT_SECRET;
  if (KEY) return KEY;
  let r = (await db.query("select value from settings where key = 'jwtKey'")).rows[0];
  if (!r) { await db.query("insert into settings (key, value) values ('jwtKey', $1) on conflict (key) do nothing", [JSON.stringify(randomBytes(48).toString('base64url'))]);
    r = (await db.query("select value from settings where key = 'jwtKey'")).rows[0]; }
  return (KEY = r.value);
}
export const resetKeyCache = () => { KEY = ''; }; // tests
function sign(claims, key) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), body = b64(JSON.stringify(claims));
  return `${head}.${body}.${createHmac('sha256', key).update(`${head}.${body}`).digest('base64url')}`;
}
// → the claims, or null when the token is not ours, was changed, uses another algorithm, or has expired.
function verify(token, key) {
  const [head, body, sig] = String(token || '').split('.'); if (!head || !body || !sig) return null;
  const want = createHmac('sha256', key).update(`${head}.${body}`).digest(), got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let h, c; try { h = JSON.parse(Buffer.from(head, 'base64url').toString()); c = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (h.alg !== 'HS256' || !c.sub || !c.sid || !(c.exp * 1000 > Date.now())) return null;
  return c;
}
export async function createSession(db, userId) {
  const sid = randomBytes(32).toString('base64url'), now = Math.floor(Date.now() / 1000);
  await db.query(`insert into sessions (token_hash, user_id, expires_at, last_seen) values ($1, $2, now() + interval '${LIFE_HOURS} hours', now())`, [sha(sid), userId]);
  return sign({ sub: userId, sid, iat: now, exp: now + LIFE_HOURS * 3600 }, await jwtKey(db));
}
// The session's row in the sessions table (its key is a hash of the token's sid), for "sign out the other devices".
export async function sessionKey(db, token) { const c = verify(token, await jwtKey(db)); return c ? sha(c.sid) : ''; }
// token, and idle = seconds since the person last tapped or typed → { user } or { why: 'none' | 'ended' | 'idle' }.
export async function sessionUser(db, token, idle = 0) {
  if (!token) return { why: 'none' };
  const c = verify(token, await jwtKey(db)); if (!c) return { why: 'ended' };
  const u = (await db.query(`select u.*, s.last_seen from sessions s join users u on u.id = s.user_id
    where s.token_hash = $1 and s.user_id = $2 and s.expires_at > now() and u.active`, [sha(c.sid), c.sub])).rows[0];
  if (!u) return { why: 'ended' };
  // Ended when the page says nobody has tapped or typed for an hour, or when no real use has reached the server for an hour (a page
  // opened again after hours away starts its own idle count from zero, so the last use the server saw is checked too).
  const now = Date.now(), seen = u.last_seen ? Date.parse(u.last_seen) : now, idleMs = Math.min(86400, Math.max(0, +idle || 0)) * 1000, limit = (IDLE_MIN + 1) * 60000;
  if (idleMs > limit || now - seen > limit) { await db.query('delete from sessions where token_hash = $1', [sha(c.sid)]); return { why: 'idle' }; }
  const used = Math.max(seen, now - idleMs);
  if (!u.last_seen || used - seen > 60000) await db.query('update sessions set last_seen = $2 where token_hash = $1', [sha(c.sid), new Date(used).toISOString()]);
  delete u.last_seen; return { user: u };
}
export async function userFromToken(db, token) { return (await sessionUser(db, token)).user || null; }
export async function dropSession(db, token) { const k = await sessionKey(db, token); if (k) await db.query('delete from sessions where token_hash = $1', [k]); }
export function sessionCookie(token, secure) {
  return `aali_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? LIFE_HOURS * 3600 : 0}${secure ? '; Secure' : ''}`;
}
export function readCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
// name is what the screens show: the display name the person chose, or their full name. fullName is always the real name.
export const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.display || u.name, fullName: u.name, display: u.display || '', photo: u.photo || '', title: u.title, team: u.team, phone: u.phone, isAdmin: isAdminUser(u), hr: !!u.hr, personalEmail: u.personal_email || '', active: u.active, designation: u.designation || '', createdAt: u.created_at, removedAt: u.removed_at || null, removedReason: u.removed_reason || '', removedBy: u.removed_by || null,
  surname: u.surname && u.name.endsWith(u.surname) ? u.surname : '', firstName: u.surname && u.name.endsWith(u.surname) ? u.name.slice(0, -u.surname.length).trim() : u.name,
  company: u.team === 'management' ? 'Aali Group' : u.company || 'Aali Conssultancy' });

