/*
 * @Description: Accept-aware error output for HTTP routes (ARCH-06 / D-6).
 * @License: BSD (3-Clause)
 */

import { KoattyContext } from "koatty_core";
import { Middleware } from "koa-compose";

/**
 * Media ranges understood as "the client asked for JSON".
 *
 * The wildcard media range (a lone asterisk) is deliberately **not** included:
 * it is the default of curl, of many test clients and of browsers navigating to
 * an API, and the framework keeps its existing `text/plain` error output for
 * those callers.
 */
const JSON_MEDIA_TYPE = /^application\/(?:json|[a-z0-9.+-]+\+json)$/i;

/**
 * Whether the request explicitly prefers JSON over plain text.
 */
export function prefersJson(ctx: KoattyContext): boolean {
  const accept = String(
    (ctx as any)?.request?.header?.accept
    ?? (ctx as any)?.request?.headers?.accept
    ?? (ctx as any)?.headers?.accept
    ?? "",
  );
  if (!accept) return false;

  const ranges = accept.split(',').map((part, index) => {
    const [media, ...params] = part.trim().split(';');
    const q = params.find(p => p.trim().toLowerCase().startsWith('q='));
    const weight = q ? Number(q.trim().slice(2)) : 1;
    return { media: media.trim().toLowerCase(), weight: Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0, index };
  });
  const candidates = ranges.filter(r => JSON_MEDIA_TYPE.test(r.media) || r.media === 'text/plain');
  const types = candidates.filter(r => r.weight > 0).sort((a,b) => b.weight - a.weight || a.index - b.index);
  if (!types.length || !JSON_MEDIA_TYPE.test(types[0].media)) return false;
  // Koa handles wildcard specificity and q=0 exclusions when available.
  if (typeof (ctx as any).accepts === 'function') return (ctx as any).accepts('text/plain', types[0].media) === types[0].media;
  return true;
}

/**
 * The status/content-type/body an error should produce for this client.
 *
 * 5xx messages are never leaked (they become `Internal Server Error`), matching
 * Koa's `err.expose` contract.
 */
export function negotiateError(
  ctx: KoattyContext,
  err: any,
): { status: number; contentType: string; body: string } {
  const rawStatus = err?.status ?? err?.statusCode;
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : 500;
  const exposed = status < 500 || err?.expose === true;
  const message = exposed
    ? String(err?.message ?? err ?? "Error")
    : "Internal Server Error";

  if (prefersJson(ctx)) {
    return {
      status,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        error: {
          status,
          code: err?.code ?? status,
          message,
        },
      }),
    };
  }

  return { status, contentType: "text/plain; charset=utf-8", body: message };
}

/**
 * HTTP error-negotiation middleware.
 *
 * Registered ahead of the router chain so that an error raised anywhere
 * downstream is written in the representation the client asked for:
 *
 * - client explicitly accepts JSON → `application/json` body
 *   (`{ error: { status, code, message } }`);
 * - anything else → the framework's existing `text/plain` behaviour is kept by
 *   re-throwing, so Koa's `ctx.onerror` produces the response as before.
 *
 * Non-HTTP protocols (gRPC, WebSocket) never set an explicit JSON `Accept` in a
 * way this middleware reacts to, so their error handling is unchanged.
 */
export function errorNegotiation(): Middleware<KoattyContext> {
  return async (ctx: KoattyContext, next: () => Promise<any>) => {
    try {
      await next();
    } catch (err) {
      // Only take over when the client explicitly asked for JSON, and only when
      // nothing has been written yet.
      if (!['http','https','http2'].includes((ctx as any).protocol ?? 'http') || !prefersJson(ctx) || (ctx as any).headerSent || (ctx as any).writable === false) {
        throw err;
      }
      const negotiated = negotiateError(ctx, err);
      const res = (ctx as any).res;
      // Keep the application-level error log/emit behaviour.
      (ctx as any).app?.emit?.("error", err, ctx);
      res.statusCode = negotiated.status;
      res.setHeader?.("Content-Type", negotiated.contentType);
      res.setHeader?.("Content-Length", Buffer.byteLength(negotiated.body));
      (ctx as any).respond = false;
      res.end(negotiated.body);
    }
  };
}
