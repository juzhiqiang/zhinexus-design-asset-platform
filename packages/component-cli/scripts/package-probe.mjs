#!/usr/bin/env node
/**
 * 把 T10 探针打成可随 `@company/component-cli` 分发的运行材料（A 侧）。
 *
 * 用法（在仓库根执行）：
 *   node packages/component-cli/scripts/package-probe.mjs            # 打包
 *   node packages/component-cli/scripts/package-probe.mjs --check    # 只复核已有产物
 *   node packages/component-cli/scripts/package-probe.mjs --out <d>  # 指定输出目录
 *
 * 产物布局（`packages/component-cli/dist/probe/`）：
 *   probe.mjs, environment.mjs, bundle.mjs, policy.mjs,
 *   consumer.mjs, browser.mjs, evidence.mjs, probe.test.mjs
 *   resources/examples/{vue,react,fixtures}/…     ← 双框架模板与 fixtures
 *   resources/tsconfig.base.json                  ← 示例 tsconfig 的 extends 目标
 *   probe-manifest.json                           ← 逐文件 sha256 + 字节数
 *
 * 为什么是这个布局：示例源码里写死了两条相对路径——`src/App.vue` 用
 * `../../fixtures/*.json`、各示例 `tsconfig.json` extends `../../tsconfig.base.json`。
 * 因此打包必须原样保留 `resources/examples/<framework>` 与 `resources/examples/fixtures`
 * 这对兄弟关系，探针的 `resolveProbeLayout()` 才能用同一个 `resourceRoot` 同时喂
 * `exampleDir` 与 `repoRoot` 给 `createConsumer`，不必改消费者那侧的任何签名。
 *
 * 边界（与 `AGENTS.md` 一致）：
 * - 只**复制**，不打包、不改写任何冻结产物；探针与模板都是只读源；
 * - **逐文件白名单**：进包的每一项都显式列出，缺一个失败、多一个也失败。
 *   没有"复制整个目录再排黑名单"这种形态——那迟早漏东西（C 实测：`.envrc`、
 *   `credentials.json`、`npm-debug.log`、`src/generated.js` 全被复制进去还报 ok）；
 * - `--out` 在删除前必须过闸门：指到源目录/仓库根/链接一律拒绝，来历不明的
 *   非空目录一律不删。只清理可证明是本脚本自己产出的目录；
 * - 不触碰根 `package.json` / 锁文件 / `packages/contracts` / SDK 包。
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根：本脚本位于 `<repo>/packages/component-cli/scripts/`。 */
export const REPO_ROOT_FROM_SCRIPT = path.resolve(HERE, '../../..');

/** 探针模块白名单：一个都不能少，少一个入口就起不来。 */
export const PROBE_MODULES = /** @type {const} */ ([
  'probe.mjs',
  'environment.mjs',
  'bundle.mjs',
  'policy.mjs',
  'consumer.mjs',
  'browser.mjs',
  'evidence.mjs',
  'probe.test.mjs',
]);

/**
 * 双框架模板的**逐文件**白名单（相对 `examples/<framework>/`）。
 *
 * 为什么逐个列出而不是列目录：列目录就只能靠"排除法"防污染，而排除法永远追不上
 * 新出现的文件名。逐个列出之后，白名单之外的任何文件——密钥、临时脚本、
 * 手滑生成的源码——都会让打包**失败**并点名，而不是被静默复制进产物。
 * 新增示例文件时必须显式加进来，这是有意的摩擦。
 */
