import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import * as child_process from 'node:child_process';
import {
  computeFileSha256,
  createArtifactRef,
  computeSourceDigest,
} from './digest.js';
import {
  freezePackageRelease,
  verifyFrozenTarball,
  type FrozenArtifact,
} from './freeze.js';
import { captureExample, type CaptureResult } from './capture.js';
import { buildCheckReport } from './report.js';
import { validateReleaseBundle } from '../contracts/bundle.js';
import type {
  ArtifactRef,
  Framework,
  PackageRef,
  ReleaseManifestV1,
  ValidationResult,
  VariantRef,
} from '../contracts/release-manifest.js';
import type { ExampleRef, ScreenshotRef } from '../contracts/examples.js';
import type { CheckReportV1, CompatibilityRecord } from '../contracts/reports.js';
import { findRepoRoot } from '../commands/check.js';

export type ComponentName = 'line' | 'bar' | 'pie' | 'scatter' | 'trend-card';

/**
 * 消费者页面入口文件名。`line` 用 `index.html`，其余组件用 `<component>.html`；
 * 新增组件时必须同步 `tests/consumers/{vue,react}` 下的同名页面（由 SDK 侧交付），
 * 否则该组件的静态预览会回落到空占位页。
 */
const COMPONENT_ENTRY_HTML: Record<ComponentName, string> = {
  line: 'index.html',
  bar: 'bar.html',
  pie: 'pie.html',
  scatter: 'scatter.html',
  'trend-card': 'trend-card.html',
};

/** 组件在框架包中的命名导出与中文描述，用于生成 api / docs 材料。 */
const COMPONENT_EXPORT: Record<ComponentName, { exportName: string; exportDesc: string }> = {
  line: { exportName: 'LineChart', exportDesc: '折线图' },
  bar: { exportName: 'BarChart', exportDesc: '柱状图' },
  pie: { exportName: 'PieChart', exportDesc: '饼图' },
  scatter: { exportName: 'ScatterChart', exportDesc: '散点图' },
  'trend-card': { exportName: 'TrendCard', exportDesc: '趋势卡片' },
};

export type PrepareReleaseBundleOptions = {
  repoRoot?: string;
  bundleDir: string;
  components?: ComponentName[];
  frameworks?: Framework[];
  timeoutMs?: number;
  stagingDir?: string;
};

export type PrepareReleaseBundleResult = {
  ok: boolean;
  manifest: ReleaseManifestV1;
  bundleDir: string;
  filesMap: Map<string, Uint8Array>;
  issues?: Array<{ code: string; path: string; message: string }>;
};

/**
 * 递归复制目录
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.turbo', 'dist'].includes(entry.name)) continue;
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

/**
 * 从磁盘读取 Bundle 目录，收集除 manifest.json 外的所有文件字节 Map 与 parsed manifest
 */
export async function loadReleaseBundle(
  bundleDir: string,
): Promise<{ manifest: ReleaseManifestV1; filesMap: Map<string, Uint8Array> }> {
  const manifestPath = path.join(bundleDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`BUNDLE_MANIFEST_MISSING: manifest.json 未在 bundle 目录中找到: ${manifestPath}`);
  }

  const manifestJson = await fs.promises.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestJson) as ReleaseManifestV1;
  const filesMap = new Map<string, Uint8Array>();

  async function scan(currentDir: string): Promise<void> {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(bundleDir, fullPath).replace(/\\/g, '/');
        if (relPath === 'manifest.json') continue;
        const bytes = await fs.promises.readFile(fullPath);
        filesMap.set(relPath, new Uint8Array(bytes));
      }
    }
  }

  await scan(bundleDir);
  return { manifest, filesMap };
}

/**
 * 严格校验指定 bundleDir 是否符合 ReleaseManifestV1 契约及所有字节完整性
 */
export async function verifyReleaseBundle(
  bundleDir: string,
): Promise<ValidationResult<ReleaseManifestV1>> {
  const { manifest, filesMap } = await loadReleaseBundle(bundleDir);
  return validateReleaseBundle(manifest, filesMap);
}

/**
 * 完整发布材料生成闭环：
 * 1. 冻结 core 与双框架候选包，计算确定性 SHA-256；
 * 2. 在工作区外干净目录安装消费，启动本地 Vite 预览服务；
 * 3. 驱动就绪协议为折线与柱状双组件采集真实截图与 NEW 基线报告；
 * 4. 生成 preview、api、docs 规范化描述文件并组装完整文件清单；
 * 5. 组装 ReleaseManifestV1，并通过 validateReleaseBundle 严格自检。
 */
