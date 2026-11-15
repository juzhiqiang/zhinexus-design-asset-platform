# B1 项目上下文表单 Windows 宿主验收

日期：2026-11-15。执行人：C / Codex。分支：`feat/b-phase2-matching`，业务基线 `35dcc2e1`。Claude 桌面端交付页面与纯转换，C 运行固定 Windows 工具链、补回归测试与手机导航样式，A 在独立工作区只读审查。无 merge、push 或发布。

## 交付与边界

- `/match` 继承控制台 noindex，并由控制台导航进入。初始框架/版本/包管理器为空；仅收集 ProjectContext 字段并调用公共校验。
- 需求可增删；未添加的非空草稿阻止校验并保留输入；所有编辑清除旧结果和旧提示；退出清除项目状态，换身份不保留旧需求。
- 不发送匹配请求、不写项目需求到 localStorage/sessionStorage。登录仍调用原有 auth 会话存储；客户端会话门只控制展示，不证明真实 OIDC 身份认证。
- 页面明确匹配服务尚未接入，不生成候选、装配方案或兼容性结论。未改服务端、公共契约、依赖或锁文件。

## RED 与修订

1. 初始纯函数测试缺少实现模块而失败，尚未收集用例；初始浏览器实测页面为 404，1 失败、1 中断、4 未运行。原 noindex 用例被 404 自带 noindex 误判通过，随后每个原用例增加 HTTP 200 断言。
2. 首版通过 27 项表单/契约单测与构建。C 新增草稿编辑与退出换身份测试后实跑 9 项浏览器：7 通过、2 失败。失败分别为两处旧成功提示残留、旧需求列表残留一条。
3. Claude 修复后两项回归转绿。C 扩展网络/存储检查、字段错误关联与 1280/360 视口截图；手机全局导航改为允许整组换行，避免汉字挤压折行。

## 实际执行命令与结果

所有 pnpm 命令通过 `scripts/pnpm.ps1` 使用项目固定工具链。页面构建及浏览器运行设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`。B 在契约交接阶段已完成全图强制构建；本批新增页面后重新构建画廊。

| 命令 | 实际结果 |
| --- | --- |
| `.\scripts\pnpm.ps1 exec vitest run tests/gallery/phase2-context.test.ts tests/contracts/project-context.test.ts tests/unit/web-upload-workflow.test.ts` | exit 0，3 文件 53 测试通过（表单 9、ProjectContext 18、上传工作流 26） |
| `.\scripts\pnpm.ps1 --filter @company/gallery build` | exit 0，Next 编译及生成页面成功，包含 `/match`；最终手机样式修改后已重跑 |
| `.\scripts\pnpm.ps1 --filter @company/gallery typecheck` | exit 0，直接执行 tsc，非 Turbo 缓存结论 |
| `.\scripts\pnpm.ps1 build:services` | exit 0，5 任务成功，其中 3 缓存；仅作为根类型检查的前置产物准备，不当作新一轮全图构建证据 |
| `.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | exit 0，直接检查根测试与脚本类型 |
| `.\scripts\pnpm.ps1 exec playwright test tests/browser/phase2-context.spec.ts tests/browser/gallery-rendering.spec.ts tests/browser/manual-release.spec.ts --config tests/playwright.config.ts --workers=2` | exit 0，25 测试通过（上下文 10、画廊 6、手动发布 9）；最终手机样式修改后重跑，25/25 |
| `.\scripts\pnpm.ps1 verify:workspace` | exit 0，10 成员、无环、4 公开包及服务依赖边界通过 |

截图保存在忽略目录 `test-results/phase2-context-二期-match-项目上下文本地表单-桌面与手机入口和字段错误可读，页面不横向溢出/context-{1280,360}.png`，C 已逐张查看；360px 顶部导航修订后再次查看，标题、字段与操作可读，页面无横向溢出。截图仅是本页 UI 验证，不是组件自动视觉基线或发布材料。

A 独立审查提交为 `5a81a43b`，记录留在 A 分支；无阻断项。其提到的历史 RED 注释已调整为回顾描述。后续 C 仅调整手机导航 CSS、截图前回到顶部及文档，不改校验协议。

## 审计文档口径补充

保留 B 原只读审计与实施交接记录，不重写历史。原审计中“OIDC 未接入 / T05 未完成”应限定为画廊登录流程与公司真实 OIDC 验收：仓库现有 API 已有 Bearer/OIDC 服务端校验实现，不应据前端的展示门推断整个 API 没有鉴权。早期“唯一新增文件”和 RED 状态只反映对应审计时点。

## 未覆盖项

本批未重跑全部 SDK 浏览器、真实网页三存储 E2E、全量平台测试或真实 OIDC/生产域名验收。已有上传浏览器测试部分使用模拟服务，不能替代真实发布链路。网络检查覆盖既定匹配端点和测试需求明文请求泄漏，结合页面无网络发送代码审查；不声称覆盖所有可能的外部环境。T13/T14、多模态检索、30 真实标注样本、真实候选与装配仍未完成。

版本由 C 单独收口为 Gallery 0.0.6，并更新 CHANGELOG；根平台、SDK、CLI 和服务版本不随此页面功能变化。
