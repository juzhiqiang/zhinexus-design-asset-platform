import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function root() { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'juz-workbench-unit-')); roots.push(value); return value; }
it.each(['react', 'vue', 'all'])('creates an offline %s project with real source, examples and independently publishable packages', async framework => {
  const cwd = await root();
  const result = await runCli(['create', 'demo', '--framework', framework], '0.1.0', { cwd });
  expect(result.exitCode, result.stderr).toBe(0);
  const { readWorkspace } = await import('../../packages/component-cli/src/workbench/workspace.js');
  const workspace = await readWorkspace(path.join(cwd, 'demo'));
  expect(workspace.projects).toHaveLength(framework === 'all' ? 2 : 1);
  for (const project of workspace.projects) {
    expect(project.pkg.private).toBe(false);
    const variant = project.config.variants[0]!;
    expect(await fs.readFile(path.join(project.root, variant.sourceEntry!), 'utf8')).toContain('export');
    expect(JSON.parse(await fs.readFile(path.join(project.root, variant.playground!), 'utf8')).props.label).toBe('Hello juz');
    expect(await fs.readdir(path.join(project.root, variant.consumer.templateDir))).not.toContain('node_modules');
    expect(project.pkg.dependencies?.echarts).toBeUndefined();
    expect(variant.category).toBeUndefined();
  }
  const before = await fs.readFile(path.join(cwd, 'demo/package.json'), 'utf8');
  expect((await runCli(['create', 'demo', '--framework', framework], '0.1.0', { cwd })).exitCode).toBe(1);
  expect(await fs.readFile(path.join(cwd, 'demo/package.json'), 'utf8')).toBe(before);
});
it('deduplicates real configs, rejects duplicate implementations, category mismatches and escaped workspace paths', async () => {
  const cwd = await root();
  expect((await runCli(['create', 'demo', '--framework', 'all'], '0.1.0', { cwd })).exitCode).toBe(0);
  const base = path.join(cwd, 'demo');
  const { readWorkspace, selectProject } = await import('../../packages/component-cli/src/workbench/workspace.js');
  const workspace = await readWorkspace(base);
  await expect(selectProject(workspace)).rejects.toThrow('PACKAGE_SELECTION_REQUIRED');
  expect((await selectProject(workspace, workspace.projects[0]!.pkg.name)).pkg.name).toBe(workspace.projects[0]!.pkg.name);
  const indexPath = path.join(base, 'component.workspace.json');
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.packages.push(index.packages[0]); await fs.writeFile(indexPath, JSON.stringify(index));
  expect((await readWorkspace(base)).projects).toHaveLength(2);
  index.packages.push('../elsewhere.json'); await fs.writeFile(indexPath, JSON.stringify(index));
  await expect(readWorkspace(base)).rejects.toThrow('PATH_OUTSIDE_PROJECT');
  index.packages.pop(); await fs.writeFile(indexPath, JSON.stringify(index));
  const configPath = workspace.projects[1]!.configPath;
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.variants[0].framework = 'react'; await fs.writeFile(configPath, JSON.stringify(config));
  await expect(readWorkspace(base)).rejects.toThrow('CONFIG_DUPLICATE');
  config.variants[0].framework = 'vue'; config.variants[0].category = 'other'; await fs.writeFile(configPath, JSON.stringify(config));
  await expect(readWorkspace(base)).rejects.toThrow('CATEGORY_CONFLICT');
});
it('validates examples, atomically saves designated JSON, and rejects a stale editor without overwriting newer content', async () => {
  const cwd = await root(); await runCli(['create', 'demo', '--framework', 'react'], '0.1.0', { cwd });
  const { readWorkspace } = await import('../../packages/component-cli/src/workbench/workspace.js');
  const { readPlayground, savePlayground } = await import('../../packages/component-cli/src/workbench/examples.js');
  const project = (await readWorkspace(path.join(cwd, 'demo'))).projects[0]!; const variant = project.config.variants[0]!;
  const current = await readPlayground(project, variant);
  const updated = { ...current.value, props: { ...current.value.props, label: 'Saved label' } };
  await savePlayground(project, variant, current.digest, updated);
  expect((await readPlayground(project, variant)).value.props.label).toBe('Saved label');
  await expect(savePlayground(project, variant, current.digest, current.value)).rejects.toThrow('EXAMPLE_CONFLICT');
  const next = await readPlayground(project, variant);
  await expect(savePlayground(project, variant, next.digest, { ...updated, props: { label: 'Bad', value: 'not a number' } })).rejects.toThrow('PLAYGROUND_INVALID');
  expect((await readPlayground(project, variant)).value.props.label).toBe('Saved label');
});
it('initializes an existing package offline, registers explicit source and fills only missing materials', async () => {
  const cwd=await root();
  await fs.writeFile(path.join(cwd,'package.json'),JSON.stringify({name:'existing-badge',version:'1.0.0',private:false,type:'module',scripts:{build:'node build.mjs'}}));
  await fs.mkdir(path.join(cwd,'src'));await fs.writeFile(path.join(cwd,'src/index.ts'),'export const Badge=()=>null;');
  await fs.mkdir(path.join(cwd,'docs'));await fs.writeFile(path.join(cwd,'docs/badge-react.md'),'# Keep my docs');
  const result=await runCli(['init','--component','badge','--export','Badge','--framework','react','--source','src/index.ts'],'0.1.0',{cwd});
  expect(result.exitCode,result.stderr).toBe(0);
  expect(await fs.readFile(path.join(cwd,'docs/badge-react.md'),'utf8')).toBe('# Keep my docs');
  const config=JSON.parse(await fs.readFile(path.join(cwd,'component.config.json'),'utf8'));
  expect(config.variants[0].sourceEntry).toBe('src/index.ts');
  expect(JSON.parse(await fs.readFile(path.join(cwd,config.variants[0].playground),'utf8')).adapter).toBe('custom');
});

