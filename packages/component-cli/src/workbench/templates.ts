import type { ProjectVariant } from '../project/config.js';
import type { ComponentApiV1 } from '../contracts/component-api.js';
export const templateVersions = { react:'19.3.1', vue:'3.5.45', vite:'8.3.8', typescript:'7.0.2', vueTypescript:'6.0.3', vueTsc:'3.3.14', reactPlugin:'6.3.0', vuePlugin:'6.0.10' };
export const reactSource=`export type DemoProps = {
  label?: string;
  value?: number;
  enabled?: boolean;
  color?: string;
  valueColor?: string;
  data?: number[];
  onChange?: (event: { value: number }) => void;
};

export function Demo({ label = 'Hello juz', value = 42, enabled = true, color = '#A3D2FF', valueColor = '#FF6B35', data = [], onChange }: DemoProps) {
  return (
    <button
      disabled={!enabled}
      onClick={() => onChange?.({ value: value + 1 })}
      style={{ width: '100%', height: '100%', padding: 32, border: 0, borderRadius: 12, background: '#172731', color, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
    >
      <h1>{label}</h1>
      <strong style={{ fontSize: 56, color: valueColor }}>{value}</strong>
      <p>{JSON.stringify(data)}</p>
    </button>
  );
}
`;
export const vueSource=`<script setup lang="ts">
withDefaults(defineProps<{
  label?: string;
  value?: number;
  enabled?: boolean;
  color?: string;
  valueColor?: string;
  data?: number[];
}>(), { label: 'Hello juz', value: 42, enabled: true, color: '#A3D2FF', valueColor: '#FF6B35', data: () => [] });

const emit = defineEmits<{ change: [event: { value: number }] }>();
</script>

<template>
  <button
    :disabled="!enabled"
    :style="{ width: '100%', height: '100%', padding: '32px', border: 0, borderRadius: '12px', background: '#172731', color, font: 'inherit', textAlign: 'left', cursor: 'pointer' }"
    @click="emit('change', { value: value + 1 })"
  >
    <h1>{{ label }}</h1>
    <strong :style="{ fontSize: '56px', color: valueColor }">{{ value }}</strong>
    <p>{{ JSON.stringify(data) }}</p>
  </button>
</template>
`;
// Keep ordinary Bundler-style source imports, but ship NodeNext-compatible types.
export const vueDeclarations=`import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
function moduleReferences(source) {
  const references = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) references.push(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) references.push(node.argument.literal);
    else if (ts.isExternalModuleReference(node) && node.expression && ts.isStringLiteral(node.expression)) references.push(node.expression);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return references;
}
async function normalize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await normalize(file);
    else if (entry.name.endsWith('.d.ts')) {
      const text = await readFile(file, 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const edits = [];
      for (const node of moduleReferences(source)) {
        const specifier = node.text;
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
        const target = resolve(dirname(file), specifier);
        let replacement;
        if (existsSync(target + '.d.ts')) replacement = specifier + '.js';
        else if (existsSync(join(target, 'index.d.ts'))) replacement = specifier + '/index.js';
        if (replacement) edits.push({ start: node.getStart(source) + 1, end: node.end - 1, replacement });
      }
      let output = text;
      for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
      await writeFile(file, output);
    }
  }
}
await normalize('dist');
`;
export function initialPlayground() {
  const props={label:'Hello juz',value:42,enabled:true,color:'#A3D2FF',valueColor:'#FF6B35'};
  return {schemaVersion:1,adapter:'auto',props,data:[12,24,36],dataProp:'data',controls:[],states:[{id:'default',label:'默认',props:{...props},data:[12,24,36]},{id:'empty',label:'空数据',props:{...props,label:'No data',value:0},data:[]}]};
}
export function consumerSource(packageName:string,variant:ProjectVariant,api:ComponentApiV1):string {
  const moduleName=JSON.stringify(packageName+variant.exportPath.slice(1));
  const imports=variant.framework==='react' ? "import { createElement, Component as ReactComponent } from 'react';\nimport { createRoot } from 'react-dom/client';" : "import { createApp, h, shallowRef, nextTick } from 'vue';";
  const mount=variant.framework==='react' ? `const root=createRoot(host);
class Boundary extends ReactComponent { componentDidCatch(error) { failure=String(error); send({type:'status',status:'error',message:failure}); } render() { return this.props.children; } }
async function render() { root.render(createElement(Boundary,null,createElement(Selected,{...properties(),ref:instance}))); await painted(); }
const unmount=()=>root.unmount();` : `const state=shallowRef(properties());
const app=createApp({render:()=>h(Selected,{...state.value,ref:value=>{instance.current=value;}})});
app.config.errorHandler=error=>{failure=String(error);send({type:'status',status:'error',message:failure});};
app.mount(host);
async function render(){state.value=properties();await nextTick();await painted();}
const unmount=()=>app.unmount();`;
  return `${imports}
import { ${variant.exportName} as Selected } from ${moduleName};
import saved from './playground.json';
const events=${JSON.stringify(api.events.map(e=>e.name))};
const readyMethod=${JSON.stringify(api.readyMethod ?? '')};
const host=document.querySelector('#app');
let values={props:saved.props,data:saved.data},port,failure='',instance={current:null};
const painted=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const send=message=>{try{port?.postMessage(message);}catch{}};
function properties(){const props={...values.props};if(saved.dataProp)props[saved.dataProp]=values.data;for(const name of events){const callback=(...args)=>send({type:'event',name,payload:args.length===1?args[0]:args,time:new Date().toISOString()});props[name.startsWith('on')?name:'on'+name[0].toUpperCase()+name.slice(1)]=callback;}return props;}
${mount}
async function ready(){await render();if(readyMethod&&typeof instance.current?.[readyMethod]==='function')await instance.current[readyMethod]();if(document.fonts)await document.fonts.ready;if(failure)throw new Error(failure);}
const checks=()=>[{name:'framework-mounted',status:host.children.length>0&&!failure?'passed':'failed'},{name:'nonzero-container',status:host.clientWidth>0&&host.clientHeight>0?'passed':'failed'}];
const protocol={ready:ready(),states:saved.states.map(s=>s.id),async runState(id){const state=saved.states.find(s=>s.id===id);if(!state)throw new Error('UNKNOWN_STATE');values={props:state.props,data:state.data};this.ready=ready();await this.ready;},getChecks:checks};
window.__COMPONENT_EXAMPLE__=protocol;
addEventListener('message',event=>{const expected=document.querySelector('meta[name="juz-parent"]')?.content;if(!expected||event.source!==parent||event.origin!==expected||event.data?.type!=='juz-connect'||event.ports.length!==1||port)return;port=event.ports[0];port.onmessage=async event=>{try{const message=event.data;if(message?.type==='values'&&message.values?.props&&typeof message.values.props==='object'&&!Array.isArray(message.values.props)){values=message.values;protocol.ready=ready();await protocol.ready;}else if(message?.type==='state'&&typeof message.id==='string')await protocol.runState(message.id);else return;send({type:'status',status:'ready',checks:checks()});}catch(error){send({type:'status',status:'error',message:String(error)});}};port.start();send({type:'status',status:'mounted'});protocol.ready.then(()=>send({type:'status',status:'ready',checks:checks()})).catch(error=>send({type:'status',status:'error',message:String(error)}));});
addEventListener('error',event=>{failure=event.message;send({type:'status',status:'error',message:failure});});
addEventListener('unhandledrejection',event=>send({type:'status',status:'error',message:String(event.reason)}));
addEventListener('pagehide',()=>{unmount();port?.close();},{once:true});
`;
}
export const consumerHtml='<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>组件预览</title><style>html,body,#app{margin:0;width:100%;height:100%;box-sizing:border-box}body{font-family:system-ui,sans-serif}#app{display:grid;place-items:stretch}</style></head><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>\n';
