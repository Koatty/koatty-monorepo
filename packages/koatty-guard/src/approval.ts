/** Durable, single-use approval tickets. Only explicit approval can execute. */
import { createHash, randomUUID } from 'crypto';
import { createMaskingService } from './masking';

export interface ApprovalTicketLike {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  argumentSummary?: Record<string, unknown>;
  caller?: string;
  sessionId?: string;
  requestId?: string;
  createdAt?: number;
  expiresAt?: number;
}
export type ApprovalDecisionLike = { approved: true; approver?: string } | { approved: false; reason: string };
export type ApprovalTicketInput = Omit<ApprovalTicketLike, 'id'> & { id?: string };
export interface KeyValueStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  /** Atomic create/update; expected=null means the key must not exist. */
  compareAndSet?(key: string, expected: string | null, value: string): Promise<boolean> | boolean;
}
export interface ApprovalService {
  readonly managesTimeout?: boolean;
  request(ticket: ApprovalTicketInput, options?: { signal?: AbortSignal }): Promise<ApprovalDecisionLike>;
  approve(id: string, approver?: string): Promise<boolean>;
  reject(id: string, reason: string): Promise<boolean>;
  list(): ApprovalTicketLike[];
  /** Resume a persisted pending ticket after restart; a decision is consumed once. */
  resume?(id: string, context: Omit<ApprovalTicketInput, 'id'>, options?: { signal?: AbortSignal }): Promise<ApprovalDecisionLike>;
}
interface RecordState {
  ticket: ApprovalTicketLike;
  fingerprint: string;
  state: 'pending' | 'decided' | 'consumed';
  decision?: ApprovalDecisionLike;
}
const PREFIX = 'koatty_guard:approval:';
const denied = (reason: string): ApprovalDecisionLike => ({ approved: false, reason });
const normalize = (value: any): ApprovalDecisionLike => value?.approved === true
  ? { approved: true, ...(typeof value.approver === 'string' ? { approver: value.approver } : {}) }
  : denied(typeof value?.reason === 'string' ? value.reason : 'invalid-approval');

