import type { QueryResult, QueryResultRow } from 'pg';
import type { Principal } from '../auth/oidc.js';
import { PlatformError } from '../errors.js';

export type RequestContext = { principal: Principal; requestId: string };
export type Sql = { query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<T>> };
export async function audit(sql: Sql, subject: string | undefined, event: string, target: string, data: Record<string, unknown> = {}, requestId?: string): Promise<void> {
  await sql.query('INSERT INTO audit_events(subject,event,target_id,data,request_id) VALUES ($1,$2,$3,$4,$5)', [subject ?? null, event, target, JSON.stringify(data), requestId ?? null]);
}
export async function requireComponents(sql: Sql, subject: string, componentIds: string[], maintain = false): Promise<void> {
  const ids = [...new Set(componentIds)];
  if (!ids.length) return;
  const found = await sql.query(`SELECT component_id FROM component_permissions WHERE subject=$1 AND component_id=ANY($2::text[]) AND ${maintain ? 'can_maintain' : '(can_publish OR can_maintain)'}`, [subject, ids]);
  if (found.rowCount !== ids.length) throw new PlatformError('FORBIDDEN');
}
export async function requirePackages(sql: Sql, subject: string, packageNames: string[]): Promise<void> {
  const names = [...new Set(packageNames)];
  const found = await sql.query('SELECT package_name FROM package_permissions WHERE subject=$1 AND package_name=ANY($2::text[])', [subject, names]);
  if (found.rowCount !== names.length) throw new PlatformError('FORBIDDEN');
}
export function uuid(value: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new PlatformError('NOT_FOUND');
  return value;
}
