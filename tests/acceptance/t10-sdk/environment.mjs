/**
 * 固定环境签名与展示配置解析（T10 探针，A 侧）。
 *
 * 本模块是 `tests/acceptance/t10-sdk/` 探针的纯逻辑部分：不发起网络请求、
 * 不启动浏览器、不写文件，可单独用 `node --test` 覆盖。
 *
 * `canonicalJson` / `environmentProjection` / `environmentKey` 与
 * `packages/contracts/src/digests.ts` 同口径实现（canonical JSON + 递归键排序 +
 * 剔除 frameworkVersion / echartsVersion 后取 SHA-256）。**不复用 contracts 源码**：
 * contracts 是私有包，公开 SDK 与探针都不得依赖它；探针跑在工作区外，只能自带一份
 * 同口径实现。一致性由 `probe.test.mjs` 用 C 冻结 bundle 里的真实
 * `environmentKey` 反向锁定——那是在 Windows 上由另一套代码路径产出的值。
 */

import { createHash } from 'node:crypto';

/** 展示组合：主题 × 渲染器。与 `rules/platform.md` 声明的支持矩阵一致。 */
export const THEMES = /** @type {const} */ (['light', 'dark']);
export const RENDERERS = /** @type {const} */ (['canvas', 'svg']);

/** 逻辑组件 → 示例页路径（line 走 index.html，与仓库既有约定一致）。 */
export const COMPONENTS = /** @type {const} */ ([
  'line',
  'bar',
  'pie',
  'scatter',
  'trend-card',
  'ranking',
  'proportion',
]);

export const PAGE_PATH = /** @type {Record<string, string>} */ ({
  line: '/index.html',
  bar: '/bar.html',
  pie: '/pie.html',
  scatter: '/scatter.html',
  'trend-card': '/trend-card.html',
  ranking: '/ranking.html',
  proportion: '/proportion.html',
});

/** 图表宿主选择器：每个组件根容器类名固定 `charts-<组件名>`。 */
export function chartHostSelector(component) {
  assertComponent(component);
  return `.charts-${component}`;
}

export function assertComponent(component) {
  if (!COMPONENTS.includes(component)) {
    throw new Error(`未知逻辑组件 ${JSON.stringify(component)}；可用：${COMPONENTS.join(', ')}`);
  }
}

/**
 * 解析展示组合字面量（`light-canvas` / `dark-svg`）。
 * 只接受四组合之一，拒绝 `light`、`canvas`、`LIGHT-CANVAS` 之类的模糊输入——
 * 模糊输入会让截图与 environmentKey 对不上。
 */
export function parsePresentation(literal) {
  const [theme, renderer] = String(literal).split('-');
  if (!THEMES.includes(theme) || !RENDERERS.includes(renderer)) {
    throw new Error(
      `展示组合必须是 ${THEMES.map((t) => RENDERERS.map((r) => `${t}-${r}`).join(' / ')).join(' / ')} 之一：收到 ${JSON.stringify(literal)}`,
    );
  }
  return { theme, renderer };
}

export function formatPresentation({ theme, renderer }) {
  return `${theme}-${renderer}`;
}

/** 平台名归一化：与 `component-cli` 的 `detectEnvironment` 一致（win32 → windows）。 */
export function platformName(platform = process.platform) {
  return platform === 'win32' ? 'windows' : platform;
}

/**
 * `component-cli` 的**声明常量**，不是实测值。
 *
 * CLI 的 `detectEnvironment` 在拿不到外部指定摘要时用它兜底，输入是固定的
 * `'system-ui,sans-serif;regular,bold;zh-CN'` 字符串——也就是说它**从来不测量本机字体**。
 * 探针保留它只有一个用途：复现 C 侧 CLI 产出的 environmentKey（`probe.test.mjs` 里有锁定用例）。
 *
 * **探针不得把它当作本机字体签名。** 没装中文字体的机器与装了字体的机器会算出同一个
 * 常量，于是得到同一个 environmentKey，视觉比对会静默判 PASS。要出截图就必须用
 * `fontDigestFromMeasurements()` 基于浏览器里的真实度量算摘要，或由操作者显式传
 * `--font-digest`（证据里记 `operator-supplied`）。
 */
