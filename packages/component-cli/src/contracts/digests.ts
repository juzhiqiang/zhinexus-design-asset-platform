import type { EnvironmentV1 } from './reports.js';
import { assertJson } from './schema.js';
import { environmentSchema } from './schemas.js';
import { validateSchema } from './schema.js';

/** v1 encoding: UTF-8 JSON, recursive UTF-16 key ordering, unchanged array order, no whitespace. */
export function canonicalJson(input: unknown): string {
  assertJson(input);
  function encode(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
    if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  return encode(input);
}
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
