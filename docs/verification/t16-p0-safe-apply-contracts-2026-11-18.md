# T16 P0 受控应用与安全恢复契约验证

日期：2026-11-18（Asia/Shanghai）。本记录仅验收 T16 Task 1 / C / P0 的 synthetic 契约交付，不把 CLI apply 产品实现、真实 Vue/React 项目 diff、安装恢复黑盒或完整 T16 标记为完成。

## 交付范围

- 新增 apply authorization、apply result、backup、rollback result 四类 v1 类型、运行时 validator 与 JSON Schema。
- 新增合法/失败 fixtures 和契约测试，并同步到 component-cli 的内联契约镜像；CLI 仍不依赖私有 `@company/contracts` 运行时。
- apply result 明确约束状态、issue code、backup、写入及安装证据；issue message 采用固定脱敏 code→message 映射。
- rollback 将 restored、unchanged、preserved 互斥覆盖全部备份候选；preserved path 与同路径 `USER_EDITED` 双向绑定；畸形 backup 上下文返回验证失败而不抛异常。
- Schema 只证明结构与显式上下文关系，不证明真实授权、realpath、并发安全、实际字节摘要、安装结果或用户项目可用性。

## TDD 与审查闭环

初始实现后的独立审查发现四项阻断：preserved path 未强制 `USER_EDITED`、apply 状态可携带伪造证据、issue message 可携带敏感任意文本、畸形 backup 会触发运行时异常。补充反例后的最终 RED 为 **81 项中 7 failed / 74 passed**，失败均对应上述缺口；日志：`.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/task-1-review-red-final.log`。

最小修复后重建 contracts 出口，专项测试 **81/81**；重新生成 Schema、构建 CLI 并同步镜像后再次运行仍为 **81/81**。最终独立复审结论为 **Critical 0 / Important 0 / Minor 0**，四项均关闭；复审未修改、暂存或提交文件。

## 实际验证

所有命令均在隔离 worktree `feat/t16-safe-apply`，使用项目固定 Node 26.13.0 / pnpm 12.18.0 执行。

| 命令 | 结果 |
| --- | --- |
| `--filter @company/contracts schemas:generate` | exit 0；contracts build 通过，四份 v1 Schema 重新生成 |
| `--filter @company/component-cli build` | exit 0；契约同步成功，73 文件打包探针无缺失、污染、链接或改动 |
| `exec vitest run tests/contracts/integration-apply.test.ts` | **81/81 passed**，exit 0 |
| `exec vitest run tests/contracts` | **16 files，435/435 passed**，exit 0 |
| `verify:workspace` | 10 个成员、无环、四个公开包骨架及安全服务依赖图通过 |
| `exec turbo run build typecheck --force` | **20/20 tasks**，0 cached，exit 0 |
| `exec tsc -p tsconfig.json --noEmit`（以参数数组透传包装脚本） | exit 0 |
| `test` | T10 Node tests：168 total，161 passed / 7 skipped；Vitest：**84 files，1574 passed / 1 skipped**；exit 0，Vitest 286.89s |

根测试保留既有 Node `DEP0190` 警告，本轮未新增或修改相关 shell 调用；没有测试失败。

## 派生物与不可变基线

- contracts 与 component-cli 中的 `integration-apply.ts`、`index.ts`、`schemas.ts` 分别逐字节一致。
- 四份提交的 JSON Schema 与 `CONTRACT_SCHEMAS` 按生成格式逐字节一致。
- `git diff --check` 通过，暂存区为空，变更集中无 `dist/` 或 `build/` 产物。
- `component-platform-architecture.md` 未修改，SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
- 没有重新 pack 已冻结 SDK，没有新增 CLI 产品入口，因此不升级产品版本。

## 未完成项

Task 2–4、CLI 本地真实 apply/install/generate/rollback、独立进程故障恢复、npm/pnpm 真实安装矩阵，以及真实授权 Vue 3 / React 19 项目 diff 均未执行。当前只可验收 T16 P0 契约与 synthetic 技术门禁；完整 T16 和 T17 继续保持未完成。
