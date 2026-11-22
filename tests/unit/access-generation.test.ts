import { expect,it } from 'vitest';
import { CompanyOidc } from '../../apps/api/dist/access/oidc.js';

it('rejects identity configuration changes during token verification before granting protected access',async()=>{
  let generation='0';
  const settings={options:{outbound:[]},current:async()=>({generation})};
  const fallback={verify:async()=>{
    generation='1';
    return {issuer:'https://id.example.com',identitySubject:'alice',subject:'alice',clientId:'web',channel:'web',roles:['reader']};
  }};
  const db={query:async()=>({rows:[],rowCount:0})};
  const oidc=new CompanyOidc(db as never,settings as never,fallback as never);
  await expect(oidc.authenticate('Bearer valid-token')).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
