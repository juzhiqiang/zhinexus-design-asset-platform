import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { freezePackageRelease, verifyFrozenTarball, type FrozenArtifact } from '../local/freeze.js';
import { resolvePnpmExecutable } from '../local/pack.js';
import { captureExample, type CaptureResult } from '../local/capture.js';
import { compareBaseline, type CompareBaselineResult } from '../local/compare.js';
import { buildCheckReport } from '../local/report.js';
import { validateCheckReport } from '../contracts/validation.js';
import type { CheckReportV1, EnvironmentV1 } from '../contracts/reports.js';
import type { Framework } from '../contracts/release-manifest.js';

export type CheckCommandOptions = {
  framework?: 'vue' | 'react' | 'all';
  repoRoot?: string;
  stagingDir?: string;
  baselineDir?: string;
  timeoutMs?: number;
};

export type CheckFrameworkResult = {
  framework: Framework;
  variantId: string;
  packageSha256: string;
  environmentKey: string;
  report: CheckReportV1;
  reportPath: string;
  screenshots: string[];
  baselineComparison?: CompareBaselineResult;
  diffImagePath?: string;
};

export type CheckCommandResult = {
  success: boolean;
  exitCode: number;
  results: CheckFrameworkResult[];
  errors: string[];
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
 * 寻找仓库根目录
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  const currentModuleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateStarts = [startDir, process.cwd(), currentModuleDir];

  for (const candidate of candidateStarts) {
    let curr = path.resolve(candidate);
    while (curr !== path.dirname(curr)) {
      const pnpmWorkspace = path.join(curr, 'pnpm-workspace.yaml');
      const rootPkgJson = path.join(curr, 'package.json');
      if (fs.existsSync(pnpmWorkspace) && fs.existsSync(rootPkgJson)) {
        return curr;
      }
      curr = path.dirname(curr);
    }
  }
  return process.cwd();
}

/**
 * 执行 component check --framework vue|react|all 完整本地闭环验证：
 * 1. 打包并冻结候选 tarball（core + 框架实现），生成确定性摘要；
 * 2. 在工作区外干净临时目录安装冻结产物，严格校验无 workspace:* 或源码 alias；
 * 3. 启动干净消费者本地服务并通过 Playwright 驱动 ready -> runState -> getChecks；
 * 4. 采集环境指纹、生成确定性截图与 CheckReportV1 报告；
 * 5. 任何篡改、页面运行错误或超时均非零退出。
 */
