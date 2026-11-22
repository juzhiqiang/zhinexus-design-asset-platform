import { getDomain } from 'tldts';
import { artifactPath, validateSchema } from './schema.js';

export function isArtifactPath(path: unknown): path is string { return validateSchema<string>(artifactPath, path).ok; }

/** Deployment configuration, never inferred from a request Host or forwarding header. */
export type PreviewConfig = { mode?: 'domain' | 'ip-port'; platformOrigin: string; apiOrigin: string; previewOrigin: string };
export function validatePreviewConfig(input: PreviewConfig): PreviewConfig {
  if (input.mode !== undefined && input.mode !== 'domain' && input.mode !== 'ip-port') throw new Error('Invalid preview mode');
  const origin = (value: string) => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      value !== url.origin || !/^[a-z0-9.-]+$/.test(url.hostname)) throw new Error('Invalid preview origins');
    return url;
  };
  const origins = [origin(input.platformOrigin), origin(input.apiOrigin), origin(input.previewOrigin)] as const;
  const [platform, api, preview] = origins;
  if (input.mode === 'ip-port') {
    // URL and the canonical origin check above normalize and validate numeric hosts first.
    if (!preview.port || !/^\d+\.\d+\.\d+\.\d+$/.test(preview.hostname) || platform.hostname !== preview.hostname || api.hostname !== preview.hostname ||
        platform.port === preview.port || api.port === preview.port) throw new Error('IP preview requires a distinct HTTPS port on the same IPv4 address');
    return { ...input };
  }
  const domains = origins.map(url => getDomain(url.hostname, { allowPrivateDomains: false }));
  if (!domains[2] || domains[0] === domains[2] || domains[1] === domains[2] || origins[0].hostname === preview.hostname || origins[1].hostname === preview.hostname) throw new Error('Preview requires a separate registered domain');
  return { ...input };
}

export function previewConfigFromEnv(env: Record<string, string | undefined>): PreviewConfig | undefined {
  const mode = env.PLATFORM_PREVIEW_MODE || undefined;
  if (mode !== undefined && mode !== 'domain' && mode !== 'ip-port') throw new Error('Invalid PLATFORM_PREVIEW_MODE');
  if (!env.PLATFORM_PREVIEW_ORIGIN && mode !== 'ip-port') return undefined;
  return validatePreviewConfig({
    ...(mode ? { mode } : {}),
    platformOrigin: env.PLATFORM_GALLERY_ORIGIN ?? '',
    apiOrigin: env.PLATFORM_API_ORIGIN ?? '',
    previewOrigin: env.PLATFORM_PREVIEW_ORIGIN ?? '',
  });
}

export function previewOriginFor(id: string, config: PreviewConfig): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid preview release');
  if (config.mode === 'ip-port') return config.previewOrigin;
  const url = new URL(config.previewOrigin);
  url.hostname = `r-${id}.${url.hostname}`;
  return url.origin;
}
