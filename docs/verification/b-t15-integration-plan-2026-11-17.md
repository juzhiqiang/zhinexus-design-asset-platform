# B / T15 P1 本地项目识别验证记录（进行中）

日期：2026-11-17（Asia/Shanghai）。执行：Claude 桌面端（角色 B）。工作树：`C:\Users\10208\.codex\worktrees\t15-b-integration-plan\zhinexus-design-asset-platform`，分支 `feat/t15-b-integration-plan`，基线 `31ae120a270e84ab7c100d3ad77919b233d1d48b`。本记录只登记实际执行过的命令与结果，不宣称未运行的验证；T15 产品、真实服务与业务项目验收均未完成。

## 执行边界

- Windows 固定工具链（Node `26.13.0` / pnpm `12.18.0`，经 `.\scripts\pnpm.ps1`）由宿主 C 在 Windows 代跑并回传日志；B 的会话环境无法执行 Windows 二进制，未修复 `.git`、未改 `node_modules`/链接/主目录，也未再申请任何目录权限。
- 宿主日志位于 `.superpowers/t15/`（已被 `.gitignore` 忽略），仅作本地留痕，不进入提交。
- B 在 Linux 沙箱仅用 npm 取得的 `typescript@7.0.2`（linux-x64 原生包）与 `vitest@5.1.0` 做语法/类型/可执行性预检，**不代表固定工具链结果**，本文单独标注。

## 一、inspect：20 RED → 20 GREEN（宿主 C 固定工具链）

### RED（行为 RED 确认前）

1. `.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`：exit 1，1 个套件收集失败、0 个测试，原因仅为 `packages/component-cli/src/integration/inspect.js` 不存在。按约定**不计作**行为 RED（设施/缺模块）。
2. 补最小占位导出（`inspectProject` 仅抛 Not implemented）后复跑同命令：exit 1，**20 failed (20)**、0 跳过。行为 RED 成立（日志 `host-inspect-behavior-red-2026-11-17.log`）。

### 实现

新增 `packages/component-cli/src/integration/{workspace,locks,inspect}.ts`：workspace 词法与 realpath 边界、P0 冻结 glob 子集、npm v3 与 pnpm v9 锁解析（`parseAllDocuments`）、monorepo 与成员校验、包管理器/锁一致性、importer 存在性、框架判定与精确版本解析、原生脚本名、Git 只读状态（固定 argv/cwd、`--no-optional-locks`、禁 fsmonitor 与外部 diff/textconv、清除 Git 目录/索引环境覆盖）、原始字节 SHA-256 快照；产出过 `validateLocalProjectInspection` 自检。全程零写入、零脚本执行。

### GREEN（宿主 C 固定工具链）

- `.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`：**Test Files 1 passed，Tests 20 passed (20)**，0 跳过（日志 `host-inspect-green-2026-11-17.log`）。
- `.\scripts\pnpm.ps1 --filter @company/component-cli build`：exit 0；`sync-contracts`、`tsc -p tsconfig.build.json`、`package-probe` 打包与 `--check` 复核 ok（文件 73、缺失 0、污染 0、链接 0、被改动 0）（日志 `host-inspect-build-2026-11-17.log`）。
- `.\scripts\pnpm.ps1 --filter @company/component-cli typecheck`：`tsc -p tsconfig.json --noEmit` exit 0（日志 `host-inspect-typecheck-2026-11-17.log`）。

### B 沙箱预检（非正式）

`tsc --noEmit`（仓库 `tsconfig.base.json` + CLI `lib/types`）exit 0；同版本 vitest 5.1.0 下 20/20 通过。Linux 专属行为不在预检覆盖内。

## 二、独立审查反例：首轮 9 个用例（宿主已运行）

宿主独立审查提出 6 类阻断/余项，B 只新增反例测试、未改实现。宿主运行结果：**7 failed | 21 passed | 1 skipped (29)**（日志 `host-inspect-review-red-2026-11-17.log`）；跳过项为 `pnpm-workspace.yaml` 文件符号链接用例（Windows 无文件链接权限），登记为未覆盖。反例覆盖：外链读取前阻断（当时仅行为断言）、npm importer 借用提升版本、pnpm-workspace 多文档不同 `packages`、npm `workspaces` 非字符串条目、外来锁并存、仅有外来锁、非法 caret 声明、Git 子项目路径折算；另有一个已批准协议守卫（`workspace:^`/`catalog:`/`latest`）当时即通过。

## 三、本轮补充：IO spy、真实锁快照、Git filter（待宿主运行）

A 冻结提交 `5a508567` 已由 C 安全 ff 合入，真实工具锁快照位于 `tests/fixtures/phase3-projects/lock-snapshots/`。Git filter 实验（Node 26.13.0 / Git 2.48.1.windows.1）报告与 helper 已由 C 复制到 `.superpowers/t15/`：B 固定 argv 的只读 `status` 在等长修改 + mtime 变更后会重新触发 `filter.*.clean` 与 `filter.*.process`（`executedDuringStatus: true`），`fsmonitor=false` 与 `--no-optional-locks` 不足以阻断。据此新增 12 个用例（共 41 个），实现仍未改：

1. **外链 IO spy（受控 realpath mock，无符号链接权限也可运行）**：`vi.mock('node:fs')` 透传包装 `readFileSync`/`realpathSync`，把根内普通 `pnpm-workspace.yaml` 的 realpath 覆写为项目根外声明；直接断言该链接路径与外部声明都未被读取，不要求 `WORKSPACE_INVALID` 充当 IO 证据。基础 20 项中的真实 junction/symlink 逃逸用例保留。
2. **Git filter marker ×2（clean/process）**：helper 与 marker 置于项目根外；控制正例 `git add` 必须触发 helper，未触发即抛 setup 错误（不静默跳过）；断言 marker 不得被写出且 Git 仍真实报告 dirty。
3. **真实锁快照消费 ×4（RED）**：npm v3 单包 Vue/React/显式 workspace（当前通过）；pnpm v9 单包 Vue/React、显式 workspace、空格中文 workspace（当前失败，原因与 C 矩阵一致：真实 pnpm 12.18.0 锁为两个 v9 文档，第一文档仅含 `configDependencies`/`packageManagerDependencies`，当前实现把两个都当项目锁而 `LOCKFILE_INVALID`）。
4. **项目依赖文档歧义守卫 ×2（当前通过）**：以真实快照文档字节构造两个相同/不同的项目依赖文档，均须 `LOCKFILE_INVALID`。
5. **Git 子项目拆两个用例**：父仓库下 `apps/client` 自带清单与锁，直接 `inspectProject(childRoot)` 只报告项目内路径并折算为项目相对（当前 RED）；显式 workspace 调用仍以项目根相对路径报告 `apps/client/package.json`（当前通过，作守卫）。

B 沙箱预检（非正式）：41 个用例 **27 passed | 14 failed | 0 skipped**；14 个失败原因逐一核对符合预期（IO spy 实际捕获越界读取 `pnpm-workspace.yaml`；两个 filter marker 在沙箱 Git 2.34 同 fixture 下亦可复现）。宿主运行命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`。

## 四、审查反例修复（GREEN，宿主复跑待确认）

宿主正式 RED（`host-inspect-review-red2-2026-11-17.log`）：41 项 **14 failed | 27 passed | 0 skipped**，exit 1，14 项均为实际行为断言。B 修复 `workspace.ts`/`locks.ts`/`inspect.ts`（未改契约与根配置）：

1. **pnpm 多文档区分**：根因是真实 pnpm 12.18.0 锁由多个 v9 文档组成，前一文档仅含 `configDependencies`/`packageManagerDependencies`，旧实现把所有含 `lockfileVersion`/`importers` 的文档都当项目锁。改为按 config-only 文档排除（所有 importer 键均属这两类配置键且 importer 非空），余下必须恰为 1 个项目锁文档，多个则 `LOCKFILE_INVALID`。
2. **npm importer 不借用提升版本**：依赖必须由目标 importer 自身声明，未声明即 `VERSION_UNRESOLVED`。
3. **外链读取前阻断**：`pnpm-workspace.yaml` realpath 逃逸时不再读取其字节，仅报 `PATH_UNSAFE`。
4. **声明失效关闭**：pnpm-workspace.yaml 多文档都声明 `packages`、npm `workspaces` 含非字符串条目，均 `WORKSPACE_INVALID`。
5. **外来锁**：与受支持锁并存 → `LOCKFILE_MULTIPLE`；仅有 yarn/bun 锁 → `LOCKFILE_UNSUPPORTED`。
6. **非法范围声明**：`validRange` 为 null 时，已批准协议前缀与 dist-tag 放行，其余（如 `^not-a-version`）报 `VERSION_UNRESOLVED`。
7. **Git filter 屏蔽**：根因是 `git status` 在 mtime 变更后为核对内容会触发 `filter.*.clean`/`process`。方案为先以只读的 `git config --get-regexp` 枚举 driver（只读配置、不触 filter、与 status 同一套清除后环境），再用固定 argv 追加 `-c filter.<driver>.clean=/process=/smudge=` 与 `-c filter.<driver>.required=false` 置为 no-op 透传；实测必须同时覆盖 `required`，否则 `required=true` 时 git 直接失败。driver 名经字符校验后使用。不执行任何用户命令，真实 dirty 照常报告。
8. **Git 子项目路径折算**：`git rev-parse --show-toplevel --show-prefix` 取前缀，porcelain v1 路径只保留项目内条目并折算为项目相对，剔除项目外 dirty。

B 同时修正了自己的测试缺陷：两个“项目依赖文档歧义守卫”原先被 `realLockProject` 的快照覆盖，实际未测到构造的歧义锁，已改为直接组装。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；`tsconfig.build.json` declaration emit exit 0；vitest 5.1.0 **41 passed (41)**、0 跳过，连跑两次一致；额外验证深层嵌套子项目（两层前缀）折算正确、filter 屏蔽后 status exit 0 且 marker 未写出。宿主复跑命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`、`--filter @company/component-cli build`、`--filter @company/component-cli typecheck`。

## 五、最终执行边界反例：48 项 RED → 实现修复（宿主复跑待确认）

### 测试侧修正（C 复核后，共 48 项）

C 在正式 RED 前指出三处测试问题，B 只改测试、未改实现：① 受控 spy 记录跨用例累计，新增 `beforeEach` 清空 `gitCalls.entries`/`overrides` 与 `fsMock` 记录，避免 config 失败用例因早前的 status 调用假失败；② porcelain mock 的状态列补足为合法三段（首列空格、第二列 `M`、第三列空格），`-z` rename 顺序按实测改为先目标后源；③ P0 `integrationPathSchema` 已禁止 `>` 与双引号，不能把 literal 箭头/引号路径当作合法 dirtyPaths 期待，遂改为含空格/中文的合规路径 + 真实 rename 结构，并新增“末条缺 NUL”截断用例。最终 48 项中新增 7 个反例：driver 名含下划线、filter 枚举 exit 2、枚举输出截断/畸形、无 filter 时 exit 1 守卫、staged rename 须同时记录源与目标、porcelain 须 `-z` 结构化解析、porcelain `-z` 输出截断。

### 宿主正式 RED（`host-inspect-final-review-red-2026-11-17.log`）

`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`：**6 failed | 42 passed (48)**，exit 1，测试源前后 SHA 一致（`F833BDC9DB01EA6FC3B9C1B894D9B5EB45E745491073DF16806C88A5CF096CF0`）。6 个失败均为实际行为断言：下划线 driver 的 filter 被触发（marker 重现）、`git config` 枚举 exit 2/截断后仍调用 status、真实 staged rename 只留目标、两个 porcelain 用例因实现错误产出非法 inspection（`INVALID_SCHEMA`）。

### 实现修复（仅 `inspect.ts`，未改契约、测试语义与原真实锁）

1. **filter 枚举结构化 + 失效关闭**：改用 `git config -z --get-regexp '^filter\..+\.(clean|process|smudge)$'`，按 NUL 记录（`key\nvalue\0`）解析；退出码 1 视为无 filter，其余退出码、spawn 错误、stdout 非字符串、末条记录缺 NUL、空记录、配置项不可解析或 driver 名无法可靠屏蔽，一律判定枚举失败——不再调用 `rev-parse`/`status`，整体返回 `git = unavailable` 且空 dirtyPaths。driver 名放行 Git 实际允许的字符（含下划线）：`^[A-Za-z0-9_][A-Za-z0-9._-]*$`，仍拒绝 `..`、首尾 `.` 与 `=`/空格/控制字符/非 ASCII。屏蔽仍同时覆盖 `clean/process/smudge` 与 `required=false`。
2. **`status` 改 `--porcelain -z` 结构化解析**：新增 `parsePorcelainZStatus`，普通条目取 `XY PATH`（两列状态 + 一个空格，`-z` 下路径无引号/八进制转义），rename/copy 条目把紧随其后的独立 NUL 字段记为源路径，源与目标都记录；状态列非法、条目缺路径、rename 缺源、末条记录缺 NUL 均判不可信 → 整体 `unavailable` + 空 dirtyPaths。路径折算改为先取完整记录、再按 project root 限定（剔除 Git 根内项目外条目并去前缀）。
3. **测试断言收紧**（C 要求）：`porcelain -z 输出截断` 用例从“unavailable 或 clean+空路径”收紧为精确等于 `{ status: 'unavailable', dirtyPaths: [] }`，不允许报告 clean 冒充已观察；该项在收紧后、实现前仍为行为 RED。

