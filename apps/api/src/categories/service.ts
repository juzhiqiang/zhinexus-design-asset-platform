import {
  validateCreateComponentCategory, validateUpdateComponentCategory, validateUpdateComponentVisibility,
  type ComponentCategory, type ComponentCategoryListResponse, type ComponentReleaseHistoryResponse,
  type ComponentVisibilityResponse, type PublishingOptionsResponse, type ReleaseManifestV1,
} from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit, requireComponents, requireCurrentIdentity, type RequestContext, type Sql } from '../db/access.js';
import type { AccessSettingsService } from '../access/service.js';
import type { Principal } from '../auth/oidc.js';
import { PlatformError } from '../errors.js';
import { compareVersions } from '../releases/version-order.js';

const COMPONENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class CategoryService {
  constructor(private readonly db: Database, private readonly access?: AccessSettingsService, private readonly managedIssuer?: string) {}

  private async resolveManagedAccount(sql: Sql, context: RequestContext): Promise<{ enabled: boolean; administrator: boolean; roles: Principal['roles'] } | undefined> {
    const active = (await sql.query("SELECT generation FROM access_active WHERE section='oidc' FOR SHARE")).rows[0];
    if (!active || active.generation !== (context.principal.generation ?? '0')) throw new PlatformError('UNAUTHENTICATED');
    if ((await sql.query('SELECT 1 FROM disabled_subjects WHERE subject=$1', [context.principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
    const account = this.managedIssuer && context.principal.issuer === this.managedIssuer
      ? (await sql.query<{ enabled: boolean; administrator: boolean; roles: Principal['roles'] }>('SELECT enabled,administrator,roles FROM managed_accounts WHERE issuer=$1 AND subject=$2 FOR SHARE', [this.managedIssuer, context.principal.identitySubject ?? context.principal.subject])).rows[0]
      : undefined;
    if (this.managedIssuer && this.managedIssuer === context.principal.issuer && !account) throw new PlatformError('UNAUTHENTICATED');
    if (account && !account.enabled) throw new PlatformError('FORBIDDEN');
    return account;
  }

  private async identity(sql: Sql, context: RequestContext, administrator = false): Promise<void> {
    const account = await this.resolveManagedAccount(sql, context);
    if (administrator) {
      if (account) { if (!account.administrator) throw new PlatformError('FORBIDDEN'); }
      else { if (!this.access) throw new PlatformError('FORBIDDEN'); this.access.administrator(context); }
    } else {
      await requireCurrentIdentity(sql, account ? { ...context, principal: { ...context.principal, roles: account.roles } } : context, 'upload');
    }
  }

  private isAdministrator(account: { administrator: boolean } | undefined, context: RequestContext): boolean {
    if (account) return account.administrator;
    if (!this.access) return false;
    try {
      this.access.administrator(context);
      return true;
    } catch {
      return false;
    }
  }

  async list(includeDisabled: boolean, context: RequestContext): Promise<ComponentCategoryListResponse> {
    return this.db.transaction(async sql => {
      await this.identity(sql, context, includeDisabled);
      return { items: (await sql.query<ComponentCategory>(`SELECT id,name,enabled,revision FROM component_categories ${includeDisabled ? '' : 'WHERE enabled'} ORDER BY id`)).rows };
    });
  }
  async create(input: unknown, context: RequestContext): Promise<ComponentCategory> {
    return this.db.transaction(async sql => {
      await this.identity(sql, context, true);
      const parsed = validateCreateComponentCategory(input);
      if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
      const { id, name } = parsed.value;
      const category = (await sql.query<ComponentCategory>('INSERT INTO component_categories(id,name) VALUES ($1,$2) RETURNING id,name,enabled,revision', [id, name])).rows[0]!;
      await audit(sql, context.principal.subject, 'CATEGORY_CREATED', id, { name, revision: category.revision }, context.requestId);
      return category;
    });
  }
  async update(id: string, input: unknown, context: RequestContext): Promise<ComponentCategory> {
    return this.db.transaction(async sql => {
      await this.identity(sql, context, true);
      const parsed = validateUpdateComponentCategory(input);
      if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
      if (!validateCreateComponentCategory({ id, name: parsed.value.name }).ok) throw new PlatformError('INVALID_SCHEMA');
      const prior = (await sql.query<ComponentCategory>('SELECT id,name,enabled,revision FROM component_categories WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!prior) throw new PlatformError('NOT_FOUND');
      if (prior.revision !== parsed.value.expectedRevision) throw new PlatformError('CONFLICT');
      const category = (await sql.query<ComponentCategory>('UPDATE component_categories SET name=$2,enabled=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,name,enabled,revision', [id, parsed.value.name, parsed.value.enabled])).rows[0]!;
      await audit(sql, context.principal.subject, 'CATEGORY_UPDATED', id, { before: prior, after: category }, context.requestId);
      return category;
    });
  }
  async publishingOptions(context: RequestContext): Promise<PublishingOptionsResponse> {
    return this.db.transaction(async sql => {
      await this.identity(sql, context);
      const categories = (await sql.query<ComponentCategory>('SELECT id,name,enabled,revision FROM component_categories WHERE enabled ORDER BY id')).rows;
      const components = (await sql.query<{ componentId: string; category: string; isPublic: boolean }>('SELECT c.id AS "componentId",c.category,c.public AS "isPublic" FROM components c JOIN component_permissions p ON p.component_id=c.id WHERE p.subject=$1 AND (p.can_publish OR p.can_maintain) ORDER BY c.id', [context.principal.subject])).rows;
      const packages = (await sql.query<{ package_name: string }>('SELECT package_name FROM package_permissions WHERE subject=$1 ORDER BY package_name', [context.principal.subject])).rows.map(row => row.package_name);
      return { categories, components, packages };
    });
  }

  async updateComponentVisibility(componentId: string, input: unknown, context: RequestContext): Promise<ComponentVisibilityResponse> {
    if (!COMPONENT_ID_RE.test(componentId)) throw new PlatformError('INVALID_SCHEMA');
    const parsed = validateUpdateComponentVisibility(input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    return this.db.transaction(async sql => {
      const account = await this.resolveManagedAccount(sql, context);
      const effective = account ? { ...context, principal: { ...context.principal, roles: account.roles } } : context;
      if (!this.isAdministrator(account, context)) {
        await requireCurrentIdentity(sql, effective, 'deprecate');
        await requireComponents(sql, context.principal.subject, [componentId], true);
      }
      const prior = (await sql.query<{ id: string; category: string; public: boolean }>('SELECT id,category,public FROM components WHERE id=$1 FOR UPDATE', [componentId])).rows[0];
      if (!prior) throw new PlatformError('NOT_FOUND');
      const updated = (await sql.query<ComponentVisibilityResponse>('UPDATE components SET public=$2 WHERE id=$1 RETURNING id AS "componentId",category,public AS "isPublic"', [componentId, parsed.value.isPublic])).rows[0]!;
      await audit(sql, context.principal.subject, 'COMPONENT_VISIBILITY_UPDATED', componentId, { before: prior.public, isPublic: parsed.value.isPublic, reason: parsed.value.reason }, context.requestId);
      return updated;
    });
  }

  async componentReleaseHistory(componentId: string, context: RequestContext): Promise<ComponentReleaseHistoryResponse> {
    if (!COMPONENT_ID_RE.test(componentId)) throw new PlatformError('NOT_FOUND', [], true);
    return this.db.transaction(async sql => {
      const account = await this.resolveManagedAccount(sql, context);
      const effective = account ? { ...context, principal: { ...context.principal, roles: account.roles } } : context;
      const admin = this.isAdministrator(account, context);
      if (!admin) {
        await requireCurrentIdentity(sql, effective, 'read');
      }
      const comp = (await sql.query<{ id: string; category: string; public: boolean }>(
        admin
          ? 'SELECT id,category,public FROM components WHERE id=$1'
          : 'SELECT id,category,public FROM components WHERE id=$1 AND catalog_can_read(id,$2)',
        admin ? [componentId] : [componentId, context.principal.subject],
      )).rows[0];
      if (!comp) throw new PlatformError('NOT_FOUND', [], true);
      const rows = (await sql.query<{
        id: string;
        variant_id: string;
        framework: 'vue' | 'react';
        name: string;
        version: string;
        export_name: string;
        availability: 'Ready' | 'DEPRECATED';
        deprecated_reason: string | null;
      }>(
        `SELECT vr.id,vr.variant_id,v.framework,p.name,p.version,vr.metadata->>'exportName' AS export_name,vr.availability,vr.deprecated_reason
           FROM variant_releases vr
           JOIN variants v ON v.id=vr.variant_id
           JOIN package_releases p ON p.id=vr.package_release_id
           JOIN release_jobs j ON j.id=p.job_id
          WHERE v.component_id=$1 AND p.state='READY' AND j.state='READY' AND vr.availability IN ('Ready','DEPRECATED')`,
        [componentId],
      )).rows;
      rows.sort((a, b) => {
        if (a.framework !== b.framework) return a.framework < b.framework ? -1 : 1;
        return compareVersions(b.version, a.version);
      });
      return {
        componentId: comp.id,
        category: comp.category,
        isPublic: comp.public,
        items: rows.map(r => ({
          variantReleaseId: r.id,
          variantId: r.variant_id,
          framework: r.framework,
          packageName: r.name,
          packageVersion: r.version,
          exportName: r.export_name ?? r.variant_id,
          availability: r.availability,
          ...(r.deprecated_reason ? { deprecatedReason: r.deprecated_reason } : {}),
        })),
      };
    });
  }
}

/** Called only inside the new, authorized release registration transaction. */
export async function registerReleaseCategories(sql: Sql, manifest: ReleaseManifestV1): Promise<void> {
  const choices = new Map(manifest.variants.filter(variant => variant.category !== undefined).map(variant => [variant.componentId, variant.category!]));
  const ids = [...new Set(choices.values())].sort();
  if (!ids.length) return;
  // Shared row locks serialize validation with admin rename/disable, across API processes.
  const categories = (await sql.query<ComponentCategory>('SELECT id,name,enabled,revision FROM component_categories WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE', [ids])).rows;
  if (categories.length !== ids.length) throw new PlatformError('REFERENCE_NOT_FOUND');
  if (categories.some(category => !category.enabled)) throw new PlatformError('INVALID_SCHEMA');
  for (const [componentId, category] of [...choices].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    await sql.query('UPDATE components SET category=$2 WHERE id=$1', [componentId, category]);
  }
}
