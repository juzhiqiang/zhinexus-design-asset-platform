# C / T15 P0 公共契约冻结记录

日期：2026-11-17。执行：Codex，独立工作树 `t15-c-contracts`，分支 `feat/t15-c-contracts`，基线 `0b73f13a`。本记录仅证明 P0，不代表 T15 产品、真实服务或业务项目验收完成。

## 接口与下游约定

- `packages/contracts/src/integration-plan.ts` 导出 `LocalProjectInspectionV1`、`IntegrationPlanV1`、`IntegrationConflict`、文件快照/依赖/命令/改动类型，以及两个 `unknown → ValidationResult<T>` 校验器。CLI 镜像由既有 sync 脚本生成，不增加私有运行时依赖。
- inspection 的 `workspace='.'` 表示根项目；不确定框架、包管理器、锁时允许缺省，但必须 `conflicted` 并提供阻塞原因。缺少 ECharts 可以保留为未解析；P1 必须用 MatchPlan 明确版本重新查询资格，不自行补最新版本。
- 冲突 code 完整清单见导出的 `INTEGRATION_CONFLICT_CODES`；本轮所有冲突 `blocking:true`。planned 与 conflicted 严格对应有无冲突。P1 如需新增 code，交 C 维护，不自定义本地 DTO。
- plan 额外保留 `sourceMatchPlan` 以独立检查 gap 传播；`matchPlanDigest` 为其 `canonicalJson` UTF-8 原始字节 SHA-256，由 P1 计算。契约校验只检查摘要格式，不能证明文件/网络字节真实性。
- 路径统一项目根相对路径和 `/` 分隔，允许中文与内部空格；显式枚举所有修改文件。Windows 路径别名、穿越、设备名、ADS、末尾点/空格不合法。逻辑去重包含大小写/NFC；realpath、junction/symlink/8.3 逃逸仍须 P1/P3 实测。
- `fileSnapshots` 的现有文件必须携带 SHA，缺失文件禁止携带 SHA。`baseFileHashes` 必须完整保留 inspection 快照，并为每个 allowedPath 提供存在性保护。pnpm workspace 还必须快照根 `pnpm-workspace.yaml`；npm workspace 声明包含在根 package.json 内。
- 支持锁文件为根 `package-lock.json`（npm-v3）或 `pnpm-lock.yaml`（pnpm-v9）。锁内容、importer 和声明约束一致性由 P1 的真实读取证明。
- P0 在 `tests/fixtures/integration-plan.ts#workspacePatternCases` 冻结 glob 边界：支持普通相对目录、独立路径段 `*`/`**`；不支持否定、brace、extglob、部分段通配、问号、反斜杠、穿越和尾斜杠。P1 消费这些边界实现识别，A/P2 独立提供真实工程预期。
- command 仅预览根目录 `{executable: npm|pnpm,args:['install','--ignore-scripts'],cwd:'.',purpose:'install'}`，以及目标包已有 `build`/`typecheck` 的 `run` 命令。脚本不得实际运行，任何输出都不授予 T16 apply 权限。
- `changes` 分别是 package-json 的精确 dependencies 数组、lockfile-regeneration 意图、generated-component 的 instanceId/framework/path。新依赖必须对应清单变更、锁再生成和安装预览；每个 planned 元素必须有一个生成意图。无最终源码/锁字节。
- `publicationEvidence` 保存全部唯一 target 最后 GET 的 response 与 UTC checkedAt；`registryEvidence` 保存 name/version/sha256/integrity/verification。平台目标摘要采用 `platform-sha256`；无平台摘要的 runtime/core 只采用 `registry-integrity`。P1 仍需先核对下载字节、再 GET 复读和本地快照复读。
- JSON Schema 明确标注仅结构保证；调用者必须执行运行时校验，完成结构无法表达的 status、引用、文件守卫、依赖、权威 API 完整性和 gap 传播检查。

## 依赖

