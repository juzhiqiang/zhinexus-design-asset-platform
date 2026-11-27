import { PassThrough, Writable } from 'node:stream';
import { expect, it } from 'vitest';
import { readSecret } from '../../packages/component-cli/src/terminal.js';

it('accepts a secret with editing while writing neither the secret nor redraws', async () => {
  const input = new PassThrough(); let rendered = '';
  const output = new Writable({ write(chunk, _encoding, complete) { rendered += chunk.toString(); complete(); } });
  const answer = readSecret('密码', input, output);
  input.write('secretX\x7f123\r');
  expect(await answer).toBe('secret123');
  expect(rendered).toBe('密码: \n');
  input.destroy(); output.destroy();
});

it('cancels a secret prompt on Ctrl+C and releases the input', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  const answer = readSecret('密码', input, output);
  input.write('\x03');
  await expect(answer).rejects.toThrow();
  input.destroy(); output.destroy();
});
