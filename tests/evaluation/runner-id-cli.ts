import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIdEvaluation } from './runner-id.js';

const FLAGS = ['cases', 'observations', 'output', 'mapping-version', 'runner-version'] as const;
type Flag = (typeof FLAGS)[number];
type Options = Record<Flag, string>;

const PARSE_ERROR = 'runner-id: invalid arguments; expected only --cases --observations --output --mapping-version --runner-version with one non-empty value each.\n';
const INPUT_ERROR = 'runner-id: cannot read or parse input; no report written.\n';
const OUTPUT_ERROR = 'runner-id: cannot write report or output path conflicts with input.\n';

function parseArgs(argv: string[]): Options | null {
  const found = new Map<Flag, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--') || !FLAGS.includes(token.slice(2) as Flag)) return null;
    const flag = token.slice(2) as Flag;
    if (found.has(flag)) return null;
    const value = argv[i + 1];
    if (value === undefined || value === '' || value.trim() === '' || value.startsWith('-')) return null;
    found.set(flag, value);
    i += 1;
  }
  if (found.size !== FLAGS.length) return null;
  return Object.fromEntries(found) as Options;
}

function identity(path: string): { real: string; key: string } | null {
  try {
    const real = realpathSync(resolve(path));
    const stat = statSync(real);
    return { real, key: `${stat.dev}:${stat.ino}` };
  } catch {
    return null;
  }
}

function sameFile(a: string, b: string): boolean {
  const left = identity(a);
  const right = identity(b);
  if (left && right) return left.real === right.real || left.key === right.key;
  return resolve(a) === resolve(b);
}

function readText(path: string): string {
  const bytes = readFileSync(path);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

export function runIdEvaluationCli(argv: string[]): number {
  const options = parseArgs(argv);
  if (!options) {
    process.stderr.write(PARSE_ERROR);
    return 2;
  }

  for (const input of [options.cases, options.observations]) {
    if (sameFile(options.output, input)) {
      process.stderr.write(OUTPUT_ERROR);
      return 2;
    }
  }

  let casesText: string;
  let observationsText: string;
  try {
    casesText = readText(options.cases);
    observationsText = readText(options.observations);
  } catch {
    process.stderr.write(INPUT_ERROR);
    return 2;
  }

  let report: ReturnType<typeof runIdEvaluation>;
  try {
    report = runIdEvaluation(casesText, observationsText, {
      mappingVersion: options['mapping-version'],
      runnerVersion: options['runner-version'],
    });
  } catch {
    process.stderr.write(INPUT_ERROR);
    return 2;
  }

  try {
    writeFileSync(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch {
    process.stderr.write(OUTPUT_ERROR);
    return 2;
  }

  const status = report.passed ? 'PASS' : 'FAIL';
  process.stdout.write(`runner-id: ${status} real=${report.real.totalCases} synthetic=${report.synthetic.totalCases} hardViolations=${report.real.hardViolationCases + report.synthetic.hardViolationCases}\n`);
  return report.passed ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  process.exitCode = runIdEvaluationCli(process.argv.slice(2));
}
