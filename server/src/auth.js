import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { HttpError } from './utils.js';

export function signToken(user, claims = {}) {
  return jwt.sign(
    { uid: user.uid, name: user.name, email: user.email || '', picture: user.picture || '', emailVerified: !!user.emailVerified, ...claims },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, issuer: 'meetsphere' },
  );
}

export function verifyToken(token) {
  const p = jwt.verify(token, config.jwtSecret, { issuer: 'meetsphere' });
  return { uid: p.uid, name: p.name, email: p.email, picture: p.picture, emailVerified: !!p.emailVerified, guest: p.guest === true, roomCode: p.roomCode, invitationHash: p.invitationHash };
}

/** Express middleware: requires "Authorization: Bearer <JWT>" */
export function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Missing token'));
  try {
    req.user = verifyToken(token);
    if (req.user.guest) return next(new HttpError(401, 'Account login required'));
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}
