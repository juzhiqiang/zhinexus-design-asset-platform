import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { validateComponentApi, type ComponentValueSchemaV1 } from '../../packages/contracts/src/index.js';
import { createProject } from '../../packages/component-cli/src/workbench/create.js';
import { readWorkspace } from '../../packages/component-cli/src/workbench/workspace.js';
import { readPlayground } from '../../packages/component-cli/src/workbench/examples.js';
import { startWorkbench } from '../../packages/component-cli/src/workbench/server.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

it.each([
  { payload: 'string', schema: { type: 'number' } },
  { payload: 'number', schema: { type: 'boolean' } },
  { payload: 'number[]', schema: { type: 'array', items: { type: 'string' } } },
  { payload: 'Array<string>', schema: { type: 'string' } },
] satisfies { payload: string; schema: ComponentValueSchemaV1 }[])('rejects conflicting event payload and schema: $payload', event => {
  const result = validateComponentApi({ schemaVersion: 1, componentId: 'demo', framework: 'react', exportName: 'Demo', exportPath: '.', props: [], events: [{ name: 'change', ...event }], notes: [] });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/events/0/schema/type' })]));
});

async function savedExample(kind: 'props' | 'state' | 'data') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'juz-input-boundary-')); roots.push(root);
  await createProject(root, 'demo', 'react');
  const project = (await readWorkspace(path.join(root, 'demo'))).projects[0]!, variant = project.config.variants[0]!;
  const example = (await readPlayground(project, variant)).value;
  const apiFile = path.join(project.root, variant.api), api = JSON.parse(await fs.readFile(apiFile, 'utf8'));
  api.props.find((p: { name: string }) => p.name === 'value').schema.maximum = 100;
  await fs.writeFile(apiFile, JSON.stringify(api));
  if (kind === 'props') example.props.value = 200;
  if (kind === 'state') example.states[0]!.props.value = 300;
  if (kind === 'data') { example.dataProp = 'value'; example.props.value = 1; example.data = 200; example.states = []; }
  await fs.writeFile(path.join(project.root, variant.playground!), JSON.stringify(example));
  return { project, variant };
}

it.each(['props', 'state', 'data'] as const)('validates saved %s against the API before first preview or consumer use', async kind => {
  const { project, variant } = await savedExample(kind);
  await expect(readPlayground(project, variant)).rejects.toThrow('PLAYGROUND_INVALID');
});

it('rejects invalid initial values in the catalog and development preview, before resolving project tooling', async () => {
  const { project, variant } = await savedExample('props');
  const service = await startWorkbench({ root: project.root, version: 'test', port: 0 });
  try {
    const headers = { origin: service.origin, 'x-juz-session': service.token, 'content-type': 'application/json' };
    const catalog = await fetch(service.origin + '/api/catalog', { headers });
    expect(catalog.status).toBe(400);
    expect(await catalog.text()).toContain('PLAYGROUND_INVALID');
    const { stateKey } = await import('../../packages/component-cli/src/workbench/state.js');
    const preview = await fetch(service.origin + '/api/select', { method: 'POST', headers, body: JSON.stringify({ id: stateKey(project) + ':' + variant.componentId + ':' + variant.framework }) });
    expect(preview.status).toBe(400);
    expect(await preview.text()).toContain('PLAYGROUND_INVALID');
  } finally { await service.close(); }
});

it('does not treat an unconfigured custom consumer fallback as its actual inputs', async () => {
  const { project, variant } = await savedExample('props');
  const { playground: _ignored, ...custom } = variant;
  await expect(readPlayground(project, custom)).resolves.toMatchObject({ value: { adapter: 'custom', props: {} }, digest: '' });
});
