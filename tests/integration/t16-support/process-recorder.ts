/** 测试私有 spawn/spawnSync mock：named/default 共用；严格记录启动前字节并物化 synthetic 包树。真实安装矩阵另行验收。 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { parseAllDocuments, stringify as yamlStringify } from 'yaml';
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import { linkDirectory, syntheticRoot, treeSnapshot, tarballFileName, tarballIntegrity } from './synthetic-projects.js';

export type RecordedProcessCall = {
  command: string;
  args: string[];
  cwd: string | undefined;
  env: Record<string, string | undefined>;
  shell: boolean | undefined;
  sync: boolean;
  files?: Record<string, string>;
  lockAfter?: string;
};

export type ProcessInterceptRequest = {
  command: string;
  args: readonly string[];
  cwd: string | undefined;
  shell: boolean | undefined;
  env: Record<string, string | undefined> | undefined;
  sync: boolean;
};

export type ProcessInterceptResult = {
  syncResult?: SpawnSyncReturns<Buffer>;
  child?: ChildProcess;
};

export type SyntheticDependency = { name: string; version: string };

export type MaterializationMode =
  | 'succeed'
  | 'fail'
  | 'wrong-version'
  | 'rewrite-lock'
  | 'drop-package'
  | 'external-link';

export type ProcessRecorderState = {
  calls: RecordedProcessCall[];
  /** 候选锁生成进程的合成结果。 */
  candidateLock: 'succeed' | 'fail';
  /** 冻结依赖物化进程的合成结果。 */
  materialization: MaterializationMode;
  /** 计划的确切实依赖：物化受控包树时按它写真实版本。 */
  dependencies: SyntheticDependency[];
  /** 本地 loopback registry origin：候选锁的 resolution 来源必须与它一致。 */
  fixtureErrors?: string[];
  stageOutsideBaseline?: Map<string, string>;
  registryOrigin: string | undefined;
  /** 由 installProcessInterceptor 安装；null 表示尚未安装（导入期调用会透明委派）。 */
  intercept: ((request: ProcessInterceptRequest) => ProcessInterceptResult | undefined) | null;
  /** `external-link` 模式下工程外链接目标的真实目录（供用例断言零改动）。 */
  stageOutsideRoot: string | undefined;
};

// ─── 受控包树：真实目录 + 真实 package.json / 入口文件 ───

export function materializePackageTree(root: string, dependencies: readonly SyntheticDependency[]): void {
  for (const dependency of dependencies) {
    const directory = path.join(root, 'node_modules', ...dependency.name.split('/'));
    fs.mkdirSync(path.join(directory, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({
      name: dependency.name,
      version: dependency.version,
      main: 'dist/index.js',
      module: 'dist/index.mjs',
      types: 'dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs', require: './dist/index.js' } },
    }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(directory, 'dist', 'index.js'),
      `"use strict";\nmodule.exports = { name: ${JSON.stringify(dependency.name)}, version: ${JSON.stringify(dependency.version)} };\n`, 'utf8');
    fs.writeFileSync(path.join(directory, 'dist', 'index.mjs'),
      `export const name = ${JSON.stringify(dependency.name)};\nexport const version = ${JSON.stringify(dependency.version)};\n`, 'utf8');
    fs.writeFileSync(path.join(directory, 'dist', 'index.d.ts'),
      'export declare const name: string;\nexport declare const version: string;\n', 'utf8');
  }
}

