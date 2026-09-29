import { createMaskingService, isSensitiveKey } from './masking';
/**
 * Auditing service (roadmap Phase F, item F-3).
 *
 * Structured, redacted call records: caller, target, argument summary, status
 * and duration. The sink is injected so the application decides where records
 * go (logger, `koatty_store`, SIEM). Records never contain raw credentials:
 * the summary passes through the masking hook first.
 */

export interface GuardAuditRecord {
  caller?: string;
  sessionId?: string;
  requestId?: string;
  target: string;
  status: 'success' | 'error' | 'rejected' | 'pending-approval';
  durationMs: number;
  argumentSummary?: Record<string, unknown>;
  error?: string;
  at: number;
}

export interface AuditService {
  record(record: Omit<GuardAuditRecord, 'at'> & { at?: number }): void;
}

/** Argument summary: keys kept, values reduced to a type/size marker. */
export function summarizeArguments(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') {
    return { value: typeof args };
  }
  if (Buffer.isBuffer(args)) return { type: 'buffer', bytes: args.byteLength };
  if (args instanceof Map || args instanceof Set) return { type: args instanceof Map ? 'map' : 'set', size: args.size };
  if (Array.isArray(args)) return { type: 'array', length: args.length };
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      summary[key] = '***';
    } else if (value === null || value === undefined) {
      summary[key] = value;
    } else if (typeof value === 'string') {
      summary[key] = value.length > 60 ? `${value.slice(0, 57)}...` : value;
    } else if (Array.isArray(value)) {
      summary[key] = `[array:${value.length}]`;
    } else if (typeof value === 'object') {
      summary[key] = `[object:${Object.keys(value as Record<string, unknown>).length}]`;
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

/**
 * Create an audit service.
 *
 * @param options.sink destination callback; defaults to a no-op collector
 * @param options.mask masking hook applied to the argument summary
 */
export function createAuditService(options: {
  sink?: (record: GuardAuditRecord) => void | Promise<void>;
  mask?: (value: unknown) => unknown;
  now?: () => number;
} = {}): AuditService {
  const now = options.now ?? (() => Date.now());
  const safeMask = createMaskingService().mask;
  const mask = (value: unknown) => { try { return safeMask(options.mask ? options.mask(value) : value); } catch { return '***'; } };

  return {
    record(record) {
      const maskedSummary = record.argumentSummary
        ? (mask(record.argumentSummary) as Record<string, unknown>)
        : undefined;
      const entry: GuardAuditRecord = {
        ...record,
        argumentSummary: maskedSummary,
        at: record.at ?? now(),
        caller: record.caller ? String(mask(record.caller)) : undefined,
        // Error messages can contain arbitrary credentials, not just PII.
        error: record.error ? (['approval-timeout', 'approval-cancelled', 'approval-denied', 'rate-limited', 'content-rejected'].includes(record.error) ? record.error : 'guard-operation-failed') : undefined,
      };
      if (options.sink) {
        try { void Promise.resolve(options.sink(entry)).catch(() => {}); } catch { /* best-effort sink */ }
      }
    },
  };
}
