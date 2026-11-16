# SDK 标签裁切修复与原候选结论

2026-11-16，Windows C 分支 `feat/t13-c-matching`，修复前 HEAD `61691ca6`。用户明确授权“继续修复，生成新 SDK 候选”。

## 发现与修复

已安装 CLI 0.0.11 对原 SDK（core 0.0.10、Vue/React 0.0.11）完成 56 组合无基线探测，exit 1 / `PROBE_HOLD`。运行、交互和类型检查通过，但逐张审查发现排行榜 `180次`、占比 `120次（40.0%）` 右侧裁切，原报告不能作为采纳基线。

根因为 ranking/proportion 固定右边距 32px/64px 容不下完整条末文字。修复按 ECharts 公共文字测量函数计算格式化标签宽度，匹配实际字体与距离，并留 8px 外边距；不截断数值、单位或百分比。公共 API 与支持范围不变。

新增 `tests/browser/scene-label-bounds.spec.ts`：8 项覆盖双框架、双主题、560px/360px 容器及 single 状态；另 2 项检查 360px 下长单位和小数。断言实际 SVG 文字边界与完整文本。

## RED / GREEN

```powershell
.\scripts\pnpm.ps1 test:browser scene-label-bounds.spec.ts
$env:TURBO_FORCE='true'
.\scripts\pnpm.ps1 exec turbo run build --filter=@company/example-vue... --filter=@company/example-react...
.\scripts\pnpm.ps1 test:browser scene-label-bounds.spec.ts
```

- RED：10 failed，均复现右边界溢出，`.tools/sdk-label-bounds-red.log`。
- 修复构建通过，`.tools/sdk-label-build.log`。
- 首次 GREEN：5 passed / 5 failed；测试读到了 resize 后下一帧文字布局更新之前的边界，且 single 占比夹具应为 300 而非 200。等待真实边界收敛并核对夹具后再跑，未放宽断言。保留 `.tools/sdk-label-bounds-green.log`。
- 最终 GREEN：10 passed（4.2s），`.tools/sdk-label-bounds-green2.log`。

## 原候选实测（不能替代新候选）

运行目录 `.tools/cli0011-next-7c77701970da41ebb2c90728f3f2a1ed`；CLI SHA-256 `14775474e4b0181fd3c891f6624ed15b11b2f52582731271063138e606420adf`。SDK 严格目录 `.tools/operations/next-sdk-handoff-zQIRda`；manifest SHA-256 `917f195aaa1deb12c30ad55a482241cbfd1182173777f4757edfbeff523c997d`。原产物保持不变。

- `hold/probe-evidence-hold.json`：56 组合；`scripts/audit-t10-evidence.mjs <报告> hold 56` 通过，重算环境键、字体和截图摘要。视觉审查拒绝上述裁切，没有执行原候选 adopt。
- `strict/cli.log`、`strict-only/cli.log`：安装 CLI 均 exit 1 / `PROBE_FAILED`，内层 `PROBE_PEER_REJECTED`，在首个 Vue 消费者的冻结 peer 预检即拒绝；无自动 legacy 降级，无报告。不能据此声称 React 严格路径已单独验证，或 npm 已尝试解析并拒绝。
- `legacy/probe-evidence-legacy.json`：显式 6.0.0 共 56 组合，两框架 runtime/interaction/visual passed，但 Bundler/NodeNext 类型均失败（Vue exit 2、React exit 1），`peerSatisfied=false`、`recommendation=hold`。视觉 PASS 只表示与原截图一致，不推翻裁切发现。
- `legacy/measurement-audit.log`：独立测量审计通过，56 个环境键、字体和截图摘要复核；正式 strict 基线审计器未放宽，保留此前用其审计 legacy 被正确拒绝的记录。
- `rollback/rollback-evidence.json`：`passed=true`、`candidateAdopted=false`。两原 owned 消费者实际安装 6.0.0 并构建，再恢复 package.json/lock 原字节、严格安装 6.1.0、Bundler/NodeNext 类型检查、构建及无 window/document 的 SSR 导入；两份原 manifest/lock SHA 一致、`errors=[]`，仅在全部成功后清理自有消费者。

## 后续边界

提交前强制全图门禁：`verify:workspace` exit 0；`build` 10/10、`typecheck` 14/14（均零缓存，根 tsc 通过）；`test` T10 168 passed / 0 skipped，Vitest 70 文件 / 1113 passed；`test:browser` 270 passed。通过 `.\scripts\pnpm.ps1` 执行；设 `TURBO_FORCE=true`、`NEXT_PUBLIC_SITE_URL=https://gallery.test`、`A10_FROZEN_BUNDLE` 指向上述原冻结输入。浏览器首次遗漏独立参数 `ZHINEXUS_SDK_BUNDLE_DIR`，264 passed / 2 failed / 4 did not run，均为明确 MISSING_ENV；补齐该参数指向同一输入后完整重跑 270 passed。日志 `.tools/sdk-label-full-{verify-workspace,build,typecheck,test,test-browser}.log`、`.tools/sdk-label-full-browser-green.log`。此时新 SDK 尚未打包，这些是源码集成门禁。

原始架构 SHA-256 实测仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

core/wrappers 独立升版后重新冻结并执行 56 组合 hold→截图审查→全新消费者 adopt→strict/legacy→真实回退→installed-compatibility。CLI 0.0.11 及其探针模板未变，保持冻结。

G2 公司 OIDC、独立预览域及生产配置，T13/T14 真实规则、导出、独立标注仍缺。历史工作树删除被自动审批 `blocked by policy` 拒绝，备份及原目录保留，详见 `four-agent-merge-cleanup-2026-11-16.md`。
