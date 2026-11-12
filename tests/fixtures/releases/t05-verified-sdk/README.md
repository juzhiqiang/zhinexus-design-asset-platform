# 真实冻结 SDK 验收样本

本目录是实际运行生成的材料，不是合成 tar/图片。

- SDK：charts-core/vue/react 0.0.2；功能基线 6993e11，T04 Bundle 生成入口来自 main 9c355ca。
- 生成与接入命令：固定工具链 `pnpm test:platform`，其中 real-artifacts 原始测试调用 prepareReleaseBundle，工作区外干净消费者安装冻结 tarball，再驱动本机 Playwright Chromium 获取 Vue/React 的 line/bar 四个实现截图。
- evidence.json 记录 2026-11-12T05:01:30.536Z 的实际接入结果与包/图片摘要：真实 Nest + PG + MinIO，PENDING；全部磁盘与冻结对象字节一致。
- bundle 保留当时的原始 manifest、报告、tarball、PNG 与文档，截图之后未重新 pack。后续测试只重放这份已验证材料，不能称为重新运行过 0.0.2 浏览器。
- main 随后增加 0.0.3 的 ./pie；当前 CLI prepareReleaseBundle 仍生成 line/bar。另一个真实本地测试验证缺少 pie 实现时 API 必须拒绝，不能借本样本声称 0.0.3 完整发布已验收。
- preview HTML 仍是 CLI 生成的占位；公司 OIDC、T06 发布、T07 在线预览未在本样本验收。JWT 是本地真实 RSA 签名测试身份。

不得修改 bundle 字节或以重打包方式刷新该证据。SDK 升级应生成一份新样本，保留旧材料及其验证记录。
