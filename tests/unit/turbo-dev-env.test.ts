import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const turbo = JSON.parse(readFileSync(new URL('../../turbo.json', import.meta.url), 'utf8'));

it('passes platform runtime configuration to the API development task', () => {
  expect(turbo.tasks['@company/platform-api#dev']?.passThroughEnv).toContain('PLATFORM_*');
});
