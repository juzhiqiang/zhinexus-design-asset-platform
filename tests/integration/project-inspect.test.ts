/**
 * T15 P1 项目识别测试（角色 B：Claude 桌面端）。
 *
 * 结构：① 20 个基础识别用例（宿主已确认 20 RED → 20 GREEN）；② 独立审查反例（6 类）；
 * ③ A 冻结的真实工具锁快照消费 + 项目依赖文档歧义守卫；④ Git filter 执行反例。
 * 契约一律通过 CLI 内联合约副本导入；fixtures 在临时目录合成或只读消费 A 的快照，
 * 不读取任何真实业务工作区。依据：docs/superpowers/plans/2026-11-16-phase3-t15-kickoff.md P1、
 * .superpowers/t15/brief.md、docs/verification/c-t15-contracts-2026-11-17.md（P0 冻结）。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { stringify as yamlStringify } from 'yaml';
import { inspectProject } from '../../packages/component-cli/src/integration/inspect.js';
import { validateLocalProjectInspection } from '../../packages/component-cli/src/contracts/integration-plan.js';
import type { LocalProjectInspectionV1 } from '../../packages/component-cli/src/contracts/integration-plan.js';

/**
 * 受控 spy（均原样透传，不改变任何行为）：
 * - node:fs：记录 readFileSync 路径，并可用 realpath 覆盖把根内普通文件解析到外部（模拟外链）；
 * - node:child_process：记录 spawnSync 调用，可对指定调用返回受控结果
 *   （用于验证 git config 枚举失败/畸形输出时必须停止 status）。
 */
const fsMock = vi.hoisted(() => ({ reads: [] as string[], realpathOverrides: new Map<string, string>() }));
type GitCallOverride = {
  match: (command: string, args: readonly string[]) => boolean;
  result: { status: number | null; stdout: string; stderr?: string; error?: Error };
};
const gitCalls = vi.hoisted(() => ({
  entries: [] as { command: string; args: readonly string[]; options?: unknown }[],
  overrides: [] as GitCallOverride[],
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    default: actual,
    spawnSync: ((command: string, args: readonly string[], options?: unknown) => {
      gitCalls.entries.push({ command, args, options });
      for (const override of gitCalls.overrides) {
        if (override.match(command, args)) return { ...override.result };
      }
      return (actual.spawnSync as (c: string, a: readonly string[], o?: unknown) => unknown)(command, args, options);
    }) as typeof actual.spawnSync,
  };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    readFileSync: ((target: fs.PathOrFileDescriptor, options?: unknown) => {
      fsMock.reads.push(typeof target === 'string' ? target : String(target));
      return (actual.readFileSync as (path: unknown, options?: unknown) => unknown)(target, options);
    }) as typeof actual.readFileSync,
    realpathSync: ((target: fs.PathOrFileDescriptor, options?: unknown) => {
      const key = typeof target === 'string' ? target : String(target);
      const override = fsMock.realpathOverrides.get(key);
      if (override !== undefined) return override;
      return (actual.realpathSync as (path: unknown, options?: unknown) => unknown)(target, options) as string;
    }) as typeof actual.realpathSync,
  };
});

const INTEGRITY = `sha512-${'A'.repeat(86)}==`;

const createdDirs: string[] = [];
beforeEach(() => {
  // 受控 spy 记录跨用例累计，每次用例前清空，避免相互干扰造成假失败/假通过。
  gitCalls.entries.length = 0;
  gitCalls.overrides.length = 0;
  fsMock.reads.length = 0;
  fsMock.realpathOverrides.clear();
});
afterAll(() => {
  for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
  createdDirs.length = 0;
});

function tempProject(name: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `t15-${name}-`));
  createdDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

function sha256Of(root: string, rel: string): string {
  return createHash('sha256').update(fs.readFileSync(path.join(root, ...rel.split('/')))).digest('hex');
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd, stdio: 'ignore' });
}

function initGitRepo(dir: string): void {
  git(dir, ['init', '-q', '--template=']);
  git(dir, ['config', 'user.email', 't15-fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'T15 Fixture']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

/** npm package-lock：importers 键为 ''（根）或工作区相对目录；解析版本统一提升到根 node_modules。 */
function npmV3Lock(importers: Record<string, Record<string, string>>, versions: Record<string, string>, lockfileVersion = 3): string {
  const packages: Record<string, unknown> = {};
  for (const [importer, deps] of Object.entries(importers)) {
    packages[importer] = importer === ''
      ? { name: 'host-app', version: '1.0.0', dependencies: deps }
      : { dependencies: deps };
  }
  for (const [name, version] of Object.entries(versions)) {
    packages[`node_modules/${name}`] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
      integrity: INTEGRITY,
    };
  }
  return JSON.stringify({ lockfileVersion, name: 'host-app', requires: true, packages }, null, 2);
}

type PnpmImporterDeps = Record<string, { specifier: string; version: string }>;

/** pnpm lockfile 单文档（lockfileVersion + importers + packages + snapshots）。 */
function pnpmV9Lock(importers: Record<string, PnpmImporterDeps>, lockfileVersion = '9.0'): string {
  const versions = new Map<string, string>();
  for (const deps of Object.values(importers)) {
    for (const [name, entry] of Object.entries(deps)) if (entry.version) versions.set(name, entry.version);
  }
  const lock = {
    lockfileVersion,
    importers: Object.fromEntries(Object.entries(importers).map(([importer, deps]) => [importer, { dependencies: deps }])),
    packages: Object.fromEntries([...versions].map(([name, version]) => [`${name}@${version}`, { resolution: { integrity: INTEGRITY } }])),
    snapshots: Object.fromEntries([...versions].map(([name, version]) => [`${name}@${version}`, { dependencies: {} }])),
  };
  return yamlStringify(lock);
}

/**
 * A 实测 pnpm 12.18.0 生成的锁为多 YAML 文档：先是 packageManagerDependencies 文档，
 * 之后是 v9 importers 等正文。实现必须使用 yaml.parseAllDocuments 并拒绝歧义/错误，
 * 不能假设 parse() 单文档即可覆盖受支持的真实 pnpm 锁。
 */
function pnpmMultiDocLock(importers: Record<string, PnpmImporterDeps>): string {
  return `${yamlStringify({ packageManagerDependencies: { pnpm: '12.18.0' } })}---\n${pnpmV9Lock(importers)}`;
}

const manifestJson = (manifest: Record<string, unknown>): string => JSON.stringify(manifest, null, 2);

const vueNpmManifest = manifestJson({
  name: 'host-app', version: '1.0.0', private: true,
  dependencies: { vue: '^3.5.0', echarts: '6.1.0' },
  scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
});

function vueNpmProject(): string {
  const deps = { vue: '^3.5.0', echarts: '6.1.0' };
  return tempProject('vue-npm', {
    'package.json': vueNpmManifest,
    'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }),
  });
}

const reactPnpmDeps: PnpmImporterDeps = {
  react: { specifier: '19.3.1', version: '19.3.1' },
  'react-dom': { specifier: '19.3.1', version: '19.3.1' },
  echarts: { specifier: '6.1.0', version: '6.1.0' },
};

const reactPnpmManifest = manifestJson({
  name: 'host-app', version: '1.0.0', private: true,
  dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
  scripts: { build: 'tsc -p tsconfig.json', typecheck: 'tsc --noEmit' },
});

function reactPnpmProject(): string {
  return tempProject('react-pnpm', {
    'package.json': reactPnpmManifest,
    'pnpm-lock.yaml': pnpmMultiDocLock({ '.': reactPnpmDeps }),
  });
}

function expectValid(result: LocalProjectInspectionV1): void {
  const checked = validateLocalProjectInspection(result);
  expect(checked.ok, JSON.stringify(checked.ok ? [] : checked.issues)).toBe(true);
}

/** A 冻结的真实工具生成锁快照（只读消费，不用合成 header 替代）。 */
const LOCK_SNAPSHOT_ROOT = fileURLToPath(new URL('../fixtures/phase3-projects/lock-snapshots', import.meta.url));

function snapshotLockText(caseId: string): string {
  const fileName = caseId.startsWith('pnpm') || caseId.startsWith('spaces') ? 'pnpm-lock.yaml' : 'package-lock.json';
  return fs.readFileSync(path.join(LOCK_SNAPSHOT_ROOT, caseId, fileName), 'utf8');
}

/** 用 A 的真实锁快照加本文件内合成清单组装临时项目（清单与快照 importer 声明一致）。 */
function realLockProject(caseId: string, files: Record<string, string>): string {
  const fileName = caseId.startsWith('pnpm') || caseId.startsWith('spaces') ? 'pnpm-lock.yaml' : 'package-lock.json';
  return tempProject(`real-${caseId}`, { ...files, [fileName]: snapshotLockText(caseId) });
}

/** 拆分多文档 pnpm 锁快照为文档数组（真实字节，用于构造歧义反例）。 */
function snapshotLockDocuments(caseId: string): string[] {
  return snapshotLockText(caseId).split(/^---[ \t]*$/m);
}

function shellArgument(value: string): string {
  return `"${value.replaceAll('\\', '/')}"`;
}

/** 宿主 C 独立实验中验证过的 filter helper（原样内联，避免依赖仓库外文件）。 */
const CLEAN_FILTER_HELPER = String.raw`const fs=require('node:fs');fs.appendFileSync(process.argv[2],'clean-invoked\n');let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>process.stdout.write(data));`;
const PROCESS_FILTER_HELPER = String.raw`const fs=require('node:fs');
const marker=process.argv[2];
fs.appendFileSync(marker,'process-start\n');
function exact(n){const b=Buffer.alloc(n);let p=0;while(p<n){const k=fs.readSync(0,b,p,n-p,null);if(!k){if(!p)return undefined;throw Error('partial packet');}p+=k;}return b;}
function packet(){const h=exact(4);if(!h)return undefined;const n=parseInt(h.toString(),16);if(n===0)return null;if(n<4)throw Error('invalid packet');return exact(n-4);}
function list(){const a=[];for(;;){const p=packet();if(p===undefined)return undefined;if(p===null)return a;a.push(p);}}
function send(b){if(typeof b==='string')b=Buffer.from(b);fs.writeSync(1,(b.length+4).toString(16).padStart(4,'0'));fs.writeSync(1,b);}
function flush(){fs.writeSync(1,'0000');}
const hello=list();if(!hello)process.exit(0);
send('git-filter-server\n');send('version=2\n');flush();
const caps=list();if(!caps)process.exit(0);
send('capability=clean\n');flush();
for(;;){const headers=list();if(!headers)break;const content=list();if(!content)break;fs.appendFileSync(marker,headers.map(x=>x.toString().trim()).join(' ')+'\n');send('status=success\n');flush();for(const b of content)send(b);flush();flush();}
`;

type GitFilterFixture = { root: string; marker: string };

/**
 * 构造带 clean/process filter 的 Git 项目：helper 与 marker 都放在项目根之外的临时目录。
 * driver 名可指定（真实 Git 允许下划线等字符，用于验证屏蔽逻辑的字符假设）。
 * 控制正例（git add 触发 helper 写 marker）必须生效，否则视为测试环境问题直接抛错，不静默跳过。
 */
function createGitFilterProject(name: string, mode: 'clean' | 'process', driver = 'synthetic'): GitFilterFixture {
  const root = tempProject(`git-filter-${name}`, {
    'package.json': manifestJson({
      name: `synthetic-filter-${name}`, version: '1.0.0', private: true,
      dependencies: { vue: '3.5.45' }, scripts: { build: 'echo build' },
    }),
    'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    '.gitattributes': `payload.txt filter=${driver}\n`,
    'payload.txt': 'alpha-000\n',
  });
  const helperDir = tempProject(`git-filter-helper-${name}`, {});
  const marker = path.join(helperDir, `${mode}.marker`);
  const helper = path.join(helperDir, `${mode}-helper.cjs`);
  fs.writeFileSync(helper, mode === 'clean' ? CLEAN_FILTER_HELPER : PROCESS_FILTER_HELPER, 'utf8');
  initGitRepo(root);
  const filterCommand = [process.execPath, helper, marker].map(shellArgument).join(' ');
  git(root, ['config', `filter.${driver}.${mode}`, filterCommand]);
  git(root, ['config', `filter.${driver}.required`, 'true']);
  // 控制正例：git add 必须触发 filter helper；未触发说明 fixture/环境有问题，抛错而非误判为通过。
  git(root, ['add', '--', '.gitattributes', 'payload.txt']);
  if (!fs.existsSync(marker)) {
    throw new Error(`Git filter 控制正例未生效（${mode}/${driver}）：git add 未触发 filter helper，无法建立反例前提`);
  }
  git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'synthetic baseline']);
  fs.rmSync(marker, { force: true });
  // 等长修改 + mtime 变更，迫使 Git 重新核对内容（宿主 Windows Git 2.48.1 实测会触发 filter）。
  fs.writeFileSync(path.join(root, 'payload.txt'), 'omega-000\n');
  const stat = fs.statSync(path.join(root, 'payload.txt'));
  fs.utimesSync(path.join(root, 'payload.txt'), new Date(stat.mtimeMs + 5000), new Date(stat.mtimeMs + 5000));
  return { root, marker };
}

function resolvedMap(result: LocalProjectInspectionV1): Record<string, { name: string; version: string; specifier: string }> {
  return Object.fromEntries(result.resolvedDependencies.map(d => [d.name, d]));
}

/** 全树快照：`.git` 内部字节不计（只读 Git 子进程可能刷新索引 stat 缓存），但记录其存在性。 */
function snapshotTree(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) entries.set(childRel, `link:${fs.readlinkSync(abs)}`);
      else if (entry.isDirectory()) {
        entries.set(childRel, 'dir');
        if (childRel !== '.git') walk(abs, childRel);
      } else {
        entries.set(childRel, `file:${fs.statSync(abs).size}:${fs.readFileSync(abs).toString('base64')}`);
      }
    }
  };
  walk(root, '');
  return entries;
}

