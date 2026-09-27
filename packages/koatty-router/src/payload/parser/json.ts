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
import { emptyFallback, payloadParseError, resolveOnParseError } from "../error_policy";
import { parseText } from "./text";


/**
 * Parse request body as JSON
 *
 * Fail-closed (SEC-02 / ADR-101): malformed JSON throws an Exception with
 * HTTP status 400 instead of silently resolving to `{}`. The legacy fallback
 * remains available via `onParseError: 'empty'`.
 *
 * @param {KoattyContext} ctx - Koatty context object
 * @param {PayloadOptions} opts - Payload parsing options
 * @returns {Promise<Record<string, any>>} Parsed JSON object
 */
export async function parseJson(ctx: KoattyContext, opts: PayloadOptions) {
  const str = await parseText(ctx, opts);
  if (!str) return {};

  try {
    const parsed = JSON.parse(str);
    // Return flat object; wrap non-object values for consistency
    return (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed
      : { value: parsed };
  } catch (error) {
    if (resolveOnParseError(ctx, opts) === 'empty') {
      return emptyFallback('malformed JSON body', error);
    }
    // message must not contain request body fragments
    throw payloadParseError('malformed JSON body', 400, error);
  }
}
