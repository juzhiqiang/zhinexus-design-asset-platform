/** Stable V1 machine-readable codes. Messages are descriptive, not identifiers. */
export const CONTRACT_ERROR_CODES = [
  'INVALID_SCHEMA', 'INVALID_PATH', 'DUPLICATE_ID', 'CONFLICT',
  'REFERENCE_NOT_FOUND', 'ARTIFACT_MISMATCH', 'DIGEST_MISMATCH',
  'SCREENSHOT_REQUIRED', 'SCREENSHOT_VARIANT_MISMATCH', 'SOURCE_FORBIDDEN',
  'REPORT_REQUIRED', 'REPORT_MISMATCH', 'COMPATIBILITY_EVIDENCE_REQUIRED',
  'FILE_REQUIRED', 'UNEXPECTED_FILE',
] as const;
export type ContractErrorCode = typeof CONTRACT_ERROR_CODES[number];
export type ValidationIssue = { code: ContractErrorCode; path: string; message: string };
export const API_ERROR_CODES = [
  ...CONTRACT_ERROR_CODES, 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND',
  'UPLOAD_INCOMPLETE', 'LIMIT_EXCEEDED', 'LEASE_LOST', 'INFRA_UNAVAILABLE', 'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = typeof API_ERROR_CODES[number];
export type ApiError = { code: ApiErrorCode; message: string; details: ValidationIssue[]; requestId: string };
