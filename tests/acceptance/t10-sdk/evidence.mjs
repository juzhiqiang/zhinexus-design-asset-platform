/**
 * 证据装配与维度映射（T10 探针，A 侧）。
 *
 * 四维结论（`typecheck` / `runtime` / `interaction` / `visual`）与
 * `charts-core` 的 `CombinationDimensions` 一一对应，探针自己收集的更多细节
 * （构建、SSR 导入、生命周期、逐截图 environmentKey）作为 `evidence` 附在同一个
 * 组合记录里，**不新增第五个维度**——否则报告的维度集合与策略层的判定输入不一致。
 *
 * 映射口径（写死在 `summariseDimensions` 里，报告与文档都引用它）：
 *
 * | 维度 | passed 条件 | failed 条件 | not-run 条件 |
 * | --- | --- | --- | --- |
 * | `typecheck` | 每种解析模式的 tsc / vue-tsc 都退出 0 | 任一退出非 0 | 一次都没跑 |
 * | `runtime` | SSR 安全导入通过 + 生产构建通过 + 浏览器运行全过 + 生命周期通过 | 任一失败 | 浏览器维度被 `--skip-browser` 跳过 |
 * | `interaction` | 每个组件的点击载荷都等于共享语义 | 任一不符或缺失 | 未采集到点击 |
 * | `visual` | 每张截图都有同 environmentKey 基线且字节一致 | 同环境基线下字节不同（DIFF） | 无基线（NEW）或 environmentKey 不同（INCOMPATIBLE） |
 */

/** 维度取值：与 `charts-core` 的 `DimensionOutcome` 同集合。 */
export const PASSED = 'passed';
export const FAILED = 'failed';
export const NOT_RUN = 'not-run';

function firstFailure(results) {
  return results.find((result) => result.ok === false) ?? null;
}

function allOk(results) {
  return results.length > 0 && results.every((result) => result.ok === true);
}

/**
 * 由原始运行结果得出四维结论与失败原因清单。
 *
 * @param {{
 *   typecheckRuns?: {resolution:string; status:number; output?:string}[];
 *   buildRun?: {status:number; output?:string} | null;
 *   ssrRun?: {status:number; payload?: {windowDefined:boolean; documentDefined:boolean} | null; output?:string} | null;
 *   browserRuns?: {component:string; presentation:string; runtimeProblems?:string[]; interactionProblems?:string[]; clickError?:string|null; screenshot?: object|null}[];
 *   lifecycle?: {status:'passed'|'failed'|'not-run'; reason?:string} | null;
 *   visualComparisons?: {component:string; presentation:string; result:'PASS'|'DIFF'|'NEW'|'INCOMPATIBLE'; reason?:string}[];
 *   browserSkipped?: boolean;
 * }} input
 */
