import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 复制样式入口到 dist，供消费者通过 `@company/charts-react/style.css` 导入。 */
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
await copyFile(
  path.join(packageRoot, 'src/style.css'),
  path.join(packageRoot, 'dist/style.css'),
);
