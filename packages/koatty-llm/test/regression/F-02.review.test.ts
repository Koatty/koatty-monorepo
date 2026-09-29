import 'reflect-metadata';
import { IsString, IsInt } from 'class-validator';
import { createLlmClient, LlmError } from '../../src';
import type { LlmProvider, LlmConfig } from '../../src';
const messages = [{ role: 'user' as const, content: 'hello' }];
const make = (provider: LlmProvider, extra: Partial<LlmConfig> = {}) => createLlmClient({ providers: [provider], routes: { default: { model: 'default' } }, reliability: { attempts: 1, timeoutMs: 30 }, ...extra });
const counter = () => { let used = 0; return { get: () => used, set: (_: string, n: number) => { used = n; }, incrBy: (_: string, n: number) => used += n }; };
class TextAnswer { @IsString() value!: string; }
class NumberAnswer { @IsInt() value!: number; }
test('P1-02 immediate provider failure releases the reservation and permits recovery', async () => {
  const store = counter(); let fail = true;
  const llm = make({ name: 'recover', async *stream() { if (fail) throw new LlmError('503', { code: 'provider_error', retryable: true }); yield { type: 'done' }; } }, { budget: { maxTokens: 10000, store } });
  await expect(llm.complete({ messages, budgetScope: 'tenant' })).rejects.toThrow(); expect(store.get()).toBe(0);
  fail = false; await expect(llm.complete({ messages, budgetScope: 'tenant' })).resolves.toHaveProperty('cached', false);
});
test('P1-02 bounded defaults permit five concurrent reservations', async () => {
  const store = counter(); let entered = 0; let release!: () => void;
  const gate = new Promise<void>(r => release = r);
  const llm = make({ name: 'parallel', async *stream(req) { entered++; expect(req.maxTokens).toBe(1024); await gate; yield { type: 'done' }; } }, { budget: { maxTokens: 10000, store }, reliability: { attempts: 1, timeoutMs: 1000 } });
  const jobs = Array.from({ length: 5 }, () => llm.complete({ messages, budgetScope: 'tenant' }));
  await new Promise(r => setImmediate(r)); expect(entered).toBe(5); release(); await Promise.all(jobs);
});
test('P1-10 DTO and client cache isolation; invalid hits refresh', async () => {
  const entries = new Map<string, any>(); const cache = { get: (k: string) => entries.get(k), set: (k: string, v: any) => { entries.set(k, v); } }; let calls = 0;
  const llm = make({ name: 'same', async *stream(req) { calls++; yield { type: 'text', delta: req.responseSchema?.schema.properties.value.type === 'integer' ? '{"value":1}' : '{"value":"ok"}' }; } }, { cache });
  await llm.complete({ messages, dto: TextAnswer }); await llm.complete({ messages, dto: NumberAnswer }); expect(calls).toBe(2);
  for (const value of entries.values()) value.text = 'invalid';
  await expect(llm.complete({ messages, dto: TextAnswer })).resolves.toMatchObject({ text: '{"value":"ok"}', cached: false });
  const other = make({ name: 'same', async *stream() { yield { type: 'text', delta: 'different account' }; } }, { cache });
  await expect(other.complete({ messages })).resolves.toMatchObject({ text: 'different account', cached: false });
});
test('P2 provider ignoring signal cannot hold the timeout open', async () => {
  const llm = make({ name: 'hung', async *stream() { await new Promise(() => {}); yield { type: 'done' }; } });
  const start = Date.now(); await expect(llm.complete({ messages })).rejects.toMatchObject({ code: 'timeout' }); expect(Date.now() - start).toBeLessThan(500);
});
test('P2 estimates do not truncate authoritative usage and settlement errors do not replace output', async () => {
  let n = 0; const store = { get: () => 0, set() {}, incrBy: (_: string, delta: number) => { if (n++) throw new Error('offline'); return delta; } };
  const llm = make({ name: 'estimate', async *stream() { yield { type: 'text', delta: 'x'.repeat(1000) }; yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; } }, { budget: { maxTokens: 20, store } });
  await expect(llm.complete({ messages, budgetScope: 'a' })).resolves.toHaveProperty('text', 'x'.repeat(1000));
});
test('P2 detached streamWithTools rejects an unauthorized chunk before publication', async () => {
  const { streamWithTools } = make({ name: 'tools', async *stream() { yield { type: 'tool_call', toolCall: { id: '1', name: 'write', args: {} } }; } });
  const chunks: unknown[] = []; const invoke = jest.fn();
  await expect((async () => { for await (const c of streamWithTools({ messages, tools: [], registry: { getTool: () => undefined }, invoke })) chunks.push(c); })()).rejects.toMatchObject({ code: 'bad_request' });
  expect(chunks).toEqual([]); expect(invoke).not.toHaveBeenCalled();
});
