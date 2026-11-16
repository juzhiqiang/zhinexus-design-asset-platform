import type { EnvironmentV1 } from './reports.js';
import { canonicalJson } from './schema.js';
export { canonicalJson } from './schema.js';
import { environmentSchema } from './schemas.js';
import { validateSchema } from './schema.js';

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const manifestDigest = (input: unknown): Promise<string> => sha256(new TextEncoder().encode(canonicalJson(input)));

export function environmentProjection(input: EnvironmentV1) {
  const validated = validateSchema<EnvironmentV1>(environmentSchema, input);
  if (!validated.ok) throw new TypeError('Cannot key an invalid environment');
  const { frameworkVersion: _framework, echartsVersion: _engine, ...projection } = validated.value;
  return Object.fromEntries(Object.entries(projection).map(([key, value]) => [key, typeof value === 'string' ? (key === 'os' || key === 'arch' ? value.trim().normalize('NFC').toLowerCase() : value.trim().normalize('NFC')) : value]));
}
export const environmentKey = (input: EnvironmentV1): Promise<string> => manifestDigest(environmentProjection(input));
