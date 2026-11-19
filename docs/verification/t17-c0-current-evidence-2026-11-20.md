# T17 C0 当前依赖、SDK 与 stdio 补充证据（2026-11-20）

本记录是 2026-11-20 的补充取证，不重建 2026-11-19 的原始 P0，不追认未定位的初始 RED。此次只读检查当前锁文件、清单、实际安装的 SDK 导出/类型及已有完整日志；没有重新安装、构建、打包或重复运行通过的测试。新增内容仅为本文件。

## 当前冻结输入与适用范围

CLI 为 0.0.21，来源 HEAD 3fbcfa9b66900c55e254f15e73f318055c6a104f。tarball 位于 D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/cli-0.0.21-432a7805-4921-4c7d-a07d-029bbf7ed010/company-component-cli-0.0.21.tgz，451414 字节，SHA-256 为 7dd4874f0e6c98caddb2de959b942d7bde463c35a04ba82fe31ec67140f5f7cd。

本次执行以下只读差异检查，退出码 0、无输出，确认所检查的依赖清单、锁与 MCP 产品源码相对该冻结来源未变：

    git diff --exit-code 3fbcfa9b -- pnpm-lock.yaml package.json packages/component-cli/package.json packages/component-cli/src/mcp/server.ts

证据仍属于授权临时工程和本地隔离服务；productionAcceptance=false。它不替代最终宿主/33 格矩阵、历史真实业务试点、公司 OIDC 或生产独立预览域验收。完整回归与原件/副本复读另见 [0.0.21 回归记录](t17-cli-0021-regressions-2026-11-20.md)。

## 精确依赖与实际包元数据

[CLI 清单](../../packages/component-cli/package.json) 的运行时依赖精确为 @modelcontextprotocol/server 2.4.0 与 zod 4.6.7；[根清单](../../package.json) 的测试客户端精确为 @modelcontextprotocol/client 2.4.0。[pnpm-lock.yaml](../../pnpm-lock.yaml) 的根 importer 第 175–177 行、CLI importer 第 432–449 行，以及第 3359–3376 行的依赖快照共同固定 client/server/core 2.4.0 和 zod 4.6.7。

实际读取 packages/component-cli/node_modules/@modelcontextprotocol/server/package.json、node_modules/@modelcontextprotocol/client/package.json 与 packages/component-cli/node_modules/zod/package.json，版本分别为 2.4.0、2.4.0、4.6.7。server/client 均声明 Node >=20，未声明 peerDependencies 字段；两者对 zod 的上游 dependencies 范围为 ^4.2.0，本仓实际解析为 4.6.7。不能把该普通依赖范围误称为 peer，也不能据此声称验证过所有 Node >=20 环境。

server/client 的本地包元数据均指向 modelcontextprotocol/typescript-sdk repository 与 modelcontextprotocol.io homepage。此次核对的是已安装包中的元数据，未重新打开官方网页、核验线上最新版本或补造旧 P0 官方来源访问记录。

| 文件（相对工作树） | 字节 | SHA-256 |
| --- | ---: | --- |
| pnpm-lock.yaml | 157340 | ef4ae8928503b090d4b7170fdd9891f5ebbf06f0d882ba9f9ddd47a106db10e2 |
| package.json | 3136 | 1c392334619e65645ff87eb8848e68ddbc77f5ecfdacd1d171255b683de71675 |
| packages/component-cli/package.json | 959 | 26f8e0c3ce4db47151f9531aced795e30252a451cb69a73a4602dfb8e347470f |
| packages/component-cli/node_modules/@modelcontextprotocol/server/package.json | 5102 | c82767fbf0247c56e39a2b757245d56109a538a12ea0b6162fd65a1d3c0a3c52 |
| node_modules/@modelcontextprotocol/client/package.json | 4941 | a93ec75fda93a16032c092b30a36d16c7ade5eab6306ef429dce3e80ae53af45 |
| packages/component-cli/node_modules/zod/package.json | 4142 | c2d190d9ee4e0bdb60332aaa2130a6a98d65ddb903fe1d29248b15de57832c45 |

## 实际导出与声明类型

两个 MCP 包的 exports 均将根 ESM 入口映射到 dist/index.mjs、声明映射到 dist/index.d.mts，并将 ./stdio 映射到 dist/stdio.mjs 与 dist/stdio.d.mts；相应 CJS 分支也在清单中声明。本次读取并计算摘要的是下面列出的 ESM 文件/声明，不扩大为所有导出分支的运行验收。

