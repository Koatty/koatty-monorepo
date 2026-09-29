/**
 * OpenTelemetry GenAI attribute names (roadmap Phase F, item F-4).
 *
 * The OTel GenAI semantic conventions are still in development, so every
 * `gen_ai.*` name used by koatty_trace is centralised here: following upstream
 * renames then means editing one file.
 */

export const GEN_AI_ATTRIBUTES = Object.freeze({
  /** Provider/vendor, e.g. `openai`, `anthropic`. */
  system: 'gen_ai.system',
  /** Operation, e.g. `chat`, `execute_tool`. */
  operationName: 'gen_ai.operation.name',
  /** Model requested by the application (logical or provider-side id). */
  requestModel: 'gen_ai.request.model',
  /** Model that actually answered (after failover). */
  responseModel: 'gen_ai.response.model',
  /** Prompt tokens reported by the provider. */
  inputTokens: 'gen_ai.usage.input_tokens',
  /** Completion tokens reported by the provider. */
  outputTokens: 'gen_ai.usage.output_tokens',
  /** Provider finish reasons, e.g. `stop`, `tool_calls`. */
  finishReasons: 'gen_ai.response.finish_reasons',
  /** Tool name for tool-call spans. */
  toolName: 'gen_ai.tool.name',
  /** Tool call id, correlating the model request with the local invocation. */
  toolCallId: 'gen_ai.tool.call.id',
  /** Tool call outcome: `success` | `error`. */
  toolStatus: 'gen_ai.tool.status',
  /** Approval outcome: `approved` | `rejected` | `timeout`. */
  approvalDecision: 'gen_ai.approval.decision',
  /** Cost in USD estimated from the configured prices. */
  costUsd: 'gen_ai.usage.cost_usd',
  /** Rounded call duration. */
  durationMs: 'gen_ai.call.duration_ms',
  /** Prompt text — ONLY recorded when `captureContent: true` (already masked). */
  promptContent: 'gen_ai.prompt',
  /** Completion text — ONLY recorded when `captureContent: true` (already masked). */
  completionContent: 'gen_ai.completion',
});

/** Span names used by the recorder. */
export const GEN_AI_SPAN_NAMES = Object.freeze({
  chat: 'gen_ai.chat',
  tool: 'gen_ai.tool',
  approval: 'gen_ai.approval',
});
