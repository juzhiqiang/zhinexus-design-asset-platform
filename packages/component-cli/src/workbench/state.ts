import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { projectPath,type LoadedProject } from '../project/config.js';
import { computeBufferSha256,computeSourceDigest } from '../local/digest.js';
import { canonicalJson } from '../contracts/schema.js';
const schema=z.strictObject({configFile:z.string(),configDigest:z.string().regex(/^[a-f0-9]{64}$/),inputDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),packageName:z.string(),packageVersion:z.string(),bundleDir:z.string(),manifestDigest:z.string().regex(/^[a-f0-9]{64}$/)});
export type ReleasePointer=z.infer<typeof schema>;
export const configRelative=(project:LoadedProject)=>path.relative(project.root,project.configPath).replace(/\\/g,'/');
export function stateKey(project:LoadedProject){return computeBufferSha256(configRelative(project)+'\n'+project.pkg.name).slice(0,24);}
export async function pointerPath(project:LoadedProject){return projectPath(project.root,'.component-state/'+stateKey(project)+'.json',true);}
export async function inputFingerprint(project:LoadedProject){
 // Build commands may consume shared sources/configuration anywhere in the
 // declared project. A conservative root digest prevents stale implicit reuse.
 const entries:[string,string][]=[['config',canonicalJson(project.config)],['project',await computeSourceDigest(project.root,{ignore:['.tools','.next','test-results','playwright-report','.release']})],['package',await computeSourceDigest(project.packageDir,{ignore:['.component-state','.superpowers']})]];
 for(const relative of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','package-lock.json','npm-shrinkwrap.json','tsconfig.json','tsconfig.base.json']){
  try{entries.push(['root/'+relative,computeBufferSha256(await fs.readFile(await projectPath(project.root,relative)))]);}catch(error){if(!(error instanceof Error&&error.message.startsWith('PROJECT_FILE_MISSING')))throw error;}
 }
 for(const variant of project.config.variants)for(const relative of [variant.api,variant.docs,variant.playground,variant.sourceEntry,variant.consumer.templateDir].filter((s):s is string=>!!s)){
  const file=await projectPath(project.root,relative);const stat=await fs.stat(file);
  entries.push([relative,stat.isDirectory()?await computeSourceDigest(file):computeBufferSha256(await fs.readFile(file))]);
  if(relative===variant.sourceEntry)entries.push(['source-root/'+path.dirname(relative),await computeSourceDigest(path.dirname(file))]);
 }
 return computeBufferSha256(canonicalJson(entries.sort((a,b)=>a[0].localeCompare(b[0]))));
}
export async function readPointer(project:LoadedProject):Promise<ReleasePointer|undefined>{
 for(const file of [await pointerPath(project),await projectPath(project.root,'.component-release.json',true)]) {
  let input:unknown;try{input=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')continue;throw error;}
  const parsed=schema.safeParse(input);if(!parsed.success)throw new Error('RELEASE_POINTER_INVALID');
  const value=parsed.data;
  if(path.resolve(project.root,value.configFile)===project.configPath&&value.packageName===project.pkg.name&&value.packageVersion===project.pkg.version)return value;
 }
 return undefined;
}
export async function writePointer(project:LoadedProject,pointer:ReleasePointer){
 const target=await pointerPath(project);await fs.mkdir(path.dirname(target),{recursive:true});
 await fs.writeFile(target+'.tmp',JSON.stringify(pointer,null,2)+'\n');await fs.rename(target+'.tmp',target);
 // Preserve the old single-config entry point without sharing it across package configs.
 if(configRelative(project)==='component.config.json'){
  const legacy=await projectPath(project.root,'.component-release.json',true);
  await fs.writeFile(legacy+'.tmp',JSON.stringify(pointer,null,2)+'\n');await fs.rename(legacy+'.tmp',legacy);
 }
}
