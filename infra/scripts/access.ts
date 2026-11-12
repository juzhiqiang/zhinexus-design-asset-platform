import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateAccessConfig, validateOidcMetadata, validateOidcJwks } from './access-config.js';
import { localDir, root } from './local.js';

async function main(): Promise<void> {
  const input = process.env.G2_ACCESS_CONFIG ? resolve(process.env.G2_ACCESS_CONFIG) : join(root, 'infra/access.example.json');
  const config = validateAccessConfig(JSON.parse(readFileSync(input, 'utf8')));
  const results = { oidc: 'unconfigured', preview: 'unconfigured', g2Ready: false };
  if (config.oidc) {
    const issuer = config.oidc.issuer;
    const response = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error('OIDC discovery request failed');
    const metadata = await response.json();
    validateOidcMetadata(metadata, issuer);
    const keys = await fetch(metadata.jwks_uri, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!keys.ok) throw new Error('OIDC JWKS unavailable');
    validateOidcJwks(await keys.json());
    results.oidc = 'metadata-verified; real web/CLI login and client registration still required';
  }
  if (config.preview) {
    for (const origin of Object.values(config.preview)) {
      // Native fetch verifies DNS and TLS. Redirects cannot hide a different origin.
      const response = await fetch(origin, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (response.status >= 500) throw new Error('Preview/platform origin returned a server failure');
    }
    results.preview = 'gallery-api-preview-dns-tls-verified; wildcard certificate, grants and sandbox isolation still required';
  }
  mkdirSync(localDir, { recursive: true });
  writeFileSync(join(localDir, 'access-result.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), ...results }, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  // This command checks access prerequisites only, never the full G2 gate.
  process.exitCode = config.oidc && config.preview ? 0 : 2;
}
main().catch(() => {
  mkdirSync(localDir, { recursive: true });
  writeFileSync(join(localDir, 'access-result.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), status: 'failed', g2Ready: false }, null, 2)}\n`);
  console.error('Access check failed; check non-secret configuration, HTTPS endpoints and metadata.');
  process.exitCode = 1;
});
