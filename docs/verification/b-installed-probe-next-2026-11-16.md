# 已安装 CLI 0.0.10 的 T10 探针分发入口审计与交接（2026-11-16）

- 日期：2026-11-16
- 执行人：B（`packages/component-cli` + `apps/gallery` 负责人）
- Worktree：`C:\Users\10208\.codex\worktrees\t13-b-match-ui\zhinexus-design-asset-platform`
- 分支：`feat/b-release-acceptance-20261116`（HEAD `42e837c6`）
- 性质：**只读审计 + 交接文档**。未改任何产品代码、未打补丁、未重打包、未合并 A 的源、未做任何 Git 操作、未改版本号。

## 0. 结论先行

**已安装的 CLI 0.0.10 无法对本次冻结 SDK（core 0.0.10 + Vue/React 0.0.11）跑进 56 组合矩阵。**

它在 `readAndVerifyFrozenBundle` 阶段就被自己的「三包同版本」闸门拒绝，**探针子进程根本不会启动**，因此既到不了视觉 hold、也到不了 adopt。后面第 3 节给出三处独立闸门与实证；第 6 节给 C 可直接执行的 Windows 复核命令；第 7 节列阻塞与后续升版/新候选验收要求。

## 1. 冻结输入（B 侧只读核验的事实）

| 项 | 值 |
| --- | --- |
| 冻结 CLI tarball | `D:\project\zhinexus-design-asset-platform\.tools\b-cli0010-distribution-KJhUCm\company-component-cli-0.0.10.tgz`，218759 字节 |
| CLI tarball SHA-256 | `0261b846c6c738e509a99afeb2c8089902538856d42a6609f85484cb629063e9`（B 实算，与 C 声明值一致，可确认同一份字节） |
| 已安装真实路径 | `C:\Users\10208\AppData\Local\Temp\zhinexus-cli0010-consumer-xRMZib\node_modules\.pnpm\@company+component-cli@file_3c39797316c51dfdb2c6b3baf2eecce0\node_modules\@company\component-cli` |
| 冻结 SDK 严格副本 | `D:\project\zhinexus-design-asset-platform\.tools\operations\next-sdk-handoff-zQIRda` |
| 逐项核验材料 | handoff 目录旁的 `next-sdk-handoff-zQIRda.evidence.json`（manifestSha256 `917f195aaa1deb12c30ad55a482241cbfd1182173777f4757edfbeff523c997d`，declaredFiles 199） |
| SDK 三包版本 | `@company/charts-core@0.0.10`、`@company/charts-vue@0.0.11`、`@company/charts-react@0.0.11` |
| SDK 三包摘要/字节 | B 对 handoff 目录实算：三个 tarball 的 SHA-256 与字节数**全部**与 manifest 一致 |
| echarts peer | 三包均为精确 `6.1.0`（集合大小 1） |
| Vue/React → charts-core 依赖 | 均为精确 `0.0.10`，与 core 实际版本一致 |
| variants / compatibility | 14 个 variant，14 条 `status: 'passed'` 记录，vue@3.5.45 与 react@19.3.1 各 7 条，echarts 均为 6.1.0 |

> B 侧读不到本 worktree 的 `.tools`（它是一个符号链接/junction，沙箱内解析失败），故改从主仓库挂载 `D:\project\zhinexus-design-asset-platform\.tools\...` 读取同一份冻结 tarball 与 handoff 副本；tarball 摘要与 C 声明值一致，因此可确认是同一份字节。

## 2. 默认 packaged probe 入口接线（审计通过）

`packages/component-cli/src/commands/echarts.ts` 的 `resolveDefaultProbeEntry()`：

```ts
const selfPath = fileURLToPath(import.meta.url);
const inSrc = path.basename(path.dirname(path.dirname(selfPath))) === 'src';
return fileURLToPath(new URL(inSrc ? '../../dist/probe/probe.mjs' : '../probe/probe.mjs', import.meta.url));
```

B 用路径演算核对了三种布局，结论是**安装形态解析正确**：

