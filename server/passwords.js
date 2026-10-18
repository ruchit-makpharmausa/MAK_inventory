import { randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(deriveKey);
const options = { N: 16384, r: 8, p: 1 };
export const validUsername = (value) => typeof value === 'string' && /^[a-zA-Z0-9._@-]{3,100}$/.test(value.trim());
export const validPassword = (value) => typeof value === 'string' && value.length >= 6 && value.length <= 256;

export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Password must contain between 6 and 256 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, options);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export const validPasswordHash = (value) => typeof value === 'string' && value.length === 168 && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value);

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256 || !validPasswordHash(encoded)) return false;
  const [, salt, hash] = encoded.split('$');
  const actual = await scrypt(password, salt, 64, options);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
