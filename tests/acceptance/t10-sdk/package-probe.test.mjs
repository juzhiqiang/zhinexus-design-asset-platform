/**
 * T10 探针随 CLI 分发的打包材料回归（node:test）。
 *
 * 运行：`node --test tests/acceptance/t10-sdk/package-probe.test.mjs`
 *
 * 背景：探针原先只活在源码仓库里（`REPO_ROOT = HERE/../../..`）。要让它随
 * `@company/component-cli` 一起发布，就必须把探针本身 + Vue/React 模板 + fixtures +
 * `tsconfig.base.json` 按**逐文件白名单**打进 `packages/component-cli/dist/probe/`，
 * 并且让探针在安装后的目录结构下仍能跑。
 *
 * 这一组先写失败（RED），验收面与 C 复核出的五处缺陷一一对应：
 *   ① 白名单逐文件：缺文件要失败、白名单外的文件也要失败，不靠扩黑名单；
 *   ② 删除闸门：`--out` 指到仓库根/任一源目录时必须拒绝，且源文件一个字节都不能少；
 *      来历不明的非空目录不得被删；只有本脚本自己的产物才允许覆盖；
 *   ③ 复核无过滤：追加 `.env` / `node_modules` / `dist` 残留 / 符号链接都必须让
 *      `--check` 失败——原先复核复用带排除过滤的枚举，污染全被漏掉；
 *   ④ 安装包只读：默认输出与消费者都不得落进安装包，`--out` 必须在写入前就过闸；
 *   ⑤ 任意 cwd：探针不得依赖调用时的工作目录或源码仓库绝对路径。
 *
 * 涉及真实文件复制，因此用临时目录；不触网、不装依赖。
 * 危险反例（`out = repoRoot` 等）只在**自己创建的临时树**里验，绝不指向真实仓库。
 */

import assert from 'node:assert/strict';
import { existsSync, symlinkSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PROBE_DIR = path.join(REPO_ROOT, 'tests', 'acceptance', 't10-sdk');

// 打包脚本由 B 的 CLI 包承载，但脚本本体归 A。用 file URL 而不是裸相对路径：
// 相对 import 的基准是**本文件**，写成 '../../packages/...' 会解析到 tests/packages/...。
const PACKAGER = pathToFileURL(
  path.join(REPO_ROOT, 'packages', 'component-cli', 'scripts', 'package-probe.mjs'),
).href;

// 顶层导入一次：后面每个用例都靠它。导入失败时整个文件报同一个可读错误，
// 比每个用例各自 try/catch 更不容易漏看。
const packager = await import(PACKAGER).catch((error) => {
  throw new Error(`打包脚本不可导入：${String(error?.message ?? error)}`);
});

/** 造一个只含白名单文件的假仓库（从真实仓库复制所需文件）。 */
const makeWhitelistedRepo = async (root) => {
  const probeDir = path.join(root, 'tests', 'acceptance', 't10-sdk');
  await mkdir(probeDir, { recursive: true });
  for (const name of packager.PROBE_MODULES) {
    await cp(path.join(PROBE_DIR, name), path.join(probeDir, name));
  }
  const localState = new Set(packager.KNOWN_LOCAL_STATE);
  await cp(path.join(REPO_ROOT, 'examples'), path.join(root, 'examples'), {
    recursive: true,
    filter: (src) => !localState.has(path.basename(src)),
  });
  await cp(path.join(REPO_ROOT, 'tsconfig.base.json'), path.join(root, 'tsconfig.base.json'));
  return root;
};

/** 递归快照：相对路径 → 内容摘要。用来证明「一个字节都没少/没多」。 */
const snapshot = async (root) => {
  const out = {};
  const walk = async (dir, prefix) => {
    const { readdir } = await import('node:fs/promises');
    const { lstat } = await import('node:fs/promises');
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        out[rel] = await readFile(full).then((bytes) => bytes.toString('base64'));
      } else {
        out[rel] = `<${await lstat(full).then((s) => (s.isSymbolicLink() ? 'symlink' : 'other'))}>`;
      }
    }
  };
  await walk(root, '');
  return out;
};

/**
 * 造一个指向 `target` 的链接（符号链接 / Windows Junction）。
 * 没有权限时返回 null——调用方据此跳过，不把环境问题记成代码缺陷。
 */
const makeLink = (target, linkPath) => {
  if (process.platform === 'win32') {
    // Junction 不需要管理员权限，是 Windows 上最贴近真实绕法的一种。
    const result = spawnSync('cmd', ['/c', 'mklink', '/J', linkPath, target], { encoding: 'utf8' });
    return result.status === 0 ? 'junction' : null;
  }
  try {
    symlinkSync(target, linkPath, 'dir');
    return 'symlink';
  } catch {
    return null;
  }
};

