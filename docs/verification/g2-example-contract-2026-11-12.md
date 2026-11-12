# C 示例状态契约收口（2026-11-12）

本次按 G2 本地子计划先收口示例接口：states 为可选只读枚举，requiredStates 继续作为必需执行清单；三个既有方法不变。新增全局名称常量直接放在 contracts/index，保持类型文件无运行时依赖。不修改 SDK/CLI 示例实现或 wire JSON Schema，不代替 A/B 业务评审。

实际验证（固定 Node 26.13.0 / pnpm 12.18.0，Windows x64）：

- 基线契约 145/145 通过。
- `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` RED：原类型没有 states，出现 TS2353/TS2339；同命令在构建新 contracts 后 GREEN。
- `scripts/pnpm.ps1 exec vitest run tests/contracts`：146/146 通过。
- `TURBO_FORCE=true` 下 `scripts/verify.ps1`：冻结安装、workspace、10 个构建、14 个类型任务及根 tsc、181 项单元/集成测试通过；浏览器首次 14/15，新增常量从 examples.js 重导出触发测试静态模块白名单拦截。
- 将常量直接定义在公共 index（避免为常量增加运行时模块边），重新构建 contracts；使用与构建一致的 `NEXT_PUBLIC_SITE_URL=https://gallery.test` 执行 `scripts/pnpm.ps1 test:browser`：15/15 通过。

原始架构 SHA-256 仍为 E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723。此项为私有契约的兼容补充，未触发公开包/平台业务发布升版。三存储与外部接入在本轮后续独立验证；本记录不声明 G2/T01 完成。