### B 沙箱预检（非正式）

`tsc --noEmit`（仅覆盖本人拥有的 4 个文件及其传递闭包）exit 0；vitest 5.1.0 下 48 项 **48 passed**、0 跳过。另做不经 mock 的真实 Git 验证（沙箱 Git 2.34.1）：staged rename（`old 名字.txt` → `src 目录/新 名字.txt`）同时记录源与目标；工作区修改与未跟踪文件（含空格/中文）原样记录；干净仓库返回 clean；`filter.multi_line.clean` 值为多行且 `required=true` 时屏蔽生效且 dirty 照常报告。**不代表固定工具链。**

## 六、数据边界复审反例：62 项 RED（宿主已运行：12 failed | 50 passed | 0 skipped）

宿主确认 Git 最终执行边界轮 **48/48 passed、0 skipped、exit 0（8.77s）**，CLI `build`/`typecheck` exit 0。提交前 C 独立只读审查提出六项数据边界阻断（`.superpowers/t15/c-inspect-data-review-2026-11-17.md`），B 只补测试、未改实现，追加 14 个用例（共 62 个）：

1. **workspace 选择须依据实际包管理器**：pnpm 项目同时带 npm `workspaces: apps/*` 与 pnpm `packages/*`，且 `apps/client` 真实存在、importer 合法；现按 `npmPatternsRead ?? pnpmPatternsRead` 采信 npm 声明而 `inspected`（RED）。配套正例：`packages/ui` 作为 pnpm 原生成员也应 `inspected`（当前 RED）。
2. **坏字段与缺字段不能混同**：`pnpm-workspace.yaml` 首文档 `packages: 42`（显式存在但类型错误）后接合法 `packages: ['apps/*']`，现跳过坏文档采信后者（RED）；守卫：文档缺 `packages` 后接合法声明仍 `inspected`（当前通过）。
3. **pnpm 项目锁正文必须有合法标量版本**：缺 `lockfileVersion`、`lockfileVersion` 为数组/对象（`String(['9.0'])==='9.0'`）、伪造 `9.x` 尾缀 `'9.0.1'` 均 RED；真实 pnpm 12.18.0 config-only + 正文多文档仍由既有快照用例守卫（原锁字节不动）。
4. **pnpm importer 条目不完整必须显式冲突**：缺 specifier、specifier 非字符串均 RED（当前跳过一致性核对后 inspected）。
5. **manifest 坏类型失效关闭**：三类依赖字段含非字符串值、`scripts: { build: 7 }` 仍输出可用 `build`、`packageManager: 42` 被当未声明，均 RED。
6. **npm 近层 link 遮蔽不得借用提升版本**：近层 `apps/client/node_modules/vue` 为 link 且无 version、链接目标 Vue 4、根提升 Vue 3，现借根 3.5.45 而 `inspected`（RED）；守卫：近层自带 version 时仍优先（当前通过）。

测试用 `tempProject` 直接组装锁/声明字节，不用会覆盖构造锁的 `realLockProject`；新增本地构造器 `pnpmLockDocument(importers, lockfileVersion?)`。另按 C 要求更正 `inspect.ts` 中一处不实注释（纯注释）：不得声称变换型 filter 被置空后“完全同语义”或“只多报不漏报”（差异方向由 C 独立核实中）。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0 **12 failed | 50 passed (62)**、0 跳过，12 个失败均为“当前 inspected、应为 conflicted”的行为断言，无 setup 失败。宿主运行命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`。

## 七、数据边界复审反例修复（GREEN，宿主复跑待确认）

宿主正式 RED：62 项 **12 failed | 50 passed | 0 skipped**，exit 1（8.49s），测试前后 SHA 均为 `53A475FC0DA17D35F68C40CA899F91E5C69F245C20B55539AFFFE256556676FA`（`host-inspect-data-review-red-2026-11-17.log`）。B 修复 `workspace.ts`/`locks.ts`/`inspect.ts`，未改 P0 契约、真实锁快照字节与公共配置：

1. **workspace 声明依据实际包管理器**：新增 `inferPackageManager`（`packageManager` 声明优先，其次按锁文件推断，不产出冲突）。pnpm 项目只认 `pnpm-workspace.yaml`，npm 项目只认 `package.json workspaces`；pnpm 项目缺 `pnpm-workspace.yaml` 即无原生成员声明，按“未声明成员”处理而不退回 npm 声明；包管理器无法判定时维持“npm 优先、其次 pnpm”的既有优先级。
2. **成员资格未确认即停止后续解析**：声明不可解析、glob 语法不支持、目标不在成员范围、未声明成员却指定 `--workspace` 四种情形均置 `targetDetermined = false`，不再解析该目录的锁 importer、依赖与脚本。
3. **坏字段与缺字段区分**：`packages` 显式存在但非数组 → `WORKSPACE_INVALID`；缺字段仍可跳过。
4. **pnpm 锁正文版本校验**：仅接受标量字符串 `'9.0'`；非标量 → `LOCKFILE_INVALID`，其他标量（含伪造 `9.x` 尾缀）→ `LOCKFILE_UNSUPPORTED`，项目文档缺版本 → `LOCKFILE_INVALID`；config-only + 正文多文档仍受支持。
5. **锁条目不完整失效关闭**：pnpm 条目缺 `specifier`/`specifier` 非字符串、npm importer 条目显式声明但类型错误，均返回 `unresolved`，调用方记 `VERSION_MISMATCH` 且不计入 `resolvedDependencies`。
6. **npm 近层 link 遮蔽**：近层条目无 `version` 时不再借用提升版本——优先解析锁内被链接记录取得精确版本，解析不到则保守 `VERSION_UNRESOLVED`。
7. **manifest 坏类型失效关闭**：三类依赖字段非字符串值、`scripts` 非字符串命令、`packageManager` 非非空字符串均记 `WORKSPACE_INVALID`；脚本只输出字符串命令条目。
8. **filter 注释软化**（纯注释）：变换型 filter 置空后的差异方向尚未定论，不声称“只多报不漏报”或“完全同语义”。

测试侧两处必要修正（断言未改）：两个 pnpm specifier 用例的锁 fixture 显式写 `lockfileVersion: '9.0'`，否则新版本校验会先以“缺版本”拒绝该锁、掩盖被测的 specifier 缺陷；另新增 1 个守卫用例（pnpm 项目只有 npm `workspaces`、无 `pnpm-workspace.yaml` 时指定 `--workspace` 必须 `WORKSPACE_INVALID` 且不输出该目录的锁/依赖），共 63 项。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0 **63 passed (63)**、0 跳过；附加验证近层 link 解析到被链接记录（vue 4.0.0 → `FRAMEWORK_UNSUPPORTED`，不把根 vue 3.5.45 当作目标版本）、npm 项目不受杂散 `pnpm-workspace.yaml` 影响、坏类型 `packages` 文档 conflicted 且无依赖输出。**不代表固定工具链。**

## 八、filter 语义复审反例：65 项 RED（宿主运行待确认）

六项数据边界修复经宿主复跑 **63/63 passed、0 skipped、exit 0（9.28s）**，CLI `build`/`typecheck` 与根 `tsc` exit 0；C 另用保留的修复前构建重放修正后的夹具，得 **13 failed | 50 passed | 0 skipped**（构建 SHA 前后不变），确认测试侧修正确实令那两例重新变红。提交前 C 提出第七项阻断：变换型 Git filter 的 false-clean 已实证（`.superpowers/t15/c-filter-falseclean-review-2026-11-17.md`，证据 `independent-filter-falseclean-2026-11-17.json`，SHA256 `1627a6c0…9b9fd`）：clean filter 把 `"version"` 主版本号 +1，`git add` 存索引的是变换后字节，用户把工作区文件写成变换后内容时，原生 status 报告 ` M package.json` 且 helper marker 出现，而置空 filter 的 status 输出为空 → 模块 inspect 返回 `inspected` + `git clean` + `[]`，marker 未出现、全树含 `.git` 字节未变。

B 只补测试、未改实现，追加 2 个用例（共 65 个）：① 受 filter 的 `package.json` 必须保守记为 dirty（断言不执行 helper、树快照不变、`git.status === 'dirty'`、`dirtyPaths` 恰为 `['package.json']`）；② 受 filter 的普通 tracked 文件同样保守记脏且不把无关路径一概标脏（`dirtyPaths` 恰为 `['payload.txt']`）。两个控制正例在 fixture 内校验（`git add` 触发 helper；原生 status 报脏且触发 helper），不生效即抛 setup 错误；helper 与 marker 置于项目根之外。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0 **2 failed | 63 passed (65)**、0 跳过，2 个失败均为 `expected 'clean' to be 'dirty'`，marker 与树快照两项控制均通过。宿主运行命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`。

## 九、npm 近层记录残余反例：68 项 RED（宿主运行待确认）

宿主正式 filter RED：65 项 **2 failed | 63 passed | 0 skipped**，exit 1（10.96s），两项均为“应为 dirty、实际 clean”的行为断言，marker 不存在与全树快照控制通过；测试前后 SHA 同 `6E955229…307B9`，实现 SHA 仍 `EEE0E9EA…1E729`（`host-inspect-filter-semantics-red-2026-11-17.log`）。C 独立只读复审随后发现第六类（npm 近层记录）的两条残余漏检路径（`.superpowers/t15/c-npm-near-record-review-2026-11-17.md`）：① `apps/client/node_modules/vue` 为 `{ resolved: 'node_modules/not-vue' }`（无 `link`、无 `version`），实现对没有 `link===true` 的 resolved 也采信，用旁边无关包 `node_modules/not-vue` 的 3.5.45 冒充目标 vue；② 近层记录显式为 `null`，`if (!entry) continue` 把显式坏记录当缺失，借根提升版本。两者当前都输出 `inspected`。

B 只追加测试、未改实现（实现三文件 SHA 不变），新增 3 个用例（共 68 个）：两个反例分别断言 conflicted 且 vue 不进入 `resolvedDependencies`/不输出精确版本；一个守卫断言合法 `link: true` + 锁内目标仍正常解析为 3.5.45 且 `inspected`（防止 GREEN 过度拒绝）。连同 2 个 filter 用例，当前共 4 项待修 RED。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0 **4 failed | 64 passed (68)**、0 跳过；4 个失败为 2 项 `expected 'inspected' to be 'conflicted'` 与 2 项 `expected 'clean' to be 'dirty'`，新增守卫通过。宿主运行命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`。

## 十、filter false-clean 与 npm 近层记录修复（GREEN，宿主复跑待确认）

宿主正式 RED：68 项 **4 failed | 64 passed | 0 skipped**，exit 1（11.10s，`host-inspect-near-record-red-2026-11-17.log`）；失败为 2 项“inspected 应为 conflicted”（npm 近层记录）与 2 项“clean 应为 dirty”（变换型 filter），合法 link 守卫通过，无 setup 失败。B 修复 `locks.ts`/`inspect.ts`，未改 P0 契约、真实锁快照字节、公共配置与既有断言：

1. **npm 近层记录失效关闭**：用 `hasOwnProperty` 区分“该层没有记录”与“显式坏记录”（`null`/数组/标量 → `unresolved`）；该层记录存在但无 `version` 时一律视为遮蔽更外层并失效关闭，仅 `link === true` 且 `resolved` 指向锁内合法包的链接记录才解析目标版本；`resolved` 指向无关包但无 `link` 标记的条目不再被采信。逻辑对任意层级一致。
2. **变换型 filter false-clean 收口**：新增 `readGitFilterAssociatedPaths`——固定 argv 的 `ls-files -z`（cwd 即项目根，输出即项目相对路径）与 `check-attr -z filter --stdin`（输入为完整 NUL 终止的路径集合，记录形如 `<path>\0filter\0<info>\0`），同一清理环境与 filter 屏蔽参数；仅当属性值等于已枚举 driver 名才认为关联，并保守并入 dirtyPaths（raw status 为空也并入）；未关联路径不标脏。退出码异常、末条缺 NUL、记录非三字段、属性名不符、路径不属于本次已跟踪集合或重复、已跟踪路径缺记录 → 整体 `git unavailable` + 空 dirtyPaths。
3. **注释更正**：不再声称变换型 filter 置空后“完全同语义”或“只多报不漏报”；改为说明该场景下这些路径多报、不漏报，差异方向以该实现为准。

新增测试 9 个（68 → 77 项）：固定 argv 与清理环境（含 check-attr 输入的 NUL 完整性）、check-attr 截断/退出异常/字段畸形/属性名不符/路径归属不可靠 → unavailable、ls-files 退出异常/截断 → unavailable、仅实际关联路径被标脏（set/unset/unspecified 不标）、有 driver 但无关联不标脏、未配置 driver 不触发枚举。测试顶部 child_process spy 扩展为同时记录 `options`（既有用例不受影响）。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0 **77 passed (77)**、0 跳过；附加真实 Git 验证：Git 根在项目根之上时只并入项目内关联路径（仓库根的关联文件不混入，且路径为项目相对口径）、未修改但关联的文件按设计保守多报、inspect 未执行 helper。**不代表固定工具链。**

## 十一、关联枚举最终复审反例：86 项 RED（宿主运行待确认）

宿主正式复跑 filter false-clean 与 npm 近层记录修复：**77/77 passed、0 skipped、exit 0（17.17s）**，CLI `build`/`typecheck` 与根 `tsc` exit 0，测试/源码 SHA 前后与交付一致（`host-inspect-filter-near-{green,build,typecheck,root-tsc}-2026-11-17.log`）。独立审查随后确认两个具体 Important（`.superpowers/t15/c-filter-association-final-review-2026-11-17.md`），B 只补测试、未改实现，追加 9 个用例（共 86 个）：

1. **ls-files 未验证每条路径本身**：空路径（`\0` + `unspecified`）、穿越路径（未关联/关联）三条反例。前两条当前报 `clean`；第三条把 `../outside.txt` 拼进 dirtyPaths 触发 `LocalProjectInspectionV1` 校验失败（inspectProject 抛错）。三条都断言“送入属性命令前拒绝”（当前仍调用 check-attr）并要求整体 `git unavailable`。
2. **check-attr 特殊状态与合法同名 driver 输出完全一致**：沙箱实测（Git 2.34.1）`filter=set` 与裸 `filter` 的信息值都是 `set`，但前者会真实应用 `filter.set.clean`（索引字节已变换）、后者不应用；`unset`/`unspecified` 同理。故仅凭 `drivers.includes(info)` 既会把未关联文件全标脏（driver 名为 `set`/`unset`/`unspecified` 时），也会在“消掉多报”时引入漏报。三条反例断言不得标脏；一条守卫断言显式 `filter=unspecified` + 真实变换 helper 时**不得报 clean**（允许可靠区分后标脏或名称歧义失效关闭）。
3. **守卫两条**：真实中文/空格路径（`.gitattributes` 模式按 git 规则加双引号）仍正常关联并入；嵌套项目根（Git 根在项目根之上）只并入项目内关联路径，仓库根同名关联文件不混入。

配套：`createTransformingFilterProject` 与 `TRANSFORMING_CLEAN_FILTER_HELPER` 上移到模块作用域；`filterAssociationProject` 增加 driver 名参数（默认 `reviewtransform`）。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0 **6 failed | 80 passed (86)**、0 跳过；6 个失败为 3 项“非法路径仍送入属性命令”与 3 项 `expected 'dirty' not to be 'dirty'`，3 个守卫通过。宿主运行命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`。