/**
 * 造一个"已安装的 CLI 包"：`<pkg>/package.json` + `<pkg>/dist/probe`。
 *
 * package.json 必须真的在：`resolveProbeLayout()` 靠它把只读边界从 `dist/probe`
 * 扩大到整个安装包。没有它边界就只剩 dist/probe，「消费者建在 dist/other」会漏过去。
 */
const makeInstalledPackage = async (work) => {
  const cliRoot = path.join(work, 'cli', 'node_modules', '@company', 'component-cli');
  await mkdir(cliRoot, { recursive: true });
  await writeFile(
    path.join(cliRoot, 'package.json'),
    `${JSON.stringify({ name: '@company/component-cli', version: '0.0.0', main: 'dist/index.js' }, null, 2)}\n`,
  );
  const packaged = path.join(cliRoot, 'dist', 'probe');
  await packager.packageProbe({ repoRoot: REPO_ROOT, cliRoot, out: packaged });
  return { cliRoot, packaged };
};

describe('打包材料完整性（逐文件白名单）', () => {
  it('源码的 pnpm node_modules 链接不进入白名单产物，也不阻断正常构建', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'c-probe-pnpm-links-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const repo = await makeWhitelistedRepo(path.join(work, 'repo'));
    const dependency = path.join(work, 'dependency');
    await mkdir(dependency);
    await writeFile(path.join(dependency, 'secret-sentinel.txt'), 'must not ship');
    const dependencies = path.join(repo, 'examples', 'vue', 'node_modules');
    await mkdir(dependencies);
    await symlink(dependency, path.join(dependencies, 'vue'), process.platform === 'win32' ? 'junction' : 'dir');
    const out = path.join(work, 'output');
    const result = await packager.packageProbe({ repoRoot: repo, out });
    assert.equal(result.verification.ok, true);
    const found = await packager.enumerateArtifact(out);
    assert.deepEqual(found.links, []);
    assert.equal(found.files.some((file) => file.includes('node_modules') || file.includes('secret-sentinel')), false);
  });

  it('dist/probe 必须包含白名单内的每一项，且一项都不多', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-pack-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });

    const result = await packager.packageProbe({ repoRoot: REPO_ROOT, cliRoot, out: path.join(cliRoot, 'dist', 'probe') });
    const root = result.root;

    // 探针自身：八个模块一个不能少，少一个入口就起不来
    for (const name of packager.PROBE_MODULES) {
      assert.equal(existsSync(path.join(root, name)), true, `缺少探针模块 ${name}`);
    }
    // 必要资源：双框架模板 + fixtures + tsconfig.base.json
    for (const rel of [
      path.join('resources', 'examples', 'vue', 'package.json'),
      path.join('resources', 'examples', 'react', 'package.json'),
      path.join('resources', 'examples', 'vue', 'src', 'App.vue'),
      path.join('resources', 'examples', 'react', 'src', 'App.tsx'),
      path.join('resources', 'examples', 'fixtures', 'line.json'),
      path.join('resources', 'examples', 'fixtures', 'trend-card.json'),
      path.join('resources', 'tsconfig.base.json'),
    ]) {
      assert.equal(existsSync(path.join(root, rel)), true, `缺少资源 ${rel}`);
    }
    // 清单必须逐文件可核对：条数、摘要、字节数都对上
    const manifest = await packager.readProbeManifest(root);
    assert.ok(manifest, '必须产出 probe-manifest.json');
    assert.equal(manifest.complete, true, '清单必须标记为已完成');
    assert.ok(manifest.files.length > 0, '清单不能为空');
    assert.equal(manifest.entry, 'probe.mjs');
    // 入口必须是 <安装目录>/probe/probe.mjs，即 dist/probe/probe.mjs
    assert.equal(path.join(path.basename(root), manifest.entry), path.join('probe', 'probe.mjs'));
    assert.equal(existsSync(path.join(root, 'probe.mjs')), true, '入口文件必须真的在那');
    for (const entry of manifest.files) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${entry.path} 摘要格式不对`);
      assert.ok(entry.bytes > 0, `${entry.path} 字节数必须大于 0`);
    }
    // 产物里出现的文件必须与清单一一对应：既不能少，也不能多
    const enumerated = await packager.enumerateArtifact(root);
    assert.deepEqual(
      enumerated.files.filter((rel) => rel !== 'probe-manifest.json').sort(),
      manifest.files.map((entry) => entry.path).sort(),
      '产物文件集合必须与清单完全一致',
    );
    assert.deepEqual(enumerated.links, [], '产物里不得有符号链接');
    // 复核：清单里的每个文件都真的在，且没有清单外的文件
    const verified = await packager.verifyProbeBundle(root);
    assert.deepEqual(verified.missing, [], '清单内文件缺失');
    assert.deepEqual(verified.extra, [], '存在清单外文件');
    assert.deepEqual(verified.polluted, [], '存在被排除项污染');
    assert.deepEqual(verified.tampered, [], '存在被改动文件');
    assert.equal(verified.ok, true, verified.reasons?.join('；') ?? '');
  }, 120_000);

  it('白名单内的文件缺失时必须失败，而不是悄悄少打包', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-missing-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const repo = await makeWhitelistedRepo(path.join(work, 'repo'));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });
    const out = path.join(cliRoot, 'dist', 'probe');

    // 原样：应当成功
    await packager.packageProbe({ repoRoot: repo, cliRoot, out });
    assert.equal(existsSync(path.join(out, 'resources', 'examples', 'vue', 'src', 'App.vue')), true);

    // 逐个删掉白名单里的关键文件，每一次都必须明确失败并点名缺的是谁
    for (const rel of [
      path.join('tests', 'acceptance', 't10-sdk', 'probe.mjs'),
      path.join('tests', 'acceptance', 't10-sdk', 'consumer.mjs'),
      path.join('examples', 'vue', 'src', 'App.vue'),
      path.join('examples', 'react', 'src', 'main.tsx'),
      path.join('examples', 'fixtures', 'ranking.json'),
      'tsconfig.base.json',
    ]) {
      const file = path.join(repo, rel);
      const original = await readFile(file);
      await rm(file);
      await assert.rejects(
        () => packager.packageProbe({ repoRoot: repo, cliRoot, out }),
        /PROBE_INPUT.*(缺少|缺失)/,
        `删除 ${rel} 后必须失败`,
      );
      await writeFile(file, original);
    }
  }, 180_000);

  it('白名单之外的文件（密钥与来历不明的源码）必须让打包失败', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-foreign-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const repo = await makeWhitelistedRepo(path.join(work, 'repo'));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });
    const out = path.join(cliRoot, 'dist', 'probe');

    await packager.packageProbe({ repoRoot: repo, cliRoot, out });

    // C 的复现：临时加入这些东西，旧实现"整个 examples 递归拷贝 + 黑名单"会连它们
    // 一起复制进产物还报 ok。逐文件白名单下它们必须让打包失败——拒绝放行，
    // 而不是把它们加进另一条黑名单。
    for (const rel of [
      path.join('examples', 'vue', '.envrc'),
      path.join('examples', 'vue', 'credentials.json'),
      path.join('examples', 'vue', 'npm-debug.log'),
      path.join('examples', 'vue', 'src', 'generated.js'),
      path.join('examples', 'vue', 'signing.pem'),
      path.join('examples', 'react', 'src', 'scratch.tsx'),
      path.join('examples', 'fixtures', 'not-in-whitelist.json'),
      path.join('tests', 'acceptance', 't10-sdk', 'extra-module.mjs'),
    ]) {
      const file = path.join(repo, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'foreign\n');
      await assert.rejects(
        () => packager.packageProbe({ repoRoot: repo, cliRoot, out }),
        /PROBE_INPUT.*白名单之外/,
        `加入 ${rel} 后必须失败，而不是默默跳过`,
      );
      await rm(file);
    }
    // 全部移除后恢复可打包
    await packager.packageProbe({ repoRoot: repo, cliRoot, out });
    assert.equal((await packager.verifyProbeBundle(out)).ok, true);
  }, 180_000);
});

describe('打包材料不得掺入本机构建状态', () => {
  /** 造一个"本机刚构建过"的假仓库：只有白名单文件 + 已知本地产物目录。 */
  const makeBuiltRepo = async (root) => {
    await makeWhitelistedRepo(root);
    for (const rel of [
      path.join('examples', 'vue', 'node_modules', 'vue', 'index.js'),
      path.join('examples', 'vue', 'dist', 'assets', 'index.js'),
      path.join('examples', 'vue', '.turbo', 'turbo-build.log'),
      path.join('examples', 'react', 'node_modules', 'react', 'index.js'),
      path.join('examples', 'react', 'dist', 'assets', 'index.js'),
      path.join('examples', 'react', '.vite', 'deps', '_metadata.json'),
      path.join('tests', 'acceptance', 't10-sdk', 'node_modules', 'x', 'index.js'),
      path.join('examples', 'vue', 'tsconfig.tsbuildinfo'),
      path.join('examples', 'vue', 'dist', '.vite', 'deps', '_vendor.js'),
    ]) {
      const file = path.join(root, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'local build state\n');
    }
    await mkdir(path.join(root, '.git', 'objects'), { recursive: true });
    await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await mkdir(path.join(root, 'test-results', 't10-sdk-probes'), { recursive: true });
    await writeFile(path.join(root, 'test-results', 't10-sdk-probes', 'old.json'), '{}\n');
    await mkdir(path.join(root, 'coverage'), { recursive: true });
    await writeFile(path.join(root, 'coverage', 'lcov.info'), 'TN:\n');
    return root;
  };

  it('已知本地产物目录整体跳过，产物里一个字节都不得出现', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-built-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const repo = await makeBuiltRepo(path.join(work, 'repo'));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });

    const { root } = await packager.packageProbe({ repoRoot: repo, cliRoot, out: path.join(cliRoot, 'dist', 'probe') });
    // 该在的还在
    assert.equal(existsSync(path.join(root, 'probe.mjs')), true);
    assert.equal(existsSync(path.join(root, 'resources', 'examples', 'vue', 'package.json')), true);
    // 不该在的一律不得在
    for (const rel of [
      path.join('resources', 'examples', 'vue', 'node_modules'),
      path.join('resources', 'examples', 'vue', 'dist'),
      path.join('resources', 'examples', 'vue', '.turbo'),
      path.join('resources', 'examples', 'vue', '.vite'),
      path.join('resources', 'examples', 'vue', 'tsconfig.tsbuildinfo'),
      path.join('resources', 'examples', 'react', 'node_modules'),
      path.join('resources', 'examples', 'react', 'dist'),
      'node_modules',
      '.git',
      path.join('resources', 'test-results'),
      path.join('resources', 'coverage'),
      'test-results',
    ]) {
      assert.equal(existsSync(path.join(root, rel)), false, `本地产物泄漏：${rel}`);
    }
    const verified = await packager.verifyProbeBundle(root);
    assert.deepEqual(verified.polluted, [], `污染项：${verified.polluted.join(', ')}`);
    assert.equal(verified.ok, true, verified.reasons.join('；'));
    // 白名单是显式的：不得靠"复制整个仓库"蒙过去
    assert.ok(packager.PROBE_MODULES.length >= 8, '探针模块白名单必须显式列出');
    assert.ok(packager.PROBE_RESOURCE_SPEC.templates.vue.length > 10, 'vue 模板必须逐文件列出');
    assert.ok(packager.PROBE_RESOURCE_SPEC.templates.react.length > 10, 'react 模板必须逐文件列出');
    assert.ok(packager.PROBE_RESOURCE_SPEC.fixtures.includes('ranking.json'), 'fixtures 必须逐文件列出');
  }, 180_000);

  it('改动安装包里任何一个字节都必须被摘要核对抓到', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-tamper-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });
    const { root } = await packager.packageProbe({ repoRoot: REPO_ROOT, cliRoot, out: path.join(cliRoot, 'dist', 'probe') });

    // 原样：ok
    let verified = await packager.verifyProbeBundle(root);
    assert.equal(verified.ok, true, verified.reasons.join('；'));

    // 改一个字节（只加一个分号，文件照样能跑）——只查存在性的复核会漏掉这个
    const victim = path.join(root, 'consumer.mjs');
    const original = await readFile(victim, 'utf8');
    await writeFile(victim, `${original}\n// 被人改了一行\n`);
    verified = await packager.verifyProbeBundle(root);
    assert.equal(verified.ok, false, '改动一个字节必须让复核失败');
    assert.ok(verified.tampered.includes('consumer.mjs'), `被改动清单：${verified.tampered.join(', ')}`);
    assert.match(verified.reasons.join('；'), /摘要不一致/);

    // 恢复后必须又变回 ok（证明判据是摘要本身，不是缓存或顺序）
    await writeFile(victim, original);
    verified = await packager.verifyProbeBundle(root);
    assert.equal(verified.ok, true, '恢复原字节后必须重新通过');
  }, 120_000);
});

