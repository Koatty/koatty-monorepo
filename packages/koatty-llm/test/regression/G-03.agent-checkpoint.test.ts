import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAgentRunner } from '../../src/agent';
import { createFileAgentRunStore } from '../../src/agent-file-store';

describe('G-03 checkpointed Agent', () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'koatty-agent-')); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });
  const registry = { getTool: (name: string) => name === 'write' ? { name, inputSchema: { type: 'object' } } : undefined };
  const response = (calls: any[] = []) => ({ text: calls.length ? '' : 'done', toolCalls: calls,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'test', provider: 'test', cached: false });
  const call = { id: 'c1', name: 'write', args: {} };
  const client = () => ({ complete: jest.fn(async (request: any) => response(request.messages.some((m: any) => m.role === 'tool') ? [] : [call])) });

  test('persists state across runner/store instances and never reexecutes a completed run', async () => {
    const invoke = jest.fn(async () => ({ ok: true }));
    const opts = { client: client(), definition: 'v1', tools: ['write'], registry, invoke };
    const first = createAgentRunner({ ...opts, store: createFileAgentRunStore(directory) });
    await first.start({ scope: 'tenant', id: 'run', messages: [{ role: 'user', content: 'do it' }] });
    const second = createAgentRunner({ ...opts, store: createFileAgentRunStore(directory) });
    const done = await second.run('tenant', 'run');
    expect(done.status).toBe('completed');
    expect(done.usage.totalTokens).toBe(4);
    expect(done.messages.filter(m => m.role === 'tool')).toHaveLength(1);
    expect((await first.run('tenant', 'run')).status).toBe('completed');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]).toHaveLength(3);
    await expect(first.inspect('other-tenant', 'run')).rejects.toThrow('AGENT_NOT_FOUND');
  });

  test('unknown side effect survives recreation, requires authoritative reconciliation and is not replayed', async () => {
    const invoke = jest.fn(async () => { throw new Error('network failed after business commit'); });
    const opts = { client: client(), definition: 'v1', tools: ['write'], registry, invoke };
    const first = createAgentRunner({ ...opts, store: createFileAgentRunStore(directory) });
    await first.start({ scope: 'tenant', id: 'run', messages: [] });
    const uncertain = await first.run('tenant', 'run');
    expect(uncertain.status).toBe('unknown');
    const second = createAgentRunner({ ...opts, store: createFileAgentRunStore(directory) });
    expect((await second.run('tenant', 'run')).status).toBe('unknown');
    expect(invoke).toHaveBeenCalledTimes(1);
    await expect(second.resolveUnknown('tenant', 'run', { revision: uncertain.revision - 1, idempotencyKey: uncertain.inFlight!.key, output: {} })).rejects.toThrow();
    await second.resolveUnknown('tenant', 'run', { revision: uncertain.revision, idempotencyKey: uncertain.inFlight!.key, output: { reconciled: true } });
    expect((await second.run('tenant', 'run')).status).toBe('completed');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('concurrent runners cannot acquire the same live lease', async () => {
    let release!: () => void;
    const invoke = jest.fn(() => new Promise<unknown>(resolve => { release = () => resolve({}); }));
    const opts = { client: client(), definition: 'v1', tools: ['write'], registry, invoke };
    const first = createAgentRunner({ ...opts, store: createFileAgentRunStore(directory) });
    const second = createAgentRunner({ ...opts, store: createFileAgentRunStore(directory) });
    await first.start({ scope: 'tenant', id: 'run', messages: [] });
    const running = first.run('tenant', 'run');
    while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    await expect(second.run('tenant', 'run')).rejects.toThrow('AGENT_BUSY');
    release(); await running;
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('cancelling an in-flight non-cooperative tool records unknown, not rolled-back', async () => {
    const abort = new AbortController();
    const invoke = jest.fn(() => { abort.abort(); return new Promise(() => {}); });
    const runner = createAgentRunner({ client: client(), definition: 'v1', tools: ['write'], registry, invoke,
      store: createFileAgentRunStore(directory) });
    await runner.start({ scope: 'tenant', id: 'run', messages: [] });
    expect((await runner.run('tenant', 'run', abort.signal)).status).toBe('unknown');
  });

  test('fails closed for changed definition, undeclared tools and retained local CAS locks', async () => {
    const store = createFileAgentRunStore(directory);
    const opts = { client: { complete: async () => response([{ ...call, name: 'not-allowed' }]) }, definition: 'v1', tools: ['write'], registry, invoke: jest.fn(), store };
    const runner = createAgentRunner(opts);
    await runner.start({ scope: 'tenant', id: 'run', messages: [] });
    await expect(createAgentRunner({ ...opts, definition: 'v2' }).run('tenant', 'run')).rejects.toThrow('AGENT_DEFINITION_CHANGED');
    expect((await runner.run('tenant', 'run')).errorCode).toBe('AGENT_TOOL_NOT_ALLOWED');
    expect(opts.invoke).not.toHaveBeenCalled();
    const key = 'locked-key';
    expect(await store.compareAndSet(key, null, 'old')).toBe(true);
    const digest = require('crypto').createHash('sha256').update(key).digest('hex');
    fs.writeFileSync(path.join(directory, digest + '.json.lock'), '');
    expect(await store.compareAndSet(key, 'old', 'new')).toBe(false);
    expect(await store.get(key)).toBe('old');
  });

  test('bounds repeated tool rounds and preserves budget failure as a terminal state', async () => {
    const invoke = jest.fn(async () => ({}));
    const store = createFileAgentRunStore(directory);
    const opts = { definition: 'v1', tools: ['write'], registry, invoke, store, maxRounds: 1 };
    const loop = createAgentRunner({ ...opts, client: { complete: async () => response([call]) } });
    await loop.start({ scope: 'tenant', id: 'loop', messages: [] });
    expect((await loop.run('tenant', 'loop')).status).toBe('tool_round_limit');
    expect(invoke).toHaveBeenCalledTimes(1);
    const complete = jest.fn(async () => { throw Object.assign(new Error('budget'), { code: 'budget_exceeded' }); });
    const budget = createAgentRunner({ ...opts, client: { complete } });
    await budget.start({ scope: 'tenant', id: 'budget', messages: [] });
    expect((await budget.run('tenant', 'budget')).status).toBe('budget_limited');
    expect((await budget.run('tenant', 'budget')).status).toBe('budget_limited');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
