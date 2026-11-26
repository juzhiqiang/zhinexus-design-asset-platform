import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type LocalCredentials = { postgresPassword?: unknown };

export function resolveLocalPlatformDatabaseUrl(
  root: string,
  environment: Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'PLATFORM_DATABASE_URL'>>,
): string | undefined {
  if (environment.PLATFORM_DATABASE_URL) return environment.PLATFORM_DATABASE_URL;
  if (environment.NODE_ENV === 'production') return undefined;

  let credentials: LocalCredentials;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, '.tools', 'g2-local', 'credentials.json'), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    credentials = parsed as LocalCredentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Local G2 credentials are invalid; restore them from a protected backup');
  }
  if (typeof credentials.postgresPassword !== 'string' || !credentials.postgresPassword) {
    throw new Error('Local G2 PostgreSQL credential is missing; restore it from a protected backup');
  }

  const url = new URL('postgresql://zhinexus@127.0.0.1:15432/zhinexus');
  url.password = credentials.postgresPassword;
  return url.toString();
}