describe('删除输出目录前的路径守卫', () => {
  it('out 指向仓库根或任一源目录时必须拒绝，且源文件一个字节都不能少', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-guard-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const repo = await makeWhitelistedRepo(path.join(work, 'repo'));
    const sentinel = path.join(repo, 'SENTINEL-DO-NOT-DELETE.txt');
    await writeFile(sentinel, 'sentinel\n');
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });
    const before = await snapshot(repo);

    // C 的复现：`--out .`（out = repoRoot）会让 rm(out, recursive) 把源文件连哨兵一起删掉。
    // 真实场景里 out 指到仓库根、examples、tests、甚至磁盘根，都必须先拒绝再动手。
    const bad = [
      repo,
      path.join(repo, 'examples'),
      path.join(repo, 'examples', 'vue'),
      path.join(repo, 'examples', 'fixtures'),
      path.join(repo, 'tests'),
      path.join(repo, 'tests', 'acceptance'),
      path.join(repo, 'tests', 'acceptance', 't10-sdk'),
      work,
      path.parse(work).root,
    ];
    for (const out of bad) {
      await assert.rejects(
        () => packager.packageProbe({ repoRoot: repo, cliRoot, out }),
        /PROBE_INPUT/,
        `out=${out} 必须被拒绝`,
      );
    }

    // 一个字节都不能少，也不能多
    assert.deepEqual(await snapshot(repo), before, '被拒后仓库必须保持原样');
    assert.equal(existsSync(sentinel), true, '哨兵文件必须还在');
    assert.equal((await packager.verifyProbeBundle(path.join(cliRoot, 'dist', 'probe'))).ok, false, '不得顺带产出任何产物');
  }, 180_000);

  it('out 是符号链接 / Junction 时必须拒绝（绕过手法）', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-link-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const repo = await makeWhitelistedRepo(path.join(work, 'repo'));
    const sentinel = path.join(repo, 'SENTINEL-DO-NOT-DELETE.txt');
    await writeFile(sentinel, 'sentinel\n');
    const before = await snapshot(repo);
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });
    const out = path.join(cliRoot, 'dist', 'probe');
    await mkdir(out, { recursive: true });
    const linkKind = makeLink(repo, path.join(cliRoot, 'dist', 'probe-link'));
    if (linkKind === null) {
      return t.skip('当前用户无权创建符号链接/Junction（Windows 需开发者模式或管理员权限），跳过');
    }
    await assert.rejects(
      () => packager.packageProbe({ repoRoot: repo, cliRoot, out: path.join(cliRoot, 'dist', 'probe-link') }),
      /PROBE_INPUT.*(符号链接|Junction|链接)/,
      'out 是链接时必须拒绝',
    );
    // 链接指向的源目录必须完好无损，链接自身也不得被 rm 跟进删除
    assert.deepEqual(await snapshot(repo), before, '被拒后仓库必须保持原样');
    assert.equal(existsSync(sentinel), true, '哨兵文件必须还在');
    assert.equal(existsSync(path.join(cliRoot, 'dist', 'probe-link')), true, '链接自身不得被删除');
  }, 120_000);

  it('来历不明的非空目录不得被删除；只有本脚本自己的产物才允许覆盖', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-owner-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const repo = await makeWhitelistedRepo(path.join(work, 'repo'));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });
    const out = path.join(cliRoot, 'dist', 'probe');

    // 一个不属于本脚本的非空目录：不得删
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'someone-elses-file.txt'), 'important\n');
    await assert.rejects(
      () => packager.packageProbe({ repoRoot: repo, cliRoot, out }),
      /PROBE_INPUT.*(无法证明|不属于|自己的产物)/,
      '非空且没有产物清单的目录不得被删',
    );
    assert.equal(existsSync(path.join(out, 'someone-elses-file.txt')), true, '别人的文件必须留着');

    // 有了 probe-manifest.json 就证明是本脚本的产物：允许覆盖重打包
    await writeFile(path.join(out, 'probe-manifest.json'), '{"schemaVersion":1,"files":[]}\n');
    await writeFile(path.join(out, 'stale-leftover.js'), 'stale\n');
    const result = await packager.packageProbe({ repoRoot: repo, cliRoot, out });
    assert.equal(result.verification.ok, true, result.verification.reasons.join('；'));
    assert.equal(existsSync(path.join(out, 'stale-leftover.js')), false, '上次的残留必须被清掉');
    assert.equal(existsSync(path.join(out, 'someone-elses-file.txt')), false, '已认领的产物目录内的旧文件应被清掉');
    // 空目录同样允许（没有任何东西可证明，但也没有任何东西可误删）
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    const again = await packager.packageProbe({ repoRoot: repo, cliRoot, out });
    assert.equal(again.verification.ok, true);
  }, 180_000);
});

