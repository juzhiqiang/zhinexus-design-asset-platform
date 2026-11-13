# C：七组件十四实现 Windows 本地验收

日期：2026-11-13。基线 `885792b`，分支 `fix/c-sdk14-acceptance`。本记录新增本轮证据，不改写此前十实现的历史结果。对应 [执行计划](../superpowers/plans/2026-11-13-c-sdk14-acceptance.md)。

## 范围和结果

SDK 0.0.6 的 line、bar、pie、scatter、trend-card、ranking、proportion，各 Vue/React 两个实现，共十四实现已在 Windows x64 本机完成冻结产物、工作区外消费者截图、真实三存储发布至 READY、真实 HTTPS 浏览器预览与精确 Registry 消费验收。

`current-sdk.test.ts` 先将十四实现预期加到旧五组件清单观察失败，再扩展实现矩阵。三份 tarball 在截图前冻结，截图后不重新打包。测试分别核对 tarball、完整 manifest 变体、API/docs、完整检查报告、截图、全部静态预览文件的实际字节摘要。Registry 端核对精确包版本；两个工作区外消费者分别安装 Vue/React 精确版本，导入各七个子路径并核对 core 精确依赖版本。

浏览器通过仅作用于测试上下文的 CONNECT 代理和临时自签名 TLS 访问真实 preview-gateway；不修改系统证书、hosts 或代理。逐实现实际经历 bootstrap 的 303、Secure/HttpOnly/SameSite=None 会话 Cookie、去除 grant 后的静态入口，等待示例 ready，对运行时检查的名称、数量和状态与冻结报告逐项比较，并确认 canvas/svg 存在且无页面错误。失败诊断去除授权查询参数，Cookie 仅比较非敏感属性。

最终原始摘要见 [本次验收 JSON](c-sdk14-acceptance-2026-11-13.evidence.json)，时间 `2026-11-13T04:33:03.815Z`（北京时间 12:33:03）。其中 browserPreviews 保存十四个实际入口、运行时检查与实际读取的预览资源摘要；variants 保存 API/docs、报告与截图引用。完整本地冻结材料在 `.tools/operations/current-sdk/69443f97-8b73-4ecb-91aa-d8835a0b58dc/`，该忽略目录不提交。提交的 JSON SHA-256 为 `24a989a4d88561d8b2055995f2397bf9871c09c80424c13fec152ab8355e3192`。

| 包 | 精确版本 | 冻结 tarball SHA-256 |
| --- | --- | --- |
| @company/charts-core | 0.0.6 | 7af91861c7ddb4786d1f98669a819625504ce5ad2a00bfee2b311a6f47e4e4eb |
| @company/charts-vue | 0.0.6 | aa20d821f9a6369c5ec0968049a2eb056f4ea2fd78c62bc1c5b046f55759955f |
| @company/charts-react | 0.0.6 | 91a2f9de25927e062f0f6205d16d4ab881981f9365af41a321ffb04f2f5ffdc4 |

## 实际命令与边界

命令均通过仓库 `scripts/pnpm.ps1` 使用固定 Node 26.13.0、pnpm 12.18.0；未将测试放入 Turbo 缓存。

| 命令（省略共同前缀 `.\scripts\pnpm.ps1`） | 实际结果 |
| --- | --- |
| `verify:workspace` | 通过，10 成员、无环、安全服务依赖图 |
| `build` | 本轮初始基线构建 10/10 通过 |
| `exec turbo run build typecheck --filter=@company/platform-api --filter=@company/preview-gateway --force` | 5/5 通过，0 缓存 |
| `exec turbo run typecheck --force` | 14/14 通过，0 缓存 |
| `exec tsc --project tsconfig.json --noEmit` | 最终修改后通过 |
| `exec vitest run tests/unit tests/contracts` | 最终 19 文件、327 测试通过，14.90 秒 |
| `exec vitest run tests/unit/platform-harness-cleanup.test.ts` | 初始化清理前三项先 RED（3 失败），修正后 GREEN；最终五项随上一行通过 |
| `exec vitest run --config tests/platform/vitest.config.ts tests/platform/current-sdk.test.ts` | 最终 1/1 通过，63.85 秒；此前两轮完整通过分别为 65.12、66.44 秒 |
| `exec vitest run tests/integration/packed-consumer-frameworks.test.ts tests/integration/cli-bundle.test.ts` | 本轮前段 12 项通过 |
| `test:browser` | 本轮前段完整 122 项通过；这是基线 SDK0.0.6，未包含 A 的 T10 新提交 |
| `test` | 前段 30 文件通过/1 失败，588 passed/1 failed；cli-release 因共享 credentials.json 缺失失败，不称全绿 |
| `test:platform` | 前段 25 文件失败/2 通过；61 failed/2 passed/24 skipped；隔离 current-sdk 与 recovery 通过，多数旧测试因共享凭据缺失失败，不称全绿 |
| `git diff --check` | 通过 |

曾有一轮真实预览 getChecks 返回 failed，之后增加变体/检查诊断并继续验证，连续三轮完整通过；不将那次失败抹除。最终逐项检查与冻结报告一致，默认状态之外的展示矩阵仍以专属浏览器用例为证据。

隔离设施由 RecoveryStack 以随机端口、随机资源名、所有权标签创建。HTTP harness 接受 PlatformServices（credentials/postgresPort/storageEndpoint/registryOrigin），可供 B 真实网页测试复用。初始化失败清理覆盖连接失败、建库/建桶成功但响应丢失、桶尚不存在及 storage.close 抛错；仅清理精确拥有的库/桶/容器/卷与凭据目录，不枚举删除其他资源。

共享三存储在线，但 `.tools/g2-local/credentials.json` 缺失。未初始化、重启或轮换共享服务凭据；旧测试仍硬编码共享端口与凭据，完整旧套件保持阻塞。若需全套重跑，应先恢复原凭据或另行将旧套件迁入隔离设施，不能生成新密码覆盖原服务。

## 仍未验收

- 公司 OIDC/PKCE、组织角色撤销、生产独立域/TLS和真实浏览器第三方 Cookie 政策。
- B 的真实网页文件选择、上传、恢复及三存储浏览器端到端；本轮 C 的 CLI 自动来源不代替网页 manual-upload 验收。
- A 在 `feat/t10-sdk-compatibility` 的新提交之 Windows 原生复验、完整 T10 升级 runner 及两个真实业务试点。
- 生产容量/SLA、G2/M2/T11/T12 整体验收。

原架构文档 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。本轮仅测试支撑和证据变更，无新增公开产品行为，不升版，不 push、不合并 main。
