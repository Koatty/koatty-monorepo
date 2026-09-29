/**
 * stdio transport for local MCP clients (Cursor / Claude Code / MCP Inspector).
 *
 * The stdio entry MUST run through the same authentication and scope checks as
 * HTTP: it wraps every call in `runWithIdentity({ headers: {} })`, which resolves
 * to the configured `stdioIdentity` (anonymous by default → scoped tools denied).
 *
 * @License BSD-3-Clause
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpHost } from '../server';
import type { McpPrincipal } from '../types';

export interface StdioOptions {
  /** Identity granted to the local stdio client (scopes apply as-is). */
  identity?: McpPrincipal;
  /** Replace the transport (tests inject an in-memory pair). */
  transport?: any;
}

/**
 * Connect the host to stdio. Progress notifications and cancellation are
 * handled by the SDK; the request scope / Core ALS boundary is entered by the
 * host dispatch pipeline.
 */
export async function startStdioServer(host: McpHost, options: StdioOptions = {}): Promise<any> {
  const transport = options.transport ?? new StdioServerTransport();
  const originalCallTool = host.callTool;
  // Bind the stdio identity for the whole connection: every handler call runs
  // inside this AsyncLocalStorage context, so scope checks are unchanged.
  await host.runWithIdentity({ headers: {} }, async () => {
    await host.server.connect(transport);
  });
  void originalCallTool;
  return transport;
}

/** Create (do not connect) an in-memory linked pair for tests. */
export async function createInMemoryPair(): Promise<[any, any]> {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  return InMemoryTransport.createLinkedPair() as [any, any];
}
