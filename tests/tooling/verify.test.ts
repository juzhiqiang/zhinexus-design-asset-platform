import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Run the real coordinator; replace only downloads/install/build at the process boundary.
function verify(args: string[] = [], extraEnv: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zhinexus-verify-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'caller'));
  copyFileSync(new URL('../../scripts/verify.ps1', import.meta.url), join(root, 'scripts/verify.ps1'));
  writeFileSync(join(root, '.node-version'), '26.13.0\n');
  writeFileSync(join(root, 'package.json'), '{"packageManager":"pnpm@12.18.0"}');
  writeFileSync(join(root, 'scripts/pnpm.ps1'), `
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PnpmArgs)
Add-Content -LiteralPath $env:VERIFY_TRACE -Value ($PnpmArgs -join ' ')
if ($PnpmArgs[0] -eq $env:VERIFY_FAIL) { exit 7 }
exit 0
`);
  writeFileSync(join(root, 'scripts/bootstrap.ps1'), `
$cache = Join-Path (Split-Path -Parent $PSScriptRoot) 'downloaded'
if (Test-Path -LiteralPath $cache) { $phase = 'cached' } else { $phase = 'fresh' }
Add-Content -LiteralPath $env:VERIFY_TRACE -Value $phase
if ($env:VERIFY_FAIL -eq 'bootstrap') { exit 7 }
New-Item -ItemType File -Path $cache -Force | Out-Null
`);
  writeFileSync(join(root, 'run.ps1'), `
$ErrorActionPreference = 'Stop'
try { & (Join-Path $PSScriptRoot 'scripts/verify.ps1') @args }
finally {
  @{ site = $env:NEXT_PUBLIC_SITE_URL; cwd = (Get-Location).Path } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'state.json')
}
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'run.ps1'), ...args], {
    cwd: join(root, 'caller'), encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, NEXT_PUBLIC_SITE_URL: '', VERIFY_FAIL: '', ...extraEnv, VERIFY_TRACE: join(root, 'trace.txt') },
  });
  const trace = existsSync(join(root, 'trace.txt')) ? readFileSync(join(root, 'trace.txt'), 'utf8').trim().split(/\r?\n/) : [];
  const state = JSON.parse(readFileSync(join(root, 'state.json'), 'utf8').replace(/^\uFEFF/, ''));
  return { root, result, trace, state };
}

describe.skipIf(process.platform !== 'win32')('PowerShell verification entry points', () => {
  it('runs the daily checks without a redundant final service build and restores the caller', () => {
    const { root, result, trace, state } = verify();
    expect(result.status, result.stderr).toBe(0);
    expect(trace).toEqual(['install --frozen-lockfile', 'verify:workspace', 'build', 'typecheck', 'test', 'test:browser']);
    expect(state).toEqual({ site: null, cwd: join(root, 'caller') });
  });

  it('stops on a failed task and restores a configured origin', () => {
    const { root, result, trace, state } = verify([], { VERIFY_FAIL: 'build', NEXT_PUBLIC_SITE_URL: 'https://caller.test' });
    expect(result.status).not.toBe(0);
    expect(trace).toEqual(['install --frozen-lockfile', 'verify:workspace', 'build']);
    expect(state).toEqual({ site: 'https://caller.test', cwd: join(root, 'caller') });
  });

  it.each(['', 'bootstrap'])('isolates the bootstrap mode and cleans up after failure=%s', failure => {
    const { root, result, trace, state } = verify(['-Bootstrap'], { VERIFY_FAIL: failure, NEXT_PUBLIC_SITE_URL: 'https://bootstrap-caller.test' });
    expect(result.status, result.stderr).toBe(failure ? 1 : 0);
    expect(trace).toEqual(failure ? ['fresh'] : ['fresh', 'cached']);
    expect(readdirSync(join(root, '.tools'))).toEqual([]);
    expect(state).toEqual({ site: 'https://bootstrap-caller.test', cwd: join(root, 'caller') });
  });
});
