/**
 * 工作区外干净消费者（T10 探针，A 侧）。
 *
 * 探针把 `examples/<framework>` 的源码复制到系统临时目录，把其中的 `workspace:*`
 * 换成冻结 tarball 的 `file:` 绝对路径，再补上示例原本从工作区根借用的开发依赖，
 * 然后 `npm install`。消费者目录**不在仓库内**，因此类型检查、构建与截图都不可能
 * 经由 workspace 链接或源码 alias 命中仓库里的未提交改动。
 *
 * 纯函数 `rewriteConsumerManifest` 单独可测；涉及 npm / tsc / vite 的部分只在
 * `probe.mjs` 的真实运行中执行。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 示例原本从工作区根借用的开发依赖：精确版本，与根 `package.json` / `rules/platform.md` 一致。 */
export const CONSUMER_DEV_DEPENDENCIES = /** @type {const} */ ({
  common: {
    '@types/node': '26.6.6',
    vite: '8.3.8',
  },
  vue: {
    '@vitejs/plugin-vue': '6.0.10',
    typescript: '6.0.3',
    'vue-tsc': '3.3.14',
  },
  react: {
    '@vitejs/plugin-react': '6.3.0',
    typescript: '7.0.2',
    '@types/react': '19.3.0',
    '@types/react-dom': '19.3.0',
  },
});

/**
 * 把示例 `package.json` 改写成干净消费者 `package.json`。
 *
 * 三条硬约束：
 * 1. `workspace:*` 一律换成 `file:<冻结 tarball 绝对路径>`，换完不得再有 `workspace:` 残留；
 * 2. `@company/*` 同时写进 `overrides`——否则 npm 会按版本号去公共 registry 找私有包；
 * 3. `echarts` 被替换成候选精确版本，这是探针唯一被允许改动的依赖版本。
 */
export function rewriteConsumerManifest(manifest, { tarballs, echartsVersion, framework }) {
  const fileDependency = (name) => {
    const tarball = tarballs[name];
    if (!tarball) throw new Error(`冻结 bundle 中没有 ${name} 的 tarball`);
    return `file:${tarball.replaceAll('\\', '/')}`;
  };
  const dependencies = {};
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (spec === 'workspace:*') {
      dependencies[name] = fileDependency(name);
    } else if (name === 'echarts') {
      dependencies[name] = echartsVersion;
    } else {
      dependencies[name] = spec;
    }
  }
  const overrides = {};
  for (const name of Object.keys(tarballs)) {
    overrides[name] = fileDependency(name);
  }
  const devDependencies = {
    ...CONSUMER_DEV_DEPENDENCIES.common,
    ...CONSUMER_DEV_DEPENDENCIES[framework],
    ...(manifest.devDependencies ?? {}),
  };
  const rewritten = {
    ...manifest,
    name: `a-t10-probe-consumer-${framework}`,
    version: '1.0.0',
    private: true,
    description: `T10 探针干净消费者（${framework}）：安装冻结 tarball 与 echarts ${echartsVersion}`,
    dependencies,
    devDependencies,
    overrides,
  };
  const serialized = JSON.stringify(rewritten);
  if (serialized.includes('workspace:')) {
    throw new Error('PROBE_INTERNAL 改写后的消费者仍含 workspace: 协议');
  }
  return rewritten;
}

/**
 * spawn 选项：**一律 `shell: false`**。
 *
 * Windows 上原先用 `shell: process.platform === 'win32'`，于是命令行要过一层 `cmd.exe`，
 * 带空格的路径会被拆开——C 实测 `run(execPath, ["C:/t10 path/script.mjs"])` 报
 * `Cannot find module C:\t10`。正确做法是不走 shell：Node 可执行文件与 npm 都用
 * `npmInvocation()` 给出的真实可执行路径（node + npm-cli.js），argv 原样传递。
 *
 * @param {{production?: boolean; timeoutMs?: number}} [options]
 */
