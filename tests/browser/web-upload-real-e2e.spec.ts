import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { buildServer } from '../../apps/api/dist/app.js';
import { Database } from '../../apps/api/dist/db/database.js';
import { migrateRegistry } from '../../apps/api/dist/db/migrate.js';
import { ArtifactStore } from '../../apps/api/dist/storage/artifact-store.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { RegistryClient } from '../../apps/api/dist/releases/registry-client.js';
import { createRecoveryStack, type RecoveryStack } from '../../infra/scripts/recovery-stack.js';
import { sanitizeWebManifest } from '../../apps/gallery/app/lib/uploads/manifest-form.js';

test.describe('T08: 真实三存储浏览器端到端发布流水线', () => {
  // 设置合理超时时间（覆盖独立随机端口三存储启动与 14 实现真实流转）
  test.setTimeout(240_000);

  const CURRENT_SDK_DIR = resolve('D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/69443f97-8b73-4ecb-91aa-d8835a0b58dc');

  function getAllFiles(dir: string, fileList: string[] = []): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        getAllFiles(full, fileList);
      } else {
        fileList.push(full);
      }
    }
    return fileList;
  }

  async function loginToUploadConsole(page: Page, authToken: string, targetApi: string) {
    // 遵守安全规范：使用 page.addInitScript 注入会话，避免在 URL Query 中传递 JWT
    // 关键修正：严禁在 addInitScript 中执行 localStorage.clear()，否则 page.reload() 也会清空待恢复记录
    await page.addInitScript(
      ({ tokenVal, apiVal }) => {
        localStorage.setItem(
          'zhinexus_console_auth',
          JSON.stringify({
            token: tokenVal,
            subject: 'alice',
            roles: ['publisher', 'maintainer'],
            channel: 'web',
          }),
        );
        localStorage.setItem('zhinexus_api_url', apiVal);
      },
      { tokenVal: authToken, apiVal: targetApi },
    );
    await page.goto('http://127.0.0.1:5173/upload');
  }

  async function importCompleteRealMaterials(page: Page, tempManifestPath: string) {
    // 1. 导入清单文件
    await page.locator('#import-manifest-input').setInputFiles(tempManifestPath);
    await expect(page.locator('#upload-status-message')).toContainText('成功导入外部 Manifest 清单');

    // 2. 真实目录导入本地预构建产物（借助 webkitdirectory 选择实际文件夹，获取真实的 File.webkitRelativePath）
    await page.locator('#import-files-input').setInputFiles(CURRENT_SDK_DIR);
    await expect(page.locator('#upload-status-message')).toContainText('成功导入');

    // 3. 真实目录导入 14 张有效展示截图（来源固定为 manual-upload）
    await page.locator('#import-screenshots-input').setInputFiles(join(CURRENT_SDK_DIR, 'screenshots'));
    await expect(page.locator('#upload-status-message')).toContainText('成功批量关联 14 张有效展示截图');

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeEnabled();
    return submitBtn;
  }

  // 创建隔离的平台三存储与 API 服务环境辅助函数
  async function setupIsolatedPlatform() {
    const stack = await createRecoveryStack();
    const secrets = stack.secrets;
    const postgresPort = stack.ports.postgres;
    const minioPort = stack.ports.minio;
    const verdaccioPort = stack.ports.verdaccio;

    const dbUrl = `postgresql://zhinexus:${encodeURIComponent(secrets.postgresPassword)}@127.0.0.1:${postgresPort}/zhinexus`;
    const db = new Database(dbUrl);
    await migrateRegistry(db);

    const bucketName = `t08-e2e-${randomUUID()}`;
    const storageConfig = {
      endpoint: `http://127.0.0.1:${minioPort}`,
      region: 'us-east-1',
      bucket: bucketName,
      accessKeyId: secrets.minioUser,
      secretAccessKey: secrets.minioPassword,
    };
    const store = new ArtifactStore(storageConfig);
    await store.ensureBucket();

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
    const registry = new RegistryClient({ origin: registryOrigin, token: regToken });

    const keys = await generateKeyPair('RS256');
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: `t08-test-key-${randomUUID().slice(0, 8)}`,
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

    const token = await new SignJWT({
      roles: ['publisher', 'maintainer'],
      azp: 'web',
      client_id: 'web',
    })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer(oidcConfig.issuer)
      .setAudience(oidcConfig.audience)
      .setSubject('alice')
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(keys.privateKey);

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

    const app = await buildServer({
      databaseUrl: dbUrl,
      storage: storageConfig,
      oidc: oidcConfig,
      keyResolver: createLocalJWKSet({ keys: [jwk] }),
      galleryOrigin: 'http://127.0.0.1:5173',
    });
    await app.listen(0, '127.0.0.1');
    const apiOrigin = await app.getUrl();
    const server = app.getHttpServer();
    server.on('error', (e: unknown) => console.log('*** API SERVER ERROR ***', apiOrigin, e));

    return {
      stack,
      db,
      store,
      registry,
      app,
      apiOrigin,
      token,
      verdaccioToken: regToken,
      cleanup: async () => {
        try { await app.close(); } catch {}
        store.close();
        try { await db.close(); } catch {}
        if (stack) {
          try { await stack.close(); } catch {}
          try {
            const recoveryRoot = resolve(process.cwd(), '.tools', 'recovery');
            const ownedPath = relative(recoveryRoot, resolve(stack.directory));
            if (/^[0-9a-f-]{36}$/.test(ownedPath)) {
              await rm(stack.directory, { recursive: true, force: true });
            }
          } catch {}
        }
      },
    };
  }

  let mainEnv: Awaited<ReturnType<typeof setupIsolatedPlatform>> | undefined;
  let tempArtifactsDir: string | undefined;
  let webManifestPath = '';
  let webManifestFileCount = 0;

  test.beforeAll(async () => {
    mainEnv = await setupIsolatedPlatform();
    tempArtifactsDir = await mkdtemp(join(tmpdir(), 't08-e2e-artifacts-'));

    // 预备网页合规 Manifest（清洗 CLI 自动报告与签名）
    const rawManifest = JSON.parse(await readFile(join(CURRENT_SDK_DIR, 'manifest.json'), 'utf8'));
    const webManifest = sanitizeWebManifest(rawManifest);
    webManifestFileCount = webManifest.files.length; // 恰好为 185
    webManifestPath = join(tempArtifactsDir, 'web-manifest.json');
    await writeFile(webManifestPath, JSON.stringify(webManifest));
  });

  test.afterAll(async () => {
    if (tempArtifactsDir) {
      try { await rm(tempArtifactsDir, { recursive: true, force: true }); } catch {}
    }
    if (mainEnv) {
      await mainEnv.cleanup();
    }
  });

  test('真实三存储全链路：选择真实产物和逐实现手动截图，经 Nest API/MinIO/Worker 推进至 READY', async ({
    page,
  }) => {
    // 1. 核验 3 个真实包的 SHA-256（只读复用 C 的 69443f97-8b73-4ecb-91aa-d8835a0b58dc 目录）
    const coreTarball = await readFile(join(CURRENT_SDK_DIR, 'packages/company-charts-core-0.0.6.tgz'));
    const vueTarball = await readFile(join(CURRENT_SDK_DIR, 'packages/company-charts-vue-0.0.6.tgz'));
    const reactTarball = await readFile(join(CURRENT_SDK_DIR, 'packages/company-charts-react-0.0.6.tgz'));

    expect(createHash('sha256').update(coreTarball).digest('hex')).toBe(
      '7af91861c7ddb4786d1f98669a819625504ce5ad2a00bfee2b311a6f47e4e4eb',
    );
    expect(createHash('sha256').update(vueTarball).digest('hex')).toBe(
      'aa20d821f9a6369c5ec0968049a2eb056f4ea2fd78c62bc1c5b046f55759955f',
    );
    expect(createHash('sha256').update(reactTarball).digest('hex')).toBe(
      '91a2f9de25927e062f0f6205d16d4ab881981f9365af41a321ffb04f2f5ffdc4',
    );

    // 2. 访问网页控制台（不带 URL query token，通过 localStorage 注入）
    await loginToUploadConsole(page, mainEnv!.token, mainEnv!.apiOrigin);

    await expect(page.locator('h1')).toContainText('资产发布工作区 (Manual Release)');
    await expect(page.locator('body')).toContainText('当前登录身份：alice');
    await expect(page.locator('#active-api-url')).toContainText(mainEnv!.apiOrigin);

    // 3. 导入全部真实产物与截图，确认达到可提交状态
    const submitBtn = await importCompleteRealMaterials(page, webManifestPath);

    // 4. 监听 MinIO PUT 请求与响应头（真实核验 OPTIONS 预检 204 与 ETag 头）
    const minioUploadRecords: Array<{ url: string; status: number; etag: string | null }> = [];
    page.on('response', (res) => {
      if (res.url().includes(`127.0.0.1:${mainEnv!.stack.ports.minio}`) && res.request().method() === 'PUT') {
        minioUploadRecords.push({
          url: res.url(),
          status: res.status(),
          etag: res.headers()['etag'] || null,
        });
      }
    });

    let capturedJobId = '';
    const releasePromise = page.waitForResponse(
      (res) => res.url().includes('/v1/releases') && res.request().method() === 'POST' && res.status() === 202,
    );

    // 点击提交
    await submitBtn.click();

    const releaseRes = await releasePromise;
    const releaseBody = await releaseRes.json();
    capturedJobId = releaseBody.jobId;
    expect(capturedJobId).toBeTruthy();

    // 验证 MinIO 真实直传记录：精确等于 webManifest.files.length (185 个产物文件)，且均以 HTTP 200 写入带有效 ETag
    expect(minioUploadRecords.length).toBe(webManifestFileCount);
    for (const record of minioUploadRecords) {
      expect(record.status).toBe(200);
      expect(record.etag).toBeTruthy();
    }

    // 5. 触发 ReleaseWorker 推进该真实发布作业
    const worker = new ReleaseWorker(mainEnv!.db, mainEnv!.store, mainEnv!.registry);
    const ran = await worker.runOnce(capturedJobId);
    expect(ran).toBe(true);

    // 验证数据库状态机推进至 READY
    const jobRow = (await mainEnv!.db.query('SELECT state, stage FROM release_jobs WHERE id=$1', [capturedJobId]))
      .rows[0]!;
    expect(jobRow.state).toBe('READY');
    expect(jobRow.stage).toBe('READY');

    // 6. 验证浏览器端轮询自动感应 READY 状态
    await expect(page.locator('.status-card .value.ready')).toContainText('READY');
    await expect(page.locator('body')).toContainText('发布成功！ 版本状态已原子写入 Ready。');

    // 7. 验证 Verdaccio 真实存在三个包的候选发布
    for (const pkg of ['@company%2fcharts-core', '@company%2fcharts-vue', '@company%2fcharts-react']) {
      const verdaccioRes = await fetch(`http://127.0.0.1:${mainEnv!.stack.ports.verdaccio}/${pkg}`, {
        headers: { authorization: `Bearer ${mainEnv!.verdaccioToken}` },
      });
      expect(verdaccioRes.status).toBe(200);
      const pkgData = await verdaccioRes.json();
      expect(pkgData.versions['0.0.6']).toBeTruthy();
    }
  });

  test('缺图阻断：从已导入真实材料的可提交状态删一实现截图，严格阻断提交 (SCREENSHOT_REQUIRED)', async ({
    page,
  }) => {
    await loginToUploadConsole(page, mainEnv!.token, mainEnv!.apiOrigin);

    // 1. 先导入全部真实材料，进入完整就绪的可提交状态
    const submitBtn = await importCompleteRealMaterials(page, webManifestPath);
    await expect(submitBtn).toBeEnabled();

    // 2. 删除 ranking-react 变体的展示截图
    const removeBtn = page.locator('button[data-remove-shot="ranking-react"]');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // 3. 验证提交按钮立即被禁用，醒目展示阻断警告与缺失变体
    await expect(submitBtn).toBeDisabled();
    const alert = page.locator('.blocker-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('SCREENSHOT_REQUIRED');
    await expect(alert).toContainText('ranking-react');
    await expect(page.locator('.tag:has-text("未就绪")')).toContainText('缺图 1 项');

    // 4. 重新为 ranking-react 上传有效展示截图后，提交按钮重新恢复可用
    const realShotBytes = readFileSync(join(CURRENT_SDK_DIR, 'screenshots/ranking-react-default.png'));
    const uploadInput = page.locator('input[data-upload-shot="ranking-react"]');
    await uploadInput.setInputFiles({
      name: 'screenshots/ranking-react-default.png',
      mimeType: 'image/png',
      buffer: realShotBytes,
    });

    await expect(submitBtn).toBeEnabled();
    await expect(alert).not.toBeVisible();
  });

  test('框架错配拦截：导入将 React 截图关联给 Vue 变体的清单时前置拦截 (SCREENSHOT_VARIANT_MISMATCH)', async ({
    page,
  }) => {
    await loginToUploadConsole(page, mainEnv!.token, mainEnv!.apiOrigin);

    // 构造框架错配清单（Vue 变体错误关联了 React 截图）
    const mismatchManifest = {
      schemaVersion: 1,
      channel: 'web',
      packages: [],
      variants: [
        {
          componentId: 'line',
          variantId: 'line-vue',
          framework: 'vue',
          packageName: '@company/charts-vue',
          packageVersion: '0.0.6',
          exportPath: './line',
          exportName: 'LineChart',
          api: { path: 'api/line-vue.json', sha256: '00', bytes: 10 },
          docs: { path: 'docs/line-vue.md', sha256: '00', bytes: 10 },
          examples: [
            {
              id: 'example-line-vue-default',
              previewEntry: 'preview/line-vue/index.html',
              previewFiles: [{ path: 'preview/line-vue/index.html', sha256: '00', bytes: 10 }],
              fixtureDigest: '0000000000000000000000000000000000000000000000000000000000000000',
              renderer: 'canvas',
              theme: 'light',
              width: 800,
              height: 400,
              requiredStates: ['default'],
            },
          ],
          screenshots: [
            {
              id: 'shot-line-vue-default',
              variantId: 'line-vue',
              framework: 'react', // 故意错误标记为 react 框架
              packageVersion: '0.0.6',
              packageSha256: '00',
              exampleId: 'example-line-vue-default',
              state: 'default',
              source: 'manual-upload',
              image: { path: 'screenshots/line-vue-default.png', sha256: '00', bytes: 10 },
              environmentKey: 'unknown-manual',
            },
          ],
          compatibility: [],
        },
      ],
      reports: [],
      files: [],
    };

    await page.locator('#import-manifest-input').setInputFiles({
      name: 'manifest.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mismatchManifest)),
    });

    const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
    await expect(submitBtn).toBeDisabled();
    const alert = page.locator('.blocker-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('SCREENSHOT_VARIANT_MISMATCH');
    await expect(alert).toContainText('框架错配');
  });

  test('真实后端上传异常阻断：MinIO 故障或上传异常时停止发布，禁止调用 complete 或 release', async ({
    page,
  }) => {
    await loginToUploadConsole(page, mainEnv!.token, mainEnv!.apiOrigin);

    // 导入全部真实材料达到就绪状态（绝不使用伪造文件冒充）
    const submitBtn = await importCompleteRealMaterials(page, webManifestPath);
    await expect(submitBtn).toBeEnabled();

    // 设置监听器统计 complete 与 release 的调用次数
    let completeCalls = 0;
    let releaseCalls = 0;
    await page.route('**/v1/uploads/*/complete', async (route) => {
      completeCalls++;
      await route.continue();
    });
    await page.route('**/v1/releases', async (route) => {
      releaseCalls++;
      await route.continue();
    });

    // 模拟 MinIO 上传端点发生网络连接重置
    await page.route('**/t08-e2e-*/**', async (route) => {
      await route.abort('connectionreset');
    });

    await submitBtn.click();

    // 验证页面明确展示发布失败并中止
    await expect(page.locator('#upload-status-message')).toContainText('发布失败:');
    // 核心安全断言：绝不调用 complete，绝不调用 release
    expect(completeCalls).toBe(0);
    expect(releaseCalls).toBe(0);
    await expect(submitBtn).toBeEnabled();
  });

  test('真实丢失响应恢复与唯一作业断言：网络掉线后刷新页面点击恢复，复用原幂等键且数据库仅一作业', async ({
    page,
  }) => {
    // 启动完全独立的 RecoveryStack 实例（避免 0.0.6 已发布版本不可变冲突）
    const recoveryEnv = await setupIsolatedPlatform();
    console.log('MAIN API ORIGIN:', mainEnv?.apiOrigin);
    console.log('RECOVERY API ORIGIN:', recoveryEnv.apiOrigin);

    try {
      await loginToUploadConsole(page, recoveryEnv.token, recoveryEnv.apiOrigin);

      // 导入全部 185 个真实有效产物
      const submitBtn = await importCompleteRealMaterials(page, webManifestPath);
      await expect(submitBtn).toBeEnabled();

      // 拦截首个 POST /v1/releases 请求：服务端落库成功，但对前端丢弃响应（模拟真实掉线）
      let releasePostCalls = 0;
      let serverJobId = '';
      let capturedIdempotencyKey = '';
      const capturedKeys: string[] = [];

      await page.route('**/v1/releases', async (route) => {
        releasePostCalls++;
        const req = route.request();
        const idempKey = req.headers()['idempotency-key'] || '';
        capturedKeys.push(idempKey);
        capturedIdempotencyKey = idempKey;

        if (releasePostCalls === 1) {
          // 使用 Playwright 原生 route.fetch() 让真实网络请求发送给 API 服务端落库
          const response = await route.fetch();
          expect(response.status()).toBe(202);
          const body = (await response.json()) as any;
          serverJobId = body.jobId;
          // 服务端已成功 202 落库，此时对浏览器页面模拟网络异常掉线（丢弃响应）
          await route.abort('failed');
        } else {
          await route.continue();
        }
      });

      await submitBtn.click();

      // 前端捕获到网络异常，提示发布失败（等待 185 个产物直传与 complete 真实流转）
      await expect(page.locator('#upload-status-message')).toContainText('发布失败:', { timeout: 60000 });
      expect(serverJobId).toBeTruthy();
      expect(capturedIdempotencyKey).toBeTruthy();

      // 刷新页面模拟用户重新打开控制台
      await page.reload();

      // 验证出现恢复卡片并展示相同幂等键
      await expect(page.locator('body')).toContainText('检测到未完成的发布请求');
      await expect(page.locator('body')).toContainText(capturedIdempotencyKey);

      const resumeBtn = page.getByRole('button', { name: '恢复提交' });
      await expect(resumeBtn).toBeVisible();

      // 监听第二次恢复请求的 response
      const secondReleasePromise = page.waitForResponse(
        (res) => res.url().includes('/v1/releases') && res.request().method() === 'POST',
      );

      // 点击恢复提交
      await resumeBtn.click();

      // 断言第二次 POST 真实发生，取得 202 且返回的 jobId 等于首次请求的 serverJobId
      const secondReleaseRes = await secondReleasePromise;
      expect(secondReleaseRes.status()).toBe(202);
      const secondBody = (await secondReleaseRes.json()) as any;
      expect(secondBody.jobId).toBe(serverJobId);
      expect(capturedKeys[1]).toBe(capturedIdempotencyKey);

      // 验证数据库中严格仅有一条作业记录，且复用了相同的 jobId
      const dbJobs = await recoveryEnv.db.query('SELECT id, idempotency_key, state FROM release_jobs WHERE idempotency_key=$1', [
        capturedIdempotencyKey,
      ]);
      expect(dbJobs.rows.length).toBe(1);
      expect(dbJobs.rows[0]!.id).toBe(serverJobId);

      // ReleaseWorker 推进该作业至 READY
      const worker = new ReleaseWorker(recoveryEnv.db, recoveryEnv.store, recoveryEnv.registry);
      const ran = await worker.runOnce(serverJobId);
      expect(ran).toBe(true);

      // 验证浏览器自动感知 READY
      await expect(page.locator('.status-card .value.ready')).toContainText('READY');
    } finally {
      await recoveryEnv.cleanup();
    }
  });

  test('清单期望摘要不可篡改：导入同名损坏或篡改 tarball 时保持期望摘要并严格阻断发布 (DIGEST_MISMATCH)', async ({
    page,
  }) => {
    await loginToUploadConsole(page, mainEnv!.token, mainEnv!.apiOrigin);

    // 1. 导入合规的 0.0.6 网页清单
    await page.locator('#import-manifest-input').setInputFiles(webManifestPath);
    await expect(page.locator('#upload-status-message')).toContainText('成功导入外部 Manifest 清单');

    // 2. 复制真实 SDK 目录到临时目录，并只篡改其中同名 tarball 字节内容（保持长度相同，精确触发 DIGEST_MISMATCH）
    const corruptedDir = await mkdtemp(join(tmpdir(), 't08-corrupted-bundle-'));
    try {
      const { cp } = await import('node:fs/promises');
      await cp(CURRENT_SDK_DIR, corruptedDir, { recursive: true });
      const corruptedCoreTarball = join(corruptedDir, 'packages/company-charts-core-0.0.6.tgz');
      const originalTarballBytes = await readFile(corruptedCoreTarball);
      const flippedBytes = Buffer.from(originalTarballBytes);
      flippedBytes[100] = (flippedBytes[100]! + 1) % 256;
      await writeFile(corruptedCoreTarball, flippedBytes);

      // 3. 真实目录选择器导入被篡改的产物目录
      await page.locator('#import-files-input').setInputFiles(corruptedDir);
      await expect(page.locator('#upload-status-message')).toContainText('成功导入');

      // 4. 关联真实截图
      await page.locator('#import-screenshots-input').setInputFiles(join(corruptedDir, 'screenshots'));

      // 5. 核心断言：提交必须被阻断，错误提示列出 DIGEST_MISMATCH，且清单期望摘要保持原值
      const submitBtn = page.getByRole('button', { name: '确认并提交发布' });
      await expect(submitBtn).toBeDisabled();
      const blockerAlert = page.locator('.blocker-alert');
      await expect(blockerAlert).toContainText('DIGEST_MISMATCH');
      await expect(blockerAlert).toContainText('packages/company-charts-core-0.0.6.tgz');
    } finally {
      await rm(corruptedDir, { recursive: true, force: true });
    }
  });
});