/** 只支持已有明确静态成员，不展开动态/否定模式。 */
function stagedWorkspaceMembers(cwd: string): string[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const workspaceFile = path.join(cwd, 'pnpm-workspace.yaml');
  const entries = fs.existsSync(workspaceFile) ? (yamlParse(fs.readFileSync(workspaceFile, 'utf8')) as { packages: unknown }).packages : manifest.workspaces;
  if (entries === undefined) return [];
  if (!Array.isArray(entries) || entries.some(p => typeof p !== 'string' || /[*!?]/.test(p) || path.isAbsolute(p) || p.split(/[\\/]/).includes('..'))) throw new Error('fixture: non-static staging workspace');
  for (const entry of entries) fs.readFileSync(path.join(cwd, entry, 'package.json'), 'utf8');
  return entries;
}
function importerDependencies(cwd: string, importer: string, known: readonly SyntheticDependency[]): SyntheticDependency[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, importer, 'package.json'), 'utf8'));
  const declared = Object.entries(manifest.dependencies ?? {}) as [string, unknown][];
  return declared.map(([name, specifier]) => {
    const exact = known.find(d => d.name === name);
    if (!exact || typeof specifier !== 'string') throw new Error('fixture: unknown dependency ' + name);
    return { name, version: exact.version };
  });
}
function yamlParse(text: string): unknown {
  const documents = parseAllDocuments(text, { strict: true, logLevel: 'silent' });
  if (documents.length !== 1 || documents[0]!.errors.length) throw new Error('fixture: invalid staging YAML');
  return documents[0]!.toJS();
}
/** 候选锁：按暂存 manifest 的真实 name/version、依赖与 registry origin 写出，供产品冻结与后续核对。 */
function writeCandidateLock(cwd: string, kind: 'npm' | 'pnpm', dependencies: readonly SyntheticDependency[], registryOrigin: string | undefined): void {
  if (registryOrigin === undefined || registryOrigin.length === 0) {
    throw new Error('T16 辅助：未提供 registry origin，拒绝写出来源不可信的候选锁');
  }
  const manifest = readStagedManifest(cwd);
  const integrityOf = tarballIntegrity;
  // 静态 workspace：根 importer 与每个成员 importer 都要按各自真实清单写锁。
  const members = stagedWorkspaceMembers(cwd);
  const importers: { path: string; dependencies: SyntheticDependency[] }[] = [
    { path: '.', dependencies: importerDependencies(cwd, '.', dependencies) },
  ];
  for (const member of members) importers.push({ path: member, dependencies: importerDependencies(cwd, member, dependencies) });
  const allDependencies = importers.flatMap(importer => importer.dependencies);

  if (kind === 'npm') {
    const packages: Record<string, unknown> = {
      '': {
        name: manifest.name, version: manifest.version,
        dependencies: Object.fromEntries(importers[0]!.dependencies.map(dependency => [dependency.name, dependency.version])),
      },
    };
    for (const importer of importers) {
      if (importer.path === '.') continue;
      packages[importer.path] = { dependencies: Object.fromEntries(importer.dependencies.map(dependency => [dependency.name, dependency.version])) };
    }
    for (const dependency of allDependencies) {
      packages[`node_modules/${dependency.name}`] = {
        version: dependency.version,
        // 必须用真实 tarball 文件名（scope 包去掉 scope 前缀），否则指向不存在的路由。
        resolved: `${registryOrigin}/${dependency.name}/-/${tarballFileName(dependency.name, dependency.version)}`,
        integrity: integrityOf(dependency.name, dependency.version),
      };
    }
    fs.writeFileSync(path.join(cwd, 'package-lock.json'), `${JSON.stringify({
      name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages,
    }, null, 2)}\n`, 'utf8');
    return;
  }
  const lockImporters: Record<string, unknown> = {};
  const packages: Record<string, unknown> = {};
  const snapshots: Record<string, unknown> = {};
  for (const importer of importers) {
    lockImporters[importer.path] = {
      dependencies: Object.fromEntries(importer.dependencies.map(dependency => [dependency.name, { specifier: dependency.version, version: dependency.version }])),
    };
  }
  for (const dependency of allDependencies) {
    packages[`${dependency.name}@${dependency.version}`] = { resolution: { integrity: integrityOf(dependency.name, dependency.version) } };
    snapshots[`${dependency.name}@${dependency.version}`] = { dependencies: {} };
  }
  fs.writeFileSync(path.join(cwd, 'pnpm-lock.yaml'),
    `${yamlStringify({ lockfileVersion: '9.0', importers: lockImporters, packages, snapshots })}`, 'utf8');
}

