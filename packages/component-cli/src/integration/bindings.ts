/**
 * T16 P1 生成器共用的绑定模型。
 *
 * 职责：把 MatchPlan 元素与**权威** ComponentApiV1 折算成“安全字符串键 + 显式 props/callbacks”
 * 的适配描述。设计声明的数据源名、事件处理名与布局描述一律作为**字符串数据**进入生成文件，
 * 绝不被拼进任何求值位置（不 eval、不 new Function、不拼接业务表达式）。
 *
 * 边界：
 * - 只接受权威 API 已声明的属性/事件；离线元素与权威 API 任何不一致都显式失败关闭；
 * - 绑定键名必须命中安全形态，`__proto__` / `constructor` / `prototype` 一律拒绝；
 * - 类型文本按权威框架安全解析：核心类型只允许 `@company/charts-core` 已导出的类型名；
 *   React 框架类型（CSSProperties / Ref）来自 'react'，`Ref<...Handle | null>` 的句柄类型
 *   只允许 SDK 真实导出的句柄白名单；未知/不安全类型一律显式阻断，不拼接类型文本。
 */
import { validateComponentApi, type ComponentApiV1 } from '../contracts/component-api.js';
import { componentValueType, sameComponentMember, type ComponentValueSchemaV1 } from '../contracts/component-values.js';
import type { MatchElement } from '../contracts/match-plan.js';

/** 生成器失败：调用方映射为固定的 BINDING_UNSUPPORTED / API_MISMATCH issue。 */
export class BindingError extends Error {
  readonly code: 'BINDING_UNSUPPORTED' | 'API_MISMATCH';

  constructor(code: 'BINDING_UNSUPPORTED' | 'API_MISMATCH', message: string) {
    super(message);
    this.name = 'BindingError';
    this.code = code;
  }
}

/** 设计声明的数据源/事件处理键名：仅限安全键形态，且不得命中原型链危险键。 */
const SAFE_BINDING_KEY = /^[A-Za-z0-9_$][A-Za-z0-9_$./-]{0,127}$/;
const DANGEROUS_BINDING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** 生成的 TypeScript 标识符（组件名、props 名）只允许这种形态。 */
const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * `@company/charts-core` 确实导出的图表相关类型名。
 * 生成文件只能 import 这里的类型：权威 API 声明了名单外的类型名时显式阻断，
 * 不把不可证实的类型名写进消费者的编译单元。
 */
export const SUPPORTED_CORE_TYPES = new Set([
  'AnyChartConfig', 'BarChartConfig', 'BarChartOption', 'ChartComponentOption', 'ChartConfig',
  'ChartController', 'ChartData', 'ChartEvent', 'ChartPoint', 'ChartSeries', 'ChartType',
  'LineChartConfig', 'LineChartOption', 'PieChartConfig', 'PieChartOption', 'PointClickListener',
  'ProportionChartConfig', 'ProportionChartOption', 'ProportionShare', 'RankingChartConfig',
  'RankingChartOption', 'RankingDirection', 'RankingEntry', 'Renderer', 'ScatterChartConfig',
  'ScatterChartOption', 'SupportedOptionOverrides', 'ThemeName', 'TrendCardConfig',
  'TrendCardOption', 'TrendSummary', 'UnitSpec', 'Unsubscribe',
]);

/** 属性绑定：`data` 之类的数据属性按设计声明的键名从宿主注册表取真实值。 */
export type SourceBinding = {
  kind: 'source';
  /** 权威 API 声明的属性名（camelCase）。 */
  prop: string;
  /** 权威 API 声明的属性类型。 */
  type: string;
  /** 设计声明的数据源键名（纯字符串数据）。 */
  key: string;
  required: boolean;
  /** 生成组件上承载注册表的 props 名，如 `dataSources`。 */
  registry: string;
};

/** 透传绑定：设计未绑定数据源的可选属性，由宿主直接传入。 */
export type PassthroughBinding = {
  kind: 'passthrough';
  prop: string;
  type: string;
  required: boolean;
};

/** 事件绑定：设计声明的事件处理键名（纯字符串数据），经宿主注册表取真实回调。 */
export type EventBinding = {
  kind: 'event';
  /** 权威 API 声明的事件名（kebab-case，如 `point-click`）。 */
  event: string;
  /** 权威 API 声明的事件载荷类型。 */
  payload: string;
  /** 设计声明的事件处理键名（纯字符串数据）。 */
  key: string;
};

