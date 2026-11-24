import { describe, expect, it } from 'vitest';
import type { DesignIdInputV1, DesignIdMappingV1, DesignElementV1 } from '@company/contracts';
import {
  MAPPING_JSON_SYNTAX_ERROR,
  buildDesignIdInput,
  groupElementsByDesignId,
  parseMappingJson,
} from '../../apps/admin/app/match/design-id-input.js';

/**
 * 二期 ID 规则匹配：设计 ID 配置/元素清单输入的 RED 基线测试
 * （`design-id-input.ts` 尚未创建）。
 *
 * 约定（与 `2026-11-15-phase2-match-plan-http.md` B 范围一致）：
 * - 纯本地输入构造，不发起任何网络请求、不自定义公共 DTO；
 * - 映射来自**显式规则 JSON**，元素清单来自逐行输入；两者都交给冻结契约
 *   `validateDesignIdMapping` / `validateDesignIdInput` 校验，不重写校验规则；
 * - ID 为不透明字符串：不切分、不 trim、不转大小写、不解释为正则/路径/脚本；
 * - 未知字段与重复映射/实例在本地拒绝（渲染安全字段路径），未知 designId 交服务端报缺口；
 * - 空配置/空元素合法，但不得被称为匹配成功。
 *
 * TDD 记录：实现文件缺失时本文件因无法解析导入而失败（RED）；由 C 在宿主确认 RED 后再实现转 GREEN。
 */

const designId = '设计/Line';

const mappingJson = (overrides: Partial<DesignIdMappingV1> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    ruleSetId: 'library',
    revision: 'draft-1',
    entries: [{ designId, framework: 'react', variantReleaseId: '00000000-0000-4000-8000-000000000001' }],
    ...overrides,
  });

const element = (instanceId: string, id = designId): DesignElementV1 => ({ instanceId, designId: id });

