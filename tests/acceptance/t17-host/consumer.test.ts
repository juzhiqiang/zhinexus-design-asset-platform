import { spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createOwnedRun, type Framework } from './host.js';
import { scaffoldConsumerProject, wireAppliedGeneratedComponent } from './consumer.js';

const require = createRequire(import.meta.url);

async function generatedBuildGraphPlugin(framework: Framework, graphOutput: boolean) {
  const run = await createOwnedRun();
  const project = await scaffoldConsumerProject(run, framework);
  await writeFile(join(project.root, project.generatedPath), framework === 'vue'
    ? '<template><div /></template>\n'
    : 'export function ZhinexusLineChart() { return null; }\n');
  await wireAppliedGeneratedComponent(project, { dataKey: 'revenue', eventKey: 'point-click' });
  await run.registerOwnedPath(project.root, ['package.json', '.t17-hook.cjs', 'index.html', 'tsconfig.json', 'vite.config.mts', 'src']);
  const graphArea = await run.createEvidenceArea('graph-output');
  try {
    let source = await readFile(join(project.root, 'vite.config.mts'), 'utf8');
    // Keep the generated plugin unchanged; resolve its real build dependencies from
    // this test workspace because this narrow test does not install a consumer.
    for (const dependency of ['vite', '@vitejs/plugin-vue', '@vitejs/plugin-react']) {
      source = source.replaceAll("from'" + dependency + "'", 'from ' + JSON.stringify(pathToFileURL(require.resolve(dependency)).href))
        .replaceAll("from '" + dependency + "'", 'from ' + JSON.stringify(pathToFileURL(require.resolve(dependency)).href));
    }
    const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
    const bundle = { entry: { type: 'chunk', fileName: 'assets/host.js', isEntry: true, modules: { [join(project.root, project.generatedPath)]: {} } }, asset: { type: 'asset', fileName: 'style.css' } };
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' };
    delete env.T17_BUILD_GRAPH_OUT;
    const graphPath = join(graphArea, 'graph.json');
    if (graphOutput) env.T17_BUILD_GRAPH_OUT = graphPath;
    const code = 'import(' + JSON.stringify(moduleUrl) + ').then(({default:config})=>{const plugin=config.plugins.find(item=>item.name==="t17-build-graph");plugin.generateBundle({},' + JSON.stringify(bundle) + ');}).catch(error=>{console.error(error);process.exitCode=1;});';
    const child = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    expect(child.error).toBeUndefined();
    expect({ exitCode: child.status, stderr: child.stderr }).toEqual({ exitCode: 0, stderr: '' });
    if (graphOutput) {
      expect(JSON.parse(await readFile(graphPath, 'utf8'))).toEqual([{ file: 'assets/host.js', entry: true, modules: [join(project.root, project.generatedPath)] }]);
    }
  } finally {
    const entries = await readdir(graphArea);
    if (entries.length > 0) await run.registerEvidenceAreaContents(graphArea, entries);
    await run.abortForTest();
  }
}

describe('T17 generated consumer build graph', () => {
  it.each(['vue', 'react'] as const)('%s builds when product verification omits the optional graph output environment', async framework => {
    await generatedBuildGraphPlugin(framework, false);
  });
  it.each(['vue', 'react'] as const)('%s still emits exact module proof for the explicit owned prebuild', async framework => {
    await generatedBuildGraphPlugin(framework, true);
  });
});
