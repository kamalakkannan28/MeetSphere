import { randomInt } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const part = (n) => Array.from({ length: n }, () => LETTERS[randomInt(LETTERS.length)]).join('');

/** Google-Meet-style meeting code: abc-defg-hij */
export const generateCode = () => `${part(3)}-${part(4)}-${part(3)}`;
export const isValidCode = (c) => typeof c === 'string' && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(c);
export const clamp = (s, n) => String(s ?? '').trim().slice(0, n);
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
