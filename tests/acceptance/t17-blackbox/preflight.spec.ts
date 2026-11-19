import { afterEach, describe, expect, it } from 'vitest';
import { required, requiredFile } from './support.mjs';

const originalTarball = process.env.T17_D_CLI_TARBALL;
afterEach(() => {
  if (originalTarball === undefined) delete process.env.T17_D_CLI_TARBALL;
  else process.env.T17_D_CLI_TARBALL = originalTarball;
});

describe('T17 frozen-input preflight', () => {
  it('fails with an explicit error when the frozen CLI tarball is missing', () => {
    delete process.env.T17_D_CLI_TARBALL;

    expect(() => required('T17_D_CLI_TARBALL')).toThrow(/缺少必需环境变量 T17_D_CLI_TARBALL/);
  });

  it('rejects a relative tarball path before attempting installation', async () => {
    process.env.T17_D_CLI_TARBALL = 'artifacts/component-cli.tgz';

    await expect(requiredFile('T17_D_CLI_TARBALL')).rejects.toThrow(/必须是绝对路径/);
  });
});
