import type { ProjectVariant } from '../project/config.js';
import type { ComponentApiV1 } from '../contracts/component-api.js';
export const templateVersions = { react:'19.3.1', vue:'3.5.45', vite:'8.3.8', typescript:'7.0.2', reactPlugin:'6.3.0', vuePlugin:'6.0.10' };
export function initialPlayground() { return { schemaVersion:1, adapter:'auto', props:{label:'Hello juz',value:42,enabled:true,color:'#A3D2FF'}, data:[12,24,36], dataProp:'data', controls:[{name:'label',kind:'text'},{name:'value',kind:'number'},{name:'enabled',kind:'boolean'},{name:'color',kind:'color'}], states:[{id:'default',label:'默认',props:{label:'Hello juz',value:42,enabled:true,color:'#A3D2FF'},data:[12,24,36]},{id:'empty',label:'空数据',props:{label:'No data',value:0,enabled:true,color:'#A3D2FF'},data:[]}] }; }
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
