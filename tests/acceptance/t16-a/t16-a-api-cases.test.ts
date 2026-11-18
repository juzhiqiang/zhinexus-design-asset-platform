import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateMatchPlan, type MatchPlanV1 } from '@company/contracts';
import {
  assertGeneratedComponentMatchesExpected,
  EXPECTED_FROZEN_MANIFEST_SHA256,
  verifyFrozenSdkManifestReadOnly,
  type ExpectedGeneratedSpec,
  type RejectionRuleCode,
} from './assertions.js';
import { sdkApiAuditMatrix } from './sdk-api-matrix.js';

const REPO_ROOT = process.cwd();

type CasesFixture = {
  schemaVersion: number;
  origin: 'synthetic';
  validCases: Array<{
    caseId: string;
    origin: 'synthetic';
    componentId: ExpectedGeneratedSpec['componentId'];
    framework: 'vue' | 'react';
    matchPlanInput: MatchPlanV1;
    expected: ExpectedGeneratedSpec;
  }>;
  negativeCases: Array<{
    caseId: string;
    reason: string;
    framework: 'vue' | 'react';
    componentId: ExpectedGeneratedSpec['componentId'];
    expectedRejectedRule: RejectionRuleCode;
  }>;
};

function loadCasesFixture(): CasesFixture {
  const raw = readFileSync(
    path.join(REPO_ROOT, 'tests/acceptance/t16-a/security-and-binding-cases.json'),
    'utf8',
  );
  return JSON.parse(raw) as CasesFixture;
}

