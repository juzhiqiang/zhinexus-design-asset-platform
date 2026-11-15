import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvaluationCase, EvaluationObservation } from './scoring.js';
import { runEvaluationCli } from './runner.js';

type EvalCaseWithSplit = EvaluationCase & { split: string };

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'a3-eval-runner-'));
  tempDirs.push(dir);
  return dir;
}

function sha256Hex(raw: Buffer): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeRealPassingDataset(): {
  cases: EvalCaseWithSplit[];
  observations: EvaluationObservation[];
} {
  const cases: EvalCaseWithSplit[] = [];
  const observations: EvaluationObservation[] = [];

  for (let i = 1; i <= 20; i += 1) {
    const caseId = `real-match-${i}`;
    cases.push({
      caseId,
      origin: 'real',
      category: 'matchable',
      acceptableVariantIds: [`var-${i}`],
      requiredGapFields: ['peer:react-dom'],
      split: 'eval',
    });
    observations.push({
      caseId,
      top5VariantIds: [`var-${i}`],
      gapFields: ['peer:react-dom'],
      hardViolations: [],
    });
  }

  for (let i = 1; i <= 10; i += 1) {
    const caseId = `real-trap-${i}`;
    cases.push({
      caseId,
      origin: 'real',
      category: 'no-match',
      acceptableVariantIds: [],
      requiredGapFields: ['missing:capability'],
      split: 'eval',
    });
    observations.push({
      caseId,
      top5VariantIds: [],
      gapFields: ['missing:capability'],
      hardViolations: [],
    });
  }

  return { cases, observations };
}