describe('parseMappingJson（显式规则 JSON）', () => {
  it('合法 JSON 解析为 DesignIdMappingV1，规则来源与条目原样保留', () => {
    const result = parseMappingJson(mappingJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe(1);
    expect(result.value.ruleSetId).toBe('library');
    expect(result.value.revision).toBe('draft-1');
    expect(result.value.entries).toHaveLength(1);
    expect(result.value.entries[0]).toEqual({
      designId,
      framework: 'react',
      variantReleaseId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('JSON 语法错误时本地拒绝，使用固定文案且不回显解析器原文', () => {
    const result = parseMappingJson('{"schemaVersion":1,');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('INVALID_SCHEMA');
    expect(result.issues[0]?.message).toBe(MAPPING_JSON_SYNTAX_ERROR);
    expect(result.issues[0]?.message).not.toContain('Unexpected');
    expect(result.issues[0]?.message).not.toContain('position');
  });

  it.each(['[]', 'null', '"text"', '42', 'true'])('非对象 JSON %s 被拒绝', (raw) => {
    const result = parseMappingJson(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe('INVALID_SCHEMA');
  });

  it('未知字段按契约路径拒绝，不指向根路径', () => {
    const result = parseMappingJson(mappingJson({ ocrText: 'screenshot' } as Partial<DesignIdMappingV1>));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_SCHEMA', path: '/ocrText' }),
    );
  });

  it('空白 designId 与超长 designId 指向具体条目路径', () => {
    const blank = parseMappingJson(
      JSON.stringify({ schemaVersion: 1, ruleSetId: 'r', revision: 'v', entries: [{ designId: ' ', framework: 'react', variantReleaseId: 'x' }] }),
    );
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.issues).toContainEqual(expect.objectContaining({ path: '/entries/0/designId' }));

    const tooLong = parseMappingJson(
      JSON.stringify({ schemaVersion: 1, ruleSetId: 'r', revision: 'v', entries: [{ designId: 'a'.repeat(2049), framework: 'react', variantReleaseId: 'x' }] }),
    );
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.issues).toContainEqual(expect.objectContaining({ path: '/entries/0/designId' }));
  });

  it('非法 framework 与缺少必填字段均被拒绝', () => {
    const badFramework = parseMappingJson(
      JSON.stringify({ schemaVersion: 1, ruleSetId: 'r', revision: 'v', entries: [{ designId, framework: 'svelte', variantReleaseId: 'x' }] }),
    );
    expect(badFramework.ok).toBe(false);
    if (badFramework.ok) return;
    expect(badFramework.issues).toContainEqual(expect.objectContaining({ path: '/entries/0/framework' }));

    const missing = parseMappingJson(JSON.stringify({ schemaVersion: 1, entries: [] }));
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.issues).toContainEqual(expect.objectContaining({ path: '/ruleSetId' }));
  });

  it('同一 designId/framework 重复映射即使目标相同也拒绝', () => {
    const result = parseMappingJson(
      JSON.stringify({
        schemaVersion: 1,
        ruleSetId: 'library',
        revision: 'draft-1',
        entries: [
          { designId, framework: 'react', variantReleaseId: '00000000-0000-4000-8000-000000000001' },
          { designId, framework: 'react', variantReleaseId: '00000000-0000-4000-8000-000000000001' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ID', path: '/entries/1/designId' }),
    );
  });

  it('同一 designId 可分别配置 Vue 与 React', () => {
    const result = parseMappingJson(
      JSON.stringify({
        schemaVersion: 1,
        ruleSetId: 'library',
        revision: 'draft-1',
        entries: [
          { designId, framework: 'react', variantReleaseId: 'release-react' },
          { designId, framework: 'vue', variantReleaseId: 'release-vue' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries).toHaveLength(2);
  });

  it('空条目列表合法（尚未配置），但不产生任何匹配结论', () => {
    const result = parseMappingJson(JSON.stringify({ schemaVersion: 1, ruleSetId: 'library', revision: 'draft-1', entries: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries).toEqual([]);
  });
});

describe('buildDesignIdInput（元素清单组装）', () => {
  const mapping = (): DesignIdMappingV1 => {
    const parsed = parseMappingJson(mappingJson());
    if (!parsed.ok) throw new Error('fixture mapping must be valid');
    return parsed.value;
  };

  it('不透明 ID 原值往返：不 trim、不转大小写、不切分、不解释为路径或正则', () => {
    for (const id of [' ID ', 'id', 'ID', '../line', 'a.*', '__proto__', 'constructor', 'line:1', 'line/1']) {
      const result = buildDesignIdInput({ mapping: mapping(), elements: [element(' node-1 ', id)] });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.elements[0]?.designId).toBe(id);
      expect(result.value.elements[0]?.instanceId).toBe(' node-1 ');
    }
  });

  it('仅分隔符/大小写不同的 ID 视为互不相同的设计', () => {
    const ids = ['line', 'line:1', 'line/1', 'line-1', 'line.1', 'Line'];
    const result = buildDesignIdInput({ mapping: mapping(), elements: ids.map((id, i) => element(`node-${i}`, id)) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.value.elements.map((e) => e.designId)).size).toBe(ids.length);
  });

  it('重复 instanceId 即使引用不同 designId 也拒绝', () => {
    const result = buildDesignIdInput({ mapping: mapping(), elements: [element('node-1'), element('node-1', 'other')] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ID', path: '/elements/1/instanceId' }),
    );
  });

  it('同一 designId 可被多个实例复用，且实例数量不丢失', () => {
    const result = buildDesignIdInput({
      mapping: mapping(),
      elements: [element('node-1'), element('node-2'), element('node-3')],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.elements).toHaveLength(3);
    expect(result.value.elements.every((e) => e.designId === designId)).toBe(true);
  });

  it('未知 designId 仍是通过校验的输入（缺口由服务端解析报告）', () => {
    const result = buildDesignIdInput({ mapping: mapping(), elements: [element('node-1', 'unconfigured')] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.elements[0]?.designId).toBe('unconfigured');
  });

  it('空配置与空元素合法，schemaVersion 固定为 1', () => {
    const emptyMapping = parseMappingJson(JSON.stringify({ schemaVersion: 1, ruleSetId: 'library', revision: 'draft-1', entries: [] }));
    expect(emptyMapping.ok).toBe(true);
    if (!emptyMapping.ok) return;
    const result = buildDesignIdInput({ mapping: emptyMapping.value, elements: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ schemaVersion: 1, mapping: emptyMapping.value, elements: [] });
  });

  it('嵌套输入下映射重复错误路径带 /mapping 前缀（口径锁定，随契约变更同步）', () => {
    const duplicated = {
      schemaVersion: 1 as const,
      ruleSetId: 'library',
      revision: 'draft-1',
      entries: [
        { designId, framework: 'react' as const, variantReleaseId: 'release-a' },
        { designId, framework: 'react' as const, variantReleaseId: 'release-b' },
      ],
    };

    // 顶层映射校验：路径不带前缀
    const mappingCheck = parseMappingJson(JSON.stringify(duplicated));
    expect(mappingCheck.ok).toBe(false);
    if (mappingCheck.ok) return;
    expect(mappingCheck.issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ID', path: '/entries/1/designId' }),
    );

    // 完整输入校验：同一重复以 /mapping 前缀呈现，供界面锚定到规则 JSON
    const result = buildDesignIdInput({ mapping: duplicated, elements: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ID', path: '/mapping/entries/1/designId' }),
    );
  });

  it('元素字段缺失或空白 instanceId 指向对应元素路径', () => {
    const missing = buildDesignIdInput({ mapping: mapping(), elements: [{ designId } as DesignElementV1] });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.issues).toContainEqual(expect.objectContaining({ path: '/elements/0/instanceId' }));

    const blank = buildDesignIdInput({ mapping: mapping(), elements: [element('  ')] });
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.issues).toContainEqual(expect.objectContaining({ path: '/elements/0/instanceId' }));
  });
});

describe('groupElementsByDesignId（多实例复用展示分组）', () => {
  const design = (): DesignIdInputV1 => {
    const parsed = buildDesignIdInput({
      mapping: (() => {
        const value = parseMappingJson(mappingJson());
        if (!value.ok) throw new Error('fixture mapping must be valid');
        return value.value;
      })(),
      elements: [element('node-1'), element('node-2'), element('node-3', 'other')],
    });
    if (!parsed.ok) throw new Error('fixture design must be valid');
    return parsed.value;
  };

  it('按 designId 分组且保留全部实例', () => {
    const groups = groupElementsByDesignId(design());
    expect(groups).toBeInstanceOf(Map);
    expect(groups.get(designId)).toHaveLength(2);
    expect(groups.get('other')).toHaveLength(1);
    expect(groups.size).toBe(2);
  });

  it('原型键形状的 ID 只作字符串：不污染原型、不遍历原型链', () => {
    const value = buildDesignIdInput({
      mapping: (() => {
        const parsed = parseMappingJson(mappingJson());
        if (!parsed.ok) throw new Error('fixture mapping must be valid');
        return parsed.value;
      })(),
      elements: [element('node-1', '__proto__'), element('node-2', 'constructor'), element('node-3', 'toString')],
    });
    expect(value.ok).toBe(true);
    if (!value.ok) return;

    const groups = groupElementsByDesignId(value.value);
    expect(groups.get('__proto__')).toHaveLength(1);
    expect(groups.get('constructor')).toHaveLength(1);
    expect(groups.get('toString')).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty('polluted')).toBe(false);
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain('polluted');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
