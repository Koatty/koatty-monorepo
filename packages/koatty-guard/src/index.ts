/**
 * koatty_guard — AI guardrails for Koatty (roadmap Phase F, item F-3).
 *
 * Services: masking, content (prompt-injection) inspection, human approval,
 * rate limiting and auditing. They are exposed as plain services plus ONE
 * aspect (see `GuardAspect`) because the existing AOP pipeline applies a single
 * `Around` per method.
 */

export {
  createMaskingService,
  DEFAULT_MASKING_RULES,
  type MaskingRule,
  type MaskingService,
} from './masking';

export {
  createContentGuard,
  DEFAULT_INJECTION_RULES,
  type ContentDecision,
  type ContentFinding,
  type ContentGuard,
  type ContentRisk,
} from './content';

export {
  createApprovalService,
  createCallbackApprovalService,
  type ApprovalDecisionLike,
  type ApprovalService,
  type ApprovalTicketLike,
  type KeyValueStore,
} from './approval';

export { createRateLimiter, type RateLimiter, type RateLimitResult } from './ratelimit';

export {
  createAuditService,
  summarizeArguments,
  type AuditService,
  type GuardAuditRecord,
} from './audit';

export { createGuardAspect, GuardAspect, GuardError, type GuardAspectOptions } from './aspects';

import { createMaskingService } from './masking';
import { createContentGuard } from './content';
import { createRateLimiter } from './ratelimit';
import { createAuditService, type GuardAuditRecord } from './audit';
import { createGuardAspect, type GuardAspectOptions } from './aspects';
import { createApprovalService, type ApprovalService, type KeyValueStore } from './approval';

export interface GuardBundle {
  masking: ReturnType<typeof createMaskingService>;
  content: ReturnType<typeof createContentGuard>;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  audit: ReturnType<typeof createAuditService>;
  approval: ApprovalService;
  aspect: ReturnType<typeof createGuardAspect>;
}

/**
 * Create every guard service plus the aspect that composes them.
 *
 * @param options.app the Koatty application (used for the current context)
 * @param options.rateLimit max calls per caller+target per window
 * @param options.windowMs rate-limit window
 * @param options.approvalTimeoutMs approval timeout; tickets time out to REJECT
 * @param options.approvalStore optional shared store for approval tickets
 */
export function createGuard(options: {
  app: any;
  masking?: GuardAspectOptions['masking'];
  content?: GuardAspectOptions['content'];
  rateLimit?: number;
  windowMs?: number;
  approvalTimeoutMs?: number;
  approvalStore?: KeyValueStore;
  requiresApproval?: GuardAspectOptions['requiresApproval'];
  inspectsContent?: GuardAspectOptions['inspectsContent'];
  auditSink?: (record: GuardAuditRecord) => void | Promise<void>;
}): GuardBundle {
  const masking = options.masking ?? createMaskingService();
  const content = options.content ?? createContentGuard();
  const rateLimiter = createRateLimiter({
    limit: options.rateLimit ?? 60,
    windowMs: options.windowMs ?? 60_000,
  });
  const audit = createAuditService({ sink: options.auditSink, mask: (value) => masking.mask(value) });
  const approval = createApprovalService({
    timeoutMs: options.approvalTimeoutMs,
    store: options.approvalStore,
  });
  const aspect = createGuardAspect({
    app: options.app,
    masking,
    content,
    rateLimiter,
    audit,
    approval,
    requiresApproval: options.requiresApproval,
    inspectsContent: options.inspectsContent,
  });
  return { masking, content, rateLimiter, audit, approval, aspect };
}
