import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateAccessMutation,type AccessSection } from '@company/contracts';
import { Platform,environmentOptions } from '../platform.js';
import { PlatformError } from '../errors.js';
import { audit } from '../db/access.js';

/** Deployment-only command: never registered as an HTTP endpoint. */
export async function applyAccessOperation(platform:Platform,input:unknown,operator:string):Promise<{applied:true}> {
  if(!platform.db || !platform.access || !/^[A-Za-z0-9_.-]{1,128}$/.test(operator))throw new PlatformError('FORBIDDEN');
  if(!input || typeof input!=='object' || Array.isArray(input) || !('action' in input))throw new PlatformError('INVALID_SCHEMA');
  const body=input as Record<string,unknown>;
  const identifier=(value:unknown):value is string=>typeof value==='string' && value.length>0 && value.length<512 && !/[\u0000-\u001f\u007f]/u.test(value);
  const keys=(expected:string[])=>Object.keys(body).sort().join(',')===expected.sort().join(',');
  if(body.action==='restore'){
    if(!keys(['action','section','expectedGeneration','revision']) || !['oidc','preview'].includes(String(body.section)))throw new PlatformError('INVALID_SCHEMA');
    const section=body.section as AccessSection;
    const parsed=validateAccessMutation(section,'rollback',{expectedGeneration:body.expectedGeneration,revision:body.revision});
    if(!parsed.ok)throw new PlatformError('INVALID_SCHEMA');
    const administrator=platform.access.options.administrators[0];
    if(!administrator)throw new PlatformError('FORBIDDEN');
    await platform.access.mutate(section,'rollback',parsed.value,{principal:{issuer:administrator.issuer,identitySubject:administrator.subject,subject:administrator.subject,clientId:'deployment-ops',channel:'cli',roles:[]},requestId:randomUUID(),operator});
    return{applied:true};
  }
  await platform.db.transaction(async sql=>{
    if(body.action==='bind'){
      if(!keys(['action','issuer','identitySubject','platformSubject']) || !identifier(body.issuer) || !identifier(body.identitySubject) || !identifier(body.platformSubject))throw new PlatformError('INVALID_SCHEMA');
      const url=new URL(body.issuer);if(url.protocol!=='https:' || url.username || url.password || url.hash || url.search)throw new PlatformError('INVALID_SCHEMA');
      await sql.query('INSERT INTO identity_bindings(issuer,identity_subject,platform_subject) VALUES ($1,$2,$3)',[body.issuer,body.identitySubject,body.platformSubject]);
    }else if(body.action==='restrict-role'){
      if(!keys(['action','platformSubject','role','denied']) || !identifier(body.platformSubject) || !['reader','publisher','maintainer'].includes(String(body.role)) || typeof body.denied!=='boolean')throw new PlatformError('INVALID_SCHEMA');
      if(body.denied)await sql.query('INSERT INTO subject_role_restrictions(subject,role) VALUES ($1,$2) ON CONFLICT DO NOTHING',[body.platformSubject,body.role]);
      else await sql.query('DELETE FROM subject_role_restrictions WHERE subject=$1 AND role=$2',[body.platformSubject,body.role]);
    }else if(body.action==='disable'){
      if(!keys(['action','platformSubject','disabled']) || !identifier(body.platformSubject) || typeof body.disabled!=='boolean')throw new PlatformError('INVALID_SCHEMA');
      if(body.disabled)await sql.query('INSERT INTO disabled_subjects(subject) VALUES ($1) ON CONFLICT DO NOTHING',[body.platformSubject]);
      else await sql.query('DELETE FROM disabled_subjects WHERE subject=$1',[body.platformSubject]);
    }else throw new PlatformError('INVALID_SCHEMA');
    await audit(sql,'deployment:'+operator,'ACCESS_OPERATION',String(body.action),{platformSubject:body.platformSubject});
  });
  return{applied:true};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let platform:Platform | undefined;
  try{
    if(process.argv.length!==4 || process.argv[2]!=='--file' || !process.env.PLATFORM_ACCESS_OPERATOR)throw new Error();
    platform=new Platform(environmentOptions());
    const input:unknown=JSON.parse(await readFile(resolve(process.argv[3]!),'utf8'));
    console.log(JSON.stringify(await applyAccessOperation(platform,input,process.env.PLATFORM_ACCESS_OPERATOR)));
  }catch{console.error('Deployment access operation failed. Check operator, input, revision and validation.');process.exitCode=1;}
  finally{await platform?.onApplicationShutdown();}
}
