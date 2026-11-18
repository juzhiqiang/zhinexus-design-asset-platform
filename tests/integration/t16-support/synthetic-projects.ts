/**
 * T16 B / P1 产品 RED 辅助：synthetic 临时工程与独立字节证据。
 *
 * 依据 docs/superpowers/plans/2026-11-18-t16-b-install-isolation-brief.md：
 * - 临时工程一律位于工作区之外（`os.tmpdir()`），每个用例独占一个目录；
 * - 文件证据（SHA-256 / 原始字节）由本文件用 Node `fs` + `crypto` 独立实算，
 *   不读取公共 fixtures 的占位摘要，也不用 fixtures 冒充字节证据；
 * - 只使用 synthetic 包名/版本/凭据，不连接任何公司环境。
 *
 * 本文件不是 Vitest 用例（不匹配 `*.test.ts`），仅被三份产品测试共用。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify as yamlStringify } from 'yaml';

// ─── synthetic 包身份（全部为测试专用假数据） ───

export const VUE_PACKAGE_NAME = '@company/charts-vue';
export const REACT_PACKAGE_NAME = '@company/charts-react';
export const PACKAGE_VERSION = '0.0.12';
export const VUE_FRAMEWORK_VERSION = '3.5.45';
export const REACT_FRAMEWORK_VERSION = '19.3.1';
export const REACT_DOM_VERSION = '19.3.1';
export const ECHARTS_VERSION = '6.1.0';

export function tarballFileName(name: string, version: string): string {
  const base = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
  return `${base}-${version}.tgz`;
}

/** 固定合成 tarball bytes：仅作为 T15 式“实收摘要复核”的稳定输入（平台摘要/integrity/shasum 由它实算）。
 *
 * 注意：这些 bytes 不是可安装产物。安装相关用例必须由测试私有进程 mock 物化**受控包树**
 * （真实目录 + 真实 package.json/入口文件），不得把这里的文本 bytes 冒充 npm/pnpm 可解包的 tarball。 */
export function tarballBytes(name: string, version: string): Buffer {
  return Buffer.from(`synthetic tarball payload for ${name}@${version}\n`);
}

export function tarballSha256(name: string, version: string): string {
  return createHash('sha256').update(tarballBytes(name, version)).digest('hex');
}

export function tarballIntegrity(name: string, version: string): string {
  return `sha512-${createHash('sha512').update(tarballBytes(name, version)).digest('base64')}`;
}

export function tarballShasum(name: string, version: string): string {
  return createHash('sha1').update(tarballBytes(name, version)).digest('hex');
}

// ─── 目录生命周期 ───

type RegisteredRoot = { path: string };

const createdDirs: RegisteredRoot[] = [];

const TEMP_PREFIX = 't16-';

function safeLstat(absolute: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(absolute);
  } catch {
    return undefined;
  }
}

/**
 * 清理前复核登记项：父目录必须是系统临时根，且名字带本辅助的固定前缀。
 * 只允许操作本次 `mkdtempSync` 登记过的目录，绝不触碰其他源码/公共文件。
 */
function isRegisteredTempDir(dir: string): boolean {
  if (path.dirname(dir) !== path.resolve(os.tmpdir())) return false;
  return path.basename(dir).startsWith(TEMP_PREFIX);
}

/**
 * 递归恢复写权限：只对“本次登记目录内的普通文件且 nlink===1”chmod。
 * - 一律 `lstat` 判定，绝不跟随符号链接/junction 进入链接目标；
 * - 硬链接（nlink>1）跳过：chmod 会顺着 inode 影响工程外/其他文件；
 * - 链接本身只移除链接，不递归、不进入目标目录。
 */
