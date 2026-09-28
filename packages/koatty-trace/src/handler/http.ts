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
import { BaseHandler, Handler, buildRequestLogData } from "./base";
import { extensionOptions } from "../trace/itrace";
import { respond } from "./respond";

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
      // COR-15: the span is ended and metrics are collected exactly once, in
      // `trace.ts#handleRequest`'s finally; here we only write the access log
      // (errors are already logged by Exception.handler).
      if (!error || ctx.status < 400) {
        this.commonPostHandle(ctx, ext, buildRequestLogData(ctx));
      }
    }
  }
}
