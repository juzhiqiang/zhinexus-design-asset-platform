/**
 * T17 A1 验证报告与外部独占证据落盘助手。
 *
 * 边界：
 * - 所有证据写入 `artifactRoot` 下的独占 run 子目录，绝不写入目标工程，绝不覆盖基线或旧 run；
 * - 写入前清洗敏感凭据（`ZHINEXUS_API_TOKEN` / `ZHINEXUS_REGISTRY_TOKEN`）与不可信原始错误建议；
 * - 所有 issue 一律使用 `INTEGRATION_VERIFICATION_ISSUE_MESSAGES` 固定脱敏文案。
 */
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INTEGRATION_VERIFICATION_ISSUE_MESSAGES,
  validateIntegrationVerificationReport,
  type IntegrationVerificationCheck,
  type IntegrationVerificationIssue,
  type IntegrationVerificationIssueCode,
  type IntegrationVerificationReportV1,
} from '../contracts/integration-verification.js';
import type { IntegrationFileSnapshot } from '../contracts/integration-plan.js';
import type { ArtifactRef } from '../contracts/release-manifest.js';
import type { EnvironmentV1 } from '../contracts/reports.js';
import { canonicalJson } from '../contracts/schema.js';
import { isInsideDirectory, realpathOrSelf, toPosix } from './workspace.js';

export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function readCliToolVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    if (typeof parsed.version === 'string' && /^\d+\.\d+\.\d+/.test(parsed.version)) {
      return parsed.version;
    }
  } catch {
    // fallback
  }
  return '0.0.16';
}

export function verificationIssue(
  code: IntegrationVerificationIssueCode,
  relativePath?: string,
): IntegrationVerificationIssue {
  return {
    code,
    message: INTEGRATION_VERIFICATION_ISSUE_MESSAGES[code],
    ...(relativePath !== undefined ? { path: relativePath } : {}),
  } as IntegrationVerificationIssue;
}

/** 从文本中擦除已知环境变量凭据，防止日志/报告反射敏感值。 */
export function sanitizeDiagnosticText(text: string): string {
  let out = text;
  for (const key of ['ZHINEXUS_API_TOKEN', 'ZHINEXUS_REGISTRY_TOKEN']) {
    const val = process.env[key];
    if (val && val.length >= 4) {
      out = out.split(val).join('[REDACTED]');
    }
  }
  return out;
}

/** 解析已存在的真实祖先，再接回缺失路径段；缺失的符号链接目标失败关闭。 */
function realpathWithMissingTail(abs: string): string | undefined {
  let candidate = path.resolve(abs);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return path.resolve(fs.realpathSync(candidate), ...missingSegments.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') return undefined;

      try {
        // lstat sees a dangling symlink/junction even when realpath cannot follow it.
        fs.lstatSync(candidate);
        return undefined;
      } catch (statError) {
        const statCode = (statError as NodeJS.ErrnoException).code;
        if (statCode !== 'ENOENT') return undefined;
      }

      const parent = path.dirname(candidate);
      if (parent === candidate) return undefined;
      missingSegments.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

export type RunArtifactSession = {
  artifactRoot: string;
  realArtifactRoot: string;
  runDirName: string;
  runDirAbs: string;
  artifacts: ArtifactRef[];
  writeText: (fileName: string, content: string) => ArtifactRef;
  writeBytes: (fileName: string, content: Buffer) => ArtifactRef;
};

export function assertArtifactRootOutsideProject(projectRealRoot: string, artifactRoot: string): {
  ok: true;
  realArtifactRoot: string;
} | {
  ok: false;
  issue: IntegrationVerificationIssue;
} {
  if (!artifactRoot || !path.isAbsolute(artifactRoot)) {
    return { ok: false, issue: verificationIssue('PATH_UNSAFE') };
  }
  const resolvedArtifact = path.resolve(artifactRoot);
  const realArtifact = realpathWithMissingTail(resolvedArtifact);
  if (!realArtifact) {
    return { ok: false, issue: verificationIssue('PATH_UNSAFE') };
  }
  if (isInsideDirectory(projectRealRoot, realArtifact) || isInsideDirectory(realArtifact, projectRealRoot)) {
    return { ok: false, issue: verificationIssue('PATH_UNSAFE') };
  }
  return { ok: true, realArtifactRoot: realArtifact };
}

export function createRunArtifactSession(
  artifactRoot: string,
  prefix: 'verify' | 'repair' = 'verify',
): RunArtifactSession {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const realArtifactRoot = realpathOrSelf(path.resolve(artifactRoot));
  const runDirName = `runs/${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDirAbs = path.join(realArtifactRoot, runDirName);
  fs.mkdirSync(runDirAbs, { recursive: true });

  const artifacts: ArtifactRef[] = [];

  const writeBytes = (fileName: string, content: Buffer): ArtifactRef => {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const relPath = toPosix(`${runDirName}/${safeName}`);
    const absPath = path.join(realArtifactRoot, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
    const ref: ArtifactRef = {
      path: relPath,
      sha256: sha256Hex(content),
      bytes: content.byteLength,
    };
    artifacts.push(ref);
    return ref;
  };

  const writeText = (fileName: string, content: string): ArtifactRef => {
    const sanitized = sanitizeDiagnosticText(content);
    return writeBytes(fileName, Buffer.from(sanitized, 'utf8'));
  };

  return {
    artifactRoot,
    realArtifactRoot,
    runDirName,
    runDirAbs,
    artifacts,
    writeText,
    writeBytes,
  };
}

export function buildVerificationReport(params: {
  id: string;
  projectRoot: string;
  planDigest: string;
  applyResultDigest: string;
  specDigest: string;
  status: 'passed' | 'failed' | 'blocked';
  checks: IntegrationVerificationCheck[];
  changedFiles: string[];
  snapshots: { before: IntegrationFileSnapshot[]; after: IntegrationFileSnapshot[] };
  installedVersions: { name: string; version: string; manifestSha256: string }[];
  visualResult: 'PASS' | 'DIFF' | 'NEW' | 'INCOMPATIBLE' | 'not-run';
  environment?: EnvironmentV1;
  artifacts: ArtifactRef[];
  pendingItems: IntegrationVerificationIssue[];
}): IntegrationVerificationReportV1 {
  const report: IntegrationVerificationReportV1 = {
    schemaVersion: 1,
    projectRoot: params.projectRoot,
    planDigest: params.planDigest,
    applyResultDigest: params.applyResultDigest,
    specDigest: params.specDigest,
    operation: 'verify',
    id: params.id,
    toolVersion: readCliToolVersion(),
    verifiedAt: new Date().toISOString(),
    status: params.status,
    checks: params.checks,
    changedFiles: params.changedFiles,
    snapshots: params.snapshots,
    installedVersions: params.installedVersions,
    visualResult: params.visualResult,
    ...(params.environment ? { environment: params.environment } : {}),
    artifacts: params.artifacts,
    pendingItems: params.pendingItems,
  };

  const validated = validateIntegrationVerificationReport(report);
  if (!validated.ok) {
    throw new Error(`INVALID_VERIFICATION_REPORT: ${validated.issues.map(i => `${i.path}:${i.message}`).join('; ')}`);
  }
  return validated.value;
}
