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
      const step = error instanceof ProbeFailure ? error.step : 'connection';
      const failed:AccessChecks = step === 'dns' ? {dns:'failed',tls:'pending',routing:'pending',gateway:'failed'}
        : step === 'tls' ? {dns:'passed',tls:'failed',routing:'pending',gateway:'failed'}
        : step === 'connection' ? {dns:'passed',tls:'pending',routing:'pending',gateway:'failed'}
        : {dns:'passed',tls:'passed',routing:'failed',gateway:'failed'};
      for (const key of ['dns','tls','routing','gateway'] as const) {
        if (checks[key] !== 'failed' && (failed[key] === 'failed' || failed[key] === 'pending')) checks[key] = failed[key];
      }
    }
  }
  return checks;
}