describe('T15 P1 RED：本地项目只读识别（inspectProject）', () => {
  it('识别 Vue/npm 项目：精确版本来自锁文件，快照与脚本齐全并通过契约校验', async () => {
    const root = vueNpmProject();

    const result = await inspectProject(root);

    expect(result.status).toBe('inspected');
    expect(result.workspace).toBe('.');
    expect(result.packageManager).toBe('npm');
    expect(result.lockfile).toEqual({ path: 'package-lock.json', format: 'npm-v3' });
    expect(result.framework).toBe('vue');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.5.45', specifier: '^3.5.0' });
    expect(resolvedMap(result).echarts).toEqual({ name: 'echarts', version: '6.1.0', specifier: '6.1.0' });
    expect(result.scripts).toContain('build');
    expect(result.scripts).toContain('typecheck');
    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    expect(result.fileSnapshots).toContainEqual({ path: 'package.json', exists: true, sha256: sha256Of(root, 'package.json') });
    expect(result.fileSnapshots).toContainEqual({ path: 'package-lock.json', exists: true, sha256: sha256Of(root, 'package-lock.json') });
    expect(result.conflicts).toEqual([]);
    expectValid(result);
  });

  it('识别 React/pnpm 项目：支持 pnpm 12.18.0 多文档锁（packageManagerDependencies + v9）', async () => {
    const root = reactPnpmProject();

    const result = await inspectProject(root);

    expect(result.status).toBe('inspected');
    expect(result.packageManager).toBe('pnpm');
    expect(result.lockfile).toEqual({ path: 'pnpm-lock.yaml', format: 'pnpm-v9' });
    expect(result.framework).toBe('react');
    expect(resolvedMap(result).react).toEqual({ name: 'react', version: '19.3.1', specifier: '19.3.1' });
    expect(resolvedMap(result)['react-dom']).toEqual({ name: 'react-dom', version: '19.3.1', specifier: '19.3.1' });
    expect(result.fileSnapshots).toContainEqual({ path: 'package.json', exists: true, sha256: sha256Of(root, 'package.json') });
    expect(result.fileSnapshots).toContainEqual({ path: 'pnpm-lock.yaml', exists: true, sha256: sha256Of(root, 'pnpm-lock.yaml') });
    expect(result.conflicts).toEqual([]);
    expectValid(result);
  });

  it('npm workspace 显式定位子包：workspace、成员清单与根锁快照齐全', async () => {
    const memberDeps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('npm-workspace', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, workspaces: ['apps/*'] }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: memberDeps,
        scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
      }),
      'package-lock.json': npmV3Lock({ '': {}, 'apps/client': memberDeps }, { vue: '3.5.45', echarts: '6.1.0' }),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('inspected');
    expect(result.workspace).toBe('apps/client');
    expect(result.framework).toBe('vue');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.5.45', specifier: '^3.5.0' });
    expect(result.fileSnapshots).toContainEqual({ path: 'package.json', exists: true, sha256: sha256Of(root, 'package.json') });
    expect(result.fileSnapshots).toContainEqual({ path: 'apps/client/package.json', exists: true, sha256: sha256Of(root, 'apps/client/package.json') });
    expect(result.fileSnapshots).toContainEqual({ path: 'package-lock.json', exists: true, sha256: sha256Of(root, 'package-lock.json') });
    expect(result.conflicts).toEqual([]);
    expectValid(result);
  });

  it('pnpm workspace 显式定位中文/空格目录成员，并快照 pnpm-workspace.yaml', async () => {
    const member = 'apps/业务 客户端';
    const memberDeps: PnpmImporterDeps = {
      react: { specifier: '19.3.1', version: '19.3.1' },
      'react-dom': { specifier: '19.3.1', version: '19.3.1' },
      echarts: { specifier: '6.1.0', version: '6.1.0' },
    };
    const root = tempProject('pnpm-workspace-unicode', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true }),
      'pnpm-workspace.yaml': yamlStringify({ packages: ['apps/*'] }),
      [`${member}/package.json`]: manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
        scripts: { build: 'tsc -p tsconfig.json', typecheck: 'tsc --noEmit' },
      }),
      'pnpm-lock.yaml': pnpmMultiDocLock({ '.': {}, [member]: memberDeps }),
    });

    const result = await inspectProject(root, { workspace: member });

    expect(result.status).toBe('inspected');
    expect(result.workspace).toBe(member);
    expect(result.framework).toBe('react');
    expect(resolvedMap(result)['react-dom']).toEqual({ name: 'react-dom', version: '19.3.1', specifier: '19.3.1' });
    expect(result.fileSnapshots).toContainEqual({ path: 'package.json', exists: true, sha256: sha256Of(root, 'package.json') });
    expect(result.fileSnapshots).toContainEqual({ path: `${member}/package.json`, exists: true, sha256: sha256Of(root, `${member}/package.json`) });
    expect(result.fileSnapshots).toContainEqual({ path: 'pnpm-workspace.yaml', exists: true, sha256: sha256Of(root, 'pnpm-workspace.yaml') });
    expect(result.fileSnapshots).toContainEqual({ path: 'pnpm-lock.yaml', exists: true, sha256: sha256Of(root, 'pnpm-lock.yaml') });
    expect(result.conflicts).toEqual([]);
    expectValid(result);
  });

  it('monorepo 根未指定 --workspace 时报告 WORKSPACE_REQUIRED 冲突', async () => {
    const root = tempProject('workspace-required', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, workspaces: ['apps/*'], dependencies: {} }),
      'package-lock.json': npmV3Lock({ '': {} }, {}),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('WORKSPACE_REQUIRED');
    expectValid(result);
  });

  it('多个包管理器锁并存报告 LOCKFILE_MULTIPLE 冲突', async () => {
    const deps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('multi-lock', {
      'package.json': vueNpmManifest,
      'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }),
      'pnpm-lock.yaml': pnpmV9Lock({ '.': { vue: { specifier: '^3.5.0', version: '3.5.45' }, echarts: { specifier: '6.1.0', version: '6.1.0' } } }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('LOCKFILE_MULTIPLE');
    expectValid(result);
  });

  it('缺少锁文件报告 LOCKFILE_MISSING 冲突', async () => {
    const root = tempProject('no-lock', { 'package.json': vueNpmManifest });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('LOCKFILE_MISSING');
    expectValid(result);
  });

  it('npm lockfileVersion 非 v3 报告 LOCKFILE_UNSUPPORTED 冲突', async () => {
    const deps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('npm-lock-v1', {
      'package.json': vueNpmManifest,
      'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }, 1),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('LOCKFILE_UNSUPPORTED');
    expectValid(result);
  });

  it('pnpm lockfileVersion 非 v9 报告 LOCKFILE_UNSUPPORTED 冲突', async () => {
    const root = tempProject('pnpm-lock-v6', {
      'package.json': reactPnpmManifest,
      'pnpm-lock.yaml': pnpmV9Lock({ '.': reactPnpmDeps }, '6.0'),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('LOCKFILE_UNSUPPORTED');
    expectValid(result);
  });

  it('packageManager 声明与锁类型不一致报告 PACKAGE_MANAGER_MISMATCH 冲突', async () => {
    const deps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('pm-mismatch', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
        dependencies: deps, scripts: { build: 'vite build' },
      }),
      'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('PACKAGE_MANAGER_MISMATCH');
    expectValid(result);
  });

  it('Yarn 等其他包管理器报告 PACKAGE_MANAGER_UNSUPPORTED 冲突，不自动迁移或创建锁', async () => {
    const root = tempProject('yarn-project', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, packageManager: 'yarn@1.22.19',
        dependencies: { vue: '^3.5.0', echarts: '6.1.0' },
      }),
      'yarn.lock': '# yarn lockfile v1\n',
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('PACKAGE_MANAGER_UNSUPPORTED');
    expect(fs.existsSync(path.join(root, 'package-lock.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'pnpm-lock.yaml'))).toBe(false);
    expectValid(result);
  });

  it('pnpm workspace 锁缺少目标 importer 报告 IMPORTER_MISSING 冲突', async () => {
    const root = tempProject('wrong-importer', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true }),
      'pnpm-workspace.yaml': yamlStringify({ packages: ['apps/*'] }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
      }),
      // 注意：importers 中没有 apps/client，与 pnpm-workspace.yaml 成员声明不一致。
      'pnpm-lock.yaml': pnpmMultiDocLock({ '.': {} }),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('IMPORTER_MISSING');
    expectValid(result);
  });

  it('同一项目同时存在 Vue 与 React 依赖报告 FRAMEWORK_AMBIGUOUS 冲突', async () => {
    const deps: PnpmImporterDeps = {
      vue: { specifier: '^3.5.0', version: '3.5.45' },
      react: { specifier: '19.3.1', version: '19.3.1' },
      'react-dom': { specifier: '19.3.1', version: '19.3.1' },
      echarts: { specifier: '6.1.0', version: '6.1.0' },
    };
    const root = tempProject('framework-ambiguous', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true,
        dependencies: { vue: '^3.5.0', react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
      }),
      'pnpm-lock.yaml': pnpmV9Lock({ '.': deps }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('FRAMEWORK_AMBIGUOUS');
    expectValid(result);
  });

  it('没有任何受支持框架依赖报告 FRAMEWORK_MISSING 冲突', async () => {
    const root = tempProject('framework-missing', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, dependencies: { echarts: '6.1.0' },
      }),
      'package-lock.json': npmV3Lock({ '': { echarts: '6.1.0' } }, { echarts: '6.1.0' }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('FRAMEWORK_MISSING');
    expectValid(result);
  });

  it('声明的 range 在锁中无精确解析报告 VERSION_UNRESOLVED 冲突', async () => {
    const lock = yamlStringify({
      lockfileVersion: '9.0',
      importers: { '.': { dependencies: {
        vue: { specifier: '^3.5.0' },
        echarts: { specifier: '6.1.0', version: '6.1.0' },
      } } },
      packages: { 'echarts@6.1.0': { resolution: { integrity: INTEGRITY } } },
      snapshots: { 'echarts@6.1.0': {} },
    });
    const root = tempProject('version-unresolved', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, dependencies: { vue: '^3.5.0', echarts: '6.1.0' },
      }),
      'pnpm-lock.yaml': lock,
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('VERSION_UNRESOLVED');
    expectValid(result);
  });

  it('React 项目缺少已解析的 react-dom 报告 REACT_DOM_MISSING 冲突', async () => {
    const root = tempProject('react-dom-missing', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, dependencies: { react: '19.3.1', echarts: '6.1.0' },
      }),
      'package-lock.json': npmV3Lock({ '': { react: '19.3.1', echarts: '6.1.0' } }, { react: '19.3.1', echarts: '6.1.0' }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('REACT_DOM_MISSING');
    expectValid(result);
  });

  it('workspace 经 junction/symlink 逃逸到项目根之外报告 PATH_UNSAFE 冲突', async (ctx) => {
    const root = vueNpmProject();
    const outside = tempProject('outside-host', {
      'package.json': manifestJson({ name: 'outside', version: '1.0.0', private: true, dependencies: { vue: '3.5.45' } }),
    });
    let linkCreated = true;
    try {
      // Windows 上目录 junction 无需管理员权限；其他平台使用目录符号链接。
      fs.symlinkSync(outside, path.join(root, 'apps-linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      linkCreated = false;
    }
    if (!linkCreated) return ctx.skip();

    const result = await inspectProject(root, { workspace: 'apps-linked' });

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('PATH_UNSAFE');
    expectValid(result);
  });

  it('workspace 参数越界（..、绝对路径、穿越）报告 WORKSPACE_INVALID 冲突', async () => {
    const root = vueNpmProject();
    for (const workspace of ['../outside', '/etc/host', 'apps/../../outside']) {
      const result = await inspectProject(root, { workspace });
      expect(result.status, workspace).toBe('conflicted');
      expect(result.conflicts.map(c => c.code), workspace).toContain('WORKSPACE_INVALID');
      expectValid(result);
    }
  });

  it('只读识别：不执行安装脚本/动态配置，目标树字节不变', async () => {
    const deps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('readonly-no-exec', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, dependencies: deps,
        scripts: {
          preinstall: "node -e \"require('fs').writeFileSync('PWNED-PREINSTALL','x')\"",
          install: "node -e \"require('fs').writeFileSync('PWNED-INSTALL','x')\"",
          postinstall: "node -e \"require('fs').writeFileSync('PWNED-POSTINSTALL','x')\"",
          prepare: "node -e \"require('fs').writeFileSync('PWNED-PREPARE','x')\"",
          build: 'vite build',
        },
      }),
      'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }),
      'vue.config.js': "require('fs').writeFileSync('PWNED-CONFIG','x')",
    });
    const before = snapshotTree(root);

    const result = await inspectProject(root);

    expect(result.status).toBe('inspected');
    expect(result.scripts).toContain('build');
    expect(snapshotTree(root)).toEqual(before);
    expectValid(result);
  });

  it('识别 Git 脏路径（含未跟踪文件），不伪称干净', async () => {
    const deps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('git-dirty', {
      'package.json': vueNpmManifest,
      'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }),
      'app.ts': 'export const a = 1;\n',
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'init']);
    fs.appendFileSync(path.join(root, 'app.ts'), 'export const b = 2;\n');
    fs.writeFileSync(path.join(root, 'untracked.ts'), 'export const c = 3;\n');

    const result = await inspectProject(root);

    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('app.ts');
    expect(result.git.dirtyPaths).toContain('untracked.ts');
    expectValid(result);
  });
});

describe('T15 P1 独立审查反例（宿主 C review blockers）', () => {
  it('pnpm-workspace.yaml 外链必须在读取前阻断（受控 realpath mock，无需符号链接权限）', async () => {
    const outside = tempProject('outside-declaration', {
      // 外部声明：若实现跟随链接读取，就会用它验证成员归属。
      'declaration.yaml': yamlStringify({ packages: ['apps/*'] }),
    });
    const memberDeps: PnpmImporterDeps = {
      react: { specifier: '19.3.1', version: '19.3.1' },
      'react-dom': { specifier: '19.3.1', version: '19.3.1' },
      echarts: { specifier: '6.1.0', version: '6.1.0' },
    };
    const root = tempProject('decl-escape-mocked', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true }),
      // 根内普通文件，但 realpath 被受控 mock 解析到项目根之外（等价于外链，且不依赖文件链接权限）。
      'pnpm-workspace.yaml': yamlStringify({ packages: ['apps/*'] }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
        scripts: { build: 'tsc -p tsconfig.json', typecheck: 'tsc --noEmit' },
      }),
      'pnpm-lock.yaml': pnpmMultiDocLock({ '.': {}, 'apps/client': memberDeps }),
    });
    const linked = path.join(fs.realpathSync(root), 'pnpm-workspace.yaml');
    const external = path.join(fs.realpathSync(outside), 'declaration.yaml');
    fsMock.realpathOverrides.set(linked, external);
    fsMock.reads.length = 0;
    let result: LocalProjectInspectionV1;
    try {
      result = await inspectProject(root, { workspace: 'apps/client' });
    } finally {
      fsMock.realpathOverrides.delete(linked);
    }

    // IO 证据（直接）：inspect 期间既不得读取该链接路径，也不得读取外部声明字节。
    expect(fsMock.reads.some(read => read === linked || read === external), `发生了越界读取：${fsMock.reads.join(', ')}`).toBe(false);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('PATH_UNSAFE');
    expectValid(result);
  });

  it('npm importer 未声明依赖时不得借用其他 importer 的提升版本冒充一致', async () => {
    const memberDeps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('npm-importer-empty', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, workspaces: ['apps/*'] }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: memberDeps,
        scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
      }),
      // importer 'apps/client' 存在但没有任何依赖声明；vue/echarts 只出现在根 node_modules 提升条目中。
      'package-lock.json': npmV3Lock({ '': {}, 'apps/client': {} }, { vue: '3.5.45', echarts: '6.1.0' }),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('conflicted');
    // 目标 importer 未声明的依赖无法从该 importer 证实精确版本，必须显式冲突。
    expect(result.conflicts.map(c => c.code)).toContain('VERSION_UNRESOLVED');
    // 不得把根提升版本记为目标成员的已解析依赖。
    expect(result.resolvedDependencies).toEqual([]);
    expectValid(result);
  });

  it('pnpm-workspace.yaml 多文档声明不同 packages 时失效关闭', async () => {
    const root = tempProject('pnpm-ws-multidoc', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true }),
      // 两个文档各自声明不同成员范围：不得默认选取第一份。
      'pnpm-workspace.yaml': `${yamlStringify({ packages: ['apps/*'] })}---\n${yamlStringify({ packages: ['packages/*'] })}`,
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
      }),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('WORKSPACE_INVALID');
    expectValid(result);
  });

  it('npm workspaces 声明含有非字符串条目时失效关闭', async () => {
    const memberDeps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('npm-ws-invalid-entry', {
      // 不得静默过滤非字符串条目后继续当作有效声明。
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, workspaces: ['apps/*', 42] }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: memberDeps,
        scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
      }),
      'package-lock.json': npmV3Lock({ '': {}, 'apps/client': memberDeps }, { vue: '3.5.45', echarts: '6.1.0' }),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('WORKSPACE_INVALID');
    expectValid(result);
  });

  it('受支持锁旁存在其他包管理器锁时报告 LOCKFILE_MULTIPLE', async () => {
    const deps = { vue: '^3.5.0', echarts: '6.1.0' };
    for (const foreignLock of ['yarn.lock', 'bun.lock', 'bun.lockb']) {
      const root = tempProject(`npm-plus-${foreignLock}`, {
        'package.json': vueNpmManifest,
        'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }),
        [foreignLock]: '# foreign package manager lock\n',
      });

      const result = await inspectProject(root);

      expect(result.status, foreignLock).toBe('conflicted');
      expect(result.conflicts.map(c => c.code), foreignLock).toContain('LOCKFILE_MULTIPLE');
      expectValid(result);
    }
  });

  it('仅有其他包管理器锁时明确报告不支持，不静默按缺锁忽略', async () => {
    const root = tempProject('only-foreign-lock', {
      'package.json': vueNpmManifest,
      'yarn.lock': '# yarn lockfile v1\n',
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    // 必须给出显式的“不支持”冲突（锁格式或包管理器不支持），不得只报 LOCKFILE_MISSING 了事。
    const codes = result.conflicts.map(c => c.code);
    expect(codes.some(code => code === 'LOCKFILE_UNSUPPORTED' || code === 'PACKAGE_MANAGER_UNSUPPORTED')).toBe(true);
    expectValid(result);
  });

  it('非法范围声明（如 ^not-a-version）不得借提升版本冒充已解析', async () => {
    const deps = { vue: '^not-a-version', echarts: '6.1.0' };
    const root = tempProject('illegal-caret', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, dependencies: deps, scripts: { build: 'vite build' },
      }),
      // 清单与 importer 声明一致（都是非法 caret），但锁中提升版本为 3.5.45。
      'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('VERSION_UNRESOLVED');
    expect(resolvedMap(result).vue).toBeUndefined();
    expectValid(result);
  });

  it('已批准的 workspace/catalog/tag 协议声明仍以锁内精确版本为准', async () => {
    const deps: PnpmImporterDeps = {
      react: { specifier: 'workspace:^', version: '19.3.1' },
      'react-dom': { specifier: 'catalog:', version: '19.3.1' },
      echarts: { specifier: 'latest', version: '6.1.0' },
    };
    const root = tempProject('protocol-specifiers', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true,
        dependencies: { react: 'workspace:^', 'react-dom': 'catalog:', echarts: 'latest' },
        scripts: { build: 'tsc -p tsconfig.json', typecheck: 'tsc --noEmit' },
      }),
      'pnpm-lock.yaml': pnpmMultiDocLock({ '.': deps }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('inspected');
    expect(resolvedMap(result).react).toEqual({ name: 'react', version: '19.3.1', specifier: 'workspace:^' });
    expect(resolvedMap(result)['react-dom']).toEqual({ name: 'react-dom', version: '19.3.1', specifier: 'catalog:' });
    expect(resolvedMap(result).echarts).toEqual({ name: 'echarts', version: '6.1.0', specifier: 'latest' });
    expect(result.conflicts).toEqual([]);
    expectValid(result);
  });

  it('Git 父仓库下的子项目根：直接识别只报告项目内路径并折算为项目相对路径', async () => {
    const parent = tempProject('git-parent-child', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, workspaces: ['apps/*'] }),
      'outside.txt': 'outside\n',
      // 子项目根自带清单与锁，可独立识别。
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { vue: '3.5.45' }, scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
      }),
      'apps/client/package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    // Git 根在父仓库，项目根在 apps/client：porcelain v1 路径相对 Git 根。
    initGitRepo(parent);
    git(parent, ['add', '.']);
    git(parent, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    fs.appendFileSync(path.join(parent, 'apps/client/package.json'), '\n');
    fs.writeFileSync(path.join(parent, 'outside.txt'), 'outside modified\n');
    fs.writeFileSync(path.join(parent, 'apps/client/untracked.ts'), 'export const c = 3;\n');
    const childRoot = path.join(parent, 'apps/client');

    const result = await inspectProject(childRoot);

    expect(result.status).toBe('inspected');
    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('package.json');
    expect(result.git.dirtyPaths).toContain('untracked.ts');
    // 不得保留 Git 根相对路径，也不得混入项目根之外的 dirty 文件。
    expect(result.git.dirtyPaths).not.toContain('apps/client/package.json');
    expect(result.git.dirtyPaths).not.toContain('outside.txt');
    expectValid(result);
  });

  it('显式 workspace 调用仍以项目根相对路径报告 Git 脏路径', async () => {
    const memberDeps = { vue: '3.5.45' };
    const root = tempProject('git-parent-explicit-ws', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, workspaces: ['apps/*'] }),
      'package-lock.json': npmV3Lock({ '': {}, 'apps/client': memberDeps }, { vue: '3.5.45' }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: memberDeps,
        scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
      }),
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    fs.appendFileSync(path.join(root, 'apps/client/package.json'), '\n');

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.git.status).toBe('dirty');
    // 项目根即 Git 根：保持项目根相对路径，不做多余折算。
    expect(result.git.dirtyPaths).toContain('apps/client/package.json');
    expectValid(result);
  });
});

