import { previewOriginFor } from '@company/contracts/preview';
import type { AccessChecks,PreviewAccessConfig } from '@company/contracts';
import type { Database } from '../db/database.js';
import type { AccessSettingsService } from './service.js';
import { ProbeFailure,RestrictedHttps } from './outbound.js';

export async function probePreview(db:Database,settings:AccessSettingsService,network:RestrictedHttps,config:PreviewAccessConfig):Promise<AccessChecks> {
  const checked=settings.preview(config);
  const ids=(await db.query("SELECT vr.id FROM variant_releases vr JOIN package_releases p ON p.id=vr.package_release_id WHERE vr.availability='Ready' AND p.state='READY' ORDER BY vr.id LIMIT 2")).rows.map(r=>r.id as string);
  if(!ids.length || (config.mode==='domain' && ids.length<2)) return{dns:'pending',tls:'pending',routing:'pending',gateway:'pending'};
  const checks:AccessChecks={dns:'passed',tls:'passed',routing:'passed',gateway:'passed'};
  for(const id of config.mode==='domain' ? ids : ids.slice(0,1)) {
    try {
      const result=await network.json(previewOriginFor(id,checked)+'/access-probe',undefined,{cookie:'access-probe=credential-filter-check',authorization:'Bearer credential-filter-check'});
      if(!settings.options.gatewayId || !result || typeof result!=='object' || !('service' in result) || result.service!=='preview-gateway' || !('deploymentId' in result) || result.deploymentId!==settings.options.gatewayId) {checks.routing='failed';checks.gateway='failed';}
    }catch(error){
      if(error instanceof ProbeFailure && error.step==='dns')checks.dns='failed';
      else if(error instanceof ProbeFailure && error.step==='tls')checks.tls='failed';
      else checks.routing='failed';
      checks.gateway='failed';
    }
  }
  return checks;
}