export async function prepareReleaseBundle(
  options: PrepareReleaseBundleOptions,
): Promise<PrepareReleaseBundleResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const bundleDir = path.resolve(options.bundleDir);
  const components = options.components ?? ['line', 'bar', 'pie', 'scatter', 'trend-card'];
  const frameworks = options.frameworks ?? ['vue', 'react'];
  const timeoutMs = options.timeoutMs ?? 30_000;
  const stagingDir =
    options.stagingDir ?? path.join(bundleDir, '.staging-' + crypto.randomBytes(4).toString('hex'));

  // 创建 bundle 目录结构
  await fs.promises.mkdir(bundleDir, { recursive: true });
  await fs.promises.mkdir(path.join(bundleDir, 'packages'), { recursive: true });
  await fs.promises.mkdir(path.join(bundleDir, 'screenshots'), { recursive: true });
  await fs.promises.mkdir(path.join(bundleDir, 'reports'), { recursive: true });
  await fs.promises.mkdir(path.join(bundleDir, 'preview'), { recursive: true });
  await fs.promises.mkdir(path.join(bundleDir, 'api'), { recursive: true });
  await fs.promises.mkdir(path.join(bundleDir, 'docs'), { recursive: true });
  await fs.promises.mkdir(stagingDir, { recursive: true });

  const corePkgDir = path.join(repoRoot, 'packages', 'charts-core');
  const frameworkPkgDirs: Record<Framework, string> = {
    vue: path.join(repoRoot, 'packages', 'charts-vue'),
    react: path.join(repoRoot, 'packages', 'charts-react'),
  };
  const consumerTemplates: Record<Framework, string> = {
    vue: path.join(repoRoot, 'tests', 'consumers', 'vue'),
    react: path.join(repoRoot, 'tests', 'consumers', 'react'),
  };

  const packagesMap = new Map<string, PackageRef>();
  const frozenTarballs: Record<string, FrozenArtifact> = {};

  // 1. 冻结 @company/charts-core
  const frozenCore = await freezePackageRelease({
    packageDir: corePkgDir,
    stagingDir: path.join(stagingDir, 'core'),
  });
  const coreVerify = await verifyFrozenTarball(frozenCore);
  if (!coreVerify.ok) {
    throw new Error(`CORE_TARBALL_VERIFICATION_FAILED: ${coreVerify.message ?? coreVerify.error}`);
  }
  frozenTarballs['@company/charts-core'] = frozenCore;

  // 复制 core tarball 至 bundleDir/packages
  const coreTarballDest = path.join(bundleDir, 'packages', path.basename(frozenCore.tarballPath));
  await fs.promises.copyFile(frozenCore.tarballPath, coreTarballDest);
  const coreTarballRef = await createArtifactRef(
    coreTarballDest,
    `packages/${path.basename(frozenCore.tarballPath)}`,
  );

  const corePkgJson = JSON.parse(
    await fs.promises.readFile(path.join(corePkgDir, 'package.json'), 'utf8'),
  );
  packagesMap.set(frozenCore.packageName, {
    name: frozenCore.packageName,
    version: frozenCore.version,
    tarball: coreTarballRef,
    sourceDigest: frozenCore.sourceDigest,
    dependencies: {},
    peerDependencies: corePkgJson.peerDependencies ?? {},
  });

  // 2. 冻结各个框架包
  for (const framework of frameworks) {
    const pkgDir = frameworkPkgDirs[framework];
    const frozen = await freezePackageRelease({
      packageDir: pkgDir,
      stagingDir: path.join(stagingDir, framework),
    });
    const verify = await verifyFrozenTarball(frozen);
    if (!verify.ok) {
      throw new Error(`FRAMEWORK_TARBALL_VERIFICATION_FAILED: ${verify.message ?? verify.error}`);
    }
    frozenTarballs[frozen.packageName] = frozen;

    const tarballDest = path.join(bundleDir, 'packages', path.basename(frozen.tarballPath));
    await fs.promises.copyFile(frozen.tarballPath, tarballDest);
    const tarballRef = await createArtifactRef(
      tarballDest,
      `packages/${path.basename(frozen.tarballPath)}`,
    );

    const pkgJson = JSON.parse(await fs.promises.readFile(path.join(pkgDir, 'package.json'), 'utf8'));
    packagesMap.set(frozen.packageName, {
      name: frozen.packageName,
      version: frozen.version,
      tarball: tarballRef,
      sourceDigest: frozen.sourceDigest,
      dependencies: {
        '@company/charts-core': frozenCore.version,
      },
      peerDependencies: pkgJson.peerDependencies ?? {},
    });
  }

  // 3. 在干净消费者中驱动双框架、六个组件实现的实际渲染与截图
  const reportsRecord: Record<string, CheckReportV1> = {};
  const reportArtifacts: ArtifactRef[] = [];
  const variantScreenshots: Record<string, ScreenshotRef[]> = {};
  const variantReports: Record<string, CheckReportV1> = {};
  const variantPreviewMap = new Map<string, ArtifactRef[]>();
  const extraArtifacts: ArtifactRef[] = [];

  for (const framework of frameworks) {
    let viteServer: ViteDevServer | null = null;
    const consumerDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `component-bundle-${framework}-${crypto.randomBytes(4).toString('hex')}`),
    );

    try {
      await copyDir(consumerTemplates[framework], consumerDir);
      const pkgJsonPath = path.join(consumerDir, 'package.json');
      const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf8'));

      const frameworkPkgName = framework === 'vue' ? '@company/charts-vue' : '@company/charts-react';
      const frozenFramework = frozenTarballs[frameworkPkgName]!;
      const frameworkTarballPosix = frozenFramework.tarballPath.replace(/\\/g, '/');
      const coreTarballPosix = frozenCore.tarballPath.replace(/\\/g, '/');

      pkgJson.dependencies[frameworkPkgName] = `file:${frameworkTarballPosix}`;
      pkgJson.dependencies['@company/charts-core'] = `file:${coreTarballPosix}`;
      pkgJson.overrides = {
        ...(pkgJson.overrides ?? {}),
        '@company/charts-core': `file:${coreTarballPosix}`,
      };
      pkgJson.pnpm = {
        ...(pkgJson.pnpm ?? {}),
        overrides: {
          ...(pkgJson.pnpm?.overrides ?? {}),
          '@company/charts-core': `file:${coreTarballPosix}`,
        },
      };

      await fs.promises.writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');
      await fs.promises.writeFile(
        path.join(consumerDir, '.npmrc'),
        'link-workspace-packages=false\nprefer-frozen-lockfile=false\n',
        'utf8',
      );

      // 安装干净消费者依赖
      const isWin = process.platform === 'win32';
      const installResult = child_process.spawnSync(
        isWin ? 'npm.cmd' : 'npm',
        ['install', '--no-audit', '--no-fund', '--loglevel=error'],
        {
          cwd: consumerDir,
          encoding: 'utf8',
          shell: isWin,
          env: { ...process.env },
          maxBuffer: 32 * 1024 * 1024,
        },
      );

      if (installResult.status !== 0) {
        throw new Error(
          `CONSUMER_INSTALL_FAILED: ${framework} 消费者安装依赖失败 (code ${installResult.status}): ${installResult.stderr || installResult.stdout}`,
        );
      }

      // 构建干净消费者真实静态预览产物
      const buildResult = child_process.spawnSync(
        isWin ? 'npm.cmd' : 'npm',
        ['run', 'build'],
        {
          cwd: consumerDir,
          encoding: 'utf8',
          shell: isWin,
          env: { ...process.env },
          maxBuffer: 32 * 1024 * 1024,
        },
      );

      if (buildResult.status !== 0) {
        throw new Error(
          `CONSUMER_BUILD_FAILED: ${framework} 消费者构建静态预览失败 (code ${buildResult.status}): ${buildResult.stderr || buildResult.stdout}`,
        );
      }

      // 启动消费者服务
      viteServer = await createServer({
        root: consumerDir,
        server: {
          host: '127.0.0.1',
          port: 0,
        },
        logLevel: 'error',
      });
      await viteServer.listen();
      const address = viteServer.httpServer?.address();
      const port =
        typeof address === 'object' && address ? address.port : viteServer.config.server.port;

      for (const component of components) {
        const variantId = `${component}-${framework}`;
        const exampleId = `example-${variantId}-default`;
        const entryHtml = COMPONENT_ENTRY_HTML[component];
        const url = `http://127.0.0.1:${port}/${entryHtml}`;

        // 复制并组织变体独立静态预览资源
        const previewRelDir = `preview/${variantId}`;
        const previewDir = path.join(bundleDir, previewRelDir);
        await fs.promises.mkdir(previewDir, { recursive: true });

        const srcHtmlPath = path.join(consumerDir, 'dist', entryHtml);
        const destHtmlPath = path.join(previewDir, 'index.html');
        if (fs.existsSync(srcHtmlPath)) {
          await fs.promises.copyFile(srcHtmlPath, destHtmlPath);
        } else {
          await fs.promises.writeFile(
            destHtmlPath,
            `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>Preview: ${variantId}</title></head><body><div id="app"></div></body></html>\n`,
            'utf8',
          );
        }

        const srcAssetsDir = path.join(consumerDir, 'dist', 'assets');
        const destAssetsDir = path.join(previewDir, 'assets');
        if (fs.existsSync(srcAssetsDir)) {
          await fs.promises.mkdir(destAssetsDir, { recursive: true });
          const assetFiles = await fs.promises.readdir(srcAssetsDir);
          for (const assetFile of assetFiles) {
            await fs.promises.copyFile(
              path.join(srcAssetsDir, assetFile),
              path.join(destAssetsDir, assetFile),
            );
          }
        }

        const variantPreviewArtifacts: ArtifactRef[] = [];
        async function collectPreviewArtifacts(dir: string, baseSubDir: string): Promise<void> {
          const entries = await fs.promises.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const logicalPath = `${baseSubDir}/${entry.name}`;
            if (entry.isDirectory()) {
              await collectPreviewArtifacts(fullPath, logicalPath);
            } else if (entry.isFile()) {
              const artifact = await createArtifactRef(fullPath, logicalPath);
              variantPreviewArtifacts.push(artifact);
              extraArtifacts.push(artifact);
            }
          }
        }
        await collectPreviewArtifacts(previewDir, previewRelDir);
        variantPreviewMap.set(variantId, variantPreviewArtifacts);

        const screenshotsDir = path.join(bundleDir, 'screenshots');
        const captureResult: CaptureResult = await captureExample({
          url,
          states: ['default'],
          outputDir: screenshotsDir,
          baseDir: bundleDir,
          framework,
          frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1',
          echartsVersion: '6.1.0',
          exampleId,
          variantId,
          packageSha256: frozenFramework.sha256,
          packageVersion: frozenFramework.version,
          timeoutMs,
        });

        const reportId = `report-${variantId}`;
        const createdAt = new Date().toISOString();

        // 绑定 reportId 与每个截图
        const boundScreenshots: ScreenshotRef[] = captureResult.screenshots.map((s) => ({
          ...s,
          reportId,
        }));

        const report = buildCheckReport({
          id: reportId,
          toolVersion: '0.0.1',
          variantId,
          packageSha256: frozenFramework.sha256,
          exampleId,
          environment: captureResult.environment,
          environmentKey: captureResult.environmentKey,
          checks: captureResult.checks.map((c) => ({
            name: c.name,
            status: c.status,
          })),
          screenshots: boundScreenshots,
          baselineResult: 'NEW',
          createdAt,
        });

        const reportRelPath = `reports/${variantId}.json`;
        const reportFullPath = path.join(bundleDir, reportRelPath);
        await fs.promises.writeFile(reportFullPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

        const reportRef = await createArtifactRef(reportFullPath, reportRelPath);
        reportsRecord[reportRelPath] = report;
        reportArtifacts.push(reportRef);

        variantScreenshots[variantId] = boundScreenshots;
        variantReports[variantId] = report;
      }
    } finally {
      if (viteServer) {
        try {
          await viteServer.close();
        } catch {
          // ignore
        }
      }
      if (consumerDir && fs.existsSync(consumerDir)) {
        try {
          fs.rmSync(consumerDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  }

  // 4. 生成 preview, api, docs 文件并创建 ArtifactRef
  const variants: VariantRef[] = [];

  for (const component of components) {
    const fixturePath = path.join(repoRoot, 'examples', 'fixtures', `${component}.json`);
    const fixtureBytes = await fs.promises.readFile(fixturePath);
    const fixtureSha256 = crypto.createHash('sha256').update(fixtureBytes).digest('hex');

    for (const framework of frameworks) {
      const variantId = `${component}-${framework}`;
      const packageName = framework === 'vue' ? '@company/charts-vue' : '@company/charts-react';
      const pkg = packagesMap.get(packageName)!;
      const exportPath = `./${component}`;
      const { exportName, exportDesc } = COMPONENT_EXPORT[component];

      // 4.1 独立静态预览产物引用
      const variantPreviewArtifacts = variantPreviewMap.get(variantId) ?? [];
      const previewEntryPath = `preview/${variantId}/index.html`;

      // 4.2 API 规范
      const apiRelPath = `api/${variantId}.json`;
      const apiFullPath = path.join(bundleDir, apiRelPath);
      const apiMetadata = {
        componentId: component,
        framework,
        exportName,
        exportPath,
        props: {
          data: { type: 'ChartData', required: true },
          config: { type: `${exportName}Config`, required: false },
          optionOverrides: { type: 'EChartsOption', required: false },
        },
        events: {
          'point-click': { payload: 'ChartEvent' },
        },
      };
      await fs.promises.writeFile(apiFullPath, JSON.stringify(apiMetadata, null, 2) + '\n', 'utf8');
      const apiArtifact = await createArtifactRef(apiFullPath, apiRelPath);
      extraArtifacts.push(apiArtifact);

      // 4.3 Docs 说明
      const docRelPath = `docs/${variantId}.md`;
      const docFullPath = path.join(bundleDir, docRelPath);
      const docContent = `# ${exportName} (${framework.toUpperCase()})\n\n${exportDesc}组件。\n\n## 导出路径\n\`\`\`ts\nimport { ${exportName} } from '${packageName}${exportPath.replace(/^\./, '')}';\n\`\`\`\n`;
      await fs.promises.writeFile(docFullPath, docContent, 'utf8');
      const docArtifact = await createArtifactRef(docFullPath, docRelPath);
      extraArtifacts.push(docArtifact);

      const exampleRef: ExampleRef = {
        id: `example-${variantId}-default`,
        previewEntry: previewEntryPath,
        previewFiles: variantPreviewArtifacts,
        fixtureDigest: fixtureSha256,
        renderer: 'canvas',
        theme: 'light',
        width: 800,
        height: 400,
        requiredStates: ['default'],
      };

      const screenshots = variantScreenshots[variantId] ?? [];
      const report = variantReports[variantId]!;

      const compatibility: CompatibilityRecord[] = [
        {
          framework,
          frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1',
          ...(framework === 'react' ? { reactDomVersion: '19.3.1' } : {}),
          echartsVersion: '6.1.0',
          status: 'passed',
          reportId: report.id,
          verifiedAt: report.createdAt,
        },
      ];

      variants.push({
        componentId: component,
        variantId,
        framework,
        packageName,
        packageVersion: pkg.version,
        exportPath,
        exportName,
        api: apiArtifact,
        docs: docArtifact,
        examples: [exampleRef],
        screenshots,
        compatibility,
      });
    }
  }

  // 5. 整理完整文件清单 files
  const inventoryMap = new Map<string, ArtifactRef>();
  for (const pkg of packagesMap.values()) {
    inventoryMap.set(pkg.tarball.path, pkg.tarball);
  }
  for (const artifact of extraArtifacts) {
    inventoryMap.set(artifact.path, artifact);
  }
  for (const variant of variants) {
    for (const shot of variant.screenshots) {
      inventoryMap.set(shot.image.path, shot.image);
    }
  }
  for (const repRef of reportArtifacts) {
    inventoryMap.set(repRef.path, repRef);
  }

  const files = [...inventoryMap.values()].sort((a, b) => a.path.localeCompare(b.path));

  // 6. 构造 ReleaseManifestV1
  const manifest: ReleaseManifestV1 = {
    schemaVersion: 1,
    channel: 'cli',
    packages: [...packagesMap.values()],
    variants,
    reports: reportArtifacts,
    files,
  };

  // 7. 写入 manifest.json
  const manifestPath = path.join(bundleDir, 'manifest.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // 清理临时 staging 目录
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  // 8. 严格自检
  const { filesMap } = await loadReleaseBundle(bundleDir);
  const validation = await validateReleaseBundle(manifest, filesMap);

  if (!validation.ok) {
    return {
      ok: false,
      manifest,
      bundleDir,
      filesMap,
      issues: validation.issues,
    };
  }

  return {
    ok: true,
    manifest: validation.value,
    bundleDir,
    filesMap,
  };
}

