/*
 * @Description: Payload parsing utilities with performance optimizations
 * @Usage: Parse request body based on content-type with caching
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2025-01-20 10:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { DefaultLogger as Logger } from "koatty_logger";
import { KoattyContext } from "koatty_core";
import { PayloadOptions } from "../interface";
import { parseText } from "./text";


/**
 * Parse WebSocket message data from context
 * @param ctx KoattyContext instance
 * @param opts PayloadOptions for parsing configuration
 * @returns {Promise<object|string>} Parsed message data as object for JSON or string for plain text
 * @description Attempts to parse WebSocket message as JSON first, falls back to raw text if JSON parsing fails
 * @throws {Error} Logs error if parsing fails and returns empty object
 */
export async function parseWebSocket(ctx: KoattyContext, opts: PayloadOptions) {
  try {
    const str = await parseText(ctx, opts);
    if (!str) return {};

    // WebSocket messages may be JSON or plain text
    try {
      const parsed = JSON.parse(str);
      return (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
        ? parsed
        : { value: parsed };
    } catch {
      return { value: str };  // Plain text fallback
    }
  } catch (error) {
    Logger.Error('[WebSocketParseError]', error);

    return {};
  }
}
