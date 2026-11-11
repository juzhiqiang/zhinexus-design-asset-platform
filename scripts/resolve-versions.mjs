import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dirs = ['.', 'apps/api', 'apps/gallery', 'apps/preview-gateway', 'packages/contracts', 'packages/charts-core', 'packages/charts-vue', 'packages/charts-react', 'packages/component-cli', 'examples/vue', 'examples/react'];
const names = new Set(['pnpm']);
for (const dir of dirs) {
  const pkg = JSON.parse(await readFile(path.join(root, dir, 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(pkg[section] ?? {})) if (!version.startsWith('workspace:')) names.add(name);
  }
}
const npm = await Promise.all([...names].sort().map(async name => {
  const source = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const pkg = await response.json();
  if (pkg.version.includes('-')) throw new Error(`${name}: latest is prerelease; manual selection required`);
  return { name, version: pkg.version, engines: pkg.engines ?? {}, peerDependencies: pkg.peerDependencies ?? {}, peerDependenciesMeta: pkg.peerDependenciesMeta ?? {}, integrity: pkg.dist.integrity, source };
}));
const response = await fetch('https://nodejs.org/dist/index.json');
if (!response.ok) throw new Error('Cannot read official Node release list');
const nodes = await response.json();
const discoveredNode = nodes.find(n => !n.version.includes('-'));
const record = { queriedAt: new Date().toISOString(), status: 'official-discovery-only', npm, node: { version: discoveredNode.version, lts: discoveredNode.lts, source: 'https://nodejs.org/dist/index.json' }, note: 'Discovery does not change package.json or the lockfile and does not prove compatibility. See bootstrap verification for installed results.' };
await mkdir(path.join(root, 'docs'), { recursive: true });
await writeFile(path.join(root, 'docs/versions.discovery.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`Recorded ${npm.length} package candidates in docs/versions.discovery.json; no versions changed.`);
