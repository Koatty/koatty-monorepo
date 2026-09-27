import { Trace } from '../src/trace/trace';
import { Koatty, KoattyContext } from "koatty_core";
import { SpanManager } from '../src/opentelemetry/spanManager';
import { Span } from '@opentelemetry/api';

// Minimal mock for Koatty app with only used properties
const mockTracer = {
  startSpan: jest.fn().mockImplementation((name: string) => ({
    end: jest.fn(),
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    addEvent: jest.fn(),
    setStatus: jest.fn(),
    updateName: jest.fn(),
    isRecording: jest.fn().mockReturnValue(true),
    recordException: jest.fn(),
    spanContext: jest.fn().mockReturnValue({
      traceId: 'mock-trace-id',
      spanId: 'mock-span-id',
      traceFlags: 1
    })
  }))
};

const mockApp = {
  name: 'test-app',
  appDebug: true,
  getMetaData: jest.fn().mockImplementation((key: string) => {
    if (key === 'tracer') return [mockTracer];
    if (key === 'spanManager') return [mockSpanManager];
    return [];
  }),
  once: jest.fn(),
  server: { 
    status: 200
  }
} as unknown as Koatty;

// Enhanced mock for IncomingMessage with all methods mocked
const mockIncomingMessage = {
  on: jest.fn().mockImplementation((event, listener) => {
    if (event === 'data') listener(Buffer.from('test'));
    if (event === 'end') listener();
    return this;
  }),
  once: jest.fn(),
  emit: jest.fn(),
  headers: {},
  method: 'GET',
  url: '/test',
  socket: {},
  httpVersion: '1.1',
  httpVersionMajor: 1,
  httpVersionMinor: 1,
  getMetaData: jest.fn().mockReturnValue([{_body: {}}]),
  destroy: jest.fn(),
  setTimeout: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
  setEncoding: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  pipe: jest.fn()
} as unknown as any;

// Enhanced mock for ServerResponse
const mockServerResponse = {
  on: jest.fn(),
  once: jest.fn().mockImplementation((event: string, callback: () => void) => {
    if (event === 'finish') {
      callback();
    }
  }),
  emit: jest.fn(),
  setHeader: jest.fn(),
  statusCode: 200,
  statusMessage: 'OK',
  end: jest.fn(),
  writeHead: jest.fn(),
  write: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn()
} as unknown as any;

// Enhanced mock for Koatty context
const createMockContext = (protocol = 'http'): KoattyContext => ({
  protocol,
  status: 200,
  path: '/test',
  headers: {},
  query: {},
  set: jest.fn(),
  setMetaData: jest.fn(),
  getMetaData: jest.fn().mockReturnValue([{
    _body: {
      requestId: 'test-request-id'
    }
  }]),
  rpc: { 
    call: { 
      metadata: { 
        set: jest.fn(),
        get: jest.fn().mockReturnValue(['test-value'])
      },
      sendMetadata: jest.fn(),
      once: jest.fn()
    },
    callback: jest.fn()
  },
  req: {
    ...mockIncomingMessage,
    on: jest.fn()
  },
  res: {
    ...mockServerResponse,
    once: jest.fn().mockImplementation((event, callback) => {
      if (event === 'finish') callback();
    })
  },
  body: '',
  requestId: '',
  get: jest.fn(),
  originalPath: '/test',
  startTime: Date.now()
} as unknown as KoattyContext);

// Mock Span
const mockSpan: Span = {
  end: jest.fn(),
  setAttributes: jest.fn(),
  setAttribute: jest.fn(),
  addEvent: jest.fn(),
  setStatus: jest.fn(),
  updateName: jest.fn(),
  isRecording: jest.fn().mockReturnValue(true),
  recordException: jest.fn(),
  spanContext: jest.fn().mockReturnValue({
    traceId: 'mock-trace-id',
    spanId: 'mock-span-id',
    traceFlags: 1
  })
} as unknown as Span;

