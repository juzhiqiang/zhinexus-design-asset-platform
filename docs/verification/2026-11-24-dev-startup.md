# 2026-11-24 开发启动与端口冲突排查

- 范围：T01 本地开发入口，C 负责根编排检查；串行排查，无协议或业务代码变更。
- 用户日志明确显示 React 示例 `Error: Port 5175 is already in use`。当时的占用进程已无法从当前状态追溯；不能仅凭末尾 `Failed: @company/gallery#dev` 判定画廊自身的失败原因。日志中的 pnpm 位于全局 `C:\nvm4w\nodejs` 路径，本轮统一使用仓库固定工具链入口。
- 根 `package.json` 的 `dev` 为 `turbo run dev --concurrency=12 --cache=local:rw`；`turbo.json` 中 `dev` 配置为 `dependsOn: ["^build"]`、`cache: false`、`persistent: true`。

## 实际验证

1. 执行 `.\scripts\pnpm.ps1 dev` 两轮，每轮日志均显示 `turbo 2.11.10`、`Running dev in 10 packages`，Next、两个 Vite 示例及两个 Nest 服务均启动成功，watch 编译无错误。上游构建存在本地缓存命中，不将其计为重新构建验证。
2. 第二轮使用 `Invoke-WebRequest -UseBasicParsing -TimeoutSec 15` 请求以下入口，全部返回 HTTP 200：

   | 入口 | 结果 |
   | --- | --- |
   | `http://127.0.0.1:5173/` | 200 |
   | `http://127.0.0.1:5174/` | 200 |
   | `http://127.0.0.1:5175/` | 200 |
   | `http://127.0.0.1:3000/healthz` | 200 |
   | `http://127.0.0.1:3001/healthz` | 200 |

3. 每轮结束均向本轮启动的会话发送 `Ctrl+C`，随后通过 `Get-NetTCPConnection -State Listen` 确认 `3000/3001/5173/5174/5175` 全部释放。常驻命令因主动取消返回退出码 1，不将此退出码记为构建失败，也不记为退出码 0 的测试。
4. 原架构文档 SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与仓库已记录基线一致。保留用户已有修改，恢复本轮 Next dev 自动改写的 `next-env.d.ts` 引用。
5. `.\scripts\pnpm.ps1 verify:workspace` 退出码 0，输出确认 10 个成员、无循环依赖及安全服务依赖图；`git diff --check` 通过。

## 边界

验证覆盖本地启动与上述 HTTP 入口，不覆盖浏览器交互、OIDC、三存储或 G2；未改动启动代码，无需业务版本升级。遇到端口冲突先确认占用进程并停止旧服务，再启动一组开发服务；未修改示例固定端口或自动终止其他进程。
