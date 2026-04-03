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

  constructor(config: HealthCheckConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      path: config.path ?? '/health',
      readiness: config.readiness ?? '/ready',
      detailed: config.detailed ?? false,
      memoryThresholdMB: config.memoryThresholdMB ?? 500,
    };
    this.startTime = Date.now();
  }

  middleware() {
    return async (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => {
      if (!this.config.enabled) {
        return next();
      }
      const url = req.url?.split('?')[0];
      if (url === this.config.path) {
        return this.handleHealthCheck(req, res);
      }
      if (url === this.config.readiness) {
        return this.handleReadinessCheck(req, res);
      }
      return next();
    };
  }
  private handleHealthCheck(req: any, res: any): void {
    const response: HealthCheckResponse = {
      status: 'ok',
      uptime: this.getUptime(),
      timestamp: new Date().toISOString(),
    };
    if (this.config.detailed) {
      response.details = {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      };
    }
    this.sendJsonResponse(res, 200, response);
  }
  private handleReadinessCheck(req: any, res: any): void {
    const checks: Record<string, boolean> = {
      uptime: this.getUptime() > 0,
      memory: this.checkMemoryHealth(),
    };
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
export function createHealthCheckMiddleware(config?: HealthCheckConfig) {
  const middleware = new HealthCheckMiddleware(config);
  return middleware.middleware();
}
