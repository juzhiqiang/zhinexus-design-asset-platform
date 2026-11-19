import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedRun } from './host.js';

const processMockState = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: processMockState.spawn }));

import { installDependencies, runFrozenCli, runNativeScript, type FixedToolchain } from './runtime.js';
import { createOwnedRun } from './host.js';

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  command?: string;
  args?: string[];
  kill: ReturnType<typeof vi.fn>;
};

const children: FakeChild[] = [];
const temporaryRoots: string[] = [];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const toolchain: FixedToolchain = {
  nodeExecutable: 'C:/tools/node.exe',
  npmCliPath: 'C:/tools/npm-cli.js',
  pnpmWrapper: 'C:/repo/scripts/pnpm.ps1',
  repositoryRoot: 'C:/repo',
};

function fakeChild(pid: number): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  });
}

function ownedRun(evidenceRoot: string, ownedPaths: string[] = [evidenceRoot]) {
  const active = new Set<() => Promise<void>>();
  const evidenceNames = new Set<string>();
  const run = {
    evidenceRoot,
    async createEvidenceArea(name: string) {
      const area = join(evidenceRoot, name);
      await mkdir(area, { recursive: true });
      return area;
    },
    async registerEvidenceAreaContents() {},
    async assertOwnedProject(path: string) { if (!ownedPaths.includes(path)) throw new Error('Only an owned project can be used as an execution root.'); },
    trackOwnedProcess(close: () => Promise<void>) {
      active.add(close);
      return () => active.delete(close);
    },
    async writeEvidence(name: string, bytes: Uint8Array) {
      if (evidenceNames.has(name)) throw new Error('Evidence name collision: ' + name);
      evidenceNames.add(name);
      await mkdir(evidenceRoot, { recursive: true });
      await writeFile(join(evidenceRoot, name), bytes);
      return {
        path: join(evidenceRoot, name),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
      };
    },
    active,
    evidenceNames,
  };
  return run as unknown as OwnedRun & typeof run;
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 't17-runtime-test-'));
  temporaryRoots.push(root);
  return root;
}

function closeChild(child: FakeChild, code: number | null = 0) {
  child.exitCode = code;
  child.emit('close', code, null);
}

