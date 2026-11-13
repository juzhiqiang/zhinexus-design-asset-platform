import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * charts-vue 构建：清理 dist → vue-tsc 发射声明（含 .vue 的 DefineComponent）→ vite 发射 ESM
 * → 复制样式入口。直接调用编译器，不经过 Turbo，避免递归。
 */
const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

// 清理旧产物：避免哈希 chunk 残留（含历史构建机路径）进入 tarball
await rm(path.join(packageRoot, 'dist'), { recursive: true, force: true });

/**
 * 规范化声明文件里的裸 `.vue` 再导出说明符。
 *
 * vue-tsc 会把 `export { default as LineChart } from './LineChart.vue'` 原样写进
 * `dist/*.d.ts`，而旁边真实的声明文件叫 `LineChart.vue.d.ts`。仓库与多数消费者用
 * `moduleResolution: 'Bundler'`，TS 能把 `./LineChart.vue` 解析过去，缺陷因此不可见；
 * 但 `moduleResolution: 'NodeNext'` + `skipLibCheck: false` 的消费者会报
 * `TS2307: Cannot find module './LineChart.vue'`（9 处，覆盖根入口与全部子路径）。
 *
 * 把 `./X.vue` 改写成 `./X.vue.js`：NodeNext 与 Bundler 都会把 `.js` 说明符映射到
 * `X.vue.d.ts`，两种解析模式都通。只碰声明文件，不影响 vite 产出的运行时 chunk
 * （那里已经是哈希文件名，从不出现裸 `.vue` 说明符）。
 *
 * 回归护栏：`tests/unit/charts-vue-declarations.test.ts`。
 */
const BARE_VUE_SPECIFIER = /(from\s+')(\.\/[A-Za-z0-9_-]+\.vue)(')/g;

function normalizeDeclarationSpecifiers(source) {
  return source.replace(BARE_VUE_SPECIFIER, '$1$2.js$3');
}

async function normalizeDistDeclarationSpecifiers(dist) {
  const entries = await readdir(dist);
  let rewritten = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.d.ts')) {
      continue;
    }
    const file = path.join(dist, entry);
    const before = await readFile(file, 'utf8');
    const after = normalizeDeclarationSpecifiers(before);
    if (after !== before) {
      await writeFile(file, after, 'utf8');
      rewritten += 1;
    }
  }
  return rewritten;
}

function packageDirectory(name) {
  let entry;
  try {
    entry = require.resolve(`${name}/package.json`);
  } catch {
    entry = require.resolve(name);
  }
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory) && !existsSync(path.join(directory, 'package.json'))) {
    directory = path.dirname(directory);
  }
  return directory;
}

function executable(name, relative) {
  const candidate = path.join(packageDirectory(name), relative);
  if (!existsSync(candidate)) {
    throw new Error(`无法解析 ${name} 的可执行入口：${candidate}`);
  }
  return candidate;
}

// 1. 声明产物：.vue 生成 DefineComponent 声明，.ts 生成普通声明
execFileSync(
  process.execPath,
  [executable('vue-tsc', 'bin/vue-tsc.js'), '--declaration', '--emitDeclarationOnly', '-p', 'tsconfig.build.json'],
  { cwd: packageRoot, stdio: 'inherit' },
);

// 2. JS 产物：vite 库模式，@vitejs/plugin-vue 编译 SFC
// 显式 NODE_ENV=production：调用方（如测试进程）可能带有其他 NODE_ENV，
// 否则 isProduction 为 false 会在产物中写入构建机绝对路径（__file）
execFileSync(
  process.execPath,
  [executable('vite', 'bin/vite.js'), 'build'],
  { cwd: packageRoot, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } },
);

// 3. 声明规范化：裸 './X.vue' → './X.vue.js'，使 NodeNext 消费者也能解析
const rewritten = await normalizeDistDeclarationSpecifiers(path.join(packageRoot, 'dist'));

// 4. 样式入口（确保 LF 换行）
await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
const css = await readFile(path.join(packageRoot, 'src/style.css'), 'utf8');
await writeFile(path.join(packageRoot, 'dist/style.css'), css.replace(/\r\n/g, '\n'), 'utf8');
console.log(
  `charts-vue 构建完成：index / line / bar / pie / scatter / trend-card / ranking / proportion / style.css → dist` +
    `（声明规范化 ${rewritten} 个文件）`,
);
