import { mkdir, writeFile } from 'node:fs/promises';
import { API_SCHEMAS, CONTRACT_SCHEMAS } from '@company/contracts';

const directory = new URL('../schemas/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries({ ...CONTRACT_SCHEMAS, ...API_SCHEMAS })) {
  const file = new URL(`${name}.schema.json`, directory);
  const json = `${JSON.stringify(schema, null, 2)}\n`;
  await writeFile(file, json, 'utf8');
}
console.log('Generated V1 contract schemas.');
