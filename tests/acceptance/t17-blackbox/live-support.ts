/** Independent T17-D fixtures. No CLI product implementation or host-chain/scoring import. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentApiV1, MatchPlanV1 } from '@company/contracts';
import { sha256 } from './support.mjs';

export type LiveFramework = 'vue' | 'react';
export type LiveProject = { root: string; framework: LiveFramework; mode: 'cli' | 'mcp'; artifactRoot: string; cancellationDirectory: string; generatedPath: string; referenceSource: string; generatedHostSource: string; graphPath: string };
export const EXPECTED_SDK_MANIFEST_SHA256 = '04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1';
export const SDK_PACKAGE_SHA256 = { vue: '51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9', react: 'bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28' };
// These are acceptance inputs for the explicitly frozen SDK, never inferred from generated output.
export function declaredLineApi(framework: LiveFramework): Pick<ComponentApiV1, 'props' | 'events'> {
  return { props: [
    { name: 'data', type: 'ChartData', required: true },
    { name: 'config', type: 'LineChartConfig', required: false },
    { name: 'optionOverrides', type: 'SupportedOptionOverrides', required: false },
    ...(framework === 'react' ? [
      { name: 'className', type: 'string', required: false },
      { name: 'style', type: 'CSSProperties', required: false },
      { name: 'ref', type: 'Ref<LineChartHandle | null>', required: false },
    ] : []),
  ], events: [{ name: framework === 'vue' ? 'point-click' : 'onPointClick', payload: 'ChartEvent' }] };
}
export function makeLiveMatch(framework: LiveFramework, variantReleaseId: string, compatibilityIds: string[] = []): MatchPlanV1 {
  const api = declaredLineApi(framework);
  return { schemaVersion: 1, source: 'design-id', inputDigest: sha256('independent-t17-d-line-' + framework),
    ruleSetId: 'independent-t17-d', revision: '1', context: { framework, frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1', echartsVersion: '6.1.0', packageManager: 'npm', requirements: [] },
    elements: [{ instanceId: 'node-1', designId: 'independent/line/' + framework, status: 'mapped', target: {
      variantReleaseId, variantId: 'line-' + framework, componentId: 'line', framework, packageName: '@company/charts-' + framework,
      packageVersion: '0.0.12', packageSha256: SDK_PACKAGE_SHA256[framework], exportName: 'LineChart', exportPath: './line',
      evidence: [{ kind: 'api', path: 'api/line-' + framework + '.json', sha256: framework === 'vue' ? '41e38469674e0a51e281d97fa5d6a01229a25ef8a6b25bc4c0d9e2f3771a757d' : '7017e79ffe964b1e70b2e7f58f77157d82be9b9c2c93a14e7130b5c6d002ce6c' },
        { kind: 'docs', path: 'docs/line-' + framework + '.md', sha256: framework === 'vue' ? 'a4bba35c1bb4d87f0b633e56c2483f0456b333b67a374aa56fdba65e3f642bef' : '5070900d59e9c81ce26979aeed7266c1d5a659a0de3253f69fc0e4ff9dca365f' }],
      compatibility: { status: compatibilityIds.length ? 'verified' : 'unverified', recordIds: [...compatibilityIds] },
      examples: [{ id: 'example-line-' + framework + '-default', previewEntry: 'preview/line-' + framework + '/index.html' }],
      styleExport: './style.css', readyMethod: 'whenRendered', notes: ['仅客户端挂载后渲染，SSR 宿主仅承诺安全导入', '宿主容器须具备明确非零宽高并导入对应包的 ./style.css', 'whenRendered() 为命令式就绪句柄，仅客户端挂载后可用'],
    }, props: api.props.map(p => ({ ...p, ...(p.name === 'data' ? { source: 'independentRevenue' } : {}) })),
    events: api.events.map(e => ({ ...e, handler: 'observeRevenuePoint' })), layout: 'grid cell 1', gaps: [] }],
    exactDependencies: [{ name: '@company/charts-core', version: '0.0.11' }, { name: '@company/charts-' + framework, version: '0.0.12' },
      { name: framework, version: framework === 'vue' ? '3.5.45' : '19.3.1' },
      ...(framework === 'react' ? [{ name: 'react-dom', version: '19.3.1' }] : []), { name: 'echarts', version: '6.1.0' }].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0), gaps: [] };
}

export async function scaffoldLiveProject(area: string, framework: LiveFramework, mode: 'cli' | 'mcp'): Promise<LiveProject> {
  const label = framework + '-' + mode, root = join(area, 'projects', label), artifactRoot = join(area, 'evidence', label);
  const cancellationDirectory = join(artifactRoot, 'owned-cancellation-pids'), graphPath = join(artifactRoot, 'build-modules.json');
  await mkdir(join(root, 'src'), { recursive: true }); await mkdir(cancellationDirectory, { recursive: true });
  const project: LiveProject = { root, framework, mode, artifactRoot, cancellationDirectory, graphPath,
    generatedPath: 'src/components/zhinexus/component-0001.' + (framework === 'vue' ? 'vue' : 'tsx'),
    referenceSource: 'src/Reference.' + (framework === 'vue' ? 'vue' : 'tsx'), generatedHostSource: 'src/Generated.' + (framework === 'vue' ? 'vue' : 'tsx') };
  const dependencies = framework === 'vue' ? { vue: '3.5.45', echarts: '6.1.0' } : { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' };
  const devDependencies = framework === 'vue' ? { vite: '8.3.8', typescript: '6.0.3', 'vue-tsc': '3.3.14', '@vitejs/plugin-vue': '6.0.10' }
    : { vite: '8.3.8', typescript: '6.0.3', '@types/react': '19.3.0', '@types/react-dom': '19.3.0', '@vitejs/plugin-react': '6.3.0' };
  const manifest = { name: 'independent-t17-d-' + framework, version: '1.0.0', private: true, type: 'module', packageManager: 'npm@11.20.0',
    scripts: { typecheck: framework === 'vue' ? 'vue-tsc --noEmit -p tsconfig.json' : 'tsc --noEmit -p tsconfig.json', build: 'vite build', slowcheck: 'node live-cancel.mjs',
      preinstall: 'node live-hook.mjs', postinstall: 'node live-hook.mjs', pretypecheck: 'node live-hook.mjs', posttypecheck: 'node live-hook.mjs', prebuild: 'node live-hook.mjs', postbuild: 'node live-hook.mjs' }, dependencies, devDependencies };
  const files: Record<string, string> = {
    'package.json': JSON.stringify(manifest, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, jsx: 'react-jsx', lib: ['ES2022', 'DOM'], noEmit: true }, include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'] }, null, 2) + '\n',
    'src/vite-env.d.ts': '/// <reference types="vite/client" />\ndeclare module "*.vue" { import type { DefineComponent } from "vue"; const component: DefineComponent<Record<string, unknown>, {}, unknown>; export default component; }\n',
    'src/site.css': 'body{margin:0;font-family:Arial,sans-serif;font-size:14px;color:#1f2937;background:#fff}main{padding:16px}h1{font-size:18px;margin:0 0 12px}.chart-frame,.zhinexus-chart-host{width:720px;height:360px}output{display:block;margin-top:8px}svg *{transition:none!important}\n',
    'src/inputs.ts': 'import{getInstanceByDom}from"echarts/core";\nexport const data={series:[{id:"revenue",name:"Revenue",points:[{x:"Monday",y:42},{x:"Tuesday",y:75},{x:"Wednesday",y:56}]}]};\nexport const config={renderer:"svg" as const,animation:false,width:720,height:360};\nexport function arm(){let attempts=0;const timer=setInterval(()=>{const host=document.querySelector<HTMLElement>(".charts-line");const chart=host&&getInstanceByDom(host);if(chart&&host){const point=chart.convertToPixel({seriesIndex:0},["Tuesday",75]) as number[];const box=host.getBoundingClientRect();const element=point&&document.elementFromPoint(box.left+point[0]!,box.top+point[1]!);if(element&&host.contains(element)&&element.tagName.toLowerCase()==="path"){element.setAttribute("data-live-point","true");document.querySelector("h1")?.setAttribute("data-live-ready","true");clearInterval(timer);}}if(++attempts>400){clearInterval(timer);throw Error("real chart point did not become ready");}},25);}\n',
    'live-hook.mjs': 'import{writeFileSync}from"node:fs";writeFileSync("live-hook-executed.txt","unexpected lifecycle hook");\n',
    'live-cancel.mjs': cancellationScript(cancellationDirectory),
  };
  const plugin = framework === 'vue' ? 'import plugin from "@vitejs/plugin-vue";' : 'import plugin from "@vitejs/plugin-react";';
  files['vite.config.mts'] = 'import{defineConfig}from"vite";import{writeFileSync}from"node:fs";' + plugin + '\nexport default defineConfig({plugins:[plugin(),{name:"independent-build-source-proof",generateBundle(_opts,bundle){writeFileSync(' + JSON.stringify(graphPath) + ',JSON.stringify(Object.values(bundle).filter(item=>item.type==="chunk").map(item=>({file:item.fileName,entry:item.isEntry,modules:Object.keys(item.modules)}))));}}],build:{sourcemap:true,manifest:true,rollupOptions:{input:{generated:"index.html",reference:"reference.html"}}}});\n';
  for (const reference of [false, true]) {
    const component = reference ? 'Reference' : 'Generated';
    const entry = reference ? 'reference-entry' : 'main';
    files[(reference ? 'reference' : 'index') + '.html'] = '<!doctype html><html><head><meta charset="utf-8"><title>Independent integration fixture</title></head><body><div id="app"></div><script type="module" src="/src/' + entry + (framework === 'vue' ? '.ts' : '.tsx') + '"></script></body></html>\n';
    if (framework === 'vue') {
      files['src/' + entry + '.ts'] = 'import{createApp}from"vue";import App from"./' + component + '.vue";import"./site.css";createApp(App).mount("#app");\n';
      const imported = reference ? 'import{LineChart as Chart}from"@company/charts-vue/line";import"@company/charts-vue/style.css";' : 'import Chart from"./components/zhinexus/component-0001.vue";';
      const chart = reference ? '<div class="zhinexus-chart-host"><Chart :data="data" :config="config" @point-click="observe"/></div>' : '<Chart :data-sources="{independentRevenue:data}" :config="config" :handlers="{observeRevenuePoint:observe}"/>';
      files['src/' + component + '.vue'] = '<script setup lang="ts">import{ref,onMounted}from"vue";' + imported + 'import{data,config,arm}from"./inputs";const count=ref(0);function observe(){count.value++}onMounted(arm);</script><template><main><h1>Independent revenue chart</h1><div class="chart-frame">' + chart + '</div><output data-live-count>{{count}}</output></main></template>\n';
    } else {
      files['src/' + entry + '.tsx'] = 'import{createRoot}from"react-dom/client";import App from"./' + component + '";import"./site.css";createRoot(document.getElementById("app")!).render(<App/>);\n';
      const imported = reference ? 'import{LineChart as Chart}from"@company/charts-react/line";import"@company/charts-react/style.css";' : 'import{ZhinexusLineChart as Chart}from"./components/zhinexus/component-0001";';
      const chart = reference ? '<div className="zhinexus-chart-host"><Chart data={data} config={config} onPointClick={observe}/></div>' : '<Chart dataSources={{independentRevenue:data}} config={config} handlers={{observeRevenuePoint:observe}}/>';
      files['src/' + component + '.tsx'] = 'import{useEffect,useState}from"react";' + imported + 'import{data,config,arm}from"./inputs";export default function App(){const[count,setCount]=useState(0);const observe=()=>setCount(n=>n+1);useEffect(arm,[]);return <main><h1>Independent revenue chart</h1><div className="chart-frame">' + chart + '</div><output data-live-count>{count}</output></main>}\n';
    }
  }
  for (const [file, content] of Object.entries(files)) await writeFile(join(root, file), content, { flag: 'wx' });
  return project;
}
function cancellationScript(directory: string): string {
  return 'import{spawn}from"node:child_process";import{writeFileSync}from"node:fs";import{join}from"node:path";const directory=' + JSON.stringify(directory) + ';const role=process.argv[2]??"parent";writeFileSync(join(directory,role+".json"),JSON.stringify({pid:process.pid,parentPid:process.ppid,role}));if(role!=="grandchild")spawn(process.execPath,[import.meta.filename,role==="parent"?"child":"grandchild"],{stdio:"ignore",windowsHide:true});setInterval(()=>{},1000);\n';
}
