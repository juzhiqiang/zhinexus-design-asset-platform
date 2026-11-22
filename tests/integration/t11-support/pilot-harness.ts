/**
 * T11 真实试点 harness（合成演练）
 *
 * 依据 docs/plans/2026-11-11-component-platform-implementation.md T11 第 1 项：
 *   「用真实 Vue 和 React 项目（用户提供访问范围）安装精确发布版本；只读识别项目后创建可审查变更，
 *     完成类型/构建、点击/更新交互和页面核对，记录框架/引擎版本。**合成消费者不能替代这一步。**」
 *
 * 本文件提供该流程的**可复用机械部分**：只读识别、可审查变更清单、命令结果与框架/引擎版本记录。
 * 它对输入工程一无所知，也不判断工程是否"真实业务"——判定由调用方显式给出。
 *
 * 重要边界（不得放宽）：
 * - 本 harness 只读识别工程，除显式登记的写入外不修改工程；
 * - 字节证据全部由 Node `fs` + `crypto` 独立实算，不读取任何 fixture 的占位摘要；
 * - `synthetic` / `productionAcceptance` / `satisfiesRealBusinessPilot` 三个字段由构造参数强制提供，
 *   harness 内部不做任何"看起来像真实"的推断。
 *
 * 本文件不是 Vitest 用例（不匹配 `*.test.ts`），仅供 T11 验收测试与试点脚本共用。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type PilotFramework = 'vue' | 'react';

/** 只读识别结果。任何字段缺失都必须是 `undefined`，不得用猜测值填充。 */
export type ProjectIdentity = {
  framework: PilotFramework | 'unknown';
  frameworkVersion?: string;
  reactDomVersion?: string;
  engineVersion?: string;
  packageManager?: string;
  lockfiles: string[];
};

export type CommandOutcome = {
  name: string;
  command: string;
  /** `undefined` 表示本轮未执行（例如沙箱缺工具链）；不得用 0 冒充通过。 */
  exitCode?: number;
  durationMs: number;
  executed: boolean;
  note?: string;
};

export type PilotChange = {
  path: string;
  kind: 'added' | 'modified';
  bytes: number;
  sha256: string;
};

export type PilotRelease = {
  name: string;
  version: string;
  integrity: string;
};

export type PilotReceipt = {
  schemaVersion: 1;
  /** 输入工程是否为合成工程。由调用方强制提供，harness 不推断。 */
  synthetic: boolean;
  /** 是否构成生产验收。合成演练恒为 false。 */
  productionAcceptance: boolean;
  /** 是否满足 T11「两个真实业务项目」标准项。合成演练恒为 false。 */
  satisfiesRealBusinessPilot: boolean;
  framework: PilotFramework;
  identity: ProjectIdentity;
  release: PilotRelease;
  changes: PilotChange[];
  commands: CommandOutcome[];
  startedAt: string;
  finishedAt: string;
};

// ─── 临时目录生命周期（与 t16-support 同型：只操作本次登记的目录） ───

const TEMP_PREFIX = 't11-pilot-';
const createdDirs: string[] = [];

function safeLstat(absolute: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(absolute);
  } catch {
    return undefined;
  }
}

function isRegisteredTempDir(dir: string): boolean {
  if (path.dirname(dir) !== path.resolve(os.tmpdir())) return false;
  return path.basename(dir).startsWith(TEMP_PREFIX);
}

/** 递归恢复写权限：只对本次登记目录内 `nlink===1` 的普通文件 chmod；硬链接与链接一律跳过。 */
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
    if (childStats.isSymbolicLink()) continue;
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
  }
}

