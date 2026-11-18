/**
 * T16 P1 Vue SFC 生成器。
 *
 * 职责：按**真实** SDK API 生成可编译的 Vue 单文件组件：
 * 组件与样式从权威 target 声明的包名 + 包内子路径导入；设计声明的数据源/事件处理
 * 以安全字符串键经宿主注册表传入；布局描述作为字符串数据落到宿主元素属性上。
 *
 * 边界：
 * - 业务源/事件名/布局文本只以字符串字面量出现，绝不拼进模板表达式或脚本的求值位置；
 * - 不 eval、不 new Function、不 import()、不引用 node 内建模块；
 * - 未知/不安全的必需绑定在绑定模型阶段就已显式阻断，不会落到这里。
 */
import { BindingError, propsTypeText, vueEventListener, vuePropName, type GeneratedBindingModel } from './bindings.js';

/** 生成 SFC 用的 JS 单引号字符串字面量：控制字符与引号全部显式转义。 */
export function jsSingleQuotedLiteral(value: string): string {
  let out = "'";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "'") out += "\\'";
    else if (character === '\\') out += '\\\\';
    else if (character === '\n') out += '\\n';
    else if (character === '\r') out += '\\r';
    else if (character === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += character;
  }
  return `${out}'`;
}

/** 模板属性值：字符串键一律走单引号字面量（HTML 属性用双引号定界）。 */
function templateKeyLiteral(value: string): string {
  return jsSingleQuotedLiteral(value);
}

/**
 * 共享 literal 策略的 HTML 边界防护（布局描述与数据源/事件处理键同查）。
 *
 * JS 引号转义只解决 JS 解析层，不构成 HTML/SFC 边界：`</script>`（大小写混合）
 * 直接终止 setup script 块并注入普通 script；`"` 可逃逸模板双引号属性定界。
 * 含 `<` / `>` / `"` 任一字符的值一律 BINDING_UNSUPPORTED 失败关闭（生成器抛出即零写入）；
 * 不含边界字符的合法值仍按原值进入字面量，不做转义替换（HTML 边界保护不靠引号转义）。
 */
export function assertHtmlBoundarySafe(value: string, what: string): void {
  for (const character of value) {
    if (character === '<' || character === '>' || character === '"') {
      throw new BindingError('BINDING_UNSUPPORTED', `${what}含有 HTML/SFC 边界字符，可能终止 block 或逃逸属性定界，拒绝生成`);
    }
  }
}

export function generateVueComponent(model: GeneratedBindingModel): string {
  if (model.bindings.length === 0) {
    throw new BindingError('BINDING_UNSUPPORTED', '权威组件 API 未声明任何可下发的属性或事件');
  }
  if (model.layout !== undefined) {
    assertHtmlBoundarySafe(model.layout, '设计声明的布局描述');
  }
  const typeImports = model.typeImports.length > 0 ? `import type { ${model.typeImports.join(', ')} } from '@company/charts-core';\n` : '';
  const layoutLine = model.layout !== undefined
    ? `\n/** 设计声明的布局描述。 */\nconst layout = ${jsSingleQuotedLiteral(model.layout)};\n`
    : '';
  const layoutAttribute = model.layout !== undefined ? ' :data-layout="layout"' : '';

  const propsLines: string[] = [];
  const eventLines: string[] = [];
  for (const binding of model.bindings) {
    if (binding.kind === 'source') {
      assertHtmlBoundarySafe(binding.key, '设计声明的数据源键名');
      propsLines.push(`      :${vuePropName(binding.prop)}="${binding.registry}[${templateKeyLiteral(binding.key)}]"`);
    } else if (binding.kind === 'passthrough') {
      propsLines.push(`      :${vuePropName(binding.prop)}="${binding.prop}"`);
    } else {
      assertHtmlBoundarySafe(binding.key, '设计声明的事件处理键名');
      eventLines.push(`      @${vueEventListener(binding.event)}="handlers[${templateKeyLiteral(binding.key)}]"`);
    }
  }

  return `<script setup lang="ts">
import { ${model.exportName} as ${model.sdkIdentifier} } from '${model.importSpecifier}';
import '${model.styleSpecifier}';
${typeImports}
/**
 * ${model.componentName}：Zhinexus design-id 接入组件（由接入计划生成）。
 * 设计声明的数据源、事件处理与布局均以字符串数据下发，绝不被当作代码求值。
 */
${layoutLine}
defineProps<{
${propsTypeText(model)}
}>();
</script>

<template>
  <div class="zhinexus-chart-host"${layoutAttribute}>
    <${model.sdkIdentifier}
${[...propsLines, ...eventLines].join('\n')}
    />
  </div>
</template>
`;
}
