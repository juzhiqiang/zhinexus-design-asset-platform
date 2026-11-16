# D 二期查询验收记录（2026-11-16）

## 事实
- Claude Code 会话 `ae4a896e-7cd3-4601-bacb-2e0987ea4b6e` 读取了仓库内 AGENTS.md、rules、P3 计划、spec、contracts 与既有测试设施。
- 工具解析连续失败两次（exit 1）。随后在禁用工具、以 `--print` 续跑时，输出使用同一已配置模型；未调整模型设置。
- 该输出生成了消费者测试、使用说明与示例校验候选；但输出多次出现截断或语法错误。**CLI 本身未编辑文件，也未运行测试。**
- 宿主（C）修正了：React 事件名、无 token 调用、完整撤权、`__proto__` 直传、行类型，以及示例的导入与错字、文档末句截断。

## 验证
- 宿主 `build:services`：exit 0。
- 宿主运行 `tests/platform/component-query-consumer.test.ts`：5 项失败，均为预期 404，因为未含 P1 路由。实际使用隔离 PG/MinIO/Verdaccio/Nest 与本地签名 JWT，属正确 RED，不是设施未启动。
- 文档示例校验由 C 运行；HTTP GREEN 待 B 集成。

## 本分支文件
- `tests/platform/component-query-consumer.test.ts`
- `tests/evaluation/component-query-examples.test.ts`
- `docs/phase2/component-query-api.md`
- 本记录

边界：合成数据，非真实业务样本；不代表 OIDC 外部接入或生产验收完成。

## C 宿主补充（生成内容修正后）

- `exec vitest run tests/evaluation/component-query-examples.test.ts`：3/3 通过，exit 0。
- 独立工作树根 tsc 暂因 charts-core 与框架 dist 尚未构建而失败；新文件未报错。最终全图构建后的类型检查与 HTTP GREEN 由 C 集成记录补充，本记录不将其写成通过。
- CLI 输出异常的修复属于 C 的协助，不将宿主动作记为 Claude Code 直接操作。
- C 后续先构建 charts-core/vue/react，再执行根 tsc：exit 0。前述缺 dist 阻塞已消除。
