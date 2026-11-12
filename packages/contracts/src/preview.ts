import { getDomain } from 'tldts';
import { artifactPath, validateSchema } from './schema.js';

export function isArtifactPath(path: unknown): path is string { return validateSchema<string>(artifactPath, path).ok; }

/** Deployment configuration, never inferred from a request Host or forwarding header. */
export type PreviewConfig = { platformOrigin: string; apiOrigin: string; previewOrigin: string };
export function validatePreviewConfig(input: PreviewConfig): PreviewConfig {
  const origins = [input.platformOrigin, input.apiOrigin, input.previewOrigin].map(value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      value !== url.origin || !/^[a-z0-9.-]+$/.test(url.hostname)) throw new Error('Invalid preview origins');
    return url;
  });
  const domains = origins.map(url => getDomain(url.hostname, { allowPrivateDomains: false }));
  if (domains.some(domain => !domain) || domains[0] === domains[2] || domains[1] === domains[2]) throw new Error('Preview requires a separate registered domain');
  return { ...input };
}
export function previewOriginFor(id: string, config: PreviewConfig): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid preview release');
  const url = new URL(config.previewOrigin);
  url.hostname = `r-${id}.${url.hostname}`;
  return url.origin;
}