/** 真实改写已冻结的候选锁：改一个依赖的锁存版本，字节与语义都不再等于冻结内容。 */
function rewriteFrozenLock(cwd: string, kind: 'npm' | 'pnpm', dependencies: readonly SyntheticDependency[], registryOrigin: string | undefined): void {
  if (!registryOrigin) throw new Error('fixture: rewrite missing registry');
  const changed = dependencies.map(dependency => ({ ...dependency, version: bumpPatch(dependency.version) }));
  if (changed.length === 0) throw new Error('fixture: rewrite requires a dependency');
  if (kind === 'npm') {
    const lockPath = path.join(cwd, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const packages = lock['packages'] as Record<string, Record<string, unknown>> | undefined;
    if (!packages) throw new Error('fixture: missing lock packages');
    {
      for (const dependency of changed) {
        const entry = packages[`node_modules/${dependency.name}`];
        if (!entry) throw new Error('fixture: missing frozen dependency');
        {
          entry['version'] = dependency.version;
          entry['resolved'] = `${registryOrigin}/${dependency.name}/-/${tarballFileName(dependency.name, dependency.version)}`;
        }
      }
    }
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    return;
  }
  const lockPath = path.join(cwd, 'pnpm-lock.yaml');
  let text = fs.readFileSync(lockPath, 'utf8');
  for (const dependency of changed) {
    text = text.replace(`${dependency.name}@${dependencies.find(candidate => candidate.name === dependency.name)?.version ?? ''}`, `${dependency.name}@${dependency.version}`);
  }
  fs.writeFileSync(lockPath, text, 'utf8');
}

function readStagedManifest(cwd: string): { name: string; version: string } {
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw new Error('fixture: missing manifest identity');
  return { name: manifest.name, version: manifest.version };
}
function stagedDependencies(cwd: string, known: readonly SyntheticDependency[]): SyntheticDependency[] {
  return [ '.', ...stagedWorkspaceMembers(cwd) ].flatMap(p => importerDependencies(cwd, p, known));
}
/** 启动前留存文件字节，清理后也能复审；不跟随链接，不读已安装的包树。 */
export function captureStage(cwd: string, args: readonly string[], env: Record<string, string | undefined> | undefined): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) throw new Error('fixture: linked staging input');
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute); else files[absolute] = fs.readFileSync(absolute, 'utf8');
    }
  };
  walk(cwd);
  const config = new Set<string>();
  for (const flag of ['--userconfig', '--globalconfig']) {
    const i = args.findIndex(a => a === flag || a.startsWith(flag+'='));
    if (i >= 0) { const p = args[i]!.includes('=') ? args[i]!.slice(flag.length+1) : args[i+1]; if (p) config.add(p); }
  }
  for (const key of ['npm_config_userconfig', 'npm_config_globalconfig']) { if (env?.[key]) config.add(env[key]!); }
  for (const p of config) files[p] = fs.readFileSync(p, 'utf8');
  return files;
}
// ─── 合成进程结果 ───

type SyntheticProcessResult = { status: number; stdout: string; stderr: string };

function syntheticSyncResult(result: SyntheticProcessResult): SpawnSyncReturns<Buffer> {
  const stdout = Buffer.from(result.stdout, 'utf8');
  const stderr = Buffer.from(result.stderr, 'utf8');
  return { pid: 4242, output: [null, stdout, stderr], stdout, stderr, status: result.status, signal: null, error: undefined };
}

function syntheticChild(result: SyntheticProcessResult): ChildProcess {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  stdout.push(Buffer.from(result.stdout, 'utf8'));
  stdout.push(null);
  stderr.push(Buffer.from(result.stderr, 'utf8'));
  stderr.push(null);
  const child = Object.assign(new EventEmitter(), {
    pid: 4242,
    stdout,
    stderr,
    stdin,
    killed: false,
    connected: false,
    exitCode: null as number | null,
    signalCode: null as string | null,
    spawnargs: [] as string[],
    kill(): boolean { return true; },
    send(): boolean { return true; },
    disconnect(): void { /* 合成进程无 IPC */ },
    unref(): unknown { return child; },
    ref(): unknown { return child; },
  }) as unknown as ChildProcess;
  process.nextTick(() => {
    child.emit('spawn');
    child.emit('exit', result.status, null);
    child.emit('close', result.status, null);
  });
  return child;
}

