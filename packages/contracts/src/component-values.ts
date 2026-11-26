import type { ComponentApiV1 } from './component-api.js';
import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import { array, assertJson, canonicalJson, choice, integer, object, text, validateSchema, type Schema } from './schema.js';

/** Reference-free JSON Schema subset. Defaults are annotations, never implicit mutations. */
export type ComponentValueSchemaV1 = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';
  title?: string; description?: string; default?: unknown; enum?: (string | number | boolean | null)[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number; items?: ComponentValueSchemaV1;
  properties?: Record<string, ComponentValueSchemaV1>; required?: string[]; additionalProperties?: boolean;
};
export type ComponentEditorV1 = { kind: 'text' | 'number' | 'boolean' | 'enum' | 'color' | 'json'; group?: string };
export const componentEditorSchema = object({ kind: choice('text', 'number', 'boolean', 'enum', 'color', 'json'), group: text }, ['group']);
/** Structural boundary; recursive vocabulary, budgets and defaults are checked by validateComponentValueSchema. */
export const componentValueSchemaShape: Schema = {
  ...object({
    type: choice('string', 'number', 'integer', 'boolean', 'null', 'object', 'array'), title: text, description: text, default: {},
    enum: array({}, 1), minimum: { type: 'number' }, maximum: { type: 'number' },
    minLength: integer(), maxLength: integer(), minItems: integer(), maxItems: integer(),
    items: { type: 'object' }, properties: { type: 'object', additionalProperties: { type: 'object' } },
    required: array(text), additionalProperties: { type: 'boolean' },
  }, ['title', 'description', 'default', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'items', 'properties', 'required', 'additionalProperties']),
  description: 'Bounded reference-free JSON Schema subset; runtime additionally validates nested definitions, keyword/type consistency, defaults and depth/node limits.',
};
const dangerous = new Set(['__proto__', 'constructor', 'prototype']);
const pointer = (base: string, name: string) => base + '/' + name.replaceAll('~', '~0').replaceAll('/', '~1');

/** Compare public definitions, excluding instance bindings such as source/handler. */
export function sameComponentMember(left: ComponentApiV1['props'][number] | ComponentApiV1['events'][number], right: ComponentApiV1['props'][number] | ComponentApiV1['events'][number]): boolean {
  const definition = (member: typeof left) => ({ name: member.name,
    ...('type' in member ? { type: member.type, required: member.required, ...(member.editor ? { editor: member.editor } : {}) } : { payload: member.payload }),
    ...(member.schema ? { schema: member.schema } : {}),
  });
  return canonicalJson(definition(left)) === canonicalJson(definition(right));
}

export function validateComponentValueSchema(input: unknown): ValidationResult<ComponentValueSchemaV1> {
  const issues: ValidationIssue[] = []; let nodes = 0;
  const add = (path: string, message: string) => { if (issues.length < 100) issues.push({ code: 'INVALID_SCHEMA', path, message }); };
  try { assertJson(input); } catch { return { ok: false, issues: [{ code: 'INVALID_SCHEMA', path: '', message: 'Expected bounded JSON schema' }] }; }
  function visit(value: unknown, path: string, depth: number): void {
    if (++nodes > 256 || depth > 12) { add(path, 'Component schema exceeds depth/node budget'); return; }
    const shape = validateSchema<ComponentValueSchemaV1>(componentValueSchemaShape, value);
    if (!shape.ok) { for (const issue of shape.issues) add(path + issue.path, issue.message); return; }
    const s = shape.value; const before = issues.length;
    const keywords: Record<string, readonly string[]> = {
      string: ['minLength', 'maxLength'], number: ['minimum', 'maximum'], integer: ['minimum', 'maximum'],
      boolean: [], null: [], array: ['items', 'minItems', 'maxItems'], object: ['properties', 'required', 'additionalProperties'],
    };
    for (const key of Object.keys(s)) if (!['type', 'title', 'description', 'default', 'enum', ...keywords[s.type]!].includes(key)) add(pointer(path, key), 'Keyword does not apply to ' + s.type);
    for (const [min, max] of [[s.minimum, s.maximum], [s.minLength, s.maxLength], [s.minItems, s.maxItems]]) if (min !== undefined && max !== undefined && min > max) add(path, 'Minimum exceeds maximum');
    if (s.enum) {
      if (s.enum.length > 128 || new Set(s.enum.map(canonicalJson)).size !== s.enum.length) add(path + '/enum', 'Enum must contain unique bounded scalar values');
      for (const entry of s.enum) if ((entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)) || !validateSchema(s as Schema, entry).ok) add(path + '/enum', 'Enum member does not satisfy its schema');
    }
    if (s.type === 'array') { if (!s.items) add(path + '/items', 'Array items schema is required'); else visit(s.items, path + '/items', depth + 1); }
    if (s.type === 'object') {
      if (new Set(s.required ?? []).size !== (s.required ?? []).length) add(path + '/required', 'Duplicate required member');
      for (const name of s.required ?? []) if (!Object.hasOwn(s.properties ?? {}, name)) add(path + '/required', 'Required member must have a property schema');
      for (const [name, child] of Object.entries(s.properties ?? {})) {
        if (dangerous.has(name)) add(pointer(path + '/properties', name), 'Unsafe property name');
        visit(child, pointer(path + '/properties', name), depth + 1);
      }
    }
    if (issues.length === before && Object.hasOwn(s, 'default') && !validateSchema(s as Schema, s.default).ok) add(path + '/default', 'Default does not satisfy its schema');
  }
  visit(input, '', 0);
  return issues.length ? { ok: false, issues } : { ok: true, value: input as ComponentValueSchemaV1 };
}

