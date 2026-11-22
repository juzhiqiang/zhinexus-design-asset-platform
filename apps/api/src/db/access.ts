import type { QueryResult, QueryResultRow } from 'pg';
import type { Principal } from '../auth/oidc.js';
import { PlatformError } from '../errors.js';
import { requireRole } from '../auth/roles.js';

export type RequestContext = { principal: Principal; requestId: string;operator?:string };
export type Sql = { query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<T>> };
export async function requireCurrentIdentity(sql:Sql,context:RequestContext,action:'read'|'upload'|'baseline'|'deprecate'):Promise<void> {
  const active=(await sql.query("SELECT generation FROM access_active WHERE section='oidc' FOR SHARE")).rows[0];
  if (!active || (context.principal.generation ?? '0')!==active.generation) throw new PlatformError('UNAUTHENTICATED');
  if ((await sql.query('SELECT 1 FROM disabled_subjects WHERE subject=$1',[context.principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
  const denied=(await sql.query('SELECT role FROM subject_role_restrictions WHERE subject=$1',[context.principal.subject])).rows.map(row=>row.role);
  requireRole({...context.principal,roles:context.principal.roles.filter(role=>!denied.includes(role))},action);
}
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
