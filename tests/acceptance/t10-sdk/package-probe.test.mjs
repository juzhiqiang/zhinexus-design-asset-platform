/**
 * T10 探针随 CLI 分发的打包材料回归（node:test）。
 *
 * 运行：`node --test tests/acceptance/t10-sdk/package-probe.test.mjs`
 *
 * 背景：探针原先只活在源码仓库里（`REPO_ROOT = HERE/../../..`）。要让它随
 * `@company/component-cli` 一起发布，就必须把探针本身 + Vue/React 模板 + fixtures +
 * `tsconfig.base.json` 按**白名单**打进 `packages/component-cli/dist/probe/`，
 * 并且让探针在安装后的目录结构下仍能跑。
 *
 * 这一组先写失败（RED）：四个验收面各自一条——
 *   ① 缺失资源：打包产物少文件 / 清单不完整；
 *   ② 污染目录：`node_modules` / `dist` / `.turbo` / `.git` / 密钥被打进包；
 *   ③ 安装包只读：探针不得把默认输出或消费者写进安装包目录；
 *   ④ 任意 cwd：探针不得依赖调用时的工作目录或源码仓库绝对路径。
 *
 * 涉及真实文件复制，因此用临时目录；不触网、不装依赖。
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PROBE_DIR = path.join(REPO_ROOT, 'tests', 'acceptance', 't10-sdk');

// 打包脚本由 B 的 CLI 包承载，但脚本本体归 A。用 file URL 而不是裸相对路径：
// 相对 import 的基准是**本文件**，写成 '../../packages/...' 会解析到 tests/packages/...。
const PACKAGER = pathToFileURL(
  path.join(REPO_ROOT, 'packages', 'component-cli', 'scripts', 'package-probe.mjs'),
).href;

describe('打包材料完整性（缺失资源）', () => {
  it('dist/probe 必须包含探针全部模块与三份必要资源', async (t) => {
    const packager = await import(PACKAGER).catch((error) => {
      throw new Error(`打包脚本不可导入：${String(error?.message ?? error)}`);
    });
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-pack-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });

    const result = await packager.packageProbe({ repoRoot: REPO_ROOT, cliRoot, out: path.join(cliRoot, 'dist', 'probe') });
    const root = result.root;

    // 探针自身：八个模块一个不能少，少一个入口就起不来
    for (const name of [
      'probe.mjs', 'environment.mjs', 'bundle.mjs', 'policy.mjs',
      'consumer.mjs', 'browser.mjs', 'evidence.mjs', 'probe.test.mjs',
    ]) {
      assert.equal(existsSync(path.join(root, name)), true, `缺少探针模块 ${name}`);
    }
    // 必要资源：双框架模板 + fixtures + tsconfig.base.json
    for (const rel of [
      path.join('resources', 'examples', 'vue', 'package.json'),
      path.join('resources', 'examples', 'react', 'package.json'),
      path.join('resources', 'examples', 'fixtures', 'line.json'),
      path.join('resources', 'examples', 'fixtures', 'trend-card.json'),
      path.join('resources', 'tsconfig.base.json'),
    ]) {
      assert.equal(existsSync(path.join(root, rel)), true, `缺少资源 ${rel}`);
    }
    // 清单必须逐文件可核对：条数、摘要、字节数都对上
    const manifest = await packager.readProbeManifest(root);
    assert.ok(manifest, '必须产出 probe-manifest.json');
    assert.ok(manifest.files.length > 0, '清单不能为空');
    assert.equal(manifest.entry, 'probe.mjs');
    // 入口必须是 <安装目录>/probe/probe.mjs，即 dist/probe/probe.mjs
    assert.equal(path.join(path.basename(root), manifest.entry), path.join('probe', 'probe.mjs'));
    assert.equal(existsSync(path.join(root, 'probe.mjs')), true, '入口文件必须真的在那');
    for (const entry of manifest.files) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${entry.path} 摘要格式不对`);
      assert.ok(entry.bytes > 0, `${entry.path} 字节数必须大于 0`);
    }
    // 复核：清单里的每个文件都真的在，且没有清单外的文件
    const verified = await packager.verifyProbeBundle(root);
    assert.deepEqual(verified.missing, [], '清单内文件缺失');
    assert.deepEqual(verified.extra, [], '存在清单外文件');
    assert.deepEqual(verified.polluted, [], '存在被排除项污染');
    assert.equal(verified.ok, true, verified.reasons?.join('；') ?? '');
  }, 120_000);
});

describe('打包材料不得污染（本地状态与密钥）', () => {
  /** 造一个"本机刚构建过、还留着密钥"的假仓库。 */
  const makeDirtyRepo = async (root) => {
    await cp(path.join(REPO_ROOT, 'examples'), path.join(root, 'examples'), {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return !['node_modules', 'dist', '.turbo', '.git'].includes(base);
      },
    });
    await cp(path.join(REPO_ROOT, 'tests', 'acceptance', 't10-sdk'), path.join(root, 'tests', 'acceptance', 't10-sdk'), {
      recursive: true,
      filter: (src) => path.basename(src) !== 'node_modules',
    });
    await cp(path.join(REPO_ROOT, 'tsconfig.base.json'), path.join(root, 'tsconfig.base.json'));
    // 本地状态
    for (const rel of [
      path.join('examples', 'vue', 'node_modules', 'vue', 'index.js'),
      path.join('examples', 'vue', 'dist', 'assets', 'index.js'),
      path.join('examples', 'vue', '.turbo', 'turbo-build.log'),
      path.join('examples', 'react', 'node_modules', 'react', 'index.js'),
      path.join('examples', 'react', 'dist', 'assets', 'index.js'),
      path.join('tests', 'acceptance', 't10-sdk', 'node_modules', 'x', 'index.js'),
    ]) {
      const file = path.join(root, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'local state\n');
    }
    await mkdir(path.join(root, '.git', 'objects'), { recursive: true });
    await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    // 密钥与既有输出
    await writeFile(path.join(root, 'examples', 'vue', '.env'), 'SECRET=1\n');
    await writeFile(path.join(root, 'examples', 'vue', 'signing.pem'), '<SECRET_3021d90e>\n');
    await writeFile(path.join(root, 'examples', 'vue', 'id_rsa'), '<SECRET_8bcac790>\n');
    await mkdir(path.join(root, 'test-results', 't10-sdk-probes'), { recursive: true });
    await writeFile(path.join(root, 'test-results', 't10-sdk-probes', 'old.json'), '{}\n');
    await writeFile(path.join(root, 'examples', 'vue', 'tsconfig.tsbuildinfo'), '{}\n');
    return root;
  };

  it('本地状态、密钥与既有输出都不得进入 dist/probe', async (t) => {
    const packager = await import(PACKAGER);
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-dirty-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const dirty = await makeDirtyRepo(path.join(work, 'repo'));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });

    const result = await packager.packageProbe({ repoRoot: dirty, cliRoot, out: path.join(cliRoot, 'dist', 'probe') });
    const root = result.root;
    // 该在的还在
    assert.equal(existsSync(path.join(root, 'probe.mjs')), true);
    assert.equal(existsSync(path.join(root, 'resources', 'examples', 'vue', 'package.json')), true);
    // 不该在的一律不得在
    for (const rel of [
      path.join('resources', 'examples', 'vue', 'node_modules'),
      path.join('resources', 'examples', 'vue', 'dist'),
      path.join('resources', 'examples', 'vue', '.turbo'),
      path.join('resources', 'examples', 'react', 'node_modules'),
      path.join('resources', 'examples', 'react', 'dist'),
      'node_modules',
      '.git',
      path.join('resources', 'examples', 'vue', '.env'),
      path.join('resources', 'examples', 'vue', 'signing.pem'),
      path.join('resources', 'examples', 'vue', 'id_rsa'),
      path.join('resources', 'examples', 'vue', 'tsconfig.tsbuildinfo'),
      path.join('resources', 'test-results'),
      'test-results',
    ]) {
      assert.equal(existsSync(path.join(root, rel)), false, `污染项泄漏：${rel}`);
    }
    const verified = await packager.verifyProbeBundle(root);
    assert.deepEqual(verified.polluted, [], `污染项：${verified.polluted.join(', ')}`);
    assert.equal(verified.ok, true);
    // 白名单是显式的：不得靠"复制整个仓库"蒙过去
    assert.ok(packager.PROBE_RESOURCE_SPEC.probeModules.length >= 8, '探针模块白名单必须显式列出');
    assert.ok(packager.PROBE_RESOURCE_SPEC.templates.includes('vue'));
    assert.ok(packager.PROBE_RESOURCE_SPEC.templates.includes('react'));
  }, 120_000);

  it('isExcluded 对嵌套本地状态与密钥后缀一律拒绝', async (t) => {
    const packager = await import(PACKAGER);
    for (const rel of [
      'node_modules',
      'resources/examples/vue/node_modules/vue/index.js',
      'resources/examples/vue/dist/assets/index.js',
      'resources/examples/vue/.turbo/x.log',
      '.git/HEAD',
      'resources/examples/vue/.env',
      'resources/examples/vue/signing.pem',
      'resources/examples/vue/id_rsa',
      'resources/examples/vue/tsconfig.tsbuildinfo',
      'resources/test-results/x.json',
      'resources/coverage/lcov.info',
    ]) {
      assert.equal(packager.isExcluded(rel), true, `${rel} 必须被排除`);
    }
    for (const rel of [
      'probe.mjs',
      'consumer.mjs',
      'resources/examples/vue/package.json',
      'resources/examples/vue/src/App.vue',
      'resources/examples/fixtures/line.json',
      'resources/tsconfig.base.json',
    ]) {
      assert.equal(packager.isExcluded(rel), false, `${rel} 不该被排除`);
    }
  });

  it('改动安装包里任何一个字节都必须被摘要核对抓到', async (t) => {
    const packager = await import(PACKAGER);
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

describe('安装包只读与任意 cwd', () => {
  it('默认输出落在调用者 cwd，绝不落在安装包目录内', async (t) => {
    const packager = await import(PACKAGER);
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-out-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const cliRoot = path.join(work, 'cli', 'node_modules', '@company', 'component-cli');
    await mkdir(cliRoot, { recursive: true });
    const packaged = path.join(cliRoot, 'dist', 'probe');
    await packager.packageProbe({ repoRoot: REPO_ROOT, cliRoot, out: packaged });

    const probe = await import(pathToFileURL(path.join(PROBE_DIR, 'probe.mjs')).href);
    const layout = probe.resolveProbeLayout(packaged);
    assert.equal(layout.packaged, true, '必须识别为已打包形态');
    assert.equal(layout.resourceRoot, path.join(packaged, 'resources'));
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

  it('消费者根目录落在安装包内时必须被拒绝', async (t) => {
    const packager = await import(PACKAGER);
    const work = await mkdtemp(path.join(tmpdir(), 'a-t10-ro-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const cliRoot = path.join(work, 'cli');
    await mkdir(cliRoot, { recursive: true });
    const packaged = path.join(cliRoot, 'dist', 'probe');
    await packager.packageProbe({ repoRoot: REPO_ROOT, cliRoot, out: packaged });

    const probe = await import(pathToFileURL(path.join(PROBE_DIR, 'probe.mjs')).href);
    const layout = probe.resolveProbeLayout(packaged);
    const consumer = await import(pathToFileURL(path.join(PROBE_DIR, 'consumer.mjs')).href);
    // 安装包是只读分发物：往里写消费者或输出都等于污染安装目录。
    // 边界必须是**整个 installRoot**，不能只圈 resources/——否则
    // 「消费者建在 dist/probe 下但不在 resources 下」这种绕法就漏过去了。
    assert.equal(layout.installRoot, packaged);
    for (const candidate of [
      packaged,
      path.join(packaged, 'resources'),
      path.join(packaged, 'resources', 'examples'),
      path.join(packaged, 'a-t10-consumer'),
      path.join(packaged, '..', 'probe', 'a-t10-consumer'),
    ]) {
      const outside = consumer.checkOutsideRepo(candidate, layout.installRoot);
      assert.equal(outside.ok, false, `消费者根 ${candidate} 落在安装包内，必须拒绝`);
    }
    // 安装包**之外**必须放行：外部临时目录、调用者 cwd 都该能建消费者
    for (const candidate of [work, path.join(work, 'nested', 'a-t10-consumer'), tmpdir()]) {
      const outside = consumer.checkOutsideRepo(candidate, layout.installRoot);
      assert.equal(outside.ok, true, `消费者根 ${candidate} 在安装包外，不该被拒：${outside.reason ?? ''}`);
    }
  }, 120_000);
});
