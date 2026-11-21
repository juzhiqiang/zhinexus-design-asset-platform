# 同 IPv4 分 HTTPS 端口预览验证（2026-11-21）

分支 `feat/preview-ip-port` 以 `2cd035ff` 为基线。部署和迁回独立域的步骤见 [IP 预览部署](../preview-ip-port.md)。原架构文档 SHA-256 为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`。

| 验证命令或范围 | 结果 |
| --- | --- |
| `.\scripts\pnpm.ps1 verify:workspace` | 10 个成员、4 个公开包、服务端依赖边界通过 |
| `pnpm exec turbo run build typecheck --force` 与 `pnpm exec tsc -p tsconfig.json --noEmit` | 全图 20/20、0 缓存，根类型检查退出 0。网关路由整理后 `build:services` 及专项平台复验退出 0 |
| `pnpm test` | Vitest 2292 通过、2 跳过。T10 执行 161 通过、7 跳过，退出 0 |
| `pnpm exec vitest run tests/unit/preview-policy.test.ts tests/unit/production-preflight.test.ts tests/infra/access-config.test.ts` | 54 项通过，覆盖域名默认值、IP/端口规则和部署环境配置 |
| `pnpm test:browser`，设置 `ZHINEXUS_SDK_BUNDLE_DIR` 为下列冻结目录 | 312 通过，默认构建跳过 1 项 IP 模式专属用例，退出 0。显式 IP 模式画廊构建和专项 Chromium 4 项另行通过，画廊授权接口使用测试替身 |
| `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/preview.test.ts tests/platform/preview-browser.test.ts tests/platform/preview-ip-port.test.ts`，设置 `A10_FROZEN_BUNDLE` 为下列冻结目录 | 14 项通过，退出 0。覆盖域名模式、一次性授权、Cookie 行为与本机 IP 模式的真实发布到 Chromium 渲染 |
| `pnpm exec tsx scripts/verify-deployment.ts`、`pnpm exec tsx scripts/production-preflight.ts` | 模板检查通过。缺公司参数的离线预检退出 2，`productionAcceptance=false` |
| 独立 Nginx 1.27.4 容器的 `nginx -t` 和本机 TLS 转发 | 使用本机 SAN 证书。实测保留 Host 和端口、过滤 Cookie 与 Authorization、过滤响应 Set-Cookie，并拒绝预览入口以外的路径 |

各 pnpm 命令使用仓库固定工具链包装器执行。首次浏览器全套运行缺少冻结目录变量，两项报缺配置并中止了同组测试，补齐变量后全套复跑通过。

专项使用原冻结 SDK Bundle `.tools/operations/current-sdk/881238b3-2214-4ec8-bf0c-af5238b7fcd3`，其 `manifest.json` 的 SHA-256 为 `04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1`。真实 API、网关、PostgreSQL、MinIO 与 Verdaccio 在隔离测试环境中发布和读取同一份字节。Chromium 在 `127.0.0.2` 的两个 HTTPS 端口以测试证书加载 14 个 Vue/React 实现，覆盖不透明源、无预览 Cookie、多标签页、跨版本拒绝、错误端口、摘要不符、过期、撤销授权和撤销组件权限。

目标服务器的 IP SAN 证书、入口可达性、公司身份提供方和正式独立预览域 G2 门槛待现场验收。