## 十二、Git 子模块零执行边界反例：89 项 RED（宿主运行待确认）

宿主正式关联枚举 RED：86 项 **6 failed | 80 passed | 0 skipped**，exit 1（22.53s，`host-inspect-association-final-red-2026-11-17.log`）。C 进一步用真实临时仓证实子模块执行泄漏（`.superpowers/t15/c-submodule-zeroexec-review-2026-11-17.md`；证据 `submodule-filter-result-2026-11-17.json` SHA `f6619e1a…ffe10`、`submodule-no-recursion-controls-result-2026-11-17.json` SHA `fa06350c…36457`）：父仓 filter 枚举 exit 1/空，但当前固定完整 status 参数会递归检查子仓并执行子仓唯一 `childonly.clean`（marker 证明 2→3，stdout ` M vendor/child\0`），全树含 `.git` 字节未变；C 已实测最小控制：`ls-files --stage -z` 只读发现 160000 gitlink，所有 status 加 `--ignore-submodules=all` 与 `-c status.submoduleSummary=false` 后项目内/外子模块均零 marker、全树不变。

B 只追加测试、未改实现（实现三文件 SHA 不变），新增 3 个用例（共 89 个）：

1. **项目内 gitlink**：真实 fixture（父仓无 filter、`vendor/child` 已初始化子仓、子仓内唯一 `childonly.clean`，helper/marker 在项目外；子仓 payload 改为“变换后的内容”后提交）。控制正例用当前 status 参数从父仓根执行必须报告 `vendor/child` 且写 marker（否则抛 setup 错误）。断言 inspect 零 helper、全树（含 `.git` 内部字节）深度快照不变、`git` 恰为 `{ status: 'unavailable', dirtyPaths: [] }`。当前实现执行子仓 helper → RED。
2. **Git 根在项目根之上且子模块在项目外**：同一 fixture 从 `apps/nested-project` 检查；控制正例证实嵌套目录下当前 status 参数同样执行项目外子仓 helper（沙箱 Git 2.34.1 实测为真）。断言零 helper、全树不变、`git` 恰为 `{ status: 'clean', dirtyPaths: [] }`（子模块在项目范围之外，项目自身可完整检查；不得把项目外路径算进 dirtyPaths）。当前实现执行外部 helper 且前缀过滤后伪称 clean → RED。
3. **普通无 gitlink 项目保持既有脏识别（守卫）**：无子模块项目 + 工作区改动仍 `dirty` 且含该路径，不得一律 unavailable。

配套新增 `deepTreeSnapshot`（含 `.git` 内部字节）与 `createSubmoduleProject`/`assertSubmoduleHelperExecutes`；file protocol 仅用于自有临时 `submodule add`。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0 **8 failed | 81 passed (89)**、0 跳过；8 个失败 = 上轮 6 项 + 本轮 2 项（均为 `inspect 不得执行子模块 filter helper: expected true to be false`），控制正例在沙箱真实复现，无 setup 失败。宿主运行命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`。

宿主确认结果（`.superpowers/t15/c-submodule-corrected-red-receipt-2026-11-17.md`）：C 最小修正三处 fixture `core.autocrlf=false` 后，2026-11-17 12:27:34 固定 Node26.13.0/pnpm12.18.0/Git2.48.1 完整运行 89 项，**8 behavior failed / 81 passed / 0 skipped**，exit 1，29.05s（`host-inspect-submodule-corrected-full-red-2026-11-17.log`），测试前后 SHA 均 `804840E7…CE6745`，无 setup 失败；先前 2 项失败经 C 独立定位为 Windows `core.autocrlf=true` 下 CRLF 工作区与 LF 索引 size 缓存不等导致的 fixture 控制失败，**不记为行为 RED**。

## 十三、partial clone 缺失对象 + 共享 argv 零执行边界反例：92 项 RED（宿主运行待确认）

宿主正式子模块 RED 已确认（8 behavior failed / 81 passed / 0 skipped，exit 1，29.05s，测试 SHA `804840E7…CE6745`）。C 又实证 partial clone 执行泄漏（`.superpowers/t15/c-promisor-zeroexec-review-2026-11-17.md`；证据 `partial-clone-lazy-fetch-result-2026-11-17.json` SHA `cafa466b…59d3a5`）：真正 `--filter=blob:none --no-checkout --no-local` clone（存在 `.promisor` pack）+ `read-tree HEAD` 后，索引中的 `.gitattributes` blob 缺失；在 B 当前基础 argv 下 `check-attr` 与 `status` 自动 lazy-fetch 并执行外置 ext transport helper（marker `service=git-upload-pack`，exit 128）；分别加全局 `--no-lazy-fetch` 后 exit 0、零 marker、status ` D .gitattributes`、check-attr 两项 unspecified；`ls-files`、`ls-files --stage`、`config`、`rev-parse` 加/不加均不执行 helper。宿主固定 Git 2.48.1.windows.1、Node 26.13.0、pnpm 12.18.0。

B 只追加测试、未改实现（实现三文件 SHA 不变），在既有 89 项之上追加 3 个用例（共 **92** 个），落在新 describe「T15 P1 Git 零执行边界收口（partial clone lazy-fetch + 共享 argv 守卫）」，**未改动子模块 describe 的任何 fixture 或断言**（含 C 刚修正的三处 `core.autocrlf false`）：

1. **partial clone 缺失属性 blob：inspect 不得 lazy-fetch 执行外置 transport helper**。fixture 按 C 精确实验命令构造：自有 source 库（`uploadpack.allowFilter true`，含 `.gitattributes`/`package.json`/`payload.txt`，提交基线）→ `git -c protocol.file.allow=always clone --quiet --filter=blob:none --no-checkout --no-local <source> project` → `git read-tree HEAD` → 复制 `package.json`/`payload.txt` 到工作区（不复制 `.gitattributes`）→ `git config remote.origin.url "ext::<node> <helper> <marker>"` + `git config protocol.ext.allow always`；helper 为项目外 CJS，仅向项目外 marker 追加一行后 exit 1，不访问真实网络。控制正例：`git rev-list --objects --missing=print HEAD` 必须列出 `?<blobOid>`（沙箱构造出的 blob OID `cd77e84c…9b5d0` 与 C 实证逐字节一致）；当前固定基础 argv 执行 `status --porcelain -z --untracked-files=all` 后 marker 必须出现（C 实证 exit 128 + marker）——控制用 **spawnSync 有界执行并明确忽略退出码**，只以 marker 判定前提。断言 inspect 后 marker 不存在、全树（含 `.git` 内部字节）深度快照不变、`git.status === 'dirty'` 且 `dirtyPaths` 含 `'.gitattributes'`、契约校验通过。按 C 预审意见（`.superpowers/t15/c-promisor-fixture-precheck-2026-11-17.md`），**已去掉宽泛 catch + `ctx.skip`**：fixture 或控制正例任一失败都作为失败显式暴露，不用 skip 代替 RED。
2. **inspect 的所有 Git 元数据命令共享 `--no-lazy-fetch`（argv 守卫）**：普通完整 clone 项目（含 filter 关联与 dirty 工作区），断言每次实际 Git 调用的 args 都含 `--no-lazy-fetch` 且位于子命令之前。当前 `config -z --get-regexp` 等调用不带 → RED（环境无关）。
3. **Git 元数据命令失败时整体 unavailable，且不重试无保护命令**：受控 spy 让 status 返回 exit 128（模拟 promisor 取不到对象），断言 `git` 恰为 `{ status: 'unavailable', dirtyPaths: [] }`，且失败后任何一次调用都不缺少 `--no-lazy-fetch`。当前调用不带 → RED（环境无关）。

配套新增本地 `deepSnapshot`、`createPromisorProject`、`assertPromisorHelperExecutes`；file protocol 仅用于自有临时 clone，不改变全局 Git。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0，沙箱 Git **2.34.1**：**11 failed | 81 passed (92)**、0 跳过。partial clone 用例在沙箱不支持该前提（该 Git 的 blob:none clone 不真缺对象），按 C 要求不再 skip，而是显式失败于 setup 控制正例，错误信息明确；其余 10 个失败 = 上轮 6 项关联边界 + 2 项子模块 + 本轮 2 项 argv 守卫（失败于 `config -z --get-regexp …` 调用缺 `--no-lazy-fetch`）。**沙箱 Git 2.34.1 不代表固定工具链，B 未把沙箱外新取工具作为项目依赖或正式证据，本轮只交测试源与状态；正式零 skip RED 由宿主 C 执行。** 宿主运行命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts`（预期 11 failed / 81 passed / 0 skipped）。

本轮测试源 SHA-256：`C91F0D0F219BB44D6E1F759756B7FD30C4045908BA3BDC6AF7C1D5FA4B555CF5`（`tests/integration/project-inspect.test.ts`）。实现三文件本轮未改：`inspect.ts` `3EFE46412731860825D8855758DB88326B2821BDBE72FF7FC5315D1A037BD5E5`、`locks.ts` `8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46`、`workspace.ts` `5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576`。

宿主确认 RED（12:40，30.29s，`host-inspect-zeroexec-red-2026-11-17.log`）：**11 failed / 81 passed / 0 skipped**，exit 1，全部为行为断言、无 setup 失败；测试前后 SHA 均 `C91F0D0F…804B`，3 实现源仍 77 GREEN 摘要。

随后同批 GREEN（仅改 `inspect.ts`）：① `GIT_BASE_ARGV` 追加 `--no-lazy-fetch` 与 `-c status.submoduleSummary=false`（均位于子命令之前，覆盖 config/ls-files/ls-files --stage/rev-parse/status/check-attr；某版本不支持即整体 unavailable，绝不去掉保护参数重试）；② status 追加 `--ignore-submodules=all`；③ 新增 `readGitGitlinkState`，固定 argv `ls-files --stage -z` 逐条校验 `<mode> <sha> <stage>\t<path>\0`（完整 NUL、三段、6 位八进制 mode、0-3 stage、合法路径），发现 160000 → 整体 unavailable，探测在 status 之前执行；④ 新增 `readGitTrackedPaths` 在调用 check-attr 前逐条词法校验已跟踪路径，非法即 unavailable 且不调 check-attr；`readGitFilterAssociatedPaths` 增加名称歧义失效关闭（信息值 `set`/`unset`/`unspecified` 与已枚举 driver 同名 → unavailable）。实现 SHA-256 `B25DEEC2E80A985181C77131F22660B05F2D3687D44BBC382A5F283C5327D33A`；`locks.ts`/`workspace.ts` 与测试文件本轮未改。