export const PROBE_TEMPLATE_FILES = /** @type {const} */ ({
  vue: [
    'bar.html',
    'harness.html',
    'index.html',
    'keepalive.html',
    'package.json',
    'pie.html',
    'proportion.html',
    'ranking.html',
    'scatter.html',
    'src/App.vue',
    'src/BarApp.vue',
    'src/ChartPane.vue',
    'src/KeepAliveDemo.vue',
    'src/PieApp.vue',
    'src/ProportionApp.vue',
    'src/RankingApp.vue',
    'src/ScatterApp.vue',
    'src/TrendCardApp.vue',
    'src/bar-main.ts',
    'src/core-harness.ts',
    'src/example/runtime.ts',
    'src/keepalive-main.ts',
    'src/main.ts',
    'src/pie-main.ts',
    'src/proportion-main.ts',
    'src/ranking-main.ts',
    'src/scatter-main.ts',
    'src/trend-card-main.ts',
    'trend-card.html',
    'tsconfig.json',
    'vite.config.ts',
  ],
  react: [
    'bar.html',
    'index.html',
    'package.json',
    'pie.html',
    'proportion.html',
    'ranking.html',
    'scatter.html',
    'src/App.tsx',
    'src/BarApp.tsx',
    'src/PieApp.tsx',
    'src/ProportionApp.tsx',
    'src/RankingApp.tsx',
    'src/ScatterApp.tsx',
    'src/TrendCardApp.tsx',
    'src/bar-main.tsx',
    'src/example/runtime.ts',
    'src/main.tsx',
    'src/pie-main.tsx',
    'src/proportion-main.tsx',
    'src/ranking-main.tsx',
    'src/scatter-main.tsx',
    'src/styles.css',
    'src/trend-card-main.tsx',
    'trend-card.html',
    'tsconfig.json',
    'vite.config.ts',
  ],
});

/** fixtures 的逐文件白名单（相对 `examples/fixtures/`）。 */
export const PROBE_FIXTURE_FILES = /** @type {const} */ ([
  'bar.json',
  'line.json',
  'pie.json',
  'proportion.json',
  'ranking.json',
  'scatter.json',
  'trend-card.json',
]);

/**
 * 与探针同目录、但**刻意不随包分发**的文件。
 *
 * 只有一条，但必须是显式的一条：`package-probe.test.mjs` 测的是打包脚本自己，
 * 而脚本不在分发物里，所以它进了安装包也跑不起来。声明出来而不是"悄悄不管"，
 * 是为了让"多出一个文件"这件事继续是错误——新文件不会被默认放行。
 */
export const PROBE_DIR_NOT_SHIPPED = /** @type {const} */ (['package-probe.test.mjs']);

/** 资源白名单汇总。 */
export const PROBE_RESOURCE_SPEC = /** @type {const} */ ({
  templates: PROBE_TEMPLATE_FILES,
  fixtures: PROBE_FIXTURE_FILES,
  baseTsconfig: 'tsconfig.base.json',
  probeModules: PROBE_MODULES,
  notShipped: PROBE_DIR_NOT_SHIPPED,
});

/**
 * **已知本机构建状态**的目录名，封闭列表。
 *
 * 与"黑名单"的区别：这份名单不参与"这个文件能不能进包"的判断——能不能进包只由
 * 上面的逐文件白名单决定。它只回答一个次要问题：「打包时遍历到的东西是不是本机
 * 刚构建出来的」。是就整体跳过；不是（也不在白名单里）就报错。
 * 因此往 examples 里丢一个陌生文件不会被悄悄放行，也不会诱导人往这里加规则。
 */
export const KNOWN_LOCAL_STATE = /** @type {const} */ ([
  'node_modules',
  'dist',
  '.turbo',
  '.git',
  'coverage',
  'test-results',
  'playwright-report',
  '.release',
  '.cache',
  'vite',
  '.vite',
  '.pnpm-store',
]);

/**
 * **已知本机构建状态**的文件名样式，封闭列表。
 *
 * 同样是"增量构建留下的东西"，不是源码也不是凭据。刻意**不含** `npm-debug.log`、
 * `.env`、`credentials.json` 之类：那些要么可能带敏感内容，要么说明有人往源码树里
 * 丢了不该丢的东西，必须让人看见，不能静默跳过。
 */
export const KNOWN_LOCAL_STATE_FILE_PATTERNS = /** @type {const} */ ([/\.tsbuildinfo$/, /^\.eslintcache$/]);

