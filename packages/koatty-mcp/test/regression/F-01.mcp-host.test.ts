/**
 * F-01: koatty_mcp host.
 *
 * Covers the Phase F acceptance gates that belong to F-1:
 * - tool/resource/prompt discovery from component metadata;
 * - DTO -> JSON Schema input schemas;
 * - extra fields stripped, illegal parameters -> JSON-RPC error instead of an
 *   unhandled exception;
 * - callers without the required scope are rejected before business code runs;
 * - high-risk tools without approval are never executed (fail closed);
 * - per-call container request scope (enter/release) and redacted auditing;
 * - Origin validation (DNS-rebinding protection) on the HTTP transport.
 */
import 'reflect-metadata';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { IOCContainer } from 'koatty_container';
import { Service } from 'koatty_core';
import { Validated } from 'koatty_validation';
import { Prompt, Resource, Tool } from '../../src/decorators';
import { createMcpHost } from '../../src/server';
import { dtoToJsonSchema } from '../../src/schema';
import { checkOrigin, createApiKeyAuth } from '../../src/security';
import { createInMemoryPair } from '../../src/transport/stdio';
import { createMcpHttpAdapter } from '../../src/transport/http';

class QueryOrderDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;
}

class RefundDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

const CALLS: string[] = [];
const RECEIVED: any[] = [];

@Service()
class OrderTools {
  @Tool({ name: 'order_query', description: 'Query an order', annotations: { readOnlyHint: true } })
  @Validated({ async: false, types: [QueryOrderDto] })
  async query(input: QueryOrderDto) {
    CALLS.push('query');
    RECEIVED.push(input);
    return { orderNo: input.orderNo, page: input.page ?? null, status: 'paid' };
  }

  @Tool({
    name: 'order_refund',
    description: 'Refund an order',
    annotations: { destructiveHint: true },
    scopes: ['order:refund'],
  })
  @Validated({ async: false, types: [RefundDto] })
  async refund(input: RefundDto) {
    CALLS.push('refund');
    return { refunded: true, orderNo: input.orderNo };
  }

  @Tool({ name: 'order_cancel', annotations: { destructiveHint: true }, requireApproval: true })
  @Validated({ async: false, types: [RefundDto] })
  async cancel(input: RefundDto) {
    CALLS.push('cancel');
    return { cancelled: true, orderNo: input.orderNo };
  }

  /** Destructive without an explicit `requireApproval`: strict profile decides. */
  @Tool({ name: 'order_destroy', annotations: { destructiveHint: true } })
  async destroy() {
    CALLS.push('destroy');
    return { destroyed: true };
  }

  @Resource({ uri: 'order://{orderNo}', mimeType: 'application/json' })
  async orderResource(params: { orderNo: string }) {
    CALLS.push('resource');
    return { orderNo: params.orderNo, status: 'paid' };
  }

  @Prompt({ name: 'refund_policy', description: 'Refund policy' })
  refundPrompt() {
    return 'Refunds are processed within 3 business days.';
  }
}

const app = {
  container: IOCContainer,
  getCurrentContext: (): any => undefined,
  ctxStorage: undefined as any,
};

const API_KEYS: Record<string, string[]> = { 'key-refund': ['order:refund'], 'key-read': [] };

const clients: Client[] = [];

function createHost(overrides: Record<string, any> = {}) {
  return createMcpHost({
    app,
    security: { auth: createApiKeyAuth({ keys: API_KEYS }) },
    ...overrides,
  } as any);
}

async function connectClient(host: ReturnType<typeof createHost>) {
  const [clientTransport, serverTransport] = await createInMemoryPair();
  const client = new Client({ name: 'f01-client', version: '1.0.0' });
  await host.server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

function textOf(result: any): any {
  const text = result?.content?.[0]?.text;
  return typeof text === 'string' ? JSON.parse(text) : text;
}

afterAll(async () => {
  for (const client of clients) {
    try {
      await client.close();
    } catch {
      // best effort
    }
  }
});

describe('F-01 discovery and schema', () => {
  it('discovers tools, resources and prompts from component metadata', () => {
    const host = createHost();
    expect(host.registry.tools.map((tool) => tool.name).sort()).toEqual([
      'order_cancel',
      'order_destroy',
      'order_query',
      'order_refund',
    ]);
    expect(host.registry.resources.map((resource) => resource.uriTemplate)).toEqual(['order://{orderNo}']);
    expect(host.registry.prompts.map((prompt) => prompt.name)).toEqual(['refund_policy']);
    const query = host.registry.getTool('order_query')!;
    expect(query.className).toBe('OrderTools');
    expect(query.methodName).toBe('query');
    expect(query.annotations.readOnlyHint).toBe(true);
  });

  it('bridges the @Validated DTO into a JSON Schema input schema', () => {
    const schema = dtoToJsonSchema(QueryOrderDto);
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['orderNo']);
    expect(schema.properties.orderNo).toMatchObject({ type: 'string' });
    expect(schema.properties.page).toMatchObject({ type: 'integer', minimum: 1 });
    expect(schema['x-koatty-unresolved']).toBeUndefined();

    const host = createHost();
    const tool = host.registry.getTool('order_query')!;
    expect(tool.inputSchema.required).toEqual(['orderNo']);
  });

  it('publishes discovery over the protocol', async () => {
    const host = createHost();
    const client = await connectClient(host);

    const tools = await client.listTools();
    const query = tools.tools.find((tool) => tool.name === 'order_query')!;
    expect(query.inputSchema).toMatchObject({ type: 'object' });
    expect(query.annotations?.readOnlyHint).toBe(true);

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain('order://{orderNo}');

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('refund_policy');

    const prompt = await client.getPrompt({ name: 'refund_policy' });
    expect(prompt.messages[0].content).toMatchObject({ type: 'text' });
  });

  it('reads a resource through its URI template', async () => {
    const host = createHost();
    const client = await connectClient(host);
    const read = await client.readResource({ uri: 'order://A-42' });
    const text = (read.contents[0] as any).text;
    expect(JSON.parse(text)).toMatchObject({ orderNo: 'A-42' });
  });
});

