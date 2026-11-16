# C 二期组件 GET 契约冻结验证

日期：2026-11-16。实现基线：`981ba7a529d5d75587d4d1b4606d22cd754401c5`。本记录只覆盖收口计划 P0，不证明 GET 路由、真实 SDK 联调或二期整体验收完成。

## 交付

- 新增 `ComponentMatchQueryV1`、`ComponentMatchResponseV1` 和两个公开运行时校验器；复用 `MatchTarget` 与 `ComponentApiV1`。
- 查询只接收精确版本和原始大小写 ID。React 必须含 reactDomVersion，Vue 禁止该字段；未知/数组/对象字段失败关闭。
- matched 要求 query、target、API 身份和样式/就绪方法一致，包含目标包与宿主精确依赖；gap 禁止暴露 target/API/依赖。兼容状态与证据、缺口保持一致。
- 生成两个 JSON Schema，并同步 CLI 内联源码及浏览器模块白名单。Schema 仅保证结构，框架条件、结果状态、动态身份和依赖一致性必须额外运行校验器；未扩展通用 Schema 引擎。
- 公共 fixtures 标为 synthetic，不代表真实设计样本或兼容性证据。

## 实际验证

固定 Windows x64 Node 26.13.0、pnpm 12.18.0；所有工作区命令通过 `scripts/pnpm.ps1` 执行。独立工作树仅链接已有固定工具链缓存，node_modules 与构建产物独立。

| 命令 | 结果 |
| --- | --- |
| `install --frozen-lockfile` | exit 0 |
| `--filter @company/contracts build` 后执行 `exec vitest run tests/contracts/component-match.test.ts` | RED：exit 1，36 项因缺少新导出/Schema 失败 |
| `--filter @company/contracts schemas:generate` | exit 0 |
| `exec vitest run tests/contracts/component-match.test.ts tests/contracts/api-schema.test.ts tests/contracts/match-plan.test.ts` | GREEN：exit 0，3 文件、83 项通过 |
| `exec turbo run build typecheck --force` | exit 0，20/20 任务成功，0 缓存；含 CLI 同步和构建 |
| `-PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | exit 0 |
| `verify:workspace` | exit 0，10 成员、无环、4 公开包、服务端依赖图安全 |
| `exec playwright test --config tests/playwright.config.ts tests/browser/contracts-runtime.spec.ts` | exit 0，Chromium 1/1 通过 |

原架构 SHA-256：`E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与保护值一致。

## 后续边界

原始 URL 单次解码、重复参数、权限复查、跨包歧义属于 P1 的 HTTP/服务实现；真实冻结 14 实现、Gallery 联调和独立调用侧测试由 P2–P4 验收。P0 不新增 CLI 命令或改变其已有外部行为；最终 API/Gallery 等受影响包升版由 P5 统一执行。
