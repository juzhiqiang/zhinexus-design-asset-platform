import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {createServer} from 'node:http';
import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {resolvePnpmExecutable} from '../../packages/component-cli/src/local/pack.js';
import {computeFileSha256} from '../../packages/component-cli/src/local/digest.js';
import {terminateTree} from '../../packages/component-cli/src/project/lifecycle.js';
import {fakeWorkbenchPlatform} from '../helpers/workbench-platform.js';
const execute=promisify(execFile);
async function availablePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const port=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return port;}
it('installs the actual juz tgz outside the repository and runs create/init/dev/package/preview/publish/resume (mock HTTP)',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juz-independent-workbench-'));let child:ChildProcess|undefined;
 const platform=await fakeWorkbenchPlatform('demo',['demo-react','demo-vue']);
 try{
  const packed=JSON.parse((await execute(process.execPath,[path.resolve('packages/component-cli/scripts/pack-juz.mjs'),'--out',path.join(root,'artifacts')],{windowsHide:true,timeout:120000})).stdout);
  const install=path.join(root,'installed');await fs.mkdir(install);await fs.writeFile(path.join(install,'package.json'),JSON.stringify({name:'cli-acceptance',private:true,version:'1.0.0'}));
  await execute(resolvePnpmExecutable(),['add',packed.tarballPath,'--ignore-scripts','--config.manage-package-manager-versions=false'],{cwd:install,windowsHide:true,timeout:120000});
  const installed=await fs.realpath(path.join(install,'node_modules/juz-cli'));expect(installed.startsWith(install)).toBe(true);
  const bin=path.join(installed,'dist/bin.js');const env={...process.env,NODE_PATH:'',NODE_OPTIONS:'',PLATFORM_API_URL:'',ZHINEXUS_API_URL:'',ZHINEXUS_API_TOKEN:'',PLATFORM_TOKEN:'',PLATFORM_API_TOKEN:'',ZHINEXUS_TOKEN:'',ZHINEXUS_CREDENTIAL_FILE:path.join(root,'session.local')};
  const cli=(args:string[],cwd=root)=>execute(process.execPath,[bin,...args],{cwd,env,windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});
  await cli(['create','demo','--framework','all']);const project=path.join(root,'demo');
  await execute(resolvePnpmExecutable(),['install','--ignore-scripts','--config.manage-package-manager-versions=false'],{cwd:project,env,windowsHide:true,timeout:120000});
  await cli(['create','incoming','--framework','react']);await fs.unlink(path.join(root,'incoming/component.config.json'));
  await cli(['init','--component','incoming','--export','Demo','--framework','react','--source','src/index.tsx'],path.join(root,'incoming'));
  expect(JSON.parse(await fs.readFile(path.join(root,'incoming/component.config.json'),'utf8')).variants[0].sourceEntry).toBe('src/index.tsx');
  async function launch(args:string[],cwd:string){
   child=spawn(process.execPath,[bin,...args,'--port',String(await availablePort()),'--no-open'],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let output='',errors='';child.stderr!.on('data',d=>{errors+=String(d);});
   return new Promise<{url:string}>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CLI_START_TIMEOUT: '+errors.slice(-2000))),30000);child!.stdout!.on('data',d=>{output+=String(d);try{const result=JSON.parse(output.trim());clearTimeout(timer);resolve(result);}catch{}});child!.once('exit',code=>{clearTimeout(timer);reject(new Error('CLI_EXIT '+code+': '+errors.slice(-2000)));});});
  }
  const browser=await chromium.launch({headless:true});
  try{
   const page=await browser.newPage();
   for(const selected of ['demo-vue','packages/vue','packages/vue/component.config.json']){
    const dev=await launch(['dev','--package',selected,'--framework','vue'],project);expect(new URL(dev.url).searchParams.get('package')).toBe('demo-vue');await page.goto(dev.url);
    await expect.poll(()=>page.locator('#vue').getAttribute('aria-pressed')).toBe('true');await page.frameLocator('iframe').getByRole('heading',{name:'Hello juz'}).waitFor();
    expect((await page.locator('#mode').textContent())).toContain('源码');await terminateTree(child!);child=undefined;
   }
   const exampleFile=path.join(project,'packages/react/playground.json');const example=JSON.parse(await fs.readFile(exampleFile,'utf8'));example.props.label='Installed CLI frozen';example.states[0].props=example.props;await fs.writeFile(exampleFile,JSON.stringify(example));
   const output=JSON.parse((await cli(['package','--package','demo-react','--category','general'],project)).stdout);
   const hashes=await Promise.all(output.manifest.files.map((f:{path:string})=>computeFileSha256(path.join(output.bundleDir,f.path))));
   const preview=await launch(['preview','--bundle-dir',output.bundleDir],root);await page.goto(preview.url);await page.frameLocator('iframe').getByRole('heading',{name:'Installed CLI frozen'}).waitFor();expect(await page.locator('#mode').textContent()).toContain('冻结');expect(await page.locator('#save').isDisabled()).toBe(true);await terminateTree(child!);child=undefined;
   await cli(['login','--api-url',platform.origin,'--token','mock-installed-token']);platform.interrupt();
   await expect(cli(['publish','--package','demo-react','--idempotency-key','independent-original-key'],project)).rejects.toMatchObject({code:1});
   const session=JSON.parse(await fs.readFile(path.join(output.bundleDir,'.release-session.json'),'utf8'));expect(session.idempotencyKey).toBe('independent-original-key');
   const ready=JSON.parse((await cli(['publish','--package','demo-react','--idempotency-key','ignored-new-key'],project)).stdout);expect(ready.state).toBe('READY');expect(platform.creates()).toBe(1);expect(platform.keys).toEqual(['independent-original-key']);
   expect(await Promise.all(output.manifest.files.map((f:{path:string})=>computeFileSha256(path.join(output.bundleDir,f.path))))).toEqual(hashes);
   await fs.mkdir(path.resolve('test-results/workbench'),{recursive:true});await fs.writeFile(path.resolve('test-results/workbench/independent-cli.json'),JSON.stringify({evidence:'INDEPENDENT_JUZ_WORKBENCH',mockHttp:true,cliVersion:packed.version,cliTarballSha256:packed.sha256,commands:['create all','init source','dev default Vue','package selected React','preview read-only','login token','publish interrupted','publish resume'],componentTarballSha256:output.manifest.packages[0].tarball.sha256,uploadCreates:platform.creates(),originalKeyRetained:true},null,2));
  }finally{await browser.close();}
 }finally{if(child)await terminateTree(child);await platform.close();await fs.rm(root,{recursive:true,force:true});}
},300000);