export function spawnOptions({ production = false, timeoutMs = 900_000 } = {}) {
  return {
    shell: false,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    env: production ? { ...process.env, NODE_ENV: 'production' } : process.env,
  };
}

/**
 * 跑一个子进程。
 *
 * `spawnImpl` 可注入：单测用它断言「不过 shell、argv 原样传递」，不必真起进程。
 */
export function run(command, args, cwd, { production = false, timeoutMs = 900_000, spawnImpl = spawnSync } = {}) {
  const result = spawnImpl(command, args, { cwd, ...spawnOptions({ production, timeoutMs }) });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    status: result.status ?? -1,
    output: output.length > 200_000 ? `${output.slice(0, 200_000)}\n…[截断]` : output,
    error: result.error ? String(result.error.message ?? result.error) : undefined,
  };
}

/**
 * npm 可执行入口。
 *
 * Windows 的 Node 发行版把 npm 放在 `<node>/node_modules/npm/bin/npm-cli.js`，
 * Linux 的官方 tarball 则放在 `<node>/lib/node_modules/npm/bin/npm-cli.js`
 * （`<node>/bin/npm` 只是软链）。两种布局都试一遍，都不中就退回 PATH 上的 `npm`。
 *
 * 关键是**必须用 node 去跑 npm-cli.js**，不要在 Windows 上直接调 `npm.cmd`：
 * `.cmd` 只能靠 shell 启动，而一过 shell 带空格的路径就会被拆开（见 `spawnOptions`）。
 * 这样同一份入口在 Windows（C 跑）与 Linux（A 跑）都能用。
 */
export function npmInvocation() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { command: process.execPath, prefix: [candidate] };
  }
  return { command: 'npm', prefix: [] };
}

/** 走 `npmInvocation` 的 npm：不过 shell，argv 原样传递。 */
export function npm(args, cwd, options) {
  const { command, prefix } = npmInvocation();
  return run(command, [...prefix, ...args], cwd, options);
}

/**
 * peer 放宽决策：严格安装被拒后是否允许用 `--legacy-peer-deps` 重试。
 *
 * 只有**显式** `--peer legacy` 才允许放宽。原先只对 `strict-only` 拦住，默认的 `strict`
 * 被拒后也会自动放宽——等于「默认就绕过 peer」，这正是纪律要防的事：
 * 绕过 peer 后能不能用，会被读成「兼容」。
 *
 * @param {'strict'|'legacy'|'strict-only'} peer
 * @param {number} strictStatus 严格安装的退出码
 * @returns {{retry: boolean; mode: 'strict'|'legacy'}}
 */
export function peerRetryPlan(peer, strictStatus) {
  if (strictStatus === 0) return { retry: false, mode: 'strict' };
  if (peer === 'legacy') return { retry: true, mode: 'legacy' };
  return { retry: false, mode: 'strict' };
}

/** 从安装结果里摘出失败原因分类，供报告分流（不解析整段日志）。 */
export function classifyInstallFailure(output) {
  if (output.includes('ERESOLVE')) {
    return { reason: 'peer-unresolved', detail: 'npm ERESOLVE：候选 ECharts 与冻结包声明的 peer 精确版本不一致' };
  }
  if (output.includes('ETARGET') || output.includes('No matching version')) {
    return { reason: 'version-not-found', detail: 'registry 中找不到请求的精确版本' };
  }
  if (output.includes('E404')) return { reason: 'not-found', detail: 'registry 404' };
  if (output.includes('ENOTFOUND') || output.includes('EAI_AGAIN')) {
    return { reason: 'network', detail: '无法访问 registry' };
  }
  return { reason: 'install-failed', detail: output.slice(-2000) };
}

/**
 * 创建干净消费者：复制示例源码、改写清单、安装依赖。
 *
 * @returns {Promise<object>} 消费者描述（含两次安装的结果与解析到的精确版本）
 */
