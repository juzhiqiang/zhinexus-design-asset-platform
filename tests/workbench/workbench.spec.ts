import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test,expect} from '@playwright/test';
import {createProject} from '../../packages/component-cli/src/workbench/create.js';
import {startWorkbench} from '../../packages/component-cli/src/workbench/server.js';
import {resolvePnpmExecutable} from '../../packages/component-cli/src/local/pack.js';
import {request} from 'node:http';
async function upgradeStatus(url:string,origin:string){return new Promise<number>(resolve=>{const req=request(url.replace('ws:','http:'),{headers:{origin,connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ=='}},res=>{res.resume();resolve(res.statusCode??0);});req.on('upgrade',(res,socket)=>{socket.destroy();resolve(res.statusCode??0);});req.on('error',()=>resolve(0));req.setTimeout(2000,()=>{req.destroy();resolve(0);});req.end();});}
let root:string,service:Awaited<ReturnType<typeof startWorkbench>>;
test.beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'juz-browser-'));await createProject(root,'demo','all');await promisify(execFile)(resolvePnpmExecutable(),['install','--ignore-scripts','--config.manage-package-manager-versions=false'],{cwd:path.join(root,'demo'),windowsHide:true,timeout:120000});service=await startWorkbench({root:path.join(root,'demo'),version:'0.1.0',port:0});});
test.afterEach(async()=>{await service?.close();if(root)await fs.rm(root,{recursive:true,force:true});});

test('overlapping validation preserves edits to different controls and ignores stale failures after framework switches',async({page})=>{
 await page.goto(service.url);const frame=page.frameLocator('iframe');await expect(frame.getByRole('heading',{name:'Hello juz'})).toBeVisible();
 const pending:(()=>Promise<void>)[]=[];
 await page.route('**/api/validate',async route=>{const response=await route.fetch();await new Promise<void>(resolve=>{pending.push(async()=>{await route.fulfill({response});resolve();});});});
 try{
  await page.getByLabel('label',{exact:true}).fill('Concurrent label');await expect.poll(()=>pending.length).toBe(1);
  await page.getByLabel('value',{exact:true}).fill('99');await expect.poll(()=>pending.length).toBe(2);
  await expect(page.getByRole('button',{name:'保存示例',exact:true})).toBeDisabled();
  await pending.pop()!();await pending.pop()!();
  await expect(frame.getByRole('heading',{name:'Concurrent label'})).toBeVisible();await expect(frame.locator('#app strong')).toHaveText('99');
  await expect(page.locator('#props-json')).toHaveValue(/Concurrent label/);
  await page.getByLabel('数据 JSON',{exact:true}).fill('"invalid array"');await page.getByRole('button',{name:'应用数据',exact:true}).click();await expect.poll(()=>pending.length).toBe(1);
  await page.getByRole('button',{name:'Vue',exact:true}).click();await expect(frame.getByRole('heading',{name:'Hello juz'})).toBeVisible();await pending.pop()!();
  await expect(page.getByRole('alert')).toBeHidden();
  await page.getByRole('button',{name:'React',exact:true}).click();await expect(frame.getByRole('heading',{name:'Concurrent label'})).toBeVisible();
 }finally{for(const release of pending)await release();}
});

test('source preview uses project aliases, plugins and CSS configuration without exposing compiler credentials',async({page})=>{
 const project=path.join(root,'demo'),pkg=path.join(project,'packages/react');
 const config=JSON.parse(await fs.readFile(path.join(pkg,'component.config.json'),'utf8'));
 await fs.writeFile(path.join(project,config.variants[0].sourceEntry),"import {createElement} from 'react';import {message} from '@/message';import suffix from 'virtual:project-suffix';import styles from '@/style.module.css';export function Demo(){return createElement('h1',{className:styles.title},message+suffix);}");
 await fs.writeFile(path.join(pkg,'src/message.ts'),"export const message='Project alias';");await fs.writeFile(path.join(pkg,'src/style.module.css'),'.title { color: rgb(12, 34, 56) }');
 await fs.writeFile(path.join(pkg,'vite.config.js'),"import react from '@vitejs/plugin-react';import{resolve}from'node:path';import{writeFileSync}from'node:fs';writeFileSync("+JSON.stringify(path.join(project,'config-env.json'))+",JSON.stringify({token:process.env.ZHINEXUS_API_TOKEN}));export default {plugins:[react(),{name:'project-virtual',resolveId(id){if(id==='virtual:project-suffix')return '\\0project-suffix';},load(id){if(id==='\\0project-suffix')return 'export default \" plugin\";';}}],resolve:{alias:{'@':resolve('src')}},css:{modules:{generateScopedName:'project_[local]'}},server:{host:'0.0.0.0',cors:true,fs:{strict:false}}};");
 const old=process.env.ZHINEXUS_API_TOKEN;process.env.ZHINEXUS_API_TOKEN='synthetic-config-test';
 try{
  await page.goto(service.url);const heading=page.frameLocator('iframe').getByRole('heading',{name:'Project alias plugin'});await expect(heading).toBeVisible();await expect(heading).toHaveClass('project_title');await expect(heading).toHaveCSS('color','rgb(12, 34, 56)');
  expect(JSON.parse(await fs.readFile(path.join(project,'config-env.json'),'utf8'))).toEqual({});
  await fs.writeFile(path.join(pkg,'src/message.ts'),"export const message='Changed alias';");await expect(page.frameLocator('iframe').getByRole('heading',{name:'Changed alias plugin'})).toBeVisible();
  const preview=new URL((await page.locator('iframe').getAttribute('src'))!);expect((await fetch(new URL('message',preview),{headers:{origin:'http://evil.example'}})).status).toBe(404);
 }finally{if(old===undefined)delete process.env.ZHINEXUS_API_TOKEN;else process.env.ZHINEXUS_API_TOKEN=old;}
});

test('pending saves remain attached to their implementation and preserve later edits',async({page})=>{
 await page.goto(service.url);const frame=page.frameLocator('iframe');await expect(frame.getByRole('heading',{name:'Hello juz'})).toBeVisible();
 let release:()=>void=()=>{},received=false;
 await page.route('**/api/save',async route=>{const response=await route.fetch();const waiting=new Promise<void>(resolve=>{release=resolve;});received=true;await waiting;await route.fulfill({response});});
 try{
  await page.getByLabel('label',{exact:true}).fill('React saved');await expect(frame.getByRole('heading',{name:'React saved'})).toBeVisible();await page.getByRole('button',{name:'保存示例',exact:true}).click();await expect.poll(()=>received).toBe(true);
  await page.getByRole('button',{name:'Vue',exact:true}).click();await expect(frame.getByRole('heading',{name:'Hello juz'})).toBeVisible();release();await expect(page.locator('#notice')).toContainText('示例已保存');
  await expect(page.getByLabel('label',{exact:true})).toHaveValue('Hello juz');
  await page.getByRole('button',{name:'React',exact:true}).click();await expect(frame.getByRole('heading',{name:'React saved'})).toBeVisible();
  received=false;await page.getByLabel('label',{exact:true}).fill('First edit');await expect(frame.getByRole('heading',{name:'First edit'})).toBeVisible();await page.getByRole('button',{name:'保存示例',exact:true}).click();await expect.poll(()=>received).toBe(true);
  await page.getByLabel('label',{exact:true}).fill('Later edit');await expect(frame.getByRole('heading',{name:'Later edit'})).toBeVisible();release();await expect(page.locator('#notice')).toContainText('示例已保存');await expect(page.getByLabel('label',{exact:true})).toHaveValue('Later edit');
  expect(JSON.parse(await fs.readFile(path.join(root,'demo/packages/react/playground.json'),'utf8')).props.label).toBe('First edit');
  await expect(page.getByRole('button',{name:'保存示例',exact:true})).toBeEnabled();
 }finally{release();}
});

for(const hook of ['config','configResolved','configureServer'])test('project '+hook+' cannot relax preview filesystem policy',async({page})=>{
 const project=path.join(root,'demo'),pkg=path.join(project,'packages/react');
 const outside=path.join(root,'outside.txt');await fs.writeFile(outside,'synthetic-outside-file');
 await fs.writeFile(path.join(project,'.env'),'JUZ_UNSAFE_TEST=synthetic-env-file\n');
 const target=hook==='configureServer'?'value.config':'value';
 await fs.writeFile(path.join(pkg,'vite.config.js'),"import react from '@vitejs/plugin-react';export default {plugins:[react(),{name:'project-policy-test',"+hook+"(value){const config="+target+";config.server.fs={strict:false,allow:['/'],deny:[]};config.envPrefix=['JUZ_'];config.envDir="+JSON.stringify(project)+";"+(hook==='config'?"return {server:{fs:{strict:false,deny:[]}},envPrefix:['JUZ_'],envDir:"+JSON.stringify(project)+"};":"")+"}}]};");
 await page.goto(service.url);await expect(page.frameLocator('iframe').getByRole('heading',{name:'Hello juz'})).toBeVisible();
 const preview=new URL((await page.locator('iframe').getAttribute('src'))!);
 expect((await fetch(new URL('@fs/'+outside.replace(/\\/g,'/'),preview),{headers:{origin:'null'}})).status).toBe(404);
 const source=path.join(pkg,'src/Demo.tsx');await fs.appendFile(source,'\n// verify HMR stays connected\n');
 await page.getByLabel('label',{exact:true}).fill('Policy remains active');await expect(page.frameLocator('iframe').getByRole('heading',{name:'Policy remains active'})).toBeVisible();
});

test('supports enum/bounds/boolean controls, real drag resizing and honestly reports a custom consumer without a bridge',async({page})=>{
 const project=path.join(root,'demo'),exampleFile=path.join(project,'packages/react/playground.json');
 const example=JSON.parse(await fs.readFile(exampleFile,'utf8'));example.controls[0]={name:'label',kind:'enum',options:['Hello juz','Selected enum','No data']};example.controls[1].min=0;await fs.writeFile(exampleFile,JSON.stringify(example));
 await page.goto(service.url);const frame=page.frameLocator('iframe');await expect(frame.getByRole('heading',{name:'Hello juz'})).toBeVisible();
 await page.getByLabel('label',{exact:true}).selectOption('Selected enum');await expect(frame.getByRole('heading',{name:'Selected enum'})).toBeVisible();
 await page.getByLabel('value',{exact:true}).fill('-1');await expect(page.getByRole('alert')).toContainText('PLAYGROUND_INVALID');await expect(frame.locator('#app strong')).toHaveText('42');
 await page.getByLabel('value',{exact:true}).fill('45');await expect(frame.locator('#app strong')).toHaveText('45');await page.getByLabel('enabled',{exact:true}).uncheck();await expect(frame.getByRole('button')).toBeDisabled();
 const handle=page.getByRole('button',{name:'拖动调整画布',exact:true}),box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+20);await page.mouse.up();
 await expect(page.getByLabel('宽度',{exact:true})).toHaveValue('840');await expect(page.getByLabel('高度',{exact:true})).toHaveValue('420');
 await service.close();
 await fs.writeFile(path.join(project,'packages/react/.juz/consumer/main.js'),"import {createElement} from 'react';import{createRoot}from'react-dom/client';import{Demo}from'demo-react';createRoot(document.getElementById('app')).render(createElement(Demo,{label:'Custom consumer'}));");
 service=await startWorkbench({root:project,version:'0.1.0',port:0});await page.goto(service.url);await expect(frame.getByRole('heading',{name:'Custom consumer'})).toBeVisible();await expect(page.getByTestId('preview-status')).toContainText('受限');await expect(page.locator('#bridge-note')).toContainText('MessageChannel');
});

test('project compiler code cannot inherit CLI platform credentials',async({page})=>{
 const project=path.join(root,'demo'),plugin=path.join(project,'packages/react/node_modules/@vitejs/plugin-react');
 await fs.rename(plugin,plugin+'.original');await fs.mkdir(plugin);
 await fs.writeFile(path.join(plugin,'package.json'),JSON.stringify({name:'@vitejs/plugin-react',version:'6.3.0',type:'module',exports:'./index.js'}));
 await fs.writeFile(path.join(plugin,'index.js'),"import {writeFileSync} from 'node:fs';writeFileSync("+JSON.stringify(path.join(project,'compiler-env.json'))+",JSON.stringify({token:process.env.ZHINEXUS_API_TOKEN,database:process.env.PLATFORM_DATABASE_URL}));export default ()=>({name:'test-compiler-env'});");
 const oldToken=process.env.ZHINEXUS_API_TOKEN,oldDatabase=process.env.PLATFORM_DATABASE_URL;
 process.env.ZHINEXUS_API_TOKEN='synthetic-compiler-test';process.env.PLATFORM_DATABASE_URL='postgres://synthetic:password@localhost/test';
 try{await page.goto(service.url);await expect(page.frameLocator('iframe').getByRole('heading',{name:'Hello juz'})).toBeVisible();expect(JSON.parse(await fs.readFile(path.join(project,'compiler-env.json'),'utf8'))).toEqual({});}
 finally{if(oldToken===undefined)delete process.env.ZHINEXUS_API_TOKEN;else process.env.ZHINEXUS_API_TOKEN=oldToken;if(oldDatabase===undefined)delete process.env.PLATFORM_DATABASE_URL;else process.env.PLATFORM_DATABASE_URL=oldDatabase;}
});

test('prepares saved examples, shows immutable snapshot, invalidates changed inputs and explicitly confirms publication (mock HTTP)',async({page})=>{
 const {fakeWorkbenchPlatform}=await import('../helpers/workbench-platform.js');
 const platform=await fakeWorkbenchPlatform('demo',['demo-react','demo-vue']);const oldToken=process.env.ZHINEXUS_API_TOKEN;process.env.ZHINEXUS_API_TOKEN='mock-workbench-token';
 await service.close();service=await startWorkbench({root:path.join(root,'demo'),version:'0.1.0',port:0,apiOrigin:platform.origin});
 try{
  await page.goto(service.url);await expect(page.locator('#account')).toContainText('workbench-test');
  await page.locator('#category').selectOption('general');await page.getByRole('button',{name:'分配分类',exact:true}).click();await expect(page.getByRole('status')).toContainText('分类已保存');
  await page.getByLabel('label',{exact:true}).fill('Frozen snapshot');await page.getByRole('button',{name:'保存示例',exact:true}).click();await expect(page.getByRole('status')).toContainText('示例已保存');
  await page.getByRole('button',{name:'打包验证',exact:true}).click();await expect(page.locator('#progress')).toContainText('succeeded',{timeout:60000});
  await expect(page.getByRole('button',{name:'上传发布',exact:true})).toBeEnabled();
  await page.getByLabel('label',{exact:true}).fill('Unsaved draft');
  await page.getByRole('button',{name:'查看冻结预览',exact:true}).click();
  await expect(page.frameLocator('iframe').getByRole('heading',{name:'Frozen snapshot'})).toBeVisible();
  await expect(page.getByLabel('label',{exact:true})).toHaveValue('Frozen snapshot');await expect(page.getByLabel('label',{exact:true})).toBeDisabled();
  await page.getByLabel('示例状态',{exact:true}).selectOption('empty');await expect(page.frameLocator('iframe').getByRole('heading',{name:'No data'})).toBeVisible();
  await page.getByRole('button',{name:'返回开发预览',exact:true}).click();await expect(page.frameLocator('iframe').getByRole('heading',{name:'Unsaved draft'})).toBeVisible();
  await page.getByRole('button',{name:'重置默认值',exact:true}).click();await expect(page.getByRole('button',{name:'上传发布',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'上传发布',exact:true}).click();await expect(page.getByRole('dialog')).toContainText(platform.origin);await expect(page.getByRole('dialog')).toContainText('workbench-test');expect(platform.creates()).toBe(0);
  await page.getByRole('button',{name:'确认上传发布',exact:true}).click();await expect(page.locator('#progress')).toContainText('publish · succeeded',{timeout:60000});expect(platform.creates()).toBe(1);
  const docs=path.join(root,'demo/packages/react/docs/demo.md');await fs.appendFile(docs,'\nChanged document');
  await expect(page.locator('#candidate')).toContainText('与当前草稿不同',{timeout:10000});await expect(page.getByRole('button',{name:'上传发布',exact:true})).toBeDisabled();
 }finally{if(oldToken===undefined)delete process.env.ZHINEXUS_API_TOKEN;else process.env.ZHINEXUS_API_TOKEN=oldToken;await service.close();await platform.close();}
});
test('real source rendering, framework drafts, controls, JSON, events, resizing, HMR, saving and sandbox isolation',async({page})=>{
 await page.addInitScript(()=>{const channels:MessageChannel[]=[];(window as unknown as {testChannels:MessageChannel[]}).testChannels=channels;const Original=MessageChannel;window.MessageChannel=class extends Original{constructor(){super();channels.push(this);}};});
 const sockets:string[]=[];page.on('websocket',socket=>sockets.push(socket.url()));
 await page.goto(service.url);
 const frame=page.frameLocator('iframe[title="组件预览"]');
 await expect(frame.getByRole('heading',{name:'Hello juz'})).toBeVisible();
 await expect(page.getByTestId('preview-status')).toContainText('已就绪');
 await expect(page.getByTestId('mode')).toContainText('源码');
 await page.getByLabel('label',{exact:true}).fill('React draft');await expect(frame.getByRole('heading',{name:'React draft'})).toBeVisible();
 await frame.getByRole('button').click();await expect(page.getByTestId('event-log')).toContainText('change');await expect(page.getByTestId('event-log')).toContainText('43');
 await page.getByLabel('宽度',{exact:true}).fill('560');await page.getByLabel('高度',{exact:true}).fill('360');
 await expect.poll(()=>page.locator('iframe[title="组件预览"]').evaluate((e:HTMLIFrameElement)=>[e.clientWidth,e.clientHeight])).toEqual([560,360]);
 await page.getByLabel('数据 JSON',{exact:true}).fill('{');await page.getByRole('button',{name:'应用数据',exact:true}).click();await expect(page.getByRole('alert')).toContainText('JSON');await expect(frame.locator('#app p')).toHaveText('[12,24,36]');
 await page.getByLabel('数据 JSON',{exact:true}).fill('[88,99]');await page.getByRole('button',{name:'应用数据',exact:true}).click();await expect(frame.locator('#app p')).toHaveText('[88,99]');
 await page.getByRole('button',{name:'保存示例',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'示例已保存'})).toBeVisible();
 await page.evaluate(()=>{const test=window as unknown as {testChannels:MessageChannel[];stalePort:MessagePort};test.stalePort=test.testChannels.at(-1)!.port1;});
 await page.getByRole('button',{name:'Vue',exact:true}).click();await expect(frame.getByRole('heading',{name:'Hello juz'})).toBeVisible();await page.getByLabel('label',{exact:true}).fill('Vue draft');await expect(frame.getByRole('heading',{name:'Vue draft'})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {stalePort:MessagePort}).stalePort.dispatchEvent(new MessageEvent('message',{data:{type:'event',name:'change',payload:'stale-channel',time:new Date().toISOString()}}));});await expect(page.getByTestId('event-log')).not.toContainText('stale-channel');
 await page.getByRole('button',{name:'React',exact:true}).click();await expect(frame.getByRole('heading',{name:'React draft'})).toBeVisible();
 const source=path.join(root,'demo/packages/react/src/Demo.tsx');const old=await fs.readFile(source,'utf8');await fs.writeFile(source,old.replace('<h1>{label}</h1>','<h1>{label} HMR</h1>'));await expect(frame.getByRole('heading',{name:'React draft HMR'})).toBeVisible();await fs.writeFile(source,old);await expect(frame.getByRole('heading',{name:'React draft'})).toBeVisible();
 expect(sockets.length).toBeGreaterThan(0);
 expect(await upgradeStatus(sockets.at(-1)!,'http://evil.example')).not.toBe(101);
 const wrongPath=new URL(sockets.at(-1)!);wrongPath.pathname='/wrong/hmr';expect(await upgradeStatus(wrongPath.href,'null')).not.toBe(101);
  const previewUrl=new URL((await page.locator('iframe').getAttribute('src'))!);
 await fs.mkdir(path.join(root,'demo/.tools'),{recursive:true});await fs.writeFile(path.join(root,'demo/.tools/credentials.local'),'synthetic-private');
 const secretUrl=new URL('@fs/'+path.join(root,'demo/.tools/credentials.local').replace(/\\/g,'/'),previewUrl).href;
 expect((await fetch(secretUrl,{headers:{origin:'null'}})).status).toBe(404);
 expect(await frame.locator('body').evaluate(()=>{try{void parent.document.body;return false;}catch{return true;}})).toBe(true);
 const refused=await frame.locator('body').evaluate(async(_body,url)=>{try{await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});return false;}catch{return true;}},service.origin+'/api/save');expect(refused).toBe(true);
 await page.evaluate(()=>window.postMessage({type:'event',name:'forged-event',payload:'bad'},location.origin));await expect(page.getByTestId('event-log')).not.toContainText('forged-event');
 await service.close();service=await startWorkbench({root:path.join(root,'demo'),version:'0.1.0',port:0});await page.goto(service.url);await expect(page.frameLocator('iframe[title="组件预览"]').getByRole('heading',{name:'React draft'})).toBeVisible();
 await expect(page.getByLabel('数据 JSON',{exact:true})).toHaveValue('[\n  88,\n  99\n]');
 await page.screenshot({path:path.resolve('test-results/workbench/workbench-desktop.png')});
});

