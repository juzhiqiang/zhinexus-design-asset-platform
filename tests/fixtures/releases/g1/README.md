# G1 合成契约 fixtures

这些是协议评审样本。tarball、PNG、字体和 rendered check 内容均为**合成字节**，不是有效 npm 包、真实截图、浏览器执行或兼容性证明。测试只验证字节与声明摘要一致；真实 MIME/包 exports/消费验收仍归 T03/T04/T05。

| 入口 | 内容 |
| --- | --- |
| factory.ts | 独立的 web/cli manifest、报告和冻结字节 Map；一包多组件+双框架 |
| api.ts、json/api-messages.json | 18 类 API 样例，URL 使用 example.test，身份虚构 |
| json/valid-web.json | 每实现 manual-upload / unknown-manual，无伪造报告 |
| json/valid-cli.json、reports.json、synthetic-bytes.json | 同一文件清单、自动来源声明与报告，字节 base64 |
| json/negative-cases.json | 反例预期稳定错误码 |
| json/missing-screenshot.json | 一包第二个组件缺图，SCREENSHOT_REQUIRED |
| json/wrong-framework.json | React 借 Vue 图，SCREENSHOT_VARIANT_MISMATCH |
| json/wrong-digest.json | 图的包摘要错误，DIGEST_MISMATCH |
| json/forged-source.json | web 伪造自动来源，SOURCE_FORBIDDEN |
| json/conflicting-package.json | 同名同版本不同摘要，CONFLICT |
| json/unsafe-path.json | 路径穿越，INVALID_PATH |

在根目录运行：

```powershell
.\scripts\pnpm.ps1 --filter @company/contracts build
.\scripts\pnpm.ps1 exec tsx tests/fixtures/releases/g1/generate.ts
.\scripts\pnpm.ps1 exec tsx tests/fixtures/releases/g1/generate.ts --check
.\scripts\pnpm.ps1 exec vitest run tests/contracts
```

A 核对示例/双框架语义；B 核对冻结、截图/报告/API 与失败码；C 收口。实际评审与 G2 接入回执见 docs/superpowers/plans/2026-11-12-g1-review-g2-access.md，没有回执不得填通过。
