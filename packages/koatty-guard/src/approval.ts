/** Durable, single-use approval tickets. Only explicit approval can execute. */
import { createHash, randomUUID } from 'crypto';

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
  request(ticket: ApprovalTicketInput, options?: { signal?: AbortSignal }): Promise<ApprovalDecisionLike>;
  approve(id: string, approver?: string): boolean | Promise<boolean>;
  reject(id: string, reason: string): boolean | Promise<boolean>;
  list(): ApprovalTicketLike[];
  /** Resume a persisted pending ticket after restart; a decision is consumed once. */
  resume?(id: string, options?: { signal?: AbortSignal }): Promise<ApprovalDecisionLike>;
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
  /** Local mode keeps single-use tombstones and refuses growth above this bound. */
  maxLocalTickets?: number;
} = {}): ApprovalService {
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('approval timeout must be positive');
  if (options.store && !options.store.compareAndSet) throw new Error('Shared approval stores require atomic compareAndSet');
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

  const nextDecision = (raw: string | null, decision: ApprovalDecisionLike): string | undefined => {
    if (!raw) return;
    const record = JSON.parse(raw) as RecordState;
    if (record.state !== 'pending' || now() >= record.ticket.expiresAt!) return;
    return JSON.stringify({ ...record, state: 'decided', decision: normalize(decision) });
  };
  const decide = (id: string, decision: ApprovalDecisionLike): boolean | Promise<boolean> => {
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
    catch (error) { return denied((error as Error).message === 'approval-cancelled' ? 'approval-cancelled' : 'approval-timeout'); }
    finally {
      pending.delete(ticket.id);
      // Timeout/cancellation terminalization is best effort. Even if storage is
      // unavailable the immutable deadline still prevents a late approval.
      if (signal?.aborted || now() >= ticket.expiresAt!) {
        void Promise.resolve().then(async () => {
          const raw = await store.get(PREFIX + ticket.id);
          if (!raw) return;
          const record = JSON.parse(raw) as RecordState;
          if (record.state === 'consumed') return;
          await store.compareAndSet!(PREFIX + ticket.id, raw, JSON.stringify({ state: 'consumed', fingerprint: record.fingerprint,
            ticket: { id: ticket.id, tool: ticket.tool, expiresAt: ticket.expiresAt } }));
        }).catch(() => {});
      }
    }
  }
  return {
    async request(input, call = {}) {
      if (call.signal?.aborted) return denied('approval-cancelled');
      if (!options.store && memory.size >= (options.maxLocalTickets ?? 10_000)) return denied('approval-capacity');
      const createdAt = input.createdAt ?? now();
      const ticket: ApprovalTicketLike = { ...input, id: input.id || randomUUID(), createdAt,
        expiresAt: Math.min(input.expiresAt ?? createdAt + timeoutMs, createdAt + timeoutMs) };
      if (!Number.isFinite(ticket.expiresAt) || ticket.expiresAt! <= now()) return denied('approval-timeout');
      const fingerprint = createHash('sha256').update(JSON.stringify([ticket.tool, ticket.caller, ticket.sessionId, ticket.requestId, ticket.args])).digest('hex');
      if (pending.has(ticket.id)) return denied('duplicate-ticket');
      pending.set(ticket.id, ticket);
      try {
        const created = await bounded(store.compareAndSet!(PREFIX + ticket.id, null, JSON.stringify({ ticket, fingerprint, state: 'pending' })), ticket.expiresAt!, now, call.signal);
        if (!created) { pending.delete(ticket.id); return denied('duplicate-ticket'); }
        // Notification never delays deadline enforcement. A failed notifier
        // rejects the same persisted ticket instead of authorizing it.
        void Promise.resolve().then(() => options.notify?.(ticket)).catch(() => decide(ticket.id, denied('notification-failed'))).catch(() => {});
        return await finish(ticket, call.signal);
      } catch { pending.delete(ticket.id); return denied(call.signal?.aborted ? 'approval-cancelled' : 'approval-backend-failed'); }
    },
    approve: (id, approver) => decide(id, { approved: true, approver }),
    reject: (id, reason) => decide(id, denied(reason)),
    list: () => [...pending.values()],
    async resume(id, call = {}) {
      try {
        const raw = await bounded(store.get(PREFIX + id), now() + timeoutMs, now, call.signal);
        if (!raw) return denied('approval-not-found');
        const record = JSON.parse(raw) as RecordState;
        if (record.state === 'consumed') return denied('approval-already-consumed');
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
  return { ...service, approve: () => false, reject: () => false };
}
