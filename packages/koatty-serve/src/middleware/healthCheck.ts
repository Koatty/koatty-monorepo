/*
 * @Description: Health Check Middleware
 * @Usage: Built-in health check endpoint for monitoring
 * @Author: richen
 * @Date: 2026-04-02 00:00:00
 * @LastEditTime: 2026-04-02 00:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { IncomingMessage, ServerResponse } from 'http';

export interface HealthCheckConfig {
  enabled?: boolean;
  path?: string;
  readiness?: string;
  detailed?: boolean;
  memoryThresholdMB?: number;
  /** metrics endpoint path (SEC-06 / B-6); defaults to '/metrics' */
  metricsPath?: string;
  /** metrics exposure policy; defaults from the security profile (internal) */
  exposeMetrics?: 'off' | 'internal' | 'public';
  /** prometheus-format metrics provider used by the /metrics endpoint */
  metricsProvider?: () => string;
  /** bearer token required for /metrics outside allowCidrs and for details */
  opsToken?: string;
  /** extra trusted CIDRs (RFC1918 + loopback are always trusted) */
  allowCidrs?: string[];
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  uptime: number;
  timestamp: string;
  details?: {
    memory?: NodeJS.MemoryUsage;
    cpu?: NodeJS.CpuUsage;
  };
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  checks?: Record<string, boolean>;
  timestamp: string;
}
export class HealthCheckMiddleware {
  private config: Required<HealthCheckConfig>;
  private startTime: number;
  private draining = false;

  constructor(config: HealthCheckConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      path: config.path ?? '/health',
      readiness: config.readiness ?? '/ready',
      detailed: config.detailed ?? false,
      memoryThresholdMB: config.memoryThresholdMB ?? 500,
      metricsPath: config.metricsPath ?? '/metrics',
      exposeMetrics: config.exposeMetrics ?? 'internal',
      metricsProvider: config.metricsProvider ?? (() => ''),
      opsToken: config.opsToken ?? '',
      allowCidrs: config.allowCidrs ?? [],
    };
    this.startTime = Date.now();
  }

  /**
   * Mark the server as draining (graceful shutdown started): /ready flips
   * to 503 so load balancers stop routing new traffic (COR-03 / B-6).
   */
  setDraining(draining: boolean): void {
    this.draining = draining;
  }

  middleware() {
    return async (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => {
      if (!this.config.enabled) {
        return next();
      }
      const url = req.url?.split('?')[0];
      if (url === this.config.path || url === '/healthz') {
        return this.handleHealthCheck(req, res);
      }
      if (url === this.config.readiness) {
        return this.handleReadinessCheck(req, res);
      }
      if (url === this.config.metricsPath) {
        return this.handleMetrics(req, res);
      }
      return next();
    };
  }
  /**
   * Liveness probe (SEC-06 / B-6): always returns the minimal body —
   * memory, CPU, connection counts and the like are NEVER included, even
   * when details are authorized.
   */
  private handleHealthCheck(req: any, res: any): void {
    const authorized = this.isAuthorized(req);
    if (this.config.detailed && authorized) {
      const response: HealthCheckResponse = {
        status: 'ok',
        uptime: this.getUptime(),
        timestamp: new Date().toISOString(),
        details: {
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
        },
      };
      return this.sendJsonResponse(res, 200, response);
    }
    // minimal liveness payload
    this.sendJsonResponse(res, 200, { status: 'ok' });
  }

  /**
   * True when the request comes from a trusted source: loopback/RFC1918 by
   * default (based on socket.remoteAddress only — X-Forwarded-For is never
   * trusted here), plus configured allowCidrs, or a valid ops bearer token.
   */
  private isAuthorized(req: any): boolean {
    if (this.config.opsToken) {
      const auth = String(req.headers?.authorization || '');
      if (auth === `Bearer ${this.config.opsToken}`) {
        return true;
      }
    }
    const ip = String(req.socket?.remoteAddress || '');
    return isTrustedRemoteIp(ip, this.config.allowCidrs);
  }

  /**
   * Metrics endpoint (SEC-06 / B-6): exposure is governed by the security
   * profile's `ops.exposeMetrics` policy:
   * - 'off': 404;
   * - 'internal' (default): only trusted sources (loopback/RFC1918/allowCidrs
   *   or a valid bearer token);
   * - 'public': open.
   */
  private handleMetrics(req: any, res: any): void {
    if (this.config.exposeMetrics === 'off') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found' }));
      return;
    }
    if (this.config.exposeMetrics !== 'public' && !this.isAuthorized(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Forbidden' }));
      return;
    }
    const body = this.config.metricsProvider() || '';
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }
  private handleReadinessCheck(req: any, res: any): void {
    const checks: Record<string, boolean> = {
      // B-6: an uptime of 0 in the first second must not flip /ready to 503
      uptime: Number.isFinite(this.getUptime()),
      memory: this.checkMemoryHealth(),
    };
    if (this.draining) {
      this.sendJsonResponse(res, 503, {
        status: 'not_ready',
        checks: this.config.detailed ? { ...checks, draining: false } : undefined,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const allChecksPass = Object.values(checks).every(check => check === true);
    const response: ReadinessResponse = {
      status: allChecksPass ? 'ready' : 'not_ready',
      checks: this.config.detailed ? checks : undefined,
      timestamp: new Date().toISOString(),
    };
    this.sendJsonResponse(res, allChecksPass ? 200 : 503, response);
  }
  private getUptime(): number {
    return (Date.now() - this.startTime) / 1000;
  }
  private checkMemoryHealth(): boolean {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    return heapUsedMB < this.config.memoryThresholdMB;
  }
  private sendJsonResponse(res: any, statusCode: number, data: any): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data, null, 2));
  }
}
/** loopback + RFC1918 defaults (IPv4), matched as integer ranges */
const TRUSTED_V4_RANGES: Array<[number, number]> = [
  [ipv4ToInt('127.0.0.0'), ipv4ToInt('127.255.255.255')],
  [ipv4ToInt('10.0.0.0'), ipv4ToInt('10.255.255.255')],
  [ipv4ToInt('172.16.0.0'), ipv4ToInt('172.31.255.255')],
  [ipv4ToInt('192.168.0.0'), ipv4ToInt('192.168.255.255')],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return NaN;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return NaN;
    out = out * 256 + n;
  }
  return out;
}

