# 同 IP 分端口预览实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for implementation and superpowers:verification-before-completion for delivery.

2026-11-21 用户确认同一台服务器仅有 IP 时，允许先用不同 HTTPS 端口联调组件预览，获得域名后通过配置迁回。独立注册域是默认模式及正式 DNS/TLS 验收目标。原架构文档保持原始字节。

- C 先补配置及 HTTP 回归测试，再实现 contracts、API 和网关。只在显式 `PLATFORM_PREVIEW_MODE=ip-port` 时接受同一规范 IP 上与画廊和 API 不同的 HTTPS 预览端口。域名模式继续生成逐发布主机。
- 网关沿用一次性 grant、授权表、静态文件引用、撤销及摘要验证。IP 模式使用路径中的短期会话标识绑定一个发布版本，省去跨端口共享的 Cookie，浏览器文档使用不透明源沙箱。静态模块使用授权路径和无凭据的 CORS。边缘代理过滤 Cookie 和 Authorization，禁止缓存和记录授权路径。
- B 处理画廊真实发布 ID、获取新授权及 iframe 沙箱。C 分别收口部署配置、预检和浏览器回归，编译后验证旧域名模式和新 IP 模式。
- `verify:workspace`、全图构建和类型检查、根测试、平台预览及部署测试、本地浏览器验证均留存实际结果。目标机部署和公司环境验收另行登记。
