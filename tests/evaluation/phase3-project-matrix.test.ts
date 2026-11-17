import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATION_CONFLICT_CODES } from '@company/contracts';
import { expectedSdkComponents, validateExpectedSdkMatrix } from '../fixtures/component-query-sdk.js';
import { workspacePatternCases } from '../fixtures/integration-plan.js';
import { createProjectCase, projectCases } from '../fixtures/phase3-projects/cases.js';
import {
  validateProjectMatrix,
  verifyCaseLockfileAlignment,
  type ProjectCaseMeta,
} from '../fixtures/phase3-projects/expected.js';

const REPO_ROOT = process.cwd();

describe('P2 三期独立项目矩阵与双框架 SDK 审计', () => {
  it('导出至少 12 个 synthetic 案例并覆盖双框架、双包管理器、workspace、中文空格脏路径及各类冲突', () => {
    expect(projectCases.length).toBeGreaterThanOrEqual(12);
    expect(validateProjectMatrix(projectCases)).toEqual({ valid: true });

    for (const item of projectCases) {
      expect(item.origin).toBe('synthetic');
      for (const code of item.expectedConflictCodes) {
        expect(INTEGRATION_CONFLICT_CODES).toContain(code);
      }
    }

    const inspectedPairs = new Set(
      projectCases
        .filter((c) => c.expected.status === 'inspected')
        .map((c) => `${c.packageManager}:${c.framework}`),
    );
    expect(inspectedPairs.has('npm:vue')).toBe(true);
    expect(inspectedPairs.has('npm:react')).toBe(true);
    expect(inspectedPairs.has('pnpm:vue')).toBe(true);
    expect(inspectedPairs.has('pnpm:react')).toBe(true);

    const conflictCodes = new Set(projectCases.flatMap((c) => c.expectedConflictCodes));
    for (const requiredCode of [
      'LOCKFILE_MULTIPLE',
      'LOCKFILE_MISSING',
      'REACT_DOM_MISSING',
      'IMPORTER_MISSING',
      'FRAMEWORK_AMBIGUOUS',
      'WORKSPACE_REQUIRED',
    ] as const) {
      expect(conflictCodes.has(requiredCode)).toBe(true);
    }

    const dirtyCase = projectCases.find((c) => c.caseId === 'spaces-chinese-dirty');
    expect(dirtyCase).toBeDefined();
    expect(dirtyCase!.workspace).toContain('业务 应用');
    expect(dirtyCase!.expected.gitStatus).toBe('dirty');
    expect(dirtyCase!.expected.dirtyPaths.length).toBeGreaterThan(0);
    expect(dirtyCase!.expected.status).toBe('inspected');
  });

  it('缺 ECharts 案例按 spec 第 5 条与 P0 契约保持 inspected 且不伪造 echarts 依赖', () => {
    const missingEchartsCase = projectCases.find((c) => c.caseId === 'conflict-missing-echarts');
    expect(missingEchartsCase).toBeDefined();
    expect(missingEchartsCase!.expected.status).toBe('inspected');
    expect(missingEchartsCase!.expectedConflictCodes).toEqual([]);
    expect(missingEchartsCase!.expected.conflictCodes).toEqual([]);
    expect(missingEchartsCase!.expected.resolvedDependencies).toEqual([
      { name: 'vue', version: '3.5.45', specifier: '3.5.45' },
    ]);
    expect(
      missingEchartsCase!.expected.resolvedDependencies.some((dep) => dep.name === 'echarts'),
    ).toBe(false);
  });

  it('反例：矩阵校验拒绝缺少框架/包管理器组合、重复 caseId 与预期版本和锁不符', () => {
    const missingPnpmReact = projectCases.filter(
      (c) => !(c.packageManager === 'pnpm' && c.framework === 'react'),
    );
    const missingRes = validateProjectMatrix(missingPnpmReact);
    expect(missingRes.valid).toBe(false);
    if (!missingRes.valid) {
      expect(missingRes.errors.some((e) => e.includes('pnpm:react'))).toBe(true);
    }

    const duplicated: ProjectCaseMeta[] = [...projectCases, { ...projectCases[0]! }];
    const dupRes = validateProjectMatrix(duplicated);
    expect(dupRes.valid).toBe(false);
    if (!dupRes.valid) {
      expect(dupRes.errors.some((e) => e.includes('重复'))).toBe(true);
    }

    const wrongVersionCase: ProjectCaseMeta = {
      ...projectCases[0]!,
      expected: {
        ...projectCases[0]!.expected,
        resolvedDependencies: projectCases[0]!.expected.resolvedDependencies.map((dep) =>
          dep.name === 'vue' ? { ...dep, version: '3.4.0' } : dep,
        ),
      },
    };
    const lockAlignRes = verifyCaseLockfileAlignment(wrongVersionCase);
    expect(lockAlignRes.valid).toBe(false);
    if (!lockAlignRes.valid) {
      expect(lockAlignRes.errors.some((e) => e.includes('vue'))).toBe(true);
    }
  });

  it('createProjectCase 在隔离临时目录生成全部案例，且真实工具锁文件与预期一致', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 't15-p2-matrix-'));
    try {
      for (const item of projectCases) {
        const materialized = await createProjectCase(item.caseId, tempRoot);
        expect(existsSync(materialized.projectRoot)).toBe(true);
        expect(existsSync(path.join(materialized.projectRoot, 'package.json'))).toBe(true);
        expect(materialized.expected).toEqual(item.expected);

        if (item.expected.lockfileFormat === 'npm-v3') {
          const lockJson = JSON.parse(
            readFileSync(path.join(materialized.projectRoot, 'package-lock.json'), 'utf8'),
          ) as { lockfileVersion: number };
          expect(lockJson.lockfileVersion).toBe(3);
        }
        if (item.expected.lockfileFormat === 'pnpm-v9') {
          const lockYaml = readFileSync(
            path.join(materialized.projectRoot, 'pnpm-lock.yaml'),
            'utf8',
          );
          expect(lockYaml).toContain("lockfileVersion: '9.0'");
        }

        const alignRes = verifyCaseLockfileAlignment(item);
        expect(alignRes).toEqual({ valid: true });
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('保留 P0 workspacePatternCases 边界用例', () => {
    expect(workspacePatternCases.length).toBeGreaterThanOrEqual(12);
    expect(workspacePatternCases.some((c) => c.pattern === '业务 应用/client' && c.supported)).toBe(
      true,
    );
    expect(workspacePatternCases.some((c) => c.pattern === '../outside/*' && !c.supported)).toBe(
      true,
    );
  });

  it('独立审计 14 个双框架 SDK 实现并核对 T16 生成器所需差异', () => {
    expect(expectedSdkComponents).toHaveLength(14);
    expect(validateExpectedSdkMatrix(expectedSdkComponents)).toEqual({ valid: true });

    const corePkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/charts-core/package.json'), 'utf8'),
    ) as { version: string };
    const vuePkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/charts-vue/package.json'), 'utf8'),
    ) as { version: string; peerDependencies: Record<string, string> };
    const reactPkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/charts-react/package.json'), 'utf8'),
    ) as { version: string; peerDependencies: Record<string, string> };

    expect(corePkg.version).toBe('0.0.11');
    expect(vuePkg.version).toBe('0.0.12');
    expect(reactPkg.version).toBe('0.0.12');
    expect(vuePkg.peerDependencies.vue).toBe('3.5.45');
    expect(reactPkg.peerDependencies.react).toBe('19.3.1');
    expect(reactPkg.peerDependencies['react-dom']).toBe('19.3.1');
  });
});
