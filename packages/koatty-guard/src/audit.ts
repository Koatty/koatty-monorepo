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
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value === null || value === undefined) {
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
  const mask = options.mask ?? ((value: unknown) => value);

  return {
    record(record) {
      const maskedSummary = record.argumentSummary
        ? (mask(record.argumentSummary) as Record<string, unknown>)
        : undefined;
      const entry: GuardAuditRecord = {
        ...record,
        argumentSummary: maskedSummary,
        at: record.at ?? now(),
      };
      if (options.sink) {
        void options.sink(entry);
      }
    },
  };
}
