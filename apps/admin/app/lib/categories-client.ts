import {
  validateComponentCategory, validateComponentCategoryList, validateCreateComponentCategory,
  validatePublishingOptions, validateUpdateComponentCategory,
  type ComponentCategory, type ComponentCategoryListResponse, type CreateComponentCategoryRequest,
  type PublishingOptionsResponse, type UpdateComponentCategoryRequest, type ValidationResult,
} from '@company/contracts';
export type CategoryConnection = { apiUrl: string; token?: string; signal?: AbortSignal };
export class CategoryApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function validated<T>(result: ValidationResult<T>, message: string): T {
  if (!result.ok) throw new Error(message);
  return result.value;
}
async function send(connection: CategoryConnection, path: string, body?: unknown): Promise<unknown> {
  const token = connection.token;
  const session = !token || token === '__session__';
  const response = await fetch(connection.apiUrl.trim().replace(/\/+$/, '') + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: session ? 'include' : 'omit',
    cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: connection.signal ? AbortSignal.any([connection.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    headers: { 'content-type': 'application/json', ...(!session ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const message = response.status === 401 ? '登录已失效，请重新登录。'
      : response.status === 403 ? '当前身份没有权限；分类管理仅允许平台管理员，发布选项需要发布权限。'
        : response.status === 409 ? '分类已存在或修订已变化，请刷新列表后重试。'
          : response.status === 400 ? '分类填写内容不符合规则，请检查 ID、名称与修订。'
            : '分类服务暂时不可用，请稍后重试。';
    throw new CategoryApiError(message, response.status);
  }
  return response.json();
}
export async function listComponentCategories(connection: CategoryConnection): Promise<ComponentCategoryListResponse> {
  return validated(validateComponentCategoryList(await send(connection, '/v1/categories?includeDisabled=true')), '分类服务返回了无效的分类列表。');
}
export async function createComponentCategory(connection: CategoryConnection, draft: CreateComponentCategoryRequest): Promise<ComponentCategory> {
  const body = validated(validateCreateComponentCategory(draft), '分类 ID 或名称不符合规则。');
  const category = validated(validateComponentCategory(await send(connection, '/v1/categories', body)), '分类服务返回了无效的分类。');
  if (category.id !== body.id) throw new Error('分类服务返回了无效的稳定 ID。');
  return category;
}
export async function updateComponentCategory(connection: CategoryConnection, id: string, draft: UpdateComponentCategoryRequest): Promise<ComponentCategory> {
  const body = validated(validateUpdateComponentCategory(draft), '分类名称或修订不符合规则。');
  const category = validated(validateComponentCategory(await send(connection, `/v1/categories/${encodeURIComponent(id)}/update`, body)), '分类服务返回了无效的分类。');
  if (category.id !== id) throw new Error('分类服务返回了无效的稳定 ID。');
  return category;
}
export async function readPublishingOptions(connection: CategoryConnection): Promise<PublishingOptionsResponse> {
  return validated(validatePublishingOptions(await send(connection, '/v1/publishing/options')), '分类服务返回了无效的发布选项。');
}
