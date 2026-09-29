import 'reflect-metadata';
import { createServer, Server as HttpServer } from 'http';
import { AsyncLocalStorage } from 'async_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Container } from 'koatty_container';
import { Tool } from '../../src/decorators';
import { createMcpHost } from '../../src/server';
import { createMcpHttpAdapter } from '../../src/transport/http';
import { createInMemoryPair, startStdioServer } from '../../src/transport/stdio';
import { createApiKeyAuth, checkOrigin } from '../../src/security';

class Tools {
  calls = 0;
  @Tool({ name: 'read' }) read() { return ++this.calls; }
  @Tool({ name: 'write', annotations: { destructiveHint: true } }) write() { return ++this.calls; }
  @Tool({ name: 'scoped', scopes: ['write'] }) scoped() { return ++this.calls; }
}
function fixture(overrides: any = {}) {
  const container = new Container(); container.reg('Tools', Tools, { type: 'SERVICE' } as any);
  const ctxStorage = new AsyncLocalStorage();
  const app = { container, ctxStorage, getCurrentContext: () => ctxStorage.getStore(), security: { name: 'strict' } };
  return createMcpHost({ app, ...overrides });
}
const identity: import('../../src/types').ToolCallIdentity = { principal: null, sessionId: 's', requestId: 'r', headers: {} };
test('F-A07: destructive tools inherit the application strict profile', async () => {
  await expect(fixture().callTool('write', {}, identity)).rejects.toThrow(/approval/i);
});
test('F-A08: configured auth requires a principal even for unscoped tools', async () => {
  const host = fixture({ security: { auth: createApiKeyAuth({ keys: ['fixture-key'] }) } });
  await expect(host.resolveIdentity({ headers: {} })).rejects.toThrow(/auth|credential/i);
});
test('F-A09: explicit origins compare scheme and port', () => {
  expect(checkOrigin('http://example.com:9999', ['https://example.com'])).toBe(false);
  expect(checkOrigin('https://example.com:443', ['https://example.com'])).toBe(true);
});
test('F-A10: already-cancelled calls cannot reach an approval backend or handler', async () => {
  const request = jest.fn(async () => ({ approved: true as const }));
  const host = fixture({ approval: { request } }); const abort = new AbortController(); abort.abort();
  await expect(host.callTool('write', {}, identity, { signal: abort.signal })).rejects.toBeDefined();
  expect(request).not.toHaveBeenCalled();
});
test('F-A10: cancellation during approval prevents a late approval from executing', async () => {
  let grant!: (value: any) => void; let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const host = fixture({ approval: { request: () => { entered(); return new Promise(r => { grant = r; }); } } });
  const abort = new AbortController(); const call = host.callTool('write', {}, identity, { signal: abort.signal });
  await started; abort.abort(); grant({ approved: true });
  await expect(call).rejects.toBeDefined();
  expect(await host.callTool('read', {}, identity)).toBe(1);
});
test('F-A22: stdio identity reaches the actual protocol handlers', async () => {
  const host = fixture(); const [a, b] = await createInMemoryPair();
  const client = new Client({ name: 'test', version: '1' });
  try {
    await startStdioServer(host, { transport: b, identity: { id: 'operator', scopes: ['write'] } });
    await client.connect(a);
    expect((await client.callTool({ name: 'scoped' })).isError).toBeFalsy();
  } finally { await client.close(); await host.server.close(); }
});

describe.each([false, true])('F-A01 real HTTP sessionful=%s', sessionful => {
  let server: HttpServer; let adapter: ReturnType<typeof createMcpHttpAdapter>; const clients: Client[] = [];
  afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.close())); await adapter?.close(); if (server) await new Promise<void>(r => server.close(() => r())); });
  test('initialize, list, repeated and concurrent calls work for two clients', async () => {
    const host = fixture({ security: { auth: createApiKeyAuth({ keys: ['fixture-key'] }), allowedOrigins: ['https://trusted.example'] } });
    adapter = createMcpHttpAdapter({ host, sessionful, enableJsonResponse: true });
    server = createServer(async (req, res) => {
      try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const ctx: any = { path: '/mcp', method: req.method, req, res, request: { headers: req.headers, body: raw ? JSON.parse(raw) : undefined }, get: (key: string) => req.headers[key] };
        await adapter.middleware(ctx, async () => {});
        if (ctx.respond !== false) { res.statusCode = ctx.status ?? 200; res.end(JSON.stringify(ctx.body)); }
      } catch { res.statusCode = 500; res.end(); }
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const url = new URL(`http://127.0.0.1:${(server.address() as any).port}/mcp`);
    for (let i = 0; i < 2; i++) {
      const client = new Client({ name: `test-${i}`, version: '1' }); clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { 'x-api-key': 'fixture-key', origin: 'https://trusted.example' } } }));
      expect((await client.listTools()).tools).toHaveLength(3);
    }
    const results = await Promise.all(clients.map(c => c.callTool({ name: 'read' })));
    expect(results.every(r => !r.isError)).toBe(true);
  });
});