export async function createConsumer({
  framework,
  exampleDir,
  repoRoot,
  tarballs,
  echartsVersion,
  consumerRoot,
  peer = 'strict',
}) {
  // 硬约束：干净消费者必须建在仓库之外。三种绕法（直接写仓库内、`..` 折回、
  // 符号链接 / Junction 指向仓库内）都在 checkOutsideRepo 里拦。
  const outside = checkOutsideRepo(consumerRoot ?? tmpdir(), repoRoot);
  if (!outside.ok) {
    throw new Error(`PROBE_INPUT ${outside.reason}`);
  }
  const root = path.resolve(consumerRoot ?? tmpdir());
  await mkdir(root, { recursive: true });
  // 暂存根：示例源码用 `../../fixtures/*.json` 引用仓库的 `examples/fixtures`，
  // 复制到工作区外后这条相对路径指向消费者的上一级。因此每个探针运行各有自己的
  // 暂存根，fixtures 放在暂存根下、消费者放在暂存根下一层，相对路径自然对上，
  // 也不会把 fixtures 丢进共享的临时目录。
  const staging = await mkdtemp(path.join(root, 'a-t10-staging-'));
  // 从建 staging 起的每一步失败都要收尾。
  //
  // 原先只覆盖安装阶段，且严格安装被拒时只 `rm(exampleRoot)`（那只是 staging 下的一层），
  // 于是 `staging` 本身连同样板里的 `fixtures/` 一起留在临时目录。更糟的是：异常抛出时
  // `staging` 还没返回给主编排，`removeConsumer` 根本不知道该删哪个目录——临时目录越积越多。
  const abandonStaging = async () => {
    if (!/^a-t10-staging-/.test(path.basename(staging))) {
      throw new Error(`PROBE_INTERNAL 拒绝删除非探针创建的目录：${staging}`);
    }
    await rm(staging, { recursive: true, force: true });
  };

  let exampleRoot;
  // `rewritten` 必须在 try 之外声明：return 里的 `manifest: rewritten` 与 digest 都要用它。
  // 放在 try 内会构成 ReferenceError——成功路径直接崩，而且崩在证据出具之前。
  let rewritten = null;
  try {
    const dir = path.join(staging, `a-t10-consumer-${framework}`);
    await mkdir(dir, { recursive: true });
    exampleRoot = await cp(path.resolve(exampleDir), dir, { recursive: true, force: true }).then(() => dir);
    await cp(path.resolve(repoRoot, 'examples', 'fixtures'), path.join(staging, 'fixtures'), {
      recursive: true,
      force: true,
    });
    // `examples/*/tsconfig.json` 继承仓库根的 `tsconfig.base.json`，同样会断链；
    // 把它搬进消费者并把 extends 改成消费者内相对路径，编译器设置与仓库完全一致。
    await cp(path.resolve(repoRoot, 'tsconfig.base.json'), path.join(exampleRoot, 'tsconfig.base.json'), {
      force: true,
    });
    const exampleTsconfig = path.join(exampleRoot, 'tsconfig.json');
    const tsconfig = await readFile(exampleTsconfig, 'utf8');
    if (tsconfig.includes('../../tsconfig.base.json')) {
      await writeFile(exampleTsconfig, tsconfig.replaceAll('../../tsconfig.base.json', './tsconfig.base.json'));
    }
    const manifestPath = path.join(exampleRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    rewritten = rewriteConsumerManifest(manifest, { tarballs, echartsVersion, framework });
    await writeFile(manifestPath, `${JSON.stringify(rewritten, null, 2)}\n`);
  } catch (error) {
    await abandonStaging().catch(() => {});
    throw error;
  }

  const installs = [];
  let strict;
  try {
    strict = npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], exampleRoot);
    installs.push({ mode: 'strict', ...strict });
    if (strict.status !== 0) {
      const classified = classifyInstallFailure(strict.output);
      const plan = peerRetryPlan(peer, strict.status);
      if (!plan.retry) {
        await abandonStaging();
        throw new Error(
          `PROBE_PEER_REJECTED 严格 peer 安装被拒绝（${classified.reason}）。` +
            `当前 peer 模式为 ${peer}，按纪律不得自动放宽：候选未落在已锁定的 peer 精确版本上时，` +
            '放宽只会让「绕过 peer 后能不能用」冒充成「兼容」。需要测量请显式传 --peer legacy。',
        );
      }
      // 只有显式 --peer legacy 才走到这里：目的是测量「绕过 peer 后到底能不能用」，
      // 这不改变 SDK 声明，也不构成通过结论（证据里会记 peerMode=legacy 并进未覆盖说明）。
      const legacy = npm(
        ['install', '--no-audit', '--no-fund', '--loglevel=error', '--legacy-peer-deps'],
        exampleRoot,
      );
      installs.push({ mode: 'legacy', ...legacy, ...classified });
      if (legacy.status !== 0) {
        await abandonStaging();
        throw new Error(
          `PROBE_INSTALL_FAILED 干净消费者安装失败（strict=${strict.status} legacy=${legacy.status}）：\n${legacy.output}`,
        );
      }
    }
  } catch (error) {
    // 已按上面各分支收过尾的就不再重复删；其余异常（读 manifest、cp 失败等）统一收
    if (existsSync(staging)) await abandonStaging().catch(() => {});
    throw error;
  }

  const applied = installs.some((entry) => entry.mode === 'legacy') ? 'legacy' : 'strict';

  const resolved = await readResolvedVersions(exampleRoot, [
    ...Object.keys(tarballs),
    'echarts',
    'zrender',
    'vue',
    'react',
    'react-dom',
    'typescript',
  ]);
  return {
    framework,
    root: exampleRoot,
    staging,
    manifest: rewritten,
    installs,
    applied,
    resolved,
    digest: createHash('sha256').update(JSON.stringify(rewritten)).digest('hex').slice(0, 16),
  };
}

