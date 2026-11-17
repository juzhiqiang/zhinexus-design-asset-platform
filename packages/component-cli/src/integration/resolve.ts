import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IntegrationConflict, LocalProjectInspectionV1 } from '../contracts/integration-plan.js';
import type { MatchPlanV1, MatchTarget } from '../contracts/match-plan.js';
import { isDirectory, isFile, isInsideDirectory, realpathOrSelf } from './workspace.js';
import { inspectProject } from './inspect.js';

/**
 * T15 P1 plan 阶段本地侧解析：识别目标项目、核对 MatchPlan 与本地实际宿主/importer/精确版本的
 * 一致性，并标出无需网络即可确定的冲突。
 *
 * 只读边界：复用 inspectProject 的同一套只读约束（固定 argv/cwd 的 Git 子进程、禁 optional locks/
 * fsmonitor/外部 diff/textconv、清除 Git 环境覆盖、屏蔽用户 filter driver、禁 submodule 递归、
 * 固定 stage 枚举发现 gitlink、`--no-lazy-fetch`）；本模块自身不发起任何网络请求，不写目标项目。
 */

/** 默认未来源码位置：相对目标包，且计划内路径统一相对项目根。 */
export const DEFAULT_OUTPUT_DIR = 'src/components/zhinexus';
/** 生成文件名前缀与序号宽度（按元素输入顺序）。 */
const GENERATED_PREFIX = 'component-';
const GENERATED_DIGITS = 4;

export type MappedElement = { instanceId: string; target: MatchTarget };

export type PlannedTarget = {
  target: MatchTarget;
  /** 该目标是否需要读取 registry 材料（同名不同精确版本冲突时为 false）。 */
  readable: boolean;
};

export type LocalPlanResolution = {
  inspection: LocalProjectInspectionV1;
  conflicts: IntegrationConflict[];
  /** 去重后需要权威 GET 的目标身份，按首次出现顺序。 */
  queries: PlannedTarget[];
  /** 输入顺序的 mapped 元素（用于按顺序生成组件文件）。 */
  mappedElements: MappedElement[];
  /** 折算为项目相对时的前缀（workspace 为 '.' 时为空）。 */
  workspacePrefix: string;
  /** 目标 manifest 与锁的项目相对路径。 */
  manifestPath: string;
  lockPath?: string;
  /** 项目原生可预览的脚本名。 */
  nativeScripts: string[];
  /** 本地已锁的精确版本（name → version）。 */
  lockedVersions: Map<string, string>;
};

function addConflict(
  conflicts: IntegrationConflict[],
  code: IntegrationConflict['code'],
  message: string,
  extra?: { path?: string; instanceId?: string },
): void {
  if (conflicts.some(c => c.code === code && c.message === message && c.instanceId === extra?.instanceId && c.path === extra?.path)) return;
  conflicts.push({
    code, message, blocking: true,
    ...(extra?.path !== undefined ? { path: extra.path } : {}),
    ...(extra?.instanceId !== undefined ? { instanceId: extra.instanceId } : {}),
  });
}

