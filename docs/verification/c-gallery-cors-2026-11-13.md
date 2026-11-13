# C：画廊 API 跨域修复验证

日期：2026-11-13。分支 `fix/c-sdk14-acceptance`，修复基线 `e490564`。对应 [执行计划](../superpowers/plans/2026-11-13-c-gallery-cors.md)。

## 根因与修复

B 的画廊客户端直接向 apiUrl 发起 JSON/Bearer/Idempotency-Key 请求，API 原本没有启用 CORS。真实 HTTP 复现中 `OPTIONS /v1/releases` 返回404，没有允许来源；单元上传逻辑通过不能证明浏览器跨域可用。

API 现在独立读取既有 `PLATFORM_GALLERY_ORIGIN`，或采用已验证预览配置中的 platformOrigin。仅接受精确 HTTPS Origin，显式本机 localhost/127.0.0.1/[::1] 支持 HTTP；不接受路径、查询、片段、凭据和通配符。若同时有预览配置，两处画廊值必须相同。缺配置不开放跨域。

精确来源回调只允许该画廊，预览域、相似子域、不同端口和 null 均不放行。方法仅 GET/POST/OPTIONS，请求头仅 Authorization/Content-Type/Idempotency-Key，暴露 X-Request-Id，不设置 Allow-Credentials。预检返回204，实际匿名发布仍401，原 JWT、角色和组件权限逻辑未修改。代码没有引入新依赖。

## 实际验证

全部命令经 `.\scripts\pnpm.ps1` 使用仓库固定工具链。

| 命令 | 结果 |
| --- | --- |
| `exec vitest run tests/unit/api-cors.test.ts`（旧dist） | RED：4 failed / 2 passed；允许预检404、loopback缺头、非法配置未拒绝、环境映射缺失均按预期暴露 |
| `build:services` | 5/5通过；API build/typecheck实际重跑，未变动的contracts/网关3项命中已有缓存 |
| `exec vitest run tests/unit/api-cors.test.ts`（新dist） | GREEN：6/6通过，1.06秒；使用真实Nest监听与HTTP，不mock响应 |
| `exec vitest run tests/unit tests/contracts` | 20文件333测试通过，12.00秒；包含无Origin调用的既有bootstrap鉴权回归 |
| `exec tsc --project tsconfig.json --noEmit` | 通过 |
| `verify:workspace` | 通过，10成员、无环、安全服务图 |
| `git diff --check` | 通过 |

独立静态审查未发现 Critical/Important/Minor。上述验证覆盖实际HTTP预检、Origin与配置边界；真实浏览器携带有效身份、选择文件、MinIO PUT/ETag、恢复与发布到READY由B的真实网页E2E继续完成。本轮不据此宣称T08/G2整体完成。

C 的十四实现验收支撑提交为 `e490564`。已向 B 交接 PlatformServices 和精确文件接入范围；本修复的API文件也由C维护，B应使用同一修复产物再执行真实浏览器验证。共享服务与凭据保持原状，不push、不合并main。
