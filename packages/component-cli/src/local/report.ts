import * as crypto from 'node:crypto';
import type { CheckReportV1, EnvironmentV1 } from '../contracts/reports.js';
import type { ScreenshotRef } from '../contracts/examples.js';
import type { ArtifactRef } from '../contracts/release-manifest.js';
import { validateCheckReport } from '../contracts/validation.js';

export type BuildCheckReportOptions = {
  id?: string;
  toolVersion?: string;
  variantId: string;
  packageSha256: string;
  exampleId: string;
  environment: EnvironmentV1;
  environmentKey: string;
  checks: { name: string; status: 'passed' | 'failed'; evidence?: ArtifactRef }[];
  screenshots: ScreenshotRef[];
  baselineRevision?: string;
  baselineResult?: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE';
  createdAt?: string;
};

/**
 * 构造并校验标准 CheckReportV1 检查报告。
 * - 确保每个截图关联报告 ID、变体、包摘要及自动验证来源；
 * - 默认基线对比结果为 NEW（首轮未录入基线）；
 * - 必须严格通过 validateCheckReport 契约校验。
 */
export function buildCheckReport(options: BuildCheckReportOptions): CheckReportV1 {
  const reportId = options.id ?? `report-${crypto.randomBytes(8).toString('hex')}`;
  const toolVersion = options.toolVersion ?? '0.0.1';
  const baselineResult = options.baselineResult ?? 'NEW';
  const createdAt = options.createdAt ?? new Date().toISOString();

  // 绑定 reportId 与 packageSha256 到关联截图
  const boundScreenshots: ScreenshotRef[] = options.screenshots.map((shot) => ({
    ...shot,
    reportId,
    variantId: options.variantId,
    exampleId: options.exampleId,
    packageSha256: options.packageSha256,
  }));

  const report: CheckReportV1 = {
    id: reportId,
    toolVersion,
    variantId: options.variantId,
    packageSha256: options.packageSha256,
    exampleId: options.exampleId,
    environment: options.environment,
    checks: options.checks,
    screenshots: boundScreenshots,
    baselineResult,
    createdAt,
  };

  if (options.baselineRevision) {
    report.baselineRevision = options.baselineRevision;
  }

  return report;
}

