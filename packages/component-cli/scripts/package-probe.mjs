#!/usr/bin/env node
/**
 * 把 T10 探针打成可随 `@company/component-cli` 分发的运行材料（A 侧）。
 *
 * 用法（在仓库根执行）：
 *   node packages/component-cli/scripts/package-probe.mjs            # 打包
 *   node packages/component-cli/scripts/package-probe.mjs --check    # 只复核已有产物
 *   node packages/component-cli/scripts/package-probe.mjs --out <d>  # 指定输出目录
 *
 * 产物布局（`packages/component-cli/dist/probe/`）：
 *   probe.mjs, environment.mjs, bundle.mjs, policy.mjs,
 *   consumer.mjs, browser.mjs, evidence.mjs, probe.test.mjs
 *   resources/examples/{vue,react,fixtures}/…     ← 双框架模板与 fixtures
 *   resources/tsconfig.base.json                  ← 示例 tsconfig 的 extends 目标
 *   probe-manifest.json                           ← 逐文件 sha256 + 字节数
 *
 * 为什么是这个布局：示例源码里写死了两条相对路径——`src/App.vue` 用
 * `../../fixtures/*.json`、各示例 `tsconfig.json` extends `../../tsconfig.base.json`。
 * 因此打包必须原样保留 `resources/examples/<framework>` 与 `resources/examples/fixtures`
 * 这对兄弟关系，探针的 `resolveProbeLayout()` 才能用同一个 `resourceRoot` 同时喂
 * `exampleDir` 与 `repoRoot` 给 `createConsumer`，不必改消费者那侧的任何签名。
 *
 * 边界（与 `AGENTS.md` 一致）：
 * - 只**复制**，不打包、不改写任何冻结产物；探针与模板都是只读源；
 * - 白名单显式列出该进包的每一项，"复制整个目录"式的通配一律不用；
 * - `node_modules` / `dist` / `.turbo` / `.git` / 密钥 / 既有输出硬排除，
 *   打完还会整体复核一遍，污染即失败；
 * - 不触碰根 `package.json` / 锁文件 / `packages/contracts` / SDK 包。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根：本脚本位于 `<repo>/packages/component-cli/scripts/`。 */
export const REPO_ROOT_FROM_SCRIPT = path.resolve(HERE, '../../..');

/** 探针模块白名单：一个都不能少，少一个入口就起不来。 */
export const PROBE_MODULES = /** @type {const} */ ([
  'probe.mjs',
  'environment.mjs',
  'bundle.mjs',
  'policy.mjs',
  'consumer.mjs',
  'browser.mjs',
  'evidence.mjs',
  'probe.test.mjs',
]);

/** 资源白名单：模板框架、fixtures、以及示例 tsconfig 的 extends 目标。 */
export const PROBE_RESOURCE_SPEC = /** @type {const} */ ({
  templates: ['vue', 'react'],
  fixtures: 'fixtures',
  baseTsconfig: 'tsconfig.base.json',
  probeModules: PROBE_MODULES,
});

/**
 * 硬排除项。两类：
 * ① 本地产物（`node_modules` / `dist` / `.turbo` / `.git` / 缓存与报告目录）；
 * ② 敏感文件（`.env*` / `*.pem` / `*.key` / `id_rsa` 等）。
 * 按**相对路径的任一段**匹配，因此嵌套在任何层级的 `node_modules` 都会被挡住。
 */
const EXCLUDED_NAMES = new Set([
  'node_modules',
  'dist',
  '.turbo',
  '.git',
  'coverage',
  'test-results',
  'playwright-report',
  '.release',
  '.cache',
  '.vite',
  '.pnpm-store',
]);

const EXCLUDED_FILE_PATTERNS = [
  /^\.env(\..+)?$/,
  /\.tsbuildinfo$/,
  /\.pem$/,
  /\.key$/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_ed25519$/,
  /\.(pfx|p12|jks|keystore)$/,
  /(^|\/)\.npmrc$/,
];

