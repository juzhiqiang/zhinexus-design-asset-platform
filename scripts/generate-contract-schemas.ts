import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { API_SCHEMAS, CONTRACT_SCHEMAS } from '@company/contracts';

const directory = new URL('../packages/contracts/schemas/', import.meta.url);
const check = process.argv.includes('--check');
if (!check) await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries({ ...CONTRACT_SCHEMAS, ...API_SCHEMAS })) {
  const file = new URL(`${name}.schema.json`, directory);
  const json = `${JSON.stringify(schema, null, 2)}\n`;
  if (check) {
    if (await readFile(file, 'utf8') !== json) throw new Error(`Schema drift: ${name}`);
  } else await writeFile(file, json, 'utf8');
}
console.log(check ? 'Contract schemas match runtime definitions.' : 'Generated V1 contract schemas.');
