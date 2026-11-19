/**
 * T17 矩阵用例工程生成器（确定性字节：不含时间戳/随机数）。
 *
 * 每个用例生成一个仓外最小 Vue/React 工程：
 * - standalone 或 npm/pnpm workspace（apps/web）；
 * - 宿主页在 apply 前就 import 计划生成的 component-000N 文件（路径由 resolve.generatedPathFor 冻结）；
 * - 数据源/事件处理注册表键与矩阵自建的 MatchPlan 完全一致（`matrix.<prop>` / `matrixHandler`）；
 * - 每种 hostMode 暴露真实可观察的 DOM 计数（clicks / series-count / activation / mounts / cleanups 等），
 *   供产品 spec 与独立 harness 使用 limited click/fill + visible/text/count 断言。
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ComponentApiV1, PackageRef } from '@company/contracts';
import type { MatrixEnv } from '../acceptance/t17-matrix/env.js';
import type { T17ComponentId, T17PositiveScenario } from '../scenarios.js';
import { T17_TOOLCHAIN } from '../scenarios.js';
import { ensureDir } from '../acceptance/t17-matrix/support.js';

export type FixtureProject = {
  root: string;
  workspaceDir: string;
  workspace: string;
  entryPath: string;
  distDir: string;
  generatedPaths: string[];
  packageJsonPath: string;
};

type BundlePackages = { core: PackageRef; framework: PackageRef };

const SERIES = (id: string, name: string, points: [string | number, number | null][]) => ({
  id,
  name,
  points: points.map(([x, y]) => ({ x, y })),
});

function dataFor(componentId: T17ComponentId, state: 'default' | 'empty' | 'updated' | 'center'): unknown {
  if (state === 'empty') return { series: [] };
  const updated = state === 'updated';
  switch (componentId) {
    case 'line':
      return state === 'center'
        ? { series: [SERIES('revenue', '收入', [['A', 0], ['B', 50], ['C', 0]])] }
        : {
            series: [
              SERIES('revenue', '收入', updated ? [['周一', 260], ['周二', 240], ['周三', 300], ['周四', 280]] : [['周一', 120], ['周二', null], ['周三', 180], ['周四', 150]]),
              SERIES('cost', '成本', updated ? [['周一', 90], ['周二', 85], ['周三', 95], ['周四', 88]] : [['周一', 40], ['周二', 55], ['周三', null], ['周四', 60]]),
            ],
          };
    case 'bar':
      return {
        series: [
          SERIES('revenue', '收入', updated ? [['周一', 260], ['周二', 240]] : [['周一', 120], ['周二', 200]]),
          SERIES('cost', '成本', updated ? [['周一', 90], ['周二', 85]] : [['周一', 40], ['周二', 55]]),
        ],
      };
    case 'pie':
      return { series: [SERIES('share', '占比', [['搜索', 120], ['直投', 80], ['自然', 60], ['合作', 100]])] };
    case 'scatter':
      return {
        series: [
          SERIES('revenue', '收入', [[1, 120], [2, 180], [3, 150], [4, 200]]),
          SERIES('cost', '成本', [[1, 40], [2, 60], [3, 55], [4, 80]]),
        ],
      };
    case 'trend-card':
      return { series: [SERIES('active', '活跃用户', [['周一', 120], ['周二', 150], ['周三', 180], ['周四', 200]])] };
    case 'ranking':
      return { series: [SERIES('hot', '热度', [['折线图', 120], ['柱状图', 180], ['饼图', 180], ['散点图', 90], ['趋势卡片', 60], ['排行榜', 30]])] };
    case 'proportion':
      return { series: [SERIES('source', '来源', [['搜索', 120], ['直投', 80], ['自然', 60]])] };
  }
}

const EXTRA_SERIES = SERIES('quality', '质量', [[1, 30], [2, 45], [3, 60], [4, 75]]);

function propValueExpression(propName: string, propType: string, framework: 'vue' | 'react'): string {
  void propType;
  void framework;
  const lower = propName.toLowerCase();
  if (lower.includes('data') && !lower.includes('metadata')) return 'data.value';
  if (lower.includes('config') || lower.includes('option')) return 'config.value';
  return '{}';
}

function registriesForVue(api: ComponentApiV1): string {
  const lines: string[] = [];
  for (const prop of api.props) {
    const registry = prop.name + 'Sources';
    const key = JSON.stringify('matrix.' + prop.name);
    lines.push(`  ${registry}: { ${key}: ${propValueExpression(prop.name, prop.type, 'vue')} },`);
  }
  if (api.events.length > 0) lines.push(`  handlers: { matrixHandler: onPointClick },`);
  return lines.join('\n');
}

function registriesForReact(api: ComponentApiV1): string {
  const lines: string[] = [];
  for (const prop of api.props) {
    const registry = prop.name + 'Sources';
    const key = JSON.stringify('matrix.' + prop.name);
    lines.push(`  ${registry}: { ${key}: data },`);
  }
  if (api.events.length > 0) lines.push(`  handlers: { matrixHandler: onPointClick },`);
  return lines.join('\n');
}

function componentFileName(index: number, framework: 'vue' | 'react'): string {
  return `component-${String(index).padStart(4, '0')}.${framework === 'vue' ? 'vue' : 'tsx'}`;
}

function vueImports(scenario: T17PositiveScenario): string {
  const lines: string[] = [];
  scenario.components.forEach((component, index) => {
    lines.push(`import Chart${index + 1} from './components/zhinexus/${componentFileName(index + 1, 'vue')}';`);
  });
  return lines.join('\n');
}

function reactImports(scenario: T17PositiveScenario, apis: Map<string, ComponentApiV1>): string {
  const lines: string[] = [];
  scenario.components.forEach((component, index) => {
    const api = apis.get(component.instanceId)!;
    lines.push(`import { ${api.exportName} as Chart${index + 1} } from './components/zhinexus/${componentFileName(index + 1, 'react')}';`);
  });
  return lines.join('\n');
}

function dataConst(name: string, value: unknown): string {
  return `const ${name}: any = ${JSON.stringify(value, null, 2)};`;
}

function vueApp(scenario: T17PositiveScenario, apis: Map<string, ComponentApiV1>): { app: string; extraFiles: Record<string, string> } {
  const initial = dataFor(scenario.components[0]!.componentId, scenario.components[0]!.dataState);
  const updated = dataFor(scenario.components[0]!.componentId, 'updated');
  const extraFiles: Record<string, string> = {};
  const imports = vueImports(scenario);
  const chartProps = scenario.components.map((component, index) => {
    const api = apis.get(component.instanceId)!;
    return { index, api, component };
  });

  const propGetters = chartProps.map(({ index, api }) => [
    `const props${index + 1} = computed(() => ({`,
    registriesForVue(api),
    `}));`,
  ].join('\n')).join('\n\n');

  const mode = scenario.hostMode;
  const chartsMarkup = chartProps.map(({ index }) => `<Chart${index + 1} v-bind="props${index + 1}" />`).join('\n      ');

  const usesKeepAlive = mode === 'keepalive';
  if (usesKeepAlive) {
    extraFiles['ChartPane.vue'] = `<script setup lang="ts">
import { onActivated } from 'vue';
import Chart1 from './components/zhinexus/${componentFileName(1, 'vue')}';
defineProps<{ chartProps: Record<string, unknown> }>();
const emit = defineEmits<{ activated: [] }>();
onActivated(() => emit('activated'));
</script>

<template>
  <div class="chart-frame"><Chart1 v-bind="chartProps" /></div>
</template>
`;
  }

  const body = (() => {
    if (mode === 'multi') {
      const multiCharts = chartProps.map(({ index, component }) => {
        const data = dataFor(component.componentId, component.dataState);
        return { index, data };
      });
      const multiData = multiCharts.map(({ index, data }) => `const data${index + 1} = ref<any>(${JSON.stringify(data)});`).join('\n');
      const multiProps = chartProps.map(({ index, api }) => [
        `const props${index + 1} = computed(() => ({`,
        registriesForVue(api).replaceAll('data.value', `data${index + 1}.value`),
        `}));`,
      ].join('\n')).join('\n');
      return `${multiData}
const config = ref<any>({ theme: 'light', renderer: 'canvas', animation: false });
const filter = ref('');
const filterResult = ref('');
const events = ref(0);
const onPointClick = () => { events.value += 1; };
function applyFilter() { filterResult.value = filter.value; events.value += 1; }
${multiProps}
</script>

<template>
  <main>
    <section data-testid="multi-host" class="multi">
      ${chartProps.map(({ index }) => `<Chart${index + 1} v-bind="props${index + 1}" />`).join('\n      ')}
    </section>
    <label>过滤 <input data-testid="filter" v-model="filter" /></label>
    <button data-testid="apply-filter" @click="applyFilter">应用</button>
    <p data-testid="filter-result">{{ filterResult }}</p>
    <p data-testid="events">events={{ events }}</p>
  </main>
</template>`;
    }
    if (usesKeepAlive) {
      return `const data = ref<any>(${JSON.stringify(initial)});
const config = ref<any>({ theme: 'light', renderer: 'canvas', animation: false });
const clicks = ref(0);
const activation = ref(0);
const tab = ref<'chart' | 'placeholder'>('chart');
const onPointClick = () => { clicks.value += 1; };
${propGetters}
</script>

<template>
  <main>
    <div class="tabs">
      <button data-testid="tab-chart" @click="tab = 'chart'">图表</button>
      <button data-testid="tab-placeholder" @click="tab = 'placeholder'">占位</button>
    </div>
    <KeepAlive>
      <ChartPane v-if="tab === 'chart'" :chart-props="props1" @activated="activation += 1" />
      <section v-else class="placeholder">占位内容</section>
    </KeepAlive>
    <p data-testid="activation">activation={{ activation }}</p>
    <p data-testid="clicks">clicks={{ clicks }}</p>
  </main>
</template>`;
    }
    if (mode === 'hidden-show') {
      return `const data = ref<any>(${JSON.stringify(initial)});
const config = ref<any>({ theme: 'light', renderer: 'canvas', animation: false });
const clicks = ref(0);
const shown = ref(0);
const visible = ref(false);
const seriesCount = ref(0);
watchEffect(() => { seriesCount.value = Array.isArray(data.value?.series) ? data.value.series.length : 0; });
const onPointClick = () => { clicks.value += 1; };
function show() { visible.value = true; shown.value += 1; }
${propGetters}
</script>

<template>
  <main>
    <button data-testid="show" @click="show">显示</button>
    <div data-testid="chart-host" :style="visible ? { width: '720px', height: '360px' } : { display: 'none', width: '0px', height: '0px' }">
      <Chart1 v-bind="props1" />
    </div>
    <p data-testid="shown">shown={{ shown }}</p>
    <p data-testid="clicks">clicks={{ clicks }}</p>
    <p data-testid="series-count">series={{ seriesCount }}</p>
  </main>
</template>`;
    }
    return `const data = ref<any>(${JSON.stringify(initial)});
const config = ref<any>({ theme: 'light', renderer: 'canvas', animation: false });
const clicks = ref(0);
const seriesCount = ref(0);
watchEffect(() => { seriesCount.value = Array.isArray(data.value?.series) ? data.value.series.length : 0; });
const onPointClick = () => { clicks.value += 1; };
function loadData() { data.value = ${JSON.stringify(updated)}; }
function addSeries() { data.value = { series: [...data.value.series, ${JSON.stringify(EXTRA_SERIES)}] }; }
function removeSeries() { data.value = { series: data.value.series.slice(0, 1) }; }
function toggleRenderer() { config.value = { ...config.value, renderer: config.value.renderer === 'canvas' ? 'svg' : 'canvas' }; }
${propGetters}
</script>

<template>
  <main>
    <div data-testid="chart-host" class="chart-frame">
      ${chartsMarkup}
    </div>
    <button data-testid="load-data" @click="loadData">加载数据</button>
    <button data-testid="add-series" @click="addSeries">追加系列</button>
    <button data-testid="remove-series" @click="removeSeries">删减系列</button>
    <button data-testid="toggle-renderer" @click="toggleRenderer">切换渲染器</button>
    <p data-testid="clicks">clicks={{ clicks }}</p>
    <p data-testid="series-count">series={{ seriesCount }}</p>
    <p data-testid="shown">shown=0</p>
  </main>
</template>`;
  })();

  const scriptImports = mode === 'keepalive'
    ? `import { computed, ref } from 'vue';\nimport ChartPane from './ChartPane.vue';`
    : `import { computed, ref, watchEffect } from 'vue';`;

  return {
    app: `<script setup lang="ts">
${scriptImports}
${imports}
${body}
</script>

<style>
body { font-family: system-ui, sans-serif; margin: 24px; }
.chart-frame { width: 720px; height: 360px; border: 1px solid #e2e8f0; }
.multi { display: flex; gap: 16px; flex-wrap: wrap; }
.placeholder { width: 720px; height: 120px; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; }
</style>
`,
    extraFiles,
  };
}

function reactApp(scenario: T17PositiveScenario, apis: Map<string, ComponentApiV1>): string {
  const initial = dataFor(scenario.components[0]!.componentId, scenario.components[0]!.dataState);
  const updated = dataFor(scenario.components[0]!.componentId, 'updated');
  const imports = reactImports(scenario, apis);
  const chartProps = scenario.components.map((component, index) => ({ index, api: apis.get(component.instanceId)!, component }));

  const mode = scenario.hostMode;
  if (mode === 'strictmode') {
    const api = apis.get(scenario.components[0]!.instanceId)!;
    return `import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
${imports}

const initialData: any = ${JSON.stringify(initial)};
const config: any = { theme: 'light', renderer: 'canvas', animation: false };

function ChartPane({ onMount, onCleanup, data, onPointClick }: { onMount: () => void; onCleanup: () => void; data: any; onPointClick: () => void }) {
  useEffect(() => {
    onMount();
    return () => onCleanup();
  }, []);
  return (
    <div className="chart-frame">
      <Chart1
        ${api.props.map((prop) => {
          const value = prop.name.toLowerCase().includes('data') ? 'data' : prop.name.toLowerCase().includes('config') ? '({ ...config })' : '{}';
          return `${prop.name}Sources={{ ${JSON.stringify('matrix.' + prop.name)}: ${value} }}`;
        }).join(' ')}
        ${api.events.length ? 'handlers={{ matrixHandler: onPointClick }}' : ''}
      />
    </div>
  );
}

function App() {
  const [show, setShow] = useState(true);
  const [mounts, setMounts] = useState(0);
  const [cleanups, setCleanups] = useState(0);
  const [clicks, setClicks] = useState(0);
  const data: any = initialData;
  return (
    <main>
      <button data-testid="toggle-chart" onClick={() => setShow((value) => !value)}>切換</button>
      {show && <ChartPane data={data} onMount={() => setMounts((value) => value + 1)} onCleanup={() => setCleanups((value) => value + 1)} onPointClick={() => setClicks((value) => value + 1)} />}
      <p data-testid="mounts">mounts={mounts}</p>
      <p data-testid="cleanups">cleanups={cleanups}</p>
      <p data-testid="clicks">clicks={clicks}</p>
    </main>
  );
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;
  }

  if (mode === 'multi') {
    const multi = chartProps.map(({ index, api }) => ({ index, api }));
    return `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
${imports}

${multi.map(({ index, api }) => `const data${index + 1}: any = ${JSON.stringify(dataFor(scenario.components[index]!.componentId, scenario.components[index]!.dataState), null, 2)};`).join('\n')}
const config: any = { theme: 'light', renderer: 'canvas', animation: false };

function App() {
  const [filter, setFilter] = useState('');
  const [filterResult, setFilterResult] = useState('');
  const [events, setEvents] = useState(0);
  const onPointClick = () => setEvents((value) => value + 1);
  return (
    <main>
      <section data-testid="multi-host" className="multi">
${multi.map(({ index, api }) => `        <Chart${index + 1} ${api.props.map((prop) => `${prop.name}Sources={{ ${JSON.stringify('matrix.' + prop.name)}: data${index + 1} }}`).join(' ')} ${api.events.length ? 'handlers={{ matrixHandler: onPointClick }}' : ''} />`).join('\n')}
      </section>
      <label>过滤 <input data-testid="filter" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      <button data-testid="apply-filter" onClick={() => { setFilterResult(filter); setEvents((value) => value + 1); }}>应用</button>
      <p data-testid="filter-result">{filterResult}</p>
      <p data-testid="events">events={events}</p>
    </main>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
`;
  }

  const hidden = mode === 'hidden-show';
  const emptyUpdate = mode === 'empty-update';
  const seriesTheme = mode === 'series-theme';
  const dataExpr = JSON.stringify(initial);
  return `import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
${imports}

const initialData: any = ${dataExpr};
const updatedData: any = ${JSON.stringify(updated)};
const extraSeries: any = ${JSON.stringify(EXTRA_SERIES)};
const config: any = { theme: 'light', renderer: 'canvas', animation: false };

function App() {
  const [data, setData] = useState<any>(initialData);
  const [renderer, setRenderer] = useState<'canvas' | 'svg'>('canvas');
  const [clicks, setClicks] = useState(0);
  const [shown, setShown] = useState(0);
  const [visible, setVisible] = useState(${hidden ? 'false' : 'true'});
  const seriesCount = Array.isArray(data?.series) ? data.series.length : 0;
  const onPointClick = () => setClicks((value) => value + 1);
  const loadData = () => setData(updatedData);
  const addSeries = () => setData({ series: [...data.series, extraSeries] });
  const removeSeries = () => setData({ series: data.series.slice(0, 1) });
  const toggleRenderer = () => setRenderer((value) => (value === 'canvas' ? 'svg' : 'canvas'));
  const show = () => { setVisible(true); setShown((value) => value + 1); };
  return (
    <main>
      ${hidden ? '<button data-testid="show" onClick={show}>显示</button>' : ''}
      <div data-testid="chart-host" className="chart-frame" style={visible ? { width: 720, height: 360 } : { display: 'none', width: 0, height: 0 }}>
        <Chart1
          ${apis.get(scenario.components[0]!.instanceId)!.props.map((prop) => `${prop.name}Sources={{ ${JSON.stringify('matrix.' + prop.name)}: ${prop.name.toLowerCase().includes('data') ? 'data' : prop.name.toLowerCase().includes('config') ? '({ ...config, renderer })' : '{}'} }}`).join('\n          ')}
          ${apis.get(scenario.components[0]!.instanceId)!.events.length ? 'handlers={{ matrixHandler: onPointClick }}' : ''}
        />
      </div>
      <button data-testid="load-data" onClick={loadData}>加载数据</button>
      <button data-testid="add-series" onClick={addSeries}>追加系列</button>
      <button data-testid="remove-series" onClick={removeSeries}>删减系列</button>
      <button data-testid="toggle-renderer" onClick={toggleRenderer}>切换渲染器</button>
      <p data-testid="clicks">clicks={clicks}</p>
      <p data-testid="series-count">series={seriesCount}</p>
      <p data-testid="shown">shown={shown}</p>
    </main>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
`;
}

function packageJsonFor(
  scenario: T17PositiveScenario,
  frameworkPackage: PackageRef,
  corePackage: PackageRef,
  workspaceChild: boolean,
): Record<string, unknown> {
  const toolchain = T17_TOOLCHAIN;
  const isVue = scenario.framework === 'vue';
  const deps: Record<string, string> = {
    [frameworkPackage.name]: frameworkPackage.version,
    [corePackage.name]: corePackage.version,
    echarts: toolchain.echarts,
    ...(isVue ? { vue: toolchain.vue } : { react: toolchain.react, 'react-dom': toolchain.reactDom }),
  };
  const devDeps: Record<string, string> = {
    vite: toolchain.vite,
    ...(isVue
      ? { '@vitejs/plugin-vue': toolchain.pluginVue, typescript: toolchain.typescriptVue, 'vue-tsc': toolchain.vueTsc }
      : { '@vitejs/plugin-react': toolchain.pluginReact, typescript: toolchain.typescriptReact, '@types/react': toolchain.typesReact, '@types/react-dom': toolchain.typesReactDom }),
  };
  return {
    name: workspaceChild ? '@matrix/web' : 'matrix-' + scenario.caseId.toLowerCase(),
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite --host 127.0.0.1 --port 0 --strictPort',
      build: 'vite build',
      typecheck: isVue ? 'vue-tsc --noEmit' : 'tsc --noEmit',
    },
    dependencies: deps,
    devDependencies: devDeps,
  };
}

function tsconfigFor(framework: 'vue' | 'react'): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      ...(framework === 'vue' ? { jsx: 'preserve' } : { jsx: 'react-jsx' }),
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: ['vite/client'],
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
    },
    include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue', 'vite.config.ts'],
  }, null, 2) + '\n';
}

function viteConfigFor(framework: 'vue' | 'react'): string {
  return framework === 'vue'
    ? `import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\nexport default defineConfig({ plugins: [vue()], server: { host: '127.0.0.1' } });\n`
    : `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()], server: { host: '127.0.0.1' } });\n`;
}

export async function materializeProject(
  env: MatrixEnv,
  scenario: T17PositiveScenario,
  bundleManifest: { packages: PackageRef[] },
  apis: Map<string, ComponentApiV1>,
): Promise<FixtureProject> {
  const runRoot = path.join(env.workRoot, 'cases', scenario.caseId);
  await ensureDir(runRoot);
  const isVue = scenario.framework === 'vue';
  const frameworkPackage = bundleManifest.packages.find((pkg) => pkg.name === '@company/charts-' + scenario.framework);
  const corePackage = bundleManifest.packages.find((pkg) => pkg.name === '@company/charts-core');
  if (!frameworkPackage || !corePackage) throw new Error('冻结 bundle 缺少 charts 包: ' + scenario.framework);

  const workspace = scenario.workspace;
  const workspaceDir = workspace === '.' ? runRoot : path.join(runRoot, 'apps', 'web');
  const packageJsonPath = path.join(workspaceDir, 'package.json');

  if (scenario.topology === 'workspace') {
    if (scenario.packageManager === 'pnpm') {
      await writeFile(path.join(runRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n", 'utf8');
    }
    await writeFile(path.join(runRoot, 'package.json'), JSON.stringify({ name: 'matrix-workspace', private: true, workspaces: ['apps/*'] }, null, 2) + '\n', 'utf8');
    await ensureDir(workspaceDir);
    await writeFile(packageJsonPath, JSON.stringify(packageJsonFor(scenario, frameworkPackage, corePackage, true), null, 2) + '\n', 'utf8');
  } else {
    await writeFile(packageJsonPath, JSON.stringify(packageJsonFor(scenario, frameworkPackage, corePackage, false), null, 2) + '\n', 'utf8');
  }

  const srcDir = path.join(workspaceDir, 'src');
  await ensureDir(path.join(srcDir, 'components', 'zhinexus'));
  await writeFile(path.join(workspaceDir, 'tsconfig.json'), tsconfigFor(scenario.framework), 'utf8');
  await writeFile(path.join(workspaceDir, 'vite.config.ts'), viteConfigFor(scenario.framework), 'utf8');
  await writeFile(path.join(workspaceDir, 'index.html'), '<!doctype html>\n<html lang="zh-CN">\n  <head><meta charset="UTF-8" /><title>matrix ' + scenario.caseId + '</title></head>\n  <body><div id="app"></div><script type="module" src="/src/main.' + (isVue ? 'ts' : 'tsx') + '"></script></body>\n</html>\n', 'utf8');
  await writeFile(path.join(srcDir, isVue ? 'vite-env.d.ts' : 'vite-env.d.ts'), '/// <reference types="vite/client" />\n', 'utf8');

  if (isVue) {
    const host = vueApp(scenario, apis);
    await writeFile(path.join(srcDir, 'main.ts'), "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n", 'utf8');
    await writeFile(path.join(srcDir, 'App.vue'), host.app, 'utf8');
    for (const [name, content] of Object.entries(host.extraFiles)) await writeFile(path.join(srcDir, name), content, 'utf8');
  } else {
    await writeFile(path.join(srcDir, 'main.tsx'), "import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>);\n", 'utf8');
    await writeFile(path.join(srcDir, 'App.tsx'), reactApp(scenario, apis), 'utf8');
  }

  return {
    root: runRoot,
    workspaceDir,
    workspace,
    entryPath: workspace + '/src/' + (isVue ? 'App.vue' : 'App.tsx'),
    distDir: path.join(workspaceDir, 'dist'),
    generatedPaths: scenario.components.map((_, index) => `${workspace === '.' ? '' : workspace + '/'}src/components/zhinexus/${componentFileName(index + 1, scenario.framework)}`),
    packageJsonPath,
  };
}
