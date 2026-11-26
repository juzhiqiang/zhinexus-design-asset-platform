import {expect,it} from 'vitest';
import type {ComponentApiV1} from '../../packages/component-cli/src/contracts/component-api.js';
import type {MatchElement} from '../../packages/component-cli/src/contracts/match-plan.js';
import {resolveBindingModel} from '../../packages/component-cli/src/integration/bindings.js';
import {generateReactComponent} from '../../packages/component-cli/src/integration/generate-react.js';
import {generateVueComponent} from '../../packages/component-cli/src/integration/generate-vue.js';

function fixture(framework:'react'|'vue'){
 const api:ComponentApiV1={schemaVersion:1,componentId:'metric',framework,exportName:'Metric',exportPath:'.',notes:[],props:[
  {name:'config',type:'MetricConfig',required:false,schema:{type:'object',properties:{digits:{type:'integer'},unit:{type:'string',enum:['元','万元']}},required:['digits'],additionalProperties:false},editor:{kind:'json'}},
  {name:'data',type:'number[]',required:false,schema:{type:'array',items:{type:'number'}}}],
  events:[{name:'change',payload:'MetricChange',schema:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}}]};
 const element:MatchElement={instanceId:'card1',designId:'metric',status:'mapped',props:structuredClone(api.props),events:api.events.map(e=>({...e,handler:'changed'})),gaps:[]};
 return {api,element,packageName:'ordinary-metric',exportName:api.exportName,exportPath:api.exportPath};
}
it.each(['react','vue'] as const)('%s 普通组件根导出不强制 CSS，结构化类型不猜测包内类型导出',framework=>{
 const model=resolveBindingModel(fixture(framework)),source=framework==='react'?generateReactComponent(model):generateVueComponent(model);
 expect(model.importSpecifier).toBe('ordinary-metric');expect(model.styleSpecifier).toBeUndefined();
 expect(source).not.toContain('charts-core');expect(source).not.toContain('undefined');expect(source).not.toContain('.css');
 expect(source).toContain('config?: { "digits": number; "unit"?: "元" | "万元" }');expect(source).toContain('data?: Array<number>');expect(source).toContain('(event: { "value": number }) => void');
});
it('结构化描述被离线计划篡改时失败关闭',()=>{
 const input=fixture('react');input.element.props[0]!.schema!.required=[];
 expect(()=>resolveBindingModel(input)).toThrow('API');
 const events=fixture('vue');delete events.element.events[0]!.schema;
 expect(()=>resolveBindingModel(events)).toThrow('API');
});
