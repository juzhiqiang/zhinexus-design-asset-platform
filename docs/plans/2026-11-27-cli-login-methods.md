# CLI 三种登录方式与 HTTP 接入

用户于 2026-11-27 明确授权：CLI 的 HTTPS 是建议而非强制要求；账号密码、浏览器授权、Token 三种登录方式由用户选择。原架构文档保持原字节。

## 范围与接口

- 在当前干净工作区的 `feat/cli-login-methods` 分支顺序实施，不创建并行实现或修改用户组件项目。
- `juz login` 在终端提供三种选择；`--method password|browser|token` 可直接选择，`--token` 保留直登，`--username` 选择账号密码。密码与手动输入的 Token 隐藏输入；密码不接受命令行明文参数，不保存。非交互且未指定方式时保留浏览器登录兼容性。
- CLI 平台 API origin、已保存凭据及 CLI 登录元数据允许 HTTP/HTTPS；HTTP 提示推荐 HTTPS，不要求额外确认。其他协议、URL 内嵌凭证及非精确 origin 继续拒绝，HTTPS 证书校验保持。平台服务的生产身份源与预览 HTTPS 部署策略不扩散修改。
- 同步取消 CLI 接入计划读取 API/registry 时的非回环 HTTP 限制；仍拒绝重定向、分离两类 Token、限定 tarball 同 registry origin 并核对摘要。
- `OidcCliMetadata` 兼容新增可选 `passwordLoginEndpoint`、`browserAuthorizationEndpoint`。仅自托管身份提供这些入口；CLI 账号密码只提交给所选 API 同 origin 的密码端点。
- `POST /identity/login` 可选 `client_id`：缺省仍签发 web token，精确匹配已配置 CLI client 才签发 cli token，其余值拒绝；不改变角色、权限、首次换密、停用或撤权检查。
- 浏览器继续 PKCE，原 token endpoint 不变。自托管浏览器入口指向后台登录页；登录页和错误回跳接受严格的 CLI HTTP 回环 callback，真实 redirect 仍由身份服务注册表验证。

## 实施与验证

1. 先补契约、CLI HTTP 登录及三种选择、密码端点客户端身份、后台 CLI 回调测试，运行并保存实际 RED。
2. 最小实现，运行对应 GREEN；真实 Nest HTTP + PostgreSQL 验证账号密码签发 cli 身份、浏览器 PKCE 和 Token 保存，并验证错误密码不会改写旧凭据。
3. 执行 `pnpm verify:workspace`、CLI/API/admin 类型检查与构建、根 `pnpm typecheck`、`pnpm test`。共享契约变更运行完整契约测试及内联镜像检查。独立安装最终 tarball 验证版本、帮助和交互不回显。
4. 独立记录验证结果及未覆盖边界；功能和升版分别中文提交。CLI/API/admin/root 按本次实际外显变更递增 PATCH，同步 CHANGELOG；生成并更新本机 CLI，不执行远程发布、push 或合并。

## 重点回归

三种方式互斥；HTTP 远端 origin 可保存复用；密码/Token 不回显；不保存密码；未知 client 不得签发；web token 不冒充 cli；失败不覆盖旧凭据；首次换密与账号停用保持；不向异 origin 发送密码；浏览器 state、PKCE 及回调限制保持。
