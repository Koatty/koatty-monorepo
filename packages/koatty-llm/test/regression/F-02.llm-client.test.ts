/**
 * F-02: `koatty_llm` (roadmap Phase F, item F-2).
 *
 * Covers the acceptance gates that belong to F-2:
 * - a client disconnect (aborted `ctx.signal`) cancels the streaming call
 *   within 1 second, verified against a slow mock provider;
 * - model routing with ordered failover, retry only for 429/5xx, and a circuit
 *   breaker that stops hammering a failing provider;
 * - token budget enforced before and after a call through an injected store;
 * - structured output validated with `koatty_validation` (and retried once);
 * - tool-call loop driving the tools registered in the application;
 * - exact-match caching for non-streaming calls;
 * - the two provider adapters speak their wire protocol (OpenAI-compatible SSE,
 *   Anthropic Messages with tool_use input fragments).
 */
import 'reflect-metadata';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import {
  LlmAbortError,
  LlmBudgetError,
  LlmError,
  LlmUnavailableError,
  LlmValidationError,
  createAnthropicProvider,
  createLlmClient,
  createOpenAiCompatibleProvider,
  parseJsonOutput,
  resetBreakers,
} from '../../src';
import type {
  BudgetStore,
  JsonSchema,
  LlmChunk,
  LlmConfig,
  LlmMessage,
  LlmProvider,
  LlmToolDefinition,
  ProviderRequest,
} from '../../src';

class AnswerDto {
  @IsString()
  @IsNotEmpty()
  summary!: string;

  @IsInt()
  @Min(1)
  score!: number;
}

const ANSWER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { summary: { type: 'string' }, score: { type: 'integer', minimum: 1 } },
  required: ['summary', 'score'],
};

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      },
      { once: true },
    );
  });

function textScript(text: string, chunkSize = 4) {
  return async function* (): AsyncIterable<LlmChunk> {
    for (let index = 0; index < text.length; index += chunkSize) {
      yield { type: 'text', delta: text.slice(index, index + chunkSize) };
    }
    yield { type: 'done', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 } };
  };
}

/** A provider whose script is a plain function; records every request. */
function mockProvider(name: string, script: (request: ProviderRequest) => AsyncIterable<LlmChunk>) {
  const calls: ProviderRequest[] = [];
  const provider: LlmProvider = {
    name,
    stream(request) {
      calls.push(request);
      return script(request);
    },
  };
  return { provider, calls };
}

function baseConfig(providers: LlmProvider[], routes: LlmConfig['routes'], extra: Partial<LlmConfig> = {}): LlmConfig {
  return {
    providers,
    routes,
    reliability: { attempts: 1, backoffMs: 1, timeoutMs: 5_000, breakerThreshold: 99 },
    ...extra,
  };
}

function inMemoryStore(): BudgetStore & { values: Map<string, number> } {
  const values = new Map<string, number>();
  return {
    values,
    get: (key: string) => values.get(key),
    set: (key: string, value: number) => {
      values.set(key, value);
    },
    incrBy: (key: string, delta: number) => {
      const next = (values.get(key) ?? 0) + delta;
      values.set(key, next);
      return next;
    },
  };
}

beforeEach(() => {
  resetBreakers();
});

