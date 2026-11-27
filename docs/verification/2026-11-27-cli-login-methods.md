# CLI 三种登录方式与 HTTP 接入验证

日期：2026-11-27。环境：Windows、Node v24.6.0、全局 pnpm 12.18.0。基线提交 `959c1411`，工作分支 `feat/cli-login-methods`；开始时工作区干净。

## 行为与范围

- `juz login` 交互选择账号密码、浏览器授权或 Token；`--method` 可直接选择，`--username` 隐含密码方式，`--token` 保持非交互登录。三种方式互斥，密码没有命令行明文参数。
- HTTP/HTTPS 均允许，HTTP 登录提示建议使用 HTTPS。保存地址复用、发布前置检查及 integrate 的 API/registry 读取不再限制非回环 HTTP；HTTPS 证书校验仍开启。
- 密码与手动输入 Token 隐藏输入；首次换密需要输入并确认新密码。只保存经 API 会话验证的 Token 与精确 origin，失败保留旧凭据，异源密码入口在发送前拒绝。
- 自托管元数据兼容提供密码入口与后台浏览器表单入口；密码接口只为精确注册的 client 签发对应身份。缺省仍为 web，未知、空值、null 与对象 client_id 拒绝。外部公司身份源不假设提供密码入口。
- 浏览器仍使用 state 与 S256 PKCE；后台页面和错误回跳识别 CLI 回环 callback，身份服务继续核对精确注册 URI。未改变生产 OIDC、预览 HTTPS 策略和现有权限。

## RED 与定向 GREEN

原始日志位于本机忽略目录 `test-results/cli-login-methods/`，不提交完整日志或凭据。

| 验证 | 实际结果 |
| --- | --- |
| 基线 access CLI / credentials / metadata 三文件 | 9 测试通过 |
| 新增行为初次 RED | 10 失败、72 通过；其中 JWK 初始化夹具已修正，独立重跑确认 CLI 期望值仍错误地取得 web client |
| 显式 null client_id 的独立 RED | 1 失败、24 通过，确认被错误地当作缺省 web |
| 非回环 HTTP API/registry 的独立 RED | 1 失败，确认旧逻辑返回 INVALID_ENDPOINT |
| 登录、秘密输入、access、onboarding、identity、后台和全部 contracts 定向回归 | 30 文件、677 测试通过 |
| 真实 Nest/PostgreSQL 定向回归 | 3 文件、6 测试通过，两轮独立环境均通过 |
| 审查者重跑 CLI/secret/contracts | 3 文件、19 测试通过 |
| 审查者重跑 project-plan-network | 1 文件、33 测试通过 |

主要命令：

```powershell
pnpm exec vitest run tests/unit/cli-login-methods.test.ts tests/unit/cli-secret-prompt.test.ts tests/unit/access-cli.test.ts tests/unit/access-credentials.test.ts tests/unit/component-cli-onboarding.test.ts tests/unit/local-identity.test.ts tests/unit/admin-login-page.test.ts tests/admin/login-page.test.ts tests/contracts
pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/cli-login-methods.test.ts tests/platform/local-development.test.ts tests/platform/access-oidc.test.ts
pnpm exec vitest run tests/integration/project-plan-network.test.ts
```

真实平台检查使用独立 Docker 基础设施、独立数据库与 bucket，不访问或修改共享本地平台数据。新增平台用例验证真实密码签发 CLI 身份、默认 web 身份、拒绝未知客户端及错误密码，再用签名 Token 经 CLI 保存和真实会话验证。浏览器 PKCE 协议由 CLI 本地 HTTP 夹具与既有真实平台 OIDC 用例覆盖；不把夹具称作公司身份源验收。

## 工程、浏览器与审查

- `pnpm verify:workspace`：11 个成员、依赖方向、公开包与服务端边界通过。
- `pnpm build:services`：5 个任务实际执行通过。
- `$env:TURBO_FORCE='true'; pnpm typecheck`：15 个任务实际执行、0 缓存，根及后台测试 TypeScript 检查通过。
- `$env:NEXT_PUBLIC_SITE_URL='http://127.0.0.1:5173'; $env:TURBO_FORCE='true'; pnpm build`：串行执行时 11 个任务实际执行、0 缓存通过。首次与 typecheck 并发执行时示例 Vue 缺失重建中的 style.css；没有修改 SDK，串行重跑排除了该执行竞争。
- `pnpm test`：T10 Node 测试 161 通过、7 个既有跳过；Vitest 首轮 172 文件通过、5 文件失败、2 个 worker 错误，2665 测试通过、21 失败、2 个既有跳过。该命令退出 1，不记为全绿。失败组全部按下列真实环境重跑，未修改任何失败用例：
  - T17 要求仓库固定 Node v26.13.0/npm 11.20.0，当前系统 Node v24.6.0 不满足其验收夹具；另需准备匹配的 Chromium 缓存。`$env:T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH=Join-Path $env:LOCALAPPDATA 'ms-playwright'; pnpm exec ./.tools/node-v26.13.0-win-x64/node.exe ./node_modules/vitest/vitest.mjs run tests/acceptance/t17-host tests/acceptance/t17-matrix`：23 文件、306 测试全部通过。
  - `project-inspect.test.ts`、`project-plan.test.ts` 的 worker 在系统 Node v24.6.0 首轮和独立重跑均以 3221226505 退出；`pnpm exec ./.tools/node-v26.13.0-win-x64/node.exe ./node_modules/vitest/vitest.mjs run tests/integration/project-inspect.test.ts tests/integration/project-plan.test.ts`：2 文件、116 测试全部通过。仅确认运行时差异，未在本任务追查 Node 原生进程退出原因或变更 CLI 的最低 Node 支持范围。
  - 因其余组已通过，未再次重复完整长耗时套件；不得把定向补跑改写成系统 Node v24.6.0 下 `pnpm test` 退出 0。
