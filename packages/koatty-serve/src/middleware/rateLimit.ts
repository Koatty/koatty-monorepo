import { IncomingMessage, ServerResponse } from 'http';

export interface RateLimitOptions {
  enabled?: boolean;
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: IncomingMessage) => string;
  message?: string;
  skipSuccessfulRequests?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const defaultOptions: Required<RateLimitOptions> = {
  enabled: false,
  windowMs: 60000,
  max: 100,
  keyGenerator: (req: IncomingMessage) => {
    return req.socket?.remoteAddress || 'unknown';
  },
  message: 'Too many requests',
  skipSuccessfulRequests: false,
};

export function createRateLimitMiddleware(options: RateLimitOptions = {}) {
  const config = { ...defaultOptions, ...options };
  if (!config.enabled) {
    return null;
  }

  const store = new Map<string, RateLimitEntry>();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetTime) {
        store.delete(key);
      }
    }
  }, config.windowMs);
  cleanupTimer.unref();

  return async (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => {
    const key = config.keyGenerator(req);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + config.windowMs };
      store.set(key, entry);
    }

    entry.count++;
    const remaining = Math.max(0, config.max - entry.count);
    const resetTimeSeconds = Math.ceil((entry.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', String(config.max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetTimeSeconds));

    if (entry.count > config.max) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: config.message }));
      return;
    }

    await next();

    if (config.skipSuccessfulRequests && (res.statusCode || 200) < 400) {
      entry.count--;
    }
  };
}
