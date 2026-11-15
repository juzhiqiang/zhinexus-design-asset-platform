# C2 当前资格过滤与三方交接验证

日期：2026-11-15。公共契约提交 `e0a7f5ee`；B 原样接入 `dcb4d52e`，12 个文件逐 blob 核对一致。

## 实现与范围

`filterEligibleCandidates` 接收内部索引命中及当前快照读取接口，先过滤并在返回前复读权限、Ready/废弃、包和作业状态、内容与索引 revision、当前 provider、框架与精确 peer。没有宿主 ReactDOM 事实时拒绝需要它的候选，范围 peer 不做猜测。索引仅提供命中与评分，候选身份和证据由当前快照提供。

兼容状态只由服务器接受记录与发布 ID、包名、版本、摘要、框架/引擎精确组合匹配产生。截图来源不提升兼容可信度；缺用途/视觉评分不补零。重复命中去重，过滤诊断不暴露被拒绝的发布 ID，读取异常不返回部分成功。输出复制为独立快照。

这是尚未接路由的内部模块，无数据库/网络/组件执行/截图浏览器依赖。读取适配器必须绑定已认证 subject，并提供真实当前元数据与接受记录；双轮读取不保证跨候选事务一致性，后续 PG 接入需实现该策略。本批不升级 API 版本；T13/T14 均未完成。

## 实际验证

- RED：`.\scripts\pnpm.ps1 exec vitest run tests/integration/search-eligibility.test.ts`，退出 1，新 `dist/search/eligibility.js` 尚不存在。
- GREEN：`.\scripts\pnpm.ps1 build:services` 后，同命令 32 项通过；测试导入真实 Nest 编译 `dist`，快照源为显式注入的合成数据，不冒充 HTTP/PG 集成。
- `.\scripts\pnpm.ps1 exec turbo run typecheck --force`：14/14 任务成功，0 缓存；根 `tsc -p tsconfig.json --noEmit` 退出 0。
- 全图构建 10/10 强制成功和 198 契约测试证据见 `c-phase2-candidate-contract-2026-11-15.md`；过滤器新增后再次执行了服务构建与根 test 前置构建。
- 首次根 `.\scripts\pnpm.ps1 test`：816 通过、1 个 Vue 外部消费者失败，日志显示无法加载 Vue 包导出。当时另一个类型检查进程也重建 SDK，存在产物竞争，不能将此运行计为通过。
- 待所有重建结束后，串行重跑 `.\scripts\pnpm.ps1 test`：49 文件、817 项 Vitest 全通过；另 node:test 166 项中 159 通过、7 跳过、0 失败。完整命令退出 0，未复现消费者失败。
- `.\scripts\pnpm.ps1 verify:workspace`：10 成员、无循环与服务边界通过。
- 原始架构 SHA256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，未改动。

## 独立审查与工程裁决

A 在 `15511ec9` 提交独立审查 `docs/verification/a-review-c2-search-2026-11-15.md`，无阻断项；明确记录未接 HTTP/PG 和事务一致性边界。C 独立复跑 A 修订后 12 项评分测试通过，门槛补齐与稀疏数组修复为 `2bea0082`；30 真实样本仍缺失。

为了让 B 的静态组件测试进入根类型检查，C 维护根 `tsconfig.json` 增加 `jsx: react-jsx`；B 的 Vitest 另显式执行 JSX 转换，保留 Next 的 `jsx: preserve`。测试从 gallery 声明的依赖加载 React，未增加根 React 依赖或修改锁文件。