export async function runCheckCommand(
  options: CheckCommandOptions = {},
): Promise<CheckCommandResult> {
  const frameworkChoice = options.framework ?? 'all';
  const frameworks: Framework[] =
    frameworkChoice === 'all'
      ? ['vue', 'react']
      : frameworkChoice === 'vue'
        ? ['vue']
        : ['react'];

  const repoRoot = options.repoRoot ?? findRepoRoot();
  const stagingDir = options.stagingDir ?? path.join(repoRoot, '.release-freeze');
  const timeoutMs = options.timeoutMs ?? 30_000;

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

  const results: CheckFrameworkResult[] = [];
  const errors: string[] = [];

  let frozenCore: FrozenArtifact | null = null;
  try {
    // 1. 冻结核心 charts-core 候选包
    frozenCore = await freezePackageRelease({
      packageDir: corePkgDir,
      stagingDir: path.join(stagingDir, 'core'),
    });

    const verifyCore = await verifyFrozenTarball(frozenCore);
    if (!verifyCore.ok) {
      throw new Error(`CORE_TARBALL_VERIFICATION_FAILED: ${verifyCore.message ?? verifyCore.error}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`[core] 打包冻结失败: ${msg}`);
    return { success: false, exitCode: 1, results, errors };
  }

  for (const framework of frameworks) {
    let viteServer: ViteDevServer | null = null;
    let consumerDir = '';

    try {
      // 2. 冻结目标框架候选包
      const frameworkDir = frameworkPkgDirs[framework];
      const frozenFramework = await freezePackageRelease({
        packageDir: frameworkDir,
        stagingDir: path.join(stagingDir, framework),
      });

      const verifyFramework = await verifyFrozenTarball(frozenFramework);
      if (!verifyFramework.ok) {
        throw new Error(
          `FRAMEWORK_TARBALL_VERIFICATION_FAILED: ${verifyFramework.message ?? verifyFramework.error}`,
        );
      }

      // 3. 在工作区外临时目录建立隔离干净消费者
      consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), `component-check-${framework}-`));
      await copyDir(consumerTemplates[framework], consumerDir);

      const pkgJsonPath = path.join(consumerDir, 'package.json');
      const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf8'));

      const frameworkPkgName = framework === 'vue' ? '@company/charts-vue' : '@company/charts-react';
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

      // 写入干净消费者 npmrc
      await fs.promises.writeFile(
        path.join(consumerDir, '.npmrc'),
        'link-workspace-packages=false\nprefer-frozen-lockfile=false\n',
        'utf8',
      );

      // 执行依赖安装：使用 spawnSync 确保进程与磁盘写入完全刷新，原生支持 overrides
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
          `消费者安装依赖失败 (code ${installResult.status}): ${installResult.stderr || installResult.stdout}`,
        );
      }

      // 验证目标包安装真实落地
      const installedEntry = path.join(consumerDir, 'node_modules', frameworkPkgName, 'package.json');
      if (!fs.existsSync(installedEntry)) {
        throw new Error(`消费者安装异常: 未能在 node_modules 中找到 ${frameworkPkgName}`);
      }

      // 4. 启动消费者 Vite 服务
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
      const port = typeof address === 'object' && address ? address.port : viteServer.config.server.port;
      const url = `http://127.0.0.1:${port}/index.html`;

      // 5. 驱动就绪协议并截图
      const screenshotsDir = path.join(stagingDir, 'screenshots', framework);
      const captureResult: CaptureResult = await captureExample({
        url,
        states: ['default'],
        outputDir: screenshotsDir,
        framework,
        frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1',
        echartsVersion: '6.1.0',
        exampleId: 'line-default',
        variantId: `line-${framework}`,
        packageSha256: frozenFramework.sha256,
        packageVersion: frozenFramework.version,
        timeoutMs,
      });

      // 关闭服务
      await viteServer.close();
      viteServer = null;

      // 6. 可选视觉基线对比
      let baselineResult: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE' = 'NEW';
      let baselineComparison: CompareBaselineResult | undefined;
      let diffImagePath: string | undefined;

      if (options.baselineDir && captureResult.screenshots.length > 0) {
        const variantId = `line-${framework}`;
        const exampleId = 'line-default';
        const shotFile = captureResult.screenshots[0]!.image.path;
        const absShotPath = path.isAbsolute(shotFile) ? shotFile : path.join(screenshotsDir, path.basename(shotFile));
        const currentPng = await fs.promises.readFile(absShotPath);

        const baseDir = path.join(options.baselineDir, variantId, exampleId);
        const basePngPath = path.join(baseDir, 'baseline.png');
        const baseMetaPath = path.join(baseDir, 'baseline.json');

        let baselineInput: { environment: EnvironmentV1; environmentKey?: string; imageBuffer: Buffer } | null = null;
        if (fs.existsSync(basePngPath) && fs.existsSync(baseMetaPath)) {
          const basePng = await fs.promises.readFile(basePngPath);
          const baseMeta = JSON.parse(await fs.promises.readFile(baseMetaPath, 'utf8')) as {
            environment: EnvironmentV1;
            environmentKey?: string;
          };
          baselineInput = {
            environment: baseMeta.environment,
            environmentKey: baseMeta.environmentKey,
            imageBuffer: basePng,
          };
        }

        baselineComparison = compareBaseline(
          {
            environment: captureResult.environment,
            environmentKey: captureResult.environmentKey,
            imageBuffer: currentPng,
          },
          baselineInput,
        );
        baselineResult = baselineComparison.result;

        if (baselineComparison.result === 'DIFF' && baselineComparison.diffImage) {
          const diffsDir = path.join(stagingDir, 'diffs');
          await fs.promises.mkdir(diffsDir, { recursive: true });
          diffImagePath = path.join(diffsDir, `${variantId}-diff.png`);
          await fs.promises.writeFile(diffImagePath, baselineComparison.diffImage);
        }
      }

      // 7. 生成并校验 CheckReportV1 报告
      const reportId = `rep-${framework}-${crypto.randomBytes(6).toString('hex')}`;
      const report = buildCheckReport({
        id: reportId,
        toolVersion: '0.0.1',
        variantId: `line-${framework}`,
        packageSha256: frozenFramework.sha256,
        exampleId: 'line-default',
        environment: captureResult.environment,
        environmentKey: captureResult.environmentKey,
        checks: captureResult.checks.map((c) => ({
          name: c.name,
          status: c.status,
        })),
        screenshots: captureResult.screenshots,
        baselineResult,
      });

      const validation = validateCheckReport(report);
      if (!validation.ok) {
        throw new Error(
          `REPORT_VALIDATION_FAILED: 报告未通过契约校验: ${validation.issues.map((i) => i.message).join('; ')}`,
        );
      }

      const reportsDir = path.join(stagingDir, 'reports');
      await fs.promises.mkdir(reportsDir, { recursive: true });
      const reportPath = path.join(reportsDir, `${reportId}.json`);
      await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

      results.push({
        framework,
        variantId: `line-${framework}`,
        packageSha256: frozenFramework.sha256,
        environmentKey: captureResult.environmentKey,
        report,
        reportPath,
        screenshots: captureResult.screenshots.map((s) => s.image.path),
        baselineComparison,
        diffImagePath,
      });

      if (baselineComparison && (baselineComparison.result === 'DIFF' || baselineComparison.result === 'INCOMPATIBLE')) {
        errors.push(
          `[${framework}] 视觉基线比对未通过 (${baselineComparison.result}, diffRatio=${baselineComparison.diffRatio.toFixed(6)}${diffImagePath ? `, diffImage=${diffImagePath}` : ''}): ${baselineComparison.reason ?? ''}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${framework}] 验证失败: ${msg}`);
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

  const success = errors.length === 0 && results.length === frameworks.length;
  return {
    success,
    exitCode: success ? 0 : 1,
    results,
    errors,
  };
}

// 帮助函数封装 child_process.spawn
import * as child_process from 'node:child_process';
function child_process_spawn(
  cmd: string,
  args: string[],
  options: child_process.SpawnOptions,
): child_process.ChildProcess {
  return child_process.spawn(cmd, args, options);
}
