import { mkdir, copyFile, appendFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const framework of ['vue', 'react']) await copyFile(`src/${framework}.mjs`, `dist/${framework}.mjs`);
await appendFile('build-count', 'build\n');
