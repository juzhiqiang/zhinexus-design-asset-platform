/** 测试私有 fs 故障；journal/latest 精确提交边界待 GREEN 接入。 */
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { validateIntegrationBackup } from '../../../packages/component-cli/src/contracts/integration-apply.js';
export type FsInterceptorState = {
  intercept: ((operation: string, paths: string[], data: unknown) => boolean) | null;
  /** 读取故障独立武装，避免既有写入失败夹具提前在分类阶段失败。 */
  readIntercept?: ((operation: string, paths: string[], data: unknown) => boolean) | null;
  backupComplete?: (backupRoot: string, projectRoot: string) => boolean;
};
export type FsFaultController = {
  armPath(absolute: string): void;
  armCommitFailure(projectRoot: string, backupRoot: string, failCommit: number): void;
  disarm(): void;
  failedOrdinal(): number | undefined;
};
const DESTINATION = new Set(['rename', 'copyFile', 'link', 'symlink']);
const CONTENT = new Set(['writeFile', 'appendFile', 'copyFile', 'rename', 'truncate', 'link', 'symlink']);
const MUTATING = [...CONTENT, 'mkdir', 'rm', 'unlink', 'rmdir', 'chmod', 'utimes'];
const under = (root: string, p: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(p));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
export function installFsInterceptor(state: FsInterceptorState): FsFaultController {
  let mode: { kind: 'none' } | { kind: 'path'; root: string }
    | { kind: 'commit'; root: string; backup: string; ordinal: number } = { kind: 'none' };
  let backupReady = false;
  let failed: number | undefined;
  const destinations = new Set<string>();
  state.intercept = (operation, paths): boolean => {
    const current = mode;
    if (current.kind === 'none') return false;
    if (current.kind === 'path') return paths.some(p => under(current.root, p));
    if (!CONTENT.has(operation) || failed !== undefined) return false;
    const destination = paths.at(-1);
    if (!destination || !under(current.root, destination) || /(^\.|\.tmp$|~$)/.test(path.basename(destination))) return false;
    // 首次目标写入前实读完整备份和原字节；mkdir/写前 JSON 不能武装故障。
    backupReady ||= state.backupComplete?.(current.backup, current.root) === true;
    if (!backupReady) return false;
    const key = path.resolve(destination).toLowerCase();
    if (destinations.has(key)) return false;
    destinations.add(key);
    if (destinations.size !== current.ordinal) return false;
    failed = current.ordinal; return true; // 一次性；补偿不继续阻断。
  };
  return {
    armPath(root) { mode = { kind: 'path', root: path.resolve(root) }; },
    armCommitFailure(root, backup, ordinal) {
      mode = { kind: 'commit', root: path.resolve(root), backup: path.resolve(backup), ordinal };
      backupReady = false; failed = undefined; destinations.clear();
    },
    disarm() { mode = { kind: 'none' }; backupReady = false; failed = undefined; destinations.clear(); },
    failedOrdinal() { return failed; },
  };
}
export function buildFsModuleMock(state: FsInterceptorState, actual: typeof import('node:fs')): typeof import('node:fs') {
  state.backupComplete = (backupRoot, projectRoot): boolean => {
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const walk = (root: string): boolean => {
      for (const entry of actual.readdirSync(root, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(root, entry.name);
        if (entry.isDirectory()) { if (walk(absolute)) return true; continue; }
        let json: unknown;
        try { json = JSON.parse(actual.readFileSync(absolute, 'utf8')); } catch { continue; }
        const validated = validateIntegrationBackup(json);
        if (!validated.ok) continue;
        const backup = validated.value;
        if (path.resolve(backup.projectRoot).toLowerCase() !== path.resolve(projectRoot).toLowerCase()) continue;
        if (backup.files.every(file => {
          const target = path.join(projectRoot, file.path);
          if (!file.before.exists) return !actual.existsSync(target);
          const bytes = Buffer.from(file.originalBase64 ?? '', 'base64');
          return digest(bytes) === file.before.sha256 && digest(actual.readFileSync(target)) === file.before.sha256;
        })) return true;
      }
      return false;
    };
    try { return walk(backupRoot); } catch { return false; }
  };
  const guard = (operation: string, args: unknown[], reading = false): void => {
    const values = DESTINATION.has(operation) ? args.slice(0, 2) : args.slice(0, 1);
    const paths = values.filter((p): p is string => typeof p === 'string');
    const intercept = reading ? state.readIntercept : state.intercept;
    if (!intercept?.(operation, paths, args[1])) return;
    const error = new Error('synthetic fs failure: ' + operation) as NodeJS.ErrnoException;
    error.code = 'EACCES'; throw error;
  };
  const mocked = { ...actual } as unknown as Record<string, unknown>;
  const promises = { ...actual.promises } as unknown as Record<string, unknown>;
  const methods = actual as unknown as Record<string, (...args: unknown[]) => unknown>;
  const promiseMethods = actual.promises as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const operation of ['lstat', 'readFile']) {
    mocked[operation+'Sync'] = (...args: unknown[]) => {
      guard(operation, args, true); return methods[operation+'Sync']!(...args);
    };
  }
  for (const operation of MUTATING) {
    if (typeof methods[operation+'Sync'] === 'function') mocked[operation+'Sync'] = (...args: unknown[]) => {
      guard(operation, args); return methods[operation+'Sync']!(...args);
    };
    if (typeof methods[operation] === 'function') mocked[operation] = (...args: unknown[]) => {
      try { guard(operation, args); } catch (error) {
        const callback = args.at(-1);
        if (typeof callback !== 'function') throw error;
        queueMicrotask(() => callback(error)); return;
      }
      return methods[operation]!(...args);
    };
    if (typeof promiseMethods[operation] === 'function') promises[operation] = async (...args: unknown[]) => {
      guard(operation, args); return promiseMethods[operation]!(...args);
    };
  }
  mocked.promises = promises;
  return { ...mocked, default: mocked } as unknown as typeof import('node:fs');
}