describe('F-02 cancellation', () => {
  it('cancels a streaming call within 1 second when the caller aborts', async () => {
    let observedAbort = false;
    const slow = mockProvider('slow', async function* (request) {
      for (let index = 0; index < 100; index += 1) {
        if (request.signal?.aborted) {
          observedAbort = true;
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        await delay(40, request.signal);
        yield { type: 'text', delta: `token-${index} ` };
      }
      yield { type: 'done', finishReason: 'stop' };
    });
    const client = createLlmClient(baseConfig([slow.provider], { default: { model: 'default', provider: 'slow' } }));
    const controller = new AbortController();

    const received: string[] = [];
    const pending = (async () => {
      for await (const chunk of client.stream({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal })) {
        if (chunk.type === 'text' && chunk.delta) {
          received.push(chunk.delta);
          if (received.length === 1) controller.abort();
        }
      }
    })();

    const started = Date.now();
    await expect(pending).rejects.toBeInstanceOf(LlmAbortError);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(received).toHaveLength(1);
    expect(observedAbort).toBe(true);
  });

  it('propagates the abort to the provider instead of waiting for the next chunk', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const slow = mockProvider('slow', async function* (request) {
      signals.push(request.signal);
      await delay(5_000, request.signal);
      yield { type: 'done' };
    });
    const client = createLlmClient(
      baseConfig([slow.provider], { default: { model: 'default', provider: 'slow' } }, { reliability: { attempts: 1, timeoutMs: 30_000 } }),
    );
    const controller = new AbortController();
    const pending = client.complete({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toBeInstanceOf(LlmAbortError);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('F-02 routing and reliability', () => {
  it('fails over to the fallback route for retryable failures', async () => {
    const primary = mockProvider('primary', async function* () {
      throw Object.assign(new Error('rate limited'), { status: 429 });
    });
    const secondary = mockProvider('secondary', textScript('from-fallback'));
    const client = createLlmClient(
      baseConfig([primary.provider, secondary.provider], {
        default: { model: 'default', provider: 'primary', fallbacks: ['strong'] },
        strong: { model: 'strong', provider: 'secondary', providerModel: 'gpt-strong' },
      }),
    );

    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('from-fallback');
    expect(result.provider).toBe('secondary');
    expect(result.model).toBe('default');
    expect(primary.calls).toHaveLength(1);
    expect(secondary.calls[0].model).toBe('gpt-strong');
  });

  it('does not fail over for a non-retryable client error', async () => {
    const primary = mockProvider('primary', async function* () {
      throw Object.assign(new Error('bad request'), { status: 400 });
    });
    const secondary = mockProvider('secondary', textScript('nope'));
    const client = createLlmClient(
      baseConfig([primary.provider, secondary.provider], {
        default: { model: 'default', provider: 'primary', fallbacks: ['strong'] },
        strong: { model: 'strong', provider: 'secondary' },
      }),
    );

    await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'bad_request',
      retryable: false,
    });
    expect(secondary.calls).toHaveLength(0);
  });

  it('retries a 429 up to the configured attempts and then reports unavailability', async () => {
    const failing = mockProvider('flaky', async function* () {
      throw Object.assign(new Error('rate limited'), { status: 429 });
    });
    const client = createLlmClient(
      baseConfig([failing.provider], { default: { model: 'default', provider: 'flaky' } }, { reliability: { attempts: 2, backoffMs: 1 } }),
    );

    await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(failing.calls).toHaveLength(2);
  });

  it('opens the circuit breaker after consecutive failures and skips the provider', async () => {
    const failing = mockProvider('flaky', async function* () {
      throw Object.assign(new Error('boom'), { status: 503 });
    });
    const client = createLlmClient(
      baseConfig([failing.provider], { default: { model: 'default', provider: 'flaky' } }, {
        reliability: { attempts: 1, backoffMs: 1, breakerThreshold: 2, breakerResetMs: 60_000 },
      }),
    );

    await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(failing.calls).toHaveLength(2);

    await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      code: 'breaker_open',
    });
    expect(failing.calls).toHaveLength(2);
  });

  it('maps a per-attempt timeout to a retryable error', async () => {
    const slow = mockProvider('slow', async function* (request) {
      await delay(400, request.signal);
      yield { type: 'done' };
    });
    const client = createLlmClient(
      baseConfig([slow.provider], { default: { model: 'default', provider: 'slow' } }, { reliability: { attempts: 1, timeoutMs: 40 } }),
    );

    await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'timeout' });
    expect(slow.calls[0].signal?.aborted).toBe(true);
  });
});