describe('复核必须无过滤枚举', () => {
  /** 打包一份干净产物，返回 {root, restore}。 */
  const pack = async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-verify-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });
    const { root } = await packager.packageProbe({ repoRoot: REPO_ROOT, cliRoot, out: path.join(cliRoot, 'dist', 'probe') });
    return { root, work };
  };

  it('追加 .env / node_modules / dist 残留都必须让复核失败', async (t) => {
    const { root } = await pack(t);
    let verified = await packager.verifyProbeBundle(root);
    assert.equal(verified.ok, true, verified.reasons.join('；'));

    // C 的复现：复核复用带排除过滤的枚举，这些东西追加进去 --check 仍报 ok。
    const injected = [
      [path.join(root, '.env'), 'SECRET=1\n'],
      [path.join(root, 'node_modules', 'extra', 'index.js'), 'module.exports = 1\n'],
      [path.join(root, 'dist', 'residue.js'), 'leftover\n'],
      [path.join(root, 'resources', 'examples', 'vue', 'dist', 'index.js'), 'leftover\n'],
      [path.join(root, 'resources', 'examples', 'vue', '.env'), 'SECRET=1\n'],
      [path.join(root, 'extra.json'), '{}\n'],
    ];
    for (const [file, body] of injected) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    }
    verified = await packager.verifyProbeBundle(root);
    assert.equal(verified.ok, false, '追加任何文件都必须让复核失败');
    assert.ok(verified.extra.length >= injected.length, `清单外文件应全部检出：${verified.extra.join(', ')}`);
    assert.ok(verified.polluted.includes('.env'), `污染项应含 .env：${verified.polluted.join(', ')}`);
    assert.ok(
      verified.polluted.some((rel) => rel.startsWith('node_modules')),
      `污染项应含 node_modules：${verified.polluted.join(', ')}`,
    );
    assert.ok(
      verified.polluted.some((rel) => rel.startsWith('dist')),
      `污染项应含 dist：${verified.polluted.join(', ')}`,
    );
    assert.match(verified.reasons.join('；'), /清单外文件/);
  }, 120_000);

  it('清单内文件被删掉也必须失败', async (t) => {
    const { root } = await pack(t);
    await rm(path.join(root, 'resources', 'examples', 'fixtures', 'ranking.json'));
    const verified = await packager.verifyProbeBundle(root);
    assert.equal(verified.ok, false);
    assert.ok(verified.missing.includes('resources/examples/fixtures/ranking.json'), `缺失清单：${verified.missing.join(', ')}`);
  });

  it('清单未标记完成（上一次打包中断）时必须失败', async (t) => {
    const { root } = await pack(t);
    const manifestPath = path.join(root, 'probe-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, complete: false }, null, 2)}\n`);
    const verified = await packager.verifyProbeBundle(root);
    assert.equal(verified.ok, false, '未完成的清单不得当成完整产物');
    assert.match(verified.reasons.join('；'), /未标记为已完成|未完成/);
  });

  it('产物里出现符号链接必须被检出', async (t) => {
    const { root } = await pack(t);
    const kind = makeLink(path.join(REPO_ROOT, 'examples'), path.join(root, 'resources', 'examples-link'));
    if (kind === null) {
      return t.skip('当前用户无权创建符号链接/Junction，跳过');
    }
    const verified = await packager.verifyProbeBundle(root);
    assert.equal(verified.ok, false, '符号链接必须让复核失败');
    assert.ok(verified.links.length > 0, `链接清单：${verified.links.join(', ')}`);
    assert.match(verified.reasons.join('；'), /链接/);
  }, 120_000);

  it('--check 模式把污染现形，退出码非零', async (t) => {
    const { root } = await pack(t);
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'x.js'), 'x\n');
    const script = path.join(REPO_ROOT, 'packages', 'component-cli', 'scripts', 'package-probe.mjs');
    const result = spawnSync(process.execPath, [script, '--check', '--out', root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, `--check 应当失败：${result.stdout}`);
    assert.match(`${result.stdout}${result.stderr}`, /污染|清单外/);
  }, 120_000);
});