// Complete mock for SpanManager with tracer
const mockSpanManager: any = {
  createSpan: jest.fn((tracer: any, ctx: any, serviceName: string) => {
    const span = {
      ...mockSpan,
      setAttribute: jest.fn(),
      setAttributes: jest.fn(),
      addEvent: jest.fn(),
      setStatus: jest.fn(),
      updateName: jest.fn(),
      spanContext: jest.fn().mockReturnValue({
        traceId: `mock-trace-id-${Math.random().toString(36).substring(7)}`,
        spanId: 'mock-span-id',
        traceFlags: 1
      })
    };
    // Store the created span for later verification
    mockSpanManager.getSpan = jest.fn().mockReturnValue(span);
    return span;
  }),
  endSpan: jest.fn().mockImplementation(() => {
    const span = mockSpanManager.getSpan();
    if (span) {
      span.end();
    }
  }),
  getSpan: jest.fn().mockReturnValue(mockSpan),
  setupSpanTimeout: jest.fn().mockImplementation((span: any) => {
    return setTimeout(() => {
      span.end();
    }, 100);
  }),
  injectContext: jest.fn(),
  setBasicAttributes: jest.fn(),
  setSpanAttributes: jest.fn(),
  tracer: {
    startSpan: jest.fn().mockImplementation((name: string) => {
      return {
        ...mockSpan,
        name,
        setAttribute: jest.fn(),
        setAttributes: jest.fn(),
        addEvent: jest.fn(),
        setStatus: jest.fn(),
        updateName: jest.fn(),
        end: jest.fn(),
        isRecording: jest.fn().mockReturnValue(true),
        recordException: jest.fn(),
        spanContext: jest.fn().mockReturnValue({
          traceId: `mock-trace-id-${Math.random().toString(36).substring(7)}`,
          spanId: 'mock-span-id',
          traceFlags: 1
        })
      };
    }),
    getCurrentSpan: jest.fn().mockReturnValue(mockSpan),
    withSpan: jest.fn(),
    bind: jest.fn(),
    getActiveSpan: jest.fn(),
    startActiveSpan: jest.fn()
  },
  getTracer: jest.fn().mockReturnValue({
    startSpan: jest.fn().mockReturnValue(mockSpan)
  }),
  addSpanEvent: jest.fn().mockImplementation((name: string, attributes?: Record<string, any>) => {
    const span = mockSpanManager.getSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  })
} as unknown as SpanManager;

