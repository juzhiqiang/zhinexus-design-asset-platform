import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { prepareT17LocalServices } from './local-services.js';

it('fresh isolated API credentials cover the full two-hour matrix budget with bounded cleanup margin', async () => {
  const sdkBundle = process.env.A10_FROZEN_BUNDLE;
  const evidenceParent = process.env.T17_TOKEN_BUDGET_EVIDENCE;
  if (!sdkBundle || !evidenceParent) throw new Error('Frozen SDK and external evidence paths are required.');
  const evidenceDirectory = await mkdtemp(join(evidenceParent, 'token-budget-'));
  const services = await prepareT17LocalServices({ sdkBundle, evidenceDirectory });
  try {
    const observedAt = Math.floor(Date.now() / 1000);
    // prepare already used this signed bearer against the real API to reach READY. Never persist it.
    const payload = JSON.parse(Buffer.from(services.apiToken.split('.')[1]!, 'base64url').toString('utf8')) as { iat: number; exp: number };
    const remainingSeconds = payload.exp - observedAt;
    await writeFile(join(evidenceDirectory, 'lifetime-observed.json'), JSON.stringify({
      schemaVersion: 1, productionAcceptance: false, matrixBudgetSeconds: 7200, remainingSeconds,
      issuedLifetimeSeconds: payload.exp - payload.iat,
    }, null, 2) + '\n', { flag: 'wx' });
    expect(Number.isSafeInteger(payload.iat) && Number.isSafeInteger(payload.exp)).toBe(true);
    expect(remainingSeconds).toBeGreaterThanOrEqual(7200 + 900);
    expect(remainingSeconds).toBeLessThanOrEqual(10800);
  } finally {
    await services.close();
  }
}, 240_000);
