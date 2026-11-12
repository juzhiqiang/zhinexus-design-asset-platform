import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { versions } from './local.js';
import type { RecoveryStack } from './recovery-stack.js';
import { checkConsistency } from './consistency.js';

const files = ['postgres.dump','verdaccio.tar','minio.tar'] as const;
type BackupManifest = { version:1; sourceId:string; createdAt:string; files:Record<typeof files[number],{bytes:number;sha256:string}> };
export function validateBackupManifest(input: unknown): BackupManifest {
  const value = input as BackupManifest;
  if (!value || value.version!==1 || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.sourceId) || !Number.isFinite(Date.parse(value.createdAt)) ||
    !value.files || Object.keys(value.files).length!==3 || files.some(file => {
      const ref = value.files[file]; return !ref || !Number.isSafeInteger(ref.bytes) || ref.bytes<=0 || !/^[a-f0-9]{64}$/.test(ref.sha256);
    })) throw new Error('Invalid backup manifest');
  return value;
}
async function fileDigest(path: string) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Backup must use regular files');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
  return {bytes:info.size,sha256:hash.digest('hex')};
}
export async function verifyBackup(directory: string): Promise<BackupManifest> {
  const dir = await realpath(directory);
  const meta = await lstat(join(dir,'manifest.json')); if (!meta.isFile() || meta.isSymbolicLink() || meta.size>16_384) throw new Error('Invalid backup manifest file');
  const manifest = validateBackupManifest(JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')));
  for (const file of files) {
    if (dirname(await realpath(join(dir,file))) !== dir) throw new Error('Backup path escaped its directory');
    const actual = await fileDigest(join(dir,file)); const expected = manifest.files[file];
    if (actual.bytes!==expected.bytes || actual.sha256!==expected.sha256) throw new Error('Backup archive checksum mismatch');
  }
  return manifest;
}
function volumeArchive(stack: RecoveryStack, service: 'verdaccio'|'minio', dir: string, restore: boolean): void {
  stack.assertOwned(service,true);
  stack.docker(['run','--rm','--network','none','--security-opt','no-new-privileges:true',
    '--mount',`type=volume,src=${stack.volumes[service]},dst=/data${restore?'':',readonly'}`,
    '--mount',`type=bind,src=${resolve(dir)},dst=/backup${restore?',readonly':''}`,
    '--entrypoint','tar',versions.postgres.image,'-C','/data',restore?'-xf':'-cf',`/backup/${service}.tar`,...(restore?[]:['.'])]);
}
export async function backupStack(stack: RecoveryStack, directory: string): Promise<BackupManifest> {
  // The source owns no API/worker containers. Its caller must close all seed clients before invoking this tool.
  await stack.clients(async ({db}) => {
    if ((await db.query("SELECT 1 FROM release_jobs WHERE state NOT IN ('READY','REJECTED','CONFLICT') LIMIT 1")).rowCount) throw new Error('Drain release work before backup');
  });
  await mkdir(directory,{recursive:false});
  stack.assertOwned('postgres');
  stack.stopData();
  try {
    stack.docker(['exec',stack.names.postgres,'pg_dump','-U','zhinexus','-d','zhinexus','-Fc','--no-owner','--no-acl','-f','/tmp/recovery.dump']);
    stack.docker(['cp',`${stack.names.postgres}:/tmp/recovery.dump`,join(resolve(directory),'postgres.dump')]);
    for (const service of ['verdaccio','minio'] as const) volumeArchive(stack,service,directory,false);
    const manifest: BackupManifest = {version:1,sourceId:stack.id,createdAt:new Date().toISOString(),files:{} as BackupManifest['files']};
    for (const file of files) manifest.files[file] = await fileDigest(join(directory,file));
    await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
    return await verifyBackup(directory);
  } finally { await stack.startData(); }
}
export async function restoreStack(stack: RecoveryStack, directory: string) {
  const manifest = await verifyBackup(directory);
  if (manifest.sourceId === stack.id || stack.restored) throw new Error('Restore requires a new isolated target');
  await stack.clients(async ({db,store}) => {
    if ((await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1")).rowCount ||
      (await store.client.send(new ListBucketsCommand({}))).Buckets?.length) throw new Error('Restore target is not empty');
  });
  stack.assertOwned('verdaccio',true);
  const registryFiles = stack.docker(['run','--rm','--network','none','--mount',`type=volume,src=${stack.volumes.verdaccio},dst=/data,readonly`,
    '--entrypoint','find',versions.postgres.image,'/data','-mindepth','1','-maxdepth','1']).trim().split('\n').filter(Boolean);
  if (registryFiles.some(file => file.trim()!=='/data/.verdaccio-db.json')) throw new Error('Restore registry target is not empty');
  stack.restored = true; // Failed restoration may only be retried in another new target.
  stack.stopData();
  try {
    for (const service of ['verdaccio','minio'] as const) volumeArchive(stack,service,directory,true);
    stack.assertOwned('postgres');
    stack.docker(['cp',join(resolve(directory),'postgres.dump'),`${stack.names.postgres}:/tmp/recovery.dump`]);
    stack.docker(['exec',stack.names.postgres,'pg_restore','-U','zhinexus','-d','zhinexus','--no-owner','--no-acl','--exit-on-error','--single-transaction','/tmp/recovery.dump']);
  } finally { await stack.startData(); }
  return stack.clients(async c => checkConsistency(c.db,c.store,c.registry));
}
