# Phase G：AI 开发契约与 Agent 执行迁移

2026-09-30。本地实现已提交。changeset 尚未应用，版本尚未发布。CLI 的默认模板和覆盖行为有变化，changeset 按 major 记录；不要依据现有版本号推断新命令已发布。

## CLI 与开发 MCP

- 新增 `capabilities --json`、`doctor --json`、`verify --checks types,test --json`；MCP 提供对应工具。结果包含 `schemaVersion/operation/status/data/diagnostics`，MCP 保留文本结果并增加 `structuredContent/outputSchema`。失败返回非零退出码或 `isError`。
- `plan --spec <file>` 默认不写文件；显式 `--save-plan` 将签名计划保存在 `.koatty/plans`。`apply --plan <id>` 默认预览，`--yes` 执行；计划绑定项目、相关源文件指纹、前像和十分钟有效期，执行时消费一次。计划密钥与记录不能提交。此签名不防御已控制同一用户文件系统的攻击者。
- CLI 文件输入和 MCP 会话计划共用校验及写入事务。MCP 仍要求同一连接签发的 hash/changeset，不能直接使用 CLI 计划 ID。生成器不再在生成 changeset 时先修改协议配置。
- 新文件冲突现在拒绝覆盖。修改已有业务代码应做显式修改，不要删除原文件后重试生成器。交互式 `add` 在非 TTY 下明确失败；自动化使用 Spec/plan/apply。
- `apply` 默认执行类型检查；校验失败时文件可能已写入，回执明确列出 `written`。先修复问题再执行 verify，不要重放已消费计划。MCP apply 返回 `applied`，需单独调用 verify 才有测试证据。`--no-validate` 同样不表示测试成功。
- 检查仅使用项目声明且已安装的 TypeScript/Jest/ESLint，不再通过 npx 隐式安装。检查有超时/取消；执行项目测试与配置仍然可以产生业务副作用，这不是 OS 沙箱。
- 新项目默认使用随包模板，旧缓存必须通过 `--source cache` 显式选择；`--offline` 禁止下载。`--template-digest` 校验模板快照；`.koatty/template-lock.json` 同时记录模板与实际输出摘要。完整复现还需相同 CLI、recipe、Skill 和依赖锁文件。
- 标准项目升级到 Koatty 5 和实际 HTTP smoke 测试。新 `mcp`、`agent` recipe 使用显式 application composition，包含鉴权、scope、默认拒绝缺失审批后端的写工具、DTO、协议测试和随项目 Skill。Agent recipe 是有限轮请求循环，持久化 runner 需应用显式接入。
- Manifest v1 新增可选 `mcp`：tools/resources/prompts、输入输出 schema、scopes/审批声明；动态声明进入 `unresolved`。`coverage` 仅表示静态声明覆盖，不保证运行时注册/授权。`--section/--name/--offset/--limit` 提供有界查询。开发 MCP 的 `koatty_docs` 支持 `scope: framework` 检索随包 Skill。

## MCP 输出约束

工具声明 `outputSchema` 时必须是对象 schema；host 创建时编译，执行后验证实际输出，失败返回 `MCP_OUTPUT_INVALID`。修复过去不符合 schema 的返回值。校验在业务方法之后，失败不能理解成业务回滚，尤其不能盲目重试写操作。

## 可选持久化 Agent

`koatty_llm` 新增 `createAgentRunner`、`AgentRunStore`、`createFileAgentRunStore`，复用既有 LLM client 的预算和 MCP host 的权限执行链，不修改默认请求流程。

- `start → run → inspect` 使用 scope、run ID、definition 绑定身份与实现版本；scope 必须来自可信认证上下文。definition 不兼容变化后必须升级。
- 原子 CAS 控制 revision/租约，工具调用前保存意图。工具执行结果不确定时进入 `unknown`，禁止自动重放。应用必须按 idempotencyKey 查询业务权威结果，再以 revision/key/result 调用 `resolveUnknown`。
- completed、failed、cancelled、budget_limited、tool_round_limit 是终态；取消不表示外部操作被回滚。模型请求在检查点前中断可能重复计费。
- 本地文件 store 仅适用本地文件系统；CAS 中途进程崩溃可能保留锁，需核对后人工恢复。集群必须提供数据库级原子 CAS。存储包含会话内容，应按业务权限和保留策略保护。
- 没有自动后台调度、未经鉴权的恢复接口或自动审批；业务应用负责这些入口和部署配置。

## 测试和发布边界

`pnpm test:ai-development` 运行固定开发任务回归和独立子进程崩溃恢复实验；先构建受影响包。生成工程测试使用当前 workspace 依赖，执行真实 TypeScript、HTTP/MCP/SSE，但模型响应为 mock。它们不是 npm 隔离安装、真实 provider、Redis/数据库集群或外部客户端发布验收。

Skill 源码为 `packages/koatty-ai/skills/koatty`，与 CLI/recipe 同版本分发；参考文档要求 feature detection，不将尚未发布的导出假定为已安装能力。发布需同时提交 CLI 子模块、其 project 模板嵌套子模块和主仓库指针，遵循 RELEASE-GUIDE.md。
