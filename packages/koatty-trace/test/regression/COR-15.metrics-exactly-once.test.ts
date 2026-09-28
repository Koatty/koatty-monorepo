/**
 * COR-15 regression test (C-7): one request must be accounted for exactly once.
 *
 * Before the fix both the per-protocol handlers (`handler/http.ts`,
 * `handler/grpc.ts` via `handler/base.ts#commonPostHandle`) and the `finally` of
 * `trace.ts#handleRequest` collected request metrics and ended the span, so every
 * request produced `metrics +2` and a double span end.
 *
 * The contract now is:
 *   - `trace.ts#handleRequest` is the ONLY place that ends the span and collects
 *     request metrics (once per request, success and error paths alike);
 *   - the protocol handlers only write the access log.
 *
 * @license: BSD (3-Clause)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as prometheus from '../../src/opentelemetry/prometheus';
import { HttpHandler } from '../../src/handler/http';
import { extensionOptions } from '../../src/trace/itrace';

function collectSources(dir: string, base = dir): Array<{ rel: string; content: string }> {
  const out: Array<{ rel: string; content: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full, base));
    } else if (entry.name.endsWith('.ts')) {
      out.push({ rel: path.relative(base, full), content: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
}

function makeExt(): extensionOptions {
  return {
    timeout: 1000,
    spanManager: {
      getSpan: jest.fn(),
      setSpanAttributes: jest.fn(),
      addSpanEvent: jest.fn(),
      endSpan: jest.fn(),
      activeSpans: new Map(),
    },
  } as unknown as extensionOptions;
}

function makeCtx(): any {
  const ctx: any = {
    method: 'GET',
    status: 200,
    body: 'ok',
    startTime: Date.now() - 10,
    requestId: 'cor15-request-id',
    originalPath: '/cor15',
    url: '/cor15',
    path: '/cor15',
    protocol: 'http',
    headers: {},
    set: jest.fn(),
    get: jest.fn(() => ''),
    req: { method: 'GET', headers: {}, url: '/cor15' },
    res: {
      end: jest.fn(function (this: any, data?: any, cb?: () => void) {
        if (data) this.body = data;
        if (cb) setImmediate(cb);
        return this;
      }),
      once: jest.fn(),
      setTimeout: jest.fn(),
      writeHead: jest.fn(),
      setHeader: jest.fn(),
      getHeader: jest.fn(() => null),
      headersSent: false,
    },
  };
  return ctx;
}

describe('COR-15: exactly-once request accounting', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('the http handler does not collect request metrics anymore', async () => {
    const collectSpy = jest.spyOn(prometheus, 'collectRequestMetrics');
    const ext = makeExt();

    await HttpHandler.getInstance().handle(makeCtx(), jest.fn().mockResolvedValue(undefined), ext);

    expect(collectSpy).not.toHaveBeenCalled();
  });

  it('the http handler does not end the span anymore (handleRequest owns it)', async () => {
    const ext = makeExt();

    await HttpHandler.getInstance().handle(makeCtx(), jest.fn().mockResolvedValue(undefined), ext);

    expect((ext.spanManager as any).endSpan).not.toHaveBeenCalled();
  });

  it('the error path is accounted for in the same single place', async () => {
    const collectSpy = jest.spyOn(prometheus, 'collectRequestMetrics');
    const ext = makeExt();
    const ctx = makeCtx();
    ctx.status = 500;
    ctx.message = 'boom';

    await HttpHandler.getInstance().handle(ctx, jest.fn().mockResolvedValue(undefined), ext);

    expect(collectSpy).not.toHaveBeenCalled();
    expect((ext.spanManager as any).endSpan).not.toHaveBeenCalled();
  });

  it('has exactly one metric-collection call site and one span end in src/', () => {
    const sources = collectSources(path.join(__dirname, '../../src'));

    const metricCallSites = sources
      .filter((f) => !f.rel.endsWith(path.join('opentelemetry', 'prometheus.ts')))
      .filter((f) => /collectRequestMetrics\(/.test(f.content))
      .map((f) => f.rel.split(path.sep).join('/'));

    const spanEndSites = sources
      .filter((f) => !f.rel.endsWith(path.join('opentelemetry', 'spanManager.ts')))
      .filter((f) => /\.endSpan\(/.test(f.content))
      .map((f) => f.rel.split(path.sep).join('/'));

    expect(metricCallSites).toEqual(['trace/trace.ts']);
    expect(spanEndSites).toEqual(['trace/trace.ts']);
  });

  it('no protocol handler collects metrics or ends a span', () => {
    const handlers = collectSources(path.join(__dirname, '../../src/handler'));

    for (const file of handlers) {
      expect(file.content).not.toMatch(/collectRequestMetrics/);
      expect(file.content).not.toMatch(/\.endSpan\(/);
    }
  });
});
