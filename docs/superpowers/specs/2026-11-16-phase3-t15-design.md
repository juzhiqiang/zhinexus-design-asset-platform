# 三期首轮：本地项目识别与只读接入计划

日期：2026-11-16（Asia/Shanghai）。规划基线：`main@b35498ac9bddcfcc63ff4fdd85c7befaf29e6c0f`。2026-11-17 状态：T15 技术验收完成，CLI `0.0.13`；实际门禁、冻结产物和本地收口见 [最终记录](../../verification/t15-completion-2026-11-17.md)。T16/T17 与真实业务试点保持未完成。

## 目标与用户决定

三期沿用总体计划 T15–T17：从二期组件/装配协议进入本地项目识别、依赖与代码接入、验证/有限修复/MCP。用户指定 Antigravity、Claude 桌面端、Claude Code、Codex 四个实际客户端协作，允许各自独立 Git 分支，完成后合并并删除开发分支；开发任务重的工作优先给 Claude 桌面端。

本方案选择首轮完整交付 T15：读取真实目标项目和 MatchPlan，核对发布材料，输出可审查的接入计划。T16 安装/代码写入、T17 验证修复/MCP 在下一轮接续。这是任务顺序安排，不缩减三期最终范围。四个实际客户端已按本方案完成 T15；以下设计约束继续用于后续接续。

二期以 2026-11-16 GET 协议收口记录为准，设计平台连接器和真实设计标注不恢复为首轮前置。真实 Vue/React 业务项目仍是三期最终验收条件，普通 fixtures 仅用于开发和技术验收。

## 已有基础与缺口

- 已有 ProjectContext、MatchPlanV1、ComponentApiV1、GET `/v1/matching/components` 和 POST `/v1/matching/plans`，可复用身份、版本、材料摘要和兼容证据语义。
- 当前 ProjectContext 不包含锁文件、目标子包、项目脚本、React DOM 和文件快照；新增本地项目描述，保持二期契约兼容。
- `packages/component-cli/src/integration/`、`commands/integrate.ts`、`mcp/` 尚不存在；IntegrationPlan 及其运行时校验尚未实现。
- 现有 `local/consumer.ts` 创建临时消费者清单与配置，不能直接用于修改已有业务项目。T15 不调用该安装流程。
- 服务端不增加组件构建、运行或浏览器能力。保持 10 个 workspace 成员，MCP 后续放入现有 CLI 包。

## 首轮支持与行为

以下是规划采用的实施选择，由 C 在 P0 的契约、fixtures 中落实，不描述成用户已指定的产品细节。

1. Windows x64，本仓开发使用 Node `26.13.0` / pnpm `12.18.0`。目标项目只读识别 Vue 3、React 19，以及 npm/pnpm 单包和显式目标子包；识别不等于承诺对所有宿主提供代码生成。
2. 首批锁格式选择 npm package-lock v3、pnpm lockfile v9，分别由实际工具生成 fixtures 并验证。其他格式、Yarn/Bun、缺锁、多个包管理器锁并存均返回明确冲突，不自动迁移或创建锁。
3. npm workspace 使用根 package.json 的 workspaces，pnpm 使用 pnpm-workspace.yaml；常规目录 glob 支持范围由 P0 反例固定，不能靠扫描到第一个框架目录选择目标。Monorepo 必须指定 `--workspace <相对目录>`；目标和锁的 realpath 都受项目根约束。
4. packageManager 声明、锁文件类型和目标 importer 必须一致；从对应锁定位精确框架/React DOM/ECharts 版本，同时检查 package.json 声明约束。range 不当成精确版本；无法证实解析结果则报告冲突。禁止加载执行项目配置、安装脚本或源码。
5. 现有 React 和 React DOM 按各自实际精确版本进入现有资格校验，不凭 major 相同判定兼容。宿主已有框架/ECharts 不自动升级；缺少 ECharts 时可采用 MatchPlan 明确的候选版本进入只读计划，并重新查询精确组合，不能凭空补“最新版本”。
6. dirty/untracked 项目可识别；计划拟修改的已有文件若有用户未提交改动则标冲突，其他 dirty 文件保留并记录。允许固定 argv/cwd 的只读 Git 子进程，禁用 optional locks、fsmonitor 及外部 diff/textconv，不执行 hooks/用户脚本；环境中的 Git 目录/索引覆盖变量不得改变实际检查目标。无 Git 项目仍可读取，必须提供原始字节快照，不伪称 Git 干净。
7. 所有场景均不写目标项目，不执行安装、构建、项目脚本或浏览器。只向 stdout 输出 JSON；调用者可自行重定向到项目之外。不提供会悄悄在项目生成日志、缓存、备份的选项。

