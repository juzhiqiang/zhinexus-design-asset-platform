# 独立 CLI 分发、兼容记录与生产准备执行计划

> 执行方式：A（Claude）、B（Antigravity）并行；C（Codex）使用 executing-plans 自行实现平台准备并负责最终审查与集成。

**Goal:** 完成无需源码仓库的 CLI 兼容探针、可审计的兼容记录闭环，以及可运行的部署预检和服务发布包检查。

**Architecture:** 保留现有本地探针与三存储架构。CLI 携带探针及白名单资源；API 只验证和保存证据。生产准备复用现有配置验证器，默认离线检查，真实环境验收仍独立记录。

**Tech Stack:** 仓库固定 Node 26.13.0、pnpm 12.18.0、TypeScript、Vitest、Playwright 1.65.0。

**Spec:** 用户在 2026-11-14 批准上一条六项缺口建议及 A/B/C 分工，随后明确“暂时没有，先完成代码、预检和部署准备”。本计划具体化该授权；公司 OIDC、生产域名、部署环境和真实业务项目尚不存在。

## 全局约束与接口

- 基线 `bea8d3f912115791a322a3448e13797dcf4e92ad`；三方均在新分支/独立工作树开发，最终 C 按已有授权本地合 main，不推送。
- A：`feat/a-probe-distribution`；B：`feat/b-cli-compatibility`；C：`feat/c-production-readiness`。
- 冻结 SDK 0.0.10、199 文件、14 实现保持只读；不以候选测试扩大 SDK peer。
- A 维护 `tests/acceptance/t10-sdk/**` 与 `packages/component-cli/scripts/package-probe.mjs`。产物入口为 `packages/component-cli/dist/probe/probe.mjs`，包含必要模板/fixtures/配置；B 接入构建与默认入口。
- B 维护 CLI 源码和 package.json，以及兼容记录专用 API/迁移/测试。公共 contracts 的修改先交 C 协调；根清单、锁文件、infra 和公共文档由 C 维护。
- 兼容接受必须显式授权并核对 release、variant、包摘要及完整证据；缺项、失败、hold 不能成为已验证支持。
- 准备检查不得发出生产通过结论，不连接未配置的公司环境，不输出秘密，不自动部署。

## Review Focus

- 安装后的 CLI 在任意 cwd、源码仓库不可访问时仍能找到探针与模板；写输出不要求安装目录可写（A/B）。
- 打包材料不包含构建残留、密钥或 node_modules；缺浏览器明确失败（A/B）。
- 兼容证据错版本/错摘要/越权/畸形/重复冲突的持久化行为（B）。
- 部署配置与服务实际身份校验保持一致：空白 ID、重复/重叠 client ID、伪装 HTTPS URL、相同预览身份均拒绝（C）。
- 发布包缺入口、越界链接、混入 CLI/SDK/浏览器/开发工具必须失败；预检输出不得泄漏环境变量值（C）。

## Task 1：A 探针分发材料

- [x] 按接口编写真实失败回归，适配资源根与输出目录。
- [x] 以白名单生成 dist/probe，验证任意 cwd、污染目录和包目录只读。
- [x] 执行原探针回归与打包材料的真实消费者验证，交固定提交和证据。

## Task 2：B 独立 CLI 与兼容记录

- [x] 接入包内入口、构建脚本和精确运行依赖，保留显式入口覆盖。
- [x] 核对现有兼容表/协议，给出接口后实现显式接受、查询、幂等和权限检查。
- [x] 完成针对性回归和外部安装准备，提交固定源码与交接记录。

## Task 3：C 部署预检

**Files:** `scripts/verify-deployment.ts`、新建 `scripts/production-preflight.ts`、`tests/unit/production-preflight.test.ts`，维护 `package.json` 与生产准备文档。

**Interfaces:** 复用 `validateDeployment(input, env?)`；新增 `productionPreflight(template, env?, staging?)` 返回仅含检查状态、错误代码/变量名与外部待验收项的报告。未配置返回退出码 2，配置非法返回 1，全部请求的准备检查通过返回 0；任何结果均 `productionAcceptance: false`。

- [x] 基线服务构建、部署/接入窄测试。
- [x] RED：缺配置保持未就绪、非法 OIDC client/URL 拒绝、输出不含秘密、有效配置仅证明准备检查。
- [x] GREEN：复用运行时身份验证规则；新增脱敏离线预检入口，显式 `--environment` 才读取私有环境配置。
- [x] 运行窄测试、真实缺资源命令与根类型检查，记录结果并提交。

## Task 4：C 服务发布包检查

**Files:** 新建 `scripts/verify-service-staging.ts`、`tests/unit/service-staging.test.ts`；维护 `docs/guides/operations.md`、`infra/README.md`。

**Interfaces:** `verifyServiceStaging(root)` 检查 pnpm deploy 的 `api/` 与 `preview/` 两个闭包；命令只读，返回结构化错误和文件计数。仅接受必需服务包与 contracts，拒绝客户端/构建工具和越界链接；不运行包内业务代码。

- [x] RED：缺入口/迁移、错误服务身份、开发包、外链、源文件/敏感文件混入的实际目录用例。
- [x] GREEN：只读验证包目录、依赖清单和链接边界，提供可复现的 staging 命令。
- [x] 实跑两个服务的生产依赖导出并检查；检查与实际结果一致才写验收记录。
- [x] 根测试与类型检查、独立审查；修复后聚焦提交。

## Task 5：C 集成验收

- [x] 导入 A 固定交付，审查 A/B 源码和测试证据；同步锁文件。
- [x] 真正 npm pack/外部安装 CLI，完成可执行入口与兼容探针验证。
- [x] 全套必要检查和真实本地平台兼容记录闭环；修复阻断。
- [x] 更新总验收状态，合并本地 main，复核工作区和未验收项。合并 `2c3ec76e`，main 构建/类型 20/20、Node 166/166（0 skip）、Vitest 740/740；完整证据见 `docs/verification/platform-services.md`。

公司 OIDC/撤权、生产 DNS/TLS、真实双业务项目与生产 SLA 在本轮继续开放，准备脚本通过不改变这些状态。
