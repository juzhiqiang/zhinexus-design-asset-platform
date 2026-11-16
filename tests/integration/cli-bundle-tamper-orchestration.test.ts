import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';

/**
 * 二期发布验收补齐（T04）**prepareReleaseBundle 编排级** RED→GREEN 测试。
 *
 * 独立审查实证（2026-11-16 12:56:54，仓库外探针 6/6 断言通过）确认的编排错绑：
 * - `manifest.ts` 第 211–215 / 243–249 行：冻结后先把 tarball **复制进 bundleDir/packages**，
 *   `createArtifactRef` 记录的是**副本**摘要；
 * - 第 284–289 行：消费者安装的却是 `frozen*.tarballPath`，即 **staging 原路径**；
 * - 第 426 / 444 行：报告 `packageSha256` 用冻结时算出的 staging 摘要；
 * - 第 603–608 行删除 staging；第 610–611 行只对 bundle 调 `validateReleaseBundle`。
 *
 * 后果：只篡改 **staging 源**（bundle 副本保持原样）时——
 * - 消费者真实安装到的是篡改后字节；
 * - bundle 副本未被碰，`validateReleaseBundle` 的字节/摘要核对全部通过；
 * - 报告里的 `packageSha256` 与 bundle 副本一致，`validateManifest` 的绑定也通过；
 * → `prepareReleaseBundle.ok === true`，但截图与报告实际对应的是**另一份字节**。
 * 探针记录到「消费者 file: 路径真实读取 SHA ≠ bundle 包 SHA」，而 ok 仍为 true。
 *
 * 本文件用 mock 结构复现同一窗口（沙箱读不到宿主 Temp 下的探针文件，按其描述的关键手法实现：
 * **从消费者 package.json 的 file: 路径记录真实读取 SHA**），并断言编排必须失败关闭。
 *
 * 断言形态（C 2026-11-16 终审补充）：`prepareReleaseBundle` 只有 `finally`、无 `catch`，
 * 核对失败直接向上抛错，因此篡改用例用 `rejects.toThrow` 断言错误码，
 * 并确认 `bundleDir/reports` 无报告、`manifest.json` 未生成；**不为测试改动现有 API 错误形态**。
 *
 * mock 边界（只 mock 昂贵/环境相关部分，**不** mock 冻结、摘要、报告与校验）：
 * - `local/pack.js` 的 `packPackage`：跳过真实 pnpm pack，产出确定性 tarball 字节；
 * - `node:child_process` 的 `spawnSync`：跳过真实 npm install / npm run build，
 *   并**如实记录从消费者 package.json file: 路径读取到的真实 SHA-256**；
 * - `vite` 的 `createServer`：跳过真实 Vite 服务；
 * - `local/capture.js` 的 `captureExample`：跳过真实 Playwright，产出确定性截图与自检；
 * - 保持真实：`freezePackageRelease` / `verifyFrozenTarball` / `buildCheckReport` /
 *   `buildComponentApi` / `validateComponentApi` / `validateReleaseBundle`。
 */

const repoRoot = path.resolve(__dirname, '../../');

/** 测试文件自身按 NodeNext ESM 运行，用 createRequire 取得同步 CJS 入口（与 gallery 测试同手法）。 */
const testRequire = createRequire(import.meta.url);

/** 跨 mock 边界共享状态（vi.hoisted 使工厂函数可引用）。 */
const harness = vi.hoisted(() => ({
  /** 篡改阶段：null=不篡改；'install'=安装期间；'capture'=截图期间 */
  phase: null as null | 'install' | 'capture',
  /** 篡改目标：只改 staging 里的 core 或 framework 源，bundle 副本不动 */
  target: 'core' as 'core' | 'framework',
  stagingDir: '',
  /** 消费者安装时从 package.json 的 file: 路径真实读取到的 SHA-256（按包名索引） */
  installedSha256: {} as Record<string, string>,
  /** install stub 独立保存的「冻结时」摘要（按包名索引，篡改前采样） */
  frozenSha256: {} as Record<string, string>,
  /** 篡改发生时记录的变异后摘要（按包名索引，capture 场景的证据） */
  mutatedSha256: {} as Record<string, string>,
}));

