import type { ValidationIssue } from './errors.js';
import type { ValidationResult } from './release-manifest.js';
import type { ComponentApiV1 } from './component-api.js';
import { componentInputIssues } from './component-values.js';
import { designIdInputSchema, validateDesignIdInput, type DesignIdInputV1 } from './design-id.js';
import { projectContextSchema, type ProjectContext } from './project-context.js';
import { duplicateIssues, propSchema, eventSchema, memberName, exportNameSchema, exportPathSchema, styleExportSchema } from './component-api.js';
import { array, artifactPath, choice, exactVersion, hash, object, text, validateSchema } from './schema.js';

export type ElementBindings = {instanceId:string;props:{name:string;source:string}[];events:{name:string;handler:string}[];layout?:string};
export type MatchPlanRequest = {design:DesignIdInputV1;context:ProjectContext;reactDomVersion?:string;bindings?:ElementBindings[]};
export const MATCH_GAP_CODES = ['UNMAPPED_ID','TARGET_UNAVAILABLE','API_UNSUPPORTED','UNKNOWN_PROP','UNKNOWN_EVENT','MISSING_PROP','MISSING_EVENT','LAYOUT_UNKNOWN','COMPATIBILITY_UNVERIFIED','REQUIREMENTS_UNASSESSED','DEPENDENCY_CONFLICT','EMPTY_DESIGN'] as const;
export type MatchGap = {code:typeof MATCH_GAP_CODES[number];message:string};
export type MatchTarget = {
  variantReleaseId:string;variantId:string;componentId:string;framework:'vue'|'react';packageName:string;packageVersion:string;packageSha256:string;exportName:string;exportPath:string;
  evidence:{kind:'api'|'docs';path:string;sha256:string}[];compatibility:{status:'verified'|'unverified';recordIds:string[]};
  examples:{id:string;previewEntry:string}[];styleExport?:string;readyMethod?:string;notes:string[];
};
export type MatchElement = {instanceId:string;designId:string;status:'mapped'|'gap';target?:MatchTarget;
  props:(ComponentApiV1['props'][number]&{source?:string})[];events:(ComponentApiV1['events'][number]&{handler?:string})[];layout?:string;gaps:MatchGap[]};
export type MatchPlanV1 = {schemaVersion:1;source:'design-id';inputDigest:string;ruleSetId:string;revision:string;context:ProjectContext;
  elements:MatchElement[];exactDependencies:{name:string;version:string}[];gaps:MatchGap[]};

const packageName={...text,pattern:'^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$'};
const gapSchema=object({code:choice(...MATCH_GAP_CODES),message:text});
const bindingSchema=object({instanceId:text,props:array(object({name:memberName,source:text})),events:array(object({name:memberName,handler:text})),layout:text},['layout']);
export const matchPlanRequestSchema=object({design:designIdInputSchema,context:projectContextSchema,reactDomVersion:exactVersion,bindings:array(bindingSchema)},['reactDomVersion','bindings']);
export const matchTargetSchema=object({
  variantReleaseId:text,variantId:text,componentId:text,framework:choice('vue','react'),packageName,packageVersion:exactVersion,packageSha256:hash,exportName:exportNameSchema,exportPath:exportPathSchema,
  evidence:array(object({kind:choice('api','docs'),path:artifactPath,sha256:hash}),2),
  compatibility:object({status:choice('verified','unverified'),recordIds:array(text)}),examples:array(object({id:text,previewEntry:artifactPath}),1),
  styleExport:styleExportSchema,readyMethod:exportNameSchema,notes:array(text),
},['styleExport','readyMethod']);
export const matchPlanSchema=object({schemaVersion:{type:'integer',const:1},source:{type:'string',const:'design-id'},inputDigest:hash,ruleSetId:text,revision:text,context:projectContextSchema,
  elements:array(object({instanceId:text,designId:text,status:choice('mapped','gap'),target:matchTargetSchema,
    props:array(object({...propSchema.properties!,source:text},['source','schema','editor'])),events:array(object({...eventSchema.properties!,handler:text},['handler','schema'])),layout:text,gaps:array(gapSchema)},['target','layout'])),
  exactDependencies:array(object({name:packageName,version:exactVersion})),gaps:array(gapSchema),
});

