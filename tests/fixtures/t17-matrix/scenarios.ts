/**
 * T17 B 独立支持矩阵的冻结场景声明。
 *
 * 唯一事实来源是 `scenarios.json`（本文件只做加载、类型化与结构校验）。
 * 冻结规则（docs/verification/t17-matrix-2026-11-19.md）：
 * - 正向 20 例：Vue 10 + React 10，成功率分母固定，跑后不得改分母；
 * - 强制拒绝 13 例：单列，不计入正向分子或分母；
 * - 支持域 = Vue 3.5.45 / React 19.3.1 × npm/pnpm × standalone/workspace × ECharts 6.1.0。
 *
 * 兼容契约：正向场景保留 `host` 字符串字段，拒绝场景保留 `reason`/`expectedOutcome`，
 * 供既有 score.ts / matrix.test.ts 直接消费；扩展字段（topology/browser/kind/setup 等）
 * 由真实 harness 使用。
 */
import { readFileSync } from 'node:fs';

export type T17Framework = 'vue' | 'react';
export type T17PackageManager = 'npm' | 'pnpm';
export type T17Topology = 'standalone' | 'workspace';
export type T17ComponentId = 'line' | 'bar' | 'pie' | 'scatter' | 'trend-card' | 'ranking' | 'proportion';
export type T17HostMode = 'basic' | 'multi' | 'empty-update' | 'hidden-show' | 'keepalive' | 'strictmode' | 'series-theme';
export type T17BrowserAction = { kind: 'click'; selector: string } | { kind: 'fill'; selector: string; value: string };
export type T17BrowserAssertion =
  | { kind: 'visible'; selector: string }
  | { kind: 'text'; selector: string; value: string }
  | { kind: 'count'; selector: string; count: number };
export type T17Interaction = { selector: string; pattern: string; from: number; to: number };

export type T17PositiveScenario = {
  caseId: string;
  framework: T17Framework;
  packageManager: T17PackageManager;
  topology: T17Topology;
  workspace: string;
  host: 'vite' | 'next-app-router';
  focus: string;
  hostMode: T17HostMode;
  components: { componentId: T17ComponentId; instanceId: string; dataState: 'default' | 'empty' | 'updated' | 'center' }[];
  browser: {
    readySelector: string;
    actions: T17BrowserAction[];
    assertions: T17BrowserAssertion[];
    interaction?: T17Interaction;
  };
  visual: { renderer: 'canvas' | 'svg'; theme: 'light' | 'dark' };
  requiresRepairFault?: boolean;
  expectedOutcome: 'pass';
};

export type T17RefusalKind = 'refusal' | 'guard' | 'detection';
export type T17RefusalReason = 'unsupported-target' | 'missing-required-binding' | 'stale-project' | 'repair-budget-exceeded';
export type T17RefusalSetup =
  | 'echarts-conflict' | 'apply-then-edit' | 'bogus-variant' | 'business-gap' | 'handler-suppressed'
  | 'tamper-version' | 'no-baseline' | 'diff-baseline' | 'env-baseline' | 'budget' | 'symlink-parent'
  | 'sentinel' | 'static-standin';
export type T17RefusalScenario = {
  caseId: string;
  kind: T17RefusalKind;
  focus: string;
  reason: T17RefusalReason;
  expectedOutcome: 'refuse';
  setup: T17RefusalSetup;
  framework: T17Framework;
  packageManager: T17PackageManager;
  expectedCodes?: string[];
  expectedExit?: number[];
  expectedStatus?: string[];
  expectedVisual?: 'NEW' | 'DIFF' | 'INCOMPATIBLE';
  expectedRepair?: 'stopped-or-rejected';
  assertNoRepairWrite?: boolean;
  assertNoSentinel?: boolean;
  expectedDetection?: 'entry-import-missing';
};

export type T17Toolchain = {
  vite: string; pluginVue: string; pluginReact: string;
  typescriptVue: string; typescriptReact: string; vueTsc: string;
  vue: string; react: string; reactDom: string; echarts: string;
  typesReact: string; typesReactDom: string;
};

