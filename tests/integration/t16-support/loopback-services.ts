/**
 * T16 B / P1 产品 RED 辅助：本地 loopback API / registry 与 synthetic 凭据。
 *
 * 依据 docs/plans/2026-11-18-t16-b-install-isolation-brief.md：
 * - API 与 registry 是两个独立的 loopback 服务（127.0.0.1 随机端口）；
 * - 只使用明确的 synthetic 凭据，两套凭据分别只发往各自 origin，便于断言不互传；
 * - 记录每个请求的目标、query 与 Authorization，供“请求目标和认证分别检查”使用；
 * - 不连接任何公司环境，不访问外网。
 *
 * 本文件不是 Vitest 用例（不匹配 `*.test.ts`），仅被三份产品测试共用。
 */
import * as http from 'node:http';
import { PACKAGE_VERSION, tarballBytes, tarballFileName, tarballIntegrity, tarballShasum } from './synthetic-projects.js';

export const SYNTHETIC_API_TOKEN = 't16-synthetic-api-token';
export const SYNTHETIC_REGISTRY_TOKEN = 't16-synthetic-registry-token';

export type SyntheticRequest = {
  kind: 'api' | 'registry';
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | undefined;
};

export type SyntheticNetwork = {
  apiOrigin: string;
  registryOrigin: string;
  apiToken: string;
  registryToken: string;
  requests: SyntheticRequest[];
  /** 权威 GET 响应体；测试可随时替换以模拟发布变化/撤权。 */
  apiResponder: (query: Record<string, string>) => unknown;
  /** registry tarball 实发 bytes；测试可替换以模拟 bytes 损坏。 */
  tarballProvider: (name: string, version: string) => Buffer;
  close: () => Promise<void>;
};

function queryOf(url: string | undefined): Record<string, string> {
  const parsed = new URL(url ?? '/', 'http://127.0.0.1');
  const query: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) query[key] = value;
  return query;
}

function listen(server: http.Server): Promise<string> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '');
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * 拆解 registry 请求路径：`/<name>` 为 packument，`/<name>/-/<file>` 为 tarball。
 *
 * 以 `/​-/` 分隔符切分，而不是按段数猜：scope 包的 `/` 必须原样保留，
 * 因此同时支持未编码 `/@company/charts-vue` 与编码 `/@company%2Fcharts-vue`，
 * 且不会重复补 `@`、不会把 scope 截断。
 */
function registryTarget(pathname: string):
  | { kind: 'packument'; name: string }
  | { kind: 'tarball'; name: string; file: string }
  | undefined {
  const raw = pathname.replace(/^\/+/, '');
  if (raw.length === 0) return undefined;
  const separator = raw.indexOf('/-/');
  const encodedName = separator < 0 ? raw : raw.slice(0, separator);
  const encodedFile = separator < 0 ? undefined : raw.slice(separator + 3);
  const name = decodeSegment(encodedName);
  if (name === undefined || name.length === 0) return undefined;
  if (separator < 0) return { kind: 'packument', name };
  // 出现 `/​-/` 分隔符就必须是完整 tarball 路径；文件名缺失一律按未知路径拒绝。
  const file = decodeSegment(encodedFile ?? '');
  if (file === undefined || file.length === 0) return undefined;
  return { kind: 'tarball', name, file };
}

export async function startSyntheticNetwork(): Promise<SyntheticNetwork> {
  const requests: SyntheticRequest[] = [];
  const network: SyntheticNetwork = {
    apiOrigin: '',
    registryOrigin: '',
    apiToken: SYNTHETIC_API_TOKEN,
    registryToken: SYNTHETIC_REGISTRY_TOKEN,
    requests,
    apiResponder: () => ({ schemaVersion: 1, status: 'gap', exactDependencies: [], gaps: [] }),
    tarballProvider: (name, version) => tarballBytes(name, version),
    close: async () => {
      await Promise.all([close(apiServer), close(registryServer)]);
    },
  };

  const apiServer = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    requests.push({
      kind: 'api', method: request.method ?? 'GET', path: pathname,
      query: queryOf(request.url), authorization: readAuthorization(request),
    });
    let body: unknown;
    try {
      body = network.apiResponder(queryOf(request.url));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'synthetic responder failure', detail: String(error) }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  });

  const registryServer = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    requests.push({
      kind: 'registry', method: request.method ?? 'GET', path: pathname,
      query: queryOf(request.url), authorization: readAuthorization(request),
    });
    const target = registryTarget(pathname);
    if (!target) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'synthetic registry: unknown path' }));
      return;
    }
    if (target.kind === 'packument') {
      const tarball = `${network.registryOrigin}/${target.name}/-/${tarballFileName(target.name, PACKAGE_VERSION)}`;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        name: target.name,
        'dist-tags': { latest: PACKAGE_VERSION },
        versions: {
          [PACKAGE_VERSION]: {
            name: target.name, version: PACKAGE_VERSION,
            dist: { tarball, integrity: tarballIntegrity(target.name, PACKAGE_VERSION), shasum: tarballShasum(target.name, PACKAGE_VERSION) },
          },
        },
      }));
      return;
    }
    const base = target.name.startsWith('@') ? target.name.slice(target.name.indexOf('/') + 1) : target.name;
    const prefix = `${base}-`;
    if (!target.file.startsWith(prefix) || !target.file.endsWith('.tgz')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'synthetic registry: unexpected tarball name' }));
      return;
    }
    const version = target.file.slice(prefix.length, -'.tgz'.length);
    const bytes = network.tarballProvider(target.name, version);
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(bytes);
  });

  network.apiOrigin = await listen(apiServer);
  network.registryOrigin = await listen(registryServer);
  return network;
}

function readAuthorization(request: http.IncomingMessage): string | undefined {
  const value = request.headers['authorization'];
  return typeof value === 'string' ? value : undefined;
}

export function requestsTo(network: SyntheticNetwork, kind: 'api' | 'registry'): SyntheticRequest[] {
  return network.requests.filter(request => request.kind === kind);
}

export function authorizationHeaders(network: SyntheticNetwork, kind: 'api' | 'registry'): (string | undefined)[] {
  return requestsTo(network, kind).map(request => request.authorization);
}
