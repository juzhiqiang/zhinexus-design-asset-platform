# 二期第三批：文本检索接入与离线评估入口

延续用户授权的三人协同开发，使用现有 worktree；不 merge、不 push。T13/T14 仍为部分完成。

## 冻结接口

- `POST /v1/search/candidates`，Bearer、read 角色、no-store、noindex。
- `SearchCandidatesRequest = { query: string; context: ProjectContext; reactDomVersion?: string }`。query 非空且最长 2048；reactDomVersion 为精确版本；未知字段拒绝。不扩展 ProjectContext、不从 React 推断 React DOM。
- 返回既有 SearchCandidatesResponse；排名仅 text，response.gaps 必须说明仅搜索发布元数据，未提供用途/视觉评分。无匹配为空候选，不伪造兼容。
- 索引 provider `metadata-text-v1`，文本包含组件、实现、导出名、包名、分类；不是文档全文或语义检索。PostgreSQL 持久化索引，outbox 原子消费、失败重试及显式重建；资产 Ready 与索引状态独立。
- 查询按当前读权限、Ready、框架先过滤，复用 eligibility 对精确 peers、摘要、acceptedCompatibility、revision/provider 作最终检查。索引不可授予权限；返回前再次查询当前权限及状态。并发提交发生在最后读取之后不属于可撤回响应的承诺。

## 唯一负责人及文件范围

### A3 / Antigravity

所有权：A worktree `tests/evaluation/runner.ts`、`runner.test.ts`、`docs/phase2/evaluation-runner.md`、新增 `docs/verification/a3-evaluation-runner-2026-11-15.md`。
实现文件型 runner，复用 scoring.ts，不修改评分规则。严格输入：cases JSON `{schemaVersion:1,cases:[...EvaluationCase & {split:'eval'}]}`；observations JSON `{schemaVersion:1,observations:EvaluationObservation[]}`。拒绝未知字段、train split、非法来源、重复/未知 case ID。保留 real/synthetic 分组，不推断真实样本。
命令参数 `--cases --observations --output --retrieval-version --model-version`，每项必填且拒绝重复/未知参数；model-version 可显式 `none`。报告包含 schemaVersion、原文件字节 SHA256、版本标识、generatedAt 和 scoreEvaluation 结果。输出使用独占创建 wx，不覆盖已有文件/输入；不打印数据或凭据。退出码 0 达标、2 合法但未达标、1 非法输入/IO 错误。函数入口可注入时间便于复现。没有真实标注集，不声称 T14 完成。
TDD、评分器与 runner 全部测试、根 tsc、workspace；中文聚焦提交。不要修改根脚本、锁文件、版本或他人工作区。

### B3 / Claude 桌面端

所有权：B worktree `apps/gallery/app/(console)/match/page.tsx`、`apps/gallery/app/lib/search-client.ts`、`tests/gallery/search-client.test.ts`、`tests/browser/phase2-search.spec.ts`、新增 `docs/verification/b3-search-page-2026-11-15.md`。如需改 CandidateResults，仅局部必要调整。
等待 C 同步契约后 TDD。保留原本地校验按钮及行为，新增 query 与可选 React DOM 精确版本输入及独立搜索按钮。只有用户明确点击搜索才 POST，Bearer 取当前 session；不持久化查询、上下文或响应。成功经契约解析后挂载 CandidateResults；区分 loading、空态、鉴权失败、网络/格式失败。表单任何编辑、退出、身份切换、卸载均取消并忽略旧响应，重试也不能恢复旧身份数据。requirements 未添加草稿拒绝提交。不要回显服务端原始错误或 token。
单元覆盖请求、校验、解析、错误；浏览器覆盖显式提交、编辑/退出/换身份旧响应、空态与错误。C 在宿主执行固定工具链 RED/GREEN/build/browser，B 不使用沙箱替代工具链、不 Git 操作。版本、README 和 CHANGELOG 由 C 收口。

### C3 / Codex

所有权：公共契约/生成 schema/CLI 镜像/fixtures、`apps/api/src/search/*`、`apps/api/src/index/*`、008 migration 与清单/rollback、controller 注册、平台测试、计划/README/新验证记录及版本。
先契约 RED/GREEN，精确同步给 B；后索引及真实 HTTP RED/GREEN。不执行上传代码、不启动服务端浏览器。验证真实隔离 PostgreSQL/MinIO/Verdaccio/OIDC 测试，覆盖权限撤销/禁用、废弃、索引过期/失败/重建、框架及 peer、摘要记录、并发消费者与幂等性。对 A/B 独立验收，请 A 只读审查 C/B。

## 验收与收口

- 同一 worktree 构建/typecheck/test 串行，避免外部消费者 tarball 竞争。
- C：contracts、eligibility、platform search/database 窄测试；完整根 test、强制 build/typecheck、workspace。B：相关单元、浏览器、强制 build/typecheck；A：评分器+runner、tsc、workspace。
- 对外 HTTP/UI 达到本批验收后 API 0.0.5→0.0.6、Gallery 0.0.6→0.0.7，分别独立版本/CHANGELOG 提交。未发布包无需发布动作。
- 记录真实执行结果和未覆盖边界；真实多模态检索、设计稿解析、真实标注集及 T13/T14 总体验收不在本批完成声明中。

状态：A3/B3/C3 待实施。
