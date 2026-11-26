import type { ComponentMatchQueryV1, ComponentMatchResponseV1 } from '@company/contracts';
import { componentApiFixture, matchPlanFixture } from './match-plan.js';

/** Synthetic protocol fixture; not a business design sample or compatibility evidence. */
export function componentMatchQueryFixture(framework: 'vue' | 'react' = 'vue'): ComponentMatchQueryV1 {
  return {
    componentId: 'line', framework, packageVersion: '0.0.12',
    frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1', echartsVersion: '6.1.0',
    ...(framework === 'react' ? { reactDomVersion: '19.3.1' } : {}),
  };
}

export function componentMatchResponseFixture(framework: 'vue' | 'react' = 'vue'): ComponentMatchResponseV1 {
  const query = componentMatchQueryFixture(framework);
  const target = { ...matchPlanFixture().elements[0]!.target, framework,
    variantId: `line-${framework}`, packageName: `@company/charts-${framework}`, packageVersion: query.packageVersion };
  return {
    schemaVersion: 1, query, status: 'matched', target, api: componentApiFixture(framework),
    exactDependencies: [
      { name: target.packageName, version: target.packageVersion },
      { name: framework, version: query.frameworkVersion },
      ...(query.echartsVersion ? [{ name: 'echarts', version: query.echartsVersion }] : []),
      ...(framework === 'react' ? [{ name: 'react-dom', version: query.reactDomVersion! }] : []),
    ],
    gaps: [{ code: 'COMPATIBILITY_UNVERIFIED', message: 'Synthetic fixture has no accepted compatibility evidence' }],
  };
}

export function componentMatchGapFixture(framework: 'vue' | 'react' = 'vue'): ComponentMatchResponseV1 {
  return { schemaVersion: 1, query: componentMatchQueryFixture(framework), status: 'gap', exactDependencies: [],
    gaps: [{ code: 'TARGET_UNAVAILABLE', message: 'Target unavailable' }] };
}
