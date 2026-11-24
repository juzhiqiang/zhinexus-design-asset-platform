import { randomUUID } from 'node:crypto';
import { ACCESS_SECTIONS, validateAccessMutation, validateAccessConfig, type AccessAction, type AccessChecks, type AccessConfig, type AccessRevision, type AccessSection, type AccessSettingsView } from '@company/contracts';
import { BlockList,isIP } from 'node:net';
import { validatePreviewConfig, type PreviewConfig } from '@company/contracts/preview';
import type { Database } from '../db/database.js';
import type { Sql, RequestContext } from '../db/access.js';
import { PlatformError } from '../errors.js';

export type Administrator = { issuer: string; subject: string };
export type OutboundRule = { hostname: string; port: number; networks: string[] };
export type AccessOptions = { apiOrigin: string; administrators: Administrator[]; outbound: OutboundRule[]; ca?: string; initialOidc?: AccessConfig<'oidc'>;gatewayId?:string };
export type AccessProbe = <K extends AccessSection>(section: K, config: AccessConfig<K>) => Promise<AccessChecks>;
export function validateAccessOptions(options: AccessOptions): void {
  const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const identifier = (value:unknown):value is string => typeof value === 'string' && value.length>0 && value.length<=256 && !/[\s\u0000-\u001f\u007f]/u.test(value);
  const https = (value:unknown):value is string => {
    if (!identifier(value)) return false;
    try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password && !url.search && !url.hash && !/[\\]/u.test(value); } catch {return false;}
  };
  try {
    if (!record(options) || Object.keys(options).some(key=>!['apiOrigin','administrators','outbound','ca','initialOidc','gatewayId'].includes(key)) || !https(options.apiOrigin) || new URL(options.apiOrigin).origin!==options.apiOrigin) throw new Error();
    if (!Array.isArray(options.administrators) || !options.administrators.length || options.administrators.length>128 || options.administrators.some(admin=>!record(admin) || Object.keys(admin).sort().join(',')!=='issuer,subject' || !https(admin.issuer) || !identifier(admin.subject))) throw new Error();
    if (!Array.isArray(options.outbound) || options.outbound.length>64) throw new Error();
    for (const rule of options.outbound) {
      if (!record(rule) || Object.keys(rule).sort().join(',')!=='hostname,networks,port' || !identifier(rule.hostname) || !Number.isInteger(rule.port) || rule.port<1 || rule.port>65535 || !Array.isArray(rule.networks) || !rule.networks.length || rule.networks.length>64) throw new Error();
      const host=rule.hostname.startsWith('*.') ? rule.hostname.slice(2) : rule.hostname;
      const url=new URL('https://'+host);
      if (url.hostname!==host || url.host!==host || host.includes('*') || (!isIP(host) && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(host)) || (rule.hostname.startsWith('*.') && (!host.includes('.') || isIP(host)))) throw new Error();
      const list=new BlockList();
      for (const network of rule.networks) {
        if (typeof network!=='string' || !/^[-:a-fA-F0-9.]+(?:\/[0-9]{1,3})?$/u.test(network)) throw new Error();
        const [address,prefix]=network.split('/'), family=isIP(address!)===4 ? 'ipv4' : isIP(address!)===6 ? 'ipv6' : undefined;
        if (!family) throw new Error();
        if (prefix===undefined) list.addAddress(address!,family); else list.addSubnet(address!,Number(prefix),family);
      }
    }
    if (options.ca!==undefined && (typeof options.ca!=='string' || !options.ca.includes('-----BEGIN CERTIFICATE-----'))) throw new Error();
    if (options.gatewayId!==undefined && !identifier(options.gatewayId)) throw new Error();
    if (options.initialOidc && (!validateAccessConfig('oidc',options.initialOidc).ok || options.initialOidc.webRedirectUri!==options.apiOrigin+'/v1/auth/oidc/callback')) throw new Error();
  } catch { throw new PlatformError('INVALID_SCHEMA'); }
}
type ActiveRow = { section: AccessSection; generation: string; active_revision_id: string | null; draft_revision_id: string | null; gateway_generation: string | null };
type CheckEvidence = Partial<Record<keyof AccessChecks, { at: string; generation: string }>>;
type RevisionRow = { id: string; section: AccessSection; config: AccessConfig<AccessSection>; checks: AccessChecks; check_evidence: CheckEvidence; created_at: Date; checked_at: Date | null;activated?:boolean };
const evidenceTimes = (checks: AccessChecks, generation: string): CheckEvidence => Object.fromEntries(Object.keys(checks).map(key => [key, {at:new Date().toISOString(),generation}]));
const revisionView = (row: RevisionRow,generation?:string) => {
  const checks={...row.checks};
  if (generation!==undefined) for (const key of Object.keys(checks) as (keyof AccessChecks)[]) {
    const evidence=row.check_evidence[key],age=evidence ? Date.now()-Date.parse(evidence.at) : NaN;
    if (checks[key]==='passed' && (evidence?.generation!==generation || !Number.isFinite(age) || age<0 || age>15*60_000)) checks[key]='pending';
  }
  return { id:row.id,config:row.config,checks,createdAt:row.created_at.toISOString(),...(row.checked_at ? {checkedAt:row.checked_at.toISOString()} : {}),...(row.activated!==undefined ? {activated:row.activated} : {}) };
};

