/**
 * T16 P1 React TSX 生成器。
 *
 * 职责：按**真实** SDK API 生成可编译的 React 客户端组件：
 * 组件与样式从权威 target 声明的包名 + 包内子路径导入；设计声明的数据源/事件处理
 * 以安全字符串键经宿主注册表传入；布局描述作为字符串数据落到宿主元素属性上。
 *
 * 边界：
 * - 业务源/事件名/布局文本只以字符串字面量出现，绝不拼进 JSX 表达式或脚本的求值位置；
 * - 不 eval、不 new Function、不 import()、不引用 node 内建模块；
 * - 未知/不安全的必需绑定在绑定模型阶段就已显式阻断，不会落到这里。
 */
import { BindingError, propsTypeText, reactEventProp, type GeneratedBindingModel } from './bindings.js';
import { jsSingleQuotedLiteral } from './generate-vue.js';

export function generateReactComponent(model: GeneratedBindingModel): string {
  if (model.bindings.length === 0) {
    throw new BindingError('BINDING_UNSUPPORTED', '权威组件 API 未声明任何可下发的属性或事件');
  }
  const typeImports = model.typeImports.length > 0 ? `import type { ${model.typeImports.join(', ')} } from '@company/charts-core';\n` : '';
  const reactTypeImports = (model.reactTypeImports ?? []).length > 0
    ? `import type { ${(model.reactTypeImports ?? []).join(', ')} } from 'react';\n`
    : '';
  const packageTypeImports = (model.packageTypeImports ?? []).length > 0
    ? `import type { ${(model.packageTypeImports ?? []).join(', ')} } from '${model.importSpecifier}';\n`
    : '';
  const layoutLine = model.layout !== undefined
    ? `\n/** 设计声明的布局描述。 */\nconst layout = ${jsSingleQuotedLiteral(model.layout)};\n`
    : '';
  const layoutAttribute = model.layout !== undefined ? ' data-layout={layout}' : '';

  const destructured: string[] = [];
  const attributeLines: string[] = [];
  for (const binding of model.bindings) {
    if (binding.kind === 'source') {
      destructured.push(binding.registry);
      attributeLines.push(`      ${binding.prop}={${binding.registry}[${jsSingleQuotedLiteral(binding.key)}]}`);
    } else if (binding.kind === 'passthrough') {
      destructured.push(binding.prop);
      attributeLines.push(`      ${binding.prop}={${binding.prop}}`);
    } else {
      attributeLines.push(`      ${reactEventProp(binding.event)}={handlers[${jsSingleQuotedLiteral(binding.key)}]}`);
    }
  }
  if (model.bindings.some(binding => binding.kind === 'event')) destructured.push('handlers');

  return `'use client';
import { ${model.exportName} as ${model.sdkIdentifier} } from '${model.importSpecifier}';
import '${model.styleSpecifier}';
${typeImports}${reactTypeImports}${packageTypeImports}
/**
 * ${model.componentName}：Zhinexus design-id 接入组件（由接入计划生成）。
 * 设计声明的数据源、事件处理与布局均以字符串数据下发，绝不被当作代码求值。
 */
${layoutLine}
export type ${model.componentName}Props = {
${propsTypeText(model)}
};

export function ${model.componentName}({ ${destructured.join(', ')} }: ${model.componentName}Props) {
  return (
    <div className="zhinexus-chart-host"${layoutAttribute}>
      <${model.sdkIdentifier}
${attributeLines.join('\n')}
      />
    </div>
  );
}
`;
}
