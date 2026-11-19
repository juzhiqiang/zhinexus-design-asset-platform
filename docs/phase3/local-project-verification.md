# 本地接入验证、有限修复与 MCP

适用于 CLI 0.0.23。先按 [只读接入计划](integration-plan.md) 和 [应用与恢复](local-project-apply.md) 完成真实 plan/apply，再准备独立的 `IntegrationVerificationSpecV1`。本轮技术验收采用授权创建的临时 Vue/React 工程；历史真实业务项目试点及生产 G2 另行验收。

## 验证

在固定 Node 26.13.0、pnpm 12.18.0 工具链下运行已安装 CLI：

```powershell
component integrate verify --project C:/projects/app --plan D:/evidence/plan.json --apply-result D:/evidence/apply.json --spec D:/evidence/spec.json --out D:/evidence/verify --allow-project-scripts true --allow-browser true
```

`plan`、`apply-result`、`spec` 必须绑定相同工程与真实摘要。两个授权布尔参数均须显式提供；磁盘 JSON 中的声明不能授予执行权限。验证从实际安装树读取精确版本和包清单摘要，复核锁文件；即使 apply 未执行安装、其 `installedVersions` 为空，verify 也必须独立证明实际依赖。

spec 的 `commands` 引用项目清单内已有的 type/build 脚本及清单字节摘要，不能提供自由 executable、shell 或 argv。npm 抑制 pre/post 生命周期；固定 pnpm 使用 `--pm-on-fail=ignore` 与 `--config.verifyDepsBeforeRun=false`，显式关闭管理器重新引导及脚本前隐式安装，保留项目合法的精确 `packageManager` 声明。脚本属于授权执行的项目代码；实际源文件变化会进入报告。

浏览器页面由可信调用方预先启动，spec 提供精确 loopback URL、就绪元素、有限 click/fill 动作和 visible/text/count 断言。可信调用方须另行核对宿主入口确实 import 本轮生成文件，并保留构建图与浏览器资源加载证据；仅凭 loopback 或页面通过不能证明业务已接入。

动作之后，断言阶段共用一份 `browser.timeoutMs` 等待预算，允许页面异步更新；条件满足即继续，永久不匹配在预算耗尽后仍失败。文本比较保留首个匹配元素的 `textContent().trim()`，数量必须精确相等，可见性还须具有非零宽高。取消会及时关闭本次浏览器。导航、就绪与动作仍使用各自原有超时规则。

视觉基线须事先独立提供，并以 `ArtifactRef` 和实际 `EnvironmentV1` 绑定。本轮既定验收阈值为 `pixelThreshold=0.1`、`maxDiffPixelRatio=0.001`；spec 包含 visual 时必须显式提供两个字段。NEW、DIFF、INCOMPATIBLE 均不通过，也不会自动接纳或改写基线。`--out` 是工程外的证据根，基线路径相对此根；每次运行使用独占子目录。

## 有限修复

```powershell
component integrate repair --project C:/projects/app --plan D:/evidence/plan.json --apply-result D:/evidence/apply.json --spec D:/evidence/spec.json --report D:/evidence/report.json --out D:/evidence/verify --allow-project-scripts true --allow-browser true --max-attempts 2
```

`--report` 使用前次 verify 输出的完整 JSON。`--max-attempts` 只接受 0、1、2，默认 2。工具只修复能够精确识别的已知生成模板问题，只写原计划生成文件；业务缺口、未知错误或用户新增/编辑/删除会停止修复。每轮先向外部独占目录备份原始字节，再完整重新验证类型、构建、依赖、行为与视觉。

修复结果必须与原 plan/apply/spec 摘要、源报告、逐轮快照、备份及最终报告共同解释。修复后的 `finalReport` 连同 repair envelope 构成证据；不能改写旧 apply 的 afterHashes，或用旧 apply 单独重跑普通 verify 来伪造修复链。

源报告已有用户文件变动时不会启动修复。修复中的完整源快照只更新本轮确认写入的生成路径，原计划和 apply 的包清单、锁文件等守卫独立保留；写后或重验中出现用户新增、编辑、删除会立即停止，不继续下一轮写入。

| 退出码 | 含义 |
| --- | --- |
| 0 | verify passed 或 repair repaired |
| 2 | 已形成结构化失败、阻断、停止或待恢复结果 |
| 1 | 参数/输入错误，或执行错误导致无法形成可信结果 |

stdout 为单个 JSON，诊断写 stderr。`passed` 仅覆盖本次显式声明的检查，不自动发布组件、确认平台兼容记录或接受视觉基线。

## 本地 stdio MCP

```powershell
component mcp serve --config D:/evidence/mcp-host.json
```

可信宿主配置最小示例：

```json
{
  "schemaVersion": 1,
  "projectRoot": "C:/projects/app",
  "artifactRoot": "D:/evidence/mcp",
  "allowedApiOrigins": ["http://127.0.0.1:3000"],
  "allowedRegistryOrigins": ["http://127.0.0.1:4873"]
}
```

该配置可读取工程与创建只读计划。宿主只有在获得本次工程操作授权后，才加入绑定精确摘要及路径的 `applyGrant` 或 `verificationGrant`；字段采用 `IntegrationApplyAuthorizationV1` / `IntegrationExecutionAuthorizationV1` 契约。verify grant 必须为 `operation=verify`。API/registry 凭据由可信宿主通过对应环境变量提供，不放入工具参数或提交的配置。

服务只暴露 `inspect_project`、`plan_integration`、`apply_integration`、`verify_integration` 四工具。请求自报批准不能替代宿主 grant；verify 不标只读，也不隐式调用 repair。stdout 仅为 MCP 协议，取消及退出关闭本次拥有的进程。

严格输入校验仍会拒绝额外字段。回复在 stdio 序列化前统一脱敏，覆盖 SDK 自动产生的校验错误和协议错误，清除已知 API/registry 环境凭据及其 JSON 转义表示；请求关联标识保持原样。

完整实跑入口及证据见 [T17 集成记录](../verification/t17-integration-2026-11-20.md)。单元配置、真实产品配置和历史运行记录需按其注明的范围分别使用。
