/**
 * Per-call context and scope helpers for the Koatty MCP host
 * (roadmap Phase F, F-1 item 3: every tool call gets its own request scope and
 * the protocol data is attached to the EXISTING Koatty context / Core ALS).
 *
 * @License BSD-3-Clause
 */
import type { KoattyLike, McpPrincipal, ToolCallIdentity } from './types';

export interface CallContextExtras {
  toolName: string;
  signal?: AbortSignal;
  progress?: (current: number, total?: number, message?: string) => Promise<void> | void;
}

function toContextPrincipal(principal: McpPrincipal | null): Record<string, any> | null {
  if (!principal) return null;
  return { id: principal.id, scopes: [...principal.scopes], kind: principal.kind, claims: principal.claims };
}

/**
 * Build the context handed to the tool body.
 *
 * When the call arrives over HTTP the current Koatty context is extended in
 * place; a stdio call (no HTTP request) gets a standalone context object that
 * is still published through the Core AsyncLocalStorage boundary, so
 * `this.app.getCurrentContext()` works identically on both transports.
 */
export function createCallContext(
  app: KoattyLike,
  identity: ToolCallIdentity,
  extras: CallContextExtras,
): any {
  const current = app?.getCurrentContext?.();
  const ctx: any = current ?? { app };
  ctx.principal = toContextPrincipal(identity.principal);
  ctx.mcpSessionId = identity.sessionId;
  ctx.mcpRequestId = identity.requestId;
  ctx.mcpToolName = extras.toolName;
  ctx.signal = extras.signal;
  if (extras.progress) ctx.progress = extras.progress;
  return ctx;
}

/** Enter the Core AsyncLocalStorage boundary when the application exposes it. */
export async function runWithContext<T>(app: KoattyLike, ctx: any, fn: () => Promise<T>): Promise<T> {
  const storage = app?.ctxStorage;
  if (storage && typeof storage.run === 'function') return await storage.run(ctx, fn);
  return await fn();
}

/**
 * Run `fn` inside a container request scope (ARCH-02 / D-2) so scoped providers
 * are isolated per tool call, then always release the scope.
 */
export async function runInRequestScope<T>(container: any, ctx: object, fn: () => Promise<T>): Promise<T> {
  const prepared = container?.readyRequestScope?.(ctx);
  if (prepared && typeof prepared.then === 'function') await prepared;
  try {
    return container?.runInRequestScope ? await container.runInRequestScope(ctx, fn) : await fn();
  } finally {
    if (typeof container?.releaseRequestScope === 'function') {
      try {
        await container.releaseRequestScope(ctx);
      } catch {
        // scope cleanup must never mask the tool result
      }
    }
  }
}
