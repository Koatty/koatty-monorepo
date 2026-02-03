/**
 * 
 * @Description: 
 * @Author: richen
 * @Date: 2025-04-04 12:21:48
 * @LastEditTime: 2025-04-04 20:00:41
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { KoattyContext } from "koatty_core";
import { Exception } from "koatty_exception";
import { DefaultLogger as Logger } from "koatty_logger";
import { BaseHandler, Handler } from "./base";
import { extensionOptions } from "../trace/itrace";
import { respond } from "./respond";
import { collectRequestMetrics } from "../opentelemetry/prometheus";
import { SemanticAttributes } from "@opentelemetry/semantic-conventions";

/**
 * HTTP request handler middleware for Koatty framework.
 * Handles request timeout, security headers, logging, tracing and error handling.
 * 
 * @param {KoattyContext} ctx - Koatty context object
 * @param {Function} next - Next middleware function
 * @param {extensionOptions} [ext] - Extension options including timeout, encoding, span and other settings
 * @returns {Promise<any>} Response data after handling the request
 * 
 * @throws {Exception} When request timeout occurs or status code >= 400
 * 
 * Features:
 * - Sets security headers
 * - Handles request timeout (default 10s)
 * - Logs request/response details
 * - OpenTelemetry tracing support
 * - Automatic error handling
 */
export class HttpHandler extends BaseHandler implements Handler {
  private static instance: HttpHandler;

  private constructor() {
    super();
  }

  public static getInstance(): HttpHandler {
    if (!HttpHandler.instance) {
      HttpHandler.instance = new HttpHandler();
    }
    return HttpHandler.instance;
  }

  async handle(ctx: KoattyContext, next: Function, ext?: extensionOptions): Promise<any> {
    const timeout = ext.timeout || 10000;
    let error: any = null;

    this.commonPreHandle(ctx, ext);

    try {
      // 使用基类的通用超时处理方法
      await this.handleWithTimeout(ctx, next, ext, timeout);

      // 使用基类的通用状态检查方法
      this.checkAndSetStatus(ctx);
      
      return respond(ctx, ext);
    } catch (err: any) {
      error = err;
      return this.handleError(err, ctx, ext);
    } finally {
      // 统一在 finally 块中记录日志和结束追踪
      // 只记录成功请求或非4xx/5xx的日志（错误日志已由Exception.handler记录）
      if (!error || ctx.status < 400) {
        const now = Date.now();
        const msg = `{"action":"${ctx.method}","status":"${ctx.status}","startTime":"${ctx.startTime}","duration":"${(now - ctx.startTime) || 0}","requestId":"${ctx.requestId}","endTime":"${now}","path":"${ctx.originalPath || '/'}"}`;
        this.commonPostHandle(ctx, ext, msg);
      } else {
        // 错误情况只处理追踪和指标，日志已经记录过了
        this.endTraceSpanOnly(ctx, ext);
        this.collectMetricsOnly(ctx, ext);
      }
    }
  }

  /**
   * 只结束追踪span，不记录日志
   */
  private endTraceSpanOnly(ctx: KoattyContext, ext: extensionOptions) {
    if (ext.spanManager) {
      const now = Date.now();
      const msg = `{"action":"${ctx.method}","status":"${ctx.status}","startTime":"${ctx.startTime}","duration":"${(now - ctx.startTime) || 0}","requestId":"${ctx.requestId}","endTime":"${now}","path":"${ctx.originalPath || '/'}"}`;
      
      // 设置span属性
      ext.spanManager.setSpanAttributes(ctx, {
        [SemanticAttributes.HTTP_STATUS_CODE]: ctx.status,
        [SemanticAttributes.HTTP_METHOD]: ctx.method,
        [SemanticAttributes.HTTP_URL]: ctx.url
      });
      ext.spanManager.addSpanEvent(ctx, "request", { "message": msg });
      ext.spanManager.endSpan(ctx);
    }
  }

  /**
   * 只收集指标，不记录日志
   */
  private collectMetricsOnly(ctx: KoattyContext, ext: extensionOptions) {
    if (ctx.startTime) {
      const duration = Date.now() - ctx.startTime;
      collectRequestMetrics(ctx, duration);
    }
  }
}
