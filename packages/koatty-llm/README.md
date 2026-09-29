# koatty_llm

LLM calling abstraction for Koatty: one interface for every vendor, plus the
reliability, budget and safety plumbing that production calls need.

> Roadmap: `docs/koatty-hardening-and-ai-evolution-plan.md` → Phase F, item **F-2**.
> Deliberately NOT included: agent orchestration DSLs and multi-agent frameworks.

## Install

```bash
pnpm add koatty_llm
```

`koatty_validation` is required; `koatty_store` (distributed token counting) and
`koatty_cacheable` (response cache) are optional peers — any object with the two
documented methods works, so a custom Redis/DB client is fine too.

## Use

```ts
import { Service } from 'koatty_core';
import { Autowired } from 'koatty_container';
import { createOpenAiCompatibleProvider, createLlmClient } from 'koatty_llm';

const llm = createLlmClient({
  providers: [
    createOpenAiCompatibleProvider({ name: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY }),
    createOpenAiCompatibleProvider({ name: 'local', baseUrl: 'http://127.0.0.1:11434/v1' }),
  ],
  routes: {
    // logical name -> provider + provider-side model, with ordered failover
    default: { model: 'default', provider: 'openai', providerModel: 'gpt-4o-mini', fallbacks: ['local'] },
    local: { model: 'local', provider: 'local', providerModel: 'llama3.1' },
  },
  reliability: { attempts: 2, backoffMs: 200, timeoutMs: 60_000, breakerThreshold: 5 },
  budget: { maxTokens: 200_000, scope: 'tenant', store: redisStore },
  cache: cacheableService,
});

@Service()
export class SupportAgent {
  async answer(question: string, signal: AbortSignal) {
    // returns an AsyncIterable — pipe it through the existing streamSSE helper
    return llm.stream({
      model: 'default',
      messages: [{ role: 'user', content: question }],
      signal,                      // ctx.signal: aborting cancels the provider call
      budgetScope: 'tenant-42',
    });
  }
}
```

## Capabilities

| Capability | Notes |
|---|---|
| Provider abstraction | `createOpenAiCompatibleProvider` (OpenAI, Azure-compatible gateways, most vendors, vLLM/Ollama) and `createAnthropicProvider`. Both are `fetch` + SSE, so a proxy/instrumented `fetchImpl` can be injected. |
| Model routing | Logical model name → provider + provider-side model id; `fallbacks` are tried in order, and only for retryable failures. |
| Reliability | Per-attempt timeout, exponential backoff with jitter for **429/5xx only**, circuit breaker per provider+model (`resetBreakers()` for admin use). |
| Budget | Pre-flight check plus post-call accounting through `BudgetStore` (`get`/`set`/optional `incrBy`), so several instances share one counter. Exceeding the budget aborts the call — it never silently truncates. |
| Cancellation | `options.signal` is propagated to the provider **and** re-checked between chunks, so an aborted call (`ctx.signal`) stops within the provider round-trip. |
| Structured output | Pass `schema` (provider-side JSON schema) and `dto` (class-validator DTO); the parsed JSON is validated with `koatty_validation`, and `validationRetries` re-asks once with a correction message. |
| Tool calling | `withTools({ tools, registry, invoke })` runs the tool-call loop in-process: the model asks for a tool → it is invoked through your invoker (a `koatty_mcp` host satisfies it) → the result is fed back, with a hard `maxRounds` cap. |
| Caching | Exact-match cache for non-streaming `complete()` calls (`cache: false` to bypass, `cacheKey` to control the key). Semantic caching is intentionally not in v1. |
| Cost | `estimateCost()` from `pricePer1kPrompt` / `pricePer1kCompletion` on the route. |

Every result carries `model`, `provider`, `usage`, `finishReason`, `cached` and
(optionally) `cost` — feed those into your trace/metrics layer.

## Errors

`LlmError` subclasses tell the caller what to do:

| Error | When | Retryable |
|---|---|---|
| `LlmAbortError` | caller aborted (`ctx.signal`) | no |
| `LlmTimeoutError` | per-attempt timeout | yes |
| `LlmBudgetError` | scope budget exhausted (`scope`, `used`, `max`) | no |
| `LlmValidationError` | structured output is not JSON or fails the DTO (`issues`, `raw`) | no |
| `LlmUnavailableError` | every route/attempt failed (`attempts`, plus the last error `code`) | per last error |
| `LlmError` | provider 4xx/5xx first failure | 429/5xx only |

## Verify

```bash
npx jest test/regression/F-02 --coverage=false   # 19 cases: cancellation ≤1s,
                                                 # failover/retry/breaker, budget,
                                                 # structured output, tool loop,
                                                 # cache, both adapters
npx tsc -p tsconfig.json --noEmit
```

## License

BSD-3-Clause
