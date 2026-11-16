import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * 二期发布验收补齐（T04 缺口 A）的**编排级**测试（宿主 RED → GREEN）。
 *
 * C 2026-11-16 复核意见：直接调用 `verifyFrozenTarball` 无法证明编排缺口
 * （`tests/integration/cli-check.test.ts` 已有等价单测）。本文件驱动 `runCheckCommand`
 * 真实编排，只 mock 昂贵/环境相关边界，在「冻结 → 安装 → 截图」期间篡改 tarball，
 * 断言**编排本身**必须失败关闭。
 *
 * 宿主实跑 RED（2026-11-16 12:50，`.tools/b-tamper-red-20261116.log`）：exit 1，
 * 2 failed / 5 passed，失败的正是「安装期间篡改」与「截图期间篡改」两条——
 * 即修复前 `runCheckCommand` 只在安装前核对一次（`check.ts` 第 130、152 行），
 * 安装与截图期间（Vite 服务 + Playwright 生命周期，可能数分钟）tarball 若被改动，
 * 截图与报告仍会沿用旧的 `packageSha256`，而消费者实际安装的已是变动后的字节。
 *
 * GREEN 实现：截图完成、报告生成前，同时复核 core 与当前框架包的冻结 tarball；
 * 任一不符即抛错进入 catch，不写成功报告、不写入 results。
 *
 * 覆盖矩阵（参数化，确保「只核对一个包」也能被发现）：
 * - 阶段 × { install, capture }
 * - 目标 × { core, framework }
 * 共 4 条必失败用例 + 1 条对照用例（未篡改必须通过，证明 mock 边界不造成假失败）。
 *
 * mock 边界（只 mock 与「摘要贯穿」无关的昂贵部分，**不** mock 冻结与核对本身）：
 * - `local/pack.js` 的 `packPackage`：跳过真实 pnpm pack，产出确定性 tarball 字节；
 * - `node:child_process` 的 `spawnSync`：跳过真实 npm install，落盘 node_modules 标记文件；
 * - `vite` 的 `createServer`：跳过真实 Vite 服务；
 * - `local/capture.js` 的 `captureExample`：跳过真实 Playwright，产出确定性截图与自检；
 * - 保持真实：`freezePackageRelease` / `verifyFrozenTarball` / `buildCheckReport` /
 *   `validateCheckReport`——被审计的正是冻结与核对在编排中的位置。
 */

const repoRoot = path.resolve(__dirname, '../../');

/** 跨 mock 边界共享的篡改状态（vi.hoisted 使工厂函数可引用）。 */
const tamper = vi.hoisted(() => ({
  /** 篡改阶段：null=不篡改；'install'=安装后；'capture'=截图期间 */
  phase: null as null | 'install' | 'capture',
  /** 篡改目标：只改 core 或只改当前框架包 */
  target: 'core' as 'core' | 'framework',
  stagingDir: '',
}));

/** 翻转指定子目录下所有冻结 tarball 的末字节。 */
function flipTarballs(stagingDir: string, sub: 'core' | 'vue' | 'react'): void {
  const dir = path.join(stagingDir, sub);
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.tgz')) continue;
    const tarballPath = path.join(dir, entry);
    const bytes = fs.readFileSync(tarballPath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    fs.writeFileSync(tarballPath, bytes);
  }
}

