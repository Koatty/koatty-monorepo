/*
 * @Description: Payload parsing utilities with performance optimizations
 * @Usage: Parse request body based on content-type with caching
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2025-01-20 10:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { KoattyContext } from "koatty_core";
import { PayloadOptions } from "../interface";
import { emptyFallback, payloadParseError, rawBodyErrorStatus, resolveOnParseError } from "../error_policy";
import getRawBody from "raw-body";
import inflate from "inflation";

/**
 * Parse raw request body as text.
 *
 * Fail-closed (SEC-02 / ADR-101): stream-level failures (body too large,
 * unsupported content-encoding, aborted/malformed stream) throw an Exception
 * carrying the matching HTTP status instead of silently resolving to "".
 * The legacy fallback remains available via `onParseError: 'empty'`.
 *
 * @param {KoattyContext} ctx - Koatty context object
 * @param {PayloadOptions} opts - Payload parsing options
 * @returns {Promise<string>} Parsed text content
 */
export async function parseText(ctx: KoattyContext, opts: PayloadOptions): Promise<string> {
  try {
    return await getRawBody(inflate(ctx.req), opts);
  } catch (err) {
    if (resolveOnParseError(ctx, opts) === 'empty') {
      emptyFallback('raw body', err);
      return "";
    }
    throw payloadParseError('unreadable body', rawBodyErrorStatus(err), err);
  }
}