| `import.meta.url` 实际位置 | inSrc | 解析出的探针入口 |
| --- | --- | --- |
| `<pkg>/src/commands/echarts.ts`（仓库源码形态） | true | `<pkg>/dist/probe/probe.mjs` |
| `<pkg>/dist/commands/echarts.js`（构建产物形态） | false | `<pkg>/dist/probe/probe.mjs` |
| `<installRoot>/dist/commands/echarts.js`（安装形态） | false | `<installRoot>/dist/probe/probe.mjs` |

即：**默认入口始终指向包内 `dist/probe/probe.mjs`，不依赖调用者 cwd、不依赖仓库布局**。配套事实（均从冻结 tarball 内核实）：

- `package.json`：`bin: { "component": "./dist/bin.js" }`、`files: ["dist"]`、`dependencies: { "@playwright/test": "1.65.0", "vite": "8.3.8" }`、`version: 0.0.10`。
- 包内 `dist/probe/` 含 8 个模块 + `probe.test.mjs` + `probe-manifest.json` + `resources/`；manifest `complete: true`、`files: 73`、`entry: probe.mjs`、`resourceRoot: resources`。
- 探针只惰性 `await import('@playwright/test')`，**不 import `@company/contracts`**，因此安装形态不需要 contracts 运行时依赖；`@playwright/test@1.65.0` 是 CLI 的运行依赖，闭包完整。
- 覆盖顺序为 `--probe-entry` > `ZHINEXUS_ECHARTS_PROBE_ENTRY` > 默认包内入口；缺失时报 `PROBE_ENTRY_NOT_FOUND` 并提示 `@playwright/test@1.65.0` 与 `npx playwright install chromium`。该失败边界已被 `tests/unit/echarts-cli.test.ts` 的 B1 用例覆盖（在仓库外临时安装副本上实跑）。
- CLI **故意不暴露**探针的 `--font-digest`，因此 `fontDigestSource` 恒为 `measured`（除非显式 `--skip-browser`），与 `scripts/audit-t10-evidence.mjs` 「不接受操作者覆盖字体摘要」的要求一致。这是正向结论，不是缺口。

## 3. 阻塞：三处独立闸门（按触发顺序）

### 闸门 1（CLI 自身，最先触发，B 所有权）

`packages/component-cli/src/commands/echarts.ts:317-323`（冻结 tarball 内对应 `dist/commands/echarts.js:169-173`）：

```ts
if (packageVersions.size !== 1) {
  return { ok: false, errorCode: 'INVALID_BUNDLE_MANIFEST',
    error: `冻结 bundle 三个包版本必须一致，当前为: ${[...packageVersions].join(', ')}` };
}
```

`checkEchartsBundle` 与 `verifyEchartsCandidate` 都在第一步调用 `readAndVerifyFrozenBundle`，因此 **check 与 verify 都在这里失败，探针不会启动，也不会访问网络**。

### 闸门 2（冻结 tarball 内的 packaged probe，A 所有权）

冻结 tarball内 `dist/probe/bundle.mjs:69-74`（即 A 的 `ce34c390` 之前的版本；B 已解包核实该行仍在）：

```js
const version = manifest.packages[0].version;
for (const entry of manifest.packages) {
  if (entry.version !== version) {
    throw new Error(`PROBE_INPUT 版本不一致：${entry.name} 为 ${entry.version}，其余为 ${version}`);
  }
```

A 的 `ce34c390`（在 `feat/t13-a-eval` 上，**不是** B 的 HEAD `42e837c6` 的祖先）已把它改为「各自版本均为合法精确语义化版本」，并在多版本时把 `version` 合成 `@company/charts-core@0.0.10, @company/charts-vue@0.0.11, @company/charts-react@0.0.11`。但冻结 CLI 0.0.10 tarball 打的是修复前的 `dist/probe/bundle.mjs`。

### 闸门 3（CLI 与探针的证据绑定，前两处修好后才会暴露，B 所有权）

`packages/component-cli/src/commands/echarts.ts:942`（tarball 内 `dist/commands/echarts.js:744`）：

