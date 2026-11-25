import { expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';
it('exposes company login and rejects unsafe platform URLs without opening a browser', async () => {
  expect((await runCli(['--help'],'0.0.25')).stdout).toContain('juz login');
  const result = await runCli(['login','--api-url','http://169.254.169.254'],'0.0.25');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('公司登录');
});
