// 装饰器元数据多 polyfill：本模块会被集成测试直接加载（不经过 app.ts），
// 缺它时 @Controller/@Get 在模块求值阶段就会抛错。与 app.ts 的首行一致，幂等无害。
import 'reflect-metadata';
import { Controller, Get, Headers, Inject, Req, Res } from '@nestjs/common';
import { validateComponentMatchQuery, type ComponentMatchQueryV1, type ValidationResult } from '@company/contracts';
import { Platform } from '../platform.js';
import { PlatformError } from '../errors.js';
import { ComponentQueryService } from './component-query.js';

/**
 * 二期 P1：`GET /v1/matching/components` HTTP 适配层。
 *
 * 边界（与 `docs/specs/2026-11-16-phase2-query-completion-design.md` 一致）：
 * - 无 body、Bearer `read`；`Cache-Control: no-store`、`X-Robots-Tag: noindex, nofollow`；
 * - **原始 query 串整串解析**：不读框架 query 对象（它可能丢弃重复值或静默取末值），
 *   保留全部键，做合法的一次百分号解码，解码后再检查重复键；
 * - 拒绝：畸形编码、重复原始键、重复解码后键、未知键、数组/嵌套键、无等号片段、空片段、
 *   空值、范围/不完整版本；不使用首值/末值覆盖；
 * - 非法一律 400 `INVALID_SCHEMA`，且不带任何服务端内部细节。
 */

const ALLOWED_KEYS = ['componentId', 'framework', 'packageVersion', 'packageName', 'frameworkVersion', 'echartsVersion', 'reactDomVersion'] as const;

const invalid = (path: string, message: string): ValidationResult<ComponentMatchQueryV1> =>
  ({ ok: false, issues: [{ code: 'INVALID_SCHEMA', path, message }] });

/** 合法一次百分号解码：`+` 视为空格，`%XX` 解码一次；畸形序列返回 null。 */
function decodeOnce(raw: string): string | null {
  try { return decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { return null; }
}

/** 从原始 URL 中取出 query 串（不含前导 `?`）。 */
export function rawQueryOf(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? '' : url.slice(index + 1);
}

/**
 * 解析原始 query 串为 `ComponentMatchQueryV1`。
 *
 * 顺序固定：分段 → 单次解码 → **解码后键的白名单与重复校验（在 pairs 上做，不建对象）**
 * → 结构/条件校验。
 *
 * 白名单必须落在**解码后的 pairs** 上，而不是先建一个普通对象再 `Object.keys`：
 * `record['__proto__'] = value` 会走原型 setter，既不留下自有键、也不会进白名单，
 * 于是这个参数被静默丢掉而不是被拒绝。
 *
 * 因此 `?a=1&a=2`（重复原始键）与 `?a=1&a%49d=2`（重复解码后键）都报「查询参数重复」，
 * 不会被任何解析器静默收敛成一个值；`%2525` 之类二次编码也不会被再次解释。
 */
export function parseComponentMatchQuery(url: string): ValidationResult<ComponentMatchQueryV1> {
  const raw = rawQueryOf(url);
  const pairs: Array<[string, string]> = [];
  if (raw.length > 0) {
    for (const segment of raw.split('&')) {
      if (segment.length === 0) return invalid('', '查询参数存在空片段');
      const separator = segment.indexOf('=');
      if (separator <= 0) return invalid('', '查询参数必须为 key=value 形式');
      const key = decodeOnce(segment.slice(0, separator));
      if (key === null) return invalid('', '查询参数名包含非法百分号编码');
      const value = decodeOnce(segment.slice(separator + 1));
      if (value === null) return invalid(`/${key}`, '查询参数值包含非法百分号编码');
      pairs.push([key, value]);
    }
  }
  const seen = new Set<string>();
  for (const [key] of pairs) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) return invalid(`/${key}`, '未知查询参数');
    if (seen.has(key)) return invalid(`/${key}`, '查询参数重复');
    seen.add(key);
  }
  const record: Record<string, unknown> = {};
  for (const [key, value] of pairs) record[key] = value;
  return validateComponentMatchQuery(record);
}

@Controller('v1/matching')
export class ComponentQueryController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  @Get('components')
  query(@Headers('authorization') auth: string | undefined,
    @Req() request: { requestId: string; originalUrl?: string; url?: string },
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const parsed = parseComponentMatchQuery(request.originalUrl ?? request.url ?? '');
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    return this.platform.run(auth, 'read', request.requestId, (context, _uploads, db) =>
      new ComponentQueryService(db, this.platform.store).query(parsed.value, context.principal.subject));
  }
}
