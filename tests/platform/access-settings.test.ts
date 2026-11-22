import { describe, expect, it } from 'vitest';
import { platformHarness } from './http-support.js';
import { makeFixture } from '../fixtures/releases/g1/factory.js';

export const oidcDraft = {
  issuer: 'https://identity.example.com', audience: 'platform-api', webClientId: 'web', cliClientId: 'cli',
  webRedirectUri: 'https://api.example.com/v1/auth/oidc/callback', cliRedirectUri: 'http://127.0.0.1:43129/callback',
  roleClaim: 'groups', roleMapping: { reader: 'read', publisher: 'publish', maintainer: 'maintain' },
};
const options = { galleryOrigin: 'https://gallery.example.com', access: {
  apiOrigin: 'https://api.example.com', administrators: [{ issuer: 'https://issuer.t05.test', subject: 'operator' }],
  outbound: [],
} };

describe('access settings HTTP and PostgreSQL', () => {
  it('rejects stale identity at the upload database commit boundary',async()=>{
    const h=await platformHarness(options);
    try {
      const principal=await h.platform().authenticate('Bearer '+await h.token('operator',['publisher']));
      await h.db.query("UPDATE access_active SET generation=generation+1 WHERE section='oidc'");
      const fixture=makeFixture('cli');
      await expect(h.platform().uploads!.create({manifestDigest:'a'.repeat(64),files:fixture.manifest.files},{principal,requestId:'stale-commit'})).rejects.toMatchObject({code:'UNAUTHENTICATED'});
      expect((await h.db.query('SELECT count(*) FROM upload_sessions')).rows[0]!.count).toBe('0');
    }finally{await h.close();}
  });
  it('keeps expired login evidence expired after network verification and rejects reuse across generations', async () => {
    const h = await platformHarness(options);
    try {
      const { AccessSettingsService } = await import('../../apps/api/dist/access/service.js');
      const service = new AccessSettingsService(h.db, options.access, options.galleryOrigin, async () => ({ discovery:'passed', secret:'passed' }));
      const context = { principal: await h.platform().authenticate('Bearer '+await h.token('operator',['reader'])), requestId:'freshness' };
      const saved = await service.mutate('oidc','draft',{expectedGeneration:'0',expectedRevision:null,config:oidcDraft},context);
      const revision = saved.sections.oidc.draft!.id;
      await service.evidence(revision,'0',{webLogin:'passed',cliLogin:'passed',roles:'passed',adminLogin:'passed'});
      await h.db.query(`UPDATE access_revisions SET checked_at=clock_timestamp()-interval '16 minutes',
        check_evidence=(SELECT jsonb_object_agg(key,value || jsonb_build_object('at',to_char(clock_timestamp()-interval '16 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) FROM jsonb_each(check_evidence)) WHERE id=$1`,[revision]);
      await service.mutate('oidc','validate',{expectedGeneration:'0',revision},context);
      expect((await service.view(context)).sections.oidc.draft?.checks.webLogin).toBe('pending');
      await expect(service.mutate('oidc','activate',{expectedGeneration:'0',revision},context)).rejects.toMatchObject({code:'CONFLICT'});
      await service.evidence(revision,'0',{webLogin:'passed',cliLogin:'passed',roles:'passed',adminLogin:'passed'});
      await service.mutate('oidc','activate',{expectedGeneration:'0',revision},context);
      const nextContext = {...context, principal:{...context.principal,generation:'1'}};
      await expect(service.mutate('oidc','rollback',{expectedGeneration:'1',revision},nextContext)).rejects.toMatchObject({code:'CONFLICT'});
      await service.evidence(revision,'1',{webLogin:'passed',cliLogin:'passed',roles:'passed',adminLogin:'passed'});
      expect((await service.mutate('oidc','rollback',{expectedGeneration:'1',revision},nextContext)).sections.oidc.generation).toBe('2');
      await expect(h.db.query('UPDATE access_revisions SET config=$2 WHERE id=$1',[revision,JSON.stringify({...oidcDraft,audience:'other'})])).rejects.toMatchObject({code:'42501'});
      await expect(h.db.query('DELETE FROM access_audit')).rejects.toMatchObject({code:'42501'});
      await expect(h.db.query('DELETE FROM access_activations')).rejects.toMatchObject({code:'42501'});
    } finally { await h.close(); }
  });
  it('rejects a preview write when administrator authentication changes during its network check', async () => {
    const h = await platformHarness(options);
    try {
      const { AccessSettingsService } = await import('../../apps/api/dist/access/service.js');
      const service = new AccessSettingsService(h.db,options.access,options.galleryOrigin,async () => {
        await h.db.query("UPDATE access_active SET generation=generation+1 WHERE section='oidc'");
        return {dns:'passed',tls:'passed',routing:'passed',gateway:'passed'};
      });
      const context = {principal:await h.platform().authenticate('Bearer '+await h.token('operator',['reader'])),requestId:'switch'};
      const saved = await service.mutate('preview','draft',{expectedGeneration:'0',expectedRevision:null,config:{mode:'domain',previewOrigin:'https://preview.example.net'}},context);
      await expect(service.mutate('preview','validate',{expectedGeneration:'0',revision:saved.sections.preview.draft!.id},context)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
      expect((await h.db.query("SELECT count(*) FROM access_audit WHERE section='preview' AND action='validate'")).rows[0]!.count).toBe('0');
    } finally { await h.close(); }
  });
  it('supports deployment identity binding and revocation without accepting unverified recovery',async()=>{
    const h=await platformHarness(options);
    try{
      const operation=await import('../../apps/api/dist/operations/access-settings.js').catch(()=>({applyAccessOperation:undefined}));
      expect(typeof operation.applyAccessOperation).toBe('function');if(!operation.applyAccessOperation)return;
      const execute=(body:unknown)=>operation.applyAccessOperation!(h.platform(),body,'test-operator');
      await execute({action:'bind',issuer:'https://identity.example.com',identitySubject:'person',platformSubject:'alice'});
      expect((await h.db.query('SELECT platform_subject FROM identity_bindings WHERE identity_subject=$1',['person'])).rows[0]!.platform_subject).toBe('alice');
      await expect(execute({action:'bind',issuer:'https://other-identity.example.com',identitySubject:'another-person',platformSubject:'alice'})).rejects.toMatchObject({code:'23505'});
      await execute({action:'restrict-role',platformSubject:'alice',role:'publisher',denied:true});
      expect((await h.db.query('SELECT role FROM subject_role_restrictions WHERE subject=$1',['alice'])).rows[0]!.role).toBe('publisher');
      await execute({action:'disable',platformSubject:'alice',disabled:true});
      expect((await h.request('/v1/releases/123e4567-e89b-42d3-a456-426614174000',undefined,await h.token('alice',['reader']),'GET')).status).toBe(403);
      const token=await h.token('operator',['reader']);
      const draft=await (await h.request('/v1/access-settings/oidc/draft',{expectedGeneration:'0',expectedRevision:null,config:oidcDraft},token)).json();
      await expect(execute({action:'restore',section:'oidc',expectedGeneration:'0',revision:draft.sections.oidc.draft.id})).rejects.toMatchObject({code:'CONFLICT'});
    }finally{await h.close();}
  });
  it('authorizes independent deployment administrators before any write', async () => {
    const h = await platformHarness(options);
    try {
      const reader = await h.token('alice', ['maintainer']);
      expect((await h.request('/v1/access-settings', undefined, reader, 'GET')).status).toBe(403);
      const operator = await h.token('operator', ['reader']);
      expect((await h.request('/v1/access-settings', undefined, operator, 'GET')).status).toBe(200);
      expect((await h.request('/v1/access-settings/oidc/draft', { expectedGeneration: '0', expectedRevision: null, config: oidcDraft, actor: 'operator' }, operator)).status).toBe(400);
      expect((await h.request('/v1/access-settings/oidc/draft', { expectedGeneration: '0', expectedRevision: null, config: oidcDraft }, reader)).status).toBe(403);
    } finally { await h.close(); }
  });
  it('persists drafts, rejects stale saves and never activates client asserted evidence', async () => {
    const h = await platformHarness(options);
    try {
      const token = await h.token('operator', ['reader']);
      const save = () => h.request('/v1/access-settings/oidc/draft', { expectedGeneration: '0', expectedRevision: null, config: oidcDraft }, token);
      const results = await Promise.all([save(), save()]);
      expect(results.map(r => r.status).sort()).toEqual([200, 409]);
      const view = await (await h.request('/v1/access-settings', undefined, token, 'GET')).json();
      const revision = view.sections.oidc.draft.id;
      expect((await h.request('/v1/access-settings/oidc/activate', { expectedGeneration: '0', revision }, token)).status).toBe(409);
      expect((await h.request('/v1/access-settings/oidc/validate', { expectedGeneration: '0', revision, checks: { discovery: 'passed' } }, token)).status).toBe(400);
      await h.restart();
      const persisted = await (await h.request('/v1/access-settings', undefined, token, 'GET')).json();
      expect(persisted.sections.oidc.draft.id).toBe(revision);
      expect(persisted.audit.filter((entry:{action:string;result:string})=>entry.action==='draft' && entry.result==='passed')).toHaveLength(1);
      expect(persisted.audit.some((entry:{action:string;result:string})=>entry.action==='activate' && entry.result==='failed')).toBe(true);
      expect((await h.request('/v1/access-settings',undefined,await h.token('alice',['maintainer']),'GET')).status).toBe(403);
      expect((await h.db.query("SELECT count(*) FROM audit_events WHERE event='AUTH_DENIED' AND target_id='access-settings'")).rows[0]!.count).not.toBe('0');
      expect(JSON.stringify(persisted)).not.toMatch(/Bearer |clientSecret|token_hash/);
      await h.db.query('INSERT INTO disabled_subjects(subject) VALUES ($1)', ['operator']);
      expect((await h.request('/v1/access-settings', undefined, token, 'GET')).status).toBe(403);
    } finally { await h.close(); }
  });
});
