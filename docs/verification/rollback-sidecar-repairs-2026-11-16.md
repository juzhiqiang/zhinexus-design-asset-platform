# 回退留证与冻结目录旁置诊断修复

日期：2026-11-16；在已授权的 C 集成分支接续实施，不改写旧报告与旧冻结产物。

## 变更

- 回退脚本在安装前重新读取真实冻结 manifest/tarball，将首轮报告的聚合版本、包数、唯一名称及各包 version/SHA/bytes 与其绑定。恢复 core / Vue / React 的预期版本来自冻结包，去除统一 0.0.10 假设。
- 候选安装失败或恢复失败时，仍尝试两消费者的恢复，保留两者目录和 `passed: false` 报告；仅全部成功后执行带 ownership 校验的清理。报告增加基线报告摘要与冻结清单摘要。
- 新平台诊断使用 `${bundleDir}.acceptance.json` 独占写入，记录实际 manifest SHA 和三包 SHA/bytes。完成后重跑严格目录校验；旧目录内已有诊断保留，严格校验仍拒绝未声明文件。
- 为现有 JavaScript 运维入口补声明，使 TypeScript 回归测试无需关闭严格类型检查。

## RED / GREEN 与实际命令

均使用 Windows 项目固定运行时，命令前缀 `scripts/pnpm.ps1`。

| 命令 | 实测结果 | ignored 证据 |
| --- | --- | --- |
| `exec vitest run tests/unit/t10-rollback.test.ts` | RED 4 failed；GREEN/最终 4 passed | `.tools/next-rollback-{red,green,final}.log` |
| `exec vitest run --config tests/platform/vitest.config.ts tests/platform/current-sdk.test.ts` | RED 1 failed，明确命中 UNEXPECTED_FILE；GREEN 1 passed，59.80s | `.tools/next-sidecar-{red,green}.log` |
| `exec tsc --project tsconfig.json --noEmit` | 初次准确发现新测试缺 .mjs 声明；补齐后 exit 0 | `.tools/next-root-tsc{-green}.log` |

回退单测模拟 npm/构建行为，实际测试 ownership、冻结文件摘要、清单/锁字节恢复与失败目录留存，不能替代真实回退。

平台专项实际完成本机三存储发布、14 个隔离浏览器预览、Vue/React 精确注册表安装和发布材料严格复核。新诊断为 `.tools/operations/current-sdk/9d8cfd37-e082-49b4-991f-03ab969bd974.acceptance.json`；这是专项新建材料，不替换随后 T10 使用的 `next-sdk-handoff-zQIRda`。测试只使用本地签名 OIDC 夹具和测试 TLS，G2 外部接入未验收。

## 待验收

CLI 新冻结候选的 56 组合与真实双消费者回退仍须单独执行。历史工作树清理仍被自动审批阻止，详见合并记录。
