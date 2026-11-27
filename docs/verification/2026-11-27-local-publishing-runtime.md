# 本地上传发布配置修复验证

日期：2026-11-27。工作区：Windows，分支 `fix/local-publishing-runtime`，基线 `a457f14f`，开始时无已有修改。验证使用仓库准备的 Node v26.13.0 与全局 pnpm 12.18.0。

## 故障证据与本机处置

用户创建上传会话返回 503 `INFRA_UNAVAILABLE`。本机重新验证：账号登录 200，`POST /v1/uploads` 返回相同的 503；API 健康接口、MinIO ready 和 Verdaccio ping 均为 200。开发入口原来只注入数据库配置，未配置 S3，API 因此未初始化 UploadService；也未启动独立发布 worker。健康响应不代表上传能力就绪。

继续检查发现 `.tools/g2-local/credentials.json` 仅有数据库密码，缺少 MinIO 与 Verdaccio 原始凭证。旧容器的 MinIO secret 文件无法复制，Verdaccio 配置挂载指向已不存在的旧 worktree。未读出秘密值，未生成替代旧密码，未改写凭证文件、停止旧容器或删除数据卷。数据库只读检查时 `upload_sessions`、`release_jobs`、`package_releases` 均为 0。

首次本机诊断因缺少存储凭证退出。用户随后明确选择「新建一套隔离的本地 MinIO / Verdaccio，用于发布测试」。已创建 Compose 项目 `zhinexus-local-publish`，MinIO 绑定 `127.0.0.1:19010`，Verdaccio 绑定 `127.0.0.1:14883`，使用新的独立命名卷与随机凭证。镜像复用仓库已核对的固定 MinIO image ID 与 Verdaccio digest；未重建或改动旧 `zhinexus-g2` 容器、卷或凭证。原 PostgreSQL 保留并复用。

本机配置、Compose、秘密和启动辅助位于被忽略的 `.tools/local-publishing-runtime/`；新凭证与旧缺失身份完全分开。已重启本项目开发进程使 API 3000 接入新存储，并启动独立 worker；API、网关与 5173/5174/5175/5177 开发端口均恢复监听。Next 启动产生的两个 `next-env.d.ts` 路径变化已精确恢复，不纳入代码修改。

## 实现范围

- 仅非生产、未显式设置任何 S3 变量且本地 MinIO 凭证齐全时加载本地对象存储，并初始化私有桶。只有数据库凭证时保留原开发能力并警告上传不可用；部分 MinIO 凭证拒绝启动。
- `pnpm dev:worker` 复用数据库和存储；注册表密码只发送到固定本地回环地址，拒绝重定向，发布 token 不保存、不打印、不传入 Turbo 前端任务。生产缺少注册表 origin 时拒绝启动，不能默认回环地址。
- 显式部署配置不混入本地存储身份；迁移仍须显式执行。未修改 API、CLI 发布协议或 contracts，也未改变预览隔离。

## 验证结果

原始日志保留于本机忽略目录 `test-results/local-publishing-*.log`，不提交完整日志、账号凭证或 token。

| 命令 / 检查 | 实际结果 |
| --- | --- |
| 新增行为初次 RED | 7 失败、8 通过；随后独立确认生产 origin 与数据库单独开发的反例 RED |
| `pnpm exec vitest run tests/unit/dev-platform-storage.test.ts tests/unit/dev-platform-environment.test.ts` | 2 文件、20 测试通过；最终定向重跑与只读审查者重跑均通过 |
| `pnpm verify:workspace` | 11 个成员、依赖图与服务端边界通过 |
| `pnpm typecheck` | 命令通过，15 个 Turbo 任务中 14 个命中缓存；不把缓存写为新构建 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 最新实现再次实际检查通过 |
| `pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/uploads.test.ts tests/platform/releases.test.ts` | 独立 Nest/PostgreSQL/MinIO 环境，2 文件、7 测试通过 |
| `pnpm test` 首轮 | T10 161 通过、7 既有跳过；Vitest 168 文件通过、12 文件失败，2688 测试通过、37 失败、2 跳过，退出 1 |
| 原失败 12 文件补跑，设置真实 `PLAYWRIGHT_BROWSERS_PATH` | 11 文件通过、1 文件失败，83 测试通过、14 失败；剩余 T17 浏览器用例另有独立缓存变量 |
| 同时设置两种浏览器缓存变量后补跑 T17 browser / product-executor | 2 文件、51 测试全部通过 |

