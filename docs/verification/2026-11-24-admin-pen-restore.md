# 管理端按 management-api.pen 还原验证记录

**日期：** 2026-11-24
**分支：** `feat/admin-management-api-pen`（自 `main` @ `8531f9f3` 切出）
**范围：** 按 `docs/design/management-api.pen` 还原 `apps/admin` 六个画板的视觉，并对齐设计稿展示的功能。

## 实际执行的验证

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 管理端类型检查 | `tsc -p apps/admin/tsconfig.json --noEmit` | 0 错误 |
| 管理端测试 | `vitest run tests/admin` | 22/22 通过 |
| 管理端生产构建 | `next build`（cwd `apps/admin`） | 8 条路由全部编译并预渲染成功 |
| 既有回归（admin lib 相关） | `vitest run tests/gallery tests/unit/web-upload-*.test.ts tests/unit/release-acceptance-chain.test.ts` | 119+106 通过，0 失败 |
| 测试有效性（变异验证） | 改 `globals.css` 的 `--zn-bg` 一个字符、删 `.zn-motif` 的 `pointer-events:none` | 各自被对应测试捕获，还原后恢复全绿 |

## 环境与已知偏差

- **TypeScript 版本：** 沙箱内 `typescript@7.0.2` 只有 win32-x64 原生二进制（仓库按 Windows 开发锁定），无法在 Linux 执行，故改用同仓内的 `typescript@6.0.3`（JS 编译器）跑类型检查。语言服务版本不同，理论上存在版本相关漏判，Windows 本机需用锁定的 7.0.2 复跑。
- **vitest 配置：** 沙箱副本用 `vitest.config.mjs` + `oxc: { jsx: { runtime: 'automatic' } }` 顶替仓库的 `vitest.config.ts`（该文件在 9p 挂载下因 pnpm 内部符号链接不可读而无法加载）。此改动只存在于沙箱副本，未带回仓库。
- **`next build` 依赖落地：** 沙箱把 `next`/`react`/`react-dom` 从 pnpm store 复制为真实目录，并补 `@swc/helpers`、`scheduler`、`@rolldown/binding-linux-x64-gnu`；这是沙箱复现步骤，不属于仓库改动。

## 未覆盖边界

- **Playwright 未执行：** 沙箱无浏览器，`tests/browser/**` 与 `tests/acceptance/web-upload-*.spec.ts` 一律没有实跑。这些 spec 依赖的 DOM 契约由 `tests/admin/console-render.test.ts` 以静态渲染方式逐条断言，但**不等于浏览器实测**；Windows 本机需执行 `pnpm test:browser`（先 `pnpm build` 并释放 5173–5177）复核。
- **真实 API 联调未执行：** 需要 `apps/api` + PostgreSQL + 本地身份服务；本轮只验证前端自身契约。
- **`/jobs/[jobId]` 未预渲染：** 该路由为 `ƒ`（动态），`next build` 只做编译期校验；运行期渲染由 `console-render.test.ts` 覆盖。

## 与设计稿的已知取舍

设计稿是静态画布，`tests/browser/**` 是可执行契约，两方在五处冲突，一律**保留测试契约、只取设计稿视觉**：

1. `/upload` 的 `h1` 用测试要求的「资产发布工作区 (Manual Release)」，套设计稿的 42px/750/-1 排版；eyebrow 用设计稿的「01 / RELEASE MANIFEST」。
2. 发布作业步骤器渲染 7 步（`.pipeline-step` 契约），视觉按设计稿 stepper。
3. 工具栏副标题拼成「逐实现截图关联与必检清单：每个逻辑组件的 Vue / React 实现必须分别关联有效截图」，同时满足两边文案。
4. Publisher Identity 渲染真实 `session.subject`，不写死设计稿示例的 `demo-publisher`。
5. 接入设置页头三件套**跟随分区切换**——这是设计稿有、原实现缺少的行为，本轮已补齐。

另有两处设计稿元素未进代码：设计系统帧的 Optical Material Telemetry 面板只在该帧自我说明，六个业务画板无对应元素；Aurora 两条「流径」在 `.pen` 是渐变描边贝塞尔曲线，实现保留同一几何与渐变描边，但外层光晕用模糊色块近似。
