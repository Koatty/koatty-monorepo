/**
 * Error taxonomy of `koatty_llm` (roadmap Phase F, item F-2).
 *
 * Retry/failover decisions depend on {@link LlmError.retryable}: only rate
 * limits (429) and provider faults (5xx / transport) are retried, a 4xx from
 * the caller is surfaced immediately. Aborted calls are never retried.
 *
 * @License BSD-3-Clause
 */

export type LlmErrorCode =
  | 'aborted'
  | 'timeout'
  | 'rate_limited'
  | 'provider_error'
  | 'bad_request'
  | 'budget_exceeded'
  | 'invalid_output'
  | 'no_route'
  | 'breaker_open';

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly provider?: string;
  readonly model?: string;

  constructor(
    message: string,
    options: {
      code: LlmErrorCode;
      retryable?: boolean;
      status?: number;
      provider?: string;
      model?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'LlmError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.provider = options.provider;
    this.model = options.model;
    if (options.cause !== undefined) (this as any).cause = options.cause;
  }
}

/** Caller cancellation (`ctx.signal`) — never retried, never cached. */
export class LlmAbortError extends LlmError {
  constructor(message = 'LLM call aborted by the caller.', options: { provider?: string; model?: string } = {}) {
    super(message, { code: 'aborted', retryable: false, ...options });
    this.name = 'LlmAbortError';
  }
}

/** Per-attempt timeout — retried while attempts remain. */
export class LlmTimeoutError extends LlmError {
  constructor(message = 'LLM call timed out.', options: { provider?: string; model?: string } = {}) {
    super(message, { code: 'timeout', retryable: true, ...options });
    this.name = 'LlmTimeoutError';
  }
}

/** Token budget exhausted for the scope. The call is aborted, not truncated. */
export class LlmBudgetError extends LlmError {
  readonly scope: string;
  readonly used: number;
  readonly max: number;

  constructor(scope: string, used: number, max: number, options: { provider?: string; model?: string } = {}) {
    super(`Token budget exhausted for scope "${scope}" (${used}/${max}).`, {
      code: 'budget_exceeded',
      retryable: false,
      ...options,
    });
    this.name = 'LlmBudgetError';
    this.scope = scope;
    this.used = used;
    this.max = max;
  }
}

/** Structured output that is not valid JSON or violates the DTO. */
export class LlmValidationError extends LlmError {
  readonly issues: any[];
  readonly raw: string;

  constructor(message: string, issues: any[], raw: string, options: { provider?: string; model?: string } = {}) {
    super(message, { code: 'invalid_output', retryable: false, ...options });
    this.name = 'LlmValidationError';
    this.issues = issues;
    this.raw = raw;
  }
}

/** All routes (primary + fallbacks) failed. */
export class LlmUnavailableError extends LlmError {
  readonly attempts: Array<{ model: string; provider?: string; error: string }>;

  constructor(
    attempts: Array<{ model: string; provider?: string; error: string }>,
    last?: { code?: LlmErrorCode; retryable?: boolean },
  ) {
    super(
      `No LLM route could serve the request (${attempts.map((item) => `${item.model}:${item.error}`).join('; ')}).`,
      { code: last?.code ?? 'provider_error', retryable: last?.retryable ?? false },
    );
    this.name = 'LlmUnavailableError';
    this.attempts = attempts;
  }
}

/** Normalise any thrown value into an {@link LlmError}. */
export function toLlmError(error: unknown, context: { provider?: string; model?: string } = {}): LlmError {
  if (error instanceof LlmError) return error;
  const anyError = error as any;
  const name = String(anyError?.name ?? '');
  if (name === 'AbortError' || anyError?.code === 'ABORT_ERR') {
    return new LlmAbortError(undefined, context);
  }
  const status = typeof anyError?.status === 'number' ? anyError.status : undefined;
  const retryable = status === undefined ? true : status === 429 || status >= 500;
  const code: LlmErrorCode = status === 429 ? 'rate_limited' : status && status < 500 ? 'bad_request' : 'provider_error';
  return new LlmError(anyError?.message ?? 'LLM provider failure.', { code, retryable, status, ...context, cause: error });
}
