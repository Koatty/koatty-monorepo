---
"koatty_validation": minor
"koatty_core": minor
---

Phase F (F-1) — `koatty_mcp@1.0.0`：新增 MCP Server 宿主包，把 `@Service` 方法以 `@Tool` / `@Resource` / `@Prompt` 声明式暴露为 MCP 工具、资源与提示词，复用既有 IoC、`koatty_validation` 白名单校验、请求作用域与可观测性。附带两项增量改动：`koatty_validation` 新增 `PARAM_DTO_KEY`（`@Validated({ types })` 的 DTO 类型桥接元数据，`PARAM_CHECK_KEY` 语义不变）；`koatty_core` 的 `KoattyContext` 新增可选协议字段（`principal`、`mcpSessionId`、`mcpRequestId`、`mcpToolName`、`signal`、`progress`），非 MCP 请求不受影响。

`koatty_mcp@1.0.0` 为首次发布，目标版本由 changeset major 从 0.0.0 统一生成，不直接写入 `packages/koatty-mcp/package.json`，必须通过 changeset 统一生成版本。迁移说明见 `docs/migration/phase-f-mcp-host.md`。

---

Phase F (F-2) — `koatty_llm@1.0.0`：新增 LLM 调用抽象包（厂商适配、路由与 fallback、超时/退避/熔断、共享预算、`signal` 取消、结构化输出、进程内工具循环、非流式精确缓存与成本估算），与 F-1 的 `ctx.signal`、MCP 工具 schema 衔接。该包为首次发布，目标版本由 changeset major 从 0.0.0 统一生成，不直接写入 `packages/koatty-llm/package.json`，必须通过 changeset 统一生成版本；本次未改动任何既有包的行为。迁移说明见 `docs/migration/phase-f-llm-client.md`。