describe('Trace Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Trigger the appStop cleanup handler registered by Trace() so the
   * closure-created SpanManager destroys itself (stops its cleanup interval
   * and force-ends any remaining spans). Prevents dangling timers from
   * keeping the jest worker alive.
   */
  async function cleanupTrace(app: any) {
    const stopHandler = (app.once as jest.Mock).mock.calls
      .find((c: any[]) => c[0] === 'appStop')?.[1] as (() => Promise<void>) | undefined;
    if (stopHandler) {
      await stopHandler();
    }
  }

  test('should create middleware function', () => {
    const middleware = Trace({}, mockApp);
    expect(typeof middleware).toBe('function');
  });

  test('should handle server shutdown', async () => {
    const ctx = createMockContext();
    const app = { ...mockApp, server: { status: 503 } };
    const middleware = Trace({}, app as any);
    await middleware(ctx, jest.fn());
    expect(ctx.status).toBe(503);
    expect(ctx.body).toBe('Server is in the process of shutting down');
  });

  test('should generate request ID', async () => {
    const ctx = createMockContext();
    const middleware = Trace({}, mockApp);
    await middleware(ctx, jest.fn());
    expect(ctx.requestId).toBeDefined();
  });

  test('should handle HTTP protocol', async () => {
    const ctx = createMockContext('http');
    const middleware = Trace({}, mockApp);
    await middleware(ctx, jest.fn());
    expect(ctx.set).toHaveBeenCalled();
  });

  test('should handle gRPC protocol', async () => {
    const ctx = createMockContext('grpc');
    const middleware = Trace({}, mockApp);
    await middleware(ctx, jest.fn());
    expect(ctx.respond).toBe(false);
  });

  test('should handle WebSocket protocol', async () => {
    const ctx = createMockContext('ws');
    const middleware = Trace({}, mockApp);
    await middleware(ctx, jest.fn());
    expect(ctx.respond).toBe(false);
  });

  test('should initialize OpenTelemetry when enabled', async () => {
    Trace({
      enableTrace: true,
      // avoid binding the prometheus metrics port in unit tests
      metricsConf: { metricsEndpoint: '' },
    }, mockApp);
    expect(mockApp.once).toHaveBeenCalled();
    await cleanupTrace(mockApp);
  });

  test('should create span when tracing is enabled', async () => {
    // The refactored Trace middleware builds its own SpanManager inside the
    // closure and reads the tracer from app.otelTracer (trace.ts:325-331).
    const app = { ...mockApp, otelTracer: mockTracer } as any;
    const createSpanSpy = jest.spyOn(SpanManager.prototype, 'createSpan');

    const ctx = createMockContext();
    const middleware = Trace({
      enableTrace: true,
      samplingRate: 1.0,
      spanTimeout: 5000,
      // avoid binding the prometheus metrics port in unit tests
      metricsConf: { metricsEndpoint: '' },
    }, app);

    const next = jest.fn().mockResolvedValue(undefined);
    await middleware(ctx, next);

    expect(createSpanSpy).toHaveBeenCalledWith(
      mockTracer,
      expect.anything(),
      expect.any(String)
    );
    expect(next).toHaveBeenCalled();

    // the span created through the mocked tracer is ended on request completion
    const createdSpan = mockTracer.startSpan.mock.results[0]?.value;
    expect(createdSpan?.end).toHaveBeenCalled();

    createSpanSpy.mockRestore();
    await cleanupTrace(app);
  });

  test('should handle span timeout', async () => {
    const app = { ...mockApp, otelTracer: mockTracer } as any;
    // Suppress the request-completion endSpan so the periodic timeout path
    // (spanManager.forceEndSpan) is the one ending the span.
    const endSpanSpy = jest.spyOn(SpanManager.prototype, 'endSpan').mockImplementation(() => { /* suppressed */ });

    const ctx = createMockContext();
    const middleware = Trace({
      enableTrace: true,
      // spanTimeout is read from opentelemetryConf by the refactored middleware
      opentelemetryConf: { spanTimeout: 100 } as any,
      // avoid binding the prometheus metrics port in unit tests
      metricsConf: { metricsEndpoint: '' },
    }, app);

    await middleware(ctx, jest.fn().mockResolvedValue(undefined));

    // wait past the configured span timeout
    await new Promise((resolve) => setTimeout(resolve, 200));

    const createdSpan = mockTracer.startSpan.mock.results[0]?.value;
    expect(createdSpan?.end).toHaveBeenCalled();

    endSpanSpy.mockRestore();
    await cleanupTrace(app);
  });

  test('should manage multiple active spans', async () => {
    const app = { ...mockApp, otelTracer: mockTracer } as any;

    const ctx1 = createMockContext();
    const ctx2 = createMockContext();
    const middleware = Trace({
      enableTrace: true,
      samplingRate: 1.0,
      // avoid binding the prometheus metrics port in unit tests
      metricsConf: { metricsEndpoint: '' },
    }, app);

    await Promise.all([
      middleware(ctx1, jest.fn().mockResolvedValue(undefined)),
      middleware(ctx2, jest.fn().mockResolvedValue(undefined)),
    ]);

    // one span per context, each properly ended exactly once
    expect(mockTracer.startSpan).toHaveBeenCalledTimes(2);
    const spans = mockTracer.startSpan.mock.results.map((r) => r.value);
    expect(spans.length).toBe(2);
    for (const span of spans) {
      expect(span.end).toHaveBeenCalledTimes(1);
    }

    await cleanupTrace(app);
  });

  test('should enable async hooks when configured', async () => {
    const ctx = createMockContext();
    const wrapEmitterSpy = jest.spyOn(require('../src/trace/wrap'), 'wrapEmitter');
    
    const middleware = Trace({ asyncHooks: true }, mockApp);
    await middleware(ctx, jest.fn());
    
    expect(wrapEmitterSpy).toHaveBeenCalledWith(ctx.req, expect.any(Object));
    expect(wrapEmitterSpy).toHaveBeenCalledWith(ctx.res, expect.any(Object));
  });
});