describe('T15 P1 真实锁快照消费（A 冻结快照，只读）', () => {
  it('npm v3 单包 Vue 快照：精确版本与 importer 声明一致', async () => {
    const root = realLockProject('npm-vue-single', {
      'package.json': manifestJson({
        name: 'synthetic-npm-vue', version: '0.0.0', private: true, packageManager: 'npm@11.20.0',
        scripts: { build: 'echo build', typecheck: 'echo typecheck' },
        dependencies: { vue: '3.5.45', echarts: '6.1.0' },
      }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('inspected');
    expect(result.lockfile).toEqual({ path: 'package-lock.json', format: 'npm-v3' });
    expect(result.framework).toBe('vue');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.5.45', specifier: '3.5.45' });
    expect(resolvedMap(result).echarts).toEqual({ name: 'echarts', version: '6.1.0', specifier: '6.1.0' });
    expectValid(result);
  });

  it('npm v3 单包 React 快照：react 与 react-dom 均从锁解析', async () => {
    const root = realLockProject('npm-react-single', {
      'package.json': manifestJson({
        name: 'synthetic-npm-react', version: '0.0.0', private: true, packageManager: 'npm@11.20.0',
        scripts: { build: 'echo build', typecheck: 'echo typecheck' },
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
      }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('inspected');
    expect(result.framework).toBe('react');
    expect(resolvedMap(result).react).toEqual({ name: 'react', version: '19.3.1', specifier: '19.3.1' });
    expect(resolvedMap(result)['react-dom']).toEqual({ name: 'react-dom', version: '19.3.1', specifier: '19.3.1' });
    expectValid(result);
  });

  it('npm v3 显式 workspace 快照：成员 importer 与根锁提升版本分别定位', async () => {
    const root = realLockProject('npm-workspace-explicit', {
      'package.json': manifestJson({
        name: 'synthetic-npm-ws', version: '0.0.0', private: true, packageManager: 'npm@11.20.0', workspaces: ['packages/*'],
      }),
      'packages/app-vue/package.json': manifestJson({
        name: '@synthetic/app-vue', version: '0.0.0', private: true,
        scripts: { build: 'echo build', typecheck: 'echo typecheck' },
        dependencies: { vue: '3.5.45', echarts: '6.1.0' },
      }),
    });

    const result = await inspectProject(root, { workspace: 'packages/app-vue' });

    expect(result.status).toBe('inspected');
    expect(result.workspace).toBe('packages/app-vue');
    expect(result.framework).toBe('vue');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.5.45', specifier: '3.5.45' });
    expectValid(result);
  });

  it('pnpm v9 单包 Vue 快照：真实 pnpm 12.18.0 多文档锁（configDependencies 文档 + 项目依赖文档）', async () => {
    const root = realLockProject('pnpm-vue-single', {
      'package.json': manifestJson({
        name: 'synthetic-pnpm-vue', version: '0.0.0', private: true, packageManager: 'pnpm@12.18.0',
        scripts: { build: 'echo build', typecheck: 'echo typecheck' },
        dependencies: { vue: '3.5.45', echarts: '6.1.0' },
      }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('inspected');
    expect(result.lockfile).toEqual({ path: 'pnpm-lock.yaml', format: 'pnpm-v9' });
    expect(result.framework).toBe('vue');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.5.45', specifier: '3.5.45' });
    expect(resolvedMap(result).echarts).toEqual({ name: 'echarts', version: '6.1.0', specifier: '6.1.0' });
    expectValid(result);
  });

  it('pnpm v9 单包 React 快照：真实多文档锁', async () => {
    const root = realLockProject('pnpm-react-single', {
      'package.json': manifestJson({
        name: 'synthetic-pnpm-react', version: '0.0.0', private: true, packageManager: 'pnpm@12.18.0',
        scripts: { build: 'echo build', typecheck: 'echo typecheck' },
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
      }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('inspected');
    expect(result.framework).toBe('react');
    expect(resolvedMap(result).react).toEqual({ name: 'react', version: '19.3.1', specifier: '19.3.1' });
    expect(resolvedMap(result)['react-dom']).toEqual({ name: 'react-dom', version: '19.3.1', specifier: '19.3.1' });
    expectValid(result);
  });

  it('pnpm v9 显式 workspace 快照：apps/chart-react 成员 importer', async () => {
    const root = realLockProject('pnpm-workspace-explicit', {
      'package.json': manifestJson({ name: 'synthetic-pnpm-ws', version: '0.0.0', private: true, packageManager: 'pnpm@12.18.0' }),
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
      'apps/chart-react/package.json': manifestJson({
        name: '@synthetic/chart-react', version: '0.0.0', private: true,
        scripts: { build: 'echo build', typecheck: 'echo typecheck' },
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
      }),
    });

    const result = await inspectProject(root, { workspace: 'apps/chart-react' });

    expect(result.status).toBe('inspected');
    expect(result.workspace).toBe('apps/chart-react');
    expect(result.framework).toBe('react');
    expect(resolvedMap(result)['react-dom']).toEqual({ name: 'react-dom', version: '19.3.1', specifier: '19.3.1' });
    expectValid(result);
  });

  it('pnpm v9 空格/中文 workspace 快照：含无关 Git 脏文件仍 inspected', async () => {
    const member = '业务 应用/前端 client';
    const root = realLockProject('spaces-chinese-dirty', {
      'package.json': manifestJson({ name: 'synthetic-spaces-cn', version: '0.0.0', private: true, packageManager: 'pnpm@12.18.0' }),
      'pnpm-workspace.yaml': "packages:\n  - '业务 应用/*'\n",
      [`${member}/package.json`]: manifestJson({
        name: '@synthetic/cn-client', version: '0.0.0', private: true,
        scripts: { build: 'echo build', typecheck: 'echo typecheck' },
        dependencies: { vue: '3.5.45', echarts: '6.1.0' },
      }),
      'notes/草稿.txt': 'unrelated dirty note\n',
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'baseline']);
    fs.writeFileSync(path.join(root, 'notes/草稿.txt'), 'unrelated dirty note changed\n');

    const result = await inspectProject(root, { workspace: member });

    expect(result.status).toBe('inspected');
    expect(result.workspace).toBe(member);
    expect(result.framework).toBe('vue');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.5.45', specifier: '3.5.45' });
    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('notes/草稿.txt');
    expectValid(result);
  });

  it('两个真实项目依赖文档（相同内容）必须拒绝歧义', async () => {
    const projectDocument = snapshotLockDocuments('pnpm-vue-single')[2]!;
    const root = tempProject('ambiguous-identical', {
      'package.json': manifestJson({
        name: 'synthetic-pnpm-vue', version: '0.0.0', private: true, packageManager: 'pnpm@12.18.0',
        dependencies: { vue: '3.5.45', echarts: '6.1.0' },
      }),
      'pnpm-lock.yaml': `---\n${projectDocument}---\n${projectDocument}`,
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('LOCKFILE_INVALID');
    expectValid(result);
  });

  it('两个真实项目依赖文档（不同依赖）必须拒绝歧义', async () => {
    const vueDocument = snapshotLockDocuments('pnpm-vue-single')[2]!;
    const reactDocument = snapshotLockDocuments('pnpm-react-single')[2]!;
    const root = tempProject('ambiguous-different', {
      'package.json': manifestJson({
        name: 'synthetic-pnpm-vue', version: '0.0.0', private: true, packageManager: 'pnpm@12.18.0',
        dependencies: { vue: '3.5.45', echarts: '6.1.0' },
      }),
      'pnpm-lock.yaml': `---\n${vueDocument}---\n${reactDocument}`,
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('LOCKFILE_INVALID');
    expectValid(result);
  });
});

describe('T15 P1 Git filter 执行反例（宿主 C 实测：固定 argv 的 status 会触发用户 filter）', () => {
  it('只读 status 不得触发 clean filter，且保持真实 dirty 报告', async () => {
    const fixture = createGitFilterProject('clean', 'clean');

    const result = await inspectProject(fixture.root);

    expect(fs.existsSync(fixture.marker), 'clean filter 被 inspect 触发').toBe(false);
    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('payload.txt');
    expectValid(result);
  });

  it('只读 status 不得触发 process filter，且保持真实 dirty 报告', async () => {
    const fixture = createGitFilterProject('process', 'process');

    const result = await inspectProject(fixture.root);

    expect(fs.existsSync(fixture.marker), 'process filter 被 inspect 触发').toBe(false);
    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('payload.txt');
    expectValid(result);
  });
});

describe('T15 P1 最终审查反例（Git 只读边界收口）', () => {
  it('driver 名含下划线时也必须屏蔽（真实 Git 允许的字符）', async () => {
    // 真实 Git 允许 filter driver 名含下划线等字符；不得因字符假设跳过屏蔽。
    const fixture = createGitFilterProject('underscore-driver', 'clean', 'synthetic_driver_1');

    const result = await inspectProject(fixture.root);

    expect(fs.existsSync(fixture.marker), '下划线 driver 的 clean filter 被 inspect 触发').toBe(false);
    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('payload.txt');
    expectValid(result);
  });

  it('filter 枚举失败（exit 2）必须停止 status 并报告 git unavailable', async () => {
    const root = tempProject('git-config-failure', {
      'package.json': manifestJson({ name: 'host-app', version: '1.0.0', private: true, dependencies: { vue: '3.5.45' }, scripts: { build: 'echo build' } }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const a = 1;\n');

    const isConfig = (args: readonly string[]) => args.includes('config');
    gitCalls.overrides.push({
      match: (_command, args) => isConfig(args),
      result: { status: 2, stdout: '', stderr: 'fatal: unable to parse config' },
    });
    let result: LocalProjectInspectionV1;
    try {
      result = await inspectProject(root);
    } finally {
      gitCalls.overrides.length = 0;
    }

    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    // 枚举失败后不得继续调用 status。
    expect(gitCalls.entries.some(entry => entry.args.includes('status'))).toBe(false);
    expectValid(result);
  });

  it('filter 枚举输出无法可靠解析（截断/畸形）必须停止 status', async () => {
    const root = tempProject('git-config-truncated', {
      'package.json': manifestJson({ name: 'host-app', version: '1.0.0', private: true, dependencies: { vue: '3.5.45' }, scripts: { build: 'echo build' } }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const a = 1;\n');

    const isConfig = (args: readonly string[]) => args.includes('config');
    gitCalls.overrides.push({
      // 看似成功的截断输出：无法据此可靠枚举 driver 名。
      match: (_command, args) => isConfig(args),
      result: { status: 0, stdout: 'filter.synthetic_driver_1.clean "node helper.js"', stderr: '' },
    });
    let result: LocalProjectInspectionV1;
    try {
      result = await inspectProject(root);
    } finally {
      gitCalls.overrides.length = 0;
    }

    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    expect(gitCalls.entries.some(entry => entry.args.includes('status'))).toBe(false);
    expectValid(result);
  });

  it('无 filter 时 git config 退出码 1 属正常，不影响真实 dirty 报告', async () => {
    const root = tempProject('git-config-nomatch', {
      'package.json': manifestJson({ name: 'host-app', version: '1.0.0', private: true, dependencies: { vue: '3.5.45' }, scripts: { build: 'echo build' } }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const a = 1;\n');

    const result = await inspectProject(root);

    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('app.ts');
    expectValid(result);
  });

  it('staged rename 必须同时记录源路径与目标路径', async () => {
    const root = tempProject('git-staged-rename', {
      'package.json': manifestJson({ name: 'host-app', version: '1.0.0', private: true, dependencies: { vue: '3.5.45' }, scripts: { build: 'echo build' } }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      'old-name.txt': 'renamed payload\n',
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    fs.renameSync(path.join(root, 'old-name.txt'), path.join(root, 'new-name.txt'));
    git(root, ['add', '--', 'old-name.txt', 'new-name.txt']);

    const result = await inspectProject(root);

    expect(result.git.status).toBe('dirty');
    // 源与目标都必须记录：只留目标会让 DIRTY_TARGET 漏判源路径上的用户改动。
    expect(result.git.dirtyPaths).toContain('old-name.txt');
    expect(result.git.dirtyPaths).toContain('new-name.txt');
    expectValid(result);
  });

  it('porcelain -z 输出须按 NUL 结构化解析：空格/中文路径与真实 rename 结构', async () => {
    const root = tempProject('git-porcelain-z', {
      'package.json': manifestJson({ name: 'host-app', version: '1.0.0', private: true, dependencies: { vue: '3.5.45' }, scripts: { build: 'echo build' } }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    const realRoot = fs.realpathSync(root);

    // 受控 -z 字节（实测 Git 输出结构）：普通条目为 `XY PATH\0`（两列状态 + 一个空格），
    // rename 为 `XY <新路径>\0<旧路径>\0`（先目标后源）；路径含空格与中文，均为 P0 合法路径。
    const isStatus = (args: readonly string[]) => args.includes('status');
    const isRevParse = (args: readonly string[]) => args.includes('rev-parse');
    gitCalls.overrides.push(
      {
        match: (_command, args) => isRevParse(args),
        result: { status: 0, stdout: `${realRoot}\n\n`, stderr: '' },
      },
      {
        match: (_command, args) => isStatus(args),
        result: {
          status: 0,
          stdout: [
            ' M sp ace 2.txt\0',
            'R  中文 目录/文件 2.txt\0中文 目录/文件.txt\0',
            '?? 未跟踪 文件.txt\0',
          ].join(''),
          stderr: '',
        },
      },
    );
    let result: LocalProjectInspectionV1;
    try {
      result = await inspectProject(root);
    } finally {
      gitCalls.overrides.length = 0;
    }

    expect(result.git.status).toBe('dirty');
    // 精确核对：状态列不得吃进路径，rename 的源与目标都记录，空格/中文完整保留。
    expect([...result.git.dirtyPaths].sort()).toEqual([
      'sp ace 2.txt', '中文 目录/文件 2.txt', '中文 目录/文件.txt', '未跟踪 文件.txt',
    ].sort());
    expectValid(result);
  });

  it('porcelain -z 输出截断（末条缺 NUL）必须整体 git unavailable 与空 dirtyPaths', async () => {
    const root = tempProject('git-porcelain-truncated', {
      'package.json': manifestJson({ name: 'host-app', version: '1.0.0', private: true, dependencies: { vue: '3.5.45' }, scripts: { build: 'echo build' } }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    const realRoot = fs.realpathSync(root);

    const isStatus = (args: readonly string[]) => args.includes('status');
    const isRevParse = (args: readonly string[]) => args.includes('rev-parse');
    gitCalls.overrides.push(
      {
        match: (_command, args) => isRevParse(args),
        result: { status: 0, stdout: `${realRoot}\n\n`, stderr: '' },
      },
      {
        // 末条记录缺少 NUL 终止：输出不可靠，不得据此拼出违反 P0 路径规则的 dirtyPaths。
        match: (_command, args) => isStatus(args),
        result: { status: 0, stdout: ' M sp ace 2.txt\0?? 未跟踪 文件.txt', stderr: '' },
      },
    );
    let result: LocalProjectInspectionV1;
    try {
      result = await inspectProject(root);
    } finally {
      gitCalls.overrides.length = 0;
    }

    // 末条记录缺 NUL 终止即输出不可信：必须整体判定 unavailable 且空 dirtyPaths，
    // 不允许退而报告 clean 冒充“已观察且无改动”（此处确有一条完整记录，clean 会丢改动）。
    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    expectValid(result);
  });
});

/**
 * 数据边界复审反例（C 独立审查六项，宿主已核实；实现尚未改，故下列反例当前失败）。
 * 依据：.superpowers/t15/c-inspect-data-review-2026-11-17.md。
 * 一律用 tempProject 直接组装锁/声明字节，不用会覆盖构造锁的 realLockProject；全树只读快照保持。
 */
describe('T15 P1 数据边界复审反例（workspace 选择 / 坏字段 / 锁版本 / specifier / manifest 类型 / 近层 link）', () => {
  /** pnpm v9 锁文档构造器：lockfileVersion 缺省时省略该字段，依赖条目原样写入（可构造不完整条目）。 */
  function pnpmLockDocument(
    importers: Record<string, Record<string, Record<string, unknown>>>,
    lockfileVersion?: unknown,
  ): string {
    const versions = new Map<string, string>();
    for (const deps of Object.values(importers)) {
      for (const [name, entry] of Object.entries(deps)) {
        if (typeof entry['version'] === 'string') versions.set(name, entry['version'] as string);
      }
    }
    const lock: Record<string, unknown> = {
      ...(lockfileVersion === undefined ? {} : { lockfileVersion }),
      importers: Object.fromEntries(Object.entries(importers).map(([importer, deps]) => [importer, { dependencies: deps }])),
      packages: Object.fromEntries([...versions].map(([name, version]) => [`${name}@${version}`, { resolution: { integrity: INTEGRITY } }])),
      snapshots: Object.fromEntries([...versions].map(([name, version]) => [`${name}@${version}`, { dependencies: {} }])),
    };
    return yamlStringify(lock);
  }

  /** pnpm 项目同时带 npm workspaces 与 pnpm-workspace.yaml：成员定位必须依据实际包管理器的原生声明。 */
  function dualDeclarationPnpmProject(name: string): string {
    const memberDeps: PnpmImporterDeps = {
      vue: { specifier: '^3.5.0', version: '3.5.45' },
      echarts: { specifier: '6.1.0', version: '6.1.0' },
    };
    return tempProject(name, {
      'package.json': manifestJson({
        name: 'monorepo', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
        // npm 形态声明：pnpm 并不据此定位成员，不得借它接受 pnpm 已排除的目录。
        workspaces: { packages: ['apps/*'] },
      }),
      'pnpm-workspace.yaml': yamlStringify({ packages: ['packages/*'] }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { vue: '^3.5.0', echarts: '6.1.0' }, scripts: { build: 'vite build' },
      }),
      'packages/ui/package.json': manifestJson({
        name: '@host/ui', version: '1.0.0', private: true,
        dependencies: { vue: '^3.5.0', echarts: '6.1.0' }, scripts: { build: 'vite build' },
      }),
      'pnpm-lock.yaml': pnpmMultiDocLock({ '.': {}, 'apps/client': memberDeps, 'packages/ui': memberDeps }),
    });
  }

  it('pnpm 项目必须按 pnpm 原生声明定位成员，不得按 package.json workspaces 接受 apps/client', async () => {
    const root = dualDeclarationPnpmProject('data-pm-native-pnpm');

    const result = await inspectProject(root, { workspace: 'apps/client' });

    // apps/client 不在 pnpm 声明的 packages/* 内：pnpm 实际会排除该成员，必须显式冲突。
    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('WORKSPACE_INVALID');
    expect(result.resolvedDependencies).toEqual([]);
    expectValid(result);
  });

  it('pnpm 原生声明的成员（packages/*）仍可正确定位并 inspected', async () => {
    const root = dualDeclarationPnpmProject('data-pm-native-pnpm-ok');

    const result = await inspectProject(root, { workspace: 'packages/ui' });

    expect(result.status).toBe('inspected');
    expect(result.workspace).toBe('packages/ui');
    expect(result.framework).toBe('vue');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.5.45', specifier: '^3.5.0' });
    expect(result.conflicts).toEqual([]);
    expectValid(result);
  });

  it('pnpm-workspace.yaml 多文档中 packages 显式存在但类型错误必须失效关闭', async () => {
    const memberDeps: PnpmImporterDeps = {
      react: { specifier: '19.3.1', version: '19.3.1' },
      'react-dom': { specifier: '19.3.1', version: '19.3.1' },
      echarts: { specifier: '6.1.0', version: '6.1.0' },
    };
    const root = tempProject('data-pnpm-ws-badtype', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0' }),
      // 第一份文档显式声明 packages 但类型是数字：不得跳过它再采信后一份合法声明。
      'pnpm-workspace.yaml': `${yamlStringify({ packages: 42 })}---\n${yamlStringify({ packages: ['apps/*'] })}`,
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
      }),
      'pnpm-lock.yaml': pnpmMultiDocLock({ '.': {}, 'apps/client': memberDeps }),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('WORKSPACE_INVALID');
    expectValid(result);
  });

  it('pnpm-workspace.yaml 文档缺 packages 与坏类型不同：后续合法声明仍被接受（守卫）', async () => {
    const memberDeps: PnpmImporterDeps = {
      react: { specifier: '19.3.1', version: '19.3.1' },
      'react-dom': { specifier: '19.3.1', version: '19.3.1' },
      echarts: { specifier: '6.1.0', version: '6.1.0' },
    };
    const root = tempProject('data-pnpm-ws-missing-then-valid', {
      'package.json': manifestJson({ name: 'monorepo', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0' }),
      // 第一份文档没有 packages 字段（缺字段），第二份是合法声明：不得一律判歧义。
      'pnpm-workspace.yaml': `${yamlStringify({ settings: { autoInstallPeers: true } })}---\n${yamlStringify({ packages: ['apps/*'] })}`,
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
      }),
      'pnpm-lock.yaml': pnpmMultiDocLock({ '.': {}, 'apps/client': memberDeps }),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('inspected');
    expect(result.conflicts).toEqual([]);
    expectValid(result);
  });

  it('pnpm 项目锁文档缺少 lockfileVersion 必须 LOCKFILE_INVALID', async () => {
    const root = tempProject('data-pnpm-lock-noversion', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
        dependencies: { vue: '3.5.45' },
      }),
      'pnpm-lock.yaml': pnpmLockDocument({ '.': { vue: { specifier: '3.5.45', version: '3.5.45' } } }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('LOCKFILE_INVALID');
    expectValid(result);
  });

  it('pnpm lockfileVersion 为数组/对象等非标量必须 LOCKFILE_INVALID', async () => {
    const cases: [string, unknown][] = [['array', ['9.0']], ['object', { major: 9 }]];
    for (const [label, version] of cases) {
      const root = tempProject(`data-pnpm-lock-nonscalar-${label}`, {
        'package.json': manifestJson({
          name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
          dependencies: { vue: '3.5.45' },
        }),
        // String(['9.0']) === '9.0'：不能靠字符串化把非标量版本蒙混过关。
        'pnpm-lock.yaml': pnpmLockDocument({ '.': { vue: { specifier: '3.5.45', version: '3.5.45' } } }, version),
      });

      const result = await inspectProject(root);

      expect(result.status, label).toBe('conflicted');
      expect(result.conflicts.map(c => c.code), label).toContain('LOCKFILE_INVALID');
      expectValid(result);
    }
  });

  it('pnpm lockfileVersion 伪造 9.x 尾缀不得当作 v9 接受', async () => {
    const root = tempProject('data-pnpm-lock-fakeversion', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
        dependencies: { vue: '3.5.45' },
      }),
      // 真实 pnpm 只写 '9.0'；'9.0.1' 之类的尾缀不能凭 startsWith('9.') 通过。
      'pnpm-lock.yaml': pnpmLockDocument({ '.': { vue: { specifier: '3.5.45', version: '3.5.45' } } }, '9.0.1'),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    const codes = result.conflicts.map(c => c.code);
    expect(codes.some(code => code === 'LOCKFILE_INVALID' || code === 'LOCKFILE_UNSUPPORTED')).toBe(true);
    expectValid(result);
  });

  it('pnpm importer 条目缺少 specifier 时必须显式冲突，不得默认相信', async () => {
    const root = tempProject('data-pnpm-entry-no-specifier', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
        dependencies: { vue: '^3.5.0' },
      }),
      // 条目只有 version：清单声明 ^3.5.0 无法与该条目核对一致性（锁版本合法，隔离 specifier 缺陷）。
      'pnpm-lock.yaml': pnpmLockDocument({ '.': { vue: { version: '3.5.45' } } }, '9.0'),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    const codes = result.conflicts.map(c => c.code);
    expect(codes.some(code => code === 'VERSION_MISMATCH' || code === 'VERSION_UNRESOLVED')).toBe(true);
    expect(resolvedMap(result).vue).toBeUndefined();
    expectValid(result);
  });

  it('pnpm importer 条目 specifier 非字符串时必须显式冲突', async () => {
    const root = tempProject('data-pnpm-entry-bad-specifier', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
        dependencies: { vue: '^3.5.0' },
      }),
      'pnpm-lock.yaml': pnpmLockDocument({ '.': { vue: { specifier: 42, version: '3.5.45' } } }, '9.0'),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    const codes = result.conflicts.map(c => c.code);
    expect(codes.some(code => code === 'VERSION_MISMATCH' || code === 'VERSION_UNRESOLVED')).toBe(true);
    expect(resolvedMap(result).vue).toBeUndefined();
    expectValid(result);
  });

  it('manifest 依赖字段含有非字符串声明必须失效关闭（不得静默丢弃）', async () => {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const root = tempProject(`data-manifest-bad-dep-${field}`, {
        'package.json': manifestJson({
          name: 'host-app', version: '1.0.0', private: true,
          [field]: { vue: '^3.5.0', echarts: 42 },
          scripts: { build: 'vite build' },
        }),
        'package-lock.json': npmV3Lock({ '': { vue: '^3.5.0', echarts: '6.1.0' } }, { vue: '3.5.45', echarts: '6.1.0' }),
      });

      const result = await inspectProject(root);

      // 坏类型条目不能被悄悄跳过：锁旁有合法 Vue 也必须显式冲突。
      expect(result.status, field).toBe('conflicted');
      expect(result.conflicts.map(c => c.code), field).toContain('WORKSPACE_INVALID');
      expectValid(result);
    }
  });

  it('manifest scripts 含有非字符串值不得输出假的可用脚本', async () => {
    const root = tempProject('data-manifest-bad-scripts', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true,
        dependencies: { vue: '^3.5.0' }, scripts: { build: 7 },
      }),
      'package-lock.json': npmV3Lock({ '': { vue: '^3.5.0' } }, { vue: '3.5.45' }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    expect(result.scripts).not.toContain('build');
    expectValid(result);
  });

  it('manifest packageManager 非字符串必须失效关闭（不得当作未声明）', async () => {
    const root = tempProject('data-manifest-bad-pm', {
      'package.json': manifestJson({
        name: 'host-app', version: '1.0.0', private: true, packageManager: 42,
        dependencies: { vue: '^3.5.0' }, scripts: { build: 'vite build' },
      }),
      'package-lock.json': npmV3Lock({ '': { vue: '^3.5.0' } }, { vue: '3.5.45' }),
    });

    const result = await inspectProject(root);

    expect(result.status).toBe('conflicted');
    const codes = result.conflicts.map(c => c.code);
    expect(codes.some(code => code === 'WORKSPACE_INVALID' || code === 'PACKAGE_MANAGER_UNSUPPORTED')).toBe(true);
    expectValid(result);
  });

  it('npm 近层 link 遮蔽条目不得借用根提升版本冒充目标版本', async () => {
    const root = tempProject('data-npm-near-layer-link', {
      'package.json': manifestJson({
        name: 'monorepo', version: '1.0.0', private: true, packageManager: 'npm@11.20.0', workspaces: ['apps/*'],
      }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true,
        dependencies: { vue: 'file:../../local-vue' }, scripts: { build: 'vite build' },
      }),
      // file: 目标目录：本地 vue 4（与根提升的 vue 3 不同）。
      'local-vue/package.json': manifestJson({ name: 'vue', version: '4.0.0', main: 'index.js' }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3, name: 'monorepo', requires: true,
        packages: {
          '': { name: 'monorepo', version: '1.0.0', workspaces: ['apps/*'] },
          'apps/client': { name: '@host/client', version: '1.0.0', dependencies: { vue: 'file:../../local-vue' } },
          // 近层实际遮蔽条目：link 记录，没有 version；不得继续借根 node_modules/vue 的 3.5.45。
          'apps/client/node_modules/vue': { resolved: 'local-vue', link: true },
          'local-vue': { name: 'vue', version: '4.0.0' },
          'node_modules/vue': {
            version: '3.5.45', resolved: 'https://registry.npmjs.org/vue/-/vue-3.5.45.tgz', integrity: INTEGRITY,
          },
        },
      }, null, 2),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    // 近层 link 遮蔽根提升版本：要么解析锁内链接记录（4.0.0 → FRAMEWORK_UNSUPPORTED），
    // 要么保守 VERSION_UNRESOLVED；两者都必须 conflicted 且不得把根 Vue3 当作目标版本。
    expect(result.status).toBe('conflicted');
    expect(resolvedMap(result).vue?.version).not.toBe('3.5.45');
    expectValid(result);
  });

  it('pnpm 项目缺少 pnpm-workspace.yaml 时不得按 npm workspaces 声明接受成员（守卫）', async () => {
    const root = tempProject('data-pnpm-no-native-declaration', {
      'package.json': manifestJson({
        name: 'monorepo', version: '1.0.0', private: true, packageManager: 'pnpm@12.18.0',
        // npm 形态声明：pnpm 并不读取它定位成员；无 pnpm-workspace.yaml 即无原生成员声明。
        workspaces: ['apps/*'],
      }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: { vue: '^3.5.0' }, scripts: { build: 'vite build' },
      }),
      'pnpm-lock.yaml': pnpmMultiDocLock({ '.': {}, 'apps/client': { vue: { specifier: '^3.5.0', version: '3.5.45' } } }),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('conflicted');
    expect(result.conflicts.map(c => c.code)).toContain('WORKSPACE_INVALID');
    // 成员资格未确认：不得把该目录的 importer/依赖当作已验证目标输出。
    expect(result.resolvedDependencies).toEqual([]);
    expect(result.lockfile).toBeUndefined();
    expectValid(result);
  });

  it('npm 近层自带 version 的条目仍优先于根提升版本（守卫）', async () => {
    const root = tempProject('data-npm-near-layer-version', {
      'package.json': manifestJson({
        name: 'monorepo', version: '1.0.0', private: true, packageManager: 'npm@11.20.0', workspaces: ['apps/*'],
      }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: { vue: '^3.4.0' }, scripts: { build: 'vite build' },
      }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3, name: 'monorepo', requires: true,
        packages: {
          '': { name: 'monorepo', version: '1.0.0', workspaces: ['apps/*'] },
          'apps/client': { name: '@host/client', version: '1.0.0', dependencies: { vue: '^3.4.0' } },
          // 近层条目自带精确版本：必须优先于根提升版本解析。
          'apps/client/node_modules/vue': {
            version: '3.4.0', resolved: 'https://registry.npmjs.org/vue/-/vue-3.4.0.tgz', integrity: INTEGRITY,
          },
          'node_modules/vue': {
            version: '3.5.45', resolved: 'https://registry.npmjs.org/vue/-/vue-3.5.45.tgz', integrity: INTEGRITY,
          },
        },
      }, null, 2),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('inspected');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.4.0', specifier: '^3.4.0' });
    expectValid(result);
  });

  it('npm 近层记录 resolved 指向无关包（无 link、无 version）不得借其版本冒充目标', async () => {
    const root = tempProject('data-npm-near-unrelated-resolved', {
      'package.json': manifestJson({
        name: 'monorepo', version: '1.0.0', private: true, packageManager: 'npm@11.20.0', workspaces: ['apps/*'],
      }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: { vue: '^3.5.0' }, scripts: { build: 'vite build' },
      }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3, name: 'monorepo', requires: true,
        packages: {
          '': { name: 'monorepo', version: '1.0.0', workspaces: ['apps/*'] },
          'apps/client': { name: '@host/client', version: '1.0.0', dependencies: { vue: '^3.5.0' } },
          // 近层记录既无 version 也无 link 标记，resolved 却指向另一个包：不得采信它的版本。
          'apps/client/node_modules/vue': { resolved: 'node_modules/not-vue' },
          'node_modules/not-vue': {
            version: '3.5.45', resolved: 'https://registry.npmjs.org/not-vue/-/not-vue-3.5.45.tgz', integrity: INTEGRITY,
          },
          'node_modules/vue': {
            version: '3.5.45', resolved: 'https://registry.npmjs.org/vue/-/vue-3.5.45.tgz', integrity: INTEGRITY,
          },
        },
      }, null, 2),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    // 旁边无关包的版本不能充当目标 vue 的精确版本。
    expect(result.status).toBe('conflicted');
    expect(resolvedMap(result).vue).toBeUndefined();
    expectValid(result);
  });

  it('npm 近层记录显式为 null 必须失效关闭，不得当作缺失而借根提升版本', async () => {
    const root = tempProject('data-npm-near-null-record', {
      'package.json': manifestJson({
        name: 'monorepo', version: '1.0.0', private: true, packageManager: 'npm@11.20.0', workspaces: ['apps/*'],
      }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: { vue: '^3.5.0' }, scripts: { build: 'vite build' },
      }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3, name: 'monorepo', requires: true,
        packages: {
          '': { name: 'monorepo', version: '1.0.0', workspaces: ['apps/*'] },
          'apps/client': { name: '@host/client', version: '1.0.0', dependencies: { vue: '^3.5.0' } },
          // 显式坏记录（null）与“该层没有记录”不是一回事：不得跳过它去借根提升版本。
          'apps/client/node_modules/vue': null,
          'node_modules/vue': {
            version: '3.5.45', resolved: 'https://registry.npmjs.org/vue/-/vue-3.5.45.tgz', integrity: INTEGRITY,
          },
        },
      }, null, 2),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('conflicted');
    expect(resolvedMap(result).vue).toBeUndefined();
    expectValid(result);
  });

  it('npm 近层合法 link 记录仍解析锁内目标（守卫）', async () => {
    const root = tempProject('data-npm-near-legal-link', {
      'package.json': manifestJson({
        name: 'monorepo', version: '1.0.0', private: true, packageManager: 'npm@11.20.0', workspaces: ['apps/*'],
      }),
      'apps/client/package.json': manifestJson({
        name: '@host/client', version: '1.0.0', private: true, dependencies: { vue: '^3.5.0' }, scripts: { build: 'vite build' },
      }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3, name: 'monorepo', requires: true,
        packages: {
          '': { name: 'monorepo', version: '1.0.0', workspaces: ['apps/*'] },
          'apps/client': { name: '@host/client', version: '1.0.0', dependencies: { vue: '^3.5.0' } },
          // 合法 link 记录：link===true 且 resolved 指向锁内目标，正常解析其精确版本。
          'apps/client/node_modules/vue': { resolved: 'local-vue', link: true },
          'local-vue': { name: 'vue', version: '3.5.45' },
          'node_modules/vue': {
            version: '3.4.0', resolved: 'https://registry.npmjs.org/vue/-/vue-3.4.0.tgz', integrity: INTEGRITY,
          },
        },
      }, null, 2),
    });

    const result = await inspectProject(root, { workspace: 'apps/client' });

    expect(result.status).toBe('inspected');
    expect(resolvedMap(result).vue).toEqual({ name: 'vue', version: '3.5.45', specifier: '^3.5.0' });
    expectValid(result);
  });
});

/**
 * 第七项：变换型 Git filter 的 false-clean（宿主 C 已实证，`.superpowers/t15/c-filter-falseclean-review-2026-11-17.md`）。
 * 构造：clean filter 把 `"version": "N.N.N"` 的主版本号 +1。于是 T(1.0.0)=2.0.0、T(2.0.0)=3.0.0。
 * `git add` 会把变换后的字节存进索引；用户再把工作区文件写成“变换后的内容”时：
 * - 原生 status（filter 生效）必须再跑一次 filter 才能发现改动 → 真脏（控制正例）；
 * - 置空 filter 的 status 用原始字节比对索引 → 认为未改 → false clean（当前实现的缺陷）。
 * 要求：inspect 不执行 filter、目标树字节不变，但必须把受 filter 的 tracked 路径保守记为 dirty，
 * 不得伪称 clean，也不得把整个项目报成 git unavailable 来掩盖可能被改写的清单。
 */
/** 变换型 clean filter：主版本号 +1（既改写内容，也保证对已变换内容再次变换结果不同）。 */
const TRANSFORMING_CLEAN_FILTER_HELPER = String.raw`const fs=require('node:fs');let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>{fs.appendFileSync(process.argv[2],'clean-invoked\n');process.stdout.write(data.replace(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/g,(m,a,b,c)=>'"version": "'+(Number(a)+1)+'.'+b+'.'+c+'"'));});`;

type TransformingFilterFixture = { root: string; marker: string };

/**
 * 构造变换型 filter 项目：helper 与 marker 都放在项目根之外。
 * 两个控制正例都必须生效，否则视为测试环境问题直接抛错（不静默跳过、不误判为通过）：
 * ① git add 触发 helper（索引存入变换后的字节）；② 原生 status 报告脏且触发 helper。
 */
function createTransformingFilterProject(name: string, payloadRelative: string, files: Record<string, string>): TransformingFilterFixture {
  const root = tempProject(`git-transform-${name}`, {
    ...files,
    '.gitattributes': `${payloadRelative} filter=reviewtransform\n`,
  });
  const helperDir = tempProject(`git-transform-helper-${name}`, {});
  const marker = path.join(helperDir, 'clean.marker');
  const helper = path.join(helperDir, 'clean-helper.cjs');
  fs.writeFileSync(helper, TRANSFORMING_CLEAN_FILTER_HELPER, 'utf8');
  initGitRepo(root);
  const filterCommand = [process.execPath, helper, marker].map(shellArgument).join(' ');
  git(root, ['config', 'filter.reviewtransform.clean', filterCommand]);
  git(root, ['config', 'filter.reviewtransform.required', 'true']);
  // 控制正例 ①：git add 必须触发 filter，索引里存的是变换后的字节。
  git(root, ['add', '--all']);
  if (!fs.existsSync(marker)) {
    throw new Error(`变换型 filter 控制正例①未生效（${name}）：git add 未触发 filter helper，无法建立 false-clean 前提`);
  }
  git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'transformed baseline']);
  // 索引字节即 T(原始内容)；把它写回工作区，等价于“用户把文件改成变换后的内容”。
  const indexText = execFileSync('git', ['show', `:${payloadRelative}`], { cwd: root, encoding: 'utf8' });
  const payloadAbs = path.join(root, ...payloadRelative.split('/'));
  fs.writeFileSync(payloadAbs, indexText, 'utf8');
  const stat = fs.statSync(payloadAbs);
  fs.utimesSync(payloadAbs, new Date(stat.mtimeMs + 5000), new Date(stat.mtimeMs + 5000));
  // 控制正例 ②：原生 status（filter 生效）必须报告该路径脏，并再次触发 helper。
  fs.rmSync(marker, { force: true });
  const nativeOut = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  if (!nativeOut.includes(payloadRelative) || !fs.existsSync(marker)) {
    throw new Error(`变换型 filter 控制正例②未生效（${name}）：原生 status 未报告脏或未触发 helper，无法建立 false-clean 前提`);
  }
  fs.rmSync(marker, { force: true });
  return { root, marker };
}


describe('T15 P1 filter 语义复审反例（变换型 filter 的 false-clean）', () => {
  it('变换型 filter 下受 filter 的 package.json 必须保守记为 dirty（不得伪称 clean）', async () => {
    const fixture = createTransformingFilterProject('manifest', 'package.json', {
      'package.json': manifestJson({
        name: 'synthetic-filter-host', version: '1.0.0', private: true, packageManager: 'npm@11.20.0',
        dependencies: { vue: '3.5.45' }, scripts: { build: 'echo synthetic' },
      }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    const before = snapshotTree(fixture.root);

    const result = await inspectProject(fixture.root);

    // 只读边界：不执行用户 filter helper，目标树字节不变。
    expect(fs.existsSync(fixture.marker), 'inspect 不得执行用户 filter helper').toBe(false);
    expect(snapshotTree(fixture.root)).toEqual(before);
    // 但必须发现真实改动：受 filter 的 tracked 清单保守记为 dirty。
    expect(result.git.status).toBe('dirty');
    expect([...result.git.dirtyPaths].sort()).toEqual(['package.json']);
    expectValid(result);
  });

  it('变换型 filter 下受 filter 的普通 tracked 文件同样保守记为 dirty，且不把无关路径一概标脏', async () => {
    const fixture = createTransformingFilterProject('payload', 'payload.txt', {
      'package.json': manifestJson({
        name: 'synthetic-filter-host', version: '1.0.0', private: true, packageManager: 'npm@11.20.0',
        dependencies: { vue: '3.5.45' }, scripts: { build: 'echo synthetic' },
      }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      // 含 version 串的普通 tracked 文件：变换型 filter 对它同样造成 false clean。
      'payload.txt': '{ "version": "1.0.0" }\n',
    });
    const before = snapshotTree(fixture.root);

    const result = await inspectProject(fixture.root);

    expect(fs.existsSync(fixture.marker), 'inspect 不得执行用户 filter helper').toBe(false);
    expect(snapshotTree(fixture.root)).toEqual(before);
    expect(result.git.status).toBe('dirty');
    // 只有受 filter 的路径被保守标脏；清单与锁未改，不应当成脏。
    expect([...result.git.dirtyPaths].sort()).toEqual(['payload.txt']);
    expectValid(result);
  });
});

/**
 * filter 关联枚举的只读边界（C 对第七项修复的要求）：
 * 固定 argv 的 `ls-files -z` + `check-attr -z filter --stdin`，同一清理环境，
 * 完整 NUL、每条记录三字段、路径归属可靠；实际关联已枚举 driver 的 tracked 路径保守并入，
 * 未关联不标脏；畸形/截断/退出失败整体 git unavailable。
 */
describe('T15 P1 filter 关联枚举边界（ls-files / check-attr 只读收口）', () => {
  /** Git 环境覆盖变量：任何只读子进程都不得携带（否则可能改变实际检查目标）。 */
  const GIT_ENV_OVERRIDE_KEYS = [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
    'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_EXTERNAL_DIFF', 'GIT_TEXTCOV',
  ];

  function envOf(entry: { options?: unknown }): Record<string, string | undefined> | undefined {
    return (entry.options as { env?: Record<string, string | undefined> } | undefined)?.env;
  }

  function inputOf(entry: { options?: unknown }): string | undefined {
    return (entry.options as { input?: string } | undefined)?.input;
  }

  /** 构造带 filter 配置的 Git 基线项目（clean 为原样透传 helper），返回根与 marker。 */
  function filterAssociationProject(
    name: string,
    attributes: string,
    files: Record<string, string>,
    driver = 'reviewtransform',
  ): { root: string; marker: string } {
    const root = tempProject(`git-assoc-${name}`, { ...files, '.gitattributes': attributes });
    const helperDir = tempProject(`git-assoc-helper-${name}`, {});
    const marker = path.join(helperDir, 'clean.marker');
    const helper = path.join(helperDir, 'clean-helper.cjs');
    fs.writeFileSync(helper, CLEAN_FILTER_HELPER, 'utf8');
    initGitRepo(root);
    const filterCommand = [process.execPath, helper, marker].map(shellArgument).join(' ');
    git(root, ['config', `filter.${driver}.clean`, filterCommand]);
    git(root, ['config', `filter.${driver}.required`, 'true']);
    git(root, ['add', '--all']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'baseline']);
    fs.rmSync(marker, { force: true });
    return { root, marker };
  }

  const vueManifest = manifestJson({
    name: 'synthetic-filter-host', version: '1.0.0', private: true, packageManager: 'npm@11.20.0',
    dependencies: { vue: '3.5.45' }, scripts: { build: 'echo synthetic' },
  });

  /** 该 fixture 的已跟踪路径（git ls-files 排序结果），用于构造受控 check-attr 输出。 */
  const ASSOC_TRACKED = ['.gitattributes', 'other.bin', 'package-lock.json', 'package.json', 'plain.txt'];

  it('filter 关联枚举使用固定 argv 与同一清理环境，且输入为完整 NUL 的已跟踪路径', async () => {
    const fixture = filterAssociationProject('argv', [
      'package.json filter=reviewtransform',
      'plain.txt filter',
      'other.bin -filter',
      '',
    ].join('\n'), {
      'package.json': vueManifest,
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      'plain.txt': 'no driver value\n',
      'other.bin': 'explicitly unset\n',
    });
    gitCalls.entries.length = 0;

    const result = await inspectProject(fixture.root);

    expect(result.git.status).toBe('dirty');
    const allGitCalls = gitCalls.entries;
    const lsFiles = allGitCalls.filter(entry => entry.args.includes('ls-files'));
    const checkAttr = allGitCalls.filter(entry => entry.args.includes('check-attr'));
    // 普通 `ls-files -z`（取已跟踪路径）与 `ls-files --stage -z`（gitlink stage 枚举）各一次：
    // 后者对所有可检查 Git 项目固定执行，不用工作树形态做触发前置。
    const lsFilesPlain = lsFiles.filter(entry => !entry.args.includes('--stage'));
    const lsFilesStage = lsFiles.filter(entry => entry.args.includes('--stage'));
    expect(lsFilesPlain.length, '普通 ls-files -z 只调用一次').toBe(1);
    expect(lsFilesStage.length, 'gitlink stage 枚举只调用一次').toBe(1);
    expect(checkAttr.length, 'check-attr 只调用一次').toBe(1);
    // 固定 argv：基础只读参数 + filter 屏蔽 + 子命令与 -z/--stdin/filter 属性名。
    for (const entry of [...lsFilesPlain, ...lsFilesStage]) {
      expect(entry.args).toContain('--no-pager');
      expect(entry.args).toContain('--no-optional-locks');
      expect(entry.args).toContain('core.fsmonitor=false');
      expect(entry.args).toContain('filter.reviewtransform.clean=');
      expect(entry.args).toContain('filter.reviewtransform.required=false');
    }
    expect(lsFilesPlain[0]!.args.slice(-2)).toEqual(['ls-files', '-z']);
    expect(lsFilesStage[0]!.args.slice(-3)).toEqual(['ls-files', '--stage', '-z']);
    expect(checkAttr[0]!.args.slice(-4)).toEqual(['check-attr', '-z', '--stdin', 'filter']);
    // check-attr 的输入是完整 NUL 终止的已跟踪路径集合。
    const input = inputOf(checkAttr[0]!);
    expect(typeof input).toBe('string');
    expect(input!.endsWith('\0')).toBe(true);
    expect(input!.split('\0').filter(part => part.length > 0).sort()).toEqual(ASSOC_TRACKED);
    // 同一清理环境：所有只读子进程都不得携带 Git 环境覆盖变量，且禁用交互提示。
    for (const entry of gitCalls.entries) {
      const env = envOf(entry);
      expect(env, `${entry.args.join(' ')} 必须显式传 env`).toBeDefined();
      for (const key of GIT_ENV_OVERRIDE_KEYS) {
        expect(env?.[key], `${entry.args.join(' ')} 不得携带 ${key}`).toBeUndefined();
      }
      expect(env?.GIT_TERMINAL_PROMPT).toBe('0');
    }
    expectValid(result);
  });

  it('check-attr 输出末条缺 NUL（截断）必须整体 git unavailable', async () => {
    const fixture = filterAssociationProject('attr-truncated', 'package.json filter=reviewtransform\n', {
      'package.json': vueManifest,
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    let result: LocalProjectInspectionV1;
    try {
      gitCalls.overrides.push({
        match: (_command, args) => args.includes('check-attr'),
        // 末条记录缺少 NUL 终止：输出不可信。
        result: { status: 0, stdout: 'package.json\0filter\0reviewtransform', stderr: '' },
      });
      result = await inspectProject(fixture.root);
    } finally {
      gitCalls.overrides.length = 0;
    }

    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    expectValid(result);
  });

  it('check-attr 退出码异常必须整体 git unavailable', async () => {
    const fixture = filterAssociationProject('attr-exit', 'package.json filter=reviewtransform\n', {
      'package.json': vueManifest,
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    let result: LocalProjectInspectionV1;
    try {
      gitCalls.overrides.push({
        match: (_command, args) => args.includes('check-attr'),
        result: { status: 2, stdout: '', stderr: 'fatal: unable to read attributes' },
      });
      result = await inspectProject(fixture.root);
    } finally {
      gitCalls.overrides.length = 0;
    }

    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    expectValid(result);
  });

  it('check-attr 记录不是三字段或属性名不符必须整体 git unavailable', async () => {
    for (const [label, stdout] of [
      ['字段数不整', `${ASSOC_TRACKED.map(path => `${path}\0filter\0unspecified`).join('\0')}\0package.json\0filter\0`],
      ['属性名不符', 'package.json\0diff\0reviewtransform\0'],
    ] as const) {
      const fixture = filterAssociationProject(`attr-malformed-${label}`, 'package.json filter=reviewtransform\n', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      });
      let result: LocalProjectInspectionV1;
      try {
        gitCalls.overrides.push({
          match: (_command, args) => args.includes('check-attr'),
          result: { status: 0, stdout, stderr: '' },
        });
        result = await inspectProject(fixture.root);
      } finally {
        gitCalls.overrides.length = 0;
      }

      expect(result.git, label).toEqual({ status: 'unavailable', dirtyPaths: [] });
      expectValid(result);
    }
  });

  it('check-attr 返回的路径不属于本次已跟踪集合必须整体 git unavailable', async () => {
    const fixture = filterAssociationProject('attr-foreign-path', 'package.json filter=reviewtransform\n', {
      'package.json': vueManifest,
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });
    let result: LocalProjectInspectionV1;
    try {
      gitCalls.overrides.push({
        match: (_command, args) => args.includes('check-attr'),
        // 掺入一个不在 ls-files 输出里的路径（项目外/不存在）：归属不可信。
        result: {
          status: 0,
          stdout: [
            ...ASSOC_TRACKED.map(path => `${path}\0filter\0unspecified`),
            '../outside.txt\0filter\0reviewtransform\0',
          ].join('\0'),
          stderr: '',
        },
      });
      result = await inspectProject(fixture.root);
    } finally {
      gitCalls.overrides.length = 0;
    }

    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    expectValid(result);
  });

  it('ls-files 退出码异常或输出截断必须整体 git unavailable', async () => {
    for (const [label, result_] of [
      ['退出码异常', { status: 2, stdout: '', stderr: 'fatal: not a git repository' }],
      ['输出截断', { status: 0, stdout: 'package.json\0package-lock.json', stderr: '' }],
    ] as const) {
      const fixture = filterAssociationProject(`ls-${label}`, 'package.json filter=reviewtransform\n', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      });
      let result: LocalProjectInspectionV1;
      try {
        gitCalls.overrides.push({
          match: (_command, args) => args.includes('ls-files'),
          result: result_,
        });
        result = await inspectProject(fixture.root);
      } finally {
        gitCalls.overrides.length = 0;
      }

      expect(result.git, label).toEqual({ status: 'unavailable', dirtyPaths: [] });
      expectValid(result);
    }
  });

  it('只有实际关联已枚举 driver 的 tracked 路径被保守标脏（set/unset/unspecified 不标脏）', async () => {
    const fixture = filterAssociationProject('association-forms', [
      'package.json filter=reviewtransform',
      'plain.txt filter',
      'other.bin -filter',
      '',
    ].join('\n'), {
      'package.json': vueManifest,
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      'plain.txt': 'no driver value\n',
      'other.bin': 'explicitly unset\n',
    });

    const result = await inspectProject(fixture.root);

    // 未修改文件：raw status 为空；只有 filter=<已枚举 driver> 的 package.json 被保守并入。
    expect(result.git.status).toBe('dirty');
    expect([...result.git.dirtyPaths].sort()).toEqual(['package.json']);
    expectValid(result);
  });

  it('已枚举 driver 但没有任何路径关联时不标脏（守卫）', async () => {
    const fixture = filterAssociationProject('no-association', '', {
      'package.json': vueManifest,
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
    });

    const result = await inspectProject(fixture.root);

    // 有 filter 配置但 .gitattributes 不关联任何路径：不得把全项目一概标脏。
    expect(result.git).toEqual({ status: 'clean', dirtyPaths: [] });
    expectValid(result);
  });

  it('未配置的 driver 名不触发关联枚举（守卫）', async () => {
    const root = tempProject('git-assoc-unconfigured-driver', {
      'package.json': vueManifest,
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      // 关联了一个从未配置的 driver：没有任何 filter 配置可枚举。
      '.gitattributes': 'package.json filter=nobody-configured-this\n',
    });
    initGitRepo(root);
    git(root, ['add', '--all']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'baseline']);

    const result = await inspectProject(root);
    expect(result.git).toEqual({ status: 'clean', dirtyPaths: [] });
    expectValid(result);
  });

  /**
   * 最终复审反例（C：`.superpowers/t15/c-filter-association-final-review-2026-11-17.md`）。
   * 两条边界：① ls-files 只验证了 NUL 完整性，没验证每条路径本身——空路径/穿越路径会被采信；
   * ② check-attr 的 `set`/`unset`/`unspecified` 特殊状态与合法同名 driver 的输出完全一致
   *    （实测：`filter=set` 与裸 `filter` 都输出 `set`，但前者会真实应用 filter.set.clean），
   *    仅凭 `drivers.includes(info)` 既会把未关联文件全标脏，也会在消掉多报时引入漏报。
   */
  describe('路径合法性与特殊状态歧义（最终复审）', () => {
    it('ls-files 输出含空路径必须整体 git unavailable，且不得送入属性命令', async () => {
      const fixture = filterAssociationProject('final-empty-path', 'package.json filter=reviewtransform\n', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      });
      gitCalls.entries.length = 0;
      let result: LocalProjectInspectionV1;
      try {
        gitCalls.overrides.push(
          {
            match: (_command, args) => args.includes('ls-files'),
            // 完整 NUL 但不是合法路径：空路径。
            result: { status: 0, stdout: '\0', stderr: '' },
          },
          {
            match: (_command, args) => args.includes('check-attr'),
            result: { status: 0, stdout: '\0filter\0unspecified\0', stderr: '' },
          },
        );
        result = await inspectProject(fixture.root);
      } finally {
        gitCalls.overrides.length = 0;
      }

      expect(gitCalls.entries.some(entry => entry.args.includes('check-attr')), '非法路径必须在送入属性命令前拒绝').toBe(false);
      expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
      expectValid(result);
    });

    it('ls-files 输出含穿越路径（未关联）必须整体 git unavailable，且不得送入属性命令', async () => {
      const fixture = filterAssociationProject('final-traversal-plain', 'package.json filter=reviewtransform\n', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      });
      gitCalls.entries.length = 0;
      let result: LocalProjectInspectionV1;
      try {
        gitCalls.overrides.push(
          {
            match: (_command, args) => args.includes('ls-files'),
            result: { status: 0, stdout: '../outside.txt\0', stderr: '' },
          },
          {
            match: (_command, args) => args.includes('check-attr'),
            result: { status: 0, stdout: '../outside.txt\0filter\0unspecified\0', stderr: '' },
          },
        );
        result = await inspectProject(fixture.root);
      } finally {
        gitCalls.overrides.length = 0;
      }

      expect(gitCalls.entries.some(entry => entry.args.includes('check-attr')), '非法路径必须在送入属性命令前拒绝').toBe(false);
      expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
      expectValid(result);
    });

    it('ls-files 输出含穿越路径（关联）必须整体 git unavailable，不得产出非法 inspection', async () => {
      const fixture = filterAssociationProject('final-traversal-linked', 'package.json filter=reviewtransform\n', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      });
      gitCalls.entries.length = 0;
      let result: LocalProjectInspectionV1 | undefined;
      let thrown: unknown;
      try {
        gitCalls.overrides.push(
          {
            match: (_command, args) => args.includes('ls-files'),
            result: { status: 0, stdout: '../outside.txt\0', stderr: '' },
          },
          {
            match: (_command, args) => args.includes('check-attr'),
            result: { status: 0, stdout: '../outside.txt\0filter\0reviewtransform\0', stderr: '' },
          },
        );
        result = await inspectProject(fixture.root);
      } catch (error) {
        thrown = error;
      } finally {
        gitCalls.overrides.length = 0;
      }

      expect(gitCalls.entries.some(entry => entry.args.includes('check-attr')), '非法路径必须在送入属性命令前拒绝').toBe(false);
      // 不得把穿越路径拼进 dirtyPaths 触发契约校验失败，必须整体判不可用。
      expect(thrown, `不得产出非法 inspection：${String(thrown)}`).toBeUndefined();
      expect(result?.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    });

    it('check-attr 特殊状态 set 与同名 driver 碰撞时不得把未关联文件标脏', async () => {
      // driver 名为 set：裸 `filter`（信息值 set）与显式 `filter=set` 输出完全相同，
      // 但前者不应用任何 filter、后者应用 filter.set.clean——无法据此可靠区分。
      const fixture = filterAssociationProject('final-special-set', 'plain.txt filter\n', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
        'plain.txt': 'no driver value\n',
      }, 'set');

      const result = await inspectProject(fixture.root);

      expect(result.git.status).not.toBe('dirty');
      expectValid(result);
    });

    it('check-attr 特殊状态 unset 与同名 driver 碰撞时不得把未关联文件标脏', async () => {
      const fixture = filterAssociationProject('final-special-unset', 'plain.txt -filter\n', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
        'plain.txt': 'explicitly unset\n',
      }, 'unset');

      const result = await inspectProject(fixture.root);

      expect(result.git.status).not.toBe('dirty');
      expectValid(result);
    });

    it('check-attr 特殊状态 unspecified 与同名 driver 碰撞时不得把未关联文件标脏', async () => {
      // 无任何 .gitattributes 关联：所有文件的信息值都是 unspecified。
      const fixture = filterAssociationProject('final-special-unspecified', '', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      }, 'unspecified');

      const result = await inspectProject(fixture.root);

      expect(result.git.status).not.toBe('dirty');
      expectValid(result);
    });

    it('显式同名真实 driver（filter=unspecified）不得因歧义处理而漏报（守卫）', async () => {
      // .gitattributes 显式 filter=unspecified，且 filter.unspecified.clean 是真实变换 helper：
      // 索引里存的是变换后字节。任何实现都不得把它报成 clean（那等于重新引入 false-clean）。
      const fixture = createTransformingFilterProject('final-explicit-unspecified', 'package.json', {
        'package.json': manifestJson({
          name: 'synthetic-filter-host', version: '1.0.0', private: true, packageManager: 'npm@11.20.0',
          dependencies: { vue: '3.5.45' }, scripts: { build: 'echo synthetic' },
        }),
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      });
      // 把 driver 名换成 unspecified，并让 .gitattributes 显式指向它。
      const root = fixture.root;
      git(root, ['config', '--unset', 'filter.reviewtransform.clean']);
      git(root, ['config', '--unset', 'filter.reviewtransform.required']);
      git(root, ['config', 'filter.unspecified.clean', [process.execPath, path.join(path.dirname(fixture.marker), 'clean-helper.cjs'), fixture.marker].map(shellArgument).join(' ')]);
      git(root, ['config', 'filter.unspecified.required', 'true']);
      fs.writeFileSync(path.join(root, '.gitattributes'), 'package.json filter=unspecified\n', 'utf8');
      git(root, ['add', '--all']);
      git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'explicit same-named driver']);
      const indexText = execFileSync('git', ['show', ':package.json'], { cwd: root, encoding: 'utf8' });
      fs.writeFileSync(path.join(root, 'package.json'), indexText, 'utf8');
      const stat = fs.statSync(path.join(root, 'package.json'));
      fs.utimesSync(path.join(root, 'package.json'), new Date(stat.mtimeMs + 5000), new Date(stat.mtimeMs + 5000));
      fs.rmSync(fixture.marker, { force: true });

      const result = await inspectProject(root);

      // 允许“可靠区分后标脏”或“名称歧义失效关闭”，但不允许 clean。
      expect(fs.existsSync(fixture.marker), 'inspect 不得执行用户 filter helper').toBe(false);
      expect(result.git.status).not.toBe('clean');
      expectValid(result);
    });

    it('真实中文/空格路径仍能正常关联并入（守卫）', async () => {
      // .gitattributes 的模式含空格，必须按 git 规则加双引号（否则被当成两个 token）。
      const fixture = filterAssociationProject('final-cjk-path', '"数据 文件.txt" filter=reviewtransform\n', {
        'package.json': vueManifest,
        'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
        '数据 文件.txt': '业务 数据\n',
      });

      const result = await inspectProject(fixture.root);

      expect(result.git.status).toBe('dirty');
      expect(result.git.dirtyPaths).toEqual(['数据 文件.txt']);
      expectValid(result);
    });

    it('嵌套项目根：Git 根在项目根之上时只并入项目内的关联路径（守卫）', async () => {
      const root = tempProject('git-assoc-nested-root', {
        'apps/client/package.json': vueManifest,
        'apps/client/package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
        'apps/client/.gitattributes': 'package.json filter=reviewtransform\n',
        // 仓库根上的同名关联文件：不在项目根内，不得混入。
        'outer.txt': 'outer\n',
        '.gitattributes': 'outer.txt filter=reviewtransform\n',
      });
      const helperDir = tempProject('git-assoc-nested-helper', {});
      const marker = path.join(helperDir, 'clean.marker');
      const helper = path.join(helperDir, 'clean-helper.cjs');
      fs.writeFileSync(helper, CLEAN_FILTER_HELPER, 'utf8');
      initGitRepo(root);
      git(root, ['config', 'filter.reviewtransform.clean', [process.execPath, helper, marker].map(shellArgument).join(' ')]);
      git(root, ['config', 'filter.reviewtransform.required', 'true']);
      git(root, ['add', '--all']);
      git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'baseline']);
      fs.rmSync(marker, { force: true });

      const result = await inspectProject(path.join(root, 'apps', 'client'));

      expect(result.git.status).toBe('dirty');
      expect(result.git.dirtyPaths).toEqual(['package.json']);
      expectValid(result);
    });
  });
});

/**
 * Git 子模块零执行边界（C 已实证：`.superpowers/t15/c-submodule-zeroexec-review-2026-11-17.md`）。
 * 真实 fixture：父仓无任何 filter 配置，但 vendor/child 是已初始化的子仓，子仓内有唯一
 * `childonly.clean`（helper/marker 都在项目外）。子仓 payload 被改成“变换后的内容”后，
 * 父仓用当前固定完整 status 参数检查时会递归跑子仓 status → 执行子仓 helper（marker 为证）。
 * 要求：inspect 零 helper 执行、全树（含 .git）字节不变；项目内存在 gitlink 而无法安全
 * 完整识别其 dirty 状态时明确 git unavailable，不得忽略后伪称 clean；普通无 gitlink 项目
 * 保持既有脏识别。file protocol 仅用于自有临时 submodule add，不改变全局 Git。
 */
describe('T15 P1 Git 子模块零执行边界（真实子模块 fixture）', () => {
  /** 当前实现的固定只读 status 基础参数（用于控制正例复现执行泄漏）。 */
  const GIT_STATUS_CONTROL_ARGV = [
    '--no-pager',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    '-c', 'core.quotePath=false',
    '-c', 'diff.external=',
    '-c', 'diff.textconv=',
    '--no-optional-locks',
  ];

  /** 全树深度快照（含 .git 内部字节）：验证 inspect 不改变目标项目任何字节。 */
  function deepTreeSnapshot(root: string): Map<string, string> {
    const entries = new Map<string, string>();
    const walk = (dir: string, rel: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) entries.set(childRel, `link:${fs.readlinkSync(abs)}`);
        else if (entry.isDirectory()) {
          entries.set(childRel, 'dir');
          walk(abs, childRel);
        } else {
          entries.set(childRel, `file:${fs.statSync(abs).size}:${fs.readFileSync(abs).toString('base64')}`);
        }
      }
    };
    walk(root, '');
    return entries;
  }

  type SubmoduleFixture = { root: string; marker: string };

  /** 构造“父仓无 filter + 已初始化子仓唯一 childonly filter”的真实 fixture。 */
  function createSubmoduleProject(name: string): SubmoduleFixture {
    const outside = tempProject(`git-submodule-outside-${name}`, {});
    const marker = path.join(outside, 'child-clean.marker');
    const helper = path.join(outside, 'child-transform.cjs');
    fs.writeFileSync(helper, TRANSFORMING_CLEAN_FILTER_HELPER, 'utf8');
    // 子仓种子：此时尚未配置 driver，索引里存的是原始字节。
    const seed = tempProject(`git-submodule-seed-${name}`, {
      '.gitattributes': 'payload.txt filter=childonly\n',
      'payload.txt': '{ "name": "synthetic-filter-host", "version": "1.0.0", "private": true }\n',
    });
    initGitRepo(seed);
    // 固定 synthetic fixture 行尾，避免宿主 autocrlf=true 使 stat size 不同而跳过 filter 控制。
    git(seed, ['config', 'core.autocrlf', 'false']);
    git(seed, ['add', '--all']);
    git(seed, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'seed']);
    // 父仓：清单 + 嵌套项目目录（Git 根即父仓根）。
    const root = tempProject(`git-submodule-${name}`, {
      'package.json': manifestJson({ name: 'synthetic-parent', version: '1.0.0', private: true }),
      'apps/nested-project/package.json': manifestJson({ name: '@host/nested', version: '1.0.0', private: true }),
    });
    initGitRepo(root);
    git(root, ['config', 'core.autocrlf', 'false']);
    git(root, ['add', '--all']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'parent baseline']);
    // 自有临时子模块（file protocol 仅用于此，不改变全局 Git）。
    git(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--', fs.realpathSync(seed), 'vendor/child']);
    // 子仓内配置唯一 childonly driver，并把 payload 改成“变换后的内容”后提交。
    const child = path.join(root, 'vendor', 'child');
    git(child, ['config', 'user.email', 't15-fixture@example.invalid']);
    git(child, ['config', 'user.name', 'T15 Fixture']);
    git(child, ['config', 'core.autocrlf', 'false']);
    git(child, ['config', 'filter.childonly.clean', [process.execPath, helper, marker].map(shellArgument).join(' ')]);
    git(child, ['config', 'filter.childonly.required', 'true']);
    git(child, ['add', '--all']);
    const indexText = execFileSync('git', ['show', ':payload.txt'], { cwd: child, encoding: 'utf8' });
    fs.writeFileSync(path.join(child, 'payload.txt'), indexText, 'utf8');
    git(child, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'child transformed baseline']);
    git(root, ['add', '--all']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'initialized submodule baseline']);
    fs.rmSync(marker, { force: true });
    return { root, marker };
  }

  /** 控制正例：当前完整 status 参数必须真的执行子模块 helper，否则抛错（不静默跳过）。 */
  function assertSubmoduleHelperExecutes(cwd: string, marker: string, expectedPath: string): void {
    fs.rmSync(marker, { force: true });
    const out = execFileSync('git', [...GIT_STATUS_CONTROL_ARGV, 'status', '--porcelain', '-z', '--untracked-files=all'], {
      cwd, encoding: 'utf8',
    });
    if (!out.includes(expectedPath) || !fs.existsSync(marker)) {
      throw new Error(`子模块零执行控制正例未生效（${cwd}）：status 未报告 ${expectedPath} 或未执行子模块 helper，无法建立反例前提`);
    }
    fs.rmSync(marker, { force: true });
  }

  it('项目内 gitlink：inspect 不得执行子模块 helper，且无法安全识别时明确 git unavailable', async () => {
    const fixture = createSubmoduleProject('in-project');
    // 控制正例：父仓当前 status 参数会递归执行子仓 helper。
    assertSubmoduleHelperExecutes(fixture.root, fixture.marker, 'vendor/child');
    const before = deepTreeSnapshot(fixture.root);

    const result = await inspectProject(fixture.root);

    expect(fs.existsSync(fixture.marker), 'inspect 不得执行子模块 filter helper').toBe(false);
    expect(deepTreeSnapshot(fixture.root)).toEqual(before);
    // 项目内存在 gitlink，无法安全完整识别其 dirty 状态：明确 unavailable，不得伪称 clean。
    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    expectValid(result);
  }, 30_000); // 多次真实 Git 子进程与快照的外层预算；inspect 内部期限不变。

  it('Git 根在项目根之上且子模块在项目外：不得执行外部 helper，也不得把项目外路径当脏', async () => {
    const fixture = createSubmoduleProject('outside-project');
    const nested = path.join(fixture.root, 'apps', 'nested-project');
    // 控制正例：从嵌套项目目录用当前 status 参数同样会执行项目外子仓 helper。
    assertSubmoduleHelperExecutes(nested, fixture.marker, 'vendor/child');
    const before = deepTreeSnapshot(fixture.root);

    const result = await inspectProject(nested);

    expect(fs.existsSync(fixture.marker), 'inspect 不得执行项目外子模块 helper').toBe(false);
    expect(deepTreeSnapshot(fixture.root)).toEqual(before);
    // 子模块在项目范围之外：项目自身可完整检查，报 clean；不得把项目外路径算进 dirtyPaths。
    expect(result.git).toEqual({ status: 'clean', dirtyPaths: [] });
    expectValid(result);
  }, 30_000);

  it('普通无 gitlink 项目保持既有脏识别，不得一律 unavailable（守卫）', async () => {
    const deps = { vue: '^3.5.0', echarts: '6.1.0' };
    const root = tempProject('git-submodule-none', {
      'package.json': vueNpmManifest,
      'package-lock.json': npmV3Lock({ '': deps }, { vue: '3.5.45', echarts: '6.1.0' }),
      'app.ts': 'export const a = 1;\n',
    });
    initGitRepo(root);
    git(root, ['add', '.']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'init']);
    fs.appendFileSync(path.join(root, 'app.ts'), 'export const b = 2;\n');

    const result = await inspectProject(root);

    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('app.ts');
    expectValid(result);
  });

  /**
   * gitlink 触发可靠性回归（C：`.superpowers/t15/c-gitlink-trigger-implementation-review-2026-11-17.md`）。
   * 项目内 gitlink 登记在**索引**里，不依赖工作树：子模块目录可以不存在，`.gitmodules` 可以在当前
   * project 根之外、被用户删除或从未登记，plain `ls-files` 只有路径名、无法据此证明“不是 gitlink”。
   * 因此“项目范围内存在 160000”必须靠固定 argv 的 stage 枚举本身判定，不能用工作树目录/`.gitmodules`
   * 作为触发前置——否则会漏掉本应 unavailable 的项目，并让 status 在忽略子模块后伪称 clean。
   *
   * 场景：外层 Git 根，目标项目 `apps/client`，索引在 `apps/client/child` 登记 160000，
   * 但该目录不存在、项目根无 `.gitmodules`、外层也没有；其余工作树文件干净，
   * `--ignore-submodules=all` 的 status 输出为空。要求 inspect 明确 git unavailable。
   */
  it('项目内索引登记 160000 但目录不存在且无 .gitmodules：必须 git unavailable（触发可靠性回归）', async () => {
    // 自有 seed 提供一个真实 commit OID（不运行任何子仓代码）。
    const seed = tempProject('git-gitlink-trigger-seed', { 'payload.txt': 'seed\n' });
    initGitRepo(seed);
    git(seed, ['add', '--all']);
    git(seed, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'seed']);
    const seedOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: seed, encoding: 'utf8' }).trim();
    // 外层 Git 根：目标项目 apps/client 自带清单与锁，索引里登记 160000 child。
    const root = tempProject('git-gitlink-trigger-root', {
      'apps/client/package.json': vueNpmManifest,
      // 与原 vueNpmManifest 的两项声明一致，让 inspected 守卫不被缺 ECharts 锁条目遮挡。
      'apps/client/package-lock.json': npmV3Lock({ '': { vue: '^3.5.0', echarts: '6.1.0' } }, { vue: '3.5.45', echarts: '6.1.0' }),
    });
    initGitRepo(root);
    git(root, ['add', '--all']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'baseline']);
    // 合法索引记录：160000 <真实 commit OID> apps/client/child；刻意不创建该目录、不写 .gitmodules。
    git(root, ['update-index', '--add', '--cacheinfo', `160000,${seedOid},apps/client/child`]);

    // 控制正例：索引里确实是 160000，且忽略子模块后的 status 为空（否则不会伪称 clean，前提不成立）。
    const staged = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: path.join(root, 'apps', 'client'), encoding: 'utf8' });
    if (!staged.includes('160000') || !staged.includes('child')) {
      throw new Error('gitlink 触发回归控制正例未生效：项目内索引未登记 160000 child，无法建立反例前提');
    }
    const controlStatus = execFileSync('git', [
      '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.quotePath=false',
      '-c', 'diff.external=', '-c', 'diff.textconv=', '-c', 'status.submoduleSummary=false', '--no-optional-locks',
      'status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=all',
    ], { cwd: path.join(root, 'apps', 'client'), encoding: 'utf8' });
    if (controlStatus !== '') {
      throw new Error(`gitlink 触发回归控制正例未生效：忽略子模块后的 status 非空（${JSON.stringify(controlStatus)}），不存在伪称 clean 的风险`);
    }
    const before = deepTreeSnapshot(root);

    const result = await inspectProject(path.join(root, 'apps', 'client'));

    // 项目内存在 gitlink：无法安全完整识别其 dirty 状态，必须明确 unavailable，不得伪称 clean。
    expect(deepTreeSnapshot(root)).toEqual(before);
    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    expect(result.status).toBe('inspected');
    expectValid(result);
  });
});

/**
 * Git 零执行边界收口：partial clone 缺失对象 + 共享 argv 守卫
 * （C 已实证：`.superpowers/t15/c-promisor-zeroexec-review-2026-11-17.md`，证据
 * `partial-clone-lazy-fetch-result-2026-11-17.json` SHA `cafa466b…59d3a5`）。
 *
 * 真实 `--filter=blob:none --no-checkout --no-local` clone 有 .promisor pack，索引里的
 * .gitattributes blob 缺失；remote 切到自有 ext transport helper（写项目外 marker 后 exit 1）。
 * 当前固定 argv 的 check-attr 与 status 会自动 lazy-fetch 并执行该 helper（宿主 Git 2.48.1 实测）。
 * 要求：所有 inspection Git 元数据命令共享 `--no-lazy-fetch`；失败即整体 unavailable，
 * 不得重试无保护命令；不得因 status 失败而掩盖零执行失败。
 * 宿主 Git 2.48.1 支持该 flag，正式零 skip RED 由宿主 C 固定工具链执行；本用例不用 skip
 * 代替 RED，fixture 或控制正例的任一失败都作为失败显式暴露。
 */
describe('T15 P1 Git 零执行边界收口（partial clone lazy-fetch + 共享 argv 守卫）', () => {
  const GIT_BASE_CONTROL_ARGV = [
    '--no-pager',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    '-c', 'core.quotePath=false',
    '-c', 'diff.external=',
    '-c', 'diff.textconv=',
    '--no-optional-locks',
  ];

  /** 全树深度快照（含 .git 内部字节）：验证 inspect 不改变目标项目任何字节。 */
  function deepSnapshot(root: string): Map<string, string> {
    const entries = new Map<string, string>();
    const walk = (dir: string, rel: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) entries.set(childRel, `link:${fs.readlinkSync(abs)}`);
        else if (entry.isDirectory()) {
          entries.set(childRel, 'dir');
          walk(abs, childRel);
        } else {
          entries.set(childRel, `file:${fs.statSync(abs).size}:${fs.readFileSync(abs).toString('base64')}`);
        }
      }
    };
    walk(root, '');
    return entries;
  }

  type PromisorFixture = { root: string; marker: string };

  /**
   * 构造“真正 partial clone + 缺失 .gitattributes blob + 外置 ext helper”的 fixture。
   * 若当前 Git 版本无法满足前提（如沙箱 Git 2.34.1 既不支持 --no-lazy-fetch、clone 也未真正缺对象），
   * 抛错交由调用方跳过——不以 0 tests 或静默 skip 代替宿主正式 RED。
   */
  function createPromisorProject(name: string): PromisorFixture {
    const outside = tempProject(`git-promisor-outside-${name}`, {});
    const marker = path.join(outside, 'transport.marker');
    const helper = path.join(outside, 'transport-helper.cjs');
    // 外置 transport helper：写项目外 marker 后立即 exit 1，不访问真实网络。
    fs.writeFileSync(helper, String.raw`const fs=require('node:fs');fs.appendFileSync(process.argv[2],'invoked\n');process.exit(1);`, 'utf8');
    // 源库：.gitattributes 的 blob 将在 partial clone 中缺失。
    const source = tempProject(`git-promisor-source-${name}`, {
      '.gitattributes': 'payload.txt filter=reviewtransform\n',
      'package.json': manifestJson({ name: 'synthetic-promisor-host', version: '1.0.0', private: true }),
      'payload.txt': 'payload\n',
    });
    initGitRepo(source);
    git(source, ['config', 'uploadpack.allowFilter', 'true']);
    git(source, ['add', '--all']);
    git(source, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'source baseline']);
    // 真正的 partial clone（blob:none，不检出），再 read-tree 建索引。
    const parent = tempProject(`git-promisor-parent-${name}`, {});
    git(parent, [
      '-c', 'protocol.file.allow=always', 'clone', '--quiet',
      '--filter=blob:none', '--no-checkout', '--no-local', fs.realpathSync(source), 'project',
    ]);
    const root = path.join(parent, 'project');
    git(root, ['read-tree', 'HEAD']);
    // 控制：索引里的 .gitattributes blob 确实缺失（--missing=print 会以 ? 前缀列出）。
    const missing = execFileSync('git', ['rev-list', '--objects', '--missing=print', 'HEAD'], { cwd: root, encoding: 'utf8' });
    const blobOid = execFileSync('git', ['rev-parse', 'HEAD:.gitattributes'], { cwd: root, encoding: 'utf8' }).trim();
    if (!missing.split('\n').some(line => line.trim() === `?${blobOid}`)) {
      throw new Error(`partial clone 控制正例未生效：.gitattributes blob ${blobOid} 未缺失，无法建立 lazy-fetch 前提`);
    }
    // 工作区放回应存在的文件（不含 .gitattributes，使其成为缺失对象）。
    fs.copyFileSync(path.join(source, 'package.json'), path.join(root, 'package.json'));
    fs.copyFileSync(path.join(source, 'payload.txt'), path.join(root, 'payload.txt'));
    git(root, ['config', 'remote.origin.url', `ext::${process.execPath} ${helper} ${marker}`]);
    git(root, ['config', 'protocol.ext.allow', 'always']);
    fs.rmSync(marker, { force: true });
    return { root, marker };
  }

  /**
   * 控制正例：当前固定 argv 必须真的 lazy-fetch 并执行外置 transport helper，否则抛错。
   * helper 执行后 status 以 128 失败（C 实证）是预期结果，不能让它先抛错掩盖 marker 校验；
   * 因此用 spawnSync 有界执行、明确忽略退出码，只以 marker 是否存在判定前提是否成立。
   */
  function assertPromisorHelperExecutes(root: string, marker: string): void {
    fs.rmSync(marker, { force: true });
    spawnSync('git', [...GIT_BASE_CONTROL_ARGV, 'status', '--porcelain', '-z', '--untracked-files=all'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!fs.existsSync(marker)) {
      throw new Error('partial clone 控制正例未生效：当前 argv 的 status 未 lazy-fetch 执行外置 transport helper，无法建立反例前提');
    }
    fs.rmSync(marker, { force: true });
  }

  it('partial clone 缺失属性 blob：inspect 不得 lazy-fetch 执行外置 transport helper', async () => {
    // fixture 与控制正例的任一失败都是 setup 失败，必须作为失败显式暴露，不用 skip 代替 RED。
    const fixture = createPromisorProject('lazy-fetch');
    assertPromisorHelperExecutes(fixture.root, fixture.marker);
    const before = deepSnapshot(fixture.root);

    const result = await inspectProject(fixture.root);

    expect(fs.existsSync(fixture.marker), 'inspect 不得 lazy-fetch 执行外置 transport helper').toBe(false);
    expect(deepSnapshot(fixture.root)).toEqual(before);
    // 不得因 status 失败而掩盖零执行失败：工作区缺失的 .gitattributes 必须被发现。
    expect(result.git.status).toBe('dirty');
    expect(result.git.dirtyPaths).toContain('.gitattributes');
    expectValid(result);
  });

  it('inspect 的所有 Git 元数据命令共享 --no-lazy-fetch（argv 守卫）', async () => {
    const root = tempProject('git-shared-no-lazy', {
      'package.json': manifestJson({
        name: 'synthetic-filter-host', version: '1.0.0', private: true, packageManager: 'npm@11.20.0',
        dependencies: { vue: '3.5.45' }, scripts: { build: 'echo synthetic' },
      }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      '.gitattributes': 'package.json filter=reviewtransform\n',
    });
    initGitRepo(root);
    git(root, ['config', 'filter.reviewtransform.clean', 'cat']);
    git(root, ['config', 'filter.reviewtransform.required', 'false']);
    git(root, ['add', '--all']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'baseline']);
    gitCalls.entries.length = 0;

    const result = await inspectProject(root);

    expect(result.git.status).toBe('dirty');
    const calls = gitCalls.entries;
    expect(calls.length, 'inspect 必须实际调用 Git 元数据命令').toBeGreaterThan(0);
    for (const entry of calls) {
      expect(entry.args, `${entry.args.join(' ')} 必须带 --no-lazy-fetch`).toContain('--no-lazy-fetch');
    }
    // 保护参数必须位于子命令之前（git 顶层选项）。
    for (const subcommand of ['status', 'check-attr', 'ls-files', 'rev-parse', 'config']) {
      const entry = calls.find(candidate => candidate.args.includes(subcommand));
      if (!entry) continue;
      expect(entry.args.indexOf('--no-lazy-fetch'), `${subcommand} 的 --no-lazy-fetch 必须位于子命令之前`).toBeLessThan(entry.args.indexOf(subcommand));
    }
    expectValid(result);
  });

  it('Git 元数据命令失败时整体 unavailable，且不重试无保护命令', async () => {
    const root = tempProject('git-shared-no-lazy-failure', {
      'package.json': manifestJson({
        name: 'synthetic-filter-host', version: '1.0.0', private: true, packageManager: 'npm@11.20.0',
        dependencies: { vue: '3.5.45' }, scripts: { build: 'echo synthetic' },
      }),
      'package-lock.json': npmV3Lock({ '': { vue: '3.5.45' } }, { vue: '3.5.45' }),
      '.gitattributes': 'package.json filter=reviewtransform\n',
    });
    initGitRepo(root);
    git(root, ['config', 'filter.reviewtransform.clean', 'cat']);
    git(root, ['config', 'filter.reviewtransform.required', 'false']);
    git(root, ['add', '--all']);
    git(root, ['-c', 'core.hooksPath=', 'commit', '--quiet', '-m', 'baseline']);
    gitCalls.entries.length = 0;
    let result: LocalProjectInspectionV1;
    try {
      gitCalls.overrides.push({
        match: (_command, args) => args.includes('status'),
        // 模拟 promisor remote 取不到对象：退出码 128。
        result: { status: 128, stdout: '', stderr: 'fatal: could not fetch cd77e84c from promisor remote' },
      });
      result = await inspectProject(root);
    } finally {
      gitCalls.overrides.length = 0;
    }

    expect(result.git).toEqual({ status: 'unavailable', dirtyPaths: [] });
    // 失败后不得出现任何不带保护参数的重试。
    for (const entry of gitCalls.entries) {
      expect(entry.args, `${entry.args.join(' ')} 必须带 --no-lazy-fetch`).toContain('--no-lazy-fetch');
    }
    expectValid(result);
  });
});
