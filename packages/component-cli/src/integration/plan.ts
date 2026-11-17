import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '../contracts/schema.js';
import { validateIntegrationPlan } from '../contracts/integration-plan.js';
import type {
  IntegrationChange,
  IntegrationCommand,
  IntegrationConflict,
  IntegrationDependency,
  IntegrationFileSnapshot,
  IntegrationPlanV1,
  LocalProjectInspectionV1,
} from '../contracts/integration-plan.js';
import { validateComponentMatchResponse, type ComponentMatchResponseV1 } from '../contracts/component-match.js';
import type { MatchPlanV1, MatchTarget } from '../contracts/match-plan.js';
import {
  DEFAULT_OUTPUT_DIR,
  normalizeOutputDir,
  realPathOf,
  resolveGeneratedPaths,
  resolveLocalPlan,
  type LocalPlanResolution,
  type MappedElement,
} from './resolve.js';
import {
  fetchComponentMatch,
  fetchPackageDigest,
  REGISTRY_ERROR_CODES,
  type PackageDigestExpectation,
  type PackageDigestRead,
  type RegistryCredentials,
  type RegistryEndpoints,
} from './registry.js';
import { isInsideDirectory, realpathOrSelf } from './workspace.js';

/**
 * T15 P1 接入计划编排。
 *
 * 冻结接口（docs/superpowers/plans/2026-11-16-phase3-t15-kickoff.md P1）：
 * `planIntegration(root, matchPlan, options): Promise<IntegrationPlanV1>`。
 *
 * 行为边界：只读目标项目与远端材料，输出结构化 IntegrationPlanV1；
 * `executionAuthorized` 恒为 false，不构成安装/写入授权；不创建源码/目录/备份/缓存，
 * 不执行安装/构建/项目脚本/浏览器；凭据只在内存请求中使用；结构化冲突以 status
 * `conflicted` 返回，执行错误（参数/JSON/读取/网络）抛出由调用方映射为 exit 1。
 */

export type PlanOptions = {
  workspace?: string;
  /** 未来源码位置，相对目标包；不是本轮 JSON 的输出路径。 */
  outputDir?: string;
  apiUrl: string;
  registryUrl: string;
  apiToken?: string;
  registryToken?: string;
  requestTimeoutMs?: number;
};

/**
 * 计划执行错误（调用方映射为 CLI exit 1）。`code` 为稳定标识，消息不得包含任何凭据。
 * 结构化冲突不走这里——那些以 status `conflicted` 的计划返回（exit 2）。
 */
export const INTEGRATION_PLAN_ERROR_CODES = [
  'NOT_IMPLEMENTED',
  'INVALID_SCHEMA',
  ...REGISTRY_ERROR_CODES,
] as const;

export type IntegrationPlanErrorCode = typeof INTEGRATION_PLAN_ERROR_CODES[number];

export class IntegrationPlanError extends Error {
  readonly code: IntegrationPlanErrorCode;

  constructor(code: IntegrationPlanErrorCode, message: string) {
    super(message);
    this.name = 'IntegrationPlanError';
    this.code = code;
  }
}

