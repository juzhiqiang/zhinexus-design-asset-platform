import { expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareT17LocalServices, readT17CompatibilityEvidence } from '../t17-host/local-services.js';
import { evidenceArea, required, requiredDirectory, requiredFile, sha256 } from './support.mjs';

it('accepts unchanged historical real compatibility evidence only into a newly owned real service stack', async () => {
  const sdkBundle = await requiredDirectory('T17_D_SDK_BUNDLE'), file = await requiredFile('T17_D_COMPATIBILITY_EVIDENCE');
  const digest = required('T17_D_COMPATIBILITY_SHA256'), evidenceDirectory = await evidenceArea('t17-d-prerequisites-');
  const checked = await readT17CompatibilityEvidence({ file, sha256: digest }, sdkBundle);
  expect(checked.screenshotsChecked).toBe(56);
  const services = await prepareT17LocalServices({ sdkBundle, evidenceDirectory, compatibilityEvidence: { file, sha256: digest } });
  try {
    if (!services.acceptedCompatibilityFile) throw new Error('Real local compatibility records were not returned.');
    const accepted = JSON.parse(await readFile(services.acceptedCompatibilityFile, 'utf8')) as { records: Array<{ variantReleaseId: string; compatibilityId: string; status: string }> };
    expect(accepted.records).toHaveLength(14);
    expect(new Set(accepted.records.map(record => record.compatibilityId)).size).toBe(14);
    for (const record of accepted.records) {
      expect(record.status).toBe('passed');
      const response = await fetch(services.apiUrl + '/v1/me/variant-releases/' + record.variantReleaseId + '/compatibility', { headers: { authorization: 'Bearer ' + services.apiToken } });
      expect(response.status).toBe(200);
      const value = await response.json() as { items: Array<{ compatibilityId: string }> };
      expect(value.items.map(item => item.compatibilityId)).toContain(record.compatibilityId);
    }
    expect(sha256(await readFile(file))).toBe(digest);
    await writeFile(join(evidenceDirectory, 'prerequisites-receipt.json'), JSON.stringify({ result: 'passed', productionAcceptance: false, sdkManifestSha256: services.sdkManifestSha256,
      compatibilityEvidenceSha256: digest, acceptedCompatibilityFile: services.acceptedCompatibilityFile, realAcceptedRecords: accepted.records.length, historicalProbeScreenshotsChecked: 56, historicalProbeReplayed: true }, null, 2) + '\n');
  } finally { await services.close(); }
  await writeFile(join(evidenceDirectory, 'prerequisites-cleanup.json'), JSON.stringify({ servicesClosed: true, productionAcceptance: false }) + '\n');
}, 240_000);
