import { describe, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';
import { buildServer } from '../../apps/api/src/app.js';
import { buildServer as buildPreviewServer } from '../../apps/preview-gateway/src/app.js';

describe('bootstrap entry points', () => {
  it('reports the supplied CLI version', () => {
    expect(runCli(['--version'], '0.0.0')).toEqual({ exitCode: 0, stdout: '0.0.0\n', stderr: '' });
  });
  it('does not pretend release or check are implemented', () => {
    for (const command of ['release', 'check', 'integrate', '--unknown']) {
      const result = runCli([command], '0.0.0');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('尚未实现');
    }
  });
  it('explains the bootstrap scope in help', () => {
    expect(runCli(['--help'], '0.0.0').stdout).toContain('工程骨架');
    expect(runCli([], '0.0.0').exitCode).toBe(0);
  });
  for (const [service, create] of [['api', buildServer], ['preview-gateway', buildPreviewServer]] as const) {
    it(`${service} exposes liveness without claiming production readiness`, async () => {
      const server = create();
      try {
        const response = await server.inject({ method: 'GET', url: '/healthz' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ status: 'ok', service, stage: 'bootstrap' });
        const missing = await server.inject({ method: 'POST', url: '/v1/releases', payload: {} });
        expect(missing.statusCode).toBe(404);
      } finally { await server.close(); }
    });
  }
});
