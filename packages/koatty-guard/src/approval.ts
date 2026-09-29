/**
 * Approval service (roadmap Phase F, item F-3).
 *
 * Implements the human-in-the-loop backend that `koatty_mcp`'s `requireApproval`
 * gate expects (`request(ticket)` -> decision). The ticket types are declared
 * structurally here on purpose: `koatty_guard` must not depend on `koatty_mcp`.
 *
 * Fail closed: a ticket that times out is REJECTED, never approved.
 */

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

export type ApprovalDecisionLike =
  | { approved: true; approver?: string }
  | { approved: false; reason: string };

export type ApprovalTicketInput = Omit<ApprovalTicketLike, 'id'> & { id?: string };

/** Minimal key/value store (satisfied by `koatty_store` clients). */
export interface KeyValueStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
}

export interface ApprovalService {
  request(ticket: ApprovalTicketInput): Promise<ApprovalDecisionLike>;
  /** Approve a pending ticket (human operator side). */
  approve(id: string, approver?: string): boolean;
  /** Reject a pending ticket. */
  reject(id: string, reason: string): boolean;
  /** Pending tickets, for dashboards. */
  list(): ApprovalTicketLike[];
}

const PENDING_PREFIX = 'koatty_guard:approval:pending:';

function defaultId(): string {
  return `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create an approval service with an in-process pending queue and optional
 * persistence through any `{ get, set }` store so several instances share the
 * same tickets.
 *
 * @param options.timeoutMs how long a ticket waits before auto-rejection
 * @param options.notify called when a ticket is created (e.g. MCP elicitation or a webhook)
 * @param options.now injectable clock (tests)
 */
export function createApprovalService(options: {
  timeoutMs?: number;
  store?: KeyValueStore;
  notify?: (ticket: ApprovalTicketLike) => void | Promise<void>;
  now?: () => number;
} = {}): ApprovalService {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const store = options.store;
  const pending = new Map<string, ApprovalTicketLike>();
  const decisions = new Map<string, ApprovalDecisionLike>();

  const persist = async (ticket: ApprovalTicketLike): Promise<void> => {
    if (store) {
      await store.set(`${PENDING_PREFIX}${ticket.id}`, JSON.stringify(ticket));
    }
  };

  return {
    async request(ticket: ApprovalTicketInput) {
      const createdAt = ticket.createdAt ?? now();
      const prepared: ApprovalTicketLike = {
        ...ticket,
        id: ticket.id || defaultId(),
        createdAt,
        expiresAt: ticket.expiresAt ?? createdAt + timeoutMs,
      };
      pending.set(prepared.id, prepared);
      await persist(prepared);
      if (options.notify) {
        await options.notify(prepared);
      }

      const decision = await new Promise<ApprovalDecisionLike>((resolve) => {
        const deadline = prepared.expiresAt as number;
        const tick = () => {
          const settled = decisions.get(prepared.id);
          if (settled) {
            resolve(settled);
            return;
          }
          if (now() >= deadline) {
            // Fail closed: silence is a rejection.
            decisions.set(prepared.id, { approved: false, reason: 'approval-timeout' });
            resolve({ approved: false, reason: 'approval-timeout' });
            return;
          }
          setTimeout(tick, Math.max(1, Math.min(50, deadline - now())));
        };
        tick();
      });

      pending.delete(prepared.id);
      return decision;
    },

    approve(id: string, approver?: string) {
      if (!pending.has(id)) {
        return false;
      }
      decisions.set(id, approver ? { approved: true, approver } : { approved: true });
      return true;
    },

    reject(id: string, reason: string) {
      if (!pending.has(id)) {
        return false;
      }
      decisions.set(id, { approved: false, reason });
      return true;
    },

    list() {
      return [...pending.values()];
    },
  };
}

/**
 * Notify an external system and wait for its answer; timeouts reject.
 * Useful for MCP elicitation style flows or chat-ops webhooks.
 */
export function createCallbackApprovalService(options: {
  notify: (ticket: ApprovalTicketLike) => Promise<ApprovalDecisionLike>;
  timeoutMs?: number;
  now?: () => number;
}): ApprovalService {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const open = new Map<string, ApprovalTicketLike>();

  return {
    async request(ticket: ApprovalTicketInput): Promise<ApprovalDecisionLike> {
      const prepared: ApprovalTicketLike = {
        ...ticket,
        id: ticket.id || defaultId(),
        createdAt: ticket.createdAt ?? now(),
        expiresAt: ticket.expiresAt ?? (ticket.createdAt ?? now()) + timeoutMs,
      };
      open.set(prepared.id, prepared);
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeoutDecision = new Promise<ApprovalDecisionLike>((resolve) => {
          timer = setTimeout(
            () => resolve({ approved: false, reason: 'approval-timeout' }),
            Math.max(1, (prepared.expiresAt as number) - now()),
          );
          timer.unref?.();
        });
        const notified = Promise.resolve()
          .then(() => options.notify(prepared))
          .catch(() => ({ approved: false, reason: 'callback-error' }) as ApprovalDecisionLike);
        return await Promise.race([notified, timeoutDecision]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        open.delete(prepared.id);
      }
    },

    // The decision comes from the external system, not from local operators.
    approve() {
      return false;
    },

    reject() {
      return false;
    },

    list() {
      return [...open.values()];
    },
  };
}
