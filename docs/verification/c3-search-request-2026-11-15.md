# C3 检索请求契约验证

- RED：`scripts/pnpm.ps1 exec vitest run tests/contracts/search-request.test.ts`，12 项失败，缺失 validateSearchCandidatesRequest。
- GREEN：schema 生成、CLI 镜像同步后 `scripts/pnpm.ps1 exec vitest run tests/contracts`，11 文件 210 项全部通过。
- 冻结 query/context/reactDomVersion 三字段，复用 ProjectContext 与精确版本 schema；拒绝空白、超长查询、未知字段及版本范围。
- 本记录仅证明请求形状边界，HTTP 鉴权、检索与浏览器行为另行验证。
