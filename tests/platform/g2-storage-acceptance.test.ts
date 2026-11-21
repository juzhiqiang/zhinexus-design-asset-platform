import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Client } from 'pg';
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { it } from 'vitest';
import { createRecoveryStack } from '../../infra/scripts/recovery-stack.js';
import { npm, root, versions } from '../../infra/scripts/local.js';
import { readS3Object, withS3Deadline } from '../../infra/scripts/s3-probe.js';

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

it('records real G2 storage writes, exact consumption, denied permissions, process restarts and isolated restores', async () => {
  const stack = await createRecoveryStack();
  let cleanupAttempted = false;
  try {
    const directory = join(root, '.tools/operations/g2-acceptance', stack.id);
    mkdirSync(directory, { recursive: true });
    const report = {
      schemaVersion: 1, runId: stack.id, startedAt: new Date().toISOString(),
      scope: 'isolated-local-three-storage', g2Ready: false, productionAcceptance: false,
      status: 'running', completedAt: '', stage: 'postgres',
      services: {} as Record<string, unknown>,
      checks: [] as { service: string; name: string; measuredAt: string; result: unknown }[],
      pendingAcceptance: ['company-oidc-web-cli-login-roles-revocation', 'target-preview-dns-tls-grants-browser-isolation'],
      cleanup: 'pending', consumerCleanup: 'not-created',
    };
    const record = (service: string, name: string, result: unknown) => {
      report.checks.push({ service, name, measuredAt: new Date().toISOString(), result });
      console.log(JSON.stringify({ event: 'G2_STORAGE_CHECK', service, name, result }));
    };
    let consumer: string | undefined;
    const s3Client = () => new S3Client({ region: 'us-east-1', endpoint: `http://127.0.0.1:${stack.ports.minio}`, forcePathStyle: true,
      maxAttempts: 2, credentials: { accessKeyId: stack.secrets.minioUser, secretAccessKey: stack.secrets.minioPassword } });
    let s3 = s3Client();
    const database = async <T>(fn: (client: Client) => Promise<T>, name = 'zhinexus') => {
      const client = new Client({ host: '127.0.0.1', port: stack.ports.postgres, user: 'zhinexus',
        password: stack.secrets.postgresPassword, database: name, connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
      try { await client.connect(); return await fn(client); } finally { await client.end(); }
    };
    const bytes = randomBytes(256);
    const payloadDigest = digest(bytes);
    const bucket = 'g2-acceptance';
    const key = `${stack.id}/original.bin`;
    const readObject = (objectKey: string) => readS3Object(s3, { Bucket: bucket, Key: objectKey });
    const inspect = (service: 'postgres' | 'verdaccio' | 'minio') => JSON.parse(stack.docker(['inspect', stack.names[service]]))[0];
    try {
      for (const service of ['postgres', 'verdaccio', 'minio'] as const) {
        const info = inspect(service);
        report.services[service] = { container: stack.names[service], volume: stack.volumes[service], port: stack.ports[service],
          imageId: info.Image, configuredImage: info.Config.Image, startedAtBefore: info.State.StartedAt };
      }
      await database(async client => {
        const version = (await client.query('SHOW server_version')).rows[0].server_version as string;
        assert.ok(version === versions.postgres.version || version.startsWith(`${versions.postgres.version} `));
        await client.query('CREATE TABLE g2_probe (id text PRIMARY KEY, payload text NOT NULL, digest text NOT NULL)');
        await client.query('INSERT INTO g2_probe VALUES ($1, $2, $3)', [stack.id, bytes.toString('base64'), payloadDigest]);
        await assert.rejects(client.query('INSERT INTO g2_probe VALUES ($1, $2, $3)', [stack.id, 'duplicate', payloadDigest]),
          (error: unknown) => (error as { code?: string }).code === '23505');
        const row = (await client.query('SELECT payload, digest FROM g2_probe WHERE id=$1', [stack.id])).rows[0];
        assert.equal(row.digest, payloadDigest);
        assert.equal(digest(Buffer.from(row.payload, 'base64')), payloadDigest);
        record('postgres', 'real-write-read-and-unique-constraint', { version, payloadSha256: payloadDigest, duplicateSqlState: '23505' });
      });
      const backup = stack.docker(['exec', stack.names.postgres, 'pg_dump', '-U', 'zhinexus', '-d', 'zhinexus',
        '--no-owner', '--no-privileges', '-t', 'public.g2_probe']);
      writeFileSync(join(directory, 'postgres.sql'), backup);

      report.stage = 'minio';
      await withS3Deadline(signal => s3.send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: signal }));
      await withS3Deadline(signal => s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }), { abortSignal: signal }));
      const downloaded = await readObject(key);
      assert.deepEqual(Buffer.from(downloaded), bytes);
      assert.equal(digest(downloaded), payloadDigest);
      writeFileSync(join(directory, 'minio-backup.bin'), downloaded);
      const anonymous = await fetch(`http://127.0.0.1:${stack.ports.minio}/${bucket}/${key}`,
        { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      assert.equal(anonymous.status, 403);
      await anonymous.arrayBuffer();
      const minioVersion = stack.docker(['exec', stack.names.minio, '/minio', '--version']);
      assert.ok(minioVersion.includes(versions.minio.release) && minioVersion.includes(versions.minio.sourceCommit));
      record('minio', 'private-object-put-get-digest-and-anonymous-denial',
        { bytes: bytes.length, sha256: payloadDigest, anonymousStatus: anonymous.status, sourceCommit: versions.minio.sourceCommit, release: versions.minio.release });

      report.stage = 'verdaccio';
      let registry = `http://127.0.0.1:${stack.ports.verdaccio}`;
      const login = async (name: 'g2publisher' | 'g2reader', password: string) => {
        const response = await fetch(`${registry}/-/user/org.couchdb.user:${name}`, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${name}:${password}`).toString('base64')}` },
          body: JSON.stringify({ name, password, type: 'user', roles: [], date: new Date().toISOString() }) });
        assert.equal(response.status, 201);
        const token = (await response.json()).token;
        assert.equal(typeof token, 'string');
        return token as string;
      };
      const publisher = await login('g2publisher', stack.secrets.publisherPassword);
      const reader = await login('g2reader', stack.secrets.readerPassword);
      const npmrc = (name: string, token: string) => {
        const path = join(directory, `${name}.npmrc`);
        writeFileSync(path, `registry=${registry}/\n//127.0.0.1:${stack.ports.verdaccio}/:_authToken=${token}\nignore-scripts=true\naudit=false\nfund=false\n`, { mode: 0o600 });
        return path;
      };
      const publisherConfig = npmrc('publisher', publisher);
      const readerConfig = npmrc('reader', reader);
      // npm redacts hyphenated UUIDs even in its machine-readable pack output.
      const packageName = `@g2-probe/probe-${stack.id.replaceAll('-', '')}`;
      const source = join(directory, 'package');
      mkdirSync(source);
      const readme = `Frozen G2 probe ${stack.id}\n`;
      writeFileSync(join(source, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', files: ['README.md'] }));
      writeFileSync(join(source, 'README.md'), readme);
      const packed = JSON.parse(npm(['pack', source, '--pack-destination', directory, '--ignore-scripts', '--json'], directory, publisherConfig));
      const tarball = join(directory, packed[0].filename);
      const tarballDigest = digest(readFileSync(tarball));
      // Project .npmrc overrides user configuration; pin every registry operation explicitly.
      npm(['publish', tarball, '--ignore-scripts', '--registry', registry, '--access', 'restricted'], directory, publisherConfig);
      const metadataUrl = () => `${registry}/${encodeURIComponent(packageName)}/1.0.0`;
      const registryBytes = async () => {
        const response = await fetch(metadataUrl(), { headers: { authorization: `Bearer ${reader}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
        assert.equal(response.status, 200);
        const metadata = await response.json();
        const url = new URL(metadata.dist.tarball);
        assert.equal(url.origin, registry);
        assert.ok(!url.username && !url.password);
        const artifact = await fetch(url, { headers: { authorization: `Bearer ${reader}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
        assert.equal(artifact.status, 200);
        return Buffer.from(await artifact.arrayBuffer());
      };
      assert.equal(digest(await registryBytes()), tarballDigest);
      const anonymousPackage = await fetch(metadataUrl(), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      assert.ok([401, 403].includes(anonymousPackage.status));
      await anonymousPackage.arrayBuffer();
      const denied = await fetch(`${registry}/${encodeURIComponent(`@g2-probe/denied-${stack.id}`)}`, { method: 'PUT', redirect: 'error',
        signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${reader}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: `@g2-probe/denied-${stack.id}`, versions: {} }) });
      assert.equal(denied.status, 403);
      await denied.arrayBuffer();
      assert.throws(() => npm(['publish', tarball, '--ignore-scripts', '--registry', registry, '--force', '--json'], directory, publisherConfig), /E409/);
      assert.equal(digest(await registryBytes()), tarballDigest);
      record('verdaccio', 'publish-download-permissions-and-immutability', {
        packageName, version: '1.0.0', tarballSha256: tarballDigest,
        anonymousStatus: anonymousPackage.status, readerWriteStatus: denied.status, duplicatePublish: 'E409',
      });
      consumer = mkdtempSync(join(tmpdir(), 'zhinexus-g2-acceptance-consumer-'));
      report.consumerCleanup = 'pending';
      const consumerRelative = relative(root, consumer);
      assert.ok(isAbsolute(consumerRelative) || consumerRelative === '..' || consumerRelative.startsWith(`..${sep}`), 'Consumer must be outside the workspace');
      writeFileSync(join(consumer, 'package.json'), '{"name":"g2-consumer","version":"1.0.0","private":true}\n');
      npm(['install', `${packageName}@1.0.0`, '--ignore-scripts', '--registry', registry, '--no-audit', '--no-fund', '--cache', join(consumer, 'fresh-cache')], consumer, readerConfig);
      const installed = JSON.parse(readFileSync(join(consumer, 'node_modules', packageName, 'package.json'), 'utf8'));
      assert.equal(installed.name, packageName);
      assert.equal(installed.version, '1.0.0');
      assert.equal(readFileSync(join(consumer, 'node_modules', packageName, 'README.md'), 'utf8'), readme);
      const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8')).packages[`node_modules/${packageName}`];
      assert.equal(lock.integrity, `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`);
      record('verdaccio', 'exact-fresh-consumer-install', {
        packageName, version: installed.version, tarballSha256: tarballDigest, installedIntegrity: lock.integrity,
        freshCache: true,
      });

      report.stage = 'restart';
      for (const service of ['postgres', 'verdaccio', 'minio'] as const) stack.assertOwned(service);
      stack.docker(['restart', ...Object.values(stack.names)]);
      for (const service of ['postgres', 'verdaccio', 'minio'] as const) {
        const info = inspect(service);
        const identity = report.services[service] as { startedAtBefore: string; startedAtAfter?: string; portAfter?: number };
        assert.notEqual(info.State.StartedAt, identity.startedAtBefore);
        identity.startedAtAfter = info.State.StartedAt;
        const port = { postgres: 5432, verdaccio: 4873, minio: 9000 }[service];
        const binding = info.NetworkSettings.Ports[`${port}/tcp`][0];
        assert.equal(binding.HostIp, '127.0.0.1');
        stack.ports[service] = Number(binding.HostPort);
        identity.portAfter = stack.ports[service];
        assert.ok(info.Mounts.some((mount: { Name?: string }) => mount.Name === stack.volumes[service]));
      }
      // Docker may allocate new random host ports when these containers restart.
      registry = `http://127.0.0.1:${stack.ports.verdaccio}`;
      s3.destroy();
      s3 = s3Client();
      await stack.ready();
      await database(async client => {
        const row = (await client.query('SELECT payload, digest FROM g2_probe WHERE id=$1', [stack.id])).rows[0];
        assert.equal(row.digest, payloadDigest);
        assert.equal(digest(Buffer.from(row.payload, 'base64')), payloadDigest);
      });
      record('postgres', 'process-restart-persistence', { sha256: payloadDigest });
      assert.equal(digest(await readObject(key)), payloadDigest);
      record('minio', 'process-restart-persistence', { sha256: payloadDigest });
      assert.equal(digest(await registryBytes()), tarballDigest);
      record('verdaccio', 'process-restart-frozen-tarball-readable', { sha256: tarballDigest });

      report.stage = 'restore';
      const restoreDatabase = 'g2_restore';
      await database(client => client.query(`CREATE DATABASE ${restoreDatabase}`));
      stack.docker(['cp', join(directory, 'postgres.sql'), `${stack.names.postgres}:/tmp/g2-acceptance.sql`]);
      stack.docker(['exec', stack.names.postgres, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'zhinexus', '-d', restoreDatabase, '-f', '/tmp/g2-acceptance.sql']);
      await database(async client => {
        const row = (await client.query('SELECT payload, digest FROM g2_probe WHERE id=$1', [stack.id])).rows[0];
        assert.equal(row.digest, payloadDigest);
        assert.equal(digest(Buffer.from(row.payload, 'base64')), payloadDigest);
      }, restoreDatabase);
      record('postgres', 'backup-restore-to-separate-database', { database: restoreDatabase, backupSha256: digest(backup), payloadSha256: payloadDigest });
      const restoredKey = `${stack.id}/restored.bin`;
      const restoredBytes = readFileSync(join(directory, 'minio-backup.bin'));
      await withS3Deadline(signal => s3.send(new PutObjectCommand({ Bucket: bucket, Key: restoredKey, Body: restoredBytes }), { abortSignal: signal }));
      assert.equal(digest(await readObject(restoredKey)), payloadDigest);
      assert.equal(digest(await readObject(key)), payloadDigest);
      record('minio', 'backup-restore-to-separate-object', { originalKey: key, restoredKey, sha256: payloadDigest });
      assert.equal(digest(readFileSync(tarball)), tarballDigest);
      report.status = 'passed';
    } finally {
      s3.destroy();
      try {
        try {
          if (consumer) {
            assert.equal(dirname(resolve(consumer)), resolve(tmpdir()));
            assert.ok(basename(consumer).startsWith('zhinexus-g2-acceptance-consumer-'));
            rmSync(consumer, { recursive: true, force: true });
            assert.ok(!existsSync(consumer));
            report.consumerCleanup = 'removed';
          }
        } finally {
          // A busy consumer directory must not prevent cleanup of the owned stack.
          cleanupAttempted = true;
          await stack.close();
          assert.equal(stack.docker(['ps', '-a', '--filter', `label=org.zhinexus.recovery=${stack.id}`, '--format', '{{.Names}}']).trim(), '');
          assert.equal(stack.docker(['volume', 'ls', '--filter', `label=org.zhinexus.recovery=${stack.id}`, '--format', '{{.Name}}']).trim(), '');
          report.cleanup = 'owned-containers-and-volumes-removed';
        }
      } finally {
        if (report.status !== 'passed' || report.cleanup === 'pending' || report.consumerCleanup === 'pending') report.status = 'failed';
        report.completedAt = new Date().toISOString();
        writeFileSync(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify({ event: 'G2_STORAGE_REPORT', path: join(directory, 'report.json'), status: report.status, g2Ready: false }));
      }
    }
  } finally {
    // Report-directory or client initialization failures also release this stack.
    if (!cleanupAttempted) await stack.close();
  }
}, 180_000);
