# T15 本地项目识别与接入计划（草案）

状态：黑盒验收当前为 RED，产品尚未验收。说明由实际 Claude Code 会话提供，C 宿主校对协议字段和命令；示例将在产品集成后实际运行复核。

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

凭据由两个独立环境变量注入：`ZHINEXUS_API_TOKEN` 用于平台 API，`ZHINEXUS_REGISTRY_TOKEN` 用于 registry 元数据与 tarball。令牌不互相转发，不进入计划、日志或命令预览。

命令不写目标项目，不执行安装、构建、项目脚本、配置代码、Git hooks 或浏览器。Git 仅允许固定参数的受控只读调用。需要保存 JSON 时，请自行重定向到项目之外。

计划的 `executionAuthorized` 恒为 `false`。计划不构成 apply 授权；T16 写入前仍须重新核验文件、资格、版本和摘要。T16 安装及代码生成、T17 验证修复及 MCP、真实业务项目验收尚有独立门槛；合成工程和协议 stub 不能作为业务试点或真实兼容证据。
