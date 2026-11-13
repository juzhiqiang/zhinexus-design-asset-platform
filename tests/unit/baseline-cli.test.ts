import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectEnvironment, computeEnvironmentKey } from '../../packages/component-cli/src/local/environment.js';
import { buildCheckReport } from '../../packages/component-cli/src/local/report.js';
import { acceptBaseline } from '../../packages/component-cli/src/commands/baseline.js';
import { runCli } from '../../packages/component-cli/src/cli.js';
import type { ScreenshotRef } from '../../packages/component-cli/src/contracts/examples.js';

describe('T04: component baseline accept CLI 与权限/CAS 闭环', () => {
  const tempDirs: string[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    for (const d of tempDirs.splice(0)) {
      await fs.rm(d, { recursive: true, force: true });
    }
  });

  async function writeReportFixture(overrides: {
    source?: 'local-automatic' | 'manual-upload';
    environmentKeyOverride?: string;
    checkStatus?: 'passed' | 'failed';
    baselineResult?: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE';
  } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't04-baseline-cli-'));
    tempDirs.push(dir);
    const env = detectEnvironment({ framework: 'vue' });
    const envKey = overrides.environmentKeyOverride ?? computeEnvironmentKey(env);
    const shot: ScreenshotRef = {
      id: 'shot-line-vue-default',
      variantId: 'line-vue',
      framework: 'vue',
      packageSha256: 'a'.repeat(64),
      packageVersion: '0.0.10',
      exampleId: 'line-default',
      state: 'default',
      source: overrides.source ?? 'local-automatic',
      environmentKey: envKey,
      image: {
        path: 'screenshots/line-vue-default.png',
        sha256: 'b'.repeat(64),
        bytes: 1024,
      },
    };
    const report = buildCheckReport({
      id: 'rep-line-vue-1',
      variantId: 'line-vue',
      packageSha256: 'a'.repeat(64),
      exampleId: 'line-default',
      environment: env,
      environmentKey: envKey,
      checks: [{ name: 'render-default', status: overrides.checkStatus ?? 'passed' }],
      screenshots: [shot],
      baselineResult: overrides.baselineResult ?? 'NEW',
    });
    const reportPath = path.join(dir, 'report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return { reportPath, envKey, report };
  }

  async function startStubApi(
    handler: (req: http.IncomingMessage, body: Record<string, unknown>, res: http.ServerResponse) => void,
  ): Promise<{ url: string; requests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> }> {
    const requests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        requests.push({ url: req.url ?? '', headers: req.headers, body: parsed });
        handler(req, parsed, res);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    return { url: `http://127.0.0.1:${addr.port}`, requests };
  }

  it('合法自动验证报告通过 POST /v1/baselines 接受基线并传递 expectedRevision CAS', async () => {
    const { reportPath, envKey } = await writeReportFixture();
    const api = await startStubApi((_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ revisionId: 'rev-0001' }));
    });

    const cliResult = await runCli(
      [
        'baseline',
        'accept',
        '--report',
        reportPath,
        '--reason',
        '首次确认 ECharts 6.1.0 折线图基准',
        '--api-url',
        api.url,
        '--token',
        'jwt-maintainer-token',
        '--expected-revision',
        'rev-0000',
      ],
      '0.0.6',
    );

    expect(cliResult.exitCode).toBe(0);
    expect(cliResult.stdout).toContain('rev-0001');
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]!.url).toBe('/v1/baselines');
    expect(api.requests[0]!.headers.authorization).toBe('Bearer jwt-maintainer-token');
    expect(api.requests[0]!.body).toEqual({
      variantId: 'line-vue',
      exampleId: 'line-default',
      environmentKey: envKey,
      screenshotId: 'shot-line-vue-default',
      reason: '首次确认 ECharts 6.1.0 折线图基准',
      expectedRevision: 'rev-0000',
    });
  });

  it('严禁接受 manual-upload 手动截图或 unknown-manual 来源，前置拒绝且不发请求', async () => {
    const { reportPath: manualPath } = await writeReportFixture({ source: 'manual-upload' });
    const { reportPath: unknownManualPath } = await writeReportFixture({
      source: 'local-automatic',
      environmentKeyOverride: 'unknown-manual',
    });
    const api = await startStubApi((_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ revisionId: 'should-not-happen' }));
    });

    const res1 = await acceptBaseline({
      reportPath: manualPath,
      reason: '尝试偷渡手动图',
      apiUrl: api.url,
      token: 'jwt-maintainer',
    });
    expect(res1.ok).toBe(false);
    expect(res1.errorCode).toBe('SOURCE_FORBIDDEN');

    const res2 = await acceptBaseline({
      reportPath: unknownManualPath,
      reason: '尝试偷渡 unknown-manual',
      apiUrl: api.url,
      token: 'jwt-maintainer',
    });
    expect(res2.ok).toBe(false);
    expect(res2.errorCode).toBe('SOURCE_FORBIDDEN');

    expect(api.requests).toHaveLength(0);
  });

  it('运行失败或环境不兼容 (INCOMPATIBLE) 的报告不得接受为基线', async () => {
    const { reportPath: failedPath } = await writeReportFixture({ checkStatus: 'failed' });
    const { reportPath: incompatiblePath } = await writeReportFixture({ baselineResult: 'INCOMPATIBLE' });
    const api = await startStubApi((_req, _body, res) => {
      res.writeHead(200);
      res.end('{}');
    });

    const res1 = await acceptBaseline({
      reportPath: failedPath,
      reason: '忽略失败检查',
      apiUrl: api.url,
      token: 'jwt-maintainer',
    });
    expect(res1.ok).toBe(false);
    expect(res1.errorCode).toBe('CHECK_FAILED');

    const res2 = await acceptBaseline({
      reportPath: incompatiblePath,
      reason: '忽略不兼容环境',
      apiUrl: api.url,
      token: 'jwt-maintainer',
    });
    expect(res2.ok).toBe(false);
    expect(res2.errorCode).toBe('INCOMPATIBLE_ENVIRONMENT');

    expect(api.requests).toHaveLength(0);
  });

  it('服务端返回 409 CONFLICT (CAS 版本冲突) 或 403 FORBIDDEN (无权限) 时非零退出并清晰报错', async () => {
    const { reportPath } = await writeReportFixture();
    const conflictApi = await startStubApi((_req, _body, res) => {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'CONFLICT', message: 'expectedRevision mismatch', details: [], requestId: 'req-1' }));
    });

    const conflictCli = await runCli(
      [
        'baseline',
        'accept',
        '--report',
        reportPath,
        '--reason',
        '更新基线',
        '--api-url',
        conflictApi.url,
        '--token',
        'jwt-maintainer',
        '--expected-revision',
        'stale-rev',
      ],
      '0.0.6',
    );
    expect(conflictCli.exitCode).toBe(1);
    expect(conflictCli.stderr).toContain('CONFLICT');

    const forbiddenApi = await startStubApi((_req, _body, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'FORBIDDEN', message: 'maintainer role required', details: [], requestId: 'req-2' }));
    });
    const forbiddenCli = await runCli(
      [
        'baseline',
        'accept',
        '--report',
        reportPath,
        '--reason',
        '无权限更新基线',
        '--api-url',
        forbiddenApi.url,
        '--token',
        'jwt-reader',
      ],
      '0.0.6',
    );
    expect(forbiddenCli.exitCode).toBe(1);
    expect(forbiddenCli.stderr).toContain('FORBIDDEN');
  });

  it('服务端返回 HTTP 200 {} 或非法 revisionId 时必须判定失败 (INVALID_RESPONSE)', async () => {
    const { reportPath } = await writeReportFixture();
    const empty200Api = await startStubApi((_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    });

    const res = await acceptBaseline({
      reportPath,
      reason: '空响应校验',
      apiUrl: empty200Api.url,
      token: 'jwt-maintainer',
    });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_RESPONSE');
  });

  it('通过 jobId 查询 releaseJob.baselineCandidates 映射服务端 screenshotId，且保留本地 report 匹配', async () => {
    const { reportPath, envKey } = await writeReportFixture();
    const serverShotUuid = '11111111-1111-4111-8111-111111111111';
    let capturedRedirect: RequestRedirect | undefined;
    let hasSignal = false;

    const api = await startStubApi((req, _body, res) => {
      if (req.method === 'GET' && req.url === '/v1/releases/job-abc') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            state: 'READY',
            stage: 'READY',
            attempt: 1,
            missingArtifacts: [],
            pollAfterMs: 1000,
            baselineCandidates: [
              {
                screenshotId: serverShotUuid,
                sourceScreenshotId: 'shot-line-vue-default',
                variantId: 'line-vue',
                exampleId: 'line-default',
                environmentKey: envKey,
              },
            ],
          }),
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/baselines') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ revisionId: 'rev-server-mapped' }));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });

    const wrappedFetch: typeof fetch = (input, init) => {
      capturedRedirect = init?.redirect;
      hasSignal = Boolean(init?.signal);
      return globalThis.fetch(input, init);
    };

    const res = await acceptBaseline({
      reportPath,
      reason: '使用 releaseJob.baselineCandidates 服务端 ID 确认基线',
      apiUrl: api.url,
      token: 'jwt-maintainer',
      jobId: 'job-abc',
      fetchImpl: wrappedFetch,
    });

    expect(res.ok).toBe(true);
    expect(res.revisionId).toBe('rev-server-mapped');
    expect(capturedRedirect).toBe('error');
    expect(hasSignal).toBe(true);
    const postReq = api.requests.find((r) => r.url === '/v1/baselines')!;
    expect(postReq.body.screenshotId).toBe(serverShotUuid);
  });
});
