# C：独立 CLI、兼容记录与生产准备集成验收

2026-11-15，Asia/Shanghai，Windows x64。基线 `bea8d3f912115791a322a3448e13797dcf4e92ad`；集成源码 `7183f366f0dfff678348d6be3a7463faafd7949a`。本轮只完成代码、预检、分发与部署准备；用户暂无公司 OIDC、独立部署域和双业务试点。没有推送、发布 npm 包或部署生产。

## 交付与集成修正

- A（Claude）交付 `56634e81dc73c7df8bb17c9c3ef360d4ef9246ac`，r2 bundle SHA256 `f9900ef7bf9c5c1a9ae912591ff4cb618f0270c3e374d7060df402ba1d262932`。验证 bundle 后导入 Windows 分支。按逐文件白名单分发探针及模板，删除前检查源目录/真实路径/输出归属，产物复核不排除污染项。
- B（Antigravity）交付 `70e663f840ed1d6e76ec54c06ba81dfe9a9191f2`，最后代码 `d6e1de91b80581f05daa7a66dea20bfeba0157f6`。独立 CLI 入口、包内默认探针、兼容记录显式接收/查询、迁移 007 及权限和证据校验已集成。
- C 部署准备提交 `225fdf1d`、公共兼容契约提交 `b19e1535`。集成时同步根入口和锁文件；CLI 构建无条件打包并检查资源。CLI 的资源跨包目录，关闭该构建任务缓存，防止缓存回放旧探针。
- C 复现并修复安装后自检漏传 fixtures/tsconfig、`..output` 普通目录漏过包内边界、正常 pnpm 依赖 junction 导致源白名单构建失败；产物枚举仍完整检查。测试 helper 的 POSIX 符号链接创建改为同步，避免未等待的竞争。打包回归 24/24，0 skip。

## 真实安装包与双框架探针

先构建 CLI，实际 `npm pack` 后在仓库外新建消费者执行 npm install；从外部目录调用 `.bin/component.cmd`，未传源码探针覆盖。安装包自身含全部探针、模板和 fixtures，报告 `probe.packaged=true`，`packageRoot` 指向外部 `node_modules/@company/component-cli`。

| 材料/命令 | 结果 |
| --- | --- |
| `company-component-cli-0.0.8.tgz` | 201,353 字节；解包 869,498 字节；183 文件 |
| tarball SHA256 | `1f8188fc6a909b9097226a07216372136e3a64eeaab35b19f14ef31541afad16` |
| tarball npm integrity | `sha512-nhBcZCWwPIuarChGPdxoDePNpdmylwjs6eK0Wt7i2ehrwHDSF5AdeuX2eUb87mm8xFKVrEFpTQUs/Ftn0bcPdA==` |
| 外部 npm install / `component --version` | 成功；0.0.8 |
| 安装目录直接 `node node_modules/@company/component-cli/dist/probe/probe.test.mjs` | 121/121，0 skip，包含实际干净消费者安装及类型检查 |
| 首轮 `component echarts verify`，不提供基线 | 双框架各 7 组件 × 4 展示 = 56；类型/运行/交互 passed；视觉 NEW；hold，CLI 非零 `PROBE_HOLD` |
| 次轮相同候选，以首轮报告为本地基线 | 56 组合，四维 passed；adopt，CLI 退出 0 |
| `scripts/audit-t10-evidence.mjs` 分别审计 hold/adopt | 各重算 56 环境键、字体摘要，核对 56 张截图字节与 SHA256，通过 |
| 安装目录前后摘要 | 183 文件全部相同，无新增/缺失 |

候选是当前冻结 peer `echarts@6.1.0`，来源 `https://registry.npmjs.org/echarts`，两个消费者的 SRI 来自各自实际 package-lock，均与候选相同。Vue 3.5.45 / React 19.3.1，Windows Chromium 158.0.8127.18 / revision 1254。本轮证明独立分发与同环境重复运行，不新增上游候选支持；没有扩大 SDK peer。

人工抽看 line Vue light-canvas、ranking React dark-svg、pie React light-canvas。图形和交互提示可见；ranking 最大值右侧标签贴近裁切边界，是本轮冻结材料已有外观，未改动冻结 SDK。56 张自动比对通过不等于全量人工设计验收，也不能替代业务试点。

安装后自检在本机用直接 `node <file>` 运行；`node --test node_modules/...` 的单次尝试返回找不到文件，未将该失败命令记为通过。

