import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentApiV1 } from '@company/contracts';
import type { FixtureProject } from '../../fixtures/t17-matrix/generate.js';
import type { T17PositiveScenario } from '../../fixtures/t17-matrix/scenarios.js';

/** Hand-authored expectation adapter. It never reads target generated files or CLI generators. */
export function independentReferenceComponent(api: ComponentApiV1, packageName: string): string {
  const source = JSON.stringify(packageName + api.exportPath.slice(1));
  const style = JSON.stringify(packageName + api.styleExport.slice(1));
  const registries = api.props.map(prop => prop.name + 'Sources');
  const types = [...registries.map(name => name + ': Record<string, any>;'), ...(api.events.length ? ['handlers: Record<string, (...args: any[]) => void>;'] : [])].join('\n');
  if (api.framework === 'vue') {
    const props = api.props.map(prop => ' :' + prop.name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()) + '=\"' + prop.name + "Sources['matrix." + prop.name + "']\"").join('');
    const events = api.events.map(event => ' @' + event.name + '=\"handlers[\'matrixHandler\']\"').join('');
    return '<script setup lang="ts">\nimport { ' + api.exportName + ' as ReferenceSdk } from ' + source + ';\nimport ' + style + ';\ndefineProps<{\n' + types + '\n}>();\n</script>\n<template><div class="zhinexus-chart-host"><ReferenceSdk' + props + events + ' /></div></template>\n';
  }
  const props = api.props.map(prop => prop.name + '={' + prop.name + "Sources['matrix." + prop.name + "']}").join(' ');
  const events = api.events.map(event => (event.name.startsWith('on') ? event.name : 'on' + event.name.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')) + "={handlers['matrixHandler']}").join(' ');
  return "'use client';\nimport { " + api.exportName + ' as ReferenceSdk } from ' + source + ';\nimport ' + style + ';\nexport function Zhinexus' + api.exportName + '({ ' + [...registries, ...(api.events.length ? ['handlers'] : [])].join(', ') + ' }: { ' + types + ' }) { return <div className="zhinexus-chart-host"><ReferenceSdk ' + props + ' ' + events + ' /></div>; }\n';
}

export async function authorIndependentReference(project: FixtureProject, scenario: T17PositiveScenario, apis: Map<string, ComponentApiV1>): Promise<void> {
  for (const [index, component] of scenario.components.entries()) {
    const api = apis.get(component.instanceId);
    if (!api || api.framework !== scenario.framework) throw new Error('Independent reference requires the authoritative public SDK API.');
    await writeFile(join(project.root, project.generatedPaths[index]!), independentReferenceComponent(api, '@company/charts-' + scenario.framework), { flag: 'wx' });
  }
}
