import {
  validateCreateComponentCategory, validateUpdateComponentCategory,
  type ComponentCategory, type ComponentCategoryListResponse, type PublishingOptionsResponse, type ReleaseManifestV1,
} from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit, requireCurrentIdentity, type RequestContext, type Sql } from '../db/access.js';
import type { AccessSettingsService } from '../access/service.js';
import type { Principal } from '../auth/oidc.js';
import { PlatformError } from '../errors.js';

export class CategoryService {
  constructor(private readonly db: Database, private readonly access?: AccessSettingsService, private readonly managedIssuer?: string) {}

  private async identity(sql: Sql, context: RequestContext, administrator = false): Promise<void> {
    const active = (await sql.query("SELECT generation FROM access_active WHERE section='oidc' FOR SHARE")).rows[0];
    if (!active || active.generation !== (context.principal.generation ?? '0')) throw new PlatformError('UNAUTHENTICATED');
    if ((await sql.query('SELECT 1 FROM disabled_subjects WHERE subject=$1', [context.principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
    const account = this.managedIssuer && context.principal.issuer === this.managedIssuer
      ? (await sql.query<{ enabled: boolean; administrator: boolean; roles: Principal['roles'] }>('SELECT enabled,administrator,roles FROM managed_accounts WHERE issuer=$1 AND subject=$2 FOR SHARE', [this.managedIssuer, context.principal.identitySubject ?? context.principal.subject])).rows[0]
      : undefined;
    if (this.managedIssuer === context.principal.issuer && !account) throw new PlatformError('UNAUTHENTICATED');
    if (account && !account.enabled) throw new PlatformError('FORBIDDEN');
    if (administrator) {
      if (account) { if (!account.administrator) throw new PlatformError('FORBIDDEN'); }
      else { if (!this.access) throw new PlatformError('FORBIDDEN'); this.access.administrator(context); }
    } else {
      await requireCurrentIdentity(sql, account ? { ...context, principal: { ...context.principal, roles: account.roles } } : context, 'upload');
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
      const components = (await sql.query<{ componentId: string; category: string }>('SELECT c.id AS "componentId",c.category FROM components c JOIN component_permissions p ON p.component_id=c.id WHERE p.subject=$1 AND (p.can_publish OR p.can_maintain) ORDER BY c.id', [context.principal.subject])).rows;
      const packages = (await sql.query<{ package_name: string }>('SELECT package_name FROM package_permissions WHERE subject=$1 ORDER BY package_name', [context.principal.subject])).rows.map(row => row.package_name);
      return { categories, components, packages };
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