```ts
if (evidence.bundle.version !== bundleCheck.bundleVersion || evidence.bundle.packages.length !== bundleCheck.packages.length)
  → BUNDLE_EVIDENCE_MISMATCH
```

若只移除前置同版本拒绝，`bundleVersion = [...packageVersions][0]`（`:333`）在混合版本下仍为 `0.0.10`；A 修复后的 `bundle.version` 是上面的复合字符串，会导致 `BUNDLE_EVIDENCE_MISMATCH`。这是源码推导的后续接线问题，本轮未绕过前两道门禁实跑此分支。C 已裁定：CLI 按 manifest 中的包顺序复算与 A 相同的字符串（同版时单值，独立版本时以逗号和空格连接 `name@version`），保留现有顶层判等与逐包名称、版本、SHA、bytes 绑定，不变更公共协议、不削弱校验。

### 不会触发的闸门（已核实，排除误判）

| 检查 | 结论 |
| --- | --- |
| `MIXED_PEER_BASELINE`（`echarts.ts:325-331`） | **不触发**：三包 echarts peer 均为精确 `6.1.0`，集合大小 1 |
| 探针对 `charts-core` 的依赖版本校验（`bundle.mjs:104-108`） | **通过**：Vue/React 均依赖精确 `0.0.10` |
| 三包 tarball 摘要/字节校验 | **通过**：B 对 handoff 目录实算全部一致 |
| 额外诊断文件（如 `acceptance.json`） | 此 echarts 路径只读取 manifest 和声明 tarball；完整发布目录校验 `verifyReleaseBundle` 会拒绝原目录的额外文件。故本轮使用 C 已严格核验的声明材料副本，不能据此放宽发布校验 |
| `workspace:` 协议残留 | **无**：manifest 依赖均为精确版本 |

## 4. B 侧沙箱复现（纯输入校验路径，无平台依赖）

以下是在沙箱用**真实 CLI 源码**与**冻结 tarball 内的真实探针代码**、对**真实冻结 handoff 目录**的复现。该路径不 spawn 子进程、不跑浏览器、不装 npm，因此与 Windows/Linux 无关；但这**不是** Windows 实测，Windows 宿主仍需按第 6 节实跑确认。

复现闸门 1（编译 `src/commands/echarts.ts` 后调用 `checkEchartsBundle`）：

```json
{ "ok": false, "errorCode": "INVALID_BUNDLE_MANIFEST",
  "error": "冻结 bundle 三个包版本必须一致，当前为: 0.0.10, 0.0.11" }
```

复现闸门 2（直接 import 冻结 tarball 内的 `dist/probe/bundle.mjs` 并调用 `readFrozenBundle`）：

```text
THROWN: PROBE_INPUT 版本不一致：@company/charts-vue 为 0.0.11，其余为 0.0.10
```

## 5. 其它接线缺陷（不阻塞本轮审计，但影响 Windows 实操）

### 待实测风险：默认探针超时为 600 s

`echarts.ts:881` 为 `options.timeoutMs ?? 600_000`。完整 56 组合的 Windows 耗时尚未测量；A 的 43.9 s 窄矩阵已经包含按框架运行的 typecheck、build、SSR 和浏览器启动，不能按 4→56 线性外推，也不能断言默认值必然失败。后续由 C 明确记录选定的 timeout 和实际耗时；出现超时应作为失败报告，不能改记视觉 hold。

本轮没有修改默认值。仅补充文档不单独升版；若后续实测证明需要调整 CLI 行为，再按 RED/GREEN 与版本规则处理。

### P2：`component --help` 未列全 `echarts verify` 实际接受的参数

解析器接受：`--bundle --echarts --version --latest --frameworks --components --presentations --registry --peer --out --label --consumer-root --baseline --probe-entry --timeout --keep --skip-browser --json`。
help 第 19 行只列到 `--probe-entry` 与 `--json`，**漏掉 `--consumer-root`、`--keep`、`--timeout`、`--skip-browser`**。而 T10 首轮必需 `--consumer-root` 与 `--keep`（`scripts/t10-consumer-ownership.mjs` 的 `validateOwnedConsumers` 断言 `probe.command` 中 `--consumer-root` 恰好出现一次且 `args.includes('--keep')`），操作者照 help 拼命令会漏。

