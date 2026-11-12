import type { ApiErrorCode, ValidationIssue } from '@company/contracts';

export class PlatformError extends Error {
  readonly status: number;
  constructor(readonly code: ApiErrorCode, readonly details: ValidationIssue[] = [], readonly authorizationDenied = false) {
    super(code);
    this.status = ({ UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
      UPLOAD_INCOMPLETE: 409, LEASE_LOST: 409, LIMIT_EXCEEDED: 413, INFRA_UNAVAILABLE: 503,
      INTERNAL_ERROR: 500 } as Partial<Record<ApiErrorCode, number>>)[code] ?? 400;
  }
}
