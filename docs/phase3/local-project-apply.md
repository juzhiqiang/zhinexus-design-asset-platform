# T16 本地受控应用与恢复

状态：2026-11-18 开发审查修复中。B08 后产品窄测 117 条，97 通过、20 失败、无 pending；失败项阻断合并。B05 的产品 84/84 与真实隔离安装/构建/迁移矩阵 12/12 保留为历史阶段证据。D 首条参数黑盒已通过真实开发 CLI，完整独立黑盒、全量回归与最终冻结 CLI 验收尚未完成。完整 T16 仍需真实授权 Vue/React 业务项目，T17 独立待验收。见 [产品审查记录](../verification/t16-product-review-2026-11-18.md) 和 [实际客户端交付记录](../verification/t16-client-text-delivery-2026-11-18.md)。

先按 [只读接入计划](integration-plan.md) 执行 inspect/plan，把计划 JSON 保存到目标工程外。计划的 `executionAuthorized` 始终为 `false`；每次显式 apply 调用授权当前工程和计划，随后重新检查文件摘要、发布资格和 API。

```text
component integrate apply --project <path> --plan <file> --api-url <origin> --registry <origin> --backup-root <outside-root> --allow-install <true|false> [--workspace <relative-path>] [--output-dir <relative-path>]
component integrate rollback --project <path> --backup-id <id> --backup-sha256 <sha256> --backup-root <dir>
```

workspace 和 output-dir 必须与 plan 的目标一致。备份与安装暂存目录在目标工程外，并与目标同卷；保留 apply 返回的 `backupRef.id`、`backupRef.sha256` 和指定 backup-root。rollback 使用最新的不可变备份引用，拒绝错误工程、篡改摘要及过时引用。备份包含原文件字节，应保存在使用者控制的目录中。

安装只在隔离暂存区用固定 Node 26.13.0/npm 11.20.0 或 pnpm 12.18.0 执行，禁用生命周期脚本和项目 hooks。目标工程的 build/typecheck 及 plan.commands 不执行。支持 npm lock v3、pnpm lock v9 与静态 workspace；影响解析的未支持配置、本地依赖、未知链接、硬链接和跨卷交付会阻断。pnpm 交付采用 hoisted/copy；已知内部状态文件经检查后省略，后续自行 install 会在目标上下文重建包管理器元数据。

生成 Vue SFC 或 React TSX，不自动接入现有页面或路由。source、handler 与 layout 中的文本按数据处理；未知必要绑定拒绝。API 与 registry 凭据分别从 `ZHINEXUS_API_TOKEN` / `ZHINEXUS_REGISTRY_TOKEN` 读取，不互相转发。

stdout 为单个 JSON；exit 0 表示操作成功或已安全回退，exit 2 表示 blocked/recovery-required，exit 1 表示参数、JSON、读取或执行错误。始终同时查看 JSON 的 status、issues 与 installState。

rollback 逐文件核对当前摘要：已匹配原状态的归入 unchangedPaths，可安全恢复的归入 restoredPaths，用户后续编辑归入 preservedPaths，读取/恢复 I/O 失败归入 unresolvedPaths。后两组存在时返回 recovery-required。依赖物化一旦开始，文件恢复后的 installState 保持 reinstall-required；源码备份不保证恢复 node_modules。workspace 多个依赖目录也不承诺跨目录原子事务，部分交付证据与 quarantine 应保留供诊断。

同一冻结 CLI 与 SDK 的消费者验收通过后才可记录技术交付完成。合成工程的成功不替代真实业务项目 diff 或生产验收。