describe('T16 A/P2 独立 14 实现 API 对照、安全绑定与负例断言', () => {
  it('14 个双框架 SDK 实现的导出、事件、样式、readyMethod 与源码声明一致', () => {
    expect(sdkApiAuditMatrix).toHaveLength(14);

    const vuePkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/charts-vue/package.json'), 'utf8'),
    ) as { version: string; exports: Record<string, unknown> };
    const reactPkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/charts-react/package.json'), 'utf8'),
    ) as { version: string; exports: Record<string, unknown> };
    const corePkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/charts-core/package.json'), 'utf8'),
    ) as { version: string };

    expect(corePkg.version).toBe('0.0.11');
    expect(vuePkg.version).toBe('0.0.12');
    expect(reactPkg.version).toBe('0.0.12');

    for (const entry of sdkApiAuditMatrix) {
      expect(entry.readyMethod).toBe('whenRendered');
      expect(entry.requiredProps.map((p) => p.name)).toEqual(['data']);

      const subpath = `./${entry.componentId}`;
      const pkgExports = entry.framework === 'vue' ? vuePkg.exports : reactPkg.exports;
      expect(pkgExports).toHaveProperty(subpath);
      expect(pkgExports).toHaveProperty('./style.css');

      const srcDir = entry.framework === 'vue' ? 'packages/charts-vue/src' : 'packages/charts-react/src';
      const entrySrc = readFileSync(path.join(REPO_ROOT, srcDir, `${entry.componentId}.ts`), 'utf8');
      const typesSrc = readFileSync(
        path.join(REPO_ROOT, srcDir, `${entry.componentId}-chart.types.ts`),
        'utf8',
      );

      if (entry.framework === 'vue') {
        expect(entrySrc).toMatch(new RegExp(`export\\s*\\{\\s*default\\s+as\\s+${entry.exportName}\\s*\\}`));
        expect(typesSrc).toContain("'point-click': [event: ChartEvent]");
      } else {
        expect(entrySrc).toMatch(new RegExp(`export\\s*\\{\\s*${entry.exportName}\\s*\\}`));
        expect(typesSrc).toContain('onPointClick?: (event: ChartEvent) => void');
      }
      expect(typesSrc).toContain('data: ChartData;');
      expect(typesSrc).toContain('whenRendered: () => Promise<void>;');
    }
  });

  it('安全 JSON 案例对齐 MatchPlanV1（validateMatchPlan 通过）、LineChart source !== handler 且包含危险文本', () => {
    const fixture = loadCasesFixture();
    expect(fixture.origin).toBe('synthetic');
    expect(fixture.validCases.length).toBeGreaterThanOrEqual(4);
    expect(fixture.negativeCases).toHaveLength(8);

    for (const vc of fixture.validCases) {
      const validated = validateMatchPlan(vc.matchPlanInput);
      expect(validated.ok).toBe(true);
      expect(vc.expected.componentId).toBe(vc.componentId);
      expect(vc.expected.framework).toBe(vc.framework);
    }

    const lineCases = fixture.validCases.filter((c) => c.componentId === 'line');
    expect(lineCases.length).toBeGreaterThanOrEqual(2);

    for (const lc of lineCases) {
      const el = lc.matchPlanInput.elements[0]!;
      const source = el.props[0]!.source;
      const handler = el.events[0]!.handler;
      expect(source).not.toBe(handler);
    }

    const allTexts = JSON.stringify(fixture.validCases);
    for (const token of ['__proto__', 'constructor', '</script>', '{{', '${', 'eval(']) {
      expect(allTexts).toContain(token);
    }
  });

  it('合法 SFC / TSX 安全绑定生成物通过断言且不污染原型', () => {
    const fixture = loadCasesFixture();
    const vueLine = fixture.validCases.find((c) => c.caseId === 'vue-line-proto-vs-constructor')!;
    const reactLine = fixture.validCases.find(
      (c) => c.caseId === 'react-line-dangerous-injection-strings',
    )!;

    const validVueSfc = [
      '<script setup lang="ts">',
      "import { LineChart } from '@company/charts-vue/line';",
      "import '@company/charts-vue/style.css';",
      'import { ref } from "vue";',
      'const props = defineProps<{ dataSources: Record<string, any>; handlers: Record<string, any> }>();',
      'const chartRef = ref<{ whenRendered: () => Promise<void> } | null>(null);',
      'const sourceKey = "__proto__";',
      'const handlerKey = "constructor";',
      'defineExpose({ whenRendered: () => chartRef.value?.whenRendered() ?? Promise.resolve() });',
      '</script>',
      '<template>',
      '  <LineChart ref="chartRef" :data="Object.prototype.hasOwnProperty.call(props.dataSources, sourceKey) ? props.dataSources[sourceKey] : undefined" @point-click="(ev) => props.handlers?.[handlerKey]?.(ev)" />',
      '</template>',
    ].join('\n');

    expect(assertGeneratedComponentMatchesExpected(validVueSfc, vueLine.expected)).toEqual({
      ok: true,
    });

    const sourceKeyLiteral = JSON.stringify(reactLine.expected.propBindings[0]!.sourceKey);
    const handlerKeyLiteral = JSON.stringify(reactLine.expected.callbackBindings[0]!.handlerKey);
    const validReactTsx = [
      "import { LineChart } from '@company/charts-react/line';",
      "import '@company/charts-react/style.css';",
      `const SOURCE_KEY = ${sourceKeyLiteral};`,
      `const HANDLER_KEY = ${handlerKeyLiteral};`,
      'export function GeneratedLineChart({ dataSources, handlers }: any) {',
      '  return <LineChart data={dataSources[SOURCE_KEY]} onPointClick={(ev) => handlers?.[HANDLER_KEY]?.(ev)} />;',
      '}',
    ].join('\n');

    expect(assertGeneratedComponentMatchesExpected(validReactTsx, reactLine.expected)).toEqual({
      ok: true,
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('8 类负例（伪导入/跨组件prop/错事件/未渲染/局部遮蔽/无关字面量/后置spread/缺必需绑定）均被拒绝', () => {
    const reactExpected: ExpectedGeneratedSpec = {
      componentId: 'line',
      framework: 'react',
      importSpecifier: '@company/charts-react/line',
      exportName: 'LineChart',
      styleImport: '@company/charts-react/style.css',
      readyMethod: 'whenRendered',
      outputExtension: '.tsx',
      propBindings: [{ prop: 'data', sourceKey: 'sales' }],
      callbackBindings: [{ event: 'onPointClick', templateBinding: 'onPointClick', handlerKey: 'onSelect' }],
      mustRetainAsStringKeys: ['sales', 'onSelect'],
    };

    const vueExpected: ExpectedGeneratedSpec = {
      componentId: 'ranking',
      framework: 'vue',
      importSpecifier: '@company/charts-vue/ranking',
      exportName: 'Ranking',
      styleImport: '@company/charts-vue/style.css',
      readyMethod: 'whenRendered',
      outputExtension: '.vue',
      propBindings: [{ prop: 'data', sourceKey: 'ranks' }],
      callbackBindings: [{ event: 'point-click', templateBinding: '@point-click', handlerKey: 'onPick' }],
      mustRetainAsStringKeys: ['ranks', 'onPick'],
    };

    const negativeSnippets: Array<{
      rule: RejectionRuleCode;
      expected: ExpectedGeneratedSpec;
      code: string;
    }> = [
      {
        rule: 'INVALID_SDK_IMPORT',
        expected: reactExpected,
        code: `
          import { LineChart } from 'evil-fake-sdk/line';
          const k = "sales"; const h = "onSelect";
          export function Bad() { return <LineChart data={{}} onPointClick={() => {}} />; }
        `,
      },
      {
        rule: 'UNKNOWN_OR_FOREIGN_PROP',
        expected: vueExpected,
        code: `
          <script setup lang="ts">
          import { Ranking } from '@company/charts-vue/ranking';
          import '@company/charts-vue/style.css';
          const k = "ranks"; const h = "onPick";
          </script>
          <template><Ranking :data="{}" :xAxisUnit="'ms'" /></template>
        `,
      },
      {
        rule: 'WRONG_EVENT_NAME',
        expected: vueExpected,
        code: `
          <script setup lang="ts">
          import { Ranking } from '@company/charts-vue/ranking';
          import '@company/charts-vue/style.css';
          const k = "ranks"; const h = "onPick";
          </script>
          <template><Ranking :data="{}" @onPointClick="() => {}" /></template>
        `,
      },
      {
        rule: 'COMPONENT_NOT_RENDERED',
        expected: reactExpected,
        code: `
          import { LineChart } from '@company/charts-react/line';
          import '@company/charts-react/style.css';
          const k = "sales"; const h = "onSelect";
          function unusedHelper() { return 1; }
          export function Bad() { return <div />; }
        `,
      },
      {
        rule: 'LOCAL_SYMBOL_SHADOWING',
        expected: reactExpected,
        code: `
          import { LineChart } from '@company/charts-react/line';
          import '@company/charts-react/style.css';
          const k = "sales"; const h = "onSelect";
          export function Bad() {
            const LineChart = () => <div />;
            return <LineChart data={{}} />;
          }
        `,
      },
      {
        rule: 'UNRELATED_STRING_LITERAL_ONLY',
        expected: vueExpected,
        code: `
          <script setup lang="ts">
          const fake = "@company/charts-vue/ranking Ranking ranks onPick";
          </script>
          <template><div>{{ fake }}</div></template>
        `,
      },
      {
        rule: 'TRAILING_SPREAD_OVERRIDE',
        expected: reactExpected,
        code: `
          import { LineChart } from '@company/charts-react/line';
          import '@company/charts-react/style.css';
          const k = "sales"; const h = "onSelect";
          export function Bad(props: any) { return <LineChart data={{}} {...props.extra} />; }
        `,
      },
      {
        rule: 'MISSING_REQUIRED_BINDING',
        expected: vueExpected,
        code: `
          <script setup lang="ts">
          import { Ranking } from '@company/charts-vue/ranking';
          import '@company/charts-vue/style.css';
          const k = "ranks"; const h = "onPick";
          </script>
          <template><Ranking @point-click="() => {}" /></template>
        `,
      },
    ];

    for (const item of negativeSnippets) {
      const res = assertGeneratedComponentMatchesExpected(item.code, item.expected);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.violations.some((v) => v.rule === item.rule)).toBe(true);
      }
    }
  });

  it('审查复核反例与单引号真绑定：拒绝无关常量/无callback、source-handler互换、未调用函数JSX、参数遮蔽，接受合法单引号绑定', () => {
    const reactExpected: ExpectedGeneratedSpec = {
      componentId: 'line',
      framework: 'react',
      importSpecifier: '@company/charts-react/line',
      exportName: 'LineChart',
      styleImport: '@company/charts-react/style.css',
      readyMethod: 'whenRendered',
      outputExtension: '.tsx',
      propBindings: [{ prop: 'data', sourceKey: 'sales' }],
      callbackBindings: [{ event: 'onPointClick', templateBinding: 'onPointClick', handlerKey: 'onSelect' }],
      mustRetainAsStringKeys: ['sales', 'onSelect'],
    };

    const vueExpected: ExpectedGeneratedSpec = {
      componentId: 'line',
      framework: 'vue',
      importSpecifier: '@company/charts-vue/line',
      exportName: 'LineChart',
      styleImport: '@company/charts-vue/style.css',
      readyMethod: 'whenRendered',
      outputExtension: '.vue',
      propBindings: [{ prop: 'data', sourceKey: 'sales' }],
      callbackBindings: [{ event: 'point-click', templateBinding: '@point-click', handlerKey: 'onSelect' }],
      mustRetainAsStringKeys: ['sales', 'onSelect'],
    };

    // 1. 无关常量 + data=[] + 无 callback（React & Vue）
    const reactUnrelatedConst = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      const keys = ['sales', 'onSelect'];
      export function Bad() { return <LineChart data={[]} />; }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactUnrelatedConst, reactExpected).ok).toBe(false);

    const vueUnrelatedConst = `
      <script setup lang="ts">
      import { LineChart } from '@company/charts-vue/line';
      import '@company/charts-vue/style.css';
      const keys = ['sales', 'onSelect'];
      </script>
      <template><LineChart :data="[]" /></template>
    `;
    expect(assertGeneratedComponentMatchesExpected(vueUnrelatedConst, vueExpected).ok).toBe(false);

    // 2. source 与 handler 互换绑定
    const reactSwapped = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      const sourceKey = 'sales';
      const handlerKey = 'onSelect';
      export function Bad({ dataSources, handlers }: any) {
        return <LineChart data={dataSources[handlerKey]} onPointClick={(ev) => handlers?.[sourceKey]?.(ev)} />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactSwapped, reactExpected).ok).toBe(false);

    // 3. SDK JSX 仅在未调用函数中，导出组件未渲染
    const reactUncalledHelper = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      function unusedHelper({ dataSources, handlers }: any) {
        return <LineChart data={dataSources['sales']} onPointClick={(ev) => handlers?.['onSelect']?.(ev)} />;
      }
      export function Bad() { return <div />; }
    `;
    const uncalledRes = assertGeneratedComponentMatchesExpected(reactUncalledHelper, reactExpected);
    expect(uncalledRes.ok).toBe(false);
    if (!uncalledRes.ok) {
      expect(uncalledRes.violations.some((v) => v.rule === 'COMPONENT_NOT_RENDERED')).toBe(true);
    }

    // 4. 导出函数参数遮蔽 LineChart
    const reactParamShadow = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      export function Bad(LineChart: any) {
        return <LineChart data={{ sales: [] }['sales']} onPointClick={() => ({})['onSelect']} />;
      }
    `;
    const shadowRes = assertGeneratedComponentMatchesExpected(reactParamShadow, reactExpected);
    expect(shadowRes.ok).toBe(false);
    if (!shadowRes.ok) {
      expect(shadowRes.violations.some((v) => v.rule === 'LOCAL_SYMBOL_SHADOWING')).toBe(true);
    }

    // 5. 合法单引号真绑定必须通过（React & Vue）
    const validSingleQuoteReact = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      const sourceKey = 'sales';
      const handlerKey = 'onSelect';
      export function Good({ dataSources, handlers }: any) {
        return <LineChart data={dataSources[sourceKey]} onPointClick={(ev) => handlers?.[handlerKey]?.(ev)} />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(validSingleQuoteReact, reactExpected)).toEqual({
      ok: true,
    });

    const validSingleQuoteVue = `
      <script setup lang="ts">
      import { LineChart } from '@company/charts-vue/line';
      import '@company/charts-vue/style.css';
      const props = defineProps<{ dataSources: Record<string, any>; handlers: Record<string, any> }>();
      const sourceKey = 'sales';
      const handlerKey = 'onSelect';
      </script>
      <template>
        <LineChart :data="props.dataSources[sourceKey]" @point-click="(ev) => props.handlers?.[handlerKey]?.(ev)" />
      </template>
    `;
    expect(assertGeneratedComponentMatchesExpected(validSingleQuoteVue, vueExpected)).toEqual({
      ok: true,
    });
  });

  it('第二轮审查反例与合法写法：拒绝假绑定/假渲染/参数遮蔽，接受 export default、cb 变量与真实 import alias', () => {
    const reactExpected: ExpectedGeneratedSpec = {
      componentId: 'line',
      framework: 'react',
      importSpecifier: '@company/charts-react/line',
      exportName: 'LineChart',
      styleImport: '@company/charts-react/style.css',
      readyMethod: 'whenRendered',
      outputExtension: '.tsx',
      propBindings: [{ prop: 'data', sourceKey: 'sales' }],
      callbackBindings: [{ event: 'onPointClick', templateBinding: 'onPointClick', handlerKey: 'onSelect' }],
      mustRetainAsStringKeys: ['sales', 'onSelect'],
    };

    const vueExpected: ExpectedGeneratedSpec = {
      componentId: 'line',
      framework: 'vue',
      importSpecifier: '@company/charts-vue/line',
      exportName: 'LineChart',
      styleImport: '@company/charts-vue/style.css',
      readyMethod: 'whenRendered',
      outputExtension: '.vue',
      propBindings: [{ prop: 'data', sourceKey: 'sales' }],
      callbackBindings: [{ event: 'point-click', templateBinding: '@point-click', handlerKey: 'onSelect' }],
      mustRetainAsStringKeys: ['sales', 'onSelect'],
    };

    // 1a. React sequence expression 丢弃字符串
    const reactSequence = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      export function Bad() {
        return <LineChart data={("sales", [])} onPointClick={() => ("onSelect", undefined)} />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactSequence, reactExpected).ok).toBe(false);

    // 1b. 丢弃语句/内嵌调用返回值
    const reactDiscardedStmt = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      function getData() { 0; "sales"; return []; }
      function getHandler() { "onSelect"; return undefined; }
      export function Bad() {
        return <LineChart data={getData()} onPointClick={getHandler()} />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactDiscardedStmt, reactExpected).ok).toBe(false);

    // 1c. Vue sequence expression
    const vueSequence = `
      <script setup lang="ts">
      import { LineChart } from '@company/charts-vue/line';
      import '@company/charts-vue/style.css';
      </script>
      <template>
        <LineChart :data="('sales', [])" @point-click="() => ('onSelect', undefined)" />
      </template>
    `;
    expect(assertGeneratedComponentMatchesExpected(vueSequence, vueExpected).ok).toBe(false);

    // 2a. 导出函数内 unused 内嵌 function/arrow 的 SDK JSX
    const reactNestedUnused = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      export function Bad({ dataSources, handlers }: any) {
        const dead = () => <LineChart data={dataSources['sales']} onPointClick={(ev) => handlers?.['onSelect']?.(ev)} />;
        return <div />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactNestedUnused, reactExpected).ok).toBe(false);

    // 2b. false 分支与 (JSX, null)
    const reactFalseBranch = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      export function Bad({ dataSources, handlers }: any) {
        return false ? <LineChart data={dataSources['sales']} onPointClick={(ev) => handlers?.['onSelect']?.(ev)} /> : <div />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactFalseBranch, reactExpected).ok).toBe(false);

    const reactSeqNull = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      export function Bad({ dataSources, handlers }: any) {
        return (<LineChart data={dataSources['sales']} onPointClick={(ev) => handlers?.['onSelect']?.(ev)} />, null);
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactSeqNull, reactExpected).ok).toBe(false);

    // 2c. 调用 helper 丢弃返回值
    const reactDiscardedHelper = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      function buildChart({ dataSources, handlers }: any) {
        return <LineChart data={dataSources['sales']} onPointClick={(ev) => handlers?.['onSelect']?.(ev)} />;
      }
      export function Bad(props: any) {
        buildChart(props);
        return <div />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactDiscardedHelper, reactExpected).ok).toBe(false);

    // 2d. Vue v-if="false"
    const vueVIfFalse = `
      <script setup lang="ts">
      import { LineChart } from '@company/charts-vue/line';
      import '@company/charts-vue/style.css';
      const props = defineProps<{ dataSources: Record<string, any>; handlers: Record<string, any> }>();
      </script>
      <template>
        <LineChart v-if="false" :data="props.dataSources['sales']" @point-click="(ev) => props.handlers?.['onSelect']?.(ev)" />
      </template>
    `;
    expect(assertGeneratedComponentMatchesExpected(vueVIfFalse, vueExpected).ok).toBe(false);

    // 3. 顶层 sourceKey/handlerKey 被 renderer 同名参数遮蔽
    const reactParamShadowKeys = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      const sourceKey = 'sales';
      const handlerKey = 'onSelect';
      export function Bad({ dataSources, handlers, sourceKey, handlerKey }: any) {
        return <LineChart data={dataSources[sourceKey]} onPointClick={(ev) => handlers?.[handlerKey]?.(ev)} />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactParamShadowKeys, reactExpected).ok).toBe(false);

    // 4. 无关 function unrelated(LineChart: any) 不得使合法 renderer 误拒
    const reactUnrelatedParamShadow = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      function unrelated(LineChart: any) { return LineChart; }
      export function Good({ dataSources, handlers }: any) {
        return <LineChart data={dataSources['sales']} onPointClick={(ev) => handlers?.['onSelect']?.(ev)} />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactUnrelatedParamShadow, reactExpected)).toEqual({
      ok: true,
    });

    // 5a. const Good = () => SDK JSX; export default Good; + const cb = ...
    const reactExportDefaultAndCb = `
      import { LineChart } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      const Good = ({ dataSources, handlers }: any) => {
        const cb = (ev: any) => handlers?.['onSelect']?.(ev);
        return <LineChart data={dataSources['sales']} onPointClick={cb} />;
      };
      export default Good;
    `;
    expect(assertGeneratedComponentMatchesExpected(reactExportDefaultAndCb, reactExpected)).toEqual({
      ok: true,
    });

    // 5b. 真实 SDK import alias（React & Vue）
    const reactAlias = `
      import { LineChart as MyLine } from '@company/charts-react/line';
      import '@company/charts-react/style.css';
      export function Good({ dataSources, handlers }: any) {
        return <MyLine data={dataSources['sales']} onPointClick={(ev) => handlers?.['onSelect']?.(ev)} />;
      }
    `;
    expect(assertGeneratedComponentMatchesExpected(reactAlias, reactExpected)).toEqual({
      ok: true,
    });

    const vueAlias = `
      <script setup lang="ts">
      import { LineChart as MyLine } from '@company/charts-vue/line';
      import '@company/charts-vue/style.css';
      const props = defineProps<{ dataSources: Record<string, any>; handlers: Record<string, any> }>();
      </script>
      <template>
        <MyLine :data="props.dataSources['sales']" @point-click="(ev) => props.handlers?.['onSelect']?.(ev)" />
      </template>
    `;
    expect(assertGeneratedComponentMatchesExpected(vueAlias, vueExpected)).toEqual({
      ok: true,
    });
  });

  describe('第三轮独立审查：10 类死路径/条件测试/丢弃调用/块作用域/参数遮蔽反例与 1 类不误拒合法例', () => {
    const reactExpected: ExpectedGeneratedSpec = {
      componentId: 'line',
      framework: 'react',
      importSpecifier: '@company/charts-react/line',
      exportName: 'LineChart',
      styleImport: '@company/charts-react/style.css',
      readyMethod: 'whenRendered',
      outputExtension: '.tsx',
      propBindings: [{ prop: 'data', sourceKey: 'sales' }],
      callbackBindings: [{ event: 'onPointClick', templateBinding: 'onPointClick', handlerKey: 'onSelect' }],
      mustRetainAsStringKeys: ['sales', 'onSelect'],
    };

    const vueExpected: ExpectedGeneratedSpec = {
      componentId: 'line',
      framework: 'vue',
      importSpecifier: '@company/charts-vue/line',
      exportName: 'LineChart',
      styleImport: '@company/charts-vue/style.css',
      readyMethod: 'whenRendered',
      outputExtension: '.vue',
      propBindings: [{ prop: 'data', sourceKey: 'sales' }],
      callbackBindings: [{ event: 'point-click', templateBinding: '@point-click', handlerKey: 'onSelect' }],
      mustRetainAsStringKeys: ['sales', 'onSelect'],
    };

    it('1a. 拒绝 return <div/> 之后不可达的第二个 return <LineChart .../>', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        export function Bad({ dataSources, handlers }: any) {
          return <div />;
          return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']} />;
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('1b. 拒绝 helper 中 if(false) return dataSources["sales"]; return [];', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        function getData(dataSources: any) {
          if (false) return dataSources['sales'];
          return [];
        }
        export function Bad({ dataSources, handlers }: any) {
          return <LineChart data={getData(dataSources)} onPointClick={handlers['onSelect']} />;
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('1c. 拒绝 helper 中 return []; return dataSources["sales"];', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        function getData(dataSources: any) {
          return [];
          return dataSources['sales'];
        }
        export function Bad({ dataSources, handlers }: any) {
          return <LineChart data={getData(dataSources)} onPointClick={handlers['onSelect']} />;
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('2a. 拒绝 React 条件测试字符串 data={"sales" ? [] : []} 与 onPointClick={() => "onSelect" ? undefined : undefined}', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        export function Bad() {
          return <LineChart data={'sales' ? [] : []} onPointClick={() => ('onSelect' ? undefined : undefined)} />;
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('2b. 拒绝 Vue 条件测试字符串 :data="\'sales\' ? [] : []" 与 @point-click="() => \'onSelect\' ? undefined : undefined"', () => {
      const code = `
        <script setup lang="ts">
        import { LineChart } from '@company/charts-vue/line';
        import '@company/charts-vue/style.css';
        </script>
        <template>
          <LineChart :data="'sales' ? [] : []" @point-click="() => ('onSelect' ? undefined : undefined)" />
        </template>
      `;
      expect(assertGeneratedComponentMatchesExpected(code, vueExpected).ok).toBe(false);
    });

    it('2c. 拒绝丢弃参数 data={((x)=>[])("sales")} 与 onPointClick={((x)=>undefined)("onSelect")}', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        export function Bad() {
          return <LineChart data={((_x: any) => [])('sales')} onPointClick={((_x: any) => undefined)('onSelect') as any} />;
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('2d. 拒绝丢弃内嵌调用 data={(()=>{(()=>"sales")();return [];})()}', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        export function Bad({ handlers }: any) {
          return (
            <LineChart
              data={(() => { (() => 'sales')(); return []; })()}
              onPointClick={handlers['onSelect']}
            />
          );
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('3. 拒绝块内 const 泄漏撤销外层参数遮蔽（if(false){const sourceKey="sales"}）', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        export function Bad({ dataSources, handlers }: any, sourceKey: any, handlerKey: any) {
          if (false) {
            const sourceKey = 'sales';
            const handlerKey = 'onSelect';
          }
          return <LineChart data={dataSources[sourceKey]} onPointClick={handlers[handlerKey]} />;
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('4a. 拒绝同名参数遮蔽顶层 buildChart helper：export function Bad(buildChart){ return buildChart(); }', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        function buildChart(dataSources: any, handlers: any) {
          return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']} />;
        }
        export function Bad(buildChart: any) {
          return buildChart();
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('4b. 拒绝同名参数遮蔽顶层 getData/getHandler：export function Bad(getData, getHandler)', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        function getData(dataSources: any) { return dataSources['sales']; }
        function getHandler(handlers: any) { return handlers['onSelect']; }
        export function Bad(getData: any, getHandler: any) {
          return <LineChart data={getData()} onPointClick={getHandler()} />;
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected).ok).toBe(false);
    });

    it('5. 接受无关 false 块内同名 const LineChart 不遮蔽外层合法渲染', () => {
      const code = `
        import { LineChart } from '@company/charts-react/line';
        import '@company/charts-react/style.css';
        export function Good({ dataSources, handlers }: any) {
          if (false) {
            const LineChart = () => null;
          }
          return <LineChart data={dataSources['sales']} onPointClick={handlers['onSelect']} />;
        }
      `;
      expect(assertGeneratedComponentMatchesExpected(code, reactExpected)).toEqual({ ok: true });
    });
  });

  it.skipIf(!process.env.A10_FROZEN_BUNDLE)(
    '显式传入 A10_FROZEN_BUNDLE 时只读核对冻结 manifest SHA-256 与 0.0.11/0.0.12 版本',
    () => {
      const result = verifyFrozenSdkManifestReadOnly(process.env.A10_FROZEN_BUNDLE!);
      expect(result.manifestSha256).toBe(EXPECTED_FROZEN_MANIFEST_SHA256);
      expect(result.packages['@company/charts-core']).toBe('0.0.11');
      expect(result.packages['@company/charts-vue']).toBe('0.0.12');
      expect(result.packages['@company/charts-react']).toBe('0.0.12');
    },
  );
});