describe('安装包只读与任意 cwd', () => {
  it('以两个点开头的普通包内目录仍受只读边界保护', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'c-probe-dotdot-name-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const boundary = path.join(work, 'installed-cli');
    await mkdir(boundary);
    const inside = path.join(boundary, '..output');
    const probe = await import(pathToFileURL(path.join(PROBE_DIR, 'probe.mjs')).href);
    const consumer = await import(pathToFileURL(path.join(PROBE_DIR, 'consumer.mjs')).href);
    assert.equal(packager.isInside(inside, boundary), true);
    assert.equal(consumer.checkOutsideRepo(inside, boundary).ok, false);
    assert.throws(() => probe.resolveOutputDir({ out: inside, boundary }), /PROBE_INPUT/);
    assert.equal(existsSync(inside), false);
    assert.equal(consumer.checkOutsideRepo(path.join(work, '..outside'), boundary).ok, true);
  });

  it('默认输出落在调用者 cwd，绝不落在安装包目录内', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-out-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const { cliRoot, packaged } = await makeInstalledPackage(work);

    const probe = await import(pathToFileURL(path.join(PROBE_DIR, 'probe.mjs')).href);
    const layout = probe.resolveProbeLayout(packaged);
    assert.equal(layout.packaged, true, '必须识别为已打包形态');
    assert.equal(layout.resourceRoot, path.join(packaged, 'resources'));
    // 只读边界必须是**整个已安装包**，不只是 dist/probe：
    // 往 dist/ 或 lib/ 里写东西一样污染安装目录。
    assert.equal(layout.installRoot, packaged);
    assert.equal(layout.packageRoot, cliRoot);
    // 默认输出基座是 cwd，不是安装包目录
    for (const cwd of [work, path.join(work, 'nested', 'deeper'), tmpdir()]) {
      const out = probe.defaultOutputDir({ cwd, at: new Date('2026-11-14T00:00:00.000Z') });
      assert.equal(path.resolve(out).startsWith(path.resolve(cwd) + path.sep), true, `默认输出必须落在 ${cwd} 下`);
      assert.equal(
        out.startsWith(path.resolve(packaged)),
        false,
        `默认输出不得落在安装包目录内：${out}`,
      );
    }
  }, 120_000);

  it('cwd 落在安装包内时，默认输出必须改道而不是写进安装包', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-incwd-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const { cliRoot, packaged } = await makeInstalledPackage(work);

    const probe = await import(pathToFileURL(path.join(PROBE_DIR, 'probe.mjs')).href);
    const layout = probe.resolveProbeLayout(packaged);
    const at = new Date('2026-11-14T00:00:00.000Z');
    // 三种"人在包里"的 cwd：包根本身、dist 下、dist/probe 里
    for (const cwd of [cliRoot, path.join(cliRoot, 'dist'), packaged]) {
      const plan = probe.resolveOutputDir({ cwd, at, boundary: layout.packageRoot });
      assert.equal(plan.substituted, true, `cwd=${cwd} 在安装包内，默认输出必须改道`);
      assert.equal(
        plan.dir.startsWith(path.resolve(cliRoot)),
        false,
        `改道后的输出不得仍在安装包内：${plan.dir}`,
      );
      assert.match(plan.reason, /安装包|只读/);
    }
    // cwd 在包外时不改道
    const outside = probe.resolveOutputDir({ cwd: work, at, boundary: layout.packageRoot });
    assert.equal(outside.substituted, false);
    assert.equal(outside.dir.startsWith(path.resolve(work)), true);
  }, 120_000);

  it('--out 落在安装包内时，必须在任何写入之前就拒绝', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-outguard-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const { cliRoot, packaged } = await makeInstalledPackage(work);

    const probe = await import(pathToFileURL(path.join(PROBE_DIR, 'probe.mjs')).href);
    const layout = probe.resolveProbeLayout(packaged);
    const before = await snapshot(cliRoot);
    for (const out of [packaged, path.join(cliRoot, 'dist', 'other'), path.join(cliRoot, 'lib')]) {
      assert.throws(
        () => probe.resolveOutputDir({ out, boundary: layout.packageRoot }),
        /PROBE_INPUT/,
        `--out ${out} 落在安装包内必须拒绝`,
      );
    }
    // 包外放行
    const ok = probe.resolveOutputDir({ out: path.join(work, 'out'), boundary: layout.packageRoot });
    assert.equal(ok.substituted, false);
    assert.equal(ok.dir, path.join(work, 'out'));
    // 一个字节都没写进去
    assert.deepEqual(await snapshot(cliRoot), before, '拒绝时不得往安装包里写任何东西');
  }, 120_000);

  it('consumer-root 落在安装包内时必须被拒绝，且覆盖整个安装包而非只 dist/probe', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-ro-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const { cliRoot, packaged } = await makeInstalledPackage(work);

    const probe = await import(pathToFileURL(path.join(PROBE_DIR, 'probe.mjs')).href);
    const layout = probe.resolveProbeLayout(packaged);
    const consumer = await import(pathToFileURL(path.join(PROBE_DIR, 'consumer.mjs')).href);
    // 安装包是只读分发物：往里写消费者或输出都等于污染安装目录。
    // 边界必须是**整个 packageRoot**，不能只圈 dist/probe——否则
    // 「消费者建在 dist/other」这种绕法就漏过去了。
    for (const candidate of [
      cliRoot,
      packaged,
      path.join(packaged, 'resources'),
      path.join(packaged, 'resources', 'examples'),
      path.join(packaged, 'a-t10-consumer'),
      path.join(cliRoot, 'dist', 'other-consumer'),
      path.join(cliRoot, 'lib', 'consumer'),
    ]) {
      const outside = consumer.checkOutsideRepo(candidate, layout.packageRoot);
      assert.equal(outside.ok, false, `消费者根 ${candidate} 落在安装包内，必须拒绝`);
    }
    // 安装包**之外**必须放行：外部临时目录、调用者 cwd 都该能建消费者
    for (const candidate of [work, path.join(work, 'nested', 'a-t10-consumer'), tmpdir()]) {
      const outside = consumer.checkOutsideRepo(candidate, layout.packageRoot);
      assert.equal(outside.ok, true, `消费者根 ${candidate} 在安装包外，不该被拒：${outside.reason ?? ''}`);
    }
  }, 120_000);

  it('资源缺失时必须给出可行动诊断，而不是崩在半路', async (t) => {
    const probe = await import(pathToFileURL(path.join(PROBE_DIR, 'probe.mjs')).href);
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-bare-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    // 只有 probe.mjs、没有 resources/：正是"打包漏了资源"的现场
    const bare = path.join(work, 'dist', 'probe');
    await mkdir(bare, { recursive: true });
    await writeFile(path.join(bare, 'probe.mjs'), '// 空壳\n');
    assert.throws(
      () => probe.resolveProbeLayout(bare),
      /PROBE_INPUT.*资源|resources/s,
      '缺资源必须明确报错并指出 resources',
    );
  });

  it('缺浏览器工具链时，两种形态给不同处方', async (t) => {
    const browser = await import(pathToFileURL(path.join(PROBE_DIR, 'browser.mjs')).href);
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-diag-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    // 仓库形态：browser.mjs 的上一级没有 resources/
    const repoForm = path.join(work, 'repo', 'tests', 'acceptance', 't10-sdk');
    await mkdir(repoForm, { recursive: true });
    await writeFile(path.join(repoForm, 'browser.mjs'), '// 占位\n');
    const repoMsg = browser.browserMissingDiagnostic(pathToFileURL(path.join(repoForm, 'browser.mjs')).href);
    assert.match(repoMsg, /仓库根执行 pnpm install/, '仓库形态应指向仓库根安装');

    // 打包形态：上一级就是 resources/
    const packaged = path.join(work, 'install', 'dist', 'probe');
    await mkdir(path.join(packaged, 'resources', 'examples'), { recursive: true });
    await writeFile(path.join(packaged, 'browser.mjs'), '// 占位\n');
    const packagedMsg = browser.browserMissingDiagnostic(pathToFileURL(path.join(packaged, 'browser.mjs')).href);
    assert.match(packagedMsg, /@playwright\/test@1\.65\.0/, '安装形态应指向 CLI 运行依赖');
    assert.match(packagedMsg, /playwright install chromium|PLAYWRIGHT_BROWSERS_PATH/, '应提示装浏览器');
    assert.match(packagedMsg, /--skip-browser/, '应说明可以显式跳过浏览器维度');
    // 关键：不能让安装用户去跑"仓库根 pnpm install"——那在安装形态下根本不存在
    assert.equal(/仓库根执行 pnpm install/.test(packagedMsg), false, '安装形态不得给仓库处方');
  });
});

