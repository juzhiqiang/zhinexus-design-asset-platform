import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';

const tempDirs: string[] = [];
const servers: http.Server[] = [];

async function startMockRegistry(packument: Record<string, unknown>): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(packument));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}/echarts`;
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createFrozenBundleFixture(options?: {
  tamperSha?: boolean;
  singleFrameworkOnly?: boolean;
}): Promise<string> {
  const bundleDir = await makeTempDir('t10-echarts-bundle-');
  const pkgsDir = path.join(bundleDir, 'packages');
  await fs.mkdir(pkgsDir, { recursive: true });

  const pkgSpecs = [
    {
      name: '@company/charts-core',
      file: 'company-charts-core-0.0.10.tgz',
      peerDependencies: { echarts: '6.1.0' },
    },
    {
      name: '@company/charts-vue',
      file: 'company-charts-vue-0.0.10.tgz',
      peerDependencies: { vue: '3.5.45', echarts: '6.1.0' },
    },
    {
      name: '@company/charts-react',
      file: 'company-charts-react-0.0.10.tgz',
      peerDependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
    },
  ];

  const packages = [];
  for (const spec of pkgSpecs) {
    const content = Buffer.from(`mock-tarball-${spec.name}-0.0.10`);
    const absPath = path.join(pkgsDir, spec.file);
    await fs.writeFile(absPath, content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    packages.push({
      name: spec.name,
      version: '0.0.10',
      tarballPath: `packages/${spec.file}`,
      sha256: options?.tamperSha && spec.name === '@company/charts-vue' ? '0'.repeat(64) : sha256,
      bytes: content.length,
      peerDependencies: spec.peerDependencies,
    });
  }

  const variants = [
    {
      variantId: 'line-vue',
      framework: 'vue',
      compatibility: [
        {
          framework: 'vue',
          frameworkVersion: '3.5.45',
          echartsVersion: '6.1.0',
          status: 'passed',
          reportId: 'rep-line-vue',
          verifiedAt: '2026-11-13T06:57:29.148Z',
        },
      ],
    },
    ...(options?.singleFrameworkOnly
      ? []
      : [
          {
            variantId: 'line-react',
            framework: 'react',
            compatibility: [
              {
                framework: 'react',
                frameworkVersion: '19.3.1',
                reactDomVersion: '19.3.1',
                echartsVersion: '6.1.0',
                status: 'passed',
                reportId: 'rep-line-react',
                verifiedAt: '2026-11-13T06:57:38.089Z',
              },
            ],
          },
        ]),
  ];

  await fs.writeFile(
    path.join(bundleDir, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, channel: 'cli', version: '0.0.10', packages, variants }, null, 2),
  );
  return bundleDir;
}

async function createMockProbeScript(scriptBody: string): Promise<string> {
  const dir = await makeTempDir('t10-mock-probe-');
  const scriptPath = path.join(dir, 'mock-probe.mjs');
  await fs.writeFile(scriptPath, scriptBody, 'utf8');
  return scriptPath;
}

async function validProbeEvidenceForBundle(bundleDir: string, overrides?: Record<string, unknown>) {
  const manifest = JSON.parse(await fs.readFile(path.join(bundleDir, 'manifest.json'), 'utf8')) as {
    packages: Array<{ name: string; version: string; sha256: string; bytes: number }>;
  };
  return validProbeEvidence({
    bundle: {
      root: bundleDir,
      channel: 'cli',
      version: '0.0.10',
      packages: manifest.packages.map((p) => ({
        name: p.name,
        version: p.version,
        sha256: p.sha256,
        bytes: p.bytes,
      })),
    },
    ...overrides,
  });
}

function validProbeEvidence(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    kind: 'a-t10-sdk-probe',
    generatedAt: '2026-11-14T02:00:00.000Z',
    bundle: {
      root: '/tmp/bundle',
      channel: 'cli',
      version: '0.0.10',
      packages: [
        { name: '@company/charts-core', version: '0.0.10', sha256: 'a'.repeat(64), bytes: 10 },
        { name: '@company/charts-vue', version: '0.0.10', sha256: 'b'.repeat(64), bytes: 10 },
        { name: '@company/charts-react', version: '0.0.10', sha256: 'c'.repeat(64), bytes: 10 },
      ],
    },
    candidate: {
      version: '6.1.0',
      integrity: 'sha512-registry-610==',
      integrityVerified: true,
      source: 'http://127.0.0.1:0/echarts',
      resolution: 'exact',
    },
    requestedEchartsVersion: '6.1.0',
    baselineEchartsVersion: '6.1.0',
    supported: [
      { framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.1.0', reportId: 'rep-v', verifiedAt: '2026-11-13T06:57:29.148Z' },
      { framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.1.0', reportId: 'rep-r', verifiedAt: '2026-11-13T06:57:38.089Z' },
    ],
    combinations: [
      {
        framework: 'vue',
        frameworkVersion: '3.5.45',
        baselineEchartsVersion: '6.1.0',
        echartsVersion: '6.1.0',
        dimensions: { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' },
        failures: [],
      },
      {
        framework: 'react',
        frameworkVersion: '19.3.1',
        baselineEchartsVersion: '6.1.0',
        echartsVersion: '6.1.0',
        dimensions: { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' },
        failures: [],
      },
    ],
    policy: {
      peerSatisfied: true,
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: false,
      hasDualFrameworkCoverage: true,
      candidateIntegrityVerified: true,
    },
    recommendation: 'adopt',
    uncovered: [],
    ...overrides,
  };
}

describe('T10: component echarts check / verify CLI 集成与失败关闭约束', () => {
  afterEach(async () => {
    for (const srv of servers.splice(0)) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('component echarts check 只查询冻结 bundle 与支持矩阵，精准匹配双框架 6.1.0 时通过', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const res = await runCli(
      ['echarts', 'check', '--bundle', bundleDir, '--echarts', '6.1.0', '--registry', 'offline', '--json'],
      '0.0.8',
    );
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.candidateEchartsVersion).toBe('6.1.0');
    expect(parsed.peerSatisfied).toBe(true);
    expect(parsed.hasDualFrameworkCoverage).toBe(true);
    expect(parsed.supported).toHaveLength(2);
  });

  it('component echarts check 拒绝非精确版本、未验证候选或摘要篡改的 bundle', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const nonExact = await runCli(
      ['echarts', 'check', '--bundle', bundleDir, '--echarts', '^6.1.0', '--registry', 'offline'],
      '0.0.8',
    );
    expect(nonExact.exitCode).toBe(1);
    expect(nonExact.stderr).toContain('NOT_EXACT_VERSION');

    const unverified = await runCli(
      ['echarts', 'check', '--bundle', bundleDir, '--echarts', '6.2.0', '--registry', 'offline'],
      '0.0.8',
    );
    expect(unverified.exitCode).toBe(1);
    expect(unverified.stderr).toMatch(/PEER_UNSATISFIED|VERIFY_REQUIRED/);

    const tamperedDir = await createFrozenBundleFixture({ tamperSha: true });
    const tampered = await runCli(
      ['echarts', 'check', '--bundle', tamperedDir, '--echarts', '6.1.0', '--registry', 'offline'],
      '0.0.8',
    );
    expect(tampered.exitCode).toBe(1);
    expect(tampered.stderr).toContain('BUNDLE_DIGEST_MISMATCH');
  });

  it('component echarts verify 透传冻结 --bundle 与完整探针参数，仅在 adopt + 无未覆盖项 + 四维全过时返回 0', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const registryUrl = await startMockRegistry({
      'dist-tags': { latest: '6.1.0' },
      versions: { '6.1.0': { dist: { integrity: 'sha512-registry-610==' } } },
    });
    const argsCapturePath = path.join(await makeTempDir('t10-args-'), 'args.json');
    const evidence = await validProbeEvidenceForBundle(bundleDir, {
      candidate: {
        version: '6.1.0',
        integrity: 'sha512-registry-610==',
        integrityVerified: true,
        source: registryUrl,
        resolution: 'exact',
      },
    });
    const probeScript = await createMockProbeScript(`