describe('F-01 argument validation', () => {
  it('strips extra fields and validates through the shared koatty_validation path', async () => {
    const host = createHost();
    const client = await connectClient(host);
    const before = CALLS.length;

    const result: any = await client.callTool({
      name: 'order_query',
      arguments: { orderNo: 'A-1', page: 2, injected: 'drop-me' },
    });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatchObject({ orderNo: 'A-1', page: 2, status: 'paid' });
    expect(CALLS.length).toBe(before + 1);
    const received = RECEIVED[RECEIVED.length - 1];
    expect(received.orderNo).toBe('A-1');
    expect(received.injected).toBeUndefined();
  });

  it('returns a JSON-RPC invalid-params error instead of throwing for illegal arguments', async () => {
    const host = createHost();
    const client = await connectClient(host);
    const before = CALLS.length;

    await expect(client.callTool({ name: 'order_query', arguments: { page: 1 } })).rejects.toMatchObject({
      code: -32602,
    });
    await expect(client.callTool({ name: 'order_query', arguments: { orderNo: 'A-1', page: 0 } })).rejects.toMatchObject({
      code: -32602,
    });
    expect(CALLS.length).toBe(before);
  });

  it('returns a JSON-RPC error for an unknown tool', async () => {
    const host = createHost();
    const client = await connectClient(host);
    await expect(client.callTool({ name: 'not_a_tool', arguments: {} })).rejects.toMatchObject({
      code: -32602,
    });
  });
});

describe('F-01 authentication and scopes', () => {
  it('rejects a caller without the required scope before running the tool', async () => {
    const host = createHost();
    const client = await connectClient(host);
    const before = CALLS.length;

    await expect(
      host.runWithIdentity({ headers: { 'x-api-key': 'key-read' } }, () =>
        client.callTool({ name: 'order_refund', arguments: { orderNo: 'A-1', reason: 'customer' } }),
      ),
    ).rejects.toMatchObject({ code: -32600 });
    expect(CALLS.includes('refund')).toBe(false);
    expect(CALLS.length).toBe(before);
  });

  it('runs the tool when the caller holds the scope', async () => {
    const host = createHost();
    const client = await connectClient(host);
    const result: any = await host.runWithIdentity({ headers: { 'x-api-key': 'key-refund' } }, () =>
      client.callTool({ name: 'order_refund', arguments: { orderNo: 'A-2', reason: 'customer' } }),
    );
    expect(textOf(result)).toMatchObject({ refunded: true, orderNo: 'A-2' });
  });

  it('rejects an unknown API key before running the tool', async () => {
    const host = createHost();
    const client = await connectClient(host);
    await expect(
      host.runWithIdentity({ headers: { 'x-api-key': 'not-a-key' } }, () =>
        client.callTool({ name: 'order_query', arguments: { orderNo: 'A-1' } }),
      ),
    ).rejects.toMatchObject({ code: -32600 });
  });
});

