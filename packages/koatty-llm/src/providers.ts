/**
 * Provider adapters (roadmap Phase F, item F-2).
 *
 * Two adapters cover the field without dragging a vendor SDK into every
 * install: OpenAI-compatible (the de-facto protocol of most vendors and of
 * local vLLM/Ollama) and Anthropic. Both are plain `fetch` + SSE readers, so
 * `globalThis.fetch`, a custom `fetchImpl` (proxy, instrumentation, tests) or an
 * SDK client with a compatible `fetch` all work.
 *
 * The contract every adapter honours:
 * - chunks are streamed, never buffered;
 * - `request.signal` aborts the HTTP call and the iteration promptly;
 * - failures are thrown as {@link LlmError} with a `retryable` hint.
 *
 * @License BSD-3-Clause
 */
import { LlmError, toLlmError } from './errors';
import type {
  JsonSchema,
  LlmChunk,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
  LlmToolDefinition,
  LlmUsage,
  ProviderRequest,
} from './types';

type FetchLike = (input: any, init?: any) => Promise<any>;

export interface ProviderOptions {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Injected fetch (proxy, instrumentation, tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike;
  /** Extra query string appended to the endpoint, e.g. `?api-version=...`. */
  query?: string;
}

/** Iterate the SSE `data:` payloads of a fetch response body. */
export async function* readSse(body: any): AsyncGenerator<string> {
  if (!body) return;
  const decoder = new TextDecoder();
  let buffer = '';
  const stream = typeof body.getReader === 'function' ? body.getReader() : null;
  const iterator = stream ? null : (body[Symbol.asyncIterator]?.() ?? null);

  const push = function* (text: string): Generator<string> {
    buffer += text;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
      index = buffer.indexOf('\n');
    }
  };

  for (;;) {
    const { value, done } = stream ? await stream.read() : await iterator!.next();
    if (done) break;
    if (!value) continue;
    const text = typeof value === 'string' ? value : decoder.decode(value as Uint8Array, { stream: true });
    for (const payload of push(text)) {
      if (payload === '[DONE]') return;
      if (payload) yield payload;
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const payload = tail.slice(5).trim();
    if (payload && payload !== '[DONE]') yield payload;
  }
}

async function failure(res: any, provider: string, model: string): Promise<LlmError> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    // the body may already be consumed
  }
  const status = typeof res.status === 'number' ? res.status : undefined;
  return new LlmError(`LLM provider "${provider}" responded ${status ?? 'with an error'}${detail ? `: ${detail}` : '.'}`, {
    code: status === 429 ? 'rate_limited' : status && status < 500 ? 'bad_request' : 'provider_error',
    retryable: status === 429 || status === undefined || status >= 500,
    status,
    provider,
    model,
  });
}

function emptyUsage(): LlmUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function usageFrom(raw: any): LlmUsage | undefined {
  if (!raw) return undefined;
  const promptTokens = Number(raw.prompt_tokens ?? raw.input_tokens ?? 0) || 0;
  const completionTokens = Number(raw.completion_tokens ?? raw.output_tokens ?? 0) || 0;
  const totalTokens = Number(raw.total_tokens ?? promptTokens + completionTokens) || 0;
  if (!promptTokens && !completionTokens && !totalTokens) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

function hasToolContent(message: LlmMessage): boolean {
  return Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
}

function toOpenAiMessages(messages: LlmMessage[]): any[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (hasToolContent(message)) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls!.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toOpenAiTools(tools?: LlmToolDefinition[]): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

function toAnthropicMessages(messages: LlmMessage[]): { system?: string; messages: any[] } {
  const systemParts: string[] = [];
  const converted: any[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }
    if (message.role === 'tool') {
      converted.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }],
      });
      continue;
    }
    if (hasToolContent(message)) {
      const content: any[] = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls!) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args ?? {} });
      converted.push({ role: 'assistant', content });
      continue;
    }
    converted.push({ role: message.role, content: message.content });
  }
  return { system: systemParts.length ? systemParts.join('\n\n') : undefined, messages: converted };
}

/**
 * OpenAI-compatible chat completions adapter (`/chat/completions`).
 *
 * Covers OpenAI, Azure-compatible gateways, most domestic vendors and local
 * runtimes (vLLM, Ollama, LM Studio).
 */
