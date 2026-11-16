import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseAllDocuments } from 'yaml';
import type { IntegrationConflict } from '@company/contracts';

export type ExpectedInspection = {
  status: 'inspected' | 'conflicted';
  workspace: string;
  packageManager?: 'npm' | 'pnpm';
  lockfileFormat?: 'npm-v3' | 'pnpm-v9';
  lockfilePath?: string;
  framework?: 'vue' | 'react';
  resolvedDependencies: Array<{ name: string; version: string; specifier: string }>;
  scripts: string[];
  gitStatus: 'clean' | 'dirty' | 'unavailable';
  dirtyPaths: string[];
  conflictCodes: IntegrationConflict['code'][];
};

export type ProjectCaseMeta = {
  caseId: string;
  title: string;
  origin: 'synthetic';
  framework?: 'vue' | 'react';
  packageManager?: 'npm' | 'pnpm';
  lockType?: 'npm-v3' | 'pnpm-v9' | 'none' | 'multiple';
  workspace?: string;
  lockSnapshotDir?: string;
  expectedConflictCodes: IntegrationConflict['code'][];
  expected: ExpectedInspection;
};

export type MatrixValidationResult = { valid: true } | { valid: false; errors: string[] };

const LOCK_SNAPSHOTS_ROOT = path.resolve(
  process.cwd(),
  'tests/fixtures/phase3-projects/lock-snapshots',
);

/**
 * 校验三期本地项目矩阵：至少 12 个案例、无重复 caseId、覆盖双框架 × 双包管理器且状态与冲突一致。
 */
export function validateProjectMatrix(cases: readonly ProjectCaseMeta[]): MatrixValidationResult {
  const errors: string[] = [];
  if (cases.length < 12) {
    errors.push(`项目矩阵至少需要 12 个案例，当前仅 ${cases.length} 个`);
  }

  const seenIds = new Set<string>();
  const inspectedPairs = new Set<string>();

  for (const item of cases) {
    if (seenIds.has(item.caseId)) {
      errors.push(`存在重复 caseId：${item.caseId}`);
    }
    seenIds.add(item.caseId);

    if (item.expected.status === 'inspected') {
      if (item.expectedConflictCodes.length > 0 || item.expected.conflictCodes.length > 0) {
        errors.push(`${item.caseId} 为 inspected 状态，不应包含预期冲突`);
      }
      if (item.packageManager && item.framework) {
        inspectedPairs.add(`${item.packageManager}:${item.framework}`);
      }
    } else {
      if (item.expectedConflictCodes.length === 0 || item.expected.conflictCodes.length === 0) {
        errors.push(`${item.caseId} 为 conflicted 状态，必须声明预期冲突码`);
      }
    }
  }

  for (const pair of ['npm:vue', 'npm:react', 'pnpm:vue', 'pnpm:react']) {
    if (!inspectedPairs.has(pair)) {
      errors.push(`缺少正常 inspected 组合：${pair}`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

type NpmLockV3 = {
  lockfileVersion?: number;
  packages?: Record<
    string,
    {
      version?: string;
      dependencies?: Record<string, string>;
    }
  >;
};

type PnpmLockV9 = {
  lockfileVersion?: string;
  importers?: Record<
    string,
    {
      dependencies?: Record<string, { specifier?: string; version?: string }>;
    }
  >;
};

/**
 * 独立核对案例预期 resolvedDependencies 版本与真实工具生成的锁快照一致。
 */
export function verifyCaseLockfileAlignment(item: ProjectCaseMeta): MatrixValidationResult {
  if (!item.lockSnapshotDir || !item.expected.lockfileFormat) {
    return { valid: true };
  }
  const snapDir = path.join(LOCK_SNAPSHOTS_ROOT, item.lockSnapshotDir);
  const errors: string[] = [];

  if (item.expected.lockfileFormat === 'npm-v3') {
    const lockPath = path.join(snapDir, 'package-lock.json');
    if (!existsSync(lockPath)) {
      return { valid: false, errors: [`缺少 npm 锁快照：${lockPath}`] };
    }
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as NpmLockV3;
    if (lock.lockfileVersion !== 3) {
      errors.push(`${item.caseId} npm lockfileVersion 应为 3，实际 ${String(lock.lockfileVersion)}`);
    }
    const importerKey = item.expected.workspace === '.' ? '' : item.expected.workspace;
    const importerPkg = lock.packages?.[importerKey];
    if (!importerPkg) {
      errors.push(`${item.caseId} 在 package-lock.json 中缺少 importer：${importerKey}`);
    } else {
      for (const dep of item.expected.resolvedDependencies) {
        const wsModKey =
          importerKey === ''
            ? `node_modules/${dep.name}`
            : `${importerKey}/node_modules/${dep.name}`;
        const rootModKey = `node_modules/${dep.name}`;
        const resolvedVer =
          lock.packages?.[wsModKey]?.version ?? lock.packages?.[rootModKey]?.version;
        if (resolvedVer !== dep.version) {
          errors.push(
            `${item.caseId} 依赖 ${dep.name} 版本与 npm 锁不一致：预期 ${dep.version}，锁中为 ${String(resolvedVer)}`,
          );
        }
      }
    }
  } else if (item.expected.lockfileFormat === 'pnpm-v9') {
    const lockPath = path.join(snapDir, 'pnpm-lock.yaml');
    if (!existsSync(lockPath)) {
      return { valid: false, errors: [`缺少 pnpm 锁快照：${lockPath}`] };
    }
    const docs = parseAllDocuments(readFileSync(lockPath, 'utf8')).map(
      (doc) => (doc.toJS() ?? {}) as PnpmLockV9,
    );
    const hasV9 = docs.some((d) => d.lockfileVersion === '9.0');
    if (!hasV9) {
      errors.push(`${item.caseId} pnpm lockfileVersion 应为 9.0`);
    }
    const importerKey = item.expected.workspace;
    const importer = docs.find((d) => d.importers?.[importerKey]?.dependencies)?.importers?.[
      importerKey
    ];
    if (!importer) {
      errors.push(`${item.caseId} 在 pnpm-lock.yaml 中缺少 importer：${importerKey}`);
    } else {
      for (const dep of item.expected.resolvedDependencies) {
        const rawVer = importer.dependencies?.[dep.name]?.version;
        const cleanVer = rawVer?.split('(')[0];
        if (cleanVer !== dep.version) {
          errors.push(
            `${item.caseId} 依赖 ${dep.name} 版本与 pnpm 锁不一致：预期 ${dep.version}，锁中为 ${String(cleanVer)}`,
          );
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
