# T16 验收令牌与 C 检查点

日期：2026-11-18。仅记录 C 的验收基础设施修复与阶段状态，不标记产品或完整 T16 通过。

## 令牌期限 RED→GREEN

独立审查发现：安装矩阵原先只签发一次 5 分钟 API token，各 CLI 进程可运行 15 分钟，全测试可运行 20 分钟；后续操作可能因凭据过期返回 401，掩盖实际产品结果。

新增 `tests/platform/http-token.test.ts` 使用真实隔离 PostgreSQL/MinIO 和平台签名 helper，独立解码签出令牌并验证签名、issuer、audience、subject 与 CLI client。RED 中原默认控制通过，长任务令牌断言得到 `300 != 1200`：2 collected / 1 passed / 1 failed / 0 pending，exit 1。增加 helper 的可选第四参数后 GREEN 为 2/2，exit 0；未传参数仍固定为 5 分钟。

T16 安装验收在每次 CLI、匹配、上传、发布、状态查询与兼容请求前重新签发 20 分钟 API token。全部历次 API token 保留于内存 Set，与 registry token 一起检查所有进程原始输出；证据保存前逐个替换为 `[REDACTED]`。泄漏断言只比较布尔值，避免失败消息回显凭据或原始输出。未改变生产鉴权、共享默认期限或产品代码。

实际命令（通过固定工具链 wrapper 执行；JSON 与同名日志保留在 ignored `.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/`）：

```powershell
.\scripts\pnpm.ps1 -PnpmArgs @('build:services')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/platform/vitest.config.ts','tests/platform/http-token.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c-token-red.json')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/platform/vitest.config.ts','tests/platform/http-token.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c-token-green.json')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','--noEmit','--ignoreConfig','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023','--strict','--skipLibCheck','--esModuleInterop','tests/platform/http-token.test.ts','tests/acceptance/t16-installed.spec.ts','tests/acceptance/t16-installed-global-setup.ts','tests/acceptance/t16-installed.config.ts')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','turbo','run','build','typecheck','--filter=@company/platform-api','--filter=@company/preview-gateway','--force')
.\scripts\pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/platform/vitest.config.ts','tests/platform/http-token.test.ts','tests/platform/harness-cleanup.test.ts','--reporter=json','--outputFile=.superpowers/sdd/2026-11-18-phase3-t16-safe-apply/c-token-final.json')
```

首次 `build:services` exit 0，但 5 项均为缓存命中，不作为重新构建证据。之后强制构建/类型检查 5/5、0 cached，exit 0；窄 TS7 exit 0。独立复审确认令牌期限、重新签发及全历史脱敏收口。

强制构建后的令牌与既有 harness 清理回归共 3/3、0 failed、0 pending，exit 0；未复用测试缓存。提交前将上面的窄 TS7 命令增加三个 `tests/integration/project-{apply,rollback,install-isolation}.test.ts` 文件再执行，exit 0，证据 `c-checkpoint-typecheck.log`。

## 当前产品与实际客户端门槛

此前三文件完整产品结果为 84 collected / 73 passed / 11 failed / 0 pending，exit 1，保存于 `product-current-red-84.json`；本轮令牌修复没有重跑真实安装矩阵，不更新其通过状态。失败覆盖 React 权威类型/事件 2 项、固定裸 Node 探针 3 项、pnpm 设置/内部环境 5 项，以及普通 npm hidden lock 1 项。各类 RED 与安全控制见独立 B brief、npm/pnpm 验证记录。

B 实际 Claude 桌面已收到补修任务，当前重新挂接指定目录弹出 Allow 权限窗口，尚未继续产品补修。D 按用户要求恢复默认模型且未使用 `--model` override，文件工具限定重试在 3 轮后 exit 1，返回工具调用无法解析；未生成黑盒测试。默认配置保持原样，不能用 C 或 reviewer 替代其交付。

本检查点只提交 C 拥有的测试、harness、brief 与记录，保留 B 产品未提交源码。真实 8 项安装/重定位矩阵、4 项恶意配置验证、D 冻结黑盒、全分支审查、版本升级、单次 pack 冻结和本地 main 合并仍未完成；无真实业务项目时完整 T16/T17 仍未完成。不 push、不清理 worktree 或原始仓外证据。

原架构文档 SHA-256 实际核对为 `e59bb77ede1497d349fcc5eae49bf892e1c92572f4777535ff13b89e1a371723`，字节未变。
