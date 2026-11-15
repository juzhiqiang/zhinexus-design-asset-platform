import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EvaluationInputError,
  scoreEvaluation,
  type EvaluationCase,
  type EvaluationObservation,
  type EvaluationScoreReport,
} from './scoring.js';

const CASE_KEYS = new Set([
  'caseId',
  'origin',
  'category',
  'acceptableVariantIds',
  'requiredGapFields',
  'split',
]);
const OBSERVATION_KEYS = new Set([
  'caseId',
  'top5VariantIds',
  'gapFields',
  'hardViolations',
]);
const CASES_FILE_KEYS = new Set(['schemaVersion', 'cases']);
const OBSERVATIONS_FILE_KEYS = new Set(['schemaVersion', 'observations']);

const REQUIRED_FLAGS = [
  '--cases',
  '--observations',
  '--output',
  '--retrieval-version',
  '--model-version',
] as const;

type FlagName = (typeof REQUIRED_FLAGS)[number];

export type EvaluationRunnerArgs = {
  casesPath: string;
  observationsPath: string;
  outputPath: string;
  retrievalVersion: string;
  modelVersion: string;
};

export type EvaluationReport = {
  schemaVersion: 1;
  inputs: {
    casesSha256: string;
    observationsSha256: string;
  };
  versions: {
    retrievalVersion: string;
    modelVersion: string;
  };
  generatedAt: string;
  score: EvaluationScoreReport;
};

export type RunnerDeps = {
  now?: () => Date;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvaluationInputError(`${label} 必须为普通对象`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new EvaluationInputError(`${label} 包含未知字段: ${key}`);
    }
  }
}

export function parseRunnerArgs(argv: string[]): EvaluationRunnerArgs {
  const seen = new Map<FlagName, string>();
  const validFlagSet = new Set<string>(REQUIRED_FLAGS);

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      throw new EvaluationInputError(`不支持的位置参数: ${token}`);
    }

    const eqIndex = token.indexOf('=');
    let flag: string;
    let value: string | undefined;

    if (eqIndex !== -1) {
      flag = token.slice(0, eqIndex);
      value = token.slice(eqIndex + 1);
    } else {
      flag = token;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new EvaluationInputError(`参数 ${flag} 缺少取值`);
      }
      value = next;
      i += 1;
    }

    if (!validFlagSet.has(flag)) {
      throw new EvaluationInputError(`未知参数: ${flag}`);
    }
    const typedFlag = flag as FlagName;
    if (seen.has(typedFlag)) {
      throw new EvaluationInputError(`重复参数: ${flag}`);
    }
    if (value.trim().length === 0) {
      throw new EvaluationInputError(`参数 ${flag} 不能为空`);
    }
    seen.set(typedFlag, value);
  }

  for (const flag of REQUIRED_FLAGS) {
    if (!seen.has(flag)) {
      throw new EvaluationInputError(`缺少必填参数: ${flag}`);
    }
  }

  return {
    casesPath: seen.get('--cases')!,
    observationsPath: seen.get('--observations')!,
    outputPath: seen.get('--output')!,
    retrievalVersion: seen.get('--retrieval-version')!,
    modelVersion: seen.get('--model-version')!,
  };
}

function readJsonWithSha256(filePath: string, label: string): { data: unknown; sha256: string } {
  const rawBytes = readFileSync(filePath);
  const sha256 = createHash('sha256').update(rawBytes).digest('hex');
  try {
    const data: unknown = JSON.parse(rawBytes.toString('utf8'));
    return { data, sha256 };
  } catch {
    throw new EvaluationInputError(`${label} 不是合法 JSON`);
  }
}

