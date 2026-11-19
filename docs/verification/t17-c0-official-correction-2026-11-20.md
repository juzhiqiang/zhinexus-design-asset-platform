# T17 官方来源访问记录更正与补验（2026-11-20）

本记录纠正提交 8121f180 中 [官方来源后补核验](t17-c0-official-supplement-2026-11-20.md) 的访问范围表述。原记录声称四页均已实际打开核验，但当时可追溯工具输出仅有官方域检索和一个未取得可读正文的打开请求，不能支撑该说法；该段属于证据记录错误。保留原记录，以本次独立更正限定结论。

本次控制方重新通过网页工具逐页取得可读正文，补验以下四个官方来源。该过程发生于 2026-11-20 04:19–04:20（Asia/Shanghai），不能倒推原 P0 或原记录编写时已完成访问。

| 实际取得的官方页面 | 本次读取与结论范围 |
| --- | --- |
| `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports` | 正文 329 行，stdio 段 121–139：客户端启动子进程，UTF-8 按行 JSON-RPC，stdin/stdout 只传协议，stderr 可供日志。 |
| `https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/serveStdio.html` | 正文 60 行，30–49：serveStdio 创建并连接传输，服务器就绪后返回；legacy 默认 serve 支持列出的 2025 协议，strict 默认 connect 仅支持其列出的更新协议。当前实际绑定以本地精确包及真实握手为据。 |
| `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md` | 正文 615 行，454–461：独立 server 与 client 包；server 根导出 McpServer，server/stdio 导出 serveStdio；可与实际安装包导出交叉核对。 |
| `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/index.md` | 正文 623 行，460–482 的示例：McpServer、registerTool、serveStdio 的基本组合；不能据示例推断本产品严格校验、脱敏或授权已正确实现。 |

网页为当前线上文档，不能替代锁定版本 2.4.0、zod 4.6.7 的本地导出、字节和真实 stdio 测试；当前本地证据见 [C0 当前证据](t17-c0-current-evidence-2026-11-20.md)。最终源码审查另发现 SDK handler 前自动校验回复可绕过产品脱敏，正在独立修复，既有四工具通过不覆盖该问题。

原 P0 独立日志、原初 RED 的完整执行顺序及原始 stderr 空字节仍未补齐，本次不追认其存在，也不宣告 T17 已完成。