describe('F-01 approval gate', () => {
  it('never executes a tool that needs approval when no backend is configured', async () => {
    const host = createHost();
    const client = await connectClient(host);
    await expect(
      client.callTool({ name: 'order_cancel', arguments: { orderNo: 'A-1', reason: 'customer' } }),
    ).rejects.toMatchObject({ code: -32600 });
    expect(CALLS.includes('cancel')).toBe(false);
  });

  it('executes only after the approval backend approves', async () => {
    let approved = true;
    const tickets: string[] = [];
    const host = createHost({
      approval: {
        request: async (ticket: any) => {
          tickets.push(ticket.tool);
          return approved ? { approved: true, approver: 'alice' } : { approved: false, reason: 'policy' };
        },
      },
    });
    const client = await connectClient(host);

    const result: any = await client.callTool({
      name: 'order_cancel',
      arguments: { orderNo: 'A-3', reason: 'customer' },
    });
    expect(textOf(result)).toMatchObject({ cancelled: true, orderNo: 'A-3' });
    expect(tickets).toEqual(['order_cancel']);

    const before = CALLS.filter((call) => call === 'cancel').length;
    approved = false;
    await expect(
      client.callTool({ name: 'order_cancel', arguments: { orderNo: 'A-4', reason: 'customer' } }),
    ).rejects.toMatchObject({ code: -32600 });
    expect(CALLS.filter((call) => call === 'cancel').length).toBe(before);
  });

  it('applies the strict-profile default policy to destructive tools', async () => {
    const strictSeen: string[] = [];
    const strictHost = createMcpHost({
      app,
      security: { strict: true },
      approval: { request: async (ticket: any) => (strictSeen.push(ticket.tool), { approved: true }) },
    } as any);
    const strictClient = await connectClient(strictHost);
    await strictClient.callTool({ name: 'order_destroy', arguments: {} });
    expect(strictSeen).toEqual(['order_destroy']);

    const legacySeen: string[] = [];
    const legacyHost = createMcpHost({
      app,
      security: { strict: false },
      approval: { request: async (ticket: any) => (legacySeen.push(ticket.tool), { approved: true }) },
    } as any);
    const legacyClient = await connectClient(legacyHost);
    await legacyClient.callTool({ name: 'order_destroy', arguments: {} });
    expect(legacySeen).toEqual([]);
  });
});

describe('F-01 context isolation, audit and protocol safety', () => {
  it('enters and releases a container request scope for every call', async () => {
    const events: string[] = [];
    const container = {
      listClass: (type: string) => IOCContainer.listClass(type),
      listPropertyData: (key: any, target: any) => IOCContainer.listPropertyData(key as any, target),
      getInsByClass: (clazz: any) => IOCContainer.getInsByClass(clazz),
      readyRequestScope: (ctx: any) => {
        events.push('ready');
        return (IOCContainer as any).readyRequestScope(ctx);
      },
      runInRequestScope: (ctx: any, fn: any) => {
        events.push('enter');
        return (IOCContainer as any).runInRequestScope(ctx, fn);
      },
      releaseRequestScope: (ctx: any) => {
        events.push('release');
        return (IOCContainer as any).releaseRequestScope(ctx);
      },
    };
    const host = createMcpHost({ app, container } as any);
    const client = await connectClient(host);
    await client.callTool({ name: 'order_query', arguments: { orderNo: 'A-7' } });
    expect(events).toEqual(['ready', 'enter', 'release']);
  });

  it('audits a redacted argument summary', async () => {
    const records: any[] = [];
    const host = createHost({ audit: { record: (record: any) => records.push(record) } });
    const client = await connectClient(host);
    await client.callTool({
      name: 'order_query',
      arguments: { orderNo: 'A-8', apiKey: 'super-secret-value' },
    });

    const record = records.find((item) => item.tool === 'order_query' && item.status === 'success');
    expect(record).toBeTruthy();
    expect(record.caller).toBe('anonymous');
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(record.argumentSummary)).not.toContain('super-secret-value');
  });

  it('audits denials so refused calls stay traceable', async () => {
    const records: any[] = [];
    const host = createHost({ audit: { record: (record: any) => records.push(record) } });
    const client = await connectClient(host);
    await expect(client.callTool({ name: 'order_cancel', arguments: { orderNo: 'A-1', reason: 'x' } })).rejects.toBeTruthy();
    const record = records.find((item) => item.tool === 'order_cancel');
    expect(record.status).toBe('pending-approval');
  });

  it('validates the Origin header for DNS-rebinding protection', () => {
    expect(checkOrigin(undefined)).toBe(true);
    expect(checkOrigin('http://localhost:3000')).toBe(true);
    expect(checkOrigin('http://127.0.0.1:8080')).toBe(true);
    expect(checkOrigin('http://evil.example.com')).toBe(false);
    expect(checkOrigin('https://app.example.com', ['https://app.example.com'])).toBe(true);
    expect(checkOrigin('http://localhost', ['https://app.example.com'])).toBe(false);
  });

  it('answers 403 for a foreign Origin without touching the transport', async () => {
    const host = createHost();
    const adapter = createMcpHttpAdapter({ host });
    expect(adapter.path).toBe('/mcp');

    const ctx: any = {
      path: '/mcp',
      method: 'POST',
      request: { headers: { origin: 'http://evil.example.com' } },
      status: 200,
      respond: true,
      body: undefined,
      get: (name: string) => (name === 'origin' ? 'http://evil.example.com' : undefined),
    };
    let nextCalled = false;
    await adapter.middleware(ctx, async () => {
      nextCalled = true;
    });
    expect(ctx.status).toBe(403);
    expect(ctx.respond).toBe(true);
    expect(nextCalled).toBe(false);
  });

  it('leaves non-MCP paths to the next middleware', async () => {
    const host = createHost();
    const adapter = createMcpHttpAdapter({ host });
    let nextCalled = false;
    await adapter.middleware({ path: '/api/orders', method: 'POST', request: { headers: {} } } as any, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});