import fs from 'node:fs/promises';
await fs.writeFile(${JSON.stringify(argsCapturePath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(JSON.stringify(evidence))});
process.exit(0);
`);

    const res = await runCli(
      [
        'echarts',
        'verify',
        '--bundle',
        bundleDir,
        '--echarts',
        '6.1.0',
        '--frameworks',
        'vue,react',
        '--components',
        'line,bar',
        '--presentations',
        'light-canvas',
        '--registry',
        registryUrl,
        '--peer',
        'strict',
        '--label',
        'light-pass',
        '--baseline',
        '/tmp/base-a.json,/tmp/base-b.json',
        '--probe-entry',
        probeScript,
        '--json',
      ],
      '0.0.8',
    );

    expect(res.exitCode).toBe(0);
    const forwarded: string[] = JSON.parse(await fs.readFile(argsCapturePath, 'utf8'));
    expect(forwarded).toContain('--bundle');
    expect(forwarded).toContain(path.resolve(bundleDir));
    expect(forwarded).toContain('--echarts');
    expect(forwarded).toContain('6.1.0');
    expect(forwarded).toContain('--frameworks');
    expect(forwarded).toContain('vue,react');
    expect(forwarded).toContain('--components');
    expect(forwarded).toContain('line,bar');
    expect(forwarded).toContain('--presentations');
    expect(forwarded).toContain('light-canvas');
    expect(forwarded).toContain('--registry');
    expect(forwarded).toContain(registryUrl);
    expect(forwarded).toContain('--peer');
    expect(forwarded).toContain('strict');
    expect(forwarded).toContain('--label');
    expect(forwarded).toContain('light-pass');
    expect(forwarded).toContain('--baseline');
    expect(forwarded).toContain('/tmp/base-a.json,/tmp/base-b.json');
    expect(forwarded).toContain('--json');

    const cliOut = JSON.parse(res.stdout);
    expect(cliOut.ok).toBe(true);
    expect(cliOut.recommendation).toBe('adopt');
  });

  it('退出码 0 但 recommendation=hold、存在 uncovered/not-run 或 schema 非法时必须失败关闭', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const registryUrl = await startMockRegistry({
      'dist-tags': { latest: '6.1.0' },
      versions: { '6.1.0': { dist: { integrity: 'sha512-registry-610==' } } },
    });

    // 1. 退出码 0 但 recommendation === 'hold'
    const holdProbe = await createMockProbeScript(`
process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { recommendation: 'hold', candidate: { version: '6.1.0', integrity: 'sha512-registry-610==', source: registryUrl, integrityVerified: true } })))});
process.exit(0);
`);
    const holdRes = await runCli(['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', holdProbe], '0.0.8');
    expect(holdRes.exitCode).toBe(1);
    expect(holdRes.stderr).toContain('PROBE_HOLD');

    // 2. 退出码 0、recommendation === 'adopt' 但缺证据 (uncovered 非空)
    const uncoveredProbe = await createMockProbeScript(`
