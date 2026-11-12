import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { validateDeployment } from '../../scripts/verify-deployment.js';
import { retentionPolicy } from '../../apps/api/dist/operations/retention.js';

it('accepts the reviewed template but rejects floating images, exposed storage and inline secrets', async () => {
  const template = parse(await readFile('infra/compose.production.yaml','utf8'),{merge:true});
  expect(validateDeployment(template)).toEqual([]);
  for (const change of [(x:any)=>x.services.api.image='api:latest', (x:any)=>x.services.postgres.ports=['5432:5432'],
    (x:any)=>x.services.api.environment.PLATFORM_DATABASE_URL='postgres://secret', (x:any)=>x.services.worker.command=['npm','install'],
    (x:any)=>x.services.api.read_only=false, (x:any)=>x.services.api.user='0:0', (x:any)=>x.services.api.volumes=['/tmp:/app'],
    (x:any)=>x.services.api.tmpfs=['/app'], (x:any)=>x.services.postgres.networks=['edge']]) {
    const invalid = structuredClone(template); change(invalid); expect(validateDeployment(invalid).length).toBeGreaterThan(0);
  }
  expect(validateDeployment(template,{}).length).toBeGreaterThan(0);
});
it('uses configurable bounded retention with 24 hour uploads and 30 day failed candidate defaults', () => {
  expect(retentionPolicy({})).toEqual({uploadHours:24,failedDays:30});
  expect(retentionPolicy({PLATFORM_UPLOAD_RETENTION_HOURS:'48',PLATFORM_FAILED_RETENTION_DAYS:'60'})).toEqual({uploadHours:48,failedDays:60});
  for (const value of ['-1','NaN','1.5','0','999999']) expect(()=>retentionPolicy({PLATFORM_UPLOAD_RETENTION_HOURS:value})).toThrow();
});