server 根声明导出 McpServer；dist/mcp-BCJHyo7l.d.mts 第 3246 行声明该类，第 3373 行提供接受 schema 对象的 registerTool 重载。stdio 声明第 62 行导出 serveStdio(factory, options)，接受服务器工厂。client 根声明导出 Client；dist/client-BTIWJvaF.d.mts 第 551、703、1082、1110 行分别定位类、connect、callTool、listTools。client 的 stdio 声明第 54 行提供 StdioClientTransport，第 62 行接受子进程启动配置。zod 根 ESM/类型入口为 index.js 与 index.d.cts。

[产品 MCP 实现](../../packages/component-cli/src/mcp/server.ts) 第 13–14 行按这些包名导入 McpServer/serveStdio，第 185、214、257、310 行注册四工具，第 398 行将创建服务器的工厂交给 serveStdio。宿主配置使用 strict schema；工具 schema 与实际拒绝行为由下节测试覆盖。

| 实际安装文件（相对工作树） | 字节 | SHA-256 |
| --- | ---: | --- |
| packages/component-cli/node_modules/@modelcontextprotocol/server/dist/index.mjs | 70276 | ab7434003c94a09e2c7dec6765647ed600104ad4ebcd347f574dab94f52fcf8d |
| packages/component-cli/node_modules/@modelcontextprotocol/server/dist/index.d.mts | 52051 | c5ed30a09923a42ff6e76c9c75311309ef0ac695762201995fc88b431ecad102 |
| packages/component-cli/node_modules/@modelcontextprotocol/server/dist/mcp-BCJHyo7l.d.mts | 194542 | e69a8b3811163e31e8f328fbab63b25cbabd8eb3ea67b4bf4c0ee9d2075d4801 |
| packages/component-cli/node_modules/@modelcontextprotocol/server/dist/stdio.mjs | 22199 | 892fcad4d0e0c7fa11a88dd769353e298b6d2b445ad833790d16b063e199b10d |
| packages/component-cli/node_modules/@modelcontextprotocol/server/dist/stdio.d.mts | 4678 | fe3a52eab97b6b366c09d83fea89d269d80daa5e5170f0561c250905206aed10 |
| node_modules/@modelcontextprotocol/client/dist/index.mjs | 79439 | b78923b9b9d342109f4fc2a03a9dcea7241fbb89bb2943ec4c9f05a23891b1cf |
| node_modules/@modelcontextprotocol/client/dist/index.d.mts | 128399 | 314d358ab8a1a2a36d984e4bb5768c8a14ee9680ac80b37233a3c3b3b39d0468 |
| node_modules/@modelcontextprotocol/client/dist/client-BTIWJvaF.d.mts | 57634 | 9e8a7724bca48a1b774a35ffc324d57674b714055949cbd5902060086df290a8 |
| node_modules/@modelcontextprotocol/client/dist/stdio.mjs | 6153 | d44adf6ca40eb7a9cafb35dec9658de2b9e17c7dea6be01c06fb8e0d594dc211 |
| node_modules/@modelcontextprotocol/client/dist/stdio.d.mts | 3360 | 332c24a1f3cbbadab8b02c469cce53f5ff091faf2e1cbeed5c623f133e0c0fca |
| packages/component-cli/node_modules/zod/index.js | 422 | 32e7efd49a94a765f6d10a1a0a3c02c50c246def17c80c6f0225f85525d98505 |
| packages/component-cli/node_modules/zod/index.d.cts | 119 | 31506fd6e72c0d09e082b2f0b3741e6bbe90670361c9560ef998bdb1e56edc3e |

## 已有真实进程与 strict schema 回归

当前完整根命令由固定 Node 26.13.0、pnpm 12.18.0 包装器执行 test，日志首行实际展开为 pnpm build:services && pnpm test:t10 && vitest run。2026-11-20 03:47:04 至 03:56:59，T10 168/168、零跳过；Vitest 121 文件、2187/2187，594.49 秒、exit 0。test 本身没有进入 Turbo 缓存；日志中的前置 build:services 复用了服务构建缓存，强制全图构建的独立结果见 0.0.21 回归记录，不混为无缓存根命令。

