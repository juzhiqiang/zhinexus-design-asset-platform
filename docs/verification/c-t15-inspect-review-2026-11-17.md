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