## 兼容 API 真实闭环

新增显式套件 `test:installed-compatibility`，缺 `A10_FROZEN_BUNDLE` 或 `INSTALLED_CLI_EVIDENCE` 直接失败。使用实际安装包生成的 adopt 报告，读取冻结目录原件，逐一核对 manifest 的 199 个 artifact 字节与 SHA；仅在独占 PG/MinIO/Verdaccio 测试栈中发布原始材料，worker 推进至 READY。

两框架 line release 分别接受该报告返回 201；重复提交 409；篡改消费者 ECharts 版本 400。重启 API 后，私有组件匿名查询 404，维护者能读到持久化记录及审计字段；显式设为公开后匿名查询 200、各一条记录、无 reason/subject。原始报告文件未被修改。套件 1/1 通过，退出 0，独占测试栈已关闭。

首次测试误把默认私有组件当公开组件，匿名查询 404；定位 `catalog_can_read` 后修正测试设置并增加私有查询断言，未放宽产品权限。该 API 校验提交证据与权威发布材料及执行细节是否自洽，不是对远端本地执行的密码学证明，也不在服务端执行组件。

复现时，使用冻结目录和实际报告设置两个环境变量，再执行 `scripts/pnpm.ps1 test:installed-compatibility`。本次冻结原件位于 `D:/project/zhinexus-design-asset-platform/.tools/operations/current-sdk/dcc49e73-37c6-4579-a814-713e780ae583`。

## 集成检查

| 检查 | 实际结果 | C 工作树日志 |
| --- | --- | --- |
| 根 build | 10/10 | `.tools/round2-build.log` |
| 根 typecheck / 根 tsc | 14/14，退出 0 | `.tools/round2-typecheck.log` |
| 根 test | Node 166/166、0 skip；Vitest 46 文件 737/737 | `.tools/round2-root-test.log` |
| test:platform | 28 文件、88/88 | `.tools/round2-platform.log` |
| test:browser | 首次 189 passed，真实三存储 6 项缺冻结目录参数；补 `ZHINEXUS_SDK_BUNDLE_DIR` 后该文件 6/6 | `.tools/round2-browser.log`、`round2-browser-real-retry.log` |
| verify:workspace | 10 成员、无环、4 个公开包、安全服务依赖图 | `.tools/round2-workspace.log` |
| 实际 pnpm deploy 两服务导出并静态检查 | API 8,418 文件/160 包；preview 7,970/141；无错误 | `.tools/round2-service-staging.log` |
| 无公司资源直接 Node/tsx 预检 | 模板 passed；27 个必填变量缺失；unconfigured；退出 2；productionAcceptance=false | `.tools/round2-preflight.log` |

保留已有 DEP0190 警告和 Vite 大 chunk 提示，没有把通过写成零告警。pnpm 包装器可能将子进程 2 归一化为 1，直接 Node/tsx 的实际退出码为 2。

## 原件与证据保留

冻结目录有 199 个 manifest artifact，另有 manifest.json/acceptance.json，共 201 文件；前后全量大小和 SHA 差异为零。三包摘要：

- core：`2d9d4208bf070f2478116e500b87ab0748fe5af2793dfa3d13a7c7954212e752`
- Vue：`b01aeec7604b2c399a6cb1efa7b4ba1ac3092f12ea92322c682a188045e8c01b`
- React：`cd625741f37a95f81b395b45bce6a34d439135dcaa1df3ea5989c73159ab8e5c`

原始安装目录为 `C:/Users/10208/AppData/Local/Temp/zhinexus-cli-round2-4702d365c1c546c986146f1ac512a25c`；保留安装包、两个消费者与原报告。tarball、hold/adopt 报告和截图、自检/探针日志另复制到主仓库忽略目录 `.tools/operations/cli-distribution-2026-11-15/`，附 `archive-sha256.json`；原报告绝对路径字段没有改写。adopt 报告 SHA256：`081b931b1e57784bc4ace096451b7002f1bbc52f952bbfcdc106e6a92a251e28`。

## 仍开放的外部验收

公司 OIDC/PKCE 登录与撤权、独立生产 DNS/TLS/浏览器隔离、Linux 镜像运行及最小权限/供应链、告警送达、生产等量容量与备份 RPO/RTO、真实 Vue/React 两业务试点。准备脚本与本地闭环通过均不能关闭这些项目。
