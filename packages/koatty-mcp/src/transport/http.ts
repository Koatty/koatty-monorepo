/** Streamable HTTP mounted on the existing Koa service. One SDK Server per connection. */
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { MCP_DEFAULT_HOST, MCP_DEFAULT_PATH } from '../constants';
import type { McpHost } from '../server';
import { checkOrigin, McpAuthError } from '../security';

export interface McpHttpOptions {
  host: McpHost;
  path?: string;
  allowedOrigins?: string[];
  sessionful?: boolean;
  enableJsonResponse?: boolean;
  /** Idle session lifetime, default 5 minutes. */
  sessionTtlMs?: number;
  /** Maximum active transports, default 1000. */
  maxSessions?: number;
}
interface SessionEntry { transport: StreamableHTTPServerTransport; server: Server; principalId: string | null; lastUsed: number }
export interface McpHttpAdapter {
  readonly path: string;
  readonly sessionful: boolean;
  middleware: (ctx: any, next: () => Promise<any>) => Promise<any>;
  close(): Promise<void>;
}

export function createMcpHttpAdapter(options: McpHttpOptions): McpHttpAdapter {
  const path = options.path ?? MCP_DEFAULT_PATH;
  const sessionful = options.sessionful === true;
  const sessions = new Map<string, SessionEntry>();
  const active = new Set<SessionEntry>();
  let closed = false;
  const ttl = options.sessionTtlMs ?? 300_000;
  const capacity = options.maxSessions ?? 1000;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 2_147_483_647 || !Number.isSafeInteger(capacity) || capacity <= 0) throw new Error('Invalid MCP session limits');
  const error = (ctx: any, status: number, message: string) => {
    ctx.status = status;
    ctx.body = { jsonrpc: '2.0', error: { code: -32000, message }, id: null };
  };
  const dispose = async (entry: SessionEntry) => {
    if (!active.delete(entry)) return;
    for (const [id, candidate] of sessions) if (candidate === entry) sessions.delete(id);
    await entry.server.close();
  };

  const sweep = setInterval(() => {
    for (const entry of active) if (Date.now() - entry.lastUsed >= ttl) void dispose(entry).catch(() => {});
  }, Math.min(ttl, 30_000));
  sweep.unref();
  return {
    path, sessionful,
    async middleware(ctx, next) {
      if ((ctx.path ?? ctx.request?.path ?? '').split('?')[0] !== path) return await next();
      if (closed) return error(ctx, 503, 'MCP server is stopping.');
      if (!checkOrigin(ctx.get?.('origin') ?? ctx.request?.headers?.origin, options.allowedOrigins ?? options.host.allowedOrigins)) {
        return error(ctx, 403, 'Origin not allowed.');
      }
      const method = (ctx.method ?? ctx.request?.method ?? '').toUpperCase();
      if ((!sessionful && method !== 'POST') || !['POST', 'GET', 'DELETE'].includes(method)) return error(ctx, 405, 'Method not allowed.');
      const headers = ctx.request?.headers ?? ctx.req?.headers ?? {};
      let principal;
      try { principal = await options.host.resolveIdentity({ headers, transport: 'http' }); }
      catch (cause) {
        const status = cause instanceof McpAuthError ? cause.status : 403;
        if (status === 401) ctx.set?.('WWW-Authenticate', 'Bearer');
        return error(ctx, status, status === 401 ? 'Authentication required.' : 'Access denied.');
      }
      const sessionId = ctx.get?.('mcp-session-id') ?? headers['mcp-session-id'];
      let entry = sessionId ? sessions.get(sessionId) : undefined;
      if (sessionful && sessionId && !entry) return error(ctx, 404, 'Unknown MCP session.');
      if (sessionful && !entry && method !== 'POST') return error(ctx, 400, 'Missing MCP session id.');
      if (entry && entry.principalId !== (principal?.id ?? null)) return error(ctx, 403, 'Session belongs to another caller.');
      if (entry && Date.now() - entry.lastUsed >= ttl) { await dispose(entry); return error(ctx, 404, 'Expired MCP session.'); }
      if (!entry) {
        if (active.size >= capacity) return error(ctx, 503, 'MCP session capacity reached.');
        const server = options.host.createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: sessionful ? () => randomUUID() : undefined,
          enableJsonResponse: options.enableJsonResponse === true,
          onsessioninitialized: id => { sessions.set(id, entry!); },
          onsessionclosed: id => { sessions.delete(id); void dispose(entry!).catch(() => {}); },
        });
        entry = { server, transport, principalId: principal?.id ?? null, lastUsed: Date.now() };
        active.add(entry);
        try { await server.connect(transport); } catch (cause) { await dispose(entry); throw cause; }
      }
      entry.lastUsed = Date.now();
      const connection = entry;
      const abort = new AbortController();
      const disconnected = () => { if (!ctx.res.writableFinished) abort.abort(); };
      ctx.res.once('close', disconnected);
      ctx.req.once('aborted', disconnected);
      ctx.respond = false;
      // handleRequest can return before the tool response finishes. Cleanup
      // follows response lifetime, not just the SDK dispatch Promise.
      const finished = () => {
        disconnected();
        ctx.res.removeListener('close', finished);
        ctx.res.removeListener('finish', finished);
        ctx.res.removeListener('close', disconnected);
        ctx.req.removeListener('aborted', disconnected);
        if (!sessionful || !connection.transport.sessionId) void dispose(connection).catch(() => {});
      };
      ctx.res.once('finish', finished); ctx.res.once('close', finished);
      try {
        await options.host.runWithIdentity({ headers, principal, transport: 'http', sessionId, signal: abort.signal },
          () => connection.transport.handleRequest(ctx.req, ctx.res, ctx.request?.body));
      } catch (cause) { finished(); await dispose(connection); throw cause; }
    },
    async close() {
      closed = true;
      clearInterval(sweep);
      await Promise.allSettled([...active].map(dispose));
      sessions.clear();
    },
  };
}
export const DEFAULT_MCP_HOST = MCP_DEFAULT_HOST;
