# B CLI 冻结链路与版本收口补充

日期：2026-11-16。补充既有 T04/T08 计划，不替代历史验证记录或完整 G2 验收。

## 所有权与依赖

B 使用实际 Claude 桌面端负责 CLI 编排与专属测试；C 承担 Windows 宿主验证、独立审查意见收口、版本/根文档及提交。基线为 `feat/b-release-acceptance-20261116` / `36b9cfbd`，业务修复提交 `0ed4a04d`。API/contracts/画廊行为及原架构不变。

## 步骤与验收

1. 已完成：check 截图后核验；bundle 复制身份核对、安装后和每次截图后核验。RED/GREEN、真实冻结消费者与三存储发布证据见本轮 B 验证记录。
2. 已完成：手动提交逐框架缺图/错图/错摘要拒绝及来源约束复验；使用 A 冻结的 core 0.0.10、Vue/React 0.0.11，不重新 pack。
3. C 将 CLI 0.0.9 递增至 0.0.10，同步 CHANGELOG/README；离线冻结安装检查、强制 CLI 构建/类型检查、工作区边界检查。
4. 新 CLI 只 pack 一次，在工作区外干净消费者安装该 tarball；验证真实安装位置、版本、bin/ESM/严格类型、无私有运行时依赖，并校验 A 的既有冻结 bundle。保存摘要与实际结果后独立提交版本变更。

## 完成边界

工程验收与公司环境分开。公司 OIDC、生产独立预览域、真实业务试点仍开放；没有合并分支、push、生产包发布或 T13/T14 真实样本验收。独立 CLI 的 ECharts 默认工作区探针分发问题不在本轮修复范围，既有未验收说明继续有效。

结果记录：`docs/verification/sdk-release.md` 与 `docs/verification/sdk-release.md`。