[根 Vitest 配置](../../vitest.config.ts) 包含 tests/**/*.test.ts，仅排除 tests/platform/**，因此 [project-mcp.test.ts](../../tests/integration/project-mcp.test.ts) 属于该次完整运行范围。其第 231–244 行实际创建 SDK StdioClientTransport、启动 CLI 子进程并 await Client.connect；第 252 行用例经真实 listTools/callTool 断言仅有四工具、verify 不声明只读、额外 approval 字段返回 Unrecognized key、越根请求被拒绝、未绑定或未允许的 endpoint 不发请求、缺失 apply/verify grant 被拒绝。第 358 行覆盖授权全链与 CLI 语义；第 589 行覆盖真实取消与脚本进程树。该日志使用汇总 reporter，没有逐用例名称输出；不能描述成保留了每项调用的原始协议帧。

冻结 CLI 的独立 live 配置实际 5/5、exit 0、543.99 秒；legacy 安装/拒绝配置另为 5/5、exit 0、30.60 秒，两者无名称过滤。live 的四条 Vue/React × CLI/MCP 链来自仓外已安装冻结包；覆盖真实安装、plan/apply/type/build/click/visual、CLI/MCP 规范化语义、无 grant 拒绝和真实 SDK 取消。失败后的无配方 repair 停止证据不等同于成功修复。legacy 另检验 SDK stdio inspect 对等、拒绝未授权写入/验证及输出协议帧形状。strict approval 额外字段的直接断言以上述 project-mcp 回归为据，不将其虚称为 live 的独立用例。

外部路径统一相对 D:/project/zhinexus-t17-acceptance-evidence/2026-11-20：

| 证据路径 | 字节 | SHA-256 |
| --- | ---: | --- |
| cli-0.0.21-432a7805-4921-4c7d-a07d-029bbf7ed010/freeze-manifest.json | 528 | bdc7a3c6bff0d634bd2068ef5d0891f39bc62b4dd2e5c3d47663f11b45e4de26 |
| full-test-0.0.21-final-3477abf8131947849354b18116cc239f/test.log | 20345 | 219a8b3c79ef689ef0d5376ca8634768a3a49c64b27b75cd2c524ef49e8ea5c2 |
| full-test-0.0.21-final-3477abf8131947849354b18116cc239f/result.json | 77 | 38df0e52d720c19de9b6e7c8b39a27c1a40f48b5651c393fbe96be0b96f8028f |
| blackbox-0.0.21-1795115999104/live.log | 230 | abec7861accb33ef3aecfd6c4cffcb6a1d3e095a6306c8d13e3bfb8657ea3fa4 |
| blackbox-0.0.21-1795115999104/installed.log | 243 | c39b31c2a7aba81de121e26003864f0d6fa04e78eb9bbf2b5225a0a4c16e061e |
| blackbox-0.0.21-1795115999104/result.json | 378 | 737c72dc541a66c609ee47d5a80bafec497fcd14b8813436e0a0dbace0b7e394 |
| blackbox-0.0.21-1795115999104/final-independent-reopen.json | 5271 | d1ffbff630c5f1a8623fc6d5df1535c00b06a126160bb9e43679a6f7c0ca5a46 |

final-independent-reopen.json 将同一冻结 CLI 绑定到五份归档 manifest、295 份原件/副本和 17 receipts；其中 live 158 文件/12 receipts、legacy 8 文件/5 receipts，余者为 T15/T16。CLI 前后 SHA 相同，281 个文本 JWT/Bearer 形态扫描为零。完整复读经过与清理保留项以该索引及 [0.0.21 回归记录](t17-cli-0021-regressions-2026-11-20.md) 为准，本次没有再次跑全套流程。

| 当前产品/测试源码 | 字节 | SHA-256 |
| --- | ---: | --- |
| packages/component-cli/src/mcp/server.ts | 16160 | 79aec1b0b18628317583e309b1161eab7023e40403fa663f62343ee588365f6e |
| tests/integration/project-mcp.test.ts | 29473 | dc73c9710ab3a67dd4530e30a3ecf2ad902d4c8a8bcc393d742f7ec45653499d |
| tests/acceptance/t17-blackbox/live.spec.ts | 30377 | 9ce6408acd2bbee088de3857807455e2d873967647eb19c0b44595d938edf5b6 |
| tests/acceptance/t17-blackbox/installed.spec.ts | 15123 | 2acab03d34f1a452ce24b05f121c13c83663112c365714fba1939aeae001c171 |

## 取证命令与历史边界

此次实际执行 Get-Content、rg -n、Get-FileHash -Algorithm SHA256 和上文 git diff，只读检查命令退出 0；所有表格摘要来自 Get-FileHash 的文件原始字节，未从 Git 文本规范化结果计算。可按表内路径重复该命令核对。实际类型检索覆盖 class McpServer、registerTool、serveStdio、class Client、connect、callTool、listTools 与 StdioClientTransport；没有以类型存在代替真实进程验收。

对 docs/verification、T17 设计/计划及可见 operations/外部证据目录的搜索未定位到原 P0 独立日志；5a172921 契约提交本身也未包含该记录。原先有关官方页面阅读、最初握手探针、stderr 为空和初始 RED 的历史说法继续列为来源待追溯。本补充能支撑当前精确依赖、实际导出/类型、严格输入拒绝和真实 stdio 产品行为，不证明原 P0 当时执行顺序或输出。

控制方随后另行打开官方 stdio 规范与 SDK 页面，核验结果新增于 [官方来源后补记录](t17-c0-official-supplement-2026-11-20.md)。这属于本日的后续取证，不改变上文只读本地检查的原执行范围。