建议的失败测试（供 C 落地跑 RED，B 本轮不新增测试文件）：

```ts
// tests/unit/echarts-cli-help-surface.test.ts（建议）
import { describe, expect, it } from 'vitest';
import { runCli } from '../../packages/component-cli/src/cli.js';

const ACCEPTED = ['--bundle', '--echarts', '--version', '--latest', '--frameworks', '--components',
  '--presentations', '--registry', '--peer', '--out', '--label', '--consumer-root', '--baseline',
  '--probe-entry', '--timeout', '--keep', '--skip-browser', '--json'];

describe('T10 接线：component --help 必须列全 echarts verify 实际接受的参数', () => {
  it('help 文本覆盖 echarts verify 解析器接受的全部选项', async () => {
    const res = await runCli(['--help'], '0.0.10');
    expect(res.exitCode).toBe(0);
    const line = res.stdout.split('\n').find((l) => l.includes('component echarts verify'));
    expect(line).toBeDefined();
    for (const opt of ACCEPTED) expect(line).toContain(opt);
  });
});
```

预期 RED：`--consumer-root` / `--keep` / `--timeout` / `--skip-browser` 四项不在 help 行中。

## 6. 交 C 的 Windows 宿主命令

统一前缀：固定 Node `<repo>\.tools\node-v26.13.0-win-x64\node.exe`；仓库命令走 `.\scripts\pnpm.ps1`。

```powershell
$repo = 'C:\Users\10208\.codex\worktrees\t13-b-match-ui\zhinexus-design-asset-platform'
Set-Location -LiteralPath $repo
$node = Join-Path $repo '.tools\node-v26.13.0-win-x64\node.exe'
$tgz  = Join-Path $repo '.tools\b-cli0010-distribution-KJhUCm\company-component-cli-0.0.10.tgz'
$sdk  = 'D:\project\zhinexus-design-asset-platform\.tools\operations\next-sdk-handoff-zQIRda'
$consumer = 'C:\Users\10208\AppData\Local\Temp\zhinexus-cli0010-consumer-xRMZib'
$installed = Join-Path $consumer 'node_modules\.pnpm\@company+component-cli@file_3c39797316c51dfdb2c6b3baf2eecce0\node_modules\@company\component-cli'

# 6.1 冻结 CLI 摘要（期望 0261b846c6c738e509a99afeb2c8089902538856d42a6609f85484cb629063e9）
& $node -e "const fs=require('fs'),c=require('crypto');const b=fs.readFileSync(process.argv[1]);console.log(b.length, c.createHash('sha256').update(b).digest('hex'))" $tgz

# 6.2 默认安装 bin 与 probe 的 realpath 证明
& $node -e "const fs=require('fs'),p=require('path');for(const f of ['dist/bin.js','dist/commands/echarts.js','dist/probe/probe.mjs','dist/probe/bundle.mjs','dist/probe/probe-manifest.json']){const a=p.join(process.argv[1],f);console.log(fs.existsSync(a)?'EXISTS ':'MISSING', p.normalize(fs.realpathSync(a)))}" $installed
& $node (Join-Path $installed 'dist\bin.js') --version      # 期望 0.0.10
& $node -e "const m=require(require('path').join(process.argv[1],'dist/probe/probe-manifest.json'));console.log('complete',m.complete,'files',m.files.length,'entry',m.entry)" $installed

# 6.3 失败边界：check 与 verify 都必须在探针启动前被拒（--registry offline 可证明不需要网络）
& $node (Join-Path $installed 'dist\bin.js') echarts check  --bundle $sdk --registry offline
& $node (Join-Path $installed 'dist\bin.js') echarts verify --bundle $sdk --version 6.1.0 --registry offline --json
# 预期均为 exit 1，stderr 含 INVALID_BUNDLE_MANIFEST 与「三个包版本必须一致，当前为: 0.0.10, 0.0.11」；
# 不得出现 PROBE_FAILED / PROBE_HOLD / 超时，也不得产生任何消费者目录。

# 6.4 冻结 tarball 内 packaged probe 的同版本硬编码（闸门 2 直接证据）
& $node -e "import(require('url').pathToFileURL(require('path').join(process.argv[1],'dist/probe/bundle.mjs')).href).then(async m=>{try{await m.readFrozenBundle(process.argv[2]);console.log('UNEXPECTED OK')}catch(e){console.log('THROWN:',String(e.message).split('\n')[0])}})" $installed $sdk
# 预期 THROWN: PROBE_INPUT 版本不一致：@company/charts-vue 为 0.0.11，其余为 0.0.10

# 6.5 安装包 probe 自检与产物复核（脚本只在仓库里，需用仓库副本核对安装目录）
Remove-Item Env:NODE_TEST_CONTEXT -ErrorAction SilentlyContinue   # 见 a-probe-distribution-2026-11-14.md §5.5：不清掉会被父运行器吞输出
& $node --test (Join-Path $installed 'dist\probe\probe.test.mjs')
& $node (Join-Path $repo 'packages\component-cli\scripts\package-probe.mjs') --check --out (Join-Path $installed 'dist\probe')
# 预期 --check 全零（清单 73 / 实际 73 / 缺失 0 / 清单外 0 / 污染 0 / 链接 0 / 被改动 0），退出码 0
```

