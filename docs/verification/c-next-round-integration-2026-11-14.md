# A/B/C 下一轮集成与 Windows 原生复验

日期：2026-11-14。负责人：C。基线 `4dc93fec1c0c702fb615b0709f8f7a9816bc3ec9`；集成分支 `chore/c-next-round-integration`。本文新增记录本轮实际执行结果，不改写各方历史验证记录。

## 分支与审查

- C：`acd9d5739291236e284fd1db1472ff00514127c2`，镜像身份预检、完整登记原子发布与独立平台专项；独立复审已关闭并发登记 P2。本地合并 `0b71cf44019f43dbbb516787b2f717a7ff14f1cd`。
- B 第一阶段：`d1f61500a6f6e80e6bbd9a50749bd663ccc1fcbb`，本地视觉基线、真实 API CAS、网页异常恢复和冻结材料参数；独立复核窄测试 17/17，两项 P2 已关闭。集成合并 `20d01e4`。
- A 首份交付：`698e2321511a67be305be9996b716442e0e48cfd`，Git bundle 完整性验证通过，已快进导入 Windows A 工作树。首轮审查发现问题，尚未合并；后续修正另记。
- B 第二阶段兼容 CLI 与 A 候选/回退证据仍在实施。不能将本轮进度写为完整 T10 完成。
- 原 SDK 冻结批次不重新 pack。三方均保留独立分支；不 push、不删除分支或工作树。

## C 与 B 第一阶段集成验证

命令在 Windows C 工作树执行，使用项目固定 Node 26.13.0 / pnpm 12.18.0。

| 命令 | 实际结果与边界 |
| --- | --- |
| `scripts/pnpm.ps1 vitest run tests/unit/local-images.test.ts tests/unit/platform-isolation.test.ts` | C 合并前新鲜执行，10/10 |
| `scripts/pnpm.ps1 test` | C 合并前新鲜执行，38 文件、693/693，203.21s |
| `scripts/pnpm.ps1 test:platform` | C 合并后相同源码树，28 文件、88/88，229.45s，exit 0；独立栈 `b2efee12-b7ca-4ba7-a51c-b6d7aa447304` 已清理 |
| `scripts/pnpm.ps1 install --frozen-lockfile` | C+B 集成通过；未改写锁文件 |
| `scripts/pnpm.ps1 verify:workspace` | 10 成员、无环、4 公开包、服务端依赖图通过 |
| `scripts/pnpm.ps1 exec turbo run build typecheck --force` | 20/20 实际执行通过，0 cached，17.24s |
| `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 根类型检查 exit 0。首次简写调用因 PowerShell 参数绑定失败，改显式数组后实跑通过；首次失败不算通过 |
| `scripts/pnpm.ps1 test:browser` | 195/195，1.4m，exit 0；先强制构建并确认 5173–5176 空闲，设置 `ZHINEXUS_SDK_BUNDLE_DIR` 指向权威冻结批次 |

浏览器范围包含 14 实现、56 项主题/渲染器展示、手动发布失败恢复与 6 项真实三存储网页 E2E。不能替代公司 OIDC、生产独立域/TLS 或真实业务试点。

原始架构 SHA-256 再核对为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，未变。

## A 首份交付的 Windows 失败与运行证据

在 Windows A 工作树使用 C 的固定工具链启动，未修改 A 源码。

1. `install --frozen-lockfile --ignore-scripts`：通过，10.9s。A 工作树最初没有 `.tools`；首次日志重定向未能建立文件，命令未执行，不计入验证。
2. `node --test tests/acceptance/t10-sdk/probe.test.mjs`：51 项中 46 通过、5 失败，exit 1。失败均由测试 fixture 使用 Unix `cat`，Windows `spawnSync cat ENOENT`。已将准确堆栈反馈 A。
3. `probe.mjs --bundle <权威冻结目录> --echarts 6.1.0 --out test-results/t10-sdk-probes/windows-initial --label windows-baseline`：exit 0；两框架各 28 次浏览器运行，类型/生产构建/SSR/运行/交互与 bar 卸载重挂均通过；无视觉基线，`visual=not-run`、`recommendation=hold`。两份消费者目录确认已清理。
4. 只读临时探针复现：两份同组合基线冲突时 `conflicts.length=1`，比较仍返回 `PASS`；缺 SSR/生命周期/浏览器运行证据时 `runtime=passed`。已反馈 A 补 RED/GREEN。

首轮报告还使用常量字体摘要与浏览器 revision，并含硬编码 Linux 未覆盖说明；因此这批截图只作为故障排查证据，不能升级为可信视觉通过。新环境指纹修正后必须重新生成基线并复验。

审查还要求未核对候选来源/integrity 时保持 hold、读取真实框架解析版本、冲突基线失败关闭及跨平台测试。A 最终修正、候选回退、B 命令和最终 main 门禁将在后续段落追加。

## 未验收门槛

公司 OIDC/PKCE/撤权、生产独立预览域/TLS、真实 Vue/React 业务试点、跨版本兼容记录落库均不因本地测试自动通过。完整 G2/T10/T11/T12 保持开放。

## 追加复核：修正交付前的实际失败

下列失败发生于 A 未提交草稿或 B 固定提交，不覆盖上面的首轮记录；均已反馈各自负责人，修正后的通过结果另记。

- A Windows 真实浏览器 smoke：`measureFontFingerprint` 在 `page.evaluate` 中引用 Node 外层常量，抛 `ReferenceError: FONT_MEASUREMENT_SOURCE is not defined`；浏览器 revision 读取先后遇到缺失 `fileURLToPath` 和 pnpm 包路径解析失败。C 从真实 `@playwright/test → playwright → playwright-core` 依赖链解析 `browsers.json`，读到 Chromium revision `1254`，已给 A 可复现的定位方法。
- A `nativePlatformNote` 必须进 `scopeNotes`，不能让本机完整验证因“其他操作系统未复验”永远 hold。默认 strict 安装失败不得自动重试 legacy；只有显式选择 legacy 才允许继续测量。消费者来源需与真实 npm lock 的版本、integrity、resolved 和非链接状态核对。
- B `0ee149a` 独立窄测 3 文件、24/24 通过，但额外临时反例复现四项 P2：组合实际 ECharts/框架版本未绑定、resolver integrity/source 被丢弃、畸形 `failures` 引发未捕获异常、Windows junction 可越出冻结根目录。该提交暂不合并第二阶段；后续固定 head 另行复核。
- C 已完成根脚本接线草稿：`test:t10` 与 `probe:t10`，根 `test` 将在服务构建后运行探针 Node 单测，再运行 Vitest；仍不进入 Turbo 缓存。冻结安装与工作区边界检查实际通过，锁文件未变。A 源码尚未导入时不运行或宣称根最终门禁通过。