export type ResolvedBinding = SourceBinding | PassthroughBinding | EventBinding;

export type GeneratedBindingModel = {
  /** 权威 target 的导出名，如 `LineChart`。 */
  exportName: string;
  /** 生成文件中的 SDK 引用标识符，如 `SDKLineChart`。 */
  sdkIdentifier: string;
  /** 包内子路径导入说明符，如 `@company/charts-vue/line`。 */
  importSpecifier: string;
  /** 样式导入说明符，如 `@company/charts-vue/style.css`。 */
  styleSpecifier?: string;
  /** 生成组件的导出名，如 `ZhinexusLineChart`。 */
  componentName: string;
  bindings: ResolvedBinding[];
  /** 设计声明的布局描述；缺失时不下发布局属性。 */
  layout?: string;
  /** 需要从 `@company/charts-core` 导入的类型名（去重、有序）。 */
  typeImports: string[];
  /** 需要从 'react' 导入的框架类型名（仅 React 生成使用；可选以兼容既有构造方；去重、有序）。 */
  reactTypeImports?: string[];
  /** 需要从 charts SDK 包导入的句柄类型名（仅 React 生成使用；可选以兼容既有构造方；去重、有序）。 */
  packageTypeImports?: string[];
};

function safeKey(value: string | undefined, what: string): string {
  if (value === undefined || value.length === 0) {
    throw new BindingError('BINDING_UNSUPPORTED', `${what}缺失或为空，拒绝伪造绑定`);
  }
  if (!SAFE_BINDING_KEY.test(value) || DANGEROUS_BINDING_KEYS.has(value)) {
    throw new BindingError('BINDING_UNSUPPORTED', `${what}不是安全的字符串键，拒绝作为代码使用`);
  }
  return value;
}

/** TypeScript 内建类型关键字：语言原生类型，无需任何导入即可在生成文件中使用。 */
const BUILTIN_TYPE_KEYWORDS = new Set([
  'string', 'number', 'boolean', 'null', 'undefined', 'void', 'never', 'unknown', 'object', 'symbol', 'bigint',
]);

/** React 框架从 'react' 导入的类型（权威 React SDK API 审计矩阵实际使用的类型）。 */
const REACT_FRAMEWORK_TYPES = new Set(['CSSProperties', 'Ref']);

/** `Ref<...Handle | null>` 形态：句柄类型必须是 SDK 真实导出的组件句柄白名单成员。 */
const REACT_REF_PATTERN = /^Ref<([A-Za-z_$][A-Za-z0-9_$]*)\s*\|\s*null>$/;

/**
 * `@company/charts-react` 7 个 React 实现真实导出的组件句柄类型（根与各自子路径均有导出，
 * 与 A 的 SDK API 审计矩阵逐一对应）。
 */
const SUPPORTED_REACT_HANDLE_TYPES = new Set([
  'BarChartHandle', 'LineChartHandle', 'PieChartHandle', 'ProportionHandle',
  'RankingHandle', 'ScatterChartHandle', 'TrendCardHandle',
]);

function safeType(value: string, what: string): string {
  if (BUILTIN_TYPE_KEYWORDS.has(value)) return value;
  if (!SAFE_IDENTIFIER.test(value) || !SUPPORTED_CORE_TYPES.has(value)) {
    throw new BindingError('BINDING_UNSUPPORTED', `${what}不是受支持的图表核心类型，拒绝生成不可证实的导入`);
  }
  return value;
}

/** 类型解析结果：text 原样进入 props 类型文本；导入按来源拆分，绝不混入错误模块。 */
type ResolvedPropType = {
  text: string;
  /** 需要从 `@company/charts-core` 导入的类型名。 */
  coreTypes: string[];
  /** 需要从 'react' 导入的框架类型名。 */
  reactTypes: string[];
  /** 需要从 charts SDK 包导入的句柄类型名。 */
  packageTypes: string[];
};

