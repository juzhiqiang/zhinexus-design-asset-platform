# T15 本地项目识别与接入计划

状态：2026-11-17 CLI `0.0.13` 已完成 T15 技术验收。实际 Claude Code 提供独立黑盒，宿主 C 在集成树完成 P1 + 黑盒 183/183，并使用同一冻结 tarball 在仓外通过真实 Nest/PostgreSQL/MinIO/Verdaccio 25/25。命令、摘要和边界见 [最终验收记录](../verification/t15-completion-2026-11-17.md)。

```text
component integrate inspect --project <path> [--workspace <relative-path>]
component integrate plan --project <path> [--workspace <relative-path>] --match <file> --api-url <origin> --registry <origin> [--output-dir <relative-path>]
```

`inspect` 只读识别 Vue 3 / React 19、npm package-lock v3 / pnpm lockfile v9，并输出 `LocalProjectInspectionV1`。Monorepo 必须通过 `--workspace` 指定目标子包。多锁、多框架、缺锁、错误 importer 和无法确定的精确版本保留为冲突。

`plan` 使用 MatchPlan 和最新平台资格查询，核对 API、绑定、版本、tarball 摘要及兼容证据，输出 `IntegrationPlanV1`。`--output-dir` 相对目标子包，只表示未来组件文件位置，默认 `src/components/zhinexus`；命令不会创建该目录。

stdout 只输出 JSON，诊断写 stderr。退出码含义如下：

- `0`：识别为 `inspected`，或计划为 `planned`，没有已知阻塞。
- `2`：输出 `conflicted`，包含阻塞冲突。
- `1`：参数、JSON、文件读取或网络等执行错误。

执行错误的 stdout 采用本地 `{ "status": "error", "error": { "code": "…", "message": "…" } }` envelope；冲突仍输出完整 inspection/plan。网络失败不会被包装成成功计划。

凭据由两个独立环境变量注入：`ZHINEXUS_API_TOKEN` 用于平台 API，`ZHINEXUS_REGISTRY_TOKEN` 用于 registry 元数据与 tarball。令牌不互相转发，不进入计划、日志或命令预览。

命令不写目标项目，不执行安装、构建、项目脚本、配置代码、Git hooks 或浏览器。Git 仅允许固定参数的受控只读调用。需要保存 JSON 时，请自行重定向到项目之外。

计划的 `executionAuthorized` 恒为 `false`。计划不构成 apply 授权；T16 写入前仍须重新核验文件、资格、版本和摘要。T16 安装及代码生成、T17 验证修复及 MCP、真实业务项目验收尚有独立门槛；合成工程和协议 stub 不能作为业务试点或真实兼容证据。

规划结束前会复读目标资格、API 和关键文件，结果只代表该次复读时点。已锁依赖冲突、缺少兼容证据、数据/事件/布局缺口、已有输出或脏目标均保留为冲突；不会静默升级宿主。拟生成位置经多跳链接/junction 核验，无法证明安全时返回 `PATH_UNSAFE`；解析上限为 64 跳，超限也失败关闭。