关于 6.3 的顺序说明：`verifyEchartsCandidate` 先做 `--bundle` 读取与校验（`echarts.ts:778`），之后才进入 `--registry offline` 的拒绝分支（`:808`），因此用 `--registry offline` 恰好能证明失败来自 bundle 闸门而非 registry 闸门。

## 7. 阻塞清单与后续要求

### 7.1 必须先清除的阻塞（否则不得开始 56 组合）

| # | 归属 | 内容 | 位置 |
| --- | --- | --- | --- |
| B1 | B | 接受「三包各自独立精确版本」，不再要求同版本；保留各包版本必须为精确语义化版本、`workspace:` 禁止、tarball 摘要/字节必查 | `packages/component-cli/src/commands/echarts.ts:317-323` |
| A1 | A→待授权集成 | `ce34c390` 及后续严格版本校验修复必须进入构建 CLI 的分支，examples 中的生命周期探针控件一同对齐 | `tests/acceptance/t10-sdk/bundle.mjs` → `dist/probe/bundle.mjs`；`examples/{vue,react}` → probe resources |
| B2 | B | 按 C 已裁定规则复算相同 `bundle.version`，保留顶层及逐包绑定 | `packages/component-cli/src/commands/echarts.ts:942`、`:333` |
| C1（回退前置） | C | 回退脚本把框架包版本写死为 0.0.10，新 0.0.11 正确恢复也会失败；应从已绑定的冻结包/基线证据取得期望版本，并验证失败留证与消费者保留边界 | `scripts/verify-t10-rollback.mjs:70`、`:89` |

B 不在本轮修改上述任何一处，也不给 0.0.10 tarball 打补丁、不重打包、不把 A 的源合并进本分支。

### 7.2 后续 CLI 升版要求

新版 CLI 必须同时包含 A1 的完整探针修复、B1、B2；help 缺项作为 B 的独立小修复处理。默认 timeout 先实测，不按未证实估算改变。发布前需重跑：

- `.\scripts\pnpm.ps1 --filter @company/component-cli build`（含 `package-probe.mjs` 与 `--check`）；
- 显式设置 `$env:A10_FROZEN_BUNDLE = $sdk` 后执行 `.\scripts\pnpm.ps1 test:t10`，完成后恢复原环境变量值；集成后的用例总数以实际输出为准，必须单列 failed / skipped，不沿用 A 旧提交的 167 项计数；
- `.\scripts\pnpm.ps1 exec vitest run tests/unit/echarts-cli.test.ts` 及本轮新增的 help 表面测试；
- **全新的工作区外消费者安装**，并记录**新的** tarball SHA-256；0.0.10 的 `0261b846…` 不得复用或改写，旧 tarball 原样留作证据。

