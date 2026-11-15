# C 二期 ProjectContext 首批验证（2026-11-15）

工作区：c-phase2-search，分支 feat/c-phase2-search，基准 fa24ab525e5945e7096ed816a83f11962ba5f000。本记录新增，不覆盖历史验证。

## 范围

实现 T13 的首批 ProjectContext 类型、运行时校验及独立 JSON Schema，导出 validateProjectContext 并注册 project-context-v1。字段沿用实施计划；版本沿用已有 exactVersion 校验策略。未知字段、可变/不完整版本、空白需求、非 JSON 输入失败关闭，错误沿用 JSON Pointer。

CLI 使用固定文件清单内联 contracts；补齐 project-context.ts 清单和生成镜像，防止新增根导出导致 CLI 构建失败。未新增 CLI 命令、HTTP API、页面或兼容性判断。contracts 为 private 0.0.0，本批无对外实质功能发布，不升级公开包/平台版本。

## TDD 与问题证据

- RED：先新增 tests/contracts/project-context.test.ts；18 项因缺少 validateProjectContext 导出及 schema 注册如预期失败。
- GREEN：最小实现复用 schema.ts，不复制新的版本解析规则；同一文件 18 项通过。
- 首次根 build --force 失败：根脚本自带 --cache，Turbo 拒绝两者同时使用。强制验收改直接调用 Turbo，根脚本不改。
- 首次直接强制全图 build 失败：CLI 已复制 index/schemas，但固定清单缺少新增模块。补齐同步脚本后完整强制构建通过。
- 首次根 tsc 参数传递因 PowerShell 包装脚本参数绑定失败，未计通过；显式 -PnpmArgs 数组重跑通过。

## 实际验证

全部在上述 Windows worktree 使用 .tools 固定 Node 26.13.0 / pnpm 12.18.0：

|命令|实际结果|
|---|---|
|.\scripts\pnpm.ps1 --filter @company/contracts schemas:generate|exit 0，生成独立 schema|
|.\scripts\pnpm.ps1 exec vitest run tests/contracts/project-context.test.ts|exit 0，18 项通过|
|.\scripts\pnpm.ps1 verify:workspace|exit 0，10 成员、公开包和服务依赖边界通过|
|.\scripts\pnpm.ps1 exec vitest run tests/contracts|exit 0，9 文件 / 171 项通过；包含所有注册 schema 的磁盘内容一致性检查|
|.\scripts\pnpm.ps1 exec turbo run build --force|exit 0，10 任务通过 / 0 缓存命中；含 CLI 随包 probe 材料检查及 Next 构建|
|.\scripts\pnpm.ps1 build:services|exit 0，服务编译产物与声明前置满足；本命令含缓存，完整服务构建另已由上行 force 执行|
|.\scripts\pnpm.ps1 exec turbo run typecheck --force|exit 0，14 任务通过 / 0 缓存命中|
|.\scripts\pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')|exit 0，根测试/脚本类型检查通过|
|.\scripts\pnpm.ps1 test|exit 0，T10 node:test 159 通过 / 7 跳过 / 0 失败；Vitest 47 文件 / 758 项通过|
|git diff --check|exit 0；仅现有同步脚本有行尾转换提示，无空白错误|
|Get-FileHash component-platform-architecture.md -Algorithm SHA256|E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723，与基准一致|

## 未覆盖边界

未新增浏览器可见行为，未运行新表单浏览器验收或完整 test:browser。根测试的隔离设施验证不等于公司 OIDC、生产预览独立域、真实业务试点或多模态匹配验收。尚未提供 Candidate/MatchPlan、索引/outbox、权限重检、peer 硬过滤、设计稿解析或真实评估集。本批不标 T13/T14 完成；ProjectContext 校验成功仅证明形状，不构成兼容性证据。

B 在正式交付前仍只读审计；后续由 C 原样提供契约并记录来源，不让 B 自定义公共 DTO。未 merge、push 或发布。

## 非作者审查

A / Antigravity 对本批未提交代码进行了独立只读审查，结论为无阻断项；记录提交为 `f172dbac`，位于 A 分支 `docs/verification/a-review-project-context-2026-11-15.md`。A 实测核对契约源与 CLI 镜像 SHA-256 一致、原始架构摘要不变；没有把作者测试结果冒充另一次执行。审查覆盖仅限本批契约与传播，B 页面另行验收。
