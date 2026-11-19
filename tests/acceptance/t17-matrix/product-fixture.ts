import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FixtureProject } from '../../fixtures/t17-matrix/generate.js';
import type { T17PositiveScenario } from '../../fixtures/t17-matrix/scenarios.js';

/** Correct only the declared host bindings; generated adapters and frozen actions are untouched. */
export async function correctProductHostFixture(project: FixtureProject, scenario: T17PositiveScenario): Promise<void> {
  const vue = scenario.framework === 'vue';
  const appPath = join(project.workspaceDir, 'src/App.' + (vue ? 'vue' : 'tsx'));
  let source = await readFile(appPath, 'utf8');
  if (scenario.hostMode === 'multi') {
    let configIndex = 0;
    source = source.replace(/"matrix\.config": (?:config\.value|data\d+)/g, () => {
      const component = scenario.components[configIndex++];
      if (!component) throw new Error('Multi-instance configuration exceeded its declared instances.');
      return '"matrix.config": { ...config' + (vue ? '.value' : '') + ", chart: '" + component.componentId + "' }";
    });
    if (configIndex !== scenario.components.length) throw new Error('Every declared component requires its own public config binding.');
    source = source.replace(/"matrix\.optionOverrides": (?:config\.value|data\d+)/g, '"matrix.optionOverrides": {}');
    source = source.replace(/"matrix\.className": data\d+/g, '"matrix.className": ""');
    source = source.replace(/"matrix\.ref": data\d+/g, '"matrix.ref": null');
    source = source.replace(/"matrix\.style": data\d+/g, '"matrix.style": {}');
  } else {
    source = source.replace("{ theme: 'light', renderer: 'canvas', animation: false }", "{ chart: '" + scenario.components[0]!.componentId + "', theme: 'light', renderer: 'canvas', animation: false }");
    source = source.replaceAll('"matrix.optionOverrides": config.value', '"matrix.optionOverrides": {}');
    source = source.replaceAll('"matrix.className": {}', '"matrix.className": ""');
    source = source.replaceAll('"matrix.ref": {}', '"matrix.ref": null');
  }
  if (vue) source = source.replace('</template>\n</script>\n\n<style>', '</template>\n\n<style>');
  else source = source.replace(/(from ['"][^'"]+)\.tsx(['"])/g, '$1$2');
  await writeFile(appPath, source);
  if (vue && scenario.hostMode === 'keepalive') {
    const panePath = join(project.workspaceDir, 'src/ChartPane.vue');
    const pane = await readFile(panePath, 'utf8');
    const original = "onActivated(() => emit('activated'));";
    if (!pane.includes(original)) throw new Error('KeepAlive fixture activation hook is unavailable.');
    await writeFile(panePath, pane.replace('chartProps: Record<string, unknown>', "chartProps: InstanceType<typeof Chart1>['$props']").replace(original, "let hasActivated = false;\nonActivated(() => { if (hasActivated) emit('activated'); hasActivated = true; });"));
  }
  if (!vue) await writeFile(join(project.workspaceDir, 'src/main.tsx'), "import './App';\n");
}