function editorMatches(editor: ComponentEditorV1, schema: ComponentValueSchemaV1 | undefined, type: string): boolean {
  if (editor.kind === 'json') return true;
  const actual = schema?.type ?? type;
  if (editor.kind === 'enum') return actual === 'string' && !!schema?.enum?.length && schema.enum.every(v => typeof v === 'string');
  if (editor.kind === 'color' || editor.kind === 'text') return actual === 'string';
  if (editor.kind === 'number') return actual === 'number' || actual === 'integer';
  return actual === 'boolean';
}
export function componentInputIssues(api: Pick<ComponentApiV1, 'props' | 'events'>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [kind, members] of [['props', api.props], ['events', api.events]] as const) for (const [i, member] of members.entries()) {
    const base = '/' + kind + '/' + i;
    if (dangerous.has(member.name)) issues.push({ code: 'INVALID_SCHEMA', path: base + '/name', message: 'Unsafe member name' });
    if (member.schema) {
      const checked = validateComponentValueSchema(member.schema);
      if (!checked.ok) issues.push(...checked.issues.map(issue => ({ ...issue, path: base + '/schema' + issue.path })));
      else if ('type' in member && !schemaMatchesType(member.schema, member.type.trim())) issues.push({ code:'INVALID_SCHEMA', path:base+'/schema/type', message:'Schema conflicts with the public primitive type' });
    }
    if ('type' in member && member.editor) {
      if (!editorMatches(member.editor, member.schema, member.type)) issues.push({ code: 'INVALID_SCHEMA', path: base + '/editor', message: 'Editor does not match the property schema' });
      if (member.editor.kind === 'color' && member.schema && Object.hasOwn(member.schema, 'default') && !isColor(member.schema.default)) issues.push({ code: 'INVALID_SCHEMA', path: base + '/schema/default', message: 'Color default must be a six-digit hex color' });
    }
  }
  return issues.slice(0, 100);
}
const isColor = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
function schemaMatchesType(schema: ComponentValueSchemaV1, type: string): boolean {
  if (['string','number','boolean','null','object'].includes(type)) return schema.type === type || type === 'number' && schema.type === 'integer';
  const arrayType = /^(.+)\[\]$/.exec(type) ?? /^Array<(.+)>$/.exec(type);
  return !arrayType || schema.type === 'array' && !!schema.items && schemaMatchesType(schema.items, arrayType[1]!.trim());
}
function matchesLegacy(value: unknown, type: string): boolean {
  if (['string', 'number', 'boolean'].includes(type)) return typeof value === type && (type !== 'number' || Number.isFinite(value));
  const arrayType = /^(.+)\[\]$/.exec(type) ?? /^Array<(.+)>$/.exec(type);
  return arrayType ? Array.isArray(value) && value.every(item => matchesLegacy(item, arrayType[1]!.trim())) : true;
}
/** Unknown legacy named types remain documentation; only declared structured schemas claim full validation. */
export function validateComponentValues(api: Pick<ComponentApiV1, 'props' | 'events'>, input: unknown): ValidationResult<Record<string, unknown>> {
  const definitions = componentInputIssues(api);
  if (definitions.length) return { ok: false, issues: definitions };
  const shape = validateSchema<Record<string, unknown>>({ type: 'object', additionalProperties: {} }, input);
  if (!shape.ok) return shape;
  const issues: ValidationIssue[] = []; const value = shape.value;
  for (const name of Object.keys(value)) if (dangerous.has(name)) issues.push({ code: 'INVALID_SCHEMA', path: pointer('', name), message: 'Unsafe property name' });
  for (const prop of api.props) {
    if (!Object.hasOwn(value, prop.name)) { if (prop.required) issues.push({ code: 'INVALID_SCHEMA', path: pointer('', prop.name), message: 'Required property is missing' }); continue; }
    const actual = value[prop.name];
    if (prop.schema) {
      const checked = validateSchema(prop.schema as Schema, actual);
      if (!checked.ok) issues.push(...checked.issues.map(issue => ({ ...issue, path: pointer('', prop.name) + issue.path })));
    } else if (!matchesLegacy(actual, prop.type.trim())) issues.push({ code: 'INVALID_SCHEMA', path: pointer('', prop.name), message: 'Invalid property type' });
    if (prop.editor?.kind === 'color' && !isColor(actual)) issues.push({ code: 'INVALID_SCHEMA', path: pointer('', prop.name), message: 'Expected a six-digit hex color' });
  }
  return issues.length ? { ok: false, issues: issues.slice(0, 100) } : { ok: true, value };
}

const literal = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll(String.fromCharCode(8232), '\\u2028').replaceAll(String.fromCharCode(8233), '\\u2029');
/** Emit types from validated data only; no user-provided TypeScript or expressions are evaluated. */
export function componentValueType(input: ComponentValueSchemaV1): string {
  const checked = validateComponentValueSchema(input);
  if (!checked.ok) throw new Error('COMPONENT_SCHEMA_INVALID: ' + JSON.stringify(checked.issues));
  function emit(s: ComponentValueSchemaV1): string {
    if (s.enum) return s.enum.map(literal).join(' | ');
    if (s.type === 'array') return 'Array<' + emit(s.items!) + '>';
    if (s.type === 'object') {
      const fields = Object.entries(s.properties ?? {}).map(([name, child]) => literal(name) + (s.required?.includes(name) ? '' : '?') + ': ' + emit(child));
      if (s.additionalProperties !== false) fields.push('[key: string]: unknown');
      return fields.length ? '{ ' + fields.join('; ') + ' }' : 'Record<string, never>';
    }
    return s.type === 'integer' ? 'number' : s.type;
  }
  return emit(checked.value);
}