type TargetRead = {
  target: MatchTarget;
  response: ComponentMatchResponseV1;
  /** 该包是否需要 registry 材料核对（同名不同精确版本冲突时为 false）。 */
  readable: boolean;
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

/**
 * 权威 GET 的 query：完整字段 + packageName 绑定已选包。
 *
 * ECharts 版本以 MatchPlan 声明为准；声明省略时**不得发送空值**——用本地 inspected lock 已锁的
 * 精确版本形成真实查询（来源仍是本地已证实的锁，不是凭空补“最新版”）。省略本身与本地已锁值
 * 不一致属于上下文冲突，由 resolveLocalPlan 记 MATCH_CONTEXT_MISMATCH，这里不伪造一致性。
 */
function matchQuery(
  target: MatchTarget,
  context: MatchPlanV1['context'],
  reactDomVersion: string | undefined,
  lockedEcharts?: string,
): Record<string, string> {
  const query: Record<string, string> = {
    componentId: target.componentId,
    framework: target.framework,
    packageName: target.packageName,
    packageVersion: target.packageVersion,
    frameworkVersion: context.frameworkVersion,
    echartsVersion: context.echartsVersion ?? lockedEcharts ?? '',
  };
  if (target.framework === 'react') query.reactDomVersion = reactDomVersion ?? '';
  return query;
}

/**
 * 发布证据里的 gap 消息是远端可控文本（可能夹带凭据或内部信息）：只保留稳定 code，用固定措辞
 * 描述；target/api/依赖等其余证据一律原样保留，不为了脱敏删空证据或丢 gap code。
 */
function sanitizePublicationResponse(response: ComponentMatchResponseV1): ComponentMatchResponseV1 {
  if (response.gaps.length === 0) return response;
  return {
    ...response,
    gaps: response.gaps.map(gap => ({ code: gap.code, message: `权威响应返回 gap：${gap.code}` })),
  };
}

/**
 * 影响识别但基线时刻可能尚不存在的探测路径（相对项目根）：一律先建立基准，
 * 规划期间出现/变化即 PROJECT_CHANGED。plan 自行探测，不改 inspection 的已冻结输出。
 */
const PROBE_PATHS = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
] as const;

