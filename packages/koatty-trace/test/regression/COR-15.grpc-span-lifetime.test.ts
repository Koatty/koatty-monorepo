import { SpanManager } from '../../src/opentelemetry/spanManager';

test('long streams retain their span until actual completion, ending exactly once', async () => {
  jest.useFakeTimers();
  const memory = process.memoryUsage();
  const spy = jest.spyOn(process, 'memoryUsage').mockReturnValue({ ...memory, heapUsed: 64 * 1024 * 1024 });
  const manager = new SpanManager({ enableTrace: true, opentelemetryConf: { spanTimeout: 10 } });
  const span = { spanContext: () => ({ traceId: 'stream' }), setAttribute: jest.fn(), setAttributes: jest.fn(), addEvent: jest.fn(), end: jest.fn() };
  const ctx: any = { protocol: 'grpc', method: 'POST', path: '/Stream', set: jest.fn(),
    rpc: { call: { koattyMethodKind: 'server_stream', getDeadline: () => Infinity } } };
  try {
    manager.createSpan({ startSpan: () => span } as any, ctx, 'test');
    await jest.advanceTimersByTimeAsync(100);
    expect(span.end).not.toHaveBeenCalled();
    expect(manager.getStats().activeSpansCount).toBe(1);
    manager.endSpan(ctx); manager.endSpan(ctx);
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(manager.getStats().activeSpansCount).toBe(0);
  } finally { manager.destroy(); spy.mockRestore(); jest.useRealTimers(); }
});
