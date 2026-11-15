import { describe, expect, it } from 'vitest';
import { CONTRACT_SCHEMAS, validateProjectContext } from '@company/contracts';

const react = { framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.1.0', packageManager: 'pnpm', requirements: ['支持折线图'] };

describe('ProjectContext 输入边界', () => {
  // Removing framework/version/unknown-field validation must make these cases fail.
  it.each([
    react,
    { framework: 'vue', frameworkVersion: '3.5.45', packageManager: 'npm', requirements: [] },
    { ...react, frameworkVersion: '19.4.0-rc.1' },
  ])('保留合法精确版本及用户需求 %#', input => {
    expect(validateProjectContext(input)).toEqual({ ok: true, value: input });
  });

  it.each([
    { ...react, framework: 'angular' },
    { ...react, frameworkVersion: '^19.0.0' },
    { ...react, frameworkVersion: '19' },
    { ...react, frameworkVersion: '19.3.1+build' },
    { ...react, echartsVersion: '*' },
    { ...react, packageManager: 'yarn' },
    { ...react, requirements: ['  '] },
    { ...react, requirements: [42] },
    { ...react, requirements: ['a'.repeat(2049)] },
    { ...react, compatibility: 'passed' },
    { framework: 'react', frameworkVersion: '19.3.1', packageManager: 'pnpm' },
    null,
    new Date(),
  ])('拒绝不完整、可变版本或伪造信任状态 %#', input => {
    expect(validateProjectContext(input).ok).toBe(false);
  });

  it('提供指向出错字段的诊断，供表单定位', () => {
    const result = validateProjectContext({ ...react, frameworkVersion: '~19.3.1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/frameworkVersion' })]));
  });

  it('注册可供其他客户端使用的独立 JSON Schema', () => {
    expect(CONTRACT_SCHEMAS['project-context-v1']).toMatchObject({
      type: 'object', additionalProperties: false,
      required: ['framework', 'frameworkVersion', 'packageManager', 'requirements'],
    });
  });
});
