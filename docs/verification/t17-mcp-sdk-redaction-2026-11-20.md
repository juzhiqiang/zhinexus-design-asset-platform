# T17 MCP SDK 自动错误回复脱敏补验（2026-11-20）

本记录为最终审查 Important 的独立返工证据，不改写原验收记录。范围仅为 MCP stdio 产品边界及对应回归；本次没有升版、重新冻结 tarball、提交、推送或运行根全量回归。冻结产物验收由 C 后续收口。

## 根因

官方 server SDK 2.4.0 的 tools/call 处理器先调用 validateToolInput，再进入注册工具 callback；strict Zod 校验的错误由 SDK 自行转成 isError 工具结果。未知工具则由 SDK 生成 JSON-RPC error。原 server.ts 的 jsonToolError 脱敏覆盖不到这两条路径，serveStdio 的 onerror 仅处理带外错误，也不重写 stdout 回复。SDK 的错误说明会反射未知 JSON 键或工具名；Zod 说明本身还可能包含已转义 JSON 字符串。

## 变更

- 新增 mcp/transport.ts，以 SDK 官方支持的自定义 StdioServerTransport 在 send 序列化前统一清洗 result、error 和 params，包括字符串与对象键；jsonrpc、id、method 保持协议关联语义。
- 在内存捕获两项已知宿主凭据 ZHINEXUS_API_TOKEN 和 ZHINEXUS_REGISTRY_TOKEN，清洗其原始值及 JSON 嵌套转义表示；同一路径清洗 SDK 带外 stderr 诊断。没有输出环境或凭据内容。
- 四个 inputSchema 仍为 strict，tools/list 的 additionalProperties=false 不变；SDK 原有拒绝、错误码及业务 handler 的授权/路径判断保持。
- 新增正式测试 tests/integration/project-mcp-redaction.test.ts：真实 CLI 子进程原始 stdio、initialize、四工具列举与 strict schema、额外字段拒绝、未知工具协议错误、取消通知、错误后的有效 inspect/list、干净退出与 stdout JSON-RPC 帧完整性。仅通过环境白名单继承系统必要键，凭据全部为合成值；断言失败仅显示泄露布尔值。

## RED / GREEN

所有命令通过 scripts/pnpm.ps1 使用固定 Node 26.13.0 / pnpm 12.18.0。本次只构建本地 dist，没有 pnpm pack。

1. RED：./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-mcp-redaction.test.ts')
   - 退出 1，2/2 预期失败；普通合成凭据与含引号、反斜杠、Tab、换行的合成凭据均在 leaked=true 对 false 的断言失败，前置握手/列举/strict 拒绝/协议错误成立。未输出原始协议帧或凭据。
2. 类型：./scripts/pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','typecheck')
   - 退出 0。
3. 构建：./scripts/pnpm.ps1 -PnpmArgs @('--filter','@company/component-cli','build')
   - 退出 0；contracts 同步、TypeScript 编译及内嵌 probe 清单复核通过，仍为 73/73，缺失/清单外/污染/链接/被改动均为 0。新增 MCP transport 为 CLI 自身编译模块，不属于 probe 清单。
4. GREEN：./scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','tests/integration/project-mcp-redaction.test.ts','tests/integration/project-mcp.test.ts')
   - 初次退出 0，2 个文件 8/8。强化错误后的有效调用以及解析后的 SDK 文本转义检查后再次运行，退出 0，仍为 8/8，耗时 10.69 秒。
   - 两种凭据表示均未进入 stdout/stderr；stdout 均可逐行解析为完整 JSON-RPC 帧。既有官方 SDK 真实双进程 suite 覆盖四工具与 CLI 语义、授权拒绝、verify 取消后的脚本/孙进程树终止及退出。

## 边界

本次证明源码构建产物的本地 stdio 行为；尚未针对新的冻结 tarball 重跑仓外安装、全图、矩阵或黑盒。统一清洗范围为已知的 API/registry 环境凭据及其原始/JSON 转义表示，不宣称通用污点跟踪或任意编码的秘密识别。保留本次及原有临时现场，未执行清理。

## 控制方复验与独立复审

控制方于 04:28:50 以同一固定包装器完整运行新旧两份 MCP suite：8/8、无 skip、10.15 秒、exit 0。独立复审者另于 04:30:07 运行同两份 suite：8/8、9.10 秒、exit 0，并完成 CLI typecheck（exit 0）。

独立流探针的九项检查通过，覆盖 result/error.data/params、对象键、原始及六层 JSON 转义、协议 envelope 和 error.code/progressToken/非字符串值保留、原输入不变、构造时凭据快照。复审同时核对 SDK wire/entry/channel 均经 send，以及实际 dist/mcp/transport.js 与 files=[dist] 分发路径。当前范围无 Critical / Important / Minor。

附加 malformed-input stderr 探针未出现可确认的脱敏标记，其“必须出现标记”断言不计通过；观测无凭据泄露，协议可继续调用并正常退出。该附加探针不抵充正式 suite 或新冻结包门槛，不宣称每条异常 stderr 路径均已独立触发。
