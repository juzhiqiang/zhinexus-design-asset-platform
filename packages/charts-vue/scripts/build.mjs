import { copyFile, mkdir, rm } from 'node:fs/promises';
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

// 3. 样式入口
await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
await copyFile(path.join(packageRoot, 'src/style.css'), path.join(packageRoot, 'dist/style.css'));
console.log('charts-vue 构建完成：index / line / style.css → dist');