/** 敏感文件名样式。只用于把「为什么被拒」说得更具体，不参与放行判断。 */
const SENSITIVE_PATTERNS = [
  /^\.env(\..+)?$/,
  /\.pem$/,
  /\.key$/,
  /\.crt$/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_ed25519$/,
  /\.(pfx|p12|jks|keystore)$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)credentials(\..+)?\.json$/,
  /(^|\/)secrets?(\..+)?\.json$/,
];

const LOCAL_STATE_SET = new Set(KNOWN_LOCAL_STATE);

/** 相对路径的任一段是否属于已知本机构建状态。 */
export function isKnownLocalState(rel) {
  const segments = String(rel).split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  if (KNOWN_LOCAL_STATE_FILE_PATTERNS.some((pattern) => pattern.test(name))) return true;
  return segments.some((segment) => LOCAL_STATE_SET.has(segment));
}

/** 命中敏感样式时返回人话解释，否则 null。 */
export function sensitiveHint(rel) {
  const name = path.basename(String(rel));
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(name)) return `（看起来是密钥/凭据类文件：${name}）`;
  }
  return '';
}

/** Windows 上路径大小写不敏感；比较前统一口径，否则同一条路径会判成两条。 */
function comparable(target) {
  const normalized = path.normalize(path.resolve(target));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** `a` 是否等于 `b` 或位于 `b` 内部（两者都应已 resolve）。 */
export function isInside(a, b) {
  const relative = path.relative(comparable(b), comparable(a));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 取**真实路径**；路径不存在时先解析到最近的已存在祖先再拼回后续段。
 *
 * 为什么需要"不存在"这一支：`--out` 与消费者根常常是"还不存在的目录"
 * （例如 `--consumer-root "/tmp/xxx/not yet created"`）。直接 realpath 会抛，
 * 于是这条路径逃过所有链接检查——而它恰好是最该被查的那条。
 */
export function resolveRealPath(target) {
  const absolute = path.resolve(target);
  const tail = [];
  let current = absolute;
  while (true) {
    if (existsSync(current)) {
      let real = current;
      try {
        real = realpathSync(current);
      } catch {
        // 取不到就按原样用：调用方还有 lexicographic 判据兜底
      }
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    }
    const parent = path.dirname(current);
    if (parent === current) return absolute;
    tail.push(path.basename(current));
    current = parent;
  }
}

/**
 * 无过滤枚举一个目录下的所有普通文件与符号链接（相对路径，统一用 `/`）。
 *
 * **不带任何排除过滤**——这是它与旧实现的根本区别。旧实现复用带过滤的枚举去
 * 复核产物，于是往 `dist/probe` 里追加的 `.env`、`node_modules/extra/index.js`、
 * `dist/residue.js` 全都看不见，`--check` 照样报 ok。复核既然要证明"产物干净"，
 * 枚举就不能替它决定什么不算脏。
 *
 * 符号链接单独收集且**不跟进**：跟进会绕出目录（也可能成环），而链接本身
 * 就是不该出现在产物里的东西。
 *
 * @param {string} root
 * @param {string} [prefix]
 * @returns {Promise<{files: string[]; links: string[]}>}
 */
export async function enumerateArtifact(root, prefix = '') {
  const files = [];
  const links = [];
  let entries;
  try {
    entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return { files, links };
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      links.push(rel);
    } else if (entry.isDirectory()) {
      const nested = await enumerateArtifact(root, rel);
      files.push(...nested.files);
      links.push(...nested.links);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return { files: files.sort(), links: links.sort() };
}

/**
 * 从源目录里按**逐文件白名单**收集材料。
 *
 * 四条判据全部无过滤执行：
 * ① 白名单里的文件必须都在——缺一个就是打包漏东西，失败并点名；
 * ② 白名单之外的文件必须一个都没有——密钥、临时脚本、手滑生成的源码，
 *    失败并点名，不静默跳过、也不往黑名单里加规则；
 * ③ 不得出现符号链接——产物里的链接在安装后会指向不存在的地方；
 * ④ `knownNotShipped` 里的文件是"同目录但不分发"的已知项，跳过；不在这份
 *    显式名单里的一律按 ② 处理。
 *
 * @param {string} dir 源目录
 * @param {string[]} allowed 逐文件白名单（相对 dir，`/` 分隔）
 * @param {string} label 出错时给人看的名字
 * @param {string[]} [knownNotShipped] 刻意不分发的已知文件
 * @returns {Promise<{source: string; target: string}[]>}
 */
async function collectWhitelisted(dir, allowed, label, knownNotShipped = []) {
  const found = await enumerateArtifact(dir);
  if (found.links.length > 0) {
    throw new Error(
      `PROBE_INPUT ${label} 下出现符号链接：${found.links.join(', ')}。` +
        '产物里不得有链接（安装后会断），请改成实体文件。',
    );
  }
  const allowedSet = new Set(allowed);
  const notShipped = new Set(knownNotShipped);
  const unexpected = found.files.filter(
    (rel) => !allowedSet.has(rel) && !notShipped.has(rel) && !isKnownLocalState(rel),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `PROBE_INPUT ${label} 下有白名单之外的文件：${unexpected.join(', ')}${sensitiveHint(unexpected[0])}。` +
        `请确认它们不该进包；若确实需要，请显式加入 ${label} 的逐文件白名单，` +
        '不要靠扩充排除名单绕过。',
    );
  }
  const present = new Set(found.files);
  const missing = allowed.filter((rel) => !present.has(rel));
  if (missing.length > 0) {
    throw new Error(`PROBE_INPUT ${label} 缺少白名单内的文件：${missing.join(', ')}`);
  }
  return allowed
    .filter((rel) => present.has(rel))
    .map((rel) => ({ source: path.join(dir, ...rel.split('/')), target: rel }));
}

/**
 * 生成一份只含白名单文件的清单（不落盘，便于单测）。
 *
 * @param {{repoRoot: string; probeDir?: string}} options
 * @returns {Promise<{source: string; target: string}[]>}
 */
export async function collectProbeResources({ repoRoot, probeDir = path.join('tests', 'acceptance', 't10-sdk') }) {
  const entries = [];
  const push = async (source, target) => {
    if (!existsSync(source)) {
      throw new Error(`PROBE_INPUT 打包资源缺失：${path.relative(repoRoot, source) || source}`);
    }
    const info = await stat(source);
    if (info.isDirectory()) {
      throw new Error(`PROBE_INTERNAL 目录不得整份进入清单：${source}（必须逐文件白名单）`);
    }
    entries.push({ source, target });
  };

  // 探针自身：整目录同样走逐文件白名单。多出一个模块也要失败——
  // 静默不复制会让"加了模块却没进包"这种事故一路漏到安装后才炸。
  entries.push(
    ...(await collectWhitelisted(
      path.join(repoRoot, probeDir),
      PROBE_MODULES,
      probeDir.replaceAll('\\', '/'),
      PROBE_DIR_NOT_SHIPPED,
    )).map((entry) => ({ source: entry.source, target: entry.target })),
  );
  for (const framework of Object.keys(PROBE_TEMPLATE_FILES)) {
    const dir = path.join(repoRoot, 'examples', framework);
    entries.push(
      ...(await collectWhitelisted(
        dir,
        PROBE_TEMPLATE_FILES[framework],
        `examples/${framework}`,
      )).map((entry) => ({ source: entry.source, target: `resources/examples/${framework}/${entry.target}` })),
    );
  }
  entries.push(
    ...(await collectWhitelisted(
      path.join(repoRoot, 'examples', 'fixtures'),
      PROBE_FIXTURE_FILES,
      'examples/fixtures',
    )).map((entry) => ({ source: entry.source, target: `resources/examples/fixtures/${entry.target}` })),
  );
  await push(path.join(repoRoot, PROBE_RESOURCE_SPEC.baseTsconfig), `resources/${PROBE_RESOURCE_SPEC.baseTsconfig}`);
  return entries;
}

/**
 * 删除 `out` 之前的闸门。
 *
 * C 复现的破坏路径：`--out .`（即 `out = repoRoot`）时，旧的 `rm(out, {recursive:true})`
 * 会把整个仓库连同探针源文件一起删掉。删除是不可逆操作，因此必须先证明三件事：
 *
 * ① **不是链接**：`out` 自身是符号链接/Junction 时一律拒绝。`rm` 对链接只摘链，
 *    但链接指向哪里不可信，且随后的 `mkdir` 会把真实目录变成实体目录，语义混乱；
 * ② **不与任何源路径互相包含**：`out` 覆盖源目录会连源一起删；`out` 落在源目录里
 *    会把源目录弄脏（下一次打包立刻失败）。在**真实路径**层面判，`..` 折返与
 *    链接绕法都现形；
 * ③ **可证明是本脚本自己的产物**：不存在、空目录、或带着本脚本写的
 *    `probe-manifest.json`。来历不明的非空目录一律不删——宁可让人手动确认，
 *    也不能把别人的数据当成构建残留删掉。
 *
 * @param {{out: string; sources?: string[]}} options
 * @returns {{ok: true} | {ok: false; reason: string}}
 */
export function checkOutputDirSafety({ out, sources = [] }) {
  const root = path.resolve(out);
  if (path.dirname(root) === root) {
    return { ok: false, reason: `输出目录不能是文件系统根：${root}` };
  }
  if (existsSync(root)) {
    let info;
    try {
      info = lstatSync(root);
    } catch {
      info = null;
    }
    if (info?.isSymbolicLink()) {
      return {
        ok: false,
        reason: `输出目录不得是符号链接/Junction：${root}。请指向真实目录。`,
      };
    }
    if (info && !info.isDirectory()) {
      return { ok: false, reason: `输出路径已存在且不是目录：${root}` };
    }
  }

  const realRoot = resolveRealPath(root);
  const protectedPaths = sources.map((source) => resolveRealPath(source));
  for (const target of protectedPaths) {
    if (isInside(target, realRoot)) {
      return {
        ok: false,
        reason:
          `输出目录 ${root} 覆盖了打包源路径 ${target}：删掉它会连源文件一起消失。` +
          '请换一个与源码无关的输出目录（例如 packages/component-cli/dist/probe）。',
      };
    }
    if (isInside(realRoot, target)) {
      return {
        ok: false,
        reason: `输出目录 ${root} 位于打包源路径 ${target} 内部：会弄脏源目录。`,
      };
    }
  }

  if (!existsSync(root)) return { ok: true };
  const entries = readdirSync(root);
  if (entries.length === 0) return { ok: true };
  // 带着本脚本写的清单，就证明这个目录归本脚本所有
  if (entries.includes('probe-manifest.json')) return { ok: true };
  return {
    ok: false,
    reason:
      `输出目录 ${root} 非空且没有 probe-manifest.json，无法证明它是本脚本的产物，拒绝删除。` +
      `现有内容：${entries.slice(0, 8).join(', ')}${entries.length > 8 ? '…' : ''}。` +
      '请人工确认后自行清理，或换一个输出目录。',
  };
}

/**
 * 复核一个已打包的 `dist/probe`：清单齐全、无清单外文件、无污染项、无链接、摘要一致。
 *
 * 这是给「安装后自检」与 CI 用的同一份判据：缺文件、多文件、混进本地状态、
 * **或文件被改过一个字节**都算失败，不因为"能跑起来"就放过。摘要核对是
 * 「安装包只读」这条约束的唯一可靠证据——只查存在性的话，往 dist/probe 里
 * 改一个文件照样能跑，复核却会说 ok。
 *
 * @param {string} root
 */
export async function verifyProbeBundle(root) {
  const reasons = [];
  const polluted = [];
  const tampered = [];
  const manifestPath = path.join(root, 'probe-manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      missing: [],
      extra: [],
      polluted: [],
      tampered: [],
      links: [],
      reasons: ['缺少 probe-manifest.json，无法复核'],
    };
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.complete !== true) {
    return {
      ok: false,
      missing: [],
      extra: [],
      polluted: [],
      tampered: [],
      links: [],
      reasons: ['清单未标记为已完成（上一次打包可能中断），不得当成完整产物；请重新执行打包'],
    };
  }
  const listed = new Set(manifest.files.map((entry) => entry.path));
  // 无过滤枚举：产物里出现的任何东西都要能被解释
  const found = await enumerateArtifact(root);
  const present = found.files.filter((rel) => rel !== 'probe-manifest.json');

  for (const entry of manifest.files) {
    const file = path.join(root, entry.path);
    if (!existsSync(file)) {
      reasons.push(`清单内文件缺失：${entry.path}`);
      continue;
    }
    const bytes = await readFile(file);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256 || bytes.length !== entry.bytes) {
      tampered.push(entry.path);
      reasons.push(`摘要不一致（文件被改动）：${entry.path}`);
    }
  }
  for (const rel of present) {
    if (!listed.has(rel)) reasons.push(`清单外文件：${rel}`);
    // 污染 = 清单外，且属于本机构建状态或密钥/凭据类文件
    if (isKnownLocalState(rel) || sensitiveHint(rel) !== '') polluted.push(rel);
  }
  if (polluted.length > 0) reasons.push(`污染项：${polluted.join(', ')}`);
  for (const rel of found.links) {
    reasons.push(`符号链接/Junction：${rel}`);
  }
  return {
    ok: reasons.length === 0,
    missing: manifest.files.filter((entry) => !existsSync(path.join(root, entry.path))).map((entry) => entry.path),
    extra: present.filter((rel) => !listed.has(rel)),
    polluted,
    tampered,
    links: found.links,
    reasons,
  };
}

