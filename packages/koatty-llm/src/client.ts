/**
 * The LLM client (roadmap Phase F, item F-2).
 *
 * Responsibilities, all implemented once for every provider:
 * - **routing**: logical model name -> provider + provider-side model id;
 * - **failover**: ordered fallbacks, tried only for retryable failures;
 * - **reliability**: per-attempt timeout, exponential backoff with jitter for
 *   429/5xx only, circuit breaker per provider+model;
 * - **budget**: pre-flight check and post-call accounting through an injected
 *   store (so several instances can share a counter);
 * - **cancellation**: `options.signal` (normally `ctx.signal`) is propagated to
 *   the provider and re-checked between chunks, so an aborted call stops
 *   promptly instead of only when the provider decides to stop;
 * - **structured output**: JSON schema at the provider, then `koatty_validation`
 *   against the DTO, with a bounded retry;
 * - **caching**: exact-match cache for non-streaming calls;
 * - **tool loop**: model requests a tool -> in-process invocation -> result fed
 *   back, with a hard round cap.
 *
 * @License BSD-3-Clause
 */
import { createHash } from 'crypto';
import { checkValidated } from 'koatty_validation';
import {
  LlmAbortError,
  LlmBudgetError,
  LlmError,
  LlmTimeoutError,
  LlmUnavailableError,
  LlmValidationError,
  toLlmError,
} from './errors';
import type {
  LlmChunk,
  LlmConfig,
  LlmLogger,
  LlmMessage,
  LlmRequestOptions,
  LlmResult,
  LlmToolCall,
  LlmToolDefinition,
  LlmUsage,
  ModelRoute,
  ProviderRequest,
  ToolLoopOptions,
  ToolLoopResult,
} from './types';

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 200;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BREAKER_THRESHOLD = 5;
const DEFAULT_BREAKER_RESET_MS = 30_000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_VALIDATION_RETRIES = 1;
const DEFAULT_TOOL_ROUNDS = 5;

interface BreakerState {
  failures: number;
  openedAt?: number;
}

interface Candidate {
  model: string;
  route: ModelRoute;
  providerName: string;
  providerModel: string;
}

export interface LlmClient {
  readonly config: LlmConfig;
  /** Raw routed stream (routing, failover, timeout, aborts). */
  stream(options: LlmRequestOptions): AsyncGenerator<LlmChunk>;
  /** Collected response, structured output validation and exact-match caching. */
  complete(options: LlmRequestOptions): Promise<LlmResult>;
  /** Full tool-call loop over a `koatty_mcp` style registry + invoker. */
  withTools(options: ToolLoopOptions): Promise<ToolLoopResult>;
  /** Cost estimate for a usage, when the route declares prices. */
  estimateCost(model: string, usage: LlmUsage): number | undefined;
}

const breakers = new Map<string, BreakerState>();

function breakerKey(candidate: Candidate): string {
  return `${candidate.providerName}:${candidate.providerModel}`;
}

/** Reset circuit breakers (tests / admin tooling). */
export function resetBreakers(): void {
  breakers.clear();
}

function breakerIsOpen(candidate: Candidate, resetMs: number): boolean {
  const state = breakers.get(breakerKey(candidate));
  if (!state?.openedAt) return false;
  if (Date.now() - state.openedAt >= resetMs) {
    breakers.delete(breakerKey(candidate));
    return false;
  }
  return true;
}

function recordFailure(candidate: Candidate, threshold: number): void {
  const key = breakerKey(candidate);
  const state = breakers.get(key) ?? { failures: 0 };
  state.failures += 1;
  if (state.failures >= threshold) state.openedAt = Date.now();
  breakers.set(key, state);
}

function recordSuccess(candidate: Candidate): void {
  breakers.delete(breakerKey(candidate));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmAbortError());
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new LlmAbortError());
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Cheap provider-independent estimate used for progress and budget fallback:
  // ~4 characters per token for latin text, ~1.5 for CJK-dense text.
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.max(1, Math.ceil(cjk / 1.5 + rest / 4));
}

function usageOf(chunks: LlmChunk[], text: string): LlmUsage {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const usage = chunks[index].usage;
    if (usage && (usage.totalTokens || usage.promptTokens || usage.completionTokens)) return usage;
  }
  const completionTokens = estimateTokens(text);
  return { promptTokens: 0, completionTokens, totalTokens: completionTokens };
}

