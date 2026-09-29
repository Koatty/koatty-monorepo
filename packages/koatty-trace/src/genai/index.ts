/**
 * GenAI observability entry point (roadmap Phase F, item F-4).
 */

export { createGenAiRecorder } from './genai';
export type {
  GenAiApprovalInput,
  GenAiChatInput,
  GenAiMetrics,
  GenAiRecorder,
  GenAiRecorderOptions,
  GenAiToolCallInput,
  GenAiUsage,
} from './genai';
export { GEN_AI_ATTRIBUTES, GEN_AI_SPAN_NAMES } from './constants';