function restoreWritableTree(root: string): void {
  const stats = safeLstat(root);
  if (stats === undefined || stats.isSymbolicLink() || !stats.isDirectory()) return;
  let children: fs.Dirent[];
  try {
    children = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const child of children) {
    const absolute = path.join(root, child.name);
    const childStats = safeLstat(absolute);
    if (childStats === undefined) continue;
    if (childStats.isSymbolicLink()) continue; // 链接不进入、不改权限
    if (childStats.isDirectory()) {
      restoreWritableTree(absolute);
      continue;
    }
    if (childStats.isFile() && childStats.nlink === 1) {
      try {
        fs.chmodSync(absolute, 0o666);
      } catch {
        /* 尽力而为：清理失败不影响用例结论 */
      }
    }
    // 硬链接与其他特殊文件一律跳过 chmod。
  }
}

/** 移除链接本身（不递归进入目标），用于“根目录被换成 junction”的用例。 */
function removeLinkOnly(absolute: string): void {
  try {
    fs.rmSync(absolute, { force: true });
  } catch {
    try {
      fs.rmdirSync(absolute);
    } catch {
      /* 尽力而为 */
    }
  }
}

/** 释放本文件登记的全部临时目录；先 lstat 根并复核登记，再按上面的安全规则恢复权限。 */
export function releaseSyntheticDirs(): void {
  for (const entry of [...createdDirs].reverse()) {
    const dir = entry.path;
    if (!isRegisteredTempDir(dir)) continue;
    const stats = safeLstat(dir);
    if (stats === undefined) continue;
    if (stats.isSymbolicLink()) {
      // 根被替换成链接：只移除链接本身，绝不递归进入链接目标。
      removeLinkOnly(dir);
      continue;
    }
    if (!stats.isDirectory()) {
      removeLinkOnly(dir);
      continue;
    }
    restoreWritableTree(dir);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 尽力而为 */
    }
  }
  createdDirs.length = 0;
}

