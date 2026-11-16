import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_ENTRY = resolve('tests/evaluation/runner-id-cli.ts');
const CASES_FIXTURE = resolve('tests/evaluation/design-cases.json');
const OBSERVATIONS_FIXTURE = resolve('tests/evaluation/runner-id-observations.example.json');

const ROOT = mkdtempSync(join(tmpdir(), 'runner-id-cli-'));

function freshDir(label: string): string {
  const dir = join(ROOT, label);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

type CliRun = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runCli(args: string[], cwd: string): CliRun {
  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), CLI_ENTRY, ...args],
    { cwd, encoding: 'utf8', timeout: 120_000 },
  );
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const MAPPING_VERSION = 'mapping-v1';
const RUNNER_VERSION = 'runner-1.0.0';

function standardArgs(cases: string, observations: string, output: string): string[] {
  return [
    '--cases', cases,
    '--observations', observations,
    '--output', output,
    '--mapping-version', MAPPING_VERSION,
    '--runner-version', RUNNER_VERSION,
  ];
}

type Report = {
  passed: boolean;
  productionAcceptance: boolean;
  inputSha256: string;
  observationSha256: string;
  metadata: { mappingVersion: string; runnerVersion: string };
  real: { passed: boolean; totalCases: number; hardViolationCases: number; exactMappingRate: { value: number | null; display: string } };
  synthetic: { passed: boolean; totalCases: number; hardViolationCases: number };
  failures: { caseId: string; reasons: string[] }[];
};

function readReport(path: string): Report {
  expect(existsSync(path)).toBe(true);
  return readJson(path) as Report;
}

afterAll(() => {
  // 只删除本测试自建的临时目录，不触碰仓库或系统其他位置。
  if (ROOT.startsWith(tmpdir())) {
    rmSync(ROOT, { recursive: true, force: true });
  }
});