process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { uncovered: ['react/visual: NEW'], candidate: { version: '6.1.0', integrity: 'sha512-registry-610==', source: registryUrl, integrityVerified: true } })))});
process.exit(0);
`);
    const uncoveredRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', uncoveredProbe],
      '0.0.8',
    );
    expect(uncoveredRes.exitCode).toBe(1);
    expect(uncoveredRes.stderr).toContain('INCOMPLETE_EVIDENCE');

    // 3. 退出码 0 但 stdout schema 非法 ({})
    const invalidSchemaProbe = await createMockProbeScript(`
process.stdout.write('{}');
process.exit(0);
`);
    const invalidRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', invalidSchemaProbe],
      '0.0.8',
    );
    expect(invalidRes.exitCode).toBe(1);
    expect(invalidRes.stderr).toContain('INVALID_PROBE_EVIDENCE');

    // 4. 子进程退出码非 0
    const failedProbe = await createMockProbeScript(`
process.stderr.write('PROBE_FAILED boom');
process.exit(1);
`);
    const failedRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', failedProbe],
      '0.0.8',
    );
    expect(failedRes.exitCode).toBe(1);
    expect(failedRes.stderr).toContain('PROBE_FAILED');
  });

  it('兼容探针 stdout 带 [probe] 日志前缀与 --out 目录 probe-evidence-<label>.json 文件读取', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const registryUrl = await startMockRegistry({
      'dist-tags': { latest: '6.1.0' },
      versions: { '6.1.0': { dist: { integrity: 'sha512-registry-610==' } } },
    });
    const outDir = await makeTempDir('t10-probe-out-');
    const evidence = await validProbeEvidenceForBundle(bundleDir, {
      candidate: {
        version: '6.1.0',
        integrity: 'sha512-registry-610==',
        integrityVerified: true,
        source: registryUrl,
        resolution: 'exact',
      },
    });
    const probeWithLogs = await createMockProbeScript(`
