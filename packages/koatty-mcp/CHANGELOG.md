# Changelog

## Unreleased — Phase F audit fixes (2026-09-29)

- HTTP 每连接独立 SDK Server；鉴权覆盖 discovery/unscoped 调用、strict 继承、Origin 精确匹配、stdio 身份与取消；TC39 发现与共享 DTO schema，资源模板改为 templates/list。
- 迁移说明：`docs/migration/phase-f-audit-fixes.md`（主仓库）。


All notable changes to `koatty_mcp` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 1.0.0

First release — the MCP (Model Context Protocol) Server host (roadmap Phase F, item F-1).

### Added

- `@Tool` / `@Resource` / `@Prompt` decorators exposing Service methods as MCP
  tools, resources and prompts; discovery reads the IoC metadata store, so
  inheritance and the existing loader scan flow keep working.
- DTO → JSON Schema bridge (`dtoToJsonSchema`): the tool `inputSchema` is derived
  from the existing `@Validated({ types: [Dto] })` declaration plus class-validator
  metadata. Unmappable constraints are reported under `x-koatty-unresolved`
  instead of being dropped silently.
- Shared validation path: call arguments run through `koatty_validation`'s
  whitelist check, so unknown fields are stripped and illegal values become
  JSON-RPC `-32602` errors instead of unhandled exceptions.
- Streamable HTTP transport (`createMcpHttpAdapter`, default path `/mcp`) mounted
  on the existing HTTP service, plus a stdio transport
  (`startStdioServer` / `createInMemoryPair`) for local debugging. Protocol
  details are delegated to the official `@modelcontextprotocol/sdk`.
- Per-call request scope and Core AsyncLocalStorage context: `principal`,
  `mcpSessionId`, `mcpRequestId`, `mcpToolName`, `signal` and `progress()` live on
  the existing request context (`KoattyContext`), not a parallel ToolContext store.
- Authentication providers: `createApiKeyAuth` (internal services) and
  `createBearerAuth` (OAuth 2.1 resource-server role, audience + scope aware);
  scopes are enforced identically on HTTP and stdio before business code runs.
- Approval gate for high-risk tools (`requireApproval`, or strict-profile default
  for `destructiveHint`): fail closed when no backend is configured, timeout
  aware, and every decision is audited.
- Redacted structured auditing (`emitAudit`, `summarizeArguments`) recording
  caller, tool, argument summary, status and duration.
- Protocol safety: `Origin` validation against an allowlist (DNS-rebinding
  protection) and loopback-only default binding for local mode.

### Compatibility

- The handler instance is resolved through the IoC container
  (`container.get(identifier, type)`), so component scope (Singleton / Request)
  is honoured. Non-MCP requests are unaffected: every context field added by this
  package is optional.

### Notes

- Minimum peer versions are `koatty_validation@4.1.0` (`PARAM_DTO_KEY` metadata for the
  `@Validated({ types })` bridge) and `koatty_core@2.6.0` (optional protocol fields
  on `KoattyContext`); both changes are additive and do not change existing
  behaviour, but older versions are rejected by the peer ranges on purpose.
