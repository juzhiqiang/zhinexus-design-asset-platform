import { describe, expect, it } from 'vitest';
import * as access from '../../packages/contracts/src/access-settings.js';
const { validateAccessConfig } = access;

const identity = {
  issuer: 'https://id.example.com/tenant', audience: 'platform-api', webClientId: 'web', cliClientId: 'cli',
  webRedirectUri: 'https://api.example.com/v1/auth/oidc/callback', cliRedirectUri: 'http://127.0.0.1:43129/callback',
  roleClaim: 'groups', roleMapping: { reader: 'read', publisher: 'publish', maintainer: 'maintain' },
  secretRef: 'CORP',
};

describe('access settings contracts', () => {
  it('accepts only exact candidate revision requests and opaque tickets',()=>{
    const revision='123e4567-e89b-42d3-a456-426614174000';
    expect(access.validateOidcCandidateStart({revision}).ok).toBe(true);
    expect(access.validateOidcCandidateStart({revision,subject:'operator'}).ok).toBe(false);
    expect(access.validateOidcCandidateStart({revision:'bad'}).ok).toBe(false);
    expect(access.validateOidcCandidateTicket({ticket:'a'.repeat(43)}).ok).toBe(true);
    for(const input of [{ticket:'https://other.example.com'},{ticket:'a'.repeat(43),url:'https://other.example.com'},{ticket:['a'.repeat(43)]}])expect(access.validateOidcCandidateTicket(input).ok).toBe(false);
  });
  it('accepts independent OIDC and preview configuration', () => {
    expect(validateAccessConfig('oidc', identity).ok).toBe(true);
    expect(validateAccessConfig('preview', { mode: 'ip-port', previewOrigin: 'https://192.0.2.5:8443' }).ok).toBe(true);
  });
  it('rejects secrets, credential-bearing endpoints, ambiguous clients and non-loopback native redirects', () => {
    for (const patch of [
      { clientSecret: 'not-a-reference' }, { secretRef: 'env:PLATFORM_DATABASE_URL' }, { issuer: 'https://a@id.example.com' },
      { cliRedirectUri: 'http://localhost:43129/callback' }, { cliRedirectUri: 'http://127.0.0.1/callback' },
      { cliClientId: 'web' }, { webRedirectUri: 'https://api.example.com/other' },
    ]) expect(validateAccessConfig('oidc', { ...identity, ...patch }).ok).toBe(false);
    expect(validateAccessConfig('preview', { mode: 'domain', previewOrigin: 'https://preview.example.net/some/path' }).ok).toBe(false);
  });
  it('requires exact optimistic versions and rejects extra mutation fields', () => {
    const validate = access.validateAccessMutation;
    expect(typeof validate).toBe('function');
    const request = { expectedGeneration: '0', expectedRevision: null, config: identity };
    expect(validate('oidc', 'draft', request).ok).toBe(true);
    for (const patch of [{ actor: 'admin' }, { expectedGeneration: 0 }, { expectedGeneration: '01' }, { expectedRevision: 'bad' }]) {
      expect(validate('oidc', 'draft', { ...request, ...patch }).ok).toBe(false);
    }
    expect(validate('oidc', 'activate', { expectedGeneration: '1', revision: '123e4567-e89b-42d3-a456-426614174000' }).ok).toBe(true);
    expect(validate('oidc', 'activate', { expectedGeneration: '1', revision: '123e4567-e89b-42d3-a456-426614174000', checks: { webLogin: 'passed' } }).ok).toBe(false);
  });
  it('rejects a preview address inconsistent with its isolation mode', () => {
    expect(validateAccessConfig('preview', { mode: 'domain', previewOrigin: 'https://192.0.2.5:8443' }).ok).toBe(false);
    expect(validateAccessConfig('preview', { mode: 'ip-port', previewOrigin: 'https://preview.example.net:8443' }).ok).toBe(false);
    expect(validateAccessConfig('preview', { mode: 'ip-port', previewOrigin: 'https://192.0.2.5' }).ok).toBe(false);
  });
  it('validates CLI discovery without accepting arbitrary native redirects or token endpoints', () => {
    const validate = access.validateOidcCliMetadata;
    expect(typeof validate).toBe('function');
    if (!validate) return;
    const value = {issuer:identity.issuer,audience:identity.audience,clientId:'cli',redirectUri:identity.cliRedirectUri,authorizationEndpoint:identity.issuer+'/authorize',tokenEndpoint:identity.issuer+'/token',scopes:[],generation:'0'};
    expect(validate(value).ok).toBe(true);
    expect(validate({...value,tokenEndpoint:'http://id.example.com/token'}).ok).toBe(true);
    expect(validate({...value,passwordLoginEndpoint:'http://id.example.com/login',browserAuthorizationEndpoint:'http://admin.example.com/login'}).ok).toBe(true);
    expect(validate({...value,tokenEndpoint:'file:///secret'}).ok).toBe(false);
    expect(validate({...value,passwordLoginEndpoint:'https://user:secret@id.example.com/login'}).ok).toBe(false);
    expect(validate({...value,redirectUri:'http://127.0.0.1:43129/'}).ok).toBe(false);
  });
  it('validates settings responses before exposing them to the administrator',()=>{
    const validate=access.validateAccessSettingsView;
    expect(typeof validate).toBe('function');if(!validate)return;
    const value={sections:{oidc:{generation:'0',history:[]},preview:{generation:'0',history:[]}},audit:[]};
    expect(validate(value).ok).toBe(true);
    expect(validate({...value,token:'secret'}).ok).toBe(false);
    expect(validate({...value,sections:{...value.sections,preview:{generation:0,history:[]}}}).ok).toBe(false);
  });
});
