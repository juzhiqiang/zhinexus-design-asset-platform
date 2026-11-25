import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { projectPath, readProject, type LoadedProject } from '../project/config.js';
export const WORKSPACE_FILE = 'component.workspace.json';
const schema = z.strictObject({schemaVersion:z.literal(1),packages:z.array(z.string().min(1)).min(1)});
export type ComponentWorkspace = { root:string; projects:LoadedProject[] };
export async function readWorkspace(input:string, configFile?:string):Promise<ComponentWorkspace> {
  const root = await fs.realpath(input);
  let configs = [configFile ?? 'component.config.json'];
  if (!configFile) {
    try { configs = schema.parse(JSON.parse(await fs.readFile(await projectPath(root,WORKSPACE_FILE),'utf8'))).packages; }
    catch (error) { if (!(error instanceof Error && error.message.startsWith('PROJECT_FILE_MISSING')) && !(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  const projects:LoadedProject[]=[]; const paths=new Set<string>(); const ids=new Set<string>(); const categories=new Map<string,string|undefined>();
  for (const config of configs) {
    const real=await fs.realpath(await projectPath(root,config));
    if(paths.has(real)) continue; paths.add(real);
    const project=await readProject(root,config);
    if(projects.some(p=>p.packageDir===project.packageDir)) throw new Error('PACKAGE_DUPLICATE: '+project.pkg.name);
    for(const variant of project.config.variants) {
      const id=variant.componentId+'-'+variant.framework;
      if(ids.has(id)) throw new Error('CONFIG_DUPLICATE: '+id); ids.add(id);
      if(categories.has(variant.componentId) && categories.get(variant.componentId)!==variant.category) throw new Error('CATEGORY_CONFLICT: '+variant.componentId);
      categories.set(variant.componentId,variant.category);
    }
    projects.push(project);
  }
  return {root,projects};
}
export async function selectProject(workspace:ComponentWorkspace, selected?:string, select?:(label:string,choices:{value:string;label:string}[])=>Promise<string>):Promise<LoadedProject> {
  if(!selected && workspace.projects.length===1) return workspace.projects[0]!;
  selected ??= await select?.('package', workspace.projects.map(p=>({value:p.pkg.name,label:p.pkg.name+'@'+p.pkg.version})));
  const matches=workspace.projects.filter(p=>p.pkg.name===selected || p.config.packageDir===selected || path.relative(workspace.root,p.configPath).replace(/\\/g,'/')===selected);
  if(matches.length!==1) throw new Error('PACKAGE_SELECTION_REQUIRED: 使用 --package <包名、目录或配置路径> 选择唯一组件包');
  return matches[0]!;
}