function succeeded(stdout = ''): ProcessInterceptResult {
  const result: SyntheticProcessResult = { status: 0, stdout, stderr: '' };
  return { syncResult: syntheticSyncResult(result), child: syntheticChild(result) };
}

function failed(message: string): ProcessInterceptResult {
  const result: SyntheticProcessResult = { status: 1, stdout: '', stderr: `${message}\n` };
  return { syncResult: syntheticSyncResult(result), child: syntheticChild(result) };
}

// ─── 调用识别 ───

function baseName(command: string): string {
  return path.basename(command.replace(/\\/g, '/')).toLowerCase();
}

/** 只拦截包管理器形态的调用；其余（Git 只读探测等）透明委派真实实现。 */
export function packageManagerKind(command: string, args: readonly string[]): 'npm' | 'pnpm' | undefined {
  // Windows 上 npm-cli.js 可能以反斜杠路径传入。
  if (args.some(arg => /(?:^|[\\/])npm-cli\.js$/i.test(arg))) return 'npm';
  const base = baseName(command);
  if (base === 'npm' || base === 'npm.cmd' || base === 'npm.exe' || base === 'npm.bat') return 'npm';
  if (base === 'pnpm' || base === 'pnpm.cmd' || base === 'pnpm.exe' || base === 'pnpm.bat') return 'pnpm';
  return undefined;
}

function installStep(args: readonly string[]): 'candidate-lock' | 'materialization' | 'version' | undefined {
  if (args.some(arg => arg === '--version' || arg === '-v')) return 'version';
  if (args.some(arg => arg === '--package-lock-only' || arg === '--lockfile-only')) return 'candidate-lock';
  if (args.some(arg => arg === 'ci' || arg === '--frozen-lockfile')) return 'materialization';
  return undefined;
}

/** `node.exe npm-cli.js --version` 是 npm 的版本；只有裸 node 才是 Node 自身版本。 */
function versionProbe(command: string, args: readonly string[], kind: 'npm' | 'pnpm'): string {
  if (packageManagerKind(command, args) === 'npm') return '11.20.0\n';
  const base = baseName(command);
  if (base === 'node' || base === 'node.exe') return 'v26.13.0\n';
  return kind === 'npm' ? '11.20.0\n' : '12.18.0\n';
}

// ─── 拦截器安装 ───

