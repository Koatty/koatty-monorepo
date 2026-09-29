/**
 * Public types of `koatty_llm` (roadmap Phase F, item F-2).
 *
 * The client is provider-agnostic: every adapter only has to turn its wire
 * protocol into an async iterable of {@link LlmChunk}. Everything else
 * (routing, failover, retry, budgets, caching, structured output and the tool
 * loop) is implemented once, in this package.
 *
 * @License BSD-3-Clause
 */

export type JsonSchema = Record<string, any>;

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** Tool result messages reference the call they answer. */
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmChunk {
  type: 'text' | 'tool_call' | 'done';
  /** Present for `text` chunks. */
  delta?: string;
  /** Present for `tool_call` chunks (complete call, not incremental fragments). */
  toolCall?: LlmToolCall;
  finishReason?: string;
  usage?: LlmUsage;
  /** Actual provider/model for this attempt (including failover). */
  provider?: string;
  model?: string;
  cost?: number;
}

export interface ProviderRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Structured output requested: the provider must honour it when supported. */
  responseSchema?: { name: string; schema: JsonSchema };
}

/**
 * A provider adapter. Implementations must:
 * - stream chunks (never buffer the whole response);
 * - stop promptly when `request.signal` aborts;
 * - throw {@link LlmError} with a `retryable` hint for transport failures.
 */
export interface LlmProvider {
  readonly name: string;
  stream(request: ProviderRequest): AsyncIterable<LlmChunk>;
}

export interface LlmToolDefinition {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

/** Injected tool lookup (a `koatty_mcp` registry satisfies this). */
export interface ToolRegistryLike {
  getTool(name: string): { name: string; description?: string; inputSchema: JsonSchema } | undefined;
}

/** Executes one tool call in-process (a `koatty_mcp` host satisfies this). */
export interface ToolInvoker {
  (name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface ModelRoute {
  /** Logical model name, as written in the configuration. */
  model: string;
  /** Preferred provider name; the first registered provider is used when absent. */
  provider?: string;
  /** Ordered fallbacks (logical model names) tried when the primary fails. */
  fallbacks?: string[];
  /** Provider-side model id; defaults to `model`. */
  providerModel?: string;
  pricePer1kPrompt?: number;
  pricePer1kCompletion?: number;
}

/** Distributed token counter (a `koatty_store` client satisfies this shape). */
export interface BudgetStore {
  get(key: string): Promise<number | undefined> | number | undefined;
  set(key: string, value: number, ttlMs?: number): Promise<void> | void;
  incrBy(key: string, delta: number, ttlMs?: number): Promise<number> | number;
}

export interface BudgetOptions {
  /** Tokens allowed per scope (`options.budgetScope` of the request). */
  maxTokens: number;
  scope?: string;
  store: BudgetStore;
  /** Per-attempt completion reservation when maxTokens is omitted. Default 1024. */
  defaultMaxTokens?: number;
  /** Fraction of the budget at which a warning is logged (0..1). Default 0.8. */
  warnAt?: number;
  /** Use a provider tokenizer when available; the default is an estimate. */
  estimatePromptTokens?: (messages: LlmMessage[], tools?: LlmToolDefinition[]) => number;
}

/** Exact-match response cache (a `koatty_cacheable` service satisfies this shape). */
export interface LlmCache {
  get(key: string): Promise<any> | any;
  set(key: string, value: any, ttlMs?: number): Promise<void> | void;
}

export interface ReliabilityOptions {
  /** Total attempts per model (1 = no retry). Default 2. */
  attempts?: number;
  /** Base backoff in ms; doubles per attempt with jitter. Default 200. */
  backoffMs?: number;
  /** Per-attempt timeout in ms. Default 60000. */
  timeoutMs?: number;
  /** Consecutive failures before a model is short-circuited. Default 5. */
  breakerThreshold?: number;
  /** Breaker open duration in ms. Default 30000. */
  breakerResetMs?: number;
}

export interface LlmConfig {
  providers: LlmProvider[];
  /** Logical model name -> route. `default` must exist. */
  routes: Record<string, ModelRoute>;
  /** Logical model used when the request omits `model`. Default `default`. */
  defaultModel?: string;
  reliability?: ReliabilityOptions;
  budget?: BudgetOptions;
  cache?: LlmCache;
  /** Cache TTL in ms. Default 60000. */
  cacheTtlMs?: number;
  /** Structured-output retries after a validation failure. Default 1. */
  validationRetries?: number;
  /** Max tool-call rounds in `withTools()`. Default 5. */
  maxToolRounds?: number;
  logger?: LlmLogger;
  /** Application tool registry used to resolve names in stream/complete. */
  registry?: ToolRegistryLike;
  /** Inspect/mask each outgoing request, including tool results and corrections. */
  prepareMessages?: (messages: LlmMessage[]) => LlmMessage[] | Promise<LlmMessage[]>;
  /** One lifecycle per actual provider attempt, including retries and failures. */
  observeAttempt?: (input: { provider: string; model: string; route: string; messages: LlmMessage[] }) =>
    { end(result: { usage?: LlmUsage; cost?: number; status: 'success' | 'error' | 'cancelled'; durationMs: number; finishReason?: string }): void };
}

export interface LlmLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface LlmRequestOptions {
  model?: string;
  messages: LlmMessage[];
  tools?: Array<string | LlmToolDefinition>;
  registry?: ToolRegistryLike;
  temperature?: number;
  maxTokens?: number;
  /** Cancellation, normally `ctx.signal` (populated by the protocol adapter). */
  signal?: AbortSignal;
  /** Requests provider-side JSON output matching this schema. */
  schema?: JsonSchema;
  /** DTO class validated with `koatty_validation` after the JSON is parsed. */
  dto?: any;
  /** Reject unknown fields / illegal values (shared whitelist policy). */
  partial?: boolean;
  /** Token budget scope (user / tenant / request id). */
  budgetScope?: string;
  /** Set to false to bypass the exact-match cache. */
  cache?: boolean;
  /** Extra cache-key discriminator; scoped to this client, DTO and effective request. */
  cacheKey?: string;
  progress?: (current: number, total?: number, message?: string) => Promise<void> | void;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  finishReason?: string;
  model: string;
  /** Provider-side model id, distinct from the requested logical route. */
  responseModel?: string;
  provider: string;
  /** Whether the response came from the cache. */
  cached: boolean;
  /** Cost estimate, when the route declares prices. */
  cost?: number;
}

export interface ToolLoopOptions extends LlmRequestOptions {
  registry: ToolRegistryLike;
  invoke: ToolInvoker;
  /** Round cap; defaults to `config.maxToolRounds`. */
  maxRounds?: number;
}

export interface ToolLoopResult extends LlmResult {
  /** Final chat history including tool results, ready for a follow-up turn. */
  messages: LlmMessage[];
  rounds: number;
}