通过固定 pnpm 查询 npm registry 的版本/engines/repository，并读取安装包内上游 README，锁定 CLI 运行时 `semver@7.8.6`、`yaml@2.9.1`；`@types/semver@7.8.0` 仅开发依赖。固定 Node 26.13.0 上安装、CLI build/typecheck 通过。不要使用 semver.coerce 或宽松版本猜测；YAML 解析不得执行配置，并应拒绝解析错误、重复 key 和不支持的结构。

## TDD 与独立审查

1. 现有 project-context/match-plan 基线 37/37。新工作树初次缺 contracts dist 的模块解析失败属于环境准备，构建后基线通过，不算 RED。
2. 新契约 38/38 RED（校验函数尚不存在），实现后 GREEN。fixture 内快照对象曾共享引用，修正为独立副本后快照变化反例生效。
3. 权威 props/events、宿主上下文、生成意图与 registry 关系补充 RED：6/46 失败，随后 46/46 GREEN。
4. 独立 Codex 审查发现遗漏依赖写入意图及陈旧 target 材料：4/50 RED，补清单/锁/安装关联和完整 target 比较后 GREEN。
5. 直接 ESM 导入揭示 `integration-plan → digests → schemas` 初始化循环：1/51 RED；将既有 canonicalJson 原样移至 schema 叶模块、digests 保留原导出，独立 contracts/CLI 模块导入 GREEN。
6. 根锁路径及 pnpm workspace 声明快照：2/53 RED，补交叉规则后 53/53 GREEN。
7. 审查 minor 中类型包位置已调整；workspace glob 边界写入公共 fixture，由 P1/P2 验证实际匹配。真实 IO、凭据、网络和真实服务属于后续验收，不能由 P0 推断。

日志位于本任务隔离工作树 `.superpowers/sdd/2026-11-16-phase3-t15-kickoff/`，后续集成前备份。历史验证记录未改写。

## 验证命令与结果

- `scripts/pnpm.ps1 --filter @company/contracts schemas:generate`：exit 0；两份新 JSON Schema 生成。
- `scripts/pnpm.ps1 --filter @company/component-cli build`：exit 0；内联契约及 probe 完整性检查通过。
- `scripts/pnpm.ps1 exec vitest run tests/contracts/integration-plan.test.ts tests/contracts/project-context.test.ts tests/contracts/match-plan.test.ts tests/contracts/api-schema.test.ts`：审查前 111/111、首轮修正后 115/115；最终结果下文追加。
- `scripts/pnpm.ps1 exec turbo run build typecheck --force`：最终产品修正后 20/20，0 cached。
- 根 `tsc -p tsconfig.json --noEmit`、`verify:workspace`、`install --frozen-lockfile`、`git diff --check`：exit 0。
- 首次根 `test`：Node 168/168，Vitest 1286 通过 / 9 失败；7 个文件涉及 CLI check/bundle/release/baseline、compatibility-api 和 packed consumer 浏览器验证，原因为新工作树没有 Chromium headless 可执行文件。已通过固定工具链安装 Chromium，保留失败日志，完整复跑结果下文追加。
- 原架构 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，未变。
- 复用既有 SDK bundle manifest SHA-256：`04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。根测试显式设置该已核对 `A10_FROZEN_BUNDLE`；未重打已接受 SDK。

版本：本轮 CLI 升版及 CHANGELOG 在 P4 候选冻结前统一提交，P0 不独立发布。

### 最终 P0 门槛（2026-11-17）

- 加上既有 digest/reports 回归的 5 文件窄测试：139/139，通过。
- 补齐浏览器后的根 `test`：exit 0；Node 168/168，Vitest 76 文件、1302/1302，0 跳过。保留既有 Node DEP0190 警告，未改写既有 shell 子进程实现。
- `canonicalJson` 原导出保持兼容；编译后 CLI 的 integration-plan 模块独立 ESM 导入 exit 0。
- P0 达到合入 main 的门槛；P1–P4 尚未完成。完整提交 hash 由 Git 记录并作为三方派发基线。