export function installProcessInterceptor(state: ProcessRecorderState): void {
  let outsideRoot: string | undefined;
  const outsideTree = (): string => {
    if (outsideRoot === undefined || state.stageOutsideRoot === undefined) {
      outsideRoot = syntheticRoot('stage-outside');
      materializePackageTree(outsideRoot, [{ name: 'outside-package', version: '9.9.9' }]);
      state.stageOutsideRoot = outsideRoot;
      state.stageOutsideBaseline = treeSnapshot(outsideRoot);
    }
    return outsideRoot;
  };

  state.intercept = (request): ProcessInterceptResult | undefined => {
    try {
    const kind = packageManagerKind(request.command, request.args);
    if (kind === undefined) return undefined;
    const step = installStep(request.args);
    // 版本探测不需要 cwd（工具链校验发生在任何暂存目录之前）。
    if (step === 'version') return succeeded(versionProbe(request.command, request.args, kind));
    if (request.cwd === undefined) {
      (state.fixtureErrors ??= []).push('package manager has no cwd');
      return failed('fixture: missing staging cwd');
    }
    const call = state.calls.at(-1);
    try { if (call) call.files = captureStage(request.cwd, request.args, request.env); } catch (error) {
      (state.fixtureErrors ??= []).push(String(error)); return failed('fixture: invalid staging');
    }
    if (step === 'candidate-lock') {
      if (state.candidateLock === 'fail') return failed('synthetic candidate lock generation failure');
      try {
        writeCandidateLock(request.cwd, kind, stagedDependencies(request.cwd, state.dependencies), state.registryOrigin);
      } catch (error) {
        (state.fixtureErrors ??= []).push(String(error));
        return failed('fixture: candidate lock generation failed');
      }
      if (call) call.lockAfter = fs.readFileSync(path.join(request.cwd, kind === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'), 'utf8');
      return succeeded('');
    }
    if (step === 'materialization') {
      const dependencies = stagedDependencies(request.cwd, state.dependencies);
      if (state.materialization !== 'fail') for (const member of stagedWorkspaceMembers(request.cwd)) {
        const manifest = JSON.parse(fs.readFileSync(path.join(request.cwd, member, 'package.json'), 'utf8'));
        if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(manifest.name)) throw new Error('fixture: invalid member package name');
        const link = path.join(request.cwd, 'node_modules', ...manifest.name.split('/'));
        fs.mkdirSync(path.dirname(link), { recursive: true });
        linkDirectory(link, path.join(request.cwd, member));
      }
      switch (state.materialization) {
        case 'fail':
          return failed('synthetic frozen materialization failure');
        case 'wrong-version':
          materializePackageTree(request.cwd, dependencies.map(dependency => ({ ...dependency, version: bumpPatch(dependency.version) })));
          return succeeded('');
        case 'rewrite-lock':
          materializePackageTree(request.cwd, dependencies);
          rewriteFrozenLock(request.cwd, kind, dependencies, state.registryOrigin);
          return succeeded('');
        case 'drop-package':
          materializePackageTree(request.cwd, dependencies);
          if (dependencies.length > 0) fs.rmSync(path.join(request.cwd, 'node_modules', ...dependencies[0]!.name.split('/')), { recursive: true, force: true });
          return succeeded('');
        case 'external-link': {
          materializePackageTree(request.cwd, dependencies);
          linkDirectory(path.join(request.cwd, 'node_modules', 'linked-outside'), outsideTree());
          return succeeded('');
        }
        default:
          materializePackageTree(request.cwd, dependencies);
          return succeeded('');
      }
    }
    // 未识别的包管理器调用一律失败关闭：不透明运行真实工具链，也不假装成功。
    (state.fixtureErrors ??= []).push('unrecognized package manager invocation');
    return failed('fixture: unrecognized package manager invocation');
    } catch (error) {
      (state.fixtureErrors ??= []).push(String(error));
      return failed('fixture: process materialization failed');
    }
  };
}

function bumpPatch(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3 || parts.some(part => !/^\d+$/.test(part))) return `${version}-tampered`;
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}

// ─── 用例侧查询助手 ───

export function packageManagerCalls(state: ProcessRecorderState): RecordedProcessCall[] {
  return state.calls.filter(call => packageManagerKind(call.command, call.args) !== undefined);
}

export function candidateLockCalls(state: ProcessRecorderState): RecordedProcessCall[] {
  return packageManagerCalls(state).filter(call => installStep(call.args) === 'candidate-lock');
}

export function materializationCalls(state: ProcessRecorderState): RecordedProcessCall[] {
  return packageManagerCalls(state).filter(call => installStep(call.args) === 'materialization');
}

export function describeCall(call: RecordedProcessCall): string {
  return `${call.command} ${call.args.join(' ')}（cwd=${call.cwd ?? '<none>'}）`;
}

/** 工程外暂存目录：与目标同卷、不在工程/workspace 内。 */
export function isOutsideProject(cwd: string | undefined, projectRoot: string): boolean {
  if (cwd === undefined) return false;
  const resolvedProject = path.resolve(projectRoot);
  const resolvedCwd = path.resolve(cwd);
  if (resolvedCwd === resolvedProject) return false;
  return !resolvedCwd.startsWith(resolvedProject + path.sep);
}

export function sameVolume(first: string, second: string): boolean {
  return path.parse(first).root.toLowerCase() === path.parse(second).root.toLowerCase();
}

export function tempRootFor(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-`);
}