function writeJsonFile(dir: string, filename: string, data: unknown): { path: string; raw: Buffer } {
  const filePath = join(dir, filename);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(filePath, text, 'utf8');
  return { path: filePath, raw: readFileSync(filePath) };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('A3 offline evaluation runner', () => {
  it('达标时写入报告并返回退出码 0，包含原始字节 SHA256、版本、注入时间及 real/synthetic 分组', () => {
    const dir = makeTempDir();
    const { cases, observations } = makeRealPassingDataset();
    cases.push({
      caseId: 'syn-1',
      origin: 'synthetic',
      category: 'api-trap',
      acceptableVariantIds: [],
      requiredGapFields: ['api:missing'],
      split: 'eval',
    });
    observations.push({
      caseId: 'syn-1',
      top5VariantIds: ['wrong-var'],
      gapFields: [],
      hardViolations: [],
    });

    const casesFile = writeJsonFile(dir, 'cases.json', { schemaVersion: 1, cases });
    const obsFile = writeJsonFile(dir, 'observations.json', { schemaVersion: 1, observations });
    const outputPath = join(dir, 'report.json');
    const fixedNow = new Date('2026-11-15T12:34:56.789Z');
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const code = runEvaluationCli(
      [
        '--cases',
        casesFile.path,
        '--observations',
        obsFile.path,
        '--output',
        outputPath,
        '--retrieval-version',
        'metadata-text-v1',
        '--model-version',
        'none',
      ],
      {
        now: () => fixedNow,
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line),
      },
    );

    expect(code).toBe(0);
    expect(stderrLines).toEqual([]);
    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Record<string, unknown>;
    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe('2026-11-15T12:34:56.789Z');
    expect(report.versions).toEqual({
      retrievalVersion: 'metadata-text-v1',
      modelVersion: 'none',
    });
    expect(report.inputs).toEqual({
      casesSha256: sha256Hex(casesFile.raw),
      observationsSha256: sha256Hex(obsFile.raw),
    });

    const score = report.score as {
      passed: boolean;
      real: { totalCases: number; trapCases: number; passed: boolean };
      synthetic: { totalCases: number; passed: boolean };
    };
    expect(score.passed).toBe(true);
    expect(score.real.totalCases).toBe(30);
    expect(score.real.trapCases).toBe(10);
    expect(score.real.passed).toBe(true);
    expect(score.synthetic.totalCases).toBe(1);
    expect(score.synthetic.passed).toBe(false);

    // 不打印原始 case/observation 内容
    const combinedOutput = stdoutLines.join('\n');
    expect(combinedOutput).not.toContain('real-match-1');
    expect(combinedOutput).not.toContain('wrong-var');
  });

  it('输入合法但未达标（如仅 synthetic 样本）时仍写入报告并返回退出码 2', () => {
    const dir = makeTempDir();
    const casesFile = writeJsonFile(dir, 'cases.json', {
      schemaVersion: 1,
      cases: [
        {
          caseId: 'syn-only',
          origin: 'synthetic',
          category: 'matchable',
          acceptableVariantIds: ['v1'],
          requiredGapFields: ['peer:vue'],
          split: 'eval',
        },
      ],
    });
    const obsFile = writeJsonFile(dir, 'observations.json', {
      schemaVersion: 1,
      observations: [
        {
          caseId: 'syn-only',
          top5VariantIds: ['v1'],
          gapFields: ['peer:vue'],
          hardViolations: [],
        },
      ],
    });
    const outputPath = join(dir, 'report-fail.json');

    const code = runEvaluationCli([
      '--cases',
      casesFile.path,
      '--observations',
      obsFile.path,
      '--output',
      outputPath,
      '--retrieval-version',
      'metadata-text-v1',
      '--model-version',
      'rerank-v0',
    ]);

    expect(code).toBe(2);
    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as {
      score: { passed: boolean; real: { totalCases: number }; synthetic: { totalCases: number } };
    };
    expect(report.score.passed).toBe(false);
    expect(report.score.real.totalCases).toBe(0);
    expect(report.score.synthetic.totalCases).toBe(1);
  });

  it('拒绝缺失参数、重复参数、未知参数或位置参数并返回退出码 1', () => {
    const dir = makeTempDir();
    const casesFile = writeJsonFile(dir, 'cases.json', { schemaVersion: 1, cases: [] });
    const obsFile = writeJsonFile(dir, 'observations.json', { schemaVersion: 1, observations: [] });

    const invalidArgvs: string[][] = [
      // 缺少 --model-version
      [
        '--cases',
        casesFile.path,
        '--observations',
        obsFile.path,
        '--output',
        join(dir, 'out1.json'),
        '--retrieval-version',
        'v1',
      ],
      // 重复 --cases
      [
        '--cases',
        casesFile.path,
        '--cases',
        casesFile.path,
        '--observations',
        obsFile.path,
        '--output',
        join(dir, 'out2.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
      // 未知参数
      [
        '--cases',
        casesFile.path,
        '--observations',
        obsFile.path,
        '--output',
        join(dir, 'out3.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
        '--unknown',
        'x',
      ],
      // 位置参数
      [
        'extra-arg',
        '--cases',
        casesFile.path,
        '--observations',
        obsFile.path,
        '--output',
        join(dir, 'out4.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
    ];

    for (const argv of invalidArgvs) {
      expect(runEvaluationCli(argv, { stderr: () => {} })).toBe(1);
    }
  });

  it('拒绝 train split、未知字段、非 schemaVersion=1、重复及未知 caseId 并返回退出码 1', () => {
    const dir = makeTempDir();

    const badCasesPayloads: unknown[] = [
      // schemaVersion 非 1
      { schemaVersion: 2, cases: [] },
      // 顶层未知字段
      { schemaVersion: 1, cases: [], extra: true },
      // split 为 train
      {
        schemaVersion: 1,
        cases: [
          {
            caseId: 'c1',
            origin: 'real',
            category: 'matchable',
            acceptableVariantIds: ['v1'],
            requiredGapFields: [],
            split: 'train',
          },
        ],
      },
      // case 条目含未知字段
      {
        schemaVersion: 1,
        cases: [
          {
            caseId: 'c1',
            origin: 'real',
            category: 'matchable',
            acceptableVariantIds: ['v1'],
            requiredGapFields: [],
            split: 'eval',
            unexpected: 123,
          },
        ],
      },
    ];

    const validObs = writeJsonFile(dir, 'valid-obs.json', { schemaVersion: 1, observations: [] });

    badCasesPayloads.forEach((payload, index) => {
      const badCases = writeJsonFile(dir, `bad-cases-${index}.json`, payload);
      const code = runEvaluationCli(
        [
          '--cases',
          badCases.path,
          '--observations',
          validObs.path,
          '--output',
          join(dir, `bad-out-${index}.json`),
          '--retrieval-version',
          'v1',
          '--model-version',
          'none',
        ],
        { stderr: () => {} },
      );
      expect(code).toBe(1);
    });

    const validCases = writeJsonFile(dir, 'valid-cases.json', {
      schemaVersion: 1,
      cases: [
        {
          caseId: 'c1',
          origin: 'real',
          category: 'matchable',
          acceptableVariantIds: ['v1'],
          requiredGapFields: [],
          split: 'eval',
        },
      ],
    });

    const badObsPayloads: unknown[] = [
      // observations 顶层未知字段
      { schemaVersion: 1, observations: [], extra: 'x' },
      // observation 条目未知字段
      {
        schemaVersion: 1,
        observations: [
          {
            caseId: 'c1',
            top5VariantIds: ['v1'],
            gapFields: [],
            hardViolations: [],
            extra: 'x',
          },
        ],
      },
      // 未知 caseId
      {
        schemaVersion: 1,
        observations: [
          {
            caseId: 'unknown-id',
            top5VariantIds: [],
            gapFields: [],
            hardViolations: [],
          },
        ],
      },
    ];

    badObsPayloads.forEach((payload, index) => {
      const badObs = writeJsonFile(dir, `bad-obs-${index}.json`, payload);
      const code = runEvaluationCli(
        [
          '--cases',
          validCases.path,
          '--observations',
          badObs.path,
          '--output',
          join(dir, `bad-obs-out-${index}.json`),
          '--retrieval-version',
          'v1',
          '--model-version',
          'none',
        ],
        { stderr: () => {} },
      );
      expect(code).toBe(1);
    });
  });

  it('使用独占创建 wx：输出文件已存在或与输入文件相同时不覆盖并返回退出码 1', () => {
    const dir = makeTempDir();
    const casesFile = writeJsonFile(dir, 'cases.json', { schemaVersion: 1, cases: [] });
    const obsFile = writeJsonFile(dir, 'observations.json', { schemaVersion: 1, observations: [] });
    const existingOutput = join(dir, 'existing.json');
    writeFileSync(existingOutput, '{"keep":true}\n', 'utf8');

    const codeExisting = runEvaluationCli(
      [
        '--cases',
        casesFile.path,
        '--observations',
        obsFile.path,
        '--output',
        existingOutput,
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
      { stderr: () => {} },
    );
    expect(codeExisting).toBe(1);
    expect(readFileSync(existingOutput, 'utf8')).toBe('{"keep":true}\n');

    const codeSameAsInput = runEvaluationCli(
      [
        '--cases',
        casesFile.path,
        '--observations',
        obsFile.path,
        '--output',
        casesFile.path,
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
      { stderr: () => {} },
    );
    expect(codeSameAsInput).toBe(1);
    expect(readFileSync(casesFile.path)).toEqual(casesFile.raw);
  });

  it('失败时仅输出固定错误分类，不向 stdout/stderr 回显 SECRET 标记（非法 split/未知字段/重复 caseId/IO 路径/位置参数）', () => {
    const dir = makeTempDir();
    const validCases = writeJsonFile(dir, 'valid-cases.json', {
      schemaVersion: 1,
      cases: [
        {
          caseId: 'c1',
          origin: 'real',
          category: 'matchable',
          acceptableVariantIds: ['v1'],
          requiredGapFields: [],
          split: 'eval',
        },
      ],
    });
    const validObs = writeJsonFile(dir, 'valid-obs.json', { schemaVersion: 1, observations: [] });

    const badSplitCases = writeJsonFile(dir, 'secret-split.json', {
      schemaVersion: 1,
      cases: [
        {
          caseId: 'c1',
          origin: 'real',
          category: 'matchable',
          acceptableVariantIds: ['v1'],
          requiredGapFields: [],
          split: 'SECRET_SPLIT_TOKEN',
        },
      ],
    });
    const unknownKeyCases = writeJsonFile(dir, 'secret-key.json', {
      schemaVersion: 1,
      cases: [
        {
          caseId: 'c1',
          origin: 'real',
          category: 'matchable',
          acceptableVariantIds: ['v1'],
          requiredGapFields: [],
          split: 'eval',
          SECRET_FIELD_KEY: 'value',
        },
      ],
    });
    const dupIdCases = writeJsonFile(dir, 'secret-dup.json', {
      schemaVersion: 1,
      cases: [
        {
          caseId: 'SECRET_CASE_ID',
          origin: 'real',
          category: 'matchable',
          acceptableVariantIds: ['v1'],
          requiredGapFields: [],
          split: 'eval',
        },
        {
          caseId: 'SECRET_CASE_ID',
          origin: 'real',
          category: 'matchable',
          acceptableVariantIds: ['v2'],
          requiredGapFields: [],
          split: 'eval',
        },
      ],
    });

    const scenarios: string[][] = [
      // 非法 split
      [
        '--cases',
        badSplitCases.path,
        '--observations',
        validObs.path,
        '--output',
        join(dir, 'out-split.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
      // 未知字段
      [
        '--cases',
        unknownKeyCases.path,
        '--observations',
        validObs.path,
        '--output',
        join(dir, 'out-key.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
      // 重复 caseId
      [
        '--cases',
        dupIdCases.path,
        '--observations',
        validObs.path,
        '--output',
        join(dir, 'out-dup.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
      // IO 路径错误（不存在的文件路径包含 SECRET）
      [
        '--cases',
        join(dir, 'SECRET_MISSING_FILE.json'),
        '--observations',
        validObs.path,
        '--output',
        join(dir, 'out-io.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
      // 位置参数包含 SECRET
      [
        'SECRET_POSITIONAL_ARG',
        '--cases',
        validCases.path,
        '--observations',
        validObs.path,
        '--output',
        join(dir, 'out-pos.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
      ],
      // 未知参数包含 SECRET
      [
        '--cases',
        validCases.path,
        '--observations',
        validObs.path,
        '--output',
        join(dir, 'out-flag.json'),
        '--retrieval-version',
        'v1',
        '--model-version',
        'none',
        '--SECRET_UNKNOWN_FLAG',
        'val',
      ],
    ];

    for (const argv of scenarios) {
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];
      const code = runEvaluationCli(argv, {
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line),
      });
      expect(code).toBe(1);
      expect(stdoutLines).toEqual([]);
      expect(stderrLines.length).toBeGreaterThan(0);
      expect(stderrLines.join('\n')).not.toContain('SECRET');
    }
  });
});