export type T17MatrixDeclaration = {
  schemaVersion: 1;
  matrix: string;
  frozenAt: string;
  denominator: { positive: number; vue: number; react: number; refusal: number };
  success: { rate: number; positiveRequired: number; perFrameworkRequired: number };
  visual: { pixelThreshold: number; maxDiffPixelRatio: number; viewport: { width: number; height: number } };
  toolchain: T17Toolchain;
  positive: T17PositiveScenario[];
  refusal: T17RefusalScenario[];
};

const declaration = JSON.parse(
  readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'),
) as T17MatrixDeclaration;

export const T17_MATRIX_DECLARATION: T17MatrixDeclaration = declaration;
export const T17_POSITIVE_SCENARIOS: readonly T17PositiveScenario[] = declaration.positive;
export const T17_REFUSAL_SCENARIOS: readonly T17RefusalScenario[] = declaration.refusal;
export const T17_DENOMINATOR = declaration.denominator;
export const T17_SUCCESS = declaration.success;
export const T17_VISUAL = declaration.visual;
export const T17_TOOLCHAIN = declaration.toolchain;

const FRAMEWORKS: readonly T17Framework[] = ['vue', 'react'];
const PACKAGE_MANAGERS: readonly T17PackageManager[] = ['npm', 'pnpm'];
const TOPOLOGIES: readonly T17Topology[] = ['standalone', 'workspace'];
const COMPONENTS: readonly T17ComponentId[] = ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'];
const HOST_MODES: readonly T17HostMode[] = ['basic', 'multi', 'empty-update', 'hidden-show', 'keepalive', 'strictmode', 'series-theme'];
const REFUSAL_KINDS: readonly T17RefusalKind[] = ['refusal', 'guard', 'detection'];
const REFUSAL_REASONS: readonly T17RefusalReason[] = ['unsupported-target', 'missing-required-binding', 'stale-project', 'repair-budget-exceeded'];
const REQUIRED_REFUSAL_TOPICS = [
  'peer-conflict', 'dirty-intermediate-edit', 'no-candidate', 'business-gap', 'type-pass-behavior-fail',
  'visual-pass-version-mismatch', 'visual-new', 'visual-diff', 'visual-environment-incompatible',
  'repair-budget', 'path-link', 'sensitive-output', 'wrong-host-static-standin',
] as const;

