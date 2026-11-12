# 本地开发与运维准备

Windows x64：先按根 README 使用 `scripts/bootstrap.ps1` 与 `scripts/pnpm.ps1 install --frozen-lockfile`，固定 Node 26.13.0 / pnpm 12.18.0。启动 Docker 后运行 `scripts/pnpm.ps1 infra:up`；凭证仅保存在忽略的 `.tools/g2-local`。服务配置见 API 与 preview-gateway README。

本地开发执行根 `build`、`typecheck`、`test`、`test:platform`。浏览器前先完整 build，关闭5173–5176开发服务，设置 `NEXT_PUBLIC_SITE_URL=https://gallery.test`，再运行 `test:browser`。不要并行执行 platform/browser：平台测试会重建 SDK dist。

| 运维准备命令（由 scripts/pnpm.ps1 执行） | 作用 |
| --- | --- |
| `rehearse:recovery` | 真三存储传输断连、真实worker终止、上传中断、响应丢失及授权回归 |
| `rehearse:backup` | 全新三存储源栈、协议样本发布、备份、空目标恢复、逐引用摘要检查 |
| `test:infra --no-restart` | 共享G2探针、只读消费凭证、精确安装与局部恢复，不重启共享服务 |
| `verify:deployment` | 静态部署模板检查；输出不代表生产可用 |
| `verify:deployment --environment` | 检查已通过环境变量注入的部署配置，缺项退出非零 |
| `verify:consistency` | 对配置指向的恢复实例只读检查，须注入DB/S3/Registry读取配置 |
| `ops:retention` | 服务已构建后输出到期待审查清单，不执行删除 |

CI只构建服务时运行 `build:services`，其闭包只有API、网关及contracts。组件build/pack、截图、消费者安装与上述演练只能在开发机/相应本地验收环境执行，不能进入服务镜像或Turbo测试缓存。

公司OIDC未配置时不能完成真实CLI/网页登录发布。合成JWT与协议包只能证明本地机制；当前SDK完整材料、真实业务项目与干净环境完整发布仍由A/B/C共同验收，详见 [发布约束](publishing.md) 与 [上线验收](release-acceptance.md)。