describe('随包自检', () => {
  /**
   * 安装后跑随包分发的 `probe.test.mjs`。
   *
   * C 的复现：`node --test --test-name-pattern fixture <installed>/dist/probe/probe.test.mjs`
   * 在安装形态下是 0 pass / 2 ENOENT，而同一份文件在源码树里是 2 pass——因为测试里
   * 写死了 `HERE/../../..` 与 `examples/fixtures`。修复是让测试走同一个
   * `resolveProbeLayout()`，两种形态一套代码。
   */
  it('安装后跑 fixture 用例必须真的 2 pass，而不是 0 pass / ENOENT', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-selftest-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const { packaged } = await makeInstalledPackage(work);

    // NODE_TEST_CONTEXT 必须清掉：外层 node:test 会把它设成 child-v8，
    // 内层 `node --test` 见到它就认为自己是"被父运行器接管的子进程"，
    // 于是把 reporter 输出整份吞掉——stdout 是空串、退出码却是 0。
    // 不删它的话这条断言永远拿不到证据（且看起来像"静悄悄通过了"）。
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-name-pattern', 'fixture', path.join(packaged, 'probe.test.mjs')],
      { encoding: 'utf8', env },
    );
    assert.equal(result.status, 0, `退出码应为 0：\n${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.length > 0, '必须真的拿到测试输出（NODE_TEST_CONTEXT 已清）');
    assert.match(result.stdout, /\bpass 2\b/, `应通过 2 例：\n${result.stdout}`);
    assert.match(result.stdout, /\bfail 0\b/, `不应有失败：\n${result.stdout}`);
    assert.equal(/ENOENT/.test(`${result.stdout}${result.stderr}`), false, '不得有 ENOENT');
  }, 180_000);

  it('安装后 probe.mjs 认得打包形态，且入口/资源都在安装包内', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-layout-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const { cliRoot, packaged } = await makeInstalledPackage(work);

    // 用安装包里那份 probe.mjs 自己报布局，避免"测的是仓库里那份"
    const script = `import(${JSON.stringify(pathToFileURL(path.join(packaged, 'probe.mjs')).href)}).then((m) => {
      const l = m.resolveProbeLayout(${JSON.stringify(packaged)});
      process.stdout.write(JSON.stringify({ packaged: l.packaged, installRoot: l.installRoot, packageRoot: l.packageRoot }));
    })`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `退出码应为 0：${result.stderr}`);
    const layout = JSON.parse(result.stdout);
    assert.equal(layout.packaged, true, '安装形态必须被认出');
    assert.equal(layout.installRoot, packaged);
    assert.equal(layout.packageRoot, cliRoot);
  }, 120_000);

  it('安装后 probe.mjs --help 可用，文案里不出现仓库绝对路径', async (t) => {
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-help-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const { packaged } = await makeInstalledPackage(work);
    const result = spawnSync(process.execPath, [path.join(packaged, 'probe.mjs'), '--help'], {
      encoding: 'utf8',
      cwd: work,
    });
    assert.equal(result.status, 0, `--help 应可用：${result.stderr}`);
    assert.match(result.stdout, /--bundle/);
    assert.equal(result.stdout.includes(REPO_ROOT), false, '帮助文案不得泄漏源码仓库绝对路径');
  }, 120_000);
});