/**
 * 判断一个相对路径是否属于硬排除项。
 * @param {string} rel 以 `/` 或 `\\` 分隔的相对路径
 * @returns {boolean}
 */
export function isExcluded(rel) {
  const parts = String(rel).split(/[\\/]/).filter(Boolean);
  for (const part of parts) {
    if (EXCLUDED_NAMES.has(part)) return true;
    for (const pattern of EXCLUDED_FILE_PATTERNS) {
      if (pattern.test(part)) return true;
    }
  }
  return false;
}

/** 递归列出目录下所有文件（相对路径，统一用 `/`），已应用硬排除。 */
async function listFiles(root, prefix = '') {
  const found = [];
  let entries;
  try {
    entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) {
      found.push(...(await listFiles(root, rel)));
    } else if (entry.isFile()) {
      found.push(rel);
    }
  }
  return found.sort();
}

/** 生成一份只含白名单文件的清单（不落盘，便于单测）。 */
export async function collectProbeResources({ repoRoot, probeDir = path.join('tests', 'acceptance', 't10-sdk') }) {
  const entries = [];
  const push = async (source, target) => {
    if (!existsSync(source)) {
      throw new Error(`PROBE_INPUT 打包资源缺失：${path.relative(repoRoot, source) || source}`);
    }
    const info = await stat(source);
    if (info.isDirectory()) {
      for (const rel of await listFiles(source)) {
        entries.push({ source: path.join(source, rel), target: `${target}/${rel}`.replaceAll('\\', '/') });
      }
    } else {
      entries.push({ source, target });
    }
  };

  for (const name of PROBE_MODULES) {
    await push(path.join(repoRoot, probeDir, name), name);
  }
  for (const framework of PROBE_RESOURCE_SPEC.templates) {
    await push(path.join(repoRoot, 'examples', framework), `resources/examples/${framework}`);
  }
  await push(path.join(repoRoot, 'examples', PROBE_RESOURCE_SPEC.fixtures), `resources/examples/${PROBE_RESOURCE_SPEC.fixtures}`);
  await push(path.join(repoRoot, PROBE_RESOURCE_SPEC.baseTsconfig), `resources/${PROBE_RESOURCE_SPEC.baseTsconfig}`);
  return entries;
}

/**
 * 复核一个已打包的 `dist/probe`：清单内文件齐全、无清单外文件、无污染项、摘要一致。
 *
 * 这是给「安装后自检」与 CI 用的同一份判据：缺文件、多文件、混进本地状态、
 * **或文件被改过一个字节**都算失败，不因为"能跑起来"就放过。摘要核对是
 * 「安装包只读」这条约束的唯一可靠证据——只查存在性的话，往 dist/probe 里
 * 改一个文件照样能跑，复核却会说 ok。
 */
export async function verifyProbeBundle(root) {
  const reasons = [];
  const polluted = [];
  const tampered = [];
  const manifestPath = path.join(root, 'probe-manifest.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, missing: [], extra: [], polluted: [], tampered: [], reasons: ['缺少 probe-manifest.json，无法复核'] };
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const listed = new Set(manifest.files.map((entry) => entry.path));
  const present = await listFiles(root);

  for (const entry of manifest.files) {
    const file = path.join(root, entry.path);
    if (!existsSync(file)) {
      reasons.push(`清单内文件缺失：${entry.path}`);
      continue;
    }
    const bytes = await readFile(file);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256 || bytes.length !== entry.bytes) {
      tampered.push(entry.path);
      reasons.push(`摘要不一致（文件被改动）：${entry.path}`);
    }
  }
  for (const rel of present) {
    if (rel === 'probe-manifest.json') continue;
    if (!listed.has(rel)) reasons.push(`清单外文件：${rel}`);
    if (isExcluded(rel)) polluted.push(rel);
  }
  if (polluted.length > 0) reasons.push(`污染项：${polluted.join(', ')}`);
  return {
    ok: reasons.length === 0,
    missing: manifest.files.filter((entry) => !existsSync(path.join(root, entry.path))).map((entry) => entry.path),
    extra: present.filter((rel) => rel !== 'probe-manifest.json' && !listed.has(rel)),
    polluted,
    tampered,
    reasons,
  };
}