## 命令与输出

规划命令：

```text
component integrate inspect --project <path> [--workspace <relative-path>]
component integrate plan --project <path> [--workspace <relative-path>] --match <file> --api-url <origin> --registry <origin> [--output-dir <relative-path>]
```

`--output-dir` 只决定未来生成文件的位置，默认 `src/components/zhinexus`，不是本轮输出 JSON 的存放目录。路径相对目标包；实际计划内路径统一相对项目根。按元素输入顺序规划 `component-0001.vue` / `.tsx` 等文件，目标已存在则冲突，不覆盖，不用设计 ID 拼接文件名。

退出码：0 表示只读检查/计划已完成且无已知阻塞；2 表示形成了含 conflicts 的结构化结果；1 表示参数/JSON/文件读取/网络等执行错误。错误不能伪装成“组件不存在”。任何退出码均不代表安装、业务接入或三期验收完成。stdout 只有结构化结果，诊断放 stderr，凭据不进入输出。

新增协议由 C 独占维护：

- `LocalProjectInspectionV1`：schemaVersion、workspace 相对目标、包管理器、锁类型、已解析依赖、可用脚本名、Git 脏路径、文件快照、conflicts。信息不足时字段可缺失，不能伪造一个有效 ProjectContext。
- `IntegrationPlanV1`：schemaVersion、stage=`plan`、executionAuthorized=`false`、status=`planned|conflicted`、localProject、matchPlanDigest、baseFileHashes、allowedPaths、packageManager、exactDependencies、commands、changes、conflicts、发布证据。
- `baseFileHashes` 记录原始字节 SHA-256；未来新增文件以 `exists:false` 表示，不能以空文件 SHA 冒充不存在。读取过程中关键文件变动则返回 `PROJECT_CHANGED`。
- `allowedPaths` 枚举 package.json、对应锁和拟新增组件文件，不接受目录通配授权；先规范化，再检查 realpath、Windows 大小写、junction/symlink 和路径别名。
- `commands` 是 `{executable,args,cwd,purpose}` 结构化预览，`cwd` 为相对目录；不能包含任意 shell 串、令牌或错误消息中的命令。只描述包管理器安装及项目原生类型/构建脚本，不执行。
- `changes` 区分 package-json 精确依赖修改、lockfile-regeneration 意图、generated-component 意图。T15 不预言安装后锁文件字节，也不输出未经 T16 API/绑定校验的最终源码。
- conflicts 包含稳定 code、path/instanceId（适用时）、message、blocking。未知 API/事件、业务绑定/布局缺失、兼容未验证、依赖冲突均保持显式；不把原 MatchPlan gaps 吞掉。

P0 必须冻结完整 TypeScript、Schema、运行时附加规则、错误码及合法/非法 fixtures 后才交 B/D 实施。此设计不要求在规划提交中先写产品契约代码。

## 发布与凭据检查

`inspect` 只做本地读取。`plan` 验证输入 MatchPlan，按其每个 target 的 componentId/framework/packageName/packageVersion，以及本地实际宿主版本调用 GET。核对整个 response.query、variantReleaseId、packageSha256、API 身份及证据。多实例可复用同一目标的读取，但每个元素的绑定仍独立。

必须将输入元素的 props/events 与新 GET 的权威 API 完整对照：名称、type/required/payload、成员完整性，以及 source/handler。遗漏必填 prop、删空事件列表、额外成员或过期类型不能因离线 MatchPlan 自洽而放行；输出冲突而非自动猜补业务绑定。

资格复查与文件快照是规划时点证据，不构成后续写入授权。T16 apply 前必须再次复查文件、资格、版本/摘要及所需权限；不信任离线计划中自报的 allowedPaths 或 commands。

