import { randomUUID } from 'node:crypto';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  prepareReleaseBundle,
  loadReleaseBundle,
} from '../../packages/component-cli/src/local/manifest.js';
import {
  executeReleaseCommand,
  executeStatusCommand,
  executeResumeCommand,
  loadReleaseSession,
} from '../../packages/component-cli/src/local/release.js';
import { platformHarness, grant } from '../platform/http-support.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { realRegistry, registryToken } from '../platform/t06-support.js';

describe('T04/T06: CLI release, status, resume, and Verdaccio registry installation', () => {
  it(
    'executes full release to platform API with registry adapter, reaches READY, and enables clean consumer installation from Verdaccio',
    async () => {
      const h = await platformHarness();
      const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-full-release-'));
      const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdaccio-consumer-'));

      try {
        await grant(h, 'alice', true);
        await h.db.query(
          "INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core') ON CONFLICT DO NOTHING",
        );
        const token = await h.token('alice', ['maintainer', 'publisher'], 'cli');
        const apiUrl = h.origin();

        // 1. 生成 8 个实现的完整冻结材料 Bundle (line, bar, pie, scatter × vue, react)
        const prepareResult = await prepareReleaseBundle({
          bundleDir,
          components: ['line', 'bar', 'pie', 'scatter'],
          frameworks: ['vue', 'react'],
          timeoutMs: 40_000,
        });

        expect(prepareResult.ok, JSON.stringify(prepareResult.issues)).toBe(true);
        expect(prepareResult.manifest.variants).toHaveLength(8);
        expect(prepareResult.manifest.packages).toHaveLength(3);

        // 2. 执行 CLI release 命令并在后台通过 ReleaseWorker 处理发布作业推进至 READY
        const logs: string[] = [];
        const worker = new ReleaseWorker(h.db, h.store, await realRegistry());
        let runningWorker = true;
        const workerLoop = (async () => {
          while (runningWorker) {
            try {
              await worker.runOnce();
              await worker.tags.runOnce();
            } catch {
              // ignore
            }
            await new Promise((r) => setTimeout(r, 200));
          }
        })();

        let releaseResult;
        try {
          releaseResult = await executeReleaseCommand({
            bundleDir,
            apiUrl,
            token,
            timeoutMs: 60_000,
            pollIntervalMs: 500,
            onProgress: (msg) => logs.push(msg),
          });
        } finally {
          runningWorker = false;
          await workerLoop;
        }

        expect(releaseResult.ok, releaseResult.error).toBe(true);
        expect(releaseResult.state).toBe('READY');
        expect(releaseResult.jobId).toBeDefined();

        // 3. 验证本地 session 持久化记录
        const session = await loadReleaseSession(bundleDir);
        expect(session).not.toBeNull();
        expect(session?.manifestDigest).toBe(releaseResult.session.manifestDigest);
        expect(session?.idempotencyKey).toBe(releaseResult.session.idempotencyKey);
        expect(session?.uploadSessionId).toBe(releaseResult.session.uploadSessionId);
        expect(session?.jobId).toBe(releaseResult.jobId);
        expect(session?.state).toBe('READY');

        // 4. 验证 status 命令
        const statusResult = await executeStatusCommand({
          bundleDir,
          apiUrl,
          token,
        });
        expect(statusResult.ok).toBe(true);
        expect(statusResult.status?.state).toBe('READY');
        expect(statusResult.status?.stage).toBe('READY');

        // 5. 验证断点恢复与幂等性：同一 Bundle 再次执行 resume，复用原有幂等键和 jobId，立即返回成功
        const resumeResult = await executeResumeCommand({
          bundleDir,
          apiUrl,
          token,
          timeoutMs: 10_000,
        });
        expect(resumeResult.ok).toBe(true);
        expect(resumeResult.jobId).toBe(releaseResult.jobId);
        expect(resumeResult.session.idempotencyKey).toBe(releaseResult.session.idempotencyKey);
        expect(resumeResult.state).toBe('READY');

        // 6. 验证数据库中版本状态已原子写入 Ready
        const readyVariantCount = (
          await h.db.query("SELECT count(*) FROM variant_releases WHERE availability='Ready'")
        ).rows[0]!.count;
        expect(Number(readyVariantCount)).toBeGreaterThanOrEqual(8);

        const readyPackageCount = (
          await h.db.query("SELECT count(*) FROM package_releases WHERE state='READY'")
        ).rows[0]!.count;
        expect(Number(readyPackageCount)).toBeGreaterThanOrEqual(3);

        // 7. 验证注册表已收录并能精确安装
        const readerToken = await registryToken('g2reader');

        // 7.1 核验 Verdaccio 上的版本元数据
        for (const pkg of prepareResult.manifest.packages) {
          const checkRes = await fetch(
            `http://127.0.0.1:14873/${encodeURIComponent(pkg.name)}/${pkg.version}`,
            {
              headers: { authorization: `Bearer ${readerToken}` },
            },
          );
          expect(checkRes.status).toBe(200);
          const pkgData = (await checkRes.json()) as { name: string; version: string };
          expect(pkgData.name).toBe(pkg.name);
          expect(pkgData.version).toBe(pkg.version);
        }

        // 7.2 在干净目录中通过 Verdaccio 安装真实包并验证运行时安全导入
        const vuePkgVersion = prepareResult.manifest.packages.find((p) => p.name === '@company/charts-vue')!.version;
        const isWin = process.platform === 'win32';
        const npmrcPath = path.join(consumerDir, '.npmrc');
        fs.writeFileSync(
          npmrcPath,
          `@company:registry=http://127.0.0.1:14873/\n//127.0.0.1:14873/:_authToken=${readerToken}\naudit=false\nfund=false\nlegacy-peer-deps=true\n`,
          'utf8',
        );

        const consumerPkgJson = {
          name: 'isolated-verdaccio-consumer',
          version: '1.0.0',
          private: true,
          type: 'module',
          dependencies: {
            '@company/charts-vue': vuePkgVersion,
            vue: '3.5.45',
            echarts: '6.1.0',
          },
        };
        fs.writeFileSync(
          path.join(consumerDir, 'package.json'),
          JSON.stringify(consumerPkgJson, null, 2) + '\n',
          'utf8',
        );

        const installProc = child_process.spawnSync(
          isWin ? 'npm.cmd' : 'npm',
          ['install', '--userconfig', npmrcPath, '--no-audit', '--no-fund', '--legacy-peer-deps', '--loglevel=error'],
          {
            cwd: consumerDir,
            encoding: 'utf8',
            shell: isWin,
            env: { ...process.env },
            maxBuffer: 16 * 1024 * 1024,
          },
        );

        expect(
          installProc.status,
          `npm install from Verdaccio failed: ${installProc.stderr || installProc.stdout}`,
        ).toBe(0);

        // 验证安装后的包确实来自 Verdaccio 且导出正常
        const installedVuePkgJson = JSON.parse(
          fs.readFileSync(
            path.join(consumerDir, 'node_modules', '@company', 'charts-vue', 'package.json'),
            'utf8',
          ),
        );
        expect(installedVuePkgJson.version).toBe(vuePkgVersion);

        // 测试 Node 导入验证
        const testScript = `
import { LineChart } from '@company/charts-vue/line';
import { BarChart } from '@company/charts-vue/bar';
import { PieChart } from '@company/charts-vue/pie';
import { ScatterChart } from '@company/charts-vue/scatter';
if (!LineChart || !BarChart || !PieChart || !ScatterChart) throw new Error('Export missing');
console.log('VERDACCIO_INSTALL_VERIFIED_SUCCESS');
`;
        const testScriptPath = path.join(consumerDir, 'test-import.mjs');
        fs.writeFileSync(testScriptPath, testScript, 'utf8');

        const nodeProc = child_process.spawnSync(
          process.execPath,
          [testScriptPath],
          {
            cwd: consumerDir,
            encoding: 'utf8',
            env: { ...process.env },
          },
        );

        expect(nodeProc.status).toBe(0);
        expect(nodeProc.stdout).toContain('VERDACCIO_INSTALL_VERIFIED_SUCCESS');
      } finally {
        await h.close();
        try {
          fs.rmSync(bundleDir, { recursive: true, force: true });
          fs.rmSync(consumerDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    },
    240_000,
  );
});
