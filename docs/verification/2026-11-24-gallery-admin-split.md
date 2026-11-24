# 画廊与内网管理端拆分：集成验证

日期：2026-11-24。集成分支：feat/gallery-admin-split，从本地 main fcd75253 开始。原 D:/project 工作区和在途本地身份/设计稿修改未纳入此分支。本文为新增记录，不覆盖历史验证。

## 实现与审查

- 反重力桌面端实现两个独立 Next 应用、路由迁移、受保护资产库与回归测试，提交已集成为 4b014fa6、cb15b677。
- API 实现代理提供双 origin、服务端绑定的登录 target、迁移014与真实浏览器共享 Cookie 测试，集成为 029578e6、f5089fe6。
- Claude 桌面端完成独立安全审查和 Nginx 入口模板/测试。Codex 负责集成、实际 Docker 验证、问题修复、根配置与部署指南。
- 独立复审发现并修复4项：私有子请求被拒后残留数据、账号切换重检时旧数据残留、退出后迟到会话写回、私有兼容记录误用公开版本。复审确认四项均关闭；两端原注销竞态复现返回 null。

## 已执行验证

所有工作区命令通过固定 Node 26.13.0 / pnpm 12.18.0 的 scripts/pnpm.ps1 执行。原始日志保留在集成工作树 .superpowers/sdd/2026-11-24-gallery-admin-split/（忽略目录，不提交可能含运行细节的日志）。

| 验证 | 实际结果与日志 |
| --- | --- |
| install --frozen-lockfile | 通过；锁文件仅增加 admin importer，无运行时新依赖 |
| verify:workspace | 11成员、无环、4公开包、服务端安全依赖图通过 |
| turbo run build --force | 11/11成功，0缓存；build.log |
| turbo run typecheck --force + 根tsc | 15/15成功，0缓存；根tsc通过；typecheck.log、root-typecheck-final.log |
| 最终前端 build/typecheck | 5/5成功，0缓存；frontend-final-build.log |
| pnpm test | T10：161通过、7跳过；Vitest：141文件、2382通过、2跳过；root-test.log |
| 目录真实平台测试 | 12/12；catalog-platform.log |
| API OIDC真实平台测试 | 1/1；api-oidc-platform.log；先构建CLI后通过，保留初始缺产物失败日志 |
| Nginx入口+生产预检专项 | 20/20（入口13、预检7）；ingress-final.log |
| 上传恢复/摘要浏览器专项 | 12/12；upload-acceptance.log；使用已有冻结SDK，不重新打包 |

浏览器首轮321通过、1失败：contracts-runtime的测试模块白名单遗漏managed-accounts，新增该既有契约模块后该项1/1通过（browser-contracts-green.log），完整重跑322/322（browser-rerun.log）。

入口测试使用本机 Docker、摘要锁定的 Nginx 镜像，实际执行两份 nginx -t。先后发现并修复正则转义/量词引号、大小写登录参数匹配、测试速率限制干扰与默认1MiB上传体限制。2MiB应接受/9MiB应拒绝用例先RED后GREEN；最终入口13/13通过。

平台专项首轮8通过、2失败，定位到旧账号测试缺identity初始化及过时响应包装；补齐fixture后进一步发现真实roles text[]写入错误。独立修复41bbeb12仅将两处roles参数改为原生数组，管理员/角色/版本和撤权校验均保留；账号创建/更新3项先RED再GREEN，鉴权单元28项通过，独立复审无阻塞。集成重跑账号、迁移、上传及真实跨端浏览器会话4文件11/11通过（platform-rerun.log）。

最终升版树完成22/22 build/typecheck（0缓存）与根tsc；版本后 frozen install 与11成员图校验通过。test:gallery-cache 四次真实构建与HTTP sitemap origin检查均通过（gallery-cache-final.log）。pnpm dev 实际由Turbo启动11包；5173首页及/library、5177/upload、5174/5175示例、3000/3001健康检查均200，5173/upload为404（dev-smoke.json）。开发进程仅用于验收，已停止本次启动的进程树。

## 证据边界

- 真实浏览器共享会话测试使用 Chromium、TLS、本地签名OIDC/PKCE、真实API与PostgreSQL，验证两origin、host-only Cookie、CORS/CSRF和跨端退出。承载页面是最小HTML；Next界面另由浏览器套件覆盖。这不等于公司IdP或正式DNS/TLS验收。
- 上传真实端到端复用冻结SDK批次39f845ad-b174-4340-98f6-9dc2ab083764；manifest SHA-256为5934c8b6d42b0110964d83530bda1bfd04d9186e5ea803a18f853f8ae50edfc2，与既有acceptance记录一致。本次未重pack或改冻结产物。
- 私有内容由既有逐组件权限决定；本次未自动公开任何数据库资产。管理端隔离需要真实内网/VPN、TLS入口和源站防火墙按部署指南配置，本次不执行生产部署。
- 公司IdP、生产DNS/TLS、真实公网/VPN、生产预览域与整套生产运行门槛未验收，不据此改写历史T01–T17完成状态。
- 根套件中的7项T10与2项Vitest跳过均因未设置独立A10_FROZEN_BUNDLE，不能据此声称冻结SDK升级验证完成；本次网页发布套件使用自己的ZHINEXUS_SDK_BUNDLE_DIR明确指定冻结批次。没有将Docker入口测试跳过算作通过。

## 最终集成补录

最终运行基于3c9357fc代码树：root-test-final.log记录141文件、2382通过、2跳过（469.55s，退出0），前置T10为161通过、7跳过；browser-release-final.log记录322/322（2.2min，退出0）。测试未通过Turbo缓存替代执行。账号平台最终11/11、上传专项12/12、入口13/13及生产预检7/7均已通过。

原始架构文件在集成树与原工作区的SHA-256均为E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723，且相对main基线无差异。原工作区保留在chore/gallery-design-restoration分支862fc980，其本地身份服务、设计稿和其他既有修改未暂存/提交到本次分支。

| 提交 | 目的 |
| --- | --- |
| 5fca5df8 | 明确拆分边界、责任与验收计划 |
| 029578e6 | 双origin与持久化登录目标 |
| 4b014fa6 | 独立管理端、画廊私有资产库与路由迁移 |
| cb15b677 | 四项私有状态/鉴权竞态审查修复 |
| f5089fe6 | 真实浏览器跨端会话协议验收 |
| 38a0c6c1 | 公网/内网入口、真实Nginx测试与部署指南 |
| 079b26d3 | 工作区、锁文件、编排及验收入口同步 |
| 6b60f4ec | 浏览器契约模块夹具补齐 |
| 41bbeb12 | 账号角色PostgreSQL数组写入修复与真实回归 |
| 3c9357fc | 独立升级root/gallery/API至0.1.0、admin至0.0.1 |

合并策略：原工作区保持不动，在已验证的隔离工作区清洁提交后切换本地main，使用--ff-only合并。合并后核对tree完全一致，重新执行verify:workspace及根tsc；不推送远程，不部署生产。
