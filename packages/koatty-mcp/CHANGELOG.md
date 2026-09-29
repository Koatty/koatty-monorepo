# Changelog

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

- `koatty_validation@4.x` adds the additive `PARAM_DTO_KEY` metadata
  (`@Validated({ types })` bridge) and `koatty_core@2.x` adds the optional
  protocol fields on `KoattyContext`; neither changes existing behaviour.