vi.mock('../../packages/component-cli/src/local/pack.js', () => ({
  resolvePnpmExecutable: () => 'pnpm',
  packPackage: vi.fn(async (options: { packageDir: string; outputDir: string }) => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(options.packageDir, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    // 确定性假 tarball：字节稳定，但可被单字节翻转检出
    const bytes = Buffer.from(`frozen-tarball:${pkgJson.name}@${pkgJson.version}\n`, 'utf8');
    const tarballName = `${pkgJson.name.replace(/^@/, '').replace(/\//g, '-')}-${pkgJson.version}.tgz`;
    const tarballPath = path.join(options.outputDir, tarballName);
    await fs.promises.mkdir(options.outputDir, { recursive: true });
    await fs.promises.writeFile(tarballPath, bytes);
    const { computeBufferSha256 } = await import('../../packages/component-cli/src/local/digest.js');
    return {
      tarballPath,
      tarballName,
      packageName: pkgJson.name,
      version: pkgJson.version,
      sha256: computeBufferSha256(bytes),
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
        const pkgJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>;
        };
        for (const name of Object.keys(pkgJson.dependencies ?? {})) {
          const marker = path.join(cwd, 'node_modules', name, 'package.json');
          fs.mkdirSync(path.dirname(marker), { recursive: true });
          fs.writeFileSync(marker, JSON.stringify({ name, version: '0.0.0' }), 'utf8');
        }
        // 安装阶段结束后按目标篡改：模拟安装期间产物被外部改动
        if (tamper.phase === 'install' && tamper.stagingDir) {
          if (tamper.target === 'core') flipTarballs(tamper.stagingDir, 'core');
          else {
            flipTarballs(tamper.stagingDir, 'vue');
            flipTarballs(tamper.stagingDir, 'react');
          }
        }
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

    // 截图阶段开始时按目标篡改：模拟截图期间产物被外部改动
    if (tamper.phase === 'capture' && tamper.stagingDir) {
      if (tamper.target === 'core') flipTarballs(tamper.stagingDir, 'core');
      else {
        flipTarballs(tamper.stagingDir, 'vue');
        flipTarballs(tamper.stagingDir, 'react');
      }
    }

    await fs.promises.mkdir(options.outputDir, { recursive: true });
    const shotPath = path.join(options.outputDir, `${options.variantId}-default.png`);
    await fs.promises.writeFile(shotPath, Buffer.from('deterministic-screenshot-bytes', 'utf8'));
    const image = await createArtifactRef(shotPath, `${options.variantId}-default.png`);

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

/** 断言编排失败关闭：非零退出、无结果、错误指向冻结产物核对、且无成功报告落盘。 */
function expectFailClosed(result: { success: boolean; exitCode: number; results: unknown[]; errors: string[] }, stagingDir: string): void {
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(1);
  expect(result.results).toHaveLength(0);
  expect(result.errors.some((e) => /TARBALL|冻结|摘要|digest|mutation/i.test(e))).toBe(true);
  const reportsDir = path.join(stagingDir, 'reports');
  const written = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir) : [];
  expect(written).toEqual([]);
}

describe('T04 缺口 A：runCheckCommand 必须在安装/截图之后复核 core 与框架包冻结产物', () => {
  it('未篡改时编排正常通过（证明 mock 边界本身不会造成假失败）', async () => {
    const { runCheckCommand } = await import('../../packages/component-cli/src/commands/check.js');
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-tamper-control-'));
    tamper.phase = null;
    tamper.stagingDir = stagingDir;

    try {
      const result = await runCheckCommand({ framework: 'vue', repoRoot, stagingDir, timeoutMs: 5000 });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.packageSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(result.results[0]!.reportPath)).toBe(true);
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      tamper.phase = null;
      tamper.stagingDir = '';
    }
  });

  describe.each([
    { phase: 'install' as const, label: '安装期间' },
    { phase: 'capture' as const, label: '截图期间' },
  ])('$label 篡改', ({ phase, label }) => {
    it(`${label}只篡改 core 冻结包：编排必须失败关闭`, async () => {
      const { runCheckCommand } = await import('../../packages/component-cli/src/commands/check.js');
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `check-tamper-${phase}-core-`));
      tamper.phase = phase;
      tamper.target = 'core';
      tamper.stagingDir = stagingDir;

      try {
        const result = await runCheckCommand({ framework: 'vue', repoRoot, stagingDir, timeoutMs: 5000 });
        expectFailClosed(result, stagingDir);
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        tamper.phase = null;
        tamper.stagingDir = '';
      }
    });

    it(`${label}只篡改当前框架冻结包：编排必须失败关闭`, async () => {
      const { runCheckCommand } = await import('../../packages/component-cli/src/commands/check.js');
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `check-tamper-${phase}-framework-`));
      tamper.phase = phase;
      tamper.target = 'framework';
      tamper.stagingDir = stagingDir;

      try {
        const result = await runCheckCommand({ framework: 'vue', repoRoot, stagingDir, timeoutMs: 5000 });
        expectFailClosed(result, stagingDir);
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        tamper.phase = null;
        tamper.stagingDir = '';
      }
    });
  });
});
