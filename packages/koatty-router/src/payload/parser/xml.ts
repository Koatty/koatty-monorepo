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
import { XMLParser } from "fast-xml-parser";
import { parseText } from "./text";

interface XMLParserOptions {
  ignoreAttributes: boolean;
  isArray: (name: string) => boolean;
}


// 单例 XML 解析器，避免重复创建
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: () => false,
} as XMLParserOptions);

/**
 * Parse XML payload from request body
 *
 * Fail-closed (SEC-02 / ADR-101): parse failures throw an Exception with
 * HTTP status 400. The legacy fallback remains available via
 * `onParseError: 'empty'`.
 *
 * @param ctx KoattyContext instance
 * @param opts Payload parsing options
 * @returns {Promise<Record<string, any>>} Parsed XML object
 */
export async function parseXml(ctx: KoattyContext, opts: PayloadOptions) {
  const str = await parseText(ctx, opts);
  if (!str) return {};

  try {
    const parsed = xmlParser.parse(str);
    return (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed
      : { value: parsed };
  } catch (error) {
    if (resolveOnParseError(ctx, opts) === 'empty') {
      return emptyFallback('malformed XML body', error);
    }
    throw payloadParseError('malformed XML body', 400, error);
  }
}

