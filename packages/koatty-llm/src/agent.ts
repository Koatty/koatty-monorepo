import { createHash, randomUUID } from 'crypto';
import type { LlmClient } from './client';
import type { LlmMessage, LlmToolCall, LlmUsage, ToolLoopOptions } from './types';

/** A durable backend must implement atomic CAS across all its workers. Values contain conversation content. */
export interface AgentRunStore {
  get(key: string): Promise<string | null | undefined> | string | null | undefined;
  compareAndSet(key: string, expected: string | null, value: string): Promise<boolean> | boolean;
}
export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'budget_limited' | 'tool_round_limit' | 'unknown';
export interface AgentRun {
  schemaVersion: 1;
  id: string;
  scope: string;
  definition: string;
  status: AgentRunStatus;
  revision: number;
  messages: LlmMessage[];
  tools: string[];
  rounds: number;
  usage: LlmUsage;
  pending: LlmToolCall[];
  inFlight?: { call: LlmToolCall; key: string };
  lease?: { owner: string; until: number };
  text?: string;
  errorCode?: string;
}
export class AgentRunError extends Error {
  constructor(public code: string) { super(code); this.name = 'AgentRunError'; }
}
export interface AgentRunnerOptions {
  client: Pick<LlmClient, 'complete'>;
  store: AgentRunStore;
  /** Bump whenever prompts, tool implementations, schema or policy changes incompatibly. */
  definition: string;
  tools: ToolLoopOptions['tools'];
  registry: ToolLoopOptions['registry'];
  invoke: (name: string, args: Record<string, unknown>, options: { signal: AbortSignal; idempotencyKey: string; runId: string; scope: string }) => Promise<unknown>;
  maxRounds?: number;
  leaseMs?: number;
  model?: string;
}

/** A small checkpointed single-agent loop, independent of any transport or scheduler.
 * No automatic tool replay after an ambiguous outcome; reconcile it with resolveUnknown(). */
