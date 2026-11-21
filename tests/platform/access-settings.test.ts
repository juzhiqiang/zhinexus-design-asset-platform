import { describe, expect, it } from 'vitest';
import { platformHarness } from './http-support.js';

export const oidcDraft = {
  issuer: 'https://identity.example.com', audience: 'platform-api', webClientId: 'web', cliClientId: 'cli',
  webRedirectUri: 'https://api.example.com/v1/auth/oidc/callback', cliRedirectUri: 'http://127.0.0.1:43129/callback',
  roleClaim: 'groups', roleMapping: { reader: 'read', publisher: 'publish', maintainer: 'maintain' },
};
const options = { galleryOrigin: 'https://gallery.example.com', access: {
  apiOrigin: 'https://api.example.com', administrators: [{ issuer: 'https://issuer.t05.test', subject: 'operator' }],
  outbound: [],
} };

describe('access settings HTTP and PostgreSQL', () => {
  it('authorizes independent deployment administrators before any write', async () => {
    const h = await platformHarness(options);
    try {
      const reader = await h.token('alice', ['maintainer']);
      expect((await h.request('/v1/access-settings', undefined, reader, 'GET')).status).toBe(403);
      const operator = await h.token('operator', ['reader']);
      expect((await h.request('/v1/access-settings', undefined, operator, 'GET')).status).toBe(200);
      expect((await h.request('/v1/access-settings/oidc/draft', { expectedGeneration: '0', expectedRevision: null, config: oidcDraft, actor: 'operator' }, operator)).status).toBe(400);
      expect((await h.request('/v1/access-settings/oidc/draft', { expectedGeneration: '0', expectedRevision: null, config: oidcDraft }, reader)).status).toBe(403);
    } finally { await h.close(); }
  });
  it('persists drafts, rejects stale saves and never activates client asserted evidence', async () => {
    const h = await platformHarness(options);
    try {
      const token = await h.token('operator', ['reader']);
      const save = () => h.request('/v1/access-settings/oidc/draft', { expectedGeneration: '0', expectedRevision: null, config: oidcDraft }, token);
      const results = await Promise.all([save(), save()]);
      expect(results.map(r => r.status).sort()).toEqual([200, 409]);
      const view = await (await h.request('/v1/access-settings', undefined, token, 'GET')).json();
      const revision = view.sections.oidc.draft.id;
      expect((await h.request('/v1/access-settings/oidc/activate', { expectedGeneration: '0', revision }, token)).status).toBe(409);
      expect((await h.request('/v1/access-settings/oidc/validate', { expectedGeneration: '0', revision, checks: { discovery: 'passed' } }, token)).status).toBe(400);
      await h.restart();
      const persisted = await (await h.request('/v1/access-settings', undefined, token, 'GET')).json();
      expect(persisted.sections.oidc.draft.id).toBe(revision);
      expect(persisted.audit).toHaveLength(1);
      expect(JSON.stringify(persisted)).not.toMatch(/Bearer |clientSecret|token_hash/);
      await h.db.query('INSERT INTO disabled_subjects(subject) VALUES ($1)', ['operator']);
      expect((await h.request('/v1/access-settings', undefined, token, 'GET')).status).toBe(403);
    } finally { await h.close(); }
  });
});
