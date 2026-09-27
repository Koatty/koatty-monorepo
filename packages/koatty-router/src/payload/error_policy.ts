/**
 * @Description: Shared fail-closed error policy for payload parsers (SEC-02 / B-2)
 * @License: BSD (3-Clause)
 */
import { DefaultLogger as Logger } from "koatty_logger";
import { KoattyContext } from "koatty_core";
import { Exception } from "koatty_exception";
import { PayloadOptions } from "./interface";

/**
 * Resolve the on-parse-error policy for a payload parser:
 * explicit option wins, then the application security profile
 * (`app.security.payload.onParseError`), defaulting to fail-closed ('reject').
 */
export function resolveOnParseError(ctx?: KoattyContext, opts?: PayloadOptions): 'reject' | 'empty' {
  if (opts?.onParseError === 'empty' || opts?.onParseError === 'reject') {
    return opts.onParseError;
  }
  try {
    const policy = (ctx?.app as any)?.security?.payload?.onParseError;
    if (policy === 'empty' || policy === 'reject') return policy;
  } catch {
    // application not reachable; stay fail-closed
  }
  return 'reject';
}

/**
 * Build the Exception for a payload parse failure. Messages never include
 * request body fragments (no reflection into logs or responses).
 *
 * @param kind what failed, used for the generic message
 * @param status HTTP status: 400 malformed body, 413 body too large,
 *               415 unsupported content-encoding
 */
export function payloadParseError(kind: string, status: number, cause?: unknown): Exception {
  const exc = new Exception(`Invalid request payload: ${kind}`, 1, status);
  if (cause instanceof Error) {
    // keep the original stack for diagnostics without leaking it to clients
    exc.setStack(cause.stack);
  }
  return exc;
}

/**
 * Map a raw-body error to an HTTP status:
 * - entity.too.large -> 413
 * - encoding/charset unsupported -> 415
 * - everything else (malformed/aborted stream) -> 400
 */
export function rawBodyErrorStatus(err: any): number {
  if (err?.type === 'entity.too.large') return 413;
  if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') return 415;
  if (err?.status === 415 || /unsupported content-encoding/i.test(String(err?.message ?? ''))) return 415;
  return 400;
}

/**
 * Map a formidable (multipart) error to an HTTP status.
 * Formidable assigns httpCode 413 to size/count limit errors; anything else
 * is treated as a malformed body (400).
 */
const FORMIDABLE_LIMIT_CODES = new Set([1006, 1007, 1009, 1015, 1016]);

export function multipartErrorStatus(err: any): number {
  if (err?.httpCode === 413 || FORMIDABLE_LIMIT_CODES.has(err?.code)) {
    return 413;
  }
  return 400;
}

/**
 * Common legacy fallback for parsers: log and return an empty object.
 */
export function emptyFallback(kind: string, error: unknown): Record<string, any> {
  Logger.Warn(`Payload parse failed (${kind}), fallback to empty object:`, error);
  return {};
}
