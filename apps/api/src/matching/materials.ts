import { createHash } from 'node:crypto';
import {
  validateApiMessage, validateComponentApi,
  type ComponentApiV1, type MatchGap, type ProjectContext,
} from '@company/contracts';
import { eligibleRelease, type CurrentCandidateSnapshot } from '../search/eligibility.js';
import { PlatformError } from '../errors.js';

/**
 * 装配 POST 与组件精确查询 GET 共享的资格/静态材料内部 helper。
 *
 * 边界（与 `docs/specs/2026-11-16-phase2-query-completion-design.md` 一致）：
 * - 只做**权威元数据复读**与**冻结材料摘要校验**：不加载 SDK 运行时代码、不构建、不跑浏览器；
 * - `resolveRelease` 复用 `eligibleRelease`，因此索引状态、Top-50 文本检索、组件命名拼接都不参与判定；
 * - `readApi` 逐字节核对 api/docs 摘要与字节数，再校验 `ComponentApiV1` 与 target 身份一致；
 * - 存储层 `NOT_FOUND` / `DIGEST_MISMATCH` 归一为「材料不可用」（返回 null），其它故障原样上抛，
 *   绝不让基础设施错误伪装成业务缺口。
 */

export type MatchContext = { context: ProjectContext; reactDomVersion?: string };

export type MaterialRepository = { artifact(id: string, path: string): Promise<Uint8Array> };

/** 解析出的可读发布：候选、变体元数据、包元数据与快照 revision。 */
export function resolveRelease(request: MatchContext, id: string, snapshot?: CurrentCandidateSnapshot) {
  if (!snapshot?.variant || !snapshot.package) return null;
  const candidate = eligibleRelease(request.context, id, snapshot, request.reactDomVersion ? { 'react-dom': request.reactDomVersion } : {});
  if (!candidate) return null;
  const { variant, package: pkg } = snapshot;
  const checked = validateApiMessage('variantReleaseResponse', { variantReleaseId: id, variant, package: pkg, availability: 'Ready', reportSource: 'none', baselineStatus: 'unconfirmed', indexStatus: 'pending' });
  if (!checked.ok || variant.variantId !== candidate.variantId || variant.componentId !== candidate.componentId || variant.framework !== candidate.framework ||
    variant.packageName !== candidate.packageName || variant.packageVersion !== candidate.packageVersion || variant.exportName !== candidate.exportName ||
    pkg.name !== candidate.packageName || pkg.version !== candidate.packageVersion || pkg.tarball.sha256 !== candidate.packageSha256) return null;
  for (const kind of ['api', 'docs'] as const) if (!candidate.evidence.some(e => e.kind === kind && e.path === variant[kind].path && e.sha256 === variant[kind].sha256)) return null;
  return { candidate, variant, pkg, revision: snapshot.revision };
}

export type Eligible = NonNullable<ReturnType<typeof resolveRelease>>;
/** Existing automatic assembly targets promise both capabilities; ordinary npm components may omit them. */
export type AssemblyApi = ComponentApiV1 & { styleExport: string; readyMethod: string };

/** 读取并校验 api/docs 静态材料；任何不一致都返回 null（调用方据此给 `API_UNSUPPORTED`）。 */
export async function readApi(id: string, item: Eligible, repository: MaterialRepository): Promise<AssemblyApi | null> {
  try {
    const apiBytes = await repository.artifact(id, item.variant.api.path);
    const docsBytes = await repository.artifact(id, item.variant.docs.path);
    for (const [bytes, ref] of [[apiBytes, item.variant.api], [docsBytes, item.variant.docs]] as const) {
      if (bytes.byteLength !== ref.bytes || createHash('sha256').update(bytes).digest('hex') !== ref.sha256) return null;
    }
    let input: unknown;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(apiBytes)); } catch { return null; }
    const checked = validateComponentApi(input);
    if (!checked.ok) return null;
    const api = checked.value;
    if (api.styleExport === undefined || api.readyMethod === undefined) return null;
    return api.componentId === item.variant.componentId && api.framework === item.variant.framework && api.exportName === item.variant.exportName && api.exportPath === item.variant.exportPath
      ? { ...api, styleExport: api.styleExport, readyMethod: api.readyMethod } : null;
  } catch (error) {
    if (error instanceof PlatformError && ['NOT_FOUND', 'DIGEST_MISMATCH'].includes(error.code)) return null;
    throw error;
  }
}

/** 查询 GET 与装配 POST 共用的固定缺口文案（与服务端既有口径一致，不回显内部细节）。 */
export const queryGap = (code: MatchGap['code'], message: string): MatchGap => ({ code, message });
