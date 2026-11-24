import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { validateComponentApi, type ComponentApiV1 } from '../contracts/component-api.js';

export const PROJECT_CONFIG_FILE = 'component.config.json';
const relativePath = z.string().min(1).max(1024);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
export const commandSchema = z.strictObject({ program: z.string().min(1), args: z.array(z.string()).max(128) });
const variantSchema = z.strictObject({
  componentId: identifier, framework: z.enum(['vue', 'react']), category: identifier,
  exportName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/), exportPath: z.string().regex(/^\.(?:\/[A-Za-z0-9_-]+)*$/),
  api: relativePath, docs: relativePath,
  consumer: z.strictObject({ templateDir: relativePath, build: commandSchema, previewDir: relativePath, previewEntry: relativePath }),
  readiness: z.strictObject({ selector: z.string().min(1), states: z.array(identifier).min(1), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096), renderer: z.enum(['canvas', 'svg']), theme: z.enum(['light', 'dark']) }),
});
const projectSchema = z.strictObject({
  schemaVersion: z.literal(1), packageDir: relativePath, build: commandSchema,
  dev: z.strictObject({ vue: commandSchema.optional(), react: commandSchema.optional() }), variants: z.array(variantSchema).min(1),
});
export function validateProjectConfig(input: unknown): ProjectConfig {
  const checked = projectSchema.safeParse(input);
  if (!checked.success) throw new Error('CONFIG_INVALID: ' + checked.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; '));
  return checked.data;
}
export type LocalCommand = z.infer<typeof commandSchema>;
export type ProjectConfig = z.infer<typeof projectSchema>;
export type ProjectVariant = ProjectConfig['variants'][number];
export type ProjectPackage = { name: string; version: string; private?: boolean; scripts?: Record<string, string>; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
export type LoadedProject = { root: string; configPath: string; config: ProjectConfig; packageDir: string; pkg: ProjectPackage };

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
/** Resolve existing ancestors too: a symlink cannot turn a relative path into an escape. */
export async function projectPath(root: string, relative: string, allowMissing = false): Promise<string> {
  if (path.isAbsolute(relative) || /[\u0000-\u001f]/.test(relative)) throw new Error('PATH_OUTSIDE_PROJECT: ' + relative);
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('PATH_OUTSIDE_PROJECT: ' + relative);
  let ancestor = target;
  while (true) {
    try {
      const real = await fs.realpath(ancestor);
      if (!inside(root, real)) throw new Error('PATH_OUTSIDE_PROJECT: ' + relative);
      if (!allowMissing && ancestor !== target) throw new Error('PROJECT_FILE_MISSING: ' + relative);
      return target;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') || ancestor === root) throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}
export async function readProjectPackage(root: string, relative: string): Promise<{ packageDir: string; pkg: ProjectPackage }> {
  const packageDir = await projectPath(root, relative);
  const input: unknown = JSON.parse(await fs.readFile(await projectPath(root, path.join(relative, 'package.json')), 'utf8'));
  const checked = z.object({ name: z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/), private: z.boolean().optional(), scripts: z.record(z.string(), z.string()).optional(), dependencies: z.record(z.string(), z.string()).optional(), peerDependencies: z.record(z.string(), z.string()).optional() }).safeParse(input);
  if (!checked.success) throw new Error('PACKAGE_INVALID: name/version/package.json');
  if (checked.data.private) throw new Error('PACKAGE_PRIVATE: 请选择可发布的组件子包，业务应用不能整体发布');
  return { packageDir, pkg: checked.data };
}
export async function readProject(rootInput: string, configFile = PROJECT_CONFIG_FILE): Promise<LoadedProject> {
  const root = await fs.realpath(rootInput);
  const configPath = await projectPath(root, configFile);
  const config = validateProjectConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
  const ids = new Set<string>(); const categories = new Map<string, string>();
  for (const variant of config.variants) {
    const id = variant.componentId + '-' + variant.framework;
    if (ids.has(id) || new Set(variant.readiness.states).size !== variant.readiness.states.length) throw new Error('CONFIG_DUPLICATE: ' + id);
    ids.add(id);
    if (categories.has(variant.componentId) && categories.get(variant.componentId) !== variant.category) throw new Error('CATEGORY_CONFLICT: ' + variant.componentId);
    categories.set(variant.componentId, variant.category);
    for (const relative of [variant.api, variant.docs, variant.consumer.templateDir]) await projectPath(root, relative, true);
    await projectPath(root, variant.consumer.previewDir, true); await projectPath(root, variant.consumer.previewEntry, true);
  }
  return { root, configPath, config, ...await readProjectPackage(root, config.packageDir) };
}
export async function readVariantApi(project: LoadedProject, variant: ProjectVariant): Promise<ComponentApiV1> {
  const checked = validateComponentApi(JSON.parse(await fs.readFile(await projectPath(project.root, variant.api), 'utf8')));
  if (!checked.ok) throw new Error('API_INVALID: ' + JSON.stringify(checked.issues));
  for (const key of ['componentId', 'framework', 'exportName', 'exportPath'] as const) if (checked.value[key] !== variant[key]) throw new Error('API_IDENTITY_MISMATCH: ' + key);
  return checked.value;
}
