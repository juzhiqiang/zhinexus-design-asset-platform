import { describe, expect, it } from 'vitest';
import * as contracts from '@company/contracts';

const entry = { designId: '设计:图表/Line', framework: 'react', variantReleaseId: 'release-react-1' };
const mapping = () => ({ schemaVersion: 1, ruleSetId: 'design-library', revision: 'draft-1', entries: [{ ...entry }] });
const input = () => ({ schemaVersion: 1, mapping: mapping(), elements: [{ instanceId: 'page:node/1', designId: entry.designId }] });

describe('设计 ID 配置契约（不是发布资格证明）', () => {
  it('导出配置与输入校验器', () => {
    expect(contracts.validateDesignIdMapping).toBeTypeOf('function');
    expect(contracts.validateDesignIdInput).toBeTypeOf('function');
  });
  it('保留规则来源和不透明 ID，不规范化或解释字符串', () => {
    for (const designId of ['设计:图表/Line', ' ID ', 'id', 'ID', '../line', '__proto__', 'constructor', 'a.*']) {
      const value = { ...mapping(), entries: [{ ...entry, designId }] };
      expect(contracts.validateDesignIdMapping(value)).toEqual({ ok: true, value });
    }
  });
  it('区分两框架，并允许多个设计 ID 显式指向同一发布', () => {
    const value = mapping();
    value.entries.push({ ...entry, framework: 'vue', variantReleaseId: 'release-vue-1' }, { ...entry, designId: 'another-id' });
    expect(contracts.validateDesignIdMapping(value)).toEqual({ ok: true, value });
  });
  it.each(['release-react-1', 'conflicting-release'])('拒绝相同 ID/框架重复映射，目标为 %s', variantReleaseId => {
    const value = mapping();
    value.entries.push({ ...entry, variantReleaseId });
    const result = contracts.validateDesignIdMapping(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_ID', path: '/entries/1/designId' }));
  });
  it('映射重复通过嵌套输入仍须拒绝，并提供嵌套字段路径', () => {
    const value = input(); value.mapping.entries.push({ ...entry });
    const result = contracts.validateDesignIdInput(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('/mapping/entries/1/designId');
  });
  it('不同实例可复用设计 ID', () => {
    const value = input(); value.elements.push({ instanceId: 'node-2', designId: entry.designId });
    expect(contracts.validateDesignIdInput(value)).toEqual({ ok: true, value });
  });
  it('相同实例即使引用不同设计 ID 也拒绝', () => {
    const value = input(); value.elements.push({ instanceId: value.elements[0]!.instanceId, designId: 'other-id' });
    const result = contracts.validateDesignIdInput(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_ID', path: '/elements/1/instanceId' }));
  });
  it('未知 ID 与缺框架映射不是格式错误，留给解析阶段报告缺口', () => {
    const value = input(); value.elements.push({ instanceId: 'unknown-node', designId: 'unconfigured' });
    expect(contracts.validateDesignIdInput(value)).toEqual({ ok: true, value });
    value.mapping.entries[0]!.framework = 'vue';
    expect(contracts.validateDesignIdInput(value).ok).toBe(true);
  });
  it('允许尚未配置的空列表，不生成成功匹配或信任属性', () => {
    const value = { schemaVersion: 1, mapping: { ...mapping(), entries: [] }, elements: [] };
    expect(contracts.validateDesignIdInput(value)).toEqual({ ok: true, value });
    expect(contracts.validateDesignIdMapping({ ...mapping(), entries: [] }).ok).toBe(true);
  });
  it.each([
    null, new Date(), {}, { ...mapping(), schemaVersion: 2 }, { ...mapping(), schemaVersion: '1' },
    { ...mapping(), ruleSetId: ' ' }, { ...mapping(), revision: 1 }, { ...mapping(), revision: '' },
    { ...mapping(), ready: true }, { ...mapping(), entries: {} },
    { ...mapping(), entries: [{ ...entry, framework: 'angular' }] },
    { ...mapping(), entries: [{ ...entry, designId: '' }] },
    { ...mapping(), entries: [{ ...entry, designId: 'x'.repeat(2049) }] },
    { ...mapping(), entries: [{ ...entry, variantReleaseId: '' }] },
    { ...mapping(), entries: [{ ...entry, packageVersion: 'latest' }] },
    { ...mapping(), entries: [{ ...entry, compatibility: 'verified' }] },
  ])('拒绝非法配置或额外信任声明 %#', value => {
    expect(contracts.validateDesignIdMapping(value).ok).toBe(false);
  });
  it.each([
    null, {}, { ...input(), schemaVersion: 2 }, { ...input(), elements: null },
    { ...input(), elements: [{ designId: 'id' }] },
    { ...input(), elements: [{ instanceId: ' ', designId: 'id' }] },
    { ...input(), elements: [{ instanceId: 'node', designId: 'id', source: 'local-automatic' }] },
    { ...input(), matched: true },
  ])('拒绝非法实例输入 %#', value => {
    expect(contracts.validateDesignIdInput(value).ok).toBe(false);
  });
  it('不使用对象属性索引判定 ID 唯一性', () => {
    const value = { ...input(), elements: [{ instanceId: '__proto__', designId: 'id' }, { instanceId: 'constructor', designId: 'id' }] };
    expect(contracts.validateDesignIdInput(value).ok).toBe(true);
    value.elements.push({ instanceId: '__proto__', designId: 'other' });
    expect(contracts.validateDesignIdInput(value).ok).toBe(false);
  });
  it('提供两个独立可生成的 JSON Schema', () => {
    expect(contracts.CONTRACT_SCHEMAS['design-id-mapping-v1']).toMatchObject({ type: 'object', additionalProperties: false });
    expect(contracts.CONTRACT_SCHEMAS['design-id-input-v1']).toMatchObject({ required: ['schemaVersion', 'mapping', 'elements'] });
  });
});
