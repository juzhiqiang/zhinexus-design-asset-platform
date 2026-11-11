import type { ValidationResult } from './release-manifest.js';
import type { ValidationIssue } from './errors.js';

/** The deliberately small JSON Schema 2020-12 vocabulary used by our schemas. */
export type Schema = {
  $schema?: string; $id?: string; title?: string; description?: string;
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, Schema>; required?: string[];
  additionalProperties?: boolean | Schema; items?: Schema; minItems?: number;
  minLength?: number; maxLength?: number; pattern?: string;
  minimum?: number; maximum?: number; exclusiveMinimum?: number;
  enum?: readonly unknown[]; const?: unknown; format?: 'date-time';
};
export const text: Schema = { type: 'string', minLength: 1, maxLength: 2048, pattern: '\\S' };
export const exactVersion: Schema = { ...text, pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$' };
export const hash: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
export const timestamp: Schema = { type: 'string', format: 'date-time' };
export const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Schema => ({ type: 'integer', minimum, maximum });
export const choice = (...values: string[]): Schema => ({ type: 'string', enum: values });
export const array = (items: Schema, minItems = 0): Schema => ({ type: 'array', items, minItems });
export const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object', properties, required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false,
});
// Portable POSIX-relative logical paths: no decoding, device aliases, ADS or Windows normalization ambiguity.
export const PATH_PATTERN = '^(?!/)(?!.*//)(?!.*(?:^|/)(?:\\.{1,2}|[cC][oO][nN]|[pP][rR][nN]|[aA][uU][xX]|[nN][uU][lL]|[cC][oO][mM][1-9]|[lL][pP][tT][1-9])(?:\\.[^/]*|/|$))(?!.*(?:[. ]/|[. ]$))[^/\\\\:%?#<>|"\\u0000-\\u0020]+(?:/[^/\\\\:%?#<>|"\\u0000-\\u0020]+)*$';
export const artifactPath: Schema = { ...text, pattern: PATH_PATTERN };

export function isTimestamp(value: string): boolean {
  // UTC-only wire representation; reject calendar rollover rather than Date.parse's coercion.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z');
}
const pointer = (path: string, key: string | number) => `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

/** Reject non-JSON JS objects too; callers must not obtain trusted types by passing class instances. */
export function assertJson(input: unknown): void {
  const active = new Set<object>(); let nodes = 0;
  function visit(value: unknown, depth: number): void {
    if (++nodes > 100_000 || depth > 64) throw new TypeError('JSON input exceeds validation budget');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || active.has(value)) throw new TypeError('Expected finite, acyclic JSON values');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Expected a JSON object');
    active.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) { if (!Object.hasOwn(value, i)) throw new TypeError('Sparse arrays are not JSON'); visit(value[i], depth + 1); }
    } else {
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || !descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new TypeError('Expected ordinary JSON properties');
        visit(descriptor.value, depth + 1);
      }
    }
    active.delete(value);
  }
  visit(input, 0);
}

export function validateSchema<T>(schema: Schema, input: unknown): ValidationResult<T> {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string, code: ValidationIssue['code'] = 'INVALID_SCHEMA') => { if (issues.length < 100) issues.push({ code, path, message }); };
  try { assertJson(input); } catch { return { ok: false, issues: [{ code: 'INVALID_SCHEMA', path: '', message: 'Expected finite, acyclic JSON within the validation budget' }] }; }
  function visit(s: Schema, value: unknown, path: string): void {
    if (issues.length >= 100) return;
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (s.type && (s.type === 'integer' ? !Number.isSafeInteger(value) : actual !== s.type)) { add(path, `Expected ${s.type}`); return; }
    if (s.enum && !s.enum.includes(value)) add(path, 'Value is not in the allowed enum');
    if (Object.hasOwn(s, 'const') && value !== s.const) add(path, 'Value differs from the required constant');
    if (typeof value === 'string') {
      if (s.minLength !== undefined && value.length < s.minLength || s.maxLength !== undefined && value.length > s.maxLength) add(path, 'String length is outside allowed bounds');
      if (s.pattern && !new RegExp(s.pattern).test(value)) add(path, 'String does not match the required pattern', s.pattern === PATH_PATTERN ? 'INVALID_PATH' : 'INVALID_SCHEMA');
      if (s.format === 'date-time' && !isTimestamp(value)) add(path, 'Expected a real UTC ISO-8601 timestamp');
    }
    if (typeof value === 'number') {
      if (s.minimum !== undefined && value < s.minimum || s.maximum !== undefined && value > s.maximum || s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) add(path, 'Number is outside allowed bounds');
    }
    if (Array.isArray(value)) {
      if (s.minItems !== undefined && value.length < s.minItems) add(path, 'Array has too few entries');
      if (s.items) value.forEach((item, i) => visit(s.items!, item, pointer(path, i)));
    } else if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of s.required ?? []) if (!Object.hasOwn(record, key)) add(pointer(path, key), 'Required field is missing');
      for (const [key, field] of Object.entries(record)) {
        const child = s.properties && Object.hasOwn(s.properties, key) ? s.properties[key] : undefined;
        if (child) visit(child, field, pointer(path, key));
        else if (s.additionalProperties === false) add(pointer(path, key), 'Unknown field');
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') visit(s.additionalProperties, field, pointer(path, key));
      }
    }
  }
  visit(schema, input, '');
  return issues.length ? { ok: false, issues } : { ok: true, value: input as T };
}
