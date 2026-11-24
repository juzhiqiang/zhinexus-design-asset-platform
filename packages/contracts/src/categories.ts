import type { ValidationResult } from './release-manifest.js';
import { array, object, text, validateSchema } from './schema.js';

export type ComponentCategory = { id: string; name: string; enabled: boolean; revision: string };
export type ComponentCategoryListResponse = { items: ComponentCategory[] };
export type CreateComponentCategoryRequest = { id: string; name: string };
export type UpdateComponentCategoryRequest = { name: string; enabled: boolean; expectedRevision: string };
export type PublishingOptionsResponse = {
  categories: ComponentCategory[];
  components: { componentId: string; category: string }[];
  packages: string[];
};

export const categoryIdSchema = { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const name = { ...text, maxLength: 128, pattern: '^(?![\\s\\S]*\\u0000)\\S(?:[\\s\\S]*\\S)?$' };
const revision = { type: 'string' as const, pattern: '^(0|[1-9][0-9]{0,18})$' };
export const componentCategorySchema = object({ id: categoryIdSchema, name, enabled: { type: 'boolean' }, revision });
export const componentCategoryListSchema = object({ items: array(componentCategorySchema) });
export const createComponentCategorySchema = object({ id: categoryIdSchema, name });
export const updateComponentCategorySchema = object({ name, enabled: { type: 'boolean' }, expectedRevision: revision });
export const publishingOptionsSchema = object({
  categories: array(componentCategorySchema),
  components: array(object({ componentId: categoryIdSchema, category: text })),
  packages: array({ ...text, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' }),
});
export const validateComponentCategory = (input: unknown): ValidationResult<ComponentCategory> => validateSchema(componentCategorySchema, input);
export const validateComponentCategoryList = (input: unknown): ValidationResult<ComponentCategoryListResponse> => validateSchema(componentCategoryListSchema, input);
export const validateCreateComponentCategory = (input: unknown): ValidationResult<CreateComponentCategoryRequest> => validateSchema(createComponentCategorySchema, input);
export const validateUpdateComponentCategory = (input: unknown): ValidationResult<UpdateComponentCategoryRequest> => validateSchema(updateComponentCategorySchema, input);
export const validatePublishingOptions = (input: unknown): ValidationResult<PublishingOptionsResponse> => validateSchema(publishingOptionsSchema, input);
export const categorySchemas = {
  'component-category-v1': componentCategorySchema,
  'component-category-list-response-v1': componentCategoryListSchema,
  'create-component-category-request-v1': createComponentCategorySchema,
  'update-component-category-request-v1': updateComponentCategorySchema,
  'publishing-options-response-v1': publishingOptionsSchema,
};
