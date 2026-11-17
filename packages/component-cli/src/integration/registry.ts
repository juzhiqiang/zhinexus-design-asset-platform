/**
 * T15 P1 plan 阶段远端只读读取。
 *
 * 安全边界（全部对 API 与 registry 一致生效）：
 * - 地址不得含内嵌凭证（userinfo）；仅 HTTPS，或显式本地 loopback HTTP（测试用）；
 * - 不自动跟随任何重定向（`redirect: 'manual'` + 3xx/opaqueredirect 一律拒绝），因此重定向目的地零请求；
 * - 流式读取并强制 50 MiB 限额，超限即中止，不在目标项目写任何下载缓存；
 * - 请求超时上限由调用方给出；两类令牌分别注入各自请求头，互不转发，也绝不进入返回值；
 * - tarball 地址必须与配置的 registry 同 origin，packument 指向别处一律拒绝；
 * - `dist.integrity` / `dist.shasum` 必须与**实收 bytes** 实算摘要一致，否则拒绝。
 */
import { createHash } from 'node:crypto';

/** 远端读取失败的稳定 code（由 plan.ts 映射为 IntegrationPlanError）。 */
export const REGISTRY_ERROR_CODES = [
  'INVALID_ENDPOINT',
  'REQUEST_TIMEOUT',
  'DOWNLOAD_LIMIT_EXCEEDED',
  'REDIRECT_REJECTED',
  'REGISTRY_ORIGIN_MISMATCH',
  'REGISTRY_UNAVAILABLE',
] as const;

export type RegistryErrorCode = typeof REGISTRY_ERROR_CODES[number];

export type RegistryReadFailure = { ok: false; code: RegistryErrorCode; message: string };
export type ComponentMatchRead = { ok: true; body: unknown } | RegistryReadFailure;
/**
 * 摘要来源：`registry` 表示已按 registry 的 dist.integrity 声明与实收 bytes 复算一致；
 * `computed` 表示只由实收 bytes 自算（无声明可核对），不得当作已核对的声明证据。
 */
export type PackageDigestIntegritySource = 'registry' | 'computed';
export type PackageDigestRead =
  | { ok: true; sha256: string; integrity: string; integritySource: PackageDigestIntegritySource }
  | RegistryReadFailure;

/**
 * 调用方已知的核对前提：
 * - `expectedSha256`：权威平台摘要（所选组件包）。先按实收 SHA-256 归因，bytes 损坏由调用方形成
 *   结构化冲突，不被误报成远端不可用；
 * - `requireDeclaredIntegrity`：无平台摘要的新增依赖。必须由 registry 声明完整性，缺声明即失败，
 *   不允许用自算摘要或 shasum 冒充已核对的证据。
 */
export type PackageDigestExpectation = {
  expectedSha256?: string;
  requireDeclaredIntegrity?: boolean;
};

/** 远端地址与超时；令牌单独传入，避免与地址混在一处被日志化。 */
export type RegistryEndpoints = {
  apiUrl: string;
  registryUrl: string;
  requestTimeoutMs?: number;
};

/** 两类独立凭据，互不转发。 */
export type RegistryCredentials = {
  apiToken?: string;
  registryToken?: string;
};

/** 与 P0 冻结的 registryEvidence.integrity 形态一致的支持算法。 */
const SUPPORTED_INTEGRITY_ALGORITHMS = new Set(['sha256', 'sha384', 'sha512']);
/** 流式下载限额：50 MiB。 */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
/** 未显式指定时的请求超时。 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** 权威组件匹配查询路径（二期既有端点）。 */
const COMPONENT_MATCH_PATH = '/v1/matching/components';

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * 校验远端地址：必须可解析、无内嵌凭证，且为 HTTPS 或显式 loopback HTTP。
 * 返回规范化后的 URL（去掉末尾斜杠），失败时给出稳定的 INVALID_ENDPOINT。
 */
function validateEndpoint(raw: string, label: string): { ok: true; origin: string } | RegistryReadFailure {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, code: 'INVALID_ENDPOINT', message: `${label} 不是合法 URL` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: 'INVALID_ENDPOINT', message: `${label} 不得包含内嵌凭证` };
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) {
    return { ok: false, code: 'INVALID_ENDPOINT', message: `${label} 仅支持 HTTPS，或显式本地 loopback HTTP` };
  }
  return { ok: true, origin: parsed.origin };
}

/** 规范化 origin：去掉末尾斜杠，便于直接拼接路径。 */
function normalizeOrigin(raw: string): string {
  return raw.replace(/\/+$/, '');
}

