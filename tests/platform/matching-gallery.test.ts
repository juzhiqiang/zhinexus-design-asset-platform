import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { expect, it } from 'vitest';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { workerHarness, realRegistry } from './t06-support.js';
import { componentApiFixture } from '../fixtures/match-plan.js';
import { replaceBundleArtifact } from '../fixtures/t05-artifacts.js';

it.skipIf(!process.env.PHASE2_GALLERY_ORIGIN)('真实画廊通过ID映射读取冻结API并显示绑定和撤权缺口',async()=>{
  const galleryOrigin=process.env.PHASE2_GALLERY_ORIGIN!;
  const h=await workerHarness(f=>{
    for(const v of f.manifest.variants)replaceBundleArtifact(f,v.api.path,Buffer.from(JSON.stringify({...componentApiFixture(v.framework),componentId:v.componentId,exportName:v.exportName,exportPath:v.exportPath})));
    f.manifest.packages.find(p=>p.peerDependencies.react)!.peerDependencies['react-dom']='19.3.1';
  },{galleryOrigin});
  let requests=0;
  const proxy=createServer(async(req,res)=>{
    if(req.url!=='/v1/matching/plans'){res.writeHead(404).end();return;}
    try{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      if(req.method==='POST')requests++;
      const headers:Record<string,string>={};for(const key of ['authorization','content-type','origin','access-control-request-method','access-control-request-headers'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
      const result=await fetch(`${h.origin()}${req.url}`,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{}),signal:AbortSignal.timeout(15000)});
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
    }catch{res.writeHead(502).end();}
  });
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await new ReleaseWorker(h.db,h.store,await realRegistry()).runOnce(h.jobId);
    const id=(await h.db.query("SELECT id FROM variant_releases WHERE variant_id='line-react'")).rows[0]!.id;
    await new Promise<void>((resolve,reject)=>{proxy.once('error',reject);proxy.listen(3000,'127.0.0.1',resolve);});
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1000}});
    await page.addInitScript(token=>localStorage.setItem('zhinexus_console_auth',JSON.stringify({token,subject:'alice',roles:['publisher'],channel:'web'})),h.auth);
    expect((await page.goto(`${galleryOrigin}/match`))?.status()).toBe(200);
    await page.locator('#framework-select').selectOption('react');await page.locator('#framework-version-input').fill('19.3.1');
    await page.locator('#echarts-version-input').fill('6.1.0');await page.locator('#react-dom-version-input').fill('19.3.1');await page.locator('#package-manager-select').selectOption('pnpm');
    await page.locator('#design-mapping-input').fill(JSON.stringify({schemaVersion:1,ruleSetId:'synthetic-service',revision:'v1',entries:[{designId:'opaque',framework:'react',variantReleaseId:id}]}));
    await page.locator('#design-instance-input').fill('node-1');await page.locator('#design-design-id-input').fill('opaque');await page.getByRole('button',{name:'添加元素'}).click();
    await page.locator('#design-bindings-input').fill(JSON.stringify([{instanceId:'node-1',props:[{name:'data',source:'sales'}],events:[{name:'onPointClick',handler:'showDetail'}],layout:'grid cell 1'}]));
    expect(requests).toBe(0);await page.locator('#design-submit').click();await page.locator('.plan-target').waitFor();
    const body=await page.locator('#design-plan').innerText();
    for(const text of ['ChartData','sales','onPointClick','showDetail','grid cell 1','whenRendered','./style.css'])expect(body).toContain(text);
    expect(requests).toBe(1);await page.screenshot({path:'test-results/phase2-id-live-gallery.png',fullPage:true});
    await h.db.query("UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject='alice'");
    await page.locator('#design-submit').click();await page.locator('.plan-gap').filter({hasText:'TARGET_UNAVAILABLE'}).waitFor();
    expect(await page.locator('.plan-target').count()).toBe(0);expect(await page.locator('#design-dependencies').innerText()).toBe('');
  }finally{await browser?.close();if(proxy.listening)await new Promise<void>(resolve=>proxy.close(()=>resolve()));await h.close();}
},60000);
