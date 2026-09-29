/**
 * Streamable HTTP transport for the MCP host (roadmap Phase F, F-1 item 2).
 *
 * Reuses the existing Koa HTTP service: a middleware handles `POST` JSON-RPC
 * requests at the configured path (default `/mcp`) and returns an SSE stream
 * when the handler streams. No new Serve network-protocol enum is introduced.
 *
 * Protocol safety (F-1 item 5):
 * - `Origin` is validated against an allowlist (default: loopback) for
 *   DNS-rebinding protection;
 * - local deployments bind `127.0.0.1` unless a host is set explicitly.
 *
 * @License BSD-3-Clause
 */
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_DEFAULT_HOST, MCP_DEFAULT_PATH } from '../constants';
import type { McpHost } from '../server';
import { checkOrigin } from '../security';

export interface McpHttpOptions {
  host: McpHost;
  /** Mount path, default `/mcp`. */
  path?: string;
  allowedOrigins?: string[];
  /** Sessionful transport (GET SSE + DELETE) when true; stateless POST-only otherwise. */
  sessionful?: boolean;
  enableJsonResponse?: boolean;
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
}

export interface McpHttpAdapter {
  readonly path: string;
  readonly sessionful: boolean;
  /** Koa-compatible middleware; mount it on the HTTP service (`app.use(...)`). */
  middleware: (ctx: any, next: () => Promise<any>) => Promise<any>;
  /** Close every active session (shutdown / Terminus drain). */
  close(): Promise<void>;
}

function jsonRpcError(status: number, message: string): Record<string, any> {
  return { jsonrpc: '2.0' as const, error: { code: -32000, message }, id: null };
}

/**
 * Build the Streamable HTTP adapter for a host.
 *
 * The middleware authenticates via the bound headers (the host reads them from
 * the request-scoped AsyncLocalStorage), so `scopes` are enforced before any
 * business code runs, exactly like stdio.
 */
export function createMcpHttpAdapter(options: McpHttpOptions): McpHttpAdapter {
  const path = options.path ?? MCP_DEFAULT_PATH;
  const sessionful = options.sessionful === true;
  const sessions = new Map<string, SessionEntry>();

  const createTransport = (): StreamableHTTPServerTransport => {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: sessionful ? () => randomUUID() : undefined,
      enableJsonResponse: options.enableJsonResponse === true,
      onsessioninitialized: (id: string) => {
        if (sessionful) sessions.set(id, { transport });
      },
      onsessionclosed: (id: string) => {
        sessions.delete(id);
      },
    } as any);
    return transport;
  };

  const handle = async (ctx: any): Promise<boolean> => {
    const requestPath = (ctx.path ?? (ctx.request?.path ?? '')).split('?')[0];
    if (requestPath !== path) return false;

    const origin = ctx.get?.('origin') ?? ctx.request?.headers?.origin;
    if (!checkOrigin(origin, options.allowedOrigins)) {
      ctx.status = 403;
      ctx.body = jsonRpcError(403, 'Origin not allowed.');
      return true;
    }

    const method = (ctx.method ?? ctx.request?.method ?? '').toUpperCase();
    if (!sessionful) {
      if (method !== 'POST') {
        ctx.status = 405;
        ctx.body = jsonRpcError(405, 'Method not allowed (stateless mode accepts POST only).');
        return true;
      }
      const transport = createTransport();
      ctx.respond = false;
      await options.host.runWithIdentity(
        { headers: ctx.request?.headers ?? ctx.req?.headers ?? {} },
        async () => {
          await options.host.server.connect(transport);
          await transport.handleRequest(ctx.req, ctx.res, ctx.request?.body);
        },
      );
      return true;
    }

    const sessionId = ctx.get?.('mcp-session-id') ?? ctx.request?.headers?.['mcp-session-id'];
    if (sessionId && sessions.has(sessionId)) {
      ctx.respond = false;
      const entry = sessions.get(sessionId)!;
      await options.host.runWithIdentity(
        { headers: ctx.request?.headers ?? ctx.req?.headers ?? {}, sessionId },
        async () => {
          await entry.transport.handleRequest(ctx.req, ctx.res, ctx.request?.body);
        },
      );
      return true;
    }
    if (sessionId && !sessions.has(sessionId)) {
      ctx.status = 404;
      ctx.body = jsonRpcError(404, 'Unknown MCP session.');
      return true;
    }
    if (method !== 'POST') {
      ctx.status = 400;
      ctx.body = jsonRpcError(400, 'Missing MCP session id.');
      return true;
    }

    const transport = createTransport();
    ctx.respond = false;
    await options.host.runWithIdentity(
      { headers: ctx.request?.headers ?? ctx.req?.headers ?? {} },
      async () => {
        await options.host.server.connect(transport);
        await transport.handleRequest(ctx.req, ctx.res, ctx.request?.body);
      },
    );
    return true;
  };

  const middleware = async (ctx: any, next: () => Promise<any>) => {
    const handled = await handle(ctx);
    if (!handled) return await next();
    return undefined;
  };

  return {
    path,
    sessionful,
    middleware,
    close: async () => {
      for (const entry of sessions.values()) {
        try {
          await entry.transport.close();
        } catch {
          // ignore close failures during shutdown
        }
      }
      sessions.clear();
    },
  };
}

/** Loopback is the default bind host for local MCP usage. */
export const DEFAULT_MCP_HOST = MCP_DEFAULT_HOST;
