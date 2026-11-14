# C：离线生产预检与服务发布材料检查

基线 `bea8d3f912115791a322a3448e13797dcf4e92ad`，分支 `feat/c-production-readiness`。本轮始于 2026-11-14，以下最终复核完成于 Asia/Shanghai 2026-11-15。用户明确暂无公司 OIDC、生产域/部署资源和真实业务试点，先完成代码、预检和部署准备。

## 已实现

- `preflight:production` 离线检查部署模板；显式 `--environment` 才检查注入参数。缺配置报告退出码 2，配置/模板错误为 1，通过为 0，始终 `productionAcceptance:false`。固定错误信息与变量名不包含环境变量值。
- OIDC 使用与 API 运行时同一构造校验，拒绝重复或重叠的 web/CLI client IDs、非法 audience、伪装 HTTPS 地址。数据库检查拒绝同一角色和驱动可覆盖角色的 `?user=`。
- `verify:service-staging` 只读检查实际导出包，校验每个服务自己的运行依赖闭包和 contracts、服务身份、入口与非空迁移文件；拒绝另一个服务、客户端/构建包、秘密文件、越界/循环链接、链接服务根与缺失依赖。
- 运维说明补充两个命令的使用方法、pnpm 退出码归一化和真实环境验收边界。

## 失败先行与修正

最初新增部署预检 4 例、staging 4 例均先失败，后实现通过。随后实际目录反例复现链接根、秘密别名、空/目录 SQL 和畸形 manifest；修复后通过。实际 pnpm 导出触发 RxJS 子路径 metadata 名称的误拒绝，加入对应回归后允许合法 `rxjs/ajax` 元数据。

独立审查发现两项：PG URL query 覆盖角色、预览闭包允许 API 服务。两项新增测试均先红，修正后通过。没有连接生产服务、执行导出包脚本或输出凭据。

## 实测

| 命令/材料 | 结果 |
| --- | --- |
| frozen install | 成功 |
| 部署/预检/staging/access 四文件窄测 | 29/29 |
| 根 `tsc -p tsconfig.json --noEmit` | 退出 0 |
| 根 `pnpm test`（审查修正后，兼容契约新增前） | Node 138/138，0 skip；Vitest 733/733，44 文件 |
| API `pnpm deploy --prod --legacy` 实际导出 | 8,405 文件，160 包，检查通过 |
| preview 同上 | 7,966 文件，141 包，检查通过 |
| 无资源直接 Node/tsx 运行预检 | 模板 passed；27 个必填变量缺失；environment unconfigured；退出 2 |
| pnpm 包装预检/exec | 报告 exitCode=2，外层退出 1（pnpm 归一化） |

根测试初次为 723 通过、8 失败，原因是 `.tools/playwright` 无对应 Chromium；按锁定 Playwright 1.65.0 安装 chromium/headless-shell 1254 后复跑通过。保留了 Node DEP0190 的既有子进程 shell 警告，未把警告写成新通过证据。

实际导出位于忽略目录 `.tools/production-staging/`，完整日志为 `.tools/c-round2-final-test.log`。这证明 Windows 导出材料与静态边界检查，不能证明 Linux 镜像启动或生产发布。最终 A/B/C 集成后的 CLI、兼容 API 和全套验证另行记录。

## 仍未验收

公司 OIDC 登录与撤权、生产 DNS/TLS/隔离浏览器行为、Linux CI 镜像运行与供应链/最小权限、告警送达、生产等量容量与备份恢复、真实 Vue/React 双业务试点。没有推送或发布生产镜像。