/**
 * 按权威框架安全解析类型文本：
 * - 内建关键字原样放行且不产生任何导入；
 * - 核心图表类型只允许 `@company/charts-core` 白名单（Vue/React 通用）；
 * - React 框架类型（CSSProperties / Ref）只来自 'react'；
 * - `Ref<...Handle | null>` 的句柄类型只允许 SDK 真实导出的句柄白名单，
 *   不按 “合法标识符 + Handle 后缀” 猜测不存在的 SDK 类型；
 * - 其余类型一律显式阻断，绝不拼接不可证实的导入。
 */
function resolvePropType(
  value: string,
  what: string,
  framework: ComponentApiV1['framework'],
  schema?: ComponentValueSchemaV1,
): ResolvedPropType {
  if (schema) return { text: componentValueType(schema), coreTypes: [], reactTypes: [], packageTypes: [] };
  if (BUILTIN_TYPE_KEYWORDS.has(value)) {
    return { text: value, coreTypes: [], reactTypes: [], packageTypes: [] };
  }
  if (framework === 'react' && REACT_FRAMEWORK_TYPES.has(value)) {
    return { text: value, coreTypes: [], reactTypes: [value], packageTypes: [] };
  }
  if (framework === 'react') {
    const refMatch = REACT_REF_PATTERN.exec(value);
    if (refMatch !== null) {
      const handle = refMatch[1];
      if (handle === undefined || !SUPPORTED_REACT_HANDLE_TYPES.has(handle)) {
        throw new BindingError('BINDING_UNSUPPORTED', `${what}的句柄类型不是 SDK 真实导出的组件句柄，拒绝生成不可证实的导入`);
      }
      return { text: value, coreTypes: [], reactTypes: ['Ref'], packageTypes: [handle] };
    }
  }
  const core = safeType(value, what);
  return { text: core, coreTypes: [core], reactTypes: [], packageTypes: [] };
}