export function validateT17ScenarioMatrix(
  positive: readonly T17PositiveScenario[] = T17_POSITIVE_SCENARIOS,
  refusals: readonly T17RefusalScenario[] = T17_REFUSAL_SCENARIOS,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (positive.length !== 20) errors.push('正向场景数必须为 20，当前为 ' + positive.length);
  for (const framework of FRAMEWORKS) {
    const count = positive.filter((item) => item.framework === framework).length;
    if (count !== 10) errors.push(framework + ' 正向场景数必须为 10，当前为 ' + count);
  }
  if (refusals.length !== 13) errors.push('强制拒绝场景数必须为 13，当前为 ' + refusals.length);
  if (declaration.denominator.positive !== positive.length) errors.push('声明的正分母与场景数不一致');
  if (declaration.denominator.vue !== 10 || declaration.denominator.react !== 10) errors.push('分框架分母必须为 10/10');
  if (declaration.denominator.refusal !== refusals.length) errors.push('声明的拒绝分母与场景数不一致');
  if (Math.ceil(20 * declaration.success.rate) !== declaration.success.positiveRequired) errors.push('成功率门槛与总分母不一致');
  if (Math.ceil(10 * declaration.success.rate) !== declaration.success.perFrameworkRequired) errors.push('成功率门槛与分框架分母不一致');
  const allIds = [...positive.map((item) => item.caseId), ...refusals.map((item) => item.caseId)];
  if (new Set(allIds).size !== allIds.length) errors.push('场景 caseId 必须唯一');
  for (const item of positive) {
    if (!item.caseId || !item.focus || item.expectedOutcome !== 'pass') errors.push('正向场景定义不完整: ' + item.caseId);
    if (!item.caseId.startsWith(item.framework === 'vue' ? 'V' : 'R')) errors.push('正向 caseId 前缀与框架不符: ' + item.caseId);
    if (!FRAMEWORKS.includes(item.framework)) errors.push('未知框架: ' + item.caseId);
    if (!PACKAGE_MANAGERS.includes(item.packageManager)) errors.push('未知包管理器: ' + item.caseId);
    if (!TOPOLOGIES.includes(item.topology)) errors.push('未知拓扑: ' + item.caseId);
    if (!['vite', 'next-app-router'].includes(item.host)) errors.push('未知宿主: ' + item.caseId);
    if (item.topology === 'standalone' && item.workspace !== '.') errors.push('standalone 场景 workspace 必须为 .: ' + item.caseId);
    if (item.topology === 'workspace' && (item.workspace === '.' || !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(item.workspace))) errors.push('workspace 场景需要合法的 workspace 相对路径: ' + item.caseId);
    if (!HOST_MODES.includes(item.hostMode)) errors.push('未知宿主模式: ' + item.caseId);
    if (!item.components.length) errors.push('正向场景缺少组件: ' + item.caseId);
    for (const component of item.components) {
      if (!COMPONENTS.includes(component.componentId)) errors.push('未知组件: ' + item.caseId + '/' + component.componentId);
      if (!/^instance-[0-9]+$/.test(component.instanceId)) errors.push('非法实例 id: ' + item.caseId);
    }
    if (item.hostMode === 'multi' && item.components.length !== 3) errors.push('多实例场景必须声明 3 个组件: ' + item.caseId);
    if (item.hostMode !== 'multi' && item.components.length !== 1) errors.push('单例场景只能声明 1 个组件: ' + item.caseId);
    if (item.hostMode === 'keepalive' && item.framework !== 'vue') errors.push('KeepAlive 场景仅限 Vue: ' + item.caseId);
    if (item.hostMode === 'strictmode' && item.framework !== 'react') errors.push('StrictMode 场景仅限 React: ' + item.caseId);
    for (const action of item.browser.actions) {
      if (action.kind !== 'click' && action.kind !== 'fill') errors.push('未知浏览器动作: ' + item.caseId);
      if (action.kind === 'fill' && typeof action.value !== 'string') errors.push('fill 动作缺少取值: ' + item.caseId);
    }
    for (const assertion of item.browser.assertions) {
      if (!['visible', 'text', 'count'].includes(assertion.kind)) errors.push('未知断言类型: ' + item.caseId);
      if (assertion.kind === 'text' && typeof assertion.value !== 'string') errors.push('text 断言缺少取值: ' + item.caseId);
      if (assertion.kind === 'count' && !Number.isInteger(assertion.count)) errors.push('count 断言缺少整数: ' + item.caseId);
    }
    if (!item.browser.readySelector) errors.push('缺少 readySelector: ' + item.caseId);
    if (!item.browser.interaction) errors.push('每个正向场景都必须预声明真实交互计数: ' + item.caseId);
    else if (item.browser.interaction.from === item.browser.interaction.to) errors.push('交互期望必须发生可观察变化: ' + item.caseId);
  }
  const topics = new Set(refusals.map((item) => item.focus));
  for (const topic of REQUIRED_REFUSAL_TOPICS) if (!topics.has(topic)) errors.push('缺少强制拒绝主题: ' + topic);
  for (const item of refusals) {
    if (!item.caseId || item.expectedOutcome !== 'refuse') errors.push('拒绝场景定义不完整: ' + item.caseId);
    if (!REFUSAL_KINDS.includes(item.kind)) errors.push('未知拒绝类型: ' + item.caseId);
    if (!REFUSAL_REASONS.includes(item.reason)) errors.push('未知拒绝理由: ' + item.caseId);
    if (!FRAMEWORKS.includes(item.framework)) errors.push('拒绝场景框架非法: ' + item.caseId);
    if (!PACKAGE_MANAGERS.includes(item.packageManager)) errors.push('拒绝场景包管理器非法: ' + item.caseId);
    if (item.kind === 'refusal' && (!item.expectedExit || !item.expectedExit.length)) errors.push('拒绝场景缺少预期退出码: ' + item.caseId);
    if (item.kind === 'guard' && (!item.expectedStatus || !item.expectedStatus.length)) errors.push('守卫场景缺少预期状态: ' + item.caseId);
    if (item.kind === 'detection' && !item.expectedDetection) errors.push('侦测场景缺少预期侦测类型: ' + item.caseId);
  }
  return { valid: errors.length === 0, errors };
}
