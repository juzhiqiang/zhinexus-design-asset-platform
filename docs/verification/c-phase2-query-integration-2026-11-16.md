# C 二期 GET 真实服务集成记录

日期：2026-11-16。P0 基线 `531173793fbbc23819874cbb7909dd7e8f789884`。当前记录先保存实际 RED 和准备证据，最终 GREEN 另行追加。

## 冻结材料

复用已接受的 `current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3` bundle，通过 `A10_FROZEN_BUNDLE` 显式传入。manifest SHA-256 为 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。未重新 pack，未修改旧包。

| 包 | 版本 | tarball SHA-256 |
| --- | --- | --- |
| @company/charts-core | 0.0.11 | 393effb7add8c052ace879b15dc77c4ed9ede87c79469c9519bf97929ee3ccbb |
| @company/charts-vue | 0.0.12 | 51f19262aecc3d81135aa06fce4b630bd37d297d54487eab8b016b61a5bd38d9 |
| @company/charts-react | 0.0.12 | bbc6a1ad1fba272552cdb6468746c33a246c94f49941dfc8bde746fd9c8c5d28 |

C 逐项核对 199 个 manifest 文件的字节数和 SHA；A 修正后的矩阵测试在相同输入下实际 9/9 通过、0 跳过。A 提交 `b12f34ac`、`16741369` 已合入 C：`18c3f8ae`。

## 独立专项入口

`tests/acceptance/phase2-query.config.ts` 只包含两个专项 spec，复用隔离真实 PG/MinIO/Verdaccio global setup。缺少 `A10_FROZEN_BUNDLE` 或 `PHASE2_GALLERY_ORIGIN` 时显式失败，不在默认根测试中加入环境前置。

- SDK 专项：验证冻结清单，上传原始字节，发布到隔离存储，核对注册表包摘要，然后对 14 实现逐项 GET；预期来自 A 独立源码审计矩阵与冻结 API。两框架 line 再把返回发布 ID 转成合成 design ID 的 POST 装配输入。
- Gallery 专项：已构建 Gallery，真实登录与 GET，通过本地 3000 透明代理转发到隔离 Nest；不伪造 API 响应。检查输入变化、撤权、退出后的材料清空和 375px 页面，截图只在本地浏览器执行。

## 实际 RED

固定 Windows 工具链：Node 26.13.0 / pnpm 12.18.0，均通过 `scripts/pnpm.ps1`。

1. `build:services` exit 0。首次 SDK 测试错误引用未公开的校验函数，先修正测试读取方式；该错误不算行为 RED。
2. 设置 `A10_FROZEN_BUNDLE`，运行 `exec vitest run --config tests/acceptance/phase2-query.config.ts tests/acceptance/component-query-sdk.spec.ts`：真实冻结包上传和发布 Ready 成功、注册表摘要核对成功；14 项全部因 P0 无 GET 路由得到 404 而失败，exit 1。日志 `.tools/phase2-c-sdk-red.log`。
3. 使用已构建的 P0 Gallery，设置 `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173`，运行同 config 的 `component-query-gallery.spec.ts`：真实登录成功，缺少查询输入 `#cq-component-id`，1 项预期失败，exit 1。日志 `.tools/phase2-c-gallery-red.log`。测试代理已关闭，C 启动的 preview 会话已停止。
4. 根 `exec tsc -p tsconfig.json --noEmit`：exit 0，确认两专项及配置类型可用。

## 边界

本地签名 JWT/JWK 仅为真实 HTTP 测试身份设施。没有完成公司 OIDC 接入、生产部署或真实业务试点；合成 design ID 不作为真实业务评分。SDK 专项不执行上传组件，不在服务端运行浏览器。冻结 SDK 原有消费者安装与截图证据继续引用原验收记录。

## 集成前独立审查补充

Codex 独立审查发现 GET 的材料读取错误分类尚未覆盖真实存储的 `UPLOAD_INCOMPLETE`（缺失对象，409）和 `LIMIT_EXCEEDED`（对象超过声明长度，413）。只读探针经真实 `ArtifactStore.read` 实现与 `readApi` 证实错误直接上抛；B 正补真实 HTTP 回归，随后只在 GET 读取路径规范化，保留共享 POST 语义。

审查还要求补齐使用侧文档中的条件与动态一致性规则，并让 JSON 解析期间取消用例真正进入 `response.json()` 后再取消。最终结果在后续 GREEN 节记录；此处不代表问题已关闭。

## 集成 GREEN（2026-11-16）

C 已按 A→B→D 合并，提交为 `18c3f8ae`、`56628a35`、`547d4f46`。在这些代码及本次验收文件上实际执行：

- `build` / `build:services`：exit 0；最终升版后另执行全图强制构建。
- 设置上述冻结 `A10_FROZEN_BUNDLE` 与 `PHASE2_GALLERY_ORIGIN=http://127.0.0.1:5173`，启动已构建 Gallery，然后运行 `exec vitest run --config tests/acceptance/phase2-query.config.ts`：2 文件、15/15 通过、0 跳过，exit 0。日志 `.tools/phase2-c-acceptance-green.log`，隔离服务 ID `0d2f3b6a-e5bd-407e-9031-34ec478b3b5d`。
- 14 个 SDK 查询包含逐项冻结字节/API/身份/依赖核对，Vue/React line 均继续完成 POST 身份一致性。GET 包含宿主 peers，POST 保持既有包与运行时依赖语义；校验完整 target 一致、POST 精确运行时依赖为 GET 依赖子集，且 GET 宿主版本独立断言。
- 真实 Gallery HTTP 测试通过 Vue/React 事件及 DOM 依赖、输入修改清空、撤权后材料/依赖清空、恢复读取、375px 无横向溢出及退出登录。C 检查桌面与移动截图，控件和结果可读；截图在 `test-results/phase2-query-acceptance/`，由本机浏览器生成。测试代理、浏览器和 C preview 会话已关闭。
- 独立 D HTTP 5/5、文档示例 3/3、根 tsc 均通过。使用侧文档补全审查要求的动态规则。

存储错误与真正 JSON 解析期间取消已由 B 最终宿主记录的 36/36 平台、112/112 窄测覆盖。最终全图、根测试与完整二期浏览器组见后续总收口记录。