export function createAgentRunner(options: AgentRunnerOptions) {
  if (!options.store?.compareAndSet || !options.definition) throw new AgentRunError('AGENT_STORE_AND_DEFINITION_REQUIRED');
  const names = (options.tools ?? []).map(tool => typeof tool === 'string' ? tool : tool.name);
  if (new Set(names).size !== names.length) throw new AgentRunError('AGENT_DUPLICATE_TOOLS');
  const leaseMs = options.leaseMs ?? 60000;
  const maxRounds = options.maxRounds ?? 5;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 10 || leaseMs > 600000 || !Number.isSafeInteger(maxRounds) || maxRounds < 1)
    throw new AgentRunError('AGENT_INVALID_LIMIT');
  const binding = createHash('sha256').update(JSON.stringify({ definition: options.definition, tools: names,
    schemas: names.map(name => options.registry.getTool(name)?.inputSchema ?? null), model: options.model, maxRounds })).digest('hex');
  const keyOf = (scope: string, id: string) => {
    if (!scope || !id) throw new AgentRunError('AGENT_IDENTITY_REQUIRED');
    return 'koatty:agent:' + createHash('sha256').update(JSON.stringify([scope, id])).digest('hex');
  };
  const read = async (scope: string, id: string) => {
    const key = keyOf(scope, id);
    const raw = await options.store.get(key) ?? null;
    if (!raw) throw new AgentRunError('AGENT_NOT_FOUND');
    const state = JSON.parse(raw) as AgentRun;
    if (state.schemaVersion !== 1 || state.scope !== scope || state.id !== id || state.definition !== binding)
      throw new AgentRunError('AGENT_DEFINITION_CHANGED');
    return { key, raw, state };
  };
  const inspect = async (scope: string, id: string): Promise<AgentRun> => (await read(scope, id)).state;

  return {
    inspect,
    async start(input: { scope: string; id?: string; messages: LlmMessage[] }): Promise<AgentRun> {
      const id = input.id ?? randomUUID();
      const state: AgentRun = { schemaVersion: 1, id, scope: input.scope, definition: binding, status: 'queued', revision: 0,
        messages: input.messages, tools: names, rounds: 0, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, pending: [] };
      if (!await options.store.compareAndSet(keyOf(input.scope, id), null, JSON.stringify(state)))
        throw new AgentRunError('AGENT_ALREADY_EXISTS');
      return JSON.parse(JSON.stringify(state));
    },
    async run(scope: string, id: string, signal?: AbortSignal): Promise<AgentRun> {
      const loaded = await read(scope, id);
      let raw = loaded.raw;
      let state = loaded.state;
      if (state.lease && state.lease.until > Date.now()) throw new AgentRunError('AGENT_BUSY');
      if (state.status === 'unknown' || state.inFlight) {
        if (state.status !== 'unknown') {
          state = { ...state, status: 'unknown', lease: undefined, errorCode: 'TOOL_OUTCOME_UNKNOWN', revision: state.revision + 1 };
          if (!await options.store.compareAndSet(loaded.key, raw, JSON.stringify(state))) throw new AgentRunError('AGENT_BUSY');
        }
        return state;
      }
      if (['completed', 'failed', 'cancelled', 'budget_limited', 'tool_round_limit'].includes(state.status)) return state;
      const owner = randomUUID();
      state = { ...state, status: 'running', revision: state.revision + 1, lease: { owner, until: Date.now() + leaseMs } };
      let next = JSON.stringify(state);
      if (!await options.store.compareAndSet(loaded.key, raw, next)) throw new AgentRunError('AGENT_BUSY');
      raw = next;
      const save = async (patch: Partial<AgentRun>, terminal = false) => {
        if (!state.lease || state.lease.owner !== owner || state.lease.until <= Date.now()) throw new AgentRunError('AGENT_LEASE_LOST');
        const updated: AgentRun = { ...state, ...patch, revision: state.revision + 1,
          lease: terminal ? undefined : { owner, until: Date.now() + leaseMs } };
        next = JSON.stringify(updated);
        if (!await options.store.compareAndSet(loaded.key, raw, next)) throw new AgentRunError('AGENT_LEASE_LOST');
        state = updated; raw = next;
        if (!terminal && state.lease!.until <= Date.now()) throw new AgentRunError('AGENT_LEASE_LOST');
      };
      try {
        for (;;) {
          if (signal?.aborted) { await save({ status: 'cancelled', errorCode: 'CANCELLED' }, true); return state; }
          if (state.pending.length) {
            const call = state.pending[0];
            const key = createHash('sha256').update(`${loaded.key}:${state.rounds}:${call.id}`).digest('hex');
            await save({ inFlight: { call, key } });
            // Persist the intent BEFORE invoking. A worker crash from here is an unknown outcome.
            const output = await bounded(callSignal => options.invoke(call.name, call.args,
              { signal: callSignal, idempotencyKey: key, runId: id, scope }), signal, leaseMs);
            const message: LlmMessage = { role: 'tool', toolCallId: call.id, content: JSON.stringify(output ?? null) };
            await save({ messages: [...state.messages, message], pending: state.pending.slice(1), inFlight: undefined });
            continue;
          }
          const response = await bounded(callSignal => options.client.complete({ model: options.model,
            messages: state.messages, tools: options.tools, registry: options.registry, signal: callSignal, budgetScope: scope, cache: false }), signal, leaseMs);
          const usage = { ...state.usage };
          for (const key of ['promptTokens', 'completionTokens', 'totalTokens'] as const) usage[key] += response.usage[key];
          const calls = response.toolCalls;
          if (calls.some(call => !names.includes(call.name) || !options.registry.getTool(call.name)) || new Set(calls.map(c => c.id)).size !== calls.length)
            throw new AgentRunError('AGENT_TOOL_NOT_ALLOWED');
          const messages: LlmMessage[] = [...state.messages, { role: 'assistant', content: response.text, ...(calls.length ? { toolCalls: calls } : {}) }];
          if (!calls.length) { await save({ status: 'completed', messages, usage, text: response.text }, true); return state; }
          if (state.rounds >= maxRounds) { await save({ status: 'tool_round_limit', text: response.text, usage, errorCode: 'TOOL_ROUND_LIMIT' }, true); return state; }
          await save({ messages, pending: calls, usage, rounds: state.rounds + 1 });
        }
      } catch (error) {
        if (error instanceof AgentRunError && error.code === 'AGENT_LEASE_LOST') throw error;
        const code = (error as any)?.code;
        const status: AgentRunStatus = state.inFlight ? 'unknown' : signal?.aborted ? 'cancelled' : code === 'budget_exceeded' ? 'budget_limited' : 'failed';
        // A non-cooperative external call may finish later. Never interpret cancellation as rollback.
        await save({ status, errorCode: state.inFlight ? 'TOOL_OUTCOME_UNKNOWN' : code ?? 'AGENT_FAILED' }, true);
        return state;
      }
    },
    /** Operator/application reconciliation: supply an authoritative tool result, never ask the model to guess it. */
    async resolveUnknown(scope: string, id: string, input: { revision: number; idempotencyKey: string; output: unknown }): Promise<AgentRun> {
      const { key, raw, state } = await read(scope, id);
      if (state.lease && state.lease.until > Date.now()) throw new AgentRunError('AGENT_BUSY');
      if (!state.inFlight || state.revision !== input.revision || state.inFlight.key !== input.idempotencyKey)
        throw new AgentRunError('AGENT_RECONCILIATION_CONFLICT');
      const updated: AgentRun = { ...state, status: 'queued', inFlight: undefined, lease: undefined,
        revision: state.revision + 1, errorCode: undefined, pending: state.pending.slice(1),
        messages: [...state.messages, { role: 'tool', toolCallId: state.inFlight.call.id, content: JSON.stringify(input.output ?? null) }] };
      if (!await options.store.compareAndSet(key, raw, JSON.stringify(updated))) throw new AgentRunError('AGENT_RECONCILIATION_CONFLICT');
      return updated;
    },
  };
}

async function bounded<T>(fn: (signal: AbortSignal) => Promise<T>, parent: AbortSignal | undefined, leaseMs: number): Promise<T> {
  const controller = new AbortController();
  // Leave time to persist the final state before the lease expires.
  const timeout = Math.max(1, Math.floor(leaseMs * 0.8));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    return await Promise.race([new Promise<T>((_, reject) => {
      abort = () => { controller.abort(); reject(new AgentRunError('CANCELLED')); };
      if (parent?.aborted) { abort(); return; }
      parent?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new AgentRunError('AGENT_STEP_TIMEOUT')); }, timeout);
    }), Promise.resolve().then(() => { controller.signal.throwIfAborted(); return fn(controller.signal); })]);
  } finally { if (timer) clearTimeout(timer); parent?.removeEventListener('abort', abort); }
}
