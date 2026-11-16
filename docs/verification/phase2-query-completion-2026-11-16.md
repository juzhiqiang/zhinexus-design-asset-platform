# 二期 GET 查询交付收口（2026-11-16）

当前产品候选：`19c4289789613bbfacf0c7b7359530efdda4998e`。用户确认本轮以标识规范、GET 查询和使用侧协议验收交付，不等待设计平台连接器或真实设计标注。全部技术门槛已通过，P5 剩余本地合并与分支清理。

## 实际分工与提交

| 角色 / 实际客户端 | 交付 | 提交 |
| --- | --- | --- |
| C / Codex | 请求响应契约、Schema、运行时校验与 CLI 内联 | `53117379` |
| A / Antigravity IDE | 14 实现独立 API 矩阵、199 文件字节及摘要验证 | `b12f34ac`、`16741369` |
| B / Claude 桌面端 | GET 权威查询、材料校验、Gallery 入口及测试 | `b96db90e`、`160de0ef` |
| D / Claude Code CLI | 独立 HTTP、可校验示例及使用说明候选 | `66c59f4d` |
| C / Codex | 冻结 SDK、真实 Gallery 联调、补齐规范附加规则 | `d05d3e93` |
| C / Codex | 平台 0.0.6，API/Gallery 0.0.9 | `19c42897` |

A→B→D 合入 C 的合并提交分别为 `18c3f8ae`、`56628a35`、`547d4f46`，无冲突。Claude 桌面端承担本轮主要产品开发；Windows 宿主测试与提交由 C 完成。Claude Code 出现工具解析与生成截断问题，以同一已配置客户端生成候选，再由 C 修正语法和测试设施并实测；不将宿主执行归为 CLI 自行执行。各客户端交接过程见 [A](a-phase2-query-sdk-2026-11-16.md)、[B](b-phase2-query-implementation-2026-11-16.md)、[C](c-phase2-query-integration-2026-11-16.md)、[D](d-phase2-query-consumer-2026-11-16.md) 记录。

## 对外交付

- `GET /v1/matching/components`：组件 ID、框架、精确包版本，以及宿主框架/ECharts/React DOM 精确版本；可选包名用于消歧。ID 区分大小写、按原值比较，不做 trim 或模糊推断。
- 服务从权威目录读取当前资格与权限，不依赖搜索索引。读取材料后再次检查权限、禁用、废弃、revision 与新增歧义；不可用时清空 target、API 与依赖。
- 静态材料缺失、超长、摘要或格式不符返回缺口，基础设施错误仍为 503。原 POST 装配语义保留，GET 发布 ID 可继续构造设计映射。
- `/match` 提供 Vue/React 查询入口；输入和身份变化时取消请求、清除旧结果。Ready、matched、兼容证据状态独立。
- [使用侧接口规范](../phase2/component-query-api.md) 列出请求、错误、Schema 附加运行时规则与调用示例；[SDK 对照矩阵](../phase2/component-query-sdk-matrix.md) 覆盖 7 类 × 2 框架。

## 最终验证

所有命令经 Windows 本机 `scripts/pnpm.ps1`，固定 Node 26.13.0 / pnpm 12.18.0。最终全图与综合回归对应 `19c42897` 的产品及版本；P4 对应 `d05d3e93`，后续仅增加版本元数据与交付文档。

| 检查 | 命令（省略统一脚本前缀） | 实际结果 / 日志 |
| --- | --- | --- |
| 强制全图 | `exec turbo run build typecheck --force` | 20/20，0 缓存，exit 0；`phase2-final-graph.log` |
| 根类型 | `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | exit 0；`phase2-final-tsc.log` |
| 工程边界 | `verify:workspace` | 10 成员、安全服务依赖图通过，exit 0；`phase2-final-workspace.log` |
| 根测试 | 设置 `A10_FROZEN_BUNDLE` 后 `test` | T10 168/168 + Vitest 75 文件 / 1249 测试通过，0 跳过，exit 0；`phase2-final-root-test.log` |
| 真实服务综合回归 | `exec vitest run --config tests/platform/vitest.config.ts tests/platform/matching.test.ts tests/platform/search.test.ts tests/platform/component-query.test.ts tests/platform/component-query-consumer.test.ts` | 45/45，0 跳过，exit 0；`phase2-final-platform.log` |
| 二期浏览器 | `exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts tests/browser/phase2-search.spec.ts tests/browser/phase2-design-match.spec.ts tests/browser/phase2-component-query.spec.ts` | 70/70，exit 0；`phase2-final-browser.log` |
| 冻结 SDK + 真实页面 | 设置冻结输入及 `PHASE2_GALLERY_ORIGIN`，启动已构建 Gallery，再运行 `exec vitest run --config tests/acceptance/phase2-query.config.ts` | 15/15，0 跳过，exit 0；`phase2-c-acceptance-green.log` |
| 独立使用侧 | D 的 HTTP 与文档示例测试 | 5/5 + 3/3，exit 0；`phase2-c-consumer-green.log` / `phase2-c-examples-green.log` |

B 的 RED→GREEN 另有 112/112 窄测、36/36 平台与 51/51 浏览器通过；详见 B 记录，不与最终组重复累计。真实服务使用隔离 PostgreSQL / MinIO / Verdaccio / Nest 与本地签名 JWT/JWK。P4 缺少冻结输入或 Gallery origin 会显式失败，不静默跳过。未运行会重新打包的 `tests/platform/current-sdk.test.ts`。

## 冻结与独立审查

复用已接受 bundle `current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`：manifest SHA-256 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`，199 文件、14 报告逐项字节与 SHA 验证；core 0.0.11、Vue/React 0.0.12。没有重新 pack 或修改旧产物，CLI 仍为 0.0.11。SDK 原消费者/截图证据见 [已接受采纳记录](sdk-label-adopt-acceptance-2026-11-16.md)。

独立 Codex 审查对 `19c42897` 无剩余 Critical / Important 阻断。审查发现并关闭：GET 存储错误归一、使用侧动态规则说明、GET/POST 不同依赖语义的断言，以及真正进入 JSON 解析后的取消测试。审查者实际运行只读模拟存储探针并检查代码、diff 和宿主日志；真实服务及浏览器由 C 执行。审查时待结束的完整根测试随后已全部通过。

原架构文件 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。服务端未增加构建组件、执行上传代码或启动浏览器的能力。

## 合并、证据与未覆盖范围

本地 main 合并与本轮开发分支清理待最终根测试结束后记录。日志与截图将归档至主工作区忽略目录 `.tools/operations/phase2-query-completion-2026-11-16/`，四个 managed worktree 采用原生归档，先保存证据并解除工具链 junction，避免触及共享缓存。

公司 OIDC / G2、独立生产域名、部署发布、真实 Vue/React 业务试点及三期自动接入继续独立验收。合成 design ID、真实 SDK 技术验收和本地 JWT 不改变旧 real 评分，也不冒充生产验收。本轮不 push、不创建 tag、不发布生产包。
