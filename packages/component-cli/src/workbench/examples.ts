import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validatePlayground, type PlaygroundV1 } from '../contracts/playground.js';
import { projectPath, readVariantApi, type LoadedProject, type ProjectVariant } from '../project/config.js';
import { computeBufferSha256 } from '../local/digest.js';
export async function readPlayground(project:LoadedProject, variant:ProjectVariant) {
  if(!variant.playground) return {value:{schemaVersion:1,adapter:'custom',props:{},controls:[],states:[]} as PlaygroundV1,digest:''};
  const bytes=await fs.readFile(await projectPath(project.root,variant.playground));
  return {value:checked(JSON.parse(bytes.toString('utf8'))),digest:computeBufferSha256(bytes)};
}
export function checked(input:unknown):PlaygroundV1 {
  const result=validatePlayground(input);
  if(!result.ok) throw new Error('PLAYGROUND_INVALID: '+JSON.stringify(result.issues));
  return result.value;
}
export async function validateExample(project:LoadedProject,variant:ProjectVariant,input:unknown) {
  const value=checked(input); const api=await readVariantApi(project,variant);
  for(const values of [value,...value.states]) for(const prop of api.props) {
    // Match the consumer's effective Props: a data binding overrides raw Props.
    const actual=value.dataProp===prop.name?values.data:values.props[prop.name];
    if(prop.required && actual===undefined) throw new Error('PLAYGROUND_INVALID: required '+prop.name);
    if(actual!==undefined && !matchesType(actual,prop.type.trim())) throw new Error('PLAYGROUND_INVALID: '+prop.name);
  }
  if(value.dataProp){
    const binding=value.dataProp;
    const bind=<T extends {props:Record<string,unknown>;data?:unknown}>(values:T)=>{
      const props={...values.props};delete props[binding];
      if(values.data!==undefined)props[binding]=values.data;
      return {...values,props};
    };
    checked({...bind(value),states:value.states.map(bind)});
  }
  return value;
}
function matchesType(value:unknown,type:string):boolean {
  if(['string','boolean','number'].includes(type))return typeof value===type&&(type!=='number'||Number.isFinite(value));
  const array=/^(.+)\[\]$/.exec(type)??/^Array<(.+)>$/.exec(type);
  if(array)return Array.isArray(value)&&value.every(item=>matchesType(item,array[1]!.trim()));
  // Arbitrary TypeScript expressions are documentation, never executable input.
  return true;
}
export async function savePlayground(project:LoadedProject,variant:ProjectVariant,expected:string,input:unknown) {
  if(!variant.playground) throw new Error('PLAYGROUND_NOT_CONFIGURED');
  const value=await validateExample(project,variant,input);
  const target=await projectPath(project.root,variant.playground); const lock=target+'.lock';
  let handle;
  try { handle=await fs.open(lock,'wx'); } catch { throw new Error('EXAMPLE_BUSY'); }
  const temporary=path.join(path.dirname(target),'.'+path.basename(target)+'.'+randomUUID()+'.tmp');
  try {
    if(computeBufferSha256(await fs.readFile(target))!==expected) throw new Error('EXAMPLE_CONFLICT: 文件已被其他编辑器修改，请重新载入');
    await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
    // Recheck immediately before replacement; the lock also serializes other juz editors.
    if(computeBufferSha256(await fs.readFile(target))!==expected) throw new Error('EXAMPLE_CONFLICT');
    await fs.rename(temporary,target);
    return readPlayground(project,variant);
  } finally { await handle.close(); await fs.rm(lock,{force:true}); await fs.rm(temporary,{force:true}); }
}