export function validateMatchPlanRequest(input:unknown):ValidationResult<MatchPlanRequest>{
  const checked=validateSchema<MatchPlanRequest>(matchPlanRequestSchema,input);if(!checked.ok)return checked;
  const request=checked.value;const design=validateDesignIdInput(request.design);
  const issues:ValidationIssue[]=design.ok?[]:design.issues.map(i=>({...i,path:'/design'+i.path}));
  const bindings=request.bindings??[];const instances=new Set(request.design.elements.map(e=>e.instanceId));
  issues.push(...duplicateIssues(bindings.map(b=>b.instanceId),'/bindings','instanceId'));
  bindings.forEach((binding,i)=>{
    if(!instances.has(binding.instanceId))issues.push({code:'REFERENCE_NOT_FOUND',path:`/bindings/${i}/instanceId`,message:'Binding must reference an input instance'});
    issues.push(...duplicateIssues(binding.props.map(p=>p.name),`/bindings/${i}/props`,'name'),...duplicateIssues(binding.events.map(e=>e.name),`/bindings/${i}/events`,'name'));
  });
  if(request.design.elements.length>1000||request.design.mapping.entries.length>2000||bindings.length>1000)issues.push({code:'INVALID_SCHEMA',path:'/design',message:'At most 1000 elements, 2000 mappings and 1000 binding sets per request'});
  return issues.length?{ok:false,issues:issues.slice(0,100)}:checked;
}
export function validateMatchPlan(input:unknown):ValidationResult<MatchPlanV1>{
  const checked=validateSchema<MatchPlanV1>(matchPlanSchema,input);if(!checked.ok)return checked;
  const plan=checked.value;const issues:ValidationIssue[]=[];
  const add=(path:string,message:string)=>issues.push({code:'INVALID_SCHEMA',path,message});
  issues.push(...duplicateIssues(plan.elements.map(e=>e.instanceId),'/elements','instanceId'),...duplicateIssues(plan.exactDependencies.map(d=>d.name),'/exactDependencies','name'));
  if(!plan.elements.length&&!plan.gaps.some(g=>g.code==='EMPTY_DESIGN'))add('/gaps','Empty design needs an explicit gap');
  if(plan.context.requirements.length&&!plan.gaps.some(g=>g.code==='REQUIREMENTS_UNASSESSED'))add('/gaps','Text requirements require an explicit assessment gap');
  plan.elements.forEach((element,i)=>{
    const path=`/elements/${i}`;
    if(element.status==='gap'){
      if(element.target||element.props.length||element.events.length||!element.gaps.length)add(path,'Unresolved elements require gaps and cannot expose target mappings');
      return;
    }
    const target=element.target;
    if(!target){add(path+'/target','Mapped element requires a target');return;}
    if(target.framework!==plan.context.framework)add(path+'/target/framework','Target framework must match context');
    const requireGap=(condition:boolean,code:MatchGap['code'])=>{if(condition&&!element.gaps.some(g=>g.code===code))add(path+'/gaps',`Missing explicit ${code} gap`);};
    requireGap(element.props.some(p=>p.required&&p.source===undefined),'MISSING_PROP');
    requireGap(element.events.some(e=>e.handler===undefined),'MISSING_EVENT');
    requireGap(element.layout===undefined,'LAYOUT_UNKNOWN');
    requireGap(target.compatibility.status==='unverified','COMPATIBILITY_UNVERIFIED');
    if((target.compatibility.status==='verified')!==(target.compatibility.recordIds.length>0))add(path+'/target/compatibility','Compatibility records must agree with status');
    if(new Set(target.compatibility.recordIds).size!==target.compatibility.recordIds.length)add(path+'/target/compatibility','Duplicate compatibility evidence');
    for(const kind of ['api','docs'])if(!target.evidence.some(e=>e.kind===kind))add(path+'/target/evidence','API and docs evidence are required');
    if(!plan.exactDependencies.some(d=>d.name===target.packageName&&d.version===target.packageVersion)&&!element.gaps.some(g=>g.code==='DEPENDENCY_CONFLICT'))add(path+'/target','Target package must appear in exact dependencies or carry a dependency conflict');
    issues.push(...duplicateIssues(element.props.map(p=>p.name),path+'/props','name'),...duplicateIssues(element.events.map(e=>e.name),path+'/events','name'));
    issues.push(...componentInputIssues(element).map(issue=>({...issue,path:path+issue.path})));
  });
  return issues.length?{ok:false,issues:issues.slice(0,100)}:checked;
}
