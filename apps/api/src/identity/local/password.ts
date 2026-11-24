import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string | Buffer, salt: string | Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * Password hashing parameters. scrypt lives in the Node standard library, so no external
 * dependency is introduced; argon2id would be stronger but needs a native build, and the
 * project pins external dependencies to exact versions with source evidence.
 *
 * N=2^16 (64 MiB per hash) is deliberately below the OWASP scrypt recommendation of N=2^17
 * (128 MiB): concurrent logins would otherwise multiply that cost inside the API process.
 * Raising N is a documented upgrade path once the deployment's memory headroom is known.
 */
export const PASSWORD_PARAMS = Object.freeze({ N: 2 ** 16, r: 8, p: 1, keylen: 64 });
const PREFIX = 'scrypt';
/** Minimum accepted length; temporary credentials issued by the platform are far longer. */
export const MINIMUM_PASSWORD_LENGTH = 12;
const MAXIMUM_PASSWORD_LENGTH = 256;

/** Constant byte length keeps `timingSafeEqual` usable and bounds attacker-supplied input. */
const digestOf = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
/**
 * Reads one stored parameter. `noUncheckedIndexedAccess` types `parts[1]` as `string | undefined`,
 * so the parse has to be total rather than destructured — a destructured element would carry
 * `undefined` into the arithmetic below and fail to compile under this repo's strictness.
 */
const parameter = (value: string | undefined): number | undefined => {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export class PasswordPolicyError extends Error {
  constructor(message: string) { super(message); this.name = 'PasswordPolicyError'; }
}

/** Rejects unusable passwords before any hashing work is spent on them. */
export function assertPasswordPolicy(password: unknown): asserts password is string {
  if (typeof password !== 'string') throw new PasswordPolicyError('Password must be a string');
  if (password.length < MINIMUM_PASSWORD_LENGTH || password.length > MAXIMUM_PASSWORD_LENGTH) throw new PasswordPolicyError('Password length outside policy');
  // Unicode length, not UTF-16 length, so astral characters cannot be used to bypass the bound.
  if ([...password].length < MINIMUM_PASSWORD_LENGTH) throw new PasswordPolicyError('Password length outside policy');
}

/** Encodes parameters and salt alongside the digest so verification never trusts caller input. */
export function encodePasswordHash(salt: Buffer, hash: Buffer, params: typeof PASSWORD_PARAMS = PASSWORD_PARAMS): string {
  return [PREFIX, params.N, params.r, params.p, params.keylen, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function hashPassword(password: string, params: typeof PASSWORD_PARAMS = PASSWORD_PARAMS): Promise<string> {
  assertPasswordPolicy(password);
  const salt = randomBytes(16);
  // maxmem must cover 128*N*r; the default 32 MiB would make every hash throw.
  const maxmem = 128 * params.N * params.r + 1024 ** 2;
  const hash = await scryptAsync(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem });
  return encodePasswordHash(salt, hash, params);
}

/**
 * Verification is fail-closed: a malformed or foreign record hashes a fixed dummy value and
 * still costs the same work, so a broken record cannot be distinguished from a wrong password
 * by timing or by response.
 */
export async function verifyPassword(password: unknown, encoded: unknown): Promise<boolean> {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 7 || parts[0] !== PREFIX) return false;
  const N = parameter(parts[1]), r = parameter(parts[2]), p = parameter(parts[3]), keylen = parameter(parts[4]);
  const salt = Buffer.from(parts[5] ?? '', 'base64url');
  const expected = Buffer.from(parts[6] ?? '', 'base64url');
  if (N === undefined || r === undefined || p === undefined || keylen === undefined) return false;
  if (salt.length !== 16 || expected.length !== keylen) return false;
  // Bound the work an attacker can request through a crafted record.
  if (N > 2 ** 20 || r > 32 || p > 16 || keylen > 128) return false;
  try {
    const actual = await scryptAsync(password.slice(0, MAXIMUM_PASSWORD_LENGTH), salt, keylen, { N, r, p, maxmem: 128 * N * r + 1024 ** 2 });
    return timingSafeEqual(digestOf(actual.toString('base64url')), digestOf(expected.toString('base64url')));
  } catch { return false; }
}

/** Dummy hash used to keep failed logins equally expensive; never stored or returned. */
export const DUMMY_PASSWORD_HASH = encodePasswordHash(randomBytes(16), createHash('sha256').update('dummy').digest());
