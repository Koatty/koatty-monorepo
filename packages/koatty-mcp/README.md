# koatty_mcp

MCP (Model Context Protocol) Server host for Koatty. Expose Service methods as MCP
**tools**, **resources** and **prompts** declaratively, reusing the IoC container,
DTO validation, AOP, request scope and observability that the framework already has.

> Roadmap: `docs/koatty-hardening-and-ai-evolution-plan.md` → Phase F, item **F-1**.

## Install

```bash
pnpm add koatty_mcp
```

`@modelcontextprotocol/sdk` is a peer dependency; the protocol state machine is
implemented by the official SDK, Koatty only provides decorators, IoC integration
and transport adaptation.

## Declare

```ts
import { Service } from 'koatty_core';
import { Autowired } from 'koatty_container';
import { Validated } from 'koatty_validation';
import { Prompt, Resource, Tool } from 'koatty_mcp';

class QueryOrderDto {
  @IsString() @IsNotEmpty() orderNo!: string;
  @IsOptional() @IsInt() @Min(1) page?: number;
}

@Service()
export class OrderTools {
  @Autowired() private orders: OrderService;

  @Tool({
    name: 'order_query',
    description: 'Query order status by order number',
    annotations: { readOnlyHint: true },
  })
  @Validated({ async: false, types: [QueryOrderDto] })
  async query(input: QueryOrderDto) {
    return this.orders.findByNo(input.orderNo);
  }

  @Tool({
    name: 'order_refund',
    description: 'Refund an order',
    annotations: { destructiveHint: true },
    requireApproval: true,          // human approval gate (fail closed)
    scopes: ['order:refund'],       // caller scope, checked on every transport
  })
  @Validated({ async: false, types: [RefundDto] })
  async refund(input: RefundDto) { /* ... */ }

  @Resource({ uri: 'order://{orderNo}', mimeType: 'application/json' })
  async orderResource(params: { orderNo: string }) { /* ... */ }

  @Prompt({ name: 'refund_policy', description: 'Refund policy template' })
  refundPrompt() { return 'Refunds are processed within 3 business days.'; }
}
```

Characteristic points:

- **The input schema comes from the existing `@Validated({ types: [Dto] })`** — the
  same DTO that validates the HTTP body. No second parameter-decorator vocabulary
  is introduced; call arguments are validated through the shared `koatty_validation`
  whitelist path (unknown fields are stripped, illegal values become JSON-RPC
  `-32602`).
- **The handler instance is resolved from the IoC container** (singleton/request
  scope as declared by the component), never constructed ad hoc.
- **Every call runs inside the existing request scope** and the Core
  AsyncLocalStorage context: `ctx.principal`, `ctx.mcpSessionId`, `ctx.signal` and
  `ctx.progress()` are populated on the request context — there is no parallel
  ToolContext store.
- **`@Tool`/`@Resource`/`@Prompt` metadata is read from the IoC metadata store**,
  so inheritance and the existing loader/scan flow keep working.

## Host it

```ts
import { createMcpHost, createApiKeyAuth, createMcpHttpAdapter } from 'koatty_mcp';

const host = createMcpHost({
  app: this.app,                                    // Koatty instance
  security: {
    auth: createApiKeyAuth({ keys: { 'svc-key': ['order:refund'] } }),
    strict: true,                                   // destructive ⇒ approval unless opted out
    allowedOrigins: ['https://app.example.com'],    // Origin allowlist (DNS rebinding)
  },
  approval: myApprovalService,                      // human-in-the-loop backend
  audit: myAuditSink,                               // redacted structured records
});

// Mount the Streamable HTTP transport (default path /mcp) on the existing HTTP service.
const adapter = createMcpHttpAdapter({ host });
app.use(adapter.middleware);
```

Local debugging over stdio (no HTTP headers; identity comes from `stdioIdentity`):

```ts
import { startStdioServer } from 'koatty_mcp';
await startStdioServer({ host });
```

## Per-call pipeline

Identical for HTTP and stdio, in order:

1. tool lookup → JSON-RPC invalid params when unknown;
2. authentication → principal (API key, OAuth 2.1 bearer, or stdio identity);
3. scope check → denied before any business code runs;
4. DTO validation → whitelist stripping, JSON-RPC error on illegal input;
5. approval gate → high-risk tools need an explicit decision, **fail closed**
   (no backend configured ⇒ never executed);
6. request scope + Core context → container scope and ALS per call;
7. audit → redacted structured record (`success` / `denied` / `pending-approval` / …).

Protocol safety: the Origin header is validated and local mode binds `127.0.0.1`
by default.

## Exports

| Area | Exports |
|---|---|
| Decorators | `Tool`, `Resource`, `Prompt` |
| Schema | `dtoToJsonSchema`, `emptyInputSchema` |
| Registry | `createRegistry`, `compileUriTemplate`, `resolveDtoClass`, `McpRegistry`, … |
| Security | `createApiKeyAuth`, `createBearerAuth`, `assertScopes`, `checkOrigin`, `hasRequiredScopes`, `readHeader`, `McpAuthError`, `McpScopeError` |
| Approval / audit | `evaluateApproval`, `emitAudit`, `summarizeArguments`, `McpApprovalError`, `McpApprovalTimeoutError` |
| Context | `createCallContext`, `runWithContext`, `runInRequestScope` |
| Host | `createMcpHost`, `McpHost` |
| Transport | `createMcpHttpAdapter`, `DEFAULT_MCP_HOST`, `startStdioServer`, `createInMemoryPair` |

## Verify

```bash
npx jest test/regression/F-01 --coverage=false   # 19 cases: discovery, schema,
                                                 # validation, scopes, approval,
                                                 # request scope, audit, Origin
npx tsc -p tsconfig.json --noEmit
```

## License

BSD-3-Clause