export function summariseDimensions(input) {
  const failures = [];
  const typecheckRuns = input.typecheckRuns ?? [];
  const browserRuns = input.browserRuns ?? [];
  const comparisons = input.visualComparisons ?? [];

  const typecheck = typecheckRuns.length === 0 ? NOT_RUN : typecheckRuns.every((run) => run.status === 0) ? PASSED : FAILED;
  for (const run of typecheckRuns) {
    if (run.status !== 0) {
      failures.push({
        dimension: 'typecheck',
        reason: `${run.tool ?? 'tsc'} ${run.resolution} 退出码 ${run.status}`,
        detail: tail(run.output),
      });
    }
  }

  const runtimeFailures = [];
  if (input.buildRun && input.buildRun.status !== 0) {
    runtimeFailures.push({ dimension: 'runtime', reason: `生产构建退出码 ${input.buildRun.status}`, detail: tail(input.buildRun.output) });
  }
  if (input.ssrRun) {
    if (input.ssrRun.status !== 0) {
      runtimeFailures.push({ dimension: 'runtime', reason: `SSR 安全导入退出码 ${input.ssrRun.status}`, detail: tail(input.ssrRun.output) });
    } else if (input.ssrRun.payload && (input.ssrRun.payload.windowDefined || input.ssrRun.payload.documentDefined)) {
      runtimeFailures.push({
        dimension: 'runtime',
        reason: '模块顶层触碰浏览器全局对象：SSR 宿主无法安全导入',
        detail: JSON.stringify(input.ssrRun.payload),
      });
    } else if (!input.ssrRun.payload) {
      runtimeFailures.push({ dimension: 'runtime', reason: 'SSR 导入探针未输出环境标志', detail: tail(input.ssrRun.output) });
    }
  }
  for (const run of browserRuns) {
    for (const problem of run.runtimeProblems ?? []) {
      runtimeFailures.push({ dimension: 'runtime', reason: `${run.component}/${run.presentation}: ${problem}` });
    }
  }
  if (input.lifecycle && input.lifecycle.status === 'failed') {
    runtimeFailures.push({ dimension: 'runtime', reason: `生命周期（${input.lifecycle.component}）失败：${input.lifecycle.reason ?? ''}` });
  }

  const interactionFailures = [];
  for (const run of browserRuns) {
    for (const problem of run.interactionProblems ?? []) {
      interactionFailures.push({ dimension: 'interaction', reason: `${run.component}/${run.presentation}: ${problem}` });
    }
    if (run.clickError) {
      interactionFailures.push({ dimension: 'interaction', reason: `${run.component}/${run.presentation}: ${run.clickError}` });
    }
  }

  const visualFailures = [];
  const visualNotRun = [];
  for (const comparison of comparisons) {
    if (comparison.result === 'DIFF') {
      visualFailures.push({
        dimension: 'visual',
        reason: `${comparison.component}/${comparison.presentation}: 同环境下截图与基线不一致`,
        detail: comparison.reason,
      });
    } else if (comparison.result !== 'PASS') {
      visualNotRun.push({
        dimension: 'visual',
        reason: `${comparison.component}/${comparison.presentation}: ${comparison.result}`,
        detail: comparison.reason,
      });
    }
  }

  let runtime;
  if (input.browserSkipped) {
    runtime = NOT_RUN;
  } else if (input.buildRun === null || input.buildRun === undefined) {
    runtime = NOT_RUN;
  } else if (runtimeFailures.length > 0) {
    runtime = FAILED;
  } else {
    runtime = PASSED;
  }

  const interaction = browserRuns.length === 0 ? NOT_RUN : interactionFailures.length > 0 ? FAILED : PASSED;

  let visual;
  if (comparisons.length === 0) {
    visual = NOT_RUN;
  } else if (visualFailures.length > 0) {
    visual = FAILED;
  } else if (visualNotRun.length > 0) {
    visual = NOT_RUN;
  } else {
    visual = PASSED;
  }

  failures.push(...runtimeFailures, ...interactionFailures, ...visualFailures, ...visualNotRun);
  return { dimensions: { typecheck, runtime, interaction, visual }, failures };
}

function tail(text) {
  if (!text) return undefined;
  return text.length > 4000 ? `…${text.slice(-4000)}` : text;
}

/**
 * 由四维结论得出该组合是否「值得进入人工基线确认」。
 * 与 `charts-core` 的 `requiresVisualBaselineConfirmation` 同口径。
 */
export function requiresVisualBaselineConfirmation(dimensions, failures) {
  return (
    dimensions.visual !== PASSED ||
    failures.some((failure) => failure.dimension === 'visual')
  );
}

/** 维度集合自检：四维必须齐备且取值合法，否则拒绝出具报告。 */
export function validateDimensions(dimensions) {
  const allowed = [PASSED, FAILED, NOT_RUN];
  const problems = [];
  for (const key of ['typecheck', 'runtime', 'interaction', 'visual']) {
    if (!allowed.includes(dimensions[key])) {
      problems.push(`维度 ${key} 取值非法：${dimensions[key]}`);
    }
  }
  return problems;
}

