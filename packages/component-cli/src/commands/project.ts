import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PROJECT_CONFIG_FILE, projectPath, readProject, readProjectPackage, validateProjectConfig, type ProjectConfig, type ProjectVariant } from '../project/config.js';
import { doctorProject, publishingAccess } from '../project/doctor.js';
import { runLocal } from '../project/process.js';
import { loadProjectBundle, prepareProject } from '../project/prepare.js';
import { manifestDigest } from '../contracts/digests.js';
import { z } from 'zod';
import { canonicalJson } from '../contracts/schema.js';
import { computeBufferSha256 } from '../local/digest.js';

const pointerFile = '.component-release.json';
const pointerSchema = z.strictObject({ configFile: z.string(), configDigest: z.string().regex(/^[a-f0-9]{64}$/), packageName: z.string(), packageVersion: z.string(), bundleDir: z.string(), manifestDigest: z.string().regex(/^[a-f0-9]{64}$/) });

export type ProjectCliContext = { cwd?: string; onProgress?: (message: string) => void; select?: (label: string, choices: { value: string; label: string }[]) => Promise<string> };
export async function runProjectCommand(command: string, args: readonly string[], version: string, context: ProjectCliContext = {}) {
  try {
    const options: Record<string, string> = {}; let prepareOnly = false;
    const allowed = ['--project', '--config', '--package', '--component', '--export', '--export-path', '--framework', '--category', '--api-url', '--token', '--bundle-dir', '--timeout', '--key', '--idempotency-key'];
    for (let i = 0; i < args.length; i++) {
      const key = args[i]!;
      if (key === '--prepare-only') { prepareOnly = true; continue; }
      const value = args[++i];
      if (!allowed.includes(key) || !value || value.startsWith('--') || options[key] !== undefined) throw new Error('ARGUMENT_INVALID: ' + key);
      options[key] = value;
    }
    const root = await fs.realpath(options['--project'] ?? context.cwd ?? process.cwd());
    const configFile = options['--config'] ?? PROJECT_CONFIG_FILE;
    const choose = async (name: string, choices: { value: string; label: string }[]) => {
      const explicit = options['--' + name];
      const value = explicit ?? (context.select ? await context.select(name, choices) : undefined);
      if (!value) throw new Error('ARGUMENT_REQUIRED: 非交互调用必须提供 --' + name);
      if (!choices.some(choice => choice.value === value)) throw new Error('ARGUMENT_INVALID: --' + name);
      return value;
    };
    if (command === 'init') {
      const configPath = await projectPath(root, configFile, true);
      try { await fs.access(configPath); throw new Error('CONFIG_EXISTS: ' + configFile); } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
      for (const key of ['--package', '--component', '--export']) if (!options[key]) throw new Error('ARGUMENT_REQUIRED: ' + key);
      const framework = await choose('framework', [{ value: 'vue', label: 'Vue' }, { value: 'react', label: 'React' }, { value: 'all', label: 'Vue + React' }]);
      if (!options['--category'] && !context.select) throw new Error('ARGUMENT_REQUIRED: 非交互调用必须提供 --category');
      const category = options['--category'] ?? (await choose('category', (await publishingAccess(options['--api-url'], options['--token'])).options.categories.filter(item => item.enabled).map(item => ({ value: item.id, label: item.name }))));
      const packageDir = options['--package']!; const { pkg } = await readProjectPackage(root, packageDir);
      if (!pkg.scripts?.build) throw new Error('BUILD_COMMAND_REQUIRED: 组件包必须提供 build script');
      const frameworks = framework === 'all' ? ['vue', 'react'] as const : [framework as 'vue' | 'react'];
      const config: ProjectConfig = { schemaVersion: 1, packageDir, build: { program: 'pnpm', args: ['run', 'build'] }, dev: {}, variants: frameworks.map(framework => ({ componentId: options['--component']!, framework, category, exportName: options['--export']!, exportPath: options['--export-path'] ?? '.', api: `api/${options['--component']}-${framework}.json`, docs: `docs/${options['--component']}-${framework}.md`, consumer: { templateDir: `consumers/${framework}`, adapter: 'vite', previewDir: 'dist', previewEntry: 'index.html' }, readiness: { selector: '#app', states: ['default'], width: 800, height: 400, renderer: 'canvas', theme: 'light' } })) };
      if (pkg.scripts.dev) for (const framework of frameworks) config.dev[framework] = { program: 'pnpm', args: ['run', 'dev'] };
      validateProjectConfig(config);
      await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
      return { exitCode: 0, stdout: JSON.stringify({ configPath, next: '由开发者填写 API/docs/消费者模板及就绪协议后运行 doctor' }) + '\n', stderr: '' };
    }
    const project = await readProject(root, configFile);
    const configDigest = computeBufferSha256(canonicalJson(project.config));
    const timeoutMs = options['--timeout'] ? Number(options['--timeout']) : 120_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('ARGUMENT_INVALID: --timeout');
    const log = context.onProgress ?? (() => {});
    // Frozen materials are authoritative for recovery; current category enablement
    // and developer source edits cannot cause them to be rebuilt or packed again.
    if (command === 'release' && !prepareOnly) {
      let pointer: z.infer<typeof pointerSchema> | undefined;
      try { pointer = pointerSchema.parse(JSON.parse(await fs.readFile(await projectPath(root, pointerFile), 'utf8'))); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') && !(error instanceof Error && error.message.startsWith('PROJECT_FILE_MISSING'))) throw error; }
      const explicitBundle = options['--bundle-dir'];
      const relative = explicitBundle ?? (pointer?.configFile === configFile && pointer.packageName === project.pkg.name && pointer.packageVersion === project.pkg.version ? pointer.bundleDir : undefined);
      if (relative && !explicitBundle && pointer?.configDigest !== configDigest) throw new Error('CONFIG_CHANGED: 配置已变化，请先升级组件包版本并 prepare-release 新材料；恢复原材料请显式 --bundle-dir ' + pointer?.bundleDir);
      if (relative) {
        const bundleDir = await projectPath(root, relative, true);
        try { await fs.access(path.join(bundleDir, 'manifest.json')); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
        if (await fs.stat(path.join(bundleDir, 'manifest.json')).catch(() => undefined)) {
          const prepared = await loadProjectBundle(bundleDir);
          if (pointer && !explicitBundle && await manifestDigest(prepared.manifest) !== pointer.manifestDigest) throw new Error('FROZEN_MANIFEST_MISMATCH');
          log('恢复原冻结发布材料，复用原会话: ' + bundleDir);
          const { executeReleaseCommand } = await import('../local/release.js');
          const result = await executeReleaseCommand({ bundleDir, apiUrl: options['--api-url'], token: options['--token'], timeoutMs, idempotencyKey: options['--key'] ?? options['--idempotency-key'], onProgress: log });
          return { exitCode: result.ok ? 0 : 1, stdout: JSON.stringify({ bundleDir, ...result }) + '\n', stderr: result.ok ? '' : (result.error ?? 'RELEASE_FAILED') + '\n' };
        }
        if (pointer && !explicitBundle) throw new Error('FROZEN_BUNDLE_MISSING: ' + relative);
      }
    }
    const frameworkChoices: { value: string; label: string }[] = [...new Set(project.config.variants.map(v => v.framework))].map(value => ({ value, label: value }));
    frameworkChoices.push({ value: 'all', label: '全部配置实现' });
    const selected = await choose('framework', frameworkChoices);
    const variants: ProjectVariant[] = project.config.variants.filter(v => selected === 'all' || v.framework === selected).map(v => ({ ...v, category: options['--category'] ?? v.category }));
    if (command === 'dev') {
      if (selected === 'all') throw new Error('ARGUMENT_INVALID: dev 请选择一个 --framework');
      const dev = project.config.dev[selected as 'vue' | 'react'];
      if (!dev) throw new Error('DEV_COMMAND_REQUIRED: ' + selected);
      await runLocal(dev, project.packageDir, log, options['--timeout'] ? timeoutMs : 0);
      return { exitCode: 0, stdout: JSON.stringify({ framework: selected, developed: true }) + '\n', stderr: '' };
    }
    const access = await doctorProject(project, variants, options['--api-url'], options['--token']);
    if (command === 'doctor') return { exitCode: 0, stdout: JSON.stringify({ ok: true, subject: access.identity.subject, packageName: project.pkg.name, variants: variants.map(v => v.componentId + '-' + v.framework) }) + '\n', stderr: '' };
    const relativeBundle = options['--bundle-dir'] ?? path.join('.component-releases', project.pkg.version + '-' + Date.now());
    const bundleDir = await projectPath(root, relativeBundle, true);
    const prepared = await prepareProject(project, variants, bundleDir, version, log, timeoutMs);
    const pointer = { configFile, configDigest, packageName: project.pkg.name, packageVersion: project.pkg.version, bundleDir: relativeBundle, manifestDigest: await manifestDigest(prepared.manifest) };
    const pointerPath = await projectPath(root, pointerFile, true);
    await fs.writeFile(pointerPath + '.tmp', JSON.stringify(pointer, null, 2) + '\n');
    await fs.rename(pointerPath + '.tmp', pointerPath);
    if (command === 'prepare-release' || prepareOnly) return { exitCode: 0, stdout: JSON.stringify({ bundleDir: prepared.bundleDir, manifest: prepared.manifest }) + '\n', stderr: '' };
    const { executeReleaseCommand } = await import('../local/release.js');
    const result = await executeReleaseCommand({ bundleDir, apiUrl: access.apiUrl, token: access.token, timeoutMs, idempotencyKey: options['--key'] ?? options['--idempotency-key'], onProgress: log });
    return { exitCode: result.ok ? 0 : 1, stdout: JSON.stringify({ bundleDir, ...result }) + '\n', stderr: result.ok ? '' : (result.error ?? 'RELEASE_FAILED') + '\n' };
  } catch (error) { return { exitCode: 1, stdout: '', stderr: (error instanceof Error ? error.message : String(error)) + '\n' }; }
}
