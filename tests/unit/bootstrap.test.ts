import { describe, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { buildServer } from '../../apps/api/dist/app.js';
import { buildServer as buildPreviewServer } from '../../apps/preview-gateway/dist/app.js';

describe('bootstrap entry points', () => {
  it('reports the supplied CLI version', async () => {
    expect(await runCli(['--version'], '0.0.0')).toEqual({ exitCode: 0, stdout: '0.0.0\n', stderr: '' });
  });
  it('does not pretend release or future commands are implemented', async () => {
    for (const command of ['release', 'init', 'dev', 'integrate', '--unknown']) {
      const result = await runCli([command], '0.0.0');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('尚未实现');
    }
  });
  it('explains the bootstrap scope in help', async () => {
    expect((await runCli(['--help'], '0.0.0')).stdout).toContain('工程骨架');
    expect((await runCli([], '0.0.0')).exitCode).toBe(0);
  });
  for (const [service, create] of [['api', buildServer], ['preview-gateway', buildPreviewServer]] as const) {
    it(`${service} exposes liveness without claiming production readiness`, async () => {
      const server = await create();
      try {
        await server.listen(0, '127.0.0.1');
        const origin = await server.getUrl();
        const response = await fetch(`${origin}/healthz`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok', service, stage: 'bootstrap' });
        const missing = await fetch(`${origin}/v1/releases`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        expect(missing.status).toBe(service === 'api' ? 401 : 404);
      } finally { await server.close(); }
    });
  }
});
