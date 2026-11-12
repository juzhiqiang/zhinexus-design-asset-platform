import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 复制样式入口到 dist，供消费者通过 `@company/charts-react/style.css` 导入。确保 LF 换行。 */
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
const css = await readFile(path.join(packageRoot, 'src/style.css'), 'utf8');
await writeFile(
  path.join(packageRoot, 'dist/style.css'),
  css.replace(/\r\n/g, '\n'),
  'utf8',
);
