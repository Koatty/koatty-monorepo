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
import { checkValidated, dtoToJsonSchema } from 'koatty_validation';
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
  /** Stream the same bounded, allowlisted tool loop. */
  streamWithTools(options: ToolLoopOptions): AsyncGenerator<LlmChunk>;
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

function cacheKeyFor(options: LlmRequestOptions, model: string, routes: LlmConfig['routes']): string {
  const payload = JSON.stringify({
    model,
    messages: options.messages,
    tools: options.tools,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    schema: options.schema,
    partial: options.partial,
    routes,
    key: options.cacheKey,
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
  if (config.budget && (!config.budget.store?.incrBy || !Number.isSafeInteger(config.budget.maxTokens) || config.budget.maxTokens <= 0)) {
    throw new LlmError('Token budgets require a positive integer limit and an atomic incrBy store.', { code: 'bad_request' });
  }

  const budgetKey = (scope: string) => `llm:budget:${config.budget?.scope ?? 'global'}:${scope}`;

  async function reserveBudget(options: LlmRequestOptions, messages: LlmMessage[], tools?: LlmToolDefinition[]) {
    const budget = config.budget;
    if (!budget) return undefined;
    const scope = options.budgetScope;
    if (!scope) throw new LlmError('budgetScope is required when token budgets are enabled.', { code: 'bad_request' });
    if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0)) throw new LlmError('maxTokens must be a positive integer.', { code: 'bad_request' });
    const key = budgetKey(scope);
    const store = budget.store!;
    const used = Number((await store.get(key)) ?? 0);
    if (!Number.isSafeInteger(used) || used < 0) throw new LlmError('Invalid budget counter.', { code: 'bad_request' });
    const prompt = budget.estimatePromptTokens?.(messages, tools) ??
      estimateTokens(messages.map(m => m.content + (m.toolCalls ? JSON.stringify(m.toolCalls) : '')).join('\n') + (tools?.length ? JSON.stringify(tools) : ''));
    if (!Number.isSafeInteger(prompt) || prompt < 0) throw new LlmError('Invalid prompt token estimate.', { code: 'bad_request' });
    const maxTokens = Math.min(options.maxTokens ?? budget.maxTokens, budget.maxTokens - used - prompt);
    if (maxTokens <= 0) throw new LlmBudgetError(scope, used + prompt, budget.maxTokens);
    const reserved = prompt + maxTokens;
    // Atomic increment is the admission gate. A competing reservation must be
    // rolled back before returning; no provider is called on rejected admission.
    const total = await store.incrBy!(key, reserved);
    if (!Number.isSafeInteger(total) || total < reserved) throw new LlmError('Invalid atomic budget counter.', { code: 'bad_request' });
    if (total > budget.maxTokens) {
      await store.incrBy!(key, -reserved);
      throw new LlmBudgetError(scope, total, budget.maxTokens);
    }
    if (used >= budget.maxTokens * (budget.warnAt ?? 0.8)) {
      logger?.warn('koatty_llm: token budget nearly exhausted', { scope, used, max: budget.maxTokens });
    }
    return { maxTokens, prompt, reserved, async settle(tokens: number) {
      const settled = await store.incrBy!(key, Math.max(0, tokens) - reserved);
      if (!Number.isSafeInteger(settled) || settled < 0) throw new LlmError('Invalid settled budget counter.', { code: 'bad_request' });
      if (settled > budget.maxTokens) throw new LlmBudgetError(scope, settled, budget.maxTokens);
    } };
  }

  /**
   * Run one attempt against one candidate, yielding chunks. A provider failure
   * is converted to {@link LlmError} and only surfaces after the first chunk
   * (partial output cannot be transparently retried).
   */
  async function* attempt(candidate: Candidate, request: ProviderRequest, controller: AbortController): AsyncGenerator<LlmChunk> {
    const provider = config.providers.find((item) => item.name === candidate.providerName)!;
    const iterator = provider.stream(request)[Symbol.asyncIterator]();
    try {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) return;
        yield value;
      }
    } finally { controller.abort(); await iterator.return?.(); }
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
        const originalMessages = overrideMessages ?? options.messages;
        const messages = config.prepareMessages ? await config.prepareMessages(originalMessages) : originalMessages;
        const reservation = await reserveBudget(options, messages, tools);
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        options.signal?.addEventListener('abort', onAbort, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        if (options.signal?.aborted) controller.abort();
        let visible = false;
        let output = '';
        let usage: LlmUsage | undefined;
        let completed = false;
        let started = false;
        let finishReason: string | undefined;
        const startedAt = Date.now();
        let observation: ReturnType<NonNullable<LlmConfig['observeAttempt']>> | undefined;

        const request: ProviderRequest = {
          model: candidate.providerModel,
          messages,
          tools,
          temperature: options.temperature,
          maxTokens: reservation?.maxTokens ?? options.maxTokens,
          signal: controller.signal,
          responseSchema: options.schema ? { name: 'structured_output', schema: options.schema } : undefined,
        };

        try {
          if (state) state.candidate = candidate;
          if (controller.signal.aborted) throw new LlmAbortError();
          observation = config.observeAttempt?.({ provider: candidate.providerName, model: candidate.providerModel, route: model, messages });
          started = true;
          for await (const chunk of attempt(candidate, request, controller)) {
            if (options.signal?.aborted) throw new LlmAbortError(undefined, { provider: candidate.providerName, model });
            if (timedOut) throw new LlmTimeoutError();
            if (chunk.usage) {
              if (Object.values(chunk.usage).some(value => !Number.isSafeInteger(value) || value < 0)) throw new LlmError('Invalid provider usage.', { code: 'provider_error' });
              usage = chunk.usage;
            }
            if (chunk.finishReason) finishReason = chunk.finishReason;
            if (chunk.type === 'text') output += chunk.delta ?? '';
            if (chunk.toolCall) output += JSON.stringify(chunk.toolCall);
            if (reservation && (usage?.totalTokens ?? reservation.prompt + estimateTokens(output)) > reservation.reserved) {
              controller.abort();
              throw new LlmBudgetError(options.budgetScope!, usage?.totalTokens ?? reservation.prompt + estimateTokens(output), config.budget!.maxTokens);
            }
            visible = true;
            yield { ...chunk, provider: candidate.providerName, model: candidate.providerModel,
              cost: chunk.usage ? costOf(candidate.model, chunk.usage) : undefined };
          }
          completed = true;
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
          if (visible || !normalized.retryable) {
            throw normalized;
          }
        } finally {
          controller.abort();
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
          try { observation?.end({ usage, cost: usage ? costOf(candidate.model, usage) : undefined,
            status: completed ? 'success' : options.signal?.aborted ? 'cancelled' : 'error',
            durationMs: Date.now() - startedAt, finishReason }); } catch { /* telemetry cannot prevent budget settlement */ }
          if (reservation) {
            // Unknown usage after interruption conservatively retains the entire
            // reservation. A caller cannot evade charges by disconnecting early.
            await reservation.settle(usage?.totalTokens ?? (!started ? 0 : completed ? reservation.prompt + estimateTokens(output) : reservation.reserved));
          }
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

  function resolveTools(options: LlmRequestOptions): LlmToolDefinition[] | undefined {
    const tools = options.tools?.map(entry => {
      if (typeof entry !== 'string') return entry;
      const tool = (options.registry ?? config.registry)?.getTool(entry);
      if (!tool) throw new LlmError(`Tool "${entry}" is not registered.`, { code: 'bad_request' });
      return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
    });
    return tools?.length ? tools : undefined;
  }

  function costOf(model: string, usage: LlmUsage): number | undefined {
    const route = config.routes[model];
    if (!route || (route.pricePer1kPrompt === undefined && route.pricePer1kCompletion === undefined)) return undefined;
    const prompt = ((route.pricePer1kPrompt ?? 0) * usage.promptTokens) / 1000;
    const completion = ((route.pricePer1kCompletion ?? 0) * usage.completionTokens) / 1000;
    return Number((prompt + completion).toFixed(6));
  }

  async function runComplete(options: LlmRequestOptions): Promise<LlmResult> {
    if (options.dto && !options.schema) options.schema = dtoToJsonSchema(options.dto, 0, options.partial);
    const model = options.model ?? defaultModel;
    const tools = resolveTools(options);
    let attemptIndex = 0;
    for (;;) {
      const state: { candidate?: Candidate } = {};
      const stream = streamRouted(options, tools?.length ? tools : undefined, undefined, state);
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
      for await (const chunk of stream) await consume(chunk);

      const usage = usageOf(chunks, text);
      const provider = state.candidate?.providerName ?? config.providers[0].name;
      const result: LlmResult = {
        text,
        toolCalls,
        usage,
        finishReason,
        model,
        responseModel: state.candidate?.providerModel,
        provider,
        cached: false,
        cost: costOf(state.candidate?.model ?? model, usage),
      };

      if (!options.schema && !options.dto) {
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
      return result;
    }
  }

  return {
    config,
    stream(options: LlmRequestOptions): AsyncGenerator<LlmChunk> {
      return streamRouted(options, resolveTools(options));
    },
    async complete(options: LlmRequestOptions): Promise<LlmResult> {
      const model = options.model ?? defaultModel;
      const cache = config.cache;
      const cacheable = !!cache && options.cache !== false && !options.signal;
      const key = cacheable ? cacheKeyFor({ ...options, tools: resolveTools(options) }, model, config.routes) : '';
      if (cacheable) {
        const hit = await cache!.get(key);
        if (hit) {
          if (options.dto || options.schema) {
            const parsed = parseJsonOutput(hit.text);
            if (parsed.error) throw new LlmValidationError('Cached output is not valid JSON.', [parsed.error], hit.text);
            if (options.dto) {
              try {
                const checked = await checkValidated([parsed.value], [options.dto], options.partial ?? false);
                return { ...hit, text: JSON.stringify(checked.validatedArgs[0]), cached: true };
              } catch { throw new LlmValidationError('Cached output failed DTO validation.', ['DTO validation failed'], hit.text); }
            }
          }
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
      const tools = resolveTools(options) ?? [];
      const allowed = new Set(tools.map(t => t.name));
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let totalCost = 0;

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
        for (const key of ['promptTokens', 'completionTokens', 'totalTokens'] as const) totalUsage[key] += result.usage[key];
        totalCost += result.cost ?? 0;
        if (!result.toolCalls.length) break;
        if (rounds >= maxRounds) break;
        rounds += 1;
        for (const call of result.toolCalls) {
          if (!allowed.has(call.name)) throw new LlmError(`Tool "${call.name}" is not allowed in this call.`, { code: 'bad_request' });
        }
        messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          if (options.signal?.aborted) throw new LlmAbortError();
          let output: unknown;
          try {
            output = await options.invoke(call.name, call.args, { signal: options.signal });
          } catch (error) {
            output = { error: (error as Error).message };
          }
          messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(output ?? null) });
        }
      }

      return { ...result, usage: totalUsage, cost: result.cost === undefined && !totalCost ? undefined : totalCost, messages, rounds };
    },
    async *streamWithTools(options: ToolLoopOptions): AsyncGenerator<LlmChunk> {
      const tools = resolveTools(options) ?? [];
      const allowed = new Set(tools.map(t => t.name));
      const messages = [...options.messages];
      const total = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let cost = 0;
      for (let round = 0; ; round++) {
        const calls: LlmToolCall[] = [];
        let text = ''; let done: LlmChunk = { type: 'done' };
        for await (const chunk of this.stream({ ...options, messages, tools })) {
          if (chunk.type === 'done') { done = chunk; continue; }
          if (chunk.toolCall) calls.push(chunk.toolCall);
          text += chunk.delta ?? '';
          yield chunk;
        }
        const usage = done.usage ?? { promptTokens: 0, completionTokens: estimateTokens(text), totalTokens: estimateTokens(text) };
        for (const key of ['promptTokens', 'completionTokens', 'totalTokens'] as const) total[key] += usage[key];
        cost += done.cost ?? 0;
        if (!calls.length || round >= (options.maxRounds ?? maxToolRounds)) {
          yield { ...done, usage: total, cost, finishReason: calls.length ? 'tool_round_limit' : done.finishReason };
          return;
        }
        for (const call of calls) if (!allowed.has(call.name)) throw new LlmError(`Tool "${call.name}" is not allowed in this call.`, { code: 'bad_request' });
        messages.push({ role: 'assistant', content: text, toolCalls: calls });
        for (const call of calls) {
          if (options.signal?.aborted) throw new LlmAbortError();
          const result = await options.invoke(call.name, call.args, { signal: options.signal });
          messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result ?? null) });
        }
      }
    },
    estimateCost(model: string, usage: LlmUsage): number | undefined {
      return costOf(model, usage);
    },
  };
}

function withCorrection(messages: LlmMessage[], note: string): LlmMessage[] {
  return [...messages, { role: 'user', content: `[koatty_llm] ${note} Answer again with valid JSON only.` }];
}