/** 读打包产物自带的清单；没有就返回 null。 */
export async function readProbeManifest(root) {
  const file = path.join(root, 'probe-manifest.json');
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

/** 所有源路径（文件本身 + 它到 repoRoot 之前的每一级祖先目录）。 */
function protectedSources(entries, repoRoot) {
  const protectedSet = new Set();
  const root = comparable(repoRoot);
  for (const entry of entries) {
    let current = path.resolve(entry.source);
    while (true) {
      protectedSet.add(current);
      const parent = path.dirname(current);
      if (parent === current || comparable(parent) === root) break;
      current = parent;
    }
  }
  return [...protectedSet];
}

/**
 * 打包：过闸门 → 清产物目录 → 逐文件复制 → 算摘要 → 写清单 → 整体复核。
 *
 * 顺序是有意的：闸门必须在 `rm` **之前**。旧实现先删后判，等发现 `--out` 指到
 * 仓库根时源文件已经没了。
 *
 * @param {{repoRoot?: string; cliRoot?: string; out?: string}} options
 * @returns {Promise<{root: string; manifest: object; verification: object}>}
 */
export async function packageProbe({
  repoRoot = REPO_ROOT_FROM_SCRIPT,
  cliRoot = path.resolve(repoRoot, 'packages', 'component-cli'),
  out = path.join(cliRoot, 'dist', 'probe'),
} = {}) {
  const root = path.resolve(out);
  const entries = await collectProbeResources({ repoRoot });

  // ① 删除前的闸门：源目录/祖先重叠、链接绕法、来历不明的非空目录，一律先拒绝
  const safety = checkOutputDirSafety({ out: root, sources: protectedSources(entries, repoRoot) });
  if (!safety.ok) {
    throw new Error(`PROBE_INPUT ${safety.reason}`);
  }

  // ② 先落一份"未完成"清单：既声明这个目录归本脚本所有（下一次的闸门认它），
  //    也让"上一次跑到一半"这件事在 --check 时现形，而不是被当成完整产物。
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const manifestPath = path.join(root, 'probe-manifest.json');
  const planned = entries
    .map((entry) => ({ path: entry.target.replaceAll('\\', '/'), bytes: null, sha256: null }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifestFor([]), complete: false, files: planned }, null, 2)}\n`,
  );

  // ③ 逐文件复制：清单里有的才复制，一个都不多
  const files = [];
  for (const entry of entries) {
    const target = path.join(root, entry.target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(entry.source, target);
    const bytes = await readFile(target);
    files.push({
      path: entry.target.replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));

  await writeFile(manifestPath, `${JSON.stringify(manifestFor(files), null, 2)}\n`);

  const verification = await verifyProbeBundle(root);
  if (!verification.ok) {
    throw new Error(`PROBE_INTERNAL 打包产物复核失败：${verification.reasons.join('；')}`);
  }
  return { root, manifest: JSON.parse(await readFile(manifestPath, 'utf8')), verification };
}

/** 清单骨架。 */
function manifestFor(files) {
  return {
    schemaVersion: 1,
    kind: 'a-t10-probe-distribution',
    entry: 'probe.mjs',
    resourceRoot: 'resources',
    generatedBy: 'packages/component-cli/scripts/package-probe.mjs',
    complete: true,
    files,
  };
}

const USAGE = `T10 探针分发材料打包

  node packages/component-cli/scripts/package-probe.mjs            打包到 dist/probe
  node packages/component-cli/scripts/package-probe.mjs --check    只复核已有产物
  node packages/component-cli/scripts/package-probe.mjs --out <d>  指定输出目录

产物：<out>/probe.mjs 等八个模块 + <out>/resources/{examples,tsconfig.base.json} + probe-manifest.json

逐文件白名单：进包的每一项都显式列出；缺文件、多文件都会失败。
删除闸门：--out 指到源码目录/仓库根、是符号链接、或是来历不明的非空目录时一律拒绝。
`;

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  const outIndex = args.indexOf('--out');
  const out = outIndex === -1 ? undefined : args[outIndex + 1];
  if (outIndex !== -1 && !out) {
    process.stderr.write('--out 需要一个目录参数\n');
    return 2;
  }
  const root = path.resolve(out ?? path.join(REPO_ROOT_FROM_SCRIPT, 'packages', 'component-cli', 'dist', 'probe'));
  if (args.includes('--check')) {
    if (!existsSync(root)) {
      process.stderr.write(`PROBE_INPUT 待复核目录不存在：${root}\n请先执行打包。\n`);
      return 2;
    }
    const verification = await verifyProbeBundle(root);
    const manifest = await readProbeManifest(root);
    const found = await enumerateArtifact(root);
    process.stdout.write(
      `复核 ${root}\n` +
        `  清单文件数：${manifest?.files?.length ?? 0}\n` +
        `  实际文件数：${found.files.filter((rel) => rel !== 'probe-manifest.json').length}\n` +
        `  缺失：${verification.missing.length}\n` +
        `  清单外：${verification.extra.length}\n` +
        `  污染：${verification.polluted.length}\n` +
        `  链接：${verification.links.length}\n` +
        `  被改动：${verification.tampered.length}\n` +
        `  结论：${verification.ok ? 'ok' : 'failed'}\n`,
    );
    if (!verification.ok) {
      for (const reason of verification.reasons) process.stderr.write(`  - ${reason}\n`);
      return 1;
    }
    return 0;
  }
  const result = await packageProbe({ out });
  process.stdout.write(
    `已打包 ${result.root}\n` +
      `  文件数：${result.manifest.files.length}\n` +
      `  字节数：${result.manifest.files.reduce((sum, entry) => sum + entry.bytes, 0)}\n` +
      `  复核：${result.verification.ok ? 'ok' : 'failed'}\n`,
  );
  return result.verification.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${String(error?.message ?? error)}\n`);
      process.exit(1);
    });
}