function parseCasesPayload(data: unknown): EvaluationCase[] {
  const root = assertPlainObject(data, 'cases 文件');
  assertAllowedKeys(root, CASES_FILE_KEYS, 'cases 文件');
  if (root.schemaVersion !== 1) {
    throw new EvaluationInputError(`cases 文件 schemaVersion 必须为 1，收到 ${String(root.schemaVersion)}`);
  }
  if (!Array.isArray(root.cases)) {
    throw new EvaluationInputError('cases 文件的 cases 字段必须为数组');
  }

  return root.cases.map((item, idx) => {
    const entry = assertPlainObject(item, `cases[${idx}]`);
    assertAllowedKeys(entry, CASE_KEYS, `cases[${idx}]`);
    if (entry.split !== 'eval') {
      throw new EvaluationInputError(`cases[${idx}].split 必须为 'eval'，收到 ${String(entry.split)}`);
    }
    return {
      caseId: entry.caseId as EvaluationCase['caseId'],
      origin: entry.origin as EvaluationCase['origin'],
      category: entry.category as EvaluationCase['category'],
      acceptableVariantIds: entry.acceptableVariantIds as EvaluationCase['acceptableVariantIds'],
      requiredGapFields: entry.requiredGapFields as EvaluationCase['requiredGapFields'],
    };
  });
}

function parseObservationsPayload(data: unknown): EvaluationObservation[] {
  const root = assertPlainObject(data, 'observations 文件');
  assertAllowedKeys(root, OBSERVATIONS_FILE_KEYS, 'observations 文件');
  if (root.schemaVersion !== 1) {
    throw new EvaluationInputError(
      `observations 文件 schemaVersion 必须为 1，收到 ${String(root.schemaVersion)}`,
    );
  }
  if (!Array.isArray(root.observations)) {
    throw new EvaluationInputError('observations 文件的 observations 字段必须为数组');
  }

  return root.observations.map((item, idx) => {
    const entry = assertPlainObject(item, `observations[${idx}]`);
    assertAllowedKeys(entry, OBSERVATION_KEYS, `observations[${idx}]`);
    return {
      caseId: entry.caseId as EvaluationObservation['caseId'],
      top5VariantIds: entry.top5VariantIds as EvaluationObservation['top5VariantIds'],
      gapFields: entry.gapFields as EvaluationObservation['gapFields'],
      hardViolations: entry.hardViolations as EvaluationObservation['hardViolations'],
    };
  });
}

export function runEvaluationCli(argv: string[], deps: RunnerDeps = {}): number {
  const now = deps.now ?? (() => new Date());
  const stdout = deps.stdout ?? ((line: string) => console.log(line));
  const stderr = deps.stderr ?? ((line: string) => console.error(line));

  try {
    const args = parseRunnerArgs(argv);
    const resolvedOut = resolve(args.outputPath);
    if (resolvedOut === resolve(args.casesPath) || resolvedOut === resolve(args.observationsPath)) {
      throw new EvaluationInputError('输出路径不得与输入文件相同');
    }

    const casesFile = readJsonWithSha256(args.casesPath, 'cases 文件');
    const obsFile = readJsonWithSha256(args.observationsPath, 'observations 文件');

    const cases = parseCasesPayload(casesFile.data);
    const observations = parseObservationsPayload(obsFile.data);
    const score = scoreEvaluation(cases, observations);

    const report: EvaluationReport = {
      schemaVersion: 1,
      inputs: {
        casesSha256: casesFile.sha256,
        observationsSha256: obsFile.sha256,
      },
      versions: {
        retrievalVersion: args.retrievalVersion,
        modelVersion: args.modelVersion,
      },
      generatedAt: now().toISOString(),
      score,
    };

    writeFileSync(args.outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
      encoding: 'utf8',
    });

    stdout(
      `evaluation completed: passed=${String(score.passed)} real=${score.real.totalCases} synthetic=${score.synthetic.totalCases}`,
    );
    return score.passed ? 0 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知执行错误';
    stderr(`evaluation failed: ${message}`);
    return 1;
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  process.exitCode = runEvaluationCli(process.argv.slice(2));
}