## 十四、gitlink 触发可靠性回归：93 项 RED → GREEN（宿主复跑待确认）

C 复审第十三节 GREEN 实现（`.superpowers/t15/c-gitlink-trigger-implementation-review-2026-11-17.md`）指出 `readGitGitlinkState` 的触发前置不可靠：它以“已跟踪路径在工作树中是实际目录”或“项目根 `.gitmodules` 是文件”作为执行 stage 枚举的条件，但 gitlink 登记在**索引**里——子模块目录可缺失，`.gitmodules` 可在当前 project 根之外、被用户删除或从未登记，plain `ls-files` 只有路径名、不能据此证明非 gitlink。因此“项目范围内存在 160000 必须 unavailable”会被漏掉，并在 `--ignore-submodules=all` 之后伪称 clean。C 明确这是同一 gitlink 收口的触发可靠性，不是扩张审查范围。

本轮**只补一条真实回归，产品该段未改**（第十三节 GREEN 全部保留）：新增第 93 个用例「项目内索引登记 160000 但目录不存在且无 `.gitmodules`：必须 git unavailable（触发可靠性回归）」，落在子模块 describe 末尾。

- fixture：外层 Git 根 + 目标项目 `apps/client`（自带清单与锁）；自有 seed 提供真实 commit OID（不运行任何子仓代码）；`git update-index --add --cacheinfo 160000,<真实 commit OID>,apps/client/child` 建立合法索引记录；**刻意不创建 `apps/client/child` 目录，项目根与外层都不写 `.gitmodules`**；改动限临时目录。
- 控制正例（任一不成立即抛 setup 错误，不跳过）：① 从 `apps/client` 执行 `ls-files --stage -z` 含 `160000` 与 `child`；② 当前固定完整 status 参数（含 `--ignore-submodules=all`、`-c status.submoduleSummary=false`）从 `apps/client` 执行输出为空。
- 断言：全树（含 `.git`）深度快照不变、`result.git` 恰为 `{ status: 'unavailable', dirtyPaths: [] }`、`result.status === 'inspected'`、契约校验通过。

本地实测（均非正式证据）：沙箱 Git 2.34.1 与环境中已有 Git 2.56.1 下均失败于 `expected { status: 'clean', dirtyPaths: [] } to deeply equal { status: 'unavailable', … }`，控制正例成立，属真实行为 RED 且不依赖特定 Git 版本。剥掉 `--no-lazy-fetch` 的临时副本复跑 93 项：**89 passed | 4 failed**，4 个失败 = 2 项 argv 守卫 + 1 项 partial clone（沙箱前提不成立）+ 本条回归，其余全绿，新增回归不影响其他用例。

宿主窄范围命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts -t "触发可靠性回归"`，预期 1 failed / 0 passed。

宿主确认 RED：初次窄跑 1 行为失败（92 项排除）；完整 93 项复跑 **1 failed / 92 passed / 0 skipped**，exit 1，29.35s（12:58，`host-inspect-gitlink-trigger-{initial,full-red}-2026-11-17.log`），唯一失败就是“当前 git 报 clean 应为 unavailable”，原 92 项全部 GREEN；实现 SHA 稳定 `B25DEEC2…327D33A`。C 仅校正新 fixture 的锁以对应 `vueNpmManifest` 已有的 echarts 6.1.0 声明（保留全部原断言，让 inspected 守卫不被锁缺项遮挡），产品未改。

GREEN 实现（仅 `inspect.ts`）：**移除 `readGitGitlinkState` 的 `suspicious` 前置**，不再依据工作树目录或 `.gitmodules` 推断 index 模式；**所有已能进入 Git 状态读取的项目固定执行一次只读 `ls-files --stage -z`**，保留完整 NUL/三段/mode/stage/路径校验，发现 160000 → 整体 unavailable；普通无 gitlink 项目与项目外 gitlink 项目不因此变为 unavailable。随之删除已无引用的 `GIT_MODULES_FILE` 常量。测试侧按 C 批准只调整一处非行为 argv 计数断言：`filter 关联枚举使用固定 argv 与同一清理环境…` 由「`ls-files` 只调用一次且尾参 `['ls-files','-z']`」改为「普通 `ls-files -z` 一次 + `ls-files --stage -z` 一次」，基础只读参数与 filter 屏蔽断言同时应用到两次调用；`check-attr` 仍只调用一次、输入仍是完整 NUL 的已跟踪路径集合，其余行为/零执行/全树/契约断言一字未改。

本地实测（均非正式证据）：`tsc --noEmit` exit 0；沙箱 Git 2.34.1 下剥掉 `--no-lazy-fetch` 的临时副本复跑 93 项为 **90 passed | 3 failed**（3 个失败 = 2 项 argv 守卫 + 1 项 partial clone 沙箱前提不成立），即四条边界与 gitlink 触发回归在本地全绿；环境中已有 Git 2.56.1 复跑真实源码为 **91 passed | 2 failed**（2 个失败是该环境 `git submodule add` 的 fixture 构造失败，未触及产品代码，同两项在沙箱 Git 2.34.1 下完整通过）。

本轮文件 SHA-256：`inspect.ts` `8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB`、`locks.ts` `8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46`（未改）、`workspace.ts` `5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576`（未改）、`tests/integration/project-inspect.test.ts` `AAE56CE74A74599D86AF2138FCE15591DDF9FA50A5928337FD49587479C76C27`（93 项）。宿主复跑命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts` 加 CLI build/typecheck 与根 `tsc --noEmit`，预期 93/93、0 skipped、exit 0。

## 十五、inspection 正式收口 + plan 阶段行为 RED（宿主 RED 待确认）

**inspection 收口（宿主确认）**：2026-11-17 13:06:49 固定 Node26.13.0/pnpm12.18.0/Git2.48.1 完整运行 93 项 **93/93 passed、0 skipped、exit 0**（30.50s），CLI build/typecheck 与根 tsc 均 exit 0，测试/三实现 SHA 前后一致；日志 `host-inspect-gitlink-trigger-{green,build,typecheck,root-tsc}-2026-11-17.log`。C 已代 B 聚焦提交 `99bf0f46`（`feat: 实现本地项目与锁文件只读识别`），B 工作树干净。最终实现 SHA：`inspect.ts` `8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB`、`locks.ts` `8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46`、`workspace.ts` `5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576`。

**plan 阶段 RED**（依据 `c-plan-next-stage-2026-11-17.md`，不重规划）：新增 `tests/integration/project-plan.test.ts`（16 项）与 `tests/integration/project-plan-network.test.ts`（13 项），共 29 项；为尚不存在的 `integration/{resolve,registry,plan}.ts` 与 `commands/integrate.ts` 补仅固定签名且 throwing 的最小 stub，使所有用例实际收集并在行为断言上失败（不用 0 tests 冒充 RED）。

`project-plan.test.ts` 覆盖：planned 形状（`executionAuthorized` 恒 false、`matchPlanDigest` 为 canonicalJson(sourceMatchPlan) 的原始 SHA-256、baseFileHashes 原样保留识别快照且未来源码以 `exists:false` 表示、allowedPaths/changes/commands 三类意图、install 预览固定 `install --ignore-scripts`、默认 `src/components/zhinexus/component-0001.vue` 与 `--output-dir` 自定义）、同包多实例按输入顺序编号且只读一次包材料、凭据不进计划 JSON、兼容未验证/缺数据源/缺事件处理/缺布局、同名不同精确依赖不静默升级已锁宿主、缺 ECharts 不凭空补版本、OUTPUT_EXISTS 不覆盖、DIRTY_TARGET（其他脏文件仅记录不阻塞）、`--output-dir` 穿越项目根、本地项目多锁冲突、以及“离线 MatchPlan 自洽但删掉 required prop / 删空 events / 含额外成员或过期类型”时由权威 GET 交叉核对发现遗漏（API_MISMATCH）、下载后撤权（TARGET_UNAVAILABLE）。每个用例都断言目标项目全树字节快照不变。

`project-plan-network.test.ts` 覆盖：planned 基线（API 与 registry 两类令牌分别注入、互不转发）、GET query 身份不符、tarball SHA 与平台摘要不符、仅有 registry integrity 不得伪称平台摘要、下载超 50 MiB、请求超时、跨 origin 重定向（目的地零请求）、地址含 userinfo、非 loopback HTTP、网络请求等待期间并发编辑 → PROJECT_CHANGED 且保留用户修改、tarball 暂停期间撤权后必须复读并拒绝 planned、API 返回 gap、远端 5xx。

为使“必须失败”类用例在 RED 下真正失败（不被 stub 的抛错顺手满足），`plan.ts` 增加稳定执行错误契约 `IntegrationPlanError` + `INTEGRATION_PLAN_ERROR_CODES`（`NOT_IMPLEMENTED`/`INVALID_ENDPOINT`/`REQUEST_TIMEOUT`/`DOWNLOAD_LIMIT_EXCEEDED`/`REDIRECT_REJECTED`/`REGISTRY_UNAVAILABLE`）；结构化冲突一律以 `status: 'conflicted'` 的计划返回，执行错误抛该类型（CLI 映射 exit 1）。

宿主确认正式 RED：13:25:52 两个文件 **29/29 行为失败、0 skip、exit 1**（1.45s），根 tsc exit 0，测试/四 stub SHA 前后一致；日志 `host-plan-behavior-red-2026-11-17.log`、`host-plan-behavior-red-hashes-2026-11-17.json`、`host-plan-behavior-red-root-tsc-2026-11-17.log`。C 同批预审（`.superpowers/t15/c-plan-red-fixture-precheck-2026-11-17.md`）指出 throwing stub 尚未触及网络、不能证明正常夹具可达到 planned，并列岀四类成功夹具前提缺失。本轮**只修测试夹具，产品 stub 一字未改**，不削弱任何原行为断言：

1. `project-plan.test.ts` 由“单 API server 兼任 registry、target SHA 固定 `'b'.repeat(64)`”改为 **API 与 registry 两个独立 loopback 服务**；registry 返回固定合成 bytes 的 packument 与 tarball，`integrity`/`shasum`/平台摘要全部由实收 bytes 实算（sha256/sha512/sha1），正常 target 与断言用同一 SHA-256；registry 缺省只回答被请求的精确 name/version 与 tarball 路径，其他 404。
2. `project-plan-network.test.ts` 的 `INTEGRITY` 不再是全 A 占位值，改为从实收 bytes 实算；摘要损坏案例改为 target 声称的 `packageSha256` 与实收 bytes 真实 SHA-256 不同；新增「registry `dist.integrity` 与实收 bytes 不符必须拒绝（`REGISTRY_UNAVAILABLE`）」用例，替换原先偏弱的“无平台摘要就号称 registry-integrity”断言。
3. 两份 API 正常 query 现含 `packageName` 绑定已选包，用例逐个字段断言全部 query 字段。
4. 屏障改为显式 `entered`/`opened` + `waitForEntry`（5s 受控超时）：确认请求真的进入屏障后才改文件/切撤权再释放，不用 `sleep` 冒充；产品先失败时返回 `settled` 并由“请求应先进入屏障”断言失败，不会把等待未发请求的 setup 超时当行为 RED；撤权用例断言最终 GET 次数 ≥ 2。
5. planned 首例按冻结 spec 精确预期 **install + 原生 typecheck + 原生 build**（结构 argv、cwd 相对项目根），不再把产品缩成只显示 install。

正常源 MatchPlan 与 API 响应用冻结 validators 断言动态合法；“删 required prop / 删空 events / 含额外成员”三个语义反例各自单独断言删改后仍结构合法；保留 required 却删 source 的变体按 `validateMatchPlan` 设计要求需显式 MISSING_PROP gap，故不断言其合法；缺 ECharts 场景改为删除 `echartsVersion` 键；每个入口运行前后检查同一目标树。

夹具可满足性探针（本地，非正式）：实收 bytes `sha256=a0a93a8f7e7e772d2ad1c730c8838eaef151b88516edd68d5c8e5ad63efbbdfd`、`integrity=sha512-EXxNpK4cblHNRFR1ZkIIi7ilJiK88cQCLnqFIzS0cPuv7rvqC+NyeTF2xke/U0AfNXnpPUXGdom4SACLQ/stJA==`、`shasum(sha1)=e6ee48b93e8580bd893629d47d31601e438b7831`；`validateMatchPlan=true`、`validateComponentMatchResponse=true`、`validateIntegrationPlan(validIntegrationPlanFixture())=true`（证明未触碰 C 冻结契约）。

同批独立审查补充（已追加至 `c-plan-red-fixture-precheck-2026-11-17.md`）确认“删除字段 + 缺口处理”做法正确、`sourceMatchPlan` 完整保留；同时指出原 registry-integrity 用例只是把所选组件平台 SHA 改错，未覆盖已批准的新增 core 依赖检查。已改写为真实场景并新增守卫：