从明确 registry 读取所选组件包的精确版本元数据和 tarball，计算 SHA-256 对照 GET target；同包多元素仅检查一次。core 等实际运行时依赖采用 GET 返回的精确版本，检查可达性及 registry integrity；只有有平台摘要证据的包才声称对照了平台 SHA。宿主已锁依赖从真实锁校验，不下载整个依赖树。

所有下载/元数据检查结束后，再通过 GET 复读全部唯一目标，对比资格、身份、摘要及权威 API；之后复读本地关键文件快照。下载期间撤权、废弃或材料改变应返回冲突或错误。输出只代表最后复读时点的结果，不保证其后远端状态不变。

API 令牌与 registry 只读凭据分别通过 `ZHINEXUS_API_TOKEN`、`ZHINEXUS_REGISTRY_TOKEN` 注入，不写计划/日志/命令。两者不得互相转发。校验 URL 无 userinfo；生产 HTTPS，HTTP 仅允许显式本地 loopback 测试。禁用自动跨 origin 重定向，tarball 路径及重定向受配置 registry origin 限制。使用既有 tarball 50 MiB 限额，并限制请求超时；不在项目内写下载缓存，不执行下载内容。

公开 CLI 的新增 YAML/semver 等解析依赖由 C 实施时查询官方资料、精确锁定并验证兼容；不手写宽松版本比较，不把根 devDependency 当作发布后必定可用的运行时依赖。

## 四方职责与后续轮次

| 角色 | T15 首轮唯一职责 | T16 / T17 接续 |
| --- | --- | --- |
| C / Codex | P0 契约、公共 fixtures、根依赖；P4 真实联调、独立审查协调、版本和合并 | 写入/恢复与验证契约、平台联调、MCP 依赖和最终集成 |
| B / Claude 桌面端 | 最重任务 P1：项目识别、锁解析、发布核验、计划生成和 CLI 接线 | 优先负责安装/应用/回退、Vue/React 生成器、验证修复及 MCP 产品开发 |
| A / Antigravity | P2：双框架/包管理器/workspace 输入矩阵、SDK/API 预期、反例和审计 | 生成样例、双框架运行结果核验、SDK 缺陷专项 |
| D / Claude Code | P3：独立进程黑盒、只读性/安全边界验收、用户说明 | 安装失败恢复、用户编辑保护、浏览器场景与真实项目验收 |

C 先冻结公共接口；随后 A/B/D 及 C 的集成准备可并行，最多 4 个 in_progress。A 的 fixtures 不作为 B/D 开工的硬依赖，可先用 P0 公共最小 fixtures；完整矩阵和真服务是验收依赖。B 内部先识别再规划，不能把同一 CLI 文件分给多个客户端同时改。

开发只能由被指派的实际客户端认领，不将 Codex 子代理冒称 Claude 或 Antigravity。某客户端不可用时记录阻塞或明确调整归属。

## 验收与后续门槛

首轮：npm/pnpm × Vue/React 正反矩阵通过；显式 workspace 定位；真实 Nest/PG/MinIO/Verdaccio 联调；同一冻结 SDK 身份/摘要一致；plan 无目标文件写入、不执行安装/构建/项目脚本/浏览器、无凭据泄露；已安装 CLI 在仓库外可用且无私有运行时依赖。unverified/缺业务绑定样例必须得到 conflicted，不能伪造成功。Git 只读调用按上述例外单独验证。

T16 开工需要 T15 契约与可复验计划，并准备两个框架的样例目标。T16 完成必须有授权业务项目可审查变更、安装失败恢复与用户后续编辑保护证据。T17 在此基础上完成本地类型/构建/行为/视觉检查、默认最多 2 次有限修复、4 个 MCP 工具一致性；沿用至少 10 Vue + 10 React 场景、支持范围成功率建议 ≥80%、越界写入/用户修改丢失为 0 和两个真实业务项目终验要求。

三期原估算为 35–50 开发人日、另加 10–15 独立测试人日；T15 原估算 8–12 开发人日。四个客户端不等于四份稳定人工产能，本轮按契约、产品、独立验收、集成四个门槛推进，不承诺未经实测的日历完成时间。

原架构 SHA-256 必须保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。历史验收记录只引用不改写。
