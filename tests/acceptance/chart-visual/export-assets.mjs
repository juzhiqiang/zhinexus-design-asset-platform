// 将已收集的工作区 QA 页面截图裁为内部素材草案，不生成发布材料。
// Run after run.mjs: .\scripts\pnpm.ps1 exec node tests/acceptance/chart-visual/export-assets.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const summaryPath = 'docs/verification/component-visual-acceptance-2026-11-22/summary.json';
const summary = JSON.parse(await readFile(path.join(root, summaryPath), 'utf8'));
const destination = 'docs/acceptance/first-batch-assets-2026-11-22';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cells = summary.results.filter((cell) => cell.viewport.width === 1280 && cell.theme === 'light'
  && cell.renderer === 'canvas' && cell.state === 'default');
if (cells.length !== 14 || new Set(cells.map((cell) => `${cell.component}-${cell.framework}`)).size !== 14) {
  throw new Error('必须有 7 组件 × 2 框架的完整默认状态证据');
}
await mkdir(path.join(root, destination), { recursive: true });
const assets = [];
for (const cell of cells) {
  if (!cell.functionalPassed) throw new Error(`${cell.id} 功能检查未通过，不能生成素材`);
  const original = await readFile(path.join(root, cell.screenshot.path));
  if (sha256(original) !== cell.screenshot.sha256) throw new Error(`${cell.id} 原始截图摘要不一致`);
  const source = PNG.sync.read(original);
  const bounds = cell.layout.host;
  const crop = { x: Math.max(0, Math.floor(bounds.x) - 1), y: Math.max(0, Math.floor(bounds.y) - 1),
    width: Math.ceil(bounds.width) + 2, height: Math.ceil(bounds.height) + 2 };
  if (crop.x + crop.width > source.width || crop.y + crop.height > source.height) throw new Error(`${cell.id} 图表超出原始截图`);
  const output = new PNG({ width: crop.width, height: crop.height });
  PNG.bitblt(source, output, crop.x, crop.y, crop.width, crop.height, 0, 0);
  const bytes = PNG.sync.write(output);
  const file = `${destination}/${cell.component}-${cell.framework}.png`;
  await writeFile(path.join(root, file), bytes);
  const packageName = `@company/charts-${cell.framework}`;
  const packageMetadata = JSON.parse(await readFile(path.join(root, `packages/charts-${cell.framework}/package.json`), 'utf8'));
  assets.push({ component: cell.component, framework: cell.framework, packageName, packageVersion: packageMetadata.version,
    image: { path: file, sha256: sha256(bytes), bytes: bytes.length },
    source: { caseId: cell.id, path: cell.screenshot.path, sha256: cell.screenshot.sha256, crop } });
}
await writeFile(path.join(root, destination, 'index.json'), JSON.stringify({ status: 'draft-unpublished',
  evidenceKind: 'workspace-qa-crop', baseline: summary.baseline, summaryPath, assets }, null, 2) + '\n');
console.log(`14 张 QA 素材草案已导出；原始截图摘要全部核对一致。`);
