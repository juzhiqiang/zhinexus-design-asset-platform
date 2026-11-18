// tests/acceptance/t16-d/installed-report.mjs
import { reportFiles } from './installed-report-files.mjs';
import { reportVersions } from './installed-report-versions.mjs';

export async function report(ctx) {
  const { sourceAfter, backupAfter } = await reportFiles(ctx);
  await reportVersions(ctx);
  return { sourceAfter, backupAfter };
}