- **GET 明确新增 core 依赖（planned）**：本地项目不锁 ECharts，MatchPlan 明确给出候选版本，GET 的 `exactDependencies` 显式包含该 core；registry 为 core 提供**独立 synthetic bytes / 精确版本元数据 / 由该 bytes 实算的真实 integrity**（算法沿用既定 sha256/sha512/sha1，未加新依赖）。期望 `registryEvidence` 中该 core 为 `verification: 'registry-integrity'`、`sha256` 等于 core bytes 真实 SHA-256、`integrity` 为实算值，且 core 元数据与 bytes 必须被真实读取（断言请求路径含 `/echarts` 与 `/echarts/-/echarts-6.1.0.tgz`）；不得把无平台摘要的 core 声称成 `platform-sha256`；断言显式清单修改、锁重建意图与 install 预览。
- **坏 integrity 守卫**：core 的 `dist.integrity` 与实收 bytes 不符 → 执行错误 `REGISTRY_UNAVAILABLE`，不返回计划。
- registry 服务同时改为**按请求路径路由 + 覆盖表**（缺省只回答被请求的精确 name/version 与 tarball 路径，其他 404），替换原先依赖调用顺序的响应队列。

新增 core 场景的**夹具可满足性探针**（本地，非正式）：按上述形状构造完整计划，`validateIntegrationPlan` 通过（含 `registry-integrity` 证据、双新增依赖的清单修改、install + 原生 typecheck/build），证明该用例可被正确实现满足。

宿主 13:44:42 固定工具链完整 **31/31 失败、0 skip、exit 1**（859ms），根 tsc exit 0，两个测试 SHA 为 `DEEAA4A1…FE8C` / `FBF64E3E…BF89`，四 stub 前后一致。独立 reviewer 固定前后 SHA 一次复审后只剩两处原前提未真正修正（`c-plan-red-fixture-precheck-2026-11-17.md` 末节），本轮只改这两处测试、产品 stub 一字未改、未删除任何结果合法性断言：

1. **plan.test.ts**：unverified 与三类缺绑定原用显式 `source/handler/layout: undefined` 且不加 gap，还在入口前取消源合法性断言；冻结 schema 禁止 `undefined`，`validateMatchPlan` 要求缺绑定/布局/兼容的显式 gap，而 `validateIntegrationPlan` 会再验证完整 `sourceMatchPlan`，原夹具不可能合法。现改为真正删除可选字段并补对应 gap（unverified → `compatibility` 改 unverified + `COMPATIBILITY_UNVERIFIED` gap；缺数据源 → 删 `source` + `MISSING_PROP`；缺事件处理 → 删 `handler` + `MISSING_EVENT`；缺布局 → 删 `layout` + `LAYOUT_UNKNOWN`），每个用例在调用入口前断言 `validateMatchPlan(plan).ok === true`，并保留结果合法与相应冲突断言。
2. **network.test.ts**：摘要损坏用例原 `source.target` 为 `OTHER_SHA256` 而 API 缺省首/末次 target 都是 `TARBALL_SHA256`，首次 GET 已先 `TARGET_CHANGED`。现新增可临时改写的 `apiDefaultTargetSha`（`beforeEach` 复位），该用例设为 `OTHER_SHA256` 使两次 GET 稳定声明同一摘要，served tarball 仍是正常 bytes，唯一改变的就是下载摘要；保留真实下载请求控制与结果合法性断言。

修正后 B 沙箱预检（非正式）：`tsc --noEmit` exit 0；两个新文件仍 **31 failed (31)**（16 + 15），失败全部落在行为断言（19 项缺结构化计划、6 项错误 code 不匹配、2 项请求未进入屏障、其余为缺数据源/撤销/撤权的结构化冲突断言），无 fixture、结构合法性或屏障超时失败；三处修正后的用例均失败于 `planIntegration` 行为断言（在其 `validateMatchPlan` 夹具断言之后）。本地探针另确认摘要损坏用例的完整 conflicted 计划可通过 `validateIntegrationPlan`（served bytes SHA `a0a93a8f…bbdfd` vs 声称 `78442dda…595c`）。宿主 RED 命令同上，预期 31 failed / 0 passed / 0 skipped。

本轮文件 SHA-256：`project-plan.test.ts` `C8DFC9100B158A16EE3472CF28913F577BD405BB23C54109531F3FAF5F0F7A85`（16 项）、`project-plan-network.test.ts` `E1AC8A98896E536D271FBB36A7236014C1A4C18EB741B70858BDFD12D496DFF9`（15 项）、`integration/resolve.ts` `2BADB0C789ABACAFE9EFF19FAC5486E01A3B6891B2C1F73D9103300CE89E52F4`、`integration/registry.ts` `937F3491C81CDE124E6A24812CD818FE5C581D29039B745DEEEEE78DDCAF7303`、`integration/plan.ts` `5EF4FDDF247E1F164E2F475E175DC476494B6755905B7C670A20DDD6CCD9246D`、`commands/integrate.ts` `69CBB9937B6584BD6E97638A43D83962853F32FF1912B8089C2A36CBF189F045`。inspection 三实现与 `project-inspect.test.ts` 本轮未改。

B 沙箱预检（非正式）：`tsc --noEmit` exit 0；vitest 5.1.0 两个新文件 **29 failed (29)**，无一通过/跳过；既有 93 项 inspection 在临时副本剥掉 `--no-lazy-fetch` 后仍为 3 failed | 90 passed，与收口前一致。宿主 RED 命令：`.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts`，预期 29 failed / 0 passed / 0 skipped。

## 十六、未覆盖与风险

- Git `status` 触发 clean/process filter 已由 C 实测确认，本轮已按“只读枚举配置 + `-c` 置空 clean/process/smudge 并关闭 required”收口；`git config -z` 的记录格式在沙箱 Git 2.34.1 实测，宿主 Git 2.48.1 由正式复跑确认。driver 名若含空格/非 ASCII 等无法可靠屏蔽的字符，按约定整体报 `git unavailable`（不执行 filter、不伪造 clean）。
- **第七项（变换型 filter 的 false-clean）已在第十节修复**：固定 argv 的 `ls-files -z` + `check-attr -z filter --stdin` 只读枚举，把实际关联已枚举 driver 的 tracked 路径保守并入 dirtyPaths；枚举/属性/路径记录不可信即整体 `git unavailable`，不用“清洗成干净”冒充观察，也不用全部 unavailable 掩盖清单改动。已知代价：受 filter 影响的未修改路径会被多报为 dirty（明确的只读保守边界），后续 plan 的 DIRTY_TARGET 会因此更易触发，需人工复核。
- **第六类 npm 近层记录的两条残余漏检已在第十节修复**：显式坏记录与记录缺失区分开，仅 `link === true` 且指向锁内合法包的链接记录才解析目标版本。
- Windows junction/大小写/8.3 行为依赖宿主实测；基础 20 项中的真实 junction 用例在无链接权限时跳过并登记未覆盖（外链读取阻断已改用受控 realpath mock，不再依赖文件符号链接权限）。
- 真实 pnpm 12.18.0 锁多文档形态以 A 快照为准；B 其余 fixture 为合成样本。
- pnpm 锁版本现仅接受标量 `'9.0'`：若未来 pnpm 改写其他 v9 小版本，需要同步放开并补测试（当前以 P0“pnpm lockfile v9”与真实快照为准）。
- 第六节六项数据边界阻断已在第七节修复，宿主复跑 63/63 通过；第七、八、九节共 4 项反例已在第十节修复，宿主复跑 77/77 通过；第十一节两条关联枚举边界（ls-files 路径合法性、check-attr 特殊状态与同名 driver 歧义）与第十二节 Git 子模块零执行边界（status 递归执行子仓 filter、项目内 gitlink 无法安全识别）尚未修复，共 8 项反例待宿主 RED 与 B 一并收口后方可提交 inspection 完成。
- `planIntegration`、GET 复读、registry 字节/摘要校验、CLI 接线均未开始；T16/T17、真实业务项目验收不在本轮范围。

## 十七、提交与 hash

本轮提交由宿主 C 在 Windows 代跑并注明：`feat: 实现本地项目与锁文件只读识别`（实现三模块与测试修订）、`test: 补充独立审查反例与真实锁快照、Git filter 反例`、Git 最终执行边界轮（filter 枚举/porcelain `-z` 修复与断言收紧）、数据边界轮（workspace 声明按包管理器选择、坏字段/锁版本/specifier/manifest 类型/近层 link 失效关闭，测试由 62 增至 63 项）、filter 语义与近层记录轮（变换型 filter false-clean 的只读关联枚举收口 + npm 近层记录失效关闭，测试由 68 增至 77 项）。第十一、十二节 RED（关联枚举边界 + Git 子模块零执行，测试 89 项）的提交待其 GREEN 与宿主复跑通过后另行进行。`.superpowers/` 下宿主日志被 gitignore，不得强加入提交。完整 hash 以 Git 记录为准，B 不 push、不合并、不改公共契约或根配置。
# 宿主正式 inspection 收口（C 追加，2026-11-17 13:07）

B 实际 Claude 桌面端完成四类零执行修复与 gitlink 触发可靠性修复并停写后，C 在本工作树实际执行：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts
.\scripts\pnpm.ps1 --filter @company/component-cli build
.\scripts\pnpm.ps1 --filter @company/component-cli typecheck
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

固定 Node26.13.0/pnpm12.18.0/Git2.48.1.windows.1：完整测试 **93/93 passed、0 skipped、exit0**，30.50秒（13:06:49开始）；CLI build/typecheck、根tsc均exit0。测试运行前后SHA同为 `AAE56CE74A74599D86AF2138FCE15591DDF9FA50A5928337FD49587479C76C27`，inspect源同为 `8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB`；locks/workspace摘要保持既有交付。日志本工作树 `.superpowers/t15/host-inspect-gitlink-trigger-{green,green-hashes,build,typecheck,root-tsc}-2026-11-17.*`。

本次只关闭inspection子任务。plan/registry/GET复验与CLI接线、新冻结CLI的独立黑盒及真服务验收尚未完成，不据此标T15完成。C此前仅校正synthetic子模块行尾配置及新触发回归的ECharts锁条目，保留原行为断言；产品始终由实际B开发。按已批准计划进入plan行为RED，版本/打包由C在最终候选审查后统一收口。

# 十八、plan：原 P1 GREEN 产品实现（宿主 2026-11-17 13:56:02 授权；等待宿主正式复跑）

本节把验证范围从“本地项目识别”扩展到 P1 的“只读接入计划 + CLI 接线”。上一节（十七）之后，宿主已按 `c-plan-next-stage-2026-11-17.md` 完成 31 项 plan 行为 RED 与成功夹具前提补齐，并于 13:56:02 正式授权原 GREEN。B 本轮实现 `integration/{resolve,registry,plan}.ts`、`commands/integrate.ts`，并接线 `cli.ts`/`index.ts`，**未重规划、未扩张范围**；未改 P0/公共契约、根配置、锁文件、版本，未 bump/pack/push，未动 93 项 inspection 的测试与 `inspect.ts`/`locks.ts`/`workspace.ts`。

## 实现要点（只读边界逐条落实）

- **本地解析（`resolve.ts`）**：复用 `inspectProject` 的同一套只读约束，自身零网络零写入。MatchPlan 与本地实际框架/包管理器/`frameworkVersion`/`echartsVersion` 逐项核对；本地未锁 ECharts 且 MatchPlan 未给明确候选时只报 `ECHARTS_MISSING`，不凭空补“最新版本”。输入 MatchPlan 的顶层与 element gaps 原样保留为冲突。目标按首次出现去重；同名不同精确版本 → `VERSION_MISMATCH` 且该目标不再读取 registry。`manifestPath`/`lockPath` 有未提交改动 → `DIRTY_TARGET`，其他脏文件仅记录不阻塞。默认未来位置 `src/components/zhinexus/component-0001.vue|.tsx`（按元素输入顺序，路径相对项目根），已存在 → `OUTPUT_EXISTS`，realpath 逃逸 → `PATH_UNSAFE`。
- **远端读取（`registry.ts`）**：地址无 userinfo、仅 HTTPS 或显式 loopback HTTP；`redirect: 'manual'` 并显式拒绝 3xx / `opaqueredirect` / status 0，因此重定向目的地零请求；流式读取 + 50 MiB 限额，超限即取消；`AbortSignal.timeout`；非 2xx 只回显状态码、绝不回响应体；tarball 必须与 registry 同 origin；`dist.integrity`（sha256/384/512）与 `dist.shasum`（sha1）必须与实收 bytes 实算一致；两类令牌分别注入、互不转发、绝不进返回值；不在目标项目写下载缓存。
- **编排（`plan.ts`）**：先在任何网络请求之前取关键文件原始字节基准；本地识别未通过时完全跳过远端（不为无法识别的项目下载材料）；权威 GET 后做 element target 全量比对与权威 API 对每个实例全部 props/events/type/required/payload/source/handler 的交叉核对；registry 下载按 name@version memoize 并复算摘要；下载/元数据结束后**最终复读 GET** 并与首次 `canonicalJson` 比对；再复读本地关键文件；**只为最终复读仍 matched 的元素**规划组件文件；`platform-sha256` 只对最终 matched 且摘要相符者声称，新增运行时依赖用 `registry-integrity`；产出过自身 `validateIntegrationPlan` 守卫。
- **CLI（`commands/integrate.ts` + `cli.ts` + `index.ts`）**：`component integrate inspect|plan`；stdout 只写结构化 JSON、诊断走 stderr；conflicted exit 2、planned/inspected exit 0、参数/JSON/读取/网络错误 exit 1；令牌只从 `ZHINEXUS_API_TOKEN`/`ZHINEXUS_REGISTRY_TOKEN` 读取，不读项目配置；`--output-dir` 是未来源码位置，不创建目录。