export function createOpenAiCompatibleProvider(options: ProviderOptions & { name?: string }): LlmProvider {
  const name = options.name ?? 'openai';
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions${options.query ?? ''}`;

  return {
    name,
    async *stream(request: ProviderRequest): AsyncIterable<LlmChunk> {
      const doFetch: FetchLike = options.fetchImpl ?? (globalThis.fetch as FetchLike);
      if (typeof doFetch !== 'function') {
        throw new LlmError('koatty_llm: no fetch implementation available.', { code: 'provider_error', provider: name });
      }
      const body: Record<string, unknown> = {
        model: request.model,
        messages: toOpenAiMessages(request.messages),
        stream: true,
        stream_options: { include_usage: true },
      };
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
      const tools = toOpenAiTools(request.tools);
      if (tools) body.tools = tools;
      if (request.responseSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: request.responseSchema.name, schema: request.responseSchema.schema, strict: true },
        };
      }

      let res: any;
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
            ...(options.headers ?? {}),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        throw toLlmError(error, { provider: name, model: request.model });
      }
      if (!res?.ok) throw await failure(res, name, request.model);

      const pending = new Map<number, { id: string; name: string; argsText: string }>();
      const usage = emptyUsage();
      let sawUsage = false;
      let finishReason: string | undefined;

      try {
        for await (const payload of readSse(res.body)) {
          let parsed: any;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          if (parsed?.error) {
            throw new LlmError(`LLM provider "${name}" error: ${parsed.error?.message ?? 'unknown'}`, {
              code: 'provider_error',
              retryable: false,
              provider: name,
              model: request.model,
            });
          }
          const normalized = usageFrom(parsed?.usage);
          if (normalized) {
            usage.promptTokens = normalized.promptTokens;
            usage.completionTokens = normalized.completionTokens;
            usage.totalTokens = normalized.totalTokens;
            sawUsage = true;
          }
          const choice = parsed?.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? choice.message ?? {};
          if (typeof delta.content === 'string' && delta.content) {
            yield { type: 'text', delta: delta.content };
          }
          for (const fragment of delta.tool_calls ?? []) {
            const index = Number(fragment.index ?? 0);
            const entry = pending.get(index) ?? { id: fragment.id ?? `call_${index}`, name: '', argsText: '' };
            if (fragment.id) entry.id = fragment.id;
            if (fragment.function?.name) entry.name = fragment.function.name;
            if (typeof fragment.function?.arguments === 'string') entry.argsText += fragment.function.arguments;
            pending.set(index, entry);
          }
          if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
        }
      } catch (error) {
        throw toLlmError(error, { provider: name, model: request.model });
      }

      for (const entry of pending.values()) {
        if (!entry.name) continue;
        yield { type: 'tool_call', toolCall: { id: entry.id, name: entry.name, args: parseArgs(entry.argsText) } };
      }
      yield {
        type: 'done',
        finishReason,
        usage: sawUsage ? usage : undefined,
      };
    },
  };
}

function parseArgs(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { __raw: text };
  }
}

/**
 * Anthropic Messages adapter (`/v1/messages`).
 *
 * Anthropic has no `system` role (it is a top-level field) and streams tool
 * input as JSON fragments, both handled here so the rest of the framework sees
 * the same {@link LlmChunk} stream as every other provider.
 */
export function createAnthropicProvider(
  options: ProviderOptions & { name?: string; version?: string; defaultMaxTokens?: number },
): LlmProvider {
  const name = options.name ?? 'anthropic';
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/v1/messages${options.query ?? ''}`;

  return {
    name,
    async *stream(request: ProviderRequest): AsyncIterable<LlmChunk> {
      const doFetch: FetchLike = options.fetchImpl ?? (globalThis.fetch as FetchLike);
      if (typeof doFetch !== 'function') {
        throw new LlmError('koatty_llm: no fetch implementation available.', { code: 'provider_error', provider: name });
      }
      const { system, messages } = toAnthropicMessages(request.messages);
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxTokens ?? options.defaultMaxTokens ?? 1024,
        messages,
        stream: true,
      };
      if (system) body.system = system;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.tools?.length) {
        body.tools = request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as JsonSchema,
        }));
      }

      let res: any;
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'anthropic-version': options.version ?? '2023-06-01',
            ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
            ...(options.headers ?? {}),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        throw toLlmError(error, { provider: name, model: request.model });
      }
      if (!res?.ok) throw await failure(res, name, request.model);

      const usage = emptyUsage();
      let sawUsage = false;
      let finishReason: string | undefined;
      let current: { id: string; name: string; argsText: string } | undefined;

      try {
        for await (const payload of readSse(res.body)) {
          let event: any;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          if (event?.type === 'error') {
            throw new LlmError(`LLM provider "${name}" error: ${event.error?.message ?? 'unknown'}`, {
              code: 'provider_error',
              retryable: false,
              provider: name,
              model: request.model,
            });
          }
          if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            current = { id: event.content_block.id, name: event.content_block.name, argsText: '' };
            continue;
          }
          if (event?.type === 'content_block_delta') {
            const delta = event.delta ?? {};
            if (delta.type === 'text_delta' && delta.text) yield { type: 'text', delta: delta.text };
            if (delta.type === 'input_json_delta' && current && typeof delta.partial_json === 'string') {
              current.argsText += delta.partial_json;
            }
            continue;
          }
          if (event?.type === 'content_block_stop' && current) {
            yield { type: 'tool_call', toolCall: { id: current.id, name: current.name, args: parseArgs(current.argsText) } };
            current = undefined;
            continue;
          }
          if (event?.type === 'message_delta') {
            const normalized = usageFrom(event.usage);
            if (normalized) {
              usage.completionTokens = normalized.completionTokens;
              usage.totalTokens = usage.promptTokens + normalized.completionTokens;
              sawUsage = true;
            }
            if (typeof event.delta?.stop_reason === 'string') finishReason = event.delta.stop_reason;
            continue;
          }
          if (event?.type === 'message_start') {
            const normalized = usageFrom(event.message?.usage);
            if (normalized) {
              usage.promptTokens = normalized.promptTokens;
              usage.totalTokens = usage.promptTokens + usage.completionTokens;
              sawUsage = true;
            }
            continue;
          }
          if (event?.type === 'message_stop') break;
        }
      } catch (error) {
        throw toLlmError(error, { provider: name, model: request.model });
      }

      yield { type: 'done', finishReason, usage: sawUsage ? usage : undefined };
    },
  };
}

/** Chunk helper used by tests and by custom adapters. */
export function toolCallChunk(call: LlmToolCall): LlmChunk {
  return { type: 'tool_call', toolCall: call };
}