- 本机 Chromium 实际打开当前后台 CLI 授权页：表单可见、密码 type=password、回调保持、伪装回环域名被拒绝，截图已本地检查。没有重启或停止用户已有的前端服务。
- 全仓回归中的 T17 浏览器用例初次因固定 `.tools/playwright` 目录未准备而失败；设置 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH` 指向本机现有 Playwright 缓存后，`pnpm exec vitest run tests/acceptance/t17-matrix/browser.test.ts` 实际 22 测试全部通过。未修改 T17 源码、断言或版本。
- 代码审查者只读检查实现和测试，未发现阻断问题；另用 Windows PTY 的虚构输入确认秘密不回显及 Ctrl+C 可取消。
- 当前本机 API 元数据已返回新增密码/浏览器入口；仅检查公开元数据，没有读取或替换用户登录凭据。

## 升版与最终安装

功能提交：`31c29807`。兼容变化按 0.x 规则递增 PATCH：平台根 0.2.10、CLI 0.1.4、API 0.1.9、admin 0.0.12，CHANGELOG 独立随升版提交。`pnpm install --lockfile-only --ignore-scripts` 返回 Already up to date，锁文件没有手工修改。

升版后再次使用全局 pnpm 执行 `pnpm verify:workspace`、`$env:TURBO_FORCE='true'; pnpm typecheck` 与配置本机 SITE_URL 的 `pnpm build`：分别通过；typecheck 15 个任务、build 11 个任务，均为 0 缓存。

`pnpm --filter @company/component-cli pack:juz` 生成冻结分发包 `packages/component-cli/.release/juz-cli-0.1.4.tgz`（584842 bytes），SHA-256：`fd15cfde4c776f706bdada73b397707ef7feb8ddf68da6c3a50d6de98f857258`。

- 在工作区外新建临时消费者，通过 `npm install --prefix <临时目录> <同一份 tgz> --no-audit --no-fund --foreground-scripts` 安装；真实 postinstall 成功准备 Chromium 缓存，56 个包安装完成。
- 对已安装包实际运行版本/帮助、HTTP 密码登录、浏览器 S256 PKCE 回环夹具、Token 进程登录、凭据隔离及隐藏输入检查，全部通过。这些登录网络服务明确为本机 synthetic 夹具；真实签名和会话由前述 Nest 平台用例覆盖。
- 通过 `npm install -g <同一份 tgz> --no-audit --no-fund --foreground-scripts` 更新本机 CLI，postinstall 成功，`juz --version` 实际返回 0.1.4，帮助含三种登录方式和 HTTP 建议。
- 最终全局 CLI 另用 Windows PTY 输入虚构密码，输出未回显；使用非 HTTP(S) 地址使请求在联网前拒绝，未写入临时凭据文件。
- 安装后再次计算冻结 tgz SHA-256，和上述摘要一致；没有重新打包，没有读取或替换用户原有登录文件。
- 最终构建后，已有 Nest watch 未自动拉起 API/网关。触发原监听进程重新编译，保持原运行环境；临时刷新后已恢复源文件原始字节，`git diff --exit-code -- apps/api/src/server.ts apps/preview-gateway/src/server.ts` 返回 0。最终 `GET http://127.0.0.1:3000/healthz`、`GET http://127.0.0.1:3001/healthz` 均成功，`GET /v1/auth/oidc/cli` 再次确认两种新增入口和 zhinexus-cli 客户端。

## 边界与基线

未执行 npm/Verdaccio 对外发布、push、tag 或合并；未把本机通过等同公司生产 OIDC、远端 HTTP 网络、生产反向代理和 TLS 部署验收。未运行完整浏览器套件，因 5173–5177 上有用户开发服务，改用独立 Chromium 定向检查；完整套件仍须按原规则释放端口后运行。

原架构文件 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。