describe('T13 runner-id CLI 真实进程行为', () => {
  it('synthetic 样例产生 exit1 且报告 synthetic.passed=true、real N/A、productionAcceptance=false', () => {
    const dir = freshDir('synthetic-exit1');
    const cases = join(dir, 'cases.json');
    const observations = join(dir, 'observations.json');
    const output = join(dir, 'report.json');
    cpSync(CASES_FIXTURE, cases);
    cpSync(OBSERVATIONS_FIXTURE, observations);

    const result = runCli(standardArgs(cases, observations, output), dir);
    expect(result.status).toBe(1);

    const report = readReport(output);
    expect(report.synthetic.passed).toBe(true);
    expect(report.synthetic.totalCases).toBe(1);
    expect(report.synthetic.hardViolationCases).toBe(0);
    expect(report.real.passed).toBe(false);
    expect(report.real.totalCases).toBe(0);
    expect(report.real.exactMappingRate.value).toBeNull();
    expect(report.real.exactMappingRate.display).toBe('N/A');
    expect(report.passed).toBe(false);
    expect(report.productionAcceptance).toBe(false);
    expect(report.metadata).toEqual({ mappingVersion: MAPPING_VERSION, runnerVersion: RUNNER_VERSION });
  });

  it('临时把用例 origin 改为 real 后得到 exit0，报告 passed=true 且 real.passed=true', () => {
    const dir = freshDir('real-exit0');
    const cases = join(dir, 'cases.json');
    const observations = join(dir, 'observations.json');
    const output = join(dir, 'report.json');

    const fixtureCases = readJson(CASES_FIXTURE) as { origin: string; expected: { elements: { instanceId: string; designId: string; expectedStatus: string }[] } }[];
    expect(fixtureCases).toHaveLength(1);
    expect(fixtureCases[0]!.origin).toBe('synthetic');
    const realCases = JSON.parse(JSON.stringify(fixtureCases)) as typeof fixtureCases;
    realCases[0]!.origin = 'real';
    writeJson(cases, realCases);
    cpSync(OBSERVATIONS_FIXTURE, observations);

    const result = runCli(standardArgs(cases, observations, output), dir);
    expect(result.status).toBe(0);

    const report = readReport(output);
    expect(report.passed).toBe(true);
    expect(report.real.passed).toBe(true);
    expect(report.real.totalCases).toBe(1);
    expect(report.real.hardViolationCases).toBe(0);
    expect(report.synthetic.totalCases).toBe(0);
    expect(report.productionAcceptance).toBe(false);
  });

  it('观测 plan={} 作为评分失败得到 exit1 与 invalid-match-plan-schema 硬违规', () => {
    const dir = freshDir('hard-violation');
    const cases = join(dir, 'cases.json');
    const observations = join(dir, 'observations.json');
    const output = join(dir, 'report.json');

    const fixtureCases = readJson(CASES_FIXTURE) as { caseId: string; origin: string }[];
    const realCases = JSON.parse(JSON.stringify(fixtureCases)) as typeof fixtureCases;
    realCases[0]!.origin = 'real';
    writeJson(cases, realCases);
    writeJson(observations, [{ caseId: fixtureCases[0]!.caseId, plan: {} }]);

    const result = runCli(standardArgs(cases, observations, output), dir);
    expect(result.status).toBe(1);

    const report = readReport(output);
    expect(report.passed).toBe(false);
    expect(report.real.passed).toBe(false);
    expect(report.real.hardViolationCases).toBe(1);
    const failure = report.failures.find((f) => f.caseId === fixtureCases[0]!.caseId);
    expect(failure).toBeDefined();
    expect(failure!.reasons).toContain('invalid-match-plan-schema');
    expect(report.productionAcceptance).toBe(false);
  });

  it('摘要按原始文件字节计算（含空白），不与重新序列化结果混同', () => {
    const dir = freshDir('sha-bytes');
    const cases = join(dir, 'cases.json');
    const observations = join(dir, 'observations.json');
    const output = join(dir, 'report.json');

    const casesText = readFileSync(CASES_FIXTURE, 'utf8');
    const observationsText = readFileSync(OBSERVATIONS_FIXTURE, 'utf8');
    // 前后附加空白与缩进差异，行为等价但字节不同。
    const paddedCases = `\n\n   ${casesText}   \t\n`;
    const reindentedObservations = observationsText.replace(/\n/g, '\n    ');
    writeFileSync(cases, paddedCases, 'utf8');
    writeFileSync(observations, reindentedObservations, 'utf8');

    const result = runCli(standardArgs(cases, observations, output), dir);
    expect(result.status).toBe(1);

    const report = readReport(output);
    expect(report.inputSha256).toBe(sha256(readFileSync(cases)));
    expect(report.observationSha256).toBe(sha256(readFileSync(observations)));
    expect(report.inputSha256).toBe(sha256(Buffer.from(paddedCases, 'utf8')));
    expect(report.inputSha256).not.toBe(sha256(JSON.stringify(JSON.parse(paddedCases))));
    expect(report.observationSha256).not.toBe(sha256(observationsText));
  });

  it('报告路径等于输入路径时拒绝并保持输入字节不变', () => {
    const dir = freshDir('same-path');
    const cases = join(dir, 'cases.json');
    const observations = join(dir, 'observations.json');
    cpSync(CASES_FIXTURE, cases);
    cpSync(OBSERVATIONS_FIXTURE, observations);
    const casesBefore = readFileSync(cases);
    const observationsBefore = readFileSync(observations);
    const mtimeBefore = statSync(cases).mtimeMs;

    const sameAsCases = runCli(standardArgs(cases, observations, cases), dir);
    expect(sameAsCases.status).toBe(2);
    expect(readFileSync(cases).equals(casesBefore)).toBe(true);

    const sameAsObservations = runCli(standardArgs(cases, observations, observations), dir);
    expect(sameAsObservations.status).toBe(2);
    expect(readFileSync(observations).equals(observationsBefore)).toBe(true);

    // 带相对路径形式也必须识别为同一文件。
    const relativeSame = runCli(standardArgs('cases.json', observations, 'cases.json'), dir);
    expect(relativeSame.status).toBe(2);
    expect(readFileSync(cases).equals(casesBefore)).toBe(true);
    expect(statSync(cases).mtimeMs).toBe(mtimeBefore);
  });

  it('已有输出报告不可覆盖，拒绝后保留其原始字节', () => {
    const dir = freshDir('existing-report');
    const output = join(dir, 'report.json');
    const evidence = Buffer.from('previous evaluation evidence\n');
    writeFileSync(output, evidence);

    const result = runCli(standardArgs(CASES_FIXTURE, OBSERVATIONS_FIXTURE, output), dir);
    expect(result.status).toBe(2);
    expect(readFileSync(output)).toEqual(evidence);
  });

  it.each([
    ['缺少 --cases', (c: string, o: string, out: string) => ['--observations', o, '--output', out, '--mapping-version', MAPPING_VERSION, '--runner-version', RUNNER_VERSION]],
    ['缺少 --observations', (c: string, o: string, out: string) => ['--cases', c, '--output', out, '--mapping-version', MAPPING_VERSION, '--runner-version', RUNNER_VERSION]],
    ['缺少 --output', (c: string, o: string) => ['--cases', c, '--observations', o, '--mapping-version', MAPPING_VERSION, '--runner-version', RUNNER_VERSION]],
    ['缺少 --mapping-version', (c: string, o: string, out: string) => ['--cases', c, '--observations', o, '--output', out, '--runner-version', RUNNER_VERSION]],
    ['缺少 --runner-version', (c: string, o: string, out: string) => ['--cases', c, '--observations', o, '--output', out, '--mapping-version', MAPPING_VERSION]],
    ['重复 --cases', (c: string, o: string, out: string) => ['--cases', c, '--cases', c, '--observations', o, '--output', out, '--mapping-version', MAPPING_VERSION, '--runner-version', RUNNER_VERSION]],
    ['重复 --output', (c: string, o: string, out: string) => ['--cases', c, '--observations', o, '--output', out, '--output', out, '--mapping-version', MAPPING_VERSION, '--runner-version', RUNNER_VERSION]],
    ['未知参数 --verbose', (c: string, o: string, out: string) => ['--cases', c, '--observations', o, '--output', out, '--mapping-version', MAPPING_VERSION, '--runner-version', RUNNER_VERSION, '--verbose']],
    ['空值 --mapping-version', (c: string, o: string, out: string) => ['--cases', c, '--observations', o, '--output', out, '--mapping-version', '', '--runner-version', RUNNER_VERSION]],
    ['等号形式 --cases=x', (c: string, o: string, out: string) => [`--cases=${c}`, '--observations', o, '--output', out, '--mapping-version', MAPPING_VERSION, '--runner-version', RUNNER_VERSION]],
    ['位置参数', (c: string, o: string, out: string) => ['--cases', c, '--observations', o, '--output', out, '--mapping-version', MAPPING_VERSION, '--runner-version', RUNNER_VERSION, 'stray']],
    ['参数值缺失在末尾', (c: string, o: string, out: string) => ['--cases', c, '--observations', o, '--output', out, '--mapping-version', MAPPING_VERSION, '--runner-version']],
  ])('参数错误退出码 2 且不产出报告：%s', (_label, buildArgs) => {
    const dir = freshDir(`args-${_label.replace(/[^a-zA-Z0-9]+/g, '-')}`);
    const cases = join(dir, 'cases.json');
    const observations = join(dir, 'observations.json');
    const output = join(dir, 'report.json');
    cpSync(CASES_FIXTURE, cases);
    cpSync(OBSERVATIONS_FIXTURE, observations);

    const result = runCli(buildArgs(cases, observations, output), dir);
    expect(result.status).toBe(2);
    expect(existsSync(output)).toBe(false);
  });

  it('非法 JSON 与缺失文件退出码 2，诊断不回显输入原值', () => {
    const dir = freshDir('input-errors');
    const output = join(dir, 'report.json');
    const secret = `secret-${'y'.repeat(24)}`;

    const badJson = join(dir, 'bad.json');
    writeFileSync(badJson, `[{"caseId":"${secret}", oops`, 'utf8');
    const obs = join(dir, 'obs.json');
    cpSync(OBSERVATIONS_FIXTURE, obs);

    const badJsonRun = runCli(standardArgs(badJson, obs, output), dir);
    expect(badJsonRun.status).toBe(2);
    expect(existsSync(output)).toBe(false);
    expect(badJsonRun.stderr).not.toContain(secret);
    expect(`${badJsonRun.stdout}${badJsonRun.stderr}`.trim().length).toBeGreaterThan(0);

    const missing = join(dir, 'missing.json');
    const missingRun = runCli(standardArgs(missing, obs, output), dir);
    expect(missingRun.status).toBe(2);
    expect(existsSync(output)).toBe(false);
    expect(missingRun.stderr).not.toContain(secret);

    const obsMissingRun = runCli(standardArgs(join(dir, 'cases.json'), missing, output), dir);
    expect(obsMissingRun.status).toBe(2);
    expect(existsSync(output)).toBe(false);
  });

  it('结构非法输入（非数组/未知 caseId）退出码 2 且不回显敏感值', () => {
    const dir = freshDir('structural-errors');
    const output = join(dir, 'report.json');
    const secret = `secret-${'z'.repeat(24)}`;
    const cases = join(dir, 'cases.json');
    const observations = join(dir, 'observations.json');

    writeFileSync(cases, JSON.stringify({ caseId: secret }), 'utf8');
    cpSync(OBSERVATIONS_FIXTURE, observations);
    const notArray = runCli(standardArgs(cases, observations, output), dir);
    expect(notArray.status).toBe(2);
    expect(existsSync(output)).toBe(false);
    expect(`${notArray.stdout}${notArray.stderr}`).not.toContain(secret);

    cpSync(CASES_FIXTURE, cases);
    writeJson(observations, [{ caseId: secret, plan: {} }]);
    const unknownCase = runCli(standardArgs(cases, observations, output), dir);
    expect(unknownCase.status).toBe(2);
    expect(existsSync(output)).toBe(false);
    expect(`${unknownCase.stdout}${unknownCase.stderr}`).not.toContain(secret);
  });

  it('空 cases 与空 observations 视为评分失败退出码 1 并产出未通过报告', () => {
    const dir = freshDir('empty');
    const cases = join(dir, 'cases.json');
    const observations = join(dir, 'observations.json');
    const output = join(dir, 'report.json');
    writeFileSync(cases, '[]\n', 'utf8');
    writeFileSync(observations, '[]\n', 'utf8');

    const result = runCli(standardArgs(cases, observations, output), dir);
    expect(result.status).toBe(1);
    const report = readReport(output);
    expect(report.passed).toBe(false);
    expect(report.real.passed).toBe(false);
    expect(report.synthetic.passed).toBe(false);
    expect(report.productionAcceptance).toBe(false);
  });
});
