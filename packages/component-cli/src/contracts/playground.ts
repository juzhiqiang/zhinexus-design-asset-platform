import { array, choice, object, text, validateSchema, type Schema } from './schema.js';
import type { ComponentApiV1 } from './component-api.js';
import type { ValidationResult } from './release-manifest.js';
export type PlaygroundValues = { props: Record<string, unknown>; data?: unknown };
export type PlaygroundControl = { name: string; kind: 'text'|'number'|'boolean'|'enum'|'color'|'json'; options?: string[]; min?: number; max?: number; label?: string; description?: string; group?: string };
export type PlaygroundV1 = PlaygroundValues & { schemaVersion: 1; adapter: 'auto'|'custom'; dataProp?: string; controls: PlaygroundControl[]; states: { id: string; label: string; props: Record<string, unknown>; data?: unknown }[] };
export type PlaygroundToFrame = { type: 'values'; values: PlaygroundValues } | { type: 'state'; id: string };
export type PlaygroundFromFrame = { type: 'status'; status: 'mounted'|'ready'|'error'|'limited'; message?: string; checks?: {name:string;status:'passed'|'failed'}[] } | { type: 'event'; name: string; payload: unknown; time: string };
const name: Schema = { ...text, pattern: '^[A-Za-z_$][A-Za-z0-9_$-]*$' };
const props: Schema = { type: 'object', additionalProperties: {} };
export const playgroundSchema = object({
  schemaVersion: { type: 'integer', const: 1 }, adapter: choice('auto','custom'), props, data: {}, dataProp: name,
  controls: array(object({ name, kind: choice('text','number','boolean','enum','color','json'), options: array(text,1), min: {type:'number'}, max: {type:'number'}, label:text, description:text, group:text }, ['options','min','max','label','description','group'])),
  states: array(object({ id: { ...text, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }, label: text, props, data: {} }, ['data'])),
}, ['data','dataProp']);
export function validatePlayground(input: unknown): ValidationResult<PlaygroundV1> {
  const result = validateSchema<PlaygroundV1>(playgroundSchema, input);
  if (!result.ok) return result;
  const value = result.value;
  const bad = (message: string): ValidationResult<PlaygroundV1> => ({ ok:false, issues:[{code:'INVALID_SCHEMA',path:'',message}] });
  if (new Set(value.controls.map(c=>c.name)).size !== value.controls.length || new Set(value.states.map(s=>s.id)).size !== value.states.length) return bad('Duplicate control/state');
  for (const values of [value, ...value.states]) for (const control of value.controls) {
    if (!Object.hasOwn(values.props,control.name)) continue;
    const item = values.props[control.name];
    if (control.kind === 'number' && (typeof item !== 'number' || (control.min !== undefined && item < control.min) || (control.max !== undefined && item > control.max)) || control.kind === 'boolean' && typeof item !== 'boolean' || ['text','color','enum'].includes(control.kind) && typeof item !== 'string' || control.kind === 'enum' && !control.options?.includes(String(item)) || control.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(String(item))) return bad('Invalid property: '+control.name);
  }
  return result;
}

/** UI hints are derived data; callers must persist the original example, not these controls. */
export function derivePlaygroundControls(api: Pick<ComponentApiV1,'props'>, overrides: readonly PlaygroundControl[]): PlaygroundControl[] {
  const result: PlaygroundControl[] = api.props.map(prop => {
    const schema = prop.schema; const type = schema?.type ?? prop.type;
    const kind = prop.editor?.kind ?? (schema?.enum?.every(v=>typeof v==='string') ? 'enum' : type === 'string' ? 'text' : type === 'number' || type === 'integer' ? 'number' : type === 'boolean' ? 'boolean' : 'json');
    return { name:prop.name, kind, ...(schema?.title?{label:schema.title}:{}), ...(schema?.description?{description:schema.description}:{}), ...(prop.editor?.group?{group:prop.editor.group}:{}),
      ...(kind==='enum'?{options:[...schema!.enum!] as string[]}:{}), ...(kind==='number'&&schema?.minimum!==undefined?{min:schema.minimum}:{}), ...(kind==='number'&&schema?.maximum!==undefined?{max:schema.maximum}:{}), };
  });
  for (const override of overrides) { const index=result.findIndex(item=>item.name===override.name); if(index<0)result.push({...override}); else result[index]={...result[index]!,...override}; }
  return result;
}
