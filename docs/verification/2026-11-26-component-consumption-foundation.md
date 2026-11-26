# 组件多场景消费基础验证记录

计划：docs/plans/2026-11-26-component-consumption-foundation.md。

## 基线与执行记录

- 独立分支 feat/component-consumption-foundation，起点 db65ce3e（包含先前 CLI 修复）；原 main d7a7b3f0、先前修复分支均保持不变。
- 原始架构基线 SHA-256：E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723。
- 系统 Node v24.6.0 / pnpm 12.18.0 首次 pnpm install --frozen-lockfile 被已锁定 Angular/Nest 工具的 engine 条件拒绝；不降级依赖，改用仓库固定 Node 26.13.0 的本地引导。
- 本记录只追加本轮真实结果，不覆盖先前 CLI 验证历史。

## 任务状态

- 基线：固定 Node v26.13.0 下 pnpm install --frozen-lockfile 成功；contracts build 与既有两份单测 12/12 通过。
- Task 1：新测试先出现 4 项预期失败；补充类型冲突和 Unicode 长度用例另见 2 项 RED，再全部 GREEN。扩大契约回归发现旧匹配 Schema 的字段展开把新可选字段变为必填，已修正为显式可选。
- Task 1 验证：pnpm --filter @company/contracts typecheck、schemas:generate、CLI build 通过；pnpm exec vitest run tests/contracts tests/unit/component-api.test.ts tests/unit/workbench-project.test.ts 为 24 文件、589/589 通过。
- Ruling：default 只作为注解；组件按正常 Props 默认值执行，不隐式改写用户示例。Schema 属于有界、无引用的 JSON Schema 子集；生成材料注明结构校验与递归/跨字段运行时规则的区别。
- Task 2：待执行。
- Task 3：待执行。
- Task 4：待执行。

## 明确边界

- 不交付低代码页面 DSL、布局引擎、编辑器或远程数据源。
- 不声称仅凭标识即可获得权限、兼容性或执行授权。
- 生产 OIDC/TLS、真实业务试点和真实存储发布验收需要单独记录实际结果。
