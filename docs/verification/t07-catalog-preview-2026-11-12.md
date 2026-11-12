# T07 C：目录、报告与隔离预览验证

日期：2026-11-12；执行环境 Windows x64，项目隔离 Node 26.13.0 / pnpm 12.18.0。分支 `feat/t07-catalog-preview`，基于 main `3bbf687`；复用当前独立工作树，未修改 B 主工作区已有文件。

## 交付边界

C 已实现公开/用户态目录、精确发布详情、文档/API/截图读取、检查报告读取，以及持久化预览授权与独立静态网关。T06 worker/registry-client 沿用 main 实现，不重复实现 B 分支的后端草稿。新接口与配置见 [API 接入](../../apps/api/README.md)、[网关接入](../../apps/preview-gateway/README.md)、[执行计划](../superpowers/plans/2026-11-12-t07-catalog-preview.md)。

公开端点固定 public-only；私有端点需 OIDC角色及组件权限。默认 private，Ready/报告来源/当前基线/索引状态分开。推荐以目录 variantReleaseId 读取完整档案；同实现同版本换包名产生歧义时，旧别名查询返回 CONFLICT。

预览仅允许当前实现声明的冻结静态文件，逐请求与存储读取后检查权限、Ready、撤销与到期。grant 一次兑换，session 不延长 5 分钟期限，数据库不保存原始令牌。host-only Secure/HttpOnly Cookie、严格 CSP、路径/长度/摘要检查、脱敏拒绝审计已实现；网关不执行上传代码。

## 实际验证

以下命令均由开发机执行，不能在服务镜像中运行浏览器/组件测试。普通构建和 typecheck 使用直接 Turbo `--force`，因为当前根脚本固定 `--cache=local:rw`，与 `--force` 同时传入会被 Turbo 拒绝；没有修改根缓存策略。

| 命令 | 结果与证据 |
| --- | --- |
| `scripts/pnpm.ps1 install --frozen-lockfile` | 已通过，最终升版后再次通过；依赖均复用当前精确锁定版本 |
| `scripts/pnpm.ps1 verify:workspace` | 已通过，10 个成员、无循环、安全服务依赖图 |
| `scripts/pnpm.ps1 exec turbo run build --force` | 10/10，通过，0 cached |
| `scripts/pnpm.ps1 exec turbo run typecheck --force` | 14/14，通过，0 cached |
| `scripts/pnpm.ps1 -PnpmArgs @('exec','tsc','-p','tsconfig.json','--noEmit')` | 通过；根测试/脚本类型检查无输出 |
| `scripts/pnpm.ps1 test` | 25 文件，521 项通过；包含契约、普通单元、CLI内联及服务启动回归 |
| `scripts/pnpm.ps1 test:platform` | 最终18文件、62项通过，真实PG/MinIO/Verdaccio及本地浏览器 |
| `scripts/pnpm.ps1 test:browser` | 最终串行71项通过，包含先前失败的SSR导入；未改SDK测试断言 |
| `scripts/pnpm.ps1 --filter @company/contracts schemas:generate` | 通过；新增 variantReportsResponse，普通测试核对生成内容无漂移 |
| 本地 Chromium + PG/MinIO/Verdaccio 攻击样本 | 中文 `.HTML` 入口经过真实上传冻结、发布、grant兑换和网关；父站DOM/存储、管理API请求、Service Worker、顶层跳转及撤权检查通过 |
| Nginx `-t`，只读挂载模板与本地临时证书 | 语法与配置检查通过；使用已存在镜像 `sha256:53a18edff8091d5faff1e42b4d885bc5f0f897873b0b8f0ace236cd5930819b0`，无生产部署 |

浏览器测试通过临时 CONNECT 代理，只把合成测试域转发到 loopback TLS；不修改全局 DNS/证书信任。受管浏览器不应用启动时 host-resolver 参数；最初直接访问测试域连接失败，改为 route 转发又遇到303后重定向不再匹配的问题，最终使用 CONNECT 保留完整真实 HTTP 跳转。所有浏览器 origin、Cookie、sandbox、CSP 检查由 Chromium 执行。

