import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import tar from 'tar-stream';

// Explicit local frozen input; tests never mutate that bundle or repack it.
const source = process.env.SDK_DECLARATIONS_BUNDLE;
if (!source) throw new Error('Set SDK_DECLARATIONS_BUNDLE to an existing frozen SDK bundle');
const root = process.cwd();
const script = path.join(root, 'tests/acceptance/sdk-declarations.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(run) {
  const owned = await mkdtemp(path.join(tmpdir(), 'c-sdk-input-'));
  try {
    const bundle = path.join(owned, 'bundle');
    await mkdir(path.join(bundle, 'packages'), { recursive: true });
    const original = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
    const manifest = { schemaVersion: 1, channel: 'cli', packages: original.packages,
      variants: [], reports: [], files: original.packages.map(pkg => pkg.tarball) };
    for (const pkg of manifest.packages) await copyFile(path.join(source, pkg.tarball.path), path.join(bundle, pkg.tarball.path));
    await run({ owned, bundle, manifest });
  } finally {
    assert.match(path.relative(tmpdir(), owned), /^c-sdk-input-[^/\\]+$/);
    await rm(owned, { recursive: true, force: true });
  }
}

async function rejected({ owned, bundle, manifest }, expected) {
  await writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest));
  const result = spawnSync(process.execPath, [script, root, bundle, path.join(owned, 'evidence.json')],
    { encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, 'Malformed bundle must not pass SDK acceptance');
  assert.match(`${result.stdout}${result.stderr}`, expected);
}

test('rejects a schema version that was never agreed', () => fixture(async f => {
  f.manifest.schemaVersion = 999;
  await rejected(f, /SDK_INPUT/);
}));

test('rejects core-only input instead of silently omitting both frameworks', () => fixture(async f => {
  f.manifest.packages = f.manifest.packages.slice(0, 1);
  f.manifest.files = f.manifest.packages.map(pkg => pkg.tarball);
  await rejected(f, /SDK_INPUT.*three SDK packages/);
}));

for (const mode of ['parent', 'absolute', 'junction']) {
  test(`rejects ${mode} escape from the frozen bundle`, () => fixture(async f => {
    const pkg = f.manifest.packages[0];
    const outside = path.join(f.owned, 'outside');
    await mkdir(outside);
    await copyFile(path.join(f.bundle, pkg.tarball.path), path.join(outside, 'core.tgz'));
    if (mode === 'junction') await symlink(outside, path.join(f.bundle, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    pkg.tarball.path = mode === 'parent' ? '../outside/core.tgz' : mode === 'absolute' ? path.join(outside, 'core.tgz') : 'linked/core.tgz';
    await rejected(f, /SDK_INPUT.*(?:path|outside)/);
  }));
}

async function changeFramework(f, changeJson, omit = '') {
  const pkg = f.manifest.packages.find(p => p.name === '@company/charts-vue');
  const file = path.join(f.bundle, pkg.tarball.path);
  const entries = [];
  const extract = tar.extract();
  extract.on('entry', (header, stream, next) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => { entries.push({ header, bytes: Buffer.concat(chunks) }); next(); });
  });
  const extracted = new Promise((resolve, reject) => { extract.on('finish', resolve); extract.on('error', reject); });
  extract.end(gunzipSync(await readFile(file)));
  await extracted;
  const pack = tar.pack();
  const chunks = [];
  pack.on('data', chunk => chunks.push(chunk));
  const packed = new Promise((resolve, reject) => { pack.on('end', resolve); pack.on('error', reject); });
  for (const { header, bytes } of entries) {
    if (header.name === omit) continue;
    let output = bytes;
    if (header.name === 'package/package.json') {
      const json = JSON.parse(bytes); changeJson(json); output = Buffer.from(JSON.stringify(json));
    }
    pack.entry({ ...header, size: output.length }, output);
  }
  pack.finalize();
  await packed;
  const bytes = gzipSync(Buffer.concat(chunks));
  await writeFile(file, bytes);
  pkg.tarball.sha256 = sha(bytes); pkg.tarball.bytes = bytes.length;
}

test('rejects a packed framework missing one required public entry', () => fixture(async f => {
  await changeFramework(f, json => { delete json.exports['./line']; });
  await rejected(f, /SDK_EXPORTS/);
}));

test('rejects a null style export', () => fixture(async f => {
  await changeFramework(f, json => { json.exports['./style.css'] = null; });
  await rejected(f, /SDK_EXPORTS/);
}));

test('rejects a style target absent from the installed package', () => fixture(async f => {
  await changeFramework(f, () => {}, 'package/dist/style.css');
  await rejected(f, /SDK_EXPORTS/);
}));
