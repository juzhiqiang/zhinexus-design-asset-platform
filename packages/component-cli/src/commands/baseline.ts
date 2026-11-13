import * as fs from 'node:fs/promises';
import { validateCheckReport } from '../contracts/validation.js';
import { validateApiMessage, type ApiMessages } from '../contracts/api.js';
import { computeEnvironmentKey } from '../local/environment.js';

export type AcceptBaselineOptions = {
  reportPath: string;
  reason: string;
  apiUrl?: string;
  token?: string;
  expectedRevision?: string;
  jobId?: string;
  variantId?: string;
  exampleId?: string;
  screenshotId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type AcceptBaselineResult = {
  ok: boolean;
  revisionId?: string;
  variantId?: string;
  exampleId?: string;
  environmentKey?: string;
  screenshotId?: string;
  errorCode?: string;
  error?: string;
  status?: number;
};

function validateApiUrl(rawUrl: string): { ok: true; url: string } | { ok: false; error: string } {
  if (!rawUrl) {
    return { ok: false, error: '缺少平台 API 地址，请通过 --api-url 或环境变量 PLATFORM_API_URL / ZHINEXUS_API_URL 指定' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: `平台 API 地址格式无效: ${rawUrl}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `平台 API 地址仅支持 http/https 协议，收到: ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: '平台 API 地址禁止内嵌用户名或密码凭证' };
  }
  return { ok: true, url: rawUrl.replace(/\/+$/, '') };
}

/**
 * 执行 `component baseline accept --report <path> --reason <text>`：
 * 1. 本地校验 CheckReportV1 契约，拒绝失败报告、不兼容环境报告、手动上传图与 unknown-manual；
 * 2. 重新计算并核对 environmentKey，杜绝伪造来源；
 * 3. 若指定 --job-id，则先读取 GET /v1/releases/:jobId 并按本地截图 ID 匹配 releaseJob.baselineCandidates 中的服务端 screenshotId（不以服务端 UUID 反筛本地数组）；
 * 4. 调用 POST /v1/baselines（带超时与 redirect:'error' 防凭证泄露），并使用 validateApiMessage('createBaselineResponse') 严格校验响应。
 */
export async function acceptBaseline(options: AcceptBaselineOptions): Promise<AcceptBaselineResult> {
  const reason = options.reason?.trim() ?? '';
  if (!reason || reason.length > 2000) {
    return {
      ok: false,
      errorCode: 'INVALID_REASON',
      error: '必须提供 1–2000 字符的非空基线确认理由 (--reason)',
    };
  }

  let rawJson: unknown;
  try {
    const content = await fs.readFile(options.reportPath, 'utf8');
    rawJson = JSON.parse(content);
  } catch (err: unknown) {
    return {
      ok: false,
      errorCode: 'REPORT_READ_FAILED',
      error: `无法读取或解析检查报告 ${options.reportPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const rawScreenshots =
    rawJson && typeof rawJson === 'object' && Array.isArray((rawJson as { screenshots?: unknown }).screenshots)
      ? ((rawJson as { screenshots: Array<{ source?: unknown; environmentKey?: unknown }> }).screenshots)
      : [];
  if (rawScreenshots.some((s) => s?.source === 'manual-upload' || s?.environmentKey === 'unknown-manual')) {
    return {
      ok: false,
      errorCode: 'SOURCE_FORBIDDEN',
      error: '不允许接受手动上传截图 (manual-upload / unknown-manual) 作为视觉回归基线',
    };
  }

  const checked = validateCheckReport(rawJson);
  if (!checked.ok) {
    const hasForbiddenSource = checked.issues.some((i) => i.code === 'SOURCE_FORBIDDEN');
    return {
      ok: false,
      errorCode: hasForbiddenSource ? 'SOURCE_FORBIDDEN' : 'INVALID_REPORT',
      error: `检查报告未通过契约校验: ${checked.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    };
  }

  const report = checked.value;

  if (!report.checks.length || report.checks.some((c) => c.status !== 'passed')) {
    return {
      ok: false,
      errorCode: 'CHECK_FAILED',
      error: '检查报告存在未通过项 (checks != passed)，禁止接受为视觉基线',
    };
  }

  if (report.baselineResult === 'INCOMPATIBLE') {
    return {
      ok: false,
      errorCode: 'INCOMPATIBLE_ENVIRONMENT',
      error: '检查报告环境签名不兼容 (INCOMPATIBLE)，禁止接受为视觉基线',
    };
  }

  if (options.variantId && report.variantId !== options.variantId) {
    return {
      ok: false,
      errorCode: 'VARIANT_MISMATCH',
      error: `报告变体 (${report.variantId}) 与指定变体 (${options.variantId}) 不匹配`,
    };
  }

  // 保持使用本地报告截图 ID / exampleId 定位本地截图记录，绝不用服务端 UUID 反筛本地数组
  const targetShot = report.screenshots.find((s) => {
    if (options.screenshotId && s.id !== options.screenshotId) return false;
    if (options.exampleId && s.exampleId !== options.exampleId) return false;
    return true;
  });

  if (!targetShot) {
    return {
      ok: false,
      errorCode: 'NO_SCREENSHOT_IN_REPORT',
      error: '检查报告中未找到匹配的截图记录',
    };
  }

  if (targetShot.source !== 'local-automatic' || targetShot.environmentKey === 'unknown-manual') {
    return {
      ok: false,
      errorCode: 'SOURCE_FORBIDDEN',
      error: '不允许接受手动上传截图 (manual-upload / unknown-manual) 作为视觉回归基线',
    };
  }

  const computedEnvKey = await computeEnvironmentKey(report.environment);
  if (
    targetShot.environmentKey !== computedEnvKey ||
    targetShot.variantId !== report.variantId ||
    targetShot.exampleId !== report.exampleId
  ) {
    return {
      ok: false,
      errorCode: 'REPORT_MISMATCH',
      error: '截图元数据或环境签名与检查报告不一致，拒绝提交基线',
    };
  }

  const rawApiUrl = (options.apiUrl ?? process.env.PLATFORM_API_URL ?? process.env.ZHINEXUS_API_URL ?? '').trim();
  const urlCheck = validateApiUrl(rawApiUrl);
  if (!urlCheck.ok) {
    return {
      ok: false,
      errorCode: rawApiUrl ? 'INVALID_API_URL' : 'MISSING_API_URL',
      error: urlCheck.error,
    };
  }
  const apiUrl = urlCheck.url;

  const token = (
    options.token ??
    process.env.PLATFORM_TOKEN ??
    process.env.PLATFORM_API_TOKEN ??
    process.env.ZHINEXUS_TOKEN ??
    ''
  ).trim();

  if (!token) {
    return {
      ok: false,
      errorCode: 'MISSING_TOKEN',
      error: '缺少认证凭证，请通过 --token 或环境变量 PLATFORM_TOKEN / ZHINEXUS_TOKEN 指定',
    };
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchFn = options.fetchImpl ?? globalThis.fetch;

  let resolvedScreenshotId = targetShot.id;

  // 若指定了 jobId，则从 releaseJob.baselineCandidates 解析服务端唯一 screenshotId
  if (options.jobId) {
    let jobRes: Response;
    try {
      jobRes = await fetchFn(`${apiUrl}/v1/releases/${encodeURIComponent(options.jobId)}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: unknown) {
      return {
        ok: false,
        errorCode: 'NETWORK_ERROR',
        error: `查询发布作业 ${options.jobId} 失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    let jobRaw: unknown;
    try {
      jobRaw = await jobRes.json();
    } catch {
      jobRaw = {};
    }

    if (!jobRes.ok) {
      const errObj = jobRaw as Record<string, unknown>;
      const errorCode = typeof errObj.code === 'string' ? errObj.code : `HTTP_${jobRes.status}`;
      const errorMsg = typeof errObj.message === 'string' ? errObj.message : jobRes.statusText || '查询作业失败';
      return {
        ok: false,
        status: jobRes.status,
        errorCode,
        error: `查询发布作业失败 [${errorCode}]: ${errorMsg}`,
      };
    }

    const validatedJob = validateApiMessage('releaseJobResponse', jobRaw);
    if (!validatedJob.ok) {
      return {
        ok: false,
        status: jobRes.status,
        errorCode: 'INVALID_RESPONSE',
        error: `服务端发布作业响应格式无效: ${validatedJob.issues.map((i) => i.message).join('; ')}`,
      };
    }

    const candidates = validatedJob.value.baselineCandidates ?? [];
    const matchedCandidate = candidates.find(
      (c) =>
        c.sourceScreenshotId === targetShot.id &&
        c.variantId === report.variantId &&
        c.exampleId === report.exampleId &&
        c.environmentKey === computedEnvKey,
    );
    if (!matchedCandidate) {
      return {
        ok: false,
        errorCode: 'CANDIDATE_NOT_FOUND',
        error: `在作业 ${options.jobId} 的 baselineCandidates 中未找到匹配的候选截图 (sourceScreenshotId=${targetShot.id}, variantId=${report.variantId}, exampleId=${report.exampleId})`,
      };
    }
    resolvedScreenshotId = matchedCandidate.screenshotId;
  }

  const payload: ApiMessages['createBaselineRequest'] = {
    variantId: report.variantId,
    exampleId: report.exampleId,
    environmentKey: computedEnvKey,
    screenshotId: resolvedScreenshotId,
    reason,
    ...(options.expectedRevision ? { expectedRevision: options.expectedRevision } : {}),
  };

  let response: Response;
  try {
    response = await fetchFn(`${apiUrl}/v1/baselines`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: unknown) {
    return {
      ok: false,
      errorCode: 'NETWORK_ERROR',
      error: `提交基线请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let bodyJson: unknown = {};
  try {
    bodyJson = await response.json();
  } catch {
    bodyJson = {};
  }

  if (!response.ok) {
    const errObj = (bodyJson && typeof bodyJson === 'object' ? bodyJson : {}) as Record<string, unknown>;
    const errorCode = typeof errObj.code === 'string' ? errObj.code : `HTTP_${response.status}`;
    const errorMsg = typeof errObj.message === 'string' ? errObj.message : response.statusText || '请求失败';
    return {
      ok: false,
      status: response.status,
      errorCode,
      error: `服务端拒绝基线接受请求 [${errorCode}]: ${errorMsg}`,
    };
  }

  const validatedResp = validateApiMessage('createBaselineResponse', bodyJson);
  if (!validatedResp.ok) {
    return {
      ok: false,
      status: response.status,
      errorCode: 'INVALID_RESPONSE',
      error: `服务端响应未通过 createBaselineResponse 契约校验: ${validatedResp.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    revisionId: validatedResp.value.revisionId,
    variantId: report.variantId,
    exampleId: report.exampleId,
    environmentKey: computedEnvKey,
    screenshotId: resolvedScreenshotId,
  };
}