首轮完整测试的执行环境误设 `PLAYWRIGHT_BROWSERS_PATH` 指向不存在的 `.tools/playwright`，失败输出包含缺失 `chromium_headless_shell-1254`；不得记为全绿。使用当前用户 `AppData/Local/ms-playwright` 后原失败组中的 11 个文件通过，剩余 T17 浏览器文件仍使用独立的 `T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH`。两者均设置后，T17 两文件 51 测试通过，未修改失败用例、源码或断言。未重复完整长耗时套件，不将定向补跑描述为 `pnpm test` 整体退出 0。

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA 'ms-playwright'
$env:T17_MATRIX_PLAYWRIGHT_BROWSERS_PATH = $env:PLAYWRIGHT_BROWSERS_PATH
pnpm exec vitest run tests/acceptance/t17-matrix/browser.test.ts tests/acceptance/t17-matrix/product-executor.test.ts
```

只读代码审查未发现阻断级问题。原始架构文件 SHA-256 保持 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 当前本机真实上传与 worker 发布

通过真实 API `http://127.0.0.1:3000` 登录后，使用单独生成的 web/manual 诊断材料提交，不读取用户登录文件、不伪造自动检查报告。只为唯一诊断组件与 `@g2-probe/upload-probe-1795760885573-*` 包新增私有登记和精确权限，并写入运维审计；不修改已有业务组件或账号权限。材料使用合成 PNG 与无运行逻辑的示例包，明确不作为组件浏览器验收。

- 创建上传会话 **201**；14 个文件的预签名 PUT 均为 **200**；完成校验 **200**；创建发布作业 **202**。
- 作业 `70515712-957f-41e7-87ae-9252683d9752` 由独立 worker 真实经过五个发布阶段，最终 **READY**。
- 只读注册表账号成功下载两个 `0.0.1` 诊断包，SHA-256 与冻结上传材料一致，分别为 `21fa9070de5689f7ec9fda21ef8a2f92c76370a6f7fc56aa22270c24b13e9a56`、`47f41ec286371bac5d7be1a03c7aeb77d349876896be92cda6e1352f0c9edd28`。没有删除、覆盖或重发。
- 匿名对象访问 **403**，匿名注册表访问 **401**。
- 脱敏报告为本机 `test-results/local-publishing-live-probe.json`，完整诊断材料保留在 `.tools/local-publishing-runtime/runs/upload-probe-1795760885573/`。原旧三存储仍运行。

本轮已经保持开发服务及 worker 运行。后续若需重启，在仓库根的两个终端分别执行以下本机辅助（辅助文件及秘密不进入 Git，须保管原目录）：

```powershell
# 终端一：开发服务，显式接入本轮隔离存储
& ./.tools/local-publishing-runtime/start.ps1
# 终端二：独立发布 worker，只有此进程取得注册表发布 token
& ./.tools/local-publishing-runtime/start.ps1 -Worker
```

此时裸 `pnpm dev` 仍按共享 G2 约定查找原凭证；原存储身份缺失未被伪造恢复。本机辅助只设置本轮独立设施的显式环境变量，再调用 `pnpm dev` / `pnpm dev:worker`。Docker 重启后，可用本机 `compose.yaml` 的 `up -d` 启动同一隔离项目并保留其原卷与凭证。

## 未覆盖边界

本轮实测使用 web/manual 诊断材料，未代替用户执行其真实 CLI 组件发布、浏览器验收或干净消费者安装；用户应从原组件项目重试 `juz publish`，复用其冻结材料。没有重新打包用户 tarball，没有改写其截图、报告、摘要或发布状态。生产 OIDC、目标预览域和完整浏览器套件不在本轮验收范围；没有执行 push、tag、合并或对外包发布。