## GREEN 期间唯一一处测试侧改动（显式报备）

宿主 RED 冻结的 `project-plan-network.test.ts`「API 返回 gap（目标不可用）」只推了一条 gap 响应，导致**最终复读** GET 落到 API server 的缺省 matched 响应——该用例当时是因夹具原因失败，而非锁住它声称的行为。修法是再推一条完全相同的 gap 响应。**断言一字未改**，未删除任何结果合法性断言。变异证明（沙箱，非正式）：把产品改回“用全部 mapped 元素规划组件、忽略最终复读的 gap”后，恰好只有这一条用例失败，其余 14 条不变，说明它仍是真实行为钉子。测试 SHA 由 `E1AC8A98896E…96DFF9` 变为 `5E989FCAC925…3CE24`，已请 C 决定是否需要单独复核。

## B 沙箱预检（非正式；沙箱 Git 2.34.1 / Node 22，不代表宿主固定工具链）

`tsc --noEmit`（plan 侧文件及其传递闭包）exit 0；`project-plan.test.ts` 16/16 与 `project-plan-network.test.ts` 15/15 全过（合计 31/31，0 skipped）；`project-inspect.test.ts` 90 passed | 3 failed (93)，3 个失败全部是沙箱 Git 2.34.1 不支持 `--no-lazy-fetch` 的已知限制，且 `inspect.ts` 与该测试文件与宿主 93/93 GREEN 版逐字节一致。包级 typecheck 仅 3 个错误，全在非本人文件且均为沙箱缺 `node_modules` 的模块解析；根 `tsc` 的 618 个错误同样全是模块解析与隐式 any 级联，本人文件与三个 `project-*.test.ts` 均 0 错误。

另做**真实 CLI 进程**端到端冒烟（编译到 `/tmp` + loopback API/registry）：plan → planned/exit 0/stdout 仅 JSON/目标树零写入/两类令牌不出现在 stdout+stderr/恰好 2 次权威 GET/commands 恰为 `install --ignore-scripts`、`run typecheck`、`run build`；目标已存在 → conflicted/exit 2；inspect → exit 0。参数错误矩阵（缺子命令、未知子命令、重复/未知/缺值参数、缺必填参数、坏 JSON、文件不存在、MatchPlan schema 非法）全部 exit 1 且 stdout 为空。`--output-dir ../escape` 产生 `PATH_UNSAFE` 冲突而非写入。

## 请宿主 C 执行的命令（工作树根目录）

```powershell
cd C:\Users\10208\.codex\worktrees\t15-b-integration-plan\zhinexus-design-asset-platform
git status --short --branch
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts
.\scripts\pnpm.ps1 --filter @company/component-cli run build
.\scripts\pnpm.ps1 --filter @company/component-cli run typecheck
.\scripts\pnpm.ps1 exec tsc --noEmit -p tsconfig.json
```

预期：93/93 + 31/31 passed、0 skipped、exit 0；CLI build/typecheck 与根 tsc 均 exit 0。

## 本轮文件摘要（SHA-256）

```
8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB  packages/component-cli/src/integration/inspect.ts    （未改）
5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576  packages/component-cli/src/integration/workspace.ts  （未改）
8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46  packages/component-cli/src/integration/locks.ts      （未改）
572F0C061B33BE522238E32A970259D11F7BA5B65ADA2429A16CBBAC9000CD3F  packages/component-cli/src/integration/resolve.ts    （新实现）
C9C5E296E33FF05212EC542D194E54298726F821F458724621D10333B446CF43  packages/component-cli/src/integration/registry.ts   （新实现）
C68CF23DE94B218447AF5E57B8E7B2A68FB6667B8CB2618ED31D61E3034E7EEE  packages/component-cli/src/integration/plan.ts       （新实现）
900F016475E85D762A4963B34047C52F6DFE8B1C4515D7475BED54B6AF94399E  packages/component-cli/src/commands/integrate.ts      （从 throwing stub 实现）
F84C7C6EBC795FBEFBD797066FD712F4694DAFAFD7A7C481EA586ABC3FDA17EB  packages/component-cli/src/cli.ts                    （接线）
4D0E4FBFB1809908F81DAD9A9A262EFDF428D7E98D67A60077347E0245A0CA46  packages/component-cli/src/index.ts                  （导出新模块）
AAE56CE74A74599D86AF2138FCE15591DDF9FA50A5928337FD49587479C76C27  tests/integration/project-inspect.test.ts           （未改）
E36901B930DC3BAF77E95BC58A36CC2B89B6DFF9BCF7400D85982BB0F1D945D8  tests/integration/project-plan.test.ts              （本轮未改）
5E989FCAC925D78A8B5C4DA6DB3C89864C96A419D07338EF1620D0411433CE24  tests/integration/project-plan-network.test.ts      （仅上述一处夹具变更）
```

**最终版限时复跑与停写**：`commands/integrate.ts` 做过一次 env 令牌读取的等价重构后，B 按宿主指示限时复跑——`tsc` exit 0，两个 plan 文件再次 **31/31 passed**。CLI 冒烟改走独立脚本（把 CLI 用例塞进 vitest 文件在沙箱里反复被环境问题干扰）：参数错误矩阵 10 项 + MatchPlan schema 非法 + `--output-dir ../escape` 共 12 项全部符合预期。**以上均为沙箱非正式证据，B 未宣称任何正式通过，并在此停写**，等宿主 C 的固定工具链完整 93 + 31、CLI build/typecheck 与根 tsc 结果。

# 十九、候选审查回归 RED（宿主候选 124/124 通过；7 项 Important；产品候选未改，停写待正式 RED）

宿主 14:30:28 固定工具链正式执行三组 P1：**124/124 passed、0 skipped、exit 0**（35.28s），12 源 SHA 前后稳定；CLI build/typecheck、根 tsc 均 exit 0。独立候选审查一次收束 7 项 Important（`.superpowers/t15/c-plan-product-review-2026-11-17.md`），C 逐项源码复核采纳。按交接要求，**本轮只补回归测试、产品保持当前候选**，并执行两项收口裁定。

**裁定一：删除 CLI 额外 `--timeout`。** 保留原冻结 CLI 参数清单，`PLAN_FLAGS` 去掉 `--timeout`、删除 `parseTimeout` 与 `USAGE`/help 相关文字，`plan` 不再传 `requestTimeoutMs`；库接口 `PlanOptions.requestTimeoutMs` 保留，原 timeout 单测继续覆盖。实测 `--timeout 3000` 现按未知参数 exit 1，`component --help` 的 integrate 段不再出现该项（echarts verify 行原有 `--timeout` 未动）。

**裁定二：如实说明 SHA 变化。** `project-plan.test.ts` 从宿主 RED 冻结值 `C8DFC9100B15…F0F7A85` → 候选 GREEN 时 `E36901B930DC…D945D8`（GREEN 期间那次 gap 夹具修正）→ 本轮 `C6887A7F6CB6…54C798`（仅顶部加一行 `runIntegrateCommand` 导入 + 末尾新增 4 个 CLI 用例）。`project-plan-network.test.ts` 从 `E1AC8A98896E…96DFF9` → `5E989FCAC925…3CE24` → 本轮 `EF51E0C924A8…CF1736`（仅末尾新增 14 个回归用例）。`commands/integrate.ts` 候选时为 `900F016475E8…94399E`（早期表内 `03A9C78C…54F3D` 为中间态，已更正），本轮删 `--timeout` 后为 `C03638208A09…4BC949`。原有 16 + 15 项用例及其断言一字未改。

## 新增 7 类回归测试（18 项；本地 15 项如预期失败，3 项为守卫）

1. **链接/junction 逃逸与外部读取（3 项）**：拟生成文件缺失但父目录是逃逸 junction；既有 junction 承载拟生成目标文件；等待期间目标目录被换成逃逸 junction。断言 `PATH_UNSAFE`、计划 JSON 不含项目外文件实算摘要、外部 bytes 与链接原状不变。目录链接用 junction（Windows 无需管理员特权），POSIX 退回目录符号链接；创建失败抛 setup 错误，不静默跳过。
2. **新增依赖最后下载期间撤权/编辑（2 项）**：沿未锁 ECharts/core 场景，core tarball 实际 entered 屏障后分别推撤权 gap / 编辑关键文件再放行，要求全部 registry 元数据与 tarball 结束后再 GET 复读、然后本地复读。
3. **原先不存在的第二锁 / workspace 声明（3 项，含 1 守卫）**：下载期间新增 `package-lock.json`、单包新增 `pnpm-workspace.yaml` 必须 `PROJECT_CHANGED` 且保留用户新文件；守卫要求 planned 基线的 `baseFileHashes` 把这些关键探测路径记为 `exists:false`。
4. **新依赖缺 integrity（2 项，含 1 守卫）**：新增 core 元数据给正确 shasum 但无 integrity → 必须执行失败且无 registry-integrity 证据；守卫明确区分——所选组件缺 integrity 仍按平台 SHA 处理。
5. **真实组件 bytes 损坏（1 项）**：元数据与平台摘要正常、只翻转 served tarball bytes → 必须返回合法 conflicted + `PACKAGE_DIGEST_MISMATCH`，不得误作 `REGISTRY_UNAVAILABLE`。
6. **失败矩阵单一 JSON stdout（4 项，含 1 守卫）**：直接走 `runIntegrateCommand`，参数 9 类 + MatchPlan 3 类 + 远端 5xx，要求 exit 1 + 单一 JSON stdout（本地最小稳定对象 `{status:'error',error:{code,message}}`，不冒称 IntegrationPlan）+ stderr 诊断 + 不发无必要请求 + 不回显令牌；守卫确认成功路径 stdout 仍是单一 JSON。
7. **远端值脱敏（3 项，含 1 守卫）**：不含连字符的 synthetic token 放入 `dist.integrity` 算法字段不得回显；非法 JSON 体内含 token 不回显原文（守卫）；远端 gap 消息含两类令牌时计划 JSON 不得含任何令牌。

错误码契约由命令本地实现保持稳定：`INVALID_ARGUMENTS`、`INVALID_MATCH_PLAN`、`EXECUTION_FAILED`，以及透传 `IntegrationPlanError.code`。共享 contracts 无专用执行错误 envelope，不新增共享 DTO。

## B 沙箱预检（非正式）

`tsc --noEmit`（plan 侧文件及其传递闭包）exit 0。三组复跑：`project-plan.test.ts` 3 failed | 17 passed (20)；`project-plan-network.test.ts` 12 failed | 17 passed (29)；`project-inspect.test.ts` 3 failed | 90 passed (93)（3 项为沙箱 Git 2.34.1 不支持 `--no-lazy-fetch` 的已知限制，对应文件与宿主 GREEN 版逐字节一致）。合计 18 failed | 124 passed (142)，15 个新失败全部落在新增回归的行为断言，无 fixture/结构合法性/屏障超时/setup 失败。真实进程参数矩阵 12/12（含 `--timeout` 现按未知参数 exit 1）。**不代表宿主固定工具链，未宣称任何正式通过；B 在此停写，等宿主正式 RED 后再做本批 GREEN。**

## 本轮文件摘要（SHA-256）

```
8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB  packages/component-cli/src/integration/inspect.ts    （未改）
5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576  packages/component-cli/src/integration/workspace.ts  （未改）
8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46  packages/component-cli/src/integration/locks.ts      （未改）
572F0C061B33BE522238E32A970259D11F7BA5B65ADA2429A16CBBAC9000CD3F  packages/component-cli/src/integration/resolve.ts    （产品候选未改）
C9C5E296E33FF05212EC542D194E54298726F821F458724621D10333B446CF43  packages/component-cli/src/integration/registry.ts   （产品候选未改）
C68CF23DE94B218447AF5E57B8E7B2A68FB6667B8CB2618ED31D61E3034E7EEE  packages/component-cli/src/integration/plan.ts       （产品候选未改）
C03638208A093DFC568599D81413AFB8DF06DFD3476DC66A8084A5A5354BC949  packages/component-cli/src/commands/integrate.ts      （仅删除 --timeout）
9551DC19379543F6C14321A5057AAD9A2447930B202D8344119E0F24E6D2A167  packages/component-cli/src/cli.ts                    （仅删除 help 中 --timeout）
4D0E4FBFB1809908F81DAD9A9A262EFDF428D7E98D67A60077347E0245A0CA46  packages/component-cli/src/index.ts                  （未改）
AAE56CE74A74599D86AF2138FCE15591DDF9FA50A5928337FD49587479C76C27  tests/integration/project-inspect.test.ts           （未改，93 项）
C6887A7F6CB62F152EB29F3125F856185BA947AEA6F8860445AAEA32B154C798  tests/integration/project-plan.test.ts              （16 原项未改 + 4 项 CLI 回归）
EF51E0C924A82177A79C3C15E8A0F52297E2F03A0691302516ED309454CF1736  tests/integration/project-plan-network.test.ts      （15 原项未改 + 14 项回归）
```

