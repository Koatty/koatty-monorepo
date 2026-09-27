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
import { parse } from "fast-querystring";

/**
 * Parse form-urlencoded request body.
 *
 * Fail-closed (SEC-02 / ADR-101): parse failures throw an Exception with
 * HTTP status 400. The legacy fallback remains available via
 * `onParseError: 'empty'`.
 *
 * @param {KoattyContext} ctx - The Koatty context object
 * @param {PayloadOptions} opts - The payload parsing options
 * @returns {Promise<Record<string, any>>} Parsed form data object
 * @private
 */
export async function parseForm(ctx: KoattyContext, opts: PayloadOptions) {
  const str = await parseText(ctx, opts);
  if (!str || str.trim().length === 0) {
    return {};
  }

  try {
    const result = parse(str);
    return result;  // Already a flat object
  } catch (error) {
    if (resolveOnParseError(ctx, opts) === 'empty') {
      return emptyFallback('malformed form body', error);
    }
    throw payloadParseError('malformed form body', 400, error);
  }
}
