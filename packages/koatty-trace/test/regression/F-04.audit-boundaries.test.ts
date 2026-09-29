import { createGenAiRecorder } from '../../src/genai/genai';
test('F-A16: content capture cannot be enabled without a masker', () => {
  expect(() => createGenAiRecorder({ captureContent: true })).toThrow(/mask/i);
});
test('F-A16: masking failures cannot fall back to raw content', () => {
  const startSpan = jest.fn();
  const recorder = createGenAiRecorder({ captureContent: true, mask: () => { throw new Error('mask failed'); }, tracer: { startSpan } as any });
  expect(() => recorder.recordChat({ provider: 'test', model: 'test', request: { secret: 'fixture' } })).toThrow();
  expect(startSpan).not.toHaveBeenCalled();
});

test('F-A21: live tool and chat spans preserve parentage, duration and failed status', async () => {
  const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const recorder = createGenAiRecorder({ tracer: provider.getTracer('live') });
  const tool = recorder.beginTool({ name: 'answer' });
  const chat = recorder.beginChat({ provider: 'fallback', model: 'actual', context: tool.context });
  expect(exporter.getFinishedSpans()).toHaveLength(0);
  await new Promise(r => setTimeout(r, 5));
  chat.end({ status: 'error', usage: { promptTokens: 2, completionTokens: 1 }, cost: 0.2 });
  tool.end({ status: 'error' });
  const [child, parent] = exporter.getFinishedSpans();
  expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  expect(child.attributes['gen_ai.status']).toBe('error');
  expect(child.duration[0] * 1000 + child.duration[1] / 1e6).toBeGreaterThanOrEqual(4);
  expect(recorder.metrics().costByModel['fallback:actual']).toBe(0.2);
  await provider.shutdown();
});
