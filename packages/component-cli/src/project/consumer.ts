import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { inside, projectPath, type LoadedProject, type ProjectVariant } from './config.js';
import { runLocal } from './process.js';
import type { FrozenArtifact } from '../local/freeze.js';

const exact = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const ignored = new Set(['dist', '.git', 'pnpm-lock.yaml', 'package-lock.json', '.npmrc']);
export async function consumerTemplate(project: LoadedProject, variant: ProjectVariant) {
  const root = await projectPath(project.root, variant.consumer.templateDir);
  const pkgPath = await projectPath(project.root, path.join(variant.consumer.templateDir, 'package.json'));
  const pkg: Record<string, unknown> = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  if (pkg.workspaces || pkg.pnpm || pkg.overrides || pkg.imports) throw new Error('CONSUMER_SOURCE_LINK: 禁止 workspace/override/import alias');
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entries = z.record(z.string(), z.string()).parse(pkg[key] ?? {});
    for (const [name, version] of Object.entries(entries)) if (name !== project.pkg.name && !exact.test(version)) throw new Error('CONSUMER_SOURCE_LINK: 消费者依赖必须为精确 registry 版本: ' + name);
  }
  const files: string[] = [];
  async function walk(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === 'pnpm-workspace.yaml') throw new Error('CONSUMER_SOURCE_LINK: ' + entry.name);
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        if (/\.(?:[cm]?[jt]sx?|json|vue|html)$/.test(entry.name)) {
          const source = await fs.readFile(absolute, 'utf8');
          if (/\b(?:alias\s*[:=]|workspace:|link:|file:)/.test(source)) throw new Error('CONSUMER_SOURCE_LINK: 禁止源码 alias/link: ' + entry.name);
          for (const match of source.matchAll(/(?:from\s*|import\s*\(?|require\s*\()\s*['"]([^'"]+)['"]/g)) {
            const specifier = match[1]!;
            if (path.isAbsolute(specifier) || (specifier.startsWith('.') && !inside(root, path.resolve(directory, specifier)))) throw new Error('CONSUMER_SOURCE_LINK: ' + specifier);
          }
        }
        files.push(path.relative(root, absolute));
      }
    }
  }
  await walk(root);
  return { root, pkg, files };
}
export async function installProjectConsumer(project: LoadedProject, variant: ProjectVariant, frozen: FrozenArtifact, target: string, log: (message: string) => void, timeoutMs: number) {
  const template = await consumerTemplate(project, variant);
  for (const relative of template.files) {
    await fs.mkdir(path.dirname(path.join(target, relative)), { recursive: true });
    await fs.copyFile(path.join(template.root, relative), path.join(target, relative));
  }
  const pkg = { ...template.pkg, dependencies: { ...(template.pkg.dependencies as Record<string, string> ?? {}), [frozen.packageName]: 'file:' + frozen.tarballPath.replace(/\\/g, '/') } };
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await fs.writeFile(path.join(target, '.npmrc'), 'strict-peer-dependencies=true\nengine-strict=true\nignore-scripts=true\n');
  log('安装冻结 tarball 到工作区外消费者: ' + target + ' (--ignore-scripts)');
  await runLocal({ program: 'pnpm', args: ['install', '--ignore-scripts', '--config.manage-package-manager-versions=false'] }, target, log, timeoutMs);
  const require = createRequire(path.join(target, 'package.json'));
  async function installed(name: string, optional = false): Promise<string | undefined> {
    if (optional) { try { await fs.access(path.join(target, 'node_modules', name, 'package.json')); } catch { return undefined; } }
    try {
      const resolved = await fs.realpath(require.resolve(name + '/package.json'));
      if (!inside(target, resolved)) throw new Error('CONSUMER_SOURCE_LINK: 安装路径越界: ' + name);
      const pkg = JSON.parse(await fs.readFile(resolved, 'utf8'));
      if (!exact.test(pkg.version)) throw new Error('INSTALLED_VERSION_INVALID: ' + name);
      return pkg.version;
    } catch (error) {
      if (optional && error && typeof error === 'object' && 'code' in error && error.code === 'MODULE_NOT_FOUND') return undefined;
      throw error;
    }
  }
  const moduleName = frozen.packageName + variant.exportPath.slice(1);
  const installedPackageRoot = await fs.realpath(path.join(target, 'node_modules', frozen.packageName));
  if (!inside(target, installedPackageRoot)) throw new Error('CONSUMER_SOURCE_LINK: frozen package root');
  const installedPkg = JSON.parse(await fs.readFile(path.join(installedPackageRoot, 'package.json'), 'utf8'));
  if (installedPkg.name !== frozen.packageName || installedPkg.version !== frozen.version) throw new Error('INSTALLED_PACKAGE_MISMATCH');
  const verifyPath = path.join(target, '.verify-export.mjs');
  await fs.writeFile(verifyPath, `import { writeFile } from 'node:fs/promises';\nconst exports = await import(${JSON.stringify(moduleName)}); if (exports[${JSON.stringify(variant.exportName)}] == null) throw new Error('EXPORT_MISSING');\nawait writeFile('.installed-export.json', JSON.stringify({ entry: import.meta.resolve(${JSON.stringify(moduleName)}) }));\n`);
  await runLocal({ program: process.execPath, args: [verifyPath] }, target, log, timeoutMs);
  const resolution = z.strictObject({ entry: z.string().startsWith('file:') }).parse(JSON.parse(await fs.readFile(path.join(target, '.installed-export.json'), 'utf8')));
  const installedEntry = await fs.realpath(fileURLToPath(resolution.entry));
  if (!inside(target, installedEntry)) throw new Error('CONSUMER_SOURCE_LINK: frozen package resolution');
  const frameworkVersion = (await installed(variant.framework))!;
  const reactDomVersion = variant.framework === 'react' ? await installed('react-dom') : undefined;
  const echartsVersion = await installed('echarts', true);
  return { frameworkVersion, reactDomVersion, echartsVersion, installedEntry, installedPackageRoot };
}
