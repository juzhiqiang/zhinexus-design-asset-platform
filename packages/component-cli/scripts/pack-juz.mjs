import { copyFile, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packPackage } from '../dist/local/pack.js';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
const outputDir = resolve(values.out ?? join(cliRoot, '.release'));
const source = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'));
for (const [name, version] of Object.entries(source.dependencies)) {
  if (name.startsWith('@company/') || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid distribution dependency: ' + name);
}
const staging = await mkdtemp(join(tmpdir(), 'juz-distribution-'));
try {
  await cp(join(cliRoot, 'dist'), join(staging, 'dist'), { recursive: true, errorOnExist: true });
  await cp(join(cliRoot, 'README.md'), join(staging, 'README.md'));
  // The workspace name stays internal; this tarball is the standalone npm product.
  await writeFile(join(staging, 'package.json'), JSON.stringify({
    name: 'juz-cli', version: source.version, description: '从真实项目构建、验证和发布组件到平台',
    private: false, type: source.type, files: ['dist'], bin: source.bin,
    exports: source.exports, types: source.types, main: source.main,
    engines: source.engines, dependencies: source.dependencies, publishConfig: { access: 'public' },
  }, null, 2) + '\n');
  await mkdir(outputDir, { recursive: true });
  const result = await packPackage({ packageDir: staging, outputDir: join(staging, '.packed') });
  const tarballPath = join(outputDir, result.tarballName);
  await copyFile(result.tarballPath, tarballPath);
  process.stdout.write(JSON.stringify({ ...result, tarballPath }) + '\n');
} finally {
  await rm(staging, { recursive: true, force: true });
}