export function syntheticRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PREFIX}${prefix}-`));
  createdDirs.push({ path: dir });
  return dir;
}

export type ProjectFiles = Record<string, string>;

export function createProject(prefix: string, files: ProjectFiles): string {
  const root = syntheticRoot(prefix);
  writeFiles(root, files);
  return root;
}

export function writeFiles(root: string, files: ProjectFiles): void {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
}

export function projectFile(root: string, relative: string): string {
  return path.join(root, ...relative.split('/'));
}

export function fileExists(root: string, relative: string): boolean {
  return fs.existsSync(projectFile(root, relative));
}

export function readBytes(root: string, relative: string): Buffer | undefined {
  const absolute = projectFile(root, relative);
  try {
    return fs.readFileSync(absolute);
  } catch {
    return undefined;
  }
}

export function readText(root: string, relative: string): string | undefined {
  const bytes = readBytes(root, relative);
  return bytes === undefined ? undefined : bytes.toString('utf8');
}

export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Of(root: string, relative: string): string {
  const bytes = readBytes(root, relative);
  if (bytes === undefined) throw new Error(`T16 辅助：文件不存在，无法独立计算摘要：${relative}`);
  return sha256Hex(bytes);
}

/** 递归字节快照：链接记录为 `link:<target>`，目录记录为 `dir`，文件记录 `file:<size>:<base64>`。 */
export function treeSnapshot(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (directory: string, relative: string): void => {
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      const absolute = path.join(directory, child.name);
      if (child.isSymbolicLink()) {
        let target = '';
        try {
          target = fs.readlinkSync(absolute);
        } catch {
          target = '<unreadable>';
        }
        entries.set(childRelative, `link:${target}`);
      } else if (child.isDirectory()) {
        entries.set(childRelative, 'dir');
        walk(absolute, childRelative);
      } else {
        const bytes = fs.readFileSync(absolute);
        entries.set(childRelative, `file:${bytes.length}:${bytes.toString('base64')}`);
      }
    }
  };
  walk(root, '');
  return entries;
}

export function treeDifferences(before: Map<string, string>, after: Map<string, string>): string[] {
  const differences: string[] = [];
  for (const [key, value] of before) {
    if (!after.has(key)) differences.push(`缺失：${key}`);
    else if (after.get(key) !== value) differences.push(`字节变化：${key}`);
  }
  for (const key of after.keys()) if (!before.has(key)) differences.push(`新增：${key}`);
  return differences;
}

/** 目录链接：Windows 用 junction（无需管理员特权），其他平台退回目录符号链接。 */
export function linkDirectory(linkPath: string, target: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(target, linkPath, 'junction');
  } catch {
    fs.symlinkSync(target, linkPath, 'dir');
  }
}

/** 硬链接（同卷）：用于验证恢复不会顺着链接改写工程外字节。 */
export function hardLinkFile(linkPath: string, target: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.rmSync(linkPath, { force: true });
  fs.linkSync(target, linkPath);
}

/** 受控文件系统条件：把文件设为只读，用于注入写入/删除失败。 */
export function makeReadOnly(root: string, relative: string): void {
  fs.chmodSync(projectFile(root, relative), 0o444);
}

export function makeWritable(root: string, relative: string): void {
  fs.chmodSync(projectFile(root, relative), 0o666);
}

// ─── manifest / lock 夹具（与 T15 同形态，synthetic 值） ───

const manifestJson = (manifest: Record<string, unknown>): string => JSON.stringify(manifest, null, 2);

type PnpmImporterDeps = Record<string, { specifier: string; version: string }>;

function pnpmV9Lock(importers: Record<string, PnpmImporterDeps>): string {
  const versions = new Map<string, string>();
  for (const deps of Object.values(importers)) {
    for (const [name, entry] of Object.entries(deps)) if (entry.version) versions.set(name, entry.version);
  }
  const integrity = (name: string, version: string): string => {
    try {
      return tarballIntegrity(name, version);
    } catch {
      return `sha512-${'A'.repeat(86)}==`;
    }
  };
  return yamlStringify({
    lockfileVersion: '9.0',
    importers: Object.fromEntries(Object.entries(importers).map(([importer, deps]) => [importer, { dependencies: deps }])),
    packages: Object.fromEntries([...versions].map(([name, version]) => [`${name}@${version}`, { resolution: { integrity: integrity(name, version) } }])),
    snapshots: Object.fromEntries([...versions].map(([name, version]) => [`${name}@${version}`, { dependencies: {} }])),
  });
}

function npmV3Lock(importers: Record<string, Record<string, string>>, versions: Record<string, string>): string {
  const packages: Record<string, unknown> = {};
  for (const [importer, deps] of Object.entries(importers)) {
    packages[importer] = importer === '' ? { name: 'host-app', version: '1.0.0', dependencies: deps } : { dependencies: deps };
  }
  for (const [name, version] of Object.entries(versions)) {
    packages[`node_modules/${name}`] = {
      version,
      resolved: `https://registry.example.invalid/${name}/-/${tarballFileName(name, version)}`,
      integrity: tarballIntegrity(name, version),
    };
  }
  return JSON.stringify({ lockfileVersion: 3, name: 'host-app', requires: true, packages }, null, 2);
}

const HOST_SCRIPTS = { build: 'vite build', typecheck: 'tsc --noEmit' };

/** Vue + pnpm，且 charts-vue 已在锁中：计划只有“生成组件”一项改动，没有安装意图。 */
export function vuePnpmLockedProject(prefix = 'vue-pnpm-locked'): string {
  const deps: PnpmImporterDeps = {
    vue: { specifier: '^3.5.0', version: VUE_FRAMEWORK_VERSION },
    echarts: { specifier: ECHARTS_VERSION, version: ECHARTS_VERSION },
    [VUE_PACKAGE_NAME]: { specifier: PACKAGE_VERSION, version: PACKAGE_VERSION },
  };
  return createProject(prefix, {
    'package.json': manifestJson({
      name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
      dependencies: { vue: '^3.5.0', echarts: ECHARTS_VERSION, [VUE_PACKAGE_NAME]: PACKAGE_VERSION },
      scripts: HOST_SCRIPTS,
    }),
    'pnpm-lock.yaml': pnpmV9Lock({ '.': deps }),
  });
}

