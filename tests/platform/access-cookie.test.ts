import { expect,it } from 'vitest';
import { platformHarness } from './http-support.js';

it('audits cross-origin Cookie writes without recording the supplied credential',async()=>{
  const h=await platformHarness({galleryOrigin:'https://gallery.example.com'});
  try {
    const response=await h.request('/v1/auth/oidc/logout',undefined,undefined,'POST',{cookie:'__Host-platform='+'a'.repeat(43),origin:'https://untrusted.example.com'});
    expect(response.status).toBe(403);
    const rows=(await h.db.query("SELECT target_id,data FROM audit_events WHERE event='AUTH_DENIED'")).rows;
    expect(rows).toEqual([{target_id:'oidc-csrf',data:{code:'FORBIDDEN'}}]);
    expect(JSON.stringify(rows)).not.toContain('a'.repeat(43));
  }finally{await h.close();}
});
