import type { Framework, ValidationResult } from './release-manifest.js';
import { array, choice, exactVersion, object, text, validateSchema } from './schema.js';

export type ComponentCategory = { id: string; name: string; enabled: boolean; revision: string };
export type ComponentCategoryListResponse = { items: ComponentCategory[] };
export type CreateComponentCategoryRequest = { id: string; name: string };
export type UpdateComponentCategoryRequest = { name: string; enabled: boolean; expectedRevision: string };
export type PublishingOptionsResponse = {
  categories: ComponentCategory[];
  components: { componentId: string; category: string; isPublic?: boolean }[];
  packages: string[];
};
export type UpdateComponentVisibilityRequest = { isPublic: boolean; reason: string };
export type ComponentVisibilityResponse = { componentId: string; category: string; isPublic: boolean };
export type ComponentReleaseHistoryItem = {
  variantReleaseId: string;
  variantId: string;
  framework: Framework;
  packageName: string;
  packageVersion: string;
  exportName: string;
  availability: 'Ready' | 'DEPRECATED';
  deprecatedReason?: string;
};
export type ComponentReleaseHistoryResponse = {
  componentId: string;
  category: string;
  isPublic: boolean;
  items: ComponentReleaseHistoryItem[];
};

export const categoryIdSchema = { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const name = { ...text, maxLength: 128, pattern: '^(?![\\s\\S]*\\u0000)\\S(?:[\\s\\S]*\\S)?$' };
const reason = { ...text, maxLength: 2000, pattern: '^(?![\\s\\S]*\\u0000)\\S(?:[\\s\\S]*\\S)?$' };
const revision = { type: 'string' as const, pattern: '^(0|[1-9][0-9]{0,18})$' };
const packageName = { ...text, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' };
const uuid = { ...text, pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };
export const componentCategorySchema = object({ id: categoryIdSchema, name, enabled: { type: 'boolean' }, revision });
export const componentCategoryListSchema = object({ items: array(componentCategorySchema) });
export const createComponentCategorySchema = object({ id: categoryIdSchema, name });
export const updateComponentCategorySchema = object({ name, enabled: { type: 'boolean' }, expectedRevision: revision });
export const publishingOptionsSchema = object({
  categories: array(componentCategorySchema),
  components: array(object({ componentId: categoryIdSchema, category: text, isPublic: { type: 'boolean' } }, ['isPublic'])),
  packages: array(packageName),
});
export const updateComponentVisibilitySchema = object({ isPublic: { type: 'boolean' }, reason });
export const componentVisibilitySchema = object({ componentId: categoryIdSchema, category: text, isPublic: { type: 'boolean' } });
export const componentReleaseHistoryItemSchema = object({
  variantReleaseId: uuid,
  variantId: categoryIdSchema,
  framework: choice('vue', 'react'),
  packageName,
  packageVersion: exactVersion,
  exportName: text,
  availability: choice('Ready', 'DEPRECATED'),
  deprecatedReason: text,
}, ['deprecatedReason']);
export const componentReleaseHistorySchema = object({
  componentId: categoryIdSchema,
  category: text,
  isPublic: { type: 'boolean' },
  items: array(componentReleaseHistoryItemSchema),
});

export const validateComponentCategory = (input: unknown): ValidationResult<ComponentCategory> => validateSchema(componentCategorySchema, input);
export const validateComponentCategoryList = (input: unknown): ValidationResult<ComponentCategoryListResponse> => validateSchema(componentCategoryListSchema, input);
export const validateCreateComponentCategory = (input: unknown): ValidationResult<CreateComponentCategoryRequest> => validateSchema(createComponentCategorySchema, input);
export const validateUpdateComponentCategory = (input: unknown): ValidationResult<UpdateComponentCategoryRequest> => validateSchema(updateComponentCategorySchema, input);
export const validatePublishingOptions = (input: unknown): ValidationResult<PublishingOptionsResponse> => validateSchema(publishingOptionsSchema, input);
export const validateUpdateComponentVisibility = (input: unknown): ValidationResult<UpdateComponentVisibilityRequest> => {
  const normalized = input && typeof input === 'object' && !Array.isArray(input) && typeof (input as { reason?: unknown }).reason === 'string'
    ? { ...(input as Record<string, unknown>), reason: (input as { reason: string }).reason.trim() }
    : input;
  return validateSchema(updateComponentVisibilitySchema, normalized);
};
export const validateComponentVisibility = (input: unknown): ValidationResult<ComponentVisibilityResponse> => validateSchema(componentVisibilitySchema, input);
export const validateComponentReleaseHistory = (input: unknown): ValidationResult<ComponentReleaseHistoryResponse> => validateSchema(componentReleaseHistorySchema, input);
export const categorySchemas = {
  'component-category-v1': componentCategorySchema,
  'component-category-list-response-v1': componentCategoryListSchema,
  'create-component-category-request-v1': createComponentCategorySchema,
  'update-component-category-request-v1': updateComponentCategorySchema,
  'publishing-options-response-v1': publishingOptionsSchema,
  'update-component-visibility-request-v1': updateComponentVisibilitySchema,
  'component-visibility-response-v1': componentVisibilitySchema,
  'component-release-history-response-v1': componentReleaseHistorySchema,
};
