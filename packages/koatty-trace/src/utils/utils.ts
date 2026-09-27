/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2020-11-20 17:37:32
 * @LastEditors: Please set LastEditors
 * @LastEditTime: 2023-11-10 22:18:40
 * @License: BSD (3-Clause)
 * @Copyright (c) - <richenlin(at)gmail.com>
 */

import { KoattyContext } from "koatty_core";
import { Helper } from "koatty_lib";
import { randomUUID } from 'node:crypto';
import { TraceOptions } from "../trace/itrace";

/**
 * Externally supplied request IDs must match this pattern (SEC-07 / B-7).
 * Anything longer, or containing characters outside the safe set, is
 * discarded and replaced with a generated ID — the raw value never enters
 * the logs.
 */
export const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Topology service names share the same restricted character set (SEC-15).
 */
export const SERVICE_NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Accept a client-supplied identifier only if it is a single string matching
 * the safe pattern; array headers use the first entry.
 */
export function acceptExternalId(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && REQUEST_ID_RE.test(raw) ? raw : undefined;
}

/**
 * Get request id from context based on protocol and options.
 * For grpc protocol, get from metadata or request body.
 * For other protocols, get from headers (and, only when explicitly enabled
 * via `requestIdFromQuery: true`, from query parameters — disabled by
 * default since URLs end up in access logs and referrer headers).
 * Invalid external IDs are discarded and a fresh trace id is generated
 * (SEC-07): the rejected value is never logged.
 *
 * @param {KoattyContext} ctx - Koatty context object
 * @param {TraceOptions} options - Trace configuration options
 * @returns {string} Request ID or generated trace ID
 */
export function getRequestId(ctx: KoattyContext, options: TraceOptions): string {
  let requestId = '';
  switch (ctx.protocol) {
    case "grpc":
      const request: any = ctx?.getMetaData("_body")[0] || {};
      requestId = acceptExternalId(ctx?.getMetaData(<string>options.requestIdName)) ||
        acceptExternalId(request[<string>options.requestIdName]) || '';
      break;
    default:
      if (options.requestIdHeaderName) {
        const headerValue = ctx.headers?.[options.requestIdHeaderName.toLowerCase()];
        requestId = acceptExternalId(headerValue) || '';
        // legacy fallback, opt-in only (requestIdFromQuery defaults to false)
        if (!requestId && options.requestIdFromQuery === true) {
          requestId = acceptExternalId(ctx.query?.[options.requestIdName]) || '';
        }
      }
  }
  return requestId || getTraceId(options);
}

/**
 * Generate a trace ID using the provided factory function or UUID
 * @param {TraceOptions} [options] - Optional configuration options
 * @returns {string} The generated trace ID
 */
export function getTraceId(options?: TraceOptions) {
  return Helper.isFunction(options?.idFactory) ? options.idFactory() : randomUUID();
}

// Export TimeoutController
export { TimeoutController } from './timeout';