export class AccessSettingsService {
  constructor(private readonly db: Database, readonly options: AccessOptions, readonly galleryOrigin?: string, private readonly probe?: AccessProbe, readonly adminOrigin = 'http://127.0.0.1:5177') {}
  async evidence(revision:string, generation:string, checks:AccessChecks): Promise<void> {
    await this.db.transaction(async sql => {
      const state = (await sql.query<ActiveRow>("SELECT * FROM access_active WHERE section='oidc' FOR UPDATE")).rows[0]!;
      if (state.generation !== generation || (state.draft_revision_id !== revision && !(await sql.query("SELECT 1 FROM access_activations WHERE section='oidc' AND revision=$1",[revision])).rowCount)) throw new PlatformError('CONFLICT');
      await sql.query('UPDATE access_revisions SET checks=checks || $2::jsonb,check_evidence=check_evidence || $3::jsonb,checked_at=clock_timestamp() WHERE id=$1',[revision,JSON.stringify(checks),JSON.stringify(evidenceTimes(checks,generation))]);
    });
  }
  administrator(context: RequestContext): void {
    if(context.operator && context.principal.clientId==='deployment-ops')return;
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
        const revisions = (await sql.query<RevisionRow>('SELECT r.*,EXISTS(SELECT 1 FROM access_activations a WHERE a.revision=r.id) AS activated FROM access_revisions r WHERE section=$1 ORDER BY created_at DESC LIMIT 100', [section])).rows;
        const active = revisions.find(r => r.id === state.active_revision_id);
        const draft = revisions.find(r => r.id === state.draft_revision_id);
        // Active and draft remain visible even after 100 later revisions.
        const find = async (id: string | null, row?: RevisionRow) => row ?? (id ? (await sql.query<RevisionRow>('SELECT * FROM access_revisions WHERE id=$1', [id])).rows[0] : undefined);
        const activeRow = await find(state.active_revision_id, active), draftRow = await find(state.draft_revision_id, draft);
        const value = { generation: state.generation, history: revisions.map(row=>revisionView(row,state.generation)), ...(activeRow ? { active: revisionView(activeRow,state.generation) } : {}), ...(draftRow ? { draft: revisionView(draftRow,state.generation) } : {}), ...(state.gateway_generation ? { gatewayGeneration: state.gateway_generation } : {}) };
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
    if (section === 'oidc' && body.config && (body.config as AccessConfig<'oidc'>).webRedirectUri !== this.options.apiOrigin+'/v1/auth/oidc/callback') throw new PlatformError('INVALID_SCHEMA');
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
      // Lock in the same section order as the preview gateway to avoid deadlocks.
      const identity = (await sql.query<ActiveRow>(`SELECT * FROM access_active WHERE section='oidc' ${section === 'oidc' ? 'FOR UPDATE' : 'FOR SHARE'}`)).rows[0]!;
      if (!context.operator && context.principal.generation !== identity.generation) throw new PlatformError('UNAUTHENTICATED');
      const state = (await sql.query<ActiveRow>('SELECT * FROM access_active WHERE section=$1 FOR UPDATE', [section])).rows[0]!;
      if (state.generation !== body.expectedGeneration) throw new PlatformError('CONFLICT');
      // Recheck deployment administration and live subject restrictions before committing.
      this.administrator(context);
      if (!context.operator && (await sql.query('SELECT 1 FROM disabled_subjects WHERE subject=$1', [context.principal.subject])).rowCount) throw new PlatformError('FORBIDDEN');
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
        let times = row.check_evidence;
        if (checks) {
          // Network checks cannot assert actual login or company revocation evidence.
          const networkChecks = Object.fromEntries(Object.entries(checks).filter(([key]) => (section === 'oidc' ? ['discovery','secret'] : ['dns','tls','routing','gateway']).includes(key))) as AccessChecks;
          times = {...times,...evidenceTimes(networkChecks,state.generation)};
          checks = { ...row.checks, ...networkChecks };
          await sql.query('UPDATE access_revisions SET checks=$2,check_evidence=$3,checked_at=clock_timestamp() WHERE id=$1', [revision, JSON.stringify(checks),JSON.stringify(times)]);
        }
        if (action === 'activate' || action === 'rollback') {
          const evidence = checks ?? row.checks;
          const required = section === 'oidc' ? ['discovery','secret','webLogin','cliLogin','roles','adminLogin'] : ['dns','tls','routing','gateway'];
          if (!required.every(k => {
            const key = k as keyof AccessChecks, time = times[key];
            const age = time ? Date.now()-Date.parse(time.at) : NaN;
            return evidence[key] === 'passed' && time?.generation === state.generation && age >= 0 && age <= 15*60_000;
          })) throw new PlatformError('CONFLICT');
          await sql.query('UPDATE access_active SET active_revision_id=$2,generation=generation+1,gateway_generation=NULL WHERE section=$1', [section, revision]);
          await sql.query('INSERT INTO access_activations(section,generation,revision) SELECT section,generation,$2 FROM access_active WHERE section=$1', [section, revision]);
        }
      }
      await sql.query(`INSERT INTO access_audit(section,action,revision,actor,result,generation,checks)
        SELECT $1,$2,$3,$4,$5,generation,$6 FROM access_active WHERE section=$1`, [section, action, revision, context.operator ? 'deployment:'+context.operator : `${context.principal.issuer}:${context.principal.identitySubject ?? context.principal.subject}`, checks && Object.values(checks).includes('failed') ? 'failed' : 'passed', JSON.stringify(checks ?? {})]);
    }).catch(async error => {
      if (body.revision && error instanceof PlatformError && ['CONFLICT','NOT_FOUND'].includes(error.code)) {
        await this.db.query(`INSERT INTO access_audit(section,action,revision,actor,result,generation,checks)
          SELECT $1,$2,$3,$4,'failed',generation,'{}' FROM access_active WHERE section=$1`,[section,action,body.revision,context.operator ? 'deployment:'+context.operator : `${context.principal.issuer}:${context.principal.identitySubject ?? context.principal.subject}`]).catch(()=>{});
      }
      throw error;
    });
    if (section === 'preview' && (action === 'activate' || action === 'rollback') && this.probe) {
      const active = await this.current('preview');
      // Best effort acknowledgement; the view keeps an unavailable gateway pending.
      if (active.revision) await this.probe('preview',active.revision.config).catch(() => ({}));
    }
    return this.view(context);
  }
}
