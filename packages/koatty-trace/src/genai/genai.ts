/**
 * GenAI observability (roadmap Phase F, item F-4).
 *
 * Additive API on top of the existing `koatty_trace` primitives: it uses the
 * OpenTelemetry API tracer already shipped by this package, so GenAI spans join
 * the same trace as the HTTP/MCP request spans
 * (`MCP request` -> `gen_ai.tool` -> `gen_ai.chat`).
 *
 * Privacy default: prompt and completion text are NEVER recorded unless
 * `captureContent: true`; when enabled they are masked first (inject the F-3
 * masking service — this module intentionally does not depend on koatty_guard).
 */

import { context, trace, type Context, type Span, type Tracer } from '@opentelemetry/api';
import { GEN_AI_ATTRIBUTES, GEN_AI_SPAN_NAMES } from './constants';

/**
 * Every record call can pin its parent explicitly, which is required when the
 * call happens after an `await` boundary where the active context has been
 * restored by the application (and in tests, where no context manager runs).
 */
export interface GenAiSpanOptions {
  context?: Context;
  /** Existing live span; when provided recording completes it. */
  span?: Span;
}

export interface GenAiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GenAiChatInput extends GenAiSpanOptions {
  provider: string;
  model: string;
  /** Model that answered after failover, defaults to `model`. */
  responseModel?: string;
  usage?: GenAiUsage;
  finishReason?: string;
  durationMs?: number;
  request?: unknown;
  response?: unknown;
  /** Logical name used by the application, recorded as a span attribute. */
  route?: string;
  status?: 'success' | 'error' | 'cancelled';
  cost?: number;
}

export interface GenAiToolCallInput extends GenAiSpanOptions {
  name: string;
  status: 'success' | 'error';
  durationMs?: number;
  arguments?: unknown;
  result?: unknown;
  toolCallId?: string;
}

export interface GenAiApprovalInput extends GenAiSpanOptions {
  tool: string;
  decision: 'approved' | 'rejected' | 'timeout';
  durationMs?: number;
}

export interface GenAiMetrics {
  tokensByModel: Record<string, { input: number; output: number }>;
  costByModel: Record<string, number>;
  toolCalls: { total: number; failed: number; successRate: number };
  approvals: { total: number; approved: number; rejected: number; rate: number };
}

export interface GenAiRecorderOptions {
  /** Tracer override (tests, custom instrumentation). */
  tracer?: Tracer;
  /** Record prompt/completion text (masked). Defaults to false. */
  captureContent?: boolean;
  /** Masking hook applied to captured content. */
  mask?: (value: any) => any;
  /** Price per 1k prompt tokens, per model or a single default. */
  pricePer1kPrompt?: number | Record<string, number>;
  /** Price per 1k completion tokens, per model or a single default. */
  pricePer1kCompletion?: number | Record<string, number>;
}

export interface GenAiRecorder {
  startSpan(name: string, attributes?: Record<string, unknown>, parentContext?: Context): Span;
  beginChat(input: GenAiChatInput): { context: Context; end(result?: Partial<GenAiChatInput>): void };
  beginTool(input: Omit<GenAiToolCallInput, 'status'>): { context: Context; end(result: Partial<GenAiToolCallInput>): void };
  recordChat(input: GenAiChatInput): void;
  recordToolCall(input: GenAiToolCallInput): void;
  recordApproval(input: GenAiApprovalInput): void;
  metrics(): GenAiMetrics;
}

function priceFor(price: number | Record<string, number> | undefined, model: string): number | undefined {
  if (price === undefined) {
    return undefined;
  }
  if (typeof price === 'number') {
    return price;
  }
  return price[model];
}

