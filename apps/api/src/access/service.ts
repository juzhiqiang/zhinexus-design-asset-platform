import { randomUUID } from 'node:crypto';
import { ACCESS_SECTIONS, validateAccessMutation, type AccessAction, type AccessChecks, type AccessConfig, type AccessRevision, type AccessSection, type AccessSettingsView } from '@company/contracts';
import { validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';
import type { Database } from '../db/database.js';
import type { Sql, RequestContext } from '../db/access.js';
import { PlatformError } from '../errors.js';

export type Administrator = { issuer: string; subject: string };
export type OutboundRule = { hostname: string; port: number; networks: string[] };
export type AccessOptions = { apiOrigin: string; administrators: Administrator[]; outbound: OutboundRule[]; ca?: string; initialOidc?: AccessConfig<'oidc'> };
export type AccessProbe = <K extends AccessSection>(section: K, config: AccessConfig<K>) => Promise<AccessChecks>;
type ActiveRow = { section: AccessSection; generation: string; active_revision_id: string | null; draft_revision_id: string | null; gateway_generation: string | null };
type RevisionRow = { id: string; section: AccessSection; config: AccessConfig<AccessSection>; checks: AccessChecks; created_at: Date; checked_at: Date | null };
const revisionView = (row: RevisionRow) => ({ id: row.id, config: row.config, checks: row.checks, createdAt: row.created_at.toISOString(), ...(row.checked_at ? { checkedAt: row.checked_at.toISOString() } : {}) });

export class AccessSettingsService {
  constructor(private readonly db: Database, readonly options: AccessOptions, private readonly galleryOrigin?: string, private readonly probe?: AccessProbe) {}
  administrator(context: RequestContext): void {
    const principal = context.principal;
    if (!this.options.administrators.some(a => a.issuer === principal.issuer && a.subject === (principal.identitySubject ?? principal.subject))) throw new PlatformError('FORBIDDEN');
  }
  async current<K extends AccessSection>(section: K, sql: Sql = this.db, lock = false): Promise<{ generation: string; revision?: AccessRevision<K> }> {
    const row = (await sql.query<ActiveRow>(`SELECT * FROM access_active WHERE section=$1${lock ? ' FOR SHARE' : ''}`, [section])).rows[0];
    if (!row) throw new PlatformError('INFRA_UNAVAILABLE');
    const revision = row.active_revision_id ? (await sql.query<RevisionRow>('SELECT * FROM access_revisions WHERE id=$1', [row.active_revision_id])).rows[0] : undefined;
    return { generation: row.generation, ...(revision ? { revision: revisionView(revision) as AccessRevision<K> } : {}) };
  }
  preview(config: AccessConfig<'preview'>): PreviewConfig {
    try { return validatePreviewConfig({ ...config, platformOrigin: this.galleryOrigin ?? '', apiOrigin: this.options.apiOrigin }); }
    catch { throw new PlatformError('INVALID_SCHEMA'); }
  }
  async view(context: RequestContext): Promise<AccessSettingsView> {
    this.administrator(context);
    return this.db.transaction(async sql => {
      const sections = {} as AccessSettingsView['sections'];
      for (const section of ACCESS_SECTIONS) {
        const state = (await sql.query<ActiveRow>('SELECT * FROM access_active WHERE section=$1 FOR SHARE', [section])).rows[0]!;
        const revisions = (await sql.query<RevisionRow>('SELECT * FROM access_revisions WHERE section=$1 ORDER BY created_at DESC LIMIT 100', [section])).rows;
        const active = revisions.find(r => r.id === state.active_revision_id);
        const draft = revisions.find(r => r.id === state.draft_revision_id);
        // Active and draft remain visible even after 100 later revisions.
        const find = async (id: string | null, row?: RevisionRow) => row ?? (id ? (await sql.query<RevisionRow>('SELECT * FROM access_revisions WHERE id=$1', [id])).rows[0] : undefined);
        const activeRow = await find(state.active_revision_id, active), draftRow = await find(state.draft_revision_id, draft);
        const value = { generation: state.generation, history: revisions.map(revisionView), ...(activeRow ? { active: revisionView(activeRow) } : {}), ...(draftRow ? { draft: revisionView(draftRow) } : {}), ...(state.gateway_generation ? { gatewayGeneration: state.gateway_generation } : {}) };
        Object.assign(sections, { [section]: value });
      }
      const audit = (await sql.query('SELECT section,action,revision,actor,result,generation,checks,at FROM access_audit ORDER BY id DESC LIMIT 100')).rows.map(r => ({ ...r, at: r.at.toISOString() }));
      return { sections, audit } as AccessSettingsView;
    });
  }
  async mutate(section: AccessSection, action: AccessAction, input: unknown, context: RequestContext): Promise<AccessSettingsView> {
    this.administrator(context);
    const parsed = validateAccessMutation(section, action, input);
    if (!parsed.ok) throw new PlatformError('INVALID_SCHEMA', parsed.issues);
    const body = parsed.value;
    if (section === 'preview' && body.config) this.preview(body.config as AccessConfig<'preview'>);
    let checks: AccessChecks | undefined;
    if (action === 'validate' || action === 'rollback') {
      const state = await this.current(section);
      if (state.generation !== body.expectedGeneration) throw new PlatformError('CONFLICT');
      const row = (await this.db.query<RevisionRow>('SELECT * FROM access_revisions WHERE id=$1 AND section=$2', [body.revision, section])).rows[0];
      if (!row) throw new PlatformError('NOT_FOUND');
      checks = this.probe ? await this.probe(section, row.config) : {};
    }
    await this.db.transaction(async sql => {
      const state = (await sql.query<ActiveRow>('SELECT * FROM access_active WHERE section=$1 FOR UPDATE', [section])).rows[0]!;
      if (state.generation !== body.expectedGeneration) throw new PlatformError('CONFLICT');
      // Recheck deployment administration and live subject restrictions before committing.
      this.administrator(context);
      if ((await sql.query('SELECT 1 FROM disabled_subjects WHERE subject=$1', [context.principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
      let revision = body.revision ?? randomUUID();
      if (action === 'draft') {
        if (state.draft_revision_id !== body.expectedRevision) throw new PlatformError('CONFLICT');
        await sql.query('INSERT INTO access_revisions(id,section,config) VALUES ($1,$2,$3)', [revision, section, JSON.stringify(body.config)]);
        await sql.query('UPDATE access_active SET draft_revision_id=$2 WHERE section=$1', [section, revision]);
      } else {
        const row = (await sql.query<RevisionRow>('SELECT * FROM access_revisions WHERE id=$1 AND section=$2 FOR UPDATE', [revision, section])).rows[0];
        if (!row) throw new PlatformError('NOT_FOUND');
        if (action !== 'rollback' && state.draft_revision_id !== revision) throw new PlatformError('CONFLICT');
        if (action === 'rollback' && !(await sql.query('SELECT 1 FROM access_activations WHERE section=$1 AND revision=$2', [section, revision])).rowCount) throw new PlatformError('CONFLICT');
        if (checks) {
          // Network checks cannot assert actual login or company revocation evidence.
          checks = { ...row.checks, ...checks };
          await sql.query('UPDATE access_revisions SET checks=$2,checked_at=clock_timestamp() WHERE id=$1', [revision, JSON.stringify(checks)]);
        }
        if (action === 'activate' || action === 'rollback') {
          const evidence = checks ?? row.checks;
          const required = section === 'oidc' ? ['discovery','secret','webLogin','cliLogin','roles','adminLogin'] : ['dns','tls','routing','gateway'];
          if (!required.every(k => evidence[k as keyof AccessChecks] === 'passed') || !row.checked_at || Date.now() - row.checked_at.getTime() > 15 * 60_000) throw new PlatformError('CONFLICT');
          await sql.query('UPDATE access_active SET active_revision_id=$2,generation=generation+1,gateway_generation=NULL WHERE section=$1', [section, revision]);
          await sql.query('INSERT INTO access_activations(section,generation,revision) SELECT section,generation,$2 FROM access_active WHERE section=$1', [section, revision]);
        }
      }
      await sql.query(`INSERT INTO access_audit(section,action,revision,actor,result,generation,checks)
        SELECT $1,$2,$3,$4,$5,generation,$6 FROM access_active WHERE section=$1`, [section, action, revision, `${context.principal.issuer}:${context.principal.identitySubject ?? context.principal.subject}`, checks && Object.values(checks).includes('failed') ? 'failed' : 'passed', JSON.stringify(checks ?? {})]);
    });
    return this.view(context);
  }
}
