# T17 独立产品矩阵执行器（2026-11-20）

本记录交付真实产品执行器及夹具，不将单元测试或诊断子集称为完整矩阵通过。固定场景表、20 个正向与 13 个强制拒绝、数据、动作、断言和视觉阈值保持原样。正式入口为 `scripts/pnpm.ps1 -PnpmArgs @('exec','vitest','run','--config','tests/acceptance/t17-matrix/product.vitest.config.ts')`；`vitest.config.ts` 只运行单元测试。

## 执行与证据

- 先用独立手写、直接消费 SDK 的宿主生成参考基线，再移除候选工程的 SDK 依赖，由实际冻结 CLI 的 inspect/plan/apply 安装生成实现。原生命令使用真实宿主脚本；冻结 CLI、SDK、API/registry 与安装身份均有摘要绑定。
- 独立检查入口 import、本次生成文件摘要、实际构建图、浏览器加载的 JS 与相邻 source map 原始源摘要，拒绝静态替身或错误宿主。真实 click/fill 和 DOM 精确断言按预声明场景执行。
- 公共 bar grid 参数修正让既定点击落在真实柱条上；KeepAlive 夹具使用生成 Vue 实现的真实 props 类型。没有修改动作、期望事件、分母或产品接口。合法精确 packageManager 声明保留，夹具 native pnpm 也使用既定禁止重新引导的参数。
- N10 由真实 apply 生成三份故障文件，真实 repair 最多两轮、每轮只修一份，最后仍有第三份故障。逐轮报告、原字节备份、完整源码清单与最终未决问题交由严格评分器验证；不伪造中间报告。
- 所有项目、证据与缓存都有独占 owner。交付及缓存链接只按捕获的真实 journal/原生文件身份接管；通用源码守卫不按前缀忽略未知条目。封存前检查写集，归档逐文件复读 SHA/大小后才清理本轮所属项目。

## 验证与历史实跑

- 完整矩阵单元入口 12 文件、185/185；控制方实际 03:19:26、19.69 秒，作者在 N01 修正后复验 03:22:28、34.07 秒，均 exit 0。根 tsc 与 diff check 均 exit 0。
- 独立只读审查覆盖执行器、fixture/reference/browser/import-proof/process/cache/install-observer 与入口，未发现 Critical/Important。源码摘要记录在外置 `host-live-0.0.21-8ab74b65/independent-scoring-harness-static-review.json`；静态审查不代替正式 33 格。
- 旧 0.0.20 完整轮诚实结果为正向 9/20（Vue 4/10、React 5/10）、拒绝 4/13，matrixAccepted=false。公开 grid、KeepAlive props 与 pnpm 管理器引导问题已分别修正；运行一小时后测试令牌过期导致后段 401，需另修隔离服务夹具寿命后新 owner 重跑。旧 seal 与失败记录保持原样。
- 旧轮原字节归档 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/matrix-0.0.20-failed-dde864288f6a87e81a922d689d1b4fda`：50 roots、18542 文件，逐原 seal / inventory 校验并复制后复读，archive-map SHA-256 `8036a03978358a67eb234ff16151fb0f0e232c9109eec37809a8e27552143d18`；50 个本轮 parent 已清理。
- 0.0.21 的 N01 单格先导真实 GREEN：1/1、exit 0、74.77 秒；plan conflicted、exit 2，含 DEPENDENCY_CONFLICT，证明锁定 ECharts 5.6.0 与 MatchPlan 6.1.0 实际冲突。该格先 native install 生成真实锁，未放宽拒绝要求。归档 `matrix-0.0.21-N01-diagnostic-eedda1170d0dee485e22b6a75ba53d05`，fixedDenominatorEvaluated=false；23 文件按 seal 复核，2 个本轮 parent 已清理。

正式 0.0.21 同 SHA 完整 33 格已另立 owner 执行，结果须单独记录。评分边界见 [评分补充](t17-matrix-scoring-2026-11-20.md)。