/** 读打包产物自带的清单；没有就返回 null。 */
export async function readProbeManifest(root) {
  const file = path.join(root, 'probe-manifest.json');
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * 打包：复制白名单资源 → 逐文件算摘要 → 写清单 → 整体复核。
 *
 * @param {{repoRoot?: string; cliRoot?: string; out?: string}} options
 * @returns {Promise<{root: string; manifest: object; verification: object}>}
 */
export async function packageProbe({
  repoRoot = REPO_ROOT_FROM_SCRIPT,
  cliRoot = path.resolve(repoRoot, 'packages', 'component-cli'),
  out = path.join(cliRoot, 'dist', 'probe'),
} = {}) {
  const root = path.resolve(out);
  const entries = await collectProbeResources({ repoRoot });
  // 先清后写：上一次的产物若混进了别的东西，不能留着冒充本次结果
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const files = [];
  for (const entry of entries) {
    const target = path.join(root, entry.target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(entry.source, target);
    const bytes = await readFile(target);
    files.push({
      path: entry.target.replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));

  const manifest = {
    schemaVersion: 1,
    kind: 'a-t10-probe-distribution',
    entry: 'probe.mjs',
    resourceRoot: 'resources',
    generatedBy: 'packages/component-cli/scripts/package-probe.mjs',
    files,
  };
  await writeFile(path.join(root, 'probe-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const verification = await verifyProbeBundle(root);
  if (!verification.ok) {
    throw new Error(`PROBE_INTERNAL 打包产物复核失败：${verification.reasons.join('；')}`);
  }
  return { root, manifest, verification };
}

const USAGE = `T10 探针分发材料打包

  node packages/component-cli/scripts/package-probe.mjs            打包到 dist/probe
  node packages/component-cli/scripts/package-probe.mjs --check    只复核已有产物
  node packages/component-cli/scripts/package-probe.mjs --out <d>  指定输出目录

产物：<out>/probe.mjs 等八个模块 + <out>/resources/{examples,tsconfig.base.json} + probe-manifest.json
`;

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  const outIndex = args.indexOf('--out');
  const out = outIndex === -1 ? undefined : args[outIndex + 1];
  if (outIndex !== -1 && !out) {
    process.stderr.write('--out 需要一个目录参数\n');
    return 2;
  }
  if (args.includes('--check')) {
    const root = path.resolve(out ?? path.join(REPO_ROOT_FROM_SCRIPT, 'packages', 'component-cli', 'dist', 'probe'));
    if (!existsSync(root)) {
      process.stderr.write(`PROBE_INPUT 待复核目录不存在：${root}\n请先执行打包。\n`);
      return 2;
    }
    const verification = await verifyProbeBundle(root);
    const manifest = await readProbeManifest(root);
    process.stdout.write(
      `复核 ${root}\n  清单文件数：${manifest?.files?.length ?? 0}\n  实际文件数：${verification.extra.length + (manifest?.files?.length ?? 0) - verification.extra.length}\n  缺失：${verification.missing.length}\n  清单外：${verification.extra.length}\n  污染：${verification.polluted.length}\n  被改动：${verification.tampered.length}\n  结论：${verification.ok ? 'ok' : 'failed'}\n`,
    );
    if (!verification.ok) {
      for (const reason of verification.reasons) process.stderr.write(`  - ${reason}\n`);
      return 1;
    }
    return 0;
  }
  const result = await packageProbe({ out });
  process.stdout.write(
    `已打包 ${result.root}\n  文件数：${result.manifest.files.length}\n  字节数：${result.manifest.files.reduce((sum, entry) => sum + entry.bytes, 0)}\n  复核：${result.verification.ok ? 'ok' : 'failed'}\n`,
  );
  return result.verification.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${String(error?.message ?? error)}\n`);
      process.exit(1);
    });
}
