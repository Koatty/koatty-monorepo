/**
 * F-04 — GenAI observability regression suite (roadmap Phase F, item F-4).
 *
 * Uses an in-memory OTel span exporter so the assertions run against real
 * spans, and checks the privacy default (no prompt/completion content unless
 * explicitly enabled and masked).
 */
import { context, trace, type Context } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  createGenAiRecorder,
  GEN_AI_ATTRIBUTES,
  GEN_AI_SPAN_NAMES,
} from '../../src/genai/index';

function setup() {
  const exporter = new InMemorySpanExporter();
  // @opentelemetry/sdk-trace-base >= 2 removed `addSpanProcessor` in favour of
  // the `spanProcessors` constructor option.
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('koatty-genai-test');
  return { exporter, tracer };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('F-04 GenAI attribute names', () => {
  it('keeps every gen_ai attribute name in the constants module', () => {
    expect(GEN_AI_ATTRIBUTES.system).toBe('gen_ai.system');
    expect(GEN_AI_ATTRIBUTES.requestModel).toBe('gen_ai.request.model');
    expect(GEN_AI_ATTRIBUTES.inputTokens).toBe('gen_ai.usage.input_tokens');
    expect(GEN_AI_ATTRIBUTES.toolName).toBe('gen_ai.tool.name');
    expect(GEN_AI_SPAN_NAMES).toEqual({
      chat: 'gen_ai.chat',
      tool: 'gen_ai.tool',
      approval: 'gen_ai.approval',
    });
    expect(Object.isFrozen(GEN_AI_ATTRIBUTES)).toBe(true);
  });
});

describe('F-04 chat spans', () => {
  it('records provider, model, tokens, finish reason and duration', async () => {
    const { exporter, tracer } = setup();
    const recorder = createGenAiRecorder({ tracer, pricePer1kPrompt: 0.5, pricePer1kCompletion: 1.5 });

    recorder.recordChat({
      provider: 'openai',
      model: 'default',
      responseModel: 'gpt-4o-mini',
      usage: { promptTokens: 1000, completionTokens: 500 },
      finishReason: 'stop',
      durationMs: 42,
    });
    await flush();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('gen_ai.chat');
    expect(span.attributes).toMatchObject({
      [GEN_AI_ATTRIBUTES.system]: 'openai',
      [GEN_AI_ATTRIBUTES.operationName]: 'chat',
      [GEN_AI_ATTRIBUTES.requestModel]: 'default',
      [GEN_AI_ATTRIBUTES.responseModel]: 'gpt-4o-mini',
      [GEN_AI_ATTRIBUTES.inputTokens]: 1000,
      [GEN_AI_ATTRIBUTES.outputTokens]: 500,
      [GEN_AI_ATTRIBUTES.finishReasons]: ['stop'],
      [GEN_AI_ATTRIBUTES.durationMs]: 42,
    });
    expect(span.attributes[GEN_AI_ATTRIBUTES.costUsd] as number).toBeCloseTo(1.25, 5);

    const metrics = recorder.metrics();
    expect(metrics.tokensByModel['openai:gpt-4o-mini']).toEqual({ input: 1000, output: 500 });
    expect(metrics.costByModel['openai:gpt-4o-mini']).toBeCloseTo(1.25, 5);
  });
});

describe('F-04 content privacy', () => {
  it('never records prompt or completion text by default', async () => {
    const { exporter, tracer } = setup();
    const recorder = createGenAiRecorder({ tracer });

    recorder.recordChat({
      provider: 'openai',
      model: 'default',
      request: { messages: [{ role: 'user', content: 'secret question' }] },
      response: { text: 'secret answer' },
    });
    await flush();

    const serialized = JSON.stringify(exporter.getFinishedSpans().map((span) => span.attributes));
    expect(serialized).not.toContain('secret question');
    expect(serialized).not.toContain('secret answer');
    expect(serialized).not.toContain('gen_ai.prompt');
  });

  it('records masked content only when captureContent is enabled', async () => {
    const { exporter, tracer } = setup();
    const mask = (value: any) => JSON.parse(JSON.stringify(value).replace(/ops@example\.com/g, '***'));
    const recorder = createGenAiRecorder({ tracer, captureContent: true, mask });

    recorder.recordChat({
      provider: 'openai',
      model: 'default',
      request: { messages: [{ role: 'user', content: 'mail ops@example.com' }] },
      response: { text: 'sent to ops@example.com' },
    });
    await flush();

    const [span] = exporter.getFinishedSpans();
    const prompt = span.attributes[GEN_AI_ATTRIBUTES.promptContent] as string;
    const completion = span.attributes[GEN_AI_ATTRIBUTES.completionContent] as string;
    expect(prompt).toContain('***');
    expect(prompt).not.toContain('ops@example.com');
    expect(completion).toContain('***');
  });
});

describe('F-04 tool, approval and metrics', () => {
  it('links tool calls to the request trace and tracks success/approval rates', async () => {
    const { exporter, tracer } = setup();
    const recorder = createGenAiRecorder({ tracer });

    // Simulates the MCP request span created by koatty_trace for the same
    // request: the recorder is handed that span as the parent context, so every
    // GenAI span joins the request trace instead of starting a new one.
    const requestSpan = recorder.startSpan('mcp.request', { 'mcp.tool': 'order.query' });
    const requestContext: Context = trace.setSpan(context.active(), requestSpan);
    const requestSpanId = requestSpan.spanContext().spanId;

    recorder.recordToolCall({
      name: 'order.query',
      status: 'success',
      durationMs: 5,
      toolCallId: 'call-1',
      context: requestContext,
    });
    recorder.recordToolCall({ name: 'order.refund', status: 'error', durationMs: 9, context: requestContext });
    recorder.recordApproval({ tool: 'order.refund', decision: 'approved', context: requestContext });
    recorder.recordApproval({ tool: 'order.refund', decision: 'timeout', context: requestContext });
    requestSpan.end();
    await flush();

    const spans = exporter.getFinishedSpans();
    const toolSpan = spans.find(
      (span) =>
        span.name === GEN_AI_SPAN_NAMES.tool &&
        span.attributes[GEN_AI_ATTRIBUTES.toolName] === 'order.query',
    );
    expect(toolSpan?.attributes[GEN_AI_ATTRIBUTES.toolStatus]).toBe('success');
    expect(toolSpan?.attributes[GEN_AI_ATTRIBUTES.toolCallId]).toBe('call-1');
    expect(toolSpan?.attributes[GEN_AI_ATTRIBUTES.durationMs]).toBe(5);
    // All spans share one trace id: MCP request -> tool -> approval can be stitched.
    expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(1);
    expect(toolSpan?.parentSpanContext?.spanId).toBe(requestSpanId);
    expect(spans.map((span) => span.name).sort()).toEqual(
      ['gen_ai.approval', 'gen_ai.approval', 'gen_ai.tool', 'gen_ai.tool', 'mcp.request'].sort(),
    );

    const metrics = recorder.metrics();
    expect(metrics.toolCalls).toEqual({ total: 2, failed: 1, successRate: 0.5 });
    expect(metrics.approvals).toEqual({ total: 2, approved: 1, rejected: 1, rate: 0.5 });
  });

  it('estimates cost from per-model prices', async () => {
    const { tracer } = setup();
    const recorder = createGenAiRecorder({
      tracer,
      pricePer1kPrompt: { 'openai:gpt-4o-mini': 1 },
      pricePer1kCompletion: { 'openai:gpt-4o-mini': 2 },
    });
    recorder.recordChat({
      provider: 'openai',
      model: 'default',
      responseModel: 'gpt-4o-mini',
      usage: { promptTokens: 2000, completionTokens: 1000 },
    });
    recorder.recordChat({ provider: 'local', model: 'local' });
    await flush();

    expect(recorder.metrics().costByModel['openai:gpt-4o-mini']).toBeCloseTo(4, 5);
    expect(recorder.metrics().costByModel['local:local']).toBeUndefined();
  });
});
