import { describe, expect, it } from 'vitest';
import * as c from '@company/contracts';
import { componentApiFixture, matchPlanFixture, matchRequestFixture } from '../fixtures/match-plan.js';

describe('确定性装配契约', () => {
  it('接受版本化 API，保留真实框架事件', () => {
    for (const framework of ['vue','react'] as const) expect(c.validateComponentApi(componentApiFixture(framework)).ok).toBe(true);
  });
  it.each([{}, { ...componentApiFixture(), schemaVersion: 2 }, { ...componentApiFixture(), props: [{ name: 'data', type: 'ChartData', required: 'yes' }] },
    { ...componentApiFixture(), events: [{ name: 'a.b', payload: 'ChartEvent' }] }, { ...componentApiFixture(), styleExport: '../style.css' },
    { ...componentApiFixture(), readyMethod: 'x();' }, { ...componentApiFixture(), trusted: true }])('拒绝不完整/旧/可执行形状元数据 %#', value => expect(c.validateComponentApi(value).ok).toBe(false));
  it('拒绝重复 API 字段或跨 props/events 重名', () => {
    const api = componentApiFixture(); api.props.push({ ...api.props[0]! }); expect(c.validateComponentApi(api).ok).toBe(false);
    const collision = componentApiFixture(); collision.events[0]!.name = 'data'; expect(c.validateComponentApi(collision).ok).toBe(false);
  });
  it('接受无绑定请求及显式未知 ID，合法绑定只能引用现有实例', () => {
    const request = matchRequestFixture(); expect(c.validateMatchPlanRequest(request).ok).toBe(true);
    const binding = { instanceId: 'node-1', props: [{ name: 'data', source: 'sales.total' }], events: [{ name: 'point-click', handler: 'show' }], layout: 'grid' };
    expect(c.validateMatchPlanRequest({ ...request, bindings: [binding] }).ok).toBe(true);
    expect(c.validateMatchPlanRequest({ ...request, bindings: [{ ...binding, instanceId: 'missing' }] }).ok).toBe(false);
    expect(c.validateMatchPlanRequest({ ...request, bindings: [binding, binding] }).ok).toBe(false);
    expect(c.validateMatchPlanRequest({ ...request, bindings: [{ ...binding, props: [binding.props[0], binding.props[0]] }] }).ok).toBe(false);
  });
  it('请求拒绝重复设计映射、伪造身份、无效 peer 和超量元素', () => {
    const request = matchRequestFixture(); request.design.mapping.entries.push({ ...request.design.mapping.entries[0]! });
    expect(c.validateMatchPlanRequest(request).ok).toBe(false);
    expect(c.validateMatchPlanRequest({ ...matchRequestFixture(), subject: 'admin' }).ok).toBe(false);
    expect(c.validateMatchPlanRequest({ ...matchRequestFixture(), reactDomVersion: '^19' }).ok).toBe(false);
    const tooMany = matchRequestFixture(); tooMany.design.elements = Array.from({length:1001},(_,i)=>({instanceId:String(i),designId:'id'}));
    expect(c.validateMatchPlanRequest(tooMany).ok).toBe(false);
  });
  it('方案接受可映射目标和缺口，拒绝伪装完整结果', () => {
    expect(c.validateMatchPlan(matchPlanFixture()).ok).toBe(true);
    const plan = matchPlanFixture(); plan.elements.push({...plan.elements[0]!}); expect(c.validateMatchPlan(plan).ok).toBe(false);
    expect(c.validateMatchPlan({ ...matchPlanFixture(), confidence: 1 }).ok).toBe(false);
    expect(c.validateMatchPlan({ ...matchPlanFixture(), inputDigest: 'bad' }).ok).toBe(false);
    const noTarget = matchPlanFixture(); delete (noTarget.elements[0] as {target?:unknown}).target; expect(c.validateMatchPlan(noTarget).ok).toBe(false);
    const wrong = matchPlanFixture(); (wrong.elements[0]!.target as {framework:string}).framework = 'react'; expect(c.validateMatchPlan(wrong).ok).toBe(false);
    const noDeps = matchPlanFixture(); noDeps.exactDependencies=[]; expect(c.validateMatchPlan(noDeps).ok).toBe(false);
  });
  it('缺口节点不得带目标/映射；空设计必须说明缺口', () => {
    const element = { instanceId: 'node-1', designId: 'id', status: 'gap', props: [], events: [], gaps: [{code:'UNMAPPED_ID',message:'未配置'}] };
    expect(c.validateMatchPlan({...matchPlanFixture(), elements:[element],exactDependencies:[]}).ok).toBe(true);
    expect(c.validateMatchPlan({...matchPlanFixture(), elements:[{...element,target:matchPlanFixture().elements[0]!.target}]}).ok).toBe(false);
    expect(c.validateMatchPlan({...matchPlanFixture(),elements:[],exactDependencies:[]}).ok).toBe(false);
  });
  it('注册生成 schema', () => {
    for(const name of ['component-api-v1','match-plan-request-v1','match-plan-v1']) expect(c.CONTRACT_SCHEMAS[name]).toBeDefined();
  });
});
