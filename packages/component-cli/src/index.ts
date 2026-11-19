#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli.js';

export * from './cli.js';
export * from './local/digest.js';
export * from './local/pack.js';
export * from './local/freeze.js';
export * from './local/consumer.js';
export * from './local/environment.js';
export * from './local/report.js';
export * from './local/compare.js';
export * from './local/capture.js';
export * from './local/manifest.js';
export * from './commands/check.js';
export * from './commands/baseline.js';
export * from './commands/integrate.js';
export * from './integration/inspect.js';
export * from './integration/locks.js';
export * from './integration/resolve.js';
export * from './integration/registry.js';
export * from './integration/plan.js';
export * from './integration/workspace.js';
export * from './integration/bindings.js';
export * from './integration/patch.js';
export * from './integration/backup.js';
export * from './integration/generate-vue.js';
export * from './integration/generate-react.js';
export * from './integration/install.js';
export * from './integration/apply.js';
export {
  assertArtifactRootOutsideProject,
  buildVerificationReport,
  canonicalDigest,
  createRunArtifactSession,
  sanitizeDiagnosticText,
  verificationIssue,
  type RunArtifactSession,
} from './integration/report.js';
export { verifyIntegration, type VerifyIntegrationOptions } from './integration/verify.js';
export { repairIntegration, type RepairIntegrationOptions } from './integration/repair.js';

const isDirectRun =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith('component') ||
    process.argv[1].endsWith('index.js'));

if (isDirectRun) {
  const pkg: { version: string } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const result = await runCli(process.argv.slice(2), pkg.version);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
