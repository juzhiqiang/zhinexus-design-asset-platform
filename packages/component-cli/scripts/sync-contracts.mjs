import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsSrcDir = path.resolve(__dirname, '../../contracts/src');
const targetContractsDir = path.resolve(__dirname, '../src/contracts');

if (!fs.existsSync(targetContractsDir)) {
  fs.mkdirSync(targetContractsDir, { recursive: true });
}

const filesToSync = [
  'schema.ts',
  'schemas.ts',
  'validation.ts',
  'errors.ts',
  'reports.ts',
  'release-manifest.ts',
  'examples.ts',
  'digests.ts',
  'bundle.ts',
  'api.ts',
  'index.ts',
];

for (const file of filesToSync) {
  const sourceFile = path.join(contractsSrcDir, file);
  const targetFile = path.join(targetContractsDir, file);
  if (fs.existsSync(sourceFile)) {
    const content = fs.readFileSync(sourceFile, 'utf8');
    fs.writeFileSync(targetFile, content, 'utf8');
  }
}

console.log('Contracts successfully synchronized into packages/component-cli/src/contracts');