export const DEFAULT_FONT_DIGEST = createHash('sha256')
  .update('system-ui,sans-serif;regular,bold;zh-CN', 'utf8')
  .digest('hex');

/** 字体度量的固定探针串：ASCII 排版、CJK 覆盖、易混字形。CJK 是跨机器差异最大的一项。 */
export const FONT_PROBE_STRINGS = /** @type {const} */ ([
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  '中文图表标签折线柱状饼图散点排行榜占比趋势卡片暂无数据',
  'iIlL1.,;:!|',
]);

/** 除宿主字体栈外，始终测量的参考族：保证不同页面结构下签名仍可比。 */
export const FONT_REFERENCE_FAMILIES = /** @type {const} */ (['sans-serif', 'serif', 'monospace']);

/** 前进宽度保留三位小数：跨 JS 引擎的浮点表示差异不该造成假 DIFF，真实字体差异远大于此。 */
const ADVANCE_PRECISION = 1000;

/**
 * 字体指纹的规范化输入：与 `fontDigestFromMeasurements` 用同一套归一化规则。
 *
 * 单独导出是为了让证据里能留下**被哈希的那串字符**——审核方据此重算摘要，
 * 不必去猜规范化规则（键排序、去空白、advance 保留几位）。
 *
 * @param {{stack?: unknown; families?: unknown; loadedFonts?: unknown}} measurements
 * @returns {string}
 */
export function fontFingerprintCanonical(measurements) {
  const stack = measurements?.stack;
  const families = measurements?.families;
  const loadedFonts = measurements?.loadedFonts;
  if (typeof stack !== 'string' || stack.length === 0) {
    throw new Error('PROBE_ENVIRONMENT 字体度量缺少 stack：无法出具可信的字体摘要');
  }
  if (!Array.isArray(families) || families.length === 0) {
    throw new Error('PROBE_ENVIRONMENT 字体度量缺少 families：无法出具可信的字体摘要');
  }
  if (!Array.isArray(loadedFonts)) {
    throw new Error('PROBE_ENVIRONMENT 字体度量缺少 loadedFonts：无法出具可信的字体摘要');
  }
  const normalised = families.map((family, index) => {
    if (typeof family?.family !== 'string' || family.family.length === 0) {
      throw new Error(`PROBE_ENVIRONMENT 字体度量第 ${index} 项缺少 family`);
    }
    if (!Array.isArray(family.advances) || family.advances.length !== FONT_PROBE_STRINGS.length) {
      throw new Error(
        `PROBE_ENVIRONMENT 字体度量第 ${index} 项（${family.family}）的 advances 必须是 ${FONT_PROBE_STRINGS.length} 个数值`,
      );
    }
    for (const advance of family.advances) {
      if (typeof advance !== 'number' || !Number.isFinite(advance)) {
        throw new Error(`PROBE_ENVIRONMENT 字体度量第 ${index} 项（${family.family}）的 advances 含非数值`);
      }
    }
    return {
      family: family.family,
      available: family.available === true,
      advances: family.advances.map((advance) => Math.round(advance * ADVANCE_PRECISION) / ADVANCE_PRECISION),
    };
  });
  // 参考族必须全在，否则换个页面结构就能悄悄改签名
  const present = new Set(normalised.map((entry) => entry.family));
  for (const reference of FONT_REFERENCE_FAMILIES) {
    if (!present.has(reference)) {
      throw new Error(`PROBE_ENVIRONMENT 字体度量缺少参考族 ${reference}：签名不可跨页面比较`);
    }
  }
  return canonicalJson({
    kind: 'font-fingerprint-v1',
    stack: stack.trim().normalize('NFC'),
    families: normalised,
    loadedFonts: [...loadedFonts].map((entry) => String(entry)).sort(),
  });
}

