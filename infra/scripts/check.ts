import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { S3Client, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readS3Object, withS3Deadline } from './s3-probe.js';
import { compose, credentials, endpoints, imageId, localDir, npm, versions, waitForReady, withLocalLock } from './local.js';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
let stage = 'preflight';
const runId = randomUUID().replaceAll('-', '');
const runDir = join(localDir, 'runs', runId);
const report: Record<string, unknown> = { runId, startedAt: new Date().toISOString(), scope: 'local-three-storage-probes', g2Ready: false };

async function main(): Promise<void> {
  if (!existsSync(join(localDir, 'credentials.json')) || !existsSync(join(localDir, 'images.json'))) throw new Error('Run infra:up first');
  let consumerDir: string | undefined;
  const config = credentials();
  const pgOptions = { host: '127.0.0.1', port: 15432, user: 'zhinexus', password: config.postgresPassword, database: 'zhinexus', connectionTimeoutMillis: 10_000, query_timeout: 15_000 };
  const s3 = new S3Client({ region: 'us-east-1', endpoint: endpoints.s3, forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: config.minioUser, secretAccessKey: config.minioPassword } });
  const database = async <T>(fn: (client: Client) => Promise<T>, name = 'zhinexus'): Promise<T> => {
    const client = new Client({ ...pgOptions, database: name });
    try { await client.connect(); return await fn(client); } finally { await client.end(); }
  };
  const bucket = 'g2-probes';
  const key = `${runId}/original.bin`;
  const bytes = randomBytes(256);
  const digest = sha256(bytes);
  const readObject = (objectKey: string) => readS3Object(s3, { Bucket: bucket, Key: objectKey });
  try {
    mkdirSync(runDir, { recursive: true });
    stage = 'readiness';
    compose(['ps', '--status', 'running', '--quiet']);
    await waitForReady();
    report.images = { postgres: versions.postgres.image, verdaccio: versions.verdaccio.image, minio: imageId(), minioSourceCommit: versions.minio.sourceCommit };

    stage = 'postgres-write';
    console.log('Checking PostgreSQL version, write/read and unique constraint...');
    await database(async client => {
      const version = (await client.query('SHOW server_version')).rows[0].server_version as string;
      assert.ok(version.startsWith(`${versions.postgres.version} `) || version === versions.postgres.version, 'PostgreSQL version mismatch');
      await client.query('CREATE TABLE IF NOT EXISTS g2_probe (id text PRIMARY KEY, payload text NOT NULL, digest text NOT NULL)');
      await client.query('INSERT INTO g2_probe VALUES ($1, $2, $3)', [runId, bytes.toString('base64'), digest]);
      await assert.rejects(client.query('INSERT INTO g2_probe VALUES ($1, $2, $3)', [runId, 'duplicate', digest]), (error: unknown) => (error as { code?: string }).code === '23505');
      assert.equal((await client.query('SELECT digest FROM g2_probe WHERE id=$1', [runId])).rows[0].digest, digest);
      report.postgresVersion = version;
    });
    const backup = compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'zhinexus', '-d', 'zhinexus', '--no-owner', '--no-privileges', '-t', 'public.g2_probe']);
    writeFileSync(join(runDir, 'postgres.sql'), backup);

    stage = 's3-write';
    console.log('Checking private S3 byte roundtrip...');
    try { await withS3Deadline(signal => s3.send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: signal })); } catch (error) {
      if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes((error as Error).name)) throw error;
    }
    await withS3Deadline(signal => s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/octet-stream' }), { abortSignal: signal }));
    assert.equal(sha256(await readObject(key)), digest);
    writeFileSync(join(runDir, 's3-backup.bin'), await readObject(key));
    const anonymousObject = await fetch(`${endpoints.s3}/${bucket}/${key}`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    assert.equal(anonymousObject.status, 403, 'S3 data must not be public');

    stage = 'registry-auth';
    const login = async (name: string, password: string): Promise<string> => {
      const response = await fetch(`${endpoints.registry}/-/user/org.couchdb.user:${name}`, {
        method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${name}:${password}`).toString('base64')}` }, signal: AbortSignal.timeout(10_000), redirect: 'error',
        body: JSON.stringify({ name, password, type: 'user', roles: [], date: new Date().toISOString() }),
      });
      assert.ok(response.ok, `Registry authentication failed (${response.status})`);
      const body = await response.json();
      assert.equal(typeof body.token, 'string', 'Registry did not return a token');
      return body.token;
    };
    const publisherToken = await login('g2publisher', config.publisherPassword);
    const readerToken = await login('g2reader', config.readerPassword);
    const npmrc = (name: string, token: string): string => {
      const file = join(runDir, `${name}.npmrc`);
      writeFileSync(file, `registry=${endpoints.registry}/\n//127.0.0.1:14873/:_authToken=${token}\naudit=false\nfund=false\nignore-scripts=true\n`, { mode: 0o600 });
      return file;
    };
    const publisherConfig = npmrc('publisher', publisherToken);
    const readerConfig = npmrc('reader', readerToken);
    const packageName = `@g2-probe/probe-${runId}`;
    const sourceDir = join(runDir, 'package');
    mkdirSync(sourceDir);
    writeFileSync(join(sourceDir, 'package.json'), `${JSON.stringify({ name: packageName, version: '1.0.0', description: 'Isolated G2 storage probe', files: ['README.md'] }, null, 2)}\n`);
    writeFileSync(join(sourceDir, 'README.md'), `Frozen probe ${runId}\n`);

    stage = 'registry-publish';
    console.log('Packing once, publishing a unique probe package and installing the exact version...');
    const packed = JSON.parse(npm(['pack', sourceDir, '--pack-destination', runDir, '--ignore-scripts', '--json'], runDir, publisherConfig));
    const tarball = join(runDir, packed[0].filename);
    const tarballDigest = sha256(readFileSync(tarball));
    npm(['publish', tarball, '--ignore-scripts', '--registry', endpoints.registry, '--access', 'restricted'], runDir, publisherConfig);
    const metadataUrl = `${endpoints.registry}/${encodeURIComponent(packageName)}/1.0.0`;
    const registryBytes = async (): Promise<Uint8Array> => {
      const response = await fetch(metadataUrl, { headers: { authorization: `Bearer ${readerToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200);
      const metadata = await response.json();
      const url = new URL(metadata.dist.tarball);
      assert.equal(url.origin, endpoints.registry, 'Do not send a registry token to another origin');
      assert.ok(!url.username && !url.password, 'Unexpected credentials in registry URL');
      const artifact = await fetch(url, { headers: { authorization: `Bearer ${readerToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      assert.equal(artifact.status, 200);
      return new Uint8Array(await artifact.arrayBuffer());
    };
    assert.equal(sha256(await registryBytes()), tarballDigest);
    const anonymousPackage = await fetch(metadataUrl, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    assert.ok([401, 403].includes(anonymousPackage.status), 'Registry private package must require authentication');
    // The original package remains untouched; the reader attempts a different new name.
    const denied = await fetch(`${endpoints.registry}/${encodeURIComponent(`@g2-probe/denied-${runId}`)}`, {
      method: 'PUT', headers: { authorization: `Bearer ${readerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: `@g2-probe/denied-${runId}`, versions: {} }), redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    assert.equal(denied.status, 403, 'Read-only registry account must not publish');
    // Bypass npm's local version precheck to exercise Verdaccio's actual 409 response.
    // The request contains the same frozen bytes, never an altered/repacked artifact.
    assert.throws(() => npm(['publish', tarball, '--ignore-scripts', '--registry', endpoints.registry, '--force', '--json'], runDir, publisherConfig), /E409/);
    assert.equal(sha256(await registryBytes()), tarballDigest, 'Republishing must not replace a frozen version');
    consumerDir = mkdtempSync(join(tmpdir(), 'zhinexus-g2-consumer-'));
    writeFileSync(join(consumerDir, 'package.json'), '{"name":"g2-consumer","version":"1.0.0","private":true}\n');
    npm(['install', `${packageName}@1.0.0`, '--ignore-scripts', '--no-audit', '--no-fund', '--registry', endpoints.registry], consumerDir, readerConfig);
    const installed = JSON.parse(readFileSync(join(consumerDir, 'node_modules', packageName, 'package.json'), 'utf8'));
    assert.equal(installed.version, '1.0.0');
    assert.equal(installed.name, packageName);

    stage = 'restart';
    console.log('Restarting only this Compose project, then verifying the same data...');
    compose(['restart', 'postgres', 'verdaccio', 'minio']);
    compose(['up', '-d', '--wait', '--wait-timeout', '90']);
    await waitForReady();
    await database(async client => {
      const row = (await client.query('SELECT payload, digest FROM g2_probe WHERE id=$1', [runId])).rows[0];
      assert.equal(row.digest, digest);
      assert.equal(sha256(Buffer.from(row.payload, 'base64')), digest);
    });
    assert.equal(sha256(await readObject(key)), digest);
    assert.equal(sha256(await registryBytes()), tarballDigest);

    stage = 'restore';
    console.log('Restoring probe backups into separate database/object targets...');
    const restoreDatabase = `g2_restore_${runId}`;
    await database(client => client.query(`CREATE DATABASE ${restoreDatabase}`));
    try {
      compose(['exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'zhinexus', '-d', restoreDatabase], { input: readFileSync(join(runDir, 'postgres.sql'), 'utf8') });
      await database(async client => {
        const row = (await client.query('SELECT payload, digest FROM g2_probe WHERE id=$1', [runId])).rows[0];
        assert.equal(row.digest, digest);
        assert.equal(sha256(Buffer.from(row.payload, 'base64')), digest);
      }, restoreDatabase);
    } finally {
      await database(client => client.query(`DROP DATABASE ${restoreDatabase}`));
    }
    await withS3Deadline(signal => s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${runId}/restored.bin`, Body: readFileSync(join(runDir, 's3-backup.bin')) }), { abortSignal: signal }));
    assert.equal(sha256(await readObject(`${runId}/restored.bin`)), digest);
    assert.equal(sha256(readFileSync(tarball)), tarballDigest, 'Candidate changed after verification');
    Object.assign(report, { status: 'passed', completedAt: new Date().toISOString(), packageName, packageVersion: '1.0.0', tarballSha256: tarballDigest, probeSha256: digest,
      checks: ['postgres-write-read-unique', 'private-s3-byte-roundtrip', 'registry-exact-install', 'registry-readonly-denied', 'registry-anonymous-denied', 'package-immutable', 'three-service-restart-persistence', 'postgres-isolated-restore', 's3-isolated-restore'],
      oidc: 'unconfigured', previewDomain: 'unconfigured' });
    writeFileSync(join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Local storage probes passed. Report: .tools/g2-local/runs/${runId}/report.json`);
  } finally {
    s3.destroy();
    if (consumerDir) rmSync(consumerDir, { recursive: true, force: true });
  }
}
withLocalLock(main).catch(error => {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'report.json'), `${JSON.stringify({ ...report, status: 'failed', stage, errorType: error instanceof Error ? error.name : 'unknown' }, null, 2)}\n`);
  console.error(`Infrastructure check failed at ${stage}; no readiness claimed. Report: .tools/g2-local/runs/${runId}/report.json`);
  process.exitCode = 1;
});
