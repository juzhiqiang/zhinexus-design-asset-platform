# C 对 A SDK 0.0.10 交接文档的独立复验

日期：2026-11-13。仅补充本轮文档修订与消费者片段证据，不改写以前的验证记录。

## 固定输入

- SDK 产品提交：`190b60bfc583fc68611a21d270784017b7f91f11`，三个包均为 `0.0.10`。
- A 文档提交：`e57a6bae95d9911711b3e343cd43f6e2a35d4815`，分支 `feat/t10-sdk-compatibility`；由 Claude 最终回复提供，C 未在其 Linux worktree 映射目录执行 Windows Git。
- 文档：A 输出中的 `docs/verification/t11-t12-sdk-consumer-handover-2026-11-13.md`。
- 文档 SHA-256：`a5f125a18e212c677f18fe55353bee4b281b7a3b01a80706192cf5ca8aec906f`。
- 冻结批次：`.tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583`。复验只读安装已有 tarball，没有重新打包。

## 修订核对

1. Vue SSR 示例补齐 `defineProps`，通过 `onMounted` 开启客户端挂载；KeepAlive 说明与组件自身激活后 resize 的行为一致。
2. `config.chart` 的类型约束与运行时行为明确区分；不再承诺未类型化输入缺失或错误 chart 一定被运行时拒绝。
3. `whenRendered` 明确要求客户端已挂载、容器非零尺寸且渲染已经触发，不作为无条件截图就绪承诺。
4. React 子路径仅声明真实存在的 Props/Handle，Emits 仅属于 Vue；React 示例使用真实 `RankingProps` 与组件导出。
5. 大小写冲突指向实际产物 `ranking.js` / `Ranking.js`；根入口 option/entry 类型的范围按五个实际类型列明，其余从 core 导入。

A 自验曾使用复制 dist 的临时目录，不能称为 tarball 消费者验收。本节的 C 复验另建系统临时消费者，通过 npm 离线安装同一冻结三包，原样提取并编译文档中的 Vue/React 片段。SDK 真实安装在消费者自身 node_modules 内，无工作区源码 alias、无 SDK 声明 shim，`skipLibCheck=false`。

## 实际执行

```powershell
.\scripts\pnpm.ps1 exec node .tools/operations/sdk-policy-audit/a-doc-snippets.mjs <SDK原生归档> <冻结批次> <A交接文档> .tools/operations/sdk-policy-audit/a-doc-snippets.evidence.json
```

结果：真实离线安装退出 0；React 的 TS 6.0.3 / TS 7.0.2 × Bundler / NodeNext 四组，Vue 的 vue-tsc 3.3.14 / TS 6.0.3 × Bundler / NodeNext 两组，全部退出 0。安装前后 tarball SHA-256 一致，文档在运行期间未变；自有临时消费者按前缀校验后清理。原始 JSON 位于上述 evidence 路径。

首次探针因 C 指定 Vue 编译器的相对路径错误而出现 MODULE_NOT_FOUND；改用归档绝对路径后六组通过。该失败属于验收脚本定位错误，不归因于 A 文档或 SDK；原失败证据保留于忽略目录。

SDK 冻结发布、严格公开类型及策略证据见 [原生记录](c-a-sdk0010-windows-2026-11-13.md)，185 项完整浏览器回归另见 [浏览器记录](c-a-sdk0010-browser-2026-11-13.md)。本文只验交接文档和这两段使用示例，不替代全部文档代码块的自动测试。

## 未完成边界

历史 `t09-sdk-evidence-audit.md` 中相似的导出表述不改写；本轮以此独立更正和 A 新交接文档为当前说明。完整 T10 的跨版本视觉/CLI 矩阵、公司 OIDC、生产独立预览域/TLS、真实 Vue/React 业务试点及完整 T11/T12 继续保持未完成。干净消费者不冒充真实业务项目。
