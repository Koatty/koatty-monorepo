/**
 * Guard aspects (roadmap Phase F, item F-3).
 *
 * The roadmap explicitly forbids building a new decorator stack: these aspects
 * implement `IAspect` from `koatty_container` (the existing `@Around` / `@Before`
 * implementation) and only DELEGATE to the services above.
 *
 * They also stay in one class on purpose: the existing AOP pipeline applies a
 * single `Around` per method, so composing several independent `Around`
 * aspects is not a supported assumption. One aspect that runs the services in
 * a defined order is deterministic — and therefore auditable.
 */

import type { IAspect } from 'koatty_container';
import { createAuditService, summarizeArguments, type AuditService, type GuardAuditRecord } from './audit';
import { createContentGuard, type ContentGuard } from './content';
import { createMaskingService, type MaskingService } from './masking';
import { createRateLimiter, type RateLimiter } from './ratelimit';
import type { ApprovalService } from './approval';

export interface GuardAspectOptions {
  app: any;
  masking?: MaskingService;
  content?: ContentGuard;
  rateLimiter?: RateLimiter;
  approval?: ApprovalService;
  audit?: AuditService;
  /** Targets that need approval (e.g. tools declared `requireApproval`). */
  requiresApproval?: (target: string) => boolean;
  /** Targets that consume external content (LLM entry points). */
  inspectsContent?: (target: string) => boolean;
  /** Rate limit key; defaults to caller + target. */
  rateLimitKey?: (context: { caller?: string; target: string }) => string;
  /** Caller resolver; defaults to the current Koatty context principal. */
  callerResolver?: (app: any) => string | undefined;
}

export class GuardError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
  }
}

/**
 * Aspect that runs rate limiting, content inspection, approval, result masking
 * and auditing around an intercepted method.
 */
export class GuardAspect implements IAspect {
  readonly app: any;
  readonly masking: MaskingService;
  readonly content: ContentGuard;
  readonly rateLimiter: RateLimiter;
  readonly approval?: ApprovalService;
  readonly audit: AuditService;
  private readonly options: GuardAspectOptions;

  constructor(options: GuardAspectOptions) {
    this.app = options.app;
    this.options = options;
    this.masking = options.masking ?? createMaskingService();
    this.content = options.content ?? createContentGuard();
    this.rateLimiter = options.rateLimiter ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
    this.approval = options.approval;
    this.audit = options.audit ?? createAuditService({ mask: (value) => this.masking.mask(value) });
  }

  private caller(): string | undefined {
    if (this.options.callerResolver) {
      return this.options.callerResolver(this.app);
    }
    try {
      const ctx = this.app?.getCurrentContext?.();
      return ctx?.principal?.id;
    } catch {
      return undefined;
    }
  }

  /** Check the rate limit for a caller/target pair. */
  checkRateLimit(target: string, caller = this.caller()): void {
    const key = this.options.rateLimitKey
      ? this.options.rateLimitKey({ caller, target })
      : `${caller ?? 'anonymous'}:${target}`;
    const result = this.rateLimiter.check(key);
    if (!result.allowed) {
      throw new GuardError('rate-limited', `rate limited for ${key}, retry in ${result.retryAfterMs}ms`);
    }
  }

  /** Inspect external content before it reaches the model. */
  inspectContent(text: string): { risk: string; decision: string; findings: unknown[] } {
    const result = this.content.inspect(text);
    if (result.decision === 'reject') {
      throw new GuardError('content-rejected', `content rejected: ${result.findings.map((f) => f.rule).join(',')}`);
    }
    return result;
  }

  /** Run the services in order around `proceed`. */
  async runGuarded<T>(
    target: string,
    args: unknown[],
    proceed: () => Promise<T> | T,
    context: { caller?: string; sessionId?: string; requestId?: string; signal?: AbortSignal; audit?: boolean } = {},
  ): Promise<T> {
    const startedAt = Date.now();
    const caller = context.caller ?? this.caller();
    try {
      const signal = context.signal ?? this.app?.getCurrentContext?.()?.signal;
      signal?.throwIfAborted();
      this.checkRateLimit(target, caller);

      if (this.options.inspectsContent?.(target)) {
        const seen = new WeakSet<object>();
        const inspect = (value: unknown) => {
          if (typeof value === 'string') this.inspectContent(value);
          else if (value && typeof value === 'object' && !seen.has(value)) {
            seen.add(value);
            if (Buffer.isBuffer(value)) { this.inspectContent(value.toString('utf8')); return; }
            if (value instanceof Map) { for (const [key, item] of value) { inspect(key); inspect(item); } return; }
            if (value instanceof Set) { for (const item of value) inspect(item); return; }
            for (const [key, item] of Object.entries(value)) { inspect(key); inspect(item); }
          }
        };
        inspect(args);
      }

      if (this.options.requiresApproval?.(target)) {
        if (!this.approval) {
          throw new GuardError('approval-unavailable', `no approval backend configured for ${target}`);
        }
        const decision = await this.approval.request({
          id: '',
          tool: target,
          args: (Array.isArray(args) && typeof args[0] === 'object' ? args[0] : undefined) as
            | Record<string, unknown>
            | undefined,
          caller,
          sessionId: context.sessionId,
          requestId: context.requestId,
        }, { signal });
        if (decision?.approved !== true) {
          const reason = decision?.reason ?? 'invalid-approval';
          throw new GuardError(reason, `approval denied for ${target}: ${reason}`);
        }
      }

      signal?.throwIfAborted();
      const result = await proceed();
      if (context.audit !== false) this.audit.record({
        caller,
        sessionId: context.sessionId,
        requestId: context.requestId,
        target,
        status: 'success',
        durationMs: Date.now() - startedAt,
        argumentSummary: summarizeArguments(args[0]),
      });
      return this.masking.mask(result);
    } catch (error) {
      const record: Omit<GuardAuditRecord, 'at'> = {
        caller,
        sessionId: context.sessionId,
        requestId: context.requestId,
        target,
        status: error instanceof GuardError ? 'rejected' : 'error',
        durationMs: Date.now() - startedAt,
        argumentSummary: summarizeArguments(args[0]),
        error: error instanceof GuardError ? error.code : 'guard-operation-failed',
      };
      if (context.audit !== false) this.audit.record(record);
      throw error;
    }
  }

  /** `IAspect` entry point; delegates to {@link runGuarded}. */
  run(args: unknown[], proceed?: (...values: unknown[]) => any, options?: Record<string, unknown>): any {
    const target = (options?.targetMethod as string) ?? 'unknown';
    if (typeof proceed !== 'function') {
      throw new GuardError('no-proceed', `guard aspect requires a proceed callback for ${target}`);
    }
    return this.runGuarded(target, args ?? [], () => proceed(...(args ?? [])));
  }
}

/** Convenience factory: a fully wired guard aspect. */
export function createGuardAspect(options: GuardAspectOptions): GuardAspect {
  return new GuardAspect(options);
}