### 7.3 新候选验收要求（阻塞清除后才可执行）

以下为待执行顺序，尚无本輪 56 组合报告。必须在获准的最终集成仓库根目录执行，ownerFile 的 repoRoot 与 cwd 一致；`$node` 指向该仓库固定 Node，`$installedBin` 必须由新 tarball 的工作区外安装路径解析，不能继续使用旧 0.0.10。调用使用 `& $node $installedBin ...`，审计使用 `& $node scripts/audit-t10-evidence.mjs ...`。运行环境须按 `t10-windows-local-procedure.md` 设置固定 PATH、PLAYWRIGHT_BROWSERS_PATH、npm registry 与浏览器依赖；仓库命令使用 `.\scripts\pnpm.ps1`，不依赖全局 component/node。

- 6.1.0 首轮：用 `scripts/t10-consumer-ownership.mjs` 的 `createOwnedRoot` 建专属根（`ownerFile` 放 ignored `.tools/` 且必须是新文件），`component echarts verify --bundle <handoff> --version 6.1.0 --consumer-root <owned> --keep --out <首轮输出> --label <唯一标签> --timeout <足够值> --json`，预期双框架各 28 次实测、三个行为维度 passed、视觉 not-run、CLI 以 `PROBE_HOLD` 退出 1。
- `node scripts/audit-t10-evidence.mjs <首轮报告.json> hold 56`，人工查看真实截图。
- 复验：**新的**工作区外消费者（不传 `--consumer-root`，让探针用系统临时目录即全新根），`--baseline <首轮报告.json>`，预期四维全 passed、uncovered 空、recommendation `adopt`；再跑 `node scripts/audit-t10-evidence.mjs <复验报告.json> adopt 56`。
- 6.0.0：默认 strict / strict-only 必须失败且不自动放宽；显式 legacy 只测量不采用。回退目前还被 C1 阻塞：旧脚本第 70 行写死框架包 0.0.10，第 89 行即便记录失败也继续清理消费者。本轮不运行该脚本；C 完成适配和保留证据的验证后，才能对首轮两个真实消费者执行回退并核对原 package.json / lock 字节恢复。
- `probe.command` 中 `--consumer-root` 恰好一次且含 `--keep` 是 `validateOwnedConsumers` 对回退所用首轮消费者的要求。`audit-t10-evidence.mjs` 不要求这两个参数；baseline 复验可使用探针自动创建的新临时消费者，也可另建独立 owned root，不能重用首轮消费者冒充全新安装。

## 8. B 本轮未做的事

未改任何产品代码；未新增或修改测试；未给 0.0.10 tarball 打补丁或重打包；未把 A 的 `ce34c390` 合并进本分支；未改根配置、锁、contracts、SDK、版本号；未 merge/push/reset/清理；未运行浏览器或真实 npm 安装。除本文件外无其它写入。

## 9. C 宿主复核与审校（2026-11-16）

B 停写交接后，C 修正本文的 Windows import、未证实超时判断、零跳过环境变量、所有权范围和 C1 回退阻塞。C 已实际运行固定 Node v26.13.0 加已安装 CLI 0.0.10 的 `echarts check` / `verify`，使用严格 SDK 副本与 `--registry offline`，两次均为 exit 1 / `INVALID_BUNDLE_MANIFEST`。直接调用已安装包内 `readFrozenBundle` 得到 `PROBE_INPUT 版本不一致`；浏览器矩阵未启动。

宿主证据：主仓库 ignored `.tools/c-cli0010-preflight-evidence-20261116.json`（2026-11-16T06:09:00.524Z）。其中记录真实 bin 路径、完整参数、stdout/stderr、CLI tarball/SDK manifest/三包执行前后 SHA 与字节数均未变；先前 verify 未生成消费者目录或报告。证据脚本自身 exit 0 表示成功复现预期拒绝，不表示 CLI 验收通过。第 6.5 自检、完整矩阵、adopt、6.0.0 测量、回退和 installed-compatibility 均未在本轮执行。
