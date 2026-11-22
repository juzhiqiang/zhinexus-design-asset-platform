import { array, choice, object, text, timestamp, validateSchema } from './schema.js';
import type { Schema } from './schema.js';
import type { ValidationResult } from './release-manifest.js';
import type { ValidationIssue } from './errors.js';

export const MANAGED_ACCOUNT_ROLES = ['reader', 'publisher', 'maintainer'] as const;
export type ManagedAccountRole = (typeof MANAGED_ACCOUNT_ROLES)[number];
/** Directory/role synchronisation state only; it never implies that login is possible. */
export const MANAGED_ACCOUNT_SYNC_STATES = ['pending', 'syncing', 'synced', 'failed'] as const;
export type ManagedAccountSyncState = (typeof MANAGED_ACCOUNT_SYNC_STATES)[number];
/** `unset` blocks login, `uncertain` keeps the local revocation until operations confirm the remote result. */
export const MANAGED_ACCOUNT_CREDENTIAL_STATES = ['unset', 'set', 'uncertain'] as const;
export type ManagedAccountCredentialState = (typeof MANAGED_ACCOUNT_CREDENTIAL_STATES)[number];
export const MANAGED_ACCOUNT_ACTIONS = ['create', 'set-password', 'update', 'disable', 'enable', 'force-logout'] as const;
export type ManagedAccountAction = (typeof MANAGED_ACCOUNT_ACTIONS)[number];

/** Executor defaults recorded in the design; the realm template enforces the same policy. */
export const MANAGED_ACCOUNT_USERNAME_PATTERN = '^[a-z0-9][a-z0-9._-]{2,63}$';
export const MANAGED_ACCOUNT_PASSWORD_MIN_LENGTH = 14;
export const MANAGED_ACCOUNT_PASSWORD_MAX_LENGTH = 256;
export const MANAGED_ACCOUNT_DISPLAY_NAME_MAX_LENGTH = 64;
export const MANAGED_ACCOUNT_LIMITS = Object.freeze({
  componentGrants: 256,
  packageGrants: 64,
  listPageSize: 100,
  queryLength: 128,
});

