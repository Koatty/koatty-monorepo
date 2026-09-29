/**
 * koatty_llm — LLM calling abstraction for Koatty (roadmap Phase F, item F-2).
 *
 * Provider adapters, model routing with failover, timeout/retry/circuit
 * breaker, token budgets, exact-match caching, structured output validated with
 * `koatty_validation`, and a tool-call loop that invokes the tools registered in
 * this application (see `koatty_mcp`).
 *
 * Deliberately NOT included: agent orchestration DSLs and multi-agent
 * frameworks — those change too fast; the framework only ships reliable
 * primitives.
 *
 * @License BSD-3-Clause
 */
export * from './types';
export {
  LlmError,
  LlmAbortError,
  LlmTimeoutError,
  LlmBudgetError,
  LlmValidationError,
  LlmUnavailableError,
  toLlmError,
} from './errors';
export type { LlmErrorCode } from './errors';
export {
  createOpenAiCompatibleProvider,
  createAnthropicProvider,
  readSse,
  toolCallChunk,
} from './providers';
export type { ProviderOptions } from './providers';
export {
  createLlmClient,
  estimateTokens,
  parseJsonOutput,
  resetBreakers,
} from './client';
export type { LlmClient } from './client';
