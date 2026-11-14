/**
 * 从**冻结 tarball** 加载兼容策略（T10 探针，A 侧）。
 *
 * 关键边界：探针不 import 仓库里的 `packages/charts-core/src/engine/compatibility.ts`，
 * 而是把冻结的 `company-charts-core-*.tgz` 解包到工作区外临时目录，再动态 import
 * 包内的 `dist/engine/compatibility.js`。这样「被测策略」与「被测产物」是同一份字节，
 * 不会出现「报告说验证 0.0.10、实际跑的是工作区未提交源码」的脱节。
 */

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 探针要用的四个公开函数；缺任何一个都拒绝出报告。 */
const REQUIRED_EXPORTS = /** @type {const} */ ([
  'resolveCandidate',
  'verifyCandidate',
  'recommend',
  'hasDualFrameworkCoverage',
]);

/**
 * 解包冻结 tarball 并加载其中的兼容策略模块。
 *
 * @param {{ tarballFile: string; packageName?: string; root?: string }} options
 *   `root` 让解包目录与干净消费者落在同一处——沙箱里 `os.tmpdir()` 可能指向一个
 *   只剩几百 MB 的小分区，而 `--consumer-root` 指的是大盘。不传时才退回 `os.tmpdir()`。
 * @returns {Promise<{ dir: string; module: Record<string, unknown>; cleanup: () => Promise<void> }>}
 */
export async function loadFrozenPolicy({ tarballFile, packageName = '@company/charts-core', root = null }) {
  const base = root ? path.resolve(root) : tmpdir();
  // 先确保根目录存在：`--consumer-root` 可以指向一个尚不存在的路径（带空格的新目录），
  // mkdtemp 对不存在的父目录直接 ENOENT。
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'a-t10-policy-'));
  let cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    // `tar` 解包到 `package/` 前缀下（pnpm pack 的固定结构），与仓库既有测试同手法
    execFileSync('tar', ['xzf', tarballFile, '-C', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
    const entry = path.join(dir, 'package', 'dist', 'engine', 'compatibility.js');
    const module = await import(pathToFileURL(entry).href);
    const missing = REQUIRED_EXPORTS.filter((name) => typeof module[name] !== 'function');
    if (missing.length > 0) {
      throw new Error(
        `冻结 ${packageName} 的 dist/engine/compatibility.js 缺少导出：${missing.join(', ')}。` +
          '探针拒绝用不完整的策略出具报告。',
      );
    }
    return { dir, module, cleanup: () => cleanup() };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/**
 * 构造官方 registry 快照（`RegistrySnapshot` 形状）。
 *
 * 只从 HTTP 元数据取 `dist-tags.latest` 与 `dist.integrity`，不做任何「我记得最新是几」
 * 的猜测。代理与官方源不一致时，`source` 字段即为留痕依据。
 *
 * @param {{ registry: string; version?: string; fetchImpl?: typeof fetch; timeoutMs?: number }} options
 */
export async function readRegistrySnapshot({
  registry,
  version,
  fetchImpl = fetch,
  timeoutMs = 20_000,
}) {
  const base = registry.replace(/\/+$/, '');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const get = async (suffix) => {
    const response = await fetchImpl(`${base}/${suffix}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal: abort.signal,
    });
    if (!response.ok) {
      throw new Error(`registry ${base}/${suffix} 返回 HTTP ${response.status}`);
    }
    return response.json();
  };
  try {
    const packument = await get('');
    const latest = packument?.['dist-tags']?.latest;
    if (typeof latest !== 'string' || latest.length === 0) {
      throw new Error(`registry ${base} 未提供 dist-tags.latest`);
    }
    const wanted = version ?? latest;
    const meta = packument?.versions?.[wanted];
    if (!meta) {
      // packument 可能被裁剪；按需再取一次单版本文档
      const single = await get(wanted);
      if (!single?.dist?.integrity) {
        throw new Error(`registry ${base} 中不存在版本 ${wanted} 或其 dist.integrity 缺失`);
      }
      return {
        source: base,
        latest,
        versions: {
          [wanted]: {
            integrity: single.dist.integrity,
            releaseNotes: single.repository?.url
              ? `https://github.com/apache/echarts/releases/tag/${wanted}`
              : undefined,
          },
        },
      };
    }
    return {
      source: base,
      latest,
      versions: {
        [wanted]: { integrity: meta.dist?.integrity, releaseNotes: meta.repository?.url },
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调 `resolveCandidate`，把 `CandidateError.reason` 原样带回，不解析消息文本。
 */
export function resolveCandidateSafely(policy, input, snapshot) {
  try {
    return { ok: true, candidate: policy.resolveCandidate(input, snapshot) };
  } catch (error) {
    if (error && error.name === 'CandidateError' && typeof error.reason === 'string') {
      return { ok: false, reason: error.reason, message: error.message };
    }
    return { ok: false, reason: 'unexpected', message: String(error?.message ?? error) };
  }
}
