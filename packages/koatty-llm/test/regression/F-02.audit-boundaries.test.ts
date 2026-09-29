import 'reflect-metadata';
import { IsString } from 'class-validator';
import { createLlmClient, LlmError, readSse } from '../../src';
import type { LlmConfig, LlmProvider } from '../../src';

const messages = [{ role: 'user' as const, content: 'hi' }];
function client(provider: LlmProvider, extra: Partial<LlmConfig> = {}) {
  return createLlmClient({ providers: [provider], routes: { default: { model: 'default', provider: provider.name } }, reliability: { attempts: 1 }, ...extra });
}
function counter() {
  let used = 0;
  return { get: () => used, set: (_k: string, n: number) => { used = n; }, incrBy: (_k: string, n: number) => used += n };
}
class Answer { @IsString() answer!: string; }

test('F-A03: a model cannot expand the per-call tool allowlist', async () => {
  const invoke = jest.fn(); let round = 0;
  const llm = client({ name: 'tools', async *stream() { if (!round++) yield { type: 'tool_call', toolCall: { id: '1', name: 'write', args: {} } }; yield { type: 'done' }; } });
  await expect(llm.withTools({ messages, tools: ['read'], registry: { getTool: name => ({ name, inputSchema: {} }) }, invoke })).rejects.toThrow(/not allowed/i);
  expect(invoke).not.toHaveBeenCalled();
});

test('F-A04: streaming usage is settled and exhausted scopes never call the provider', async () => {
  const store = counter(); let calls = 0;
  const llm = client({ name: 'budget', async *stream() { calls++; yield { type: 'done', usage: { promptTokens: 2, completionTokens: 8, totalTokens: 10 } }; } }, { budget: { maxTokens: 10, store } });
  for await (const _ of llm.stream({ messages, budgetScope: 'tenant' })) { /* consume */ }
  expect(store.get()).toBe(10);
  await expect(llm.complete({ messages, budgetScope: 'tenant' })).rejects.toMatchObject({ code: 'budget_exceeded' });
  expect(calls).toBe(1);
});

test('F-A04: simultaneous clients cannot reserve the same remaining budget', async () => {
  const store = counter(); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const pending = new Promise<void>(r => { release = r; });
  const provider: LlmProvider = { name: 'shared', async *stream(request) { entered(); await pending; expect(request.maxTokens).toBeLessThan(10); yield { type: 'done', usage: { promptTokens: 2, completionTokens: 8, totalTokens: 10 } }; } };
  const first = client(provider, { budget: { maxTokens: 10, store } }).complete({ messages, budgetScope: 'tenant' });
  await started;
  await expect(client(provider, { budget: { maxTokens: 10, store } }).complete({ messages, budgetScope: 'tenant' })).rejects.toBeDefined();
  release(); await first;
  expect(store.get()).toBe(10);
});

test('F-A04: invalid structured responses are still charged', async () => {
  const store = counter();
  const llm = client({ name: 'invalid', async *stream() { yield { type: 'text', delta: 'invalid' }; yield { type: 'done', usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 } }; } }, { budget: { maxTokens: 200, store }, validationRetries: 1 });
  await expect(llm.complete({ messages, budgetScope: 'tenant', dto: Answer })).rejects.toBeDefined();
  expect(store.get()).toBe(8);
});

test('F-A05: retryable errors after visible output never replay that output', async () => {
  let calls = 0; const received: string[] = [];
  const llm = client({ name: 'partial', async *stream() { calls++; yield { type: 'text', delta: 'first' }; throw new LlmError('failed', { code: 'provider_error', retryable: true, status: 503 }); } }, { reliability: { attempts: 2, backoffMs: 0 } });
  await expect((async () => { for await (const chunk of llm.stream({ messages })) received.push(chunk.delta!); })()).rejects.toThrow();
  expect(calls).toBe(1); expect(received).toEqual(['first']);
});