/**
 * True when the client IP is a loopback/private-network address (based on
 * `socket.remoteAddress` only) or falls into one of the configured CIDRs.
 */
export function isTrustedRemoteIp(ip: string, allowCidrs: string[] = []): boolean {
  if (!ip) return false;
  // strip IPv6-mapped IPv4 prefix
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (v4 === '::1' || ip === '::1') return true;
  const int = ipv4ToInt(v4);
  if (!Number.isNaN(int)) {
    if (TRUSTED_V4_RANGES.some(([min, max]) => int >= min && int <= max)) {
      return true;
    }
    for (const cidr of allowCidrs) {
      const [base, bitsStr] = cidr.split('/');
      const bits = Number(bitsStr);
      if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const baseInt = ipv4ToInt(base);
      if (Number.isNaN(baseInt)) continue;
      const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
      if ((int & mask) === (baseInt & mask)) return true;
    }
  }
  return false;
}

/**
 * Resolve ops-related health/metrics config from the application: the
 * security profile's `ops.exposeMetrics` plus `config/ops.ts` fields
 * (`token`, `allowCidrs`) (SEC-06 / B-6).
 */
export function resolveOpsConfig(app: unknown): Partial<HealthCheckConfig> {
  try {
    const a = app as any;
    const exposeMetrics = a?.security?.ops?.exposeMetrics;
    const ops = a?.config?.('ops') ?? {};
    return {
      exposeMetrics: exposeMetrics === 'off' || exposeMetrics === 'public' ? exposeMetrics : 'internal',
      opsToken: typeof ops.token === 'string' ? ops.token : undefined,
      allowCidrs: Array.isArray(ops.allowCidrs) ? ops.allowCidrs.filter((c: unknown) => typeof c === 'string') : undefined,
    };
  } catch {
    return { exposeMetrics: 'internal' };
  }
}

export function createHealthCheckMiddleware(config?: HealthCheckConfig) {
  const middleware = new HealthCheckMiddleware(config);
  return middleware.middleware();
}