/** 输出目录词法校验：拒绝空、绝对、`.`/`..` 段、空段与 Windows 非法字符。 */
export function normalizeOutputDir(outputDir: string): { ok: true; value: string } | { ok: false } {
  const value = outputDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!value) return { ok: false };
  for (const segment of value.split('/')) {
    if (!segment || segment === '.' || segment === '..') return { ok: false };
    if (/[%*#<>|"\u0000-\u001f]/.test(segment)) return { ok: false };
    if (segment.endsWith('.') || segment.endsWith(' ')) return { ok: false };
  }
  return { ok: true, value };
}

/** 拟生成组件文件的项目相对路径（按输入顺序编号）。 */
export function generatedPathFor(
  workspacePrefix: string,
  outputDir: string,
  index: number,
  framework: 'vue' | 'react',
): string {
  const extension = framework === 'vue' ? '.vue' : '.tsx';
  return `${workspacePrefix}${outputDir}/${GENERATED_PREFIX}${String(index).padStart(GENERATED_DIGITS, '0')}${extension}`;
}

/**
 * 解析路径的真实位置：逐段解析链接（含 Windows junction）；对尚不存在的尾部，
 * 先解析最近的已存在祖先后把剩余段拼回。这样“父目录已是指向项目外的链接、文件本身还没生成”
 * 也能在生成之前判定真实落点，而不是只做词法 path.relative。
 */
export function realPathOf(absolute: string): string {
  const lexical = path.resolve(absolute);
  let current = lexical;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return missing.length === 0 ? real : path.join(real, ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return lexical;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * 逐个 mapped 元素解析未来源码位置：先按真实位置判定边界，
 * 已存在且落在项目内则 OUTPUT_EXISTS（不覆盖），经链接逃逸出项目根则 PATH_UNSAFE。
 */
export function resolveGeneratedPaths(
  root: string,
  resolution: LocalPlanResolution,
  outputDir: string,
  elements: readonly MappedElement[],
): { paths: { instanceId: string; path: string; framework: 'vue' | 'react' }[]; conflicts: IntegrationConflict[] } {
  const conflicts: IntegrationConflict[] = [];
  const realRoot = realpathOrSelf(path.resolve(root));
  const paths = elements.map((element, index) => {
    const relative = generatedPathFor(resolution.workspacePrefix, outputDir, index + 1, element.target.framework);
    const absolute = path.join(realRoot, ...relative.split('/'));
    if (!isInsideDirectory(realRoot, realPathOf(absolute))) {
      // 拟生成路径经链接落到项目外：既不覆盖本地文件，也不在外部留下任何生成物。
      addConflict(conflicts, 'PATH_UNSAFE', `拟生成路径的 realpath 逃逸出项目根：${relative}`, { path: relative, instanceId: element.instanceId });
    } else if (isFile(absolute) || isDirectory(absolute)) {
      addConflict(conflicts, 'OUTPUT_EXISTS', `拟生成的组件文件已存在，不覆盖：${relative}`, { path: relative, instanceId: element.instanceId });
    }
    return { instanceId: element.instanceId, path: relative, framework: element.target.framework };
  });
  return { paths, conflicts };
}

export async function resolveLocalPlan(
  root: string,
  matchPlan: MatchPlanV1,
  workspace?: string,
): Promise<LocalPlanResolution> {
  const inspection = await inspectProject(root, workspace !== undefined ? { workspace } : undefined);
  const conflicts: IntegrationConflict[] = [...inspection.conflicts];
  const workspacePrefix = inspection.workspace === '.' ? '' : `${inspection.workspace}/`;
  const manifestPath = inspection.workspace === '.' ? 'package.json' : `${inspection.workspace}/package.json`;
  const lockPath = inspection.lockfile?.path;
  const nativeScripts = [...inspection.scripts];
  const lockedVersions = new Map<string, string>();
  for (const dependency of inspection.resolvedDependencies) lockedVersions.set(dependency.name, dependency.version);

  // 输入 MatchPlan 的缺口必须原样保留为冲突，不得吞掉。
  for (const gap of matchPlan.gaps) addConflict(conflicts, gap.code, gap.message);
  for (const element of matchPlan.elements) {
    for (const gap of element.gaps) addConflict(conflicts, gap.code, gap.message, { instanceId: element.instanceId });
  }

  // 上下文与本地实际宿主必须一致；缺 ECharts 时不得凭空补版本。
  const context = matchPlan.context;
  if (inspection.framework === undefined || context.framework !== inspection.framework) {
    addConflict(conflicts, 'MATCH_CONTEXT_MISMATCH',
      inspection.framework === undefined
        ? `无法确认目标项目框架，MatchPlan 声明为 ${context.framework}`
        : `MatchPlan 框架 ${context.framework} 与目标项目 ${inspection.framework} 不一致`);
  }
  if (inspection.packageManager === undefined || context.packageManager !== inspection.packageManager) {
    addConflict(conflicts, 'MATCH_CONTEXT_MISMATCH',
      inspection.packageManager === undefined
        ? `无法确认目标项目包管理器，MatchPlan 声明为 ${context.packageManager}`
        : `MatchPlan 包管理器 ${context.packageManager} 与目标项目 ${inspection.packageManager} 不一致`);
  }
  if (inspection.framework !== undefined) {
    const hostVersion = lockedVersions.get(context.framework);
    if (hostVersion === undefined || hostVersion !== context.frameworkVersion) {
      addConflict(conflicts, 'MATCH_CONTEXT_MISMATCH',
        hostVersion === undefined
          ? `目标项目未锁 ${context.framework}，无法确认 MatchPlan 声明的 ${context.frameworkVersion}`
          : `MatchPlan ${context.framework} 版本 ${context.frameworkVersion} 与目标项目已锁版本 ${hostVersion} 不一致`);
    }
  }
  const lockedEcharts = lockedVersions.get('echarts');
  if (lockedEcharts !== undefined && context.echartsVersion !== undefined && context.echartsVersion !== lockedEcharts) {
    addConflict(conflicts, 'MATCH_CONTEXT_MISMATCH', `MatchPlan ECharts 版本 ${context.echartsVersion} 与目标项目已锁版本 ${lockedEcharts} 不一致`);
  }
  if (lockedEcharts === undefined && context.echartsVersion === undefined) {
    // 本地未锁、MatchPlan 也未给明确候选：不能凭空补“最新版本”。
    addConflict(conflicts, 'ECHARTS_MISSING', '目标项目未锁 ECharts，且 MatchPlan 未给出明确候选版本，无法确定精确组合');
  }

  // 目标身份：按首次出现顺序去重；同名不同精确依赖不静默升级已锁宿主。
  const queries: PlannedTarget[] = [];
  const mappedElements: MappedElement[] = [];
  const seenTargets = new Set<string>();
  for (const element of matchPlan.elements) {
    if (element.status !== 'mapped' || !element.target) continue;
    mappedElements.push({ instanceId: element.instanceId, target: element.target });
    if (seenTargets.has(element.target.variantReleaseId)) continue;
    seenTargets.add(element.target.variantReleaseId);
    const locked = lockedVersions.get(element.target.packageName);
    const readable = locked === undefined || locked === element.target.packageVersion;
    if (!readable) {
      addConflict(conflicts, 'VERSION_MISMATCH',
        `目标项目已锁 ${element.target.packageName}@${locked}，与所选组件要求的 ${element.target.packageVersion} 不同；不静默升级已锁宿主`,
        { instanceId: element.instanceId });
    }
    queries.push({ target: element.target, readable });
  }

  // 拟修改的已有文件若有未提交改动则显式冲突（其他脏文件仅记录，不阻塞）。
  if (inspection.git.status === 'dirty') {
    const dirtyKeys = new Set(inspection.git.dirtyPaths.map(entry => entry.normalize('NFC').toLowerCase()));
    for (const candidate of [manifestPath, ...(lockPath !== undefined ? [lockPath] : [])]) {
      if (dirtyKeys.has(candidate.normalize('NFC').toLowerCase())) {
        addConflict(conflicts, 'DIRTY_TARGET', `拟修改的目标文件存在未提交改动：${candidate}`, { path: candidate });
      }
    }
  }

  return {
    inspection, conflicts, queries, mappedElements, workspacePrefix, manifestPath, lockPath,
    nativeScripts, lockedVersions,
  };
}
