import { expect,it } from 'vitest';
import { CompanyOidc } from '../../apps/api/dist/access/oidc.js';

it('rejects identity configuration changes during token verification before granting protected access',async()=>{
  let generation='0';
  const settings={options:{outbound:[]},current:async()=>({generation})};
  const fallback={verifyWithClaims:async()=>{
    generation='1';
    return {principal:{issuer:'https://id.example.com',identitySubject:'alice',subject:'alice',clientId:'web',channel:'web',roles:['reader']},claims:{}};
  }};
  const db={query:async()=>({rows:[],rowCount:0})};
  const oidc=new CompanyOidc(db as never,settings as never,fallback as never);
  await expect(oidc.authenticate('Bearer valid-token')).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});

it('still checks the signed self-managed account claims when no identity configuration is activated',async()=>{
  const settings={options:{outbound:[]},current:async()=>({generation:'0'})};
  const fallback={verifyWithClaims:async()=>({principal:{issuer:'https://identity.internal/realms/zhinexus',identitySubject:'member-1',subject:'oidc:member',clientId:'web',channel:'web',roles:['maintainer']},claims:{platform_account_version:'2',auth_time:500,iat:500}})};
  const db={query:async()=>({rows:[],rowCount:0})};
  const claims:Record<string,unknown>={};
  const accounts={
    selfManagedIssuer:'https://identity.internal/realms/zhinexus',
    verifiedAccount:async(_principal:unknown,signed:Record<string,unknown>)=>{
      Object.assign(claims,signed);
      if(signed['platform_account_version']!=='2'||signed['auth_time']!==500)throw new Error('unexpected claims');
      return {platform_subject:'oidc:member',roles:['reader'],version:'2',enabled:true};
    },
  };
  const oidc=new CompanyOidc(db as never,settings as never,fallback as never,undefined,accounts as never);
  await expect(oidc.authenticate('Bearer valid-token')).resolves.toMatchObject({subject:'oidc:member',roles:['reader']});
  expect(claims).toMatchObject({platform_account_version:'2',auth_time:500,iat:500});
});
