import { spawn } from 'node:child_process';
import { requirePlatformDatabaseUrlForMigration, resolveLocalPlatformDatabaseUrl } from './dev-environment.js';

function runPnpm(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const packageManager = process.env.npm_execpath;
    if (!packageManager) {
      console.error('Run this command through pnpm so the configured package manager can be reused');
      resolve(1);
      return;
    }
    const child = spawn(packageManager, args, {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', () => {
      console.error('Could not start the local development command');
      resolve(1);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

const mode = process.argv[2];
if (mode && mode !== 'migrate') {
  console.error('Expected no argument or migrate');
  process.exitCode = 2;
} else {
  try {
    const localUrl = resolveLocalPlatformDatabaseUrl(process.cwd(), process.env);
    if (localUrl) process.env.PLATFORM_DATABASE_URL = localUrl;
    else if (!process.env.PLATFORM_DATABASE_URL && process.env.NODE_ENV !== 'production') {
      if (mode === 'migrate') throw new Error('PLATFORM_DATABASE_URL is unset and local credentials are unavailable; restore .tools/g2-local credentials or configure the URL before migrating');
      console.warn('PLATFORM_DATABASE_URL is unset and local credentials are unavailable; restore .tools/g2-local credentials to enable the API database.');
    }

    if (mode === 'migrate') {
      process.env.PLATFORM_DATABASE_URL = requirePlatformDatabaseUrlForMigration(process.env);
      const buildStatus = await runPnpm(['build:services']);
      if (buildStatus !== 0) process.exitCode = buildStatus;
      else process.exitCode = await runPnpm(['--filter', '@company/platform-api', 'migrate']);
    } else {
      process.exitCode = await runPnpm(['exec', 'turbo', 'run', 'dev', '--concurrency=12', '--cache=local:rw']);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not load local platform configuration');
    process.exitCode = 1;
  }
}
