import { describe, expect, it } from 'vitest';
import { buildProjectContext } from '../../apps/gallery/app/lib/project-context-form.js';

/**
 * 二期 B1：`/match` 项目上下文本地校验的行为测试。
 *
 * 约定（与 kickoff 计划 B1 一致）：
 * - `buildProjectContext(fields)` 位于 `apps/gallery/app/lib/project-context-form.ts`；
 * - 入参 `fields` 的 `framework/frameworkVersion/echartsVersion/packageManager` 为字符串、
 *   `requirements` 为字符串数组；
 * - 返回 `@company/contracts` 的 `ValidationResult<ProjectContext>`；
 * - 转换层只做「空白可选 ECharts 版本省略」的规整，其余一律交给契约 `validateProjectContext` 校验，
 *   不自行定义公共校验规则、不虚构兼容状态、不调用任何检索/匹配端点。
 *
 * TDD 记录：宿主最初因无法解析 `project-context-form.js` 确认 RED，随后实现使其转 GREEN。
 */

type ContextFields = {
  framework: string;
  frameworkVersion: string;
  echartsVersion: string;
  packageManager: string;
  requirements: string[];
};

function fields(overrides: Partial<ContextFields> = {}): ContextFields {
  return {
    framework: 'vue',
    frameworkVersion: '3.5.45',
    echartsVersion: '', // 默认留空以验证「空白可选 ECharts 省略」
    packageManager: 'pnpm',
    requirements: [],
    ...overrides,
  };
}

describe('buildProjectContext（二期项目上下文本地校验）', () => {
  it('接受 Vue 与 React 两种框架的合法精确版本', () => {
    for (const framework of ['vue', 'react'] as const) {
      const version = framework === 'vue' ? '3.5.45' : '19.3.1';
      const result = buildProjectContext(fields({ framework, frameworkVersion: version }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.framework).toBe(framework);
        expect(result.value.frameworkVersion).toBe(version);
      }
    }
  });

  it('空白可选 ECharts 版本被省略，不进入校验对象', () => {
    const result = buildProjectContext(fields({ echartsVersion: '   ' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.prototype.hasOwnProperty.call(result.value, 'echartsVersion')).toBe(false);
    }
  });

  it('提供精确 ECharts 版本时保留该字段', () => {
    const result = buildProjectContext(fields({ echartsVersion: '6.1.0' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.echartsVersion).toBe('6.1.0');
    }
  });

  it('保留空的 requirements 数组', () => {
    const result = buildProjectContext(fields({ requirements: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requirements).toEqual([]);
    }
  });

  it('拒绝空白需求项', () => {
    const result = buildProjectContext(fields({ requirements: ['销售数据看板', '   '] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.includes('requirements'))).toBe(true);
    }
  });

  it('拒绝版本范围（非精确 semver）', () => {
    const result = buildProjectContext(fields({ frameworkVersion: '^3.0.0' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.includes('frameworkVersion'))).toBe(true);
    }
  });

  it('缺必填字段走错误路径', () => {
    const missing = {
      framework: 'vue',
      frameworkVersion: '3.5.45',
      echartsVersion: '',
      requirements: [],
    } as unknown as ContextFields;
    const result = buildProjectContext(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.includes('packageManager'))).toBe(true);
    }
  });

  it('不虚构兼容状态：成功结果仅含 ProjectContext 字段', () => {
    const result = buildProjectContext(fields());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const keys = Object.keys(result.value).sort();
      expect(keys).toEqual(['framework', 'frameworkVersion', 'packageManager', 'requirements']);
      expect(Object.prototype.hasOwnProperty.call(result.value, 'compatibility')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result.value, 'compatibilityStatus')).toBe(false);
    }
  });

  it('不虚构兼容状态：输入夹带兼容字段也不会进入成功结果', () => {
    const smuggled = {
      ...fields(),
      compatibilityStatus: 'passed',
    } as unknown as ContextFields;
    const result = buildProjectContext(smuggled);
    // 由契约以 additionalProperties:false 拒绝未知字段，或转换层不透传——二者都满足“不虚构”
    if (result.ok) {
      expect(Object.prototype.hasOwnProperty.call(result.value, 'compatibilityStatus')).toBe(false);
    } else {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});
