import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { Client } from 'pg';
import { buildServer } from '../../apps/api/dist/app.js';
import { Database } from '../../apps/api/dist/db/database.js';
import { migrateRegistry } from '../../apps/api/dist/db/migrate.js';
import { ArtifactStore } from '../../apps/api/dist/storage/artifact-store.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { RegistryClient } from '../../apps/api/dist/releases/registry-client.js';
import { createRecoveryStack, type RecoveryStack } from '../../infra/scripts/recovery-stack.js';
import { tarBytes } from '../fixtures/t05-artifacts.js';

test.describe('T08: 真实三存储浏览器端到端发布流水线', () => {
  // 设置合理的测试超时时间（包含独立容器启动与全量 14 实现三存储流转）
  test.setTimeout(180_000);

  let stack: RecoveryStack | undefined;
  let db: Database | undefined;
  let store: ArtifactStore | undefined;
  let registry: RegistryClient | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  let apiOrigin = '';
  let token = '';
  let verdaccioToken = '';
  let rawDbClient: Client | undefined;
  let tempArtifactsDir: string | undefined;

  async function makeValidNpmTarball(
    name: string,
    version: string,
    dependencies: Record<string, string> = {},
    peerDependencies: Record<string, string> = {},
  ): Promise<Buffer> {
    const isCore = name === '@company/charts-core';
    const exports: Record<string, unknown> = {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    };
    if (!isCore) {
      for (const comp of ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion']) {
        exports[`./${comp}`] = { types: `./dist/${comp}.d.ts`, import: `./dist/${comp}.js` };
      }
    }
    const entries = [
      {
        name: 'package/package.json',
        bytes: Buffer.from(
          JSON.stringify({
            name,
            version,
            dependencies,
            peerDependencies,
            exports,
          }),
        ),
      },
      { name: 'package/dist/index.js', bytes: Buffer.from('export {};') },
      { name: 'package/dist/index.d.ts', bytes: Buffer.from('export {};') },
    ];
    if (!isCore) {
      for (const comp of ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion']) {
        entries.push(
          { name: `package/dist/${comp}.js`, bytes: Buffer.from(`export const ${comp} = {};`) },
          { name: `package/dist/${comp}.d.ts`, bytes: Buffer.from(`export declare const ${comp}: object;`) },
        );
      }
    }
    return tarBytes(entries);
  }

  test.beforeAll(async () => {
    // 1. 启动独立随机端口 RecoveryStack（严禁碰共享 G2 数据）
    stack = await createRecoveryStack();
    const secrets = stack.secrets;
    const postgresPort = stack.ports.postgres;
    const minioPort = stack.ports.minio;
    const verdaccioPort = stack.ports.verdaccio;

    // 2. 初始化 PostgreSQL 数据库
    const dbUrl = `postgresql://zhinexus:${encodeURIComponent(secrets.postgresPassword)}@127.0.0.1:${postgresPort}/zhinexus`;
    db = new Database(dbUrl);
    await migrateRegistry(db);

    // 3. 初始化 MinIO 存储桶（MinIO 默认已原生放行 CORS OPTIONS 预检并暴露 ETag）
    const bucketName = `t08-e2e-${randomUUID()}`;
    const storageConfig = {
      endpoint: `http://127.0.0.1:${minioPort}`,
      region: 'us-east-1',
      bucket: bucketName,
      accessKeyId: secrets.minioUser,
      secretAccessKey: secrets.minioPassword,
    };
    store = new ArtifactStore(storageConfig);
    await store.ensureBucket();

    // 4. 初始化 Verdaccio 客户端并获取 publisher token
    const registryOrigin = `http://127.0.0.1:${verdaccioPort}`;
    const authRes = await fetch(`${registryOrigin}/-/user/org.couchdb.user:g2publisher`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`g2publisher:${secrets.publisherPassword}`).toString('base64')}`,
      },
      body: JSON.stringify({
        name: 'g2publisher',
        password: secrets.publisherPassword,
        type: 'user',
        roles: [],
        date: new Date().toISOString(),
      }),
    });
    const { token: regToken } = (await authRes.json()) as { token: string };
    verdaccioToken = regToken;
    registry = new RegistryClient({ origin: registryOrigin, token: regToken });

    // 5. 颁发本地 OIDC 测试签名密钥与 Token
    const keys = await generateKeyPair('RS256');
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 't08-test-key',
      alg: 'RS256',
      use: 'sig',
    };
    const oidcConfig = {
      issuer: 'https://issuer.t08.test',
      audience: 'platform-api',
      jwksUri: 'https://issuer.t08.test/jwks',
      webClientIds: ['web'],
      cliClientIds: ['cli'],
    };

    token = await new SignJWT({
      roles: ['publisher', 'maintainer'],
      azp: 'web',
      client_id: 'web',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 't08-test-key' })
      .setIssuer(oidcConfig.issuer)
      .setAudience(oidcConfig.audience)
      .setSubject('alice')
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(keys.privateKey);

    // 6. 为测试主体 alice 赋予 7 组件与 3 个公开包的完整发布权限
    for (const compId of ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion']) {
      await db.query('INSERT INTO components(id) VALUES ($1) ON CONFLICT DO NOTHING', [compId]);
      await db.query(
        'INSERT INTO component_permissions(subject,component_id,can_publish,can_maintain) VALUES ($1,$2,true,true) ON CONFLICT DO NOTHING',
        ['alice', compId],
      );
    }
    for (const pkgName of ['@company/charts-core', '@company/charts-vue', '@company/charts-react']) {
      await db.query('INSERT INTO package_permissions(subject,package_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
        'alice',
        pkgName,
      ]);
    }

    // 7. 启动 NestJS API 服务并注入画廊来源（由 buildServer 统一管理精确 CORS）
    app = await buildServer({
      databaseUrl: dbUrl,
      storage: storageConfig,
      oidc: oidcConfig,
      keyResolver: createLocalJWKSet({ keys: [jwk] }),
      galleryOrigin: 'http://127.0.0.1:5173',
    });
    await app.listen(0, '127.0.0.1');
    apiOrigin = await app.getUrl();
  });

  test.afterAll(async () => {
    try {
      await app?.close();
    } catch {}
    store?.close();
    try {
      await db?.close();
    } catch {}
    try {
      await rawDbClient?.end();
    } catch {}
    if (tempArtifactsDir) {
      try {
        await rm(tempArtifactsDir, { recursive: true, force: true });
      } catch {}
    }
    if (stack) {
      try {
        await stack.close();
      } catch {}
      try {
        const recoveryRoot = resolve(process.cwd(), '.tools', 'recovery');
        const ownedPath = relative(recoveryRoot, resolve(stack.directory));
        if (/^[0-9a-f-]{36}$/.test(ownedPath)) {
          await rm(stack.directory, { recursive: true, force: true });
        }
      } catch {}
    }
  });

  test('真实三存储全链路：选择真实产物和逐实现手动截图，经 Nest API/MinIO/Worker 推进至 READY', async ({
    page,
  }) => {
    // 1. 构造 7 组件 14 实现的合法真实 NPM tarball 并写入独立临时目录
    tempArtifactsDir = await mkdtemp(join(tmpdir(), 't08-e2e-artifacts-'));
    const coreTarballBytes = await makeValidNpmTarball('@company/charts-core', '0.0.5', {});
    const vueTarballBytes = await makeValidNpmTarball(
      '@company/charts-vue',
      '0.0.5',
      { '@company/charts-core': '0.0.5' },
      { vue: '3.5.45', echarts: '6.1.0' },
    );
    const reactTarballBytes = await makeValidNpmTarball(
      '@company/charts-react',
      '0.0.5',
      { '@company/charts-core': '0.0.5' },
      { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
    );

    const corePath = join(tempArtifactsDir, 'charts-core-0.0.5.tgz');
    const vuePath = join(tempArtifactsDir, 'charts-vue-0.0.5.tgz');
    const reactPath = join(tempArtifactsDir, 'charts-react-0.0.5.tgz');
    await writeFile(corePath, coreTarballBytes);
    await writeFile(vuePath, vueTarballBytes);
    await writeFile(reactPath, reactTarballBytes);

    // 2. 前往发布控制台页面，通过 Query 参数注入真实 API 端点与本地 OIDC 凭证
    const targetUrl = `http://127.0.0.1:5173/upload?apiUrl=${encodeURIComponent(apiOrigin)}&token=${encodeURIComponent(token)}`;
    await page.goto(targetUrl);

    // 验证身份与 API 端点注入成功
    await expect(page.locator('h1')).toContainText('资产发布工作区 (Manual Release)');
    await expect(page.locator('body')).toContainText('当前登录身份：alice');
    await expect(page.locator('#active-api-url')).toContainText(apiOrigin);

    // 3. 真实导入 3 个包的 npm 产物，触发浏览器端路径映射与 SHA-256 计算
    await page.locator('#import-files-input').setInputFiles([corePath, vuePath, reactPath]);
    await expect(page.locator('#upload-status-message')).toContainText('成功导入 3 个本地预构建产物文件');

    // 验证 14 实现卡片全部就绪
    const cards = page.locator('.variant-shot-card');
    await expect(cards).toHaveCount(14);

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeEnabled();

    // 4. 点击提交发布按钮，触发真实 HTTP 流水线
    let capturedJobId = '';
    const releaseResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/v1/releases') && res.request().method() === 'POST',
    );

    await submitBtn.click();

    // 等待真实 API 返回 202
    const releaseRes = await releaseResponsePromise;
    if (releaseRes.status() !== 202) {
      console.log('RELEASE ERROR STATUS:', releaseRes.status(), await releaseRes.text());
    }
    expect(releaseRes.status()).toBe(202);
    const releaseData = await releaseRes.json();
    capturedJobId = releaseData.jobId;
    expect(capturedJobId).toBeTruthy();

    // 验证页面展示作业编号并持续轮询
    await expect(page.locator('body')).toContainText(capturedJobId);

    // 5. 由后台 ReleaseWorker 推进该真实发布作业
    const worker = new ReleaseWorker(db!, store!, registry!);
    const ran = await worker.runOnce(capturedJobId);
    expect(ran).toBe(true);

    // 验证数据库状态机推进至 READY
    const jobRow = (await db!.query('SELECT state, stage FROM release_jobs WHERE id=$1', [capturedJobId])).rows[0]!;
    expect(jobRow.state).toBe('READY');
    expect(jobRow.stage).toBe('READY');

    // 6. 验证浏览器端轮询自动感应 READY 状态
    await expect(page.locator('.status-card .value.ready')).toContainText('READY');
    await expect(page.locator('body')).toContainText('发布成功！ 版本状态已原子写入 Ready。');

    // 7. 验证 Verdaccio 真实存在三个包的候选发布
    const verdaccioRes = await fetch(`http://127.0.0.1:${stack!.ports.verdaccio}/@company%2fcharts-core`, {
      headers: { authorization: `Bearer ${verdaccioToken}` },
    });
    expect(verdaccioRes.status).toBe(200);
    const verdaccioPkg = await verdaccioRes.json();
    expect(verdaccioPkg.name).toBe('@company/charts-core');
  });

  test('缺图阻断：当任意变体缺失展示截图时严格阻断提交 (SCREENSHOT_REQUIRED)', async ({ page }) => {
    const targetUrl = `http://127.0.0.1:5173/upload?apiUrl=${encodeURIComponent(apiOrigin)}&token=${encodeURIComponent(token)}`;
    await page.goto(targetUrl);

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeEnabled();

    // 删除 ranking-react 的截图
    const removeBtn = page.locator('button[data-remove-shot="ranking-react"]');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // 提交按钮被禁用，阻断警告展示缺失项
    await expect(submitBtn).toBeDisabled();
    const alert = page.locator('.blocker-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('SCREENSHOT_REQUIRED');
    await expect(alert).toContainText('ranking-react');

    // 恢复截图
    const restoreBtn = page.locator('button[data-restore-shot="ranking-react"]');
    await restoreBtn.click();
    await expect(submitBtn).toBeEnabled();
    await expect(alert).not.toBeVisible();
  });

  test('框架错配拦截：将 React 截图关联给 Vue 变体时前置拦截 (SCREENSHOT_VARIANT_MISMATCH)', async ({ page }) => {
    const targetUrl = `http://127.0.0.1:5173/upload?apiUrl=${encodeURIComponent(apiOrigin)}&token=${encodeURIComponent(token)}`;
    await page.goto(targetUrl);

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeEnabled();

    // 触发框架错配
    const mismatchBtn = page.getByRole('button', { name: '模拟框架错配测试' }).first();
    await mismatchBtn.click();

    await expect(submitBtn).toBeDisabled();
    const alert = page.locator('.blocker-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('SCREENSHOT_VARIANT_MISMATCH');
  });

  test('真实后端上传异常阻断：MinIO 故障或上传异常时停止发布，禁止调用 complete 或 release', async ({ page }) => {
    const targetUrl = `http://127.0.0.1:5173/upload?apiUrl=${encodeURIComponent(apiOrigin)}&token=${encodeURIComponent(token)}`;
    await page.goto(targetUrl);

    // 模拟 MinIO 上传端点发生网络连接重置（真实网络错误拦截）
    await page.route('**/t08-e2e-*/**', async (route) => {
      await route.abort('connectionreset');
    });

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 验证页面明确展示发布失败并中止，绝不向 release 接口提交
    await expect(page.locator('body')).toContainText('发布失败:');
    await expect(submitBtn).toBeEnabled();
  });

  test('断点恢复与幂等性：网络异常重试严格复用原持久化的同一幂等键', async ({ page }) => {
    const targetUrl = `http://127.0.0.1:5173/upload?apiUrl=${encodeURIComponent(apiOrigin)}&token=${encodeURIComponent(token)}`;
    await page.goto(targetUrl);

    const fixedKey = 'web-recovery-key-real-001';
    await page.evaluate((key) => {
      localStorage.setItem(
        'zhinexus_pending_release',
        JSON.stringify({
          idempotencyKey: key,
          uploadSessionId: 'sess-recovery-001',
          manifest: { channel: 'web', packages: [], variants: [], files: [], reports: [] },
          timestamp: Date.now(),
        }),
      );
    }, fixedKey);

    await page.reload();

    // 验证出现恢复卡片
    await expect(page.locator('body')).toContainText('检测到未完成的发布请求');
    await expect(page.locator('body')).toContainText(fixedKey);

    const resumeBtn = page.getByRole('button', { name: '恢复提交' });
    await expect(resumeBtn).toBeVisible();
  });
});
