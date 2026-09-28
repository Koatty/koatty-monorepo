/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2025-03-15 22:21:29
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import { Koatty, KoattyContext } from "koatty_core";
import { Middleware } from "koa-compose";
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
 * A pre-built route invoker.
 *
 * PERF-01: the function returned by {@link createRouteHandler} is created once at
 * route-registration time. Everything that used to happen on every request
 * (allocating the middleware array, pushing closures and re-running `koa-compose`)
 * now happens once per route, so the request hot path is a couple of plain calls.
 */
export type RouteInvoker = (ctx: KoattyContext, ctl: any) => Promise<any>;

/**
 * Build the request handler for a controller method at registration time.
 *
 * Behavioural note (intentional, plan D-4): the handler assigns `ctx.body` only
 * when it is still `undefined`. The legacy implementation used
 * `ctx.body = ctx.body || res`, which silently discarded falsy controller results
 * (`0`, `''`, `false`). Falsy results are now preserved - see
 * docs/migration/phase-d-router-hotpath.md for the migration note.
 *
 * @param {Koatty} app - The Koatty application instance
 * @param {string} method - The method name to execute
 * @param {ParamMetadata[]} [ctlParams] - Parameter metadata for injection
 * @param {any} [ctlParamsValue] - Parameter values for injection (deprecated, kept for compatibility)
 * @param {Function} [composedMiddleware] - Pre-composed middleware function
 * @param {Function} [ctlClass] - The controller class (used for registration-time
 *   legacy call compatibility (unused))
 * @returns {RouteInvoker} handler ready to be mounted on the router
 */
export function createRouteHandler(app: Koatty, method: string,
  ctlParams?: ParamMetadata[], ctlParamsValue?: any,
  composedMiddleware?: Function, _ctlClass?: Function): RouteInvoker {

  // ------------------------------------------------------------------
  // registration-time work (once per route)
  // ------------------------------------------------------------------
  const usePredefinedParams = ctlParamsValue !== undefined && ctlParamsValue !== null;
  const hasMiddleware = !!composedMiddleware && typeof composedMiddleware === 'function';
  if (Logger.isDebugEnabled) Logger.Debug(`Handler: [${method}] predefinedParams=${usePredefinedParams} middleware=${hasMiddleware}`);

  const invokeRoute = async (ctx: KoattyContext, ctl: any): Promise<any> => {
    if (!ctx || !ctl) return ctx.throw(404, `Controller not found.`);
    ctl.ctx ??= ctx;
    const args: unknown[] | undefined = usePredefinedParams
      ? ctlParamsValue
      : (ctlParams ? await extractParameters(app, ctx, ctlParams) : undefined);
    const ready = (app.container as any)?.readyRequestScope?.(ctx);
    if (ready) await ready;
    const res = await (args ? ctl[method](...args) : ctl[method]());
    if (Helper.isError(res)) throw res;
    if ((ctx as any).respond === false && ['http', 'https', 'http2', 'http3'].includes(ctx.protocol)) return ctx.body;
    if (ctx.body === undefined) ctx.body = res;
    return ctx.body;
  };

  // ------------------------------------------------------------------
  // request-time work: no array allocation, no koa-compose() call.
  // `composedMiddleware` is already composed by the router, so passing the
  // controller execution as its `next` is equivalent to the old
  // compose([composedMiddleware, finalHandler]) chain.
  // ------------------------------------------------------------------
  if (hasMiddleware) {
    const mw = composedMiddleware as Middleware<KoattyContext>;
    return async (ctx: KoattyContext, ctl: any): Promise<any> => {
      if (!ctx || !ctl) {
        return ctx.throw(404, `Controller not found.`);
      }
      ctl.ctx ??= ctx;
      await mw(ctx, () => invokeRoute(ctx, ctl));
      return ctx.body;
    };
  }

  return invokeRoute;
}

/**
 * Execute controller method with parameter injection.
 *
 * Kept for backward compatibility: it builds a route handler for a single
 * invocation. New code (router registration) should call
 * {@link createRouteHandler} once and reuse the returned invoker.
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

  const invoke = createRouteHandler(app, method, ctlParams, ctlParamsValue, composedMiddleware);
  return invoke(ctx, ctl);
}