import fs from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const labelIdx = args.indexOf('--label');
const outDir = args[outIdx + 1];
const label = args[labelIdx + 1];
await fs.writeFile(path.join(outDir, 'probe-evidence-' + label + '.json'), JSON.stringify(${JSON.stringify(evidence)}));
console.log('[probe] 冻结 bundle 校验通过');
console.log('[probe] recommendation=adopt');
process.stdout.write(JSON.stringify(${JSON.stringify(evidence)}));
`);

    const res = await runCli(
      [
        'echarts',
        'verify',
        '--bundle',
        bundleDir,
        '--registry',
        registryUrl,
        '--out',
        outDir,
        '--label',
        'with-logs',
        '--probe-entry',
        probeWithLogs,
        '--json',
      ],
      '0.0.8',
    );
    expect(res.exitCode).toBe(0);
    const cliOut = JSON.parse(res.stdout);
    expect(cliOut.ok).toBe(true);
    expect(cliOut.recommendation).toBe('adopt');
  });

  it('check 支持 --version/--latest 并真实查询 --registry 记录 integrity 与代理差异，拒绝 --latest + offline', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const registryUrl = await startMockRegistry({
      'dist-tags': { latest: '6.1.0' },
      versions: {
        '6.1.0': { dist: { integrity: 'sha512-registry-610==' } },
      },
    });

    const latestRes = await runCli(
      ['echarts', 'check', '--bundle', bundleDir, '--latest', '--registry', registryUrl, '--json'],
      '0.0.8',
    );
    expect(latestRes.exitCode).toBe(0);
    const parsed = JSON.parse(latestRes.stdout);
    expect(parsed.candidateEchartsVersion).toBe('6.1.0');
    expect(parsed.candidateIntegrity).toBe('sha512-registry-610==');
    expect(parsed.isOfficialRegistry).toBe(false);
    expect(parsed.registryProxyNote).toContain(registryUrl);

    const offlineLatest = await runCli(
      ['echarts', 'check', '--bundle', bundleDir, '--latest', '--registry', 'offline'],
      '0.0.8',
    );
    expect(offlineLatest.exitCode).toBe(1);
    expect(offlineLatest.stderr).toContain('OFFLINE_LATEST_UNSUPPORTED');
  });

  it('verify 支持 --version/--latest 入口，并严格绑定 bundle 摘要/候选/真实双框架/无 failures/唯一输出目录', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const registryUrl = await startMockRegistry({
      'dist-tags': { latest: '6.1.0' },
      versions: { '6.1.0': { dist: { integrity: 'sha512-registry-610==' } } },
    });

    // 1) --latest 解析为 6.1.0 并透传给探针
    const argsCapturePath = path.join(await makeTempDir('t10-latest-args-'), 'args.json');
    const validEv = await validProbeEvidenceForBundle(bundleDir, {
      candidate: {
        version: '6.1.0',
        integrity: 'sha512-registry-610==',
        integrityVerified: true,
        source: registryUrl,
        resolution: 'exact',
      },
    });
    const okProbe = await createMockProbeScript(`
