/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2025-03-15 22:21:29
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import { Koatty, KoattyContext, KoattyNext } from "koatty_core";
import compose, { Middleware } from "koa-compose";
import { Helper } from "koatty_lib";
import { ParamMetadata } from "./inject";
import { extractParameters } from "./strategy-extractor";
import { DefaultLogger as Logger } from "koatty_logger";

/**
 * Performance monitoring removed in v2.0.0
 * 
 * Reason: Built-in performance statistics had concurrency issues and added complexity.
 * Recommendation: Use external monitoring tools (Prometheus, StatsD, OpenTelemetry, etc.)
 * for production-grade metrics with proper concurrency handling.
 */

/**
 * Execute controller method with circuit breaker and parameter injection.
 *
 * @param {Koatty} app - The Koatty application instance
 * @param {KoattyContext} ctx - The Koatty context object
 * @param {any} ctl - The controller instance
 * @param {string} method - The method name to execute
 * @param {ParamMetadata[]} [ctlParams] - Parameter metadata for injection
 * @param {any} [ctlParamsValue] - Parameter values for injection (deprecated, kept for compatibility)
 * @param {Function} [composedMiddleware] - Pre-composed middleware function
 * @returns {Promise<any>} The execution result
 * @throws {Error} When controller not found or execution fails
 */
export async function Handler(app: Koatty, ctx: KoattyContext, ctl: any,
  method: string, ctlParams?: ParamMetadata[], ctlParamsValue?: any, composedMiddleware?: Function) {

  if (!ctx || !ctl) {
    return ctx.throw(404, `Controller not found.`);
  }
  ctl.ctx ??= ctx;

  // 创建中间件链
  const middlewareFns: Middleware<KoattyContext>[] = [];

  // 如果有预组合的中间件，直接使用
  if (composedMiddleware && typeof composedMiddleware === 'function') {
    Logger.Debug(`Handler: Using pre-composed middleware`);
    middlewareFns.push(composedMiddleware as Middleware<KoattyContext>);
  } else {
    Logger.Debug('Handler: No middleware to execute');
  }

  // 添加Handler作为最后一个中间件
  middlewareFns.push(async (ctx: KoattyContext, next: KoattyNext) => {
    // 使用优化的策略提取器
    const args = ctlParams ? await extractParameters(app, ctx, ctlParams) : [];
    // 执行方法
    const res = await ctl[method](...args);
    if (Helper.isError(res)) {
      throw res;
    }
    ctx.body = ctx.body || res;
    await next();
  });

  // 执行中间件链
  if (middlewareFns.length > 0) {
    await compose(middlewareFns)(ctx, async () => {});
  }

  return ctx.body;
}