/** PostgreSQL bigint on the wire: a decimal string, never a JavaScript number. */
const bigint: Schema = { ...text, maxLength: 19, pattern: '^(0|[1-9][0-9]{0,18})$' };
const identifier: Schema = { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const componentId: Schema = { ...text, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' };
const packageName: Schema = { ...text, maxLength: 214, pattern: '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' };
const uuid: Schema = { ...text, pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };
const roles: Schema = array(choice(...MANAGED_ACCOUNT_ROLES), 1);
const componentGrant = object({
  componentId,
  canPublish: { type: 'boolean' },
  canMaintain: { type: 'boolean' },
});
const summary = object({
  id: uuid,
  username: { ...text, maxLength: 64, pattern: MANAGED_ACCOUNT_USERNAME_PATTERN },
  displayName: { ...text, maxLength: MANAGED_ACCOUNT_DISPLAY_NAME_MAX_LENGTH },
  roles,
  enabled: { type: 'boolean' },
  credentialState: choice(...MANAGED_ACCOUNT_CREDENTIAL_STATES),
  syncState: choice(...MANAGED_ACCOUNT_SYNC_STATES),
  administrator: { type: 'boolean' },
  accountVersion: bigint,
  desiredRevision: bigint,
  accessEpoch: bigint,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const createRequest = object({
  username: { ...text, maxLength: 64 },
  displayName: { ...text, maxLength: MANAGED_ACCOUNT_DISPLAY_NAME_MAX_LENGTH },
  roles,
  componentGrants: array(componentGrant),
  packageGrants: array(packageName),
}, ['componentGrants', 'packageGrants']);
const updateRequest = object({
  expectedRevision: bigint,
  displayName: { ...text, maxLength: MANAGED_ACCOUNT_DISPLAY_NAME_MAX_LENGTH },
  roles,
  componentGrants: array(componentGrant),
  packageGrants: array(packageName),
}, ['displayName', 'roles', 'componentGrants', 'packageGrants']);
const mutationRequest = object({ expectedRevision: bigint });
const passwordRequest = object({ expectedRevision: bigint, password: { ...text, maxLength: MANAGED_ACCOUNT_PASSWORD_MAX_LENGTH } });
const listQuery = object({
  query: { ...text, maxLength: MANAGED_ACCOUNT_LIMITS.queryLength },
  enabled: { type: 'boolean' },
  page: { type: 'integer', minimum: 1, maximum: 100000 },
  pageSize: { type: 'integer', minimum: 1, maximum: MANAGED_ACCOUNT_LIMITS.listPageSize },
}, ['query', 'enabled', 'page', 'pageSize']);
const auditEntry = object({
  at: timestamp,
  actor: text,
  action: choice(...MANAGED_ACCOUNT_ACTIONS),
  accountId: uuid,
  username: { ...text, maxLength: 64 },
  result: choice('passed', 'failed'),
  requestId: { ...text, maxLength: 128 },
}, ['requestId']);

export type ManagedAccountComponentGrant = { componentId: string; canPublish: boolean; canMaintain: boolean };
export type ManagedAccountSummary = {
  id: string; username: string; displayName: string; roles: ManagedAccountRole[];
  enabled: boolean; credentialState: ManagedAccountCredentialState; syncState: ManagedAccountSyncState;
  administrator: boolean; accountVersion: string; desiredRevision: string; accessEpoch: string;
  createdAt: string; updatedAt: string;
};
export type ManagedAccountDetail = ManagedAccountSummary & { componentGrants: ManagedAccountComponentGrant[]; packageGrants: string[] };
export type ManagedAccountListQuery = { query?: string; enabled?: boolean; page?: number; pageSize?: number };
export type ManagedAccountListResponse = { items: ManagedAccountSummary[]; page: number; pageSize: number; total: number };
export type CreateManagedAccountRequest = { username: string; displayName: string; roles: ManagedAccountRole[]; componentGrants?: ManagedAccountComponentGrant[]; packageGrants?: string[] };
export type UpdateManagedAccountRequest = { expectedRevision: string; displayName?: string; roles?: ManagedAccountRole[]; componentGrants?: ManagedAccountComponentGrant[]; packageGrants?: string[] };
export type ManagedAccountMutation = { expectedRevision: string };
export type SetManagedAccountPasswordRequest = { expectedRevision: string; password: string };
export type ManagedAccountMutationResponse = { account: ManagedAccountDetail };
export type ManagedAccountAuditEntry = { at: string; actor: string; action: ManagedAccountAction; accountId: string; username: string; result: 'passed' | 'failed'; requestId?: string };
export type ManagedAccountAuditResponse = { items: ManagedAccountAuditEntry[] };

/** ASCII lowercase only; no Unicode case folding, so a non-ASCII name can never collide with an ASCII one. */
export function normalizeManagedAccountUsername(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[A-Z]/g, character => character.toLowerCase()) : '';
}
export function validateManagedAccountUsername(input: unknown): ValidationResult<{ username: string }> {
  return validateSchema<{ username: string }>(object({ username: { ...text, maxLength: 64, pattern: MANAGED_ACCOUNT_USERNAME_PATTERN } }), { username: normalizeManagedAccountUsername(input) });
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const failure = (issues: ValidationIssue[]): { ok: false; issues: ValidationIssue[] } => ({ ok: false, issues: issues.slice(0, 100) });
const duplicates = (values: string[], path: string): ValidationIssue[] => {
  const seen = new Set<string>(); const issues: ValidationIssue[] = [];
  for (const value of values) {
    if (seen.has(value)) issues.push({ code: 'DUPLICATE_ID', path, message: 'Duplicate grant in this request' });
    seen.add(value);
  }
  return issues;
};

export function validateCreateManagedAccount(input: unknown): ValidationResult<CreateManagedAccountRequest> {
  const normalized = record(input) ? { ...input, username: normalizeManagedAccountUsername(input.username) } : input;
  const parsed = validateSchema<CreateManagedAccountRequest>(createRequest, normalized);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const issues = [
    ...duplicates((value.componentGrants ?? []).map(grant => grant.componentId), '/componentGrants'),
    ...duplicates(value.packageGrants ?? [], '/packageGrants'),
    ...duplicates(value.roles, '/roles'),
  ];
  if ((value.componentGrants?.length ?? 0) > MANAGED_ACCOUNT_LIMITS.componentGrants) issues.push({ code: 'INVALID_SCHEMA', path: '/componentGrants', message: 'Too many component grants' });
  if ((value.packageGrants?.length ?? 0) > MANAGED_ACCOUNT_LIMITS.packageGrants) issues.push({ code: 'INVALID_SCHEMA', path: '/packageGrants', message: 'Too many package grants' });
  return issues.length ? failure(issues) : parsed;
}

export function validateUpdateManagedAccount(input: unknown): ValidationResult<UpdateManagedAccountRequest> {
  const parsed = validateSchema<UpdateManagedAccountRequest>(updateRequest, input);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const provided = ['displayName', 'roles', 'componentGrants', 'packageGrants'].filter(key => Object.hasOwn(value, key));
  const issues: ValidationIssue[] = [];
  if (!provided.length) issues.push({ code: 'INVALID_SCHEMA', path: '', message: 'At least one mutable field is required' });
  issues.push(...duplicates((value.componentGrants ?? []).map(grant => grant.componentId), '/componentGrants'));
  issues.push(...duplicates(value.packageGrants ?? [], '/packageGrants'));
  issues.push(...duplicates(value.roles ?? [], '/roles'));
  if ((value.componentGrants?.length ?? 0) > MANAGED_ACCOUNT_LIMITS.componentGrants) issues.push({ code: 'INVALID_SCHEMA', path: '/componentGrants', message: 'Too many component grants' });
  if ((value.packageGrants?.length ?? 0) > MANAGED_ACCOUNT_LIMITS.packageGrants) issues.push({ code: 'INVALID_SCHEMA', path: '/packageGrants', message: 'Too many package grants' });
  return issues.length ? failure(issues) : parsed;
}

export function validateManagedAccountMutation(input: unknown): ValidationResult<ManagedAccountMutation> {
  return validateSchema<ManagedAccountMutation>(mutationRequest, input);
}

/** The password exists only inside this request; it is never persisted, logged or echoed back. */
export function validateSetManagedAccountPassword(input: unknown): ValidationResult<SetManagedAccountPasswordRequest> {
  const parsed = validateSchema<SetManagedAccountPasswordRequest>(passwordRequest, input);
  if (!parsed.ok) return parsed;
  const { password } = parsed.value;
  const issues: ValidationIssue[] = [];
  if (password.length < MANAGED_ACCOUNT_PASSWORD_MIN_LENGTH) issues.push({ code: 'INVALID_SCHEMA', path: '/password', message: 'Password is shorter than the required policy' });
  if (/[\u0000-\u001f\u007f]/u.test(password) || password.trim().length === 0) issues.push({ code: 'INVALID_SCHEMA', path: '/password', message: 'Password contains unsupported characters' });
  return issues.length ? failure(issues) : parsed;
}

export function validateManagedAccountListQuery(input: unknown): ValidationResult<ManagedAccountListQuery> {
  return validateSchema<ManagedAccountListQuery>(listQuery, input);
}

export function validateManagedAccountSummary(input: unknown): ValidationResult<ManagedAccountSummary> {
  return validateSchema<ManagedAccountSummary>(summary, input);
}
export function validateManagedAccountDetail(input: unknown): ValidationResult<ManagedAccountDetail> {
  const parsed = validateSchema<ManagedAccountDetail>(object({ ...summary.properties!, componentGrants: array(componentGrant), packageGrants: array(packageName) }), input);
  if (!parsed.ok) return parsed;
  const issues = duplicates(parsed.value.componentGrants.map(grant => grant.componentId), '/componentGrants');
  issues.push(...duplicates(parsed.value.packageGrants, '/packageGrants'));
  return issues.length ? failure(issues) : parsed;
}
export function validateManagedAccountListResponse(input: unknown): ValidationResult<ManagedAccountListResponse> {
  return validateSchema<ManagedAccountListResponse>(object({
    items: array(summary, 1),
    page: { type: 'integer', minimum: 1, maximum: 100000 },
    pageSize: { type: 'integer', minimum: 1, maximum: MANAGED_ACCOUNT_LIMITS.listPageSize },
    total: { type: 'integer', minimum: 0 },
  }), input);
}
export function validateManagedAccountAuditResponse(input: unknown): ValidationResult<ManagedAccountAuditResponse> {
  return validateSchema<ManagedAccountAuditResponse>(object({ items: array(auditEntry, 1) }), input);
}

/** Raw schemas; `schemas.ts` applies the shared $schema/title wrapping for generated JSON Schema. */
export const managedAccountSchemas = {
  'managed-account-summary-v1': summary,
  'managed-account-detail-v1': object({ ...summary.properties!, componentGrants: array(componentGrant), packageGrants: array(packageName) }),
  'managed-account-list-response-v1': object({
    items: array(summary, 1),
    page: { type: 'integer', minimum: 1, maximum: 100000 },
    pageSize: { type: 'integer', minimum: 1, maximum: MANAGED_ACCOUNT_LIMITS.listPageSize },
    total: { type: 'integer', minimum: 0 },
  }),
  'create-managed-account-request-v1': createRequest,
  'update-managed-account-request-v1': updateRequest,
  'managed-account-mutation-request-v1': mutationRequest,
  'set-managed-account-password-request-v1': passwordRequest,
  'managed-account-list-query-v1': listQuery,
  'managed-account-audit-response-v1': object({ items: array(auditEntry, 1) }),
};