beforeEach(() => {
  children.length = 0;
  processMockState.spawn.mockImplementation((command: string) => {
    const child = fakeChild(children.length + 100);
    children.push(child);
    if (command.toLowerCase().endsWith('taskkill.exe')) queueMicrotask(() => closeChild(child));
    return child;
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('T17 owned native process lifecycle', () => {
  it('runs the installed frozen CLI with argv and stores stdout and stderr as separate evidence', async () => {
    const base = await temporaryRoot(), project = join(base, 'vue'), installationRoot = join(base, 'cli-consumer');
    await mkdir(project); await mkdir(join(installationRoot, 'node_modules/@company/component-cli/dist'), { recursive: true });
    const entry = join(installationRoot, 'node_modules/@company/component-cli/dist/bin.js'); await writeFile(entry, 'frozen CLI entry');
    const evidenceRoot = join(base, 'evidence');
    const run = ownedRun(evidenceRoot, [project, installationRoot]);
    await writeFile(join(installationRoot, 'node_modules/@company/component-cli/package.json'), JSON.stringify({ name: '@company/component-cli', version: '0.0.16', bin: { component: 'dist/bin.js' } }));
    processMockState.spawn.mockImplementation((command: string, args: string[]) => {
      const child = fakeChild(401); children.push(child);
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"status":"inspected"}\n')); child.stderr.emit('data', Buffer.from('diagnostic\n')); closeChild(child); });
      Object.assign(child, { command, args });
      return child;
    });
    const result = await runFrozenCli(run, { installation: { root: installationRoot, entry, version: '0.0.16', entrySha256: sha(Buffer.from('frozen CLI entry')) }, projectRoot: project, args: ['integrate', 'inspect', '--project', project], toolchain });

    expect(result).toMatchObject({ exitCode: 0, timedOut: false, args: [entry, 'integrate', 'inspect', '--project', project] });
    expect(children[0]!.command).toBe(result.executable);
    expect(children[0]).toMatchObject({ args: [entry, 'integrate', 'inspect', '--project', project] });
    expect(await import('node:fs/promises').then(fs => fs.readFile(result.stdoutEvidence, 'utf8'))).toBe('{"status":"inspected"}\n');
    expect(await import('node:fs/promises').then(fs => fs.readFile(result.stderrEvidence, 'utf8'))).toBe('diagnostic\n');
    expect(result.stdoutEvidence).not.toBe(result.stderrEvidence);
    expect(children[0]!.kill).not.toHaveBeenCalled();
  });

  it('stops a native command when output exceeds the capture limit', async () => {
    const root = await temporaryRoot();
    const run = ownedRun(root);
    let command!: FakeChild;
    processMockState.spawn.mockImplementation((executable: string) => {
      if (executable.toLowerCase().endsWith('taskkill.exe')) {
        const killer = fakeChild(701);
        children.push(killer);
        queueMicrotask(() => { closeChild(command, 1); closeChild(killer); });
        return killer;
      }
      command = fakeChild(700);
      children.push(command);
      command.kill.mockImplementation(() => { queueMicrotask(() => closeChild(command, 1)); return true; });
      queueMicrotask(() => {
        command.stdout.emit('data', Buffer.from('1234'));
        command.stdout.emit('data', Buffer.from('5678'));
      });
      setTimeout(() => { if (command.exitCode === null) closeChild(command, 0); }, 25);
      return command;
    });

    const result = await runNativeScript(run, { projectRoot: root, manager: 'npm', script: 'build', toolchain, outputLimit: 4 });

    expect(result).toMatchObject({ exitCode: null, timedOut: false });
    expect(result.stdoutBytes).toBeGreaterThan(4);
    const stdout = await (await import('node:fs/promises')).readFile(result.stdoutEvidence);
    expect(stdout).toHaveLength(4);
    expect(children.length).toBeGreaterThan(1);
  });

  it('refuses to run the frozen CLI against a project outside the owned run before spawning', async () => {
    const base = await temporaryRoot(), project = join(base, 'outside'), installationRoot = join(base, 'cli-consumer');
    await mkdir(project); await mkdir(join(installationRoot, 'node_modules/@company/component-cli/dist'), { recursive: true });
    const entry = join(installationRoot, 'node_modules/@company/component-cli/dist/bin.js'); await writeFile(entry, 'frozen CLI entry');
    const run = ownedRun(join(base, 'evidence'), [installationRoot]);
    await writeFile(join(installationRoot, 'node_modules/@company/component-cli/package.json'), JSON.stringify({ name: '@company/component-cli', version: '0.0.16', bin: { component: 'dist/bin.js' } }));

    await expect(runFrozenCli(run, { installation: { root: installationRoot, entry, version: '0.0.16', entrySha256: sha(Buffer.from('frozen CLI entry')) }, projectRoot: project, args: ['integrate', 'inspect', '--project', project], toolchain })).rejects.toThrow(/owned project/i);
    expect(processMockState.spawn).not.toHaveBeenCalled();
  });

  it('refuses to execute an installed CLI entry that changed after its install receipt was recorded', async () => {
    const base = await temporaryRoot(), project = join(base, 'vue'), installationRoot = join(base, 'cli-consumer');
    await mkdir(project); await mkdir(join(installationRoot, 'node_modules/@company/component-cli/dist'), { recursive: true });
    const entry = join(installationRoot, 'node_modules/@company/component-cli/dist/bin.js'); await writeFile(entry, 'changed entry bytes');
    await writeFile(join(installationRoot, 'node_modules/@company/component-cli/package.json'), JSON.stringify({ name: '@company/component-cli', version: '0.0.16', bin: { component: 'dist/bin.js' } }));
    const run = ownedRun(join(base, 'evidence'), [project, installationRoot]);

    await expect(runFrozenCli(run, { installation: { root: installationRoot, entry, version: '0.0.16', entrySha256: sha(Buffer.from('frozen CLI entry')) }, projectRoot: project, args: ['integrate', 'inspect', '--project', project], toolchain })).rejects.toThrow(/digest|changed/i);
    expect(processMockState.spawn).not.toHaveBeenCalled();
  });

  it('refuses to run a native project script outside the owned run before spawning', async () => {
    const base = await temporaryRoot(), project = join(base, 'outside');
    await mkdir(project);
    const run = ownedRun(join(base, 'evidence'), [join(base, 'inside')]);
    processMockState.spawn.mockImplementation(() => {
      const child = fakeChild(501); children.push(child);
      queueMicrotask(() => closeChild(child));
      return child;
    });

    await expect(runNativeScript(run, { projectRoot: project, manager: 'npm', script: 'build', toolchain }))
      .rejects.toThrow(/owned project/i);
    expect(processMockState.spawn).not.toHaveBeenCalled();
  });

  it('refuses to install dependencies outside the owned run before writing config or spawning', async () => {
    const base = await temporaryRoot(), project = join(base, 'outside');
    await mkdir(project);
    const run = ownedRun(join(base, 'evidence'), [join(base, 'inside')]);
    processMockState.spawn.mockImplementation(() => {
      const child = fakeChild(502); children.push(child);
      queueMicrotask(() => closeChild(child));
      return child;
    });

    await expect(installDependencies(run, { projectRoot: project, manager: 'npm', toolchain }))
      .rejects.toThrow(/owned project/i);
    expect(await import('node:fs/promises').then(fs => fs.access(join(project, '.t17-install')).then(() => true, () => false)))
      .toBe(false);
    expect(processMockState.spawn).not.toHaveBeenCalled();
  });

  it('rejects an install-configuration ancestor junction without truncating outside sentinel files', async () => {
    const base = await temporaryRoot(), project = join(base, 'consumer'), outside = join(base, 'outside');
    await mkdir(project); await mkdir(outside);
    const run = ownedRun(join(base, 'evidence'), [project]);
    await writeFile(join(outside, 'userconfig'), 'outside user sentinel');
    await writeFile(join(outside, 'globalconfig'), 'outside global sentinel');
    await symlink(outside, join(project, '.t17-install'), 'junction');
    processMockState.spawn.mockImplementation(() => { const child = fakeChild(550); children.push(child); queueMicrotask(() => closeChild(child)); return child; });

    const failure = await installDependencies(run, { projectRoot: project, manager: 'npm', toolchain }).then(() => undefined, error => error);

    expect(await readFile(join(outside, 'userconfig'), 'utf8')).toBe('outside user sentinel');
    expect(await readFile(join(outside, 'globalconfig'), 'utf8')).toBe('outside global sentinel');
    expect(failure).toBeInstanceOf(Error);
    expect(processMockState.spawn).not.toHaveBeenCalled();
  });

  it.each(['hardlink', 'junction'] as const)('rejects a replaced %s configuration before another install and preserves the outside sentinel', async (kind) => {
    const base = await temporaryRoot(), project = join(base, 'consumer'), outsideDirectory = join(base, 'outside'), outside = join(outsideDirectory, 'sentinel');
    await mkdir(project); await mkdir(outsideDirectory); await writeFile(outside, 'outside sentinel');
    const run = ownedRun(join(base, 'evidence'), [project]);
    processMockState.spawn.mockImplementation(() => { const child = fakeChild(551); children.push(child); queueMicrotask(() => closeChild(child)); return child; });
    await installDependencies(run, { projectRoot: project, manager: 'npm', toolchain });
    const config = join(project, '.t17-install', 'userconfig');
    await unlink(config);
    // A Windows junction exercises real symbolic-link metadata without requiring file-symlink privileges.
    if (kind === 'hardlink') await link(outside, config); else await symlink(outsideDirectory, config, 'junction');

    const failure = await installDependencies(run, { projectRoot: project, manager: 'npm', toolchain }).then(() => undefined, error => error);

    expect(await readFile(outside, 'utf8')).toBe('outside sentinel');
    expect(failure).toBeInstanceOf(Error);
    expect(processMockState.spawn).toHaveBeenCalledTimes(1);
  });

  it('reuses only its own unchanged empty configuration for legitimate repeated installs', async () => {
    const base = await temporaryRoot(), project = join(base, 'consumer');
    await mkdir(project);
    const run = ownedRun(join(base, 'evidence'), [project]);
    processMockState.spawn.mockImplementation(() => { const child = fakeChild(552); children.push(child); queueMicrotask(() => closeChild(child)); return child; });
    await installDependencies(run, { projectRoot: project, manager: 'npm', toolchain });
    const config = join(project, '.t17-install', 'userconfig'), first = await lstat(config, { bigint: true });

    await expect(installDependencies(run, { projectRoot: project, manager: 'npm', toolchain })).resolves.toMatchObject({ exitCode: 0 });

    const second = await lstat(config, { bigint: true });
    expect([second.dev, second.ino]).toEqual([first.dev, first.ino]);
    expect(await readFile(config, 'utf8')).toBe('');
    expect(processMockState.spawn).toHaveBeenCalledTimes(2);
  });

  it('keeps package download cache outside the project source while retaining owned cleanup', async () => {
    const base = await temporaryRoot(), run = await createOwnedRun({ baseDirectory: base });
    let cachePath = '';
    processMockState.spawn.mockImplementation((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = fakeChild(553); children.push(child);
      cachePath = options.env.npm_config_cache!;
      queueMicrotask(() => closeChild(child));
      return child;
    });
    try {
      await installDependencies(run, { projectRoot: run.projectRoots.vue, manager: 'npm', toolchain });
      await writeFile(join(cachePath, 'large-download'), Buffer.alloc(4 * 1024 * 1024 + 1));
      await run.registerOwnedPath(run.projectRoots.vue, ['.t17-install']);
      const relativeCache = relative(run.projectRoots.vue, cachePath);
      expect(relativeCache.startsWith('..')).toBe(true);
      expect(await lstat(join(run.projectRoots.vue, '.t17-install', 'cache')).then(() => true, () => false)).toBe(false);
      await run.registerEvidenceAreaContents(cachePath, ['large-download']);
      await run.stopOwnedProcesses();
      await run.sealEvidence({ cachePath });
      await run.cleanup();
      expect(await lstat(run.parentRoot).then(() => true, () => false)).toBe(false);
    } finally { await run.abortForTest(); }
  });

  it('retains installer output before rejecting an unsafe cache inventory', async () => {
    const root = await temporaryRoot(), project = join(root, 'consumer'), evidence = join(root, 'evidence');
    await mkdir(project);
    const run = ownedRun(evidence, [project]);
    run.registerEvidenceAreaContents = vi.fn(async () => { throw new Error('unsafe cache inventory'); });
    processMockState.spawn.mockImplementation((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = fakeChild(811); children.push(child);
      void writeFile(join(options.env.npm_config_cache!, 'download'), 'owned cache').then(() => {
        child.stdout.emit('data', Buffer.from('installer stdout'));
        child.stderr.emit('data', Buffer.from('installer stderr'));
        closeChild(child, 1);
      });
      return child;
    });
    await expect(installDependencies(run, { projectRoot: project, manager: 'npm', toolchain }))
      .rejects.toThrow('unsafe cache inventory');
    const names = await import('node:fs/promises').then(fs => fs.readdir(evidence));
    expect(names.filter(name => name.endsWith('.stdout'))).toHaveLength(1);
    expect(names.filter(name => name.endsWith('.stderr'))).toHaveLength(1);
    expect(await readFile(join(evidence, names.find(name => name.endsWith('.stdout'))!), 'utf8')).toBe('installer stdout');
    expect(await readFile(join(evidence, names.find(name => name.endsWith('.stderr'))!), 'utf8')).toBe('installer stderr');
    expect(run.active.size).toBe(0);
  });

  it.each(['npm', 'pnpm'] as const)('stops %s dependency installation and retains only bounded output when stdout exceeds its limit', async (manager) => {
    const root = await temporaryRoot(), project = join(root, 'consumer'), evidence = join(root, 'evidence');
    await mkdir(project);
    const run = ownedRun(evidence, [project]);
    let command!: FakeChild;
    processMockState.spawn.mockImplementation((executable: string) => {
      if (executable.toLowerCase().endsWith('taskkill.exe')) {
        const killer = fakeChild(803); children.push(killer);
        queueMicrotask(() => { closeChild(command, 1); closeChild(killer); });
        return killer;
      }
      command = fakeChild(802); children.push(command);
      queueMicrotask(() => {
        command.stdout.emit('data', Buffer.from('12345678'));
        command.stderr.emit('data', Buffer.from('err'));
        closeChild(command, 0);
      });
      return command;
    });

    await expect(installDependencies(run, { projectRoot: project, manager, toolchain, outputLimit: 4 }))
      .rejects.toThrow(/output limit/i);

    const fs = await import('node:fs/promises');
    const names = await fs.readdir(evidence);
    expect(names.filter(name => name.endsWith('.stdout'))).toHaveLength(1);
    expect(names.filter(name => name.endsWith('.stderr'))).toHaveLength(1);
    expect((await fs.readFile(join(evidence, names.find(name => name.endsWith('.stdout'))!))).byteLength).toBeLessThanOrEqual(4);
    expect((await fs.readFile(join(evidence, names.find(name => name.endsWith('.stderr'))!))).byteLength).toBeLessThanOrEqual(4);
    expect(processMockState.spawn).toHaveBeenCalledWith(expect.stringMatching(/node|powershell/i), expect.any(Array), expect.any(Object));
    expect(children.some(child => child !== command)).toBe(true);
  }, 10_000);

  it('does not finish a timed-out native command until its child emits close', async () => {
    const root = await temporaryRoot();
    const run = ownedRun(root);
    const pending = runNativeScript(run, {
      projectRoot: root,
      manager: 'npm',
      script: 'build',
      toolchain,
      timeoutMs: 5,
    });
    let settled = false;
    void pending.finally(() => { settled = true; });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(children.length).toBeGreaterThanOrEqual(1);
    expect(settled).toBe(false);
    expect(run.active.size).toBe(1);

    closeChild(children[0]!, 1);
    await expect(pending).resolves.toMatchObject({ timedOut: true, exitCode: 1 });
    expect(run.active.size).toBe(0);
  });

  it('keeps a timed-out dependency install owned until its child closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const root = await temporaryRoot();
    const project = join(root, 'consumer');
    await mkdir(project);
    const run = ownedRun(join(root, 'evidence'), [project]);
    let started!: () => void;
    const processStarted = new Promise<void>((resolve) => { started = resolve; });
    const originalTrack = run.trackOwnedProcess.bind(run);
    run.trackOwnedProcess = ((close: () => Promise<void>) => {
      const unregister = originalTrack(close);
      started();
      return unregister;
    }) as typeof run.trackOwnedProcess;
    const pending = installDependencies(run, {
      projectRoot: project,
      manager: 'npm',
      toolchain,
    });
    let settled = false;
    void pending.catch(() => { settled = true; });
    await processStarted;
    await vi.advanceTimersByTimeAsync(600_001);

    expect(children.length).toBeGreaterThanOrEqual(1);
    expect(settled).toBe(false);
    expect(run.active.size).toBe(1);

    closeChild(children[0]!, 1);
    await expect(pending).rejects.toThrow(/timed out/i);
    expect(run.active.size).toBe(0);
  });

  it('uses distinct evidence names for concurrent native commands in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456);
    const root = await temporaryRoot();
    const run = ownedRun(root);
    const first = runNativeScript(run, { projectRoot: root, manager: 'npm', script: 'build', toolchain });
    const second = runNativeScript(run, { projectRoot: root, manager: 'npm', script: 'build', toolchain });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    closeChild(children[0]!);
    closeChild(children[1]!);

    const results = await Promise.all([first, second]);
    expect(new Set(results.map((result) => result.stdoutEvidence)).size).toBe(2);
    expect(new Set(results.map((result) => result.stderrEvidence)).size).toBe(2);
  });

  it('uses distinct evidence names for concurrent dependency installs in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(654321);
    const root = await temporaryRoot();
    const firstRoot = join(root, 'a'), secondRoot = join(root, 'b');
    await mkdir(firstRoot); await mkdir(secondRoot);
    const run = ownedRun(join(root, 'evidence'), [firstRoot, secondRoot]);
    const first = installDependencies(run, { projectRoot: firstRoot, manager: 'npm', toolchain });
    const second = installDependencies(run, { projectRoot: secondRoot, manager: 'npm', toolchain });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    closeChild(children[0]!);
    closeChild(children[1]!);

    const results = await Promise.all([first, second]);
    expect(new Set(results.map((result) => result.stdoutSha256)).size).toBe(1);
    expect(run.evidenceNames.size).toBe(4);
  });
});
