# 本地管理端持久化运行链路返工验证

日期：2026-11-27（Asia/Shanghai）。本记录独立于此前验收记录，覆盖本次修复及全量回归发现的问题。

## 复现与根因

原默认开发登录器可以签发临时凭据，但没有初始化持久化成员、接入配置及本地 OIDC，数据库健康时仍返回 503。新增真实编译服务测试最初得到成员接口 503、两个 OIDC 入口 503，均与预期 200/303 不符。

- `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/local-development.test.ts`：首次 RED 为 3 项失败，修复后原 3 项通过；新增预览启用后重启测试最初因 UNAUTHENTICATED 失败，修复后随完整平台套件通过。正式 OIDC 已激活仍拒绝开发默认身份。
- `pnpm exec vitest run tests/gallery/auth-split.test.ts`：两个并发调用最初只有后者得到会话，RED 为 2 项失败；共享请求后 6 项通过，注销及身份切换保护保留。
- 网页上传延迟实际 File.arrayBuffer 读取，先确认产物丢失、同路径旧截图覆盖、单张/批量删除被撤销三种顺序的 RED，再验证 GREEN。修复按路径登记最新操作，切换清单使旧读取失效，使用当前状态合并本次实际读取的文件。
- 全套浏览器初次暴露提示与选择器漂移、身份切换和窄屏问题；同步修正断言与真实行为，手动发布采用测试独占临时材料，真实发布继续消费已有冻结 SDK，不重新打包 SDK。
- CLI 真实新建项目发布曾被严格路径校验拒绝；将 API JSON 通配导出改为精确路径，服务端校验保持原有规则。

本地诊断日志保留在 Git 忽略目录 .tools/local-admin-runtime/（不提交运行时凭据或产物）。关键 RED 日志为 red-platform.log、red-session-race.log、red-preview-restart.log、red-upload-race.log、red-upload-overwrite.log、red-upload-order.log。

## 实际验证

使用系统 pnpm 12.18.0、仓库已有 Node 26.13.0 执行，Windows Chromium 在本机运行。完整构建与类型检查设置 TURBO_FORCE=true，实际输出确认没有缓存命中。测试不进入 Turbo 缓存。

| 命令 | 实际结果 |
| --- | --- |
| pnpm verify:workspace | 11 个固定成员、依赖方向及公开/私有边界通过 |
| pnpm build | 最终版本构建 11/11 成功，0 缓存 |
| pnpm typecheck | 最终版本任务 15/15 成功，0 缓存；根及管理端测试 tsc 均退出 0 |
| pnpm test | 176 个 Vitest 文件通过；2,692 项通过，2 项因缺少 A10_FROZEN_BUNDLE 明确跳过；前置 T10 Node 套件 161 项通过、7 项跳过、0 失败 |
| pnpm test:platform | 隔离 PostgreSQL / MinIO / Verdaccio；47 个文件通过，166 项通过，3 项明确跳过，0 失败 |
| pnpm test:browser tests/browser/manual-release.spec.ts tests/browser/categories.spec.ts tests/browser/web-upload-real-e2e.spec.ts | 27 项通过，包括真实三存储 READY、故障阻断和丢失响应幂等恢复 |
| pnpm test:browser tests/browser/manual-release.spec.ts | 补充读取顺序修复后 13 项通过，含 4 项并发/撤销回归 |
| pnpm test:browser | 最终版本完整回归 342 项通过、0 失败；使用同一冻结 SDK 目录，未重打包 SDK |
| pnpm exec vitest run tests/unit/dev-admin-login.test.ts tests/unit/platform-resource-gating.test.ts tests/unit/admin-login-page.test.ts tests/admin/login-page.test.ts tests/gallery/auth-split.test.ts tests/unit/component-consumption.test.ts tests/unit/workbench-project.test.ts | 最终版本 7 个文件、63 项通过 |
| pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/local-development.test.ts tests/platform/workbench-publishing.test.ts | 最终版本 2 个文件、5 项通过，含本地持久化/两端 PKCE/预览重启及安装后 CLI 双框架真实发布 |
| pnpm dev；node tests/acceptance/local-admin-browser.mjs | 实际开发服务重启后，密码登录、后台 PKCE、画廊 PKCE 三条无请求拦截/模拟会话流程通过；成员与配置接口均 200，无 API 5xx |

最后一次完整构建/类型/结构检查日志分别为 build-release.log、typecheck-release.log、verify-final.log；完整普通套件为 full-test-final.log，完整平台套件为 platform-final.log；升版后的补充平台测试为 platform-release.log。

完整浏览器日志为 browser-release.log；真实开发浏览器日志为 acceptance-release.log。截图保存在忽略目录 test-results/local-admin-runtime/，包括 password-users.png、password-settings.png、admin-users.png、admin-settings.png。原先的 503 场景已经在当前开发服务通过。

独立只读审查覆盖身份与生产边界、撤权、截图示例关联、CLI 精确导出和异步读取操作次序。审查发现的两项 P2（旧读取覆盖新截图、删除被未完成读取撤销）已补 RED/GREEN 并复审关闭，未留待修阻断。

juz-cli 0.1.3 本次测试分发 tarball SHA-256 为 155f9567eee8837b16f940b0843433b609a8fc8a00f7946bd3c5d297536760b7。工作区外消费者安装该 CLI，创建并冻结 React/Vue 独立项目，在本机消费者运行截图；两个作业均 READY，恢复保留原幂等键，所有声明文件摘要逐项复核。React 包摘要为 aad66e3eb0dafe20d13ba075cb851ab835c029eb10f8b6da8e64c1f6f0278f6b，Vue 包摘要为 1c8effb303a76dd7abc5e3d734b941f9dbe135b9fae679c708a3123bb4faef0e。

根测试中 2 项冻结材料专项和平台套件中 3 项可选场景的跳过不作为通过证据：平台缺少 PHASE2_GALLERY_ORIGIN 的搜索/匹配画廊专项，以及缺少 A10_FROZEN_BUNDLE 的 HTTPS IP 分端口专项未执行。本次另行执行的真实网页发布验证不替代这些场景。

## 验收边界与保留项

本次证明本地回环开发模式及隔离三存储链路，不代表生产 OIDC/TLS、独立预览域或真实业务试点验收。服务端没有新增组件构建、上传代码执行或截图浏览器。

原始架构文件 SHA-256 保持 E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723。保留用户已有 next-env 文件改动和另一个外部管理 worktree；只清理本次开发分支。本地合并已获授权，未获得推送授权。
