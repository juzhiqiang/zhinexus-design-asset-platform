import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';

const tempDirs: string[] = [];

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
    candidate: { version: '6.1.0', integrity: 'sha512-mock', source: 'offline', resolution: 'exact' },
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
    },
    recommendation: 'adopt',
    uncovered: [],
    ...overrides,
  };
}

describe('T10: component echarts check / verify CLI 集成与失败关闭约束', () => {
  afterEach(async () => {
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
    const argsCapturePath = path.join(await makeTempDir('t10-args-'), 'args.json');
    const evidence = validProbeEvidence();
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
        'offline',
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
    expect(forwarded).toContain('offline');
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

    // 1. 退出码 0 但 recommendation === 'hold'
    const holdProbe = await createMockProbeScript(`
process.stdout.write(${JSON.stringify(JSON.stringify(validProbeEvidence({ recommendation: 'hold' })))});
process.exit(0);
`);
    const holdRes = await runCli(['echarts', 'verify', '--bundle', bundleDir, '--probe-entry', holdProbe], '0.0.8');
    expect(holdRes.exitCode).toBe(1);
    expect(holdRes.stderr).toContain('PROBE_HOLD');

    // 2. 退出码 0、recommendation === 'adopt' 但缺证据 (uncovered 非空)
    const uncoveredProbe = await createMockProbeScript(`
process.stdout.write(${JSON.stringify(JSON.stringify(validProbeEvidence({ uncovered: ['react/visual: NEW'] })))});
process.exit(0);
`);
    const uncoveredRes = await runCli(
      ['echarts', 'verify', '--bundle', bundleDir, '--probe-entry', uncoveredProbe],
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
      ['echarts', 'verify', '--bundle', bundleDir, '--probe-entry', invalidSchemaProbe],
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
      ['echarts', 'verify', '--bundle', bundleDir, '--probe-entry', failedProbe],
      '0.0.8',
    );
    expect(failedRes.exitCode).toBe(1);
    expect(failedRes.stderr).toContain('PROBE_FAILED');
  });

  it('兼容探针 stdout 带 [probe] 日志前缀与 --out 目录 probe-evidence-<label>.json 文件读取', async () => {
    const bundleDir = await createFrozenBundleFixture();
    const outDir = await makeTempDir('t10-probe-out-');
    const evidence = validProbeEvidence();
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
      ['echarts', 'verify', '--bundle', bundleDir, '--out', outDir, '--label', 'with-logs', '--probe-entry', probeWithLogs, '--json'],
      '0.0.8',
    );
    expect(res.exitCode).toBe(0);
    const cliOut = JSON.parse(res.stdout);
    expect(cliOut.ok).toBe(true);
    expect(cliOut.recommendation).toBe('adopt');
  });
});
