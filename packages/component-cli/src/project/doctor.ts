import * as fs from 'node:fs/promises';
import { z } from 'zod';
import { validatePublishingOptions } from '../contracts/categories.js';
import { resolvePlatformApiUrl, resolvePlatformToken } from '../local/credentials.js';
import { projectPath, readVariantApi, type LoadedProject, type ProjectVariant } from './config.js';
import { consumerTemplate } from './consumer.js';

export async function publishingAccess(apiInput?: string, tokenInput?: string) {
  const apiUrl = (await resolvePlatformApiUrl(apiInput) ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const url = new URL(apiUrl);
  if (url.origin !== apiUrl || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('API_ORIGIN_INVALID');
  const token = await resolvePlatformToken(apiUrl, tokenInput);
  if (!token) throw new Error('UNAUTHENTICATED: 请先 component login 或提供 --token');
  const get = async (endpoint: string): Promise<unknown> => {
    const response = await fetch(apiUrl + endpoint, { redirect: 'error', headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error((response.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN') + ': 平台前置检查被拒绝 (' + response.status + ')');
    return response.json();
  };
  const identity = z.object({ authenticated: z.literal(true), subject: z.string().min(1), roles: z.array(z.string()) }).safeParse(await get('/v1/auth/oidc/session'));
  if (!identity.success) throw new Error('UNAUTHENTICATED: 平台身份响应无效');
  if (!identity.data.roles.some(role => role === 'publisher' || role === 'maintainer')) throw new Error('FORBIDDEN: 需要 publisher/maintainer');
  const checked = validatePublishingOptions(await get('/v1/publishing/options'));
  if (!checked.ok) throw new Error('PUBLISHING_OPTIONS_INVALID: ' + JSON.stringify(checked.issues));
  return { apiUrl, token, identity: identity.data, options: checked.value };
}
export async function doctorProject(project: LoadedProject, variants: ProjectVariant[], apiUrl?: string, token?: string) {
  const access = await publishingAccess(apiUrl, token);
  if (!access.options.packages.includes(project.pkg.name)) throw new Error('FORBIDDEN: 缺少包发布 ACL');
  for (const variant of variants) {
    if (!access.options.components.some(component => component.componentId === variant.componentId)) throw new Error('FORBIDDEN: 缺少组件发布 ACL: ' + variant.componentId);
    if (!access.options.categories.some(category => category.id === variant.category && category.enabled)) throw new Error('CATEGORY_DISABLED: ' + variant.category);
    await readVariantApi(project, variant);
    const docs = await fs.readFile(await projectPath(project.root, variant.docs), 'utf8');
    if (!docs.trim()) throw new Error('DOCS_EMPTY: ' + variant.docs);
    await projectPath(project.root, variant.consumer.templateDir);
    await consumerTemplate(project, variant);
  }
  return access;
}
