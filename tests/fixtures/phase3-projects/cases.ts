import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ExpectedInspection, ProjectCaseMeta } from './expected.js';

const LOCK_SNAPSHOTS_ROOT = path.resolve(
  process.cwd(),
  'tests/fixtures/phase3-projects/lock-snapshots',
);

type InternalCaseDef = {
  meta: ProjectCaseMeta;
  rootPackageJson: Record<string, unknown>;
  pnpmWorkspaceYaml?: string;
  subPackages?: Array<{ relDir: string; packageJson: Record<string, unknown> }>;
  copyLocks: Array<{ fromDir: string; fileName: 'package-lock.json' | 'pnpm-lock.yaml' }>;
  gitDirtyFile?: { relPath: string; content: string };
};

const CASE_DEFS: readonly InternalCaseDef[] = [
  {
    meta: {
      caseId: 'npm-vue-single',
      title: 'npm 单包 Vue 3 + ECharts 6 正常项目',
      origin: 'synthetic',
      framework: 'vue',
      packageManager: 'npm',
      lockType: 'npm-v3',
      workspace: '.',
      lockSnapshotDir: 'npm-vue-single',
      expectedConflictCodes: [],
      expected: {
        status: 'inspected',
        workspace: '.',
        packageManager: 'npm',
        lockfileFormat: 'npm-v3',
        lockfilePath: 'package-lock.json',
        framework: 'vue',
        resolvedDependencies: [
          { name: 'vue', version: '3.5.45', specifier: '3.5.45' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: ['build', 'typecheck'],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: [],
      },
    },
    rootPackageJson: {
      name: 'synthetic-npm-vue',
      version: '0.0.0',
      private: true,
      packageManager: 'npm@11.20.0',
      scripts: { build: 'echo build', typecheck: 'echo typecheck' },
      dependencies: { vue: '3.5.45', echarts: '6.1.0' },
    },
    copyLocks: [{ fromDir: 'npm-vue-single', fileName: 'package-lock.json' }],
  },
  {
    meta: {
      caseId: 'npm-react-single',
      title: 'npm 单包 React 19 + React DOM + ECharts 6 正常项目',
      origin: 'synthetic',
      framework: 'react',
      packageManager: 'npm',
      lockType: 'npm-v3',
      workspace: '.',
      lockSnapshotDir: 'npm-react-single',
      expectedConflictCodes: [],
      expected: {
        status: 'inspected',
        workspace: '.',
        packageManager: 'npm',
        lockfileFormat: 'npm-v3',
        lockfilePath: 'package-lock.json',
        framework: 'react',
        resolvedDependencies: [
          { name: 'react', version: '19.3.1', specifier: '19.3.1' },
          { name: 'react-dom', version: '19.3.1', specifier: '19.3.1' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: ['build', 'typecheck'],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: [],
      },
    },
    rootPackageJson: {
      name: 'synthetic-npm-react',
      version: '0.0.0',
      private: true,
      packageManager: 'npm@11.20.0',
      scripts: { build: 'echo build', typecheck: 'echo typecheck' },
      dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
    },
    copyLocks: [{ fromDir: 'npm-react-single', fileName: 'package-lock.json' }],
  },
  {
    meta: {
      caseId: 'pnpm-vue-single',
      title: 'pnpm 单包 Vue 3 + ECharts 6 正常项目',
      origin: 'synthetic',
      framework: 'vue',
      packageManager: 'pnpm',
      lockType: 'pnpm-v9',
      workspace: '.',
      lockSnapshotDir: 'pnpm-vue-single',
      expectedConflictCodes: [],
      expected: {
        status: 'inspected',
        workspace: '.',
        packageManager: 'pnpm',
        lockfileFormat: 'pnpm-v9',
        lockfilePath: 'pnpm-lock.yaml',
        framework: 'vue',
        resolvedDependencies: [
          { name: 'vue', version: '3.5.45', specifier: '3.5.45' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: ['build', 'typecheck'],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: [],
      },
    },
    rootPackageJson: {
      name: 'synthetic-pnpm-vue',
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@12.18.0',
      scripts: { build: 'echo build', typecheck: 'echo typecheck' },
      dependencies: { vue: '3.5.45', echarts: '6.1.0' },
    },
    copyLocks: [{ fromDir: 'pnpm-vue-single', fileName: 'pnpm-lock.yaml' }],
  },
  {
    meta: {
      caseId: 'pnpm-react-single',
      title: 'pnpm 单包 React 19 + React DOM + ECharts 6 正常项目',
      origin: 'synthetic',
      framework: 'react',
      packageManager: 'pnpm',
      lockType: 'pnpm-v9',
      workspace: '.',
      lockSnapshotDir: 'pnpm-react-single',
      expectedConflictCodes: [],
      expected: {
        status: 'inspected',
        workspace: '.',
        packageManager: 'pnpm',
        lockfileFormat: 'pnpm-v9',
        lockfilePath: 'pnpm-lock.yaml',
        framework: 'react',
        resolvedDependencies: [
          { name: 'react', version: '19.3.1', specifier: '19.3.1' },
          { name: 'react-dom', version: '19.3.1', specifier: '19.3.1' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: ['build', 'typecheck'],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: [],
      },
    },
    rootPackageJson: {
      name: 'synthetic-pnpm-react',
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@12.18.0',
      scripts: { build: 'echo build', typecheck: 'echo typecheck' },
      dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
    },
    copyLocks: [{ fromDir: 'pnpm-react-single', fileName: 'pnpm-lock.yaml' }],
  },
  {
    meta: {
      caseId: 'npm-workspace-explicit',
      title: 'npm 显式 workspace 子包（packages/app-vue）',
      origin: 'synthetic',
      framework: 'vue',
      packageManager: 'npm',
      lockType: 'npm-v3',
      workspace: 'packages/app-vue',
      lockSnapshotDir: 'npm-workspace-explicit',
      expectedConflictCodes: [],
      expected: {
        status: 'inspected',
        workspace: 'packages/app-vue',
        packageManager: 'npm',
        lockfileFormat: 'npm-v3',
        lockfilePath: 'package-lock.json',
        framework: 'vue',
        resolvedDependencies: [
          { name: 'vue', version: '3.5.45', specifier: '3.5.45' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: ['build', 'typecheck'],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: [],
      },
    },
    rootPackageJson: {
      name: 'synthetic-npm-ws',
      version: '0.0.0',
      private: true,
      packageManager: 'npm@11.20.0',
      workspaces: ['packages/*'],
    },
    subPackages: [
      {
        relDir: 'packages/app-vue',
        packageJson: {
          name: '@synthetic/app-vue',
          version: '0.0.0',
          private: true,
          scripts: { build: 'echo build', typecheck: 'echo typecheck' },
          dependencies: { vue: '3.5.45', echarts: '6.1.0' },
        },
      },
    ],
    copyLocks: [{ fromDir: 'npm-workspace-explicit', fileName: 'package-lock.json' }],
  },
  {
    meta: {
      caseId: 'pnpm-workspace-explicit',
      title: 'pnpm 显式 workspace 子包（apps/chart-react）',
      origin: 'synthetic',
      framework: 'react',
      packageManager: 'pnpm',
      lockType: 'pnpm-v9',
      workspace: 'apps/chart-react',
      lockSnapshotDir: 'pnpm-workspace-explicit',
      expectedConflictCodes: [],
      expected: {
        status: 'inspected',
        workspace: 'apps/chart-react',
        packageManager: 'pnpm',
        lockfileFormat: 'pnpm-v9',
        lockfilePath: 'pnpm-lock.yaml',
        framework: 'react',
        resolvedDependencies: [
          { name: 'react', version: '19.3.1', specifier: '19.3.1' },
          { name: 'react-dom', version: '19.3.1', specifier: '19.3.1' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: ['build', 'typecheck'],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: [],
      },
    },
    rootPackageJson: {
      name: 'synthetic-pnpm-ws',
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@12.18.0',
    },
    pnpmWorkspaceYaml: "packages:\n  - 'apps/*'\n",
    subPackages: [
      {
        relDir: 'apps/chart-react',
        packageJson: {
          name: '@synthetic/chart-react',
          version: '0.0.0',
          private: true,
          scripts: { build: 'echo build', typecheck: 'echo typecheck' },
          dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
        },
      },
    ],
    copyLocks: [{ fromDir: 'pnpm-workspace-explicit', fileName: 'pnpm-lock.yaml' }],
  },
  {
    meta: {
      caseId: 'spaces-chinese-dirty',
      title: '空格与中文路径 workspace 且含无关 Git 脏文件',
      origin: 'synthetic',
      framework: 'vue',
      packageManager: 'pnpm',
      lockType: 'pnpm-v9',
      workspace: '业务 应用/前端 client',
      lockSnapshotDir: 'spaces-chinese-dirty',
      expectedConflictCodes: [],
      expected: {
        status: 'inspected',
        workspace: '业务 应用/前端 client',
        packageManager: 'pnpm',
        lockfileFormat: 'pnpm-v9',
        lockfilePath: 'pnpm-lock.yaml',
        framework: 'vue',
        resolvedDependencies: [
          { name: 'vue', version: '3.5.45', specifier: '3.5.45' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: ['build', 'typecheck'],
        gitStatus: 'dirty',
        dirtyPaths: ['notes/草稿.txt'],
        conflictCodes: [],
      },
    },
    rootPackageJson: {
      name: 'synthetic-spaces-cn',
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@12.18.0',
    },
    pnpmWorkspaceYaml: "packages:\n  - '业务 应用/*'\n",
    subPackages: [
      {
        relDir: '业务 应用/前端 client',
        packageJson: {
          name: '@synthetic/cn-client',
          version: '0.0.0',
          private: true,
          scripts: { build: 'echo build', typecheck: 'echo typecheck' },
          dependencies: { vue: '3.5.45', echarts: '6.1.0' },
        },
      },
    ],
    copyLocks: [{ fromDir: 'spaces-chinese-dirty', fileName: 'pnpm-lock.yaml' }],
    gitDirtyFile: { relPath: 'notes/草稿.txt', content: 'unrelated dirty note\n' },
  },
  {
    meta: {
      caseId: 'conflict-multiple-locks',
      title: '专项反例：package-lock.json 与 pnpm-lock.yaml 并存',
      origin: 'synthetic',
      framework: 'vue',
      packageManager: 'pnpm',
      lockType: 'multiple',
      workspace: '.',
      expectedConflictCodes: ['LOCKFILE_MULTIPLE'],
      expected: {
        status: 'conflicted',
        workspace: '.',
        packageManager: 'pnpm',
        framework: 'vue',
        resolvedDependencies: [],
        scripts: ['build'],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: ['LOCKFILE_MULTIPLE'],
      },
    },
    rootPackageJson: {
      name: 'synthetic-multi-lock',
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@12.18.0',
      scripts: { build: 'echo build' },
      dependencies: { vue: '3.5.45', echarts: '6.1.0' },
    },
    copyLocks: [
      { fromDir: 'npm-vue-single', fileName: 'package-lock.json' },
      { fromDir: 'pnpm-vue-single', fileName: 'pnpm-lock.yaml' },
    ],
  },
  {
    meta: {
      caseId: 'conflict-missing-lock',
      title: '专项反例：缺少锁文件',
      origin: 'synthetic',
      framework: 'vue',
      packageManager: 'npm',
      lockType: 'none',
      workspace: '.',
      expectedConflictCodes: ['LOCKFILE_MISSING'],
      expected: {
        status: 'conflicted',
        workspace: '.',
        packageManager: 'npm',
        framework: 'vue',
        resolvedDependencies: [],
        scripts: [],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: ['LOCKFILE_MISSING'],
      },
    },
    rootPackageJson: {
      name: 'synthetic-missing-lock',
      version: '0.0.0',
      private: true,
      packageManager: 'npm@11.20.0',
      dependencies: { vue: '3.5.45', echarts: '6.1.0' },
    },
    copyLocks: [],
  },
  {
    meta: {
      caseId: 'conflict-missing-react-dom',
      title: '专项反例：React 19 缺少 react-dom',
      origin: 'synthetic',
      framework: 'react',
      packageManager: 'npm',
      lockType: 'npm-v3',
      workspace: '.',
      lockSnapshotDir: 'conflict-missing-react-dom',
      expectedConflictCodes: ['REACT_DOM_MISSING'],
      expected: {
        status: 'conflicted',
        workspace: '.',
        packageManager: 'npm',
        lockfileFormat: 'npm-v3',
        lockfilePath: 'package-lock.json',
        framework: 'react',
        resolvedDependencies: [
          { name: 'react', version: '19.3.1', specifier: '19.3.1' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: [],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: ['REACT_DOM_MISSING'],
      },
    },
    rootPackageJson: {
      name: 'synthetic-missing-react-dom',
      version: '0.0.0',
      private: true,
      packageManager: 'npm@11.20.0',
      dependencies: { react: '19.3.1', echarts: '6.1.0' },
    },
    copyLocks: [{ fromDir: 'conflict-missing-react-dom', fileName: 'package-lock.json' }],
  },
  {
    meta: {
      caseId: 'conflict-missing-importer',
      title: '专项反例：指定的 workspace 在锁中无对应 importer',
      origin: 'synthetic',
      framework: 'react',
      packageManager: 'pnpm',
      lockType: 'pnpm-v9',
      workspace: 'apps/missing-pkg',
      expectedConflictCodes: ['IMPORTER_MISSING'],
      expected: {
        status: 'conflicted',
        workspace: 'apps/missing-pkg',
        packageManager: 'pnpm',
        lockfileFormat: 'pnpm-v9',
        lockfilePath: 'pnpm-lock.yaml',
        resolvedDependencies: [],
        scripts: [],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: ['IMPORTER_MISSING'],
      },
    },
    rootPackageJson: {
      name: 'synthetic-missing-importer',
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@12.18.0',
    },
    pnpmWorkspaceYaml: "packages:\n  - 'apps/*'\n",
    subPackages: [
      {
        relDir: 'apps/chart-react',
        packageJson: {
          name: '@synthetic/chart-react',
          version: '0.0.0',
          private: true,
          dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
        },
      },
    ],
    copyLocks: [{ fromDir: 'pnpm-workspace-explicit', fileName: 'pnpm-lock.yaml' }],
  },
  {
    meta: {
      caseId: 'conflict-framework-ambiguous',
      title: '专项反例：同时声明 vue 与 react 导致框架歧义',
      origin: 'synthetic',
      packageManager: 'pnpm',
      lockType: 'pnpm-v9',
      workspace: '.',
      lockSnapshotDir: 'conflict-framework-ambiguous',
      expectedConflictCodes: ['FRAMEWORK_AMBIGUOUS'],
      expected: {
        status: 'conflicted',
        workspace: '.',
        packageManager: 'pnpm',
        lockfileFormat: 'pnpm-v9',
        lockfilePath: 'pnpm-lock.yaml',
        resolvedDependencies: [
          { name: 'vue', version: '3.5.45', specifier: '3.5.45' },
          { name: 'react', version: '19.3.1', specifier: '19.3.1' },
          { name: 'react-dom', version: '19.3.1', specifier: '19.3.1' },
          { name: 'echarts', version: '6.1.0', specifier: '6.1.0' },
        ],
        scripts: [],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: ['FRAMEWORK_AMBIGUOUS'],
      },
    },
    rootPackageJson: {
      name: 'synthetic-ambiguous-fw',
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@12.18.0',
      dependencies: {
        vue: '3.5.45',
        react: '19.3.1',
        'react-dom': '19.3.1',
        echarts: '6.1.0',
      },
    },
    copyLocks: [{ fromDir: 'conflict-framework-ambiguous', fileName: 'pnpm-lock.yaml' }],
  },
  {
    meta: {
      caseId: 'conflict-missing-echarts',
      title: '专项反例：宿主缺少 echarts 依赖',
      origin: 'synthetic',
      framework: 'vue',
      packageManager: 'npm',
      lockType: 'npm-v3',
      workspace: '.',
      lockSnapshotDir: 'conflict-missing-echarts',
      expectedConflictCodes: ['ECHARTS_MISSING'],
      expected: {
        status: 'conflicted',
        workspace: '.',
        packageManager: 'npm',
        lockfileFormat: 'npm-v3',
        lockfilePath: 'package-lock.json',
        framework: 'vue',
        resolvedDependencies: [{ name: 'vue', version: '3.5.45', specifier: '3.5.45' }],
        scripts: [],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: ['ECHARTS_MISSING'],
      },
    },
    rootPackageJson: {
      name: 'synthetic-missing-echarts',
      version: '0.0.0',
      private: true,
      packageManager: 'npm@11.20.0',
      dependencies: { vue: '3.5.45' },
    },
    copyLocks: [{ fromDir: 'conflict-missing-echarts', fileName: 'package-lock.json' }],
  },
  {
    meta: {
      caseId: 'conflict-workspace-required',
      title: '专项反例：Monorepo 未指定 --workspace',
      origin: 'synthetic',
      packageManager: 'pnpm',
      lockType: 'pnpm-v9',
      expectedConflictCodes: ['WORKSPACE_REQUIRED'],
      expected: {
        status: 'conflicted',
        workspace: '.',
        packageManager: 'pnpm',
        lockfileFormat: 'pnpm-v9',
        lockfilePath: 'pnpm-lock.yaml',
        resolvedDependencies: [],
        scripts: [],
        gitStatus: 'unavailable',
        dirtyPaths: [],
        conflictCodes: ['WORKSPACE_REQUIRED'],
      },
    },
    rootPackageJson: {
      name: 'synthetic-ws-required',
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@12.18.0',
    },
    pnpmWorkspaceYaml: "packages:\n  - 'apps/*'\n",
    subPackages: [
      {
        relDir: 'apps/chart-react',
        packageJson: {
          name: '@synthetic/chart-react',
          version: '0.0.0',
          private: true,
          dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
        },
      },
    ],
    copyLocks: [{ fromDir: 'pnpm-workspace-explicit', fileName: 'pnpm-lock.yaml' }],
  },
];

export const projectCases: readonly ProjectCaseMeta[] = CASE_DEFS.map((def) => def.meta);

/**
 * 仅在调用者提供的临时根目录创建合成工程，不修改工作区或任何真实业务项目。
 */
export async function createProjectCase(
  caseId: string,
  tempRoot: string,
): Promise<{ projectRoot: string; workspace?: string; expected: ExpectedInspection }> {
  const def = CASE_DEFS.find((item) => item.meta.caseId === caseId);
  if (!def) {
    throw new Error(`未知的 projectCase: ${caseId}`);
  }

  const projectRoot = path.join(tempRoot, caseId);
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify(def.rootPackageJson, null, 2)}\n`,
    'utf8',
  );

  if (def.pnpmWorkspaceYaml) {
    writeFileSync(path.join(projectRoot, 'pnpm-workspace.yaml'), def.pnpmWorkspaceYaml, 'utf8');
  }

  for (const sub of def.subPackages ?? []) {
    const subDir = path.join(projectRoot, sub.relDir);
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(subDir, 'package.json'),
      `${JSON.stringify(sub.packageJson, null, 2)}\n`,
      'utf8',
    );
  }

  for (const lock of def.copyLocks) {
    const src = path.join(LOCK_SNAPSHOTS_ROOT, lock.fromDir, lock.fileName);
    if (!existsSync(src)) {
      throw new Error(`缺少真实工具生成的锁快照：${src}`);
    }
    copyFileSync(src, path.join(projectRoot, lock.fileName));
  }

  if (def.gitDirtyFile) {
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Synthetic Test'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init synthetic'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });

    const dirtyPath = path.join(projectRoot, def.gitDirtyFile.relPath);
    mkdirSync(path.dirname(dirtyPath), { recursive: true });
    writeFileSync(dirtyPath, def.gitDirtyFile.content, 'utf8');
  }

  return {
    projectRoot,
    ...(def.meta.workspace !== undefined ? { workspace: def.meta.workspace } : {}),
    expected: structuredClone(def.meta.expected),
  };
}