it('validates effective data bindings, including required props and every saved state', async () => {
  const cwd=await root();await runCli(['create','demo','--framework','react'],'0.1.0',{cwd});
  const {readWorkspace}=await import('../../packages/component-cli/src/workbench/workspace.js');
  const {readPlayground,validateExample,savePlayground}=await import('../../packages/component-cli/src/workbench/examples.js');
  const project=(await readWorkspace(path.join(cwd,'demo'))).projects[0]!,variant=project.config.variants[0]!;
  const saved=await readPlayground(project,variant);
  for(const data of ['not an array',[1,'wrong']])await expect(validateExample(project,variant,{...saved.value,data})).rejects.toThrow('PLAYGROUND_INVALID: data');
  const bound=structuredClone(saved.value);bound.controls=[];bound.dataProp='value';delete bound.props.value;bound.data=12;bound.states=[];
  await expect(validateExample(project,variant,bound)).resolves.toMatchObject({data:12});
  await expect(savePlayground(project,variant,saved.digest,{...bound,data:'not a number'})).rejects.toThrow('PLAYGROUND_INVALID: value');
  await expect(validateExample(project,variant,{...bound,data:-1,controls:[{name:'value',kind:'number',min:0}]})).rejects.toThrow('PLAYGROUND_INVALID');
  const apiFile=path.join(project.root,variant.api),api=JSON.parse(await fs.readFile(apiFile,'utf8'));api.props.find((p:{name:string})=>p.name==='value').required=true;await fs.writeFile(apiFile,JSON.stringify(api));
  delete bound.data;await expect(validateExample(project,variant,bound)).rejects.toThrow('required value');
  bound.data=12;bound.states=[{id:'bad',label:'bad',props:{},data:'wrong'}];await expect(validateExample(project,variant,bound)).rejects.toThrow('PLAYGROUND_INVALID: value');
  expect((await readPlayground(project,variant)).digest).toBe(saved.digest);
});