/** 把探针运行结果装配成单个组合记录（证据 JSON 的 `combinations[]` 元素）。 */
export function buildCombinationRecord({
  framework,
  frameworkVersion,
  baselineEchartsVersion,
  echartsVersion,
  consumer,
  dimensions,
  failures,
  typecheckRuns,
  buildRun,
  ssrRun,
  browserRuns,
  lifecycle,
  visualComparisons,
}) {
  return {
    framework,
    frameworkVersion,
    baselineEchartsVersion,
    echartsVersion,
    consumer: {
      root: consumer.root,
      kept: Boolean(consumer.kept),
      manifestDigest: consumer.digest,
      installs: consumer.installs.map((install) => ({
        mode: install.mode,
        exitCode: install.status,
        reason: install.reason,
        detail: tail(install.output),
      })),
      peerMode: consumer.applied,
      resolved: consumer.resolved,
    },
    dimensions,
    failures,
    evidence: {
      typecheck: (typecheckRuns ?? []).map((run) => ({
        tool: run.tool,
        resolution: run.resolution,
        exitCode: run.status,
        output: tail(run.output),
      })),
      build: buildRun ? { exitCode: buildRun.status, output: tail(buildRun.output) } : null,
      ssrImport: ssrRun
        ? {
            exitCode: ssrRun.status,
            windowDefined: ssrRun.payload?.windowDefined ?? null,
            documentDefined: ssrRun.payload?.documentDefined ?? null,
            navigatorDefined: ssrRun.payload?.navigatorDefined ?? null,
            output: tail(ssrRun.output),
          }
        : null,
      lifecycle: lifecycle ?? null,
      browser: (browserRuns ?? []).map((run) => ({
        component: run.component,
        presentation: run.presentation,
        url: run.url,
        hostCount: run.hostCount ?? null,
        checks: run.checks,
        appliedPresentation: run.appliedPresentation,
        pageErrors: run.pageErrors,
        clickPoint: run.clickPoint ?? null,
        clickSource: run.clickSource ?? null,
        click: run.click,
        clickError: run.clickError,
        screenshot: run.screenshot,
        environmentKey: run.environmentKey,
      })),
      visual: visualComparisons ?? [],
    },
    screenshots: (browserRuns ?? [])
      .filter((run) => run.screenshot)
      .map((run) => ({
        component: run.component,
        framework,
        presentation: run.presentation,
        theme: run.environment?.theme,
        renderer: run.environment?.renderer,
        width: run.screenshot.width,
        height: run.screenshot.height,
        path: run.screenshot.name,
        sha256: run.screenshot.sha256,
        bytes: run.screenshot.bytes,
        environmentKey: run.environmentKey,
      })),
  };
}

/** 未覆盖项收集：把「没跑」与「跑了但没证据」分开列，避免把跳过写成通过。 */
export function collectUncovered({
  browserSkipped,
  visualNotRunReasons,
  lifecycleNotRunReasons,
  registryUnavailable,
  candidateNotRegistryVerified,
  extra = [],
}) {
  const uncovered = [];
  if (browserSkipped) {
    uncovered.push('浏览器维度被 --skip-browser 跳过：runtime / interaction / visual 均为 not-run，不构成任何通过结论');
  }
  for (const reason of visualNotRunReasons ?? []) uncovered.push(`视觉基线未确认：${reason}`);
  for (const reason of lifecycleNotRunReasons ?? []) uncovered.push(`生命周期未实测：${reason}`);
  if (registryUnavailable) {
    uncovered.push('官方 registry 不可达：候选的 integrity 未经 registry 核对，candidate.source 记为 local-request');
  }
  if (candidateNotRegistryVerified) {
    uncovered.push('候选版本未在官方源核对：resolveCandidate 的 registry 拒绝路径未覆盖');
  }
  uncovered.push(...extra);
  return uncovered;
}
