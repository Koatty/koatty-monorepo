---
'koatty_cli': minor
---

双工具拆分第一阶段：新增公开生成 API（koatty_cli/generation、koatty_cli/project），main 入口不再装配 CLI；支持矩阵硬化（拒绝自定义 api.endpoints、非 rest/grpc/graphql 协议、非 id 数字主键）；单文件命令新增 --json/--dry-run；新增 http-action 生成原语。详见 docs/migration/koatty-cli-agent-split.md。

配套新增独立包 koatty_ai（Skill + Tools，单向依赖 koatty_cli 公开 API），按新包流程单独发布。
