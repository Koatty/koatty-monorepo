## Unreleased — Phase A–F review (2026-09-30)

Bound per-attempt reservations; release immediate failures; enforce timeout independently of provider cooperation; isolate/refresh DTO caches; align streaming tool allowlists and contain cleanup/settlement errors. Budget store/incrBy are required.

Migration: `docs/migration/phase-a-f-review-fixes.md` in the monorepo. No release has been applied.

# Changelog

## Unreleased — Phase F audit fixes (2026-09-29)

- 修复工具白名单、逐尝试原子预算预留与流式结算、输出后禁止重试、流资源释放、缓存 DTO 重验；新增流式工具循环、出站消息钩子和每次实际尝试遥测。
- 迁移说明：`docs/migration/phase-f-audit-fixes.md`（主仓库）。


All notable changes to `koatty_llm` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 1.0.0

First release — the LLM calling abstraction (roadmap Phase F, item F-2).
Scope is deliberately limited to calling models reliably; agent orchestration
frameworks are out of scope.

### Added

- Unified `LlmClient` (`createLlmClient`) with `complete()` and `stream()` over a
  provider abstraction; every result reports `model`, `provider`, `usage`,
  `finishReason`, `cached` and optional `cost`.
- Provider adapters over `fetch` + SSE: `createOpenAiCompatibleProvider`
  (OpenAI, compatible gateways, vLLM/Ollama) and `createAnthropicProvider`
  (system-message mapping, `tool_use` input streaming). `fetchImpl` is injectable
  for proxies and instrumentation.
- Model routing: logical model name → provider + provider-side model id, with
  ordered `fallbacks` used only for retryable failures.
- Reliability layer: per-attempt timeout, exponential backoff with jitter for
  429/5xx only, and a circuit breaker per provider+model (`resetBreakers()`).
- Budget enforcement with a pluggable `BudgetStore` (`get`/`set`/optional
  `incrBy`): pre-flight rejection plus post-call accounting, so a shared counter
  works across instances. Over-budget calls abort instead of truncating output.
- Cancellation through `options.signal`, propagated to the provider request and
  re-checked between streamed chunks (aborted calls stop within one round-trip).
- Structured output: provider-side JSON schema plus `koatty_validation` DTO
  validation, with a single correction re-ask (`validationRetries`).
- Tool calling loop (`withTools`): the model's tool calls are resolved through
  the caller's invoker (a `koatty_mcp` host satisfies it) and results are fed
  back, with a hard `maxRounds` cap and unknown-tool rejection.
- Exact-match response cache for non-streaming calls, using any
  `koatty_cacheable`-compatible service; `cache: false` bypasses it.
- `estimateCost()` from per-route `pricePer1kPrompt` / `pricePer1kCompletion`.
- Typed errors: `LlmError`, `LlmAbortError`, `LlmTimeoutError`, `LlmBudgetError`,
  `LlmValidationError`, `LlmUnavailableError` (the latter forwards the last
  failure's `code`/`retryable` so callers can distinguish configuration errors
  from transient outages).

### Notes

- `koatty_validation` is a hard dependency (DTO validation for structured
  output); `koatty_store` and `koatty_cacheable` are optional peers.
- No existing package behaviour changes: the package is additive, and its tests
  run offline against a scripted `fetch` double.
