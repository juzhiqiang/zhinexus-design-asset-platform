# C 对 B3 文本检索页面的独立验收

日期：2026-11-15。B 为 Claude 桌面端；C 在 Windows 本机使用固定工具链验证并收口提交。请求契约来自 C `95ec3726`，B `f7a81712` 六文件逐 blob 一致。

## 实际失败与修复

- 首轮相关单元 48 项中 47 通过、1 失败：被取消的延迟 fetch 仍返回结果。客户端在发起请求前、fetch 后及 JSON 解析后检查 signal；最终客户端 15、Candidate 24、请求契约 12，共 51 项通过。
- 根 tsc 揭示测试闭包赋值函数被推断为 never，改为初始化函数后通过。
- 首轮 B1+B3 浏览器 26 项中 24 通过、2 失败：新标签页未同源导航导致 localStorage SecurityError；同页身份变化晚响应留下 loading。分别补同源导航及统一 invalidateSession，并增加提交前换 token 与同 subject 换 token 回归。
- 最终 `scripts/pnpm.ps1 test:browser tests/browser/phase2-context.spec.ts tests/browser/phase2-search.spec.ts`：28/28 通过（B1 10、B3 18）。
- C 最后将「只有显式点击搜索才 POST」改为 route 控制响应完成时机，先等待 POST 再断言 loading，释放后断言空态。`scripts/pnpm.ps1 test:browser tests/browser/phase2-search.spec.ts --grep '只有显式点击搜索才 POST'`：1/1 通过，退出 0。

## 构建与回归

- `scripts/pnpm.ps1 exec turbo run build --force`：10/10 成功，0 缓存；最终会话修订后 gallery 再构建成功。
- `scripts/pnpm.ps1 exec turbo run typecheck --force`：14/14 成功，0 缓存。
- `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')`：退出 0；最终测试稳定性修订后再次通过。
- `scripts/pnpm.ps1 test`：52 文件、845 项 Vitest 全通过；node:test 159 通过、7 跳过、0 失败，整体退出 0。未把跳过算作通过。
- `scripts/pnpm.ps1 verify:workspace`：10 成员与依赖边界通过；版本收口后再执行。

## 独立审查与真实联调

Antigravity 初审 `bb86815d` 的三项问题均已修复，最终只读复查 `9045bec4` 无阻断项；重复 reset 的低优先级意见暂不扩展重构。

C `426f9c16` 新增 `tests/platform/search-gallery.test.ts`，在显式 PHASE2_GALLERY_ORIGIN 下 1/1 通过：本机 Chromium 打开 B 构建页面，通过透明本地代理请求隔离真实 API/PostgreSQL/MinIO/Verdaccio；发布、索引后点击搜索展示本轮真实包名候选，禁用 alice 后重新搜索显示登录失效并清空候选。代理不伪造响应。详见 C 分支 `docs/verification/c3-live-gallery-2026-11-15.md`。浏览器在开发机运行，不进入 API 运行时。

## 边界与交付

服务输入为合成协议 fixture，不证明真实 SDK 视觉效果、公司生产 OIDC 或大规模语料性能；未覆盖完整可访问性审计与多环境切换。仅发布元数据文本检索，无设计稿解析、多模态、用途/视觉评分或需求语义评估；无真实 30+ 标注集，T13/T14 不标记完整完成。

本批 UI 与客户端作为功能提交；Gallery 0.0.6→0.0.7 与 CHANGELOG 单独提交。未合并、推送或发布，不改原始架构文件。
