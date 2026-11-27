import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PROJECT_CONFIG_FILE, inside, projectPath, readProject, readProjectPackage, validateProjectConfig, type ProjectConfig, type ProjectVariant } from '../project/config.js';
import { doctorProject, publishingAccess, validateProjectFiles } from '../project/doctor.js';
import { runLocal } from '../project/process.js';
import { loadProjectBundle, prepareProject } from '../project/prepare.js';
import { manifestDigest } from '../contracts/digests.js';
import { readWorkspace, selectProject } from '../workbench/workspace.js';
import { configRelative, inputFingerprint, readPointer, writePointer, stateKey } from '../workbench/state.js';
import { acquirePackageLock } from '../workbench/lock.js';
import { canonicalJson } from '../contracts/schema.js';
import { computeBufferSha256 } from '../local/digest.js';
import { createBundleZip } from '../project/archive.js';
import { excludeRootReleaseArtifacts } from '../project/package-ignore.js';

export type ProjectCliContext = { cwd?: string; onProgress?: (message: string) => void; prompt?: (label: string, defaultValue?: string) => Promise<string>; promptSecret?: (label: string) => Promise<string>; select?: (label: string, choices: { value: string; label: string }[]) => Promise<string> };

async function packageManager(root: string, packageDir: string): Promise<'npm' | 'pnpm'> {
  let directory = await projectPath(root, packageDir);
  while (true) {
    const manifest = await fs.readFile(path.join(directory, 'package.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error; });
    const manager: unknown = JSON.parse(manifest).packageManager;
    if (typeof manager === 'string') {
      if (manager.startsWith('npm@')) return 'npm';
      if (manager.startsWith('pnpm@')) return 'pnpm';
      throw new Error('PACKAGE_MANAGER_UNSUPPORTED: 目前支持 npm 或 pnpm');
    }
    for (const [file, program] of [['pnpm-lock.yaml', 'pnpm'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm']] as const) {
      try { await fs.access(path.join(directory, file)); return program; }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
    if (directory === root) return 'npm';
    directory = path.dirname(directory);
  }
}
async function validateNewBundleDirectory(packageDir: string, bundleDir: string): Promise<void> {
  const packageRoot = await fs.realpath(packageDir);
  const protectedRoot = path.join(packageRoot, '.component-releases');
  // Resolve existing ancestors so a junction cannot hide a package-local output.
  for (const output of [bundleDir, bundleDir + '.zip']) {
    let ancestor = output;
    while (true) {
      try {
        const resolved = path.resolve(await fs.realpath(ancestor), path.relative(ancestor, output));
        if (inside(packageRoot, resolved) && (resolved === protectedRoot || !inside(protectedRoot, resolved))) throw new Error('BUNDLE_DIR_UNSAFE: 新发布材料必须使用默认 .component-releases/<版本> 目录，或组件包目录之外的项目内目录；不能使用 .component-releases 目录本身');
        break;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
        ancestor = path.dirname(ancestor);
      }
    }
  }
}
export async function runProjectCommand(command: string, args: readonly string[], version: string, context: ProjectCliContext = {}) {
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    const options: Record<string, string> = {}; let prepareOnly = false;
    const allowed = ['--project', '--config', '--package', '--component', '--export', '--export-path', '--source', '--framework', '--category', '--api-url', '--token', '--bundle-dir', '--timeout', '--key', '--idempotency-key'];
    for (let i = 0; i < args.length; i++) {
      const key = args[i]!;
      if (key === '--prepare-only') { prepareOnly = true; continue; }
      const value = args[++i];
      if (!allowed.includes(key) || !value || value.startsWith('--') || options[key] !== undefined) throw new Error('ARGUMENT_INVALID: ' + key);
      options[key] = value;
    }
    const root = await fs.realpath(options['--project'] ?? context.cwd ?? process.cwd());
    const configFile = options['--config'] ?? PROJECT_CONFIG_FILE;
    const input = async (name: string, defaultValue?: string) => {
      const value = options['--' + name] ?? (context.prompt ? (await context.prompt(name, defaultValue)).trim() || defaultValue : defaultValue);
      if (!value) throw new Error('ARGUMENT_REQUIRED: --' + name);
      return value;
    };
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
      const packageDir = await input('package', '.');
      const component = await input('component');
      const exportName = await input('export');
      const framework = await choose('framework', [{ value: 'vue', label: 'Vue' }, { value: 'react', label: 'React' }, { value: 'all', label: 'Vue + React' }]);
      let category = options['--category'];
      if (!category && (options['--api-url'] || options['--token']) && context.select) {
        let access: Awaited<ReturnType<typeof publishingAccess>>;
        try { access = await publishingAccess(options['--api-url'], options['--token']); }
        catch (error) {
          if (error instanceof Error && error.message.startsWith('UNAUTHENTICATED')) throw new Error('UNAUTHENTICATED: 请先运行 juz login --api-url <平台地址>，然后重新运行 juz init 选择平台分类');
          throw error;
        }
        const choices = access.options.categories.filter(item => item.enabled).map(item => ({ value: item.id, label: item.name }));
        if (!choices.length) throw new Error('CATEGORY_UNAVAILABLE: 平台没有启用的分类，请联系管理员');
        category = await choose('category', choices);
      }
      const { pkg } = await readProjectPackage(root, packageDir);
      if (!pkg.scripts?.build) throw new Error('BUILD_COMMAND_REQUIRED: 组件包必须提供 build script');
      const frameworks = framework === 'all' ? ['vue', 'react'] as const : [framework as 'vue' | 'react'];
      const program = await packageManager(root, packageDir);
      const config: ProjectConfig = { schemaVersion: 1, packageDir, build: { program, args: ['run', 'build'] }, dev: {}, variants: frameworks.map(framework => ({ componentId: component, framework, category, sourceEntry: options['--source'], playground: `examples/${component}-${framework}.json`, exportName, exportPath: options['--export-path'] ?? '.', api: `api/${component}-${framework}.json`, docs: `docs/${component}-${framework}.md`, consumer: { templateDir: `consumers/${framework}`, adapter: 'vite', previewDir: 'dist', previewEntry: 'index.html' }, readiness: { selector: '#app', states: ['default'], width: 800, height: 400, renderer: 'canvas', theme: 'light' } })) };
      if (options['--source']) await projectPath(root, options['--source']);
      if (pkg.scripts.dev) for (const framework of frameworks) config.dev[framework] = { program, args: ['run', 'dev'] };
      validateProjectConfig(config);
      if (path.resolve(root, packageDir) === root) await excludeRootReleaseArtifacts(root);
      const { addMissingMaterials } = await import('../workbench/create.js');
      for (const variant of config.variants) await addMissingMaterials(root, variant, pkg.name);
      await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
      return { exitCode: 0, stdout: JSON.stringify({ configPath, next: '运行 juz dev 开发现有组件；填写 API/docs/消费者模板及就绪协议后运行 juz package 或 juz publish' }) + '\n', stderr: '' };
    }
    const project = await selectProject(await readWorkspace(root, options['--config']), options['--package'], context.select);
    if (!['dev','doctor'].includes(command)) releaseLock = await acquirePackageLock(project);
    const configDigest = computeBufferSha256(canonicalJson(project.config));
    const timeoutMs = options['--timeout'] ? Number(options['--timeout']) : 120_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('ARGUMENT_INVALID: --timeout');
    const log = context.onProgress ?? (() => {});
    // Frozen materials are authoritative for recovery; current category enablement
    // and developer source edits cannot cause them to be rebuilt or packed again.
    if (command === 'release' && !prepareOnly) {
      const pointer = await readPointer(project);
      const explicitBundle = options['--bundle-dir'];
      const relative = explicitBundle ?? pointer?.bundleDir;
      if (relative && !explicitBundle && pointer?.configDigest !== configDigest) throw new Error('CONFIG_CHANGED: 配置已变化，请先升级组件包版本并 prepare-release 新材料；恢复原材料请显式 --bundle-dir ' + pointer?.bundleDir);
      if (relative && !explicitBundle && pointer?.inputDigest && pointer.inputDigest !== await inputFingerprint(project)) throw new Error('INPUTS_CHANGED: 源码、示例、API 或文档已变化；请准备新候选材料。恢复原材料请显式 --bundle-dir ' + pointer.bundleDir);
      if (relative) {
        const bundleDir = await projectPath(root, relative, true);
        try { await fs.access(path.join(bundleDir, 'manifest.json')); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
        if (await fs.stat(path.join(bundleDir, 'manifest.json')).catch(() => undefined)) {
          const prepared = await loadProjectBundle(bundleDir);
          if (options['--category'] && prepared.manifest.variants.some(v => v.category !== options['--category'])) throw new Error('CONFIG_CHANGED: 冻结分类不可改写，请准备新候选材料');
          if (!prepared.manifest.packages.some(p => p.name === project.pkg.name && p.version === project.pkg.version)) throw new Error('FROZEN_PACKAGE_MISMATCH');
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
    const onlyFramework = frameworkChoices.length === 1 ? frameworkChoices[0]!.value : undefined;
    if (command !== 'dev') frameworkChoices.push({ value: 'all', label: '全部配置实现' });
    const selected = options['--framework'] ?? onlyFramework ?? (command === 'dev' ? await choose('framework', frameworkChoices) : 'all');
    if (!frameworkChoices.some(choice => choice.value === selected)) throw new Error('ARGUMENT_INVALID: --framework');
    const variants: ProjectVariant[] = project.config.variants.filter(v => selected === 'all' || v.framework === selected).map(v => ({ ...v, category: options['--category'] ?? v.category }));
    if (command === 'dev') {
      if (selected === 'all') throw new Error('ARGUMENT_INVALID: dev 请选择一个 --framework');
      const dev = project.config.dev[selected as 'vue' | 'react'];
      if (!dev) throw new Error('DEV_COMMAND_REQUIRED: ' + selected);
      await runLocal(dev, project.packageDir, log, options['--timeout'] ? timeoutMs : 0);
      return { exitCode: 0, stdout: JSON.stringify({ framework: selected, developed: true }) + '\n', stderr: '' };
    }
    if (variants.some(v => !v.category)) throw new Error('CATEGORY_REQUIRED: 冻结前请分配分类，使用 --category <后台分类 ID> 或工作台分类面板');
    const access = command === 'package' ? (await validateProjectFiles(project, variants), undefined) : await doctorProject(project, variants, options['--api-url'], options['--token']);
    if (command === 'doctor' && access) return { exitCode: 0, stdout: JSON.stringify({ ok: true, subject: access.identity.subject, packageName: project.pkg.name, variants: variants.map(v => v.componentId + '-' + v.framework) }) + '\n', stderr: '' };
    const relativeBundle = options['--bundle-dir'] ?? path.join('.component-releases', stateKey(project), project.pkg.version + '-' + Date.now());
    const bundleDir = await projectPath(root, relativeBundle, true);
    await validateNewBundleDirectory(project.packageDir, bundleDir);
    const prepared = await prepareProject(project, variants, bundleDir, version, log, timeoutMs);
    const pointer = { configFile: configRelative(project), configDigest, inputDigest: prepared.inputDigest, packageName: project.pkg.name, packageVersion: project.pkg.version, bundleDir: relativeBundle, manifestDigest: await manifestDigest(prepared.manifest) };
    await writePointer(project, pointer);
    if (command === 'package') {
      const archivePath = await createBundleZip(prepared.bundleDir);
      return { exitCode: 0, stdout: JSON.stringify({ archivePath, bundleDir: prepared.bundleDir, manifest: prepared.manifest }) + '\n', stderr: '' };
    }
    if (command === 'prepare-release' || prepareOnly) return { exitCode: 0, stdout: JSON.stringify({ bundleDir: prepared.bundleDir, manifest: prepared.manifest }) + '\n', stderr: '' };
    const { executeReleaseCommand } = await import('../local/release.js');
    const result = await executeReleaseCommand({ bundleDir, apiUrl: access?.apiUrl, token: access?.token, timeoutMs, idempotencyKey: options['--key'] ?? options['--idempotency-key'], onProgress: log });
    return { exitCode: result.ok ? 0 : 1, stdout: JSON.stringify({ bundleDir, ...result }) + '\n', stderr: result.ok ? '' : (result.error ?? 'RELEASE_FAILED') + '\n' };
  } catch (error) { return { exitCode: 1, stdout: '', stderr: (error instanceof Error ? error.message : String(error)) + '\n' }; }
  finally { await releaseLock?.(); }
}