import fs from 'node:fs/promises';
await fs.writeFile(${JSON.stringify(argsCapturePath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(${JSON.stringify(JSON.stringify(validEv))});
`);
    const latestVerify = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--latest', '--registry', registryUrl, '--probe-entry', okProbe, '--json'],
      '0.0.8',
    );
    expect(latestVerify.exitCode).toBe(0);
    const forwarded: string[] = JSON.parse(await fs.readFile(argsCapturePath, 'utf8'));
    expect(forwarded).toContain('--echarts');
    expect(forwarded).toContain('6.1.0');

    // 2) 空 packages[] 或错误 sha256 -> 拒绝
    const emptyPkgProbe = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { bundle: { version: '0.0.10', packages: [] }, candidate: validEv.candidate })))});`,
    );
    const emptyPkgRes = await runCli(['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', emptyPkgProbe], '0.0.8');
    expect(emptyPkgRes.exitCode).toBe(1);
    expect(emptyPkgRes.stderr).toContain('BUNDLE_EVIDENCE_MISMATCH');

    // 3) 候选版本不匹配 -> 拒绝
    const wrongCandProbe = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: { ...validEv.candidate, version: '6.2.0' } })))});`,
    );
    const wrongCandRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--version', '6.1.0', '--registry', registryUrl, '--probe-entry', wrongCandProbe],
      '0.0.8',
    );
    expect(wrongCandRes.exitCode).toBe(1);
    expect(wrongCandRes.stderr).toContain('CANDIDATE_MISMATCH');

    // 4) combinations 缺 react（即使 policy.hasDualFrameworkCoverage=true）或未知框架 -> 拒绝
    const singleCombo = (validEv.combinations as Array<Record<string, unknown>>).slice(0, 1);
    const missingReactProbe = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: validEv.candidate, combinations: singleCombo })))});`,
    );
    const missingReactRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', missingReactProbe],
      '0.0.8',
    );
    expect(missingReactRes.exitCode).toBe(1);
    expect(missingReactRes.stderr).toContain('FRAMEWORK_COVERAGE_INVALID');

    // 5) adopt 但 failures 非空 -> 拒绝
    const combosWithFailure = (validEv.combinations as Array<Record<string, unknown>>).map((c, idx) =>
      idx === 0 ? { ...c, failures: [{ dimension: 'visual', reason: 'DIFF' }] } : c,
    );
    const failureAdoptProbe = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: validEv.candidate, combinations: combosWithFailure })))});`,
    );
    const failureAdoptRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', failureAdoptProbe],
      '0.0.8',
    );
    expect(failureAdoptRes.exitCode).toBe(1);
    expect(failureAdoptRes.stderr).toContain('INCOMPLETE_EVIDENCE');

    // 6) supportedRangeUnchanged !== true -> 拒绝
    const rangeChangedProbe = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: validEv.candidate, policy: { ...validEv.policy, supportedRangeUnchanged: false } })))});`,
    );
    const rangeChangedRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', rangeChangedProbe],
      '0.0.8',
    );
    expect(rangeChangedRes.exitCode).toBe(1);
    expect(rangeChangedRes.stderr).toContain('POLICY_NOT_SATISFIED');

    // 7) 非法 --label 与重用 --out 同名旧文件 -> 拒绝
    const badLabelRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--label', 'BAD_LABEL!', '--probe-entry', okProbe],
      '0.0.8',
    );
    expect(badLabelRes.exitCode).toBe(1);
    expect(badLabelRes.stderr).toContain('INVALID_LABEL');

    const reuseOutDir = await makeTempDir('t10-reuse-out-');
    await fs.writeFile(path.join(reuseOutDir, 'probe-evidence-dup.json'), JSON.stringify(validEv));
    const reuseRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--out', reuseOutDir, '--label', 'dup', '--probe-entry', okProbe],
      '0.0.8',
    );
    expect(reuseRes.exitCode).toBe(1);
    expect(reuseRes.stderr).toContain('OUTPUT_ALREADY_EXISTS');
  });

  it('P2 复核回归：拒绝组合版本错配/缺字段、integrity/source 篡改、离线 verify adopt、畸形 failures 与 Windows junction 越界', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const registryUrl = await startMockRegistry({
      'dist-tags': { latest: '6.1.0' },
      versions: { '6.1.0': { dist: { integrity: 'sha512-NEW-610==' } } },
    });
    const validEv = await validProbeEvidenceForBundle(bundleDir, {
      candidate: {
        version: '6.1.0',
        integrity: 'sha512-NEW-610==',
        integrityVerified: true,
        source: registryUrl,
        resolution: 'exact',
      },
    });

    // P2-1a: 顶层 candidate.version=6.1.0 但组合 echartsVersion=5.0.0 -> 拒绝
    const mismatchedComboEcharts = (validEv.combinations as Array<Record<string, unknown>>).map((c, idx) =>
      idx === 0 ? { ...c, echartsVersion: '5.0.0' } : c,
    );
    const p2_1a = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: validEv.candidate, combinations: mismatchedComboEcharts })))});`,
    );
    const r1a = await runCli(['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', p2_1a], '0.0.8');
    expect(r1a.exitCode).toBe(1);
    expect(r1a.stderr).toContain('CANDIDATE_MISMATCH');

    // P2-1b: 删除组合 frameworkVersion / echartsVersion -> 拒绝 (INVALID_PROBE_EVIDENCE)
    const strippedCombo = (validEv.combinations as Array<Record<string, unknown>>).map((c, idx) => {
      if (idx !== 0) return c;
      const copy = { ...c };
      delete copy.frameworkVersion;
      delete copy.echartsVersion;
      return copy;
    });
    const p2_1b = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: validEv.candidate, combinations: strippedCombo })))});`,
    );
    const r1b = await runCli(['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', p2_1b], '0.0.8');
    expect(r1b.exitCode).toBe(1);
    expect(r1b.stderr).toContain('INVALID_PROBE_EVIDENCE');

    // P2-1c: 组合 frameworkVersion 与冻结 supported 不对齐 -> 拒绝
    const wrongFwVer = (validEv.combinations as Array<Record<string, unknown>>).map((c, idx) =>
      idx === 0 ? { ...c, frameworkVersion: '2.7.14' } : c,
    );
    const p2_1c = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: validEv.candidate, combinations: wrongFwVer })))});`,
    );
    const r1c = await runCli(['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', p2_1c], '0.0.8');
    expect(r1c.exitCode).toBe(1);
    expect(r1c.stderr).toContain('FRAMEWORK_VERSION_MISMATCH');

    // P2-2a: --latest 官方 resolver 得 sha512-NEW-610==，但证据为 sha512-old 或 source=offline -> 拒绝
    const staleIntegrityProbe = await createMockProbeScript(
      `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: { ...validEv.candidate, integrity: 'sha512-old', source: 'offline' } })))});`,
    );
    const r2a = await runCli(['echarts', 'verify', '--bundle', bundleDir, '--latest', '--registry', registryUrl, '--probe-entry', staleIntegrityProbe], '0.0.8');
    expect(r2a.exitCode).toBe(1);
    expect(r2a.stderr).toMatch(/CANDIDATE_INTEGRITY_MISMATCH|CANDIDATE_SOURCE_MISMATCH/);

    // P2-2b: 离线模式 verify 不得 adopt
    const offlineVerifyRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--echarts', '6.1.0', '--registry', 'offline', '--probe-entry', staleIntegrityProbe],
      '0.0.8',
    );
    expect(offlineVerifyRes.exitCode).toBe(1);
    expect(offlineVerifyRes.stderr).toContain('OFFLINE_VERIFY_CANNOT_ADOPT');

    // P2-3: failures={} 或 failures=[null] -> 结构化 INVALID_PROBE_EVIDENCE（不抛 TypeError）
    for (const badFailures of [{}, [null]]) {
      const badCombo = (validEv.combinations as Array<Record<string, unknown>>).map((c, idx) =>
        idx === 0 ? { ...c, failures: badFailures } : c,
      );
      const p2_3 = await createMockProbeScript(
        `process.stdout.write(${JSON.stringify(JSON.stringify(await validProbeEvidenceForBundle(bundleDir, { candidate: validEv.candidate, combinations: badCombo })))});`,
      );
      const r3 = await runCli(['echarts', 'verify', '--bundle', bundleDir, '--registry', registryUrl, '--probe-entry', p2_3], '0.0.8');
      expect(r3.exitCode).toBe(1);
      expect(r3.stderr).toContain('INVALID_PROBE_EVIDENCE');
    }

    // P2-4: Windows packages 目录 junction 指向 bundle 外 -> 拒绝 (INVALID_BUNDLE_PATH)
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 't10-junction-outside-'));
    const junctionBundle = await fs.mkdtemp(path.join(os.tmpdir(), 't10-junction-bundle-'));
    try {
      const originalPkgsDir = path.join(bundleDir, 'packages');
      for (const file of await fs.readdir(originalPkgsDir)) {
        await fs.copyFile(path.join(originalPkgsDir, file), path.join(outsideDir, file));
      }
      await fs.copyFile(path.join(bundleDir, 'manifest.json'), path.join(junctionBundle, 'manifest.json'));
      await fs.symlink(outsideDir, path.join(junctionBundle, 'packages'), 'junction');

      const junctionCheck = await runCli(
        ['echarts', 'check', '--bundle', junctionBundle, '--echarts', '6.1.0', '--registry', 'offline'],
        '0.0.8',
      );
      expect(junctionCheck.exitCode).toBe(1);
      expect(junctionCheck.stderr).toContain('INVALID_BUNDLE_PATH');
    } finally {
      await fs.rm(junctionBundle, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
