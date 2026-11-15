import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { makeFixture } from '../fixtures/releases/g1/factory.js';

test('contracts validate the same frozen fixture and Web Crypto digest in Chromium', async ({ page }) => {
  const origin = 'https://contracts.example.test';
  const modules = new Set(['index', 'api', 'errors', 'schema', 'schemas', 'validation', 'digests', 'bundle', 'project-context', 'search', 'design-id', 'component-api', 'match-plan']);
  await page.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Contract runtime verification</title>' });
    const module = /^\/([a-z-]+)\.js$/.exec(path)?.[1];
    if (!module || !modules.has(module)) return route.abort();
    const body = await readFile(new URL(`../../packages/contracts/dist/${module}.js`, import.meta.url), 'utf8');
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  await page.goto(`${origin}/`);
  const fixture = makeFixture('cli');
  const result = await page.evaluate(async ({ manifest, entries, moduleUrl }) => {
    const contracts = await import(moduleUrl);
    const files = new Map(entries.map(([path, bytes]) => [path, new Uint8Array(bytes)]));
    const result = await contracts.validateReleaseBundle(manifest, files);
    const hash = await contracts.sha256(new TextEncoder().encode('hello'));
    const designInput = {
      schemaVersion: 1,
      mapping: { schemaVersion: 1, ruleSetId: 'draft', revision: '1', entries: [] },
      elements: [{ instanceId: '__proto__', designId: '未配置:图表/1' }],
    };
    const designResult = contracts.validateDesignIdInput(designInput);
    designInput.elements.push({ ...designInput.elements[0]! });
    const duplicateResult = contracts.validateDesignIdInput(designInput);
    return { result, hash, designOk: designResult.ok, duplicateResult };
  }, { manifest: fixture.manifest, entries: [...fixture.files].map(([path, bytes]): [string, number[]] => [path, [...bytes]]), moduleUrl: `${origin}/index.js` });
  expect(result.result).toEqual({ ok: true, value: fixture.manifest });
  expect(result.hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  expect(result.designOk).toBe(true);
  expect(result.duplicateResult).toMatchObject({ ok: false, issues: [{ code: 'DUPLICATE_ID', path: '/elements/1/instanceId' }] });
});
