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
- Task 2：4 项新单测 RED→GREEN。冻结候选页派生控件缺失经真实浏览器复现并补齐。新浏览器用例覆盖 React/Vue 独立数字颜色、API 单处新增枚举、嵌套值约束、保留有效画布、保存重载且 controls 仍为空。用例修正了等待异步校验的时序后，完整专用 Playwright 12/12 通过（58.7s），已检查截图。
- Task 2 验证：CLI typecheck 通过；pnpm exec vitest run tests/unit/component-consumption.test.ts tests/unit/workbench-project.test.ts tests/unit/workbench-server.test.ts tests/integration/workbench-templates.test.ts tests/integration/workbench-freeze.test.ts：5 文件、16/16 通过。消费者仍安装同一冻结 tarball，工作台保存未写入派生控件。
- 浏览器环境：主仓库 .tools/playwright 缺当前 headless-shell；实际使用系统 ms-playwright 中已安装的 Chromium 1254，不下载或降级依赖。
- Task 3：生成器 3 项新用例、精确查询 3 项用例、离线元数据一致性、无 ECharts 接入计划及无 ECharts 浏览器验证均观察到 RED 后转 GREEN。普通组件不虚构 CSS/就绪能力；query 的 ECharts 版本可选，真实依赖仍精确校验。补齐 query 双向字段核对，防止远端偷偷增加宿主版本。
- Task 3 验证：contracts schemas:generate、CLI build 通过；pnpm exec vitest run tests/contracts tests/unit/component-binding.test.ts tests/integration/component-query.test.ts tests/integration/match-plan.test.ts tests/integration/project-plan.test.ts tests/integration/project-apply.test.ts tests/integration/project-verify-browser-assertions.test.ts tests/acceptance/t16-a/t16-a-api-cases.test.ts：29 文件、782 通过、1 个既有跳过。无 ECharts 环境的真实 Chromium 验证 13/13 通过；不伪造视觉基线 PASS。
- Task 3 实际消费者：pnpm exec vitest run tests/integration/component-generated-consumer.test.ts 通过。分别构建真实 React/Vue 包、打包并安装到工作区外消费者，从安装后的 API 生成普通接入源码，分别以 tsc / vue-tsc 严格类型检查；不安装 ECharts 或 charts-core，不导入不存在的样式/类型。
- 能力边界：平台的已接受兼容记录仍以 ECharts 组合建模，本轮不迁移数据库或伪造普通组件兼容记录；非图表组件如实返回 COMPATIBILITY_UNVERIFIED，静态发现/描述/类型生成与可执行接入门槛分开。
- Task 4：交付验证执行中。新增跨边界回归先观察到 8 项预期失败：4 个已知事件载荷类型冲突、保存示例的初始值/状态/dataProp、首次目录加载；无 playground 的自定义消费者兜底保持可读。
- 独立最终审查发现 2 项 Important、无 Critical/Minor：事件 payload 与结构化 Schema 可能冲突；首次读取保存示例未应用 API 值校验。两项均已复现，按同一轮 RED→GREEN 修复。
- 审查修复结果：事件基础类型/数组 Schema 复用属性一致性校验；配置了 playground 的文件在首次读取时执行 validateExample，覆盖目录、开发消费者及冻结消费者入口；未配置的自定义消费者不把兜底空对象作为真实参数验证。定向回归 5 文件 40/40 通过；扩大回归 36 文件 808 通过、1 个既有跳过（66.63s）。contracts schemas:generate、CLI typecheck/build 通过。
- 基线核对：在独立的 fix/juz-component-development（db65ce3e）工作区执行 pnpm exec vitest run tests/admin/console-render.test.ts，仍为 6 失败、1 通过；本分支没有改动后台源码和这份测试。失败包含过期页面文案/类名断言及缺少 Next App Router 测试上下文，不扩展本轮范围修复。
- 首次全仓测试使用 T17 默认的缺失 .tools/playwright 浏览器缓存，出现 14 项启动失败，并复现 6 项后台基线失败；已主动停止该轮以修正环境并在最终代码上重跑，不以该次部分输出作为最终计数。T17 重跑显式使用 T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH 指定系统已有 Chromium 1254 缓存。

## 明确边界

- 不交付低代码页面 DSL、布局引擎、编辑器或远程数据源。
- 不声称仅凭标识即可获得权限、兼容性或执行授权。
- 生产 OIDC/TLS、真实业务试点和真实存储发布验收需要单独记录实际结果。