## 仍未覆盖（不宣称完成）

CLI 参数与退出码只有沙箱冒烟，**没有已提交测试覆盖** `runIntegrateCommand`，正式门槛是 D 的独立黑盒（33 项）与 C 的真服务专项（25 项）；Windows junction/大小写/8.3 未在宿主实测；未跑真实 Nest/PG/MinIO/Verdaccio 联调，也未安装已打包 CLI 做仓外验证。`registry.ts` 的 `redirect: 'manual'` 在沙箱 Node 22 下表现为 `type=basic, status=302`，其他运行时可能表现为 `opaqueredirect`，两条路径都已拒绝，宿主 Node 26.13.0 由「跨 origin 重定向」用例正式确认。

# 二十、候选审查回归 GREEN（宿主正式 RED 15 failed / 127 passed 已确认；七项 Important 同批修复，停写待宿主正式复跑与 D 验收）

宿主 2026-11-17 15:50:18–15:50:53 固定工具链完整三组：**15 failed / 127 passed / 142 total / 0 skipped、exit 1、32.91s**；原 124 项全 GREEN，新增 18 项中 15 项行为 RED、3 项既有守卫 GREEN；根 tsc exit 0，12 个文件 SHA 前后一致；Windows junction 创建与外部指向检查实际成功，无 setup/屏障/输入合法性失败。据此授权本批 GREEN。**未重规划**：七项逐一最小修复，只改 B 的四个产品文件；三个测试文件、`cli.ts`、`index.ts` 与冻结 inspection 三源字节未变；未改 P0/契约/A/C/D/根配置/锁/版本；未 commit/bump/pack/push/merge。

## 七项修复的产品落点

1. **链接与 realpath 边界（`resolve.ts` + `plan.ts`）**：`resolve.ts` 弃用只做词法 `path.relative` 的 `nearestExistingDirectory`，新增 `realPathOf()`（逐段解析链接/junction；尾部不存在时先解析最近的已存在祖先后拼回剩余段）。拟生成路径先按真实位置判界：经链接逃逸即 `PATH_UNSAFE`（不再被"文件已存在"降级为 `OUTPUT_EXISTS`）。`snapshotOf` 同样先解析真实位置，项目外路径**不读取、不记录摘要**（记 `exists:false`）。
2. **registry 材料先行（`plan.ts`）**：所选组件包与权威 GET 明确新增的运行时依赖全部下载并复算摘要后，才做最终复读 GET，然后才是路径解析与本地复读。原先新增依赖下载在最终 GET/本地复读之后，该期间的撤权/编辑漏检；`registryEvidence` 阶段改为只复用已下载结果。
3. **关键探测路径基准（`plan.ts`）**：新增 `PROBE_PATHS`（`package-lock.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`/`yarn.lock`/`bun.lock`/`bun.lockb`）进入复读基准与 `baseFileHashes`，基线不存在即以 `exists:false` 记录；inspection 已冻结输出未改。
4. **缺 integrity 的新增依赖（`registry.ts` + `plan.ts`）**：`fetchPackageDigest` 增加 `PackageDigestExpectation`（`expectedSha256`/`requireDeclaredIntegrity`）与 `integritySource`（`registry` 已按声明复算一致 / `computed` 仅自算）。无平台摘要的新增依赖缺 `dist.integrity` 即执行失败，不自算冒验证；所选组件缺 integrity 仍按平台 SHA。
5. **实收 SHA 先行（`registry.ts`）**：下载后先算实收 bytes SHA-256 并与平台摘要比对，不符即交回实算摘要由调用方形成 `PACKAGE_DIGEST_MISMATCH`（合法 conflicted）；相符或未给平台摘要时才核对 `dist.shasum`/`dist.integrity`。既有两个反例（平台声称另一 SHA + 正常 bytes；新增依赖坏 integrity）行为不变。
6. **失败矩阵单一 JSON stdout（`commands/integrate.ts`）**：失败路径统一 exit 1 + 单一 JSON stdout `{status:'error',error:{code,message}}` + stderr 诊断（参数类附 usage）；命令本地 `IntegrateCommandError` 提供稳定 code：`INVALID_ARGUMENTS`/`INVALID_MATCH_PLAN`/透传 `IntegrationPlanError.code`/`EXECUTION_FAILED`；参数与 MatchPlan 错误在发任何请求前返回。
7. **远端诊断脱敏（`registry.ts` + `plan.ts`）**：不支持的 integrity 算法改用固定文案；registry 全部诊断改为不含 `name@version` 等远端可控值的固定文案；远端 gap 只保留稳定 code；`--match` 读取/解析失败不回显底层异常原文。`sourceMatchPlan` 与 `matchPlanDigest` 约束未放宽。

## B 沙箱预检（非正式）

`tsc -p tsconfig.t15plan.json`（四个产品文件 + 两个 plan 测试的传递闭包，`strict` + `noUncheckedIndexedAccess`）exit 0。vitest 5.1.0：`project-plan.test.ts` **20/20**、`project-plan-network.test.ts` **29/29**、`project-inspect.test.ts` **90 passed | 3 failed (93)**（3 项为沙箱 Git 2.34.1 缺 `--no-lazy-fetch` 的已知限制，对应文件与宿主 GREEN 版逐字节一致）。`tests/contracts/integration-plan.test.ts` 通过。真实 CLI 子进程冒烟 13 项：10 项失败路径全部 exit 1 + 单一 JSON stdout（code 分别为 `INVALID_ARGUMENTS`/`INVALID_MATCH_PLAN`/`REGISTRY_UNAVAILABLE`/`INVALID_ENDPOINT`）+ 非空 stderr，`inspect` exit 0 + 单一 JSON，`--help` exit 0。**不代表宿主固定工具链，未宣称任何正式通过；B 在此停写**，等宿主完整三组 P1、CLI build/typecheck、根 tsc 与独立 D 验收。

## 本轮文件摘要（SHA-256；括号内为宿主正式 RED 时的值）

```
8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB  packages/component-cli/src/integration/inspect.ts    （未改）
5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576  packages/component-cli/src/integration/workspace.ts  （未改）
8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46  packages/component-cli/src/integration/locks.ts      （未改）
BA12B90B5C9BB780FA1DDAC4776CC7A5904AB54AE8EDBE15D13E209C23DA3155  packages/component-cli/src/integration/resolve.ts    （① ⑦；原 572F0C061B33…00CD3F）
E43D40390DE185B99D2D674E17510FBFD4777DB5C271F244433296AEB262E245  packages/component-cli/src/integration/registry.ts   （④ ⑤ ⑦；原 C9C5E296E33F…6CF43）
DB12F715085576B87C973C7C54F9A0696005B4BE1D93B2E4C0030A9E4A2057A9  packages/component-cli/src/integration/plan.ts       （① ② ③ ⑦；原 C68CF23DE94B…7EEE）
882123BF72D31FAE59AB4054E0327533BC68A8DB4EC8178BDC4152FCEF984EB0  packages/component-cli/src/commands/integrate.ts      （⑥ ⑦；原 C03638208A09…4BC949）
9551DC19379543F6C14321A5057AAD9A2447930B202D8344119E0F24E6D2A167  packages/component-cli/src/cli.ts                    （未改）
4D0E4FBFB1809908F81DAD9A9A262EFDF428D7E98D67A60077347E0245A0CA46  packages/component-cli/src/index.ts                  （未改）
AAE56CE74A74599D86AF2138FCE15591DDF9FA50A5928337FD49587479C76C27  tests/integration/project-inspect.test.ts           （未改，93 项）
C6887A7F6CB62F152EB29F3125F856185BA947AEA6F8860445AAEA32B154C798  tests/integration/project-plan.test.ts              （未改，20 项）
EF51E0C924A82177A79C3C15E8A0F52297E2F03A0691302516ED309454CF1736  tests/integration/project-plan-network.test.ts      （未改，29 项）
```

三个测试文件 SHA 与宿主正式 RED 时逐字节一致，即本批 GREEN 未改动、未删除、未弱化任何既有断言。

## 仍未覆盖（不宣称完成）

CLI 失败 envelope 只有沙箱子进程冒烟，**没有已提交测试覆盖**；`realPathOf` 在 Windows junction / 大小写不敏感 / 8.3 短名下的行为未在宿主实测（沙箱仅验证 Linux 目录符号链接）；未跑真实 Nest/PG/MinIO/Verdaccio 联调，也未安装已打包 CLI 做仓外验证。`redirect: 'manual'` 拒绝 3xx 的两条运行时形态（`opaqueredirect` 与直接回显 302）都已覆盖，宿主 Node 26.13.0 由「跨 origin 重定向」用例正式确认。

# 二十一、D35 独立黑盒真实 RED → 最小产品 GREEN（宿主 P1 142/142 已确认；停写 dirty-target-green-ready）

宿主固定工具链正式执行 P1 完整三组：**142/142 passed、0 skipped、exit 0（31.01s）**，CLI build/typecheck 与根 tsc 均 exit 0，12 个文件 SHA 前后稳定；已代 B 提交 `c5ca0e4962a3b803b8653e75c2b243c1de279ef9` 并按 A→B→D 合入 C 集成树，源 bytes 不变。随后 C 在集成树执行 D 的原始 35 项黑盒：**34 passed / 1 failed / 0 skipped**。

**唯一失败**：`tests/integration/project-plan-readonly.test.ts`「an existing target component file is reported as an OUTPUT_EXISTS conflict without overwriting it」。用例在**已 commit** 的 synthetic 项目中创建未跟踪的 `src/components/zhinexus/component-0001.vue`，预期 exit 2 + conflicted + `OUTPUT_EXISTS` 且保留用户 bytes；实际 exit 1 `INVALID_SCHEMA`，运行时报 `Missing blocking DIRTY_TARGET conflict`。

**根因**：`resolve.ts` 只为 manifest/lock 计算 `DIRTY_TARGET`，而 `plan.ts` 把拟生成组件也列入 `allowedPaths`；公共契约 `contracts/integration-plan.ts` 对任一 allowedPath 与 `inspection.git.dirtyPaths` 的 NFC/大小写不敏感键相交都要求同路径 `DIRTY_TARGET`。P1 原有「输出已存在」用例没有 Git 前提，故未暴露。

**最小修复（只改 `plan.ts`）**：在最终 allowedPaths 形成之后、组装 `baseFileHashes` 之前，按与契约完全相同的键为所有相交的 allowedPath 补同路径 `DIRTY_TARGET`（措辞与 `resolveLocalPlan` 既有记录逐字一致，重复自动去重）。保留 `OUTPUT_EXISTS` 与全部其他冲突、保留 allowedPaths 中的拟生成组件；未改 D 测试/fixtures、公共 contracts、冻结 inspection 三源、根配置/锁/版本，未改 P1 原 142 测试（三个测试文件 SHA 与宿主 142/142 GREEN 时逐字节一致）。

**自检（沙箱，非正式）**：`tsc -p tsconfig.t15plan.json` exit 0；三组复跑 139 passed | 3 failed (142)（3 项均为沙箱 Git 2.34.1 缺 `--no-lazy-fetch` 的已知限制，与本轮无关）；D35 场景复现（临时用例，未入仓库）得到 conflicted + `OUTPUT_EXISTS` + 同路径 `DIRTY_TARGET` + `validateIntegrationPlan` 通过 + 用户 bytes 保留；**RED 证明**：仅移除新增代码块后同一用例抛 `IntegrationPlanError(INVALID_SCHEMA)` 且 issue 恰为 `/conflicts Missing blocking DIRTY_TARGET conflict`，与 D35 观察逐字一致；真实 CLI 子进程得到 exit 2 + stdout 仅 JSON + stderr 空，失败矩阵与网络/endpoint 共 13 项仍全部 exit 1 + 单一 JSON。**不代表宿主固定工具链，未宣称任何正式通过。**

## 本轮文件摘要（SHA-256）

```
098518193D3CEC1AF0E78850E8BF7243D363567ED0C339CFD14EA770911B3CDD  packages/component-cli/src/integration/plan.ts   （本轮唯一改动；宿主 142/142 GREEN 时为 DB12F7150855…2057A9）
8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB  packages/component-cli/src/integration/inspect.ts    （未改）
5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576  packages/component-cli/src/integration/workspace.ts  （未改）
8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46  packages/component-cli/src/integration/locks.ts      （未改）
BA12B90B5C9BB780FA1DDAC4776CC7A5904AB54AE8EDBE15D13E209C23DA3155  packages/component-cli/src/integration/resolve.ts    （未改）
E43D40390DE185B99D2D674E17510FBFD4777DB5C271F244433296AEB262E245  packages/component-cli/src/integration/registry.ts   （未改）
882123BF72D31FAE59AB4054E0327533BC68A8DB4EC8178BDC4152FCEF984EB0  packages/component-cli/src/commands/integrate.ts      （未改）
9551DC19379543F6C14321A5057AAD9A2447930B202D8344119E0F24E6D2A167  packages/component-cli/src/cli.ts                    （未改）
4D0E4FBFB1809908F81DAD9A9A262EFDF428D7E98D67A60077347E0245A0CA46  packages/component-cli/src/index.ts                  （未改）
AAE56CE74A74599D86AF2138FCE15591DDF9FA50A5928337FD49587479C76C27  tests/integration/project-inspect.test.ts           （未改，93 项）
C6887A7F6CB62F152EB29F3125F856185BA947AEA6F8860445AAEA32B154C798  tests/integration/project-plan.test.ts              （未改，20 项）
EF51E0C924A82177A79C3C15E8A0F52297E2F03A0691302516ED309454CF1736  tests/integration/project-plan-network.test.ts      （未改，29 项）
```