function bounded<T>(task: Promise<T> | T, deadline: number, now: () => number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('approval-cancelled')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('approval-timeout')); }, Math.max(0, deadline - now()));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    Promise.resolve(task).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export function createApprovalService(options: {
  timeoutMs?: number;
  store?: KeyValueStore;
  notify?: (ticket: ApprovalTicketLike) => void | Promise<void>;
  now?: () => number;
  /** Bound active local tickets; replay tombstones expire at the original deadline. */
  maxLocalTickets?: number;
} = {}): ApprovalService {
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error('approval timeout must be positive');
  if (options.store && !options.store.compareAndSet) throw new Error('Shared approval stores require atomic compareAndSet');
  if (options.maxLocalTickets !== undefined && (!Number.isSafeInteger(options.maxLocalTickets) || options.maxLocalTickets <= 0)) throw new Error('Invalid approval capacity');
  const now = options.now ?? Date.now;
  const memory = new Map<string, string>();
  const store: KeyValueStore = options.store ?? {
    get: key => memory.get(key) ?? null,
    set: (key, value) => { memory.set(key, value); },
    compareAndSet: (key, expected, value) => {
      if ((memory.get(key) ?? null) !== expected) return false;
      memory.set(key, value); return true;
    },
  };
  const pending = new Map<string, ApprovalTicketLike>();
  const observed = new Map<string, string>();
  const fingerprintOf = (ticket: ApprovalTicketInput) => {
    const canonical = (value: any): any => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    return createHash('sha256').update(JSON.stringify(canonical([ticket.tool, ticket.caller, ticket.sessionId, ticket.requestId, ticket.args]))).digest('hex');
  };
  const prune = () => {
    for (const [key, raw] of memory) if (JSON.parse(raw).ticket.expiresAt <= now()) memory.delete(key);
  };
  const terminalize = async (id: string) => {
    const key = PREFIX + id;
    const known = observed.get(id);
    if (known) {
      const record = JSON.parse(known) as RecordState;
      if (record.state === 'consumed') return;
      if (await store.compareAndSet!(key, known, JSON.stringify({ ...record, state: 'consumed', decision: undefined }))) return;
    }
    const raw = await store.get(key);
    if (!raw) return;
    const record = JSON.parse(raw) as RecordState;
    if (record.state !== 'consumed') await store.compareAndSet!(key, raw, JSON.stringify({ ...record, state: 'consumed', decision: undefined }));
  };

  const nextDecision = (raw: string | null, decision: ApprovalDecisionLike): string | undefined => {
    if (!raw) return;
    const record = JSON.parse(raw) as RecordState;
    if (record.state !== 'pending' || now() >= record.ticket.expiresAt!) return;
    return JSON.stringify({ ...record, state: 'decided', decision: normalize(decision) });
  };
  const decide = async (id: string, decision: ApprovalDecisionLike): Promise<boolean> => {
    const key = PREFIX + id;
    if (!options.store) {
      const raw = memory.get(key) ?? null;
      const next = nextDecision(raw, decision);
      if (!next) return false;
      memory.set(key, next); return true;
    }
    return (async () => {
      const raw = await store.get(key); const next = nextDecision(raw, decision);
      return next ? await store.compareAndSet!(key, raw, next) : false;
    })();
  };

  async function wait(id: string, deadline: number, signal?: AbortSignal): Promise<ApprovalDecisionLike> {
    const key = PREFIX + id;
    for (;;) {
      if (signal?.aborted) return denied('approval-cancelled');
      if (now() >= deadline) return denied('approval-timeout');
      const raw = await bounded(store.get(key), deadline, now, signal);
      if (!raw) return denied('approval-not-found');
      observed.set(id, raw);
      const record = JSON.parse(raw) as RecordState;
      if (record.state === 'consumed') return denied('approval-already-consumed');
      if (record.state === 'decided') {
        // Retain only a compact replay tombstone, never reusable arguments.
        const tombstone = JSON.stringify({ state: 'consumed', fingerprint: record.fingerprint,
          ticket: { id, tool: record.ticket.tool, expiresAt: record.ticket.expiresAt } });
        if (await bounded(store.compareAndSet!(key, raw, tombstone), deadline, now, signal)) return normalize(record.decision);
        continue;
      }
      await bounded(new Promise(r => setTimeout(r, Math.min(20, Math.max(1, deadline - now())))), deadline, now, signal);
    }
  }

  async function finish(ticket: ApprovalTicketLike, signal?: AbortSignal): Promise<ApprovalDecisionLike> {
    try { return await wait(ticket.id, ticket.expiresAt!, signal); }
    catch (error) { return denied(['approval-cancelled', 'approval-timeout'].includes((error as Error).message) ? (error as Error).message : 'approval-backend-failed'); }
    finally {
      pending.delete(ticket.id);
      // Terminalize on every outcome, including a transient read failure.
      try { await bounded(terminalize(ticket.id), now() + Math.min(timeoutMs, 100), now); } catch { /* immutable expiry remains authoritative */ }
      observed.delete(ticket.id);
    }
  }
  return {
    managesTimeout: true,
    async request(input, call = {}) {
      if (call.signal?.aborted) return denied('approval-cancelled');
      prune();
      if (!options.store && [...memory.values()].filter(raw => JSON.parse(raw).state !== 'consumed').length >= (options.maxLocalTickets ?? 10_000)) return denied('approval-capacity');
      const createdAt = input.createdAt ?? now();
      if (!Number.isFinite(createdAt) || createdAt > now()) return denied('invalid-created-at');
      const ticket: ApprovalTicketLike = { ...input, id: input.id || randomUUID(), createdAt,
        expiresAt: Math.min(input.expiresAt ?? createdAt + timeoutMs, createdAt + timeoutMs) };
      if (!Number.isFinite(ticket.expiresAt) || ticket.expiresAt! <= now()) return denied('approval-timeout');
      const fingerprint = fingerprintOf(ticket);
      const storedTicket: ApprovalTicketLike = { ...ticket, args: undefined, argumentSummary: createMaskingService().mask(ticket.argumentSummary ?? {}) };
      if (pending.has(ticket.id)) return denied('duplicate-ticket');
      pending.set(ticket.id, ticket);
      try {
        const raw = JSON.stringify({ ticket: storedTicket, fingerprint, state: 'pending' });
        const created = await bounded(store.compareAndSet!(PREFIX + ticket.id, null, raw), ticket.expiresAt!, now, call.signal);
        if (!created) { pending.delete(ticket.id); return denied('duplicate-ticket'); }
        observed.set(ticket.id, raw);
        // Notification never delays deadline enforcement. A failed notifier
        // rejects the same persisted ticket instead of authorizing it.
        void Promise.resolve().then(() => options.notify?.(ticket)).catch(() => decide(ticket.id, denied('notification-failed'))).catch(() => {});
        return await finish(ticket, call.signal);
      } catch { pending.delete(ticket.id); return denied(call.signal?.aborted ? 'approval-cancelled' : 'approval-backend-failed'); }
    },
    approve: (id, approver) => decide(id, { approved: true, approver }),
    reject: (id, reason) => decide(id, denied(reason)),
    list: () => [...pending.values()],
    async resume(id, context, call = {}) {
      try {
        const raw = await bounded(store.get(PREFIX + id), now() + timeoutMs, now, call.signal);
        if (!raw) return denied('approval-not-found');
        const record = JSON.parse(raw) as RecordState;
        if (record.state === 'consumed') return denied('approval-already-consumed');
        if (!context || fingerprintOf(context) !== record.fingerprint) return denied('approval-context-mismatch');
        observed.set(id, raw);
        pending.set(id, record.ticket);
        return await finish(record.ticket, call.signal);
      } catch { return denied('approval-backend-failed'); }
    },
  };
}

export function createCallbackApprovalService(options: {
  notify: (ticket: ApprovalTicketLike) => Promise<ApprovalDecisionLike>;
  timeoutMs?: number;
  now?: () => number;
}): ApprovalService {
  const service = createApprovalService({ ...options, notify: async ticket => {
    const decision = normalize(await options.notify(ticket));
    if (decision.approved === true) await service.approve(ticket.id, decision.approver);
    else await service.reject(ticket.id, decision.reason);
  } });
  return { ...service, approve: async () => false, reject: async () => false };
}
