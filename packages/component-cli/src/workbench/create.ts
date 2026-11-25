import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { projectPath, validateProjectConfig, type ProjectConfig, type ProjectVariant } from '../project/config.js';
import { consumerHtml, consumerSource, initialPlayground, templateVersions as v } from './templates.js';
import type { ComponentApiV1 } from '../contracts/component-api.js';
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
export async function addMissingMaterials(root:string,variant:ProjectVariant,packageName:string,scaffold=false) {
  const api:ComponentApiV1={schemaVersion:1,componentId:variant.componentId,framework:variant.framework,exportName:variant.exportName,exportPath:variant.exportPath,props:scaffold?[{name:'label',type:'string',required:false},{name:'value',type:'number',required:false},{name:'enabled',type:'boolean',required:false},{name:'color',type:'string',required:false},{name:'data',type:'number[]',required:false}]:[],events:scaffold?[{name:'change',payload:'{ value: number }'}]:[],notes:scaffold?['普通组件；不依赖 ECharts']:['请补充真实 Props、事件及自定义挂载需求。']};
  const example=scaffold?initialPlayground():{schemaVersion:1,adapter:'custom',props:{},controls:[],states:[{id:'default',label:'默认',props:{}}]};
  const values:Record<string,string>={ [variant.api]:json(api), [variant.docs]:'# '+variant.exportName+'\n\n'+(scaffold?'可通过工作台调节参数、点击触发 change 事件。':'请补充组件用途、参数及挂载要求。')+'\n' };
  if(variant.playground) values[variant.playground]=json(example);
  const consumer=variant.consumer.templateDir;
  let hasConsumer=false;try{hasConsumer=(await fs.readdir(await projectPath(root,consumer))).length>0;}catch(error){if(!(error instanceof Error&&error.message.startsWith('PROJECT_FILE_MISSING')))throw error;}
  if(!hasConsumer) {
    const dependencies=variant.framework==='react'?{react:v.react,'react-dom':v.react}:{vue:v.vue};
    values[consumer+'/package.json']=json({name:'juz-consumer',version:'0.0.0',private:true,type:'module',dependencies,devDependencies:{vite:v.vite}});
    values[consumer+'/index.html']=consumerHtml;
    values[consumer+'/main.js']=consumerSource(packageName,variant,api);
    values[consumer+'/playground.json']=json(example);
    values[consumer+'/vite.config.js']="export default { base: './' };\n";
  }
  for(const [relative,content] of Object.entries(values)) {
    const file=await projectPath(root,relative,true);await fs.mkdir(path.dirname(file),{recursive:true});
    try{await fs.writeFile(file,content,{flag:'wx'});}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'))throw error;}
  }
}
export async function createProject(cwd:string,directory:string,framework:string) {
  if(!['react','vue','all'].includes(framework)||!directory||directory.startsWith('--'))throw new Error('ARGUMENT_INVALID: create <目录> --framework react|vue|all');
  const root=path.resolve(cwd,directory);await fs.mkdir(root,{recursive:false});
  const slug=path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/^-+/,'')||'component-demo';
  const frameworks=framework==='all'?['react','vue'] as const:[framework as 'react'|'vue'];const configs:string[]=[];
  if(framework==='all') {
    await fs.writeFile(path.join(root,'package.json'),json({name:slug,private:true,version:'0.0.0',packageManager:'pnpm@12.18.0'}));
    await fs.writeFile(path.join(root,'pnpm-workspace.yaml'),"packages:\n  - packages/*\nsaveExact: true\nallowBuilds:\n  esbuild: true\n");
  }
  for(const current of frameworks) {
    const prefix=framework==='all'?'packages/'+current+'/':'';const packageDir=prefix.slice(0,-1)||'.';
    const name=slug+'-'+current;const source=prefix+'src/index.'+(current==='react'?'tsx':'ts');
    const variant:ProjectVariant={componentId:slug,framework:current,exportName:'Demo',exportPath:'.',sourceEntry:source,playground:prefix+'playground.json',api:prefix+'api/demo.json',docs:prefix+'docs/demo.md',consumer:{adapter:'vite',templateDir:prefix+'consumer',previewDir:'dist',previewEntry:'index.html'},readiness:{selector:'#app',states:['default','empty'],width:800,height:400,renderer:'canvas',theme:'light'}};
    const config:ProjectConfig={schemaVersion:1,packageDir,build:{program:'pnpm',args:['run','build']},dev:{[current]:{program:'pnpm',args:['run','dev']}},variants:[variant]};validateProjectConfig(config);
    const configFile=prefix+'component.config.json';configs.push(configFile);
    const devDependencies:Record<string,string>={vite:v.vite,typescript:v.typescript,...current==='react'?{'@vitejs/plugin-react':v.reactPlugin,'@types/react':'19.3.0','@types/react-dom':'19.3.0',react:v.react,'react-dom':v.react}:{'@vitejs/plugin-vue':v.vuePlugin,vue:v.vue}};
    const files:Record<string,string>={
      [prefix+'package.json']:json({name,version:'0.0.1',private:false,type:'module',files:['dist'],exports:{'.':{types:'./dist/index.d.ts',import:'./dist/index.js'}},scripts:{build:'vite build && tsc -p tsconfig.json --emitDeclarationOnly',typecheck:'tsc -p tsconfig.json --noEmit',dev:'vite build --watch'},peerDependencies:current==='react'?{react:v.react,'react-dom':v.react}:{vue:v.vue},devDependencies,...framework==='all'?{}:{packageManager:'pnpm@12.18.0'}}),
      [configFile]:json(config),
      [prefix+'tsconfig.json']:json({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,skipLibCheck:true,declaration:true,rootDir:'src',outDir:'dist',lib:['ES2022','DOM']},include:['src']}),
      [prefix+'vite.config.js']:"import { defineConfig } from 'vite';\n"+(current==='react'?"import react from '@vitejs/plugin-react';":"import vue from '@vitejs/plugin-vue';")+"\nexport default defineConfig({plugins:["+current+"()],build:{lib:{entry:'src/index."+(current==='react'?'tsx':'ts')+"',formats:['es'],fileName:'index'},rollupOptions:{external:["+(current==='react'?"'react','react-dom','react/jsx-runtime'":"'vue'")+"]}}});\n",
      [source]:current==='react'?`import { createElement } from 'react';
export type DemoProps={label?:string;value?:number;enabled?:boolean;color?:string;data?:number[];onChange?:(event:{value:number})=>void};
export function Demo({label='Hello juz',value=42,enabled=true,color='#A3D2FF',data=[],onChange}:DemoProps){return createElement('button',{disabled:!enabled,onClick:()=>onChange?.({value:value+1}),style:{width:'100%',height:'100%',padding:32,border:0,borderRadius:12,background:'#172731',color,font:'inherit',textAlign:'left',cursor:'pointer'}},createElement('h1',null,label),createElement('strong',{style:{fontSize:56}},String(value)),createElement('p',null,JSON.stringify(data)));}
`:`import { defineComponent, h, type PropType } from 'vue';
export const Demo=defineComponent({name:'Demo',props:{label:{type:String,default:'Hello juz'},value:{type:Number,default:42},enabled:{type:Boolean,default:true},color:{type:String,default:'#A3D2FF'},data:{type:Array as PropType<number[]>,default:()=>[]}},emits:['change'],setup(props,{emit}){return()=>h('button',{disabled:!props.enabled,onClick:()=>emit('change',{value:props.value+1}),style:{width:'100%',height:'100%',padding:'32px',border:0,borderRadius:'12px',background:'#172731',color:props.color,font:'inherit',textAlign:'left',cursor:'pointer'}},[h('h1',props.label),h('strong',{style:{fontSize:'56px'}},String(props.value)),h('p',JSON.stringify(props.data))]);}});
`,
    };
    for(const [relative,content] of Object.entries(files)){const file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content,{flag:'wx'});}
    await addMissingMaterials(root,variant,name,true);
  }
  if(framework==='all')await fs.writeFile(path.join(root,'component.workspace.json'),json({schemaVersion:1,packages:configs}));
  await fs.writeFile(path.join(root,'.gitignore'),'node_modules/\ndist/\n.component-releases/\n.component-state/\n.component-release.json\n');
  await fs.writeFile(path.join(root,'README.md'),'# '+slug+'\n\n运行 pnpm install，然后 juz dev。本地开发无需登录。发布前在工作台登录并分配后台分类。\n');
  return {root,next:'cd '+directory+' && pnpm install && juz dev'};
}
