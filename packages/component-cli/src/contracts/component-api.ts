import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import { array, choice, object, text, validateSchema } from './schema.js';

export type ComponentApiV1 = {
  schemaVersion: 1; componentId: string; framework: 'vue'|'react'; exportName: string; exportPath: string;
  props: {name:string;type:string;required:boolean}[]; events: {name:string;payload:string}[];
  styleExport?: string; readyMethod?: string; notes: string[];
};
export const memberName = { ...text, pattern: '^[A-Za-z_$][A-Za-z0-9_$-]*$' };
export const exportNameSchema = { ...text, pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$' };
export const exportPathSchema = { ...text, pattern: '^\\.(?:/[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*)?$' };
export const styleExportSchema = { ...text, pattern: '^\\./[a-zA-Z0-9_/-]+\\.css$' };
export const propSchema = object({name:memberName,type:text,required:{type:'boolean'}});
export const eventSchema = object({name:memberName,payload:text});
export const componentApiSchema = object({
  schemaVersion:{type:'integer',const:1}, componentId:text, framework:choice('vue','react'), exportName:exportNameSchema, exportPath:exportPathSchema,
  props:array(propSchema),events:array(eventSchema),styleExport:styleExportSchema,readyMethod:exportNameSchema,notes:array(text),
}, ['styleExport', 'readyMethod']);
export function duplicateIssues(values: readonly string[], path: string, field: string): ValidationIssue[] {
  const seen = new Set<string>(); const issues: ValidationIssue[] = [];
  values.forEach((value,i)=> { if(seen.has(value) && issues.length<100) issues.push({code:'DUPLICATE_ID',path:`${path}/${i}/${field}`,message:'Duplicate identifier'}); seen.add(value); });
  return issues;
}
export function validateComponentApi(input: unknown): ValidationResult<ComponentApiV1> {
  const checked = validateSchema<ComponentApiV1>(componentApiSchema,input);
  if(!checked.ok) return checked;
  const api=checked.value;
  const issues=[...duplicateIssues(api.props.map(p=>p.name),'/props','name'),...duplicateIssues(api.events.map(e=>e.name),'/events','name')];
  const props=new Set(api.props.map(p=>p.name));
  api.events.forEach((e,i)=>{if(props.has(e.name)) issues.push({code:'CONFLICT',path:`/events/${i}/name`,message:'Event and property namespaces must not overlap'});});
  return issues.length?{ok:false,issues:issues.slice(0,100)}:checked;
}
