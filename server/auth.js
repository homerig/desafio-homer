import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
}
export function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p.length === 2));
}
export function getSession(db, req, role) {
  const key = cookies(req)[role === 'admin' ? 'cumple_admin' : 'cumple_guest'];
  if (!key) return null;
  return db.prepare('SELECT * FROM sessions WHERE token=? AND role=? AND expires>?').get(digest(key), role, Date.now()) || null;
}
export function createSession(db, res, role, subject, production) {
  const key = token();
  const seconds = role === 'admin' ? 60 * 60 * 24 * 7 : 60 * 60 * 24 * 90;
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(key), role, subject, Date.now() + seconds * 1000);
  res.cookie(role === 'admin' ? 'cumple_admin' : 'cumple_guest', key, { httpOnly: true, sameSite: 'strict', secure: production, maxAge: seconds * 1000, path: '/' });
}