function pascalCase(value: string): string {
  return value.split(/[-_]/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

/** camelCase 属性名 + `Sources`：生成组件上承载数据源注册表的 props 名。 */
function registryNameFor(prop: string): string {
  if (!SAFE_IDENTIFIER.test(prop)) {
    throw new BindingError('BINDING_UNSUPPORTED', '权威 API 声明的属性名不是合法标识符，拒绝生成注册表');
  }
  return `${prop}Sources`;
}

/**
 * React 事件属性名：`point-click` → `onPointClick`（真实 React 框架 API 约定）。
 * 权威 API 已按 React 惯例命名（如 `onPointClick`）时原样使用：
 * 不对已带 `on` 前缀的事件名重复加前缀，避免生成 `onOnPointClick`。
 */
export function reactEventProp(event: string): string {
  const name = /^on[A-Z]/.test(event) ? event : `on${pascalCase(event)}`;
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new BindingError('BINDING_UNSUPPORTED', '权威 API 声明的事件名无法折算为 React 事件属性');
  }
  return name;
}

/** Vue 模板监听名：`point-click` → `@point-click`（真实 Vue 框架 API 约定）。 */
export function vueEventListener(event: string): string {
  const name = kebabCase(event);
  if (name.length === 0 || /[^a-z0-9_$-]/.test(name)) {
    throw new BindingError('BINDING_UNSUPPORTED', '权威 API 声明的事件名无法折算为 Vue 模板监听名');
  }
  return name;
}

/** Vue 模板属性名：camelCase 走 kebab-case（`optionOverrides` → `option-overrides`）。 */
export function vuePropName(prop: string): string {
  return kebabCase(prop);
}

export type BindingModelInput = {
  element: MatchElement;
  /** 与元素同 variantReleaseId 的权威 API 响应。 */
  api: ComponentApiV1;
  packageName: string;
  /** 权威 target 的导出名。 */
  exportName: string;
  /** 权威 target 的包内导出路径，如 `./line`。 */
  exportPath: string;
  /** 权威 target 的样式导出路径，如 `./style.css`。 */
  styleExport?: string;
};

/**
 * 折算绑定模型：权威 API 与离线元素必须逐字段一致（计划阶段已核对，这里再次失败关闭），
 * 否则显式 API_MISMATCH；绑定键名不安全则显式 BINDING_UNSUPPORTED。
 */
export function resolveBindingModel(input: BindingModelInput): GeneratedBindingModel {
  const { element, api } = input;
  if (!validateComponentApi(api).ok) throw new BindingError('API_MISMATCH', '权威组件 API 定义无效');
  const bindings: ResolvedBinding[] = [];
  const typeImports = new Set<string>();
  const reactTypeImports = new Set<string>();
  const packageTypeImports = new Set<string>();
  const framework = api.framework;
  const collectTypeImports = (resolved: ResolvedPropType): void => {
    for (const name of resolved.coreTypes) typeImports.add(name);
    for (const name of resolved.reactTypes) reactTypeImports.add(name);
    for (const name of resolved.packageTypes) packageTypeImports.add(name);
  };

  for (const declared of api.props) {
    const bound = element.props.find(prop => prop.name === declared.name);
    if (!bound || !sameComponentMember(bound, declared)) {
      throw new BindingError('API_MISMATCH', '权威组件 API 与计划声明的属性不一致');
    }
    if (bound.source === undefined) {
      // 设计未绑定数据源：仅允许可选属性透传，必填属性不得伪造数据。
      if (declared.required) {
        throw new BindingError('BINDING_UNSUPPORTED', '必填属性缺少设计声明的数据源，拒绝伪造数据');
      }
      // 透传属性名会直接进入生成的公共 props 声明与绑定表达式（React 解构 / Vue 模板表达式）：
      // 非 SAFE_IDENTIFIER 形态（如连字符 `chart-color`）会被真实编译器拒绝。此类属性必须
      // 写入前 blocked（BINDING_UNSUPPORTED、零副作用），不得交付不可编译源码后冒称 applied，
      // 也不得静默跳过该属性假装检查完整；合法标识符属性照常透传。
      if (!SAFE_IDENTIFIER.test(declared.name)) {
        throw new BindingError('BINDING_UNSUPPORTED', '透传属性名不是合法 TypeScript 标识符，无法生成可编译的公共 props 绑定，拒绝生成');
      }
      const resolvedType = resolvePropType(declared.type, `属性 ${declared.name} 的类型`, framework, declared.schema);
      bindings.push({ kind: 'passthrough', prop: declared.name, type: resolvedType.text, required: false });
      collectTypeImports(resolvedType);
      continue;
    }
    const key = safeKey(bound.source, `属性 ${declared.name} 的数据源键名`);
    const resolvedType = resolvePropType(declared.type, `属性 ${declared.name} 的类型`, framework, declared.schema);
    bindings.push({
      kind: 'source', prop: declared.name, type: resolvedType.text, key, required: declared.required,
      registry: registryNameFor(declared.name),
    });
    collectTypeImports(resolvedType);
  }
  // 权威 API 声明了计划未声明的属性/事件：不得静默忽略（可能正是必须绑定的必需绑定）。
  for (const declared of api.props) {
    if (!element.props.some(prop => prop.name === declared.name)) {
      throw new BindingError('API_MISMATCH', '权威组件 API 存在计划未声明的属性');
    }
  }

  const payloads = new Set<string>();
  for (const declared of api.events) {
    const bound = element.events.find(event => event.name === declared.name);
    if (!bound || !sameComponentMember(bound, declared)) {
      throw new BindingError('API_MISMATCH', '权威组件 API 与计划声明的事件不一致');
    }
    const key = safeKey(bound.handler, `事件 ${declared.name} 的处理键名`);
    const resolvedPayload = resolvePropType(declared.payload, `事件 ${declared.name} 的载荷类型`, framework, declared.schema);
    payloads.add(resolvedPayload.text);
    collectTypeImports(resolvedPayload);
    bindings.push({ kind: 'event', event: declared.name, payload: resolvedPayload.text, key });
  }
  for (const declared of api.events) {
    if (!element.events.some(event => event.name === declared.name)) {
      throw new BindingError('API_MISMATCH', '权威组件 API 存在计划未声明的事件');
    }
  }
  // 同一份生成文件只承载一个处理注册表：载荷类型不一致时无法给出可编译的类型，显式阻断。
  if (payloads.size > 1) {
    throw new BindingError('BINDING_UNSUPPORTED', '同一组件的事件载荷类型不一致，拒绝生成不可证实的处理注册表');
  }

  if (element.layout !== undefined) {
    if (element.layout.length === 0 || element.layout.length > 512 || /[\u0000-\u001f\u007f]/.test(element.layout)) {
      throw new BindingError('BINDING_UNSUPPORTED', '设计声明的布局描述不是可下发的字符串数据');
    }
  }

  const exportName = input.exportName;
  if (!SAFE_IDENTIFIER.test(exportName)) {
    throw new BindingError('API_MISMATCH', '权威 target 的导出名不是合法标识符');
  }
  const componentName = `Zhinexus${exportName}`;
  if (!SAFE_IDENTIFIER.test(componentName)) {
    throw new BindingError('API_MISMATCH', '无法从权威导出名派生合法的生成组件名');
  }
  if (!/^\.(?:\/[a-zA-Z0-9_-]+)*$/.test(input.exportPath) || (input.styleExport !== undefined && !/^\.\/[a-zA-Z0-9_/-]+\.css$/.test(input.styleExport))) {
    throw new BindingError('API_MISMATCH', '权威 target 的导出路径或样式路径不是受支持的包内相对路径');
  }

  return {
    exportName,
    sdkIdentifier: `SDK${exportName}`,
    importSpecifier: input.packageName + (input.exportPath === '.' ? '' : input.exportPath.slice(1)),
    ...(input.styleExport ? { styleSpecifier: input.packageName + input.styleExport.slice(1) } : {}),
    componentName,
    bindings,
    ...(element.layout !== undefined ? { layout: element.layout } : {}),
    typeImports: [...typeImports].sort(),
    reactTypeImports: [...reactTypeImports].sort(),
    packageTypeImports: [...packageTypeImports].sort(),
  };
}

/** 生成组件对外 props 的 TypeScript 文本：按权威 API 声明顺序，事件处理注册表统一排在最后。 */
/**
 * 生成组件对外 props 的 TypeScript 文本。
 *
 * 数据源/事件处理注册表用**字面量键**声明（`{ 'sales': ChartData }`）而不是 `Record<string, T>`：
 * 这样宿主必须提供设计声明的每一个键，且在下游开启 `noUncheckedIndexedAccess` 时，
 * 绑定处取到的仍是精确类型而不是 `T | undefined`——生成的代码可以直接通过严格类型检查。
 */
export function propsTypeText(model: GeneratedBindingModel): string {
  const registries = new Map<string, Map<string, string>>();
  for (const binding of model.bindings) {
    if (binding.kind !== 'source') continue;
    const keys = registries.get(binding.registry) ?? new Map<string, string>();
    const existing = keys.get(binding.key);
    if (existing !== undefined && existing !== binding.type) {
      throw new BindingError('BINDING_UNSUPPORTED', '同一数据源键名对应多个属性类型，拒绝生成不可证实的注册表');
    }
    keys.set(binding.key, binding.type);
    registries.set(binding.registry, keys);
  }
  const handlers = new Map<string, string>();
  for (const binding of model.bindings) {
    if (binding.kind !== 'event') continue;
    const existing = handlers.get(binding.key);
    if (existing !== undefined && existing !== binding.payload) {
      throw new BindingError('BINDING_UNSUPPORTED', '同一事件处理键名对应多种载荷类型，拒绝生成不可证实的注册表');
    }
    handlers.set(binding.key, binding.payload);
  }

  const lines: string[] = [];
  const emitted = new Set<string>();
  for (const binding of model.bindings) {
    if (binding.kind === 'source') {
      if (emitted.has(binding.registry)) continue;
      emitted.add(binding.registry);
      const entries = [...(registries.get(binding.registry) ?? new Map<string, string>())]
        .map(([key, type]) => `${JSON.stringify(key)}: ${type}`);
      lines.push(`  /** 设计声明的数据源键名 → 真实数据。 */`);
      lines.push(`  ${binding.registry}: { ${entries.join('; ')} };`);
      continue;
    }
    if (binding.kind === 'passthrough') lines.push(`  ${binding.prop}?: ${binding.type};`);
  }
  if (handlers.size > 0) {
    const entries = [...handlers].map(([key, payload]) => `${JSON.stringify(key)}: (event: ${payload}) => void`);
    lines.push('  /** 设计声明的事件处理键名 → 真实回调。 */');
    lines.push(`  handlers: { ${entries.join('; ')} };`);
  }
  return lines.join('\n');
}
