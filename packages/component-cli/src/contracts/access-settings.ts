import { choice, object, text, timestamp, validateSchema } from './schema.js';
import type { Schema } from './schema.js';
import type { ValidationResult } from './release-manifest.js';

export type AccessSection = 'oidc' | 'preview';
export const ACCESS_SECTIONS = ['oidc', 'preview'] as const;
export type OidcAccessConfig = {
  issuer: string;
  audience: string;
  webClientId: string;
  cliClientId: string;
  webRedirectUri: string;
  cliRedirectUri: string;
  roleClaim: string;
  roleMapping: { reader: string; publisher: string; maintainer: string };
  secretRef?: string;
  scopes?: string[];
};
export type PreviewAccessConfig = { mode: 'domain' | 'ip-port'; previewOrigin: string };
export type AccessConfig<K extends AccessSection> = { oidc: OidcAccessConfig; preview: PreviewAccessConfig }[K];
export const ACCESS_CHECKS = {
  oidc: ['discovery', 'secret', 'webLogin', 'cliLogin', 'roles', 'revocation', 'adminLogin'],
  preview: ['dns', 'tls', 'routing', 'gateway'],
} as const;
export type AccessCheck = (typeof ACCESS_CHECKS)[AccessSection][number];
export type AccessChecks = Partial<Record<AccessCheck, 'passed' | 'failed' | 'pending'>>;
export type AccessRevision<K extends AccessSection> = {
  id: string; config: AccessConfig<K>; createdAt: string; checkedAt?: string; checks: AccessChecks;activated?:boolean;
};
export type AccessSectionView<K extends AccessSection> = {
  generation: string; active?: AccessRevision<K>; draft?: AccessRevision<K>; history: AccessRevision<K>[];
  gatewayGeneration?: string;
};
export type AccessAuditEntry = {
  section: AccessSection; action: 'draft' | 'validate' | 'activate' | 'rollback'; revision: string; actor: string; at: string;
  checks?: AccessChecks; result?: 'passed' | 'failed'; generation?: string;
};
export type AccessSettingsView = {
  sections: { [K in AccessSection]: AccessSectionView<K> }; audit: AccessAuditEntry[];
};
export type OidcCliMetadata = {
  issuer: string; audience: string; clientId: string; redirectUri: string; authorizationEndpoint: string; tokenEndpoint: string; scopes: string[]; generation:string;
  passwordLoginEndpoint?: string; browserAuthorizationEndpoint?: string;
};
export type AccessMutation = {
  expectedGeneration: string; expectedRevision?: string | null; config?: OidcAccessConfig | PreviewAccessConfig; revision?: string;
};
export type AccessAction = 'draft' | 'validate' | 'activate' | 'rollback';
export type AuthSessionView = { authenticated: boolean; administrator: boolean; subject?: string; roles?: string[] };
export type OidcCandidateStart = {revision:string};
export type OidcCandidateTicket = {ticket:string};
export const validateOidcCandidateStart = (input:unknown):ValidationResult<OidcCandidateStart> => validateSchema(object({revision:{...text,pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'}}),input);
export const validateOidcCandidateTicket = (input:unknown):ValidationResult<OidcCandidateTicket> => validateSchema(object({ticket:{...text,pattern:'^[A-Za-z0-9_-]{43}$'}}),input);

const identifier: Schema = { ...text, maxLength: 256, pattern: '^[^\\s\\u0000-\\u001f\\u007f]+$' };
const schemas: Record<AccessSection, Schema> = {
  oidc: object({
    issuer: identifier, audience: identifier, webClientId: identifier, cliClientId: identifier,
    webRedirectUri: identifier, cliRedirectUri: identifier,
    roleClaim: { ...identifier, pattern: '^[A-Za-z0-9_:.\/-]+$' },
    roleMapping: object({ reader: text, publisher: text, maintainer: text }),
    secretRef: { ...identifier, pattern: '^[A-Z][A-Z0-9_]{0,63}$' },
    scopes: { type: 'array', items: { ...identifier, pattern: '^[\\x21\\x23-\\x5b\\x5d-\\x7e]+$' } },
  }, ['secretRef', 'scopes']),
  preview: object({ mode: choice('domain', 'ip-port'), previewOrigin: identifier }),
};

export function validateAccessConfig<K extends AccessSection>(section: K, input: unknown): ValidationResult<AccessConfig<K>> {
  const result = validateSchema<AccessConfig<K>>(schemas[section], input);
  if (!result.ok) return result;
  const issue = (path: string): ValidationResult<AccessConfig<K>> => ({ ok: false, issues: [{ code: 'INVALID_SCHEMA', path, message: 'Invalid access configuration' }] });
  const parsed: OidcAccessConfig | PreviewAccessConfig = result.value;
  if ('previewOrigin' in parsed) {
    const url = parseEndpoint(parsed.previewOrigin);
    if (!url || url.protocol !== 'https:' || url.origin !== parsed.previewOrigin) return issue('/previewOrigin');
    const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (parsed.mode === 'ip-port' ? !ipv4 || !url.port : ipv4 || url.hostname.startsWith('[')) return issue('/previewOrigin');
  } else {
    const config = parsed;
    const issuer = parseEndpoint(config.issuer);
    if (!issuer || issuer.protocol !== 'https:') return issue('/issuer');
    const web = parseEndpoint(config.webRedirectUri);
    if (!web || web.protocol !== 'https:' || web.pathname !== '/v1/auth/oidc/callback') return issue('/webRedirectUri');
    const cli = parseEndpoint(config.cliRedirectUri);
    if (!cli || cli.protocol !== 'http:' || cli.hostname !== '127.0.0.1' || Number(cli.port) < 1024 || cli.pathname === '/') return issue('/cliRedirectUri');
    if (config.webClientId === config.cliClientId) return issue('/cliClientId');
    if (config.scopes && (config.scopes.length > 10 || new Set(config.scopes).size !== config.scopes.length || config.scopes.some(scope => scope === 'openid' || scope === 'offline_access'))) return issue('/scopes');
    if (new Set(Object.values(config.roleMapping)).size !== 3 || Object.values(config.roleMapping).some(value =>
      value.length > 256 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value))) return issue('/roleMapping');
  }
  return result;
}

export function validateAccessMutation(section: AccessSection, action: AccessAction, input: unknown): ValidationResult<AccessMutation> {
  const generation: Schema = { ...text, pattern: '^(0|[1-9][0-9]{0,17})$' };
  const revision: Schema = { ...text, pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };
  const shape = action === 'draft'
    ? object({ expectedGeneration: generation, expectedRevision: input && typeof input === 'object' && 'expectedRevision' in input && input.expectedRevision === null ? { type: 'null' } : revision, config: schemas[section] })
    : object({ expectedGeneration: generation, revision });
  const parsed = validateSchema<AccessMutation>(shape, input);
  if (!parsed.ok || action !== 'draft') return parsed;
  const config = validateAccessConfig(section, parsed.value.config);
  return config.ok ? parsed : config;
}

function parseEndpoint(value: string): URL | undefined {
  if (/[\\?#]/u.test(value)) return;
  try {
    const url = new URL(value);
    if (!url.username && !url.password && url.hostname && (url.href === value || url.href === value + '/')) return url;
  } catch { /* Reject ambiguous or malformed endpoints. */ }
}
export function validateOidcCliMetadata(input:unknown): ValidationResult<OidcCliMetadata> {
  const parsed = validateSchema<OidcCliMetadata>(object({issuer:identifier,audience:identifier,clientId:identifier,redirectUri:identifier,authorizationEndpoint:identifier,tokenEndpoint:identifier,passwordLoginEndpoint:identifier,browserAuthorizationEndpoint:identifier,scopes:{type:'array',items:identifier},generation:{...identifier,pattern:'^(0|[1-9][0-9]{0,17})$'}},['passwordLoginEndpoint','browserAuthorizationEndpoint']),input);
  if (!parsed.ok) return parsed;
  const value = parsed.value, cli = parseEndpoint(value.redirectUri);
  const endpoints = [value.issuer,value.authorizationEndpoint,value.tokenEndpoint,value.passwordLoginEndpoint,value.browserAuthorizationEndpoint].filter((endpoint): endpoint is string => endpoint !== undefined);
  if (!cli || cli.protocol !== 'http:' || cli.hostname !== '127.0.0.1' || Number(cli.port)<1024 || cli.pathname === '/' || !endpoints.every(endpoint => ['http:','https:'].includes(parseEndpoint(endpoint)?.protocol ?? ''))) {
    return {ok:false,issues:[{code:'INVALID_SCHEMA',path:'',message:'Invalid company CLI endpoints'}]};
  }
  return parsed;
}
export function validateAccessSettingsView(input:unknown):ValidationResult<AccessSettingsView> {
  const generation:Schema={...text,pattern:'^(0|[1-9][0-9]{0,17})$'};
  const checks=object(Object.fromEntries([...ACCESS_CHECKS.oidc,...ACCESS_CHECKS.preview].map(key=>[key,choice('passed','failed','pending')])),[...ACCESS_CHECKS.oidc,...ACCESS_CHECKS.preview]);
  const revision=(section:AccessSection)=>object({id:identifier,config:schemas[section],createdAt:timestamp,checkedAt:timestamp,checks,activated:{type:'boolean'}},['checkedAt','activated']);
  const section=(key:AccessSection)=>object({generation,active:revision(key),draft:revision(key),history:{type:'array',items:revision(key)},gatewayGeneration:generation},['active','draft','gatewayGeneration']);
  return validateSchema(object({sections:object({oidc:section('oidc'),preview:section('preview')}),audit:{type:'array',items:object({section:choice('oidc','preview'),action:choice('draft','validate','activate','rollback'),revision:identifier,actor:text,at:timestamp,checks,result:choice('passed','failed'),generation},['checks','result','generation'])}}),input);
}
