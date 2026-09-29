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

test('P1-01 nonempty arguments without DTO fail explicitly', async () => {
  await expect(fixture().callTool('read', { ignored: 1 }, identity)).rejects.toMatchObject({ code: -32602 });
});
test('P2 throwing approval observer preserves one denied audit', async () => {
  const records: any[] = [];
  const host = fixture({ approval: { request: async () => ({ approved: false, reason: 'policy' }) }, onApproval: () => { throw new Error('observer'); }, audit: { record: (r: any) => records.push(r) } });
  await expect(host.callTool('write', {}, identity)).rejects.toMatchObject({ code: -32600 });
  expect(records).toHaveLength(1); expect(records[0].status).toBe('denied');
});
test('P2 missing bearer identity fails instead of sharing oauth-client', async () => {
  const { createBearerAuth } = await import('../../src/security');
  const auth = createBearerAuth({ audience: 'resource', verify: () => ({ aud: 'resource' }) });
  await expect(auth.authenticate({ headers: { authorization: 'Bearer fixture' } })).rejects.toThrow(/subject|client/);
});
test('P2 undecorated override is private in legacy and TC39 metadata discovery', () => {
  class Base { @Tool({ name: 'base' }) method() {} }
  class Derived extends Base { method() {} }
  const container = new Container(); container.reg('Derived', Derived, { type: 'SERVICE' } as any);
  expect(createMcpHost({ app: { container } }).registry.tools).toHaveLength(0);
});

test('P2 request-scoped progress reaches a stateless HTTP client', async () => {
  class ProgressTools { @Tool({ name: 'progress' }) async run(_args: any, ctx: any) { await ctx.progress(1, 2, 'working'); return 'ok'; } }
  const container = new Container(); container.reg('ProgressTools', ProgressTools, { type: 'SERVICE' } as any);
  const host = createMcpHost({ app: { container } }); const adapter = createMcpHttpAdapter({ host });
  const server = createServer(async (req, res) => { let raw = ''; for await (const c of req) raw += c; await adapter.middleware({ path: '/mcp', method: req.method, req, res, request: { headers: req.headers, body: raw ? JSON.parse(raw) : undefined } }, async () => {}); });
  const client = new Client({ name: 'progress-test', version: '1' });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as any).port}/mcp`)));
    const progress: any[] = [];
    await client.callTool({ name: 'progress' }, undefined, { onprogress: p => progress.push(p) });
    expect(progress).toEqual([expect.objectContaining({ progress: 1, total: 2 })]);
  } finally { await client.close(); await adapter.close(); await new Promise<void>(r => server.close(() => r())); }
});

test('P2 session capacity is bounded and idle expiry permits a new session', async () => {
  const host = fixture(); const adapter = createMcpHttpAdapter({ host, sessionful: true, maxSessions: 1, sessionTtlMs: 100, enableJsonResponse: true });
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const ctx: any = { path: '/mcp', method: req.method, req, res, request: { headers: req.headers, body: raw ? JSON.parse(raw) : undefined } };
    await adapter.middleware(ctx, async () => {});
    if (ctx.respond !== false) { res.statusCode = ctx.status; res.end(JSON.stringify(ctx.body)); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
  const init = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } }) });
  try { const first = await init(); expect(first.status).toBe(200); await first.text(); const second = await init(); expect(second.status).toBe(503); await second.text(); await new Promise(r => setTimeout(r, 220)); const third = await init(); expect(third.status).toBe(200); await third.text(); }
  finally { await adapter.close(); await new Promise<void>(r => server.close(() => r())); }
});

test('P2 outer guard rejection and pre-aborted calls each retain one terminal audit', async () => {
  const records: any[] = []; const audit = { record: (r: any) => records.push(r) };
  await expect(fixture({ audit, aroundTool: async () => { throw new Error('guard rejected'); } }).callTool('read', {}, identity)).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(fixture({ audit }).callTool('read', {}, identity, { signal: controller.signal })).rejects.toThrow();
  expect(records.map(r => r.status)).toEqual(['denied', 'cancelled']);
});