describe('F-02 budget', () => {
  it('charges the store after a call and rejects once the budget is exhausted', async () => {
    const store = inMemoryStore();
    const provider = mockProvider('p', textScript('hello'));
    const client = createLlmClient(
      baseConfig([provider.provider], { default: { model: 'default', provider: 'p' } }, {
        budget: { maxTokens: 4, scope: 'default', store },
      }),
    );

    await expect(
      client.complete({ messages: [{ role: 'user', content: 'hi' }], budgetScope: 'tenant-a' }),
    ).rejects.toBeInstanceOf(LlmBudgetError);
    expect(store.values.get('llm:budget:default:tenant-a')).toBe(8);

    await expect(
      client.complete({ messages: [{ role: 'user', content: 'hi' }], budgetScope: 'tenant-a' }),
    ).rejects.toBeInstanceOf(LlmBudgetError);
    expect(provider.calls).toHaveLength(1);
  });

  it('refuses a request whose scope already exceeded the budget before calling the provider', async () => {
    const store = inMemoryStore();
    store.values.set('llm:budget:default:tenant-b', 50);
    const provider = mockProvider('p', textScript('hello'));
    const client = createLlmClient(
      baseConfig([provider.provider], { default: { model: 'default', provider: 'p' } }, {
        budget: { maxTokens: 10, scope: 'default', store },
      }),
    );

    await expect(
      client.complete({ messages: [{ role: 'user', content: 'hi' }], budgetScope: 'tenant-b' }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    expect(provider.calls).toHaveLength(0);
  });
});

describe('F-02 structured output', () => {
  it('retries once with a correction message when the model returns invalid JSON', async () => {
    let calls = 0;
    const provider = mockProvider('p', async function* (request) {
      calls += 1;
      const content = calls === 1 ? 'not json at all' : '```json\n{"summary":"ok","score":2}\n```';
      yield { type: 'text', delta: content };
      yield { type: 'done', finishReason: 'stop' };
      expect(request.responseSchema?.schema).toBe(ANSWER_SCHEMA);
    });
    const client = createLlmClient(
      baseConfig([provider.provider], { default: { model: 'default', provider: 'p' } }, { validationRetries: 1 }),
    );

    const result = await client.complete({
      messages: [{ role: 'user', content: 'summarize' }],
      schema: ANSWER_SCHEMA,
      dto: AnswerDto,
    });
    expect(JSON.parse(result.text)).toEqual({ summary: 'ok', score: 2 });
    expect(calls).toBe(2);
  });

  it('validates the parsed JSON against the DTO and reports the issues', async () => {
    const provider = mockProvider('p', textScript('{"summary":"ok","score":0}'));
    const client = createLlmClient(
      baseConfig([provider.provider], { default: { model: 'default', provider: 'p' } }, { validationRetries: 0 }),
    );

    await expect(
      client.complete({ messages: [{ role: 'user', content: 'summarize' }], schema: ANSWER_SCHEMA, dto: AnswerDto }),
    ).rejects.toBeInstanceOf(LlmValidationError);
  });

  it('parses a fenced JSON payload but rejects plain text', () => {
    expect(parseJsonOutput('```json\n{"a":1}\n```').value).toEqual({ a: 1 });
    expect(parseJsonOutput('{"a":1}').value).toEqual({ a: 1 });
    expect(parseJsonOutput('sorry, I cannot').error).toBeTruthy();
  });
});

describe('F-02 tool loop', () => {
  const tool: LlmToolDefinition = {
    name: 'order_query',
    description: 'Query an order',
    inputSchema: { type: 'object', properties: { orderNo: { type: 'string' } } },
  };

  it('invokes the registered tool and feeds the result back to the model', async () => {
    let calls = 0;
    const provider = mockProvider('p', async function* (request) {
      calls += 1;
      if (calls === 1) {
        yield { type: 'tool_call', toolCall: { id: 'call-1', name: 'order_query', args: { orderNo: 'A-1' } } };
        yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      const toolMessage = [...(request.messages ?? [])].reverse().find((message: LlmMessage) => message.role === 'tool');
      expect(toolMessage?.content).toContain('paid');
      yield { type: 'text', delta: 'Order A-1 is paid.' };
      yield { type: 'done', finishReason: 'stop' };
    });
    const client = createLlmClient(baseConfig([provider.provider], { default: { model: 'default', provider: 'p' } }));
    const invoked: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await client.withTools({
      messages: [{ role: 'user', content: 'where is A-1?' }],
      tools: ['order_query'],
      registry: { getTool: (name: string) => (name === 'order_query' ? tool : undefined) },
      invoke: async (name, args) => {
        invoked.push({ name, args });
        return { orderNo: args.orderNo, status: 'paid' };
      },
    });

    expect(result.rounds).toBe(1);
    expect(result.text).toBe('Order A-1 is paid.');
    expect(invoked).toEqual([{ name: 'order_query', args: { orderNo: 'A-1' } }]);
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
    // the provider received the tool definition derived from the registry
    expect(provider.calls[0].tools?.[0].inputSchema).toEqual(tool.inputSchema);
  });

  it('stops at the round cap and rejects unknown tool names', async () => {
    const provider = mockProvider('p', async function* () {
      yield { type: 'tool_call', toolCall: { id: `call-${Math.random()}`, name: 'order_query', args: {} } };
      yield { type: 'done', finishReason: 'tool_calls' };
    });
    const client = createLlmClient(baseConfig([provider.provider], { default: { model: 'default', provider: 'p' } }));
    const invoked: string[] = [];

    const result = await client.withTools({
      messages: [{ role: 'user', content: 'loop' }],
      tools: [tool],
      maxRounds: 2,
      registry: { getTool: () => tool },
      invoke: async (name) => {
        invoked.push(name);
        return { ok: true };
      },
    });
    expect(result.rounds).toBe(2);
    expect(invoked).toHaveLength(2);

    await expect(
      client.withTools({
        messages: [{ role: 'user', content: 'loop' }],
        tools: ['unknown_tool'],
        registry: { getTool: () => undefined },
        invoke: async () => null,
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('F-02 cache', () => {
  it('serves an identical non-streaming call from the exact-match cache', async () => {
    const values = new Map<string, any>();
    const provider = mockProvider('p', textScript('cached-answer'));
    const client = createLlmClient(
      baseConfig([provider.provider], { default: { model: 'default', provider: 'p' } }, {
        cache: {
          get: (key: string) => values.get(key),
          set: (key: string, value: any) => {
            values.set(key, value);
          },
        },
      }),
    );

    const first = await client.complete({ messages: [{ role: 'user', content: 'same' }] });
    const second = await client.complete({ messages: [{ role: 'user', content: 'same' }] });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.text).toBe('cached-answer');
    expect(provider.calls).toHaveLength(1);

    await client.complete({ messages: [{ role: 'user', content: 'same' }], cache: false });
    expect(provider.calls).toHaveLength(2);
  });
});

describe('F-02 provider adapters', () => {
  const encoder = new TextEncoder();

  function sseResponse(lines: string[], capture?: { body?: any; headers?: any; url?: string }) {
    return async (url: string, init: any) => {
      if (capture) {
        capture.url = url;
        capture.body = JSON.parse(init.body);
        capture.headers = init.headers;
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        body: new ReadableStream({
          start(controller) {
            for (const line of lines) controller.enqueue(encoder.encode(line));
            controller.close();
          },
        }),
      };
    };
  }

  it('streams text, assembles tool-call fragments and reports usage (OpenAI-compatible)', async () => {
    const capture: any = {};
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      fetchImpl: sseResponse(
        [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"order_query","arguments":"{\\"order"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"No\\":\\"A-1\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}\n\n',
          'data: [DONE]\n\n',
        ],
        capture,
      ),
    });

    const chunks: LlmChunk[] = [];
    for await (const chunk of provider.stream({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'status of A-1?' },
      ],
      tools: [{ name: 'order_query', inputSchema: { type: 'object' } }],
      responseSchema: { name: 'answer', schema: ANSWER_SCHEMA },
    })) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'text').map((chunk) => chunk.delta).join('')).toBe('Hello');
    const toolCall = chunks.find((chunk) => chunk.type === 'tool_call')!.toolCall!;
    expect(toolCall).toEqual({ id: 'call_1', name: 'order_query', args: { orderNo: 'A-1' } });
    expect(chunks[chunks.length - 1].usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });
    expect(chunks[chunks.length - 1].finishReason).toBe('tool_calls');
    expect(capture.url).toBe('https://example.test/v1/chat/completions');
    expect(capture.headers.authorization).toBe('Bearer test-key');
    expect(capture.body.tools[0].function.name).toBe('order_query');
    expect(capture.body.response_format.json_schema.schema).toEqual(ANSWER_SCHEMA);
    expect(capture.body.stream).toBe(true);
  });

  it('maps system messages and streams tool_use input (Anthropic)', async () => {
    const capture: any = {};
    const provider = createAnthropicProvider({
      baseUrl: 'https://anthropic.test',
      apiKey: 'anthropic-key',
      fetchImpl: sseResponse(
        [
          'data: {"type":"message_start","message":{"usage":{"input_tokens":9}}}\n\n',
          'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_1","name":"order_query"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"orderNo\\":"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"\\"A-2\\"}"}}\n\n',
          'data: {"type":"content_block_stop"}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"checking"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ],
        capture,
      ),
    });

    const chunks: LlmChunk[] = [];
    for await (const chunk of provider.stream({
      model: 'claude-3-5-sonnet',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'status?' },
      ],
      tools: [{ name: 'order_query', description: 'Query', inputSchema: { type: 'object' } }],
      maxTokens: 256,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.find((chunk) => chunk.type === 'text')!.delta).toBe('checking');
    expect(chunks.find((chunk) => chunk.type === 'tool_call')!.toolCall).toEqual({
      id: 'toolu_1',
      name: 'order_query',
      args: { orderNo: 'A-2' },
    });
    expect(chunks[chunks.length - 1].usage).toMatchObject({ promptTokens: 9, completionTokens: 4, totalTokens: 13 });
    expect(capture.url).toBe('https://anthropic.test/v1/messages');
    expect(capture.headers['anthropic-version']).toBeTruthy();
    expect(capture.body.system).toBe('be brief');
    expect(capture.body.messages).toEqual([{ role: 'user', content: 'status?' }]);
    expect(capture.body.tools[0].input_schema).toEqual({ type: 'object' });
    expect(capture.body.max_tokens).toBe(256);
  });
});

describe('F-02 configuration guards', () => {
  it('rejects a client without providers and an unknown model', async () => {
    expect(() => createLlmClient({ providers: [], routes: {} })).toThrow(LlmError);
    const provider = mockProvider('p', textScript('x'));
    const client = createLlmClient(baseConfig([provider.provider], { default: { model: 'default', provider: 'p' } }));
    await expect(
      (async () => {
        for await (const _chunk of client.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'nope' })) {
          // drain
        }
      })(),
    ).rejects.toMatchObject({ code: 'no_route' });
  });

  it('estimates cost from the route prices', async () => {
    const provider = mockProvider('p', textScript('hello'));
    const client = createLlmClient(
      baseConfig([provider.provider], {
        default: { model: 'default', provider: 'p', pricePer1kPrompt: 0.5, pricePer1kCompletion: 1.5 },
      }),
    );
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.cost).toBe(Number(((0.5 * 3) / 1000 + (1.5 * 5) / 1000).toFixed(6)));
    expect(client.estimateCost('default', { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 })).toBe(0.5);
  });
});
