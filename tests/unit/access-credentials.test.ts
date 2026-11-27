import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect,it,vi } from 'vitest';
import { resolvePlatformToken } from '../../packages/component-cli/src/local/credentials.js';
import { executeStatusCommand } from '../../packages/component-cli/src/local/release.js';

it('uses a saved login only for its exact API origin, with expiry and explicit credential precedence',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zh-cli-session-')),file=join(dir,'session.local');
  const token=(expiration:number)=>'header.'+Buffer.from(JSON.stringify({exp:expiration})).toString('base64url')+'.signature';
  const saved=token(Math.floor(Date.now()/1000)+7200);
  try {
    for(const key of ['ZHINEXUS_API_TOKEN','PLATFORM_TOKEN','PLATFORM_API_TOKEN','ZHINEXUS_TOKEN'])vi.stubEnv(key,'');
    vi.stubEnv('ZHINEXUS_CREDENTIAL_FILE',file);
    await writeFile(file,JSON.stringify({apiOrigin:'https://api.example.com',accessToken:saved}));
    expect(await resolvePlatformToken('https://api.example.com')).toBe(saved);
    expect(await resolvePlatformToken('https://other.example.com')).toBeUndefined();
    expect(await resolvePlatformToken('https://api.example.com','explicit')).toBe('explicit');
    vi.stubEnv('ZHINEXUS_API_TOKEN','environment');
    expect(await resolvePlatformToken('https://api.example.com')).toBe('environment');
    vi.stubEnv('ZHINEXUS_API_TOKEN','');
    const fetcher=vi.fn(async (_url:string,init:RequestInit)=>{
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer '+saved);
      expect(init.redirect).toBe('error');
      return new Response('{}',{status:401});
    });
    vi.stubGlobal('fetch',fetcher);
    expect(await executeStatusCommand({jobId:'123e4567-e89b-42d3-a456-426614174000',apiUrl:'https://api.example.com'})).toMatchObject({ok:false});
    expect(fetcher).toHaveBeenCalledTimes(1);
    await writeFile(file,JSON.stringify({apiOrigin:'https://api.example.com',accessToken:token(1)}));
    expect(await resolvePlatformToken('https://api.example.com')).toBeUndefined();
  }finally{vi.unstubAllEnvs();vi.unstubAllGlobals();await rm(dir,{recursive:true,force:true});}
});
