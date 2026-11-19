import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedRun } from './host.js';

const processMockState = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: processMockState.spawn }));

import { installDependencies, runNativeScript, type FixedToolchain } from './runtime.js';

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
};

const children: FakeChild[] = [];
const temporaryRoots: string[] = [];
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

function ownedRun(evidenceRoot: string) {
  const active = new Set<() => Promise<void>>();
  const evidenceNames = new Set<string>();
  const run = {
    evidenceRoot,
    trackOwnedProcess(close: () => Promise<void>) {
      active.add(close);
      return () => active.delete(close);
    },
    async writeEvidence(name: string, bytes: Uint8Array) {
      if (evidenceNames.has(name)) throw new Error('Evidence name collision: ' + name);
      evidenceNames.add(name);
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
    const run = ownedRun(root);
    let started!: () => void;
    const processStarted = new Promise<void>((resolve) => { started = resolve; });
    const originalTrack = run.trackOwnedProcess.bind(run);
    run.trackOwnedProcess = ((close: () => Promise<void>) => {
      const unregister = originalTrack(close);
      started();
      return unregister;
    }) as typeof run.trackOwnedProcess;
    const pending = installDependencies(run, {
      projectRoot: join(root, 'consumer'),
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
    expect(children).toHaveLength(2);
    closeChild(children[0]!);
    closeChild(children[1]!);

    const results = await Promise.all([first, second]);
    expect(new Set(results.map((result) => result.stdoutEvidence)).size).toBe(2);
    expect(new Set(results.map((result) => result.stderrEvidence)).size).toBe(2);
  });

  it('uses distinct evidence names for concurrent dependency installs in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(654321);
    const root = await temporaryRoot();
    const run = ownedRun(root);
    const first = installDependencies(run, { projectRoot: join(root, 'a'), manager: 'npm', toolchain });
    const second = installDependencies(run, { projectRoot: join(root, 'b'), manager: 'npm', toolchain });
    await vi.waitFor(() => expect(children).toHaveLength(2));
    closeChild(children[0]!);
    closeChild(children[1]!);

    const results = await Promise.all([first, second]);
    expect(new Set(results.map((result) => result.stdoutSha256)).size).toBe(1);
    expect(run.evidenceNames.size).toBe(4);
  });
});