function contentAttributes(
  capture: boolean,
  masker: (value: any) => any,
  request: unknown,
  response: unknown,
): Record<string, unknown> {
  if (!capture) {
    return {};
  }
  const attributes: Record<string, unknown> = {};
  if (request !== undefined) {
    attributes[GEN_AI_ATTRIBUTES.promptContent] = JSON.stringify(masker(request));
  }
  if (response !== undefined) {
    attributes[GEN_AI_ATTRIBUTES.completionContent] = JSON.stringify(masker(response));
  }
  return attributes;
}

/**
 * Create a GenAI recorder.
 *
 * @param options.tracer tracer to use; defaults to the shared `koatty-genai` tracer
 * @param options.captureContent record masked prompt/completion text (off by default)
 * @param options.mask masking hook (e.g. `koatty_guard`'s `masking.mask`)
 *
 * Every `record*` call accepts an optional `context` used as the span parent, so
 * the caller can stitch the GenAI span into the MCP/HTTP request span even after
 * an `await` boundary; without it the currently active context is used.
 */
export function createGenAiRecorder(options: GenAiRecorderOptions = {}): GenAiRecorder {
  const tracer = options.tracer ?? trace.getTracer('koatty-genai');
  const captureContent = options.captureContent === true;
  if (captureContent && typeof options.mask !== 'function') throw new Error('GenAI content capture requires a masking service.');
  const masker = options.mask ?? ((value: any) => value);

  const metrics: GenAiMetrics = {
    tokensByModel: {},
    costByModel: {},
    toolCalls: { total: 0, failed: 0, successRate: 1 },
    approvals: { total: 0, approved: 0, rejected: 0, rate: 1 },
  };

  const startSpan = (
    name: string,
    attributes: Record<string, unknown> = {},
    parentContext: Context = context.active(),
  ): Span => {
    return tracer.startSpan(name, { attributes: attributes as any }, parentContext);
  };

  return {
    startSpan,
    beginChat(input) {
      const span = startSpan(GEN_AI_SPAN_NAMES.chat, {}, input.context);
      const started = Date.now(); let ended = false;
      return { context: trace.setSpan(input.context ?? context.active(), span), end: (result = {}) => {
        if (ended) return; ended = true;
        try { this.recordChat({ ...input, ...result, span, durationMs: Date.now() - started }); }
        catch { span.end(); }
      } };
    },
    beginTool(input) {
      const span = startSpan(GEN_AI_SPAN_NAMES.tool, {}, input.context);
      const started = Date.now(); let ended = false;
      return { context: trace.setSpan(input.context ?? context.active(), span), end: (result) => {
        if (ended) return; ended = true;
        try { this.recordToolCall({ ...input, status: 'error', ...result, span, durationMs: Date.now() - started }); }
        catch { span.end(); }
      } };
    },

    recordChat(input: GenAiChatInput) {
      const attributes: Record<string, unknown> = {
        [GEN_AI_ATTRIBUTES.system]: input.provider,
        [GEN_AI_ATTRIBUTES.operationName]: 'chat',
        [GEN_AI_ATTRIBUTES.requestModel]: input.model,
        [GEN_AI_ATTRIBUTES.responseModel]: input.responseModel ?? input.model,
      };
      const inputTokens = input.usage?.promptTokens;
      const outputTokens = input.usage?.completionTokens;
      if (typeof inputTokens === 'number') {
        attributes[GEN_AI_ATTRIBUTES.inputTokens] = inputTokens;
      }
      if (typeof outputTokens === 'number') {
        attributes[GEN_AI_ATTRIBUTES.outputTokens] = outputTokens;
      }
      if (input.finishReason) {
        attributes[GEN_AI_ATTRIBUTES.finishReasons] = [input.finishReason];
      }
      if (typeof input.durationMs === 'number') {
        attributes[GEN_AI_ATTRIBUTES.durationMs] = input.durationMs;
      }

      const modelKey = `${input.provider}:${input.responseModel ?? input.model}`;
      const bucket = (metrics.tokensByModel[modelKey] = metrics.tokensByModel[modelKey] ?? {
        input: 0,
        output: 0,
      });
      bucket.input += inputTokens ?? 0;
      bucket.output += outputTokens ?? 0;

      const promptPrice = priceFor(options.pricePer1kPrompt, modelKey);
      const completionPrice = priceFor(options.pricePer1kCompletion, modelKey);
      if (promptPrice !== undefined || completionPrice !== undefined) {
        const cost =
          ((inputTokens ?? 0) / 1000) * (promptPrice ?? 0) +
          ((outputTokens ?? 0) / 1000) * (completionPrice ?? 0);
        metrics.costByModel[modelKey] = Number(((metrics.costByModel[modelKey] ?? 0) + cost).toFixed(6));
        attributes[GEN_AI_ATTRIBUTES.costUsd] = cost;
      }

      Object.assign(
        attributes,
        contentAttributes(captureContent, masker, input.request, input.response),
      );

      if (input.status) attributes['gen_ai.status'] = input.status;
      if (input.route) attributes['gen_ai.route'] = input.route;
      if (input.cost !== undefined) {
        attributes[GEN_AI_ATTRIBUTES.costUsd] = input.cost;
        // Prefer actual routed cost over recorder defaults.
        metrics.costByModel[modelKey] = Number(((metrics.costByModel[modelKey] ?? 0) -
          (((inputTokens ?? 0) / 1000) * (promptPrice ?? 0) + ((outputTokens ?? 0) / 1000) * (completionPrice ?? 0)) + input.cost).toFixed(6));
      }
      const span = input.span ?? startSpan(GEN_AI_SPAN_NAMES.chat, attributes, input.context);
      if (input.span) span.setAttributes(attributes as any);
      span.end();
    },

    recordToolCall(input: GenAiToolCallInput) {
      const attributes: Record<string, unknown> = {
        [GEN_AI_ATTRIBUTES.operationName]: 'execute_tool',
        [GEN_AI_ATTRIBUTES.toolName]: input.name,
        [GEN_AI_ATTRIBUTES.toolStatus]: input.status,
      };
      if (input.toolCallId) {
        attributes[GEN_AI_ATTRIBUTES.toolCallId] = input.toolCallId;
      }
      if (typeof input.durationMs === 'number') {
        attributes[GEN_AI_ATTRIBUTES.durationMs] = input.durationMs;
      }
      Object.assign(
        attributes,
        contentAttributes(captureContent, masker, input.arguments, input.result),
      );

      metrics.toolCalls.total += 1;
      if (input.status === 'error') {
        metrics.toolCalls.failed += 1;
      }
      metrics.toolCalls.successRate =
        (metrics.toolCalls.total - metrics.toolCalls.failed) / metrics.toolCalls.total;

      const span = input.span ?? startSpan(GEN_AI_SPAN_NAMES.tool, attributes, input.context);
      if (input.span) span.setAttributes(attributes as any);
      span.end();
    },

    recordApproval(input: GenAiApprovalInput) {
      const attributes: Record<string, unknown> = {
        [GEN_AI_ATTRIBUTES.operationName]: 'approval',
        [GEN_AI_ATTRIBUTES.toolName]: input.tool,
        [GEN_AI_ATTRIBUTES.approvalDecision]: input.decision,
      };
      if (typeof input.durationMs === 'number') {
        attributes[GEN_AI_ATTRIBUTES.durationMs] = input.durationMs;
      }

      metrics.approvals.total += 1;
      if (input.decision === 'approved') {
        metrics.approvals.approved += 1;
      } else {
        metrics.approvals.rejected += 1;
      }
      metrics.approvals.rate = metrics.approvals.approved / metrics.approvals.total;

      const span = startSpan(GEN_AI_SPAN_NAMES.approval, attributes, input.context);
      span.end();
    },

    metrics() {
      return {
        tokensByModel: { ...metrics.tokensByModel },
        costByModel: { ...metrics.costByModel },
        toolCalls: { ...metrics.toolCalls },
        approvals: { ...metrics.approvals },
      };
    },
  };
}
