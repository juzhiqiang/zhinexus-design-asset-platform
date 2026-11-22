import { expect,it } from 'vitest';
import { Platform } from '../../apps/api/dist/platform.js';

it('rejects malformed deployment administration, outbound rules and unbound Web callbacks at startup',()=>{
  const valid = {apiOrigin:'https://api.example.com',administrators:[{issuer:'https://id.example.com',subject:'admin'}],outbound:[{hostname:'id.example.com',port:443,networks:['192.0.2.0/24']}]};
  for (const access of [
    {...valid,administrators:{}}, {...valid,administrators:[{issuer:'https://id.example.com',subject:'admin',secret:'hidden'}]},
    {...valid,outbound:[{hostname:'*',port:443,networks:['192.0.2.0/24']}]},
    {...valid,outbound:[{hostname:'id.example.com',port:0,networks:['192.0.2.0/24']}]},
    {...valid,outbound:[{hostname:'id.example.com',port:443,networks:['192.0.2.0/999']}]},
    {...valid,initialOidc:{issuer:'https://id.example.com',audience:'api',webClientId:'web',cliClientId:'cli',webRedirectUri:'https://other.example.com/v1/auth/oidc/callback',cliRedirectUri:'http://127.0.0.1:43129/callback',roleClaim:'roles',roleMapping:{reader:'read',publisher:'publish',maintainer:'maintain'}}},
  ]) expect(()=>new Platform({access:access as never})).toThrow();
  expect(()=>new Platform({access:valid})).not.toThrow();
});