/**
 * 由浏览器实测的字体度量算出字体摘要。
 *
 * 度量的东西是**真正参与渲染的字形**：每个字体族的可用性（`document.fonts.check`）、
 * 固定探针串的 canvas 前进宽度、页面已加载的 Web 字体清单，以及宿主元素上真实生效的
 * `font-family` 栈。任何一项变化都会改变摘要，进而改变 environmentKey——于是
 * 「不同字体的两台机器」在视觉维度上得到的是 `INCOMPATIBLE`，而不是静默的 PASS。
 *
 * @param {{stack?: unknown; families?: unknown; loadedFonts?: unknown}} measurements
 * @returns {string} 64 位小写十六进制
 */
export function fontDigestFromMeasurements(measurements) {
  return sha256Hex(fontFingerprintCanonical(measurements));
}

/**
 * v1 编码：UTF-8 JSON、递归 UTF-16 键排序、数组顺序不变、无空白。
 * 与 `packages/contracts/src/digests.ts` 的 `canonicalJson` 同口径。
 */
export function canonicalJson(input) {
  return encodeValue(input);
}

function encodeValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(encodeValue).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encodeValue(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 环境投影：剔除被测对象（frameworkVersion / echartsVersion），字符串归一化。
 * `os` / `arch` 额外转小写——`Windows` 与 `windows` 必须是同一个环境。
 */
export function environmentProjection(environment) {
  const { frameworkVersion: _frameworkVersion, echartsVersion: _echartsVersion, ...rest } = environment;
  return Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? key === 'os' || key === 'arch'
          ? value.trim().normalize('NFC').toLowerCase()
          : value.trim().normalize('NFC')
        : value,
    ]),
  );
}

/** 64 位小写十六进制 SHA-256。 */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 环境签名 key。被测框架版本与 ECharts 版本**不计入** key（`rules/platform.md`），
 * 因此 Linux 探针与 Windows 探针只要 os/arch 不同就必然得到不同 key——
 * 这正是「不把 Linux 证据宣称 Windows 验证」在数据上的落点。
 */
export function computeEnvironmentKey(environment) {
  return sha256Hex(canonicalJson(environmentProjection(environment)));
}

/**
 * 构造 EnvironmentV1。字段与 `packages/contracts/src/schemas.ts` 的
 * `environmentSchema` 逐一对齐，缺一个都过不了契约校验。
 */
export function buildEnvironment({
  os,
  arch,
  browserVersion,
  browserRevision,
  fontDigest,
  locale,
  timezone,
  deviceScaleFactor,
  renderer,
  width,
  height,
  theme,
  frameworkVersion,
  echartsVersion,
}) {
  const environment = {
    os,
    arch,
    browserVersion,
    browserRevision,
    fontDigest,
    locale,
    timezone,
    deviceScaleFactor,
    renderer,
    width,
    height,
    theme,
    frameworkVersion,
    echartsVersion,
  };
  const missing = Object.entries(environment)
    .filter(([, value]) => value === undefined || value === null || value === '')
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`环境字段缺失：${missing.join(', ')}`);
  }
  return environment;
}

/** 环境字段自检：把明显的类型错误在进 key 之前拦下。 */
export function validateEnvironment(environment) {
  const problems = [];
  if (!/^[0-9a-f]{64}$/.test(String(environment.fontDigest))) {
    problems.push(`fontDigest 必须是 64 位十六进制：${environment.fontDigest}`);
  }
  if (!THEMES.includes(environment.theme)) problems.push(`theme 非法：${environment.theme}`);
  if (!RENDERERS.includes(environment.renderer)) problems.push(`renderer 非法：${environment.renderer}`);
  if (!Number.isInteger(environment.deviceScaleFactor) || environment.deviceScaleFactor <= 0) {
    problems.push(`deviceScaleFactor 必须是正整数：${environment.deviceScaleFactor}`);
  }
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(environment[key]) || environment[key] <= 0 || environment[key] > 8192) {
      problems.push(`${key} 必须是 1..8192 的整数：${environment[key]}`);
    }
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(environment.frameworkVersion))) {
    problems.push(`frameworkVersion 必须是精确版本：${environment.frameworkVersion}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(environment.echartsVersion))) {
    problems.push(`echartsVersion 必须是精确版本：${environment.echartsVersion}`);
  }
  return problems;
}
