import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {createProject} from '../../packages/component-cli/src/workbench/create.js';
import {resolvePnpmExecutable} from '../../packages/component-cli/src/local/pack.js';
const execute=promisify(execFile);

it('ordinary Vue SFCs typecheck and publish usable declarations to a clean NodeNext consumer',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juz-sfc-'));
 const run=(args:string[],cwd:string)=>execute(resolvePnpmExecutable(),args,{cwd,windowsHide:true,timeout:120000});
 try{
  await createProject(root,'demo','vue');const project=path.join(root,'demo');
  await run(['install','--ignore-scripts','--config.manage-package-manager-versions=false'],project);
  await run(['run','typecheck'],project);await run(['run','build'],project);
  await fs.mkdir(path.join(project,'src/types'));await fs.writeFile(path.join(project,'src/types/index.ts'),"export interface DemoProps {label?:string}\n");
  await fs.writeFile(path.join(project,'src/props.ts'),"export type {DemoProps} from './types';\n");
  const ordinarySfc='<script setup lang="ts">\nimport type {DemoProps} from "./props";\ndefineProps<DemoProps>();\n</script>\n<template><button>{{ label }}</button></template>\n';
  await fs.writeFile(path.join(project,'src/Demo.vue'),ordinarySfc);
  await fs.writeFile(path.join(project,'src/index.ts'),"export {default as Demo} from './Demo.vue';\nexport type {DemoProps} from './props';\nexport type LazyProps=import('./types').DemoProps;\nexport type Literal='./props';\n");
  await run(['run','typecheck'],project);await run(['run','build'],project);
  await fs.writeFile(path.join(project,'src/Demo.vue'),'<script setup lang="ts">\nconst props=defineProps<{label?:string}>();\nconst broken:number=props.label;\n</script>\n<template><button>{{ broken }}</button></template>\n');
  await expect(run(['run','typecheck'],project)).rejects.toMatchObject({code:2,stdout:expect.stringContaining('TS2322')});
  await fs.writeFile(path.join(project,'src/Demo.vue'),ordinarySfc);await run(['run','build'],project);
  expect(await fs.readFile(path.join(project,'dist/index.d.ts'),'utf8')).toContain("'./props'"); // A literal type is not a module specifier.
  const output=path.join(root,'packed');await fs.mkdir(output);await run(['pack','--pack-destination',output],project);
  const tarball=path.join(output,(await fs.readdir(output)).find(f=>f.endsWith('.tgz'))!);
  const consumer=path.join(root,'consumer');await fs.mkdir(consumer);await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
  await run(['add',tarball,'vue@3.5.45','typescript@6.0.3','--ignore-scripts','--config.manage-package-manager-versions=false'],consumer);
  const source=path.join(consumer,'index.ts');await fs.writeFile(source,"import {Demo} from 'demo-vue';\ntype Props=InstanceType<typeof Demo>['$props'];\nconst props:Props={label:'typed'};void props;\n");
  const check=['exec','tsc','index.ts','--noEmit','--strict','--skipLibCheck','false','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022'];
  await run(check,consumer);await fs.appendFile(source,"const invalid:Props={label:123};void invalid;\n");await expect(run(check,consumer)).rejects.toMatchObject({code:2,stdout:expect.stringContaining('TS2322')});
 }finally{await fs.rm(root,{recursive:true,force:true});}
},180000);