/** staging 子目录 → 包名。 */
function packageNameForSub(sub: 'core' | 'vue' | 'react'): string {
  if (sub === 'core') return '@company/charts-core';
  return sub === 'vue' ? '@company/charts-vue' : '@company/charts-react';
}

/** 翻转 staging 指定子目录下所有 tarball 的末字节（只动 staging 源）。 */
function flipStagingTarballs(stagingDir: string, sub: 'core' | 'vue' | 'react'): void {
  const dir = path.join(stagingDir, sub);
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.tgz')) continue;
    const tarballPath = path.join(dir, entry);
    const bytes = fs.readFileSync(tarballPath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    fs.writeFileSync(tarballPath, bytes);
    // 如实记录变异后的磁盘摘要，作为「源确已被改动」的证据
    harness.mutatedSha256[packageNameForSub(sub)] = sha256Hex(bytes);
  }
}

/** 记录消费者真实读取到的 SHA：按探针手法，从 package.json 的 file: 依赖路径现算。 */
function recordInstalledSha256(cwd: string): void {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  for (const [name, spec] of Object.entries(pkgJson.dependencies ?? {})) {
    if (!spec.startsWith('file:')) continue;
    const tarballPath = path.resolve(spec.slice('file:'.length));
    if (!fs.existsSync(tarballPath)) continue;
    // 同步现算，避免与 mock 生命周期竞争
    harness.installedSha256[name] = sha256Hex(fs.readFileSync(tarballPath));
  }
}