普通测试有既有 Node DEP0190 警告，未隐藏，退出码为0。第一次全浏览器回归与 `test:platform` 并行时，后者重建SDK清空dist，导致 `ssr_import_has_no_dom_access` 找不到 charts-vue/dist/index.js；其余70项通过。此后按顺序执行，避免用测试改写共享构建产物。

## RED → GREEN 与独立审查

- 目录端点最初11项因404失败；实现后迁移/目录14项通过。停用用户检查另有200→403的失败证据。
- grant/网关最初11项失败，独立域配置8项失败；实现后并发一次兑换、过期、跨版本、权限撤销及重启验证通过。grant响应 no-store 另有失败→通过证据。
- 完整报告契约及HTTP端点各1项失败后通过；真实本地基线确认不会依赖 Ready/index 状态。
- 全图构建发现 CLI 固定内联清单不含 preview 模块，移动到 `@company/contracts/preview` 独立入口后10项构建通过。CLI内联 api.ts 仅由原有 sync-contracts 脚本自动同步，未修改CLI命令行为。
- 无配置网关历史404被误改为405，既有 bootstrap 测试捕获；恢复无配置失败关闭语义后通过。
- 独立审查3项 Important：Nginx正则未引用、合法中文/扩展名资源被拒绝、variant/version并非唯一发布身份。分别用 Nginx实际失败、策略9失败、两次真实发布后旧端点错误返回200复现，再修复为配置通过、共享路径/MIME策略通过、精确release ID与歧义409通过。
- 中文入口浏览器测试验证URL安全编码；编码分隔符、双编码、穿越仍拒绝。
- 拒绝审计先新增缺记录失败测试，再补入不含Host原文/路径/凭证的 audit_events，13项网关/浏览器回归通过。
- 独立审查最终复核 `ca6e162`、`dae635a`、`3954a43` 均通过，无遗留 Critical/Important/Minor。审查者未重跑全套，完整回归由本轮实际执行。

## 外部验收与交接

- 公司OIDC/PKCE及角色撤销同步、独立注册域 wildcard DNS/TLS、目标浏览器第三方Cookie策略仍缺。数据库停用与撤权测试不冒充公司身份接入验收。
- 浏览器样本是合成协议和恶意HTML，不是当前SDK0.0.4八实现渲染材料。B需保留自己的未提交工作，先同步main中已完成T06，复用服务端worker/registry-client，补pie/scatter和真实静态材料，再接画廊。
- B负责画廊SSR/metadata/sitemap的公开DTO白名单、撤回公开后的ISR清除、私有控制台、iframe错误提示、第三方Cookie阻止时的独立窗口降级。
- T07 C本地实现可交接；完整T07、G2、M2保持开放。没有推送或生产部署；本轮功能分支保留供后续合并。
- 原始架构SHA-256实测仍为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`。

## 聚焦提交

| Commit | 内容 |
| --- | --- |
| `7b97697` | T07 C执行范围与步骤 |
| `6400ba6` | Ready目录、权限和精确版本材料 |
| `6dc5d8a` | 持久化预览授权和静态网关 |
| `3b14910` | 精确版本报告与基线状态 |
| `8548993` | 浏览器隔离测试和部署说明 |
| `ca6e162` | 契约内联、合法预览资源和Nginx修正 |
| `dae635a` | release ID定位与同号换包名歧义保护 |
| `3954a43` | 网关拒绝审计 |
| `8c9eb3b` | 平台/API 0.0.3、网关0.0.1及CHANGELOG |

平台/API版本0.0.3，网关首次功能版0.0.1；版本以单独 `chore: 升级版本号至 0.0.3` 提交，SDK0.0.4及CLI0.0.3不变。既有T05/T06/SDK历史记录未重写。工作区保留在功能分支，本轮未执行合并或push。