function buildCandidates(config: LlmConfig, model: string): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const queue: string[] = [model];
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const route = config.routes[current];
    if (!route) {
      if (current === model && Object.keys(config.routes).length === 0) {
        throw new LlmError('koatty_llm: no model routes configured.', { code: 'no_route' });
      }
      continue;
    }
    const providerName = route.provider ?? config.providers[0]?.name;
    const provider = config.providers.find((item) => item.name === providerName);
    if (!provider) {
      throw new LlmError(`koatty_llm: provider "${providerName}" is not registered for model "${current}".`, {
        code: 'no_route',
      });
    }
    candidates.push({
      model: current,
      route,
      providerName: provider.name,
      providerModel: route.providerModel ?? current,
    });
    for (const fallback of route.fallbacks ?? []) queue.push(fallback);
  }
  if (!candidates.length) {
    throw new LlmError(`koatty_llm: unknown model "${model}".`, { code: 'no_route' });
  }
  return candidates;
}

function cacheKeyFor(options: LlmRequestOptions, model: string): string {
  if (options.cacheKey) return options.cacheKey;
  const payload = JSON.stringify({
    model,
    messages: options.messages,
    tools: options.tools,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    schema: options.schema,
  });
  return `llm:${createHash('sha1').update(payload).digest('hex')}`;
}

