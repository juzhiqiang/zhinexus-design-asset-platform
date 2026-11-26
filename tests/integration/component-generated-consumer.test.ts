import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {createProject} from '../../packages/component-cli/src/workbench/create.js';
import {resolvePnpmExecutable} from '../../packages/component-cli/src/local/pack.js';
import {resolveBindingModel} from '../../packages/component-cli/src/integration/bindings.js';
import {generateReactComponent} from '../../packages/component-cli/src/integration/generate-react.js';
import {generateVueComponent} from '../../packages/component-cli/src/integration/generate-vue.js';
import type {ComponentApiV1} from '@company/contracts';

it('普通双框架包真实打包安装后，结构化 API 生成的接入源码通过宿主编译器检查',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juz-generated-consumer-'));
 const run=(args:string[],cwd:string)=>promisify(execFile)(resolvePnpmExecutable(),args,{cwd,windowsHide:true,timeout:120000});
 try{
  await createProject(root,'demo','all');const project=path.join(root,'demo');
  await run(['install','--ignore-scripts','--config.manage-package-manager-versions=false'],project);
  for(const framework of ['react','vue'] as const){
   const pkg=path.join(project,'packages',framework);await run(['run','typecheck'],pkg);await run(['run','build'],pkg);
   const output=path.join(root,'packed-'+framework);await fs.mkdir(output);await run(['pack','--pack-destination',output],pkg);
   const tgz=path.join(output,(await fs.readdir(output)).find(f=>f.endsWith('.tgz'))!);
   const consumer=path.join(root,'consumer-'+framework);await fs.mkdir(consumer);
   await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({name:'ordinary-host',private:true,type:'module'}));
   const dependencies=framework==='react'?['react@19.3.1','react-dom@19.3.1','@types/react@19.3.0','@types/react-dom@19.3.0','typescript@7.0.2']:['vue@3.5.45','typescript@6.0.3','vue-tsc@3.3.14'];
   await run(['add',tgz,...dependencies,'--ignore-scripts','--config.manage-package-manager-versions=false'],consumer);
   const api:ComponentApiV1=JSON.parse(await fs.readFile(path.join(consumer,'node_modules','demo-'+framework,'api/demo.json'),'utf8'));
   expect(api.props.some(p=>p.name==='valueColor'&&p.editor?.kind==='color')).toBe(true);
   const model=resolveBindingModel({api,element:{instanceId:'card1',designId:'metric',status:'mapped',props:api.props,events:api.events.map(e=>({...e,handler:'changed'})),gaps:[]},packageName:'demo-'+framework,exportName:api.exportName,exportPath:api.exportPath});
   const source=framework==='react'?generateReactComponent(model):generateVueComponent(model);
   expect(source).not.toContain('charts-core');expect(source).not.toContain('.css');
   await fs.writeFile(path.join(consumer,'Host.'+(framework==='react'?'tsx':'vue')),source);
   await fs.writeFile(path.join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,noUncheckedIndexedAccess:true,skipLibCheck:false,...framework==='react'?{jsx:'react-jsx'}:{}},include:['Host.*']}));
   await run(['exec',framework==='react'?'tsc':'vue-tsc','--noEmit','-p','tsconfig.json'],consumer);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
},240000);
