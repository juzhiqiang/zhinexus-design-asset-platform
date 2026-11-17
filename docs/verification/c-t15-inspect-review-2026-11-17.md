# C / T15 项目识别候选审查与 Git 实验

日期：2026-11-17。C 集成分支 `chore/t15-c-integration`；B 产品工作树 `C:/Users/10208/.codex/worktrees/t15-b-integration-plan/zhinexus-design-asset-platform`。本记录追加候选审查事实，不改写已完成契约、矩阵或验收准备的历史验证。

## 宿主初次 GREEN

C 在 B 停写交付 `inspect-green-ready` 后使用固定 Node 26.13.0 / pnpm 12.18.0 执行：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts
.\scripts\pnpm.ps1 --filter @company/component-cli build
.\scripts\pnpm.ps1 --filter @company/component-cli typecheck
.\scripts\pnpm.ps1 exec turbo run build typecheck --force
```

项目识别 **20/20 通过、0 跳过、exit 0**；CLI build/typecheck **exit 0**；全图 build/typecheck **20/20 成功、0 cached、exit 0**。日志位于 B 工作树 `.superpowers/t15/host-inspect-{green,build,typecheck,graph}-2026-11-17.log`。这些结果只覆盖当时测试，不能推断后续审查反例也通过。

## 独立只读审查

沿用 requesting-code-review 技能的独立审查代理检查 B 新增 workspace/locks/inspect 和测试；没有替代负责产品开发的实际 Claude 桌面客户端，也没有修改产品文件。确认以下候选必须补 RED→GREEN，暂不提交为已验收 inspect：

- 已标记 `pnpm-workspace.yaml` 外链逃逸后仍读取解析根外文件。
- npm 目标 importer 缺少依赖声明，仍借用根 node_modules 提升版本形成 `inspected`。
- 多份 pnpm packages 声明选首项，npm 非字符串 workspace 条目被丢弃。
- 只检查 npm/pnpm 锁，遗漏同目录 Yarn/Bun 锁并存。
- 非法 `^not-a-version` 约束因 `validRange === null` 跳过验证。
- Git porcelain 路径相对仓库根，嵌套项目根的 dirty 路径基准错误并混入项目外文件。

前五项由具体输入及代码路径静态确认；Git 嵌套路径另有以下实际实验。七类（含下节过滤器）的反例均已通过实际客户端交接，B 先补失败测试，C 执行固定工具链，随后交 B 修复；当前不声称反例 GREEN。

## Git clean/process filter 实验

独立代理仅在自有系统临时 synthetic 仓库中实验。实测 Node **26.13.0**、Git **2.48.1.windows.1**。与当时 B 完全相同的命令为：

```text
git --no-pager -c core.fsmonitor=false -c core.untrackedCache=false -c core.quotePath=false -c diff.external= -c diff.textconv= --no-optional-locks status --porcelain --untracked-files=all
```

clean/process 两种 filter 都先以 `git add` 建立 **exit 0 且 marker 出现**的控制正例，再删除 marker、对 tracked payload 做 10 字节等长内容修改并修改 mtime。上述 status 两次均 **exit 0**，输出 ` M payload.txt`，stderr 为空，且再次执行用户过滤器：clean marker 为 `clean-invoked`；process marker 包含 `process-start` 和 `command=clean pathname=payload.txt`。因此仅禁用 fsmonitor、外部 diff/textconv 和 optional locks 不满足零用户脚本执行要求。

嵌套 Git 实验从 `apps/client` 执行同命令，**exit 0**，输出 ` M apps/client/package.json` 和项目外 ` M outside.txt`，确认 dirty 路径必须限定并转换到本次项目根。

独立原报告在 `C:/Users/10208/AppData/Local/Temp/t15-review-git-filter-c907c70d255c4df1869fa7e7392a8388/independent-review-report.md`。完整实际命令、环境与输出副本保存于 C ledger `.superpowers/sdd/2026-11-16-phase3-t15-kickoff/independent-git-filter-experiment-2026-11-17.json`；这些文件仅含自有 synthetic 实验信息。未改真实业务工作区、SDK 冻结产物或 B 源码。

## 矩阵规格对齐

A 的缺 ECharts 案例原预期仅因缺项 `conflicted/ECHARTS_MISSING`；批准 spec“首轮支持与行为”第 5 条允许采用 MatchPlan 明确候选进入只读 plan，P0 inspection 不要求已解析 ECharts。因此该案例的本地识别应保持无伪造 ECharts 版本的 `inspected`，最终 plan 必须以候选精确版本重新查询。C 已交实际 Antigravity 客户端独立确认并补测试与独立验证记录；不以 B 输出计算预期，不修改历史矩阵报告。

## 当前门槛

### 独立矩阵初次消费观察

C 用固定工具链 `exec tsx .superpowers/sdd/2026-11-16-phase3-t15-kickoff/observe-matrix.ts` 在系统临时目录生成 A 的全部 14 案例，调用 B 已构建的 inspect 模块，保存实际结果于同目录 `matrix-observe-2026-11-17.log`。该观察没有断言成功，也不是已安装 CLI 验收。发现两项需要补充：

- A 实际 pnpm 12.18.0 快照有两份 **均带 lockfileVersion/importers** 的 v9 文档；第一份 importer 只含 configDependencies/packageManagerDependencies，第二份为项目依赖。B 将所有带 lockfileVersion/importers 文档当成项目锁而拒绝，导致四个正常 pnpm 案例及框架歧义案例均 `LOCKFILE_INVALID`。必须用真实锁快照补 RED，严格区分工具链文档与唯一项目依赖文档，拒绝多个项目依赖文档，不能删除或重写真实锁。
- A 的 `conflict-missing-importer` 生成目标为 `apps/missing-pkg`，但该目录没有清单，只有 `apps/chart-react`。实际结果为 `WORKSPACE_INVALID`，尚未到 importer 校验。应保持锁快照原字节并生成实际存在的目标子包，独立验证该 importer 不存在；交 A 负责修正，不迁就 B 产品输出。

14 案例的公开已安装 CLI 消费已加入 C P4 专项，首次旧 CLI 实际补跑为 25/25 行为 RED、0 跳过、exit 1，见 `c-t15-plan-integration-2026-11-17.md` 新增记录。冲突结果允许契约中的信息缺失字段不输出；任何已输出字段和完整精确依赖、Git/脚本/冲突/文件摘要仍与独立预期比对。

D RED 准备提交 `92ab7ccf` 已完成，31/31 行为 RED、0 跳过，全图 20/20 和根 TypeScript 通过。P1、P3 GREEN、P4 新安装 CLI GREEN 和完整 T15 验收仍待完成；此记录不提前升级版本、不合 main、不 push。

## 全树快照审查修复（追加）

只读审查代理发现普通对象以文件相对路径作为键时，根文件 `__proto__` 的摘要赋值会被原型 setter 忽略。C 将现有快照逻辑提取至 `tests/fixtures/phase3-project-snapshot.ts`，新增真实临时文件的新增、修改、删除反例。固定工具链执行 `exec vitest run tests/integration/phase3-project-snapshot.test.ts`：旧逻辑 **1/1 RED、0 跳过、exit 1**，实际读取文件后键集合仍为空；改为无原型对象后 **1/1 GREEN、0 跳过、exit 0**。根 `exec tsc --noEmit` **exit 0**。日志为 C ledger `snapshot-review-{red,green,typecheck}-2026-11-17.log`。这一修复只加强验收快照，不表示 CLI 产品已通过验收。

## Git 执行与路径边界最后一轮（追加）

B 在实际 Claude 桌面端补充合法下划线 filter driver、配置枚举失败/截断、真实 staged rename、NUL 输出与截断反例。C 校正测试中的不合法路径和 spy 复位后，固定工具链正式 RED 为 **6 failed / 42 passed / 0 skipped、exit 1**；失败来自实际行为断言。测试源运行前后 SHA 一致，日志 `host-inspect-final-review-red-2026-11-17.log`。

B 修复为 `git config -z --get-regexp` 枚举并在失败时停止 status，以 `--porcelain -z` 解析完整路径、同时保留 rename 源与目标，再限定到本次项目根；不可解析的输出整体为 unavailable。截断测试按 C 要求收紧为精确 `{status:'unavailable',dirtyPaths:[]}`，其余 47 项语义保持。

2026-11-17 10:56（Asia/Shanghai），C 在 B 停写交付 `inspect-final-review-green-ready` 后实际执行：

```powershell
.\scripts\pnpm.ps1 exec vitest run tests/integration/project-inspect.test.ts
.\scripts\pnpm.ps1 --filter @company/component-cli build
.\scripts\pnpm.ps1 --filter @company/component-cli typecheck
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')
```

测试 **48/48 passed、0 skipped、exit 0**，8.77 秒；CLI build/typecheck 与根 TypeScript 均 **exit 0**。日志位于 B `.superpowers/t15/host-inspect-final-review-{green,build,typecheck,root-tsc}-2026-11-17.log`。实际测试 SHA 为 `C26515925D78A10ACC5F5EDD6A2952BF8ED559BD3F93A8DB0BBDC2F396851A15`，inspect 源 SHA 为 `418F796DA1253F45872F9AC5FD17AA3E7409E455C54EA916973BF968B7A3088A`，与 B 交付一致。

独立只读数据复审又发现六项 Important，C 核实源码后交实际 B 客户端先补 RED：原生 workspace 声明按实际包管理器选择；pnpm 多文档中错误类型 packages 不得跳过；项目锁版本头缺失/错误类型不得接受；pnpm importer 缺失/非字符串 specifier 不得绕过一致性检查；manifest 依赖、脚本、packageManager 错误类型不得被静默丢弃；npm 近层 link 遮蔽不能借用根提升版本。具体交接保存在 B 已授权目录 `.superpowers/t15/c-inspect-data-review-2026-11-17.md`。

因此上述 48 项 GREEN 只关闭本轮 Git 反例，不表示 inspection 或 T15 全部完成。六项数据边界 RED→GREEN、plan 产品、D 黑盒、新冻结 CLI 真实验收仍待执行。未改 P0、冻结 SDK、真实锁快照或原架构；原架构 SHA 再次核对一致。

## 数据边界 RED 与变换型 filter 实验（追加）

B 追加 14 项数据反例与正例守卫后，C 于 2026-11-17 11:08 实际运行相同 inspection 测试命令：**12 failed / 50 passed / 0 skipped、exit 1**，8.49 秒。所有失败来自新增行为断言，没有收集/环境失败；根 TypeScript **exit 0**。测试前后 SHA 均为 `53A475FC0DA17D35F68C40CA899F91E5C69F245C20B55539AFFFE256556676FA`。日志为 B `host-inspect-data-review-{red,root-tsc}-2026-11-17.log`；实际 Claude 桌面端已收到 RED 证据继续 GREEN。

独立审查进一步核实变换型 filter 会导致漏报：自有 synthetic clean helper 将 a→b、b→c；初次 add 存储 b，用户再改工作文件为 b。有效 package.json 的 version 1→2→3 构造同样成立。固定 Node 26.13.0 / pnpm 12.18.0 / Git 2.48.1.windows.1 下，两项原生 status 均 **exit 0、报 dirty 且 marker 出现**；置空 filter 后均 **exit 0、stdout 空且无 marker**。B 当时已构建 inspection 模块实际返回 inspected、git clean、空 dirtyPaths，项目全树含 .git 字节保持不变。旧 CLI bin 尚未接线，不能将模块观察写成 CLI 黑盒结果。

同一清理环境和禁执行配置下，`ls-files -z` 与 `check-attr -z filter --stdin` 四项只读控制（两项目分别启用/屏蔽 filter）均 **exit 0、零 marker、全树字节一致**，准确识别关联文件，其余 tracked 文件为 unspecified。可在保持 P0 结构的前提下，将实际关联用户 filter 的 tracked 路径保守并入 dirtyPaths，让后续 plan 对拟改的关联路径产生现有 DIRTY_TARGET；未修改、透传或幂等的关联文件可能多报，需明确此边界。解析或枚举不可信则 unavailable，不能伪称 clean。

原始实证分别为 C ledger `independent-filter-falseclean-2026-11-17.json`（SHA `1627a6c08c8bcd518b12b1472743632bbe6eef58292d8e6300ff57ea40c9b9fd`）与 `independent-filter-readonly-attributes-2026-11-17.json`（SHA `a3ad3bf913a22fd7461d664a1fa41c646f3f0574b3fccf8476ab233f25b6ab00`）。副本已放 B 授权目录，后续由实际 B 补行为 RED→GREEN；本次只是独立实验，不表示产品已修复。

## 数据修复正式 GREEN（追加）

B 修正两份 specifier 反例的前置锁夹具，补合法版本头以避免版本校验遮挡 specifier 缺陷，原断言未削弱；另外增加第 63 项原生 pnpm workspace 缺声明守卫。C 在构建覆盖前，以 Vitest 临时 alias 将同一修正后的测试指向当时仍保留的修复前 inspection 编译模块，未修改 B 源码或测试，也未回滚任何工作区：实际 **13 failed / 50 passed / 0 skipped、exit 1**，9.68 秒。旧模块 SHA 运行前后同为 `8e633b498b692c64516bac741a0fbab61e8c6562ac038c6edeb6c95be536af6f`，日志 `host-inspect-data-corrected-prebuild-red-2026-11-17.log`；第 63 项失败为旧实现产生缺快照的非法 inspection，另 12 项为行为断言失败。该临时 alias 仅用于历史 RED 重放，随后构建已覆盖 dist，后加摘要守卫防止误用新模块重放。

2026-11-17 11:25，C 对 B 停写交付的新源码运行 inspection 测试、CLI build/typecheck 与根 TypeScript：**63/63 passed、0 skipped、exit 0**，9.28 秒；三项构建/类型命令均 **exit 0**。B 日志 `host-inspect-data-review-{green,build,typecheck,root-tsc-green}-2026-11-17.log`。测试 SHA `BB9A8FD62ACE38AF7F72D00E59BADBC1AFF96861923AB8A910D5E1E7C8643324`、inspect SHA `EEE0E9EAB46C997861DD09F5EC9ED16C0B442AAEEB8B10995BF418D62A11E729` 与交付一致；workspace/locks 原始文件和真实工具锁快照未被 C 改写。

六项数据反例已通过本轮验证；第七项变换 filter 漏报已交实际 B 客户端按同一只读边界先补测试。inspection 聚焦提交、plan、独立黑盒及最终新 CLI 已安装验收仍待后续，不能以当前 GREEN 标 T15 完成。

## 变换 filter 正式 RED 与 npm 近层残余（追加）

B 仅追加两个变换型 clean filter 反例，保持三个实现文件与上一轮 GREEN 的摘要不变。C 于 2026-11-17 11:37 实际执行 `exec vitest run tests/integration/project-inspect.test.ts`：**2 failed / 63 passed / 0 skipped、exit 1**，10.96 秒。两个失败均为当前返回 clean、预期 dirty 的行为断言；helper 零执行及全树含 `.git` 字节不变的控制断言通过。测试前后 SHA 均为 `6E955229652FE5721ACF03916A62F95F809A6013793F64A1395DF4FC19E307B9`，inspect 源前后 SHA 均为 `EEE0E9EAB46C997861DD09F5EC9ED16C0B442AAEEB8B10995BF418D62A11E729`。日志位于 B `.superpowers/t15/host-inspect-filter-semantics-red-2026-11-17.log`。

独立只读复审又确认原第六类 npm 近层记录的两条残余路径：无 `link:true` 的近层记录仍沿 `resolved` 采信任意旁边包的版本；显式 null 近层记录被当缺失后借用根提升版本。这是具体源码路径审查，不是 installed CLI 实验。反例与边界已写入 B 已授权目录 `.superpowers/t15/c-npm-near-record-review-2026-11-17.md`，实际 Claude 桌面端 B 已收到先追加测试、取得正式 RED 后一起 GREEN 的交接。

实际 D Claude Code 同一会话已收到独立黑盒补充请求：分别在 Vue/pnpm、React/npm 中使用变换清单 filter，验证 inspect 精确 dirtyPaths、plan 的 blocking DIRTY_TARGET、零 helper 执行及全树不变。请求只让 D 产出测试代码，由 C 保存、审查和运行；此刻尚无补充代码或验证结果，不能记录为已通过。P1 产品继续由实际 B 开发；无版本升级、SDK 重打包、合 main 或 push。

## 近层残余 RED、77 项 GREEN 与关联边界复审（追加）

B 追加两条 npm 近层记录反例及一条合法 link 守卫后，C 于 2026-11-17 11:43 实际运行同一 inspection 命令：**4 failed / 64 passed / 0 skipped、exit 1**，11.10 秒。两条 npm 记录为 inspected 应为 conflicted，两条 filter 为 clean 应为 dirty；合法 link 守卫通过，无 setup 失败。测试 SHA 前后一致 `0D567462FE62A2E7D13D88DAD9FB17D54986250BA4FAF9C58B8B4C5368DF607E`，源摘要仍为上轮实现。日志 `host-inspect-near-record-red-2026-11-17.log`。

B 修复两类行为并追加九条只读属性枚举边界测试后，C 于 11:54 运行 inspection、CLI build/typecheck 与根 TypeScript：**77/77 passed、0 skipped、exit 0**，17.17 秒；三项构建/类型命令均 **exit 0**。测试前后 SHA 同为 `18A4F0DC7E8132A861CFDB458FF6AAB18B5602D31814547B9971B42E73D7B56A`，inspect 前后 SHA 同为 `3EFE46412731860825D8855758DB88326B2821BDBE72FF7FC5315D1A037BD5E5`，均与交付一致。日志 `host-inspect-filter-near-{green,build,typecheck,root-tsc}-2026-11-17.log`。

只读复审关闭 npm 无 link/null 残余及普通变换 filter 主路径，仍确认两项 Important：ls-files 的完整 NUL 集合未验证每条路径非空/合法；check-attr 的 set/unset/unspecified 输出与同名 driver 会碰撞并把未关联路径一概标脏。具体输入及不引入漏报的修复边界已写 B 授权目录 `c-filter-association-final-review-2026-11-17.md`，实际 B 已收到先补测试的交接。这些是尚未关闭的候选边界，77 项 GREEN 不等于 inspection 或 T15 完成。

D 变换清单 filter 补充已经完成独立 RED 准备，提交 `a946cdea`：全组 **35/35 行为 RED、0 跳过、exit 1**，根 TypeScript exit 0，独立只读审查无阻塞。两种框架真实 Git 控制成立；产品 plan 断言尚未执行，完整结果见 D 新增独立记录，不重写此前 33 项历史。D 原始交付、宿主校正稿和日志已备份至 C 忽略 ledger，D 保持干净停写等待候选集成。

## 关联枚举正式 RED 与同名属性实证（追加）

2026-11-17 12:07（Asia/Shanghai），C 对 B 停写交付的 86 项测试运行同一完整 inspection 命令：**6 failed / 80 passed / 0 skipped、exit 1**，22.53 秒。三条非法 ls-files 路径仍被送入 check-attr，三条特殊名歧义仍把未关联文件标脏；三个守卫通过。测试 SHA 前后一致 `82E2184C73F59C8F63484ABEEA76523B0C7666C51097E5C9CC60580DEE816162`，inspect 源摘要仍为 77 项 GREEN 对应版本。日志 B `host-inspect-association-final-red-2026-11-17.log`。

独立代理仅在自有 synthetic 仓库运行 12 个实际场景：三种名字 set/unset/unspecified 分别搭配无属性、裸 filter、-filter、显式同名 driver。check-attr 的特殊状态输出与显式同名 driver 完全相同；只有显式 driver 执行 helper。变换型显式 driver 的 native status 会执行 helper 并报 dirty，屏蔽后会漏报。完整项目含 .git 字节保持不变。证据 C ledger `special-driver-result-2026-11-17.json`，SHA `55bc90b03ba3f0118cea2d26c186daafa0981afb92519c686cb4694348249c1d`。可靠边界为特殊值且枚举到同名 driver 时整体 unavailable，不能简单跳过特殊值。

## 子模块递归执行实证与控制（追加）

固定 Node 26.13.0 / pnpm 12.18.0 / Git 2.48.1.windows.1 下，独立自有本地 file-clone 子模块实验确认：父仓 filter 枚举 exit 1 且空，初始化 vendor/child 的子仓仅有本地 childonly.clean；add 将清单版本 1→索引 2，工作文件改写为索引 2 后，父仓当前固定完整 status 参数仍执行子仓 helper，marker 精确证明 2→3，stdout ` M vendor/child`。项目含 .git 字节不变，只有项目外 synthetic marker 新增。此为命令实证，未运行 B 模块或 CLI。JSON SHA `f6619e1aae26e24720013537bd0bc62061e2467fc136c6bcc1c8e69ebfbffe10`。

四项最小控制确认：`ls-files --stage -z` 安全输出 160000 gitlink；所有 status 加 `--ignore-submodules=all` 与 `-c status.submoduleSummary=false` 后零 marker、全树不变；嵌套 project 的 ls-files 只列项目范围，但 status 仍需禁递归，避免执行项目外子仓 helper。项目内 gitlink 无法完整安全识别时应明确 unavailable；普通项目维持既有 Git 识别。控制 JSON SHA `fa06350ca267b00fa65f98d785349ef665afba819da0ffca70b84653f9a36457`。两份完整材料已备份 C ledger 并交 B。

## Partial clone 缺失对象自动 fetch 实证（追加）

最后一项有界配置实验只使用自有本地 source 与真正 `--filter=blob:none --no-checkout --no-local` clone：有 .promisor pack、read-tree 建索引、缺失索引中的 .gitattributes blob，未删除任何对象。remote 指向自有 ext transport helper（fixture 单独允许 ext），写项目外 marker 后立即 exit 1，未访问真实网络。

当前固定 B base argv 的 check-attr 和 status 均在属性索引回退时自动 fetch 并执行 helper，exit 128；分别加全局 `--no-lazy-fetch` 后 exit 0、零 marker，check-attr 返回 unspecified，status 为删除 .gitattributes。ls-files、stage 枚举、config、rev-parse 加/不加均未执行 helper。12 个窄范围控制的仓库含 .git 字节一致，清除预期 marker 后完整实验树一致；不是产品或已安装 CLI 验收。证据 C ledger `partial-clone-lazy-fetch-result-2026-11-17.json`，SHA `cafa466b65e8ef2245876b4bc17d0c2b2ea97b6c39ec3b83357a22f2fe59d3a5`，已复制 B 授权目录并发送实际客户端，同批先补行为 RED。共享 argv 可采用 --no-lazy-fetch，旧 Git 不支持时 unavailable，不能重试无保护命令。

## Windows 子模块夹具前提校正（追加）

B 追加两条真实子模块反例及普通项目守卫，C 于 12:20 跑完整 89 项：**6 项关联行为失败 + 2 项子模块 setup 控制失败 / 81 passed / 0 skipped、exit 1**，26.69 秒。测试 SHA 前后一致 `6C4CD3247D371942C792830A9E5076CB72DBC1E017C461100266158F1E7BE609`。两条 setup 未到产品断言，不记为行为 RED。原日志 `host-inspect-submodule-red-2026-11-17.log` 保留不改。

C 使用 B 同款 helper 和完整创建顺序在自有临时目录作对照：宿主 core.autocrlf=true 时，clone 后 CRLF 工作文件与 LF 索引的 stat size 不同，status 可直接标脏而不调用 filter；仅在 seed/parent/child synthetic 本地配置 core.autocrlf=false 后，控制真实写 marker。推进 mtime 单独不能消除此大小差异。两份诊断 JSON `b-submodule-fixture-probe[-stable-eol]-2026-11-17.json` 保存在 C ledger。

C 仅给 B 子模块 fixture 三个自有仓库固定上述行尾配置，未修改任何产品或断言。12:27 窄范围复跑实际 **2 行为失败 / 1 passed**，5.40 秒；`-t` 排除了其余 86 项，明确记录为 86 skipped，不能作为完整全组证据。两项均到达 `inspect 不得执行子模块 helper` marker 断言。测试 SHA 前后一致 `804840E75F1D9BA1BB00C9291DF0CADEA484B7EF4B3E32EAA294E3320FCE6745`，日志 `host-inspect-submodule-corrected-red-2026-11-17.log`。完整重跑、partial-clone 行为 RED 与同批 GREEN 仍待后续；T15 不提前完成。

随后于 12:27:34 完整重跑同一 inspection 命令：**8 failed / 81 passed / 0 skipped、exit 1**，29.05 秒，全部失败为行为断言（6 项关联边界、2 项子模块执行），无 setup 失败。测试摘要前后一致 `804840E75F1D9BA1BB00C9291DF0CADEA484B7EF4B3E32EAA294E3320FCE6745`，三实现源摘要未变。日志 `host-inspect-submodule-corrected-full-red-2026-11-17.log`。此证据只关闭子模块夹具前提，产品四边界同批修复尚未开始。

## 四类零执行边界正式 92 项 RED（追加）

B 在实际 Claude 桌面端追加真实 partial clone 与两个 argv 守卫，C 预审发现 expected helper exit 128 被 execFileSync 提前抛错并由宽泛 skip 捕获。B 改为 spawnSync 控制后校验 marker，正式用例任一 setup 失败明确失败，删除 skip；沙箱 Git 2.34.1 的前提失败单独记录，不当作固定宿主结果。未改产品或原断言。

2026-11-17 12:40:11，C 用固定工具链完整执行 inspection：**11 failed / 81 passed / 0 skipped、exit 1**，30.29 秒。全部为行为断言：原 6 项关联、2 项子模块、真实 partial clone helper-marker、2 项 no-lazy-fetch argv 守卫；无 setup 失败。根 `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` **exit 0**。测试 SHA 前后一致 `C91F0D0F219BB44D6E1F759756B7FD30C4045908BA3BDC6AF7C1D5FA4B555CF5`，三实现源 SHA 保持 77 项 GREEN 版本。日志 B `host-inspect-zeroexec-red-2026-11-17.log`、`host-inspect-zeroexec-red-hashes-2026-11-17.json`、`host-inspect-zeroexec-red-root-tsc-2026-11-17.log`。

实际 B 已收到正式 RED，开始同批 GREEN：路径逐条校验、特殊名歧义、子模块禁止递归与安全 gitlink 检测、共享 no-lazy-fetch。C 不替代 B 产品开发，不继续扩张未实证配置审查；完整 GREEN/构建/聚焦提交、plan 产品及独立已安装验收仍待完成。

## Gitlink 检测触发可靠性（追加）

B 同批修复交付源摘要 `B25DEEC2E80A985181C77131F22660B05F2D3687D44BBC382A5F283C5327D33A`。C 核对当前同一 gitlink 收口，发现 stage 枚举只在工作树存在 tracked 目录或 project 根 .gitmodules 是文件时触发；目录可缺失而索引仍登记 160000，该条件不能证明项目无 gitlink。实际 B 补真实 cacheinfo 回归：自有 seed 提供真实 commit OID，外层 Git 根的 apps/client/child 登记 160000，工作目录及 .gitmodules 不存在，ignore-submodules=all status 为空；产品仍返回 clean。

12:57 窄复跑 **1 行为失败、92 项排除、exit 1**，1.14 秒，失败为 clean 应为 unavailable，没有 setup 失败。日志 B `host-inspect-gitlink-trigger-initial-2026-11-17.log`。C 只校正新 fixture 的 npm 锁 ECharts 条目，使其与原 vueNpmManifest 的两项声明一致，保留所有原断言，避免修复 Git 后 inspected 守卫被另一个夹具缺项遮挡；未改产品、真实锁或独立 A/C/D 材料。

12:58:44 完整 inspection 复跑：**1 failed / 92 passed / 0 skipped、exit 1**，29.35 秒，唯一失败为此真实 gitlink 触发回归；原四类边界 92 项全部通过。测试摘要前后一致 `B2BB790D706ED06FF331C5326E0B80F7238400F081E097E8025A59606369E857`，源摘要保持 B25DEEC2。日志 `host-inspect-gitlink-trigger-full-red-2026-11-17.log`。实际 B 已收到 GREEN 交接，移除工作树推断前置，固定执行安全 stage 枚举，并仅调整一项非行为 argv 调用计数断言。完整 GREEN/构建与提交仍待后续。

## Inspection 正式 GREEN 与聚焦提交（追加）

2026-11-17 13:06:49（Asia/Shanghai），C 对实际 B 停写的 `inspect-gitlink-trigger-green-ready` 交付运行固定工具链完整 inspection：**93/93 passed、0 skipped、exit 0**，30.50 秒。随后 `--filter @company/component-cli build`、`--filter @company/component-cli typecheck` 和根 `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` 均 **exit 0**。命令均经 `.\scripts\pnpm.ps1` 执行，Node 26.13.0、pnpm 12.18.0、Git 2.48.1.windows.1；日志为 B `.superpowers/t15/host-inspect-gitlink-trigger-{green,build,typecheck,root-tsc}-2026-11-17.log`，哈希记录 `host-inspect-gitlink-trigger-green-hashes-2026-11-17.json`。

测试 SHA 前后一致 `AAE56CE74A74599D86AF2138FCE15591DDF9FA50A5928337FD49587479C76C27`；inspect `8502273D5451221016AB31AA289D066D91029A022D2E23C0A46B5CED6A229FCB`、locks `8C9B8BA31E833E5CE63444F402E4E95CA0E526743899076BD701D9C5438EAF46`、workspace `5445B08FB6283F54BE1468D4067D3DF714CF599865F9CE519A739CA094B08576` 均与停写交付一致。路径逐条校验、特殊属性 driver 歧义、子模块禁止递归、partial clone 禁止 lazy fetch 及缺目录 gitlink 固定 stage 枚举已通过本轮行为与零执行测试；不扩张未实证 Git 配置实验。

C 检查暂存范围并只去除 B 验证文档多余 EOF 空行，`git diff --cached --check` 明确 exit 0 后代 B 提交 **`99bf0f46` — `feat: 实现本地项目与锁文件只读识别`**。提交仅含 B 三个实现文件、inspection 测试及当天验证文档，提交后 B 工作树干净。无版本升级、pack 或 push；构建的 dist/probe 不是冻结发布产物。

实际 Claude 桌面端 B 已收到上述正式 GREEN、提交 hash 与原 `c-plan-next-stage-2026-11-17.md` 启用交接：继续 P1 plan/network 行为测试，缺模块只用正确签名 throwing stub，停在 `plan-behavior-red-ready` 由 C 正式 RED 后实施。T15、独立黑盒、真实服务已安装验收及最终 main 集成仍未完成。
