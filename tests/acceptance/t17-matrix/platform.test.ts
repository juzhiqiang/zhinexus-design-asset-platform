import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentApiV1 } from '@company/contracts';
import { validIntegrationPlanFixture } from '../../fixtures/integration-plan.js';
import { componentApiFixture } from '../../fixtures/match-plan.js';
import { T17_REFUSAL_SCENARIOS, T17_TOOLCHAIN } from '../../fixtures/t17-matrix/scenarios.js';
import { positiveScenarioForRefusal } from './product-executor.js';
import { buildMatchPlan, type LoadedBundle, type MatchPlanRequest } from './platform.js';
import type { MatrixEnv } from './env.js';

afterEach(() => vi.unstubAllGlobals());
const env = { apiBase: 'http://127.0.0.1:41001', apiToken: 'synthetic-test-token' } as MatrixEnv;
const variantId = '00000000-0000-4000-8000-000000000001';
function bundleFor(readApi?: LoadedBundle['readApi']): LoadedBundle {
  return {
    manifest: {} as LoadedBundle['manifest'], manifestSha256: 'a'.repeat(64),
    variants: [{ componentId: 'line', framework: 'vue', variantReleaseId: variantId }],
    sha256Of: async () => 'b'.repeat(64),
    readApi: readApi ?? (async () => componentApiFixture() as ComponentApiV1),
  };
}
function budgetScenario() {
  return positiveScenarioForRefusal(T17_REFUSAL_SCENARIOS.find(item => item.caseId === 'N10')!);
}

describe('T17 MatchPlan request instance and mapping boundaries', () => {
  it('maps three real budget instances through one identical design target without losing bindings', async () => {
    let request: MatchPlanRequest | undefined;
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      request = JSON.parse(String(init.body)) as MatchPlanRequest;
      const entries = request.design.mapping.entries;
      if (new Set(entries.map(entry => entry.designId + '/' + entry.framework)).size !== entries.length) {
        return new Response('{}', { status: 400 });
      }
      const fixture = validIntegrationPlanFixture().sourceMatchPlan;
      const plan = { ...fixture, context: request.context,
        elements: request.design.elements.map(element => ({ ...structuredClone(fixture.elements[0]!), ...element })) };
      return new Response(JSON.stringify(plan), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const scenario = budgetScenario();
    const actual = await buildMatchPlan(env, bundleFor(), scenario, T17_TOOLCHAIN);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(request!.design.mapping.entries).toEqual([{ designId: 'matrix/line', framework: 'vue', variantReleaseId: variantId }]);
    expect(request!.design.elements.map(element => element.instanceId)).toEqual(['budget-1', 'budget-2', 'budget-3']);
    expect(request!.bindings.map(binding => binding.instanceId)).toEqual(['budget-1', 'budget-2', 'budget-3']);
    expect(actual.plan.elements).toHaveLength(3);
    expect([...actual.apis.keys()]).toEqual(['budget-1', 'budget-2', 'budget-3']);
  });

  it('rejects inconsistent targets for the same design mapping before sending an ambiguous request', async () => {
    let reads = 0;
    const bundle = bundleFor(async () => {
      if (++reads === 2) bundle.variants[0]!.variantReleaseId = '00000000-0000-4000-8000-000000000002';
      return componentApiFixture() as ComponentApiV1;
    });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(buildMatchPlan(env, bundle, budgetScenario(), T17_TOOLCHAIN)).rejects.toThrow(/conflict|冲突/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
