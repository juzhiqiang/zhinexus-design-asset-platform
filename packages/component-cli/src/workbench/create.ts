import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { projectPath, validateProjectConfig, type ProjectConfig, type ProjectVariant } from '../project/config.js';
import { consumerHtml, consumerSource, initialPlayground, reactSource,vueSource,vueDeclarations,templateVersions as v } from './templates.js';
import type { ComponentApiV1 } from '../contracts/component-api.js';
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
export async function addMissingMaterials(root:string,variant:ProjectVariant,packageName:string,scaffold=false) {
  const api:ComponentApiV1={schemaVersion:1,componentId:variant.componentId,framework:variant.framework,exportName:variant.exportName,exportPath:variant.exportPath,props:scaffold?[
    {name:'label',type:'string',required:false,schema:{type:'string',default:'Hello juz',description:'组件标题'}},
    {name:'value',type:'number',required:false,schema:{type:'number',default:42,description:'主数值'}},
    {name:'enabled',type:'boolean',required:false,schema:{type:'boolean',default:true}},
    {name:'color',type:'string',required:false,schema:{type:'string',default:'#A3D2FF',description:'标题和辅助文字颜色'},editor:{kind:'color'}},
    {name:'valueColor',type:'string',required:false,schema:{type:'string',title:'数字颜色',description:'只影响主数值，不影响标题和辅助文字',default:'#FF6B35'},editor:{kind:'color',group:'数值样式'}},
    {name:'data',type:'number[]',required:false,schema:{type:'array',items:{type:'number'},default:[]}},
  ]:[],events:scaffold?[{name:'change',payload:'{ value: number }',schema:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}}]:[],notes:scaffold?['普通组件；不依赖 ECharts。参数 schema/editor 同时供工作台、未来低代码与机器接入使用。']:['请补充真实 Props、事件及自定义挂载需求。']};
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
    if(!variant.playground)values[consumer+'/playground.json']=json(example);
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
    const variant:ProjectVariant={componentId:slug,framework:current,exportName:'Demo',exportPath:'.',sourceEntry:source,playground:prefix+'playground.json',api:prefix+'api/demo.json',docs:prefix+'docs/demo.md',consumer:{adapter:'vite',templateDir:prefix+'.juz/consumer',previewDir:'dist',previewEntry:'index.html'},readiness:{selector:'#app',states:['default','empty'],width:800,height:400,renderer:'canvas',theme:'light'}};
    const config:ProjectConfig={schemaVersion:1,packageDir,build:{program:'pnpm',args:['run','build']},dev:{[current]:{program:'pnpm',args:['run','dev']}},variants:[variant]};validateProjectConfig(config);
    const configFile=prefix+'component.config.json';configs.push(configFile);
    const devDependencies:Record<string,string>={vite:v.vite,typescript:current==='react'?v.typescript:v.vueTypescript,...current==='react'?{'@vitejs/plugin-react':v.reactPlugin,'@types/react':'19.3.0','@types/react-dom':'19.3.0',react:v.react,'react-dom':v.react}:{'@vitejs/plugin-vue':v.vuePlugin,'vue-tsc':v.vueTsc,vue:v.vue}};
    const compiler=current==='react'?'tsc':'vue-tsc';
    const files:Record<string,string>={
      [prefix+'package.json']:json({name,version:'0.0.1',private:false,type:'module',files:['dist','api','docs'],exports:{'.':{types:'./dist/index.d.ts',import:'./dist/index.js'},'./api/*':'./api/*'},scripts:{build:'vite build && '+compiler+' -p tsconfig.json --emitDeclarationOnly'+(current==='vue'?' && node .juz/declarations.mjs':''),typecheck:compiler+' -p tsconfig.json --noEmit',dev:'vite build --watch'},peerDependencies:current==='react'?{react:v.react,'react-dom':v.react}:{vue:v.vue},devDependencies,...framework==='all'?{}:{packageManager:'pnpm@12.18.0'}}),
      [configFile]:json(config),
      [prefix+'tsconfig.json']:json({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',...current==='react'?{jsx:'react-jsx'}:{},strict:true,skipLibCheck:true,declaration:true,rootDir:'src',outDir:'dist',lib:['ES2022','DOM'],types:['vite/client']},include:['src']}),
      [prefix+'vite.config.js']:[
        "import { defineConfig } from 'vite';",
        "import "+current+" from '@vitejs/plugin-"+current+"';",
        '',
        'export default defineConfig(({ command }) => {',
        "  if (command === 'build') process.env.NODE_ENV = 'production';",
        '  return {',
        '    plugins: ['+current+'()],',
        '    build: {',
        "      lib: { entry: 'src/index."+(current==='react'?'tsx':'ts')+"', formats: ['es'], fileName: 'index' },",
        "      rollupOptions: { external: "+(current==='react'?"id => /^(react|react-dom)(\\/|$)/.test(id)":"['vue']")+" },",
        '    },',
        '  };',
        '});','',
      ].join('\n'),
      [source]:current==='react'?"export { Demo, type DemoProps } from './Demo.js';\n":"export { default as Demo } from './Demo.vue';\n",
      [prefix+'src/Demo.'+(current==='react'?'tsx':'vue')]:current==='react'?reactSource:vueSource,
      ...current==='vue'?{[prefix+'.juz/declarations.mjs']:vueDeclarations}:{},
    };
    for(const [relative,content] of Object.entries(files)){const file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content,{flag:'wx'});}
    await addMissingMaterials(root,variant,name,true);
  }
  if(framework==='all')await fs.writeFile(path.join(root,'component.workspace.json'),json({schemaVersion:1,packages:configs}));
  await fs.writeFile(path.join(root,'.gitignore'),'node_modules/\ndist/\n.component-releases/\n.component-state/\n.component-release.json\n');
  await fs.writeFile(path.join(root,'README.md'),'# '+slug+'\n\n运行 pnpm install，然后 juz dev。本地开发无需登录。\n\n日常编辑 src/Demo.tsx（React）或 src/Demo.vue（Vue）；入口只负责导出。使用普通 Props、回调或 Emits，不需要平台基类。保存源码后工作台热更新。双框架项目在 packages/react 与 packages/vue 分别开发。\n\n在组件包内运行 pnpm typecheck、pnpm build。pnpm dev 为构建导出监听；juz dev 为源码调试工作台。\n\napi/demo.json 集中声明参数 schema、说明、默认值注解、编辑提示和事件载荷，供工作台、未来低代码和机器接入复用。新增参数时只需同步组件 Props 与 API；工作台自动派生控件。valueColor 只控制数字颜色，color 控制标题和辅助文字。普通 npm 导入仍直接使用组件，不加载元数据；需要时可显式读取包的 api/demo.json 子路径。\n\nplayground.json 只保存实例值、数据和预设状态，默认 controls 为空；旧显式控件仍可覆盖界面，但不能放宽 API 约束。default 是注解，不自动填入保存值；组件自身仍按常规方式提供默认值。docs/ 记录使用说明，component.config.json 登记入口与预览材料。\n\n.juz/ 是 CLI 生成的消费者桥接及声明工具，通常不需要编辑；应纳入版本管理，但不会进入组件 npm 包。复杂 Provider/插槽需求可登记自定义消费者，CLI 不推断业务初始化。\n\n发布前在工作台登录并分配后台分类，再打包验证和确认上传。\n');
  return {root,next:'cd '+directory+' && pnpm install && juz dev'};
}
