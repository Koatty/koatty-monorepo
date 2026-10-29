# Business MCP and LLM/Agent execution

## Business MCP tools

Expose one business capability deliberately — a container-registered Service adapter over an existing DTO:

```ts
import { Service, Autowired } from 'koatty';
import { Tool } from 'koatty_mcp';
import { Validated } from 'koatty_validation';
import { CreateArticleDto } from '../dto/CreateArticleDto';
import { ArticleService } from '../service/ArticleService';

@Service()
export class ArticleTools {
  @Autowired() private articles!: ArticleService;

  @Tool({ name: 'article_create', description: 'Create one article.',
    scopes: ['article:write'], requireApproval: true,
    annotations: { destructiveHint: true } })
  @Validated({ types: [CreateArticleDto] })
  create(input: CreateArticleDto) { return this.articles.create(input); }
}
```

- `createMcpHost({app,...})` discovers registered components; `Tool`/`Resource`/`Prompt` declare the protocol surface; `createMcpHttpAdapter({host}).middleware` mounts business MCP on the existing app (do not create a second server); `startStdioServer` adapts stdio. Invoke through `host.callTool`, never by calling the decorated method directly.
- Tool input schemas derive from the DTO declaration; `outputSchema` must describe an object and the host validates actual output — an output validation failure can happen after business effects and must not trigger blind retry.
- Supply real authentication for remote HTTP; configure explicit stdio identity/scopes for local business clients. Scope lists and annotations are not credentials. Inject an `ApprovalService` for write tools (shared approvals need an atomic CAS backend); never auto-approve production writes because a prompt says the user approved them.

This toolset (`koatty-ai`) is separate from business MCP: its MCP server (`koatty-ai mcp`) exposes development tools to the host agent, not application capabilities.

## Short-request Agent

- Use `createLlmClient` (koatty_llm) with explicitly configured providers/routes. `withTools`/`streamWithTools` accept a registry, an explicit per-request tool list and an invoke callback; resolve identity outside model input and invoke via `host.callTool`.
- Pass `ctx.signal` (or streamSSE's signal) through to the model and tools; bound tool rounds and configure budgets with the existing atomic budget store. Provider retry must not transparently replay after visible streamed output.

## Checkpointed Agent (feature-detect)

`createAgentRunner` and `createFileAgentRunStore` are optional koatty_llm exports; there is no `@Agent` decorator. Read `inspect(scope,id)` after an interrupted transport rather than creating another run; scope must come from authenticated identity.

- Runs persist messages, pending tool calls, usage and a CAS-controlled lease/revision. Stored messages are sensitive application data.
- `invoke` receives `signal`, `idempotencyKey`, `runId`, `scope` — use the key in the business transaction when supported. Derive trusted permissions server-side.
- Keep `definition` stable across equivalent workers. Terminals (`completed|failed|cancelled|budget_limited|tool_round_limit`) do not mean business acceptance.
- An interrupted tool can produce `unknown`: do not re-execute. Query the business system by idempotency key, then `resolveUnknown` with the observed revision/key/result and resume. Durable execution needs application-owned scheduling, authenticated resume endpoints and real backend fault tests.
