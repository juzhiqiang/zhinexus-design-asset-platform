import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

/** Read a secret without putting typed characters or readline's redraws on the terminal. */
export async function readSecret(label: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stderr): Promise<string> {
  const muted = new Writable({ write(_chunk, _encoding, complete) { complete(); } });
  const reader = createInterface({ input, output: muted, terminal: true, historySize: 0 });
  const cancelled = new AbortController();
  reader.once('SIGINT', () => cancelled.abort());
  reader.once('close', () => cancelled.abort());
  output.write(label + ': ');
  try { return await reader.question('', { signal: cancelled.signal }); }
  finally { reader.close(); muted.destroy(); output.write('\n'); }
}
