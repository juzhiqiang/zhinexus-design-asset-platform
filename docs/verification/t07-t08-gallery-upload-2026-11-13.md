# T07/T08 画廊真实服务接入与网页手动发布验证记录

- 验证日期：2026-11-13
- 验证分支：`feat/t07-t08-gallery-upload`
- 负责角色：B（CLI / 画廊 / 本地验证）
- 依据标准：`component-platform-architecture.md`、`docs/superpowers/plans/2026-11-11-three-person-allocation.md`

## 1. 验证目标与交付范围

1. **分支收口与主干同步**：将当前开发分支与最新 `main` 同步，完整纳入 C 合入的容量验收、SDK 0.0.5 与 `web-handover` 后端契约。
2. **多组件发布材料与真实静态预览**：覆盖折线图、柱状图、饼图、散点图与趋势卡片（多组件十实现）的冻结候选包构建与真实静态预览生成。
3. **CLI 发布、状态机查询与恢复联调**：验证从不可变包上传、分阶段状态机推进（`FINALIZE_OBJECTS` -> `ENSURE_PACKAGES` -> `REGISTER_ASSETS` -> `CHECK_AVAILABILITY` -> `READY_TX` -> `READY`）、Verdaccio 注册表发布及外部干净消费者的精确安装。
4. **T07 画廊真实服务收口**：
   - 真实 API 对接与未公开资产保护（404 no-store）；
   - 授权预览机制：调用 `POST /v1/preview-grants` 获取短期 `bootstrapUrl` 注入沙箱 iframe (`sandbox="allow-scripts allow-same-origin"`)，并提供独立窗口打开降级；
   - 精确版本安装命令：包含当前版本、`@company/charts-core`、ECharts 6.1.0 及框架版本，附带 Verdaccio 镜像源配置提示；
   - 手动上传来源提示：当 `reportSource === 'manual-upload'` 时，明示无本地自动化回归签名。
5. **T08 网页手动发布与控制台**：
   - 控制台鉴权：未登录访问 `/upload` 渲染 `登录后开放`，且 `meta[name="robots"]` 输出 `noindex`；
   - 逐实现必检（`blocks_submit_when_any_variant_has_no_image`）：待发布组件的每个框架实现（Vue / React）至少关联一张有效截图，任意变体缺图均在前置提示缺失列表并禁用提交按钮（`SCREENSHOT_REQUIRED`）；
   - 框架错配前置阻断（`SCREENSHOT_VARIANT_MISMATCH`）：若截图框架与变体框架不一致，前置拒绝提交；
   - 来源强制固定为 `manual-upload` 与 `unknown-manual`；
   - 提交恢复与任务跟踪：本地持久化发布会话与幂等键，`/jobs/[jobId]` 提供 7 阶段步骤器展示与状态轮询。

## 2. 核心验证命令与结果

### 2.1 浏览器端端到端测试 (Playwright)
```powershell
.\scripts\pnpm.ps1 playwright test tests/browser/manual-release.spec.ts --config tests/playwright.config.ts
```
**结果**：
```
Running 5 tests using 2 workers
  ok 1 tests\browser\manual-release.spec.ts:4:3 › 未登录用户访问发布工作区渲染登录后开放且带有 noindex 保护 (369ms)
  ok 2 tests\browser\manual-release.spec.ts:15:3 › 模拟登录后展示发布工作区与逐实现必检清单 (422ms)
  ok 3 tests\browser\manual-release.spec.ts:33:3 › 缺图阻断：任意变体缺图时禁止提交并展示明确错误提示 (blocks_submit_when_any_variant_has_no_image) (339ms)
  ok 4 tests\browser\manual-release.spec.ts:67:3 › 框架错配拦截：将 React 截图配给 Vue 变体时前置阻断 (SCREENSHOT_VARIANT_MISMATCH) (290ms)
  ok 5 tests\browser\manual-release.spec.ts:87:3 › 独立作业状态机页面支持 7 阶段步骤器展示与状态轮询 (197ms)

5 passed (3.7s)
```

### 2.2 全量浏览器回归测试
```powershell
.\scripts\pnpm.ps1 test:browser
```
**结果**：94 个浏览器测试全部通过（`94 passed (14.4s)`），无任何回归。

### 2.3 CLI 发布与冻结材料测试
```powershell
.\scripts\pnpm.ps1 vitest run tests/integration/cli-bundle.test.ts
.\scripts\pnpm.ps1 vitest run tests/integration/cli-release.test.ts
```
**结果**：
- `cli-bundle.test.ts`: 3 passed in 19.3s（包含五组件十实现全量冻结包构建与静态预览）
- `cli-release.test.ts`: 1 passed in 33.8s（发布至平台、Worker 推进至 READY、Verdaccio 发布及干净消费者安装）

### 2.4 后端手动发布交接验收测试
```powershell
.\scripts\pnpm.ps1 vitest run --config tests/platform/vitest.config.ts tests/platform/web-handover.test.ts
```
**结果**：5 passed in 5.8s
- `hands web clients a durable idempotent manual release and exact public/private material endpoints`
- `rejects web missing-vue material before creating any job or baseline`
- `rejects web missing-react material before creating any job or baseline`
- `rejects web wrong-framework material before creating any job or baseline`
- `rejects web automatic-source material before creating any job or baseline`

### 2.5 平台全量与工程全套验证
```powershell
.\scripts\pnpm.ps1 test:platform
.\scripts\verify.ps1
```
**结果**：
- `test:platform`: 27 个测试文件、87 个测试用例全部通过（180.82s）。
- `verify.ps1`: 工作区 10 成员拓扑、依赖闭包、供应链锁定、全包 build、全量测试与浏览器测试全部通过。

### 2.6 架构基线文档 SHA-256 核验
```powershell
Get-FileHash component-platform-architecture.md -Algorithm SHA256
```
**结果**：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`（绝对一致，保持原样字节不变）。

## 3. 结论

T07（画廊真实 API、授权预览、框架切换、精确版本命令）与 T08（网页手动发布、逐实现截图必检、缺图/错配阻断、任务跟踪）已全部开发完成并通过自动化验证，准备合入 `main`。

