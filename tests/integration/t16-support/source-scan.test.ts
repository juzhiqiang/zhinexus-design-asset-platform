import { describe, expect, it } from 'vitest';
import { expectBoundString } from './source-scan.js';
const sdk = "import { LineChart as SDKChart } from '@company/charts-react/line';";
const reject = (source: string, prop: 'data'|'onPointClick', key: string) => expect(() => expectBoundString(sdk+source,key,{framework:'react',prop})).toThrow();
describe('C review: only effective rendered SDK bindings count', () => {
  it('rejects statically unreachable JSX branches and discarded sequence elements', () => {
    reject('export default ()=> false ? <SDKChart data="source"/> : null;', 'data', 'source');
    reject('export default ()=> (<SDKChart data="source"/>, null);', 'data', 'source');
    reject('export default ()=> false && <SDKChart data="source"/>;', 'data', 'source');
    reject('export default ()=> true || <SDKChart data="source"/>;', 'data', 'source');
  });
  it('does not trace discarded call results into a data return value', () => {
    reject('const unused=()=>"source"; export default ()=> <SDKChart data={(()=>{unused();return []})()}/>;', 'data', 'source');
  });
  it('keeps unrelated parameter and local names outside the rendered lexical scope', () => {
    const source = sdk+'function unrelated(SDKChart:any){const source="wrong";return null} const source="source"; export default ()=> <SDKChart data={sources[source]} onPointClick={handlers["handler"]}/>;';
    expectBoundString(source,'source',{framework:'react',prop:'data'});
    expectBoundString(source,'handler',{framework:'react',prop:'onPointClick'});
  });
  it('accepts selected branches and the final rendered sequence value', () => {
    expectBoundString(sdk+'export default ()=> true ? <SDKChart data="source"/> : null;', 'source', {framework:'react',prop:'data'});
    expectBoundString(sdk+'export default ()=> (null, <SDKChart data="source"/>);', 'source', {framework:'react',prop:'data'});
  });
  it('rejects JSX in an unused function', () => {
    reject('function unused(){return <SDKChart data="source" onPointClick={()=>"handler"}/>}; export default ()=>null;', 'data', 'source');
    reject('function unused(){return <SDKChart data="source" onPointClick={()=>"handler"}/>}; export default ()=>null;', 'onPointClick', 'handler');
  });
  it('rejects a locally shadowed SDK import', () => {
    reject('export function C(){const SDKChart=()=>null; return <SDKChart data="source" onPointClick={()=>"handler"}/>}','data','source');
    reject('export function C(SDKChart:any){return <SDKChart data="source"/>}','data','source');
  });
  it('rejects unrelated callback statements and conditional tests', () => {
    reject('export default ()=> <SDKChart data={(()=>{0;"source";return []})()} onPointClick={()=>{0;"handler";return undefined}}/>;', 'data','source');
    reject('export default ()=> <SDKChart data={[]} onPointClick={()=>{0;"handler";return undefined}}/>;', 'onPointClick','handler');
    reject('export default ()=> <SDKChart data={"source"?[]:[]}/>;', 'data','source');
  });
  it('rejects overwritten or unknown spread props', () => {
    reject('export default ()=> <SDKChart data="source" {...{data:[]}}/>;', 'data','source');
    reject('export default ()=> <SDKChart onPointClick={()=>"handler"} {...{onPointClick:()=>undefined}}/>;', 'onPointClick','handler');
    reject('export default ()=> <SDKChart data="source" {...unknown}/>;', 'data','source');
  });
  it('accepts both effective props of an exported SDK component', () => {
    const source = sdk+'export function C({sources,handlers}:any){return <SDKChart data={sources["source"]} onPointClick={handlers["handler"]}/>}';
    expectBoundString(source,'source',{framework:'react',prop:'data'});
    expectBoundString(source,'handler',{framework:'react',prop:'onPointClick'});
  });
  it('rejects data from another React component', () => {
    reject('export default ()=> <><SDKChart data={[]} /><Other data="source" /></>;', 'data', 'source');
  });
  it('rejects a wrong prop and an untrusted import', () => {
    reject('export default ()=> <SDKChart title="source" />;', 'data', 'source');
    expect(() => expectBoundString('import {LineChart} from "./fake"; export default ()=> <LineChart data="source"/>;', 'source', {framework:'react',prop:'data'})).toThrow();
  });
  it('rejects Vue bindings from another component or a wrong event', () => {
    const vue = 'import {LineChart as SDKChart} from "@company/charts-vue/line";';
    expect(() => expectBoundString(`<script setup>${vue}</script><template><SDKChart :data="[]"/><Other data="source"/></template>`, 'source', {framework:'vue',prop:'data'})).toThrow();
    expect(() => expectBoundString(`<script setup>${vue}const cb=()=>"handler";</script><template><SDKChart @click="cb"/></template>`, 'handler', {framework:'vue',prop:'onPointClick'})).toThrow();
  });
  it('keeps source and callback evidence separate', () => {
    reject('const cb=()=>"source"; export default ()=> <SDKChart data={[]} onPointClick={cb}/>;', 'data', 'source');
  });
  it('tracks a trusted React alias and optional callback invocation', () => {
    const source = sdk+'const source="source"; export default ()=> <SDKChart data={sources[source]} onPointClick={e=>handlers["handler"]?.(e)}/>;';
    expectBoundString(source,'source',{framework:'react',prop:'data'});
    expectBoundString(sdk+'export default ()=> <SDKChart data={[]} onPointClick={e=>{handlers["handler"]?.(e)}}/>;', 'handler', {framework:'react',prop:'onPointClick'});
  });
  it('tracks Vue point-click and rejects unused callback body literals', () => {
    const vue = 'import {LineChart as SDKChart} from "@company/charts-vue/line";';
    expectBoundString(`<script setup>${vue}const cb=e=>handlers["handler"]?.(e);</script><template><SDKChart :data="sources['source']" @point-click="cb"/></template>`, 'handler', {framework:'vue',prop:'onPointClick'});
    reject('const cb=()=>{const unused="handler"; return []}; export default ()=> <SDKChart onPointClick={cb}/>;', 'onPointClick', 'handler');
  });
});
