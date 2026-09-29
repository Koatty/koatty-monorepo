/**
 * Approval gate and audit helpers for high-risk MCP tool calls
 * (roadmap Phase F, F-1 + F-3 integration point).
 *
 * @License BSD-3-Clause
 */
import { MCP_APPROVAL_TIMEOUT_MS } from './constants';
import { randomUUID } from 'crypto';
import type {
  ApprovalDecision,
  ApprovalService,
  ApprovalTicket,
  AuditRecord,
  AuditSink,
  McpPrincipal,
  ToolAnnotations,
} from './types';

export class McpApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpApprovalError';
  }
}

export class McpApprovalTimeoutError extends McpApprovalError {
  constructor(message: string) {
    super(message);
    this.name = 'McpApprovalTimeoutError';
  }
}

const SENSITIVE_KEY = /(pass|secret|token|authorization|apikey|api_key|cookie|card|idcard|idnumber|phone|mobile|email)/i;

function summarizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 64 ? `${value.slice(0, 61)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return depth >= 2 ? `[${value.length} items]` : value.map((item) => summarizeValue(item, depth + 1));
  if (typeof value === 'object') {
    if (depth >= 2) return '<object>';
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '<redacted>' : summarizeValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Build the audit/summary projection of tool arguments.
 *
 * Raw values of sensitive-looking keys never reach the audit log. An optional
 * `redact` hook (koatty_guard sanitize service) is applied on top.
 */
export function summarizeArguments(
  args: Record<string, unknown> | undefined,
  redact?: (value: any) => any,
): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  const summarized = summarizeValue(args) as Record<string, unknown>;
  if (typeof redact !== 'function') return summarized;
  try {
    const redacted = redact(summarized);
    return redacted && typeof redacted === 'object' ? (redacted as Record<string, unknown>) : summarized;
  } catch {
    return summarized;
  }
}

/** Options accepted by {@link evaluateApproval}. */
export interface ApprovalEvaluationInput {
  tool: string;
  annotations?: ToolAnnotations;
  requireApproval?: boolean;
  args: Record<string, unknown>;
  principal: McpPrincipal | null;
  sessionId: string;
  requestId: string;
  service?: ApprovalService;
  strict?: boolean;
  timeoutMs?: number;
  redact?: (value: any) => any;
  now?: () => number;
  signal?: AbortSignal;
}

function needsApproval(input: ApprovalEvaluationInput): boolean {
  if (input.requireApproval === false) return false;
  if (input.requireApproval === true) return true;
  // Default policy (F-1/F-3): destructive tools need approval in the strict
  // profile unless they explicitly opted out above.
  return input.strict === true && input.annotations?.destructiveHint === true;
}

/**
 * Decide whether a tool call may run.
 *
 * Fails closed: a tool that requires approval and has no approval backend is
 * rejected instead of executed.
 */
export async function evaluateApproval(
  input: ApprovalEvaluationInput,
): Promise<{ approved: boolean; ticketId?: string; reason?: string }> {
  input.signal?.throwIfAborted();
  if (!needsApproval(input)) return { approved: true };

  if (!input.service || typeof input.service.request !== 'function') {
    throw new McpApprovalError(
      `Tool "${input.tool}" requires human approval but no ApprovalService is configured.`,
    );
  }

  const now = input.now ? input.now() : Date.now();
  const timeoutMs = input.timeoutMs ?? MCP_APPROVAL_TIMEOUT_MS;
  const ticket: ApprovalTicket = {
    id: randomUUID(),
    tool: input.tool,
    args: input.args,
    argumentSummary: summarizeArguments(input.args, input.redact),
    caller: input.principal?.id ?? 'anonymous',
    sessionId: input.sessionId,
    requestId: input.requestId,
    createdAt: now,
    expiresAt: now + timeoutMs,
  };

  let decision: ApprovalDecision;
  try {
    const controller = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    try {
      const request = input.service.request(ticket, { signal });
      decision = input.service.managesTimeout ? await request : await withTimeout(request, timeoutMs, signal);
    } finally { controller.abort(); }
    input.signal?.throwIfAborted();
  } catch (error) {
    if (error instanceof McpApprovalTimeoutError) throw error;
    throw new McpApprovalError(`Approval backend failed: ${(error as Error).message}`);
  }

  if (decision?.approved === false && decision.reason === 'approval-timeout') throw new McpApprovalTimeoutError(`Approval timed out after ${timeoutMs}ms.`);
  if (decision?.approved === true) return { approved: true, ticketId: ticket.id };
  return { approved: false, ticketId: ticket.id, reason: decision?.reason ?? 'rejected' };
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new McpApprovalError('Approval cancelled.')); };
    const timer = setTimeout(
      () => { cleanup(); reject(new McpApprovalTimeoutError(`Approval timed out after ${ms}ms.`)); },
      ms,
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Safe audit emission: an audit sink failure must never break the tool call. */
export async function emitAudit(sink: AuditSink | undefined, record: AuditRecord): Promise<void> {
  if (!sink || typeof sink.record !== 'function') return;
  try {
    await sink.record(record);
  } catch {
    // auditing is best-effort by design
  }
}