function describeFetchError(error: unknown): { code: RegistryErrorCode; message: string } {
  if (error instanceof Error) {
    const name = error.name;
    if (name === 'TimeoutError' || name === 'AbortError' || name === 'ABORT_ERR') {
      return { code: 'REQUEST_TIMEOUT', message: '远端请求超时' };
    }
    // 兜底：个别运行环境把重定向包装成普通 TypeError（cause 为 unexpected redirect）。
    const cause = (error as { cause?: unknown }).cause;
    const texts = [error.message, cause instanceof Error ? cause.message : ''].join(' ');
    if (/redirect/i.test(texts)) {
      return { code: 'REDIRECT_REJECTED', message: '远端要求重定向，已按只读边界拒绝（未跟随）' };
    }
  }
  return { code: 'REGISTRY_UNAVAILABLE', message: '远端请求失败' };
}

/** 发起一次 GET：禁重定向、带超时、按用途注入对应令牌；返回原始响应体。 */
async function get(
  url: string,
  token: string | undefined,
  timeoutMs: number,
  accept: string,
): Promise<{ ok: true; response: Response } | RegistryReadFailure> {
  const headers: Record<string, string> = { accept };
  if (token) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try {
    // redirect: 'manual' 让重定向以一个可判定的 opaqueredirect 响应返回，从而在不跟随任何
    // 跳转的前提下稳定识别它；跨 origin 与同 origin 重定向一律拒绝（目的地零请求）。
    response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const described = describeFetchError(error);
    return { ok: false, code: described.code, message: `${described.message}：${new URL(url).origin}` };
  }
  // 3xx 一律拒绝：`redirect: 'manual'` 下不同运行时可能给出 opaqueredirect（status 0）或
  // 直接回显 301/302/303/307/308，两种形态都必须在跟随之前拦住（目的地零请求）。
  if (response.type === 'opaqueredirect' || response.status === 0 || (response.status >= 300 && response.status < 400)) {
    return { ok: false, code: 'REDIRECT_REJECTED', message: `远端要求重定向（HTTP ${response.status}），已按只读边界拒绝（未跟随）` };
  }
  if (!response.ok) {
    // 只回显状态码，绝不在消息里带回响应体（可能被远端注入凭据）。
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: `远端返回 HTTP ${response.status}` };
  }
  return { ok: true, response };
}

/** 流式读取响应体并强制限额；超限即取消读取。 */
async function readLimitedBody(
  response: Response,
  limit: number,
): Promise<{ ok: true; bytes: Buffer } | RegistryReadFailure> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) {
    return { ok: false, code: 'DOWNLOAD_LIMIT_EXCEEDED', message: `远端声明的内容长度 ${declared} 超过 ${limit} 字节限额` };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const chunk = Buffer.from(step.value);
      total += chunk.byteLength;
      if (total > limit) {
        await reader.cancel();
        return { ok: false, code: 'DOWNLOAD_LIMIT_EXCEEDED', message: `下载内容超过 ${limit} 字节限额` };
      }
      chunks.push(chunk);
    }
  } else {
    const bytes = Buffer.from(await response.arrayBuffer());
    total = bytes.byteLength;
    if (total > limit) {
      return { ok: false, code: 'DOWNLOAD_LIMIT_EXCEEDED', message: `下载内容超过 ${limit} 字节限额` };
    }
    chunks.push(bytes);
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}

/** 解析 `alg-base64` 形态的 integrity，并按实收 bytes 复算比对。 */
function verifyIntegrity(bytes: Buffer, claimed: string): { ok: true; integrity: string } | RegistryReadFailure {
  const separator = claimed.indexOf('-');
  if (separator <= 0) {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry dist.integrity 形态无效' };
  }
  const algorithm = claimed.slice(0, separator);
  if (!SUPPORTED_INTEGRITY_ALGORITHMS.has(algorithm)) {
    // 固定诊断：不回显远端的算法字段（该字段可能被植入敏感值）。
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry dist.integrity 声明了不支持的完整性算法' };
  }
  const actual = createDigestBase64(algorithm, bytes);
  if (actual !== claimed.slice(separator + 1)) {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry dist.integrity 与实收内容不一致' };
  }
  return { ok: true, integrity: `${algorithm}-${actual}` };
}

function createDigestBase64(algorithm: string, bytes: Buffer): string {
  return createHash(algorithm).update(bytes).digest('base64');
}

/**
 * 权威 GET 一次组件匹配；返回原始响应体，由调用方按 ComponentMatchResponseV1 校验。
 * query 由调用方给出（含 componentId/framework/packageName/packageVersion/frameworkVersion/echartsVersion/reactDomVersion）。
 */