/** 释放本文件登记的全部临时目录；先 lstat 根并复核登记，再按安全规则恢复权限。 */
export function releasePilotDirs(): void {
  for (const dir of [...createdDirs].reverse()) {
    if (!isRegisteredTempDir(dir)) continue;
    const stats = safeLstat(dir);
    if (stats === undefined) continue;
    if (!stats.isDirectory()) {
      try {
        fs.rmSync(dir, { force: true });
      } catch {
        /* 尽力而为 */
      }
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

export function pilotRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PREFIX}${prefix}-`));
  createdDirs.push(dir);
  return dir;
}

// ─── 只读识别 ───

const FRAMEWORK_DEPS: Record<PilotFramework, string> = {
  vue: 'vue',
  react: 'react',
};

function readPackageJson(root: string): Record<string, unknown> | undefined {
  const absolute = path.join(root, 'package.json');
  let text: string;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function dependencyVersion(manifest: Record<string, unknown> | undefined, name: string): string | undefined {
  if (manifest === undefined) return undefined;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const section = manifest[field];
    if (typeof section !== 'object' || section === null) continue;
    const value = (section as Record<string, unknown>)[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function installedVersion(root: string, name: string): string | undefined {
  const absolute = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const version = (parsed as Record<string, unknown>).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 只读识别：只读取 package.json、锁文件与 node_modules 下的 package.json，
 * 不写入、不执行安装、不修改工程。识别不到框架时返回 `framework:'unknown'` 且版本字段为 undefined。
 */
export function identifyProject(root: string): ProjectIdentity {
  const manifest = readPackageJson(root);
  const lockfiles = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'].filter(name =>
    safeLstat(path.join(root, name)) !== undefined,
  );
  const identity: ProjectIdentity = {
    framework: 'unknown',
    lockfiles,
    packageManager: typeof manifest?.packageManager === 'string' ? manifest.packageManager : undefined,
  };
  for (const framework of ['vue', 'react'] as const) {
    const declared = dependencyVersion(manifest, FRAMEWORK_DEPS[framework]);
    if (declared === undefined) continue;
    identity.framework = framework;
    identity.frameworkVersion = installedVersion(root, FRAMEWORK_DEPS[framework]) ?? declared;
    break;
  }
  if (identity.framework === 'react') {
    identity.reactDomVersion = installedVersion(root, 'react-dom') ?? dependencyVersion(manifest, 'react-dom');
  }
  identity.engineVersion = installedVersion(root, 'echarts') ?? dependencyVersion(manifest, 'echarts');
  return identity;
}

// ─── 可审查变更清单 ───

function listFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    const absolute = relative === '' ? root : path.join(root, ...relative.split('/'));
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const childAbsolute = path.join(root, ...childRelative.split('/'));
      const stats = safeLstat(childAbsolute);
      if (stats === undefined || stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) walk(childRelative);
      else if (stats.isFile()) found.push(childRelative);
    }
  };
  walk('');
  return found.sort();
}

function digestFile(absolute: string): { bytes: number; sha256: string } {
  const bytes = fs.readFileSync(absolute);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * 生成可审查变更清单：逐文件独立实算字节与 SHA-256，跳过 node_modules 与链接。
 * 基线快照必须在写入前采集，否则无法区分 added 与 modified。
 */
export function inventoryChanges(root: string, baseline: Set<string>): PilotChange[] {
  const changes: PilotChange[] = [];
  for (const relative of listFiles(root)) {
    const absolute = path.join(root, ...relative.split('/'));
    const { bytes, sha256 } = digestFile(absolute);
    changes.push({ path: relative, kind: baseline.has(relative) ? 'modified' : 'added', bytes, sha256 });
  }
  return changes;
}

export function snapshotFiles(root: string): Set<string> {
  return new Set(listFiles(root));
}

// ─── 命令结果记录 ───

/**
 * 记录一条命令结果。`run` 返回 undefined 表示未执行；此时 exitCode 必须保持 undefined，
 * 不得写成 0——未执行不是通过。
 */
export function recordCommand(
  name: string,
  command: string,
  run: () => { exitCode: number } | undefined,
  note?: string,
): CommandOutcome {
  const startedAt = Date.now();
  const outcome = run();
  return {
    name,
    command,
    exitCode: outcome?.exitCode,
    durationMs: Date.now() - startedAt,
    executed: outcome !== undefined,
    note,
  };
}

// ─── 合成试点工程 ───

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
}

export type SyntheticProject = {
  root: string;
  baseline: Set<string>;
  identity: ProjectIdentity;
};

/**
 * 创建合成试点工程：位于系统临时根、带本文件固定前缀、每例独占。
 * 这是**合成**输入，`satisfiesRealBusinessPilot` 恒为 false；真实业务项目由用户提供访问范围后另行接入。
 */
export function createSyntheticPilotProject(
  framework: PilotFramework,
  release: PilotRelease,
): SyntheticProject {
  const root = pilotRoot(framework);
  const manifest = framework === 'vue'
    ? {
        name: 't11-pilot-vue',
        private: true,
        version: '0.0.0',
        dependencies: { [release.name]: release.version, vue: '3.5.45', echarts: '6.1.0' },
        devDependencies: { '@vitejs/plugin-vue': '5.2.4', typescript: '5.9.2', vite: '6.3.5', 'vue-tsc': '2.2.10' },
        scripts: { typecheck: 'vue-tsc --noEmit', build: 'vite build' },
      }
    : {
        name: 't11-pilot-react',
        private: true,
        version: '0.0.0',
        dependencies: { [release.name]: release.version, react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
        devDependencies: { '@vitejs/plugin-react': '4.7.0', typescript: '5.9.2', vite: '6.3.5' },
        scripts: { typecheck: 'tsc --noEmit', build: 'vite build' },
      };
  writeFiles(root, {
    'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, jsx: framework === 'react' ? 'react-jsx' : 'preserve', noEmit: true, skipLibCheck: true } }, null, 2)}\n`,
  });
  // 受控包树：真实目录 + 真实 package.json + 入口文件，可被包管理器物化，不是占位文本 tarball。
  const packageRoot = path.join(root, 'vendor', ...release.name.split('/'));
  writeFiles(packageRoot, {
    'package.json': `${JSON.stringify({ name: release.name, version: release.version, type: 'module', main: './dist/index.js', types: './dist/index.d.ts', dependencies: { echarts: '6.1.0' } }, null, 2)}\n`,
    'dist/index.js': `export const release = ${JSON.stringify({ name: release.name, version: release.version })};\n`,
    'dist/index.d.ts': `export declare const release: { name: string; version: string };\n`,
  });
  const baseline = snapshotFiles(root);
  return { root, baseline, identity: identifyProject(root) };
}

// ─── receipt 组装 ───

/**
 * 组装试点 receipt。三个判定字段由调用方强制提供；harness 不推断、不放宽。
 * `synthetic: true` 时 `satisfiesRealBusinessPilot` 必须为 false，否则直接抛错——
 * 防止把合成演练误记成真实业务试点。
 */
export function buildPilotReceipt(input: {
  synthetic: boolean;
  productionAcceptance: boolean;
  satisfiesRealBusinessPilot: boolean;
  framework: PilotFramework;
  identity: ProjectIdentity;
  release: PilotRelease;
  changes: PilotChange[];
  commands: CommandOutcome[];
  startedAt: string;
  finishedAt: string;
}): PilotReceipt {
  if (input.synthetic && input.satisfiesRealBusinessPilot) {
    throw new Error('Synthetic rehearsal must not be recorded as satisfying the real-business-pilot criterion.');
  }
  if (input.synthetic && input.productionAcceptance) {
    throw new Error('Synthetic rehearsal must not be recorded as production acceptance.');
  }
  return { schemaVersion: 1, ...input };
}

export function canonicalPilotReceiptJson(receipt: PilotReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}