/**
 * `a` 是否等于 `b` 或位于 `b` 内部。
 *
 * @param {string} a 待判路径（应已 resolve）
 * @param {string} b 基准路径（应已 resolve）
 */
export function isInside(a, b) {
  const relative = path.relative(b, a);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** 取真实路径；不存在或取不到就原样返回（调用方负责后续判断）。 */
function realPathOrSelf(target) {
  try {
    return realpathSync.native(target);
  } catch {
    return target;
  }
}

/** 向上找最近的已存在祖先：用于判断「尚不存在的路径」究竟会落在哪里。 */
function nearestExisting(target) {
  let current = path.resolve(target);
  while (true) {
    if (existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 干净消费者必须建在**仓库之外**。
 *
 * `AGENTS.md` 的硬约束是「工作区外干净消费者」：消费者目录一旦落在仓库内，类型检查与
 * 构建就可能经由 workspace 链接或源码 alias 命中仓库里的未提交改动，「验的是用户装到的
 * 包」这句话就落了空。因此建 staging 之前必须核对真实路径，三种绕法都要拦：
 * ① 直接写仓库内路径；② 用 `..` 折回仓库内（resolve 之后现形）；
 * ③ 用符号链接 / Windows junction 指向仓库内（必须取真实路径才能发现）。
 *
 * 仓库**外部**尚不存在、且带空格的路径仍然允许——那正是隔离安装的正常用法。
 *
 * @param {string} consumerRoot 调用方给的消费者根目录
 * @param {string} repoRoot 仓库根目录
 * @returns {{ok: true} | {ok: false; reason: string}}
 */
export function checkOutsideRepo(consumerRoot, repoRoot) {
  const root = path.resolve(repoRoot);
  const candidate = path.resolve(consumerRoot);
  if (isInside(candidate, root)) {
    return { ok: false, reason: `消费者根目录 ${candidate} 位于仓库 ${root} 内部，违反「工作区外干净消费者」约束` };
  }
  const realRoot = realPathOrSelf(root);
  const realCandidate = realPathOrSelf(candidate);
  if (realCandidate !== candidate && isInside(realCandidate, realRoot)) {
    return {
      ok: false,
      reason: `消费者根目录 ${candidate} 经符号链接/Junction 指向仓库内部（真实路径 ${realCandidate}）`,
    };
  }
  // 候选路径可能尚不存在：对它最近的已存在祖先取真实路径，
  // 否则「仓库内一个还不存在的子目录」会逃过检查。
  const anchor = nearestExisting(candidate);
  if (anchor !== null) {
    const realAnchor = realPathOrSelf(anchor);
    if (isInside(realAnchor, realRoot)) {
      return {
        ok: false,
        reason: `消费者根目录 ${candidate} 的最近已存在祖先 ${anchor} 位于仓库内部（真实路径 ${realAnchor}）`,
      };
    }
  }
  return { ok: true };
}

/** 读回消费者 `node_modules` 里真实安装的版本——「声称的版本」不算证据。 */
export async function readResolvedVersions(consumerRoot, names) {
  const resolved = {};
  for (const name of names) {
    try {
      const manifestPath = path.join(consumerRoot, 'node_modules', ...name.split('/'), 'package.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      resolved[name] = manifest.version;
    } catch {
      resolved[name] = null;
    }
  }
  return resolved;
}

/**
 * 探针 tsconfig：以示例自己的 `tsconfig.json` 为底，叠加探针要的额外严格度。
 *
 * 为什么不从零写一份配置：示例的 `jsx` / `resolveJsonModule` / `esModuleInterop` 是
 * 应用能编译的前提，从零写会漏掉它们，于是 React 会报一片
 * `TS17004 Cannot use JSX unless the '--jsx' flag is provided`——那是探针配置的缺陷，
 * 不是 SDK 的缺陷。以示例配置为底，探针只覆盖自己真正想收紧的几项。
 *
 * @param {object} base 示例自己的 tsconfig（已解析好的 JSON 对象）
 * @param {'Bundler'|'NodeNext'} resolution
 * @returns {object} 合并后的 tsconfig
 */
export function buildProbeTsconfig(base, resolution) {
  const overrides = {
    target: 'ES2022',
    module: resolution === 'Bundler' ? 'ESNext' : 'NodeNext',
    moduleResolution: resolution,
    noEmit: true,
    strict: true,
    // 仓库 tsconfig.base.json 用 `skipLibCheck: true`；干净消费者这里刻意关掉，
    // 让 SDK 自己产出的 `.d.ts` 里的错误也计入结论，而不是被跳过。
    skipLibCheck: false,
    types: ['vite/client', 'node'],
  };
  const compilerOptions = { ...(base?.compilerOptions ?? {}), ...overrides };
  // NodeNext 下 `allowImportingTsExtensions` 只在 noEmit 时合法，两个模式都满足；
  // 但 `paths` / `rootDir` 之类相对路径的设置在探针配置里没有意义，剔除以免误导。
  delete compilerOptions.paths;
  delete compilerOptions.rootDir;
  delete compilerOptions.outDir;
  delete compilerOptions.declaration;
  delete compilerOptions.composite;
  delete compilerOptions.incremental;
  return {
    ...base,
    extends: undefined,
    compilerOptions,
    include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.tsm', 'src/**/*.vue', 'vite.config.ts'],
  };
}

/**
 * NodeNext 探针源文件：只 import SDK 的公开入口，不把示例应用一起拖进来。
 *
 * NodeNext 这一维的存在理由是 `charts-vue` 曾经在 `.d.ts` 里写了不带扩展名的
 * 裸 `.vue` 声明说明符（`0.0.9` 修复），只有 NodeNext 才暴露。要测的是 **SDK 声明
 * 表面的 NodeNext 可解析性**，不是示例应用的代码风格（示例里 `./BarApp` 这类无扩展名
 * 相对导入在 nodenext 下必然报 TS2835，与应用本身能不能用无关）。
 */
export function sdkSurfaceProbeSource(packageName, subpaths) {
  const lines = [
    `// 由 T10 探针生成：仅用于在 NodeNext 下解析 SDK 公开入口。`,
    ...subpaths.map((subpath, index) => `import type * as surface${index} from ${JSON.stringify(packageName + subpath)};`),
    `import type * as root from ${JSON.stringify(packageName)};`,
    ``,
    `export type A10Surface = [`,
    ...subpaths.map((_, index) => `  typeof surface${index},`),
    `  typeof root,`,
    `];`,
    ``,
  ];
  return lines.join('\n');
}

/**
 * 类型检查：`Bundler`（示例自身配置 + 额外严格度，覆盖整个示例应用）与
 * `NodeNext`（只覆盖 SDK 公开入口的解析）。
 *
 * @param {object} consumer `createConsumer` 的返回
 * @param {{packageName:string; subpaths:string[]}} sdk
 * @param {{resolutionModes?: ('Bundler'|'NodeNext')[]}} [options]
 */
export async function runTypechecks(consumer, sdk, { resolutionModes = ['Bundler', 'NodeNext'] } = {}) {
  const base = JSON.parse(await readFile(path.join(consumer.root, 'tsconfig.json'), 'utf8'));
  const results = [];
  for (const resolution of resolutionModes) {
    const tool = consumer.framework === 'vue' ? 'vue-tsc' : 'tsc';
    let include = buildProbeTsconfig(base, resolution).include;
    if (resolution === 'NodeNext') {
      await writeFile(
        path.join(consumer.root, 'src', 'a-t10-sdk-surface.ts'),
        sdkSurfaceProbeSource(sdk.packageName, sdk.subpaths),
      );
      include = ['src/a-t10-sdk-surface.ts'];
    }
    const config = { ...buildProbeTsconfig(base, resolution), include };
    await writeFile(
      path.join(consumer.root, `tsconfig.probe-${resolution}.json`),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    const command = npm(['exec', '--', tool, '--noEmit', '-p', `tsconfig.probe-${resolution}.json`], consumer.root, {
      production: true,
    });
    results.push({ tool, resolution, scope: resolution === 'NodeNext' ? 'sdk-surface' : 'example-app', ...command });
  }
  return results;
}

/** 生产构建：`vite build`。 */
export function runBuild(consumer) {
  return npm(['run', 'build'], consumer.root, { production: true });
}

/**
 * SSR 安全导入：在纯 Node 环境 import 已安装包的每个公开入口。
 *
 * 断言两件事：① 八个入口（根 + 七个子路径）全部可导入且导出完整；
 * ② 模块顶层没有触碰 `window` / `document` / `navigator`——SSR 宿主只承诺安全导入。
 */
export async function runSsrImport(consumer, { packageName, subpaths }) {
  const probe = path.join(consumer.root, 'a-t10-ssr-import.mjs');
  const lines = [];
  for (const subpath of subpaths) {
    lines.push(`const m${subpaths.indexOf(subpath)} = await import(${JSON.stringify(packageName + subpath)});`);
  }
  lines.push(`const root = await import(${JSON.stringify(packageName)});`);
  lines.push(`console.log(JSON.stringify({ windowDefined: typeof window !== 'undefined', documentDefined: typeof document !== 'undefined', navigatorDefined: typeof navigator !== 'undefined' }));`);
  await writeFile(probe, `${lines.join('\n')}\n`);
  const result = run(process.execPath, [probe], consumer.root);
  await rm(probe, { force: true });
  let payload = null;
  const lastLine = result.output.trim().split('\n').pop();
  try {
    payload = JSON.parse(lastLine ?? '');
  } catch {
    payload = null;
  }
  return { ...result, payload };
}

/** 清理消费者暂存根；只删自己创建的 `a-t10-staging-*` 目录。 */
export async function removeConsumer(consumer) {
  const owned = path.basename(consumer.staging);
  if (!/^a-t10-staging-/.test(owned)) {
    throw new Error(`PROBE_INTERNAL 拒绝删除非探针创建的目录：${consumer.staging}`);
  }
  await rm(consumer.staging, { recursive: true, force: true });
}

/**
 * 核对消费者**实际安装**的候选来源与 integrity。
 *
 * 只看「版本号相等 + integrity 以 sha512- 开头」是不够的：那只能证明字符串形状对，
 * 不能证明装进来的字节来自官方源。这里读 `npm install` 生成的 `package-lock.json`，
 * 逐项核对四件事：
 * 1. 锁里解析到的 echarts 版本就是候选版本；
 * 2. 锁里的 `integrity` 与 registry 给出的 `dist.integrity` 完全一致；
 * 3. `resolved` 的协议是 `https:` 且主机就是 registry 主机（排除 `file:` / 本地 tarball）；
 * 4. 该条目不是 `link: true` / `dev` -only 的替代来源。
 *
 * 任一项对不上即返回 `verified: false` 并说明原因——调用方据此判 hold。
 *
 * @param {string} consumerRoot 消费者根目录
 * @param {{packageName?: string; version: string; integrity: string; registryHost: string}} expected
 * @returns {Promise<{verified: boolean; reason?: string; entry?: object}>}
 */
export async function verifyConsumerCandidateSource(consumerRoot, expected) {
  const packageName = expected.packageName ?? 'echarts';
  const lockPath = path.join(consumerRoot, 'package-lock.json');
  let lock;
  try {
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    return { verified: false, reason: `读不到消费者 package-lock.json：${String(error?.message ?? error)}` };
  }
  const entry = lock?.packages?.[`node_modules/${packageName}`];
  if (!entry) {
    return { verified: false, reason: `package-lock.json 里没有 node_modules/${packageName} 条目` };
  }
  if (entry.version !== expected.version) {
    return {
      verified: false,
      reason: `锁里解析到 ${packageName}@${entry.version}，与候选 ${expected.version} 不一致`,
      entry,
    };
  }
  if (entry.integrity !== expected.integrity) {
    return {
      verified: false,
      reason:
        `锁里的 integrity 与 registry 不一致：锁=${String(entry.integrity).slice(0, 24)}…，` +
        `registry=${String(expected.integrity).slice(0, 24)}…`,
      entry,
    };
  }
  const resolved = String(entry.resolved ?? '');
  // link 必须先判：link 条目的 resolved 常常是相对路径，先解析 URL 会报「不是合法 URL」，
  // 把真正的原因（本地链接）盖掉。
  if (entry.link === true) {
    return { verified: false, reason: '锁里该条目是 link（工作区/本地链接），不是 registry 安装', entry };
  }
  let host = null;
  try {
    host = new URL(resolved).host;
  } catch {
    return { verified: false, reason: `锁里的 resolved 不是合法 URL：${resolved}`, entry };
  }
  if (!resolved.startsWith('https:')) {
    return { verified: false, reason: `锁里的 resolved 不是 https 来源：${resolved}`, entry };
  }
  if (host !== expected.registryHost) {
    return {
      verified: false,
      reason: `锁里的来源主机 ${host} 与 registry 主机 ${expected.registryHost} 不一致`,
      entry,
    };
  }
  return { verified: true, entry };
}

/** 导出入口清单：与冻结 manifest 的 `exports` 对齐（根 + 七个子路径 + style.css）。 */
export const PUBLIC_SUBPATHS = /** @type {const} */ (['', '/line', '/bar', '/pie', '/scatter', '/trend-card', '/ranking', '/proportion']);

export function packageDir(consumerRoot, packageName) {
  return path.join(consumerRoot, 'node_modules', ...packageName.split('/'));
}