export async function fetchComponentMatch(
  endpoints: RegistryEndpoints,
  credentials: RegistryCredentials,
  query: Record<string, string>,
): Promise<ComponentMatchRead> {
  const base = validateEndpoint(endpoints.apiUrl, 'API 地址');
  if (!base.ok) return base;
  const url = new URL(`${normalizeOrigin(base.origin)}${COMPONENT_MATCH_PATH}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const read = await get(url.toString(), credentials.apiToken, endpoints.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS, 'application/json');
  if (!read.ok) return read;
  try {
    return { ok: true, body: await read.response.json() };
  } catch {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: '远端返回内容不是合法 JSON' };
  }
}

/**
 * 读取 registry 中精确版本的元数据与 tarball，返回**实收 bytes** 的 SHA-256 与核对过的 integrity。
 * 元数据路径按精确 name/version 命中；tarball 必须与 registry 同 origin；dist.shasum 若提供须为真实 SHA-1。
 *
 * 判定顺序（item ⑤）：先算实收 SHA-256 并与调用方给出的平台摘要比对——不符即由调用方形成
 * PACKAGE_DIGEST_MISMATCH 结构化冲突，不再用声明完整性二次判定，避免把损坏的传输 bytes
 * 误报成 REGISTRY_UNAVAILABLE；相符或未给出平台摘要时，才继续核对 shasum / dist.integrity。
 */
export async function fetchPackageDigest(
  endpoints: RegistryEndpoints,
  credentials: RegistryCredentials,
  name: string,
  version: string,
  expectation?: PackageDigestExpectation,
): Promise<PackageDigestRead> {
  const base = validateEndpoint(endpoints.registryUrl, 'registry 地址');
  if (!base.ok) return base;
  const timeoutMs = endpoints.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const registryOrigin = normalizeOrigin(base.origin);
  // 直接拼接路径：scope 包的 `/` 保持字面量，与 registry 的精确 name 路径一致。
  const metadataUrl = `${registryOrigin}/${name}`;
  const metadata = await get(metadataUrl, credentials.registryToken, timeoutMs, 'application/json');
  if (!metadata.ok) return metadata;
  let packument: unknown;
  try {
    packument = await metadata.response.json();
  } catch {
    // 不回显远端原文（JSON 解析异常可能夹带响应体摘录）。
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry 元数据不是合法 JSON' };
  }
  if (!packument || typeof packument !== 'object' || Array.isArray(packument)) {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry 元数据形态无效' };
  }
  const versions = (packument as Record<string, unknown>).versions;
  const entry = versions && typeof versions === 'object' && !Array.isArray(versions)
    ? (versions as Record<string, unknown>)[version]
    : undefined;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry 元数据中不存在所请求的精确版本' };
  }
  const dist = (entry as Record<string, unknown>).dist;
  if (!dist || typeof dist !== 'object' || Array.isArray(dist)) {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry 元数据缺少所请求版本的 dist' };
  }
  const tarballRaw = (dist as Record<string, unknown>).tarball;
  const integrityRaw = (dist as Record<string, unknown>).integrity;
  const shasumRaw = (dist as Record<string, unknown>).shasum;
  if (typeof tarballRaw !== 'string' || !tarballRaw) {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry 元数据缺少 tarball 地址' };
  }
  let tarballUrl: URL;
  try {
    tarballUrl = new URL(tarballRaw);
  } catch {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry tarball 地址不是合法 URL' };
  }
  // tarball 必须与配置的 registry 同 origin：packument 指向别处一律拒绝，不发请求。
  if (tarballUrl.origin !== new URL(registryOrigin).origin) {
    return { ok: false, code: 'REGISTRY_ORIGIN_MISMATCH', message: 'registry tarball 地址与 registry 不同 origin' };
  }
  const tarball = await get(tarballUrl.toString(), credentials.registryToken, timeoutMs, 'application/octet-stream');
  if (!tarball.ok) return tarball;
  const limited = await readLimitedBody(tarball.response, MAX_DOWNLOAD_BYTES);
  if (!limited.ok) return limited;
  const bytes = limited.bytes;
  // 实收摘要先行：它是唯一不依赖远端声明的判据。
  const sha256 = createDigestHex('sha256', bytes);
  if (expectation?.expectedSha256 !== undefined && sha256 !== expectation.expectedSha256) {
    // bytes 与平台摘要不符：交回实算摘要，由调用方形成结构化冲突（不伪称任何已核对的声明）。
    return { ok: true, sha256, integrity: `sha256-${createDigestBase64('sha256', bytes)}`, integritySource: 'computed' };
  }
  if (typeof shasumRaw === 'string' && shasumRaw && shasumRaw !== createDigestHex('sha1', bytes)) {
    return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry dist.shasum 与实收内容不一致' };
  }
  if (typeof integrityRaw !== 'string' || !integrityRaw) {
    // 没有声明就无法核对：无平台摘要的新增依赖必须失败，不得用自算摘要冒充已验证证据。
    if (expectation?.requireDeclaredIntegrity) {
      return { ok: false, code: 'REGISTRY_UNAVAILABLE', message: 'registry 元数据缺少 dist.integrity，无法核对新增依赖的完整性' };
    }
    return { ok: true, sha256, integrity: `sha256-${createDigestBase64('sha256', bytes)}`, integritySource: 'computed' };
  }
  const verified = verifyIntegrity(bytes, integrityRaw);
  if (!verified.ok) return verified;
  return { ok: true, sha256, integrity: verified.integrity, integritySource: 'registry' };
}

function createDigestHex(algorithm: string, bytes: Buffer): string {
  return createHash(algorithm).update(bytes).digest('hex');
}