/** Strip a ```json fence, if the model added one despite the schema. */
export function parseJsonOutput(text: string): { value?: any; error?: string } {
  const trimmed = String(text ?? '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  if (!candidate) return { error: 'empty response' };
  try {
    return { value: JSON.parse(candidate) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export function createLlmClient(config: LlmConfig): LlmClient {
  if (!config?.providers?.length) throw new LlmError('koatty_llm: at least one provider is required.', { code: 'no_route' });
  const reliability = config.reliability ?? {};
  const attempts = Math.max(1, reliability.attempts ?? DEFAULT_ATTEMPTS);
  const backoffMs = reliability.backoffMs ?? DEFAULT_BACKOFF_MS;
  const timeoutMs = reliability.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const breakerThreshold = reliability.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
  const breakerResetMs = reliability.breakerResetMs ?? DEFAULT_BREAKER_RESET_MS;
  const cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const validationRetries = config.validationRetries ?? DEFAULT_VALIDATION_RETRIES;
  const maxToolRounds = config.maxToolRounds ?? DEFAULT_TOOL_ROUNDS;
  const logger: LlmLogger | undefined = config.logger;
  const defaultModel = config.defaultModel ?? 'default';

  const budgetKey = (scope: string) => `llm:budget:${config.budget?.scope ?? 'global'}:${scope}`;

  async function chargeBudget(scope: string | undefined, tokens: number, model: string, provider: string): Promise<void> {
    const budget = config.budget;
    if (!budget || !scope || tokens <= 0) return;
    const key = budgetKey(scope);
    const store = budget.store;
    if (!store) return;
    try {
      if (typeof store.incrBy === 'function') {
        const used = await store.incrBy(key, tokens);
        if (used > budget.maxTokens) {
          throw new LlmBudgetError(scope, used, budget.maxTokens, { provider, model });
        }
        return;
      }
      const used = (await store.get(key)) ?? 0;
      const next = used + tokens;
      await store.set(key, next);
      if (next > budget.maxTokens) {
        throw new LlmBudgetError(scope, next, budget.maxTokens, { provider, model });
      }
    } catch (error) {
      if (error instanceof LlmBudgetError) throw error;
      logger?.warn('koatty_llm: token accounting failed', { scope, error: (error as Error).message });
    }
  }

  async function guardBudget(scope: string | undefined, model: string, provider: string): Promise<void> {
    const budget = config.budget;
    if (!budget || !scope) return;
    const store = budget.store;
    if (!store) return;
    const used = (await store.get(budgetKey(scope))) ?? 0;
    if (used >= budget.maxTokens) throw new LlmBudgetError(scope, used, budget.maxTokens, { provider, model });
    const warnAt = budget.warnAt ?? 0.8;
    if (used >= budget.maxTokens * warnAt) {
      logger?.warn('koatty_llm: token budget nearly exhausted', { scope, used, max: budget.maxTokens });
    }
  }

  /**
   * Run one attempt against one candidate, yielding chunks. A provider failure
   * is converted to {@link LlmError} and only surfaces after the first chunk
   * (partial output cannot be transparently retried).
   */
  async function* attempt(candidate: Candidate, request: ProviderRequest): AsyncGenerator<LlmChunk> {
    const provider = config.providers.find((item) => item.name === candidate.providerName)!;
    const iterator = provider.stream(request)[Symbol.asyncIterator]();
    for (;;) {
      const { value, done } = await iterator.next();
      if (done) return;
      yield value;
    }
  }

  async function* streamRouted(
    options: LlmRequestOptions,
    tools: LlmToolDefinition[] | undefined,
    overrideMessages?: LlmMessage[],
    state?: { candidate?: Candidate },
  ): AsyncGenerator<LlmChunk> {
    const model = options.model ?? defaultModel;
    const candidates = buildCandidates(config, model).filter((candidate) => !breakerIsOpen(candidate, breakerResetMs));
    if (!candidates.length) {
      throw new LlmError(`koatty_llm: every route for "${model}" is short-circuited by the circuit breaker.`, {
        code: 'breaker_open',
        retryable: true,
      });
    }

    const failures: Array<{ model: string; provider?: string; error: string }> = [];
    let lastError: LlmError | undefined;

    for (let round = 1; round <= attempts; round += 1) {
      for (const candidate of candidates) {
        if (options.signal?.aborted) throw new LlmAbortError(undefined, { provider: candidate.providerName, model });
        await guardBudget(options.budgetScope, candidate.model, candidate.providerName);
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        options.signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let timedOut = false;
        const onTimeout = () => {
          timedOut = true;
        };
        controller.signal.addEventListener('abort', onTimeout, { once: true });

        const request: ProviderRequest = {
          model: candidate.providerModel,
          messages: overrideMessages ?? options.messages,
          tools,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          signal: controller.signal,
          responseSchema: options.schema ? { name: 'structured_output', schema: options.schema } : undefined,
        };

        try {
          if (state) state.candidate = candidate;
          for await (const chunk of attempt(candidate, request)) {
            if (options.signal?.aborted) throw new LlmAbortError(undefined, { provider: candidate.providerName, model });
            yield chunk;
          }
          recordSuccess(candidate);
          return;
        } catch (error) {
          const normalized =
            timedOut && !options.signal?.aborted
              ? new LlmTimeoutError(undefined, { provider: candidate.providerName, model })
              : toLlmError(error, { provider: candidate.providerName, model: candidate.model });
          if (normalized instanceof LlmAbortError && options.signal?.aborted) throw normalized;
          if (normalized.retryable) recordFailure(candidate, breakerThreshold);
          failures.push({ model: candidate.model, provider: candidate.providerName, error: normalized.message });
          lastError = normalized;
          if (!normalized.retryable) {
            throw normalized;
          }
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
        }
      }
      if (round < attempts) {
        await sleep(backoffMs * 2 ** (round - 1) + Math.floor(Math.random() * backoffMs), options.signal);
      }
    }

    throw new LlmUnavailableError(failures.length ? failures : [{ model, error: lastError?.message ?? 'unknown' }], {
      code: lastError?.code,
      retryable: lastError?.retryable,
    });
  }

  function costOf(model: string, usage: LlmUsage): number | undefined {
    const route = config.routes[model];
    if (!route || (route.pricePer1kPrompt === undefined && route.pricePer1kCompletion === undefined)) return undefined;
    const prompt = ((route.pricePer1kPrompt ?? 0) * usage.promptTokens) / 1000;
    const completion = ((route.pricePer1kCompletion ?? 0) * usage.completionTokens) / 1000;
    return Number((prompt + completion).toFixed(6));
  }

  async function runComplete(options: LlmRequestOptions): Promise<LlmResult> {
    const model = options.model ?? defaultModel;
    const tools = Array.isArray(options.tools)
      ? options.tools.filter((tool): tool is LlmToolDefinition => typeof tool !== 'string')
      : undefined;
    let attemptIndex = 0;
    for (;;) {
      const state: { candidate?: Candidate } = {};
      const stream = streamRouted(options, tools?.length ? tools : undefined, undefined, state);
      const first = await stream.next();
      const chunks: LlmChunk[] = [];
      let text = '';
      const toolCalls: LlmToolCall[] = [];
      let finishReason: string | undefined;
      const consume = async (chunk: LlmChunk) => {
        chunks.push(chunk);
        if (chunk.type === 'text' && chunk.delta) {
          text += chunk.delta;
          await options.progress?.(estimateTokens(text), undefined, 'streaming');
        }
        if (chunk.type === 'tool_call' && chunk.toolCall) toolCalls.push(chunk.toolCall);
        if (chunk.type === 'done') finishReason = chunk.finishReason ?? finishReason;
      };
      if (!first.done && first.value) await consume(first.value);
      for await (const chunk of stream) await consume(chunk);

      const usage = usageOf(chunks, text);
      const provider = state.candidate?.providerName ?? config.providers[0].name;
      const result: LlmResult = {
        text,
        toolCalls,
        usage,
        finishReason,
        model,
        provider,
        cached: false,
        cost: costOf(model, usage),
      };

      if (!options.schema && !options.dto) {
        await chargeBudget(options.budgetScope, usage.totalTokens, model, provider);
        return result;
      }

      const parsed = parseJsonOutput(text);
      if (parsed.error) {
        if (attemptIndex < validationRetries) {
          attemptIndex += 1;
          options.messages = withCorrection(options.messages, `Your previous answer was not valid JSON (${parsed.error}).`);
          continue;
        }
        throw new LlmValidationError(`Structured output was not valid JSON: ${parsed.error}`, [parsed.error], text, {
          provider,
          model,
        });
      }
      if (options.dto) {
        try {
          const { validatedArgs } = await checkValidated([parsed.value], [options.dto], options.partial ?? false);
          const validated = validatedArgs?.[0];
          await chargeBudget(options.budgetScope, usage.totalTokens, model, provider);
          return { ...result, text: JSON.stringify(validated) };
        } catch (error) {
          const issues = (error as any)?.errors ?? [(error as Error).message];
          if (attemptIndex < validationRetries) {
            attemptIndex += 1;
            options.messages = withCorrection(
              options.messages,
              `Your previous answer failed DTO validation: ${JSON.stringify(issues).slice(0, 500)}.`,
            );
            continue;
          }
          throw new LlmValidationError('Structured output failed DTO validation.', issues, text, { provider, model });
        }
      }
      await chargeBudget(options.budgetScope, usage.totalTokens, model, provider);
      return result;
    }
  }

  return {
    config,
    stream(options: LlmRequestOptions): AsyncGenerator<LlmChunk> {
      return streamRouted(options, undefined);
    },
    async complete(options: LlmRequestOptions): Promise<LlmResult> {
      const model = options.model ?? defaultModel;
      const cache = config.cache;
      const cacheable = !!cache && options.cache !== false && !options.signal;
      const key = cacheable ? cacheKeyFor(options, model) : '';
      if (cacheable) {
        const hit = await cache!.get(key);
        if (hit) {
          return { ...(hit as LlmResult), cached: true };
        }
      }
      const result = await runComplete({ ...options });
      if (cacheable) {
        try {
          await cache!.set(key, { ...result, cached: false }, cacheTtlMs);
        } catch (error) {
          logger?.warn('koatty_llm: cache write failed', { error: (error as Error).message });
        }
      }
      return result;
    },
    async withTools(options: ToolLoopOptions): Promise<ToolLoopResult> {
      const tools: LlmToolDefinition[] = [];
      for (const entry of options.tools ?? []) {
        if (typeof entry !== 'string') {
          tools.push(entry);
          continue;
        }
        const registered = options.registry.getTool(entry);
        if (!registered) {
          throw new LlmError(`koatty_llm: tool "${entry}" is not registered.`, { code: 'bad_request' });
        }
        tools.push({ name: registered.name, description: registered.description, inputSchema: registered.inputSchema });
      }

      const messages: LlmMessage[] = [...options.messages];
      const maxRounds = options.maxRounds ?? maxToolRounds;
      let rounds = 0;
      let result: LlmResult = {
        text: '',
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: options.model ?? defaultModel,
        provider: config.providers[0].name,
        cached: false,
      };

      for (;;) {
        result = await this.complete({ ...options, messages, tools: tools.length ? tools : undefined });
        if (!result.toolCalls.length) break;
        if (rounds >= maxRounds) break;
        rounds += 1;
        messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          let output: unknown;
          try {
            output = await options.invoke(call.name, call.args);
          } catch (error) {
            output = { error: (error as Error).message };
          }
          messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(output ?? null) });
        }
      }

      return { ...result, messages, rounds };
    },
    estimateCost(model: string, usage: LlmUsage): number | undefined {
      return costOf(model, usage);
    },
  };
}

function withCorrection(messages: LlmMessage[], note: string): LlmMessage[] {
  return [...messages, { role: 'user', content: `[koatty_llm] ${note} Answer again with valid JSON only.` }];
}
