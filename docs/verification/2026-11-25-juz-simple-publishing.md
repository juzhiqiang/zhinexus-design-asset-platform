# juz 简化发布验证记录

日期：2026-11-25。分支：`feat/juz-simple-publishing`；开工基线：`728135ae451aa8055a1f98396bad4e0fa7cb6987`。

## 范围与环境

- 简化 `juz init/login/dev/package/publish`，交互框架/分类、Token 登录及保存 API origin；本地 ZIP、独立 `juz-cli` npm 分发包。
- 真实项目构建、冻结 tarball、外部消费者安装/截图及原会话恢复继续使用已有流程；服务端不执行组件代码。
- 本机 Windows，系统 Node `24.6.0`、pnpm `12.18.0`。CLI 指南已移除固定 Node `26.13.0` 的要求；没有修改旧 T17 验收工具链。
- 独立 npm 全局安装使用临时 prefix 与临时凭据文件；没有发布 npm，没有推送 Git。

## 实际执行结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @company/component-cli build` | 通过；契约内联、probe 分发清单复核通过 |
| `pnpm --filter @company/component-cli typecheck` | 通过 |
| `pnpm verify:workspace` | 通过；11 个成员，无循环依赖，公开包及服务端依赖边界通过 |
| 下列 11 文件窄范围 Vitest | 100/100 通过 |
| `pnpm exec vitest run tests/integration/project-publish.test.ts -t "installs juz-cli globally"` | 1 通过，21 未选择；真实独立安装及发布链路通过 |
| `git diff --check` | 通过 |
| `pnpm test` | 未通过；详见全仓阻塞 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 未通过；56 条既有后台相关诊断，本轮新增测试类型错误修复后已消除 |

最终窄范围命令：

```powershell
pnpm exec vitest run tests/unit/component-cli-onboarding.test.ts tests/unit/project-init-package-ignore.test.ts tests/unit/project-cli.test.ts tests/unit/project-archive.test.ts tests/unit/juz-distribution.test.ts tests/unit/bootstrap.test.ts tests/unit/access-cli.test.ts tests/unit/access-credentials.test.ts tests/unit/echarts-cli.test.ts tests/unit/release-fingerprint.test.ts tests/integration/project-plan-consumer.test.ts
```

### 行为证据

- 独立分发 tarball 通过 npm `--global --prefix <临时目录>` 安装，真实 PowerShell `juz` shim 能读取版本；分发包不运行时依赖内部 CLI 或私有 contracts。
- 无平台登录运行 `package`，之后 Token 登录并运行无参数 `publish`、再次 `publish`；本地只构建一次，HTTP 上传字节逐文件等于冻结材料。另一全新项目直接 `publish` 也只构建一次。
- 上述集成测试真实运行本地组件构建、工作区外消费者依赖安装、Vue/React 预览构建和 Chromium 截图；平台 HTTP 接口使用测试服务器，不能代替真实 PostgreSQL/Verdaccio/MinIO/OIDC 验收。
- ZIP 在 Windows 上真实解压，含 Unicode 路径，原始 manifest 与所有声明文件字节一致；未声明目录和会话不入包，篡改及链接越界被拒绝。
- 初始化保留 `.npmignore` 或 `.gitignore` 语义，避免发布目录进入下一次组件打包；`files` 绕过忽略规则时，在消费者导入组件前拦截。
- 新材料输出在包内时，只接受 `.component-releases/` 严格子目录；包外目录允许，保护目录本身、路径折返及 junction 绕行被拒绝。合法路径单测只证明实际 build 被执行，完整发布证据由独立安装集成测试提供。
- 自定义旧目录中的合法冻结材料仍能恢复到真实 HTTP 上传请求，测试以受控 401 结束；未重建组件、未改写清单。
- 重复打包分发包时，旧版本 tgz 与当前版本共存，返回当前版本的路径和真实摘要。回归测试先观察错误，再修复为空临时目录内打包。
- 最后只读审查确认自定义输出目录递归夹带问题已消除，无新的实质问题。

## 全仓阻塞

`pnpm test` 的前置 Node 测试报告 168 项，161 通过、7 跳过、0 失败。随后 Vitest 报告 146 文件通过、5 文件失败；2517 项通过、7 失败、2 跳过，另有 2 个 worker 错误，整个命令退出 1。

1. `tests/admin/console-render.test.ts` 无法从根测试解析 `react`，收集失败。根 tsc 还报告后台页面 NodeNext 相对导入扩展名、Next 模块解析与页面 props 类型等问题。
2. T17 的 `product-executor`、`chain`、`chain-failure`、`runner` 共 7 项测试仍要求固定 Windows Node `26.13.0` / 仓库 `.tools` 路径；其中一个清理阶段还报告目录 inventory 不一致。这些文件及后台目录与开工 HEAD 一致。
3. `project-inspect.test.ts` 与 `project-plan.test.ts` 的 worker 以 `3221226505` 异常退出。单独复跑两文件仍得到 91 项通过及 2 个 worker 错误，原因未解决，不能将这两组标为通过。

本机日志保存在忽略目录 `.release/juz-test.log`、`.release/juz-root-typecheck.log`、`.release/juz-recheck-project.log`、`.release/juz-focused-tests.log`、`.release/juz-installed-publish.log`。未将这些日志作为分发包内容。

## 交付边界及工作区情况

- 本轮 CLI 可本地安装测试，尚未执行 npm 发布。后台当前需解压 ZIP，再导入 manifest 与材料目录；直接 ZIP 入口不属于本次 CLI 实现。
- 初次接入仍需真实项目维护组件代码、API/docs、消费者示例和就绪协议；CLI 不生成虚假业务代码或验证结果。
- 测试 RED 阶段暴露旧登录未遵守自定义凭据路径，合成测试凭据曾写入默认登录文件。确认该文件匹配本轮测试值后已移除，并修复路径统一及测试用户目录隔离；此前登录状态是否被覆盖无法确认，已有登录的用户需重新 `juz login`。
- RED 阶段误走旧 SDK 路径产生未跟踪 `.release-bundle/`。自动审批拒绝清理，目录保留且排除提交；没有绕过拒绝再次删除。
- 原始架构文件保持不变：Git blob 与 HEAD 相同；SHA-256 为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。
