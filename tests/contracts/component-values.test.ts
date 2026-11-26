import { describe, expect, it } from 'vitest';
import * as contracts from '../../packages/contracts/src/index.js';
import type { ComponentApiV1 } from '../../packages/contracts/src/component-api.js';

function api(): ComponentApiV1 {
  return {
    schemaVersion: 1, componentId: 'metric', framework: 'react', exportName: 'Metric', exportPath: '.',
    props: [
      { name: 'valueColor', type: 'string', required: false, schema: { type: 'string', title: '数字颜色', description: '只影响主数值', default: '#FF6B35' }, editor: { kind: 'color', group: '数值样式' } },
      { name: 'config', type: 'MetricConfig', required: true, schema: { type: 'object', properties: { precision: { type: 'integer', minimum: 0, maximum: 4 }, mode: { type: 'string', enum: ['sum', 'mean'] }, points: { type: 'array', items: { type: 'number' }, maxItems: 3 } }, required: ['precision'], additionalProperties: false } },
    ],
    events: [{ name: 'change', payload: 'MetricChange', schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false } }], notes: [],
  };
}

describe('共享组件参数契约', () => {
  it('保留旧 API，并接受可用于工作台、低代码和机器接入的结构化参数', () => {
    expect(contracts.validateComponentApi({ schemaVersion: 1, componentId: 'old', framework: 'vue', exportName: 'Old', exportPath: '.', props: [{ name: 'value', type: 'number', required: false }], events: [], notes: [] }).ok).toBe(true);
    expect(contracts.validateComponentApi(api()).ok).toBe(true);
  });

  it('使用同一契约验证嵌套对象、数组、枚举与边界，不改写输入或注入默认值', () => {
    const definition = api();
    const input = { config: { precision: 2, mode: 'sum', points: [0, 2] } };
    expect(contracts.validateComponentValues(definition, input)).toEqual({ ok: true, value: input });
    expect(Object.hasOwn(input, 'valueColor')).toBe(false);
    for (const config of [{}, { precision: 1.5 }, { precision: -1 }, { precision: 5 }, { precision: 2, mode: 'other' }, { precision: 2, points: [1, '2'] }, { precision: 2, points: [1, 2, 3, 4] }, { precision: 2, extra: true }]) {
      expect(contracts.validateComponentValues(definition, { config }).ok, JSON.stringify(config)).toBe(false);
    }
    expect(contracts.validateComponentValues(definition, {}).ok).toBe(false);
    expect(contracts.validateComponentValues(definition, { config: { precision: 2 }, valueColor: 'orange' }).ok).toBe(false);
  });

  it.each([
    { type: 'number', default: 'bad' },
    { type: 'number', minimum: 4, maximum: 2 },
    { type: 'string', enum: ['a', 'a'] },
    { type: 'string', enum: [4] },
    { type: 'object', properties: {}, required: ['missing'] },
    { type: 'array' },
    { type: 'string', $ref: 'https://example.invalid/schema' },
    { type: 'string', pattern: '(a+)+$' },
    { type: 'string', code: 'globalThis.unsafe = true' },
  ])('拒绝不受支持或自相矛盾的描述 %j', schema => {
    const input = api();
    input.props[0] = { name: 'value', type: 'unknown', required: false, schema } as ComponentApiV1['props'][number];
    expect(contracts.validateComponentApi(input).ok).toBe(false);
  });

  it('拒绝不匹配编辑器、非法默认颜色和危险属性键', () => {
    const mismatch = api(); mismatch.props[0]!.schema = { type: 'number' };
    expect(contracts.validateComponentApi(mismatch).ok).toBe(false);
    const color = api(); color.props[0]!.schema!.default = 'red';
    expect(contracts.validateComponentApi(color).ok).toBe(false);
    const dangerous = api(); dangerous.props[0]!.schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
    expect(contracts.validateComponentApi(dangerous).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('限制递归深度，防止输入描述耗尽校验预算', () => {
    const input = api(); let schema: NonNullable<ComponentApiV1['props'][number]['schema']> = { type: 'string' };
    for (let i = 0; i < 30; i++) schema = { type: 'array', items: schema };
    input.props[0] = { name: 'deep', type: 'unknown', required: false, schema };
    expect(contracts.validateComponentApi(input).ok).toBe(false);
  });

  it('拒绝与公开基础类型冲突的 Schema', () => {
    const mismatch = api(); mismatch.props[0] = { name: 'value', type: 'number', required: false, schema: { type: 'string' } };
    expect(contracts.validateComponentApi(mismatch).ok).toBe(false);
  });
  it('以 Unicode 字符检查字符串长度', () => {
    const strings = api(); strings.props = [{ name: 'text', type: 'string', required: true, schema: { type: 'string', minLength: 1, maxLength: 1 } }];
    expect(contracts.validateComponentValues(strings, { text: '😀' }).ok).toBe(true);
    expect(contracts.validateComponentValues(strings, { text: '😀😀' }).ok).toBe(false);
  });

  it('派生颜色、枚举、数值与 JSON 控件，允许旧控件显式覆盖且不污染描述', () => {
    const input = api();
    input.props.push({ name: 'size', type: 'number', required: false, schema: { type: 'number', minimum: 0, maximum: 10 } }, { name: 'mode', type: 'string', required: false, schema: { type: 'string', enum: ['sum', 'mean'] } });
    const before = JSON.stringify(input);
    expect(contracts.derivePlaygroundControls(input, [])).toEqual([
      { name: 'valueColor', kind: 'color', label: '数字颜色', description: '只影响主数值', group: '数值样式' },
      { name: 'config', kind: 'json' },
      { name: 'size', kind: 'number', min: 0, max: 10 },
      { name: 'mode', kind: 'enum', options: ['sum', 'mean'] },
    ]);
    expect(contracts.derivePlaygroundControls(input, [{ name: 'valueColor', kind: 'text' }])[0]!.kind).toBe('text');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('从结构化 Schema 生成安全 TypeScript 类型，字面量不能逃逸 Vue script 边界', () => {
    expect(contracts.componentValueType(api().props[1]!.schema!)).toBe('{ "precision": number; "mode"?: "sum" | "mean"; "points"?: Array<number> }');
    const output = contracts.componentValueType({ type: 'string', enum: ['</script><script>unsafe()</script>'] });
    expect(output).not.toContain('<');
    expect(output).toContain('\\u003c/script');
  });
});
