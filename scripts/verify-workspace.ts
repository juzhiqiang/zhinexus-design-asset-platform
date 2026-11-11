import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = new Map([
  ['apps/api', '@company/platform-api'], ['apps/gallery', '@company/gallery'],
  ['apps/preview-gateway', '@company/preview-gateway'], ['packages/contracts', '@company/contracts'],
  ['packages/charts-core', '@company/charts-core'], ['packages/charts-vue', '@company/charts-vue'],
  ['packages/charts-react', '@company/charts-react'], ['packages/component-cli', '@company/component-cli'],
  ['examples/vue', '@company/example-vue'], ['examples/react', '@company/example-react'],
]);
type Manifest = {
  name: string; private: boolean; scripts: Record<string, string>;
  dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const workspace = parse(readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'));
assert.deepEqual(workspace.packages, ['apps/*', 'packages/*', 'examples/vue', 'examples/react']);
for (const parent of ['apps', 'packages']) {
  const dirs = readdirSync(path.join(root, parent), { withFileTypes: true }).filter(d => d.isDirectory());
  for (const dir of dirs) assert(expected.has(`${parent}/${dir.name}`), `Unreviewed workspace directory: ${parent}/${dir.name}`);
}
const publicNames = new Set(['@company/charts-core', '@company/charts-vue', '@company/charts-react', '@company/component-cli']);
const graph = new Map<string, string[]>();
for (const [dir, name] of expected) {
  const pkg = readJson(`${dir}/package.json`) as Manifest;
  assert.equal(pkg.name, name, dir);
  assert.equal(pkg.private, !publicNames.has(name), `${name}: private boundary`);
  for (const task of ['build', 'typecheck', 'dev']) {
    assert(pkg.scripts[task], `${name}: missing ${task}`);
    assert(!/\bturbo\b/.test(pkg.scripts[task]), `${name}: recursive Turbo script`);
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const internal: string[] = [];
  for (const [dep, version] of Object.entries(deps)) {
    if (dep.startsWith('@company/')) {
      assert([...expected.values()].includes(dep), `${name}: unknown internal package ${dep}`);
      assert.equal(version, 'workspace:*', `${name}: internal version protocol`);
      internal.push(dep);
    } else assert(/^\d+\.\d+\.\d+$/.test(version), `${name}: unpinned dependency ${dep}`);
  }
  if (publicNames.has(name)) {
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      assert(dep !== '@company/contracts', `${name}: private runtime dependency cannot be published`);
    }
  }
  graph.set(name, internal);
}
function closure(name: string, stack: string[] = []): Set<string> {
  assert(!stack.includes(name), `Dependency cycle: ${[...stack, name].join(' -> ')}`);
  const result = new Set<string>([name]);
  for (const dep of graph.get(name) ?? []) for (const item of closure(dep, [...stack, name])) result.add(item);
  return result;
}
for (const name of graph.keys()) closure(name);
for (const name of ['@company/platform-api', '@company/preview-gateway', '@company/contracts']) {
  for (const dep of closure(name)) assert([name, '@company/contracts'].includes(dep), `${name}: unsafe service build dependency ${dep}`);
}
assert(graph.get('@company/charts-vue')?.includes('@company/charts-core'));
assert(graph.get('@company/charts-react')?.includes('@company/charts-core'));
assert(graph.get('@company/example-vue')?.includes('@company/charts-vue'));
assert(graph.get('@company/example-react')?.includes('@company/charts-react'));
const turbo = readJson('turbo.json');
assert.deepEqual(turbo.tasks.build.dependsOn, ['^build']);
assert.deepEqual(turbo.tasks.build.outputs, ['dist/**']);
assert.deepEqual(turbo.tasks.typecheck.outputs, []);
assert.equal(turbo.tasks.dev.cache, false);
for (const task of ['test', 'test:browser', 'component']) assert(!turbo.tasks[task], `${task}: must run directly without cache`);
console.log(`Workspace verified: ${expected.size} members, no cycles, four publishable shells, safe service graph.`);
