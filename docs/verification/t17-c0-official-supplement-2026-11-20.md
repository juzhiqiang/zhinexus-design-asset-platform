# T17 C0 官方来源后补核验（2026-11-20）

控制方在本日实际通过网页检索和打开官方来源，补核当前实现采用的 stdio 与 SDK API。此记录不重建原 P0 的访问记录、初始 RED 或探针 stderr，也不更改依赖、产品或冻结包。固定版本和已安装文件的字节身份另见 [当前 C0 证据](t17-c0-current-evidence-2026-11-20.md)。

| 本日实际打开的官方来源 | 核对内容及本次边界 |
| --- | --- |
| `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports` | stdio 由客户端启动子进程，stdin/stdout 传输按行分隔的 UTF-8 JSON-RPC，stdout 只承载协议消息，stderr 可承载日志。仅核该版本 stdio 规则，不把产品说成 HTTP MCP 服务。 |
| `https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/serveStdio.html` | serveStdio 接受服务器工厂并管理连接传输与关闭；legacy 默认 serve，可接纳 2025 年协议的开场。当前产品使用该工厂入口，真实测试通过 SDK 连接。 |
| `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md` | 文档给出 server 根入口的 McpServer、server/stdio 子路径的 serveStdio，以及独立 client 包。与实际包 exports 和产品导入方式一致。 |
| `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/index.md` | v2 示例通过 McpServer.registerTool 注册 schema，再交给 serveStdio。实际产品使用严格输入结构，真实额外字段拒绝由本地测试证明。 |

线上 SDK 文档覆盖的协议能力可能多于本项目显式验收的范围。本次没有升级到线上其他版本，没有据文档存在就宣称所有导出分支或协议版本已运行，也没有把类型声明或官方示例代替当前真实进程结果。当前 CLI 0.0.21 的实际 stdio、授权、取消与规范化对等，以完整根测试 2187/2187 和冻结 live/legacy 各 5/5 为据，见 [冻结包回归](t17-cli-0021-regressions-2026-11-20.md)。

原 P0 独立日志、原初 RED 的完整执行顺序及原始 stderr 空字节仍列为历史追溯缺口；当前依赖、导出、官方规则与实际 stdio 行为已有本日补充证据，不追认过去未保存的结果。