/** 与 contracts 的 SHA-256 编码保持一致的小写十六进制。 */
function sha256Hex(bytes: Buffer): string {
  const { createHash } = testRequire('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

/** 两端必须确实采样到摘要，避免 undefined 与字符串不等造成假通过。 */
function expectChangedSha(actual: string | undefined, frozen: string | undefined): void {
  expect(actual).toMatch(/^[a-f0-9]{64}$/);
  expect(frozen).toMatch(/^[a-f0-9]{64}$/);
  expect(actual).not.toBe(frozen);
}

vi.mock('../../packages/component-cli/src/local/pack.js', () => ({
  resolvePnpmExecutable: () => 'pnpm',
  packPackage: vi.fn(async (options: { packageDir: string; outputDir: string }) => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(options.packageDir, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    const bytes = Buffer.from(`frozen-tarball:${pkgJson.name}@${pkgJson.version}\n`, 'utf8');
    const tarballName = `${pkgJson.name.replace(/^@/, '').replace(/\//g, '-')}-${pkgJson.version}.tgz`;
    const tarballPath = path.join(options.outputDir, tarballName);
    await fs.promises.mkdir(options.outputDir, { recursive: true });
    await fs.promises.writeFile(tarballPath, bytes);
    return {
      tarballPath,
      tarballName,
      packageName: pkgJson.name,
      version: pkgJson.version,
      sha256: sha256Hex(bytes),
      bytes: bytes.byteLength,
    };
  }),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn((_cmd: string, args: string[], options: { cwd?: string }) => {
      const cwd = options?.cwd;
      if (cwd && Array.isArray(args) && args[0] === 'install') {
        // 先独立保存「冻结时」摘要（篡改前采样），供 install 场景证明 file: 来源差异
        if (harness.stagingDir) {
          for (const sub of ['core', 'vue', 'react'] as const) {
            const dir = path.join(harness.stagingDir, sub);
            if (!fs.existsSync(dir)) continue;
            const entry = fs.readdirSync(dir).find((f) => f.endsWith('.tgz'));
            if (!entry) continue;
            const pkgName = packageNameForSub(sub);
            harness.frozenSha256[pkgName] = sha256Hex(fs.readFileSync(path.join(dir, entry)));
          }
        }
        // 安装前按目标篡改 staging 源：bundle 副本保持原样
        if (harness.phase === 'install' && harness.stagingDir) {
          if (harness.target === 'core') flipStagingTarballs(harness.stagingDir, 'core');
          else {
            flipStagingTarballs(harness.stagingDir, 'vue');
            flipStagingTarballs(harness.stagingDir, 'react');
          }
        }
        // 落盘 node_modules 标记
        const pkgJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>;
        };
        for (const name of Object.keys(pkgJson.dependencies ?? {})) {
          const marker = path.join(cwd, 'node_modules', name, 'package.json');
          fs.mkdirSync(path.dirname(marker), { recursive: true });
          fs.writeFileSync(marker, JSON.stringify({ name, version: '0.0.0' }), 'utf8');
        }
        // 关键：如实记录消费者从 file: 路径真实读取到的 SHA
        recordInstalledSha256(cwd);
      }
      return { status: 0, stdout: '', stderr: '', pid: 0, output: [], signal: null };
    }),
  };
});

vi.mock('vite', () => ({
  createServer: vi.fn(async () => ({
    listen: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    httpServer: { address: () => ({ port: 5199, address: '127.0.0.1', family: 'IPv4' }) },
    config: { server: { port: 5199 } },
  })),
}));

vi.mock('../../packages/component-cli/src/local/capture.js', () => ({
  captureExample: vi.fn(async (options: {
    outputDir: string;
    baseDir?: string;
    framework: 'vue' | 'react';
    frameworkVersion?: string;
    echartsVersion?: string;
    exampleId: string;
    variantId: string;
    packageSha256: string;
    packageVersion: string;
  }) => {
    const { detectEnvironment, computeEnvironmentKey } = await import(
      '../../packages/component-cli/src/local/environment.js'
    );
    const { createArtifactRef } = await import('../../packages/component-cli/src/local/digest.js');

    // 截图前按目标篡改 staging 源：bundle 副本保持原样
    if (harness.phase === 'capture' && harness.stagingDir) {
      if (harness.target === 'core') flipStagingTarballs(harness.stagingDir, 'core');
      else {
        flipStagingTarballs(harness.stagingDir, 'vue');
        flipStagingTarballs(harness.stagingDir, 'react');
      }
    }

    await fs.promises.mkdir(options.outputDir, { recursive: true });
    const shotPath = path.join(options.outputDir, `${options.variantId}-default.png`);
    await fs.promises.writeFile(shotPath, Buffer.from('deterministic-screenshot-bytes', 'utf8'));
    const logicalPath = options.baseDir
      ? path.relative(options.baseDir, shotPath).replace(/\\/g, '/')
      : `${options.variantId}-default.png`;
    const image = await createArtifactRef(shotPath, logicalPath);

    const environment = detectEnvironment({
      browserVersion: '130.0.0.0',
      browserRevision: '1000',
      fontDigest: '1'.repeat(64),
      framework: options.framework,
      frameworkVersion: options.frameworkVersion,
      echartsVersion: options.echartsVersion,
    });
    const environmentKey = computeEnvironmentKey(environment);

    return {
      environment,
      environmentKey,
      screenshots: [
        {
          id: `shot-${options.variantId}-default`,
          variantId: options.variantId,
          framework: options.framework,
          packageVersion: options.packageVersion,
          exampleId: options.exampleId,
          state: 'default',
          source: 'local-automatic',
          image,
          packageSha256: options.packageSha256,
          environmentKey,
        },
      ],
      checks: [{ name: 'render-verified', status: 'passed' }],
    };
  }),
}));


/** 读取 bundle 内 manifest 登记的某包摘要（仅用于**成功**用例；失败时 manifest 可能不存在）。 */
function bundleTarballSha256(bundleDir: string, packageName: string): string {
  const manifestPath = path.join(bundleDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    packages: { name: string; tarball: { path: string; sha256: string } }[];
  };
  const pkg = manifest.packages.find((p) => p.name === packageName);
  if (!pkg) throw new Error(`manifest 中未找到包 ${packageName}`);
  return pkg.tarball.sha256;
}

/**
 * 失败关闭的通用断言。
 *
 * `prepareReleaseBundle` 只有 `finally`、无 `catch`，核对失败直接向上抛错，
 * 因此这里用 `rejects` 断言错误形态（不为测试改现有 API 错误形状），
 * 并确认没有基于变动字节的成功报告 / manifest 落盘。
 */
async function expectTamperRejected(
  run: () => Promise<unknown>,
  bundleDir: string,
): Promise<void> {
  await expect(run()).rejects.toThrow(/TARBALL|冻结|摘要|digest|mutation|BUNDLE_COPY_MISMATCH/i);
  // 严禁把基于变动字节的截图写成有效证据
  const reportsDir = path.join(bundleDir, 'reports');
  const written = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir) : [];
  expect(written).toEqual([]);
  // 失败时不应留下 manifest（manifest 只在全部校验通过后才写入）
  expect(fs.existsSync(path.join(bundleDir, 'manifest.json'))).toBe(false);
}