function snapshotOf(root: string, relative: string): IntegrationFileSnapshot {
  const absolute = path.join(root, ...relative.split('/'));
  // 先解析真实位置：无法证明落在项目内（含链接声明解析不到真实路径）的路径一律不读取、不记录摘要。
  const real = realPathOf(absolute);
  if (!real.ok || !isInsideDirectory(root, real.real)) return { path: relative, exists: false };
  if (!fs.existsSync(absolute)) return { path: relative, exists: false };
  const bytes = fs.readFileSync(absolute);
  return { path: relative, exists: true, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function planIntegration(
  root: string,
  matchPlan: MatchPlanV1,
  options: PlanOptions,
): Promise<IntegrationPlanV1> {
  const endpoints: RegistryEndpoints = {
    apiUrl: options.apiUrl,
    registryUrl: options.registryUrl,
    ...(options.requestTimeoutMs !== undefined ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
  };
  const credentials: RegistryCredentials = {
    ...(options.apiToken !== undefined ? { apiToken: options.apiToken } : {}),
    ...(options.registryToken !== undefined ? { registryToken: options.registryToken } : {}),
  };
  const realRoot = realpathOrSelf(path.resolve(root));

  // ① 本地解析：识别 + 与 MatchPlan 的本地一致性 + 脏目标（无网络）。
  const resolution: LocalPlanResolution = await resolveLocalPlan(root, matchPlan, options.workspace);
  const conflicts: IntegrationConflict[] = [...resolution.conflicts];
  const outputDir = normalizeOutputDir(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  if (!outputDir.ok) {
    addConflict(conflicts, 'PATH_UNSAFE', `--output-dir 不是合法的项目相对目录：${options.outputDir ?? ''}`);
  }
  const effectiveOutputDir = outputDir.ok ? outputDir.value : DEFAULT_OUTPUT_DIR;
  const inspection: LocalProjectInspectionV1 = resolution.inspection;
  const context = matchPlan.context;
  const reactDomVersion = resolution.lockedVersions.get('react-dom');
  // MatchPlan 省略 ECharts 版本时，用本地 inspected lock 已锁的精确版本形成真实查询（不发空值）。
  const lockedEcharts = resolution.lockedVersions.get('echarts');

  // ② 复读基准：在任何网络请求之前取关键文件的原始字节快照，供结束后检测并发编辑。
  // 除识别快照与目标清单/锁外，还包括影响识别但可能尚不存在的探测路径（以 exists:false 建立基准）。
  const keyFiles = new Set<string>([
    ...inspection.fileSnapshots.map(entry => entry.path),
    resolution.manifestPath,
    ...(resolution.lockPath !== undefined ? [resolution.lockPath] : []),
    ...PROBE_PATHS,
  ]);
  const baseline = new Map<string, IntegrationFileSnapshot>();
  for (const relative of keyFiles) baseline.set(relative, snapshotOf(realRoot, relative));

  // ③ 权威 GET：按去重后的目标身份逐个查询（同包多实例只查一次）。
  // 本地识别本身未通过时无法判定哪些依赖是“新增”，也无法形成一致计划：不作远端核对，
  // 只把识别冲突原样带出（避免为了一个无法识别的项目去下载材料）。
  const reads: TargetRead[] = [];
  const remoteVerifiable = inspection.status === 'inspected';
  for (const entry of remoteVerifiable ? resolution.queries : []) {
    const fetched = await fetchComponentMatch(endpoints, credentials, matchQuery(entry.target, context, reactDomVersion, lockedEcharts));
    if (!fetched.ok) throw new IntegrationPlanError(fetched.code, fetched.message);
    const checked = validateComponentMatchResponse(fetched.body);
    if (!checked.ok) {
      addConflict(conflicts, 'API_MISMATCH', `权威组件匹配响应未通过契约校验：${checked.issues.map(i => `${i.path} ${i.message}`).join('; ')}`);
      continue;
    }
    const response = checked.value;
    // 响应 query 必须与请求身份逐字段一致（含 packageName 绑定）。
    const requested = matchQuery(entry.target, context, reactDomVersion, lockedEcharts);
    const mismatched = Object.entries(requested).filter(([key, value]) => (response.query as unknown as Record<string, unknown>)[key] !== value);
    if (mismatched.length > 0) {
      addConflict(conflicts, 'MATCH_CONTEXT_MISMATCH',
        `权威响应 query 与请求身份不符：${mismatched.map(([key, value]) => `${key} 期望 ${value}`).join('; ')}`);
      continue;
    }
    if (response.status === 'gap') {
      // 远端 gap 消息是远端可控文本，可能夹带凭据或内部信息：只保留稳定 code，用固定措辞描述。
      for (const gap of response.gaps) addConflict(conflicts, gap.code, `权威响应返回 gap：${gap.code}`);
      continue;
    }
    if (!response.target) {
      addConflict(conflicts, 'TARGET_UNAVAILABLE', '权威响应缺少 target');
      continue;
    }
    reads.push({ target: entry.target, response, readable: entry.readable });
  }

  // ④ 权威 API 与离线元素的完整交叉核对：名称/type/required/payload、成员完整性、source/handler。
  for (const element of matchPlan.elements) {
    if (element.status !== 'mapped' || !element.target) continue;
    const read = reads.find(entry => entry.target.variantReleaseId === element.target!.variantReleaseId);
    if (!read?.response.target) continue;
    // 权威 target 必须与离线计划的 target 完全一致（身份/摘要/接口/证据）。
    if (canonicalJson(read.response.target) !== canonicalJson(element.target)) {
      addConflict(conflicts, 'TARGET_CHANGED', `权威 target 与离线计划不一致：${element.instanceId}`, { instanceId: element.instanceId });
      continue;
    }
    if (!read.response.api) continue;
    const api = read.response.api;
    const problems: string[] = [];
    for (const expected of element.props) {
      const actual = api.props.find(prop => prop.name === expected.name);
      if (!actual) { problems.push(`缺少属性 ${expected.name}`); continue; }
      if (actual.type !== expected.type) problems.push(`属性 ${expected.name} 类型 ${actual.type} 与离线声明 ${expected.type} 不符`);
      if (actual.required !== expected.required) problems.push(`属性 ${expected.name} 的 required 与权威 API 不符`);
    }
    for (const actual of api.props) {
      if (!element.props.some(expected => expected.name === actual.name)) problems.push(`权威 API 存在离线计划未声明的属性 ${actual.name}`);
    }
    for (const expected of element.events) {
      const actual = api.events.find(event => event.name === expected.name);
      if (!actual) { problems.push(`缺少事件 ${expected.name}`); continue; }
      if (actual.payload !== expected.payload) problems.push(`事件 ${expected.name} 的 payload ${actual.payload} 与离线声明 ${expected.payload} 不符`);
    }
    for (const actual of api.events) {
      if (!element.events.some(expected => expected.name === actual.name)) problems.push(`权威 API 存在离线计划未声明的事件 ${actual.name}`);
    }
    for (const expected of element.props) {
      if (expected.required && expected.source === undefined) problems.push(`必填属性 ${expected.name} 缺少数据源`);
    }
    for (const expected of element.events) {
      if (expected.handler === undefined) problems.push(`事件 ${expected.name} 缺少处理函数`);
    }
    if (problems.length > 0) {
      addConflict(conflicts, 'API_MISMATCH', `权威 API 与离线计划不一致：${problems.join('; ')}`, { instanceId: element.instanceId });
    }
  }

  // ⑤ registry 材料核对：所选组件包与权威 GET 明确新增的运行时依赖，全部下载并复算摘要
  // （同包多实例只读一次）。必须在最终复读之前全部结束，否则下载期间的撤权/编辑会漏检。
  const exactDependencies: IntegrationDependency[] = [];
  const seenDependency = new Set<string>();
  const pushDependency = (name: string, version: string): void => {
    const key = `${name}@${version}`;
    if (seenDependency.has(key)) return;
    seenDependency.add(key);
    exactDependencies.push({ name, version });
  };
  for (const read of reads) {
    if (!read.readable) continue;
    for (const dependency of read.response.exactDependencies) {
      // 权威响应要求一个本地已锁但精确版本不同的依赖：显式结构化冲突，且不把该版本写进
      // exactDependencies（那正是契约禁止的“静默升级已锁依赖”）。
      const locked = resolution.lockedVersions.get(dependency.name);
      if (locked !== undefined && locked !== dependency.version) {
        addConflict(conflicts, 'DEPENDENCY_CONFLICT',
          `权威响应要求 ${dependency.name}@${dependency.version}，与目标项目已锁版本 ${locked} 不同；不静默升级已锁依赖`);
        continue;
      }
      pushDependency(dependency.name, dependency.version);
    }
  }
  const packageReads = new Map<string, Promise<PackageDigestRead>>();
  /** 同一 name@version 只读一次：重复调用返回同一次读取，不再发起请求。 */
  const readPackage = (name: string, version: string, expectation?: PackageDigestExpectation): Promise<PackageDigestRead> => {
    const key = `${name}@${version}`;
    const pending = packageReads.get(key);
    if (pending) return pending;
    const started = fetchPackageDigest(endpoints, credentials, name, version, expectation);
    packageReads.set(key, started);
    return started;
  };
  /** 所选组件包的实收摘要（用于稍后与最终复读的 target 绑定）。 */
  const packageDigests = new Map<string, { sha256: string; integrity: string }>();
  for (const read of reads) {
    const target = read.response.target!;
    if (!read.readable) continue;
    pushDependency(target.packageName, target.packageVersion);
    // 平台摘要已知：先按实收 SHA-256 归因，bytes 损坏形成结构化冲突而不是误报远端不可用。
    const digest = await readPackage(target.packageName, target.packageVersion, { expectedSha256: target.packageSha256 });
    if (!digest.ok) throw new IntegrationPlanError(digest.code, digest.message);
    packageDigests.set(target.variantReleaseId, { sha256: digest.sha256, integrity: digest.integrity });
    if (digest.sha256 !== target.packageSha256) {
      addConflict(conflicts, 'PACKAGE_DIGEST_MISMATCH',
        `registry 中 ${target.packageName}@${target.packageVersion} 的实收内容 SHA-256 与平台摘要不符`);
    }
  }
  // 新增运行时依赖（本地未锁、无平台摘要）：只有 registry 完整性声明可核对；
  // 缺声明即执行失败，不用自算摘要或 shasum 冒充已核对的证据。
  const newDependencyDigests = new Map<string, { sha256: string; integrity: string }>();
  for (const dependency of [...exactDependencies]) {
    if (resolution.lockedVersions.has(dependency.name)) continue;
    const digest = await readPackage(dependency.name, dependency.version, { requireDeclaredIntegrity: true });
    if (!digest.ok) throw new IntegrationPlanError(digest.code, digest.message);
    newDependencyDigests.set(`${dependency.name}@${dependency.version}`, { sha256: digest.sha256, integrity: digest.integrity });
  }

  // ⑥ 下载/元数据结束后复读全部唯一目标的资格/身份/摘要/API。
  const finalReads: TargetRead[] = [];
  for (const entry of resolution.queries) {
    const fetched = await fetchComponentMatch(endpoints, credentials, matchQuery(entry.target, context, reactDomVersion, lockedEcharts));
    if (!fetched.ok) throw new IntegrationPlanError(fetched.code, fetched.message);
    const checked = validateComponentMatchResponse(fetched.body);
    if (!checked.ok) {
      addConflict(conflicts, 'API_MISMATCH', `最终复读的组件匹配响应未通过契约校验：${checked.issues.map(i => `${i.path} ${i.message}`).join('; ')}`);
      continue;
    }
    const response = checked.value;
    if (response.status === 'gap') {
      // 与首次查询一致：不回显远端 gap 原文，只保留稳定 code。
      for (const gap of response.gaps) addConflict(conflicts, gap.code, `权威响应返回 gap：${gap.code}`);
      continue;
    }
    if (!response.target) {
      addConflict(conflicts, 'TARGET_UNAVAILABLE', '最终复读的权威响应缺少 target');
      continue;
    }
    const first = reads.find(entry2 => entry2.target.variantReleaseId === entry.target.variantReleaseId);
    if (first && canonicalJson(first.response) !== canonicalJson(response)) {
      addConflict(conflicts, 'TARGET_CHANGED', `目标 ${entry.target.variantReleaseId} 在下载期间发生变化`, { instanceId: entry.target.variantReleaseId });
      continue;
    }
    finalReads.push({ target: entry.target, response, readable: entry.readable });
  }

  // ⑦ 复读本地关键文件：规划期间的并发编辑必须被发现，且保留用户修改。
  for (const [relative, before] of baseline) {
    const after = snapshotOf(realRoot, relative);
    if (after.exists !== before.exists || after.sha256 !== before.sha256) {
      addConflict(conflicts, 'PROJECT_CHANGED', `规划期间目标文件发生变化：${relative}`, { path: relative });
    }
  }

  // ⑧ 只为“最终复读仍然 matched”的元素规划组件文件；按输入顺序编号。
  const matchedVariants = new Set(finalReads.map(read => read.target.variantReleaseId));
  const plannedElements: MappedElement[] = resolution.mappedElements.filter(
    element => matchedVariants.has(element.target.variantReleaseId),
  );
  const generated = resolveGeneratedPaths(realRoot, resolution, effectiveOutputDir, plannedElements);
  for (const conflict of generated.conflicts) addConflict(conflicts, conflict.code, conflict.message, conflict);

  // ⑨ 证据：平台摘要只能对“最终复读仍 matched 且摘要相符”的目标声称。
  // 同一 name@version 只保留一条：多个 variantReleaseId/逻辑组件共用同一包时（如 line/bar），
  // 契约 unique(/registryEvidence) 要求 name 唯一；各目标的发布证据仍按目标各自保留。
  const registryEvidence: IntegrationPlanV1['registryEvidence'] = [];
  const evidenceKeys = new Set<string>();
  for (const read of finalReads) {
    const target = read.response.target!;
    const digest = packageDigests.get(read.target.variantReleaseId);
    if (!read.readable || !digest || digest.sha256 !== target.packageSha256) continue;
    const evidenceKey = `${target.packageName}@${target.packageVersion}`;
    if (evidenceKeys.has(evidenceKey)) continue;
    evidenceKeys.add(evidenceKey);
    registryEvidence.push({
      name: target.packageName, version: target.packageVersion, sha256: digest.sha256, integrity: digest.integrity, verification: 'platform-sha256',
    });
  }
  // 新增运行时依赖（本地未锁、无平台摘要）：以已核对的 registry integrity 声称，不伪称平台摘要。
  // 材料已在最终复读之前全部下载，此处只复用结果，不再发起任何请求。
  for (const dependency of exactDependencies) {
    if (resolution.lockedVersions.has(dependency.name)) continue;
    if (registryEvidence.some(entry => entry.name === dependency.name && entry.version === dependency.version)) continue;
    const digest = newDependencyDigests.get(`${dependency.name}@${dependency.version}`);
    if (!digest) continue;
    registryEvidence.push({
      name: dependency.name, version: dependency.version, sha256: digest.sha256, integrity: digest.integrity, verification: 'registry-integrity',
    });
  }

  // ⑩ 组装计划。
  const newDependencies = exactDependencies.filter(dependency => !resolution.lockedVersions.has(dependency.name));
  const allowedPaths: string[] = generated.paths.map(entry => entry.path);
  const changes: IntegrationChange[] = generated.paths.map(entry => ({
    kind: 'generated-component', path: entry.path, instanceId: entry.instanceId, framework: entry.framework,
  }));
  const commands: IntegrationCommand[] = [];
  const packageManager = inspection.packageManager;
  if (packageManager !== undefined && newDependencies.length > 0 && resolution.manifestPath && resolution.lockPath) {
    allowedPaths.push(resolution.manifestPath, resolution.lockPath);
    changes.push({
      kind: 'package-json', path: resolution.manifestPath,
      dependencies: newDependencies.map(dependency => ({ name: dependency.name, version: dependency.version })),
    });
    changes.push({ kind: 'lockfile-regeneration', path: resolution.lockPath });
    commands.push({ executable: packageManager, args: ['install', '--ignore-scripts'], cwd: '.', purpose: 'install' });
  }
  if (packageManager !== undefined) {
    for (const purpose of ['typecheck', 'build'] as const) {
      if (resolution.nativeScripts.includes(purpose)) {
        commands.push({ executable: packageManager, args: ['run', purpose], cwd: inspection.workspace, purpose });
      }
    }
  }

  // ⑩.5 契约收口：任一 allowedPath 与识别到的未提交改动路径（NFC/大小写不敏感键）相交，
  // 都必须带**同路径** DIRTY_TARGET。拟生成组件同样列入 allowedPaths，因此这里在最终
  // allowedPaths 形成后统一补齐；清单/锁在 resolveLocalPlan 中已按同一措辞记录，重复会自动去重。
  // 不删除任何 allowedPath 来规避该约束。
  if (inspection.git.status === 'dirty') {
    const dirtyKeys = new Set(inspection.git.dirtyPaths.map(entry => entry.normalize('NFC').toLowerCase()));
    for (const relative of allowedPaths) {
      if (!dirtyKeys.has(relative.normalize('NFC').toLowerCase())) continue;
      addConflict(conflicts, 'DIRTY_TARGET', `拟修改的目标文件存在未提交改动：${relative}`, { path: relative });
    }
  }

  const baseFileHashes: IntegrationFileSnapshot[] = [...inspection.fileSnapshots.map(entry => ({ ...entry }))];
  const guarded = new Set(baseFileHashes.map(entry => entry.path));
  for (const relative of new Set([
    ...allowedPaths, resolution.manifestPath,
    ...(resolution.lockPath !== undefined ? [resolution.lockPath] : []),
    // 探测路径同样需要显式守卫：基线不存在就以 exists:false 记录，不用空摘要冒充。
    ...PROBE_PATHS,
  ])) {
    if (guarded.has(relative)) continue;
    guarded.add(relative);
    baseFileHashes.push(snapshotOf(realRoot, relative));
  }

  const result: IntegrationPlanV1 = {
    schemaVersion: 1,
    stage: 'plan',
    executionAuthorized: false,
    status: conflicts.length > 0 ? 'conflicted' : 'planned',
    localProject: inspection,
    sourceMatchPlan: matchPlan,
    matchPlanDigest: createHash('sha256').update(canonicalJson(matchPlan)).digest('hex'),
    baseFileHashes,
    allowedPaths,
    ...(packageManager !== undefined ? { packageManager } : {}),
    exactDependencies,
    commands,
    changes,
    conflicts,
    // 远端 gap 消息是远端可控文本，可能夹带凭据或内部信息：保留稳定 code，用固定措辞描述。
    publicationEvidence: finalReads.map(read => ({
      response: sanitizePublicationResponse(read.response), checkedAt: new Date().toISOString(),
    })),
    registryEvidence,
  };
  // 自身守卫：产出必须通过运行时校验，否则说明实现与契约脱节，直接失败而不是交出非法计划。
  const checkedPlan = validateIntegrationPlan(result);
  if (!checkedPlan.ok) {
    throw new IntegrationPlanError('INVALID_SCHEMA',
      `planIntegration 产出未通过 IntegrationPlanV1 运行时校验：${JSON.stringify(checkedPlan.issues)}`);
  }
  return result;
}
