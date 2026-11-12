import { AuthFailure } from './oidc.js';
import type { Principal } from './oidc.js';

export function requireRole(principal: Principal, action: 'read' | 'upload' | 'baseline' | 'deprecate'): void {
  const allowed = action === 'read' ? ['reader', 'publisher', 'maintainer']
    : action === 'upload' ? ['publisher', 'maintainer']
      : action === 'baseline' || action === 'deprecate' ? ['maintainer'] : [];
  if (!principal.roles.some(role => allowed.includes(role))) throw new AuthFailure('FORBIDDEN');
}