test('built-export mode starts the declared watcher, waits for its output and stops its process tree',async({page})=>{
 await service.close();
 const project=path.join(root,'demo'),configFile=path.join(project,'packages/react/component.config.json');
 const old=await fs.readFile(configFile,'utf8');const config=JSON.parse(old);delete config.variants[0].sourceEntry;
 config.dev.react={program:process.execPath,args:['watcher.mjs']};
 await fs.writeFile(path.join(project,'packages/react/watcher.mjs'),"import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';writeFileSync('watcher.pid',String(process.pid));const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','build','--watch'],{stdio:'inherit'});setInterval(()=>{},1000);");
 await fs.writeFile(configFile,JSON.stringify(config));
 service=await startWorkbench({root:project,version:'0.1.0',port:0});
 try{
  await page.goto(service.url);await expect(page.getByTestId('mode')).toContainText('构建导出');
  await expect(page.frameLocator('iframe').getByRole('heading',{name:JSON.parse(await fs.readFile(path.join(project,'packages/react/playground.json'),'utf8')).props.label})).toBeVisible();
  const pid=Number(await fs.readFile(path.join(project,'packages/react/watcher.pid'),'utf8'));expect(pid).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Vue',exact:true}).click();await expect(page.frameLocator('iframe').getByRole('heading',{name:'Hello juz'})).toBeVisible();
  await expect.poll(()=>{try{process.kill(pid,0);return true;}catch{return false;}}).toBe(false);
 }finally{await service.close();await fs.writeFile(configFile,old);service=await startWorkbench({root:project,version:'0.1.0',port:0});}
});