test('F-A06: breaking the consumer aborts and closes the producer', async () => {
  let signal: AbortSignal | undefined; let closed = false;
  const llm = client({ name: 'close', async *stream(req) { signal = req.signal; try { yield { type: 'text', delta: 'one' }; yield { type: 'done' }; } finally { closed = true; } } });
  for await (const _ of llm.stream({ messages })) break;
  expect(signal?.aborted).toBe(true); expect(closed).toBe(true);
});

test('F-A06: a fetch reader is cancelled and unlocked on early exit', async () => {
  const reader = { read: jest.fn(async () => ({ value: new TextEncoder().encode('data: hello\n\n'), done: false })), cancel: jest.fn(async () => {}), releaseLock: jest.fn() };
  for await (const _ of readSse({ getReader: () => reader })) break;
  expect(reader.cancel).toHaveBeenCalledTimes(1); expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});

test('F-A17: a cached unvalidated response cannot bypass a subsequent DTO', async () => {
  const cache = new Map<string, any>();
  const llm = client({ name: 'cache', async *stream() { yield { type: 'text', delta: '{"answer":42}' }; yield { type: 'done' }; } }, { cache: { get: k => cache.get(k), set: (k, v) => { cache.set(k, v); } }, validationRetries: 0 });
  await llm.complete({ messages });
  await expect(llm.complete({ messages, dto: Answer })).rejects.toBeDefined();
});

test('F-A20: raw streams actually send declared tool definitions', async () => {
  const tools = [{ name: 'read', inputSchema: { type: 'object' } }]; let received: any;
  const llm = client({ name: 'declared', async *stream(req) { received = req.tools; yield { type: 'done' }; } });
  for await (const _ of llm.stream({ messages, tools })) { /* consume */ }
  expect(received).toEqual(tools);
});

test('F-A04: an unavailable budget counter fails before provider I/O', async () => {
  const stream = jest.fn(async function* () { yield { type: 'done' as const }; });
  const client = createLlmClient({ providers: [{ name: 'p', stream }], routes: { default: { model: 'default', provider: 'p' } }, budget: {
    maxTokens: 100, store: { get: () => { throw new Error('store unavailable'); }, set() {}, incrBy: () => 0 },
  } });
  await expect(client.complete({ messages: [], budgetScope: 'a' })).rejects.toThrow('store unavailable');
  expect(stream).not.toHaveBeenCalled();
});
test('F-A21: each attempted provider route is observed with its actual model and outcome', async () => {
  const events: any[] = [];
  const client = createLlmClient({ providers: [{ name: 'p', async *stream(request) {
    if (request.model === 'broken') throw new LlmError('temporary', { code: 'provider_error', retryable: true });
    yield { type: 'done', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
  } }], routes: { default: { model: 'default', providerModel: 'broken', fallbacks: ['fallback'] }, fallback: { model: 'fallback', providerModel: 'actual', pricePer1kPrompt: 1 } },
  reliability: { attempts: 1 }, observeAttempt: input => { const event: any = { ...input }; events.push(event); return { end: result => Object.assign(event, result) }; } });
  const result = await client.complete({ messages: [] });
  expect(events.map(e => [e.model, e.status])).toEqual([['broken', 'error'], ['actual', 'success']]);
  expect(result.responseModel).toBe('actual'); expect(result.cost).toBe(0.002);
});
test('F-A20: streaming tool invocations receive cancellation and aggregate all round usage', async () => {
  const controller = new AbortController(); let rounds = 0;
  const client = createLlmClient({ providers: [{ name: 'p', async *stream() {
    if (rounds++ === 0) yield { type: 'tool_call', toolCall: { id: 'r', name: 'read', args: {} } };
    else yield { type: 'text', delta: 'ok' };
    yield { type: 'done', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
  } }], routes: { default: { model: 'default' } } });
  const invoke = jest.fn(async (_name, _args, hooks) => { expect(hooks.signal).toBe(controller.signal); return 'result'; });
  const chunks = [];
  for await (const chunk of client.streamWithTools({ messages: [], tools: ['read'], registry: { getTool: name => ({ name, inputSchema: {} }) }, invoke, signal: controller.signal })) chunks.push(chunk);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(chunks.at(-1)?.usage?.totalTokens).toBe(6);
});
