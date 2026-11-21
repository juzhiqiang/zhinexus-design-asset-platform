import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { previewConfigFromEnv, type PreviewConfig } from '@company/contracts/preview';
import { validateDeployment } from './verify-deployment.js';

type Check = { status: 'passed' | 'failed' | 'unconfigured'; errors: string[] };
export type ProductionPreflightReport = {
  schemaVersion: 1;
  template: Check;
  environment: Check;
  missingVariables: string[];
  previewMode: NonNullable<PreviewConfig['mode']> | null;
  pendingAcceptance: string[];
  productionAcceptance: false;
  exitCode: 0 | 1 | 2;
};

/** Offline preparation only: no discovery requests, login, deployment or secret persistence. */
export function productionPreflight(
  template: unknown, env?: Record<string, string | undefined>,
): ProductionPreflightReport {
  const report: ProductionPreflightReport = {
    schemaVersion: 1,
    template: { status: 'passed', errors: [] },
    environment: { status: 'unconfigured', errors: [] },
    missingVariables: [],
    previewMode: null,
    pendingAcceptance: [
      'company-oidc-login-revocation', 'production-dns-tls-browser-isolation',
      'production-images-secrets-least-privilege', 'monitoring-alert-delivery',
      'production-scale-backup-capacity', 'real-vue-react-business-pilots',
    ],
    productionAcceptance: false,
    exitCode: 2,
  };
  try { report.template.errors = validateDeployment(template); }
  catch { report.template.errors = ['Malformed deployment template']; }
  if (report.template.errors.length) {
    report.template.status = 'failed'; report.exitCode = 1; return report;
  }
  const required = [...new Set([...JSON.stringify(template).matchAll(/\$\{([A-Z][A-Z0-9_]*):\?[^}]+\}/g)]
    .map(match => match[1]!))].sort();
  report.missingVariables = required.filter(key => !env?.[key]?.trim());
  if (env === undefined || report.missingVariables.length) return report;
  try {
    report.environment.errors = validateDeployment(template, env);
    if (!report.environment.errors.length) report.previewMode = previewConfigFromEnv(env)?.mode ?? 'domain';
  } catch {
    report.environment.errors = ['Invalid deployment environment'];
  }
  report.environment.status = report.environment.errors.length ? 'failed' : 'passed';
  report.exitCode = report.environment.errors.length ? 1 : 0;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--environment')) throw new Error();
    const template = parse(await readFile(new URL('../infra/compose.production.yaml', import.meta.url), 'utf8'), { merge: true });
    const report = productionPreflight(template, args.includes('--environment') ? process.env : undefined);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.exitCode;
  } catch {
    console.error('Production preparation failed; check template and arguments. Environment values are not logged.');
    process.exitCode = 1;
  }
}
