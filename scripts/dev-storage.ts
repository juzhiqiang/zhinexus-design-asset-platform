import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';

const registry = 'http://127.0.0.1:14873';
function credentials(root: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(join(root, '.tools/g2-local/credentials.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Local G2 credentials are invalid; restore them from a protected backup');
  }
}

export function resolveLocalPlatformStorageEnvironment(root: string, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv | undefined {
  if (environment.NODE_ENV === 'production' || Object.keys(environment).some(key => key.startsWith('PLATFORM_S3_') && environment[key] !== undefined)) return undefined;
  const local = credentials(root);
  if (!local) return undefined;
  if (local.minioUser === undefined && local.minioPassword === undefined) return undefined;
  if (typeof local.minioUser !== 'string' || !local.minioUser || typeof local.minioPassword !== 'string' || !local.minioPassword) throw new Error('Local MinIO credentials are incomplete');
  return {
    PLATFORM_S3_ENDPOINT: 'http://127.0.0.1:19000',
    PLATFORM_S3_BUCKET: 'zhinexus-local-artifacts',
    PLATFORM_S3_REGION: 'us-east-1',
    PLATFORM_S3_ACCESS_KEY: local.minioUser,
    PLATFORM_S3_SECRET_KEY: local.minioPassword,
  };
}

/** Only called for the complete, generated local configuration, never explicit deployments. */
export async function ensureLocalArtifactBucket(environment: NodeJS.ProcessEnv): Promise<void> {
  const client = new S3Client({ endpoint: environment.PLATFORM_S3_ENDPOINT, region: environment.PLATFORM_S3_REGION, forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: environment.PLATFORM_S3_ACCESS_KEY!, secretAccessKey: environment.PLATFORM_S3_SECRET_KEY! } });
  try {
    await client.send(new CreateBucketCommand({ Bucket: environment.PLATFORM_S3_BUCKET }), { abortSignal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'BucketAlreadyOwnedByYou') throw new Error('Local MinIO bucket initialization failed; check local infrastructure and credentials');
  } finally { client.destroy(); }
}

export async function resolveLocalRegistryToken(root: string, environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (environment.PLATFORM_REGISTRY_TOKEN) return environment.PLATFORM_REGISTRY_TOKEN;
  if (environment.NODE_ENV === 'production' || (environment.PLATFORM_REGISTRY_ORIGIN && environment.PLATFORM_REGISTRY_ORIGIN !== registry)) return undefined;
  const local = credentials(root);
  if (!local) return undefined;
  if (typeof local.publisherPassword !== 'string' || !local.publisherPassword) throw new Error('Local registry publisher credential is missing');
  try {
    const response = await fetch(registry + '/-/user/org.couchdb.user:g2publisher', {
      method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from('g2publisher:' + local.publisherPassword).toString('base64') },
      body: JSON.stringify({ name: 'g2publisher', password: local.publisherPassword, type: 'user', roles: [], date: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error();
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('token' in result) || typeof result.token !== 'string' || !result.token || result.token.length > 16_384 || /\s/.test(result.token)) throw new Error();
    return result.token;
  } catch { throw new Error('Local registry authentication failed'); }
}
