import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { validatePreviewConfig } from '@company/contracts/preview';
import { retentionPolicy } from '../apps/api/dist/operations/retention.js';

const pinned = (value: unknown) => typeof value==='string' && /^(?:[a-zA-Z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/.test(value);
const parameter = (value: unknown) => typeof value==='string' && /^\$\{[A-Z][A-Z0-9_]*:\?[^}]+\}$/.test(value);
const commands: Record<string,string[]> = {api:['node','dist/server.js'],worker:['node','dist/releases/runner.js'],'preview-gateway':['node','dist/server.js']};
export function validateDeployment(input: unknown, env?: Record<string,string|undefined>): string[] {
  const errors: string[] = []; const config = input as {services?:Record<string,any>;networks?:Record<string,any>};
  if (!config?.services) return ['services are required'];
  const expected = ['api','worker','preview-gateway','postgres','verdaccio','minio'];
  if (Object.keys(config.services).sort().join()!==expected.sort().join()) errors.push('Unexpected service topology');
  for (const [name,s] of Object.entries(config.services)) {
    if (!pinned(s.image) && !(parameter(s.image) && /_IMAGE:/.test(s.image))) errors.push(`${name}: immutable image required`);
    if (s.ports?.length || s.privileged || s.network_mode==='host' || s.build || s.entrypoint) errors.push(`${name}: unsafe exposure or execution`);
    if (name in commands && (s.read_only!==true || !s.cap_drop?.includes('ALL') || !s.security_opt?.includes('no-new-privileges:true') ||
      JSON.stringify(s.command)!==JSON.stringify(commands[name]))) errors.push(`${name}: unsafe runtime`);
    for (const [key,value] of Object.entries(s.environment??{})) {
      if (/(?:DATABASE_URL|SECRET_KEY|ACCESS_KEY|TOKEN)$/.test(key) && !parameter(value)) errors.push(`${name}: credential must be injected`);
    }
  }
  if (config.networks?.backend?.internal!==true || config.networks?.edge?.external!==true) errors.push('Explicit isolated backend and managed TLS edge required');
  if (env) {
    const raw = JSON.stringify(config);
    for (const match of raw.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?[^}]+\}/g)) if (!env[match[1]!]) errors.push(`Missing ${match[1]}`);
    for (const key of ['PLATFORM_API_IMAGE','PLATFORM_PREVIEW_IMAGE','PLATFORM_MINIO_IMAGE']) if (!pinned(env[key])) errors.push(`Invalid ${key} digest`);
    for (const key of ['PLATFORM_S3_ENDPOINT','PLATFORM_REGISTRY_ORIGIN','PLATFORM_OIDC_ISSUER','PLATFORM_OIDC_JWKS_URI']) {
      try { const u=new URL(env[key]??''); if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash) throw new Error(); }
      catch {errors.push(`Invalid ${key} HTTPS configuration`);}
    }
    try {validatePreviewConfig({previewOrigin:env.PLATFORM_PREVIEW_ORIGIN??'',platformOrigin:env.PLATFORM_GALLERY_ORIGIN??'',apiOrigin:env.PLATFORM_API_ORIGIN??''});}
    catch {errors.push('Invalid independent preview domain configuration');}
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.PLATFORM_METRICS_TOKEN??'')) errors.push('Invalid metrics token');
    if (env.PLATFORM_DATABASE_URL===env.PREVIEW_DATABASE_URL || env.PLATFORM_S3_ACCESS_KEY===env.PREVIEW_S3_ACCESS_KEY) errors.push('Preview requires a separate limited identity');
    try {retentionPolicy(env);} catch {errors.push('Invalid retention policy');}
  }
  return [...new Set(errors)];
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const errors = validateDeployment(parse(await readFile(new URL('../infra/compose.production.yaml',import.meta.url),'utf8'),{merge:true}),process.argv.includes('--environment')?process.env:undefined);
    if (errors.length) {for(const error of errors) console.error(error);process.exitCode=1;}
    else console.log(JSON.stringify({templateValidated:true,environmentValidated:process.argv.includes('--environment'),productionAcceptance:false}));
  } catch {console.error('Deployment verification failed');process.exitCode=1;}
}
