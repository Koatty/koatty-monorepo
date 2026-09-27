/**
 * 
 * @Description: 协议处理器基础接口
 * @Author: richen
 * @Date: 2025-04-04 12:21:48
 * @LastEditTime: 2025-04-04 19:11:05
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import { KoattyContext, KoattyNext } from "koatty_core";
import { catcher } from "../trace/catcher";
import { DefaultLogger as Logger } from "koatty_logger";
import { Span } from '@opentelemetry/api';
import { SemanticAttributes } from "@opentelemetry/semantic-conventions";
import { extensionOptions } from "../trace/itrace";
import { collectRequestMetrics } from '../opentelemetry/prometheus';
import { TimeoutController } from "../utils/timeout";
import { Exception } from "koatty_exception";


export interface Handler {
  handle(ctx: KoattyContext, next: KoattyNext, ext: extensionOptions): Promise<any>;
}

export abstract class BaseHandler implements Handler {
  abstract handle(ctx: KoattyContext, next: KoattyNext, ext: extensionOptions): Promise<any>;

  protected commonPreHandle(ctx: KoattyContext, ext: extensionOptions) {
    // Encoding
    ctx.encoding = ext?.encoding;
    this.setSecurityHeaders(ctx);
    this.startTraceSpan(ctx, ext);
  }

  protected commonPostHandle(ctx: KoattyContext, ext: extensionOptions, msg?: RequestLogData | string) {
    this.logRequest(ctx, ext, msg);
    this.endTraceSpan(ctx, ext, msg);
    this.collectMetrics(ctx, ext);
  }

  protected handleError(err: Error, ctx: KoattyContext, ext: extensionOptions) {
    return catcher(ctx, err, ext);
  }

  /**
   * 通用超时处理包装器
   * @param ctx - Koatty context
   * @param next - Next middleware
   * @param ext - Extension options
   * @param timeout - Timeout in milliseconds
   */
  protected async handleWithTimeout(
    ctx: KoattyContext,
    next: Function,
    ext: extensionOptions,
    timeout: number
  ): Promise<void> {
    if (ext.terminated) {
      return;
    }

    const timeoutCtrl = new TimeoutController();
    try {
      await Promise.race([next(), timeoutCtrl.createTimeout(timeout)]);
    } finally {
      timeoutCtrl.clear();
    }
  }

  /**
   * 检查并设置响应状态
   * - 将404转为200(如果有body)
   * - 状态>=400时抛出异常
   */
  protected checkAndSetStatus(ctx: KoattyContext): void {
    if (ctx.body !== undefined && ctx.status === 404) {
      ctx.status = 200;
    }
    if (ctx.status >= 400) {
      throw new Exception(ctx.message, 1, ctx.status);
    }
  }

  private setSecurityHeaders(ctx: KoattyContext) {
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('X-Frame-Options', 'DENY');
    ctx.set('X-XSS-Protection', '1; mode=block');
  }

  private startTraceSpan(ctx: KoattyContext, ext: extensionOptions) {
    if (ext.spanManager) {
      // ✅ 传递 ctx 参数
      ext.spanManager.setSpanAttributes(ctx, {
        [SemanticAttributes.HTTP_URL]: ctx.originalUrl,
        [SemanticAttributes.HTTP_METHOD]: ctx.method
      });
    }
  }

  private endTraceSpan(ctx: KoattyContext, ext: extensionOptions, msg?: RequestLogData | string) {
    if (ext.spanManager) {
      // ✅ 传递 ctx 参数
      ext.spanManager.setSpanAttributes(ctx, {
        [SemanticAttributes.HTTP_STATUS_CODE]: ctx.status,
        [SemanticAttributes.HTTP_METHOD]: ctx.method,
        [SemanticAttributes.HTTP_URL]: ctx.url
      });
      // span event attributes must be scalar values
      ext.spanManager.addSpanEvent(ctx, "request", {
        "message": typeof msg === 'string' ? msg : JSON.stringify(msg ?? {})
      });
      ext.spanManager.endSpan(ctx);
    }
  }

  /**
   * Collect metrics for the request
   * @param ctx - Koatty context object
   * @param ext - Extension options
   */
  private collectMetrics(ctx: KoattyContext, ext?: extensionOptions) {
    if (ctx.startTime) {
      const duration = Date.now() - ctx.startTime;
      collectRequestMetrics(ctx, duration);
    }
  }

  private logRequest(ctx: KoattyContext, ext: extensionOptions, msg?: RequestLogData | string) {
    // structured object goes to the logger as-is (winston serializes it);
    // hand-built JSON strings are forbidden (SEC-07: log injection via
    // template interpolation of untrusted values such as X-Request-Id)
    Logger[(ctx.status >= 400 ? 'Error' : 'Info')](msg ?? {});
  }
}

/**
 * Structured access-log entry (SEC-07 / B-7).
 */
export interface RequestLogData {
  action: string;
  status: number | string;
  startTime: number;
  duration: number;
  requestId: string;
  endTime: number;
  path: string;
}

/**
 * Build the structured access-log entry for a request. All fields are
 * written as data (serialized by the logger), never interpolated into a
 * hand-built JSON string.
 */
export function buildRequestLogData(ctx: KoattyContext, status?: number | string): RequestLogData {
  const now = Date.now();
  return {
    action: ctx.method,
    status: status ?? ctx.status,
    startTime: ctx.startTime,
    duration: (now - ctx.startTime) || 0,
    requestId: ctx.requestId,
    endTime: now,
    path: ctx.originalPath || '/',
  };
}

/**
 * 处理器类型枚举
 */
export enum ProtocolType {
  HTTP = 'http',
  GRPC = 'grpc',
  WS = 'ws',
  GRAPHQL = 'graphql'
}