describe('T04 缺口：prepareReleaseBundle 必须拒绝「只篡改 staging 源」的错绑', () => {
  it('未篡改时编排正常通过，且消费者真实读取 SHA 与 bundle 登记摘要一致', async () => {
    const { prepareReleaseBundle } = await import('../../packages/component-cli/src/local/manifest.js');
    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-tamper-control-'));
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-tamper-staging-'));
    harness.phase = null;
    harness.stagingDir = stagingDir;
    harness.installedSha256 = {};
    harness.frozenSha256 = {};
    harness.mutatedSha256 = {};

    try {
      const result = await prepareReleaseBundle({
        repoRoot,
        bundleDir,
        stagingDir,
        components: ['line'],
        frameworks: ['vue'],
        timeoutMs: 5000,
      });

      expect(result.ok).toBe(true);
      expect(result.manifest.packages.length).toBe(2);

      // 对照组：真实读取到的字节摘要必须与 bundle 登记摘要一致
      const coreSha = bundleTarballSha256(bundleDir, '@company/charts-core');
      const vueSha = bundleTarballSha256(bundleDir, '@company/charts-vue');
      expect(harness.installedSha256['@company/charts-core']).toBe(coreSha);
      expect(harness.installedSha256['@company/charts-vue']).toBe(vueSha);
      // 且 install stub 独立保存的「冻结时」摘要也与 bundle 一致
      expect(harness.frozenSha256['@company/charts-core']).toBe(coreSha);
      expect(harness.frozenSha256['@company/charts-vue']).toBe(vueSha);
    } finally {
      fs.rmSync(bundleDir, { recursive: true, force: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
      harness.phase = null;
      harness.stagingDir = '';
      harness.installedSha256 = {};
      harness.frozenSha256 = {};
      harness.mutatedSha256 = {};
    }
  });

  describe.each([
    { phase: 'install' as const, label: '安装期间' },
    { phase: 'capture' as const, label: '截图期间' },
  ])('$label 只篡改 staging 源', ({ phase, label }) => {
    describe.each(['vue', 'react'] as const)('%s 框架', (framework) => {
      const frameworkPkg = framework === 'vue' ? '@company/charts-vue' : '@company/charts-react';

      it(`${label}只篡改 staging core 源：编排必须失败关闭`, async () => {
        const { prepareReleaseBundle } = await import('../../packages/component-cli/src/local/manifest.js');
        const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), `bundle-tamper-${phase}-core-${framework}-`));
        const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `bundle-tamper-staging-${phase}-core-${framework}-`));
        harness.phase = phase;
        harness.target = 'core';
        harness.stagingDir = stagingDir;
        harness.installedSha256 = {};
        harness.frozenSha256 = {};
        harness.mutatedSha256 = {};

        try {
          await expectTamperRejected(
            () =>
              prepareReleaseBundle({
                repoRoot,
                bundleDir,
                stagingDir,
                components: ['line'],
                frameworks: [framework],
                timeoutMs: 5000,
              }),
            bundleDir,
          );

          if (phase === 'install') {
            // install 阶段：消费者真实装到的字节摘要 ≠ 冻结时摘要（错绑实证）
            expectChangedSha(harness.installedSha256['@company/charts-core'],
              harness.frozenSha256['@company/charts-core'],
            );
          } else {
            // capture 阶段：install 时字节仍是原始冻结字节（此处不断言安装摘要不同），
            // 改用篡改发生时记录的变异摘要，证明 staging 源确已被改动
            expectChangedSha(harness.mutatedSha256['@company/charts-core'],
              harness.frozenSha256['@company/charts-core'],
            );
          }
        } finally {
          fs.rmSync(bundleDir, { recursive: true, force: true });
          fs.rmSync(stagingDir, { recursive: true, force: true });
          harness.phase = null;
          harness.stagingDir = '';
          harness.installedSha256 = {};
          harness.frozenSha256 = {};
          harness.mutatedSha256 = {};
        }
      });

      it(`${label}只篡改 staging 框架源：编排必须失败关闭`, async () => {
        const { prepareReleaseBundle } = await import('../../packages/component-cli/src/local/manifest.js');
        const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), `bundle-tamper-${phase}-fw-${framework}-`));
        const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `bundle-tamper-staging-${phase}-fw-${framework}-`));
        harness.phase = phase;
        harness.target = 'framework';
        harness.stagingDir = stagingDir;
        harness.installedSha256 = {};
        harness.frozenSha256 = {};
        harness.mutatedSha256 = {};

        try {
          await expectTamperRejected(
            () =>
              prepareReleaseBundle({
                repoRoot,
                bundleDir,
                stagingDir,
                components: ['line'],
                frameworks: [framework],
                timeoutMs: 5000,
              }),
            bundleDir,
          );

          if (phase === 'install') {
            // install 阶段：消费者真实装到的框架包字节摘要 ≠ 冻结时摘要（错绑实证）
            expectChangedSha(harness.installedSha256[frameworkPkg],
              harness.frozenSha256[frameworkPkg],
            );
          } else {
            // capture 阶段：install 时仍是原始字节；用记录的变异摘要证明源已被改动
            expectChangedSha(harness.mutatedSha256[frameworkPkg],
              harness.frozenSha256[frameworkPkg],
            );
          }
        } finally {
          fs.rmSync(bundleDir, { recursive: true, force: true });
          fs.rmSync(stagingDir, { recursive: true, force: true });
          harness.phase = null;
          harness.stagingDir = '';
          harness.installedSha256 = {};
          harness.frozenSha256 = {};
          harness.mutatedSha256 = {};
        }
      });
    });
  });

  it('React 框架未被触碰时保持通过（对照：错绑只发生在 staging 被篡改时）', async () => {
    const { prepareReleaseBundle } = await import('../../packages/component-cli/src/local/manifest.js');
    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-tamper-react-untouched-'));
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-tamper-staging-react-untouched-'));
    harness.phase = null;
    harness.stagingDir = stagingDir;
    harness.installedSha256 = {};
    harness.frozenSha256 = {};
    harness.mutatedSha256 = {};

    try {
      const result = await prepareReleaseBundle({
        repoRoot,
        bundleDir,
        stagingDir,
        components: ['line'],
        frameworks: ['react'],
        timeoutMs: 5000,
      });

      expect(result.ok).toBe(true);
      const reactSha = bundleTarballSha256(bundleDir, '@company/charts-react');
      expect(harness.installedSha256['@company/charts-react']).toBe(reactSha);
      expect(harness.frozenSha256['@company/charts-react']).toBe(reactSha);
    } finally {
      fs.rmSync(bundleDir, { recursive: true, force: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
      harness.phase = null;
      harness.stagingDir = '';
      harness.installedSha256 = {};
      harness.frozenSha256 = {};
      harness.mutatedSha256 = {};
    }
  });
});