/** Vue + pnpm，charts-vue 尚未锁定：计划包含清单、锁与生成组件三项改动，并有安装意图。 */
export function vuePnpmNewDependencyProject(prefix = 'vue-pnpm-new', extra?: ProjectFiles): string {
  const deps: PnpmImporterDeps = {
    vue: { specifier: '^3.5.0', version: VUE_FRAMEWORK_VERSION },
    echarts: { specifier: ECHARTS_VERSION, version: ECHARTS_VERSION },
  };
  return createProject(prefix, {
    'package.json': manifestJson({
      name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
      dependencies: { vue: '^3.5.0', echarts: ECHARTS_VERSION },
      scripts: HOST_SCRIPTS,
    }),
    'pnpm-lock.yaml': pnpmV9Lock({ '.': deps }),
    ...extra,
  });
}

/** Vue + npm，charts-vue 尚未锁定：用于核验 npm 固定 argv 与隔离 userconfig。 */
export function vueNpmNewDependencyProject(prefix = 'vue-npm-new', extra?: ProjectFiles): string {
  const declared = { vue: '^3.5.0', echarts: ECHARTS_VERSION };
  return createProject(prefix, {
    'package.json': manifestJson({ name: 'host-app', version: '1.0.0', private: true, dependencies: declared, scripts: HOST_SCRIPTS }),
    'package-lock.json': npmV3Lock({ '': declared }, { vue: VUE_FRAMEWORK_VERSION, echarts: ECHARTS_VERSION }),
    ...extra,
  });
}

/** React + npm，charts-react 已在锁中：计划只有“生成组件”一项改动（`.tsx`）。 */
export function reactNpmLockedProject(prefix = 'react-npm-locked'): string {
  const declared = {
    react: REACT_FRAMEWORK_VERSION, 'react-dom': REACT_DOM_VERSION, echarts: ECHARTS_VERSION, [REACT_PACKAGE_NAME]: PACKAGE_VERSION,
  };
  return createProject(prefix, {
    'package.json': manifestJson({ name: 'host-app', version: '1.0.0', private: true, dependencies: declared, scripts: HOST_SCRIPTS }),
    'package-lock.json': npmV3Lock({ '': declared }, {
      react: REACT_FRAMEWORK_VERSION, 'react-dom': REACT_DOM_VERSION, echarts: ECHARTS_VERSION, [REACT_PACKAGE_NAME]: PACKAGE_VERSION,
    }),
  });
}

/** pnpm 静态 workspace（成员 apps/web），charts-vue **尚未**锁定：有真实安装意图。 */
export function vuePnpmWorkspaceNewDependencyProject(prefix = 'vue-pnpm-workspace-new', extra?: ProjectFiles): string {
  const memberDeps: PnpmImporterDeps = {
    vue: { specifier: '^3.5.0', version: VUE_FRAMEWORK_VERSION },
    echarts: { specifier: ECHARTS_VERSION, version: ECHARTS_VERSION },
  };
  return createProject(prefix, {
    'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0' }),
    'pnpm-workspace.yaml': yamlStringify({ packages: ['apps/*'] }),
    'apps/web/package.json': manifestJson({
      name: '@host/web', version: '1.0.0', private: true,
      dependencies: { vue: '^3.5.0', echarts: ECHARTS_VERSION },
      scripts: HOST_SCRIPTS,
    }),
    'pnpm-lock.yaml': pnpmV9Lock({ '.': {}, 'apps/web': memberDeps }),
    ...extra,
  });
}

/** 备份/暂存根目录：与临时工程同卷（都在 `os.tmpdir()`），且位于工程之外。 */
export function externalRoot(prefix: string): string {
  return syntheticRoot(prefix);
}
