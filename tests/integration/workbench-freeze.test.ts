import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { expect,it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { resolvePnpmExecutable } from '../../packages/component-cli/src/local/pack.js';
import { computeFileSha256 } from '../../packages/component-cli/src/local/digest.js';
const exec=promisify(execFile);
it('freezes saved data from a real installed component and serves only declared immutable preview bytes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juz-workbench-frozen-'));
 try {
  const created=await runCli(['create','demo','--framework','react'],'0.1.0',{cwd:root});expect(created.exitCode,created.stderr).toBe(0);
  const project=path.join(root,'demo');
  await exec(resolvePnpmExecutable(),['install','--ignore-scripts','--config.manage-package-manager-versions=false'],{cwd:project,timeout:120000,windowsHide:true});
  const example=path.join(project,'playground.json');const value=JSON.parse(await fs.readFile(example,'utf8'));value.props.label='Saved frozen example';value.data=[97,98];value.states[0].props=value.props;value.states[0].data=value.data;await fs.writeFile(example,JSON.stringify(value));
  const material=await runCli(['package','--category','general'],'0.1.0',{cwd:project});expect(material.exitCode,material.stderr).toBe(0);
  const output=JSON.parse(material.stdout);const manifest=output.manifest;
  const meta=manifest.files.find((f:{path:string})=>f.path.endsWith('/playground.json'));expect(meta).toBeDefined();
  expect(JSON.parse(await fs.readFile(path.join(output.bundleDir,meta.path),'utf8')).props.label).toBe('Saved frozen example');
  const {startFrozenPreview}=await import('../../packages/component-cli/src/workbench/frozen.js');
  const before=await Promise.all(manifest.files.map((f:{path:string})=>computeFileSha256(path.join(output.bundleDir,f.path))));
  const preview=await startFrozenPreview(output.bundleDir,'http://127.0.0.1:1111');
  const browser=await chromium.launch({headless:true});
  try { const page=await browser.newPage();await page.goto(preview.url(manifest.variants[0].variantId));await page.getByRole('heading',{name:'Saved frozen example'}).waitFor();expect(await page.locator('#app p').textContent()).toBe('[97,98]');
   expect((await fetch(preview.origin+'/manifest.json')).status).toBe(404);
   expect((await fetch(preview.origin+'/packages/secret.tgz')).status).toBe(404);
  } finally {await browser.close();await preview.close();}
  expect(await Promise.all(manifest.files.map((f:{path:string})=>computeFileSha256(path.join(output.bundleDir,f.path))))).toEqual(before);
 } finally {await fs.rm(root,{recursive:true,force:true});}
},180000);

