# 画廊 API 跨域修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 用户已要求 C 自行继续执行，本轮直接实施。

**Goal:** 真实画廊浏览器可用 Bearer 与固定幂等键调用 API，跨域许可只返回给配置的画廊 Origin。

**Architecture:** 复用环境变量 `PLATFORM_GALLERY_ORIGIN`，独立映射为 `PlatformOptions.galleryOrigin?: string`。预览配置存在时回退到 `preview.platformOrigin`，显式值须与之相同。Nest 使用精确 Origin 回调、GET/POST/OPTIONS、固定请求头白名单，不允许跨域 Cookie 凭证。

**Tech Stack:** 现有 NestJS/Express、TypeScript、Vitest 与真实 HTTP，不增加依赖。

**Spec:** AGENTS.md、rules/security.md、实施计划 T08 和 B 的真实网页 E2E 交接。

## Global Constraints

- 仅 C 的 API、测试、配置与文档；不修改 B 页面，不重启共享三存储。
- HTTPS 精确 Origin；仅显式 localhost/127.0.0.1/[::1] 允许 HTTP，缺配置不放行跨域。
- 身份仍由 OIDC 验证；不向预览域或任意来源开放，不更改原架构。
- API 兼容修复 0.0.4 → 0.0.5，独立升版提交。

## Review Focus

- 相似子域、不同端口、null 和恶意 Origin。
- 任意请求头反射或意外 credentials 放行。
- 画廊与预览配置冲突。
- 缺配置或带凭据/路径/查询/片段、非本机 HTTP 的配置。
- 匿名预检可完成，实际业务 POST 仍应 401。

### Task 1: 复现、修复和验证

**Files:** 新增 `tests/unit/api-cors.test.ts`；修改 `apps/api/src/platform.ts`、`apps/api/src/app.ts`。

**Interfaces:** `PlatformOptions.galleryOrigin?: string` / `Platform.galleryOrigin?: string`；已有 `buildServer(options)` 保持调用方式。

- [x] 新增真实 HTTP 测试：允许预检204、精确ACAO/Vary、GET/POST/OPTIONS、Authorization/Content-Type/Idempotency-Key、X-Request-Id；实际匿名POST401；拒绝来源与配置边界。
- [x] `exec vitest run tests/unit/api-cors.test.ts` 在旧dist上观察预期失败（4 failed/2 passed）。
- [x] 实现最小配置校验和 Nest CORS，`build:services` 后窄测试6/6、unit/contracts333、根tsc、verify:workspace通过。
- [x] 独立审查无 Critical/Important/Minor，记录结果；中文聚焦修复提交 `1bfbcd2`。

### Task 2: 交付与版本

**Files:** API README、根README、实施评估与本轮验证记录；API package.json、根CHANGELOG.md。

- [x] 同步配置文档与实施计划；B继续MinIO实测与真实网页E2E。提交后交接修复文件。
- [x] API 0.0.4 → 0.0.5，单独 `chore: 升级版本号至 0.0.5` 提交 `3e9921d`；检查确认无需改锁文件。

执行记录：基线 e490564，已确认画廊直接请求apiUrl而API未配置CORS。T08行为范围与鉴权契约不变，本轮补缺失部署通道。