**仍未覆盖**：D35 该场景没有已提交测试覆盖（D 黑盒在集成树执行，P1 原 142 未含带 Git 前提的 OUTPUT_EXISTS 用例），是否补 B 侧回归由 C 决定；`DIRTY_TARGET` 现对 manifest/lock 与拟生成组件统一按相同键计算，未来若 allowedPaths 增加新类别需保持同一收口；Windows junction/大小写/8.3、真实服务联调、仓外已打包 CLI 验证仍未覆盖。

## 宿主 C 正式 GREEN（2026-11-17 16:30:57–16:31:31 +08:00，追加）

B 已停在 plan-review-green-ready，C 在本 B 独立工作树使用固定 Node 26.13.0 / pnpm 12.18.0 执行完整三组 P1：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts --reporter=default --reporter=json --outputFile=.superpowers/t15/host-plan-green-2026-11-17-1629-results.json
.\scripts\pnpm.ps1 --filter @company/component-cli build
.\scripts\pnpm.ps1 --filter @company/component-cli typecheck
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

结果：**142/142 passed、0 failed、0 skipped、exit 0**，31.01s；CLI build/typecheck、根 TypeScript 全部 **exit 0**。12 个产品/测试源 SHA 前后一致，三个测试文件与正式 RED 时逐字节相同，原124和新增18项断言保留。Windows junction 真实创建/指向控制与跨origin重定向等用例均实际通过；8.3 别名等未由这些用例覆盖的边界仍不宣称。本次 CLI 构建的包内探针73个文件白名单检查通过：缺失/污染/链接/被改动均为0。

日志为 `.superpowers/t15/host-plan-green-2026-11-17-1629*`。C 将代 B 聚焦提交当前产品与测试；此通过仅满足P1当前测试/构建门槛，D35独立进程、C25唯一冻结新CLI与真实服务、最终全图和main收口仍待完成。不pack、不升版、不push或提前标T15完成。

# 二十二、最终整分支审查五项 + ④ 两跳窄复审：真实 RED → 最小产品 GREEN（停写 final-five-green-ready）

C 在最终整分支审查中提出五个候选残余，B **先只写回归测试、不改产品**，宿主两轮正式 RED 都成立后才做最小 GREEN。第一轮（`.superpowers/t15/host-final-five-red-*`，21:21:42 起 38.51s）完整 P1 147 项：新增 5 项全部预期行为 RED、原 142 全 GREEN、0 skipped、exit 1，根 tsc exit 0，12 个源/测试 SHA 前后一致。第二轮（`.superpowers/t15/host-two-hop-red-*`，21:40:40 起 36.69s）B 为 ④ 补了两跳 dangling 回归后完整 P1 148 项：147 passed / 1 failed / 0 skipped、exit 1，唯一失败就是两跳 dangling 实际 `planned` 未 `PATH_UNSAFE`；原五项与 142 旧项都 GREEN，12 个 SHA 前后一致。

五项缺陷与最小修复（**只改 `plan.ts` 与 `resolve.ts`**，未动公共 contracts、冻结 inspection 三源、registry/commands/cli/index、A/D、版本/锁/根配置/pack）：

1. **同包两 variant 的 registry 证据重复**：两个不同 `variantReleaseId`/逻辑组件（line/bar）共享同一包名+版本+摘要时，`plan.ts` ⑨ 按 finalReads 逐 variant push `registryEvidence`，触发契约 `unique(/registryEvidence)` 的 `Duplicate or aliased entries` 而 `INVALID_SCHEMA`（exit 1）。修复：按 `name@version` 去重（同一包只留一条平台摘要证据），**两个组件的 `publicationEvidence` 仍各自保留**，tarball 仍只读一次。
2. **matched 响应的 gap 消息泄漏凭据**：matched + 兼容未验证的 `gaps[].message` 是远端可控文本，`publicationEvidence.response` 原样保存会把它带进计划 JSON 与 CLI stdout。修复：新增 `sanitizePublicationResponse`，只保留稳定 code、message 换成固定措辞 `权威响应返回 gap：<code>`；target/api/依赖等其余证据原样保留，不删空证据、不丢 gap code，顶层冲突文案原本就已固定。
3. **权威依赖与本地锁版本冲突**：本地已锁 `@company/charts-core@0.0.10` 而权威 GET `exactDependencies` 要求 `0.0.12`，此前未比较本地锁，`validateIntegrationPlan` 以 `New exact dependencies require registry verification` + `Plan must not silently upgrade locked dependencies` 抛 `INVALID_SCHEMA`（exit 1）。修复：记 `DEPENDENCY_CONFLICT` 结构化冲突（exit 2），不把冲突版本写进 `exactDependencies`、不为它下载材料、不声称 registry 证据，用户文件与已有锁版本原样保留。
4. **dangling 链接未失败关闭**：`realPathOf` 原先把 ENOENT 当普通缺段拼回，`src` 指向项目外不存在目录时实际 `planned`；B 第一版改成单跳 readlink 后，C 窄复核指出两跳形态（`src → 项目内 bridge/future`、`bridge → 项目外不存在目录`，词法在根内、物理逃逸）仍会被放行。最终修复：`realPathOf` 返回 `{ok:true, real}` / `{ok:false}`（新导出 `RealPathResolution`），遇到链接沿声明**继续解析**（可多跳，64 跳上限并对链接路径去重），链接环/过深/始终无法解析 → `ok:false`；`resolveGeneratedPaths` 对 `ok:false` 与“解析出但在项目外”都记 `PATH_UNSAFE`（措辞区分），`snapshotOf` 对两者都不读取、不记录摘要。**不把未解析的链接声明当作已解析真实落点。**
5. **省略 `context.echartsVersion` 发空版本**：合法 MatchPlan 可省略该字段（`project-context.ts` 列为可选），但本地已锁 ECharts 6.1.0 时 GET 发 `echartsVersion=` 空值。修复：`matchQuery` 增加 `lockedEcharts`，省略时用本地 inspected lock 已锁的精确版本形成真实查询；`resolveLocalPlan` 在这种不一致时记 `MATCH_CONTEXT_MISMATCH`（公共 IntegrationPlan 契约强制），`sourceMatchPlan` 与 `matchPlanDigest` 原样保留，输出合法 `conflicted` 而不伪造 planned。

**新增 6 条回归**（`project-plan.test.ts` 20 → 22，`project-plan-network.test.ts` 29 → 33，合计 142 → 148）：源 MatchPlan 与权威响应均以冻结 validators 先验断言合法，目标全树只读，真实 loopback + 实算 bytes/integrity；② 与 ③ 额外走**完整 CLI**（stdout/stderr 都不含两类令牌、exit 2），并在 CLI 调用之后再比对一次 `treeSnapshot`；④ 两条都带真实 dangling 控制断言（lstat 是链接、realpath ENOENT、目标不存在），两跳那条还断言 `src` 声明目标词法落在项目内。

**B 沙箱预检（非正式）**：`tsc -p tsconfig.t15plan.json` exit 0；三组复跑 **148 项 → 145 passed | 3 failed | 0 skipped**，3 项均为沙箱 Git 2.34.1 缺 `--no-lazy-fetch` 的已知限制（与本轮无关）。失败关闭专项（临时用例，未入仓库）：两跳 dangling → `conflicted` + `PATH_UNSAFE`（`拟生成路径的 realpath 逃逸出项目根`）、项目外目录未创建；链接环 `src ↔ loop-a` → `conflicted` + `PATH_UNSAFE`（`拟生成路径的真实落点无法证明在项目内`）、无挂起；单跳 dangling → `conflicted` + `PATH_UNSAFE`。真实 CLI 子进程端到端（沙箱 `/tmp` 独立构建 + 双 loopback，`spawn` 异步等待；同步 `spawnSync` 会阻塞父进程事件循环导致 loopback 拒连，属夹具问题）：基线 exit 0 planned；① exit 0 planned 且 registryEvidence=1 / publicationEvidence=2；③ exit 2 `DEPENDENCY_CONFLICT`；⑤ exit 2 `MATCH_CONTEXT_MISMATCH` 且所有 GET 的 `echartsVersion` 均为 6.1.0；④ 单跳与两跳都 exit 2 `PATH_UNSAFE`；② exit 2 `COMPATIBILITY_UNVERIFIED` 且 stdout/stderr 无两类令牌；全部场景 stdout 均为单一 JSON、stderr 无诊断、目标项目文件零改动。**以上均为沙箱非正式证据，未宣称任何正式通过。**

本轮文件摘要（SHA-256；括号内为本轮开始前的值）：

```
810FA7AFDFFB7866EFCB713EC958B0B197BCE35C7DE23C356C2E2DCCFE9BFFA4  packages/component-cli/src/integration/resolve.ts    （本轮改动；原 BA12B90B…3155）
2CB671EFC6A78D3003B267DD4885F6A857C9BD7304D220A1823065FE63B61C20  packages/component-cli/src/integration/plan.ts       （本轮改动；原 09851819…3CDD）
6B89371FE08B2CD7523D41A5753F37BA7F5D0BC1CCF1DAA6C45BE78198D3200F  tests/integration/project-plan.test.ts              （本轮改动，22 项；原 C6887A7F…4798）
385D60126FA6EFD831147B257F1F288BA5D0542BA4513EB29DDBAAB0534E1B65  tests/integration/project-plan-network.test.ts      （本轮改动，33 项；原 EF51E0C9…1736）
```

其余 8 个源文件与 `project-inspect.test.ts` SHA 与上一轮逐字节一致（inspect/workspace/locks 冻结三源、registry、commands/integrate、cli、index）。本轮自建的两个临时探针文件已由 C 在宿主安全移动到 `.superpowers/t15/probes/`（git 忽略目录）并核对 SHA，`tests/` 下已无它们；B 未申请任何删除授权。

**仍未覆盖**：Windows 真实 junction 的多跳/大小写不敏感/8.3 短名与链接环仍只由宿主实测（沙箱仅验证 Linux 目录符号链接）；`realPathOf` 的 64 跳上限是对 POSIX ELOOP 的工程折中，更深但仍有限的合法链接链会被保守地失败关闭为 `PATH_UNSAFE`；`publicationEvidence` 的 target/api 自由文本字段（`notes`）未做脱敏（本轮只按候选 ② 的范围处理 gap 消息）；⑤ 的 `MATCH_CONTEXT_MISMATCH` 现由 `resolveLocalPlan` 记录，若未来契约放宽“省略即合法”需同步调整该处与测试。

**停写**：final-five-green-ready。等待宿主 C 正式复跑完整 148 + D35 黑盒 + CLI build/typecheck + 根 tsc，通过后由 C 代 B 提交，再集成 D35、升新 CLI 冻结最终门禁。B 不 commit/merge、不 bump/pack、不 push，不继续探索其他配置或扩大范围。

# 二十三、宿主 C 最终正式 GREEN（2026-11-17 21:46:58–21:47:35 +08:00，追加）

C 在本 B 独立工作树使用固定工具链（Node 26.13.0 / pnpm 12.18.0 / Git 2.48.1）执行完整 P1 三组与全部构建门槛，日志为 `.superpowers/t15/host-final-green-*`：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts tests/integration/project-plan.test.ts tests/integration/project-plan-network.test.ts --reporter=default --reporter=json --outputFile=.superpowers/t15/host-final-green-results.json
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
.\scripts\pnpm.ps1 --filter @company/component-cli run build
.\scripts\pnpm.ps1 --filter @company/component-cli run typecheck
```

结果：**148/148 passed、0 failed、0 skipped、exit 0（37.01s）**；根 TypeScript、CLI build 与 CLI typecheck 均 **exit 0**；12 个产品/测试源 SHA 前后相同（`resolve.ts` = `810FA7AF…BFFA4`、`plan.ts` = `2CB671EF…1C20`、两个 P1 测试与上一轮 RED 时逐字节相同，其余 8 个文件未变）。这组证据覆盖本轮全部 6 条新回归（同包两 variant、matched 脱敏、锁版本冲突、单跳与两跳 dangling、省略 ECharts 版本）与原 142 项断言。

状态仍为 **final-five-green-ready**：本轮产品与测试字节即刻冻结，B 不再做任何探索或范围调整，不 commit/bump/pack/merge/push。后续由 C 代 B 聚焦提交并合入 C 集成工作树、执行完整 148 + D35 独立黑盒、升新 CLI 版本冻结最终门禁，再按用户授权回 main 删分支。
