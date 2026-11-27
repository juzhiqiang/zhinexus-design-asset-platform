import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createProject } from '../../packages/component-cli/src/workbench/create.js';
import { readWorkspace } from '../../packages/component-cli/src/workbench/workspace.js';
import { readPlayground, savePlayground, validateExample } from '../../packages/component-cli/src/workbench/examples.js';
import { readVariantApi } from '../../packages/component-cli/src/project/config.js';
import { startWorkbench } from '../../packages/component-cli/src/workbench/server.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function project(framework = 'react') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'juz-consumption-')); roots.push(root);
  await createProject(root, 'demo', framework);
  return (await readWorkspace(path.join(root, 'demo'))).projects[0]!;
}

it.each(['react', 'vue'])('%s 模板通过公开参数描述独立数字颜色，普通组件入口不依赖元数据', async framework => {
  const p = await project(framework), variant = p.config.variants[0]!;
  const api = await readVariantApi(p, variant);
  expect(api.props.find(prop => prop.name === 'valueColor')).toMatchObject({ schema: { type: 'string', title: '数字颜色', default: '#FF6B35' }, editor: { kind: 'color', group: '数值样式' } });
  const example = await readPlayground(p, variant);
  expect(example.value.controls).toEqual([]);
  expect(example.value.props.valueColor).toBe('#FF6B35');
  const pkg=JSON.parse(await fs.readFile(path.join(p.packageDir,'package.json'),'utf8'));
  expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'api', 'docs']));
  expect(pkg.exports['./api/demo.json']).toBe('./api/demo.json');
});

it('API 的结构化参数约束校验实际绑定数据和每个状态，旧控件不能放宽约束', async () => {
  const p = await project(), variant = p.config.variants[0]!;
  const raw = (await readPlayground(p, variant)).value;
  const api = await readVariantApi(p, variant);
  api.props.push({ name: 'config', type: 'MetricConfig', required: true, schema: { type: 'object', properties: { digits: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['digits'], additionalProperties: false } });
  await fs.writeFile(path.join(p.root, variant.api), JSON.stringify(api));
  const valid = { ...raw, dataProp: 'config', props: { ...raw.props, config: { digits: 'ignored' } }, data: { digits: 2 }, states: [] };
  await expect(validateExample(p, variant, valid)).resolves.toMatchObject({ data: { digits: 2 } });
  await expect(validateExample(p, variant, { ...valid, data: { digits: 8 } })).rejects.toThrow('PLAYGROUND_INVALID');
  await expect(validateExample(p, variant, { ...valid, states: [{ id: 'bad', label: 'bad', props: {}, data: { digits: '2' } }] })).rejects.toThrow('PLAYGROUND_INVALID');
  await expect(validateExample(p, variant, { ...raw, controls: [{ name: 'valueColor', kind: 'text' }], props: { ...raw.props, config: { digits: 2 }, valueColor: 'red' }, states: [] })).rejects.toThrow('PLAYGROUND_INVALID');
});

it('工作台从 API 派生控件，API 新参数无需再维护 playground 控件，保存仍只写原始示例', async () => {
  const p = await project(), variant = p.config.variants[0]!;
  const definition = await readVariantApi(p, variant);
  definition.props.push({ name: 'unit', type: 'string', required: false, schema: { type: 'string', title: '单位', enum: ['元', '万元'], default: '元' } });
  await fs.writeFile(path.join(p.root, variant.api), JSON.stringify(definition));
  const service = await startWorkbench({ root: p.root, version: 'test', port: 0 });
  try {
    const response = await fetch(service.origin + '/api/catalog', { method: 'POST', headers: { origin: service.origin, 'x-juz-session': service.token, 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(200);
    const catalog = await response.json() as { variants: { controls: unknown[]; example: { controls: unknown[] } }[] };
    expect(catalog.variants[0]!.controls).toEqual(expect.arrayContaining([{ name: 'unit', kind: 'enum', label: '单位', options: ['元', '万元'] }]));
    expect(catalog.variants[0]!.example.controls).toEqual([]);
    const current = await readPlayground(p, variant);
    await savePlayground(p, variant, current.digest, { ...current.value, props: { ...current.value.props, valueColor: '#112233', unit: '万元' } });
    const persisted = JSON.parse(await fs.readFile(path.join(p.root, variant.playground!), 'utf8'));
    expect(persisted.controls).toEqual([]);
    expect(persisted.props.valueColor).toBe('#112233');
    expect(persisted.props.unit).toBe('万元');
  } finally { await service.close(); }
});
