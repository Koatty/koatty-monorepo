/**
 * Rate limiting service (roadmap Phase F, item F-3).
 *
 * Sliding-window counter keyed by caller + tool (the caller decides the key).
 * In-process by design: the roadmap asks the existing auth middleware/aspect to
 * consult a limiter, not to invent a distributed limiter; pass a shared store
 * based limiter in production if the fleet needs one.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  /** Reset one key (tests, admin tooling). */
  reset(key?: string): void;
}

/**
 * Create a sliding window limiter.
 *
 * @param options.limit max calls per window
 * @param options.windowMs window length in ms
 * @param options.now injectable clock (tests)
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();

  return {
    check(key: string) {
      const timestamp = now();
      const windowStart = timestamp - windowMs;
      const previous = (hits.get(key) ?? []).filter((entry) => entry > windowStart);

      if (previous.length >= limit) {
        hits.set(key, previous);
        const oldest = previous[0];
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, oldest + windowMs - timestamp),
        };
      }

      previous.push(timestamp);
      hits.set(key, previous);
      return { allowed: true, remaining: limit - previous.length, retryAfterMs: 0 };
    },

    reset(key?: string) {
      if (key === undefined) {
        hits.clear();
        return;
      }
      hits.delete(key);
    },
  };
}
