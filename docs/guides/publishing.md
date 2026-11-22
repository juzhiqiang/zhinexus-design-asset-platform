# 发布与恢复操作边界

CLI在开发者电脑构建并 `pnpm pack`，冻结同一tarball摘要；工作区外干净消费者安装该tarball后运行双框架示例与本地Chromium截图。截图后不重新打包。网页上传预构建材料且每个框架实现至少一张手动截图，API会拒绝缺图/错框架及伪造自动来源。

包和对象发布不可变；公司core依赖先发布，再发布Vue/React适配。客户端仅拥有OIDC身份及注册表只读消费账号，发布写凭证仅注入worker。已发布包不能删除重发，变更内容使用新版本。

发布入口为 `POST /v1/releases`，记录幂等键；轮询 `GET /v1/releases/:id` 查看stage、attempt、lastError、missingArtifacts。临时失败进入RETRY_WAIT后，通过原有 `POST /v1/releases/:id/retry` 恢复；不能人工把数据库状态改为Ready。worker自然租约恢复会先验证同名同版本和摘要；冲突失败关闭。

Ready只表示包及预览资源可达；manual-upload/local-automatic、基线确认与索引状态单独显示。目录接入以variantReleaseId读取精确版本。正式截图及当前SDK八实现材料仍需B交付，不得以本轮运维合成协议包代替。

发布卡住时先根据HTTP响应中的requestId与jobId查询JSON日志/审计；不要复制Authorization、Cookie、签名URL或OIDC token到问题单。缺件从客户端原冻结材料恢复，不能让服务器执行组件代码修复。
