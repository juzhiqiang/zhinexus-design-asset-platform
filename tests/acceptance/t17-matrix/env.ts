/**
 * T17 B 矩阵环境契约（路径由 C 在冻结包与环境就绪后提供）。
 *
 * 必需：
 * - T17_MATRIX_WORK_ROOT        仓外工作根（绝对路径，C 授权创建/清理）
 * - T17_MATRIX_API_BASE         真实本地平台 API origin
 * - T17_MATRIX_REGISTRY_BASE    真实本地 Verdaccio origin
 * - T17_MATRIX_VARIANTS         变体发布映射 JSON（componentId+framework → variantReleaseId）
 * - A10_FROZEN_BUNDLE           冻结 SDK bundle 目录（含 manifest.json）
 * - PHASE3_CLI_TARBALL          冻结 CLI tarball 绝对路径
 * - ZHINEXUS_API_TOKEN          平台 API 令牌
 * - ZHINEXUS_REGISTRY_TOKEN     注册表只读令牌
 *
 * 可选：
 * - T17_MATRIX_EVIDENCE_ROOT    证据根（默认 <WORK_ROOT>/evidence-<runId>，位于目标工程外）
 * - T17_MATRIX_BASELINE_ROOT    视觉基线根（默认 <WORK_ROOT>/baselines）
 * - T17_MATRIX_PNPM_BIN         pnpm 可执行文件（默认经 PATH 查找 pnpm）
 * - T17_MATRIX_NPM_CLI          npm-cli.js 路径（默认 Node 发行版同级 node_modules/npm/bin/npm-cli.js）
 * - T17_MATRIX_REPAIR_FAULT     已知模板故障通道 JSON（case V10/R10；缺失则这两例 blocked）
 * - T17_MATRIX_ACCEPT_BASELINES =1 时进入显式基线接纳模式（该模式不计矩阵通过）
 * - T17_MATRIX_KEEP_CASES       =1 时保留用例工程目录交给 C 清理（此时 temporary-host 收据不得计通过）
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export type RepairFaultChannel = {
  packageName: string;
  packageVersion: string;
  tarball: string;
  expectedRecipeIdPrefix?: string;
  expectedInitialCheck?: 'behavior' | 'type' | 'build';
};

export type MatrixEnv = {
  workRoot: string;
  evidenceRoot: string;
  baselineRoot: string;
  apiBase: string;
  registryBase: string;
  variantsPath: string;
  frozenBundleDir: string;
  cliTarball: string;
  apiToken: string;
  registryToken: string;
  pnpmBin: string;
  npmCli: string;
  repairFault?: RepairFaultChannel;
  acceptBaselines: boolean;
  keepCases: boolean;
};

export type MatrixEnvResult =
  | { ok: true; value: MatrixEnv }
  | { ok: false; missing: string[]; notes: string[] };

const isAbsolute = (value: string) => path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);

function loopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function defaultNpmCli(): string {
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

export function resolveMatrixEnv(env: NodeJS.ProcessEnv = process.env): MatrixEnvResult {
  const missing: string[] = [];
  const notes: string[] = [];
  const required = [
    'T17_MATRIX_WORK_ROOT',
    'T17_MATRIX_API_BASE',
    'T17_MATRIX_REGISTRY_BASE',
    'T17_MATRIX_VARIANTS',
    'A10_FROZEN_BUNDLE',
    'PHASE3_CLI_TARBALL',
    'ZHINEXUS_API_TOKEN',
    'ZHINEXUS_REGISTRY_TOKEN',
  ] as const;
  for (const name of required) if (!env[name]) missing.push(name);
  if (missing.length) {
    notes.push('冻结包/环境路径由 C 在 T17 集成验收时提供；缺失时矩阵以 blocked 记录，不产生通过结论。');
    return { ok: false, missing, notes };
  }

  const workRoot = path.resolve(env.T17_MATRIX_WORK_ROOT!);
  if (!isAbsolute(workRoot) || !existsSync(workRoot) || !statSync(workRoot).isDirectory()) {
    return { ok: false, missing: [], notes: ['T17_MATRIX_WORK_ROOT 必须是已存在的绝对目录（由 C 授权创建）。'] };
  }
  if (workRoot === REPO_ROOT || workRoot.startsWith(REPO_ROOT + path.sep)) {
    return { ok: false, missing: [], notes: ['T17_MATRIX_WORK_ROOT 必须位于仓库之外（仓外临时工程）。'] };
  }
  for (const [name, value] of [['T17_MATRIX_API_BASE', env.T17_MATRIX_API_BASE!], ['T17_MATRIX_REGISTRY_BASE', env.T17_MATRIX_REGISTRY_BASE!]] as const) {
    if (!loopbackOrigin(value)) return { ok: false, missing: [], notes: [name + ' 必须是本地 loopback origin。'] };
  }
  for (const [name, value, kind] of [
    ['T17_MATRIX_VARIANTS', env.T17_MATRIX_VARIANTS!, 'file'],
    ['PHASE3_CLI_TARBALL', env.PHASE3_CLI_TARBALL!, 'file'],
    ['A10_FROZEN_BUNDLE', env.A10_FROZEN_BUNDLE!, 'dir'],
  ] as const) {
    const target = path.resolve(value);
    if (!existsSync(target) || (kind === 'dir' ? !statSync(target).isDirectory() : !statSync(target).isFile())) {
      return { ok: false, missing: [], notes: [name + ' 指向的' + (kind === 'dir' ? '目录' : '文件') + '不存在。'] };
    }
  }
  const bundleDir = path.resolve(env.A10_FROZEN_BUNDLE!);
  if (!existsSync(path.join(bundleDir, 'manifest.json'))) return { ok: false, missing: [], notes: ['A10_FROZEN_BUNDLE 缺少 manifest.json。'] };

  let repairFault: RepairFaultChannel | undefined;
  if (env.T17_MATRIX_REPAIR_FAULT) {
    const faultPath = path.resolve(env.T17_MATRIX_REPAIR_FAULT);
    if (!existsSync(faultPath)) return { ok: false, missing: [], notes: ['T17_MATRIX_REPAIR_FAULT 指向的文件不存在。'] };
    const parsed = JSON.parse(readFileSync(faultPath, 'utf8')) as RepairFaultChannel;
    if (!parsed.packageName || !parsed.packageVersion || !parsed.tarball || !existsSync(path.resolve(parsed.tarball))) {
      return { ok: false, missing: [], notes: ['T17_MATRIX_REPAIR_FAULT 缺少 packageName/packageVersion/tarball 或 tarball 不存在。'] };
    }
    repairFault = { ...parsed, tarball: path.resolve(parsed.tarball) };
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceRoot = path.resolve(env.T17_MATRIX_EVIDENCE_ROOT ?? path.join(workRoot, 'evidence-' + runId));
  if (evidenceRoot === REPO_ROOT || evidenceRoot.startsWith(REPO_ROOT + path.sep)) {
    return { ok: false, missing: [], notes: ['T17_MATRIX_EVIDENCE_ROOT 必须位于仓库之外。'] };
  }
  if (path.resolve(evidenceRoot) === path.resolve(workRoot)) {
    return { ok: false, missing: [], notes: ['证据根不能等于工作根（避免把运行文件混入证据目录）。'] };
  }

  const npmCli = path.resolve(env.T17_MATRIX_NPM_CLI ?? defaultNpmCli());
  if (!existsSync(npmCli)) {
    notes.push('未找到 npm-cli.js（' + npmCli + '）；安装类用例会 blocked，需通过 T17_MATRIX_NPM_CLI 指定固定 npm。');
  }

  const value: MatrixEnv = {
    workRoot,
    evidenceRoot,
    baselineRoot: path.resolve(env.T17_MATRIX_BASELINE_ROOT ?? path.join(workRoot, 'baselines')),
    apiBase: env.T17_MATRIX_API_BASE!,
    registryBase: env.T17_MATRIX_REGISTRY_BASE!,
    variantsPath: path.resolve(env.T17_MATRIX_VARIANTS!),
    frozenBundleDir: bundleDir,
    cliTarball: path.resolve(env.PHASE3_CLI_TARBALL!),
    apiToken: env.ZHINEXUS_API_TOKEN!,
    registryToken: env.ZHINEXUS_REGISTRY_TOKEN!,
    pnpmBin: env.T17_MATRIX_PNPM_BIN ?? 'pnpm',
    npmCli,
    acceptBaselines: env.T17_MATRIX_ACCEPT_BASELINES === '1',
    keepCases: env.T17_MATRIX_KEEP_CASES === '1',
    ...(repairFault ? { repairFault } : {}),
  };
  return { ok: true, value };
}
